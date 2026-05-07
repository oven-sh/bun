//! phase-d: handwritten Zig `@export` / `export fn` C-ABI symbols whose bodies
//! live in `bun_jsc::VirtualMachine` but whose link names must be emitted from
//! a crate that *depends on* `bun_jsc` (so the bodies can call back into the
//! real `VirtualMachine` struct without inverting the crate DAG). Each fn here
//! is a 1:1 port of the corresponding `src/jsc/VirtualMachine.zig` body.
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
use bun_jsc::{CallFrame, JSGlobalObject, JSInternalPromise, JSValue, ZigStackFrame};
use crate::webcore::BlobExt as _;

// ─── VirtualMachine.zig ──────────────────────────────────────────────────────

/// `export fn Bun__isMainThreadVM() callconv(.c) bool { return get().is_main_thread; }`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__isMainThreadVM() -> bool {
    // SAFETY: `get()` returns the live per-thread VM raw ptr.
    unsafe { (*VirtualMachine::get()).is_main_thread }
}

/// `export fn Bun__drainMicrotasksFromJS(global, callframe) callconv(jsc.conv) JSValue`
#[unsafe(no_mangle)]
#[bun_jsc::host_call]
pub fn Bun__drainMicrotasksFromJS(global: *mut JSGlobalObject, _callframe: *mut CallFrame) -> JSValue {
    // SAFETY: JSC passes a live global; `bun_vm()` returns its owning VM.
    let vm = unsafe { (*global).bun_vm() } as *const VirtualMachine as *mut VirtualMachine;
    // SAFETY: VM is uniquely live on this thread for the duration of the call.
    unsafe { (*vm).drain_microtasks() };
    JSValue::UNDEFINED
}

/// `export fn Bun__logUnhandledException(exception: JSValue) void { get().runErrorHandler(exception, null); }`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__logUnhandledException(exception: JSValue) {
    // SAFETY: `get()` returns the live per-thread VM raw ptr; mutator thread.
    unsafe { (*VirtualMachine::get()).run_error_handler(exception, None) };
}

