use core::ffi::c_void;

use crate::event_loop::ConcurrentTask;
use crate::plugin_runner::PluginRunner;
use crate::{
    CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, Strong, Task,
    VirtualMachineRef as VirtualMachine,
};
use bun_bundler::transpiler::PluginResolver;
use bun_core::String as BunString;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_sourcemap::{BakeSourceProvider, DevServerSourceProvider};

// Zig: comptime { if (Environment.isWindows) @export(&Bun__ZigGlobalObject__uvLoop, ...) }
// Handled below by `#[cfg(windows)]` on the fn definition itself.
//
// `#[unsafe(no_mangle)] extern "C"` thunks for everything below are emitted by
// `src/codegen/generate-host-exports.ts` from the `// HOST_EXPORT(Sym, c)`
// markers; the bodies here take safe `&VirtualMachine` / `&JSGlobalObject` /
// `&BunString` borrows and the thunk performs the single `unsafe { &*ptr }`
// deref centrally.

// HOST_EXPORT(Bun__VirtualMachine__isShuttingDown, c)
pub fn is_shutting_down(this: &VirtualMachine) -> bool {
    this.is_shutting_down()
}

// HOST_EXPORT(Bun__getVM, c)
pub fn get_vm() -> *mut VirtualMachine {
    VirtualMachine::get_mut_ptr()
}

/// Caller must check for termination exception
// HOST_EXPORT(Bun__drainMicrotasks, c)
pub fn drain_microtasks() {
    VirtualMachine::get().event_loop_mut().tick();
}

// HOST_EXPORT(Bun__readOriginTimer, c)
pub fn read_origin_timer(vm: &VirtualMachine) -> u64 {
    // Check if performance.now() is overridden (for fake timers)
    if let Some(overridden) = vm.overridden_performance_now {
        return overridden;
    }
    // PORT NOTE: Zig `std.time.Timer.read()`; the Phase-B field is `Instant`.
    vm.origin_timer.elapsed().as_nanos() as u64
}

// HOST_EXPORT(Bun__readOriginTimerStart, c)
pub fn read_origin_timer_start(vm: &VirtualMachine) -> f64 {
    // timespce to milliseconds
    ((vm.origin_timestamp as f64) + crate::virtual_machine::ORIGIN_RELATIVE_EPOCH as f64)
        / 1_000_000.0
}

// HOST_EXPORT(Bun__GlobalObject__connectedIPC, c)
pub fn global_object_connected_ipc(global: &JSGlobalObject) -> bool {
    use crate::virtual_machine::IPCInstanceUnion;
    match &global.bun_vm().as_mut().ipc {
        Some(IPCInstanceUnion::Initialized(inst)) => {
            // SAFETY: `inst` was produced by `IPCInstance::new` (heap::alloc)
            // and remains live until `handleIPCClose` swaps `vm.ipc` to `None`.
            unsafe { (**inst).data.is_connected() }
        }
        Some(IPCInstanceUnion::Waiting { .. }) => true,
        None => false,
    }
}

// HOST_EXPORT(Bun__GlobalObject__hasIPC, c)
pub fn global_object_has_ipc(global: &JSGlobalObject) -> bool {
    // JSGlobalObject::bun_vm contract.
    global.bun_vm().as_mut().ipc.is_some()
}

// HOST_EXPORT(Bun__VirtualMachine__exitDuringUncaughtException, c)
pub fn exit_during_uncaught_exception(this: &mut VirtualMachine) {
    this.exit_on_uncaught_exception = true;
}

// `Bun__Process__send` lives in `bun_runtime::ipc_host` (its body — via
// `do_send` — names the `bun_runtime::Listener` type; LAYERING).

