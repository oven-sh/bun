const ModuleLoader = @This();

pub const node_fallbacks = @import("../node_fallbacks.zig");
pub const AsyncModule = @import("./AsyncModule.zig").AsyncModule;
pub const RuntimeTranspilerStore = @import("./RuntimeTranspilerStore.zig").RuntimeTranspilerStore;
pub const HardcodedModule = @import("./HardcodedModule.zig").HardcodedModule;

transpile_source_code_arena: ?*bun.ArenaAllocator = null,
eval_source: ?*logger.Source = null,

comptime {
    _ = Bun__transpileVirtualModule;
    _ = Bun__runVirtualModule;
    _ = Bun__transpileFile;
    _ = Bun__fetchBuiltinModule;
    _ = Bun__getDefaultLoader;
}

pub var is_allowed_to_use_internal_testing_apis = false;

/// This must be called after calling transpileSourceCode
pub fn resetArena(this: *ModuleLoader, jsc_vm: *VirtualMachine) void {
    bun.assert(&jsc_vm.module_loader == this);
    if (this.transpile_source_code_arena) |arena| {
        if (jsc_vm.smol) {
            _ = arena.reset(.free_all);
        } else {
            _ = arena.reset(.{ .retain_with_limit = 8 * 1024 * 1024 });
        }
    }
}

pub fn resolveEmbeddedFile(vm: *VirtualMachine, path_buf: *bun.PathBuffer, input_path: []const u8, extname: []const u8) ?[]const u8 {
    if (input_path.len == 0) return null;
    var graph = vm.standalone_module_graph orelse return null;
    const file = graph.find(input_path) orelse return null;

    if (comptime Environment.isLinux) {
        // TODO: use /proc/fd/12346 instead! Avoid the copy!
    }

    // atomically write to a tmpfile and then move it to the final destination
    const tmpname_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(tmpname_buf);
    const tmpfilename = bun.fs.FileSystem.tmpname(extname, tmpname_buf, bun.hash(file.name)) catch return null;

    const tmpdir: bun.FD = .fromStdDir(bun.fs.FileSystem.instance.tmpdir() catch return null);

    // First we open the tmpfile, to avoid any other work in the event of failure.
    const tmpfile = bun.Tmpfile.create(tmpdir, tmpfilename).unwrap() catch return null;
    defer tmpfile.fd.close();

    switch (bun.api.node.fs.NodeFS.writeFileWithPathBuffer(
        tmpname_buf, // not used

        .{
            .data = .{
                .encoded_slice = ZigString.Slice.fromUTF8NeverFree(file.contents),
            },
            .dirfd = tmpdir,
            .file = .{ .fd = tmpfile.fd },
            .encoding = .buffer,
        },
    )) {
        .err => {
            return null;
        },
        else => {},
    }
    return bun.path.joinAbsStringBuf(bun.fs.FileSystem.RealFS.tmpdirPath(), path_buf, &[_]string{tmpfilename}, .auto);
}

pub export fn Bun__getDefaultLoader(global: *JSGlobalObject, str: *const bun.String) api.Loader {
    var jsc_vm = global.bunVM();
    const filename = str.toUTF8(jsc_vm.allocator);
    defer filename.deinit();
    const loader = jsc_vm.transpiler.options.loader(Fs.PathName.init(filename.slice()).ext).toAPI();
    if (loader == .file) {
        return api.Loader.js;
    }

    return loader;
}

