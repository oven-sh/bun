comptime {
    if (bun.Environment.isWindows) {
        @export(&Bun__ZigGlobalObject__uvLoop, .{ .name = "Bun__ZigGlobalObject__uvLoop" });
    }
}

pub export fn Bun__VirtualMachine__isShuttingDown(this: *const VirtualMachine) callconv(.c) bool {
    return this.isShuttingDown();
}

pub export fn Bun__getVM() *jsc.VirtualMachine {
    return jsc.VirtualMachine.get();
}

/// Caller must check for termination exception
pub export fn Bun__drainMicrotasks() void {
    jsc.VirtualMachine.get().eventLoop().tick();
}

export fn Bun__readOriginTimer(vm: *jsc.VirtualMachine) u64 {
    // Check if performance.now() is overridden (for fake timers)
    if (vm.overridden_performance_now) |overridden| {
        return overridden;
    }
    return vm.origin_timer.read();
}

export fn Bun__readOriginTimerStart(vm: *jsc.VirtualMachine) f64 {
    // timespce to milliseconds
    return @as(f64, @floatCast((@as(f64, @floatFromInt(vm.origin_timestamp)) + jsc.VirtualMachine.origin_relative_epoch) / 1_000_000.0));
}

pub export fn Bun__GlobalObject__connectedIPC(global: *JSGlobalObject) bool {
    if (global.bunVM().ipc) |ipc| {
        if (ipc == .initialized) {
            return ipc.initialized.data.isConnected();
        }
        return true;
    }
    return false;
}
pub export fn Bun__GlobalObject__hasIPC(global: *JSGlobalObject) bool {
    if (global.bunVM().ipc != null) {
        return true;
    }
    return false;
}

export fn Bun__VirtualMachine__exitDuringUncaughtException(this: *jsc.VirtualMachine) void {
    this.exit_on_uncaught_exception = true;
}

comptime {
    const Bun__Process__send = jsc.toJSHostFn(Bun__Process__send_);
    @export(&Bun__Process__send, .{ .name = "Bun__Process__send" });
}
pub fn Bun__Process__send_(globalObject: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const vm = globalObject.bunVM();
    return IPC.doSend(if (vm.getIPCInstance()) |i| &i.data else null, globalObject, callFrame, .process);
}

