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
//! `__wrap_gettid` and `Bun__captureStackTrace` are NOT here — they live in
//! `bun_core` (their proper, already-linked home).
//!
//! Calling convention: `jsc.conv` is plain `"C"` on every non-Windows-x64
//! target, so `extern "C"` is correct on Linux/macOS. The Windows path is not
//! exercised in Phase C.

#![allow(
    non_snake_case,
    unused_variables,
    clippy::missing_safety_doc,
    clippy::not_unsafe_ptr_arg_deref
)]

use core::ffi::{c_int, c_long, c_void};

// ────────────────────────────────────────────────────────────────────────────
// Opaque handles — pointer-sized, never dereferenced here.
// ────────────────────────────────────────────────────────────────────────────
type JSGlobalObject = c_void;
type JSValue = i64; // JSC::EncodedJSValue
type VirtualMachine = c_void;

// ════════════════════════════════════════════════════════════════════════════
// Exported variables (Zig: `export var` / `@export(&var, …)`)
// ════════════════════════════════════════════════════════════════════════════

// REAL: now provided by bun_jsc (src/jsc/VirtualMachine.rs).
// isBunTest
// Bun__stringSyntheticAllocationLimit
// Bun__defaultRemainingRunsUntilSkipReleaseAccess
// Bun__getDefaultGlobalObject