pub fn transpileSourceCode(
    jsc_vm: *VirtualMachine,
    specifier: string,
    referrer: string,
    input_specifier: String,
    path: Fs.Path,
    loader: options.Loader,
    module_type: options.ModuleType,
    log: *logger.Log,
    virtual_source: ?*const logger.Source,
    promise_ptr: ?*?*jsc.JSInternalPromise,
    source_code_printer: *js_printer.BufferPrinter,
    globalObject: ?*JSGlobalObject,
    comptime flags: FetchFlags,
) !ResolvedSource {
    const disable_transpilying = comptime flags.disableTranspiling();

    if (comptime disable_transpilying) {
        if (!(loader.isJavaScriptLike() or loader == .toml or loader == .yaml or loader == .json5 or loader == .text or loader == .json or loader == .jsonc)) {
            // Don't print "export default <file path>"
            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.empty,
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
            };
        }
    }

    switch (loader) {
        .js, .jsx, .ts, .tsx, .json, .jsonc, .toml, .yaml, .json5, .text => {
            // Ensure that if there was an ASTMemoryAllocator in use, it's not used anymore.
            var ast_scope = js_ast.ASTMemoryAllocator.Scope{};
            ast_scope.enter();
            defer ast_scope.exit();

            jsc_vm.transpiled_count += 1;
            jsc_vm.transpiler.resetStore();
            const hash = bun.Watcher.getHash(path.text);
            const is_main = jsc_vm.main.len == path.text.len and
                jsc_vm.main_hash == hash and
                strings.eqlLong(jsc_vm.main, path.text, false);

            var arena_: ?*bun.ArenaAllocator = brk: {
                // Attempt to reuse the Arena from the parser when we can
                // This code is potentially re-entrant, so only one Arena can be reused at a time
                // That's why we have to check if the Arena is null
                //
                // Using an Arena here is a significant memory optimization when loading many files
                if (jsc_vm.module_loader.transpile_source_code_arena) |shared| {
                    jsc_vm.module_loader.transpile_source_code_arena = null;
                    break :brk shared;
                }

                // we must allocate the arena so that the pointer it points to is always valid.
                const arena = try jsc_vm.allocator.create(bun.ArenaAllocator);
                arena.* = bun.ArenaAllocator.init(bun.default_allocator);
                break :brk arena;
            };

            var give_back_arena = true;
            defer {
                if (give_back_arena) {
                    if (jsc_vm.module_loader.transpile_source_code_arena == null) {
                        // when .print_source is used
                        // caller is responsible for freeing the arena
                        if (flags != .print_source) {
                            if (jsc_vm.smol) {
                                _ = arena_.?.reset(.free_all);
                            } else {
                                _ = arena_.?.reset(.{ .retain_with_limit = 8 * 1024 * 1024 });
                            }
                        }

                        jsc_vm.module_loader.transpile_source_code_arena = arena_;
                    } else {
                        arena_.?.deinit();
                        jsc_vm.allocator.destroy(arena_.?);
                    }
                }
            }

            var arena = arena_.?;
            const allocator = arena.allocator();

            var fd: ?StoredFileDescriptorType = null;
            var package_json: ?*PackageJSON = null;

            if (jsc_vm.bun_watcher.indexOf(hash)) |index| {
                fd = jsc_vm.bun_watcher.watchlist().items(.fd)[index].unwrapValid();
                package_json = jsc_vm.bun_watcher.watchlist().items(.package_json)[index];
            }

            var cache = jsc.RuntimeTranspilerCache{
                .output_code_allocator = allocator,
                .sourcemap_allocator = bun.default_allocator,
            };

            const old = jsc_vm.transpiler.log;
            jsc_vm.transpiler.log = log;
            jsc_vm.transpiler.linker.log = log;
            jsc_vm.transpiler.resolver.log = log;
            if (jsc_vm.transpiler.resolver.package_manager) |pm| {
                pm.log = log;
            }

            defer {
                jsc_vm.transpiler.log = old;
                jsc_vm.transpiler.linker.log = old;
                jsc_vm.transpiler.resolver.log = old;
                if (jsc_vm.transpiler.resolver.package_manager) |pm| {
                    pm.log = old;
                }
            }

            // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
            const is_node_override = strings.hasPrefixComptime(specifier, node_fallbacks.import_path);

            const macro_remappings = if (jsc_vm.macro_mode or !jsc_vm.has_any_macro_remappings or is_node_override)
                MacroRemap{}
            else
                jsc_vm.transpiler.options.macro_remap;

            var fallback_source: logger.Source = undefined;

            // Usually, we want to close the input file automatically.
            //
            // If we're re-using the file descriptor from the fs watcher
            // Do not close it because that will break the kqueue-based watcher
            //
            var should_close_input_file_fd = fd == null;

            // We don't want cjs wrappers around non-js files
            const module_type_only_for_wrappables = switch (loader) {
                .js, .jsx, .ts, .tsx => module_type,
                else => .unknown,
            };

            var input_file_fd: StoredFileDescriptorType = bun.invalid_fd;
            var parse_options = Transpiler.ParseOptions{
                .allocator = allocator,
                .path = path,
                .loader = loader,
                .dirname_fd = bun.invalid_fd,
                .file_descriptor = fd,
                .file_fd_ptr = &input_file_fd,
                .file_hash = hash,
                .macro_remappings = macro_remappings,
                .jsx = jsc_vm.transpiler.options.jsx,
                .emit_decorator_metadata = jsc_vm.transpiler.options.emit_decorator_metadata,
                .virtual_source = virtual_source,
                .dont_bundle_twice = true,
                .allow_commonjs = true,
                .module_type = module_type_only_for_wrappables,
                .inject_jest_globals = jsc_vm.transpiler.options.rewrite_jest_for_tests,
                .keep_json_and_toml_as_one_statement = true,
                .allow_bytecode_cache = true,
                .set_breakpoint_on_first_line = is_main and
                    jsc_vm.debugger != null and
                    jsc_vm.debugger.?.set_breakpoint_on_first_line and
                    setBreakPointOnFirstLine(),
                .runtime_transpiler_cache = if (!disable_transpilying and !jsc.RuntimeTranspilerCache.is_disabled) &cache else null,
                .remove_cjs_module_wrapper = is_main and jsc_vm.module_loader.eval_source != null,
            };
            defer {
                if (should_close_input_file_fd and input_file_fd != bun.invalid_fd) {
                    input_file_fd.close();
                    input_file_fd = bun.invalid_fd;
                }
            }

            if (is_node_override) {
                if (node_fallbacks.contentsFromPath(specifier)) |code| {
                    const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                    fallback_source = logger.Source{ .path = fallback_path, .contents = code };
                    parse_options.virtual_source = &fallback_source;
                }
            }

            var parse_result: ParseResult = switch (disable_transpilying or
                (loader == .json)) {
                inline else => |return_file_only| brk: {
                    break :brk jsc_vm.transpiler.parseMaybeReturnFileOnly(
                        parse_options,
                        null,
                        return_file_only,
                    ) orelse {
                        if (comptime !disable_transpilying) {
                            if (jsc_vm.isWatcherEnabled()) {
                                if (input_file_fd.isValid()) {
                                    if (!is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                                        should_close_input_file_fd = false;
                                        _ = jsc_vm.bun_watcher.addFile(
                                            input_file_fd,
                                            path.text,
                                            hash,
                                            loader,
                                            .invalid,
                                            package_json,
                                            true,
                                        );
                                    }
                                }
                            }
                        }

                        give_back_arena = false;
                        return error.ParseError;
                    };
                },
            };

            const source = &parse_result.source;

            if (parse_result.loader == .wasm) {
                return transpileSourceCode(
                    jsc_vm,
                    specifier,
                    referrer,
                    input_specifier,
                    path,
                    .wasm,
                    .unknown, // cjs/esm don't make sense for wasm
                    log,
                    &parse_result.source,
                    promise_ptr,
                    source_code_printer,
                    globalObject,
                    flags,
                );
            }

            if (comptime !disable_transpilying) {
                if (jsc_vm.isWatcherEnabled()) {
                    if (input_file_fd.isValid()) {
                        if (!is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                            should_close_input_file_fd = false;
                            _ = jsc_vm.bun_watcher.addFile(
                                input_file_fd,
                                path.text,
                                hash,
                                loader,
                                .invalid,
                                package_json,
                                true,
                            );
                        }
                    }
                }
            }

            if (jsc_vm.transpiler.log.errors > 0) {
                give_back_arena = false;
                return error.ParseError;
            }

            if (loader == .json) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.cloneUTF8(source.contents),
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = ResolvedSource.Tag.json_for_object_loader,
                };
            }

            if (comptime disable_transpilying) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = switch (comptime flags) {
                        .print_source_and_clone => bun.String.init(jsc_vm.allocator.dupe(u8, source.contents) catch unreachable),
                        .print_source => bun.String.init(source.contents),
                        else => @compileError("unreachable"),
                    },
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                };
            }

            if (loader == .json or loader == .jsonc or loader == .toml or loader == .yaml or loader == .json5) {
                if (parse_result.empty) {
                    return ResolvedSource{
                        .allocator = null,
                        .specifier = input_specifier,
                        .source_url = input_specifier.createIfDifferent(path.text),
                        .jsvalue_for_export = JSValue.createEmptyObject(jsc_vm.global, 0),
                        .tag = .exports_object,
                    };
                }

                return ResolvedSource{
                    .allocator = null,
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .jsvalue_for_export = parse_result.ast.parts.at(0).stmts[0].data.s_expr.value.toJS(allocator, globalObject orelse jsc_vm.global) catch |e| panic("Unexpected JS error: {s}", .{@errorName(e)}),
                    .tag = .exports_object,
                };
            }

            if (parse_result.already_bundled != .none) {
                const bytecode_slice = parse_result.already_bundled.bytecodeSlice();
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.cloneLatin1(source.contents),
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .already_bundled = true,
                    .bytecode_cache = if (bytecode_slice.len > 0) bytecode_slice.ptr else null,
                    .bytecode_cache_size = bytecode_slice.len,
                    .is_commonjs_module = parse_result.already_bundled.isCommonJS(),
                };
            }

            if (parse_result.empty) {
                const was_cjs = (loader == .js or loader == .ts) and brk: {
                    const ext = std.fs.path.extension(source.path.text);
                    break :brk strings.eqlComptime(ext, ".cjs") or strings.eqlComptime(ext, ".cts");
                };
                if (was_cjs) {
                    return .{
                        .allocator = null,
                        .source_code = bun.String.static("(function(){})"),
                        .specifier = input_specifier,
                        .source_url = input_specifier.createIfDifferent(path.text),
                        .is_commonjs_module = true,
                        .tag = .javascript,
                    };
                }
            }

            if (cache.entry) |*entry| {
                jsc_vm.source_mappings.putMappings(source, .{
                    .list = .{ .items = @constCast(entry.sourcemap), .capacity = entry.sourcemap.len },
                    .allocator = bun.default_allocator,
                }) catch {};

                if (comptime Environment.allow_assert) {
                    dumpSourceString(jsc_vm, specifier, entry.output_code.byteSlice());
                }

                return ResolvedSource{
                    .allocator = null,
                    .source_code = switch (entry.output_code) {
                        .string => entry.output_code.string,
                        .utf8 => brk: {
                            const result = bun.String.cloneUTF8(entry.output_code.utf8);
                            cache.output_code_allocator.free(entry.output_code.utf8);
                            entry.output_code.utf8 = "";
                            break :brk result;
                        },
                    },
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .is_commonjs_module = entry.metadata.module_type == .cjs,
                    .tag = brk: {
                        if (entry.metadata.module_type == .cjs and source.path.isFile()) {
                            const actual_package_json: *PackageJSON = package_json orelse brk2: {
                                // this should already be cached virtually always so it's fine to do this
                                const dir_info = (jsc_vm.transpiler.resolver.readDirInfo(source.path.name.dir) catch null) orelse
                                    break :brk .javascript;

                                break :brk2 dir_info.package_json orelse dir_info.enclosing_package_json;
                            } orelse break :brk .javascript;

                            if (actual_package_json.module_type == .esm) {
                                break :brk ResolvedSource.Tag.package_json_type_module;
                            }
                        }

                        break :brk ResolvedSource.Tag.javascript;
                    },
                };
            }

            const start_count = jsc_vm.transpiler.linker.import_counter;

            // We _must_ link because:
            // - node_modules bundle won't be properly
            try jsc_vm.transpiler.linker.link(
                path,
                &parse_result,
                jsc_vm.origin,
                .absolute_path,
                false,
                true,
            );

            if (parse_result.pending_imports.len > 0) {
                if (promise_ptr == null) {
                    return error.UnexpectedPendingResolution;
                }

                if (source.contents_is_recycled) {
                    // this shared buffer is about to become owned by the AsyncModule struct
                    jsc_vm.transpiler.resolver.caches.fs.resetSharedBuffer(
                        jsc_vm.transpiler.resolver.caches.fs.sharedBuffer(),
                    );
                }

                jsc_vm.modules.enqueue(
                    globalObject.?,
                    .{
                        .parse_result = parse_result,
                        .path = path,
                        .loader = loader,
                        .fd = fd,
                        .package_json = package_json,
                        .hash = hash,
                        .promise_ptr = promise_ptr,
                        .specifier = specifier,
                        .referrer = referrer,
                        .arena = arena,
                    },
                );
                give_back_arena = false;
                return error.AsyncModule;
            }

            if (!jsc_vm.macro_mode)
                jsc_vm.resolved_count += jsc_vm.transpiler.linker.import_counter - start_count;
            jsc_vm.transpiler.linker.import_counter = 0;

            var printer = source_code_printer.*;
            printer.ctx.reset();
            defer source_code_printer.* = printer;
            _ = brk: {
                var mapper = jsc_vm.sourceMapHandler(&printer);

                break :brk try jsc_vm.transpiler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    mapper.get(),
                );
            };

            if (comptime Environment.dump_source) {
                dumpSource(jsc_vm, specifier, &printer);
            }

            defer {
                if (is_main) {
                    jsc_vm.has_loaded = true;
                }
            }

            if (jsc_vm.isWatcherEnabled()) {
                var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, input_specifier, path.text, null, false);
                resolved_source.is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs;
                return resolved_source;
            }

            // Pass along package.json type "module" if set.
            const tag: ResolvedSource.Tag = switch (loader) {
                .json, .jsonc => .json_for_object_loader,
                .js, .jsx, .ts, .tsx => brk: {
                    const module_type_ = if (package_json) |pkg| pkg.module_type else module_type;

                    break :brk switch (module_type_) {
                        .esm => .package_json_type_module,
                        .cjs => .package_json_type_commonjs,
                        else => .javascript,
                    };
                },
                else => .javascript,
            };

            return .{
                .allocator = null,
                .source_code = brk: {
                    const written = printer.ctx.getWritten();
                    const result = cache.output_code orelse bun.String.cloneLatin1(written);

                    if (written.len > 1024 * 1024 * 2 or jsc_vm.smol) {
                        printer.ctx.buffer.deinit();
                    }

                    break :brk result;
                },
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs,
                .tag = tag,
            };
        },
        // provideFetch() should be called
        .napi => unreachable,
        // .wasm => {
        //     jsc_vm.transpiled_count += 1;
        //     var fd: ?StoredFileDescriptorType = null;

        //     var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;

        //     const hash = http.Watcher.getHash(path.text);
        //     if (jsc_vm.watcher) |watcher| {
        //         if (watcher.indexOf(hash)) |index| {
        //             const _fd = watcher.watchlist().items(.fd)[index];
        //             fd = if (_fd > 0) _fd else null;
        //         }
        //     }

        //     var parse_options = Transpiler.ParseOptions{
        //         .allocator = allocator,
        //         .path = path,
        //         .loader = loader,
        //         .dirname_fd = 0,
        //         .file_descriptor = fd,
        //         .file_hash = hash,
        //         .macro_remappings = MacroRemap{},
        //         .jsx = jsc_vm.transpiler.options.jsx,
        //     };

        //     var parse_result = jsc_vm.transpiler.parse(
        //         parse_options,
        //         null,
        //     ) orelse {
        //         return error.ParseError;
        //     };

        //     return ResolvedSource{
        //         .allocator = if (jsc_vm.has_loaded) &jsc_vm.allocator else null,
        //         .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, source.contents) catch unreachable),
        //         .specifier = ZigString.init(specifier),
        //         .source_url = input_specifier.createIfDifferent(path.text),
        //         .tag = ResolvedSource.Tag.wasm,
        //     };
        // },
        .wasm => {
            if (strings.eqlComptime(referrer, "undefined") and strings.eqlLong(jsc_vm.main, path.text, true)) {
                if (virtual_source) |source| {
                    if (globalObject) |globalThis| {
                        // attempt to avoid reading the WASM file twice.
                        const decoded: jsc.DecodedJSValue = .{
                            .u = .{ .ptr = @ptrCast(globalThis) },
                        };
                        const globalValue = decoded.encode();
                        globalValue.put(
                            globalThis,
                            ZigString.static("wasmSourceBytes"),
                            try jsc.ArrayBuffer.create(globalThis, source.contents, .Uint8Array),
                        );
                    }
                }
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.static(@embedFile("../js/wasi-runner.js")),
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = .esm,
                };
            }

            return transpileSourceCode(
                jsc_vm,
                specifier,
                referrer,
                input_specifier,
                path,
                .file,
                .unknown, // cjs/esm don't make sense for wasm
                log,
                virtual_source,
                promise_ptr,
                source_code_printer,
                globalObject,
                flags,
            );
        },

        .sqlite_embedded, .sqlite => {
            const sqlite_module_source_code_string = brk: {
                if (jsc_vm.hot_reload == .hot) {
                    break :brk 
                    \\// Generated code
                    \\import {Database} from 'bun:sqlite';
                    \\const {path} = import.meta;
                    \\
                    \\// Don't reload the database if it's already loaded
                    \\const registry = (globalThis[Symbol.for("bun:sqlite:hot")] ??= new Map());
                    \\
                    \\export let db = registry.get(path);
                    \\export const __esModule = true;
                    \\if (!db) {
                    \\   // Load the database
                    \\   db = new Database(path);
                    \\   registry.set(path, db);
                    \\}
                    \\
                    \\export default db;
                    ;
                }

                break :brk 
                \\// Generated code
                \\import {Database} from 'bun:sqlite';
                \\export const db = new Database(import.meta.path);
                \\
                \\export const __esModule = true;
                \\export default db;
                ;
            };

            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.cloneUTF8(sqlite_module_source_code_string),
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .tag = .esm,
            };
        },

        .html => {
            if (flags.disableTranspiling()) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.empty,
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = .esm,
                };
            }

            if (globalObject == null) {
                return error.NotSupported;
            }

            const html_bundle = try jsc.API.HTMLBundle.init(globalObject.?, path.text);
            return ResolvedSource{
                .allocator = &jsc_vm.allocator,
                .jsvalue_for_export = html_bundle.toJS(globalObject.?),
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .tag = .export_default_object,
            };
        },

        else => {
            if (flags.disableTranspiling()) {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.empty,
                    .specifier = input_specifier,
                    .source_url = input_specifier.createIfDifferent(path.text),
                    .tag = .esm,
                };
            }

            if (virtual_source == null) {
                if (jsc_vm.isWatcherEnabled()) auto_watch: {
                    if (std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                        const input_fd: bun.StoredFileDescriptorType = brk: {
                            // on macOS, we need a file descriptor to receive event notifications on it.
                            // so we use O_EVTONLY to open the file descriptor without asking any additional permissions.
                            if (bun.Watcher.requires_file_descriptors) {
                                switch (bun.sys.open(
                                    &(std.posix.toPosixPath(path.text) catch break :auto_watch),
                                    bun.c.O_EVTONLY,
                                    0,
                                )) {
                                    .err => break :auto_watch,
                                    .result => |fd| break :brk fd,
                                }
                            } else {
                                // Otherwise, don't even bother opening it.
                                break :brk .invalid;
                            }
                        };
                        const hash = bun.Watcher.getHash(path.text);
                        switch (jsc_vm.bun_watcher.addFile(
                            input_fd,
                            path.text,
                            hash,
                            loader,
                            .invalid,
                            null,
                            true,
                        )) {
                            .err => {
                                if (comptime Environment.isMac) {
                                    // If any error occurs and we just
                                    // opened the file descriptor to
                                    // receive event notifications on
                                    // it, we should close it.
                                    if (input_fd.isValid()) {
                                        input_fd.close();
                                    }
                                }

                                // we don't consider it a failure if we cannot watch the file
                                // they didn't open the file
                            },
                            .result => {},
                        }
                    }
                }
            }

            const value = brk: {
                if (!jsc_vm.origin.isEmpty()) {
                    var buf = bun.handleOom(MutableString.init2048(jsc_vm.allocator));
                    defer buf.deinit();
                    var writer = buf.writer();
                    jsc.API.Bun.getPublicPath(specifier, jsc_vm.origin, @TypeOf(&writer), &writer);
                    break :brk try bun.String.createUTF8ForJS(globalObject.?, buf.slice());
                }

                break :brk try bun.String.createUTF8ForJS(globalObject.?, path.text);
            };

            return ResolvedSource{
                .allocator = null,
                .jsvalue_for_export = value,
                .specifier = input_specifier,
                .source_url = input_specifier.createIfDifferent(path.text),
                .tag = .export_default_object,
            };
        },
    }
}

