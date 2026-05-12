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

use crate::webcore::BlobExt as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSInternalPromise, JSValue, ZigStackFrame};

// ─── VirtualMachine.zig ──────────────────────────────────────────────────────
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
/// deref+call with no `ExceptionValidationScope` — matching the .zig spec's
/// bare `callconv(jsc.conv)` body and the prior `#[bun_jsc::host_call]`
/// rewrite. `drain_microtasks()` runs arbitrary microtasks; wrapping in a
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
    let jsc_vm = vm.jsc_vm;
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
// HOST_EXPORT(Bun__remapStackFramePositions, c)
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

/// `@export(&setEntryPointEvalResultESM, .{ .name = "Bun__VM__setEntryPointEvalResultESM" })`
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

/// `@export(&setEntryPointEvalResultCJS, .{ .name = "Bun__VM__setEntryPointEvalResultCJS" })`
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

/// `@export(&specifierIsEvalEntryPoint, .{ .name = "Bun__VM__specifierIsEvalEntryPoint" })`
// HOST_EXPORT(Bun__VM__specifierIsEvalEntryPoint, c)
pub fn specifier_is_eval_entry_point(this: &mut VirtualMachine, specifier: JSValue) -> bool {
    if let Some(eval_source) = this.module_loader.eval_source.as_ref() {
        let global = this.global();
        // Zig: `specifier.toBunString(this.global) catch @panic("unexpected exception")`
        // followed by `defer specifier_str.deref()`. `bun_core::String` is
        // `Copy` with NO `Drop`; `OwnedString` is the RAII wrapper that derefs.
        let specifier_str = bun_core::OwnedString::new(
            bun_jsc::bun_string_jsc::from_js(specifier, global).expect("unexpected exception"),
        );
        return specifier_str.eql_utf8(&eval_source.path.text);
    }
    false
}