// REAL: now provided by bun_runtime (src/runtime/cli/Arguments.rs).
// Bun__Node__ProcessNoDeprecation
// Bun__Node__ProcessThrowDeprecation
// Bun__Node__UseSystemCA

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
pub extern "C" fn Bun__panic(msg: *const u8, len: usize) -> ! {
    // SAFETY: caller guarantees `msg` is valid for `len` bytes.
    let bytes = if msg.is_null() {
        &b""[..]
    } else {
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

// ════════════════════════════════════════════════════════════════════════════
// Resolved stubs — real `#[no_mangle]` bodies live in bun_jsc / bun_runtime /
// bun_http_jsc / bun_bundler_jsc. Stub deleted; linker resolves to the crate
// definition (or flags it if the upstream gate hasn't been lifted yet).
// ════════════════════════════════════════════════════════════════════════════

// ── VM bridge ───────────────────────────────────────────────────────────────
// REAL: src/jsc/virtual_machine_exports.rs
// Bun__getVM
// Bun__VirtualMachine__exitDuringUncaughtException
// Bun__queueTask
// Bun__queueTaskConcurrently
// Bun__readOriginTimer
// Bun__readOriginTimerStart
// Bun__reportUnhandledError

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
pub extern "C" fn Bun__VM__scriptExecutionStatus(vm: *const VirtualMachine) -> i32 {
    // jsc.ScriptExecutionStatus.running = 0
    0
}

// REAL: now provided by bun_jsc (src/jsc/VirtualMachine.rs).
// Bun__VM__useIsolationSourceProviderCache

// ── Host fns: `(global, callframe) -> JSValue` ──────────────────────────────
// REAL: src/runtime/webcore/fetch.rs
// Bun__fetch
// Bun__fetchPreconnect

// REAL: src/runtime/webcore/ObjectURLRegistry.rs
// Bun__createObjectURL
// Bun__revokeObjectURL

// REAL: src/runtime/webcore/prompt.rs
// WebCore__alert
// WebCore__confirm
// WebCore__prompt

// REAL: src/runtime/webcore/FormData.rs
// FormData__jsFunctionFromMultipartData

// ── WebSocket ───────────────────────────────────────────────────────────────
// REAL: src/http_jsc/websocket_client/WebSocketUpgradeClient.rs
// Bun__WebSocket__freeSSLConfig

// ── WebWorker ───────────────────────────────────────────────────────────────
// REAL: src/jsc/web_worker.rs
// WebWorker__create
// WebWorker__destroy
// WebWorker__notifyNeedTermination
// WebWorker__setRef
// WebWorker__getParentWorker

// ── encoding ────────────────────────────────────────────────────────────────
// REAL: src/runtime/webcore/encoding.rs
// Bun__encoding__writeLatin1
// Bun__encoding__writeUTF16
// Bun__encoding__byteLengthLatin1AsUTF8
// Bun__encoding__byteLengthUTF16AsUTF8
// Bun__encoding__toString

// ── TextEncoder ─────────────────────────────────────────────────────────────
// REAL: src/runtime/webcore/TextEncoder.rs
// TextEncoder__encode8
// TextEncoder__encode16
// TextEncoder__encodeRopeString
// TextEncoder__encodeInto16
// TextEncoder__encodeInto8

// ── Blob ────────────────────────────────────────────────────────────────────
// REAL: src/runtime/webcore/Blob.rs
// Blob__dupeFromJS
// Blob__dupe
// Blob__deref
// Blob__setAsFile
// Blob__getFileNameString
// Blob__getDataPtr
// Blob__getSize
// Bun__Blob__getSizeForBindings

// .classes.ts hooks (build/debug/codegen/ZigGeneratedClasses.zig)
// REAL: now provided by bun_runtime::generated_classes
//   (build/debug/codegen/generated_classes.rs via generateRust()).
// Blob__estimatedSize
// BlobClass__finalize
// Blob__onStructuredCloneSerialize
// Blob__onStructuredCloneDeserialize
// BlockList__estimatedSize
// BlockList__onStructuredCloneSerialize
// BlockList__onStructuredCloneDeserialize

// ── WebView process control ─────────────────────────────────────────────────
// REAL: src/runtime/webview/{ChromeProcess,HostProcess}.rs (`mod webview` not
// (Bun__Chrome__kill / Bun__WebViewHost__kill now defined in
//  src/runtime/webview/{ChromeProcess,HostProcess}.rs.)

// ── napi ────────────────────────────────────────────────────────────────────
// REAL: src/runtime/napi/napi_body.rs
// napi_create_string_latin1
// napi_create_string_utf8
// napi_create_string_utf16
// napi_internal_enqueue_finalizer

// ── usockets dispatch ───────────────────────────────────────────────────────
// REAL: src/runtime/socket/uws_dispatch.rs
// us_dispatch_open
// us_dispatch_close
// us_dispatch_timeout
// us_dispatch_long_timeout
// us_dispatch_handshake
// us_dispatch_data
// us_dispatch_fd
// us_dispatch_writable
// us_dispatch_end
// us_dispatch_connect_error
// us_dispatch_connecting_error
// us_dispatch_ssl_raw_tap

// ── DNS addrinfo (usockets → bun_runtime::dns_jsc) ──────────────────────────
// REAL: src/runtime/dns_jsc/dns.rs
// Bun__addrinfo_get
// Bun__addrinfo_set
// Bun__addrinfo_cancel
// Bun__addrinfo_freeRequest
// Bun__addrinfo_getRequestResult

// ── bundler analyze ─────────────────────────────────────────────────────────
// REAL: src/bundler/analyze_transpiled_module.rs
// zig__ModuleInfoDeserialized__deinit

// REAL: src/bundler_jsc/analyze_jsc.rs
// zig__ModuleInfoDeserialized__toJSModuleRecord
// zig__renderDiff

// ════════════════════════════════════════════════════════════════════════════
// Genuinely unimplemented — no Zig `export fn`, no C++ body. Kept so the
// extern ref in the rlib resolves; loud crash if ever called.
// ════════════════════════════════════════════════════════════════════════════

// Declared `CPP_DECL` in headers.h:279 but bindings.cpp never defines it.
#[unsafe(no_mangle)]
pub extern "C" fn JSC__JSValue__parseJSON(
    string: *const c_void,
    global: *const JSGlobalObject,
) -> JSValue {
    unreachable!(
        "JSC__JSValue__parseJSON: not implemented in Zig either (CPP_DECL with no C++ body)"
    )
}

// Imported by bun_jsc/bun_sys_jsc as extern but no provider in C++ or Zig.
#[unsafe(no_mangle)]
pub extern "C" fn BunString__toErrorInstance(
    this: *const c_void,
    global: *mut JSGlobalObject,
) -> JSValue {
    unreachable!("BunString__toErrorInstance: not implemented in Zig either (no C++ body)")
}

// Declared `extern` in InspectorLifecycleAgent.cpp:47-48 but never defined in
// C++ nor Zig (Debugger.zig declares it `extern "c"` too). The agent's
// preventExit/stopPreventingExit protocol commands are no-ops in the inspector
// build today.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__LifecycleAgentPreventExit(_agent: *mut c_void) {}
#[unsafe(no_mangle)]
pub extern "C" fn Bun__LifecycleAgentStopPreventingExit(_agent: *mut c_void) {}

// `generated_classes.rs` emits `<Class>__getConstructor` externs unconditionally,
// but `ZigGeneratedClasses.cpp` only defines them for classes whose `.classes.ts`
// declares a `construct` hook. `DNSResolver` has none — the extern is dead.
#[unsafe(no_mangle)]
pub extern "C" fn DNSResolver__getConstructor(_global: *mut JSGlobalObject) -> JSValue {
    unreachable!("DNSResolver has no JS-visible constructor (no `construct` in .classes.ts)")
}

// (zig__renderDiff now defined in src/runtime/test_runner/diff_format.rs.)
// (zig__ModuleInfoDeserialized__toJSModuleRecord now defined in src/bundler_jsc/analyze_jsc.rs.)