pub export fn Bun__resolveAndFetchBuiltinModule(
    jsc_vm: *VirtualMachine,
    specifier: *bun.String,
    ret: *jsc.ErrorableResolvedSource,
) bool {
    jsc.markBinding(@src());
    var log = logger.Log.init(jsc_vm.transpiler.allocator);
    defer log.deinit();

    const alias = HardcodedModule.Alias.bun_aliases.getWithEql(specifier.*, bun.String.eqlComptime) orelse
        return false;
    const hardcoded = HardcodedModule.map.get(alias.path) orelse {
        bun.debugAssert(false);
        return false;
    };
    ret.* = .ok(
        getHardcodedModule(jsc_vm, specifier.*, hardcoded) orelse
            return false,
    );
    return true;
}

pub export fn Bun__fetchBuiltinModule(
    jsc_vm: *VirtualMachine,
    globalObject: *JSGlobalObject,
    specifier: *bun.String,
    referrer: *bun.String,
    ret: *jsc.ErrorableResolvedSource,
) bool {
    jsc.markBinding(@src());
    var log = logger.Log.init(jsc_vm.transpiler.allocator);
    defer log.deinit();

    if (ModuleLoader.fetchBuiltinModule(
        jsc_vm,
        specifier.*,
    ) catch |err| {
        if (err == error.AsyncModule) {
            unreachable;
        }

        VirtualMachine.processFetchLog(globalObject, specifier.*, referrer.*, &log, ret, err);
        return true;
    }) |builtin| {
        ret.* = jsc.ErrorableResolvedSource.ok(builtin);
        return true;
    } else {
        return false;
    }
}

