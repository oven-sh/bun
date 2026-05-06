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
//!       → `src/jsc/rare_data.rs`
//!   - `Resolver__nodeModulePathsForJS` / `Resolver__nodeModulePathsJSValue`
//!       → `src/jsc/resolver_jsc.rs`
//!   - `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming`
//!       → `src/jsc/JSGlobalObject.rs`
//!   - `Bun__Chrome__autoDetect` / `Bun__Chrome__ensure`
//!       → `src/runtime/webview/ChromeProcess.rs`
//!   - `Bun__JSSourceMap__find`
//!       → `src/sourcemap_jsc/JSSourceMap.rs`
//!   - `Bun__Process__send`
//!       → `bun_jsc::virtual_machine_exports`

use core::ffi::c_void;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSInternalPromise, JSValue, ZigStackFrame};

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

// ─── sql_jsc bridge (`Bun__VM__rareData` / `Bun__VM__timer` / Timer heap) ────
//
// `bun_sql_jsc` keeps an opaque `#[repr(C)]` view of `RareData` whose first two
// fields are the concrete `MySQLContext` / `PostgresSQLContext` (each is two
// `Strong.Optional` handles). `bun_jsc::rare_data` stores those as ZST stubs,
// so the real storage lives here in `RuntimeState` and `Bun__VM__rareData`
// hands back its address.

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__rareData(_vm: *mut VirtualMachine) -> *mut c_void {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: `state` is the boxed per-thread `RuntimeState`; `sql_rare` is an
    // embedded field that stays at a stable address for the VM's lifetime.
    unsafe { core::ptr::addr_of_mut!((*state).sql_rare) as *mut c_void }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__timer(_vm: *mut VirtualMachine) -> *mut c_void {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: `state` is the boxed per-thread `RuntimeState`; `timer` is an
    // embedded `timer::All` that stays at a stable address for the VM's lifetime.
    unsafe { core::ptr::addr_of_mut!((*state).timer) as *mut c_void }
}

/// `Timer.All.insert` (Timer.zig:63) — push an `EventLoopTimer` into the
/// per-VM intrusive pairing heap.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Timer__All__insert(
    heap: *mut c_void,
    timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
) {
    // SAFETY: `heap` is `&runtime_state().timer` (live for the VM); `timer` is
    // a live intrusive heap node owned by the caller.
    unsafe { (*(heap as *mut crate::timer::All)).timers.insert(timer) };
}

/// `Timer.All.remove` (Timer.zig:86).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Timer__All__remove(
    heap: *mut c_void,
    timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
) {
    // SAFETY: `heap` is `&runtime_state().timer`; `timer` was previously
    // inserted by the caller.
    unsafe { (*(heap as *mut crate::timer::All)).timers.remove(timer) };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__RareData__sslCtxCache(_vm: *mut c_void) -> *mut c_void {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: `state` is the boxed per-thread `RuntimeState`; the embedded
    // `SSLContextCache` has a stable address for the VM's lifetime.
    unsafe { core::ptr::addr_of_mut!((*state).ssl_ctx_cache) as *mut c_void }
}

/// `SSLContextCache::getOrCreateOpts` — digest-keyed weak `SSL_CTX*` cache.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__SSLContextCache__getOrCreateOpts(
    cache: *mut c_void,
    opts: *const bun_uws::SocketContext::BunSocketContextOptions,
    err: *mut bun_uws::create_bun_socket_error_t,
) -> *mut c_void {
    // SAFETY: `cache` is `&runtime_state().ssl_ctx_cache`; `opts`/`err` are
    // valid for reads/writes (caller stack locals in sql_jsc).
    let cache = unsafe { &mut *(cache as *mut crate::api::SSLContextCache::SSLContextCache) };
    let opts = unsafe { *opts };
    let err = unsafe { &mut *err };
    match cache.get_or_create_opts(opts, err) {
        Some(ctx) => ctx as *mut c_void,
        None => core::ptr::null_mut(),
    }
}

/// `SSLConfig::fromJS` — parse a JS TLS-options object into the runtime
/// `SSLConfig`. Returns `false` on JS exception (already thrown).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__SSLConfig__fromJS(
    global: *mut JSGlobalObject,
    value: JSValue,
    out: *mut c_void,
) -> bool {
    // SAFETY: `global` is the live per-thread global; `out` is a caller stack
    // `SSLConfig` (sql_jsc passes `&mut SSLConfig as *mut c_void`).
    let global = unsafe { &*global };
    let out = unsafe { &mut *(out as *mut crate::socket::SSLConfig) };
    // TODO(b2-blocked): `SSLConfig::from_js` body is gated on
    // `webcore::Blob` store / generated GenVal accessors. Until un-gated, the
    // sql_jsc connect path that passes `tls: {…}` cannot be exercised; surface
    // a clear failure rather than silently dropping the config.
    let _ = (value, out);
    let _ = global.throw_todo("SSLConfig.fromJS: tls options parsing not yet ported");
    false
}

/// `SSLConfig::asUSockets` — project the runtime `SSLConfig` to the C-ABI
/// `us_bun_socket_context_options_t` for client-mode verification.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__SSLConfig__asUSocketsClient(
    this: *const c_void,
    out: *mut bun_uws::SocketContext::BunSocketContextOptions,
) {
    // SAFETY: `this` is a live `SSLConfig` (sql_jsc stack local); `out` is a
    // caller stack out-param.
    let this = unsafe { &*(this as *const crate::socket::SSLConfig) };
    unsafe { *out = this.as_usockets_for_client_verification() };
}

