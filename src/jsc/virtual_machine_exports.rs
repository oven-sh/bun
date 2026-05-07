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
    use crate::virtual_machine::IPCInstanceUnion;
    match &global.bun_vm().ipc {
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
    global.bun_vm().ipc.is_some()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__exitDuringUncaughtException(this: &mut VirtualMachine) {
    this.exit_on_uncaught_exception = true;
}

// Zig: comptime { const Bun__Process__send = jsc.toJSHostFn(Bun__Process__send_); @export(...) }
// The #[bun_jsc::host_fn] attribute emits the callconv(jsc.conv) shim and export.
#[crate::host_fn(export = "Bun__Process__send")]
pub fn Bun__Process__send(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    crate::mark_binding!();
    // SAFETY: bun_vm_ptr() yields the live per-thread VM (Zig `bunVM()` is
    // mutable); `get_ipc_instance` writes `self.ipc` on first call.
    let vm = unsafe { &mut *global.bun_vm_ptr() };
    // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance` (or
    // `None`); the `&mut SendQueue` borrow is scoped to this call and does not
    // alias `vm` (the instance is heap-allocated, not embedded in `vm`).
    let ipc = vm
        .get_ipc_instance()
        .map(|i| unsafe { &mut (*i).data });
    crate::ipc::do_send(ipc, global, frame, crate::ipc::FromEnum::Process)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isBunMain(global: &JSGlobalObject, str: &BunString) -> bool {
    str.eql_utf8(global.bun_vm().main)
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
    // SAFETY: `event_loop()` never returns null for a Bun-owned global.
    unsafe {
        (*global.bun_vm().event_loop()).enqueue_task(Task::init(task));
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
    // SAFETY: `event_loop()` never returns null for a Bun-owned global; called
    // off-thread but `bunVMConcurrently` and the loop wakeup are thread-safe.
    unsafe {
        (*global.bun_vm_concurrently().event_loop())
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
        let _ = global.bun_vm().handled_promise(global, context.promise.get());
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
    // SAFETY: `event_loop()` never returns null for a Bun-owned global.
    unsafe {
        (*global.bun_vm().event_loop())
            .enqueue_task(ManagedTask::new(context, HandledPromiseContext::callback));
    }
}

/// Spec PluginRunner.zig:34 `onResolve`. Dispatch body for
/// `bun_bundler::transpiler::PluginRunner.on_resolve` — defined here (the
/// construction site) because the body needs `JSGlobalObject` /
/// `runOnResolvePlugins`, which `bun_bundler` cannot name.
fn plugin_runner_on_resolve(
    global_object: *mut c_void,
    specifier: &[u8],
    importer: &[u8],
    log: &mut bun_logger::Log,
    loc: bun_logger::Loc,
    target: bun_bundler::transpiler::PluginTarget,
) -> Result<Option<bun_paths::fs::Path<'static>>, bun_core::Error> {
    use bun_bundler::transpiler::PluginRunner;
    use bun_paths::fs::Path as FsPath;
    use std::io::Write as _;

    // SAFETY: `global_object` is the `*mut JSGlobalObject` stored verbatim by
    // `Bun__onDidAppendPlugin` below; the VM (and its global) outlives every
    // `Linker::link` call that reaches this hook.
    let global = unsafe { &*global_object.cast::<JSGlobalObject>() };
    // SAFETY: `PluginTarget` and `BunPluginTarget` are both `#[repr(u8)]` with
    // identical discriminants (Bun=0, Node=1, Browser=2).
    let target: crate::BunPluginTarget = unsafe { core::mem::transmute(target) };

    let namespace_slice = PluginRunner::extract_namespace(specifier);
    let namespace = if !namespace_slice.is_empty() && namespace_slice != b"file" {
        BunString::init(namespace_slice)
    } else {
        BunString::empty()
    };
    let Some(on_resolve_plugin) = global.run_on_resolve_plugins(
        namespace,
        BunString::init(specifier).substring(if namespace.length() > 0 {
            namespace.length() + 1
        } else {
            0
        }),
        BunString::init(importer),
        target,
    )?
    else {
        return Ok(None);
    };
    let Some(path_value) = on_resolve_plugin.get(global, "path")? else {
        return Ok(None);
    };
    if path_value.is_empty_or_undefined_or_null() {
        return Ok(None);
    }
    if !path_value.is_string() {
        log.add_error(None, loc, b"Expected \"path\" to be a string")
            .expect("unreachable");
        return Ok(None);
    }

    let file_path = path_value.to_bun_string(global)?;

    if file_path.length() == 0 {
        log.add_error(
            None,
            loc,
            b"Expected \"path\" to be a non-empty string in onResolve plugin",
        )
        .expect("unreachable");
        return Ok(None);
    } else if
    // TODO: validate this better
    file_path.eql_comptime(b".")
        || file_path.eql_comptime(b"..")
        || file_path.eql_comptime(b"...")
        || file_path.eql_comptime(b" ")
    {
        log.add_error(None, loc, b"Invalid file path from onResolve plugin")
            .expect("unreachable");
        return Ok(None);
    }
    let mut static_namespace = true;
    let user_namespace: BunString = 'brk: {
        if let Some(namespace_value) = on_resolve_plugin.get(global, "namespace")? {
            if !namespace_value.is_string() {
                log.add_error(None, loc, b"Expected \"namespace\" to be a string")
                    .expect("unreachable");
                return Ok(None);
            }

            let namespace_str = namespace_value.to_bun_string(global)?;
            if namespace_str.length() == 0 {
                break 'brk BunString::init(b"file");
            }

            if namespace_str.eql_comptime(b"file") {
                break 'brk BunString::init(b"file");
            }

            if namespace_str.eql_comptime(b"bun") {
                break 'brk BunString::init(b"bun");
            }

            if namespace_str.eql_comptime(b"node") {
                break 'brk BunString::init(b"node");
            }

            static_namespace = false;

            break 'brk namespace_str;
        }

        break 'brk BunString::init(b"file");
    };

    // PORT NOTE: Zig used `std.fmt.allocPrint(this.allocator, …)` and returned
    // the allocator-owned slice by value inside `Fs.Path`. `FsPath<'static>`
    // borrows, so we leak the formatted buffer to model the same
    // caller-owns-forever contract.
    let mut path_buf: Vec<u8> = Vec::new();
    write!(&mut path_buf, "{}", file_path).expect("unreachable");
    let path_static: &'static [u8] = path_buf.leak();

    if static_namespace {
        // `byte_slice()` borrows `&self`; re-match to recover the `'static`
        // literal so the result typechecks as `FsPath<'static>` without an
        // extra alloc.
        let ns: &'static [u8] = if user_namespace.eql_comptime(b"bun") {
            b"bun"
        } else if user_namespace.eql_comptime(b"node") {
            b"node"
        } else {
            b"file"
        };
        Ok(Some(FsPath::init_with_namespace(path_static, ns)))
    } else {
        let mut ns_buf: Vec<u8> = Vec::new();
        write!(&mut ns_buf, "{}", user_namespace).expect("unreachable");
        let ns_static: &'static [u8] = ns_buf.leak();
        Ok(Some(FsPath::init_with_namespace(path_static, ns_static)))
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__onDidAppendPlugin(jsc_vm: &mut VirtualMachine, global: &JSGlobalObject) {
    if jsc_vm.plugin_runner.is_some() {
        return;
    }

    jsc_vm.plugin_runner = Some(bun_bundler::transpiler::PluginRunner {
        // PORT NOTE: `PluginRunner.global_object` is `*mut c_void` at the
        // `bun_bundler` tier (cycle-break — `JSGlobalObject` lives here); the
        // `on_resolve` dispatch slot casts it back.
        global_object: global.as_ptr().cast(),
        on_resolve: plugin_runner_on_resolve,
    });
    // SAFETY: `plugin_runner` was just set to `Some` above; the `Option` slot
    // is embedded in `*jsc_vm` and stable for the VM's lifetime, so taking a
    // raw pointer into it for the linker BACKREF is sound.
    jsc_vm.transpiler.linker.plugin_runner =
        Some(unsafe { jsc_vm.plugin_runner.as_mut().unwrap_unchecked() } as *mut _);
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
    cb: Option<bun_event_loop::DeferredTaskQueue::DeferredRepeatingTask>,
) {
    // `None` only occurs from sql_jsc's current placeholder call site, where
    // the deferred-task path is unreached; map it to a no-op that immediately
    // unregisters itself.
    unsafe extern "C" fn noop(_: *mut c_void) -> bool {
        false
    }
    // SAFETY: `vm` / `event_loop` are live for the JS thread.
    let el = unsafe { &mut *(*vm).event_loop() };
    el.deferred_tasks
        .post_task(NonNull::new(ctx), cb.unwrap_or(noop));
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
//   confidence: high
//   todos:      0
// ──────────────────────────────────────────────────────────────────────────
