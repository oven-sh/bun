const bun = @import("root").bun;
const JSC = bun.JSC;
const Output = bun.Output;
const log = Output.scoped(.Worker, true);
const std = @import("std");
const JSValue = JSC.JSValue;
const Async = bun.Async;
const WTFStringImpl = @import("../string.zig").WTFStringImpl;

/// Shared implementation of Web and Node `Worker`
pub const WebWorker = struct {
    /// null when haven't started yet
    vm: ?*JSC.VirtualMachine = null,
    status: std.atomic.Value(Status) = std.atomic.Value(Status).init(.start),
    /// To prevent UAF, the `spin` function (aka the worker's event loop) will call deinit once this is set and properly exit the loop.
    requested_terminate: bool = false,
    execution_context_id: u32 = 0,
    parent_context_id: u32 = 0,
    parent: *JSC.VirtualMachine,

    /// Already resolved.
    specifier: []const u8 = "",
    store_fd: bool = false,
    arena: bun.MimallocArena = undefined,
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

        var resolved_entry_point = parent.bundler.resolveEntryPoint(spec_slice.slice()) catch {
            const out = temp_log.toJS(parent.global, bun.default_allocator, "Error resolving Worker entry point").toBunString(parent.global);
            error_message.* = out;
            return null;
        };

        const path = resolved_entry_point.path() orelse {
            error_message.* = bun.String.static("Worker entry point is missing");
            return null;
        };

        var worker = bun.default_allocator.create(WebWorker) catch @panic("OOM");
        worker.* = WebWorker{
            .cpp_worker = cpp_worker,
            .parent = parent,
            .parent_context_id = parent_context_id,
            .execution_context_id = this_context_id,
            .mini = mini,
            .specifier = bun.default_allocator.dupe(u8, path.text) catch @panic("OOM"),
            .store_fd = parent.bundler.resolver.store_fd,
            .name = brk: {
                if (!name_str.isEmpty()) {
                    break :brk std.fmt.allocPrintZ(bun.default_allocator, "{}", .{name_str}) catch @panic("OOM");
                }
                break :brk "";
            },
            .user_keep_alive = !default_unref,
            .worker_event_loop_running = true,
            .argv = if (argv_ptr) |ptr| ptr[0..argv_len] else null,
            .execArgv = if (execArgv_ptr) |ptr| ptr[0..execArgv_len] else null,
        };

        worker.parent_poll_ref.refConcurrently(parent);

        return worker;
    }

    pub fn startWithErrorHandling(
        this: *WebWorker,
    ) void {
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

        if (this.requested_terminate) {
            this.deinit();
            return;
        }

        std.debug.assert(this.status.load(.Acquire) == .start);
        std.debug.assert(this.vm == null);
        this.arena = try bun.MimallocArena.init();
        var vm = try JSC.VirtualMachine.initWorker(this, .{
            .allocator = this.arena.allocator(),
            .args = this.parent.bundler.options.transform_options,
            .store_fd = this.store_fd,
        });
        vm.allocator = this.arena.allocator();
        vm.arena = &this.arena;

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

        vm.loadExtraEnv();
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
        bun.JSC.ConsoleObject.format(
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
            @panic("OOM");
        };
        JSC.markBinding(@src());
        WebWorker__dispatchError(globalObject, worker.cpp_worker, bun.String.createUTF8(array.toOwnedSliceLeaky()), error_instance);
        if (vm.worker) |worker_| {
            worker.requested_terminate = true;
            worker.parent_poll_ref.unrefConcurrently(worker.parent);
            worker_.exitAndDeinit();
        }
    }

    fn setStatus(this: *WebWorker, status: Status) void {
        log("[{d}] status: {s}", .{ this.execution_context_id, @tagName(status) });

        this.status.store(status, .Release);
    }

    fn unhandledError(this: *WebWorker, _: anyerror) void {
        this.flushLogs();
    }

    fn spin(this: *WebWorker) void {
        var vm = this.vm.?;
        std.debug.assert(this.status.load(.Acquire) == .start);
        this.setStatus(.starting);

        var promise = vm.loadEntryPointForWebWorker(this.specifier) catch {
            this.flushLogs();
            this.exitAndDeinit();
            return;
        };

        if (promise.status(vm.global.vm()) == .Rejected) {
            vm.onUnhandledError(vm.global, promise.result(vm.global.vm()));

            vm.exit_handler.exit_code = 1;
            this.exitAndDeinit();
            return;
        }

        _ = promise.result(vm.global.vm());

        this.flushLogs();
        JSC.markBinding(@src());
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
            if (this.requested_terminate) break;
            vm.eventLoop().autoTickActive();
            if (this.requested_terminate) break;
        }

        // Only call "beforeExit" if we weren't from a .terminate
        if (!this.requested_terminate) {
            // TODO: is this able to allow the event loop to continue?
            vm.onBeforeExit();
        }

        this.flushLogs();
        this.exitAndDeinit();
    }

    /// This is worker.ref()/.unref() from JS (Caller thread)
    pub fn setRef(this: *WebWorker, value: bool) callconv(.C) void {
        if (this.requested_terminate) {
            return;
        }
        if (value) {
            this.parent_poll_ref.ref(this.parent);
        } else {
            this.parent_poll_ref.unref(this.parent);
        }
    }

    /// Request a terminate (Called from main thread from worker.terminate(), or inside worker in process.exit())
    /// The termination will actually happen after the next tick of the worker's loop.
    pub fn requestTerminate(this: *WebWorker) callconv(.C) void {
        if (this.status.load(.Acquire) == .terminated) {
            return;
        }
        if (this.requested_terminate) {
            return;
        }
        log("[{d}] requestTerminate", .{this.execution_context_id});
        this.setRef(false);
        this.requested_terminate = true;
        if (this.vm) |vm| {
            vm.jsc.notifyNeedTermination();
            vm.eventLoop().wakeup();
        }
    }

    /// This handles cleanup, emitting the "close" event, and deinit.
    /// Only call after the VM is initialized AND on the same thread as the worker.
    /// Otherwise, call `requestTerminate` to cause the event loop to safely terminate after the next tick.
    pub fn exitAndDeinit(this: *WebWorker) noreturn {
        JSC.markBinding(@src());
        this.setStatus(.terminated);

        log("[{d}] exitAndDeinit", .{this.execution_context_id});
        const cpp_worker = this.cpp_worker;
        var exit_code: i32 = 0;
        var globalObject: ?*JSC.JSGlobalObject = null;
        var vm_to_deinit: ?*JSC.VirtualMachine = null;
        if (this.vm) |vm| {
            this.vm = null;
            vm.onExit();
            exit_code = vm.exit_handler.exit_code;
            globalObject = vm.global;
            vm_to_deinit = vm;
        }
        var arena = this.arena;

        WebWorker__dispatchExit(globalObject, cpp_worker, exit_code);
        this.deinit();

        if (vm_to_deinit) |vm| {
            vm.deinit(); // NOTE: deinit here isn't implemented, so freeing workers will leak the vm.
        }

        arena.deinit();
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
