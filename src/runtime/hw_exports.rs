//! phase-d: handwritten C-ABI export symbols whose bodies
//! live in `bun_jsc::VirtualMachine` but whose link names must be emitted from
//! a crate that *depends on* `bun_jsc` (so the bodies can call back into the
//! real `VirtualMachine` struct without inverting the crate DAG).
//!
//! Symbols that already have a Rust `#[export_name]` / `#[no_mangle]` elsewhere
//! are intentionally **not** re-declared here to avoid duplicate-symbol link
//! errors:
//!   - `Bun__getTLSDefaultCiphers` / `Bun__setTLSDefaultCiphers`
//!   - `Bun__Process__getStdinFdType`
//!       → `src/jsc/rare_data.rs`
//!   - `Resolver__nodeModulePathsForJS` / `Resolver__nodeModulePathsJSValue`
//!       → `src/jsc/resolver_jsc.rs`
//!   - `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming`
//!       → `src/runtime/webcore/wasm_streaming.rs`
//!   - `Bun__Chrome__autoDetect` / `Bun__Chrome__ensure`
//!       → `src/runtime/webview/ChromeProcess.rs`
//!   - `Bun__JSSourceMap__find`
//!       → `src/sourcemap_jsc/JSSourceMap.rs`
//!   - `Bun__Process__send`
//!       → `bun_jsc::virtual_machine_exports`

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSInternalPromise, JSValue, StringJsc as _, ZigStackFrame,
};

// ─── VirtualMachine ──────────────────────────────────────────────────────────
//
// `#[no_mangle] extern "C"` thunks for these are emitted by
// `src/codegen/generate-host-exports.ts` into `generated_host_exports.rs`;
// the safe-signature impls below are what the thunks call. Each `// HOST_EXPORT`
// marker is the scrape input — keep it on the line immediately above `pub fn`.

/// `export fn Bun__isMainThreadVM() callconv(.c) bool { return get().is_main_thread; }`
// HOST_EXPORT(Bun__isMainThreadVM, c)
pub fn is_main_thread_vm() -> bool {
    VirtualMachine::get().as_mut().is_main_thread
}

/// `export fn Bun__drainMicrotasksFromJS(global, callframe) callconv(jsc.conv) JSValue`
///
/// Returns plain `JSValue` (not `JsResult`) so the generated thunk is a bare
/// deref+call with no `ExceptionValidationScope`.
/// `drain_microtasks()` runs arbitrary microtasks; wrapping in a
/// scope would trip `assert_exception_presence_matches(false)` if one left an
/// exception pending while we return `UNDEFINED`.
// HOST_EXPORT(Bun__drainMicrotasksFromJS)
pub fn drain_microtasks_from_js(global: &JSGlobalObject, _cf: &CallFrame) -> JSValue {
    // Hot path (~2×/request via cork callback chain): pass the incoming
    // `global` straight through instead of re-deriving it via
    // TLS→vm→event_loop→vm→global (4 dependent loads — perf root-cause #1).
    // `as_mut()` ignores its receiver and re-reads the TLS slot anyway, so go
    // straight to the thread-local for the VM.
    let vm = VirtualMachine::get_mut();
    let jsc_vm = global.vm();
    let _ = vm
        .event_loop_mut()
        .drain_microtasks_with_global(global, jsc_vm);
    JSValue::UNDEFINED
}

/// `export fn Bun__logUnhandledException(exception: JSValue) void { get().runErrorHandler(exception, null); }`
// HOST_EXPORT(Bun__logUnhandledException, c)
pub fn log_unhandled_exception(exception: JSValue) {
    VirtualMachine::get()
        .as_mut()
        .run_error_handler(exception, None);
}

