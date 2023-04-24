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
// This exists to make it so we can reload these quicker in development
fn jsModuleFromFile(from_path: string, comptime input: string) string {
    const absolute_path = comptime (bun.Environment.base_path ++ std.fs.path.dirname(@src().file).?) ++ "/" ++ input;
    const Holder = struct {
        pub const file = @embedFile(input);
    };

    if (comptime !Environment.allow_assert) {
        if (from_path.len == 0) {
            return Holder.file;
        }
    }

    var file: std.fs.File = undefined;

    if (comptime Environment.allow_assert) {
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
        var parts = [_]string{ from_path, input };
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

    var contents = file.readToEndAlloc(bun.default_allocator, std.math.maxInt(usize)) catch @panic("Cannot read file: " ++ absolute_path);
    if (comptime !Environment.allow_assert) {
        file.close();
    }
    return contents;
}

inline fn jsSyntheticModule(comptime name: ResolvedSource.Tag) ResolvedSource {
    return ResolvedSource{
        .allocator = null,
        .source_code = ZigString.init(""),
        .specifier = ZigString.init(@tagName(name)),
        .source_url = ZigString.init(@tagName(name)),
        .hash = 0,
        .tag = name,
    };
}

fn dumpSource(specifier: string, printer: anytype) !void {
    const BunDebugHolder = struct {
        pub var dir: ?std.fs.IterableDir = null;
    };
    if (BunDebugHolder.dir == null) {
        BunDebugHolder.dir = try std.fs.cwd().makeOpenPathIterable("/tmp/bun-debug-src/", .{});
    }

    if (std.fs.path.dirname(specifier)) |dir_path| {
        var parent = try BunDebugHolder.dir.?.dir.makeOpenPathIterable(dir_path[1..], .{});
        defer parent.close();
        try parent.dir.writeFile(std.fs.path.basename(specifier), printer.ctx.getWritten());
    } else {
        try BunDebugHolder.dir.?.dir.writeFile(std.fs.path.basename(specifier), printer.ctx.getWritten());
    }
}

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
                var pm = this.vm().packageManager();

                this.runTasks();
                _ = pm.scheduleTasks();
                this.runTasks();

                this.pollModules();
                _ = pm.flushDependencyQueue();
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
                        ZigString.init(this.specifier),
                        ZigString.init(this.referrer),
                        &log,
                        &errorable,
                        err,
                    );
                    break :outer;
                });
            }

            var spec = ZigString.init(this.specifier).withEncoding();
            var ref = ZigString.init(this.referrer).withEncoding();
            Bun__onFulfillAsyncModule(
                this.promise.get().?,
                &errorable,
                &spec,
                &ref,
            );
            this.deinit();
            jsc_vm.allocator.destroy(this);
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

            const written = brk: {
                defer VirtualMachine.source_code_printer.?.* = printer;
                break :brk try jsc_vm.bundler.printWithSourceMap(
                    parse_result,
                    @TypeOf(&printer),
                    &printer,
                    .esm_ascii,
                    SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
                );
            };

            if (written == 0) {
                return error.PrintingErrorWriteFailed;
            }

            if (comptime Environment.dump_source) {
                try dumpSource(specifier, &printer);
            }

            var commonjs_exports = try bun.default_allocator.alloc(ZigString, parse_result.ast.commonjs_export_names.len);
            for (parse_result.ast.commonjs_export_names, commonjs_exports) |name, *out| {
                out.* = ZigString.fromUTF8(name);
            }

            if (jsc_vm.isWatcherEnabled()) {
                var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, specifier, path.text, null);

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
                    @truncate(u32, commonjs_exports.len)
                else if (parse_result.ast.exports_kind == .cjs)
                    std.math.maxInt(u32)
                else
                    0;

                return resolved_source;
            }

            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(try default_allocator.dupe(u8, printer.ctx.getWritten())),
                .specifier = ZigString.init(specifier),
                .source_url = ZigString.init(path.text),
                .commonjs_exports = if (commonjs_exports.len > 0)
                    commonjs_exports.ptr
                else
                    null,
                .commonjs_exports_len = if (commonjs_exports.len > 0)
                    @truncate(u32, commonjs_exports.len)
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
            this.parse_result.deinit();
            // bun.default_allocator.free(this.stmt_blocks);
            // bun.default_allocator.free(this.expr_blocks);
            this.promise.deinit();
            bun.default_allocator.free(this.string_buf);
        }

        extern "C" fn Bun__onFulfillAsyncModule(
            promiseValue: JSC.JSValue,
            res: *JSC.ErrorableResolvedSource,
            specifier: *ZigString,
            referrer: *ZigString,
        ) void;
    };

    pub export fn Bun__getDefaultLoader(global: *JSC.JSGlobalObject, str: *const ZigString) Api.Loader {
        var jsc_vm = global.bunVM();
        const filename = str.toSlice(jsc_vm.allocator);
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

                var allocator = if (jsc_vm.has_loaded) jsc_vm.arena.allocator() else jsc_vm.allocator;

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
                    .inject_jest_globals = jsc_vm.bundler.options.rewrite_jest_for_tests and
                        jsc_vm.main.len == path.text.len and
                        jsc_vm.main_hash == hash and
                        strings.eqlLong(jsc_vm.main, path.text, false),
                };
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
                    const wasm_result = transpileSourceCode(
                        jsc_vm,
                        specifier,
                        display_specifier,
                        referrer,
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
                    return wasm_result;
                }

                if (comptime !disable_transpilying) {
                    if (jsc_vm.isWatcherEnabled()) {
                        if (input_file_fd != 0) {
                            if (jsc_vm.bun_watcher != null and !is_node_override and std.fs.path.isAbsolute(path.text) and !strings.contains(path.text, "node_modules")) {
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
                            .print_source_and_clone => ZigString.init(jsc_vm.allocator.dupe(u8, parse_result.source.contents) catch unreachable),
                            .print_source => ZigString.init(parse_result.source.contents),
                            else => unreachable,
                        },
                        .specifier = ZigString.init(display_specifier),
                        .source_url = ZigString.init(path.text),
                        .hash = 0,
                    };
                }

                if (parse_result.already_bundled) {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(try default_allocator.dupe(u8, parse_result.source.contents)),
                        .specifier = ZigString.init(specifier),
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
                        },
                    );
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
                            .source_code = ZigString.init("// auto-generated plugin stub\nexport default undefined\n"),
                            .specifier = ZigString.init(specifier),
                            .source_url = ZigString.init(path.text),
                            // // TODO: change hash to a bitfield
                            // .hash = 1,

                            // having JSC own the memory causes crashes
                            .hash = 0,
                        };
                    }
                    return error.PrintingErrorWriteFailed;
                }

                if (comptime Environment.dump_source) {
                    try dumpSource(specifier, &printer);
                }

                var commonjs_exports = try bun.default_allocator.alloc(ZigString, parse_result.ast.commonjs_export_names.len);
                for (parse_result.ast.commonjs_export_names, commonjs_exports) |name, *out| {
                    out.* = ZigString.fromUTF8(name);
                }

                if (jsc_vm.isWatcherEnabled()) {
                    var resolved_source = jsc_vm.refCountedResolvedSource(printer.ctx.written, display_specifier, path.text, null);

                    resolved_source.commonjs_exports = if (commonjs_exports.len > 0)
                        commonjs_exports.ptr
                    else
                        null;
                    resolved_source.commonjs_exports_len = if (commonjs_exports.len > 0)
                        @truncate(u32, commonjs_exports.len)
                    else if (parse_result.ast.exports_kind == .cjs)
                        std.math.maxInt(u32)
                    else
                        0;
                    return resolved_source;
                }

                return .{
                    .allocator = null,
                    .source_code = ZigString.init(try default_allocator.dupe(u8, printer.ctx.getWritten())),
                    .specifier = ZigString.init(display_specifier),
                    .source_url = ZigString.init(path.text),
                    .commonjs_exports = if (commonjs_exports.len > 0)
                        commonjs_exports.ptr
                    else
                        null,
                    .commonjs_exports_len = if (commonjs_exports.len > 0)
                        @truncate(u32, commonjs_exports.len)
                    else if (parse_result.ast.exports_kind == .cjs)
                        std.math.maxInt(u32)
                    else
                        0,
                    // // TODO: change hash to a bitfield
                    // .hash = 1,

                    // having JSC own the memory causes crashes
                    .hash = 0,
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
                            const globalValue = @intToEnum(JSC.JSValue, encoded.asInt64);
                            globalValue.put(
                                globalThis,
                                JSC.ZigString.static("wasmSourceBytes"),
                                JSC.ArrayBuffer.create(globalThis, source.contents, .Uint8Array),
                            );
                        }
                    }
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            strings.append3(
                                bun.default_allocator,
                                JSC.Node.fs.constants_string,
                                @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./wasi.exports.js")),
                                jsModuleFromFile(jsc_vm.load_builtins_from_path, "wasi-runner.js"),
                            ) catch unreachable,
                        ),
                        .specifier = ZigString.init(display_specifier),
                        .source_url = ZigString.init(path.text),
                        .hash = 0,
                    };
                }

                return transpileSourceCode(
                    jsc_vm,
                    specifier,
                    display_specifier,
                    referrer,
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

                const public_url = ZigString.fromUTF8(jsc_vm.allocator.dupe(u8, buf.toOwnedSliceLeaky()) catch @panic("out of memory"));
                return ResolvedSource{
                    .allocator = &jsc_vm.allocator,
                    .source_code = public_url,
                    .specifier = ZigString.init(path.text),
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
        if (strings.hasPrefixComptime(slice, "https://")) {
            slice = slice["https://".len..];
            was_http = true;
        } else if (strings.hasPrefixComptime(slice, "http://")) {
            slice = slice["http://".len..];
            was_http = true;
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
        specifier: *ZigString,
        referrer: *ZigString,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        var log = logger.Log.init(jsc_vm.bundler.allocator);
        defer log.deinit();
        if (ModuleLoader.fetchBuiltinModule(jsc_vm, specifier.slice(), &log, false) catch |err| {
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
        specifier_ptr: *const ZigString,
        referrer: *const ZigString,
        ret: *ErrorableResolvedSource,
        allow_promise: bool,
    ) ?*anyopaque {
        JSC.markBinding(@src());
        var log = logger.Log.init(jsc_vm.bundler.allocator);
        defer log.deinit();
        debug("transpileFile: {any}", .{specifier_ptr.*});

        var _specifier = specifier_ptr.toSlice(jsc_vm.allocator);
        var referrer_slice = referrer.toSlice(jsc_vm.allocator);
        defer _specifier.deinit();
        defer referrer_slice.deinit();
        var display_specifier: []const u8 = "";
        var specifier = normalizeSpecifier(
            jsc_vm,
            _specifier.slice(),
            &display_specifier,
        );
        const path = Fs.Path.init(specifier);
        const loader = jsc_vm.bundler.options.loaders.get(path.name.ext) orelse options.Loader.js;
        var promise: ?*JSC.JSInternalPromise = null;
        ret.* = ErrorableResolvedSource.ok(
            ModuleLoader.transpileSourceCode(
                jsc_vm,
                specifier,
                display_specifier,
                referrer_slice.slice(),
                path,
                loader,
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

    export fn Bun__runVirtualModule(globalObject: *JSC.JSGlobalObject, specifier_ptr: *const ZigString) JSValue {
        JSC.markBinding(@src());
        if (globalObject.bunVM().plugin_runner == null) return JSValue.zero;

        const specifier = specifier_ptr.slice();

        if (!PluginRunner.couldBePlugin(specifier)) {
            return JSValue.zero;
        }

        const namespace = PluginRunner.extractNamespace(specifier);
        const after_namespace = if (namespace.len == 0)
            specifier
        else
            specifier[@min(namespace.len + 1, specifier.len)..];

        return globalObject.runOnLoadPlugins(ZigString.init(namespace), ZigString.init(after_namespace), .bun) orelse return JSValue.zero;
    }

    const shared_library_suffix = if (Environment.isMac) "dylib" else if (Environment.isLinux) "so" else "";

    pub fn fetchBuiltinModule(jsc_vm: *VirtualMachine, specifier: string, log: *logger.Log, comptime disable_transpilying: bool) !?ResolvedSource {
        if (jsc_vm.node_modules != null and strings.eqlComptime(specifier, JSC.bun_file_import_path)) {
            // We kind of need an abstraction around this.
            // Basically we should subclass JSC::SourceCode with:
            // - hash
            // - file descriptor for source input
            // - file path + file descriptor for bytecode caching
            // - separate bundles for server build vs browser build OR at least separate sections
            const code = try jsc_vm.node_modules.?.readCodeAsStringSlow(jsc_vm.allocator);

            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(code),
                .specifier = ZigString.init(JSC.bun_file_import_path),
                .source_url = ZigString.init(JSC.bun_file_import_path[1..]),
                .hash = 0, // TODO
            };
        } else if (jsc_vm.node_modules == null and strings.eqlComptime(specifier, Runtime.Runtime.Imports.Name)) {
            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(Runtime.Runtime.sourceContentBun()),
                .specifier = ZigString.init(Runtime.Runtime.Imports.Name),
                .source_url = ZigString.init(Runtime.Runtime.Imports.Name),
                .hash = Runtime.Runtime.versionHash(),
            };
        } else if (HardcodedModule.Map.get(specifier)) |hardcoded| {
            switch (hardcoded) {
                // This is all complicated because the imports have to be linked and we want to run the printer on it
                // so it consistently handles bundled imports
                // we can't take the shortcut of just directly importing the file, sadly.
                .@"bun:main" => {
                    if (comptime disable_transpilying) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = ZigString.init(jsc_vm.entry_point.source.contents),
                            .specifier = ZigString.init(bun.asByteSlice(JSC.VirtualMachine.main_file_name)),
                            .source_url = ZigString.init(bun.asByteSlice(JSC.VirtualMachine.main_file_name)),
                            .hash = 0,
                        };
                    }
                    defer jsc_vm.transpiled_count += 1;

                    var bundler = &jsc_vm.bundler;
                    var old = jsc_vm.bundler.log;
                    jsc_vm.bundler.log = log;
                    jsc_vm.bundler.linker.log = log;
                    jsc_vm.bundler.resolver.log = log;
                    defer {
                        jsc_vm.bundler.log = old;
                        jsc_vm.bundler.linker.log = old;
                        jsc_vm.bundler.resolver.log = old;
                    }

                    var jsx = bundler.options.jsx;
                    jsx.parse = false;
                    var opts = js_parser.Parser.Options.init(jsx, .js);
                    opts.enable_legacy_bundling = false;
                    opts.legacy_transform_require_to_import = false;
                    opts.features.dynamic_require = true;
                    opts.can_import_from_bundle = bundler.options.node_modules_bundle != null;
                    opts.features.hot_module_reloading = false;
                    opts.features.top_level_await = true;
                    opts.features.react_fast_refresh = false;
                    opts.features.minify_identifiers = bundler.options.minify_identifiers;
                    opts.features.minify_syntax = bundler.options.minify_syntax;
                    opts.filepath_hash_for_hmr = 0;
                    opts.warn_about_unbundled_modules = false;
                    opts.macro_context = &jsc_vm.bundler.macro_context.?;
                    const main_ast = ((bundler.resolver.caches.js.parse(jsc_vm.allocator, opts, bundler.options.define, bundler.log, &jsc_vm.entry_point.source) catch null) orelse {
                        return error.ParseError;
                    }).ast;
                    var parse_result = ParseResult{ .source = jsc_vm.entry_point.source, .ast = main_ast, .loader = .js, .input_fd = null };
                    var file_path = Fs.Path.init(bundler.fs.top_level_dir);
                    file_path.name.dir = bundler.fs.top_level_dir;
                    file_path.name.base = "bun:main";
                    try bundler.linker.link(
                        file_path,
                        &parse_result,
                        jsc_vm.origin,
                        .absolute_path,
                        false,
                        true,
                    );
                    var printer = JSC.VirtualMachine.source_code_printer.?.*;
                    var written: usize = undefined;
                    printer.ctx.reset();
                    {
                        defer JSC.VirtualMachine.source_code_printer.?.* = printer;
                        written = try jsc_vm.bundler.printWithSourceMap(
                            parse_result,
                            @TypeOf(&printer),
                            &printer,
                            .esm_ascii,
                            SavedSourceMap.SourceMapHandler.init(&jsc_vm.source_mappings),
                        );
                    }

                    if (comptime Environment.dump_source)
                        try dumpSource(JSC.VirtualMachine.main_file_name, &printer);

                    if (written == 0) {
                        return error.PrintingErrorWriteFailed;
                    }

                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsc_vm.allocator.dupe(u8, printer.ctx.written) catch unreachable),
                        .specifier = ZigString.init(bun.asByteSlice(JSC.VirtualMachine.main_file_name)),
                        .source_url = ZigString.init(bun.asByteSlice(JSC.VirtualMachine.main_file_name)),
                        .hash = 0,
                    };
                },
                .@"bun:jsc" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "bun-jsc.exports.js")),
                        .specifier = ZigString.init("bun:jsc"),
                        .source_url = ZigString.init("bun:jsc"),
                        .hash = 0,
                    };
                },
                .@"node:child_process" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "child_process.exports.js")),
                        .specifier = ZigString.init("node:child_process"),
                        .source_url = ZigString.init("node:child_process"),
                        .hash = 0,
                    };
                },
                .@"node:net" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "net.exports.js")),
                        .specifier = ZigString.init("node:net"),
                        .source_url = ZigString.init("node:net"),
                        .hash = 0,
                    };
                },
                .@"node:fs" => {
                    if (comptime Environment.isDebug) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "fs.exports.js")),
                            .specifier = ZigString.init("node:fs"),
                            .source_url = ZigString.init("node:fs"),
                            .hash = 0,
                        };
                    } else if (jsc_vm.load_builtins_from_path.len != 0) {
                        return ResolvedSource{
                            .allocator = null,
                            .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "fs.exports.js")),
                            .specifier = ZigString.init("node:fs"),
                            .source_url = ZigString.init("node:fs"),
                            .hash = 0,
                        };
                    }

                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(@embedFile("fs.exports.js")),
                        .specifier = ZigString.init("node:fs"),
                        .source_url = ZigString.init("node:fs"),
                        .hash = 0,
                    };
                },
                .@"node:buffer" => return jsSyntheticModule(.@"node:buffer"),
                .@"node:string_decoder" => return jsSyntheticModule(.@"node:string_decoder"),
                .@"node:module" => return jsSyntheticModule(.@"node:module"),
                .@"node:events" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "events.exports.js")),
                        .specifier = ZigString.init("node:events"),
                        .source_url = ZigString.init("node:events"),
                        .hash = 0,
                    };
                },
                .@"node:process" => return jsSyntheticModule(.@"node:process"),
                .@"node:tty" => return jsSyntheticModule(.@"node:tty"),
                .@"node:util/types" => return jsSyntheticModule(.@"node:util/types"),
                .@"node:stream" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "streams.exports.js")),
                        .specifier = ZigString.init("node:stream"),
                        .source_url = ZigString.init("node:stream"),
                        .hash = 0,
                    };
                },
                .@"node:zlib" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "zlib.exports.js")),
                        .specifier = ZigString.init("node:zlib"),
                        .source_url = ZigString.init("node:zlib"),
                        .hash = 0,
                    };
                },
                .@"node:async_hooks" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "async_hooks.exports.js")),
                        .specifier = ZigString.init("node:async_hooks"),
                        .source_url = ZigString.init("node:async_hooks"),
                        .hash = 0,
                    };
                },

                .@"node:fs/promises" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(JSC.Node.fs.constants_string ++ @embedFile("fs_promises.exports.js")),
                        .specifier = ZigString.init("node:fs/promises"),
                        .source_url = ZigString.init("node:fs/promises"),
                        .hash = 0,
                    };
                },
                .@"node:path" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "path.exports.js")),
                        .specifier = ZigString.init("node:path"),
                        .source_url = ZigString.init("node:path"),
                        .hash = 0,
                    };
                },
                .@"node:dns" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "node-dns.exports.js")),
                        .specifier = ZigString.init("node:dns"),
                        .source_url = ZigString.init("node:dns"),
                        .hash = 0,
                    };
                },
                .@"node:tls" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "node-tls.exports.js")),
                        .specifier = ZigString.init("node:tls"),
                        .source_url = ZigString.init("node:tls"),
                        .hash = 0,
                    };
                },
                .@"node:dns/promises" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "node-dns_promises.exports.js")),
                        .specifier = ZigString.init("node:dns/promises"),
                        .source_url = ZigString.init("node:dns/promises"),
                        .hash = 0,
                    };
                },
                .@"node:path/win32" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "path-win32.exports.js")),
                        .specifier = ZigString.init("node:path/win32"),
                        .source_url = ZigString.init("node:path/win32"),
                        .hash = 0,
                    };
                },
                .@"node:path/posix" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "path-posix.exports.js")),
                        .specifier = ZigString.init("node:path/posix"),
                        .source_url = ZigString.init("node:path/posix"),
                        .hash = 0,
                    };
                },

                .@"node:os" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "os.exports.js")),
                        .specifier = ZigString.init("node:os"),
                        .source_url = ZigString.init("node:os"),
                        .hash = 0,
                    };
                },
                .@"node:crypto" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "crypto.exports.js")),
                        .specifier = ZigString.init("node:crypto"),
                        .source_url = ZigString.init("node:crypto"),
                        .hash = 0,
                    };
                },
                .@"node:readline" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "readline.exports.js")),
                        .specifier = ZigString.init("node:readline"),
                        .source_url = ZigString.init("node:readline"),
                        .hash = 0,
                    };
                },
                .@"node:readline/promises" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(jsModuleFromFile(jsc_vm.load_builtins_from_path, "readline_promises.exports.js")),
                        .specifier = ZigString.init("node:readline/promises"),
                        .source_url = ZigString.init("node:readline/promises"),
                        .hash = 0,
                    };
                },
                .@"bun:ffi" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            "export const FFIType = " ++
                                JSC.FFI.ABIType.map_to_js_object ++
                                ";\n\n" ++
                                "export const suffix = '" ++ shared_library_suffix ++ "';\n\n" ++
                                @embedFile("ffi.exports.js") ++
                                "\n",
                        ),
                        .specifier = ZigString.init("bun:ffi"),
                        .source_url = ZigString.init("bun:ffi"),
                        .hash = 0,
                    };
                },
                .@"detect-libc" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, @embedFile(if (Environment.isLinux) "detect-libc.linux.js" else "detect-libc.js")),
                        ),
                        .specifier = ZigString.init("detect-libc"),
                        .source_url = ZigString.init("detect-libc"),
                        .hash = 0,
                    };
                },
                .@"node:url" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "url.exports.js")),
                        ),
                        .specifier = ZigString.init("node:url"),
                        .source_url = ZigString.init("node:url"),
                        .hash = 0,
                    };
                },
                .@"node:assert" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "assert.exports.js")),
                        ),
                        .specifier = ZigString.init("node:assert"),
                        .source_url = ZigString.init("node:assert"),
                        .hash = 0,
                    };
                },
                .@"bun:sqlite" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./bindings/sqlite/sqlite.exports.js")),
                        ),
                        .specifier = ZigString.init("bun:sqlite"),
                        .source_url = ZigString.init("bun:sqlite"),
                        .hash = 0,
                    };
                },
                .@"node:perf_hooks" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./perf_hooks.exports.js")),
                        ),
                        .specifier = ZigString.init("node:perf_hooks"),
                        .source_url = ZigString.init("node:perf_hooks"),
                        .hash = 0,
                    };
                },
                .ws => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./ws.exports.js")),
                        ),
                        .specifier = ZigString.init("ws"),
                        .source_url = ZigString.init("ws"),
                        .hash = 0,
                    };
                },
                .@"node:timers" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_timers.exports.js")),
                        ),
                        .specifier = ZigString.init("node:timers"),
                        .source_url = ZigString.init("node:timers"),
                        .hash = 0,
                    };
                },
                .@"node:timers/promises" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_timers_promises.exports.js")),
                        ),
                        .specifier = ZigString.init("node:timers/promises"),
                        .source_url = ZigString.init("node:timers/promises"),
                        .hash = 0,
                    };
                },
                .@"node:stream/web" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_streams_web.exports.js")),
                        ),
                        .specifier = ZigString.init("node:stream/web"),
                        .source_url = ZigString.init("node:stream/web"),
                        .hash = 0,
                    };
                },
                .@"node:stream/consumers" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./node_streams_consumer.exports.js")),
                        ),
                        .specifier = ZigString.init("node:stream/consumers"),
                        .source_url = ZigString.init("node:stream/consumers"),
                        .hash = 0,
                    };
                },
                .@"node:util" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./util.exports.js")),
                        ),
                        .specifier = ZigString.init("node:util"),
                        .source_url = ZigString.init("node:util"),
                        .hash = 0,
                    };
                },
                .undici => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./undici.exports.js")),
                        ),
                        .specifier = ZigString.init("undici"),
                        .source_url = ZigString.init("undici"),
                        .hash = 0,
                    };
                },
                .@"node:wasi" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            strings.append(
                                bun.default_allocator,
                                JSC.Node.fs.constants_string,
                                @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./wasi.exports.js")),
                            ) catch unreachable,
                        ),
                        .specifier = ZigString.init("node:wasi"),
                        .source_url = ZigString.init("node:wasi"),
                        .hash = 0,
                    };
                },
                .@"node:http" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./http.exports.js")),
                        ),
                        .specifier = ZigString.init("node:http"),
                        .source_url = ZigString.init("node:http"),
                        .hash = 0,
                    };
                },
                .@"node:https" => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./https.exports.js")),
                        ),
                        .specifier = ZigString.init("node:https"),
                        .source_url = ZigString.init("node:https"),
                        .hash = 0,
                    };
                },
                .depd => {
                    return ResolvedSource{
                        .allocator = null,
                        .source_code = ZigString.init(
                            @as(string, jsModuleFromFile(jsc_vm.load_builtins_from_path, "./depd.exports.js")),
                        ),
                        .specifier = ZigString.init("depd"),
                        .source_url = ZigString.init("depd"),
                        .hash = 0,
                    };
                },
                .@"node:stream/promises" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:stream/promises", "node_streams_promises.exports.js"),
                .@"node:vm" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:vm", "vm.exports.js"),
                .@"node:assert/strict" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:assert/strict", "assert_strict.exports.js"),
                .@"node:v8" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:v8", "v8.exports.js"),
                .@"node:trace_events" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:trace_events", "trace_events.exports.js"),
                .@"node:repl" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:repl", "repl.exports.js"),
                .@"node:inspector" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:inspector", "inspector.exports.js"),
                .@"node:http2" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:http2", "http2.exports.js"),
                .@"node:diagnostics_channel" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:diagnostics_channel", "diagnostics_channel.exports.js"),
                .@"node:dgram" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:dgram", "dgram.exports.js"),
                .@"node:cluster" => return jsResolvedSource(jsc_vm.load_builtins_from_path, .@"node:cluster", "cluster.exports.js"),
            }
        } else if (strings.hasPrefixComptime(specifier, js_ast.Macro.namespaceWithColon)) {
            if (jsc_vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(specifier))) |entry| {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = ZigString.init(entry.source.contents),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(specifier),
                    .hash = 0,
                };
            }
        } else if (DisabledModule.has(specifier)) {
            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(
                    \\const symbol = Symbol.for("CommonJS");
                    \\const lazy = globalThis[Symbol.for("Bun.lazy")];
                    \\var masqueradesAsUndefined = lazy("masqueradesAsUndefined");
                    \\masqueradesAsUndefined[symbol] = 0;
                    \\export default masqueradesAsUndefined;
                    \\
                ),
                .specifier = ZigString.init(specifier),
                .source_url = ZigString.init(specifier),
                .hash = 0,
            };
        } else if (jsc_vm.standalone_module_graph) |graph| {
            if (graph.files.get(specifier)) |file| {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = ZigString.init(file.contents),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(specifier),
                    .hash = 0,
                };
            }
        }

        return null;
    }

    export fn Bun__transpileVirtualModule(
        globalObject: *JSC.JSGlobalObject,
        specifier_ptr: *const ZigString,
        referrer_ptr: *const ZigString,
        source_code: *ZigString,
        loader_: Api.Loader,
        ret: *ErrorableResolvedSource,
    ) bool {
        JSC.markBinding(@src());
        const jsc_vm = globalObject.bunVM();
        std.debug.assert(jsc_vm.plugin_runner != null);

        var specifier_slice = specifier_ptr.toSlice(jsc_vm.allocator);
        const specifier = specifier_slice.slice();
        defer specifier_slice.deinit();
        var source_code_slice = source_code.toSlice(jsc_vm.allocator);
        defer source_code_slice.deinit();
        var referrer_slice = referrer_ptr.toSlice(jsc_vm.allocator);
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
                specifier,
                specifier,
                referrer_slice.slice(),
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
    depd,
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
            .{ "depd", HardcodedModule.depd },
            .{ "detect-libc", HardcodedModule.@"detect-libc" },
            .{ "node:assert", HardcodedModule.@"node:assert" },
            .{ "node:assert/strict", HardcodedModule.@"node:assert/strict" },
            .{ "node:async_hooks", HardcodedModule.@"node:async_hooks" },
            .{ "node:buffer", HardcodedModule.@"node:buffer" },
            .{ "node:child_process", HardcodedModule.@"node:child_process" },
            .{ "node:cluster", HardcodedModule.@"node:cluster" },
            .{ "node:crypto", HardcodedModule.@"node:crypto" },
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
            .{ "crypto", .{ .path = "node:crypto" } },
            .{ "depd", .{ .path = "depd" } },
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
            .{ "readable-stream", .{ .path = "node:stream" } },
            .{ "readable-stream/consumer", .{ .path = "node:stream/consumers" } },
            .{ "readable-stream/web", .{ .path = "node:stream/web" } },
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

fn jsResolvedSource(builtins: []const u8, comptime module: HardcodedModule, comptime input: []const u8) ResolvedSource {
    return ResolvedSource{
        .allocator = null,
        .source_code = ZigString.init(jsModuleFromFile(builtins, input)),
        .specifier = ZigString.init(@tagName(module)),
        .source_url = ZigString.init(@tagName(module)),
        .hash = 0,
    };
}
