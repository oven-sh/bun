const bun = @import("root").bun;
const JSC = bun.JSC;
const Output = bun.Output;
const log = Output.scoped(.Worker, true);
const std = @import("std");
const JSValue = JSC.JSValue;
const Async = bun.Async;
const WTFStringImpl = @import("../string.zig").WTFStringImpl;

const Bool = std.atomic.Value(bool);

/// Shared implementation of Web and Node `Worker`
pub const WebWorker = struct {
    /// null when haven't started yet
    vm: ?*JSC.VirtualMachine = null,
    status: std.atomic.Value(Status) = std.atomic.Value(Status).init(.start),
    /// To prevent UAF, the `spin` function (aka the worker's event loop) will call deinit once this is set and properly exit the loop.
    requested_terminate: Bool = Bool.init(false),
    execution_context_id: u32 = 0,
    parent_context_id: u32 = 0,
    parent: *JSC.VirtualMachine,

    /// Already resolved.
    specifier: []const u8 = "",
    store_fd: bool = false,
    arena: ?bun.MimallocArena = null,
    name: [:0]const u8 = "Worker",
    cpp_worker: *anyopaque,
    mini: bool = false,

    /// `user_keep_alive` is the state of the user's .ref()/.unref() calls
    /// if false, then the parent poll will always be unref, otherwise the worker's event loop will keep the poll alive.
    user_keep_alive: bool = false,
    worker_event_loop_running: bool = true,
    parent_poll_ref: Async.KeepAlive = .{},

    argv: ?[]const WTFStringImpl,
    execArgv: ?[]const WTFStringImpl,

    pub const Status = enum(u8) {
        start,
        starting,
        running,
        terminated,
    };

    extern fn WebWorker__dispatchExit(?*JSC.JSGlobalObject, *anyopaque, i32) void;
    extern fn WebWorker__dispatchOnline(this: *anyopaque, *JSC.JSGlobalObject) void;
    extern fn WebWorker__dispatchError(*JSC.JSGlobalObject, *anyopaque, bun.String, JSValue) void;

    export fn WebWorker__getParentWorker(vm: *JSC.VirtualMachine) ?*anyopaque {
        const worker = vm.worker orelse return null;
        return worker.cpp_worker;
    }

    pub fn hasRequestedTerminate(this: *const WebWorker) bool {
        return this.requested_terminate.load(.monotonic);
    }

    pub fn setRequestedTerminate(this: *WebWorker) bool {
        return this.requested_terminate.swap(true, .release);
    }

    export fn WebWorker__updatePtr(worker: *WebWorker, ptr: *anyopaque) bool {
        worker.cpp_worker = ptr;

        var thread = std.Thread.spawn(
            .{ .stack_size = bun.default_thread_stack_size },
            startWithErrorHandling,
            .{worker},
        ) catch {
            worker.deinit();
            return false;
        };
        thread.detach();
        return true;
    }

    pub fn create(
        cpp_worker: *void,
        parent: *JSC.VirtualMachine,
        name_str: bun.String,
        specifier_str: bun.String,
        error_message: *bun.String,
        parent_context_id: u32,
        this_context_id: u32,
        mini: bool,
        default_unref: bool,
        argv_ptr: ?[*]WTFStringImpl,
        argv_len: u32,
        execArgv_ptr: ?[*]WTFStringImpl,
        execArgv_len: u32,
    ) callconv(.C) ?*WebWorker {
        JSC.markBinding(@src());
        log("[{d}] WebWorker.create", .{this_context_id});
        var spec_slice = specifier_str.toUTF8(bun.default_allocator);
        defer spec_slice.deinit();
        const prev_log = parent.bundler.log;
        var temp_log = bun.logger.Log.init(bun.default_allocator);
        parent.bundler.setLog(&temp_log);
        defer parent.bundler.setLog(prev_log);
        defer temp_log.deinit();

        const path = brk: {
            const str = spec_slice.slice();
            if (parent.standalone_module_graph) |graph| {
                if (graph.find(str) != null) {
                    break :brk str;
                }

                // Since `bun build --compile` renames files to `.js` by
                // default, we need to do the reverse of our file extension
                // mapping.
                //
                //   new Worker("./foo") -> new Worker("./foo.js")
                //   new Worker("./foo.ts") -> new Worker("./foo.js")
                //   new Worker("./foo.jsx") -> new Worker("./foo.js")
                //   new Worker("./foo.mjs") -> new Worker("./foo.js")
                //   new Worker("./foo.mts") -> new Worker("./foo.js")
                //   new Worker("./foo.cjs") -> new Worker("./foo.js")
                //   new Worker("./foo.cts") -> new Worker("./foo.js")
                //   new Worker("./foo.tsx") -> new Worker("./foo.js")
                //
                if (bun.strings.hasPrefixComptime(str, "./") or bun.strings.hasPrefixComptime(str, "../")) try_from_extension: {
                    var pathbuf: bun.PathBuffer = undefined;
                    var base = str;

                    base = bun.path.joinAbsStringBuf(bun.StandaloneModuleGraph.base_public_path_with_default_suffix, &pathbuf, &.{str}, .loose);
                    const extname = std.fs.path.extension(base);

                    // ./foo -> ./foo.js
                    if (extname.len == 0) {
                        pathbuf[base.len..][0..3].* = ".js".*;
                        if (graph.find(pathbuf[0 .. base.len + 3])) |js_file| {
                            break :brk js_file.name;
                        }

                        break :try_from_extension;
                    }

                    // ./foo.ts -> ./foo.js
                    if (bun.strings.eqlComptime(extname, ".ts")) {
                        pathbuf[base.len - 3 .. base.len][0..3].* = ".js".*;
                        if (graph.find(pathbuf[0..base.len])) |js_file| {
                            break :brk js_file.name;
                        }

                        break :try_from_extension;
                    }

                    if (extname.len == 4) {
                        inline for (.{ ".tsx", ".jsx", ".mjs", ".mts", ".cts", ".cjs" }) |ext| {
                            if (bun.strings.eqlComptime(extname, ext)) {
                                pathbuf[base.len - ext.len ..][0..".js".len].* = ".js".*;
                                const as_js = pathbuf[0 .. base.len - ext.len + ".js".len];
                                if (graph.find(as_js)) |js_file| {
                                    break :brk js_file.name;
                                }
                                break :try_from_extension;
                            }
                        }
                    }
                }
            }

            if (JSC.WebCore.ObjectURLRegistry.isBlobURL(str)) {
                if (JSC.WebCore.ObjectURLRegistry.singleton().has(str["blob:".len..])) {
                    break :brk str;
                } else {
                    error_message.* = bun.String.static("Blob URL is missing");
                    return null;
                }
            }

            var resolved_entry_point: bun.resolver.Result = parent.bundler.resolveEntryPoint(str) catch {
                const out = temp_log.toJS(parent.global, bun.default_allocator, "Error resolving Worker entry point").toBunString(parent.global);
                error_message.* = out;
                return null;
            };

            const entry_path: *bun.fs.Path = resolved_entry_point.path() orelse {
                error_message.* = bun.String.static("Worker entry point is missing");
                return null;
            };
            break :brk entry_path.text;
        };

        var worker = bun.default_allocator.create(WebWorker) catch bun.outOfMemory();
        worker.* = WebWorker{
            .cpp_worker = cpp_worker,
            .parent = parent,
            .parent_context_id = parent_context_id,
            .execution_context_id = this_context_id,
            .mini = mini,
            .specifier = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
            .store_fd = parent.bundler.resolver.store_fd,
            .name = brk: {
                if (!name_str.isEmpty()) {
                    break :brk std.fmt.allocPrintZ(bun.default_allocator, "{}", .{name_str}) catch bun.outOfMemory();
                }
                break :brk "";
            },
            .user_keep_alive = !default_unref,
            .worker_event_loop_running = true,
            .argv = if (argv_ptr) |ptr| ptr[0..argv_len] else null,
            .execArgv = if (execArgv_ptr) |ptr| ptr[0..execArgv_len] else null,
        };

        worker.parent_poll_ref.ref(parent);

        return worker;
    }

    pub fn startWithErrorHandling(
        this: *WebWorker,
    ) void {
        bun.Analytics.Features.workers_spawned += 1;
        start(this) catch |err| {
            Output.panic("An unhandled error occurred while starting a worker: {s}\n", .{@errorName(err)});
        };
    }

    pub fn start(
        this: *WebWorker,
    ) anyerror!void {
        if (this.name.len > 0) {
            Output.Source.configureNamedThread(this.name);
        } else {
            Output.Source.configureNamedThread("Worker");
        }

        if (this.hasRequestedTerminate()) {
            this.exitAndDeinit();
            return;
        }

        assert(this.status.load(.acquire) == .start);
        assert(this.vm == null);

        this.arena = try bun.MimallocArena.init();
        var vm = try JSC.VirtualMachine.initWorker(this, .{
            .allocator = this.arena.?.allocator(),
            .args = this.parent.bundler.options.transform_options,
            .store_fd = this.store_fd,
            .graph = this.parent.standalone_module_graph,
        });
        vm.allocator = this.arena.?.allocator();
        vm.arena = &this.arena.?;

        var b = &vm.bundler;

        b.configureRouter(false) catch {
            this.flushLogs();
            this.exitAndDeinit();
            return;
        };
        b.configureDefines() catch {
            this.flushLogs();
            this.exitAndDeinit();
            return;
        };

        // TODO: we may have to clone other parts of vm state. this will be more
        // important when implementing vm.deinit()
        const map = try vm.allocator.create(bun.DotEnv.Map);
        map.* = try vm.bundler.env.map.cloneWithAllocator(vm.allocator);

        const loader = try vm.allocator.create(bun.DotEnv.Loader);
        loader.* = bun.DotEnv.Loader.init(map, vm.allocator);

        vm.bundler.env = loader;

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = false;
        JSC.VirtualMachine.is_main_thread_vm = false;
        vm.onUnhandledRejection = onUnhandledRejection;
        const callback = JSC.OpaqueWrap(WebWorker, WebWorker.spin);

        this.vm = vm;

        vm.global.vm().holdAPILock(this, callback);
    }

    /// Deinit will clean up vm and everything.
    /// Early deinit may be called from caller thread, but full vm deinit will only be called within worker's thread.
    fn deinit(this: *WebWorker) void {
        log("[{d}] deinit", .{this.execution_context_id});
        this.parent_poll_ref.unrefConcurrently(this.parent);
        bun.default_allocator.free(this.specifier);
        bun.default_allocator.destroy(this);
    }

    fn flushLogs(this: *WebWorker) void {
        JSC.markBinding(@src());
        var vm = this.vm orelse return;
        if (vm.log.msgs.items.len == 0) return;
        const err = vm.log.toJS(vm.global, bun.default_allocator, "Error in worker");
        const str = err.toBunString(vm.global);
        defer str.deref();
        WebWorker__dispatchError(vm.global, this.cpp_worker, str, err);
    }

    fn onUnhandledRejection(vm: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, error_instance_or_exception: JSC.JSValue) void {
        // Prevent recursion
        vm.onUnhandledRejection = &JSC.VirtualMachine.onQuietUnhandledRejectionHandlerCaptureValue;

        const error_instance = error_instance_or_exception.toError() orelse error_instance_or_exception;

        var array = bun.MutableString.init(bun.default_allocator, 0) catch unreachable;
        defer array.deinit();

        var buffered_writer_ = bun.MutableString.BufferedWriter{ .context = &array };
        var buffered_writer = &buffered_writer_;
        var worker = vm.worker orelse @panic("Assertion failure: no worker");

        const writer = buffered_writer.writer();
        const Writer = @TypeOf(writer);
        // we buffer this because it'll almost always be < 4096
        // when it's under 4096, we want to avoid the dynamic allocation
        bun.JSC.ConsoleObject.format2(
            .Debug,
            globalObject,
            &[_]JSC.JSValue{error_instance},
            1,
            Writer,
            Writer,
            writer,
            .{
                .enable_colors = false,
                .add_newline = false,
                .flush = false,
                .max_depth = 32,
            },
        );
        buffered_writer.flush() catch {
            bun.outOfMemory();
        };
        JSC.markBinding(@src());
        WebWorker__dispatchError(globalObject, worker.cpp_worker, bun.String.createUTF8(array.toOwnedSliceLeaky()), error_instance);
        if (vm.worker) |worker_| {
            _ = worker.setRequestedTerminate();
            worker.parent_poll_ref.unrefConcurrently(worker.parent);
            worker_.exitAndDeinit();
        }
    }

    fn setStatus(this: *WebWorker, status: Status) void {
        log("[{d}] status: {s}", .{ this.execution_context_id, @tagName(status) });

        this.status.store(status, .release);
    }

    fn unhandledError(this: *WebWorker, _: anyerror) void {
        this.flushLogs();
    }

    fn spin(this: *WebWorker) void {
        log("[{d}] spin start", .{this.execution_context_id});

        var vm = this.vm.?;
        assert(this.status.load(.acquire) == .start);
        this.setStatus(.starting);

        var promise = vm.loadEntryPointForWebWorker(this.specifier) catch {
            this.flushLogs();
            this.exitAndDeinit();
            return;
        };

        if (promise.status(vm.global.vm()) == .Rejected) {
            const handled = vm.uncaughtException(vm.global, promise.result(vm.global.vm()), true);

            if (!handled) {
                vm.exit_handler.exit_code = 1;
                this.exitAndDeinit();
                return;
            }
        } else {
            _ = promise.result(vm.global.vm());
        }

        this.flushLogs();
        log("[{d}] event loop start", .{this.execution_context_id});
        WebWorker__dispatchOnline(this.cpp_worker, vm.global);
        this.setStatus(.running);

        // don't run the GC if we don't actually need to
        if (vm.isEventLoopAlive() or
            vm.eventLoop().tickConcurrentWithCount() > 0)
        {
            vm.global.vm().releaseWeakRefs();
            _ = vm.arena.gc(false);
            _ = vm.global.vm().runGC(false);
        }

        // always doing a first tick so we call CppTask without delay after dispatchOnline
        vm.tick();

        while (vm.isEventLoopAlive()) {
            vm.tick();
            if (this.hasRequestedTerminate()) break;
            vm.eventLoop().autoTickActive();
            if (this.hasRequestedTerminate()) break;
        }

        log("[{d}] before exit {s}", .{ this.execution_context_id, if (this.hasRequestedTerminate()) "(terminated)" else "(event loop dead)" });

        // Only call "beforeExit" if we weren't from a .terminate
        if (!this.hasRequestedTerminate()) {
            // TODO: is this able to allow the event loop to continue?
            vm.onBeforeExit();
        }

        this.flushLogs();
        this.exitAndDeinit();
        log("[{d}] spin done", .{this.execution_context_id});
    }

    /// This is worker.ref()/.unref() from JS (Caller thread)
    pub fn setRef(this: *WebWorker, value: bool) callconv(.C) void {
        if (this.hasRequestedTerminate()) {
            return;
        }

        this.setRefInternal(value);
    }

    pub fn setRefInternal(this: *WebWorker, value: bool) void {
        if (value) {
            this.parent_poll_ref.ref(this.parent);
        } else {
            this.parent_poll_ref.unref(this.parent);
        }
    }

    /// Request a terminate (Called from main thread from worker.terminate(), or inside worker in process.exit())
    /// The termination will actually happen after the next tick of the worker's loop.
    pub fn requestTerminate(this: *WebWorker) callconv(.C) void {
        if (this.status.load(.acquire) == .terminated) {
            return;
        }
        if (this.setRequestedTerminate()) {
            return;
        }
        log("[{d}] requestTerminate", .{this.execution_context_id});

        if (this.vm) |vm| {
            vm.eventLoop().wakeup();
        }

        this.setRefInternal(false);
    }

    /// This handles cleanup, emitting the "close" event, and deinit.
    /// Only call after the VM is initialized AND on the same thread as the worker.
    /// Otherwise, call `requestTerminate` to cause the event loop to safely terminate after the next tick.
    pub fn exitAndDeinit(this: *WebWorker) noreturn {
        JSC.markBinding(@src());
        this.setStatus(.terminated);
        bun.Analytics.Features.workers_terminated += 1;

        log("[{d}] exitAndDeinit", .{this.execution_context_id});
        const cpp_worker = this.cpp_worker;
        var exit_code: i32 = 0;
        var globalObject: ?*JSC.JSGlobalObject = null;
        var vm_to_deinit: ?*JSC.VirtualMachine = null;
        if (this.vm) |vm| {
            this.vm = null;
            vm.is_shutting_down = true;
            vm.onExit();
            exit_code = vm.exit_handler.exit_code;
            globalObject = vm.global;
            vm_to_deinit = vm;
        }
        var arena = this.arena;

        WebWorker__dispatchExit(globalObject, cpp_worker, exit_code);
        bun.uws.onThreadExit();
        this.deinit();

        if (vm_to_deinit) |vm| {
            vm.deinit(); // NOTE: deinit here isn't implemented, so freeing workers will leak the vm.
        }
        if (arena) |*arena_| {
            arena_.deinit();
        }
        bun.exitThread();
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(create, .{ .name = "WebWorker__create" });
            @export(requestTerminate, .{ .name = "WebWorker__requestTerminate" });
            @export(setRef, .{ .name = "WebWorker__setRef" });
            _ = WebWorker__updatePtr;
        }
    }
};

const assert = bun.assert;
