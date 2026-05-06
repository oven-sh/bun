//! Handwritten Zig→C++ `@export` symbols that are *not* covered by the
//! `.classes.ts` / JSSink / JS2Zig codegen (and therefore not in
//! `link_stubs.rs`). Each entry mirrors a `@export(&fn, .{ .name = "…" })`
//! site in the Zig tree; bodies panic until the owning module is ported.
//!
//! Signature source-of-truth: `src/jsc/bindings/headers.h` + the Zig
//! `callconv(.c)` / `callconv(jsc.conv)` definition referenced in each group
//! comment. `jsc.conv` is `"C"` on every target except Windows-x64 (where the
//! `#[bun_jsc::host_fn]` macro emits `"sysv64"`); stubs use `"C"` to match the
//! existing `link_stubs.rs` convention — the proc-macro rewrite happens when
//! the real port lands.
//!
//! NOTE: the 7 `H3ResponseSink__*` sink-shape symbols are intentionally *not*
//! duplicated here — `scripts/gen-link-stubs.sh` already emits them in
//! `link_stubs.rs` alongside the other JSSink instantiations.
#![allow(non_snake_case, improper_ctypes_definitions, unused_variables)]

use core::ffi::c_void;
use bun_jsc::{JSGlobalObject, CallFrame, JSValue};

// ════════════════════════════════════════════════════════════════════════════
// Bun__HTTPRequestContext{,Debug}{,TLS,H3}__on{Resolve,Reject}{,Stream}
// Zig: src/runtime/server/RequestContext.zig — `@export(&jsc.toJSHostFn(...))`
// C++: BUN_DECLARE_HOST_FUNCTION (headers.h) → JsHostFn ABI.
// ════════════════════════════════════════════════════════════════════════════
macro_rules! hw_host_fn {
    ($($sym:ident),* $(,)?) => {
        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $sym(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue {
                unreachable!(concat!("hw stub: ", stringify!($sym)))
            }
        )*
    };
}

hw_host_fn! {
    Bun__HTTPRequestContext__onResolve,
    Bun__HTTPRequestContext__onReject,
    Bun__HTTPRequestContext__onResolveStream,
    Bun__HTTPRequestContext__onRejectStream,
    Bun__HTTPRequestContextTLS__onResolve,
    Bun__HTTPRequestContextTLS__onReject,
    Bun__HTTPRequestContextTLS__onResolveStream,
    Bun__HTTPRequestContextTLS__onRejectStream,
    Bun__HTTPRequestContextH3__onResolve,
    Bun__HTTPRequestContextH3__onReject,
    Bun__HTTPRequestContextH3__onResolveStream,
    Bun__HTTPRequestContextH3__onRejectStream,
    Bun__HTTPRequestContextDebug__onResolve,
    Bun__HTTPRequestContextDebug__onReject,
    Bun__HTTPRequestContextDebug__onResolveStream,
    Bun__HTTPRequestContextDebug__onRejectStream,
    Bun__HTTPRequestContextDebugTLS__onResolve,
    Bun__HTTPRequestContextDebugTLS__onReject,
    Bun__HTTPRequestContextDebugTLS__onResolveStream,
    Bun__HTTPRequestContextDebugTLS__onRejectStream,
    Bun__HTTPRequestContextDebugH3__onResolve,
    Bun__HTTPRequestContextDebugH3__onReject,
    Bun__HTTPRequestContextDebugH3__onResolveStream,
    Bun__HTTPRequestContextDebugH3__onRejectStream,
}

// ════════════════════════════════════════════════════════════════════════════
// Misc `toJSHostFn`-wrapped exports (same JsHostFn ABI as above).
// ════════════════════════════════════════════════════════════════════════════
hw_host_fn! {
    // src/runtime/webcore/Blob.zig
    Bun__FileStreamWrapper__onResolveRequestStream,
    Bun__FileStreamWrapper__onRejectRequestStream,
    // src/sourcemap_jsc/JSSourceMap.zig
    Bun__JSSourceMap__find,
    // src/jsc/virtual_machine_exports.zig
    Bun__Process__send,
    // src/jsc/VirtualMachine.zig (`callconv(jsc.conv)` direct export)
    Bun__drainMicrotasksFromJS,
    // src/jsc/rare_data.zig
    Bun__getTLSDefaultCiphers,
    Bun__setTLSDefaultCiphers,
    // src/jsc/resolver_jsc.zig
    Resolver__nodeModulePathsForJS,
    // src/runtime/webcore/Response.zig (`callconv(jsc.conv)` direct export)
    jsFunctionRequestOrResponseHasBodyValue,
    jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer,
}

// ════════════════════════════════════════════════════════════════════════════
// FFI / Reader DOMJIT slow paths.
// Zig: src/runtime/ffi/FFIObject.zig (via `jsc.host_fn` slowpath codegen)
// C++: headers.h — `EncodedJSValue SYSV_ABI <sym>(JSGlobalObject*,
//       EncodedJSValue thisValue, EncodedJSValue* args, size_t argc)`.
// ════════════════════════════════════════════════════════════════════════════
macro_rules! hw_domjit_slowpath {
    ($($sym:ident),* $(,)?) => {
        $(
            #[unsafe(no_mangle)]
            pub extern "C" fn $sym(
                _g: *mut JSGlobalObject,
                _this: JSValue,
                _args: *mut JSValue,
                _argc: usize,
            ) -> JSValue {
                unreachable!(concat!("hw stub: ", stringify!($sym)))
            }
        )*
    };
}

