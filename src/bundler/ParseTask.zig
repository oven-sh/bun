pub const ContentsOrFd = union(enum) {
    fd: struct {
        dir: StoredFileDescriptorType,
        file: StoredFileDescriptorType,
    },
    contents: string,

    const Tag = @typeInfo(ContentsOrFd).@"union".tag_type.?;
};

pub const ParseTask = @This();

path: Fs.Path,
secondary_path_for_commonjs_interop: ?Fs.Path = null,
contents_or_fd: ContentsOrFd,
external_free_function: CacheEntry.ExternalFreeFunction = .none,
side_effects: _resolver.SideEffects,
loader: ?Loader = null,
jsx: options.JSX.Pragma,
source_index: Index = Index.invalid,
task: ThreadPoolLib.Task = .{ .callback = &taskCallback },

// Split this into a different task so that we don't accidentally run the
// tasks for io on the threads that are meant for parsing.
io_task: ThreadPoolLib.Task = .{ .callback = &ioTaskCallback },

// Used for splitting up the work between the io and parse steps.
stage: ParseTaskStage = .needs_source_code,

tree_shaking: bool = false,
known_target: options.Target,
module_type: options.ModuleType = .unknown,
emit_decorator_metadata: bool = false,
ctx: *BundleV2,
package_version: string = "",
is_entry_point: bool = false,

const ParseTaskStage = union(enum) {
    needs_source_code: void,
    needs_parse: CacheEntry,
};

/// The information returned to the Bundler thread when a parse finishes.
pub const Result = struct {
    task: EventLoop.Task,
    ctx: *BundleV2,
    value: Value,
    watcher_data: WatcherData,
    /// This is used for native onBeforeParsePlugins to store
    /// a function pointer and context pointer to free the
    /// returned source code by the plugin.
    external: CacheEntry.ExternalFreeFunction = .none,

    pub const Value = union(enum) {
        success: Success,
        err: Error,
        empty: struct {
            source_index: Index,
        },
    };

    const WatcherData = struct {
        fd: bun.StoredFileDescriptorType,
        dir_fd: bun.StoredFileDescriptorType,

        /// When no files to watch, this encoding is used.
        pub const none: WatcherData = .{
            .fd = bun.invalid_fd,
            .dir_fd = bun.invalid_fd,
        };
    };

    pub const Success = struct {
        ast: JSAst,
        source: Logger.Source,
        log: Logger.Log,
        use_directive: UseDirective,
        side_effects: _resolver.SideEffects,

        /// Used by "file" loader files.
        unique_key_for_additional_file: []const u8 = "",
        /// Used by "file" loader files.
        content_hash_for_additional_file: u64 = 0,

        loader: Loader,
    };

    pub const Error = struct {
        err: anyerror,
        step: Step,
        log: Logger.Log,
        target: options.Target,
        source_index: Index,

        pub const Step = enum {
            pending,
            read_file,
            parse,
            resolve,
        };
    };
};

const debug = Output.scoped(.ParseTask, .hidden);

pub fn init(resolve_result: *const _resolver.Result, source_index: Index, ctx: *BundleV2) ParseTask {
    return .{
        .ctx = ctx,
        .path = resolve_result.path_pair.primary,
        .contents_or_fd = .{
            .fd = .{
                .dir = resolve_result.dirname_fd,
                .file = resolve_result.file_fd,
            },
        },
        .side_effects = resolve_result.primary_side_effects_data,
        .jsx = resolve_result.jsx,
        .source_index = source_index,
        .module_type = resolve_result.module_type,
        .emit_decorator_metadata = resolve_result.flags.emit_decorator_metadata,
        .package_version = if (resolve_result.package_json) |package_json| package_json.version else "",
        .known_target = ctx.transpiler.options.target,
    };
}

const RuntimeSource = struct {
    parse_task: ParseTask,
    source: Logger.Source,
};