/// `Blob::needsToReadFile` — true when the blob is backed by a file/fd that
/// must be read (vs. an in-memory bytes store).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Blob__needsToReadFile(this: *const c_void) -> bool {
    // SAFETY: `this` is a live `Blob` (sql_jsc passes `&Blob as *const c_void`).
    unsafe { (*(this as *const crate::webcore::Blob)).needs_to_read_file() }
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

// ─── rare_data.zig — TLS-ciphers / stdin-fd-type host fns (un-gated bodies) ──

#[bun_jsc::host_fn(export = "Bun__setTLSDefaultCiphers")]
pub fn set_tls_default_ciphers(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> bun_jsc::JsResult<JSValue> {
    let ciphers = callframe.argument(0);
    if !ciphers.is_string() {
        return Err(global.throw_invalid_argument_type_value("ciphers", "string", ciphers));
    }
    let sliced = ciphers.to_slice(global)?;
    // SAFETY: bun_vm() never null for a Bun-owned global.
    unsafe { (*global.bun_vm()).rare_data().set_tls_default_ciphers(sliced.slice()) };
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "Bun__getTLSDefaultCiphers")]
pub fn get_tls_default_ciphers(
    global: &JSGlobalObject,
    _callframe: &CallFrame,
) -> bun_jsc::JsResult<JSValue> {
    // SAFETY: bun_vm() never null for a Bun-owned global.
    let vm = unsafe { &mut *global.bun_vm() };
    let ciphers = match vm.rare_data().tls_default_ciphers() {
        Some(c) => c,
        None => bun_uws::get_default_ciphers().as_bytes(),
    };
    Ok(bun_jsc::zig_string::ZigString::from_bytes(ciphers).to_js(global))
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Process__getStdinFdType(vm: *mut VirtualMachine, fd: i32) -> i32 {
    // TODO(b2-blocked): `RareData::std{in,out,err}()` accessors are gated on
    // `BlobStore`/`FileStore`. Spec: 0=file, 1=pipe, 2=socket. Fall back to a
    // direct fstat on the fd until the Blob-store path is un-gated.
    let _ = vm;
    let fd = bun_sys::Fd::from_native(fd as _);
    match bun_sys::fstat(fd) {
        Ok(st) if bun_sys::S::ISFIFO(st.st_mode as _) => 1,
        Ok(st) if bun_sys::S::ISSOCK(st.st_mode as _) => 2,
        _ => 0,
    }
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

#[repr(C)]
pub struct BracesOptions {
    pub parse: bool,
    pub tokenize: bool,
}

/// `BunObject.braces(input, options) -> JSValue`.
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_BunObject_dispatchBraces1(
    global: *mut JSGlobalObject,
    arg_input: *const bun_string::String,
    arg_options: *const BracesOptions,
) -> JSValue {
    // TODO(b2-blocked): `crate::api::bun_object::braces` is in the `_jsc_gated`
    // module (depends on `Braces::Lexer` un-gating). Surface a clear error
    // until that body un-gates.
    let _ = (arg_input, arg_options);
    // SAFETY: `global` is the live per-thread global.
    let global = unsafe { &*global };
    bun_jsc::host_fn::to_js_host_call(
        global,
        Err(global.throw_todo("Bun.braces: shell brace-expansion not yet ported")),
    )
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
    let _force = unsafe { *arg_force };
    // Spec body (BunObject.zig `gc`): force ⇒ `collectSync()`, else
    // `collectAsync()`, then return `heap.size()`. `collect_sync` is gated in
    // `bun_jsc::VM`; both arms call the available async path for now.
    // TODO(b2-blocked): wire `VM::collect_sync` once un-gated.
    let jsc_vm = unsafe { &*(*global.bun_vm()).jsc_vm };
    jsc_vm.collect_async();
    unsafe { *out = jsc_vm.heap_size() };
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
    fn Bun__CreateFFIFunctionValue(
        global: *mut JSGlobalObject,
        symbol_name: *const bun_string::ZigString,
        arg_count: u32,
        function: bun_jsc::host_fn::JSHostFn,
        add_ptr_field: bool,
        input_function_ptr: *mut c_void,
    ) -> JSValue;
    // C++-side host fns (Generated*Bindings.cpp).
    fn bindgen_Fmt_jsc_jsFmtString(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
    fn bindgen_DevServer_jsGetDeinitCountForTesting(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
}

#[inline]
fn new_runtime_function(
    global: *mut JSGlobalObject,
    name: &'static [u8],
    arg_count: u32,
    f: bun_jsc::host_fn::JSHostFn,
) -> JSValue {
    let zs = bun_string::ZigString::init_utf8(name);
    // SAFETY: thin FFI wrapper; `global` is live, `zs` outlives the call.
    unsafe { Bun__CreateFFIFunctionValue(global, &zs, arg_count, f, false, core::ptr::null_mut()) }
}

#[unsafe(export_name = "js2native_bindgen_fmt_jsc_fmtString")]
pub extern "C" fn js2native_bindgen_fmt_jsc_fmt_string(global: *mut JSGlobalObject) -> JSValue {
    new_runtime_function(global, b"fmtString", 3, bindgen_Fmt_jsc_jsFmtString)
}

#[unsafe(export_name = "js2native_bindgen_DevServer_getDeinitCountForTesting")]
pub extern "C" fn js2native_bindgen_dev_server_get_deinit_count(global: *mut JSGlobalObject) -> JSValue {
    new_runtime_function(
        global,
        b"getDeinitCountForTesting",
        0,
        bindgen_DevServer_jsGetDeinitCountForTesting,
    )
}

// `Bun__Chrome__autoDetect` / `Bun__Chrome__ensure` — exported from
// `crate::webview::chrome_process` (mod webview is declared in lib.rs).
//
// `Bun__JSSourceMap__find` — exported from `bun_sourcemap_jsc::js_source_map`
// via `#[bun_jsc::host_fn(export = ...)]`.