/// `export fn Bun__remapStackFramePositions(vm, frames, frames_count)` —
/// **may run on the heap-collector thread** (see oven-sh/bun#17087); the
/// underlying method serializes on `remap_stack_frames_mutex`.
///
/// # Safety
/// `frames` must point to a live array of `frames_count` `ZigStackFrame`s.
// HOST_EXPORT(Bun__remapStackFramePositions, c)
// Forwards `frames` to the C++-side remapper without dereferencing; not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn remap_stack_frame_positions(
    vm: &mut VirtualMachine,
    frames: *mut ZigStackFrame,
    frames_count: usize,
) {
    // SAFETY: `frames[..frames_count]` is a live C++ array; the method takes
    // the raw ptr because it forwards to the C++-side remapper.
    unsafe { vm.remap_stack_frame_positions(frames, frames_count) };
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMain(vm, is_patched)`
// HOST_EXPORT(Bun__VirtualMachine__setOverrideModuleRunMain, c)
pub fn set_override_module_run_main(vm: &mut VirtualMachine, is_patched: bool) {
    if vm.is_in_preload {
        vm.has_patched_run_main = is_patched;
    }
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(vm, promise)`
// HOST_EXPORT(Bun__VirtualMachine__setOverrideModuleRunMainPromise, c)
pub fn set_override_module_run_main_promise(
    vm: &mut VirtualMachine,
    promise: *mut JSInternalPromise,
) {
    if vm.pending_internal_promise.is_none() {
        vm.pending_internal_promise = Some(promise);
        vm.pending_internal_promise_is_protected = false;
    }
}

/// Exported as `Bun__VM__setEntryPointEvalResultESM`.
// HOST_EXPORT(Bun__VM__setEntryPointEvalResultESM, c)
pub fn set_entry_point_eval_result_esm(this: &mut VirtualMachine, result: JSValue) {
    // allow esm evaluate to set value multiple times
    if !this.entry_point_result.cjs_set_value {
        // `global()` returns `&'static`, decoupled from `this` for the
        // disjoint `&mut this.entry_point_result` borrow.
        let global = this.global();
        this.entry_point_result.value.set(global, result);
    }
}

/// Exported as `Bun__VM__setEntryPointEvalResultCJS`.
// HOST_EXPORT(Bun__VM__setEntryPointEvalResultCJS, c)
pub fn set_entry_point_eval_result_cjs(this: &mut VirtualMachine, value: JSValue) {
    if !this.entry_point_result.value.has() {
        // `global()` returns `&'static`, decoupled from `this` for the
        // disjoint `&mut this.entry_point_result` borrow.
        let global = this.global();
        this.entry_point_result.value.set(global, value);
        this.entry_point_result.cjs_set_value = true;
    }
}

/// Exported as `Bun__VM__specifierIsEvalEntryPoint`.
// HOST_EXPORT(Bun__VM__specifierIsEvalEntryPoint, c)
pub fn specifier_is_eval_entry_point(this: &mut VirtualMachine, specifier: JSValue) -> bool {
    if let Some(eval_source) = this.module_loader.eval_source.as_ref() {
        let global = this.global();
        let specifier_str =
            bun_core::String::from_js(specifier, global).expect("unexpected exception");
        return specifier_str.eql_utf8(eval_source.path.text);
    }
    false
}

/// Called once by JSCommonJSModule.cpp for the root CJS module so the run command reports
/// origin `uncaughtException`. `main()` compare filters out an ESM entry that `import`s CJS.
// HOST_EXPORT(Bun__VM__noteCommonJSEvaluation, c)
pub fn note_commonjs_evaluation(this: &mut VirtualMachine, specifier: JSValue) {
    if this.entry_point_result.evaluated_as_cjs || this.main().is_empty() {
        return;
    }
    let global = this.global();
    // A failed conversion just skips the note; must never panic at an FFI
    // boundary.
    let Ok(specifier_str) = bun_core::String::from_js(specifier, global) else {
        return;
    };
    if specifier_str.eql_utf8(this.main()) {
        this.entry_point_result.evaluated_as_cjs = true;
    }
}

/// `export fn Bun__closeChildIPC(global)` — defers the actual socket close to
/// the next tick on the event loop.
// HOST_EXPORT(Bun__closeChildIPC, c)
pub fn close_child_ipc(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if let Some(current_ipc) = crate::ipc_host::get_ipc_instance(vm) {
        // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance`.
        unsafe { (*current_ipc).data().disconnect() };
    }
}

// ─── sql_jsc bridge — `bun_sql_jsc::jsc::SqlRuntimeHooks` vtable ─────────────
//
// `bun_sql_jsc` cannot name `RuntimeState` / `socket::SSLConfig::from_js`
// (this crate depends on it). Instead of Rust→Rust `extern "C"` re-decls (which let the
// two sides silently disagree on pointee layout), the low tier defines
// [`bun_sql_jsc::jsc::SqlRuntimeHooks`] and this crate registers a `&'static`
// instance, `__BUN_SQL_RUNTIME_HOOKS`. Every fn-pointer signature is
// type-checked at the struct-literal below.

mod sql_hooks {
    use super::*;
    use bun_sql_jsc::jsc::{RareData as SqlRareData, SqlRuntimeHooks};

    fn with_sql_state(f: &mut dyn FnMut(&mut SqlRareData)) {
        crate::jsc_hooks::with_sql_state(f)
    }
    fn timer_insert(timer: crate::timer::TimerRef) {
        crate::jsc_hooks::timer_all().insert(timer);
    }
    fn timer_remove(timer: crate::timer::TimerRef) {
        crate::jsc_hooks::timer_all().remove(timer);
    }
    fn ssl_config_from_js(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> bun_jsc::JsResult<Option<bun_http::SSLConfig>> {
        use crate::socket::SSLConfigFromJs;
        crate::socket::SSLConfig::from_js(global.bun_vm_ref(), global, value)
    }
    /// Declared `extern "Rust"` in `bun_sql_jsc::jsc`; link-time resolved.
    #[unsafe(no_mangle)]
    static __BUN_SQL_RUNTIME_HOOKS: SqlRuntimeHooks = SqlRuntimeHooks {
        with_sql_state,
        timer_insert,
        timer_remove,
        ssl_config_from_js,
    };
}

// ─── entry-point promise reactions (used by `--print`) ───────────────────────

// HOST_EXPORT(Bun__onResolveEntryPointResult)
pub fn on_resolve_entry_point_result(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> bun_jsc::JsResult<JSValue> {
    let result = callframe.argument(0);
    // SAFETY: `vals[..len]` is the single stack `result`; `ctype` is ignored by
    // `message_with_type_and_level` (it always resolves the per-VM console via
    // `vm_console(global)`), so null is fine.
    unsafe {
        bun_jsc::ConsoleObject::message_with_type_and_level(
            core::ptr::null_mut(),
            bun_jsc::ConsoleObject::MessageType::Log,
            bun_jsc::ConsoleObject::MessageLevel::Log,
            global,
            &raw const result,
            1,
        );
    }
    // SAFETY: bun_vm() never null for a Bun-owned global.
    bun_core::Global::exit(u32::from(global.bun_vm().as_mut().exit_handler.exit_code));
}

// HOST_EXPORT(Bun__onRejectEntryPointResult)
pub fn on_reject_entry_point_result(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> bun_jsc::JsResult<JSValue> {
    let result = callframe.argument(0);
    // SAFETY: `vals[..len]` is the single stack `result`; `ctype` is ignored by
    // `message_with_type_and_level` (it always resolves the per-VM console via
    // `vm_console(global)`), so null is fine.
    unsafe {
        bun_jsc::ConsoleObject::message_with_type_and_level(
            core::ptr::null_mut(),
            bun_jsc::ConsoleObject::MessageType::Log,
            bun_jsc::ConsoleObject::MessageLevel::Log,
            global,
            &raw const result,
            1,
        );
    }
    // SAFETY: bun_vm() never null for a Bun-owned global.
    bun_core::Global::exit(u32::from(global.bun_vm().as_mut().exit_handler.exit_code));
}

// ─── bindgenv2 dispatch shims (`bindgen_*_dispatch*`) ────────────────────────
//
// These satisfy the `extern "C"` refs C++ emits from
// `Generated*Bindings.cpp`. Each forwards to the real Rust port of the named
// fn and maps `JsResult` → bool/JSValue per the bindgen ABI.

/// `NodeModuleModule._stat(path) -> i32` (0=file, 1=dir, -ENOENT otherwise).
///
/// # Safety
/// `out` must be a valid C++ stack local.
#[unsafe(no_mangle)]
unsafe extern "C" fn bindgen_NodeModuleModule_dispatch_stat1(
    _global: *mut JSGlobalObject,
    arg_str: &bun_core::String,
    out: *mut i32,
) -> bool {
    let s = arg_str.to_utf8();
    // SAFETY: `out` is a valid C++ stack out-param.
    unsafe { *out = bun_jsc::node_module_module::stat(s.slice()) };
    true
}

/// `BunObject.braces(input, options) -> JSValue`.
///
/// # Safety
/// `arg_options` must be a valid C++ stack local.
// HOST_EXPORT(bindgen_BunObject_dispatchBraces1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_bunobject_dispatch_braces(
    global: &JSGlobalObject,
    input: &bun_core::String,
    arg_options: *const crate::api::bun_object::r#gen::BracesOptions,
) -> JSValue {
    // SAFETY: `arg_options` points to a `BracesOptions` on the C++ caller's stack.
    let opts = unsafe { *arg_options };
    bun_jsc::host_fn::to_js_host_call(global, || {
        crate::api::bun_object::braces(global, input, opts)
    })
}

/// `BunObject.gc(force) -> usize` (heap size after collection).
///
/// # Safety
/// `arg_force` and `out` must be valid C++ stack locals.
// HOST_EXPORT(bindgen_BunObject_dispatchGc1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_bunobject_dispatch_gc(
    global: &JSGlobalObject,
    arg_force: *const bool,
    out: *mut usize,
) -> bool {
    // SAFETY: `arg_force`/`out` are valid C++ stack locals.
    let force = unsafe { *arg_force };
    // `garbage_collect(force)`: mimalloc cleanup, then sync `runGC(true)`
    // when `force`, else `collect_async()` + `heap_size()`.
    // SAFETY: bun_vm() never null for a Bun-owned global.
    unsafe { *out = global.bun_vm().as_mut().garbage_collect(force) };
    true
}

/// `fmt_jsc.js_bindings.fmtString(code, formatter) -> bun.String`
/// (highlighter.test.ts internal).
///
/// # Safety
/// `arg_formatter` and `out` must be valid C++ stack locals.
// HOST_EXPORT(bindgen_Fmt_jsc_dispatchFmtString1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_fmt_jsc_dispatch_fmt_string(
    global: &JSGlobalObject,
    arg_code: &bun_core::String,
    arg_formatter: *const bun_jsc::fmt_jsc::js_bindings::Formatter,
    out: *mut bun_core::String,
) -> bool {
    let code = arg_code.to_utf8();
    // SAFETY: `arg_formatter` points to a `Formatter` on the C++ caller's stack.
    let formatter = unsafe { *arg_formatter };
    bindgen_out(
        global,
        out,
        bun_jsc::fmt_jsc::js_bindings::fmt_string(global, code.slice(), formatter),
    )
}

/// `DevServer.getDeinitCountForTesting() -> usize`.
///
/// # Safety
/// `out` must be a valid C++ stack out-param.
#[unsafe(no_mangle)]
unsafe extern "C" fn bindgen_DevServer_dispatchGetDeinitCountForTesting1(
    _global: *mut JSGlobalObject,
    out: *mut usize,
) -> bool {
    // SAFETY: `out` is a valid C++ stack local out-param.
    unsafe { *out = crate::bake::get_deinit_count_for_testing() };
    true
}

// ─── bindgen dispatch shims: Bindgen_test (src/jsc/bindgen_test.rs) ──────────

/// `bindgen_test.add(a, b) -> i32` — bindgen self-test (overflow throws).
///
/// # Safety
/// `arg_a`, `arg_b`, and `out` must be valid C++ stack locals.
// HOST_EXPORT(bindgen_Bindgen_test_dispatchAdd1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_bindgen_test_dispatch_add(
    global: &JSGlobalObject,
    arg_a: *const i32,
    arg_b: *const i32,
    out: *mut i32,
) -> bool {
    // SAFETY: `arg_a`/`arg_b`/`out` are valid C++ stack locals (see
    // GeneratedBindings.cpp:149).
    match bun_jsc::bindgen_test::add(global, unsafe { *arg_a }, unsafe { *arg_b }) {
        Ok(v) => {
            // SAFETY: `out` is a valid C++ stack out-param.
            unsafe { *out = v };
            true
        }
        Err(bun_jsc::JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory();
            false
        }
        Err(_) => false,
    }
}

