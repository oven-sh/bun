const std = @import("std");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const StaticExport = @import("./bindings/static_export.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Arena = @import("../mimalloc_arena.zig").Arena;
const C = bun.C;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const IO = @import("root").bun.AsyncIO;
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const Fs = @import("../fs.zig");
const Resolver = @import("../resolver/resolver.zig");
const ast = @import("../import_record.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const ParseResult = bun.bundler.ParseResult;
const logger = @import("root").bun.logger;
const Api = @import("../api/schema.zig").Api;
const options = @import("../options.zig");
const Bundler = bun.Bundler;
const PluginRunner = bun.bundler.PluginRunner;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const http = @import("../http.zig");
const NodeFallbackModules = @import("../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../analytics/analytics_thread.zig");
const ZigString = @import("root").bun.JSC.ZigString;
const Runtime = @import("../runtime.zig");
const Router = @import("./api/filesystem_router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../env_loader.zig");
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const WebCore = @import("root").bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("root").bun.JSC.C;
const JSC = @import("root").bun.JSC;
const JSError = @import("./base.zig").JSError;
const d = @import("./base.zig").d;
const MarkedArrayBuffer = @import("./base.zig").MarkedArrayBuffer;
const getAllocator = @import("./base.zig").getAllocator;
const JSValue = @import("root").bun.JSC.JSValue;
const NewClass = @import("./base.zig").NewClass;
const Microtask = @import("root").bun.JSC.Microtask;
const JSGlobalObject = @import("root").bun.JSC.JSGlobalObject;
const ExceptionValueRef = @import("root").bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = @import("root").bun.JSC.JSPrivateDataPtr;
const ZigConsoleClient = @import("root").bun.JSC.ZigConsoleClient;
const Node = @import("root").bun.JSC.Node;
const ZigException = @import("root").bun.JSC.ZigException;
const ZigStackTrace = @import("root").bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = @import("root").bun.JSC.ErrorableResolvedSource;
const ResolvedSource = @import("root").bun.JSC.ResolvedSource;
const JSPromise = @import("root").bun.JSC.JSPromise;
const JSInternalPromise = @import("root").bun.JSC.JSInternalPromise;
const JSModuleLoader = @import("root").bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = @import("root").bun.JSC.JSPromiseRejectionOperation;
const Exception = @import("root").bun.JSC.Exception;
const ErrorableZigString = @import("root").bun.JSC.ErrorableZigString;
const ZigGlobalObject = @import("root").bun.JSC.ZigGlobalObject;
const VM = @import("root").bun.JSC.VM;
const JSFunction = @import("root").bun.JSC.JSFunction;
const Config = @import("./config.zig");
const URL = @import("../url.zig").URL;
const Bun = JSC.API.Bun;
const EventLoop = JSC.EventLoop;
const PendingResolution = @import("../resolver/resolver.zig").PendingResolution;
const ThreadSafeFunction = JSC.napi.ThreadSafeFunction;
const PackageManager = @import("../install/install.zig").PackageManager;
const Install = @import("../install/install.zig");
const VirtualMachine = JSC.VirtualMachine;
const Dependency = @import("../install/dependency.zig");

const String = bun.String;

// Setting BUN_OVERRIDE_MODULE_PATH to the path to the bun repo will make it so modules are loaded
// from there instead of the ones embedded into the binary.
// In debug mode, this is set automatically for you, using the path relative to this file.
fn jsModuleFromFile(from_path: string, comptime input: string) string {
    // `modules_dev` is not minified or committed. Later we could also try loading source maps for it too.
    const moduleFolder = if (comptime Environment.isDebug) "modules_dev" else "modules";

    const Holder = struct {
        pub const file = @embedFile("../js/out/" ++ moduleFolder ++ "/" ++ input);
    };

    if ((comptime !Environment.allow_assert) and from_path.len == 0) {
        return Holder.file;
    }

    var file: std.fs.File = undefined;
    if ((comptime Environment.allow_assert) and from_path.len == 0) {
        const absolute_path = comptime (Environment.base_path ++ (std.fs.path.dirname(std.fs.path.dirname(@src().file).?).?) ++ "/js/out/" ++ moduleFolder ++ "/" ++ input);
        file = std.fs.openFileAbsoluteZ(absolute_path, .{ .mode = .read_only }) catch {
            const WarnOnce = struct {
                pub var warned = false;
            };
            if (!WarnOnce.warned) {
                WarnOnce.warned = true;
                Output.prettyErrorln("Could not find file: " ++ absolute_path ++ " - using embedded version", .{});
            }
            return Holder.file;
        };
    } else {
        var parts = [_]string{ from_path, "src/js/out/" ++ moduleFolder ++ "/" ++ input };
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var absolute_path_to_use = Fs.FileSystem.instance.absBuf(&parts, &buf);
        buf[absolute_path_to_use.len] = 0;
        file = std.fs.openFileAbsoluteZ(absolute_path_to_use[0..absolute_path_to_use.len :0], .{ .mode = .read_only }) catch {
            const WarnOnce = struct {
                pub var warned = false;
            };
            if (!WarnOnce.warned) {
                WarnOnce.warned = true;
                Output.prettyErrorln("Could not find file: {s}, so using embedded version", .{absolute_path_to_use});
            }
            return Holder.file;
        };
    }

    var contents = file.readToEndAlloc(bun.default_allocator, std.math.maxInt(usize)) catch @panic("Cannot read file " ++ input);
    file.close();
    return contents;
}

inline fn jsSyntheticModule(comptime name: ResolvedSource.Tag, specifier: String) ResolvedSource {
    return ResolvedSource{
        .allocator = null,
        .source_code = bun.String.empty,
        .specifier = specifier,
        .source_url = ZigString.init(@tagName(name)),
        .hash = 0,
        .tag = name,
    };
}

const BunDebugHolder = struct {
    pub var dir: ?std.fs.IterableDir = null;
    pub var lock: bun.Lock = undefined;
};

fn dumpSource(specifier: string, printer: anytype) !void {
    if (BunDebugHolder.dir == null) {
        BunDebugHolder.dir = try std.fs.cwd().makeOpenPathIterable("/tmp/bun-debug-src/", .{});
        BunDebugHolder.lock = bun.Lock.init();
    }

    BunDebugHolder.lock.lock();
    defer BunDebugHolder.lock.unlock();

    if (std.fs.path.dirname(specifier)) |dir_path| {
        var parent = try BunDebugHolder.dir.?.dir.makeOpenPathIterable(dir_path[1..], .{});
        defer parent.close();
        try parent.dir.writeFile(std.fs.path.basename(specifier), printer.ctx.getWritten());
    } else {
        try BunDebugHolder.dir.?.dir.writeFile(std.fs.path.basename(specifier), printer.ctx.getWritten());
    }
}

pub const RuntimeTranspilerStore = struct {
    const debug = Output.scoped(.compile, false);

    generation_number: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    store: TranspilerJob.Store,
    enabled: bool = true,

    pub fn init(allocator: std.mem.Allocator) RuntimeTranspilerStore {
        return RuntimeTranspilerStore{
            .store = TranspilerJob.Store.init(allocator),
        };
    }

    pub fn transpile(
        this: *RuntimeTranspilerStore,
        vm: *JSC.VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        path: Fs.Path,
        referrer: []const u8,
    ) *anyopaque {
        debug("transpile({s})", .{path.text});
        var job: *TranspilerJob = this.store.get();
        var owned_path = Fs.Path.init(bun.default_allocator.dupe(u8, path.text) catch unreachable);
        var promise = JSC.JSInternalPromise.create(globalObject);
        job.* = TranspilerJob{
            .path = owned_path,
            .globalThis = globalObject,
            .referrer = bun.default_allocator.dupe(u8, referrer) catch unreachable,
            .vm = vm,
            .log = logger.Log.init(bun.default_allocator),
            .loader = vm.bundler.options.loader(owned_path.name.ext),
            .promise = JSC.Strong.create(JSC.JSValue.fromCell(promise), globalObject),
            .poll_ref = .{},
            .fetcher = TranspilerJob.Fetcher{
                .file = {},
            },
        };
        job.schedule();
        return promise;
    }

    pub const TranspilerJob = struct {
        path: Fs.Path,
        referrer: []const u8,
        loader: options.Loader,
        promise: JSC.Strong = .{},
        vm: *JSC.VirtualMachine,
        globalThis: *JSC.JSGlobalObject,
        fetcher: Fetcher,
        poll_ref: JSC.PollRef = .{},
        generation_number: u32 = 0,
        log: logger.Log,
        parse_error: ?anyerror = null,
        resolved_source: ResolvedSource = ResolvedSource{},
        work_task: JSC.WorkPoolTask = .{ .callback = runFromWorkerThread },

        pub const Store = bun.HiveArray(TranspilerJob, 64).Fallback;

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
            bun.default_allocator.free(this.referrer);

            this.poll_ref.disable();
            this.fetcher.deinit();
            this.loader = options.Loader.file;
            this.path = Fs.Path.empty;
            this.log.deinit();
            this.promise.deinit();
            this.globalThis = undefined;
        }

        threadlocal var ast_memory_store: ?*js_ast.ASTMemoryAllocator = null;
        threadlocal var source_code_printer: ?*js_printer.BufferPrinter = null;

        pub fn dispatchToMainThread(this: *TranspilerJob) void {
            this.vm.eventLoop().enqueueTaskConcurrent(
                JSC.ConcurrentTask.fromCallback(this, runFromJSThread),
            );
        }

        pub fn runFromJSThread(this: *TranspilerJob) void {
            var vm = this.vm;
            var promise = this.promise.swap();
            var globalThis = this.globalThis;
            this.poll_ref.unref(vm);
            var specifier = if (this.parse_error == null) this.resolved_source.specifier else bun.String.create(this.path.text);
            var referrer = bun.String.create(this.referrer);
            var log = this.log;
            this.log = logger.Log.init(bun.default_allocator);
            var resolved_source = this.resolved_source;
            resolved_source.source_url = specifier.toZigString();

            resolved_source.tag = brk: {
                if (resolved_source.commonjs_exports_len > 0) {
                    var actual_package_json: *PackageJSON = brk2: {
                        // this should already be cached virtually always so it's fine to do this
                        var dir_info = (vm.bundler.resolver.readDirInfo(this.path.name.dir) catch null) orelse
                            break :brk .javascript;

                        break :brk2 dir_info.package_json orelse dir_info.enclosing_package_json;
                    } orelse break :brk .javascript;

                    if (actual_package_json.module_type == .esm) {
                        break :brk ResolvedSource.Tag.package_json_type_module;
                    }
                }

                break :brk ResolvedSource.Tag.javascript;
            };

            const parse_error = this.parse_error;
            if (!vm.transpiler_store.store.hive.in(this)) {
                this.promise.deinit();
            }
            this.deinit();

            _ = vm.transpiler_store.store.hive.put(this);

            ModuleLoader.AsyncModule.fulfill(globalThis, promise, resolved_source, parse_error, specifier, referrer, &log);
        }

        pub fn schedule(this: *TranspilerJob) void {
            this.poll_ref.ref(this.vm);
            JSC.WorkPool.schedule(&this.work_task);
        }

        pub fn runFromWorkerThread(work_task: *JSC.WorkPoolTask) void {
            @fieldParentPtr(TranspilerJob, "work_task", work_task).run();
        }

        pub fn run(this: *TranspilerJob) void {
            var arena = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();

            defer this.dispatchToMainThread();
            if (this.generation_number != this.vm.transpiler_store.generation_number.load(.Monotonic)) {
                this.parse_error = error.TranspilerJobGenerationMismatch;
                return;
            }

            if (ast_memory_store == null) {
                ast_memory_store = bun.default_allocator.create(js_ast.ASTMemoryAllocator) catch @panic("out of memory!");
                ast_memory_store.?.* = js_ast.ASTMemoryAllocator{
                    .allocator = arena.allocator(),
                    .previous = null,
                };
            }

            ast_memory_store.?.reset();
            ast_memory_store.?.allocator = arena.allocator();
            ast_memory_store.?.push();

            const path = this.path;
            const specifier = this.path.text;
            const loader = this.loader;
            this.log = logger.Log.init(bun.default_allocator);

            var vm = this.vm;
            var bundler: bun.Bundler = undefined;
            bundler = vm.bundler;
            var allocator = arena.allocator();
            bundler.setAllocator(allocator);
            bundler.setLog(&this.log);
            bundler.resolver.opts = bundler.options;
            bundler.macro_context = null;
            bundler.linker.resolver = &bundler.resolver;

            var fd: ?StoredFileDescriptorType = null;
            var package_json: ?*PackageJSON = null;
            const hash = JSC.Watcher.getHash(path.text);

            if (vm.bun_dev_watcher) |watcher| {
                if (watcher.indexOf(hash)) |index| {
                    const _fd = watcher.watchlist.items(.fd)[index];
                    fd = if (_fd > 0) _fd else null;
                    package_json = watcher.watchlist.items(.package_json)[index];
                }
            } else if (vm.bun_watcher) |watcher| {
                if (watcher.indexOf(hash)) |index| {
                    const _fd = watcher.watchlist.items(.fd)[index];
                    fd = if (_fd > 0) _fd else null;
                    package_json = watcher.watchlist.items(.package_json)[index];
                }
            }

            // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
            const is_node_override = strings.hasPrefixComptime(specifier, "/bun-vfs/node_modules/");

            const macro_remappings = if (vm.macro_mode or !vm.has_any_macro_remappings or is_node_override)
                MacroRemap{}
            else
                bundler.options.macro_remap;

            var fallback_source: logger.Source = undefined;

            // Usually, we want to close the input file automatically.
            //
            // If we're re-using the file descriptor from the fs watcher
            // Do not close it because that will break the kqueue-based watcher
            //
            var should_close_input_file_fd = fd == null;

            var input_file_fd: StoredFileDescriptorType = 0;
            var parse_options = Bundler.ParseOptions{
                .allocator = allocator,
                .path = path,
                .loader = loader,
                .dirname_fd = 0,
                .file_descriptor = fd,
                .file_fd_ptr = &input_file_fd,
                .file_hash = hash,
                .macro_remappings = macro_remappings,
                .jsx = bundler.options.jsx,
                .virtual_source = null,
                .hoist_bun_plugin = false,
                .dont_bundle_twice = true,
                .allow_commonjs = true,
                .inject_jest_globals = bundler.options.rewrite_jest_for_tests and
                    vm.main.len == path.text.len and
                    vm.main_hash == hash and
                    strings.eqlLong(vm.main, path.text, false),
            };

            defer {
                if (should_close_input_file_fd and input_file_fd != 0) {
                    _ = bun.JSC.Node.Syscall.close(input_file_fd);
                    input_file_fd = 0;
                }
            }

            if (is_node_override) {
                if (NodeFallbackModules.contentsFromPath(specifier)) |code| {
                    const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                    fallback_source = logger.Source{ .path = fallback_path, .contents = code, .key_path = fallback_path };
                    parse_options.virtual_source = &fallback_source;
                }
            }

            var parse_result: bun.bundler.ParseResult = bundler.parseMaybeReturnFileOnlyAllowSharedBuffer(
                parse_options,
                null,
                false,
                false,
            ) orelse {
                if (vm.isWatcherEnabled()) {
                    if (input_file_fd != 0) {
                        if (vm.bun_watcher != null and !is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                            should_close_input_file_fd = false;
                            vm.bun_watcher.?.addFile(
                                input_file_fd,
                                path.text,
                                hash,
                                loader,
                                0,
                                package_json,
                                true,
                            ) catch {};
                        }
                    }
                }

                this.parse_error = error.ParseError;
                return;
            };

            if (vm.isWatcherEnabled()) {
                if (input_file_fd != 0) {
                    if (vm.bun_watcher != null and !is_node_override and
                        std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules"))
                    {
                        should_close_input_file_fd = false;
                        vm.bun_watcher.?.addFile(
                            input_file_fd,
                            path.text,
                            hash,
                            loader,
                            0,
                            package_json,
                            true,
                        ) catch {};
                    }
                }
            }

            if (parse_result.already_bundled) {
                this.resolved_source = ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.createLatin1(parse_result.source.contents),
                    .specifier = String.create(specifier),
                    .source_url = ZigString.init(path.text),
                    // // TODO: change hash to a bitfield
                    // .hash = 1,

                    // having JSC own the memory causes crashes
                    .hash = 0,
                };
                return;
            }

            for (parse_result.ast.import_records.slice()) |*import_record_| {
                var import_record: *bun.ImportRecord = import_record_;

                if (JSC.HardcodedModule.Aliases.get(import_record.path.text)) |replacement| {
                    import_record.path.text = replacement.path;
                    import_record.tag = replacement.tag;
                    continue;
                }

                if (JSC.DisabledModule.has(import_record.path.text)) {
                    import_record.path.is_disabled = true;
                    import_record.do_commonjs_transform_in_printer = true;
                    continue;
                }

                if (bundler.options.rewrite_jest_for_tests) {
                    if (strings.eqlComptime(
                        import_record.path.text,
                        "@jest/globals",
                    ) or strings.eqlComptime(
                        import_record.path.text,
                        "vitest",
                    )) {
                        import_record.path.namespace = "bun";
                        import_record.tag = .bun_test;
                        import_record.path.text = "test";
                        continue;
                    }
                }

                if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                    import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                    import_record.path.namespace = "bun";

                    if (strings.eqlComptime(import_record.path.text, "test")) {
                        import_record.tag = .bun_test;
                    }
                }
            }

            if (source_code_printer == null) {
                var writer = try js_printer.BufferWriter.init(bun.default_allocator);
                source_code_printer = bun.default_allocator.create(js_printer.BufferPrinter) catch unreachable;
                source_code_printer.?.* = js_printer.BufferPrinter.init(writer);
                source_code_printer.?.ctx.append_null_byte = false;
            }

            var printer = source_code_printer.?.*;
            printer.ctx.reset();

            {
                defer source_code_printer.?.* = printer;
                _ = bundler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    SavedSourceMap.SourceMapHandler.init(&vm.source_mappings),
                ) catch |err| {
                    this.parse_error = err;
                    return;
                };
            }

            if (comptime Environment.dump_source) {
                dumpSource(specifier, &printer) catch {};
            }

            this.resolved_source = ResolvedSource{
                .allocator = null,
                .source_code = bun.String.createLatin1(printer.ctx.getWritten()),
                .specifier = String.create(specifier),
                .source_url = ZigString.init(path.text),
                .commonjs_exports = null,
                .commonjs_exports_len = if (parse_result.ast.exports_kind == .cjs)
                    std.math.maxInt(u32)
                else
                    0,
                .hash = 0,
            };
        }
    };
};