fn getRuntimeSourceComptime(comptime target: options.Target) RuntimeSource {
    // When the `require` identifier is visited, it is replaced with e_require_call_target
    // and then that is either replaced with the module itself, or an import to the
    // runtime here.
    const runtime_require = switch (target) {
        // Previously, Bun inlined `import.meta.require` at all usages. This broke
        // code that called `fn.toString()` and parsed the code outside a module
        // context.
        .bun, .bun_macro =>
        \\export var __require = import.meta.require;
        ,

        .node =>
        \\import { createRequire } from "node:module";
        \\export var __require = /* @__PURE__ */ createRequire(import.meta.url);
        \\
        ,

        // Copied from esbuild's runtime.go:
        //
        // > This fallback "require" function exists so that "typeof require" can
        // > naturally be "function" even in non-CommonJS environments since esbuild
        // > emulates a CommonJS environment (issue #1202). However, people want this
        // > shim to fall back to "globalThis.require" even if it's defined later
        // > (including property accesses such as "require.resolve") so we need to
        // > use a proxy (issue #1614).
        //
        // When bundling to node, esbuild picks this code path as well, but `globalThis.require`
        // is not always defined there. The `createRequire` call approach is more reliable.
        else =>
        \\export var __require = /* @__PURE__ */ (x =>
        \\  typeof require !== 'undefined' ? require :
        \\  typeof Proxy !== 'undefined' ? new Proxy(x, {
        \\    get: (a, b) => (typeof require !== 'undefined' ? require : a)[b]
        \\  }) : x
        \\)(function (x) {
        \\  if (typeof require !== 'undefined') return require.apply(this, arguments)
        \\  throw Error('Dynamic require of "' + x + '" is not supported')
        \\});
        \\
    };
    const runtime_using_symbols = switch (target) {
        // bun's webkit has Symbol.asyncDispose, Symbol.dispose, and SuppressedError, but not the syntax support
        .bun =>
        \\export var __using = (stack, value, async) => {
        \\  if (value != null) {
        \\    if (typeof value !== 'object' && typeof value !== 'function') throw TypeError('Object expected to be assigned to "using" declaration')
        \\    let dispose
        \\    if (async) dispose = value[Symbol.asyncDispose]
        \\    if (dispose === void 0) dispose = value[Symbol.dispose]
        \\    if (typeof dispose !== 'function') throw TypeError('Object not disposable')
        \\    stack.push([async, dispose, value])
        \\  } else if (async) {
        \\    stack.push([async])
        \\  }
        \\  return value
        \\}
        \\
        \\export var __callDispose = (stack, error, hasError) => {
        \\  let fail = e => error = hasError ? new SuppressedError(e, error, 'An error was suppressed during disposal') : (hasError = true, e)
        \\    , next = (it) => {
        \\      while (it = stack.pop()) {
        \\        try {
        \\          var result = it[1] && it[1].call(it[2])
        \\          if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()))
        \\        } catch (e) {
        \\          fail(e)
        \\        }
        \\      }
        \\      if (hasError) throw error
        \\    }
        \\  return next()
        \\}
        \\
        ,
        // Other platforms may or may not have the symbol or errors
        // The definitions of __dispose and __asyncDispose match what esbuild's __wellKnownSymbol() helper does
        else =>
        \\var __dispose = Symbol.dispose || /* @__PURE__ */ Symbol.for('Symbol.dispose');
        \\var __asyncDispose =  Symbol.asyncDispose || /* @__PURE__ */ Symbol.for('Symbol.asyncDispose');
        \\
        \\export var __using = (stack, value, async) => {
        \\  if (value != null) {
        \\    if (typeof value !== 'object' && typeof value !== 'function') throw TypeError('Object expected to be assigned to "using" declaration')
        \\    var dispose
        \\    if (async) dispose = value[__asyncDispose]
        \\    if (dispose === void 0) dispose = value[__dispose]
        \\    if (typeof dispose !== 'function') throw TypeError('Object not disposable')
        \\    stack.push([async, dispose, value])
        \\  } else if (async) {
        \\    stack.push([async])
        \\  }
        \\  return value
        \\}
        \\
        \\export var __callDispose = (stack, error, hasError) => {
        \\  var E = typeof SuppressedError === 'function' ? SuppressedError :
        \\    function (e, s, m, _) { return _ = Error(m), _.name = 'SuppressedError', _.error = e, _.suppressed = s, _ },
        \\    fail = e => error = hasError ? new E(e, error, 'An error was suppressed during disposal') : (hasError = true, e),
        \\    next = (it) => {
        \\      while (it = stack.pop()) {
        \\        try {
        \\          var result = it[1] && it[1].call(it[2])
        \\          if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()))
        \\        } catch (e) {
        \\          fail(e)
        \\        }
        \\      }
        \\      if (hasError) throw error
        \\    }
        \\  return next()
        \\}
        \\
    };
    const runtime_code = @embedFile("../runtime.js") ++ runtime_require ++ runtime_using_symbols;

    const parse_task = ParseTask{
        .ctx = undefined,
        .path = Fs.Path.initWithNamespace("runtime", "bun:runtime"),
        .side_effects = .no_side_effects__pure_data,
        .jsx = .{
            .parse = false,
        },
        .contents_or_fd = .{
            .contents = runtime_code,
        },
        .source_index = Index.runtime,
        .loader = .js,
        .known_target = target,
    };
    const source = Logger.Source{
        .path = parse_task.path,
        .contents = parse_task.contents_or_fd.contents,
        .index = Index.runtime,
    };
    return .{ .parse_task = parse_task, .source = source };
}

pub fn getRuntimeSource(target: options.Target) RuntimeSource {
    return switch (target) {
        inline else => |t| comptime getRuntimeSourceComptime(t),
    };
}

threadlocal var override_file_path_buf: bun.PathBuffer = undefined;

fn getEmptyCSSAST(
    log: *Logger.Log,
    transpiler: *Transpiler,
    opts: js_parser.Parser.Options,
    allocator: std.mem.Allocator,
    source: *const Logger.Source,
) !JSAst {
    const root = Expr.init(E.Object, E.Object{}, Logger.Loc{ .start = 0 });
    var ast = JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
    ast.css = bun.create(allocator, bun.css.BundlerStyleSheet, bun.css.BundlerStyleSheet.empty(allocator));
    return ast;
}

fn getEmptyAST(log: *Logger.Log, transpiler: *Transpiler, opts: js_parser.Parser.Options, allocator: std.mem.Allocator, source: *const Logger.Source, comptime RootType: type) !JSAst {
    const root = Expr.init(RootType, RootType{}, Logger.Loc.Empty);
    return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
}

const FileLoaderHash = struct {
    key: []const u8,
    content_hash: u64,
};