const always_sync_modules = .{"reflect-metadata"};

pub export fn Bun__transpileFile(
    jsc_vm: *VirtualMachine,
    globalObject: *JSGlobalObject,
    specifier_ptr: *bun.String,
    referrer: *bun.String,
    type_attribute: ?*const bun.String,
    ret: *jsc.ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    _force_loader_type: bun.schema.api.Loader,
) ?*anyopaque {
    jsc.markBinding(@src());
    const force_loader_type: bun.options.Loader.Optional = .fromAPI(_force_loader_type);
    var log = logger.Log.init(jsc_vm.transpiler.allocator);
    defer log.deinit();

    var _specifier = specifier_ptr.toUTF8(jsc_vm.allocator);
    var referrer_slice = referrer.toUTF8(jsc_vm.allocator);
    defer _specifier.deinit();
    defer referrer_slice.deinit();

    var type_attribute_str: ?string = null;
    if (type_attribute) |attribute| if (attribute.asUTF8()) |attr_utf8| {
        type_attribute_str = attr_utf8;
    };

    var virtual_source_to_use: ?logger.Source = null;
    var blob_to_deinit: ?jsc.WebCore.Blob = null;
    var lr = options.getLoaderAndVirtualSource(_specifier.slice(), jsc_vm, &virtual_source_to_use, &blob_to_deinit, type_attribute_str) catch {
        ret.* = jsc.ErrorableResolvedSource.err(error.JSErrorObject, globalObject.ERR(.MODULE_NOT_FOUND, "Blob not found", .{}).toJS());
        return null;
    };
    defer if (blob_to_deinit) |*blob| blob.deinit();

    if (force_loader_type.unwrap()) |loader_type| {
        @branchHint(.unlikely);
        bun.assert(!is_commonjs_require);
        lr.loader = loader_type;
    } else if (is_commonjs_require and jsc_vm.has_mutated_built_in_extensions > 0) {
        @branchHint(.unlikely);
        if (node_module_module.findLongestRegisteredExtension(jsc_vm, _specifier.slice())) |entry| {
            switch (entry) {
                .loader => |loader| {
                    lr.loader = loader;
                },
                .custom => |strong| {
                    ret.* = jsc.ErrorableResolvedSource.ok(ResolvedSource{
                        .allocator = null,
                        .source_code = bun.String.empty,
                        .specifier = .empty,
                        .source_url = .empty,
                        .cjs_custom_extension_index = strong.get(),
                        .tag = .common_js_custom_extension,
                    });
                    return null;
                },
            }
        }
    }

    const module_type: options.ModuleType = brk: {
        const ext = lr.path.name.ext;
        // regular expression /.[cm][jt]s$/
        if (ext.len == ".cjs".len) {
            if (strings.eqlComptimeIgnoreLen(ext, ".cjs"))
                break :brk .cjs;
            if (strings.eqlComptimeIgnoreLen(ext, ".mjs"))
                break :brk .esm;
            if (strings.eqlComptimeIgnoreLen(ext, ".cts"))
                break :brk .cjs;
            if (strings.eqlComptimeIgnoreLen(ext, ".mts"))
                break :brk .esm;
        }
        // regular expression /.[jt]s$/
        if (ext.len == ".ts".len) {
            if (strings.eqlComptimeIgnoreLen(ext, ".js") or
                strings.eqlComptimeIgnoreLen(ext, ".ts"))
            {
                // Use the package.json module type if it exists
                break :brk if (lr.package_json) |pkg|
                    pkg.module_type
                else
                    .unknown;
            }
        }
        // For JSX TSX and other extensions, let the file contents.
        break :brk .unknown;
    };
    const pkg_name: ?[]const u8 = if (lr.package_json) |pkg|
        if (pkg.name.len > 0) pkg.name else null
    else
        null;

    // We only run the transpiler concurrently when we can.
    // Today, that's:
    //
    //   Import Statements (import 'foo')
    //   Import Expressions (import('foo'))
    //
    transpile_async: {
        if (comptime bun.FeatureFlags.concurrent_transpiler) {
            const concurrent_loader = lr.loader orelse .file;
            if (blob_to_deinit == null and
                allow_promise and
                (jsc_vm.has_loaded or jsc_vm.is_in_preload) and
                concurrent_loader.isJavaScriptLike() and
                !lr.is_main and
                // Plugins make this complicated,
                // TODO: allow running concurrently when no onLoad handlers match a plugin.
                jsc_vm.plugin_runner == null and jsc_vm.transpiler_store.enabled)
            {
                // This absolutely disgusting hack is a workaround in cases
                // where an async import is made to a CJS file with side
                // effects that other modules depend on, without incurring
                // the cost of transpiling/loading CJS modules synchronously.
                //
                // The cause of this comes from the fact that we immediately
                // and synchronously evaluate CJS modules after they've been
                // transpiled, but transpiling (which, for async imports,
                // happens in a thread pool), can resolve in whatever order.
                // This messes up module execution order.
                //
                // This is only _really_ important for
                // import("some-polyfill") cases, the most impactful of
                // which is `reflect-metadata`. People could also use
                // require or just preload their polyfills, but they aren't
                // doing this. This hack makes important polyfills work without
                // incurring the cost of transpiling/loading CJS modules
                // synchronously. The proper fix is to evaluate CJS modules
                // at the same time as ES modules. This is blocked by the
                // fact that we need exports from CJS modules and our parser
                // doesn't record them.
                if (pkg_name) |pkg_name_| {
                    inline for (always_sync_modules) |always_sync_specifier| {
                        if (bun.strings.eqlComptime(pkg_name_, always_sync_specifier)) {
                            break :transpile_async;
                        }
                    }
                }

                // TODO: check if the resolved source must be transpiled synchronously
                return jsc_vm.transpiler_store.transpile(
                    jsc_vm,
                    globalObject,
                    specifier_ptr.dupeRef(),
                    lr.path,
                    referrer.dupeRef(),
                    concurrent_loader,
                    lr.package_json,
                );
            }
        }
    }

    const synchronous_loader: options.Loader = lr.loader orelse loader: {
        if (jsc_vm.has_loaded or jsc_vm.is_in_preload) {
            // Extensionless files in this context are treated as the JS loader
            if (lr.path.name.ext.len == 0) {
                break :loader .tsx;
            }

            // Unknown extensions are to be treated as file loader
            if (is_commonjs_require) {
                if (jsc_vm.commonjs_custom_extensions.entries.len > 0 and
                    jsc_vm.has_mutated_built_in_extensions == 0)
                {
                    @branchHint(.unlikely);
                    if (node_module_module.findLongestRegisteredExtension(jsc_vm, lr.path.text)) |entry| {
                        switch (entry) {
                            .loader => |loader| break :loader loader,
                            .custom => |strong| {
                                ret.* = jsc.ErrorableResolvedSource.ok(ResolvedSource{
                                    .allocator = null,
                                    .source_code = bun.String.empty,
                                    .specifier = .empty,
                                    .source_url = .empty,
                                    .cjs_custom_extension_index = strong.get(),
                                    .tag = .common_js_custom_extension,
                                });
                                return null;
                            },
                        }
                    }
                }

                // For Node.js compatibility, requiring a file with an
                // unknown extension will be treated as a JS file
                break :loader .ts;
            }

            // For ESM, Bun treats unknown extensions as file loader
            break :loader .file;
        } else {
            // Unless it's potentially the main module
            // This is important so that "bun run ./foo-i-have-no-extension" works
            break :loader .tsx;
        }
    };

    if (comptime Environment.allow_assert)
        debug("transpile({s}, {s}, sync)", .{ lr.specifier, @tagName(synchronous_loader) });

    defer jsc_vm.module_loader.resetArena(jsc_vm);

    var promise: ?*jsc.JSInternalPromise = null;
    ret.* = jsc.ErrorableResolvedSource.ok(
        ModuleLoader.transpileSourceCode(
            jsc_vm,
            lr.specifier,
            referrer_slice.slice(),
            specifier_ptr.*,
            lr.path,
            synchronous_loader,
            module_type,
            &log,
            lr.virtual_source,
            if (allow_promise) &promise else null,
            VirtualMachine.source_code_printer.?,
            globalObject,
            FetchFlags.transpile,
        ) catch |err| {
            switch (err) {
                error.AsyncModule => {
                    bun.assert(promise != null);
                    return promise;
                },
                error.PluginError => return null,
                error.JSError => {
                    ret.* = jsc.ErrorableResolvedSource.err(error.JSError, globalObject.takeError(error.JSError));
                    return null;
                },
                else => {
                    VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer.*, &log, ret, err);
                    return null;
                },
            }
        },
    );
    return promise;
}