/// `#[repr(C)]` mirror of the bindgen optional-arg communication
/// buffer. Field order is {b_set, d_set, d_value,
/// b_value} — declaration-ordered, NOT size-sorted.
#[repr(C)]
struct BindgenTestRequiredAndOptionalArgArguments {
    pub b_set: bool,
    pub d_set: bool,
    pub d_value: u8,
    pub b_value: usize,
}

/// `bindgen_test.requiredAndOptionalArg(a, b?, c, d?) -> i32`.
///
/// # Safety
/// `arg_a`, `arg_c`, `buf`, and `out` must be valid C++ stack locals.
#[unsafe(no_mangle)]
unsafe extern "C" fn bindgen_Bindgen_test_dispatchRequiredAndOptionalArg1(
    _global: *mut JSGlobalObject,
    arg_a: *const bool,
    arg_c: *const i32,
    buf: *mut BindgenTestRequiredAndOptionalArgArguments,
    out: *mut i32,
) -> bool {
    // SAFETY: all pointers are valid C++ stack locals; `buf` fields are read
    // gated on their `_set` flags (matching `if buf.b_set buf.b_value else null`).
    let buf = unsafe { &*buf };
    // SAFETY: `arg_a`/`arg_c` point to scalars on the C++ caller's stack.
    let v = bun_jsc::bindgen_test::required_and_optional_arg(
        unsafe { *arg_a },
        if buf.b_set { Some(buf.b_value) } else { None },
        unsafe { *arg_c },
        if buf.d_set { Some(buf.d_value) } else { None },
    );
    // SAFETY: `out` is a valid C++ stack out-param.
    unsafe { *out = v };
    true
}