fn getAST(
    log: *Logger.Log,
    transpiler: *Transpiler,
    opts: js_parser.Parser.Options,
    allocator: std.mem.Allocator,
    resolver: *Resolver,
    source: *const Logger.Source,
    loader: Loader,
    unique_key_prefix: u64,
    unique_key_for_additional_file: *FileLoaderHash,
    has_any_css_locals: *std.atomic.Value(u32),
) !JSAst {
    switch (loader) {
        .jsx, .tsx, .js, .ts => {
            const trace = bun.perf.trace("Bundler.ParseJS");
            defer trace.end();
            return if (try resolver.caches.js.parse(
                transpiler.allocator,
                opts,
                transpiler.options.define,
                log,
                source,
            )) |res|
                JSAst.init(res.ast)
            else switch (opts.module_type == .esm) {
                inline else => |as_undefined| try getEmptyAST(
                    log,
                    transpiler,
                    opts,
                    allocator,
                    source,
                    if (as_undefined) E.Undefined else E.Object,
                ),
            };
        },
        .json, .jsonc => |v| {
            const trace = bun.perf.trace("Bundler.ParseJSON");
            defer trace.end();
            const root = (try resolver.caches.json.parseJSON(log, source, allocator, if (v == .jsonc) .jsonc else .json, true)) orelse Expr.init(E.Object, E.Object{}, Logger.Loc.Empty);
            return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
        },
        .toml => {
            const trace = bun.perf.trace("Bundler.ParseTOML");
            defer trace.end();
            var temp_log = bun.logger.Log.init(allocator);
            defer {
                bun.handleOom(temp_log.cloneToWithRecycled(log, true));
                temp_log.msgs.clearAndFree();
            }
            const root = try TOML.parse(source, &temp_log, allocator, false);
            return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, &temp_log, root, source, "")).?);
        },
        .yaml => {
            const trace = bun.perf.trace("Bundler.ParseYAML");
            defer trace.end();
            var temp_log = bun.logger.Log.init(allocator);
            defer {
                bun.handleOom(temp_log.cloneToWithRecycled(log, true));
                temp_log.msgs.clearAndFree();
            }
            const root = try YAML.parse(source, &temp_log, allocator);
            return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, &temp_log, root, source, "")).?);
        },
        .json5 => {
            const trace = bun.perf.trace("Bundler.ParseJSON5");
            defer trace.end();
            var temp_log = bun.logger.Log.init(allocator);
            defer {
                bun.handleOom(temp_log.cloneToWithRecycled(log, true));
                temp_log.msgs.clearAndFree();
            }
            const root = try JSON5.parse(source, &temp_log, allocator);
            return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, &temp_log, root, source, "")).?);
        },
        .text => {
            const root = Expr.init(E.String, E.String{
                .data = source.contents,
            }, Logger.Loc{ .start = 0 });
            var ast = JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
            ast.addUrlForCss(allocator, source, "text/plain", null);
            return ast;
        },

        .sqlite_embedded, .sqlite => {
            if (!transpiler.options.target.isBun()) {
                log.addError(
                    source,
                    Logger.Loc.Empty,
                    "To use the \"sqlite\" loader, set target to \"bun\"",
                ) catch |err| bun.handleOom(err);
                return error.ParserError;
            }

            const path_to_use = brk: {
                // Implements embedded sqlite
                if (loader == .sqlite_embedded) {
                    const embedded_path = std.fmt.allocPrint(allocator, "{f}A{d:0>8}", .{ bun.fmt.hexIntLower(unique_key_prefix), source.index.get() }) catch unreachable;
                    unique_key_for_additional_file.* = .{
                        .key = embedded_path,
                        .content_hash = ContentHasher.run(source.contents),
                    };
                    break :brk embedded_path;
                }

                break :brk source.path.text;
            };

            // This injects the following code:
            //
            // import.meta.require(unique_key).db
            //
            const import_path = Expr.init(E.String, E.String{
                .data = path_to_use,
            }, Logger.Loc{ .start = 0 });

            const import_meta = Expr.init(E.ImportMeta, E.ImportMeta{}, Logger.Loc{ .start = 0 });
            const require_property = Expr.init(E.Dot, E.Dot{
                .target = import_meta,
                .name_loc = Logger.Loc.Empty,
                .name = "require",
            }, Logger.Loc{ .start = 0 });
            const require_args = allocator.alloc(Expr, 2) catch unreachable;
            require_args[0] = import_path;
            const object_properties = allocator.alloc(G.Property, 1) catch unreachable;
            object_properties[0] = G.Property{
                .key = Expr.init(E.String, E.String{
                    .data = "type",
                }, Logger.Loc{ .start = 0 }),
                .value = Expr.init(E.String, E.String{
                    .data = "sqlite",
                }, Logger.Loc{ .start = 0 }),
            };
            require_args[1] = Expr.init(E.Object, E.Object{
                .properties = G.Property.List.fromOwnedSlice(object_properties),
                .is_single_line = true,
            }, Logger.Loc{ .start = 0 });
            const require_call = Expr.init(E.Call, E.Call{
                .target = require_property,
                .args = BabyList(Expr).fromOwnedSlice(require_args),
            }, Logger.Loc{ .start = 0 });

            const root = Expr.init(E.Dot, E.Dot{
                .target = require_call,
                .name_loc = Logger.Loc.Empty,
                .name = "db",
            }, Logger.Loc{ .start = 0 });

            return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
        },
        .napi => {
            // (dap-eval-cb "source.contents.ptr")
            if (transpiler.options.target == .browser) {
                log.addError(
                    source,
                    Logger.Loc.Empty,
                    "Loading .node files won't work in the browser. Make sure to set target to \"bun\" or \"node\"",
                ) catch |err| bun.handleOom(err);
                return error.ParserError;
            }

            const unique_key = std.fmt.allocPrint(allocator, "{f}A{d:0>8}", .{ bun.fmt.hexIntLower(unique_key_prefix), source.index.get() }) catch unreachable;
            // This injects the following code:
            //
            // require(unique_key)
            //
            const import_path = Expr.init(E.String, E.String{
                .data = unique_key,
            }, Logger.Loc{ .start = 0 });

            const require_args = allocator.alloc(Expr, 1) catch unreachable;
            require_args[0] = import_path;

            const root = Expr.init(E.Call, E.Call{
                .target = .{ .data = .{ .e_require_call_target = {} }, .loc = .{ .start = 0 } },
                .args = BabyList(Expr).fromOwnedSlice(require_args),
            }, Logger.Loc{ .start = 0 });

            unique_key_for_additional_file.* = .{
                .key = unique_key,
                .content_hash = ContentHasher.run(source.contents),
            };
            return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
        },
        .html => {
            var scanner = HTMLScanner.init(allocator, log, source);
            try scanner.scan(source.contents);

            // Reuse existing code for creating the AST
            // because it handles the various Ref and other structs we
            // need in order to print code later.
            var ast = (try js_parser.newLazyExportAST(
                allocator,
                transpiler.options.define,
                opts,
                log,
                Expr.init(E.Missing, E.Missing{}, Logger.Loc.Empty),
                source,
                "",
            )).?;
            ast.import_records = scanner.import_records;

            // We're banning import default of html loader files for now.
            //
            // TLDR: it kept including:
            //
            //   var name_default = ...;
            //
            // in the bundle because of the exports AST, and
            // gave up on figuring out how to fix it so that
            // this feature could ship.
            ast.has_lazy_export = false;
            ast.parts.ptr[1] = .{
                .stmts = &.{},
                .is_live = true,
                .import_record_indices = brk2: {
                    // Generate a single part that depends on all the import records.
                    // This is to ensure that we generate a JavaScript bundle containing all the user's code.
                    var import_record_indices = try Part.ImportRecordIndices.initCapacity(allocator, scanner.import_records.len);
                    import_record_indices.len = @truncate(scanner.import_records.len);
                    for (import_record_indices.slice(), 0..) |*import_record, index| {
                        import_record.* = @intCast(index);
                    }
                    break :brk2 import_record_indices;
                },
            };

            // Try to avoid generating unnecessary ESM <> CJS wrapper code.
            if (opts.output_format == .esm or opts.output_format == .iife) {
                ast.exports_kind = .esm;
            }

            return JSAst.init(ast);
        },
        .css => {
            // make css ast
            var import_records = BabyList(ImportRecord){};
            const source_code = source.contents;
            var temp_log = bun.logger.Log.init(allocator);
            defer {
                bun.handleOom(temp_log.appendToMaybeRecycled(log, source));
            }

            const css_module_suffix = ".module.css";
            const enable_css_modules = source.path.pretty.len > css_module_suffix.len and
                strings.eqlComptime(source.path.pretty[source.path.pretty.len - css_module_suffix.len ..], css_module_suffix);
            const parser_options = if (enable_css_modules) init: {
                var parseropts = bun.css.ParserOptions.default(allocator, &temp_log);
                parseropts.filename = bun.path.basename(source.path.pretty);
                parseropts.css_modules = bun.css.CssModuleConfig{};
                break :init parseropts;
            } else bun.css.ParserOptions.default(allocator, &temp_log);

            var css_ast, var extra = switch (bun.css.BundlerStyleSheet.parseBundler(
                allocator,
                source_code,
                parser_options,
                &import_records,
                source.index,
            )) {
                .result => |v| v,
                .err => |e| {
                    try e.addToLogger(&temp_log, source, allocator);
                    return error.SyntaxError;
                },
            };
            // Make sure the css modules local refs have a valid tag
            if (comptime bun.Environment.isDebug) {
                if (css_ast.local_scope.count() > 0) {
                    for (css_ast.local_scope.values()) |entry| {
                        const ref = entry.ref;
                        bun.assert(ref.innerIndex() < extra.symbols.len);
                    }
                }
            }
            if (css_ast.minify(allocator, bun.css.MinifyOptions{
                .targets = bun.css.Targets.forBundlerTarget(transpiler.options.target),
                .unused_symbols = .{},
            }, &extra).asErr()) |e| {
                try e.addToLogger(&temp_log, source, allocator);
                return error.MinifyError;
            }
            if (css_ast.local_scope.count() > 0) {
                _ = has_any_css_locals.fetchAdd(1, .monotonic);
            }
            // If this is a css module, the final exports object wil be set in `generateCodeForLazyExport`.
            const root = Expr.init(E.Object, E.Object{}, Logger.Loc{ .start = 0 });
            const css_ast_heap = bun.create(allocator, bun.css.BundlerStyleSheet, css_ast);
            var ast = JSAst.init((try js_parser.newLazyExportASTImpl(allocator, transpiler.options.define, opts, &temp_log, root, source, "", extra.symbols)).?);
            ast.css = css_ast_heap;
            ast.import_records = import_records;
            return ast;
        },
        // TODO:
        .dataurl, .base64, .bunsh => {
            return try getEmptyAST(log, transpiler, opts, allocator, source, E.String);
        },
        .file, .wasm => {
            bun.assert(loader.shouldCopyForBundling());

            // Put a unique key in the AST to implement the URL loader. At the end
            // of the bundle, the key is replaced with the actual URL.
            const content_hash = ContentHasher.run(source.contents);

            const unique_key: []const u8 = if (transpiler.options.dev_server != null)
                // With DevServer, the actual URL is added now, since it can be
                // known this far ahead of time, and it means the unique key code
                // does not have to perform an additional pass over files.
                //
                // To avoid a mutex, the actual insertion of the asset to DevServer
                // is done on the bundler thread.
                try std.fmt.allocPrint(
                    allocator,
                    bun.bake.DevServer.asset_prefix ++ "/{s}{s}",
                    .{
                        &std.fmt.bytesToHex(std.mem.asBytes(&content_hash), .lower),
                        std.fs.path.extension(source.path.text),
                    },
                )
            else
                try std.fmt.allocPrint(
                    allocator,
                    "{f}A{d:0>8}",
                    .{ bun.fmt.hexIntLower(unique_key_prefix), source.index.get() },
                );
            const root = Expr.init(E.String, .{ .data = unique_key }, .{ .start = 0 });
            unique_key_for_additional_file.* = .{
                .key = unique_key,
                .content_hash = content_hash,
            };
            var ast = JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, source, "")).?);
            ast.addUrlForCss(allocator, source, null, unique_key);
            return ast;
        },
    }
}