/// `export fn Bun__remapStackFramePositions(vm, frames, frames_count)` —
/// **may run on the heap-collector thread** (see oven-sh/bun#17087); the
/// underlying method serializes on `remap_stack_frames_mutex`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__remapStackFramePositions(
    vm: *mut VirtualMachine,
    frames: *mut ZigStackFrame,
    frames_count: usize,
) {
    // SAFETY: `vm` is the C++-side ZigGlobalObject's m_bunVM; live for the call.
    unsafe { (*vm).remap_stack_frame_positions(frames, frames_count) };
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMain(vm, is_patched)`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMain(
    vm: *mut VirtualMachine,
    is_patched: bool,
) {
    // SAFETY: `vm` is the live per-thread VM (called from `node:module` patch hook).
    let vm = unsafe { &mut *vm };
    if vm.is_in_preload {
        vm.has_patched_run_main = is_patched;
    }
}

/// `export fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(vm, promise)`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(
    vm: *mut VirtualMachine,
    promise: *mut JSInternalPromise,
) {
    // SAFETY: `vm` is the live per-thread VM; `promise` is a live JSC heap cell.
    let vm = unsafe { &mut *vm };
    if vm.pending_internal_promise.is_none() {
        vm.pending_internal_promise = Some(promise);
        vm.pending_internal_promise_is_protected = false;
    }
}

/// `@export(&setEntryPointEvalResultESM, .{ .name = "Bun__VM__setEntryPointEvalResultESM" })`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__setEntryPointEvalResultESM(this: *mut VirtualMachine, result: JSValue) {
    // SAFETY: `this` is the live per-thread VM.
    let this = unsafe { &mut *this };
    // allow esm evaluate to set value multiple times
    if !this.entry_point_result.cjs_set_value {
        // PORT NOTE: reshaped for borrowck — split disjoint &mut/& borrows.
        // SAFETY: `global` is the VM's owned global (STATIC ref per LIFETIMES.tsv).
        let global = unsafe { &*this.global };
        this.entry_point_result.value.set(global, result);
    }
}

/// `@export(&setEntryPointEvalResultCJS, .{ .name = "Bun__VM__setEntryPointEvalResultCJS" })`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__setEntryPointEvalResultCJS(this: *mut VirtualMachine, value: JSValue) {
    // SAFETY: `this` is the live per-thread VM.
    let this = unsafe { &mut *this };
    if !this.entry_point_result.value.has() {
        // PORT NOTE: reshaped for borrowck — split disjoint &mut/& borrows.
        // SAFETY: `global` is the VM's owned global (STATIC ref per LIFETIMES.tsv).
        let global = unsafe { &*this.global };
        this.entry_point_result.value.set(global, value);
        this.entry_point_result.cjs_set_value = true;
    }
}

/// `@export(&specifierIsEvalEntryPoint, .{ .name = "Bun__VM__specifierIsEvalEntryPoint" })`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__specifierIsEvalEntryPoint(
    this: *mut VirtualMachine,
    specifier: JSValue,
) -> bool {
    // SAFETY: `this` is the live per-thread VM.
    let this = unsafe { &mut *this };
    if let Some(eval_source) = this.module_loader.eval_source.as_ref() {
        let global = this.global();
        // Zig: `specifier.toBunString(this.global) catch @panic("unexpected exception")`
        let specifier_str = bun_jsc::bun_string_jsc::from_js(specifier, global)
            .expect("unexpected exception");
        // `bun.String` derefs on Drop.
        return specifier_str.eql_utf8(&eval_source.path.text);
    }
    false
}

/// `export fn Bun__closeChildIPC(global)` — defers the actual socket close to
/// the next tick on the event loop.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__closeChildIPC(global: *mut JSGlobalObject) {
    // SAFETY: `global` is live; `bun_vm()` returns its owning VM.
    let vm = unsafe { (*global).bun_vm() } as *const VirtualMachine as *mut VirtualMachine;
    // SAFETY: VM is uniquely live on this thread.
    if let Some(current_ipc) = unsafe { (*vm).get_ipc_instance() } {
        // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance`.
        unsafe { (*current_ipc).data.close_socket_next_tick(true) };
    }
}

// ─── sql_jsc bridge — `bun_sql_jsc::jsc::SqlRuntimeHooks` vtable ─────────────
//
// `bun_sql_jsc` cannot name `RuntimeState` / `socket::SSLConfig` /
// `webcore::Blob` (this crate depends on it). Instead of Rust→Rust
// `extern "C"` re-decls (which let the two sides silently disagree on pointee
// layout), the low tier defines [`bun_sql_jsc::jsc::SqlRuntimeHooks`] and this
// crate registers a `&'static` instance from [`crate::jsc_hooks::
// install_jsc_hooks`]. Every fn-pointer signature is type-checked at the
// struct-literal below.
//
// Opaque-pointer protocol for `SSLConfig`: `ssl_config_from_js` returns a
// `Box<socket::SSLConfig>::into_raw`; the SQL side holds it as `*mut c_void`
// and frees via `ssl_config_free`. Scalar accessors borrow into that box.

