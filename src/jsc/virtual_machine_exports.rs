use core::ffi::c_void;

use crate::event_loop::ConcurrentTask;
use crate::plugin_runner::PluginRunner;
use crate::{
    CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, Strong, Task,
    VirtualMachineRef as VirtualMachine,
};
use bun_bundler::transpiler::PluginResolver;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_sourcemap::{BakeSourceProvider, DevServerSourceProvider};
use bun_string::String as BunString;

// Zig: comptime { if (Environment.isWindows) @export(&Bun__ZigGlobalObject__uvLoop, ...) }
// Handled below by `#[cfg(windows)]` on the fn definition itself.

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__isShuttingDown(this: &VirtualMachine) -> bool {
    this.is_shutting_down()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getVM() -> *mut VirtualMachine {
    VirtualMachine::get()
}

/// Caller must check for termination exception
#[unsafe(no_mangle)]
pub extern "C" fn Bun__drainMicrotasks() {
    // SAFETY: VM singleton + its event loop are process-lifetime.
    unsafe { (*(*VirtualMachine::get()).event_loop()).tick() };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__readOriginTimer(vm: &VirtualMachine) -> u64 {
    // Check if performance.now() is overridden (for fake timers)
    if let Some(overridden) = vm.overridden_performance_now {
        return overridden;
    }
    // PORT NOTE: Zig `std.time.Timer.read()`; the Phase-B field is `Instant`.
    vm.origin_timer.elapsed().as_nanos() as u64
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__readOriginTimerStart(vm: &VirtualMachine) -> f64 {
    // timespce to milliseconds
    ((vm.origin_timestamp as f64) + crate::virtual_machine::ORIGIN_RELATIVE_EPOCH as f64)
        / 1_000_000.0
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__GlobalObject__connectedIPC(global: &JSGlobalObject) -> bool {
    use crate::virtual_machine::IPCInstanceUnion;
    // SAFETY: bun_vm() yields the live per-thread VM; deref locally per
    // JSGlobalObject::bun_vm contract.
    match unsafe { &(*global.bun_vm()).ipc } {
        Some(IPCInstanceUnion::Initialized(inst)) => {
            // SAFETY: `inst` was produced by `IPCInstance::new` (Box::into_raw)
            // and remains live until `handleIPCClose` swaps `vm.ipc` to `None`.
            unsafe { (**inst).data.is_connected() }
        }
        Some(IPCInstanceUnion::Waiting { .. }) => true,
        None => false,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__GlobalObject__hasIPC(global: &JSGlobalObject) -> bool {
    // SAFETY: bun_vm() yields the live per-thread VM; deref locally per
    // JSGlobalObject::bun_vm contract.
    unsafe { (*global.bun_vm()).ipc.is_some() }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__exitDuringUncaughtException(this: &mut VirtualMachine) {
    this.exit_on_uncaught_exception = true;
}

// `Bun__Process__send` lives in `bun_runtime::ipc_host` (its body — via
// `do_send` — names the `bun_runtime::Listener` type; LAYERING).

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isBunMain(global: &JSGlobalObject, str: &BunString) -> bool {
    // SAFETY: bun_vm() yields the live per-thread VM; deref locally per
    // JSGlobalObject::bun_vm contract.
    str.eql_utf8(unsafe { (*global.bun_vm()).main() })
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ensureProcessIPCInitialized(global: &JSGlobalObject) {
    // getIPCInstance() will initialize a "waiting" ipc instance so this is enough.
    // it will do nothing if IPC is not enabled.
    // SAFETY: bun_vm_ptr() yields the live per-thread VM; `get_ipc_instance`
    // writes `self.ipc` on first call.
    let _ = unsafe { (*global.bun_vm_ptr()).get_ipc_instance() };
}

/// This function is called on the main thread
/// The bunVM() call will assert this
#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTask(global: &JSGlobalObject, task: *mut crate::cpp_task::CppTask) {
    crate::mark_binding!();
    // SAFETY: bun_vm() yields the live per-thread VM; `event_loop()` never
    // returns null for a Bun-owned global.
    unsafe {
        (*(*global.bun_vm()).event_loop()).enqueue_task(Task::init(task));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportUnhandledError(global: &JSGlobalObject, value: JSValue) -> JSValue {
    crate::mark_binding!();

    if !value.is_termination_exception() {
        // SAFETY: bun_vm_ptr() yields the live per-thread VM; `uncaught_exception`
        // mutates VM counters/flags.
        let _ = unsafe { (*global.bun_vm_ptr()).uncaught_exception(global, value, false) };
    }
    JSValue::UNDEFINED
}

/// This function is called on another thread
/// The main difference: we need to allocate the task & wakeup the thread
/// We can avoid that if we run it from the main thread.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTaskConcurrently(
    global: &JSGlobalObject,
    task: *mut crate::cpp_task::CppTask,
) {
    crate::mark_binding!();
    // SAFETY: bun_vm_concurrently() yields the live VM; `event_loop()` never
    // returns null for a Bun-owned global. Called off-thread but the loop
    // wakeup is thread-safe.
    unsafe {
        (*(*global.bun_vm_concurrently()).event_loop())
            .enqueue_task_concurrent(ConcurrentTask::create(Task::init(task)));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__handleRejectedPromise(global: &JSGlobalObject, promise: &mut JSPromise) {
    crate::mark_binding!();

    let result = promise.result(global.vm());
    // SAFETY: bun_vm_ptr() yields the live per-thread VM; `unhandled_rejection`
    // mutates VM counters/flags.
    let jsc_vm = unsafe { &mut *global.bun_vm_ptr() };

    // this seems to happen in some cases when GC is running
    if result.is_empty() {
        return;
    }

    jsc_vm.unhandled_rejection(global, result, promise.to_js());
    jsc_vm.auto_garbage_collect();
}

struct HandledPromiseContext {
    global_this: *mut JSGlobalObject,
    // PORT NOTE: Zig stored a bare JSValue rooted via `.protect()`/`.unprotect()`.
    // PORTING.md forbids bare JSValue fields on heap-allocated structs; `Strong`
    // is the prescribed root type and its `Drop` releases the handle slot.
    promise: Strong,
}

impl HandledPromiseContext {
    fn callback(context: *mut Self) -> bun_event_loop::JsResult<()> {
        // SAFETY: `context` was produced by `Box::into_raw` below; we are the
        // sole owner and reconstitute the Box to drop it at end of scope.
        let context = unsafe { Box::from_raw(context) };
        // SAFETY: `global_this` was the live global at enqueue time; the VM is
        // process-lifetime and the global outlives the event-loop tick.
        let global = unsafe { &*context.global_this };
        // SAFETY: bun_vm() yields the live per-thread VM; deref locally per
        // JSGlobalObject::bun_vm contract.
        let _ = unsafe { (*global.bun_vm()).handled_promise(global, context.promise.get()) };
        // drop(context) — Box freed at scope exit (replaces `default_allocator.destroy`);
        // Strong's Drop replaces the explicit `.unprotect()`.
        Ok(())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__handleHandledPromise(global: &JSGlobalObject, promise: &JSPromise) {
    crate::mark_binding!();
    let promise_js = promise.to_js();
    let context = Box::into_raw(Box::new(HandledPromiseContext {
        global_this: global.as_ptr(),
        promise: Strong::create(promise_js, global),
    }));
    // SAFETY: bun_vm() yields the live per-thread VM; `event_loop()` never
    // returns null for a Bun-owned global.
    unsafe {
        (*(*global.bun_vm()).event_loop())
            .enqueue_task(ManagedTask::new(context, HandledPromiseContext::callback));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onDidAppendPlugin(jsc_vm: &mut VirtualMachine, global: &JSGlobalObject) {
    if jsc_vm.plugin_runner.is_some() {
        return;
    }

    jsc_vm.plugin_runner = Some(PluginRunner {
        global_object: global.as_ptr(),
    });
    // SAFETY: `plugin_runner` was just set to `Some` above; the `Option` slot
    // is embedded in `*jsc_vm` and stable for the VM's lifetime, so taking a
    // raw pointer into it for the linker BACKREF is sound.
    jsc_vm.transpiler.linker.plugin_runner = Some(
        unsafe { jsc_vm.plugin_runner.as_mut().unwrap_unchecked() } as *mut dyn PluginResolver,
    );
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ZigGlobalObject__uvLoop(jsc_vm: &mut VirtualMachine) -> *mut c_void {
    jsc_vm.uv_loop().cast()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__setTLSRejectUnauthorizedValue(value: i32) {
    // SAFETY: VM singleton is process-lifetime.
    unsafe { (*VirtualMachine::get()).default_tls_reject_unauthorized = Some(value != 0) };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getTLSRejectUnauthorizedValue() -> i32 {
    // SAFETY: VM singleton is process-lifetime.
    if unsafe { (*VirtualMachine::get()).get_tls_reject_unauthorized() } { 1 } else { 0 }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isNoProxy(
    hostname_ptr: *const u8,
    hostname_len: usize,
    host_ptr: *const u8,
    host_len: usize,
) -> bool {
    // SAFETY: VM singleton is process-lifetime.
    let vm = unsafe { &*VirtualMachine::get() };
    // SAFETY: caller (C++) guarantees `hostname_ptr[..hostname_len]` is valid for reads.
    let hostname: Option<&[u8]> = if hostname_len > 0 {
        Some(unsafe { core::slice::from_raw_parts(hostname_ptr, hostname_len) })
    } else {
        None
    };
    // SAFETY: caller (C++) guarantees `host_ptr[..host_len]` is valid for reads.
    let host: Option<&[u8]> = if host_len > 0 {
        Some(unsafe { core::slice::from_raw_parts(host_ptr, host_len) })
    } else {
        None
    };
    // SAFETY: `Transpiler.env` is a raw `*mut Loader` (cycle-break); set once
    // during VM init and live for the VM's lifetime.
    unsafe { (*vm.transpiler.env).is_no_proxy(hostname, host) }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__setVerboseFetchValue(value: i32) {
    use bun_http::HTTPVerboseLevel;
    // SAFETY: VM singleton is process-lifetime.
    unsafe {
        (*VirtualMachine::get()).default_verbose_fetch = Some(match value {
            1 => HTTPVerboseLevel::Headers as u8,
            2 => HTTPVerboseLevel::Curl as u8,
            _ => HTTPVerboseLevel::None as u8,
        });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getVerboseFetchValue() -> i32 {
    use bun_http::HTTPVerboseLevel;
    // SAFETY: VM singleton is process-lifetime.
    match unsafe { (*VirtualMachine::get()).get_verbose_fetch() } {
        HTTPVerboseLevel::None => 0,
        HTTPVerboseLevel::Headers => 1,
        HTTPVerboseLevel::Curl => 2,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addBakeSourceProviderSourceMap(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings.put_bake_source_provider(
        opaque_source_provider.cast::<BakeSourceProvider>(),
        slice.slice(),
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addDevServerSourceProvider(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings.put_dev_server_source_provider(
        opaque_source_provider.cast::<DevServerSourceProvider>(),
        slice.slice(),
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__removeDevServerSourceProvider(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings
        .remove_dev_server_source_provider(opaque_source_provider, slice.slice());
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addSourceProviderSourceMap(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings
        .put_zig_source_provider(opaque_source_provider, slice.slice());
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__removeSourceProviderSourceMap(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings
        .remove_zig_source_provider(opaque_source_provider, slice.slice());
}

#[crate::host_fn(export = "Bun__setSyntheticAllocationLimitForTesting")]
pub fn Bun__setSyntheticAllocationLimitForTesting(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let args = frame.arguments_old::<1>();
    if args.len < 1 {
        return Err(global.throw_not_enough_arguments(
            "setSyntheticAllocationLimitForTesting",
            1,
            args.len,
        ));
    }

    if !args.ptr[0].is_number() {
        return Err(global.throw_invalid_arguments(format_args!(
            "setSyntheticAllocationLimitForTesting expects a number"
        )));
    }

    let limit: usize =
        usize::try_from(args.ptr[0].coerce_to_int64(global)?.max(1024 * 1024)).unwrap();
    // SAFETY: `static mut` written only from the JS thread (testing hook); all
    // readers are also JS-thread.
    let prev = unsafe {
        let p = crate::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT;
        crate::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT = limit;
        p
    };
    crate::virtual_machine::STRING_ALLOCATION_LIMIT
        .store(limit, core::sync::atomic::Ordering::Relaxed);
    Ok(JSValue::js_number(prev as f64))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/virtual_machine_exports.zig (244 lines)
//   confidence: high
//   todos:      0
// ──────────────────────────────────────────────────────────────────────────