fn getCodeForParseTaskWithoutPlugins(
    task: *ParseTask,
    log: *Logger.Log,
    transpiler: *Transpiler,
    resolver: *Resolver,
    allocator: std.mem.Allocator,
    file_path: *Fs.Path,
    loader: Loader,
) !CacheEntry {
    return switch (task.contents_or_fd) {
        .fd => |contents| brk: {
            const trace = bun.perf.trace("Bundler.readFile");
            defer trace.end();

            // Check FileMap for in-memory files first
            if (task.ctx.file_map) |file_map| {
                if (file_map.get(file_path.text)) |file_contents| {
                    break :brk .{
                        .contents = file_contents,
                        .fd = bun.invalid_fd,
                    };
                }
            }

            if (strings.eqlComptime(file_path.namespace, "node")) lookup_builtin: {
                if (task.ctx.framework) |f| {
                    if (f.built_in_modules.get(file_path.text)) |file| {
                        switch (file) {
                            .code => |code| break :brk .{ .contents = code, .fd = bun.invalid_fd },
                            .import => |path| {
                                file_path.* = Fs.Path.init(path);
                                break :lookup_builtin;
                            },
                        }
                    }
                }

                break :brk .{
                    .contents = NodeFallbackModules.contentsFromPath(file_path.text) orelse "",
                    .fd = bun.invalid_fd,
                };
            }

            break :brk resolver.caches.fs.readFileWithAllocator(
                // TODO: this allocator may be wrong for native plugins
                if (loader.shouldCopyForBundling())
                    // The OutputFile will own the memory for the contents
                    bun.default_allocator
                else
                    allocator,
                transpiler.fs,
                file_path.text,
                task.contents_or_fd.fd.dir,
                false,
                contents.file.unwrapValid(),
            ) catch |err| {
                const source = &Logger.Source.initEmptyFile(log.msgs.allocator.dupe(u8, file_path.text) catch unreachable);
                switch (err) {
                    error.ENOENT, error.FileNotFound => {
                        log.addErrorFmt(
                            source,
                            Logger.Loc.Empty,
                            allocator,
                            "File not found {f}",
                            .{bun.fmt.quote(file_path.text)},
                        ) catch {};
                        return error.FileNotFound;
                    },
                    else => {
                        log.addErrorFmt(
                            source,
                            Logger.Loc.Empty,
                            allocator,
                            "{s} reading file: {f}",
                            .{ @errorName(err), bun.fmt.quote(file_path.text) },
                        ) catch {};
                    },
                }
                return err;
            };
        },
        .contents => |contents| .{
            .contents = contents,
            .fd = bun.invalid_fd,
        },
    };
}