// ─── bindgen dispatch shims: Node_os (src/runtime/node/node_os.rs) ───────────

use crate::node::os as node_os;

/// Maps `JsResult<T>` → bindgen's bool-return ABI: `true` writes `*out`,
/// `false` leaves a pending exception (throwing OOM if needed).
#[inline]
fn bindgen_out<T>(global: &JSGlobalObject, out: *mut T, r: bun_jsc::JsResult<T>) -> bool {
    match r {
        Ok(v) => {
            // SAFETY: `out` is a valid C++ stack out-param.
            unsafe { out.write(v) };
            true
        }
        Err(bun_jsc::JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory();
            false
        }
        Err(_) => false,
    }
}

// HOST_EXPORT(bindgen_Node_os_dispatchCpus1)
pub fn bindgen_node_os_cpus(global: &JSGlobalObject) -> bun_jsc::JsResult<JSValue> {
    node_os::cpus(global)
}

/// # Safety
/// `out` must be a valid C++ stack out-param.
#[unsafe(no_mangle)]
unsafe extern "C" fn bindgen_Node_os_dispatchFreemem1(
    _global: *mut JSGlobalObject,
    out: *mut u64,
) -> bool {
    // SAFETY: `out` is a valid C++ stack out-param. `freemem()` is infallible.
    unsafe { *out = node_os::freemem() };
    true
}