hw_domjit_slowpath! {
    FFI__ptr__slowpath,
    Reader__u8__slowpath,
    Reader__u16__slowpath,
    Reader__u32__slowpath,
    Reader__u64__slowpath,
    Reader__i8__slowpath,
    Reader__i16__slowpath,
    Reader__i32__slowpath,
    Reader__i64__slowpath,
    Reader__f32__slowpath,
    Reader__f64__slowpath,
    Reader__ptr__slowpath,
    Reader__intptr__slowpath,
}

// ════════════════════════════════════════════════════════════════════════════
// JSS3File — src/runtime/webcore/S3File.zig / src/jsc/bindings/JSS3File.cpp
// ════════════════════════════════════════════════════════════════════════════

/// `construct(globalObject, callframe) callconv(jsc.conv) ?*Blob`
#[unsafe(no_mangle)]
pub extern "C" fn JSS3File__construct(_g: *mut JSGlobalObject, _c: *mut CallFrame) -> *mut c_void {
    unreachable!("hw stub: JSS3File__construct")
}

/// `getBucket(this: *Blob, globalThis) callconv(jsc.conv) JSValue`
#[unsafe(no_mangle)]
pub extern "C" fn JSS3File__bucket(_this: *mut c_void, _g: *mut JSGlobalObject) -> JSValue {
    unreachable!("hw stub: JSS3File__bucket")
}

/// `toJSHostFnWithContext(Blob, getPresignUrl)` →
/// `(ctx: *Blob, JSGlobalObject*, CallFrame*) -> EncodedJSValue`
#[unsafe(no_mangle)]
pub extern "C" fn JSS3File__presign(
    _this: *mut c_void,
    _g: *mut JSGlobalObject,
    _c: *mut CallFrame,
) -> JSValue {
    unreachable!("hw stub: JSS3File__presign")
}

/// `toJSHostFnWithContext(Blob, getStat)`
#[unsafe(no_mangle)]
pub extern "C" fn JSS3File__stat(
    _this: *mut c_void,
    _g: *mut JSGlobalObject,
    _c: *mut CallFrame,
) -> JSValue {
    unreachable!("hw stub: JSS3File__stat")
}

// ════════════════════════════════════════════════════════════════════════════
// VirtualMachine / IPC / sourcemap — src/jsc/VirtualMachine.zig & friends.
// `*VirtualMachine` is taken as `*mut c_void` here: the bun_jsc struct is
// large/in-flux and these stubs never dereference it.
// ════════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__setEntryPointEvalResultESM(_vm: *mut c_void, _result: JSValue) {
    unreachable!("hw stub: Bun__VM__setEntryPointEvalResultESM")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__setEntryPointEvalResultCJS(_vm: *mut c_void, _value: JSValue) {
    unreachable!("hw stub: Bun__VM__setEntryPointEvalResultCJS")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__specifierIsEvalEntryPoint(_vm: *mut c_void, _specifier: JSValue) -> bool {
    unreachable!("hw stub: Bun__VM__specifierIsEvalEntryPoint")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMain(_vm: *mut c_void, _is_patched: bool) {
    unreachable!("hw stub: Bun__VirtualMachine__setOverrideModuleRunMain")
}

/// `promise: *JSInternalPromise`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(
    _vm: *mut c_void,
    _promise: *mut c_void,
) {
    unreachable!("hw stub: Bun__VirtualMachine__setOverrideModuleRunMainPromise")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__closeChildIPC(_global: *mut JSGlobalObject) {
    unreachable!("hw stub: Bun__closeChildIPC")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__isMainThreadVM() -> bool {
    unreachable!("hw stub: Bun__isMainThreadVM")
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__logUnhandledException(_exception: JSValue) {
    unreachable!("hw stub: Bun__logUnhandledException")
}

/// `(vm: *VirtualMachine, frames: [*]ZigStackFrame, frames_count: usize)`
#[unsafe(no_mangle)]
pub extern "C" fn Bun__remapStackFramePositions(
    _vm: *mut c_void,
    _frames: *mut c_void,
    _frames_count: usize,
) {
    unreachable!("hw stub: Bun__remapStackFramePositions")
}

// ════════════════════════════════════════════════════════════════════════════
// Resolver / WebAssembly streaming — non-HostFn C ABI.
// ════════════════════════════════════════════════════════════════════════════

/// `nodeModulePathsJSValue(in_str: bun.String, global, use_dirname: bool) callconv(.c) JSValue`
/// (src/jsc/resolver_jsc.zig). `bun.String` is `#[repr(C)]` and passed by value.
#[unsafe(no_mangle)]
pub extern "C" fn Resolver__nodeModulePathsJSValue(
    _in_str: bun_str::String,
    _global: *mut JSGlobalObject,
    _use_dirname: bool,
) -> JSValue {
    unreachable!("hw stub: Resolver__nodeModulePathsJSValue")
}

/// `wrap3(getBodyStreamOrBytesForWasmStreaming)` →
/// `(JSGlobalObject*, EncodedJSValue response, *Wasm::StreamingCompiler) callconv(.c) JSValue`
/// (src/jsc/JSGlobalObject.zig / ZigGlobalObject.cpp).
#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming(
    _global: *mut JSGlobalObject,
    _response: JSValue,
    _streaming_compiler: *mut c_void,
) -> JSValue {
    unreachable!("hw stub: Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming")
}
