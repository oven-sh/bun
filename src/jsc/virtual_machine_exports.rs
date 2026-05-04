use core::ffi::c_void;

use crate::ipc;
use crate::{
    CallFrame, ConcurrentTask, CppTask, JSGlobalObject, JSPromise, JSValue, JsResult, ManagedTask,
    Strong, Task, VirtualMachine,
};
use bun_sourcemap::{BakeSourceProvider, DevServerSourceProvider};
use bun_str::String as BunString;
use bun_transpiler::PluginRunner;

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
    VirtualMachine::get().event_loop().tick();
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__readOriginTimer(vm: &VirtualMachine) -> u64 {
    // Check if performance.now() is overridden (for fake timers)
    if let Some(overridden) = vm.overridden_performance_now {
        return overridden;
    }
    vm.origin_timer.read()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__readOriginTimerStart(vm: &VirtualMachine) -> f64 {
    // timespce to milliseconds
    ((vm.origin_timestamp as f64) + VirtualMachine::ORIGIN_RELATIVE_EPOCH) / 1_000_000.0
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__GlobalObject__connectedIPC(global: &JSGlobalObject) -> bool {
    if let Some(ipc) = &global.bun_vm().ipc {
        // TODO(port): exact IPC enum variant name (`.initialized` in Zig)
        if let ipc::State::Initialized(initialized) = ipc {
            return initialized.data.is_connected();
        }
        return true;
    }
    false
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__GlobalObject__hasIPC(global: &JSGlobalObject) -> bool {
    if global.bun_vm().ipc.is_some() {
        return true;
    }
    false
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__exitDuringUncaughtException(this: &mut VirtualMachine) {
    this.exit_on_uncaught_exception = true;
}

// Zig: comptime { const Bun__Process__send = jsc.toJSHostFn(Bun__Process__send_); @export(...) }
// The #[bun_jsc::host_fn] attribute emits the callconv(jsc.conv) shim and export.
// TODO(port): confirm host_fn macro emits `#[unsafe(export_name = "Bun__Process__send")]`
#[bun_jsc::host_fn]
pub fn Bun__Process__send(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    crate::mark_binding!();

    let vm = global.bun_vm();
    ipc::do_send(
        vm.get_ipc_instance().map(|i| &mut i.data),
        global,
        frame,
        // TODO(port): enum literal `.process` — confirm variant path
        ipc::SendTarget::Process,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isBunMain(global: &JSGlobalObject, str: &BunString) -> bool {
    str.eql_utf8(global.bun_vm().main.as_ref())
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ensureProcessIPCInitialized(global: &JSGlobalObject) {
    // getIPC() will initialize a "waiting" ipc instance so this is enough.
    // it will do nothing if IPC is not enabled.
    let _ = global.bun_vm().get_ipc_instance();
}

/// This function is called on the main thread
/// The bunVM() call will assert this
#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTask(global: &JSGlobalObject, task: *mut CppTask) {
    crate::mark_binding!();

    global.bun_vm().event_loop().enqueue_task(Task::init(task));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportUnhandledError(global: &JSGlobalObject, value: JSValue) -> JSValue {
    crate::mark_binding!();

    if !value.is_termination_exception() {
        let _ = global.bun_vm().uncaught_exception(global, value, false);
    }
    JSValue::UNDEFINED
}

/// This function is called on another thread
/// The main difference: we need to allocate the task & wakeup the thread
/// We can avoid that if we run it from the main thread.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTaskConcurrently(global: &JSGlobalObject, task: *mut CppTask) {
    crate::mark_binding!();

    global
        .bun_vm_concurrently()
        .event_loop()
        .enqueue_task_concurrent(ConcurrentTask::create(Task::init(task)));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__handleRejectedPromise(global: &JSGlobalObject, promise: &JSPromise) {
    crate::mark_binding!();

    let result = promise.result(global.vm());
    let jsc_vm = global.bun_vm();

    // this seems to happen in some cases when GC is running
    if result.is_empty() {
        return;
    }

    jsc_vm.unhandled_rejection(global, result, promise.to_js());
    jsc_vm.auto_garbage_collect();
}

struct HandledPromiseContext<'a> {
    global_this: &'a JSGlobalObject,
    // PORT NOTE: Zig stored a bare JSValue rooted via `.protect()`/`.unprotect()`.
    // PORTING.md forbids bare JSValue fields on heap-allocated structs; `Strong`
    // is the prescribed root type and its `Drop` releases the handle slot.
    promise: Strong,
}

impl<'a> HandledPromiseContext<'a> {
    fn callback(context: *mut Self) {
        // SAFETY: `context` was produced by `Box::into_raw` below; we are the
        // sole owner and reconstitute the Box to drop it at end of scope.
        let context = unsafe { Box::from_raw(context) };
        let _ = context
            .global_this
            .bun_vm()
            .handled_promise(context.global_this, context.promise.get());
        // drop(context) — Box freed at scope exit (replaces `default_allocator.destroy`);
        // Strong's Drop replaces the explicit `.unprotect()`.
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__handleHandledPromise(global: &JSGlobalObject, promise: &JSPromise) {
    crate::mark_binding!();
    let promise_js = promise.to_js();
    let context = Box::into_raw(Box::new(HandledPromiseContext {
        global_this: global,
        promise: Strong::create(promise_js, global),
    }));
    // TODO(port): ManagedTask::new generic-over-context API — Zig: ManagedTask.New(Context, Context.callback).init(context)
    global
        .bun_vm()
        .event_loop()
        .enqueue_task(ManagedTask::new(context, HandledPromiseContext::callback));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onDidAppendPlugin(jsc_vm: &mut VirtualMachine, global: &JSGlobalObject) {
    if jsc_vm.plugin_runner.is_some() {
        return;
    }

    jsc_vm.plugin_runner = Some(PluginRunner {
        global_object: global,
        // TODO(port): Zig passed `jsc_vm.allocator`; allocator params are dropped in Rust
    });
    // PORT NOTE: reshaped for borrowck — take ref to the just-assigned Option
    jsc_vm.transpiler.linker.plugin_runner = jsc_vm.plugin_runner.as_mut().map(|p| p as *mut _);
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ZigGlobalObject__uvLoop(
    jsc_vm: &mut VirtualMachine,
) -> *mut bun_sys::windows::libuv::Loop {
    jsc_vm.uv_loop()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__setTLSRejectUnauthorizedValue(value: i32) {
    VirtualMachine::get().default_tls_reject_unauthorized = Some(value != 0);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getTLSRejectUnauthorizedValue() -> i32 {
    if VirtualMachine::get().get_tls_reject_unauthorized() {
        1
    } else {
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isNoProxy(
    hostname_ptr: *const u8,
    hostname_len: usize,
    host_ptr: *const u8,
    host_len: usize,
) -> bool {
    let vm = VirtualMachine::get();
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
    vm.transpiler.env.is_no_proxy(hostname, host)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__setVerboseFetchValue(value: i32) {
    // TODO(port): confirm enum path for VerboseFetch (`.headers`/`.curl`/`.none`)
    VirtualMachine::get().default_verbose_fetch = Some(if value == 1 {
        bun_http::VerboseFetch::Headers
    } else if value == 2 {
        bun_http::VerboseFetch::Curl
    } else {
        bun_http::VerboseFetch::None
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getVerboseFetchValue() -> i32 {
    match VirtualMachine::get().get_verbose_fetch() {
        bun_http::VerboseFetch::None => 0,
        bun_http::VerboseFetch::Headers => 1,
        bun_http::VerboseFetch::Curl => 2,
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
        slice.as_bytes(),
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
        slice.as_bytes(),
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
    vm.source_mappings.remove_dev_server_source_provider(
        opaque_source_provider.cast::<DevServerSourceProvider>(),
        slice.as_bytes(),
    );
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
        .put_zig_source_provider(opaque_source_provider, slice.as_bytes());
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
        .remove_zig_source_provider(opaque_source_provider, slice.as_bytes());
}

#[bun_jsc::host_fn]
pub fn Bun__setSyntheticAllocationLimitForTesting(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let args = frame.arguments_old(1);
    if args.len() < 1 {
        return global.throw_not_enough_arguments(
            "setSyntheticAllocationLimitForTesting",
            1,
            args.len(),
        );
    }

    if !args[0].is_number() {
        return global.throw_invalid_arguments(
            "setSyntheticAllocationLimitForTesting expects a number",
            (),
        );
    }

    let limit: usize =
        usize::try_from(args[0].coerce_to_int64(global)?.max(1024 * 1024)).unwrap();
    // TODO(port): `synthetic_allocation_limit` / `string_allocation_limit` are mutable
    // namespace-level vars in Zig; model as `static AtomicUsize` on VirtualMachine in Phase B.
    let prev = VirtualMachine::synthetic_allocation_limit();
    VirtualMachine::set_synthetic_allocation_limit(limit);
    VirtualMachine::set_string_allocation_limit(limit);
    Ok(JSValue::js_number(prev))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/virtual_machine_exports.zig (244 lines)
//   confidence: medium
//   todos:      7
//   notes:      cross-crate enum paths (IPC state, VerboseFetch, ManagedTask API) and VM static-var accessors are guessed; HandledPromiseContext stores &'a JSGlobalObject per LIFETIMES.tsv but is heap-boxed across an event-loop tick — Phase B should re-check soundness.
// ──────────────────────────────────────────────────────────────────────────
