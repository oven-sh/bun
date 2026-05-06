//! PHASE-C link bridge — **transient**, not a permanent grab-bag.
//!
//! Every symbol below has a real home (see the `// REAL:` path on each entry,
//! which is the `.rs` sibling of the Zig `export fn`). Those homes live in
//! `bun_jsc` / `bun_runtime` / `bun_http_jsc` / `bun_bundler_jsc`, none of
//! which currently compile and therefore are **not** dependencies of this
//! binary crate (see the commented-out deps in `Cargo.toml`). Until they are,
//! a `#[no_mangle]` definition there is invisible to the linker.
//!
//! This file satisfies `ld.lld` with ABI-correct stubs so `cargo build -p
//! bun_bin` reaches 0 undefined references. As each upstream crate is added
//! to `[dependencies]`, delete the matching block here — the linker will flag
//! any you miss as a duplicate symbol.
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

use core::ffi::{c_char, c_int, c_long, c_void};

// ────────────────────────────────────────────────────────────────────────────
// Opaque handles — pointer-sized, never dereferenced here.
// ────────────────────────────────────────────────────────────────────────────
type JSGlobalObject = c_void;
type JSValue = i64; // JSC::EncodedJSValue
type CallFrame = c_void;
type VirtualMachine = c_void;
type CppTask = c_void;
type JSString = c_void;
type AbortSignal = c_void;
type Timeout = c_void;
type Blob = c_void;
type BlockList = c_void;
type ConsoleObject = c_void;
type SSLConfig = c_void;
type WebWorker = c_void;
type WTFStringImpl = c_void;
type EventLoopTaskNoContext = c_void;
type ModuleInfoDeserialized = c_void;
type UwsLoop = c_void;
type UsSocket = c_void;

/// `bun.String` — `{ tag: u8, impl: *WTFStringImpl }` (16 bytes, ptr-aligned).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct BunString {
    tag: u8,
    impl_: *const c_void,
}

/// `uws.us_bun_verify_error_t` — passed by value to `us_dispatch_handshake`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct UsBunVerifyError {
    error: c_int,
    code: *const c_char,
    reason: *const c_char,
}

type WriteBytesFn = unsafe extern "C" fn(*mut c_void, *const u8, u32);
type NapiFinalize = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void);

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
    let bytes = if msg.is_null() { &b""[..] } else { unsafe { core::slice::from_raw_parts(msg, len) } };
    bun_core::output::panic(format_args!("{}", String::from_utf8_lossy(bytes)));
}

// PHASE-C: C++ deallocator — Zig: `export fn MarkedArrayBuffer_deallocator(bytes, ctx) void`
// REAL: src/jsc/array_buffer.rs (gated under `#[cfg(any())] mod _body`).
// Body is identical to the real impl: mi_free the buffer.
#[unsafe(no_mangle)]
pub extern "C" fn MarkedArrayBuffer_deallocator(bytes: *mut c_void, _ctx: *mut c_void) {
    // SAFETY: bytes was allocated by mimalloc (default_allocator); mi_free is null-safe.
    unsafe { bun_mimalloc_sys::mimalloc::mi_free(bytes) };
}

// PHASE-C: C++ callback — Zig: `export fn ZigString__freeGlobal(ptr, len) void`
// REAL: src/jsc/ZigString.rs
// Frees a slice allocated via `bun.default_allocator` (= mimalloc). The
// process allocator is mimalloc, so route straight to it.
#[unsafe(no_mangle)]
pub extern "C" fn ZigString__freeGlobal(ptr: *const u8, len: usize) {
    let _ = len;
    if !ptr.is_null() {
        // SAFETY: contract is that `ptr` came from the global (mimalloc) allocator.
        unsafe { bun_mimalloc_sys::mimalloc::mi_free(ptr as *mut c_void) };
    }
}

// PHASE-C: C++ callback — Zig: `export fn Bun__NODE_NO_WARNINGS() bool`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__NODE_NO_WARNINGS() -> bool {
    // Real impl reads VirtualMachine env loader; until that's wired, honour
    // the env var directly so `--no-warnings` plumbing isn't silently broken.
    std::env::var_os("NODE_NO_WARNINGS").is_some_and(|v| v == "1")
}