fn getCodeForParseTask(
    task: *ParseTask,
    log: *Logger.Log,
    transpiler: *Transpiler,
    resolver: *Resolver,
    allocator: std.mem.Allocator,
    file_path: *Fs.Path,
    loader: *Loader,
    from_plugin: *bool,
) !CacheEntry {
    const might_have_on_parse_plugins = brk: {
        if (task.source_index.isRuntime()) break :brk false;
        const plugin = task.ctx.plugins orelse break :brk false;
        if (!plugin.hasOnBeforeParsePlugins()) break :brk false;

        if (strings.eqlComptime(file_path.namespace, "node")) {
            break :brk false;
        }
        break :brk true;
    };

    if (!might_have_on_parse_plugins) {
        return getCodeForParseTaskWithoutPlugins(task, log, transpiler, resolver, allocator, file_path, loader.*);
    }

    var should_continue_running: i32 = 1;

    var ctx = OnBeforeParsePlugin{
        .task = task,
        .log = log,
        .transpiler = transpiler,
        .resolver = resolver,
        .allocator = allocator,
        .file_path = file_path,
        .loader = loader,
        .deferred_error = null,
        .should_continue_running = &should_continue_running,
    };

    return try ctx.run(task.ctx.plugins.?, from_plugin);
}

const OnBeforeParsePlugin = struct {
    task: *ParseTask,
    log: *Logger.Log,
    transpiler: *Transpiler,
    resolver: *Resolver,
    allocator: std.mem.Allocator,
    file_path: *Fs.Path,
    loader: *Loader,
    deferred_error: ?anyerror = null,
    should_continue_running: *i32,

    result: ?*OnBeforeParseResult = null,

    const headers = bun.c;

    comptime {
        bun.assert(@sizeOf(OnBeforeParseArguments) == @sizeOf(headers.OnBeforeParseArguments));
        bun.assert(@alignOf(OnBeforeParseArguments) == @alignOf(headers.OnBeforeParseArguments));

        bun.assert(@sizeOf(BunLogOptions) == @sizeOf(headers.BunLogOptions));
        bun.assert(@alignOf(BunLogOptions) == @alignOf(headers.BunLogOptions));

        bun.assert(@sizeOf(OnBeforeParseResult) == @sizeOf(headers.OnBeforeParseResult));
        bun.assert(@alignOf(OnBeforeParseResult) == @alignOf(headers.OnBeforeParseResult));

        bun.assert(@sizeOf(BunLogOptions) == @sizeOf(headers.BunLogOptions));
        bun.assert(@alignOf(BunLogOptions) == @alignOf(headers.BunLogOptions));
    }

    const OnBeforeParseArguments = extern struct {
        struct_size: usize = @sizeOf(OnBeforeParseArguments),
        context: *OnBeforeParsePlugin,
        path_ptr: ?[*]const u8 = "",
        path_len: usize = 0,
        namespace_ptr: ?[*]const u8 = "file",
        namespace_len: usize = "file".len,
        default_loader: Loader = .file,
        external: ?*anyopaque = null,
    };

    const BunLogOptions = extern struct {
        struct_size: usize = @sizeOf(BunLogOptions),
        message_ptr: ?[*]const u8 = null,
        message_len: usize = 0,
        path_ptr: ?[*]const u8 = null,
        path_len: usize = 0,
        source_line_text_ptr: ?[*]const u8 = null,
        source_line_text_len: usize = 0,
        level: Logger.Log.Level = .err,
        line: i32 = 0,
        column: i32 = 0,
        line_end: i32 = 0,
        column_end: i32 = 0,

        pub fn sourceLineText(this: *const BunLogOptions) string {
            if (this.source_line_text_ptr) |ptr| {
                if (this.source_line_text_len > 0) {
                    return ptr[0..this.source_line_text_len];
                }
            }
            return "";
        }

        pub fn path(this: *const BunLogOptions) string {
            if (this.path_ptr) |ptr| {
                if (this.path_len > 0) {
                    return ptr[0..this.path_len];
                }
            }
            return "";
        }

        pub fn message(this: *const BunLogOptions) string {
            if (this.message_ptr) |ptr| {
                if (this.message_len > 0) {
                    return ptr[0..this.message_len];
                }
            }
            return "";
        }

        pub fn append(this: *const BunLogOptions, log: *Logger.Log, namespace: string) void {
            const allocator = log.msgs.allocator;
            const source_line_text = this.sourceLineText();
            const location = Logger.Location.init(
                this.path(),
                namespace,
                @max(this.line, -1),
                @max(this.column, -1),
                @max(this.column_end - this.column, 0),
                if (source_line_text.len > 0) bun.handleOom(allocator.dupe(u8, source_line_text)) else null,
            );
            var msg = Logger.Msg{ .data = .{ .location = location, .text = bun.handleOom(allocator.dupe(u8, this.message())) } };
            switch (this.level) {
                .err => msg.kind = .err,
                .warn => msg.kind = .warn,
                .verbose => msg.kind = .verbose,
                .debug => msg.kind = .debug,
                else => {},
            }
            if (msg.kind == .err) {
                log.errors += 1;
            } else if (msg.kind == .warn) {
                log.warnings += 1;
            }
            bun.handleOom(log.addMsg(msg));
        }

        pub fn logFn(
            args_: ?*OnBeforeParseArguments,
            log_options_: ?*BunLogOptions,
        ) callconv(.c) void {
            const args = args_ orelse return;
            const log_options = log_options_ orelse return;
            log_options.append(args.context.log, args.context.file_path.namespace);
        }
    };

    const OnBeforeParseResultWrapper = extern struct {
        original_source: ?[*]const u8 = null,
        original_source_len: usize = 0,
        original_source_fd: bun.FileDescriptor = bun.invalid_fd,
        loader: Loader,
        check: if (bun.Environment.isDebug) u32 else u0 = if (bun.Environment.isDebug) 42069 else 0, // Value to ensure OnBeforeParseResult is wrapped in this struct
        result: OnBeforeParseResult,
    };

    const OnBeforeParseResult = extern struct {
        struct_size: usize = @sizeOf(OnBeforeParseResult),
        source_ptr: ?[*]const u8 = null,
        source_len: usize = 0,
        loader: Loader,

        fetch_source_code_fn: *const fn (*OnBeforeParseArguments, *OnBeforeParseResult) callconv(.c) i32 = &fetchSourceCode,

        user_context: ?*anyopaque = null,
        free_user_context: ?*const fn (?*anyopaque) callconv(.c) void = null,

        log: *const fn (
            args_: ?*OnBeforeParseArguments,
            log_options_: ?*BunLogOptions,
        ) callconv(.c) void = &BunLogOptions.logFn,

        pub fn getWrapper(result: *OnBeforeParseResult) *OnBeforeParseResultWrapper {
            const wrapper: *OnBeforeParseResultWrapper = @fieldParentPtr("result", result);
            bun.debugAssert(wrapper.check == 42069);
            return wrapper;
        }
    };

    pub fn fetchSourceCode(args: *OnBeforeParseArguments, result: *OnBeforeParseResult) callconv(.c) i32 {
        debug("fetchSourceCode", .{});
        const this = args.context;
        if (this.log.errors > 0 or this.deferred_error != null or this.should_continue_running.* != 1) {
            return 1;
        }

        if (result.source_ptr != null) {
            return 0;
        }

        const entry = getCodeForParseTaskWithoutPlugins(
            this.task,
            this.log,
            this.transpiler,
            this.resolver,
            this.allocator,
            this.file_path,

            result.loader,
        ) catch |err| {
            this.deferred_error = err;
            this.should_continue_running.* = 0;
            return 1;
        };
        result.source_ptr = entry.contents.ptr;
        result.source_len = entry.contents.len;
        result.free_user_context = null;
        result.user_context = null;
        const wrapper: *OnBeforeParseResultWrapper = result.getWrapper();
        wrapper.original_source = entry.contents.ptr;
        wrapper.original_source_len = entry.contents.len;
        wrapper.original_source_fd = entry.fd;
        return 0;
    }

    pub export fn OnBeforeParseResult__reset(this: *OnBeforeParseResult) void {
        const wrapper = this.getWrapper();
        this.loader = wrapper.loader;
        if (wrapper.original_source) |src_ptr| {
            const src = src_ptr[0..wrapper.original_source_len];
            this.source_ptr = src.ptr;
            this.source_len = src.len;
        } else {
            this.source_ptr = null;
            this.source_len = 0;
        }
    }

    pub export fn OnBeforeParsePlugin__isDone(this: *OnBeforeParsePlugin) i32 {
        if (this.should_continue_running.* != 1) {
            return 1;
        }

        const result = this.result orelse return 1;
        // The first plugin to set the source wins.
        // But, we must check that they actually modified it
        // since fetching the source stores it inside `result.source_ptr`
        if (result.source_ptr != null) {
            const wrapper: *OnBeforeParseResultWrapper = result.getWrapper();
            return @intFromBool(result.source_ptr.? != wrapper.original_source.?);
        }

        return 0;
    }

    pub fn run(this: *OnBeforeParsePlugin, plugin: *jsc.API.JSBundler.Plugin, from_plugin: *bool) !CacheEntry {
        var args = OnBeforeParseArguments{
            .context = this,
            .path_ptr = this.file_path.text.ptr,
            .path_len = this.file_path.text.len,
            .default_loader = this.loader.*,
        };
        if (this.file_path.namespace.len > 0) {
            args.namespace_ptr = this.file_path.namespace.ptr;
            args.namespace_len = this.file_path.namespace.len;
        }
        var wrapper = OnBeforeParseResultWrapper{
            .loader = this.loader.*,
            .result = OnBeforeParseResult{
                .loader = this.loader.*,
            },
        };

        this.result = &wrapper.result;
        const count = plugin.callOnBeforeParsePlugins(
            this,
            if (bun.strings.eqlComptime(this.file_path.namespace, "file"))
                &bun.String.empty
            else
                &bun.String.init(this.file_path.namespace),

            &bun.String.init(this.file_path.text),
            &args,
            &wrapper.result,
            this.should_continue_running,
        );
        if (comptime Environment.enable_logs)
            debug("callOnBeforeParsePlugins({s}:{s}) = {d}", .{ this.file_path.namespace, this.file_path.text, count });
        if (count > 0) {
            if (this.deferred_error) |err| {
                if (wrapper.result.free_user_context) |free_user_context| {
                    free_user_context(wrapper.result.user_context);
                }

                return err;
            }

            // If the plugin sets the `free_user_context` function pointer, it _must_ set the `user_context` pointer.
            // Otherwise this is just invalid behavior.
            if (wrapper.result.user_context == null and wrapper.result.free_user_context != null) {
                var msg = Logger.Msg{ .data = .{ .location = null, .text = bun.default_allocator.dupe(
                    u8,
                    "Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field.",
                ) catch |err| bun.handleOom(err) } };
                msg.kind = .err;
                args.context.log.errors += 1;
                bun.handleOom(args.context.log.addMsg(msg));
                return error.InvalidNativePlugin;
            }

            if (this.log.errors > 0) {
                if (wrapper.result.free_user_context) |free_user_context| {
                    free_user_context(wrapper.result.user_context);
                }

                return error.SyntaxError;
            }

            if (wrapper.result.source_ptr) |ptr| {
                if (wrapper.result.free_user_context != null) {
                    this.task.external_free_function = .{
                        .ctx = wrapper.result.user_context,
                        .function = wrapper.result.free_user_context,
                    };
                }
                from_plugin.* = true;
                this.loader.* = wrapper.result.loader;
                return .{
                    .contents = ptr[0..wrapper.result.source_len],
                    .external_free_function = .{
                        .ctx = wrapper.result.user_context,
                        .function = wrapper.result.free_user_context,
                    },
                    .fd = wrapper.original_source_fd,
                };
            }
        }

        return try getCodeForParseTaskWithoutPlugins(this.task, this.log, this.transpiler, this.resolver, this.allocator, this.file_path, this.loader.*);
    }
};