/// # Safety
/// `arg_pid` and `out` must be valid C++ stack locals.
// HOST_EXPORT(bindgen_Node_os_dispatchGetPriority1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_node_os_dispatch_get_priority(
    global: &JSGlobalObject,
    arg_pid: *const i32,
    out: *mut i32,
) -> bool {
    // SAFETY: `arg_pid`/`out` are valid C++ stack locals.
    bindgen_out(
        global,
        out,
        node_os::get_priority(global, unsafe { *arg_pid }),
    )
}

// HOST_EXPORT(bindgen_Node_os_dispatchHomedir1, c)
pub fn bindgen_node_os_dispatch_homedir(
    global: &JSGlobalObject,
    out: *mut bun_core::String,
) -> bool {
    bindgen_out(global, out, node_os::homedir(global))
}

// HOST_EXPORT(bindgen_Node_os_dispatchHostname1)
pub fn bindgen_node_os_hostname(global: &JSGlobalObject) -> bun_jsc::JsResult<JSValue> {
    node_os::hostname(global)
}

// HOST_EXPORT(bindgen_Node_os_dispatchLoadavg1)
pub fn bindgen_node_os_loadavg(global: &JSGlobalObject) -> bun_jsc::JsResult<JSValue> {
    node_os::loadavg(global)
}