pub export fn Bun__isBunMain(globalObject: *JSGlobalObject, str: *const bun.String) bool {
    return str.eqlUTF8(globalObject.bunVM().main);
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
pub export fn Bun__ensureProcessIPCInitialized(globalObject: *JSGlobalObject) void {
    // getIPC() will initialize a "waiting" ipc instance so this is enough.
    // it will do nothing if IPC is not enabled.
    _ = globalObject.bunVM().getIPCInstance();
}

/// This function is called on the main thread
/// The bunVM() call will assert this
pub export fn Bun__queueTask(global: *JSGlobalObject, task: *jsc.CppTask) void {
    jsc.markBinding(@src());

    global.bunVM().eventLoop().enqueueTask(jsc.Task.init(task));
}

pub export fn Bun__reportUnhandledError(globalObject: *JSGlobalObject, value: JSValue) callconv(.c) JSValue {
    jsc.markBinding(@src());

    if (!value.isTerminationException()) {
        _ = globalObject.bunVM().uncaughtException(globalObject, value, false);
    }
    return .js_undefined;
}

/// This function is called on another thread
/// The main difference: we need to allocate the task & wakeup the thread
/// We can avoid that if we run it from the main thread.
pub export fn Bun__queueTaskConcurrently(global: *JSGlobalObject, task: *jsc.CppTask) void {
    jsc.markBinding(@src());

    global.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(
        jsc.ConcurrentTask.create(jsc.Task.init(task)),
    );
}

pub export fn Bun__handleRejectedPromise(global: *JSGlobalObject, promise: *jsc.JSPromise) void {
    jsc.markBinding(@src());

    const result = promise.result(global.vm());
    var jsc_vm = global.bunVM();

    // this seems to happen in some cases when GC is running
    if (result == .zero)
        return;

    jsc_vm.unhandledRejection(global, result, promise.toJS());
    jsc_vm.autoGarbageCollect();
}

pub export fn Bun__handleHandledPromise(global: *JSGlobalObject, promise: *jsc.JSPromise) void {
    const Context = struct {
        globalThis: *jsc.JSGlobalObject,
        promise: jsc.JSValue,
        pub fn callback(context: *@This()) void {
            _ = context.globalThis.bunVM().handledPromise(context.globalThis, context.promise);
            context.promise.unprotect();
            bun.default_allocator.destroy(context);
        }
    };
    jsc.markBinding(@src());
    const promise_js = promise.toJS();
    promise_js.protect();
    const context = bun.handleOom(bun.default_allocator.create(Context));
    context.* = .{ .globalThis = global, .promise = promise_js };
    global.bunVM().eventLoop().enqueueTask(jsc.ManagedTask.New(Context, Context.callback).init(context));
}

pub export fn Bun__onDidAppendPlugin(jsc_vm: *VirtualMachine, globalObject: *JSGlobalObject) void {
    if (jsc_vm.plugin_runner != null) {
        return;
    }

    jsc_vm.plugin_runner = PluginRunner{
        .global_object = globalObject,
        .allocator = jsc_vm.allocator,
    };
    jsc_vm.transpiler.linker.plugin_runner = &jsc_vm.plugin_runner.?;
}

pub fn Bun__ZigGlobalObject__uvLoop(jsc_vm: *VirtualMachine) callconv(.c) *bun.windows.libuv.Loop {
    return jsc_vm.uvLoop();
}

export fn Bun__setTLSRejectUnauthorizedValue(value: i32) void {
    VirtualMachine.get().default_tls_reject_unauthorized = value != 0;
}

export fn Bun__getTLSRejectUnauthorizedValue() i32 {
    return if (jsc.VirtualMachine.get().getTLSRejectUnauthorized()) 1 else 0;
}

export fn Bun__setVerboseFetchValue(value: i32) void {
    VirtualMachine.get().default_verbose_fetch = if (value == 1) .headers else if (value == 2) .curl else .none;
}

export fn Bun__getVerboseFetchValue() i32 {
    return switch (jsc.VirtualMachine.get().getVerboseFetch()) {
        .none => 0,
        .headers => 1,
        .curl => 2,
    };
}

export fn Bun__addBakeSourceProviderSourceMap(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.putBakeSourceProvider(@as(*BakeSourceProvider, @ptrCast(opaque_source_provider)), slice.slice());
}

export fn Bun__addDevServerSourceProvider(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.putDevServerSourceProvider(@as(*DevServerSourceProvider, @ptrCast(opaque_source_provider)), slice.slice());
}

export fn Bun__removeDevServerSourceProvider(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.removeDevServerSourceProvider(@as(*DevServerSourceProvider, @ptrCast(opaque_source_provider)), slice.slice());
}

export fn Bun__addSourceProviderSourceMap(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.putZigSourceProvider(opaque_source_provider, slice.slice());
}

export fn Bun__removeSourceProviderSourceMap(vm: *VirtualMachine, opaque_source_provider: *anyopaque, specifier: *bun.String) void {
    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const slice = specifier.toUTF8(sfb.get());
    defer slice.deinit();
    vm.source_mappings.removeZigSourceProvider(opaque_source_provider, slice.slice());
}

pub fn Bun__setSyntheticAllocationLimitForTesting(globalObject: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments_old(1).slice();
    if (args.len < 1) {
        return globalObject.throwNotEnoughArguments("setSyntheticAllocationLimitForTesting", 1, args.len);
    }

    if (!args[0].isNumber()) {
        return globalObject.throwInvalidArguments("setSyntheticAllocationLimitForTesting expects a number", .{});
    }

    const limit: usize = @intCast(@max(try args[0].coerceToInt64(globalObject), 1024 * 1024));
    const prev = VirtualMachine.synthetic_allocation_limit;
    VirtualMachine.synthetic_allocation_limit = limit;
    VirtualMachine.string_allocation_limit = limit;
    return JSValue.jsNumber(prev);
}

const IPC = @import("./ipc.zig");
const std = @import("std");

const bun = @import("bun");
const PluginRunner = bun.transpiler.PluginRunner;

const BakeSourceProvider = bun.SourceMap.BakeSourceProvider;
const DevServerSourceProvider = bun.SourceMap.DevServerSourceProvider;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