pub const ModuleLoader = struct {
    const debug = Output.scoped(.ModuleLoader, true);
    pub const AsyncModule = struct {

        // This is all the state used by the printer to print the module
        parse_result: ParseResult,
        // stmt_blocks: []*js_ast.Stmt.Data.Store.All.Block = &[_]*js_ast.Stmt.Data.Store.All.Block{},
        // expr_blocks: []*js_ast.Expr.Data.Store.All.Block = &[_]*js_ast.Expr.Data.Store.All.Block{},
        promise: JSC.Strong = .{},
        path: Fs.Path,
        specifier: string = "",
        referrer: string = "",
        string_buf: []u8 = &[_]u8{},
        fd: ?StoredFileDescriptorType = null,
        package_json: ?*PackageJSON = null,
        loader: Api.Loader,
        hash: u32 = std.math.maxInt(u32),
        globalThis: *JSC.JSGlobalObject = undefined,
        arena: bun.ArenaAllocator,

        // This is the specific state for making it async
        poll_ref: JSC.PollRef = .{},
        any_task: JSC.AnyTask = undefined,

        pub const Id = u32;

        const PackageDownloadError = struct {
            name: []const u8,
            resolution: Install.Resolution,
            err: anyerror,
            url: []const u8,
        };

        const PackageResolveError = struct {
            name: []const u8,
            err: anyerror,
            url: []const u8,
            version: Dependency.Version,
        };

        pub const Queue = struct {
            map: Map = .{},
            scheduled: u32 = 0,
            concurrent_task_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),

            const DeferredDependencyError = struct {
                dependency: Dependency,
                root_dependency_id: Install.DependencyID,
                err: anyerror,
            };

            pub const Map = std.ArrayListUnmanaged(AsyncModule);

            pub fn enqueue(this: *Queue, globalObject: *JSC.JSGlobalObject, opts: anytype) void {
                debug("enqueue: {s}", .{opts.specifier});
                var module = AsyncModule.init(opts, globalObject) catch unreachable;
                module.poll_ref.ref(this.vm());

                this.map.append(this.vm().allocator, module) catch unreachable;
                this.vm().packageManager().drainDependencyList();
            }

            pub fn onDependencyError(ctx: *anyopaque, dependency: Dependency, root_dependency_id: Install.DependencyID, err: anyerror) void {
                var this = bun.cast(*Queue, ctx);
                debug("onDependencyError: {s}", .{this.vm().packageManager().lockfile.str(&dependency.name)});

                var modules: []AsyncModule = this.map.items;
                var i: usize = 0;
                outer: for (modules) |module_| {
                    var module = module_;
                    const root_dependency_ids = module.parse_result.pending_imports.items(.root_dependency_id);
                    for (root_dependency_ids, 0..) |dep, dep_i| {
                        if (dep != root_dependency_id) continue;
                        module.resolveError(
                            this.vm(),
                            module.parse_result.pending_imports.items(.import_record_id)[dep_i],
                            .{
                                .name = this.vm().packageManager().lockfile.str(&dependency.name),
                                .err = err,
                                .url = "",
                                .version = dependency.version,
                            },
                        ) catch unreachable;
                        continue :outer;
                    }

                    modules[i] = module;
                    i += 1;
                }
                this.map.items.len = i;
            }
            pub fn onWakeHandler(ctx: *anyopaque, _: *PackageManager) void {
                debug("onWake", .{});
                var this = bun.cast(*Queue, ctx);
                var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch @panic("OOM");
                concurrent_task.* = .{
                    .task = JSC.Task.init(this),
                    .auto_delete = true,
                };
                this.vm().enqueueTaskConcurrent(concurrent_task);
            }

            pub fn onPoll(this: *Queue) void {
                debug("onPoll", .{});
                this.runTasks();
                this.pollModules();
            }

            pub fn runTasks(this: *Queue) void {
                var pm = this.vm().packageManager();

                if (Output.enable_ansi_colors_stderr) {
                    pm.startProgressBarIfNone();
                    pm.runTasks(
                        *Queue,
                        this,
                        .{
                            .onExtract = {},
                            .onResolve = onResolve,
                            .onPackageManifestError = onPackageManifestError,
                            .onPackageDownloadError = onPackageDownloadError,
                            .progress_bar = true,
                        },
                        PackageManager.Options.LogLevel.default,
                    ) catch unreachable;
                } else {
                    pm.runTasks(
                        *Queue,
                        this,
                        .{
                            .onExtract = {},
                            .onResolve = onResolve,
                            .onPackageManifestError = onPackageManifestError,
                            .onPackageDownloadError = onPackageDownloadError,
                        },
                        PackageManager.Options.LogLevel.default_no_progress,
                    ) catch unreachable;
                }
            }

            pub fn onResolve(_: *Queue) void {
                debug("onResolve", .{});
            }

            pub fn onPackageManifestError(
                this: *Queue,
                name: []const u8,
                err: anyerror,
                url: []const u8,
            ) void {
                debug("onPackageManifestError: {s}", .{name});

                var modules: []AsyncModule = this.map.items;
                var i: usize = 0;
                outer: for (modules) |module_| {
                    var module = module_;
                    var tags = module.parse_result.pending_imports.items(.tag);
                    for (tags, 0..) |tag, tag_i| {
                        if (tag == .resolve) {
                            var esms = module.parse_result.pending_imports.items(.esm);
                            const esm = esms[tag_i];
                            var string_bufs = module.parse_result.pending_imports.items(.string_buf);

                            if (!strings.eql(esm.name.slice(string_bufs[tag_i]), name)) continue;

                            var versions = module.parse_result.pending_imports.items(.dependency);

                            module.resolveError(
                                this.vm(),
                                module.parse_result.pending_imports.items(.import_record_id)[tag_i],
                                .{
                                    .name = name,
                                    .err = err,
                                    .url = url,
                                    .version = versions[tag_i],
                                },
                            ) catch unreachable;
                            continue :outer;
                        }
                    }

                    modules[i] = module;
                    i += 1;
                }
                this.map.items.len = i;
            }

            pub fn onPackageDownloadError(
                this: *Queue,
                package_id: Install.PackageID,
                name: []const u8,
                resolution: Install.Resolution,
                err: anyerror,
                url: []const u8,
            ) void {
                debug("onPackageDownloadError: {s}", .{name});

                const resolution_ids = this.vm().packageManager().lockfile.buffers.resolutions.items;
                var modules: []AsyncModule = this.map.items;
                var i: usize = 0;
                outer: for (modules) |module_| {
                    var module = module_;
                    const record_ids = module.parse_result.pending_imports.items(.import_record_id);
                    const root_dependency_ids = module.parse_result.pending_imports.items(.root_dependency_id);
                    for (root_dependency_ids, 0..) |dependency_id, import_id| {
                        if (resolution_ids[dependency_id] != package_id) continue;
                        module.downloadError(
                            this.vm(),
                            record_ids[import_id],
                            .{
                                .name = name,
                                .resolution = resolution,
                                .err = err,
                                .url = url,
                            },
                        ) catch unreachable;
                        continue :outer;
                    }

                    modules[i] = module;
                    i += 1;
                }
                this.map.items.len = i;
            }

            pub fn pollModules(this: *Queue) void {
                var pm = this.vm().packageManager();
                if (pm.pending_tasks > 0) return;

                var modules: []AsyncModule = this.map.items;
                var i: usize = 0;

                for (modules) |mod| {
                    var module = mod;
                    var tags = module.parse_result.pending_imports.items(.tag);
                    const root_dependency_ids = module.parse_result.pending_imports.items(.root_dependency_id);
                    // var esms = module.parse_result.pending_imports.items(.esm);
                    // var versions = module.parse_result.pending_imports.items(.dependency);
                    var done_count: usize = 0;
                    for (tags, 0..) |tag, tag_i| {
                        const root_id = root_dependency_ids[tag_i];
                        const resolution_ids = pm.lockfile.buffers.resolutions.items;
                        if (root_id >= resolution_ids.len) continue;
                        const package_id = resolution_ids[root_id];

                        switch (tag) {
                            .resolve => {
                                if (package_id == Install.invalid_package_id) {
                                    continue;
                                }

                                // if we get here, the package has already been resolved.
                                tags[tag_i] = .download;
                            },
                            .download => {
                                if (package_id == Install.invalid_package_id) {
                                    unreachable;
                                }
                            },
                            .done => {
                                done_count += 1;
                                continue;
                            },
                        }

                        if (package_id == Install.invalid_package_id) {
                            continue;
                        }

                        const package = pm.lockfile.packages.get(package_id);
                        std.debug.assert(package.resolution.tag != .root);

                        switch (pm.determinePreinstallState(package, pm.lockfile)) {
                            .done => {
                                // we are only truly done if all the dependencies are done.
                                const current_tasks = pm.total_tasks;
                                // so if enqueuing all the dependencies produces no new tasks, we are done.
                                pm.enqueueDependencyList(package.dependencies);
                                if (current_tasks == pm.total_tasks) {
                                    tags[tag_i] = .done;
                                    done_count += 1;
                                }
                            },
                            .extracting => {
                                // we are extracting the package
                                // we need to wait for the next poll
                                continue;
                            },
                            .extract => {},
                            else => {},
                        }
                    }

                    if (done_count == tags.len) {
                        module.done(this.vm());
                    } else {
                        modules[i] = module;
                        i += 1;
                    }
                }
                this.map.items.len = i;
                if (i == 0) {
                    // ensure we always end the progress bar
                    this.vm().packageManager().endProgressBar();
                }
            }

            pub fn vm(this: *Queue) *VirtualMachine {
                return @fieldParentPtr(VirtualMachine, "modules", this);
            }
        };

        pub fn init(opts: anytype, globalObject: *JSC.JSGlobalObject) !AsyncModule {
            var promise = JSC.Strong{};
            // var stmt_blocks = js_ast.Stmt.Data.toOwnedSlice();
            // var expr_blocks = js_ast.Expr.Data.toOwnedSlice();
            const this_promise = JSValue.createInternalPromise(globalObject);
            promise.set(globalObject, this_promise);

            var buf = bun.StringBuilder{};
            buf.count(opts.referrer);
            buf.count(opts.specifier);
            buf.count(opts.path.text);

            try buf.allocate(bun.default_allocator);
            opts.promise_ptr.?.* = this_promise.asInternalPromise().?;
            const referrer = buf.append(opts.referrer);
            const specifier = buf.append(opts.specifier);
            const path = Fs.Path.init(buf.append(opts.path.text));

            return AsyncModule{
                .parse_result = opts.parse_result,
                .promise = promise,
                .path = path,
                .specifier = specifier,
                .referrer = referrer,
                .fd = opts.fd,
                .package_json = opts.package_json,
                .loader = opts.loader.toAPI(),
                .string_buf = buf.allocatedSlice(),
                // .stmt_blocks = stmt_blocks,
                // .expr_blocks = expr_blocks,
                .globalThis = globalObject,
                .arena = opts.arena,
            };
        }

        pub fn done(this: *AsyncModule, jsc_vm: *JSC.VirtualMachine) void {
            var clone = jsc_vm.allocator.create(AsyncModule) catch unreachable;
            clone.* = this.*;
            jsc_vm.modules.scheduled += 1;
            clone.any_task = JSC.AnyTask.New(AsyncModule, onDone).init(clone);
            jsc_vm.enqueueTask(JSC.Task.init(&clone.any_task));
        }

        pub fn onDone(this: *AsyncModule) void {
            JSC.markBinding(@src());
            var jsc_vm = this.globalThis.bunVM();
            jsc_vm.modules.scheduled -= 1;
            if (jsc_vm.modules.scheduled == 0) {
                jsc_vm.packageManager().endProgressBar();
            }
            var log = logger.Log.init(jsc_vm.allocator);
            defer log.deinit();
            var errorable: ErrorableResolvedSource = undefined;
            this.poll_ref.unref(jsc_vm);
            outer: {
                errorable = ErrorableResolvedSource.ok(this.resumeLoadingModule(&log) catch |err| {
                    JSC.VirtualMachine.processFetchLog(
                        this.globalThis,
                        bun.String.init(this.specifier),
                        bun.String.init(this.referrer),
                        &log,
                        &errorable,
                        err,
                    );
                    break :outer;
                });
            }

            var spec = bun.String.init(ZigString.init(this.specifier).withEncoding());
            var ref = bun.String.init(ZigString.init(this.referrer).withEncoding());
            Bun__onFulfillAsyncModule(
                this.promise.get().?,
                &errorable,
                &spec,
                &ref,
            );
            this.deinit();
            jsc_vm.allocator.destroy(this);
        }

        pub fn fulfill(
            globalThis: *JSC.JSGlobalObject,
            promise: JSC.JSValue,
            resolved_source: ResolvedSource,
            err: ?anyerror,
            specifier_: bun.String,
            referrer_: bun.String,
            log: *logger.Log,
        ) void {
            JSC.markBinding(@src());
            var specifier = specifier_;
            var referrer = referrer_;
            defer {
                specifier.deref();
                referrer.deref();
            }

            var errorable: ErrorableResolvedSource = undefined;
            if (err) |e| {
                JSC.VirtualMachine.processFetchLog(
                    globalThis,
                    specifier,
                    referrer,
                    log,
                    &errorable,
                    e,
                );
            } else {
                errorable = ErrorableResolvedSource.ok(resolved_source);
            }
            log.deinit();

            Bun__onFulfillAsyncModule(
                promise,
                &errorable,
                &specifier,
                &referrer,
            );
        }

        pub fn resolveError(this: *AsyncModule, vm: *JSC.VirtualMachine, import_record_id: u32, result: PackageResolveError) !void {
            var globalThis = this.globalThis;

            var msg: []u8 = try switch (result.err) {
                error.PackageManifestHTTP400 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 400 while resolving package '{s}' at '{s}'",
                    .{ result.name, result.url },
                ),
                error.PackageManifestHTTP401 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 401 while resolving package '{s}' at '{s}'",
                    .{ result.name, result.url },
                ),
                error.PackageManifestHTTP402 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 402 while resolving package '{s}' at '{s}'",
                    .{ result.name, result.url },
                ),
                error.PackageManifestHTTP403 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 403 while resolving package '{s}' at '{s}'",
                    .{ result.name, result.url },
                ),
                error.PackageManifestHTTP404 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "Package '{s}' was not found",
                    .{result.name},
                ),
                error.PackageManifestHTTP4xx => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 4xx while resolving package '{s}' at '{s}'",
                    .{ result.name, result.url },
                ),
                error.PackageManifestHTTP5xx => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 5xx while resolving package '{s}' at '{s}'",
                    .{ result.name, result.url },
                ),
                error.DistTagNotFound, error.NoMatchingVersion => brk: {
                    const prefix: []const u8 = if (result.err == error.NoMatchingVersion and result.version.tag == .npm and result.version.value.npm.version.isExact())
                        "Version not found"
                    else if (result.version.tag == .npm and !result.version.value.npm.version.isExact())
                        "No matching version found"
                    else
                        "No match found";

                    break :brk std.fmt.allocPrint(
                        bun.default_allocator,
                        "{s} '{s}' for package '{s}' (but package exists)",
                        .{ prefix, vm.packageManager().lockfile.str(&result.version.literal), result.name },
                    );
                },
                else => |err| std.fmt.allocPrint(
                    bun.default_allocator,
                    "{s} resolving package '{s}' at '{s}'",
                    .{ bun.asByteSlice(@errorName(err)), result.name, result.url },
                ),
            };

            const name: []const u8 = switch (result.err) {
                error.NoMatchingVersion => "PackageVersionNotFound",
                error.DistTagNotFound => "PackageTagNotFound",
                error.PackageManifestHTTP403 => "PackageForbidden",
                error.PackageManifestHTTP404 => "PackageNotFound",
                else => "PackageResolveError",
            };

            var error_instance = ZigString.init(msg).withEncoding().toErrorInstance(globalThis);
            if (result.url.len > 0)
                error_instance.put(globalThis, ZigString.static("url"), ZigString.init(result.url).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("name"), ZigString.init(name).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("pkg"), ZigString.init(result.name).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("specifier"), ZigString.init(this.specifier).withEncoding().toValueGC(globalThis));
            const location = logger.rangeData(&this.parse_result.source, this.parse_result.ast.import_records.at(import_record_id).range, "").location.?;
            error_instance.put(globalThis, ZigString.static("sourceURL"), ZigString.init(this.parse_result.source.path.text).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("line"), JSValue.jsNumber(location.line));
            if (location.line_text) |line_text| {
                error_instance.put(globalThis, ZigString.static("lineText"), ZigString.init(line_text).withEncoding().toValueGC(globalThis));
            }
            error_instance.put(globalThis, ZigString.static("column"), JSValue.jsNumber(location.column));
            if (this.referrer.len > 0 and !strings.eqlComptime(this.referrer, "undefined")) {
                error_instance.put(globalThis, ZigString.static("referrer"), ZigString.init(this.referrer).withEncoding().toValueGC(globalThis));
            }

            const promise_value = this.promise.swap();
            var promise = promise_value.asInternalPromise().?;
            promise_value.ensureStillAlive();
            this.poll_ref.unref(vm);
            this.deinit();
            promise.rejectAsHandled(globalThis, error_instance);
        }
        pub fn downloadError(this: *AsyncModule, vm: *JSC.VirtualMachine, import_record_id: u32, result: PackageDownloadError) !void {
            var globalThis = this.globalThis;

            const msg_args = .{
                result.name,
                result.resolution.fmt(vm.packageManager().lockfile.buffers.string_bytes.items),
            };

            var msg: []u8 = try switch (result.err) {
                error.TarballHTTP400 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 400 downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballHTTP401 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 401 downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballHTTP402 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 402 downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballHTTP403 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 403 downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballHTTP404 => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 404 downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballHTTP4xx => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 4xx downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballHTTP5xx => std.fmt.allocPrint(
                    bun.default_allocator,
                    "HTTP 5xx downloading package '{s}@{any}'",
                    msg_args,
                ),
                error.TarballFailedToExtract => std.fmt.allocPrint(
                    bun.default_allocator,
                    "Failed to extract tarball for package '{s}@{any}'",
                    msg_args,
                ),
                else => |err| std.fmt.allocPrint(
                    bun.default_allocator,
                    "{s} downloading package '{s}@{any}'",
                    .{
                        bun.asByteSlice(@errorName(err)),
                        result.name,
                        result.resolution.fmt(vm.packageManager().lockfile.buffers.string_bytes.items),
                    },
                ),
            };

            const name: []const u8 = switch (result.err) {
                error.TarballFailedToExtract => "PackageExtractionError",
                error.TarballHTTP403 => "TarballForbiddenError",
                error.TarballHTTP404 => "TarballNotFoundError",
                else => "TarballDownloadError",
            };

            var error_instance = ZigString.init(msg).withEncoding().toErrorInstance(globalThis);
            if (result.url.len > 0)
                error_instance.put(globalThis, ZigString.static("url"), ZigString.init(result.url).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("name"), ZigString.init(name).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("pkg"), ZigString.init(result.name).withEncoding().toValueGC(globalThis));
            if (this.specifier.len > 0 and !strings.eqlComptime(this.specifier, "undefined")) {
                error_instance.put(globalThis, ZigString.static("referrer"), ZigString.init(this.specifier).withEncoding().toValueGC(globalThis));
            }

            const location = logger.rangeData(&this.parse_result.source, this.parse_result.ast.import_records.at(import_record_id).range, "").location.?;
            error_instance.put(globalThis, ZigString.static("specifier"), ZigString.init(
                this.parse_result.ast.import_records.at(import_record_id).path.text,
            ).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("sourceURL"), ZigString.init(this.parse_result.source.path.text).withEncoding().toValueGC(globalThis));
            error_instance.put(globalThis, ZigString.static("line"), JSValue.jsNumber(location.line));
            if (location.line_text) |line_text| {
                error_instance.put(globalThis, ZigString.static("lineText"), ZigString.init(line_text).withEncoding().toValueGC(globalThis));
            }
            error_instance.put(globalThis, ZigString.static("column"), JSValue.jsNumber(location.column));

            const promise_value = this.promise.swap();
            var promise = promise_value.asInternalPromise().?;
            promise_value.ensureStillAlive();
            this.poll_ref.unref(vm);
            this.deinit();
            promise.rejectAsHandled(globalThis, error_instance);
        }

        pub fn resumeLoadingModule(this: *AsyncModule, log: *logger.Log) !ResolvedSource {
            debug("resumeLoadingModule: {s}", .{this.specifier});
            var parse_result = this.parse_result;
            var path = this.path;
            var jsc_vm = JSC.VirtualMachine.get();
            var specifier = this.specifier;
            var old_log = jsc_vm.log;

            jsc_vm.bundler.linker.log = log;
            jsc_vm.bundler.log = log;
            jsc_vm.bundler.resolver.log = log;
            jsc_vm.packageManager().log = log;
            defer {
                jsc_vm.bundler.linker.log = old_log;
                jsc_vm.bundler.log = old_log;
                jsc_vm.bundler.resolver.log = old_log;
                jsc_vm.packageManager().log = old_log;
            }

            // We _must_ link because:
            // - node_modules bundle won't be properly
            try jsc_vm.bundler.linker.link(
                path,
                &parse_result,
                jsc_vm.origin,
                .absolute_path,
                false,
                true,
            );
            this.parse_result = parse_result;

            var printer = VirtualMachine.source_code_printer.?.*;
            printer.ctx.reset();

            {
                defer VirtualMachine.source_code_printer.?.* = printer;
                _ = try jsc_vm.bundler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
                );
            }

            if (comptime Environment.dump_source) {
                try dumpSource(specifier, &printer);
            }

            var commonjs_exports = try bun.default_allocator.alloc(ZigString, parse_result.ast.commonjs_export_names.len);
            for (parse_result.ast.commonjs_export_names, commonjs_exports) |name, *out| {
                out.* = ZigString.fromUTF8(name);
            }

            if (jsc_vm.isWatcherEnabled()) {
                var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, bun.String.init(specifier), path.text, null, false);

                if (parse_result.input_fd) |fd_| {
                    if (jsc_vm.bun_watcher != null and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                        jsc_vm.bun_watcher.?.addFile(
                            fd_,
                            path.text,
                            this.hash,
                            options.Loader.fromAPI(this.loader),
                            0,
                            this.package_json,
                            true,
                        ) catch {};
                    }
                }

                resolved_source.commonjs_exports = if (commonjs_exports.len > 0)
                    commonjs_exports.ptr
                else
                    null;
                resolved_source.commonjs_exports_len = if (commonjs_exports.len > 0)
                    @as(u32, @truncate(commonjs_exports.len))
                else if (parse_result.ast.exports_kind == .cjs)
                    std.math.maxInt(u32)
                else
                    0;

                return resolved_source;
            }

            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.createLatin1(printer.ctx.getWritten()),
                .specifier = String.init(specifier),
                .source_url = ZigString.init(path.text),
                .commonjs_exports = if (commonjs_exports.len > 0)
                    commonjs_exports.ptr
                else
                    null,
                .commonjs_exports_len = if (commonjs_exports.len > 0)
                    @as(u32, @truncate(commonjs_exports.len))
                else if (parse_result.ast.exports_kind == .cjs)
                    std.math.maxInt(u32)
                else
                    0,
                // // TODO: change hash to a bitfield
                // .hash = 1,

                // having JSC own the memory causes crashes
                .hash = 0,
            };
        }

        pub fn deinit(this: *AsyncModule) void {
            this.promise.deinit();
            this.parse_result.deinit();
            this.arena.deinit();
            // bun.default_allocator.free(this.stmt_blocks);
            // bun.default_allocator.free(this.expr_blocks);

            bun.default_allocator.free(this.string_buf);
        }

        extern "C" fn Bun__onFulfillAsyncModule(
            promiseValue: JSC.JSValue,
            res: *JSC.ErrorableResolvedSource,
            specifier: *bun.String,
            referrer: *bun.String,
        ) void;
    };

    pub export fn Bun__getDefaultLoader(global: *JSC.JSGlobalObject, str: *const bun.String) Api.Loader {
        var jsc_vm = global.bunVM();
        const filename = str.toUTF8(jsc_vm.allocator);
        defer filename.deinit();
        const loader = jsc_vm.bundler.options.loader(Fs.PathName.init(filename.slice()).ext).toAPI();
        if (loader == .file) {
            return Api.Loader.js;
        }

        return loader;
    }

    pub fn transpileSourceCode(
        jsc_vm: *VirtualMachine,
        specifier: string,
        display_specifier: string,
        referrer: string,
        input_specifier: String,
        path: Fs.Path,
        loader: options.Loader,
        log: *logger.Log,
        virtual_source: ?*const logger.Source,
        ret: *ErrorableResolvedSource,
        promise_ptr: ?*?*JSC.JSInternalPromise,
        source_code_printer: *js_printer.BufferPrinter,
        globalObject: ?*JSC.JSGlobalObject,
        comptime flags: FetchFlags,
    ) !ResolvedSource {
        const disable_transpilying = comptime flags.disableTranspiling();

        switch (loader) {
            .js, .jsx, .ts, .tsx, .json, .toml, .text => {
                jsc_vm.transpiled_count += 1;
                jsc_vm.bundler.resetStore();
                const hash = http.Watcher.getHash(path.text);
                const is_main = jsc_vm.main.len == path.text.len and
                    jsc_vm.main_hash == hash and
                    strings.eqlLong(jsc_vm.main, path.text, false);

                var arena: bun.ArenaAllocator = undefined;

                // Attempt to reuse the Arena from the parser when we can
                // This code is potentially re-entrant, so only one Arena can be reused at a time
                // That's why we have to check if the Arena is null
                //
                // Using an Arena here is a significant memory optimization when loading many files
                if (jsc_vm.parser_arena) |shared| {
                    arena = shared;
                    jsc_vm.parser_arena = null;
                    _ = arena.reset(.retain_capacity);
                } else {
                    arena = bun.ArenaAllocator.init(jsc_vm.allocator);
                }
                var give_back_arena = true;
                defer {
                    if (give_back_arena) {
                        if (jsc_vm.parser_arena == null) {
                            jsc_vm.parser_arena = arena;
                        } else {
                            arena.deinit();
                        }
                    }
                }

                var allocator = arena.allocator();

                var fd: ?StoredFileDescriptorType = null;
                var package_json: ?*PackageJSON = null;

                if (jsc_vm.bun_dev_watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        const _fd = watcher.watchlist.items(.fd)[index];
                        fd = if (_fd > 0) _fd else null;
                        package_json = watcher.watchlist.items(.package_json)[index];
                    }
                } else if (jsc_vm.bun_watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        const _fd = watcher.watchlist.items(.fd)[index];
                        fd = if (_fd > 0) _fd else null;
                        package_json = watcher.watchlist.items(.package_json)[index];
                    }
                }

                var old = jsc_vm.bundler.log;
                jsc_vm.bundler.log = log;
                jsc_vm.bundler.linker.log = log;
                jsc_vm.bundler.resolver.log = log;
                if (jsc_vm.bundler.resolver.package_manager) |pm| {
                    pm.log = log;
                }

                defer {
                    jsc_vm.bundler.log = old;
                    jsc_vm.bundler.linker.log = old;
                    jsc_vm.bundler.resolver.log = old;
                    if (jsc_vm.bundler.resolver.package_manager) |pm| {
                        pm.log = old;
                    }
                }

                // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
                const is_node_override = strings.hasPrefixComptime(specifier, "/bun-vfs/node_modules/");

                const macro_remappings = if (jsc_vm.macro_mode or !jsc_vm.has_any_macro_remappings or is_node_override)
                    MacroRemap{}
                else
                    jsc_vm.bundler.options.macro_remap;

                var fallback_source: logger.Source = undefined;

                // Usually, we want to close the input file automatically.
                //
                // If we're re-using the file descriptor from the fs watcher
                // Do not close it because that will break the kqueue-based watcher
                //
                var should_close_input_file_fd = fd == null;

                var input_file_fd: StoredFileDescriptorType = 0;
                var parse_options = Bundler.ParseOptions{
                    .allocator = allocator,
                    .path = path,
                    .loader = loader,
                    .dirname_fd = 0,
                    .file_descriptor = fd,
                    .file_fd_ptr = &input_file_fd,
                    .file_hash = hash,
                    .macro_remappings = macro_remappings,
                    .jsx = jsc_vm.bundler.options.jsx,
                    .virtual_source = virtual_source,
                    .hoist_bun_plugin = true,
                    .dont_bundle_twice = true,
                    .allow_commonjs = true,
                    .inject_jest_globals = jsc_vm.bundler.options.rewrite_jest_for_tests and is_main,
                };
                defer {
                    if (should_close_input_file_fd and input_file_fd != 0) {
                        _ = bun.JSC.Node.Syscall.close(input_file_fd);
                        input_file_fd = 0;
                    }
                }

                if (is_node_override) {
                    if (NodeFallbackModules.contentsFromPath(specifier)) |code| {
                        const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                        fallback_source = logger.Source{ .path = fallback_path, .contents = code, .key_path = fallback_path };
                        parse_options.virtual_source = &fallback_source;
                    }
                }

                var parse_result = jsc_vm.bundler.parseMaybeReturnFileOnly(
                    parse_options,
                    null,
                    disable_transpilying,
                ) orelse {
                    if (comptime !disable_transpilying) {
                        if (jsc_vm.isWatcherEnabled()) {
                            if (input_file_fd != 0) {
                                if (jsc_vm.bun_watcher != null and !is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                                    should_close_input_file_fd = false;
                                    jsc_vm.bun_watcher.?.addFile(
                                        input_file_fd,
                                        path.text,
                                        hash,
                                        loader,
                                        0,
                                        package_json,
                                        true,
                                    ) catch {};
                                }
                            }
                        }
                    }

                    return error.ParseError;
                };

                if (parse_result.loader == .wasm) {
                    return transpileSourceCode(
                        jsc_vm,
                        specifier,
                        display_specifier,
                        referrer,
                        input_specifier,
                        path,
                        .wasm,
                        log,
                        &parse_result.source,
                        ret,
                        promise_ptr,
                        source_code_printer,
                        globalObject,
                        flags,
                    );
                }

                if (comptime !disable_transpilying) {
                    if (jsc_vm.isWatcherEnabled()) {
                        if (input_file_fd != 0) {
                            if (jsc_vm.bun_watcher != null and !is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
                                should_close_input_file_fd = false;
                                jsc_vm.bun_watcher.?.addFile(
                                    input_file_fd,
                                    path.text,
                                    hash,
                                    loader,
                                    0,
                                    package_json,
                                    true,
                                ) catch {};
                            }
                        }
                    }
                }

                if (jsc_vm.bundler.log.errors > 0) {
                    return error.ParseError;
                }

                if (comptime disable_transpilying) {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = switch (comptime flags) {
                            .print_source_and_clone => bun.String.init(jsc_vm.allocator.dupe(u8, parse_result.source.contents) catch unreachable),
                            .print_source => bun.String.static(parse_result.source.contents),
                            else => unreachable,
                        },
                        .specifier = input_specifier,
                        .source_url = ZigString.init(path.text),
                        .hash = 0,
                    };
                }

                if (parse_result.already_bundled) {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = bun.String.createLatin1(parse_result.source.contents),
                        .specifier = input_specifier,
                        .source_url = ZigString.init(path.text),
                        // // TODO: change hash to a bitfield
                        // .hash = 1,

                        // having JSC own the memory causes crashes
                        .hash = 0,
                    };
                }

                const has_bun_plugin = parse_result.ast.bun_plugin.hoisted_stmts.items.len > 0;

                if (has_bun_plugin) {
                    try ModuleLoader.runBunPlugin(jsc_vm, JSC.VirtualMachine.source_code_printer.?, &parse_result, ret);
                }

                const start_count = jsc_vm.bundler.linker.import_counter;

                // We _must_ link because:
                // - node_modules bundle won't be properly
                try jsc_vm.bundler.linker.link(
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

                    if (parse_result.source.contents_is_recycled) {
                        // this shared buffer is about to become owned by the AsyncModule struct
                        jsc_vm.bundler.resolver.caches.fs.resetSharedBuffer(
                            jsc_vm.bundler.resolver.caches.fs.sharedBuffer(),
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
                    arena = bun.ArenaAllocator.init(bun.default_allocator);
                    give_back_arena = false;
                    return error.AsyncModule;
                }

                if (!jsc_vm.macro_mode)
                    jsc_vm.resolved_count += jsc_vm.bundler.linker.import_counter - start_count;
                jsc_vm.bundler.linker.import_counter = 0;

                var printer = source_code_printer.*;
                printer.ctx.reset();

                const written = brk: {
                    defer source_code_printer.* = printer;
                    break :brk try jsc_vm.bundler.printWithSourceMap(
                        parse_result,
                        @TypeOf(&printer),
                        &printer,
                        .esm_ascii,
                        SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
                    );
                };

                if (written == 0) {

                    // if it's an empty file but there were plugins
                    // we don't want it to break if you try to import from it
                    if (has_bun_plugin) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = String.static("module.exports=undefined"),
                            .specifier = input_specifier,
                            .source_url = ZigString.init(path.text),
                            // // TODO: change hash to a bitfield
                            // .hash = 1,

                            // having JSC own the memory causes crashes
                            .hash = 0,
                        };
                    }
                }

                if (comptime Environment.dump_source) {
                    try dumpSource(specifier, &printer);
                }

                var commonjs_exports = try bun.default_allocator.alloc(ZigString, parse_result.ast.commonjs_export_names.len);
                for (parse_result.ast.commonjs_export_names, commonjs_exports) |name, *out| {
                    out.* = ZigString.fromUTF8(name);
                }

                defer {
                    if (is_main) {
                        jsc_vm.has_loaded = true;
                    }
                }

                if (jsc_vm.isWatcherEnabled()) {
                    var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, input_specifier, path.text, null, false);

                    resolved_source.commonjs_exports = if (commonjs_exports.len > 0)
                        commonjs_exports.ptr
                    else
                        null;
                    resolved_source.commonjs_exports_len = if (commonjs_exports.len > 0)
                        @as(u32, @truncate(commonjs_exports.len))
                    else if (parse_result.ast.exports_kind == .cjs)
                        std.math.maxInt(u32)
                    else
                        0;
                    return resolved_source;
                }

                // Pass along package.json type "module" if set.
                const tag = brk: {
                    if (parse_result.ast.exports_kind == .cjs and parse_result.source.path.isFile()) {
                        var actual_package_json: *PackageJSON = package_json orelse brk2: {
                            // this should already be cached virtually always so it's fine to do this
                            var dir_info = (jsc_vm.bundler.resolver.readDirInfo(parse_result.source.path.name.dir) catch null) orelse
                                break :brk .javascript;

                            break :brk2 dir_info.package_json orelse dir_info.enclosing_package_json;
                        } orelse break :brk .javascript;

                        if (actual_package_json.module_type == .esm) {
                            break :brk ResolvedSource.Tag.package_json_type_module;
                        }
                    }

                    break :brk ResolvedSource.Tag.javascript;
                };

                return .{
                    .allocator = null,
                    .source_code = bun.String.createLatin1(printer.ctx.getWritten()),
                    .specifier = input_specifier,
                    .source_url = ZigString.init(path.text),
                    .commonjs_exports = if (commonjs_exports.len > 0)
                        commonjs_exports.ptr
                    else
                        null,
                    .commonjs_exports_len = if (commonjs_exports.len > 0)
                        @as(u32, @truncate(commonjs_exports.len))
                    else if (parse_result.ast.exports_kind == .cjs)
                        std.math.maxInt(u32)
                    else
                        0,
                    // // TODO: change hash to a bitfield
                    // .hash = 1,

                    // having JSC own the memory causes crashes
                    .hash = 0,

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
            //             const _fd = watcher.watchlist.items(.fd)[index];
            //             fd = if (_fd > 0) _fd else null;
            //         }
            //     }

            //     var parse_options = Bundler.ParseOptions{
            //         .allocator = allocator,
            //         .path = path,
            //         .loader = loader,
            //         .dirname_fd = 0,
            //         .file_descriptor = fd,
            //         .file_hash = hash,
            //         .macro_remappings = MacroRemap{},
            //         .jsx = jsc_vm.bundler.options.jsx,
            //     };

            //     var parse_result = jsc_vm.bundler.parse(
            //         parse_options,
            //         null,
            //     ) orelse {
            //         return error.ParseError;
            //     };

            //     return ResolvedSource{
            //         .allocator = if (jsc_vm.has_loaded) &jsc_vm.allocator else null,
            //         .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, parse_result.source.contents) catch unreachable),
            //         .specifier = ZigString.init(specifier),
            //         .source_url = ZigString.init(path.text),
            //         .hash = 0,
            //         .tag = ResolvedSource.Tag.wasm,
            //     };
            // },
            .wasm => {
                if (strings.eqlComptime(referrer, "undefined") and strings.eqlLong(jsc_vm.main, path.text, true)) {
                    if (virtual_source) |source| {
                        if (globalObject) |globalThis| {
                            // attempt to avoid reading the WASM file twice.
                            var encoded = JSC.EncodedJSValue{
                                .asPtr = globalThis,
                            };
                            const globalValue = @as(JSC.JSValue, @enumFromInt(encoded.asInt64));
                            globalValue.put(
                                globalThis,
                                JSC.ZigString.static("wasmSourceBytes"),
                                JSC.ArrayBuffer.create(globalThis, source.contents, .Uint8Array),
                            );
                        }
                    }
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = bun.String.static(
                            strings.append3(
                                bun.default_allocator,
                                JSC.Node.fs.constants_string,
                                // @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "node/wasi.js")),
                                "TODO:",
                                @embedFile("../js/wasi-runner.js"),
                            ) catch unreachable,
                        ),
                        .specifier = input_specifier,
                        .source_url = ZigString.init(path.text),
                        .tag = .esm,
                        .hash = 0,
                    };
                }

                return transpileSourceCode(
                    jsc_vm,
                    specifier,
                    display_specifier,
                    referrer,
                    input_specifier,
                    path,
                    .file,
                    log,
                    virtual_source,
                    ret,
                    promise_ptr,
                    source_code_printer,
                    globalObject,
                    flags,
                );
            },

            else => {
                var stack_buf = std.heap.stackFallback(4096, jsc_vm.allocator);
                var allocator = stack_buf.get();
                var buf = MutableString.init2048(allocator) catch unreachable;
                defer buf.deinit();
                var writer = buf.writer();
                if (!jsc_vm.origin.isEmpty()) {
                    writer.writeAll("export default `") catch unreachable;
                    // TODO: escape backtick char, though we might already do that
                    @import("./api/bun.zig").getPublicPath(specifier, jsc_vm.origin, @TypeOf(&writer), &writer);
                    writer.writeAll("`;\n") catch unreachable;
                } else {
                    writer.writeAll("export default ") catch unreachable;
                    buf = js_printer.quoteForJSON(specifier, buf, true) catch @panic("out of memory");
                    writer = buf.writer();
                    writer.writeAll(";\n") catch unreachable;
                }

                const public_url = bun.String.create(buf.toOwnedSliceLeaky());
                return ResolvedSource{
                    .allocator = &jsc_vm.allocator,
                    .source_code = public_url,
                    .specifier = input_specifier,
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                };
            },
        }
    }

    pub fn runBunPlugin(
        jsc_vm: *VirtualMachine,
        source_code_printer: *js_printer.BufferPrinter,
        parse_result: *ParseResult,
        ret: *ErrorableResolvedSource,
    ) !void {
        var printer = source_code_printer.*;
        printer.ctx.reset();

        defer printer.ctx.reset();
        // If we start transpiling in the middle of an existing transpilation session
        // we will hit undefined memory bugs
        // unless we disable resetting the store until we are done transpiling
        const prev_disable_reset = js_ast.Stmt.Data.Store.disable_reset;
        js_ast.Stmt.Data.Store.disable_reset = true;
        js_ast.Expr.Data.Store.disable_reset = true;

        // flip the source code we use
        // unless we're already transpiling a plugin
        // that case could happen when
        const was_printing_plugin = jsc_vm.is_printing_plugin;
        const prev = jsc_vm.bundler.resolver.caches.fs.use_alternate_source_cache;
        jsc_vm.is_printing_plugin = true;
        defer {
            js_ast.Stmt.Data.Store.disable_reset = prev_disable_reset;
            js_ast.Expr.Data.Store.disable_reset = prev_disable_reset;
            if (!was_printing_plugin) jsc_vm.bundler.resolver.caches.fs.use_alternate_source_cache = prev;
            jsc_vm.is_printing_plugin = was_printing_plugin;
        }
        // we flip use_alternate_source_cache
        if (!was_printing_plugin) jsc_vm.bundler.resolver.caches.fs.use_alternate_source_cache = !prev;

        // this is a bad idea, but it should work for now.
        const original_name = parse_result.ast.symbols.mut(parse_result.ast.bun_plugin.ref.innerIndex()).original_name;
        parse_result.ast.symbols.mut(parse_result.ast.bun_plugin.ref.innerIndex()).original_name = "globalThis.Bun.plugin";
        defer {
            parse_result.ast.symbols.mut(parse_result.ast.bun_plugin.ref.innerIndex()).original_name = original_name;
        }
        const hoisted_stmts = parse_result.ast.bun_plugin.hoisted_stmts.items;

        var parts = [1]js_ast.Part{
            js_ast.Part{
                .stmts = hoisted_stmts,
            },
        };
        var ast_copy = parse_result.ast;
        ast_copy.import_records.set(try jsc_vm.allocator.dupe(ImportRecord, ast_copy.import_records.slice()));
        defer ast_copy.import_records.deinitWithAllocator(jsc_vm.allocator);
        ast_copy.parts.set(&parts);
        ast_copy.prepend_part = null;
        var temporary_source = parse_result.source;
        var source_name = try std.fmt.allocPrint(jsc_vm.allocator, "{s}.plugin.{s}", .{ temporary_source.path.text, temporary_source.path.name.ext[1..] });
        temporary_source.path = Fs.Path.init(source_name);

        var temp_parse_result = parse_result.*;
        temp_parse_result.ast = ast_copy;

        try jsc_vm.bundler.linker.link(
            temporary_source.path,
            &temp_parse_result,
            jsc_vm.origin,
            .absolute_path,
            false,
            true,
        );

        _ = brk: {
            defer source_code_printer.* = printer;
            break :brk try jsc_vm.bundler.printWithSourceMapMaybe(
                temp_parse_result.ast,
                &temporary_source,
                @TypeOf(&printer),
                &printer,
                .esm_ascii,
                true,
                SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
            );
        };
        const wrote = printer.ctx.getWritten();

        if (wrote.len > 0) {
            if (comptime Environment.dump_source)
                try dumpSource(temporary_source.path.text, &printer);

            var exception = [1]JSC.JSValue{JSC.JSValue.zero};
            const promise = JSC.JSModuleLoader.evaluate(
                jsc_vm.global,
                wrote.ptr,
                wrote.len,
                temporary_source.path.text.ptr,
                temporary_source.path.text.len,
                parse_result.source.path.text.ptr,
                parse_result.source.path.text.len,
                JSC.JSValue.jsUndefined(),
                &exception,
            );
            if (!exception[0].isEmpty()) {
                ret.* = JSC.ErrorableResolvedSource.err(
                    error.JSErrorObject,
                    exception[0].asVoid(),
                );
                return error.PluginError;
            }

            if (!promise.isEmptyOrUndefinedOrNull()) {
                if (promise.asAnyPromise()) |promise_value| {
                    jsc_vm.waitForPromise(promise_value);

                    if (promise_value.status(jsc_vm.global.vm()) == .Rejected) {
                        ret.* = JSC.ErrorableResolvedSource.err(
                            error.JSErrorObject,
                            promise_value.result(jsc_vm.global.vm()).asVoid(),
                        );
                        return error.PluginError;
                    }
                }
            }
        }
    }
    pub fn normalizeSpecifier(jsc_vm: *VirtualMachine, slice_: string, string_to_use_for_source: *[]const u8) string {
        var slice = slice_;
        if (slice.len == 0) return slice;
        var was_http = false;
        if (jsc_vm.bundler.options.serve) {
            if (strings.hasPrefixComptime(slice, "https://")) {
                slice = slice["https://".len..];
                was_http = true;
            } else if (strings.hasPrefixComptime(slice, "http://")) {
                slice = slice["http://".len..];
                was_http = true;
            }
        }

        if (strings.hasPrefix(slice, jsc_vm.origin.host)) {
            slice = slice[jsc_vm.origin.host.len..];
        } else if (was_http) {
            if (strings.indexOfChar(slice, '/')) |i| {
                slice = slice[i..];
            }
        }

        if (jsc_vm.origin.path.len > 1) {
            if (strings.hasPrefix(slice, jsc_vm.origin.path)) {
                slice = slice[jsc_vm.origin.path.len..];
            }
        }

        if (jsc_vm.bundler.options.routes.asset_prefix_path.len > 0) {
            if (strings.hasPrefix(slice, jsc_vm.bundler.options.routes.asset_prefix_path)) {
                slice = slice[jsc_vm.bundler.options.routes.asset_prefix_path.len..];
            }
        }

        string_to_use_for_source.* = slice;

        if (strings.indexOfChar(slice, '?')) |i| {
            slice = slice[0..i];
        }

        return slice;
    }

    pub export fn Bun__fetchBuiltinModule(
        jsc_vm: *VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        specifier: *bun.String,
        referrer: *bun.String,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        var log = logger.Log.init(jsc_vm.bundler.allocator);
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
            ret.* = ErrorableResolvedSource.ok(builtin);
            return true;
        } else {
            return false;
        }
    }

    pub export fn Bun__transpileFile(
        jsc_vm: *VirtualMachine,
        globalObject: *JSC.JSGlobalObject,
        specifier_ptr: *const bun.String,
        referrer: *const bun.String,
        ret: *ErrorableResolvedSource,
        allow_promise: bool,
    ) ?*anyopaque {
        JSC.markBinding(@src());
        var log = logger.Log.init(jsc_vm.bundler.allocator);
        defer log.deinit();
        debug("transpileFile: {any}", .{specifier_ptr.*});

        var _specifier = specifier_ptr.toUTF8(jsc_vm.allocator);
        var referrer_slice = referrer.toUTF8(jsc_vm.allocator);
        defer _specifier.deinit();
        defer referrer_slice.deinit();
        var display_specifier: []const u8 = "";
        var specifier = normalizeSpecifier(
            jsc_vm,
            _specifier.slice(),
            &display_specifier,
        );
        const path = Fs.Path.init(specifier);

        // Deliberately optional.
        // The concurrent one only handles javascript-like loaders right now.
        const loader: ?options.Loader = jsc_vm.bundler.options.loaders.get(path.name.ext);

        // We only run the transpiler concurrently when we can.
        // Today, that's:
        //
        //   Import Statements (import 'foo')
        //   Import Expressions (import('foo'))
        //
        if (comptime bun.FeatureFlags.concurrent_transpiler) {
            const concurrent_loader = loader orelse .file;
            if (allow_promise and (jsc_vm.has_loaded or jsc_vm.is_in_preload) and concurrent_loader.isJavaScriptLike() and
                // Plugins make this complicated,
                // TODO: allow running concurrently when no onLoad handlers match a plugin.
                jsc_vm.plugin_runner == null and jsc_vm.transpiler_store.enabled)
            {
                if (!strings.eqlLong(specifier, jsc_vm.main, true)) {
                    return jsc_vm.transpiler_store.transpile(
                        jsc_vm,
                        globalObject,
                        path,
                        referrer_slice.slice(),
                    );
                }
            }
        }

        const synchronous_loader = loader orelse
            // Unknown extensions are to be treated as file loader
            if (jsc_vm.has_loaded or jsc_vm.is_in_preload)
            options.Loader.file
        else
            // Unless it's potentially the main module
            // This is important so that "bun run ./foo-i-have-no-extension" works
            options.Loader.js;

        var promise: ?*JSC.JSInternalPromise = null;
        ret.* = ErrorableResolvedSource.ok(
            ModuleLoader.transpileSourceCode(
                jsc_vm,
                specifier,
                display_specifier,
                referrer_slice.slice(),
                specifier_ptr.*,
                path,
                synchronous_loader,
                &log,
                null,
                ret,
                if (allow_promise) &promise else null,
                VirtualMachine.source_code_printer.?,
                globalObject,
                FetchFlags.transpile,
            ) catch |err| {
                if (err == error.AsyncModule) {
                    std.debug.assert(promise != null);
                    return promise;
                }

                if (err == error.PluginError) {
                    return null;
                }
                VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer.*, &log, ret, err);
                return null;
            },
        );
        return promise;
    }

    export fn Bun__runVirtualModule(globalObject: *JSC.JSGlobalObject, specifier_ptr: *const bun.String) JSValue {
        JSC.markBinding(@src());
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

        return globalObject.runOnLoadPlugins(bun.String.init(namespace), bun.String.init(after_namespace), .bun) orelse return JSValue.zero;
    }

    pub fn fetchBuiltinModule(jsc_vm: *VirtualMachine, specifier: bun.String) !?ResolvedSource {
        if (jsc_vm.node_modules != null and specifier.eqlComptime(JSC.bun_file_import_path)) {
            // We kind of need an abstraction around this.
            // Basically we should subclass JSC::SourceCode with:
            // - hash
            // - file descriptor for source input
            // - file path + file descriptor for bytecode caching
            // - separate bundles for server build vs browser build OR at least separate sections
            const code = try jsc_vm.node_modules.?.readCodeAsStringSlow(jsc_vm.allocator);

            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.init(code),
                .specifier = bun.String.init(JSC.bun_file_import_path),
                .source_url = ZigString.init(JSC.bun_file_import_path[1..]),
                .hash = 0, // TODO
            };
        } else if (jsc_vm.node_modules == null and specifier.eqlComptime(Runtime.Runtime.Imports.Name)) {
            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.init(Runtime.Runtime.sourceContentBun()),
                .specifier = bun.String.init(Runtime.Runtime.Imports.Name),
                .source_url = ZigString.init(Runtime.Runtime.Imports.Name),
                .hash = Runtime.Runtime.versionHash(),
            };
        } else if (HardcodedModule.Map.getWithEql(specifier, bun.String.eqlComptime)) |hardcoded| {
            switch (hardcoded) {
                .@"bun:main" => {
                    defer {
                        if (jsc_vm.worker) |worker| {
                            worker.queueInitialTask();
                        }
                    }

                    return ResolvedSource{
                        .allocator = null,
                        .source_code = bun.String.create(jsc_vm.entry_point.source.contents),
                        .specifier = specifier,
                        .source_url = ZigString.init(bun.asByteSlice(JSC.VirtualMachine.main_file_name)),
                        .hash = 0,
                        .tag = .esm,
                    };
                },

                // Native modules
                .@"node:buffer" => return jsSyntheticModule(.@"node:buffer", specifier),
                .@"node:string_decoder" => return jsSyntheticModule(.@"node:string_decoder", specifier),
                .@"node:module" => return jsSyntheticModule(.@"node:module", specifier),
                .@"node:process" => return jsSyntheticModule(.@"node:process", specifier),
                .@"node:tty" => return jsSyntheticModule(.@"node:tty", specifier),
                .@"node:util/types" => return jsSyntheticModule(.@"node:util/types", specifier),
                .@"node:constants" => return jsSyntheticModule(.@"node:constants", specifier),
                .@"bun:jsc" => return jsSyntheticModule(.@"bun:jsc", specifier),

                // TODO:
                // .@"node:fs/promises" => {
                //     return ResolvedSource{
                //         .allocator = null,
                //         .source_code = bun.String.static(comptime "(()=>{\"use strict\";" ++ JSC.Node.fs.constants_string ++ @embedFile("../js/out/modules/node/fs.promises.js")[19..]),
                //         .specifier = specifier,
                //         .source_url = ZigString.init("node:fs/promises"),
                //         .hash = 0,
                //     };
                // },
                // .@"bun:ffi" => {
                //     const shared_library_suffix = if (Environment.isMac) "dylib" else if (Environment.isLinux) "so" else if (Environment.isWindows) "dll" else "";
                //     return ResolvedSource{
                //         .allocator = null,
                //         .source_code = bun.String.static(
                //             comptime ("(()=>{\"use strict\";var FFIType=" ++
                //                 JSC.FFI.ABIType.map_to_js_object ++
                //                 ",suffix='" ++ shared_library_suffix ++ "';" ++
                //                 @embedFile("../js/out/modules/bun/ffi.js")[19..]),
                //         ),
                //         .specifier = specifier,
                //         .source_url = ZigString.init("bun:ffi"),
                //         .hash = 0,
                //     };
                // },

                // These are defined in src/js/*
                .@"bun:ffi" => return jsSyntheticModule(.@"bun:ffi", specifier),
                .@"bun:sqlite" => return jsSyntheticModule(.@"bun:sqlite", specifier),
                .@"node:assert" => return jsSyntheticModule(.@"node:assert", specifier),
                .@"node:assert/strict" => return jsSyntheticModule(.@"node:assert/strict", specifier),
                .@"node:async_hooks" => return jsSyntheticModule(.@"node:async_hooks", specifier),
                .@"node:child_process" => return jsSyntheticModule(.@"node:child_process", specifier),
                .@"node:cluster" => return jsSyntheticModule(.@"node:cluster", specifier),
                .@"node:crypto" => return jsSyntheticModule(.@"node:crypto", specifier),
                .@"node:dgram" => return jsSyntheticModule(.@"node:dgram", specifier),
                .@"node:diagnostics_channel" => return jsSyntheticModule(.@"node:diagnostics_channel", specifier),
                .@"node:dns" => return jsSyntheticModule(.@"node:dns", specifier),
                .@"node:dns/promises" => return jsSyntheticModule(.@"node:dns/promises", specifier),
                .@"node:events" => return jsSyntheticModule(.@"node:events", specifier),
                .@"node:fs" => return jsSyntheticModule(.@"node:fs", specifier),
                .@"node:http" => return jsSyntheticModule(.@"node:http", specifier),
                .@"node:http2" => return jsSyntheticModule(.@"node:http2", specifier),
                .@"node:https" => return jsSyntheticModule(.@"node:https", specifier),
                .@"node:inspector" => return jsSyntheticModule(.@"node:inspector", specifier),
                .@"node:net" => return jsSyntheticModule(.@"node:net", specifier),
                .@"node:os" => return jsSyntheticModule(.@"node:os", specifier),
                .@"node:path" => return jsSyntheticModule(.@"node:path", specifier),
                .@"node:path/posix" => return jsSyntheticModule(.@"node:path/posix", specifier),
                .@"node:fs/promises" => return jsSyntheticModule(.@"node:fs/promises", specifier),
                .@"node:path/win32" => return jsSyntheticModule(.@"node:path/win32", specifier),
                .@"node:perf_hooks" => return jsSyntheticModule(.@"node:perf_hooks", specifier),
                .@"node:readline" => return jsSyntheticModule(.@"node:readline", specifier),
                .@"node:readline/promises" => return jsSyntheticModule(.@"node:readline/promises", specifier),
                .@"node:repl" => return jsSyntheticModule(.@"node:repl", specifier),
                .@"node:stream" => return jsSyntheticModule(.@"node:stream", specifier),
                .@"node:stream/consumers" => return jsSyntheticModule(.@"node:stream/consumers", specifier),
                .@"node:stream/promises" => return jsSyntheticModule(.@"node:stream/promises", specifier),
                .@"node:stream/web" => return jsSyntheticModule(.@"node:stream/web", specifier),
                .@"node:timers" => return jsSyntheticModule(.@"node:timers", specifier),
                .@"node:timers/promises" => return jsSyntheticModule(.@"node:timers/promises", specifier),
                .@"node:tls" => return jsSyntheticModule(.@"node:tls", specifier),
                .@"node:trace_events" => return jsSyntheticModule(.@"node:trace_events", specifier),
                .@"node:url" => return jsSyntheticModule(.@"node:url", specifier),
                .@"node:util" => return jsSyntheticModule(.@"node:util", specifier),
                .@"node:v8" => return jsSyntheticModule(.@"node:v8", specifier),
                .@"node:vm" => return jsSyntheticModule(.@"node:vm", specifier),
                .@"node:wasi" => return jsSyntheticModule(.@"node:wasi", specifier),
                .@"node:zlib" => return jsSyntheticModule(.@"node:zlib", specifier),
                .@"detect-libc" => return jsSyntheticModule(if (Environment.isLinux) .@"detect-libc/linux" else .@"detect-libc", specifier),
                .undici => return jsSyntheticModule(.undici, specifier),
                .ws => return jsSyntheticModule(.ws, specifier),
            }
        } else if (specifier.hasPrefixComptime(js_ast.Macro.namespaceWithColon)) {
            const spec = specifier.toUTF8(bun.default_allocator);
            defer spec.deinit();
            if (jsc_vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(spec.slice()))) |entry| {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.create(entry.source.contents),
                    .specifier = specifier,
                    .source_url = specifier.toZigString(),
                    .hash = 0,
                };
            }
        } else if (DisabledModule.getWithEql(specifier, bun.String.eqlComptime) != null) {
            return ResolvedSource{
                .allocator = null,
                .source_code = bun.String.static(
                    \\$_BunCommonJSModule_$.module.exports=globalThis[Symbol.for("Bun.lazy")]("masqueradesAsUndefined")
                ),
                .specifier = specifier,
                .source_url = specifier.toZigString(),
                .hash = 0,
            };
        } else if (jsc_vm.standalone_module_graph) |graph| {
            const specifier_utf8 = specifier.toUTF8(bun.default_allocator);
            defer specifier_utf8.deinit();
            if (graph.files.get(specifier_utf8.slice())) |file| {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = bun.String.static(file.contents),
                    .specifier = specifier,
                    .source_url = specifier.toZigString(),
                    .hash = 0,
                };
            }
        }

        return null;
    }

    export fn Bun__transpileVirtualModule(
        globalObject: *JSC.JSGlobalObject,
        specifier_ptr: *const bun.String,
        referrer_ptr: *const bun.String,
        source_code: *ZigString,
        loader_: Api.Loader,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        const jsc_vm = globalObject.bunVM();
        std.debug.assert(jsc_vm.plugin_runner != null);

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
            options.Loader.fromString(@tagName(loader_)).?
        else
            jsc_vm.bundler.options.loaders.get(path.name.ext) orelse brk: {
                if (strings.eqlLong(specifier, jsc_vm.main, true)) {
                    break :brk options.Loader.js;
                }

                break :brk options.Loader.file;
            };

        defer log.deinit();
        ret.* = ErrorableResolvedSource.ok(
            ModuleLoader.transpileSourceCode(
                jsc_vm,
                specifier_slice.slice(),
                specifier_slice.slice(),
                referrer_slice.slice(),
                specifier_ptr.*,
                path,
                options.Loader.fromString(@tagName(loader)).?,
                &log,
                &virtual_source,
                ret,
                null,
                VirtualMachine.source_code_printer.?,
                globalObject,
                FetchFlags.transpile,
            ) catch |err| {
                if (err == error.PluginError) {
                    return true;
                }
                VirtualMachine.processFetchLog(globalObject, specifier_ptr.*, referrer_ptr.*, &log, ret, err);
                return true;
            },
        );
        return true;
    }

    comptime {
        _ = Bun__transpileVirtualModule;
        _ = Bun__runVirtualModule;
        _ = Bun__transpileFile;
        _ = Bun__fetchBuiltinModule;
        _ = Bun__getDefaultLoader;
    }
};