pub(crate) mod sql_hooks {
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
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; `timer` is the
        // embedded `timer::All` with stable address for the VM lifetime.
        unsafe { core::ptr::addr_of_mut!((*state).timer) as *mut c_void }
    }
    unsafe fn timer_insert(heap: *mut c_void, timer: *mut EventLoopTimer) {
        // SAFETY: `heap` is `&runtime_state().timer` (live for the VM); `timer`
        // is a live intrusive heap node owned by the caller.
        unsafe { (*(heap as *mut crate::timer::All)).timers.insert(timer) };
    }
    unsafe fn timer_remove(heap: *mut c_void, timer: *mut EventLoopTimer) {
        // SAFETY: `heap` is `&runtime_state().timer`; `timer` was previously
        // inserted by the caller.
        unsafe { (*(heap as *mut crate::timer::All)).timers.remove(timer) };
    }
    unsafe fn ssl_ctx_cache(_vm: *mut VirtualMachine) -> *mut c_void {
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; the embedded
        // `SSLContextCache` has stable address for the VM lifetime.
        unsafe { core::ptr::addr_of_mut!((*state).ssl_ctx_cache) as *mut c_void }
    }
    unsafe fn ssl_ctx_get_or_create(
        cache: *mut c_void,
        opts: &bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> *mut bun_uws::SslCtx {
        // SAFETY: `cache` is `&runtime_state().ssl_ctx_cache`.
        let cache =
            unsafe { &mut *(cache as *mut crate::api::SSLContextCache::SSLContextCache) };
        cache.get_or_create_opts(*opts, err).unwrap_or(core::ptr::null_mut())
    }
    unsafe fn ssl_config_from_js(global: &JSGlobalObject, value: JSValue) -> *mut c_void {
        match crate::socket::SSLConfig::from_js(global.bun_vm_ref(), global, value) {
            Ok(Some(cfg)) => Box::into_raw(Box::new(cfg)) as *mut c_void,
            Ok(None) => core::ptr::null_mut(),
            Err(bun_jsc::JsError::OutOfMemory) => {
                let _ = global.throw_out_of_memory();
                core::ptr::null_mut()
            }
            Err(_) => core::ptr::null_mut(),
        }
    }
    unsafe fn ssl_config_free(this: *mut c_void) {
        // SAFETY: `this` was produced by `Box::into_raw` in
        // `ssl_config_from_js`; sql_jsc's `SSLConfig::drop` guards null/double.
        drop(unsafe { Box::from_raw(this as *mut crate::socket::SSLConfig) });
    }
    unsafe fn ssl_config_as_usockets_client(
        this: *const c_void,
    ) -> bun_uws::us_bun_socket_context_options_t {
        // SAFETY: `this` is a live boxed `SSLConfig` from `ssl_config_from_js`.
        unsafe { &*(this as *const crate::socket::SSLConfig) }
            .as_usockets_for_client_verification()
    }
    unsafe fn ssl_config_server_name(this: *const c_void) -> *const core::ffi::c_char {
        // SAFETY: `this` is a live boxed `SSLConfig`; returned ptr borrows its
        // `Option<CString>` field, valid until `ssl_config_free`.
        unsafe { &*(this as *const crate::socket::SSLConfig) }
            .server_name
            .as_deref()
            .map_or(core::ptr::null(), |s| s.as_ptr())
    }
    unsafe fn ssl_config_reject_unauthorized(this: *const c_void) -> i32 {
        // SAFETY: `this` is a live boxed `SSLConfig`.
        unsafe { (*(this as *const crate::socket::SSLConfig)).reject_unauthorized }
    }
    unsafe fn blob_needs_to_read_file(this: *const c_void) -> bool {
        // SAFETY: `this` is a live `Blob` (codegen `m_ctx` payload from
        // `Blob__fromJS`).
        unsafe { (*(this as *const crate::webcore::Blob)).needs_to_read_file() }
    }
    unsafe fn blob_shared_view(this: *const c_void, out_len: *mut usize) -> *const u8 {
        // SAFETY: `this` is a live `Blob`; `out_len` is a caller stack slot.
        unsafe {
            crate::webcore::blob::Bun__Blob__sharedView(
                this as *const crate::webcore::Blob,
                out_len,
            )
        }
    }

    pub(crate) static INSTANCE: SqlRuntimeHooks = SqlRuntimeHooks {
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
        blob_needs_to_read_file,
        blob_shared_view,
    };
}

// ─── bun.js.zig — entry-point promise reactions (used by `--print`) ──────────

