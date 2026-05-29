//! PHASE-C link bridge — **transient**, not a permanent grab-bag.
//!
//! Every symbol that used to be stubbed here now has a real home (the `.rs`
//! sibling of the Zig `export fn`) inside `bun_jsc` / `bun_runtime` /
//! `bun_http_jsc` / `bun_bundler_jsc`. As of this revision `bun_runtime` (and
//! transitively `bun_jsc`) is a real dependency of this binary crate, so any
//! `#[no_mangle]` definition that compiles in either of those crates is now
//! visible to the linker — the corresponding stub has been deleted.
//!
//! What remains is the small set of symbols that are either (a) defined here
//! directly because this is their proper home, (b) safe-default placeholders
//! whose real body still depends on a gated crate, or (c) genuinely
//! unimplemented anywhere (no Zig `export fn`, no C++ body) — those are
//! `unreachable!` so a stray call is loud rather than silent garbage.
//!
//! `__wrap_gettid` is NOT here — it lives in `bun_core` (its proper,
//! already-linked home).
//!
//! Calling convention: `jsc.conv` is plain `"C"` on every non-Windows-x64
//! target, so `extern "C"` is correct on Linux/macOS. The Windows path is not
//! exercised in Phase C.

#![allow(
    non_snake_case,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref
)]

use core::ffi::c_void;

// ────────────────────────────────────────────────────────────────────────────
// Opaque handles — pointer-sized, never dereferenced here.
// ────────────────────────────────────────────────────────────────────────────
type JSGlobalObject = c_void;
type JSValue = i64; // JSC::EncodedJSValue
type VirtualMachine = c_void;

// ════════════════════════════════════════════════════════════════════════════
// Exported variables (Zig: `export var` / `@export(&var, …)`)
// ════════════════════════════════════════════════════════════════════════════

// REAL: now provided by bun_analytics (src/analytics/lib.rs).
// Bun__napi_module_register_count
// Bun__isEpollPwait2SupportedOnLinuxKernel

// REAL: now provided by bun_uws (src/uws/lib.rs).
// BUN__warn__extra_ca_load_failed

// ════════════════════════════════════════════════════════════════════════════
// Real-body exports (no gated-crate dependency)
// ════════════════════════════════════════════════════════════════════════════

// PHASE-C: C++ callback — Zig: `pub export fn Bun__panic(msg, len) noreturn`
// REAL: src/main.rs (binary-level export; defined here directly)
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__panic(msg: *const u8, len: usize) -> ! {
    let bytes = if msg.is_null() {
        &b""[..]
    } else {
        // SAFETY: `msg` is non-null (checked above) and the C++ caller guarantees it is valid for reading `len` bytes for the duration of this call.
        unsafe { core::slice::from_raw_parts(msg, len) }
    };
    bun_core::output::panic(format_args!("{}", String::from_utf8_lossy(bytes)));
}

// REAL: now provided by bun_jsc (src/jsc/array_buffer.rs).
// MarkedArrayBuffer_deallocator

// REAL: now provided by bun_jsc (src/jsc/ZigString.rs).
// ZigString__freeGlobal

// REAL: now provided by bun_runtime (src/runtime/node/node_process.rs).
// Bun__NODE_NO_WARNINGS

// REAL: `Bun__getTLSRejectUnauthorizedValue` / `Bun__isNoProxy` now exported
// directly from `bun_jsc::virtual_machine_exports` (un-gated in phase-d).

// REAL: now provided by bun_runtime (src/runtime/napi/napi_body.rs).
// napi_internal_suppress_crash_on_abort_if_desired

// REAL: now provided by bun_runtime (src/runtime/api/bun/SSLContextCache.rs).
// bun_ssl_ctx_cache_on_free

// REAL: src/jsc/JSCScheduler.rs
// Bun__eventLoop__incrementRefConcurrently

// REAL: src/runtime/api/BunObject.rs
// Bun__inspect
// Bun__reportError

// REAL: src/runtime/timer/DateHeaderTimer.rs
// Bun__internal_ensureDateHeaderTimerIsEnabled

// REAL: src/jsc/CppTask.rs
// ConcurrentCppTask__createAndRun

// REAL: src/jsc/AbortSignal.rs
// AbortSignal__Timeout__create
// AbortSignal__Timeout__deinit

// REAL: src/jsc/ConsoleObject.rs
// Bun__ConsoleObject__messageWithTypeAndLevel

// REAL: now provided by bun_jsc (src/jsc/VirtualMachine.rs).
// Bun__VM__allowRejectionHandledWarning

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__VM__scriptExecutionStatus(_vm: *const VirtualMachine) -> i32 {
    // jsc.ScriptExecutionStatus.running = 0
    0
}

// REAL: now provided by bun_jsc (src/jsc/VirtualMachine.rs).
// Bun__VM__useIsolationSourceProviderCache

// REAL: src/runtime/webcore/ObjectURLRegistry.rs
// Bun__createObjectURL
// Bun__revokeObjectURL

// REAL: src/runtime/webcore/FormData.rs
// FormData__jsFunctionFromMultipartData

// ── WebSocket ───────────────────────────────────────────────────────────────
// REAL: src/http_jsc/websocket_client/WebSocketUpgradeClient.rs
// Bun__WebSocket__freeSSLConfig

// ── bundler analyze ─────────────────────────────────────────────────────────
// REAL: src/bundler/analyze_transpiled_module.rs
// zig__ModuleInfoDeserialized__deinit

// REAL: src/bundler_jsc/analyze_jsc.rs
// zig__ModuleInfoDeserialized__toJSModuleRecord
// zig__renderDiff

// Declared `CPP_DECL` in headers.h:279 but bindings.cpp never defines it.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn JSC__JSValue__parseJSON(
    _string: *const c_void,
    _global: *const JSGlobalObject,
) -> JSValue {
    unreachable!(
        "JSC__JSValue__parseJSON: not implemented in Zig either (CPP_DECL with no C++ body)"
    )
}

// Imported by bun_jsc/bun_sys_jsc as extern but no provider in C++ or Zig.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn BunString__toErrorInstance(
    _this: *const c_void,
    _global: *mut JSGlobalObject,
) -> JSValue {
    unreachable!("BunString__toErrorInstance: not implemented in Zig either (no C++ body)")
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__LifecycleAgentPreventExit(_agent: *mut c_void) {}
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__LifecycleAgentStopPreventingExit(_agent: *mut c_void) {}

// `generated_classes.rs` emits `<Class>__getConstructor` externs unconditionally,
// but `ZigGeneratedClasses.cpp` only defines them for classes whose `.classes.ts`
// declares a `construct` hook. `DNSResolver` has none — the extern is dead.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn DNSResolver__getConstructor(_global: *mut JSGlobalObject) -> JSValue {
    unreachable!("DNSResolver has no JS-visible constructor (no `construct` in .classes.ts)")
}

// (zig__renderDiff now defined in src/runtime/test_runner/diff_format.rs.)
// (zig__ModuleInfoDeserialized__toJSModuleRecord now defined in src/bundler_jsc/analyze_jsc.rs.)