// PHASE-C: C++ callback — Zig: `export fn Bun__getTLSRejectUnauthorizedValue() i32`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__getTLSRejectUnauthorizedValue() -> i32 {
    // Default = reject (1). Real impl consults VirtualMachine.get().
    1
}

// PHASE-C: C++ callback — Zig: `export fn Bun__isNoProxy(host_ptr, host_len, …) bool`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__isNoProxy(
    hostname_ptr: *const u8,
    hostname_len: usize,
    host_ptr: *const u8,
    host_len: usize,
) -> bool {
    let _ = (hostname_ptr, hostname_len, host_ptr, host_len);
    false
}

// PHASE-C: C++ callback — Zig: `export fn napi_internal_suppress_crash_on_abort_if_desired() void`
#[unsafe(no_mangle)]
pub extern "C" fn napi_internal_suppress_crash_on_abort_if_desired() {
    // No-op until crash_handler exposes the suppression hook.
}

// PHASE-C: C++ callback — Zig: `export fn bun_ssl_ctx_cache_on_free(...) void`
// CRYPTO_EX_free signature; safe no-op until SSLContextCache is wired.
#[unsafe(no_mangle)]
pub extern "C" fn bun_ssl_ctx_cache_on_free(
    parent: *mut c_void,
    ptr: *mut c_void,
    ad: *mut c_void,
    index: c_int,
    argl: c_long,
    argp: *mut c_void,
) {
    let _ = (parent, ptr, ad, index, argl, argp);
}

// PHASE-C: C++ callback — `highway_index_of_newline_or_non_ascii_or_ansi` is
// declared in `bun_highway` but has no backing C++ impl in
// `highway_strings.cpp` (the `_or_ansi` variant was removed upstream). The
// only Rust caller is gated; export a stub so the rlib's extern ref resolves.
#[unsafe(no_mangle)]
pub extern "C" fn highway_index_of_newline_or_non_ascii_or_ansi(
    haystack: *const u8,
    haystack_len: usize,
) -> usize {
    let _ = haystack;
    haystack_len // "not found" sentinel
}

// ════════════════════════════════════════════════════════════════════════════
// todo!() stubs — real bodies live in bun_jsc / bun_runtime (gated)
// ════════════════════════════════════════════════════════════════════════════

macro_rules! phase_c_todo {
    ($name:literal) => {
        todo!(concat!("PHASE-C: ", $name, " — un-gate bun_runtime/bun_jsc"))
    };
}

// ── VM bridge ───────────────────────────────────────────────────────────────
// REAL: src/jsc/virtual_machine_exports.rs, src/jsc/VirtualMachine.rs,
//       src/jsc/JSCScheduler.rs, src/runtime/api/BunObject.rs,
//       src/runtime/timer/DateHeaderTimer.rs

#[unsafe(no_mangle)]
pub extern "C" fn Bun__getVM() -> *mut VirtualMachine {
    phase_c_todo!("Bun__getVM")
}

// REAL: src/jsc/virtual_machine_exports.rs (gated under `#![cfg(any())]`)
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__exitDuringUncaughtException(this: *mut VirtualMachine) {
    phase_c_todo!("Bun__VirtualMachine__exitDuringUncaughtException")
}

// REAL: src/jsc/VirtualMachine.rs (no Rust impl yet — C++ BunProcess.cpp caller)
// Default = allow the warning (matches Zig `is_handled_promise_warned == false`).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__allowRejectionHandledWarning(vm: *mut VirtualMachine) -> bool {
    let _ = vm;
    true
}

// REAL: C++ ZigGlobalObject.cpp (not in the Phase-C link set)
#[unsafe(no_mangle)]
pub extern "C" fn Bun__JSC_GlobalObject__handleRejectedPromises(global: *mut JSGlobalObject) {
    phase_c_todo!("Bun__JSC_GlobalObject__handleRejectedPromises")
}