/// `export fn Bun__closeChildIPC(global)` — defers the actual socket close to
/// the next tick on the event loop.
// HOST_EXPORT(Bun__closeChildIPC, c)
pub fn close_child_ipc(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if let Some(current_ipc) = vm.get_ipc_instance() {
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
// `__BUN_SQL_RUNTIME_HOOKS`. Every fn-pointer signature is type-checked at the
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
        crate::jsc_hooks::timer_all().cast()
    }
    unsafe fn timer_insert(heap: *mut c_void, timer: *mut EventLoopTimer) {
        // SAFETY: `heap` is `&runtime_state().timer` (live for the VM); `timer`
        // is a live intrusive heap node owned by the caller. Route through
        // `All::insert` (NOT the raw `.timers` field) so the lock is taken and
        // `(*timer).state` / `in_heap` bookkeeping is updated — Zig spec is
        // `vm.timer.insert(&this.timer)`.
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
    ) -> *mut bun_uws::SslCtx {
        // SAFETY: `cache` is `&runtime_state().ssl_ctx_cache`.
        let cache = unsafe { &mut *cache.cast::<crate::api::SSLContextCache::SSLContextCache>() };
        cache
            .get_or_create_opts(*opts, err)
            .unwrap_or(core::ptr::null_mut())
    }
    unsafe fn ssl_config_from_js(global: &JSGlobalObject, value: JSValue) -> *mut c_void {
        use crate::socket::SSLConfigFromJs;
        match crate::socket::SSLConfig::from_js(global.bun_vm_ref(), global, value) {
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
    unsafe fn blob_needs_to_read_file(this: *const c_void) -> bool {
        // SAFETY: `this` is a live `Blob` (codegen `m_ctx` payload from
        // `Blob__fromJS`).
        unsafe { (*this.cast::<crate::webcore::Blob>()).needs_to_read_file() }
    }
    unsafe fn blob_shared_view(this: *const c_void, out_len: *mut usize) -> *const u8 {
        // SAFETY: `this` is a live `Blob`; `out_len` is a caller stack slot.
        unsafe {
            crate::webcore::blob::Bun__Blob__sharedView(
                this.cast::<crate::webcore::Blob>(),
                out_len,
            )
        }
    }

    /// Declared `extern "Rust"` in `bun_sql_jsc::jsc`; link-time resolved.
    #[unsafe(no_mangle)]
    pub static __BUN_SQL_RUNTIME_HOOKS: SqlRuntimeHooks = SqlRuntimeHooks {
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

// HOST_EXPORT(Bun__onResolveEntryPointResult)
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
    // SAFETY: `vals[..len]` is the single stack `result`; `ctype` may be null
    // (the Zig path passes the per-VM ConsoleObject but only the writers are
    // read off it, and `null` routes to the VM's stdout/stderr default).
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

// ─── bindgenv2 dispatch shims (GeneratedBindings.zig: `bindgen_*_dispatch*`) ─
//
// These satisfy the `extern "C"` refs C++ emits from
// `Generated*Bindings.cpp`. Each forwards to the real Rust port of the named
// fn and maps `JsResult` → bool/JSValue per the bindgen ABI.

/// `NodeModuleModule._stat(path) -> i32` (0=file, 1=dir, -ENOENT otherwise).
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_NodeModuleModule_dispatch_stat1(
    _global: *mut JSGlobalObject,
    arg_str: *const bun_core::String,
    out: *mut i32,
) -> bool {
    // SAFETY: `arg_str` is a live `bun.String` (C++ stack local); `out` is a
    // valid out-param.
    let s = unsafe { (*arg_str).to_utf8() };
    unsafe { *out = bun_jsc::node_module_module::_stat(s.slice()) };
    true
}

/// `BunObject.braces(input, options) -> JSValue`.
// HOST_EXPORT(bindgen_BunObject_dispatchBraces1, c)
pub fn bindgen_bunobject_dispatch_braces(
    global: &JSGlobalObject,
    arg_input: *const bun_core::String,
    arg_options: *const crate::api::bun_object::r#gen::BracesOptions,
) -> JSValue {
    // SAFETY: `arg_input`/`arg_options` are valid C++ stack locals (see
    // GeneratedBindings.zig:203 call site).
    // Zig spec passes `arg_input.*` (bitwise copy of the ref-counted handle,
    // **no** refcount bump). `bun_core::String` is `Copy` with no `Drop`, so
    // a plain deref matches that exactly; `braces` only borrows the bytes via
    // `to_utf8()` and never derefs the handle.
    let input = unsafe { *arg_input };
    let opts = unsafe { *arg_options };
    bun_jsc::host_fn::to_js_host_call(global, || {
        crate::api::bun_object::braces(global, input, opts)
    })
}

/// `BunObject.gc(force) -> usize` (heap size after collection).
// HOST_EXPORT(bindgen_BunObject_dispatchGc1, c)
pub fn bindgen_bunobject_dispatch_gc(
    global: &JSGlobalObject,
    arg_force: *const bool,
    out: *mut usize,
) -> bool {
    // SAFETY: `arg_force`/`out` are valid C++ stack locals.
    let force = unsafe { *arg_force };
    // Spec body (GeneratedBindings.zig:212 → BunObject.zig `gc`):
    // `vm.garbageCollect(force)` — mimalloc cleanup, then sync `runGC(true)`
    // when `force`, else `collectAsync()` + `heap.size()`.
    // SAFETY: bun_vm() never null for a Bun-owned global.
    unsafe { *out = global.bun_vm().as_mut().garbage_collect(force) };
    true
}

/// `fmt_jsc.js_bindings.fmtString(code, formatter) -> bun.String`
/// (highlighter.test.ts internal — see `src/jsc/fmt_jsc.zig`).
// HOST_EXPORT(bindgen_Fmt_jsc_dispatchFmtString1, c)
pub fn bindgen_fmt_jsc_dispatch_fmt_string(
    global: &JSGlobalObject,
    arg_code: *const bun_core::String,
    arg_formatter: *const bun_jsc::fmt_jsc::js_bindings::Formatter,
    out: *mut bun_core::String,
) -> bool {
    // SAFETY: `arg_code`/`arg_formatter`/`out` are valid C++ stack locals
    // (see GeneratedBindings.cpp call site).
    let code = unsafe { (*arg_code).to_utf8() };
    let formatter = unsafe { *arg_formatter };
    match bun_jsc::fmt_jsc::js_bindings::fmt_string(global, code.slice(), formatter) {
        Ok(s) => {
            unsafe { *out = s };
            true
        }
        // OOM is the one `JsError` variant that does **not** leave a pending
        // exception on the VM; the Zig spec explicitly throws here before
        // signalling failure (`error.OutOfMemory => arg_global.throwOutOfMemory()`).
        Err(bun_jsc::JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory();
            false
        }
        // `JSError` / `JSTerminated` already set (or cleared) the pending
        // exception on `global`; the bindgen ABI signals "exception pending"
        // via `false`.
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

// ─── bindgen dispatch shims: Bindgen_test (src/jsc/bindgen_test.rs) ──────────

/// `bindgen_test.add(a, b) -> i32` — bindgen self-test (overflow throws).
// HOST_EXPORT(bindgen_Bindgen_test_dispatchAdd1, c)
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

/// `extern struct` mirror of the Zig codegen's optional-arg communication
/// buffer (GeneratedBindings.zig:164). Field order is {b_set, d_set, d_value,
/// b_value} — `extern struct` is declaration-ordered, NOT size-sorted.
#[repr(C)]
pub struct BindgenTestRequiredAndOptionalArgArguments {
    pub b_set: bool,
    pub d_set: bool,
    pub d_value: u8,
    pub b_value: usize,
}

/// `bindgen_test.requiredAndOptionalArg(a, b?, c, d?) -> i32`.
#[unsafe(no_mangle)]
pub extern "C" fn bindgen_Bindgen_test_dispatchRequiredAndOptionalArg1(
    _global: *mut JSGlobalObject,
    arg_a: *const bool,
    arg_c: *const i32,
    buf: *mut BindgenTestRequiredAndOptionalArgArguments,
    out: *mut i32,
) -> bool {
    // SAFETY: all pointers are valid C++ stack locals; `buf` fields are read
    // gated on their `_set` flags (matching `if buf.b_set buf.b_value else null`).
    let buf = unsafe { &*buf };
    let v = bun_jsc::bindgen_test::required_and_optional_arg(
        unsafe { *arg_a },
        if buf.b_set { Some(buf.b_value) } else { None },
        unsafe { *arg_c },
        if buf.d_set { Some(buf.d_value) } else { None },
    );
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

#[unsafe(no_mangle)]
pub extern "C" fn bindgen_Node_os_dispatchFreemem1(
    _global: *mut JSGlobalObject,
    out: *mut u64,
) -> bool {
    // SAFETY: `out` is a valid C++ stack out-param. `freemem()` is infallible.
    unsafe { *out = node_os::freemem() };
    true
}

// HOST_EXPORT(bindgen_Node_os_dispatchGetPriority1, c)
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

#[unsafe(no_mangle)]
pub extern "C" fn bindgen_Node_os_dispatchRelease1(
    _global: *mut JSGlobalObject,
    out: *mut bun_core::String,
) -> bool {
    // SAFETY: `out` is a valid C++ stack out-param. `release()` is infallible.
    unsafe { out.write(node_os::release()) };
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn bindgen_Node_os_dispatchTotalmem1(
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

// HOST_EXPORT(bindgen_Node_os_dispatchUserInfo1, c)
pub fn bindgen_node_os_dispatch_user_info(
    global: &JSGlobalObject,
    arg_options: *const crate::node::os::gen_::UserInfoOptions,
) -> JSValue {
    // SAFETY: `arg_options` is a valid C++ stack local; `UserInfoOptions` is
    // `#[repr(C)]` matching the bindgen `extern struct`.
    let options = unsafe { core::ptr::read(arg_options) };
    bun_jsc::host_fn::to_js_host_call(global, || node_os::user_info(global, options))
}

// HOST_EXPORT(bindgen_Node_os_dispatchVersion1, c)
pub fn bindgen_node_os_dispatch_version(
    global: &JSGlobalObject,
    out: *mut bun_core::String,
) -> bool {
    bindgen_out(global, out, node_os::version())
}

// HOST_EXPORT(bindgen_Node_os_dispatchSetPriority1, c)
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

// HOST_EXPORT(bindgen_Node_os_dispatchSetPriority2, c)
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

// ─── js2native bindgen create-callback exports (GeneratedJS2Native.zig) ──────
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
    let name = bun_core::ZigString::init_utf8(b"fmtString");
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
    let name = bun_core::ZigString::init_utf8(b"getDeinitCountForTesting");
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