export fn Bun__runVirtualModule(globalObject: *JSGlobalObject, specifier_ptr: *const bun.String) JSValue {
    jsc.markBinding(@src());
    if (globalObject.bunVM().plugin_runner == null) return JSValue.zero;

    const specifier_slice = specifier_ptr.toUTF8(bun.default_allocator);
    defer specifier_slice.deinit();
    const specifier = specifier_slice.slice();

    if (!PluginRunner.couldBePlugin(specifier)) {
        return JSValue.zero;
    }

    const namespace = PluginRunner.extractNamespace(specifier);
    const after_namespace = if (namespace.len == 0)
        specifier
    else
        specifier[@min(namespace.len + 1, specifier.len)..];

    return globalObject.runOnLoadPlugins(bun.String.init(namespace), bun.String.init(after_namespace), .bun) catch {
        return JSValue.zero;
    } orelse return .zero;
}

fn getHardcodedModule(jsc_vm: *VirtualMachine, specifier: bun.String, hardcoded: HardcodedModule) ?ResolvedSource {
    analytics.Features.builtin_modules.insert(hardcoded);
    return switch (hardcoded) {
        .@"bun:main" => .{
            .allocator = null,
            .source_code = bun.String.cloneUTF8(jsc_vm.entry_point.source.contents),
            .specifier = specifier,
            .source_url = specifier,
            .tag = .esm,
            .source_code_needs_deref = true,
        },
        .@"bun:internal-for-testing" => {
            if (!Environment.isDebug) {
                if (!is_allowed_to_use_internal_testing_apis)
                    return null;
            }
            return jsSyntheticModule(.@"bun:internal-for-testing", specifier);
        },
        .@"bun:wrap" => .{
            .allocator = null,
            .source_code = String.init(Runtime.Runtime.sourceCode()),
            .specifier = specifier,
            .source_url = specifier,
        },
        inline else => |tag| jsSyntheticModule(@field(ResolvedSource.Tag, @tagName(tag)), specifier),
    };
}