fn getSourceCode(
    task: *ParseTask,
    this: *ThreadPool.Worker,
    log: *Logger.Log,
) anyerror!CacheEntry {
    const allocator = this.allocator;

    var data = this.data;
    const transpiler = &data.transpiler;
    errdefer transpiler.resetStore();
    const resolver: *Resolver = &transpiler.resolver;
    var file_path = task.path;
    var loader = task.loader orelse file_path.loader(&transpiler.options.loaders) orelse options.Loader.file;

    var contents_came_from_plugin: bool = false;
    return try getCodeForParseTask(task, log, transpiler, resolver, allocator, &file_path, &loader, &contents_came_from_plugin);
}

fn runWithSourceCode(
    task: *ParseTask,
    this: *ThreadPool.Worker,
    step: *ParseTask.Result.Error.Step,
    log: *Logger.Log,
    entry: *CacheEntry,
) anyerror!Result.Success {
    const allocator = this.allocator;

    var transpiler = this.transpilerForTarget(task.known_target);
    errdefer transpiler.resetStore();
    const resolver: *Resolver = &transpiler.resolver;
    const file_path = &task.path;
    const loader = task.loader orelse file_path.loader(&transpiler.options.loaders) orelse options.Loader.file;

    // WARNING: Do not change the variant of `task.contents_or_fd` from
    // `.fd` to `.contents` (or back) after this point!
    //
    // When `task.contents_or_fd == .fd`, `entry.contents` is an owned string.
    // When `task.contents_or_fd == .contents`, `entry.contents` is NOT owned! Freeing it here will cause a double free!
    //
    // Changing from `.contents` to `.fd` will cause a double free.
    // This was the case in the situation where the ParseTask receives its `.contents` from an onLoad plugin, which caused it to be
    // allocated by `bun.default_allocator` and then freed in `BundleV2.deinit` (and also by `entry.deinit(allocator)` below).
    const debug_original_variant_check: if (bun.Environment.isDebug) ContentsOrFd.Tag else void =
        if (bun.Environment.isDebug) @as(ContentsOrFd.Tag, task.contents_or_fd);
    errdefer {
        if (comptime bun.Environment.isDebug) {
            if (@as(ContentsOrFd.Tag, task.contents_or_fd) != debug_original_variant_check) {
                std.debug.panic("BUG: `task.contents_or_fd` changed in a way that will cause a double free or memory to leak!\n\n    Original = {s}\n    New = {s}\n", .{
                    @tagName(debug_original_variant_check),
                    @tagName(task.contents_or_fd),
                });
            }
        }
        if (task.contents_or_fd == .fd) entry.deinit(allocator);
    }

    const will_close_file_descriptor = task.contents_or_fd == .fd and
        entry.fd.isValid() and
        entry.fd.stdioTag() == null and
        this.ctx.bun_watcher == null;
    if (will_close_file_descriptor) {
        _ = entry.closeFD();
        task.contents_or_fd = .{ .fd = .{
            .file = bun.invalid_fd,
            .dir = bun.invalid_fd,
        } };
    } else if (task.contents_or_fd == .fd) {
        task.contents_or_fd = .{ .fd = .{
            .file = entry.fd,
            .dir = bun.invalid_fd,
        } };
    }
    step.* = .parse;

    const is_empty = strings.isAllWhitespace(entry.contents);

    const use_directive: UseDirective = if (!is_empty and transpiler.options.server_components)
        if (UseDirective.parse(entry.contents)) |use|
            use
        else
            .none
    else
        .none;

    if (use_directive == .client and
        task.known_target != .bake_server_components_ssr and
        this.ctx.framework != null and
        this.ctx.framework.?.server_components.?.separate_ssr_graph or
        // set the target to the client when bundling client-side files
        ((transpiler.options.server_components or transpiler.options.dev_server != null) and
            task.known_target == .browser))
    {
        // separate_ssr_graph makes boundaries switch to client because the server file uses that generated file as input.
        // this is not done when there is one server graph because it is easier for plugins to deal with.
        transpiler = this.transpilerForTarget(.browser);
    }

    const source = &Logger.Source{
        .path = file_path.*,
        .index = task.source_index,
        .contents = entry.contents,
        .contents_is_recycled = false,
    };

    const target = (if (task.source_index.get() == 1) targetFromHashbang(entry.contents) else null) orelse
        if (task.known_target == .bake_server_components_ssr and transpiler.options.framework.?.server_components.?.separate_ssr_graph)
            .bake_server_components_ssr
        else
            transpiler.options.target;

    const output_format = transpiler.options.output_format;

    var opts = js_parser.Parser.Options.init(task.jsx, loader);
    opts.bundle = true;
    opts.warn_about_unbundled_modules = false;
    opts.macro_context = &transpiler.macro_context.?;
    opts.package_version = task.package_version;

    opts.features.allow_runtime = !source.index.isRuntime();
    opts.features.unwrap_commonjs_to_esm = output_format == .esm and FeatureFlags.unwrap_commonjs_to_esm;
    opts.features.top_level_await = output_format == .esm or output_format == .internal_bake_dev;
    opts.features.auto_import_jsx = task.jsx.parse and transpiler.options.auto_import_jsx;
    opts.features.trim_unused_imports = loader.isTypeScript() or (transpiler.options.trim_unused_imports orelse false);
    opts.features.inlining = transpiler.options.minify_syntax;
    opts.output_format = output_format;
    opts.features.minify_syntax = transpiler.options.minify_syntax;
    opts.features.minify_identifiers = transpiler.options.minify_identifiers;
    opts.features.minify_keep_names = transpiler.options.keep_names;
    opts.features.minify_whitespace = transpiler.options.minify_whitespace;
    opts.features.emit_decorator_metadata = transpiler.options.emit_decorator_metadata;
    opts.features.unwrap_commonjs_packages = transpiler.options.unwrap_commonjs_packages;
    opts.features.bundler_feature_flags = transpiler.options.bundler_feature_flags;
    opts.features.hot_module_reloading = output_format == .internal_bake_dev and !source.index.isRuntime();
    opts.features.auto_polyfill_require = output_format == .esm and !opts.features.hot_module_reloading;
    opts.features.react_fast_refresh = transpiler.options.react_fast_refresh and
        loader.isJSX() and
        !source.path.isNodeModule();

    opts.features.server_components = if (transpiler.options.server_components) switch (target) {
        .browser => .client_side,
        else => switch (use_directive) {
            .none => .wrap_anon_server_functions,
            .client => if (transpiler.options.framework.?.server_components.?.separate_ssr_graph)
                .client_side
            else
                .wrap_exports_for_client_reference,
            .server => .wrap_exports_for_server_reference,
        },
    } else .none;

    opts.framework = transpiler.options.framework;

    opts.ignore_dce_annotations = transpiler.options.ignore_dce_annotations and !source.index.isRuntime();

    // For files that are not user-specified entrypoints, set `import.meta.main` to `false`.
    // Entrypoints will have `import.meta.main` set as "unknown", unless we use `--compile`,
    // in which we inline `true`.
    if (transpiler.options.inline_entrypoint_import_meta_main or !task.is_entry_point) {
        opts.import_meta_main_value = task.is_entry_point and transpiler.options.dev_server == null;
    } else if (target == .node) {
        opts.lower_import_meta_main_for_node_js = true;
    }

    opts.tree_shaking = if (source.index.isRuntime()) true else transpiler.options.tree_shaking;
    opts.code_splitting = transpiler.options.code_splitting;
    opts.module_type = task.module_type;

    task.jsx.parse = loader.isJSX();

    var unique_key_for_additional_file: FileLoaderHash = .{
        .key = "",
        .content_hash = 0,
    };
    var ast: JSAst = if (!is_empty or loader.handlesEmptyFile())
        try getAST(log, transpiler, opts, allocator, resolver, source, loader, task.ctx.unique_key, &unique_key_for_additional_file, &task.ctx.linker.has_any_css_locals)
    else switch (opts.module_type == .esm) {
        inline else => |as_undefined| if (loader.isCSS()) try getEmptyCSSAST(
            log,
            transpiler,
            opts,
            allocator,
            source,
        ) else try getEmptyAST(
            log,
            transpiler,
            opts,
            allocator,
            source,
            if (as_undefined) E.Undefined else E.Object,
        ),
    };

    ast.target = target;
    if (ast.parts.len <= 1 and ast.css == null and (task.loader == null or task.loader.? != .html)) {
        task.side_effects = .no_side_effects__empty_ast;
    }

    // bun.debugAssert(ast.parts.len > 0); // when parts.len == 0, it is assumed to be pending/failed. empty ast has at least 1 part.

    step.* = .resolve;

    return .{
        .ast = ast,
        .source = source.*,
        .log = log.*,
        .use_directive = use_directive,
        .unique_key_for_additional_file = unique_key_for_additional_file.key,
        .side_effects = task.side_effects,
        .loader = loader,

        // Hash the files in here so that we do it in parallel.
        .content_hash_for_additional_file = if (loader.shouldCopyForBundling())
            unique_key_for_additional_file.content_hash
        else
            0,
    };
}