pub const FetchFlags = enum {
    transpile,
    print_source,
    print_source_and_clone,

    pub fn disableTranspiling(this: FetchFlags) bool {
        return this != .transpile;
    }
};

const SavedSourceMap = JSC.SavedSourceMap;

pub const HardcodedModule = enum {
    @"bun:ffi",
    @"bun:jsc",
    @"bun:main",
    @"bun:sqlite",
    @"detect-libc",
    @"node:assert",
    @"node:assert/strict",
    @"node:async_hooks",
    @"node:buffer",
    @"node:child_process",
    @"node:crypto",
    @"node:constants",
    @"node:dns",
    @"node:dns/promises",
    @"node:events",
    @"node:fs",
    @"node:fs/promises",
    @"node:http",
    @"node:https",
    @"node:module",
    @"node:net",
    @"node:os",
    @"node:path",
    @"node:path/posix",
    @"node:path/win32",
    @"node:perf_hooks",
    @"node:process",
    @"node:readline",
    @"node:readline/promises",
    @"node:stream",
    @"node:stream/consumers",
    @"node:stream/promises",
    @"node:stream/web",
    @"node:string_decoder",
    @"node:timers",
    @"node:timers/promises",
    @"node:tls",
    @"node:tty",
    @"node:url",
    @"node:util",
    @"node:util/types",
    @"node:vm",
    @"node:wasi",
    @"node:zlib",
    undici,
    ws,
    // These are all not implemented yet, but are stubbed
    @"node:v8",
    @"node:trace_events",
    @"node:repl",
    @"node:inspector",
    @"node:http2",
    @"node:diagnostics_channel",
    @"node:dgram",
    @"node:cluster",

    /// Already resolved modules go in here.
    /// This does not remap the module name, it is just a hash table.
    /// Do not put modules that have aliases in here
    /// Put those in Aliases
    pub const Map = bun.ComptimeStringMap(
        HardcodedModule,
        .{
            .{ "buffer", HardcodedModule.@"node:buffer" },
            .{ "bun:ffi", HardcodedModule.@"bun:ffi" },
            .{ "bun:jsc", HardcodedModule.@"bun:jsc" },
            .{ "bun:main", HardcodedModule.@"bun:main" },
            .{ "bun:sqlite", HardcodedModule.@"bun:sqlite" },
            .{ "detect-libc", HardcodedModule.@"detect-libc" },
            .{ "node:assert", HardcodedModule.@"node:assert" },
            .{ "node:assert/strict", HardcodedModule.@"node:assert/strict" },
            .{ "node:async_hooks", HardcodedModule.@"node:async_hooks" },
            .{ "node:buffer", HardcodedModule.@"node:buffer" },
            .{ "node:child_process", HardcodedModule.@"node:child_process" },
            .{ "node:cluster", HardcodedModule.@"node:cluster" },
            .{ "node:crypto", HardcodedModule.@"node:crypto" },
            .{ "node:constants", HardcodedModule.@"node:constants" },
            .{ "node:dgram", HardcodedModule.@"node:dgram" },
            .{ "node:diagnostics_channel", HardcodedModule.@"node:diagnostics_channel" },
            .{ "node:dns", HardcodedModule.@"node:dns" },
            .{ "node:dns/promises", HardcodedModule.@"node:dns/promises" },
            .{ "node:events", HardcodedModule.@"node:events" },
            .{ "node:fs", HardcodedModule.@"node:fs" },
            .{ "node:fs/promises", HardcodedModule.@"node:fs/promises" },
            .{ "node:http", HardcodedModule.@"node:http" },
            .{ "node:http2", HardcodedModule.@"node:http2" },
            .{ "node:https", HardcodedModule.@"node:https" },
            .{ "node:inspector", HardcodedModule.@"node:inspector" },
            .{ "node:module", HardcodedModule.@"node:module" },
            .{ "node:net", HardcodedModule.@"node:net" },
            .{ "node:os", HardcodedModule.@"node:os" },
            .{ "node:path", HardcodedModule.@"node:path" },
            .{ "node:path/posix", HardcodedModule.@"node:path/posix" },
            .{ "node:path/win32", HardcodedModule.@"node:path/win32" },
            .{ "node:perf_hooks", HardcodedModule.@"node:perf_hooks" },
            .{ "node:process", HardcodedModule.@"node:process" },
            .{ "node:readline", HardcodedModule.@"node:readline" },
            .{ "node:readline/promises", HardcodedModule.@"node:readline/promises" },
            .{ "node:repl", HardcodedModule.@"node:repl" },
            .{ "node:stream", HardcodedModule.@"node:stream" },
            .{ "node:stream/consumers", HardcodedModule.@"node:stream/consumers" },
            .{ "node:stream/promises", HardcodedModule.@"node:stream/promises" },
            .{ "node:stream/web", HardcodedModule.@"node:stream/web" },
            .{ "node:string_decoder", HardcodedModule.@"node:string_decoder" },
            .{ "node:timers", HardcodedModule.@"node:timers" },
            .{ "node:timers/promises", HardcodedModule.@"node:timers/promises" },
            .{ "node:tls", HardcodedModule.@"node:tls" },
            .{ "node:trace_events", HardcodedModule.@"node:trace_events" },
            .{ "node:tty", HardcodedModule.@"node:tty" },
            .{ "node:url", HardcodedModule.@"node:url" },
            .{ "node:util", HardcodedModule.@"node:util" },
            .{ "node:util/types", HardcodedModule.@"node:util/types" },
            .{ "node:v8", HardcodedModule.@"node:v8" },
            .{ "node:vm", HardcodedModule.@"node:vm" },
            .{ "node:wasi", HardcodedModule.@"node:wasi" },
            .{ "node:zlib", HardcodedModule.@"node:zlib" },
            .{ "undici", HardcodedModule.undici },
            .{ "ws", HardcodedModule.ws },
        },
    );
    pub const Alias = struct {
        path: string,
        tag: ImportRecord.Tag = ImportRecord.Tag.hardcoded,
    };
    pub const Aliases = bun.ComptimeStringMap(
        Alias,
        .{
            .{ "assert", .{ .path = "node:assert" } },
            .{ "assert/strict", .{ .path = "node:assert/strict" } },
            .{ "async_hooks", .{ .path = "node:async_hooks" } },
            .{ "buffer", .{ .path = "node:buffer" } },
            .{ "bun", .{ .path = "bun", .tag = .bun } },
            .{ "bun:ffi", .{ .path = "bun:ffi" } },
            .{ "bun:jsc", .{ .path = "bun:jsc" } },
            .{ "bun:sqlite", .{ .path = "bun:sqlite" } },
            .{ "bun:wrap", .{ .path = "bun:wrap" } },
            .{ "child_process", .{ .path = "node:child_process" } },
            .{ "constants", .{ .path = "node:constants" } },
            .{ "crypto", .{ .path = "node:crypto" } },
            .{ "detect-libc", .{ .path = "detect-libc" } },
            .{ "detect-libc/lib/detect-libc.js", .{ .path = "detect-libc" } },
            .{ "dns", .{ .path = "node:dns" } },
            .{ "dns/promises", .{ .path = "node:dns/promises" } },
            .{ "events", .{ .path = "node:events" } },
            .{ "ffi", .{ .path = "bun:ffi" } },
            .{ "fs", .{ .path = "node:fs" } },
            .{ "fs/promises", .{ .path = "node:fs/promises" } },
            .{ "http", .{ .path = "node:http" } },
            .{ "https", .{ .path = "node:https" } },
            .{ "module", .{ .path = "node:module" } },
            .{ "net", .{ .path = "node:net" } },
            .{ "node:assert", .{ .path = "node:assert" } },
            .{ "node:assert/strict", .{ .path = "node:assert/strict" } },
            .{ "node:async_hooks", .{ .path = "node:async_hooks" } },
            .{ "node:buffer", .{ .path = "node:buffer" } },
            .{ "node:child_process", .{ .path = "node:child_process" } },
            .{ "node:constants", .{ .path = "node:constants" } },
            .{ "node:crypto", .{ .path = "node:crypto" } },
            .{ "node:dns", .{ .path = "node:dns" } },
            .{ "node:dns/promises", .{ .path = "node:dns/promises" } },
            .{ "node:events", .{ .path = "node:events" } },
            .{ "node:fs", .{ .path = "node:fs" } },
            .{ "node:fs/promises", .{ .path = "node:fs/promises" } },
            .{ "node:http", .{ .path = "node:http" } },
            .{ "node:https", .{ .path = "node:https" } },
            .{ "node:module", .{ .path = "node:module" } },
            .{ "node:net", .{ .path = "node:net" } },
            .{ "node:os", .{ .path = "node:os" } },
            .{ "node:path", .{ .path = "node:path" } },
            .{ "node:path/posix", .{ .path = "node:path/posix" } },
            .{ "node:path/win32", .{ .path = "node:path/win32" } },
            .{ "node:perf_hooks", .{ .path = "node:perf_hooks" } },
            .{ "node:process", .{ .path = "node:process" } },
            .{ "node:readline", .{ .path = "node:readline" } },
            .{ "node:readline/promises", .{ .path = "node:readline/promises" } },
            .{ "node:stream", .{ .path = "node:stream" } },
            .{ "node:stream/consumers", .{ .path = "node:stream/consumers" } },
            .{ "node:stream/promises", .{ .path = "node:stream/promises" } },
            .{ "node:stream/web", .{ .path = "node:stream/web" } },
            .{ "node:string_decoder", .{ .path = "node:string_decoder" } },
            .{ "node:timers", .{ .path = "node:timers" } },
            .{ "node:timers/promises", .{ .path = "node:timers/promises" } },
            .{ "node:tls", .{ .path = "node:tls" } },
            .{ "node:tty", .{ .path = "node:tty" } },
            .{ "node:url", .{ .path = "node:url" } },
            .{ "node:util", .{ .path = "node:util" } },
            .{ "node:util/types", .{ .path = "node:util/types" } },
            .{ "node:wasi", .{ .path = "node:wasi" } },
            .{ "node:worker_threads", .{ .path = "node:worker_threads" } },
            .{ "node:zlib", .{ .path = "node:zlib" } },
            .{ "os", .{ .path = "node:os" } },
            .{ "path", .{ .path = "node:path" } },
            .{ "path/posix", .{ .path = "node:path/posix" } },
            .{ "path/win32", .{ .path = "node:path/win32" } },
            .{ "perf_hooks", .{ .path = "node:perf_hooks" } },
            .{ "process", .{ .path = "node:process" } },
            .{ "readline", .{ .path = "node:readline" } },
            .{ "readline/promises", .{ .path = "node:readline/promises" } },
            .{ "stream", .{ .path = "node:stream" } },
            .{ "stream/consumers", .{ .path = "node:stream/consumers" } },
            .{ "stream/promises", .{ .path = "node:stream/promises" } },
            .{ "stream/web", .{ .path = "node:stream/web" } },
            .{ "string_decoder", .{ .path = "node:string_decoder" } },
            .{ "timers", .{ .path = "node:timers" } },
            .{ "timers/promises", .{ .path = "node:timers/promises" } },
            .{ "tls", .{ .path = "node:tls" } },
            .{ "tty", .{ .path = "node:tty" } },
            .{ "undici", .{ .path = "undici" } },
            .{ "url", .{ .path = "node:url" } },
            .{ "util", .{ .path = "node:util" } },
            .{ "util/types", .{ .path = "node:util/types" } },
            .{ "wasi", .{ .path = "node:wasi" } },
            .{ "worker_threads", .{ .path = "node:worker_threads" } },
            .{ "ws", .{ .path = "ws" } },
            .{ "ws/lib/websocket", .{ .path = "ws" } },
            .{ "zlib", .{ .path = "node:zlib" } },
            // .{ "readable-stream", .{ .path = "node:stream" } },
            // .{ "readable-stream/consumer", .{ .path = "node:stream/consumers" } },
            // .{ "readable-stream/web", .{ .path = "node:stream/web" } },
            // Older versions of `readable-stream` is incompatible with latest
            // version of Node.js Stream API, which `bun` implements

            // These are returned in builtinModules, but probably not many packages use them
            // so we will just alias them.
            .{ "_http_agent", .{ .path = "node:http" } },
            .{ "_http_client", .{ .path = "node:http" } },
            .{ "_http_common", .{ .path = "node:http" } },
            .{ "_http_incoming", .{ .path = "node:http" } },
            .{ "_http_outgoing", .{ .path = "node:http" } },
            .{ "_http_server", .{ .path = "node:http" } },
            .{ "_stream_duplex", .{ .path = "node:stream" } },
            .{ "_stream_passthrough", .{ .path = "node:stream" } },
            .{ "_stream_readable", .{ .path = "node:stream" } },
            .{ "_stream_transform", .{ .path = "node:stream" } },
            .{ "_stream_writable", .{ .path = "node:stream" } },
            .{ "_stream_wrap", .{ .path = "node:stream" } },
            .{ "_tls_wrap", .{ .path = "node:tls" } },
            .{ "_tls_common", .{ .path = "node:tls" } },

            // These are not actually implemented, they are stubbed out
            .{ "cluster", .{ .path = "node:cluster" } },
            .{ "dgram", .{ .path = "node:dgram" } },
            .{ "diagnostics_channel", .{ .path = "node:diagnostics_channel" } },
            .{ "http2", .{ .path = "node:http2" } },
            .{ "inspector", .{ .path = "node:inspector" } },
            .{ "repl", .{ .path = "node:repl" } },
            .{ "trace_events", .{ .path = "node:trace_events" } },
            .{ "v8", .{ .path = "node:v8" } },
            .{ "vm", .{ .path = "node:vm" } },

            // It implements the same interface
            .{ "inspector/promises", .{ .path = "node:inspector" } },
            .{ "node:inspector/promises", .{ .path = "node:inspector" } },

            .{ "node:cluster", .{ .path = "node:cluster" } },
            .{ "node:dgram", .{ .path = "node:dgram" } },
            .{ "node:diagnostics_channel", .{ .path = "node:diagnostics_channel" } },
            .{ "node:http2", .{ .path = "node:http2" } },
            .{ "node:inspector", .{ .path = "node:inspector" } },
            .{ "node:repl", .{ .path = "node:repl" } },
            .{ "node:trace_events", .{ .path = "node:trace_events" } },
            .{ "node:v8", .{ .path = "node:v8" } },
            .{ "node:vm", .{ .path = "node:vm" } },
        },
    );
};

pub const DisabledModule = bun.ComptimeStringMap(
    void,
    .{
        // Stubbing out worker_threads will break esbuild.
        .{"worker_threads"},
        .{"node:worker_threads"},
    },
);