pub fn fetchBuiltinModule(jsc_vm: *VirtualMachine, specifier: bun.String) !?ResolvedSource {
    if (HardcodedModule.map.getWithEql(specifier, bun.String.eqlComptime)) |hardcoded| {
        return getHardcodedModule(jsc_vm, specifier, hardcoded);
    }

    if (specifier.hasPrefixComptime(js_ast.Macro.namespaceWithColon)) {
        const spec = specifier.toUTF8(bun.default_allocator);
        defer spec.deinit();
        if (jsc_vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(spec.slice()))) |entry| {
            return .{
                .allocator = null,
                .source_code = bun.String.cloneUTF8(entry.source.contents),
                .specifier = specifier,
                .source_url = specifier.dupeRef(),
            };
        }
    } else if (jsc_vm.standalone_module_graph) |graph| {
        const specifier_utf8 = specifier.toUTF8(bun.default_allocator);
        defer specifier_utf8.deinit();
        if (graph.files.getPtr(specifier_utf8.slice())) |file| {
            if (file.loader == .sqlite or file.loader == .sqlite_embedded) {
                const code =
                    \\/* Generated code */
                    \\import {Database} from 'bun:sqlite';
                    \\import {readFileSync} from 'node:fs';
                    \\export const db = new Database(readFileSync(import.meta.path));
                    \\
                    \\export const __esModule = true;
                    \\export default db;
                ;
                return .{
                    .allocator = null,
                    .source_code = bun.String.static(code),
                    .specifier = specifier,
                    .source_url = specifier.dupeRef(),
                    .source_code_needs_deref = false,
                };
            }

            return .{
                .allocator = null,
                .source_code = file.toWTFString(),
                .specifier = specifier,
                .source_url = specifier.dupeRef(),
                .source_code_needs_deref = false,
                .bytecode_cache = if (file.bytecode.len > 0) file.bytecode.ptr else null,
                .bytecode_cache_size = file.bytecode.len,
                .is_commonjs_module = file.module_format == .cjs,
            };
        }
    }

    return null;
}