// HOST_EXPORT(bindgen_Node_os_dispatchNetworkInterfaces1)
pub fn bindgen_node_os_network_interfaces(global: &JSGlobalObject) -> bun_jsc::JsResult<JSValue> {
    node_os::network_interfaces(global)
}

/// # Safety
/// `out` must be a valid C++ stack out-param.
#[unsafe(no_mangle)]
unsafe extern "C" fn bindgen_Node_os_dispatchRelease1(
    _global: *mut JSGlobalObject,
    out: *mut bun_core::String,
) -> bool {
    // SAFETY: `out` is a valid C++ stack out-param. `release()` is infallible.
    unsafe { out.write(node_os::release()) };
    true
}

/// # Safety
/// `out` must be a valid C++ stack out-param.
#[unsafe(no_mangle)]
unsafe extern "C" fn bindgen_Node_os_dispatchTotalmem1(
    _global: *mut JSGlobalObject,
    out: *mut u64,
) -> bool {
    // SAFETY: `out` is a valid C++ stack out-param. `totalmem()` is infallible.
    unsafe { *out = node_os::totalmem() };
    true
}

// HOST_EXPORT(bindgen_Node_os_dispatchUptime1, c)
pub fn bindgen_node_os_dispatch_uptime(global: &JSGlobalObject, out: *mut f64) -> bool {
    bindgen_out(global, out, node_os::uptime(global))
}

/// # Safety
/// `arg_options` must be a valid C++ stack local.
// HOST_EXPORT(bindgen_Node_os_dispatchUserInfo1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_node_os_dispatch_user_info(
    global: &JSGlobalObject,
    arg_options: *const crate::node::os::gen_::UserInfoOptions,
) -> JSValue {
    // SAFETY: `arg_options` is a valid C++ stack local; `UserInfoOptions` is
    // `#[repr(C)]` matching the bindgen `extern struct`. Borrowed: its strings
    // are `Bun::toString` views owned by the C++ frame.
    let options = unsafe { &*arg_options };
    bun_jsc::host_fn::to_js_host_call(global, || node_os::user_info(global, options))
}

// HOST_EXPORT(bindgen_Node_os_dispatchVersion1, c)
pub fn bindgen_node_os_dispatch_version(
    global: &JSGlobalObject,
    out: *mut bun_core::String,
) -> bool {
    bindgen_out(global, out, node_os::version())
}

