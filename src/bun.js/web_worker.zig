const bun = @import("root").bun;
const JSC = bun.JSC;
const Output = bun.Output;
const log = Output.scoped(.Worker, true);
const std = @import("std");
const JSValue = JSC.JSValue;

pub const WebWorker = struct {
    // null when haven't started yet
    vm: ?*JSC.VirtualMachine = null,
    status: Status = .start,
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
    allowed_to_exit: bool = false,
    mini: bool = false,
    parent_poll_ref: JSC.PollRef = .{},
    initial_poll_ref: JSC.PollRef = .{},
    did_send_initial_task: bool = false,

    extern fn WebWorker__dispatchExit(?*JSC.JSGlobalObject, *anyopaque, i32) void;
    extern fn WebWorker__dispatchOnline(this: *anyopaque, *JSC.JSGlobalObject) void;
    extern fn WebWorker__dispatchError(*JSC.JSGlobalObject, *anyopaque, bun.String, JSValue) void;
    export fn WebWorker__getParentWorker(vm: *JSC.VirtualMachine) ?*anyopaque {
        var worker = vm.worker orelse return null;
        return worker.cpp_worker;
    }

    export fn WebWorker__updatePtr(worker: *WebWorker, ptr: *anyopaque) bool {
        worker.cpp_worker = ptr;

        var thread = std.Thread.spawn(
            .{ .stack_size = 2 * 1024 * 1024 },
            startWithErrorHandling,
            .{worker},
        ) catch {
            worker.deinit();
            worker.parent_poll_ref.unref(worker.parent);
            worker.initial_poll_ref.unref(worker.parent);
            bun.default_allocator.destroy(worker);
            return false;
        };
        thread.detach();
        return true;
    }

    pub fn hasPendingActivity(this: *WebWorker) callconv(.C) bool {
        JSC.markBinding(@src());

        if (this.vm == null) {
            return !this.requested_terminate;
        }

        if (!this.allowed_to_exit) {
            return true;
        }

        var vm = this.vm.?;

        return vm.eventLoop().tasks.count > 0 or vm.active_tasks > 0 or vm.uws_event_loop.?.active > 0;
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
    ) callconv(.C) ?*WebWorker {
        JSC.markBinding(@src());
        var spec_slice = specifier_str.toUTF8(bun.default_allocator);
        defer spec_slice.deinit();
        var prev_log = parent.bundler.log;
        var temp_log = bun.logger.Log.init(bun.default_allocator);
        parent.bundler.setLog(&temp_log);
        defer parent.bundler.setLog(prev_log);
        defer temp_log.deinit();

        var resolved_entry_point = parent.bundler.resolveEntryPoint(spec_slice.slice()) catch {
            var out = temp_log.toJS(parent.global, bun.default_allocator, "Error resolving Worker entry point").toBunString(parent.global);
            out.ref();
            error_message.* = out;
            return null;
        };

        var path = resolved_entry_point.path() orelse {
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
        };

        worker.initial_poll_ref.ref(parent);

        if (!default_unref) {
            worker.allowed_to_exit = false;
            worker.parent_poll_ref.ref(parent);
        }

        return worker;
    }

    pub fn queueInitialTask(this: *WebWorker) void {
        if (this.did_send_initial_task) return;
        this.did_send_initial_task = true;

        const Unref = struct {
            pub fn unref(worker: *WebWorker) void {
                worker.initial_poll_ref.unref(worker.parent);
            }
        };

        const AnyTask = JSC.AnyTask.New(WebWorker, Unref.unref);
        var any_task = bun.default_allocator.create(JSC.AnyTask) catch @panic("OOM");
        any_task.* = AnyTask.init(this);
        var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch @panic("OOM");
        this.parent.eventLoop().enqueueTaskConcurrent(concurrent_task.from(any_task));
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
            this.queueInitialTask();
            this.deinit();
            return;
        }

        std.debug.assert(this.status == .start);
        std.debug.assert(this.vm == null);
        this.arena = try bun.MimallocArena.init();
        var vm = try JSC.VirtualMachine.initWorker(
            this.arena.allocator(),
            this.parent.bundler.options.transform_options,
            null,
            null,
            this.store_fd,
            this,
        );
        vm.allocator = this.arena.allocator();
        vm.arena = &this.arena;

        var b = &vm.bundler;

        b.configureRouter(false) catch {
            this.flushLogs();
            this.onTerminate();
            return;
        };
        b.configureDefines() catch {
            this.flushLogs();
            this.onTerminate();
            return;
        };

        vm.loadExtraEnv();
        vm.is_main_thread = false;
        JSC.VirtualMachine.is_main_thread_vm = false;
        vm.onUnhandledRejection = onUnhandledRejection;
        var callback = JSC.OpaqueWrap(WebWorker, WebWorker.spin);

        this.vm = vm;

        vm.global.vm().holdAPILock(this, callback);
    }

    fn deinit(this: *WebWorker) void {
        bun.default_allocator.free(this.specifier);
    }

    fn flushLogs(this: *WebWorker) void {
        var vm = this.vm orelse return;
        if (vm.log.msgs.items.len == 0) return;
        const err = vm.log.toJS(vm.global, bun.default_allocator, "Error in worker");
        const str = err.toBunString(vm.global);
        WebWorker__dispatchError(vm.global, this.cpp_worker, str, err);
    }

    fn onUnhandledRejection(vm: *JSC.VirtualMachine, globalObject: *JSC.JSGlobalObject, error_instance: JSC.JSValue) void {
        var array = bun.MutableString.init(bun.default_allocator, 0) catch unreachable;
        defer array.deinit();

        var buffered_writer_ = bun.MutableString.BufferedWriter{ .context = &array };
        var buffered_writer = &buffered_writer_;
        var worker = vm.worker orelse @panic("Assertion failure: no worker");

        var writer = buffered_writer.writer();
        const Writer = @TypeOf(writer);
        // we buffer this because it'll almost always be < 4096
        // when it's under 4096, we want to avoid the dynamic allocation
        bun.JSC.ZigConsoleClient.format(
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

        WebWorker__dispatchError(globalObject, worker.cpp_worker, bun.String.create(array.toOwnedSliceLeaky()), error_instance);
    }

    fn setStatus(this: *WebWorker, status: Status) void {
        log("status: {s}", .{@tagName(status)});
        this.status = status;
    }

    fn unhandledError(this: *WebWorker, _: anyerror) void {
        this.flushLogs();
    }

    fn spin(this: *WebWorker) void {
        var vm = this.vm.?;
        std.debug.assert(this.status == .start);
        this.setStatus(.starting);

        var promise = vm.loadEntryPoint(this.specifier) catch {
            this.flushLogs();
            this.onTerminate();
            return;
        };

        this.queueInitialTask();

        if (promise.status(vm.global.vm()) == .Rejected) {
            vm.onUnhandledError(vm.global, promise.result(vm.global.vm()));

            vm.exit_handler.exit_code = 1;
            this.onTerminate();

            return;
        }

        _ = promise.result(vm.global.vm());

        this.flushLogs();

        WebWorker__dispatchOnline(this.cpp_worker, vm.global);
        this.setStatus(.running);

        // don't run the GC if we don't actually need to
        if (vm.eventLoop().tasks.count > 0 or vm.active_tasks > 0 or
            vm.uws_event_loop.?.active > 0 or
            vm.eventLoop().tickConcurrentWithCount() > 0)
        {
            vm.global.vm().releaseWeakRefs();
            _ = vm.arena.gc(false);
            _ = vm.global.vm().runGC(false);
            vm.tick();
        }

        {
            while (true) {
                while (vm.eventLoop().tasks.count > 0 or vm.active_tasks > 0 or vm.uws_event_loop.?.active > 0) {
                    vm.tick();

                    vm.eventLoop().autoTickActive();
                }

                if (!this.allowed_to_exit) {
                    this.flushLogs();
                    vm.eventLoop().tickPossiblyForever();
                    continue;
                }

                vm.onBeforeExit();

                if (!this.allowed_to_exit)
                    continue;

                break;
            }

            this.flushLogs();
            this.onTerminate();
        }
    }

    pub const Status = enum {
        start,
        starting,
        running,
        terminated,
    };

    pub fn terminate(this: *WebWorker) callconv(.C) void {
        if (this.requested_terminate) {
            return;
        }

        this.allowed_to_exit = false;
        _ = this.requestTerminate();
    }

    pub fn setRef(this: *WebWorker, value: bool) callconv(.C) void {
        if (this.requested_terminate and value) {
            this.parent_poll_ref.unref(this.parent);
            return;
        }

        this.allowed_to_exit = value;
        if (value) {
            this.parent_poll_ref.ref(this.parent);
        } else {
            this.parent_poll_ref.unref(this.parent);
        }

        if (this.vm) |vm| {
            vm.eventLoop().wakeup();
        }
    }

    fn onTerminate(this: *WebWorker) void {
        log("onTerminate", .{});

        this.reallyExit();
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(hasPendingActivity, .{ .name = "WebWorker__hasPendingActivity" });
            @export(create, .{ .name = "WebWorker__create" });
            @export(terminate, .{ .name = "WebWorker__terminate" });
            @export(setRef, .{ .name = "WebWorker__setRef" });
            _ = WebWorker__updatePtr;
        }
    }

    fn reallyExit(this: *WebWorker) void {
        JSC.markBinding(@src());

        if (this.requested_terminate) {
            return;
        }
        this.requested_terminate = true;

        var cpp_worker = this.cpp_worker;
        var exit_code: i32 = 0;
        var globalObject: ?*JSC.JSGlobalObject = null;
        if (this.vm) |vm| {
            this.vm = null;
            vm.onExit();
            exit_code = vm.exit_handler.exit_code;
            globalObject = vm.global;
            this.arena.deinit();
        }
        WebWorker__dispatchExit(globalObject, cpp_worker, exit_code);

        this.deinit();
    }

    fn requestTerminate(this: *WebWorker) bool {
        var vm = this.vm orelse {
            this.requested_terminate = true;
            return false;
        };
        this.allowed_to_exit = true;
        log("requesting terminate", .{});
        var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch @panic("OOM");
        var task = bun.default_allocator.create(JSC.AnyTask) catch @panic("OOM");
        task.* = JSC.AnyTask.New(WebWorker, onTerminate).init(this);
        vm.eventLoop().enqueueTaskConcurrent(concurrent_task.from(task));
        return true;
    }
};