export fn Bun__transpileVirtualModule(
    globalObject: *JSGlobalObject,
    specifier_ptr: *const bun.String,
    referrer_ptr: *const bun.String,
    source_code: *ZigString,
    loader_: api.Loader,
    ret: *jsc.ErrorableResolvedSource,
) bool {
    jsc.markBinding(@src());
    const jsc_vm = globalObject.bunVM();
    // Plugin runner is not required for virtual modules created via build.module()
    // bun.assert(jsc_vm.plugin_runner != null);

    var specifier_slice = specifier_ptr.toUTF8(jsc_vm.allocator);
    const specifier = specifier_slice.slice();
    defer specifier_slice.deinit();
    var source_code_slice = source_code.toSlice(jsc_vm.allocator);
    defer source_code_slice.deinit();
    var referrer_slice = referrer_ptr.toUTF8(jsc_vm.allocator);
    defer referrer_slice.deinit();

    var virtual_source = logger.Source.initPathString(specifier, source_code_slice.slice());
    var log = logger.Log.init(jsc_vm.allocator);
    const path = Fs.Path.init(specifier);

    const loader = if (loader_ != ._none)
        options.Loader.fromAPI(loader_)
    else
        jsc_vm.transpiler.options.loaders.get(path.name.ext) orelse brk: {
            if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                break :brk options.Loader.js;
            }

            break :brk options.Loader.file;
        };

    defer log.deinit();
    defer jsc_vm.module_loader.resetArena(jsc_vm);

    ret.* = jsc.ErrorableResolvedSource.ok(
        ModuleLoader.transpileSourceCode(
            jsc_vm,
            specifier_slice.slice(),
            referrer_slice.slice(),
            specifier_ptr.*,
            path,
            loader,
            .unknown,
            &log,
            &virtual_source,
            null,
            VirtualMachine.source_code_printer.?,
            globalObject,
            FetchFlags.transpile,
        ) catch |err| {
            switch (err) {
                error.PluginError => return true,
                error.JSError => {
                    ret.* = jsc.ErrorableResolvedSource.err(error.JSError, globalObject.takeError(error.JSError));
                    return true;
                },
                else => {
                    VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer_ptr.*, &log, ret, err);
                    return true;
                },
            }
        },
    );
    analytics.Features.virtual_modules += 1;
    return true;
}