// REAL: C++ bindings.cpp `JSC__JSValue__parseJSON` (not in the Phase-C link set)
#[unsafe(no_mangle)]
pub extern "C" fn JSC__JSValue__parseJSON(string: *const c_void, global: *const JSGlobalObject) -> JSValue {
    phase_c_todo!("JSC__JSValue__parseJSON")
}

// REAL: C++ BunString.cpp `BunString__toErrorInstance` (not in the Phase-C link set)
#[unsafe(no_mangle)]
pub extern "C" fn BunString__toErrorInstance(this: *const c_void, global: *mut JSGlobalObject) -> JSValue {
    phase_c_todo!("BunString__toErrorInstance")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTask(global: *mut JSGlobalObject, task: *mut CppTask) {
    phase_c_todo!("Bun__queueTask")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueTaskConcurrently(global: *mut JSGlobalObject, task: *mut CppTask) {
    phase_c_todo!("Bun__queueTaskConcurrently")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__readOriginTimer(vm: *mut VirtualMachine) -> u64 {
    phase_c_todo!("Bun__readOriginTimer")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__readOriginTimerStart(vm: *mut VirtualMachine) -> f64 {
    phase_c_todo!("Bun__readOriginTimerStart")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportError(global: *mut JSGlobalObject, err: JSValue) {
    phase_c_todo!("Bun__reportError")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__reportUnhandledError(global: *mut JSGlobalObject, value: JSValue) -> JSValue {
    phase_c_todo!("Bun__reportUnhandledError")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__scriptExecutionStatus(vm: *const VirtualMachine) -> i32 {
    // jsc.ScriptExecutionStatus.running = 0
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__useIsolationSourceProviderCache(vm: *mut VirtualMachine) -> bool {
    false
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__incrementRefConcurrently(vm: *mut VirtualMachine, delta: c_int) {
    phase_c_todo!("Bun__eventLoop__incrementRefConcurrently")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__inspect(global: *mut JSGlobalObject, value: JSValue) -> BunString {
    phase_c_todo!("Bun__inspect")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: *mut UwsLoop) {
    phase_c_todo!("Bun__internal_ensureDateHeaderTimerIsEnabled")
}

// ── ConsoleObject ───────────────────────────────────────────────────────────
// REAL: src/jsc/ConsoleObject.rs

#[unsafe(no_mangle)]
pub extern "C" fn Bun__ConsoleObject__messageWithTypeAndLevel(
    console: *mut ConsoleObject,
    message_type: u32,
    level: u32,
    global: *mut JSGlobalObject,
    vals: *const JSValue,
    len: usize,
) {
    phase_c_todo!("Bun__ConsoleObject__messageWithTypeAndLevel")
}

// ── CppTask ─────────────────────────────────────────────────────────────────
// REAL: src/jsc/CppTask.rs

#[unsafe(no_mangle)]
pub extern "C" fn ConcurrentCppTask__createAndRun(cpp_task: *mut EventLoopTaskNoContext) {
    phase_c_todo!("ConcurrentCppTask__createAndRun")
}

// ── AbortSignal.Timeout ─────────────────────────────────────────────────────
// REAL: src/jsc/AbortSignal.rs

#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__create(
    vm: *mut VirtualMachine,
    signal: *mut AbortSignal,
    milliseconds: u64,
) -> *mut Timeout {
    phase_c_todo!("AbortSignal__Timeout__create")
}

#[unsafe(no_mangle)]
pub extern "C" fn AbortSignal__Timeout__deinit(this: *mut Timeout) {
    phase_c_todo!("AbortSignal__Timeout__deinit")
}

// ── Host fns: `(global, callframe) -> JSValue` ──────────────────────────────
// REAL: src/runtime/webcore/{fetch,ObjectURLRegistry,prompt,FormData}.rs

#[unsafe(no_mangle)]
pub extern "C" fn Bun__fetch(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("Bun__fetch")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__fetchPreconnect(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("Bun__fetchPreconnect")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__createObjectURL(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("Bun__createObjectURL")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__revokeObjectURL(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("Bun__revokeObjectURL")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebCore__alert(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("WebCore__alert")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebCore__confirm(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("WebCore__confirm")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebCore__prompt(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {
    phase_c_todo!("WebCore__prompt")
}

#[unsafe(no_mangle)]
pub extern "C" fn FormData__jsFunctionFromMultipartData(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    phase_c_todo!("FormData__jsFunctionFromMultipartData")
}

// ── WebSocket ───────────────────────────────────────────────────────────────
// REAL: src/http_jsc/websocket_client/WebSocketUpgradeClient.rs

#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebSocket__freeSSLConfig(config: *mut SSLConfig) {
    phase_c_todo!("Bun__WebSocket__freeSSLConfig")
}

// ── WebWorker ───────────────────────────────────────────────────────────────
// REAL: src/jsc/web_worker.rs

#[unsafe(no_mangle)]
pub extern "C" fn WebWorker__create(
    cpp_worker: *mut c_void,
    parent: *mut VirtualMachine,
    name_str: BunString,
    specifier_str: BunString,
    error_message: *mut BunString,
    parent_context_id: u32,
    this_context_id: u32,
    mini: bool,
    default_unref: bool,
    eval_mode: bool,
    argv_ptr: *mut WTFStringImpl,
    argv_len: usize,
    inherit_exec_argv: bool,
    exec_argv_ptr: *mut WTFStringImpl,
    exec_argv_len: usize,
    preload_modules_ptr: *mut BunString,
    preload_modules_len: usize,
) -> *mut WebWorker {
    phase_c_todo!("WebWorker__create")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebWorker__destroy(this: *mut WebWorker) {
    phase_c_todo!("WebWorker__destroy")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebWorker__notifyNeedTermination(this: *mut WebWorker) {
    phase_c_todo!("WebWorker__notifyNeedTermination")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebWorker__setRef(this: *mut WebWorker, value: bool) {
    phase_c_todo!("WebWorker__setRef")
}

#[unsafe(no_mangle)]
pub extern "C" fn WebWorker__getParentWorker(vm: *mut VirtualMachine) -> *mut c_void {
    core::ptr::null_mut()
}

// ── encoding ────────────────────────────────────────────────────────────────
// REAL: src/runtime/webcore/encoding.rs

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__writeLatin1(
    input: *const u8,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    phase_c_todo!("Bun__encoding__writeLatin1")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__writeUTF16(
    input: *const u16,
    len: usize,
    to: *mut u8,
    to_len: usize,
    encoding: u8,
) -> usize {
    phase_c_todo!("Bun__encoding__writeUTF16")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__byteLengthLatin1AsUTF8(input: *const u8, len: usize) -> usize {
    phase_c_todo!("Bun__encoding__byteLengthLatin1AsUTF8")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__byteLengthUTF16AsUTF8(input: *const u16, len: usize) -> usize {
    phase_c_todo!("Bun__encoding__byteLengthUTF16AsUTF8")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__encoding__toString(
    input: *const u8,
    len: usize,
    global: *mut JSGlobalObject,
    encoding: u8,
) -> JSValue {
    phase_c_todo!("Bun__encoding__toString")
}

// ── TextEncoder ─────────────────────────────────────────────────────────────
// REAL: src/runtime/webcore/TextEncoder.rs

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encode8(
    global: *mut JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    phase_c_todo!("TextEncoder__encode8")
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encode16(
    global: *mut JSGlobalObject,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    phase_c_todo!("TextEncoder__encode16")
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encodeRopeString(
    global: *mut JSGlobalObject,
    rope_str: *mut JSString,
) -> JSValue {
    phase_c_todo!("TextEncoder__encodeRopeString")
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encodeInto16(
    input_ptr: *const u16,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> u64 {
    phase_c_todo!("TextEncoder__encodeInto16")
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encodeInto8(
    input_ptr: *const u8,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> u64 {
    phase_c_todo!("TextEncoder__encodeInto8")
}

// ── Blob ────────────────────────────────────────────────────────────────────
// REAL: src/runtime/webcore/Blob.rs (+ generated .classes.ts hooks)

#[unsafe(no_mangle)]
pub extern "C" fn Blob__dupeFromJS(value: JSValue) -> *mut Blob {
    phase_c_todo!("Blob__dupeFromJS")
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__dupe(this: *mut Blob) -> *mut Blob {
    phase_c_todo!("Blob__dupe")
}

// REAL: now provided by bun_runtime (src/runtime/webcore/Blob.rs).
// Blob__deref

#[unsafe(no_mangle)]
pub extern "C" fn Blob__setAsFile(this: *mut Blob, path_str: *mut BunString) {
    phase_c_todo!("Blob__setAsFile")
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getFileNameString(this: *mut Blob) -> BunString {
    phase_c_todo!("Blob__getFileNameString")
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getDataPtr(value: JSValue) -> *mut c_void {
    phase_c_todo!("Blob__getDataPtr")
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getSize(value: JSValue) -> usize {
    phase_c_todo!("Blob__getSize")
}

// REAL: src/runtime/webcore/Blob.rs (gated)
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Blob__getSizeForBindings(this: *mut Blob) -> u64 {
    phase_c_todo!("Bun__Blob__getSizeForBindings")
}

// .classes.ts hooks (build/debug/codegen/ZigGeneratedClasses.zig)
#[unsafe(no_mangle)]
pub extern "C" fn Blob__estimatedSize(this: *mut Blob) -> usize {
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn BlobClass__finalize(this: *mut Blob) {
    phase_c_todo!("BlobClass__finalize")
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__onStructuredCloneSerialize(
    this: *mut Blob,
    global: *mut JSGlobalObject,
    ctx: *mut c_void,
    write_bytes: WriteBytesFn,
) {
    phase_c_todo!("Blob__onStructuredCloneSerialize")
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__onStructuredCloneDeserialize(
    global: *mut JSGlobalObject,
    ptr: *mut *mut u8,
    end: *const u8,
) -> JSValue {
    phase_c_todo!("Blob__onStructuredCloneDeserialize")
}

// ── BlockList (.classes.ts hooks) ───────────────────────────────────────────
// REAL: src/runtime/node/net/BlockList.rs

#[unsafe(no_mangle)]
pub extern "C" fn BlockList__estimatedSize(this: *mut BlockList) -> usize {
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn BlockListClass__finalize(this: *mut BlockList) {
    phase_c_todo!("BlockListClass__finalize")
}

#[unsafe(no_mangle)]
pub extern "C" fn BlockList__onStructuredCloneSerialize(
    this: *mut BlockList,
    global: *mut JSGlobalObject,
    ctx: *mut c_void,
    write_bytes: WriteBytesFn,
) {
    phase_c_todo!("BlockList__onStructuredCloneSerialize")
}

#[unsafe(no_mangle)]
pub extern "C" fn BlockList__onStructuredCloneDeserialize(
    global: *mut JSGlobalObject,
    ptr: *mut *mut u8,
    end: *const u8,
) -> JSValue {
    phase_c_todo!("BlockList__onStructuredCloneDeserialize")
}

// ── WebView process control ─────────────────────────────────────────────────
// REAL: src/runtime/webview/{ChromeProcess,HostProcess}.rs (gated)
// No-op pre-runtime: there is no spawned browser/host process to kill.

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Chrome__kill() {}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebViewHost__kill() {}

// ── napi ────────────────────────────────────────────────────────────────────
// REAL: src/runtime/napi/napi.rs

type NapiEnv = *mut c_void;
type NapiValue = *mut c_void;
type NapiStatus = c_int;

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_string_latin1(
    env: NapiEnv,
    str: *const u8,
    length: usize,
    result: *mut NapiValue,
) -> NapiStatus {
    phase_c_todo!("napi_create_string_latin1")
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_string_utf8(
    env: NapiEnv,
    str: *const u8,
    length: usize,
    result: *mut NapiValue,
) -> NapiStatus {
    phase_c_todo!("napi_create_string_utf8")
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_create_string_utf16(
    env: NapiEnv,
    str: *const u16,
    length: usize,
    result: *mut NapiValue,
) -> NapiStatus {
    phase_c_todo!("napi_create_string_utf16")
}

#[unsafe(no_mangle)]
pub extern "C" fn napi_internal_enqueue_finalizer(
    env: NapiEnv,
    fun: NapiFinalize,
    data: *mut c_void,
    hint: *mut c_void,
) {
    phase_c_todo!("napi_internal_enqueue_finalizer")
}

// ── usockets dispatch ───────────────────────────────────────────────────────
// REAL: src/runtime/socket/uws_dispatch.rs (already has #[no_mangle] exports)

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_open(
    s: *mut UsSocket,
    is_client: c_int,
    ip: *mut u8,
    ip_len: c_int,
) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_open")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_close(
    s: *mut UsSocket,
    code: c_int,
    reason: *mut c_void,
) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_close")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_timeout(s: *mut UsSocket) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_timeout")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_long_timeout(s: *mut UsSocket) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_long_timeout")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_handshake(s: *mut UsSocket, ok: c_int, err: UsBunVerifyError) {
    phase_c_todo!("us_dispatch_handshake")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_data(s: *mut UsSocket, data: *mut u8, len: c_int) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_data")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_fd(s: *mut UsSocket, fd: c_int) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_fd")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_writable(s: *mut UsSocket) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_writable")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_end(s: *mut UsSocket) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_end")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_connect_error(s: *mut UsSocket, code: c_int) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_connect_error")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_connecting_error(c: *mut c_void, code: c_int) -> *mut c_void {
    phase_c_todo!("us_dispatch_connecting_error")
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_ssl_raw_tap(
    s: *mut UsSocket,
    data: *mut u8,
    len: c_int,
) -> *mut UsSocket {
    phase_c_todo!("us_dispatch_ssl_raw_tap")
}

// ── DNS addrinfo (usockets → bun_runtime::dns_jsc) ──────────────────────────
// REAL: src/runtime/dns_jsc/dns.rs (gated until bun_jsc compiles)

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addrinfo_get(
    loop_: *mut UwsLoop,
    host: *const c_char,
    port: u16,
    socket: *mut *mut c_void,
) -> c_int {
    phase_c_todo!("Bun__addrinfo_get")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addrinfo_set(request: *mut c_void, socket: *mut c_void) {
    phase_c_todo!("Bun__addrinfo_set")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addrinfo_cancel(request: *mut c_void, socket: *mut c_void) -> c_int {
    phase_c_todo!("Bun__addrinfo_cancel")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addrinfo_freeRequest(req: *mut c_void, err: c_int) {
    phase_c_todo!("Bun__addrinfo_freeRequest")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__addrinfo_getRequestResult(req: *mut c_void) -> *mut c_void {
    phase_c_todo!("Bun__addrinfo_getRequestResult")
}

// ── bundler analyze ─────────────────────────────────────────────────────────
// REAL: src/bundler/analyze_transpiled_module.rs, src/bundler_jsc/analyze_jsc.rs

// REAL: now provided by bun_bundler (src/bundler/analyze_transpiled_module.rs).
// zig__ModuleInfoDeserialized__deinit

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfoDeserialized__toJSModuleRecord(
    global: *mut JSGlobalObject,
    vm: *mut c_void,
    module_key: *const c_void,
    source_code: *const c_void,
    info: *mut ModuleInfoDeserialized,
    promise: *mut c_void,
) -> JSValue {
    phase_c_todo!("zig__ModuleInfoDeserialized__toJSModuleRecord")
}

#[unsafe(no_mangle)]
pub extern "C" fn zig__renderDiff(
    expected_ptr: *const u8,
    expected_len: usize,
    received_ptr: *const u8,
    received_len: usize,
    global: *mut JSGlobalObject,
) {
    phase_c_todo!("zig__renderDiff")
}
