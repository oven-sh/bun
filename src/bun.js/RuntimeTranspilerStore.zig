const debug = Output.scoped(.RuntimeTranspilerStore, .hidden);

const string = []const u8;

pub fn dumpSource(vm: *VirtualMachine, specifier: string, printer: anytype) void {
    dumpSourceString(vm, specifier, printer.ctx.getWritten());
}

pub fn dumpSourceString(vm: *VirtualMachine, specifier: string, written: []const u8) void {
    dumpSourceStringFailiable(vm, specifier, written) catch |e| {
        Output.debugWarn("Failed to dump source string: {}", .{e});
    };
}

pub fn dumpSourceStringFailiable(vm: *VirtualMachine, specifier: string, written: []const u8) !void {
    if (!Environment.isDebug) return;
    if (bun.feature_flag.BUN_DEBUG_NO_DUMP.get()) return;

    const BunDebugHolder = struct {
        pub var dir: ?std.fs.Dir = null;
        pub var lock: bun.Mutex = .{};
    };

    BunDebugHolder.lock.lock();
    defer BunDebugHolder.lock.unlock();

    const dir = BunDebugHolder.dir orelse dir: {
        const base_name = switch (Environment.os) {
            else => "/tmp/bun-debug-src/",
            .windows => brk: {
                const temp = bun.fs.FileSystem.RealFS.platformTempDir();
                var win_temp_buffer: bun.PathBuffer = undefined;
                @memcpy(win_temp_buffer[0..temp.len], temp);
                const suffix = "\\bun-debug-src";
                @memcpy(win_temp_buffer[temp.len .. temp.len + suffix.len], suffix);
                win_temp_buffer[temp.len + suffix.len] = 0;
                break :brk win_temp_buffer[0 .. temp.len + suffix.len :0];
            },
        };
        const dir = try std.fs.cwd().makeOpenPath(base_name, .{});
        BunDebugHolder.dir = dir;
        break :dir dir;
    };

    if (std.fs.path.dirname(specifier)) |dir_path| {
        const root_len = switch (Environment.os) {
            else => "/".len,
            .windows => bun.path.windowsFilesystemRoot(dir_path).len,
        };
        var parent = try dir.makeOpenPath(dir_path[root_len..], .{});
        defer parent.close();
        parent.writeFile(.{
            .sub_path = std.fs.path.basename(specifier),
            .data = written,
        }) catch |e| {
            Output.debugWarn("Failed to dump source string: writeFile {}", .{e});
            return;
        };
        if (vm.source_mappings.get(specifier)) |mappings| {
            defer mappings.deref();
            const map_path = bun.handleOom(std.mem.concat(bun.default_allocator, u8, &.{ std.fs.path.basename(specifier), ".map" }));
            defer bun.default_allocator.free(map_path);
            const file = try parent.createFile(map_path, .{});
            defer file.close();

            const source_file = parent.readFileAlloc(
                bun.default_allocator,
                specifier,
                std.math.maxInt(u64),
            ) catch "";
            defer bun.default_allocator.free(source_file);

            var bufw_buffer: [4096]u8 = undefined;
            var bufw = file.writerStreaming(&bufw_buffer);
            const w = &bufw.interface;
            try w.print(
                \\{{
                \\  "version": 3,
                \\  "file": {f},
                \\  "sourceRoot": "",
                \\  "sources": [{f}],
                \\  "sourcesContent": [{f}],
                \\  "names": [],
                \\  "mappings": "{f}"
                \\}}
            , .{
                bun.fmt.formatJSONStringUTF8(std.fs.path.basename(specifier), .{}),
                bun.fmt.formatJSONStringUTF8(specifier, .{}),
                bun.fmt.formatJSONStringUTF8(source_file, .{}),
                mappings.formatVLQs(),
            });
            try w.flush();
        }
    } else {
        dir.writeFile(.{
            .sub_path = std.fs.path.basename(specifier),
            .data = written,
        }) catch return;
    }
}

pub fn setBreakPointOnFirstLine() bool {
    const s = struct {
        var set_break_point: std.atomic.Value(bool) = std.atomic.Value(bool).init(true);
    };
    return s.set_break_point.swap(false, .seq_cst);
}