inline fn jsSyntheticModule(name: ResolvedSource.Tag, specifier: String) ResolvedSource {
    return ResolvedSource{
        .allocator = null,
        .source_code = bun.String.empty,
        .specifier = specifier,
        .source_url = bun.String.static(@tagName(name)),
        .tag = name,
        .source_code_needs_deref = false,
    };
}

/// Dumps the module source to a file in /tmp/bun-debug-src/{filepath}
///
/// This can technically fail if concurrent access across processes happens, or permission issues.
/// Errors here should always be ignored.
pub const FetchFlags = enum {
    transpile,
    print_source,
    print_source_and_clone,

    pub fn disableTranspiling(this: FetchFlags) bool {
        return this != .transpile;
    }
};

/// Support embedded .node files
export fn Bun__resolveEmbeddedNodeFile(vm: *VirtualMachine, in_out_str: *bun.String) bool {
    if (vm.standalone_module_graph == null) return false;

    const input_path = in_out_str.toUTF8(bun.default_allocator);
    defer input_path.deinit();
    const path_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(path_buf);
    const result = ModuleLoader.resolveEmbeddedFile(vm, path_buf, input_path.slice(), "node") orelse return false;
    in_out_str.* = bun.String.cloneUTF8(result);
    return true;
}

export fn ModuleLoader__isBuiltin(data: [*]const u8, len: usize) bool {
    const str = data[0..len];
    return HardcodedModule.Alias.bun_aliases.get(str) != null;
}

const debug = Output.scoped(.ModuleLoader, .hidden);

const string = []const u8;

const Fs = @import("../fs.zig");
const Runtime = @import("../runtime.zig");
const ast = @import("../import_record.zig");
const node_module_module = @import("./bindings/NodeModuleModule.zig");
const std = @import("std");
const panic = std.debug.panic;

const options = @import("../options.zig");
const ModuleType = options.ModuleType;

const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;

const dumpSource = @import("./RuntimeTranspilerStore.zig").dumpSource;
const dumpSourceString = @import("./RuntimeTranspilerStore.zig").dumpSourceString;
const setBreakPointOnFirstLine = @import("./RuntimeTranspilerStore.zig").setBreakPointOnFirstLine;

const bun = @import("bun");
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const String = bun.String;
const Transpiler = bun.Transpiler;
const analytics = bun.analytics;
const js_ast = bun.ast;
const js_printer = bun.js_printer;
const logger = bun.logger;
const strings = bun.strings;
const Arena = bun.allocators.MimallocArena;
const api = bun.schema.api;

const jsc = bun.jsc;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const ResolvedSource = bun.jsc.ResolvedSource;
const VirtualMachine = bun.jsc.VirtualMachine;
const ZigString = bun.jsc.ZigString;
const Bun = jsc.API.Bun;

const ParseResult = bun.transpiler.ParseResult;
const PluginRunner = bun.transpiler.PluginRunner;
const MacroEntryPoint = bun.transpiler.EntryPoints.MacroEntryPoint;