// HOST_EXPORT(Bun__isBunMain, c)
pub fn is_bun_main(global: &JSGlobalObject, str: &BunString) -> bool {
    // JSGlobalObject::bun_vm contract.
    str.eql_utf8(global.bun_vm().as_mut().main())
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
// HOST_EXPORT(Bun__ensureProcessIPCInitialized, c)
pub fn ensure_process_ipc_initialized(global: &JSGlobalObject) {
    // getIPCInstance() will initialize a "waiting" ipc instance so this is enough.
    // it will do nothing if IPC is not enabled.
    let _ = global.bun_vm().as_mut().get_ipc_instance();
}

/// This function is called on the main thread
/// The bunVM() call will assert this
// HOST_EXPORT(Bun__queueTask, c)
pub fn queue_task(global: &JSGlobalObject, task: *mut crate::cpp_task::CppTask) {
    crate::mark_binding!();
    global
        .bun_vm()
        .event_loop_mut()
        .enqueue_task(Task::init(task));
}

// HOST_EXPORT(Bun__reportUnhandledError, c)
pub fn report_unhandled_error(global: &JSGlobalObject, value: JSValue) -> JSValue {
    crate::mark_binding!();

    if !value.is_termination_exception() {
        let _ = global
            .bun_vm()
            .as_mut()
            .uncaught_exception(global, value, false);
    }
    JSValue::UNDEFINED
}

/// This function is called on another thread
/// The main difference: we need to allocate the task & wakeup the thread
/// We can avoid that if we run it from the main thread.
// HOST_EXPORT(Bun__queueTaskConcurrently, c)
pub fn queue_task_concurrently(global: &JSGlobalObject, task: *mut crate::cpp_task::CppTask) {
    crate::mark_binding!();
    // SAFETY: bun_vm_concurrently() yields the live VM; `event_loop()` never
    // returns null for a Bun-owned global. Called off-thread but the loop
    // wakeup is thread-safe.
    unsafe {
        (*(*global.bun_vm_concurrently()).event_loop())
            .enqueue_task_concurrent(ConcurrentTask::create(Task::init(task)));
    }
}

// HOST_EXPORT(Bun__handleRejectedPromise, c)
pub fn handle_rejected_promise(global: &JSGlobalObject, promise: &mut JSPromise) {
    crate::mark_binding!();

    let result = promise.result(global.vm());
    let jsc_vm = global.bun_vm().as_mut();

    // this seems to happen in some cases when GC is running
    if result.is_empty() {
        return;
    }

    jsc_vm.unhandled_rejection(global, result, promise.to_js());
    jsc_vm.auto_garbage_collect();
}

struct HandledPromiseContext {
    // VM-lifetime backref (JSC_BORROW) — `GlobalRef` encapsulates the deref.
    global_this: crate::GlobalRef,
    // PORT NOTE: Zig stored a bare JSValue rooted via `.protect()`/`.unprotect()`.
    // PORTING.md forbids bare JSValue fields on heap-allocated structs; `Strong`
    // is the prescribed root type and its `Drop` releases the handle slot.
    promise: Strong,
}

impl HandledPromiseContext {
    fn callback(context: *mut Self) -> bun_event_loop::JsResult<()> {
        // SAFETY: `context` was produced by `heap::alloc` below; we are the
        // sole owner and reconstitute the Box to drop it at end of scope.
        let context = unsafe { bun_core::heap::take(context) };
        let global: &JSGlobalObject = &context.global_this;
        // JSGlobalObject::bun_vm contract.
        let _ = global
            .bun_vm()
            .as_mut()
            .handled_promise(global, context.promise.get());
        // drop(context) — Box freed at scope exit (replaces `default_allocator.destroy`);
        // Strong's Drop replaces the explicit `.unprotect()`.
        Ok(())
    }
}

// HOST_EXPORT(Bun__handleHandledPromise, c)
pub fn handle_handled_promise(global: &JSGlobalObject, promise: &JSPromise) {
    crate::mark_binding!();
    let promise_js = promise.to_js();
    let context = bun_core::heap::into_raw(Box::new(HandledPromiseContext {
        global_this: global.into(),
        promise: Strong::create(promise_js, global),
    }));
    global
        .bun_vm()
        .event_loop_mut()
        .enqueue_task(ManagedTask::new(context, HandledPromiseContext::callback));
}

// HOST_EXPORT(Bun__onDidAppendPlugin, c)
pub fn on_did_append_plugin(jsc_vm: &mut VirtualMachine, global: &JSGlobalObject) {
    if jsc_vm.plugin_runner.is_some() {
        return;
    }

    // `Option::insert` returns `&mut PluginRunner` into the VM-owned slot;
    // `plugin_runner` and `transpiler` are disjoint fields so the split borrow
    // is fine. The slot is embedded in `*jsc_vm` and stable for the VM's
    // lifetime, so taking a raw pointer into it for the linker BACKREF is sound.
    let runner = jsc_vm.plugin_runner.insert(PluginRunner {
        global_object: bun_ptr::BackRef::new(global),
    });
    jsc_vm.transpiler.linker.plugin_runner = Some(std::ptr::from_mut::<dyn PluginResolver>(runner));
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ZigGlobalObject__uvLoop(jsc_vm: &mut VirtualMachine) -> *mut c_void {
    jsc_vm.uv_loop().cast()
}

// HOST_EXPORT(Bun__setTLSRejectUnauthorizedValue, c)
pub fn set_tls_reject_unauthorized_value(value: i32) {
    // SAFETY: VM singleton is process-lifetime.
    VirtualMachine::get()
        .as_mut()
        .default_tls_reject_unauthorized = Some(value != 0);
}

// HOST_EXPORT(Bun__getTLSRejectUnauthorizedValue, c)
pub fn get_tls_reject_unauthorized_value() -> i32 {
    // SAFETY: VM singleton is process-lifetime.
    if VirtualMachine::get().as_mut().get_tls_reject_unauthorized() {
        1
    } else {
        0
    }
}

// HOST_EXPORT(Bun__isNoProxy, c)
pub fn is_no_proxy(
    hostname_ptr: *const u8,
    hostname_len: usize,
    host_ptr: *const u8,
    host_len: usize,
) -> bool {
    // SAFETY: VM singleton is process-lifetime.
    let vm = VirtualMachine::get();
    // SAFETY: caller (C++) guarantees `hostname_ptr[..hostname_len]` is valid for reads.
    let hostname: Option<&[u8]> = if hostname_len > 0 {
        Some(unsafe { bun_core::ffi::slice(hostname_ptr, hostname_len) })
    } else {
        None
    };
    // SAFETY: caller (C++) guarantees `host_ptr[..host_len]` is valid for reads.
    let host: Option<&[u8]> = if host_len > 0 {
        Some(unsafe { bun_core::ffi::slice(host_ptr, host_len) })
    } else {
        None
    };
    vm.env_loader().is_no_proxy(hostname, host)
}

// HOST_EXPORT(Bun__setVerboseFetchValue, c)
pub fn set_verbose_fetch_value(value: i32) {
    use bun_http::HTTPVerboseLevel;
    VirtualMachine::get().as_mut().default_verbose_fetch = Some(match value {
        1 => HTTPVerboseLevel::Headers as u8,
        2 => HTTPVerboseLevel::Curl as u8,
        _ => HTTPVerboseLevel::None as u8,
    });
}

// HOST_EXPORT(Bun__getVerboseFetchValue, c)
pub fn get_verbose_fetch_value() -> i32 {
    use bun_http::HTTPVerboseLevel;
    // SAFETY: VM singleton is process-lifetime.
    match VirtualMachine::get().as_mut().get_verbose_fetch() {
        HTTPVerboseLevel::None => 0,
        HTTPVerboseLevel::Headers => 1,
        HTTPVerboseLevel::Curl => 2,
    }
}

// HOST_EXPORT(Bun__addBakeSourceProviderSourceMap, c)
pub fn add_bake_source_provider_source_map(
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

// HOST_EXPORT(Bun__addDevServerSourceProvider, c)
pub fn add_dev_server_source_provider(
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

// HOST_EXPORT(Bun__removeDevServerSourceProvider, c)
pub fn remove_dev_server_source_provider(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings
        .remove_dev_server_source_provider(opaque_source_provider, slice.slice());
}

// HOST_EXPORT(Bun__addSourceProviderSourceMap, c)
pub fn add_source_provider_source_map(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let slice = specifier.to_utf8();
    vm.source_mappings
        .put_zig_source_provider(opaque_source_provider, slice.slice());
}

// HOST_EXPORT(Bun__removeSourceProviderSourceMap, c)
pub fn remove_source_provider_source_map(
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
        usize::try_from(args.ptr[0].coerce_to_int64(global)?.max(1024 * 1024)).expect("int cast");
    let prev = crate::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT
        .swap(limit, core::sync::atomic::Ordering::Relaxed);
    crate::virtual_machine::STRING_ALLOCATION_LIMIT
        .store(limit, core::sync::atomic::Ordering::Relaxed);
    Ok(JSValue::js_number(prev as f64))
}

// ported from: src/jsc/virtual_machine_exports.zig