pub const RuntimeTranspilerStore = struct {
    generation_number: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    store: TranspilerJob.Store,
    enabled: bool = true,
    queue: Queue = Queue{},

    pub const Queue = bun.UnboundedQueue(TranspilerJob, .next);

    pub fn init() RuntimeTranspilerStore {
        return RuntimeTranspilerStore{
            .store = TranspilerJob.Store.init(bun.typedAllocator(TranspilerJob)),
        };
    }

    pub fn runFromJSThread(this: *RuntimeTranspilerStore, event_loop: *jsc.EventLoop, global: *jsc.JSGlobalObject, vm: *jsc.VirtualMachine) void {
        var batch = this.queue.popBatch();
        const jsc_vm = vm.jsc_vm;
        var iter = batch.iterator();
        if (iter.next()) |job| {
            // we run just one job first to see if there are more
            job.runFromJSThread() catch |err| global.reportUncaughtExceptionFromError(err);
        } else {
            return;
        }
        while (iter.next()) |job| {
            // if there are more, we need to drain the microtasks from the previous run
            event_loop.drainMicrotasksWithGlobal(global, jsc_vm) catch return;
            job.runFromJSThread() catch |err| global.reportUncaughtExceptionFromError(err);
        }

        // immediately after this is called, the microtasks will be drained again.
    }

    pub fn transpile(
        this: *RuntimeTranspilerStore,
        vm: *VirtualMachine,
        globalObject: *JSGlobalObject,
        input_specifier: bun.String,
        path: Fs.Path,
        referrer: bun.String,
        loader: bun.options.Loader,
        package_json: ?*const PackageJSON,
    ) *anyopaque {
        var job: *TranspilerJob = this.store.get();
        const owned_path = Fs.Path.init(bun.default_allocator.dupe(u8, path.text) catch unreachable);
        const promise = jsc.JSInternalPromise.create(globalObject);

        // NOTE: DirInfo should already be cached since module loading happens
        // after module resolution, so this should be cheap
        var resolved_source = ResolvedSource{};
        if (package_json) |pkg| {
            switch (pkg.module_type) {
                .cjs => {
                    resolved_source.tag = .package_json_type_commonjs;
                    resolved_source.is_commonjs_module = true;
                },
                .esm => resolved_source.tag = .package_json_type_module,
                .unknown => {},
            }
        }

        job.* = TranspilerJob{
            .non_threadsafe_input_specifier = input_specifier,
            .path = owned_path,
            .globalThis = globalObject,
            .non_threadsafe_referrer = referrer,
            .vm = vm,
            .log = logger.Log.init(bun.default_allocator),
            .loader = loader,
            .promise = .create(JSValue.fromCell(promise), globalObject),
            .poll_ref = .{},
            .fetcher = TranspilerJob.Fetcher{
                .file = {},
            },
            .resolved_source = resolved_source,
            .generation_number = this.generation_number.load(.seq_cst),
        };
        if (comptime Environment.allow_assert)
            debug("transpile({s}, {s}, async)", .{ path.text, @tagName(job.loader) });
        job.schedule();
        return promise;
    }

    pub const TranspilerJob = struct {
        path: Fs.Path,
        non_threadsafe_input_specifier: String,
        non_threadsafe_referrer: String,
        loader: options.Loader,
        promise: jsc.Strong.Optional = .empty,
        vm: *VirtualMachine,
        globalThis: *JSGlobalObject,
        fetcher: Fetcher,
        poll_ref: Async.KeepAlive = .{},
        generation_number: u32 = 0,
        log: logger.Log,
        parse_error: ?anyerror = null,
        resolved_source: ResolvedSource = ResolvedSource{},
        work_task: jsc.WorkPoolTask = .{ .callback = runFromWorkerThread },
        next: ?*TranspilerJob = null,

        pub const Store = bun.HiveArray(TranspilerJob, if (bun.heap_breakdown.enabled) 0 else 64).Fallback;

        pub const Fetcher = union(enum) {
            virtual_module: bun.String,
            file: void,

            pub fn deinit(this: *@This()) void {
                if (this.* == .virtual_module) {
                    this.virtual_module.deref();
                }
            }
        };

        pub fn deinit(this: *TranspilerJob) void {
            bun.default_allocator.free(this.path.text);

            this.poll_ref.disable();
            this.fetcher.deinit();
            this.loader = options.Loader.file;
            this.non_threadsafe_input_specifier.deref();
            this.non_threadsafe_referrer.deref();
            this.path = Fs.Path.empty;
            this.log.deinit();
            this.promise.deinit();
            this.globalThis = undefined;
        }

        threadlocal var ast_memory_store: ?*js_ast.ASTMemoryAllocator = null;
        threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

        pub fn dispatchToMainThread(this: *TranspilerJob) void {
            this.vm.transpiler_store.queue.push(this);
            this.vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.createFrom(&this.vm.transpiler_store));
        }

        pub fn runFromJSThread(this: *TranspilerJob) bun.JSError!void {
            var vm = this.vm;
            const promise = this.promise.swap();
            const globalThis = this.globalThis;
            this.poll_ref.unref(vm);

            const referrer = this.non_threadsafe_referrer;
            this.non_threadsafe_referrer = String.empty;
            var log = this.log;
            this.log = logger.Log.init(bun.default_allocator);
            var resolved_source = this.resolved_source;
            const specifier = brk: {
                if (this.parse_error != null) {
                    break :brk bun.String.cloneUTF8(this.path.text);
                }

                const out = this.non_threadsafe_input_specifier;
                this.non_threadsafe_input_specifier = String.empty;

                bun.debugAssert(resolved_source.source_url.isEmpty());
                bun.debugAssert(resolved_source.specifier.isEmpty());
                resolved_source.source_url = out.createIfDifferent(this.path.text);
                resolved_source.specifier = out.dupeRef();
                break :brk out;
            };

            const parse_error = this.parse_error;

            this.promise.deinit();
            this.deinit();

            _ = vm.transpiler_store.store.put(this);

            try AsyncModule.fulfill(globalThis, promise, &resolved_source, parse_error, specifier, referrer, &log);
        }

        pub fn schedule(this: *TranspilerJob) void {
            this.poll_ref.ref(this.vm);
            jsc.WorkPool.schedule(&this.work_task);
        }

        pub fn runFromWorkerThread(work_task: *jsc.WorkPoolTask) void {
            @as(*TranspilerJob, @fieldParentPtr("work_task", work_task)).run();
        }

        pub fn run(this: *TranspilerJob) void {
            var arena = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            const allocator = arena.allocator();

            defer this.dispatchToMainThread();
            if (this.generation_number != this.vm.transpiler_store.generation_number.load(.monotonic)) {
                this.parse_error = error.TranspilerJobGenerationMismatch;
                return;
            }

            if (ast_memory_store == null) {
                ast_memory_store = bun.handleOom(bun.default_allocator.create(js_ast.ASTMemoryAllocator));
                ast_memory_store.?.* = js_ast.ASTMemoryAllocator{
                    .allocator = allocator,
                    .previous = null,
                };
            }

            var ast_scope = ast_memory_store.?.enter(allocator);
            defer ast_scope.exit();

            const path = this.path;
            const specifier = this.path.text;
            const loader = this.loader;

            var cache = jsc.RuntimeTranspilerCache{
                .output_code_allocator = allocator,
                .sourcemap_allocator = bun.default_allocator,
            };
            var log = logger.Log.init(allocator);
            defer {
                this.log = logger.Log.init(bun.default_allocator);
                bun.handleOom(log.cloneToWithRecycled(&this.log, true));
            }
            var vm = this.vm;
            var transpiler: bun.Transpiler = undefined;
            transpiler = vm.transpiler;
            transpiler.setAllocator(allocator);
            transpiler.setLog(&log);
            transpiler.resolver.opts = transpiler.options;
            transpiler.macro_context = null;
            transpiler.linker.resolver = &transpiler.resolver;

            var fd: ?StoredFileDescriptorType = null;
            var package_json: ?*PackageJSON = null;
            const hash = bun.Watcher.getHash(path.text);

            switch (vm.bun_watcher) {
                .hot, .watch => {
                    if (vm.bun_watcher.indexOf(hash)) |index| {
                        const watcher_fd = vm.bun_watcher.watchlist().items(.fd)[index];
                        fd = if (watcher_fd.stdioTag() == null) watcher_fd else null;
                        package_json = vm.bun_watcher.watchlist().items(.package_json)[index];
                    }
                },
                else => {},
            }

            // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
            const is_node_override = strings.hasPrefixComptime(specifier, node_fallbacks.import_path);

            const macro_remappings = if (vm.macro_mode or !vm.has_any_macro_remappings or is_node_override)
                MacroRemap{}
            else
                transpiler.options.macro_remap;

            var fallback_source: logger.Source = undefined;

            // Usually, we want to close the input file automatically.
            //
            // If we're re-using the file descriptor from the fs watcher
            // Do not close it because that will break the kqueue-based watcher
            //
            var should_close_input_file_fd = fd == null;

            var input_file_fd: StoredFileDescriptorType = .invalid;

            const is_main = vm.main.len == path.text.len and
                vm.main_hash == hash and
                strings.eqlLong(vm.main, path.text, false);

            const module_type: ModuleType = switch (this.resolved_source.tag) {
                .package_json_type_commonjs => .cjs,
                .package_json_type_module => .esm,
                else => .unknown,
            };

            var parse_options = Transpiler.ParseOptions{
                .allocator = allocator,
                .path = path,
                .loader = loader,
                .dirname_fd = .invalid,
                .file_descriptor = fd,
                .file_fd_ptr = &input_file_fd,
                .file_hash = hash,
                .macro_remappings = macro_remappings,
                .jsx = transpiler.options.jsx,
                .emit_decorator_metadata = transpiler.options.emit_decorator_metadata,
                .virtual_source = null,
                .dont_bundle_twice = true,
                .allow_commonjs = true,
                .inject_jest_globals = transpiler.options.rewrite_jest_for_tests,
                .set_breakpoint_on_first_line = vm.debugger != null and
                    vm.debugger.?.set_breakpoint_on_first_line and
                    is_main and
                    setBreakPointOnFirstLine(),
                .runtime_transpiler_cache = if (!jsc.RuntimeTranspilerCache.is_disabled) &cache else null,
                .remove_cjs_module_wrapper = is_main and vm.module_loader.eval_source != null,
                .module_type = module_type,
                .allow_bytecode_cache = true,
            };

            defer {
                if (should_close_input_file_fd and input_file_fd.isValid()) {
                    input_file_fd.close();
                    input_file_fd = .invalid;
                }
            }

            if (is_node_override) {
                if (node_fallbacks.contentsFromPath(specifier)) |code| {
                    const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                    fallback_source = logger.Source{ .path = fallback_path, .contents = code };
                    parse_options.virtual_source = &fallback_source;
                }
            }

            var parse_result: bun.transpiler.ParseResult = transpiler.parseMaybeReturnFileOnlyAllowSharedBuffer(
                parse_options,
                null,
                false,
                false,
            ) orelse {
                if (vm.isWatcherEnabled()) {
                    if (input_file_fd.isValid()) {
                        if (!is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                            should_close_input_file_fd = false;
                            _ = vm.bun_watcher.addFile(
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

                this.parse_error = error.ParseError;

                return;
            };

            if (vm.isWatcherEnabled()) {
                if (input_file_fd.isValid()) {
                    if (!is_node_override and
                        std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules"))
                    {
                        should_close_input_file_fd = false;
                        _ = vm.bun_watcher.addFile(
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

            if (cache.entry) |*entry| {
                vm.source_mappings.putMappings(&parse_result.source, .{
                    .list = .{ .items = @constCast(entry.sourcemap), .capacity = entry.sourcemap.len },
                    .allocator = bun.default_allocator,
                }) catch {};

                if (comptime Environment.dump_source) {
                    dumpSourceString(vm, specifier, entry.output_code.byteSlice());
                }

                this.resolved_source = ResolvedSource{
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
                    .is_commonjs_module = entry.metadata.module_type == .cjs,
                    .tag = this.resolved_source.tag,
                };

                return;
            }

            if (parse_result.already_bundled != .none) {
                const bytecode_slice = parse_result.already_bundled.bytecodeSlice();
                this.resolved_source = ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.cloneLatin1(parse_result.source.contents),
                    .already_bundled = true,
                    .bytecode_cache = if (bytecode_slice.len > 0) bytecode_slice.ptr else null,
                    .bytecode_cache_size = bytecode_slice.len,
                    .is_commonjs_module = parse_result.already_bundled.isCommonJS(),
                    .tag = this.resolved_source.tag,
                };
                this.resolved_source.source_code.ensureHash();
                return;
            }

            for (parse_result.ast.import_records.slice()) |*import_record_| {
                var import_record: *bun.ImportRecord = import_record_;

                if (HardcodedModule.Alias.get(import_record.path.text, transpiler.options.target, .{ .rewrite_jest_for_tests = transpiler.options.rewrite_jest_for_tests })) |replacement| {
                    import_record.path.text = replacement.path;
                    import_record.tag = replacement.tag;
                    import_record.flags.is_external_without_side_effects = true;
                    continue;
                }

                if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                    import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                    import_record.path.namespace = "bun";
                    import_record.flags.is_external_without_side_effects = true;
                }
            }

            if (source_code_printer == null) {
                const writer = js_printer.BufferWriter.init(bun.default_allocator);
                source_code_printer = bun.default_allocator.create(js_printer.BufferPrinter) catch unreachable;
                source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
                source_code_printer.?.ctx.append_null_byte = false;
            }

            var printer = source_code_printer.?.*;
            printer.ctx.reset();

            // Cap buffer size to prevent unbounded growth
            const max_buffer_cap = 512 * 1024;
            if (printer.ctx.buffer.list.capacity > max_buffer_cap) {
                printer.ctx.buffer.deinit();
                const writer = js_printer.BufferWriter.init(bun.default_allocator);
                source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
                source_code_printer.?.ctx.append_null_byte = false;
                printer = source_code_printer.?.*;
            }

            {
                var mapper = vm.sourceMapHandler(&printer);
                defer source_code_printer.?.* = printer;
                _ = transpiler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    mapper.get(),
                ) catch |err| {
                    this.parse_error = err;
                    return;
                };
            }

            if (comptime Environment.dump_source) {
                dumpSource(this.vm, specifier, &printer);
            }

            const source_code = brk: {
                const written = printer.ctx.getWritten();

                const result = cache.output_code orelse bun.String.cloneLatin1(written);

                if (written.len > 1024 * 1024 * 2 or vm.smol) {
                    printer.ctx.buffer.deinit();
                    const writer = js_printer.BufferWriter.init(bun.default_allocator);
                    source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
                    source_code_printer.?.ctx.append_null_byte = false;
                } else {
                    source_code_printer.?.* = printer;
                }

                // In a benchmarking loading @babel/standalone 100 times:
                //
                // After ensureHash:
                // 354.00 ms    4.2%    354.00 ms           WTF::StringImpl::hashSlowCase() const
                //
                // Before ensureHash:
                // 506.00 ms    6.1%    506.00 ms           WTF::StringImpl::hashSlowCase() const
                //
                result.ensureHash();

                break :brk result;
            };
            this.resolved_source = ResolvedSource{
                .allocator = null,
                .source_code = source_code,
                .is_commonjs_module = parse_result.ast.has_commonjs_export_names or parse_result.ast.exports_kind == .cjs,
                .tag = this.resolved_source.tag,
            };
        }
    };
};

const Fs = @import("../fs.zig");
const node_fallbacks = @import("../node_fallbacks.zig");
const std = @import("std");
const AsyncModule = @import("./AsyncModule.zig").AsyncModule;
const HardcodedModule = @import("./HardcodedModule.zig").HardcodedModule;

const options = @import("../options.zig");
const ModuleType = options.ModuleType;

const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const String = bun.String;
const Transpiler = bun.Transpiler;
const js_ast = bun.ast;
const js_printer = bun.js_printer;
const logger = bun.logger;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const ResolvedSource = bun.jsc.ResolvedSource;
const VirtualMachine = bun.jsc.VirtualMachine;
