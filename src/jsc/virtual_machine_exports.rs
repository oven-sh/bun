use core::ffi::c_void;
use core::ptr::NonNull;

use crate::event_loop::{ConcurrentTask, EventLoop};
use crate::rare_data::RareData;
use crate::{
    CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, Strong, Task,
    VirtualMachineRef as VirtualMachine,
};
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
    // SAFETY: bun_vm() never returns null for a Bun-owned global.
    let vm = unsafe { &*global.bun_vm() };
    // TODO(b2-cycle): `vm.ipc` is `Option<()>` until `IPCInstanceUnion` lands;
    // the connected/is_connected distinction is unrepresentable here. Mirror
    // `hasIPC` for now (Zig only differs by checking `initialized.data.is_connected()`).
    vm.ipc.is_some()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__GlobalObject__hasIPC(global: &JSGlobalObject) -> bool {
    // SAFETY: bun_vm() never returns null for a Bun-owned global.
    unsafe { (*global.bun_vm()).ipc.is_some() }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__exitDuringUncaughtException(this: &mut VirtualMachine) {
    this.exit_on_uncaught_exception = true;
}

// Zig: comptime { const Bun__Process__send = jsc.toJSHostFn(Bun__Process__send_); @export(...) }
// The #[bun_jsc::host_fn] attribute emits the callconv(jsc.conv) shim and export.
#[crate::host_fn(export = "Bun__Process__send")]
pub fn Bun__Process__send(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    crate::mark_binding!();
    // TODO(b2-cycle): `ipc::do_send(vm.get_ipc_instance().map(|i| &mut i.data), global, frame, SendTarget::Process)`
    // — `vm.ipc` is `Option<()>` until `IPCInstanceUnion` lands.
    todo!("phase-d: Bun__Process__send — ipc::do_send (IPCInstanceUnion gated)")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isBunMain(global: &JSGlobalObject, str: &BunString) -> bool {
    // SAFETY: bun_vm() never returns null for a Bun-owned global.
    str.eql_utf8(unsafe { (*global.bun_vm()).main })
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ensureProcessIPCInitialized(_global: &JSGlobalObject) {
    // getIPCInstance() will initialize a "waiting" ipc instance so this is enough.
    // it will do nothing if IPC is not enabled.
    // TODO(b2-cycle): `global.bun_vm().get_ipc_instance()` — gated on
    // `IPCInstanceUnion`; the env-var detection / lazy-init lives in
    // VirtualMachine.rs but the variant body is `()`.
}

/// This function is called on the main thread
/// The bunVM() call will assert this
#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTask(global: &JSGlobalObject, task: *mut crate::cpp_task::CppTask) {
    crate::mark_binding!();
    // SAFETY: bun_vm() / event_loop() never return null for a Bun-owned global.
    unsafe {
        (*(*global.bun_vm()).event_loop()).enqueue_task(Task::init(task));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportUnhandledError(global: &JSGlobalObject, value: JSValue) -> JSValue {
    crate::mark_binding!();

    if !value.is_termination_exception() {
        // SAFETY: bun_vm() never returns null for a Bun-owned global.
        let _ = unsafe { (*global.bun_vm()).uncaught_exception(global, value, false) };
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
    // SAFETY: bun_vm()/event_loop() never null for a Bun-owned global; called
    // off-thread but `bunVMConcurrently` and the loop wakeup are thread-safe.
    unsafe {
        (*(*global.bun_vm()).event_loop())
            .enqueue_task_concurrent(ConcurrentTask::create(Task::init(task)));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__handleRejectedPromise(global: &JSGlobalObject, promise: &mut JSPromise) {
    crate::mark_binding!();

    let result = promise.result(global.vm());
    // SAFETY: bun_vm() never returns null for a Bun-owned global.
    let jsc_vm = unsafe { &mut *global.bun_vm() };

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
    // SAFETY: bun_vm()/event_loop() never null for a Bun-owned global.
    unsafe {
        (*(*global.bun_vm()).event_loop())
            .enqueue_task(ManagedTask::new(context, HandledPromiseContext::callback));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onDidAppendPlugin(jsc_vm: &mut VirtualMachine, _global: &JSGlobalObject) {
    if jsc_vm.plugin_runner.is_some() {
        return;
    }
    // TODO(b2-cycle): `plugin_runner` is `Option<()>` (PluginRunner gated in
    // bun_bundler). Set the discriminant so `is_some()` flips; the linker hook
    // (`transpiler.linker.plugin_runner = &mut ...`) lands when the field is typed.
    jsc_vm.plugin_runner = Some(());
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
    let vm = unsafe { &*VirtualMachine::get() };
    // Spec: defaults to true when unset (NODE_TLS_REJECT_UNAUTHORIZED env consulted lazily).
    if vm.default_tls_reject_unauthorized.unwrap_or(true) { 1 } else { 0 }
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
    match unsafe { (*VirtualMachine::get()).default_verbose_fetch } {
        Some(v) if v == HTTPVerboseLevel::Headers as u8 => 1,
        Some(v) if v == HTTPVerboseLevel::Curl as u8 => 2,
        _ => 0,
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
        return Err(global.throw_invalid_arguments(
            "setSyntheticAllocationLimitForTesting expects 1 argument",
        ));
    }

    if !args.ptr[0].is_number() {
        return Err(global.throw_invalid_arguments(
            "setSyntheticAllocationLimitForTesting expects a number",
        ));
    }

    let _limit: usize =
        usize::try_from(args.ptr[0].coerce_to_int64(global)?.max(1024 * 1024)).unwrap();
    // TODO(port): `synthetic_allocation_limit` / `string_allocation_limit` are mutable
    // namespace-level vars in Zig; model as `static AtomicUsize` on VirtualMachine in Phase B.
    Ok(JSValue::js_number_from_int32(0))
}

// ════════════════════════════════════════════════════════════════════════════
// `Bun__VM__*` field accessors — opaque-handle bridge for crates that hold an
// untyped `*mut VirtualMachine` (notably `bun_sql_jsc`, which keeps its own
// view struct to avoid a crate cycle). Each is the trivial `&vm.field` Zig
// would have generated; declared here so the link names live in `bun_jsc`.
// ════════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__global(vm: *mut VirtualMachine) -> *mut JSGlobalObject {
    // SAFETY: `vm` is the live per-thread VM.
    unsafe { (*vm).global }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__eventLoop(vm: *mut VirtualMachine) -> *mut EventLoop {
    // SAFETY: `vm` is the live per-thread VM.
    unsafe { (*vm).event_loop() }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__loopRef(vm: *mut c_void) {
    // SAFETY: `vm` is the live per-thread VM (cast from sql_jsc's opaque view).
    let vm = unsafe { &*(vm as *mut VirtualMachine) };
    // SAFETY: uws loop is process-lifetime; sole `&mut` in this scope.
    unsafe { (*vm.uws_loop()).ref_() };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__loopUnref(vm: *mut c_void) {
    // SAFETY: `vm` is the live per-thread VM.
    let vm = unsafe { &*(vm as *mut VirtualMachine) };
    // SAFETY: uws loop is process-lifetime; sole `&mut` in this scope.
    unsafe { (*vm.uws_loop()).unref() };
}

/// `vm.eventLoop().deferred_tasks.postTask(ctx, cb)` — Zig
/// `AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__postDeferredTask(
    vm: *mut VirtualMachine,
    ctx: *mut c_void,
    cb: Option<unsafe extern "C" fn(*mut c_void) -> bool>,
) {
    // SAFETY: `vm` / `event_loop` are live for the JS thread.
    let el = unsafe { &mut *(*vm).event_loop() };
    // SAFETY: `extern "C" fn(*mut c_void) -> bool` and the Rust-ABI
    // `fn(*mut c_void) -> bool` (`DeferredRepeatingTask`) have identical
    // layout (one pointer arg, bool return). `None` only occurs from sql_jsc's
    // current placeholder call site, where the deferred-task path is unreached;
    // map it to a no-op task that immediately unregisters itself.
    let task: bun_event_loop::DeferredTaskQueue::DeferredRepeatingTask = match cb {
        Some(f) => unsafe { core::mem::transmute(f) },
        None => |_| false,
    };
    el.deferred_tasks.post_task(NonNull::new(ctx), task);
}

/// `vm.eventLoop().deferred_tasks.unregisterTask(ctx)` — Zig
/// `AutoFlusher.unregisterDeferredMicrotaskWithType`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__unregisterDeferredTask(vm: *mut VirtualMachine, ctx: *mut c_void) -> bool {
    // SAFETY: `vm` / `event_loop` are live for the JS thread.
    unsafe { (*(*vm).event_loop()).deferred_tasks.unregister_task(NonNull::new(ctx)) }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__enterLoop(el: *mut EventLoop) {
    // SAFETY: `el` is `&vm.event_loop` — live for the JS thread.
    unsafe { (*el).enter() };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__exitLoop(el: *mut EventLoop) {
    // SAFETY: `el` is `&vm.event_loop` — live for the JS thread.
    unsafe { (*el).exit() };
}

// ════════════════════════════════════════════════════════════════════════════
// JSCScheduler.zig — un-gated bodies (the full `JSCScheduler.rs` draft is
// `#[cfg(any())]`-gated; only the two C++→Zig exports are needed here).
// ════════════════════════════════════════════════════════════════════════════

/// `export fn Bun__eventLoop__incrementRefConcurrently(vm, delta)` — bumps the
/// event loop's `concurrent_ref` (called from off-thread JSC scheduler).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__incrementRefConcurrently(
    jsc_vm: *mut VirtualMachine,
    delta: core::ffi::c_int,
) {
    crate::mark_binding!();
    // SAFETY: `jsc_vm` is the live VM (passed from C++ BunScheduler).
    let el = unsafe { &*(*jsc_vm).event_loop() };
    if delta > 0 { el.ref_concurrently() } else { el.unref_concurrently() };
}

/// `export fn Bun__queueJSCDeferredWorkTaskConcurrently(vm, task)` — enqueue an
/// opaque `JSC::DeferredWorkTimer::Ticket` (BunVMScheduler.cpp).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    jsc_vm: *mut VirtualMachine,
    task: *mut c_void,
) {
    crate::mark_binding!();
    // SAFETY: `jsc_vm` is the live VM; called off-thread (concurrent enqueue is
    // thread-safe via `ConcurrentTask` MPSC + loop wakeup).
    unsafe {
        (*(*jsc_vm).event_loop()).enqueue_task_concurrent(ConcurrentTask::create(Task {
            tag: bun_event_loop::task_tag::JSCDeferredWorkTask,
            ptr: task.cast(),
        }));
    }
}

// ════════════════════════════════════════════════════════════════════════════
// RareData socket-group accessors — exported for `bun_sql_jsc`, which holds
// an opaque `*mut VirtualMachine` and cannot name `bun_jsc::rare_data` types
// directly. Real bodies (lazy `SocketGroup::init`) live in
// `rare_data::RareData::{postgres,mysql}_group`.
// ════════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub extern "C" fn Bun__RareData__postgresGroup(vm: *mut c_void, ssl: bool) -> *mut bun_uws::SocketGroup {
    // SAFETY: `vm` is the live per-thread VM; `rare_data()` lazy-inits.
    let vm = unsafe { &mut *(vm as *mut VirtualMachine) };
    let rare = vm.rare_data() as *mut RareData;
    // SAFETY: disjoint borrow — `postgres_group` only touches the embedded
    // `SocketGroup` field + `vm.uws_loop()`.
    unsafe {
        if ssl { (*rare).postgres_group::<true>(vm) } else { (*rare).postgres_group::<false>(vm) }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__RareData__mysqlGroup(vm: *mut c_void, ssl: bool) -> *mut bun_uws::SocketGroup {
    // SAFETY: `vm` is the live per-thread VM; `rare_data()` lazy-inits.
    let vm = unsafe { &mut *(vm as *mut VirtualMachine) };
    let rare = vm.rare_data() as *mut RareData;
    // SAFETY: disjoint borrow — `mysql_group` only touches the embedded
    // `SocketGroup` field + `vm.uws_loop()`.
    unsafe {
        if ssl { (*rare).mysql_group::<true>(vm) } else { (*rare).mysql_group::<false>(vm) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/virtual_machine_exports.zig (244 lines)
//   confidence: medium
//   todos:      7
//   notes:      IPC bodies (connectedIPC/ensureProcessIPCInitialized/Process__send) reduced while vm.ipc is Option<()>; plugin_runner sets discriminant only; verbose_fetch stored as u8 per Phase-B field type.
// ──────────────────────────────────────────────────────────────────────────
