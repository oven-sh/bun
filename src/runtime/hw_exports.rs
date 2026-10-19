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

use core::ffi::c_void;

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
pub(crate) fn is_main_thread_vm() -> bool {
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
pub(crate) fn drain_microtasks_from_js(global: &JSGlobalObject, _cf: &CallFrame) -> JSValue {
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
pub(crate) fn log_unhandled_exception(exception: JSValue) {
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
pub(crate) fn remap_stack_frame_positions(
    vm: &mut VirtualMachine,
    frames: *mut ZigStackFrame,
    frames_count: usize,
) {
    // The collector thread is not otherwise a Bun thread: give it the per-thread output source a source-map warning writes
    // through and the stack bound the map parser's recursion guard reads (idempotent), and flush what it wrote, since
    // nothing else on that thread will.
    let on_js_thread = VirtualMachine::get_or_null().is_some();
    bun_core::output::Source::configure_thread();
    // SAFETY: `frames[..frames_count]` is a live C++ array; the method takes
    // the raw ptr because it forwards to the C++-side remapper.
    unsafe { vm.remap_stack_frame_positions(frames, frames_count) };
    if !on_js_thread {
        bun_core::output::flush();
    }
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMain(vm, is_patched)`
// HOST_EXPORT(Bun__VirtualMachine__setOverrideModuleRunMain, c)
pub(crate) fn set_override_module_run_main(vm: &mut VirtualMachine, is_patched: bool) {
    if vm.is_in_preload {
        vm.has_patched_run_main = is_patched;
    }
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(vm, promise)`
// HOST_EXPORT(Bun__VirtualMachine__setOverrideModuleRunMainPromise, c)
pub(crate) fn set_override_module_run_main_promise(
    vm: &mut VirtualMachine,
    promise: *mut JSInternalPromise,
) {
    if vm.pending_internal_promise().is_none() {
        vm.set_pending_internal_promise(Some(promise));
    }
}

/// Exported as `Bun__VM__setEntryPointEvalResultESM`.
// HOST_EXPORT(Bun__VM__setEntryPointEvalResultESM, c)
pub(crate) fn set_entry_point_eval_result_esm(this: &mut VirtualMachine, result: JSValue) {
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
pub(crate) fn set_entry_point_eval_result_cjs(this: &mut VirtualMachine, value: JSValue) {
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
pub(crate) fn specifier_is_eval_entry_point(this: &mut VirtualMachine, specifier: JSValue) -> bool {
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
pub(crate) fn note_commonjs_evaluation(this: &mut VirtualMachine, specifier: JSValue) {
    if this.entry_point_result.evaluated_as_cjs {
        return;
    }
    let Some(main) = this.main() else {
        return;
    };
    let global = this.global();
    // A failed conversion just skips the note; must never panic at an FFI
    // boundary.
    let Ok(specifier_str) = bun_core::String::from_js(specifier, global) else {
        return;
    };
    if specifier_str.eql_utf8(main) {
        this.entry_point_result.evaluated_as_cjs = true;
    }
}

/// `export fn Bun__closeChildIPC(global)` — defers the actual socket close to
/// the next tick on the event loop.
// HOST_EXPORT(Bun__closeChildIPC, c)
pub(crate) fn close_child_ipc(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if let Some(current_ipc) = crate::ipc_host::get_ipc_instance(vm) {
        // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance`.
        unsafe { (*current_ipc).data().disconnect() };
    }
}

// ─── sql_jsc bridge — `bun_sql_jsc::jsc::SqlRuntimeHooks` vtable ─────────────
//
// `bun_sql_jsc` cannot name `RuntimeState` / `socket::SSLConfig`
// (this crate depends on it). Instead of Rust→Rust
// `extern "C"` re-decls (which let the two sides silently disagree on pointee
// layout), the low tier defines [`bun_sql_jsc::jsc::SqlRuntimeHooks`] and this
// crate registers a `&'static` instance from [`crate::jsc_hooks::
// `__BUN_SQL_RUNTIME_HOOKS`. Every fn-pointer signature is type-checked at the
// struct-literal below.
//
// Opaque-pointer protocol for `SSLConfig`: `ssl_config_from_js` returns a
// `Box<socket::SSLConfig>::into_raw`; the SQL side holds it as `*mut c_void`
// and frees via `ssl_config_free`. Scalar accessors borrow into that box.

mod sql_hooks {
    use super::*;
    use bun_event_loop::EventLoopTimer::EventLoopTimer;
    use bun_sql_jsc::jsc::{RareData as SqlRareData, SqlRuntimeHooks};

    unsafe fn sql_rare(_vm: *mut VirtualMachine) -> *mut SqlRareData {
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; `sql_rare` is
        // an embedded field with stable address for the VM lifetime.
        unsafe { core::ptr::addr_of_mut!((*state).sql_rare) }
    }
    unsafe fn timer_heap(_vm: *mut VirtualMachine) -> *mut c_void {
        crate::jsc_hooks::timer_all().cast()
    }
    unsafe fn timer_insert(heap: *mut c_void, timer: *mut EventLoopTimer) {
        // SAFETY: `heap` is `&runtime_state().timer` (live for the VM); `timer`
        // is a live intrusive heap node owned by the caller. Route through
        // `All::insert` (NOT the raw `.timers` field) so the fake-timers
        // routing and the `(*timer).state` / `in_heap` bookkeeping happen.
        unsafe { (*heap.cast::<crate::timer::All>()).insert(timer) };
    }
    unsafe fn timer_remove(heap: *mut c_void, timer: *mut EventLoopTimer) {
        // SAFETY: `heap` is `&runtime_state().timer`; `timer` was previously
        // inserted via `timer_insert`. Route through `All::remove` so
        // `in_heap` is consulted and reset.
        unsafe { (*heap.cast::<crate::timer::All>()).remove(timer) };
    }
    unsafe fn ssl_ctx_cache(_vm: *mut VirtualMachine) -> *mut c_void {
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; the embedded
        // `SSLContextCache` has stable address for the VM lifetime.
        unsafe { core::ptr::addr_of_mut!((*state).ssl_ctx_cache).cast::<c_void>() }
    }
    unsafe fn ssl_ctx_get_or_create(
        cache: *mut c_void,
        opts: &bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<bun_boringssl_sys::OwnedSslCtx> {
        // SAFETY: `cache` is `&runtime_state().ssl_ctx_cache`.
        let cache = unsafe { &mut *cache.cast::<crate::api::SSLContextCache::SSLContextCache>() };
        cache.get_or_create_opts(opts, err)
    }
    unsafe fn ssl_config_from_js(global: &JSGlobalObject, value: JSValue) -> *mut c_void {
        use crate::socket::SSLConfigFromJs;
        match crate::socket::SSLConfig::from_js(global.bun_vm_ref(), global, value, false) {
            Ok(Some(cfg)) => bun_core::heap::into_raw(Box::new(cfg)).cast::<c_void>(),
            Ok(None) => core::ptr::null_mut(),
            Err(bun_jsc::JsError::OutOfMemory) => {
                let _ = global.throw_out_of_memory();
                core::ptr::null_mut()
            }
            Err(_) => core::ptr::null_mut(),
        }
    }
    unsafe fn ssl_config_free(this: *mut c_void) {
        // SAFETY: `this` was produced by `heap::alloc` in
        // `ssl_config_from_js`; sql_jsc's `SSLConfig::drop` guards null/double.
        drop(unsafe { bun_core::heap::take(this.cast::<crate::socket::SSLConfig>()) });
    }
    unsafe fn ssl_config_as_usockets_client(
        this: *const c_void,
    ) -> bun_uws::us_bun_socket_context_options_t {
        // SAFETY: `this` is a live boxed `SSLConfig` from `ssl_config_from_js`.
        unsafe { &*this.cast::<crate::socket::SSLConfig>() }.as_usockets_for_client_verification()
    }
    unsafe fn ssl_config_server_name(this: *const c_void) -> *const core::ffi::c_char {
        // SAFETY: `this` is a live boxed `SSLConfig`; returned ptr borrows its
        // heap-owned C-string field, valid until `ssl_config_free`.
        unsafe { &*this.cast::<crate::socket::SSLConfig>() }.server_name
    }
    unsafe fn ssl_config_reject_unauthorized(this: *const c_void) -> i32 {
        // SAFETY: `this` is a live boxed `SSLConfig`.
        unsafe { (*this.cast::<crate::socket::SSLConfig>()).reject_unauthorized }
    }

    /// Declared `extern "Rust"` in `bun_sql_jsc::jsc`; link-time resolved.
    #[unsafe(no_mangle)]
    static __BUN_SQL_RUNTIME_HOOKS: SqlRuntimeHooks = SqlRuntimeHooks {
        sql_rare,
        timer_heap,
        timer_insert,
        timer_remove,
        ssl_ctx_cache,
        ssl_ctx_get_or_create,
        ssl_config_from_js,
        ssl_config_free,
        ssl_config_as_usockets_client,
        ssl_config_server_name,
        ssl_config_reject_unauthorized,
    };
}

// ─── entry-point promise reactions (used by `--print`) ───────────────────────

// HOST_EXPORT(Bun__onResolveEntryPointResult)
pub(crate) fn on_resolve_entry_point_result(
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
pub(crate) fn on_reject_entry_point_result(
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

// `Bun__Chrome__autoDetect` / `Bun__Chrome__ensure` — exported from
// `crate::webview::chrome_process` (mod webview is declared in lib.rs).
//
// `Bun__JSSourceMap__find` — exported from `bun_sourcemap_jsc::js_source_map`
// via `#[bun_jsc::host_fn(export = ...)]`.