fn ioTaskCallback(task: *ThreadPoolLib.Task) void {
    runFromThreadPool(@fieldParentPtr("io_task", task));
}

fn taskCallback(task: *ThreadPoolLib.Task) void {
    runFromThreadPool(@fieldParentPtr("task", task));
}

pub fn runFromThreadPool(this: *ParseTask) void {
    var worker = ThreadPool.Worker.get(this.ctx);
    defer worker.unget();
    debug("ParseTask(0x{x}, {s}) callback", .{ @intFromPtr(this), this.path.text });

    var step: ParseTask.Result.Error.Step = .pending;
    var log = Logger.Log.init(worker.allocator);
    bun.assert(this.source_index.isValid()); // forgot to set source_index

    const value: ParseTask.Result.Value = value: {
        if (this.stage == .needs_source_code) {
            this.stage = .{
                .needs_parse = getSourceCode(this, worker, &log) catch |err| {
                    break :value .{ .err = .{
                        .err = err,
                        .step = step,
                        .log = log,
                        .source_index = this.source_index,
                        .target = this.known_target,
                    } };
                },
            };

            if (log.hasErrors()) {
                break :value .{ .err = .{
                    .err = error.SyntaxError,
                    .step = step,
                    .log = log,
                    .source_index = this.source_index,
                    .target = this.known_target,
                } };
            }

            if (ThreadPool.usesIOPool()) {
                this.ctx.graph.pool.scheduleInsideThreadPool(this);
                return;
            }
        }

        if (runWithSourceCode(this, worker, &step, &log, &this.stage.needs_parse)) |ast| {
            // When using HMR, always flag asts with errors as parse failures.
            // Not done outside of the dev server out of fear of breaking existing code.
            if (this.ctx.transpiler.options.dev_server != null and ast.log.hasErrors()) {
                break :value .{
                    .err = .{
                        .err = error.SyntaxError,
                        .step = .parse,
                        .log = ast.log,
                        .source_index = this.source_index,
                        .target = this.known_target,
                    },
                };
            }

            break :value .{ .success = ast };
        } else |err| {
            if (err == error.EmptyAST) {
                log.deinit();
                break :value .{ .empty = .{
                    .source_index = this.source_index,
                } };
            }

            break :value .{ .err = .{
                .err = err,
                .step = step,
                .log = log,
                .source_index = this.source_index,
                .target = this.known_target,
            } };
        }
    };

    const result = bun.handleOom(bun.default_allocator.create(Result));

    result.* = .{
        .ctx = this.ctx,
        .task = .{},
        .value = value,
        .external = this.external_free_function,
        .watcher_data = switch (this.contents_or_fd) {
            .fd => |fd| .{ .fd = fd.file, .dir_fd = fd.dir },
            .contents => .none,
        },
    };

    switch (worker.ctx.loop().*) {
        .js => |jsc_event_loop| {
            jsc_event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(result, onComplete));
        },
        .mini => |*mini| {
            mini.enqueueTaskConcurrentWithExtraCtx(
                Result,
                BundleV2,
                result,
                BundleV2.onParseTaskComplete,
                .task,
            );
        },
    }
}