/// # Safety
/// `arg_pid` and `arg_priority` must be valid C++ stack locals.
// HOST_EXPORT(bindgen_Node_os_dispatchSetPriority1, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_node_os_dispatch_set_priority1(
    global: &JSGlobalObject,
    arg_pid: *const i32,
    arg_priority: *const i32,
) -> bool {
    // SAFETY: `arg_pid`/`arg_priority` are valid C++ stack locals.
    bindgen_out(
        global,
        std::ptr::from_mut::<()>(&mut ()),
        node_os::set_priority1(global, unsafe { *arg_pid }, unsafe { *arg_priority }),
    )
}

/// # Safety
/// `arg_priority` must be a valid C++ stack local.
// HOST_EXPORT(bindgen_Node_os_dispatchSetPriority2, c)
// Called only from the generated `extern "C"` thunk; C++ guarantees non-null stack locals.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn bindgen_node_os_dispatch_set_priority2(
    global: &JSGlobalObject,
    arg_priority: *const i32,
) -> bool {
    // SAFETY: `arg_priority` is a valid C++ stack local.
    bindgen_out(
        global,
        std::ptr::from_mut::<()>(&mut ()),
        node_os::set_priority2(global, unsafe { *arg_priority }),
    )
}

// ─── js2native bindgen create-callback exports (GeneratedJS2Native.h) ────────
//
// `js2native_bindgen_<ns>_<fn>` returns a freshly-minted `JSFunction` wrapping
// the C++-side `bindgen_<ns>_js<Fn>` host fn. The C++ side already exports the
// host fn (it lives in `Generated*Bindings.cpp`); we just call
// `NewRuntimeFunction` here.
//
// ABI: `generate-js2native.ts` declares these on the C++ side as
// `extern "C" SYSV_ABI ...(Zig::GlobalObject*)` (the `callJS2Native` switch
// dispatches through them), so the Rust thunk MUST be `jsc` (sysv64 on
// win-x64), not plain `c`. With `c`, the win-x64 callee read `global` from
// RCX while C++ passed it in RDI → garbage `&JSGlobalObject` propagated into
// `Bun__CreateFFIFunctionValue` → `getVM(garbage)` segfault on first
// `bun:internal-for-testing` import.

bun_jsc::jsc_abi_extern! {
    // C++-side host fns (Generated*Bindings.cpp).
    fn bindgen_Fmt_jsc_jsFmtString(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
    fn bindgen_DevServer_jsGetDeinitCountForTesting(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
}

// HOST_EXPORT(js2native_bindgen_fmt_jsc_fmtString, jsc)
pub fn js2native_bindgen_fmt_jsc_fmt_string(global: &JSGlobalObject) -> JSValue {
    let name = bun_core::EncodedSlice::latin1(b"fmtString");
    bun_jsc::host_fn::new_runtime_function(
        global,
        Some(&name),
        3,
        bindgen_Fmt_jsc_jsFmtString,
        false,
        None,
    )
}

// HOST_EXPORT(js2native_bindgen_DevServer_getDeinitCountForTesting, jsc)
pub fn js2native_bindgen_dev_server_get_deinit_count(global: &JSGlobalObject) -> JSValue {
    let name = bun_core::EncodedSlice::latin1(b"getDeinitCountForTesting");
    bun_jsc::host_fn::new_runtime_function(
        global,
        Some(&name),
        0,
        bindgen_DevServer_jsGetDeinitCountForTesting,
        false,
        None,
    )
}

// `Bun__Chrome__autoDetect` / `Bun__Chrome__ensure` — exported from
// `crate::webview::chrome_process` (mod webview is declared in lib.rs).
//
// `Bun__JSSourceMap__find` — exported from `bun_sourcemap_jsc::js_source_map`
// via `#[bun_jsc::host_fn(export = ...)]`.