#[bun_jsc::host_fn(export = "Bun__onResolveEntryPointResult")]
pub fn on_resolve_entry_point_result(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> bun_jsc::JsResult<JSValue> {
    let result = callframe.argument(0);
    // SAFETY: `vals[..len]` is the single stack `result`; `ctype` may be null
    // (the Zig path passes the per-VM ConsoleObject but only the writers are
    // read off it, and `null` routes to the VM's stdout/stderr default).
    unsafe {
        bun_jsc::ConsoleObject::message_with_type_and_level(
            core::ptr::null_mut(),
            bun_jsc::ConsoleObject::MessageType::Log,
            bun_jsc::ConsoleObject::MessageLevel::Log,
            global,
            &result as *const JSValue,
            1,
        );
    }
    // SAFETY: bun_vm() never null for a Bun-owned global.
    bun_core::Global::exit(u32::from(unsafe { (*global.bun_vm()).exit_handler.exit_code }));
}

#[bun_jsc::host_fn(export = "Bun__onRejectEntryPointResult")]
pub fn on_reject_entry_point_result(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> bun_jsc::JsResult<JSValue> {
    let result = callframe.argument(0);
    // SAFETY: `vals[..len]` is the single stack `result`; `ctype` may be null
    // (the Zig path passes the per-VM ConsoleObject but only the writers are
    // read off it, and `null` routes to the VM's stdout/stderr default).
    unsafe {
        bun_jsc::ConsoleObject::message_with_type_and_level(
            core::ptr::null_mut(),
            bun_jsc::ConsoleObject::MessageType::Log,
            bun_jsc::ConsoleObject::MessageLevel::Log,
            global,
            &result as *const JSValue,
            1,
        );
    }
    // SAFETY: bun_vm() never null for a Bun-owned global.
    bun_core::Global::exit(u32::from(unsafe { (*global.bun_vm()).exit_handler.exit_code }));
}

// ─── bindgenv2 dispatch shims (GeneratedBindings.zig: `bindgen_*_dispatch*`) ─
//
// These satisfy the `extern "C"` refs C++ emits from
// `Generated*Bindings.cpp`. Each forwards to the real Rust port of the named
// fn and maps `JsResult` → bool/JSValue per the bindgen ABI.

/// `NodeModuleModule._stat(path) -> i32` (0=file, 1=dir, -ENOENT otherwise).
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_NodeModuleModule_dispatch_stat1(
    _global: *mut JSGlobalObject,
    arg_str: *const bun_string::String,
    out: *mut i32,
) -> bool {
    // SAFETY: `arg_str` is a live `bun.String` (C++ stack local); `out` is a
    // valid out-param.
    let s = unsafe { (*arg_str).to_utf8() };
    unsafe { *out = bun_jsc::node_module_module::_stat(s.slice()) };
    true
}

/// `BunObject.braces(input, options) -> JSValue`.
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_BunObject_dispatchBraces1(
    global: *mut JSGlobalObject,
    arg_input: *const bun_string::String,
    arg_options: *const crate::api::bun_object::r#gen::BracesOptions,
) -> JSValue {
    // SAFETY: `global` is the live per-thread global; `arg_input`/`arg_options`
    // are valid C++ stack locals (see GeneratedBindings.zig:203 call site).
    let global = unsafe { &*global };
    // Zig spec passes `arg_input.*` (bitwise copy of the ref-counted handle,
    // **no** refcount bump). `bun_string::String` is `Copy` with no `Drop`, so
    // a plain deref matches that exactly; `braces` only borrows the bytes via
    // `to_utf8()` and never derefs the handle.
    let input = unsafe { *arg_input };
    let opts = unsafe { *arg_options };
    bun_jsc::host_fn::to_js_host_call(global, || {
        crate::api::bun_object::braces(global, input, opts)
    })
}

/// `BunObject.gc(force) -> usize` (heap size after collection).
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_BunObject_dispatchGc1(
    global: *mut JSGlobalObject,
    arg_force: *const bool,
    out: *mut usize,
) -> bool {
    // SAFETY: `global` is the live per-thread global; `arg_force`/`out` are
    // valid C++ stack locals.
    let global = unsafe { &*global };
    let force = unsafe { *arg_force };
    // Spec body (GeneratedBindings.zig:212 → BunObject.zig `gc`):
    // `vm.garbageCollect(force)` — mimalloc cleanup, then sync `runGC(true)`
    // when `force`, else `collectAsync()` + `heap.size()`.
    // SAFETY: bun_vm() never null for a Bun-owned global.
    unsafe { *out = (*global.bun_vm()).garbage_collect(force) };
    true
}

/// `fmt_jsc.js_bindings.fmtString(code, formatter) -> bun.String`
/// (highlighter.test.ts internal — see `src/jsc/fmt_jsc.zig`).
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_Fmt_jsc_dispatchFmtString1(
    global: *mut JSGlobalObject,
    arg_code: *const bun_string::String,
    arg_formatter: *const bun_jsc::fmt_jsc::js_bindings::Formatter,
    out: *mut bun_string::String,
) -> bool {
    // SAFETY: `global` is the live per-thread global; `arg_code`/`arg_formatter`
    // /`out` are valid C++ stack locals (see GeneratedBindings.cpp call site).
    let global = unsafe { &*global };
    let code = unsafe { (*arg_code).to_utf8() };
    let formatter = unsafe { *arg_formatter };
    match bun_jsc::fmt_jsc::js_bindings::fmt_string(global, code.slice(), formatter) {
        Ok(s) => {
            unsafe { *out = s };
            true
        }
        // `JsError` already set the pending exception on `global`; the bindgen
        // ABI signals "exception pending" via `false`.
        Err(_) => false,
    }
}

/// `DevServer.getDeinitCountForTesting() -> usize`.
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_DevServer_dispatchGetDeinitCountForTesting1(
    _global: *mut JSGlobalObject,
    out: *mut usize,
) -> bool {
    // SAFETY: `out` is a valid C++ stack local out-param.
    unsafe { *out = crate::bake::get_deinit_count_for_testing() };
    true
}

// ─── js2native bindgen create-callback exports (GeneratedJS2Native.zig) ──────
//
// `js2native_bindgen_<ns>_<fn>` returns a freshly-minted `JSFunction` wrapping
// the C++-side `bindgen_<ns>_js<Fn>` host fn. The C++ side already exports the
// host fn (it lives in `Generated*Bindings.cpp`); we just call
// `NewRuntimeFunction` here.

unsafe extern "C" {
    // C++-side host fns (Generated*Bindings.cpp).
    fn bindgen_Fmt_jsc_jsFmtString(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
    fn bindgen_DevServer_jsGetDeinitCountForTesting(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
}

#[unsafe(export_name = "js2native_bindgen_fmt_jsc_fmtString")]
pub extern "C" fn js2native_bindgen_fmt_jsc_fmt_string(global: *mut JSGlobalObject) -> JSValue {
    // SAFETY: `global` is live (passed from JS2Native bridge).
    let global = unsafe { &*global };
    let name = bun_string::ZigString::init_utf8(b"fmtString");
    bun_jsc::host_fn::new_runtime_function(global, Some(&name), 3, bindgen_Fmt_jsc_jsFmtString, false, None)
}

#[unsafe(export_name = "js2native_bindgen_DevServer_getDeinitCountForTesting")]
pub extern "C" fn js2native_bindgen_dev_server_get_deinit_count(global: *mut JSGlobalObject) -> JSValue {
    // SAFETY: `global` is live (passed from JS2Native bridge).
    let global = unsafe { &*global };
    let name = bun_string::ZigString::init_utf8(b"getDeinitCountForTesting");
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