pub fn onComplete(result: *Result) void {
    BundleV2.onParseTaskComplete(result, result.ctx);
}

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;

const string = []const u8;

const Fs = @import("../fs.zig");
const HTMLScanner = @import("../HTMLScanner.zig");
const NodeFallbackModules = @import("../node_fallbacks.zig");
const linker = @import("../linker.zig");
const runtime = @import("../runtime.zig");
const std = @import("std");
const URL = @import("../url.zig").URL;
const CacheEntry = @import("../cache.zig").Fs.Entry;

const Logger = @import("../logger.zig");
const Loc = Logger.Loc;

const options = @import("../options.zig");
const Loader = options.Loader;

const _resolver = @import("../resolver/resolver.zig");
const Resolver = _resolver.Resolver;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const ImportRecord = bun.ImportRecord;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const ThreadPoolLib = bun.ThreadPool;
const Transpiler = bun.Transpiler;
const bake = bun.bake;
const base64 = bun.base64;
const default_allocator = bun.default_allocator;
const js_parser = bun.js_parser;
const strings = bun.strings;
const BabyList = bun.collections.BabyList;
const JSON5 = bun.interchange.json5.JSON5Parser;
const TOML = bun.interchange.toml.TOML;
const YAML = bun.interchange.yaml.YAML;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const JSAst = js_ast.BundledAst;
const Part = js_ast.Part;
const Symbol = js_ast.Symbol;

const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;
const ContentHasher = bundler.ContentHasher;
const UseDirective = bundler.UseDirective;
const targetFromHashbang = bundler.targetFromHashbang;

const jsc = bun.jsc;
const EventLoop = bun.jsc.AnyEventLoop;
