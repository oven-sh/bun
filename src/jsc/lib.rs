//! Bindings to JavaScriptCore and other JavaScript primitives such as
//! VirtualMachine, JSGlobalObject (Zig::GlobalObject), and the event loop.
//!
//! Web and runtime-specific APIs should go in `bun.webcore` and `bun.api`.
//!
//! TODO: Remove remaining aliases to `webcore` and `api`
//!
//! ──────────────────────────────────────────────────────────────────────────
//! B-1 GATE-AND-STUB STATUS
//!   All Phase-A draft modules are gated behind `#[cfg(any())]` (with correct
//!   `#[path]` attrs so the drafts remain on disk and addressable). A minimal
//!   opaque stub surface is exposed so downstream crates type-check. Un-gating
//!   happens in B-2.
//! ──────────────────────────────────────────────────────────────────────────

#![allow(dead_code, unused_imports, unused_variables, deprecated, non_snake_case)]
#![allow(unexpected_cfgs)] // TODO(b2): ci_assert / asan features — wire up in Cargo.toml

use core::ffi::{c_char, c_void};

/// The calling convention used for JavaScript functions <> Native.
///
/// In Zig this is a `std.builtin.CallingConvention` value (`.x86_64_sysv` on
/// Windows-x64, `.c` elsewhere). Rust cannot express an ABI as a runtime value
/// — `extern "..."` takes a string literal, not an expression. The
/// `#[bun_jsc::host_fn]` / `#[bun_jsc::host_call]` attribute macros emit the
/// correct ABI per-target instead. See PORTING.md §FFI / §JSC types.
// TODO(port): proc-macro — `conv` is encoded in #[bun_jsc::host_fn] / #[bun_jsc::host_call].
#[cfg(all(windows, target_arch = "x86_64"))]
pub const CONV: &str = "sysv64";
#[cfg(not(all(windows, target_arch = "x86_64")))]
pub const CONV: &str = "C";

// ──────────────────────────────────────────────────────────────────────────
// Gated Phase-A draft modules (preserved on disk, not compiled in B-1).
// Each `#[path]` points at the actual PascalCase / snake_case .rs file so the
// draft body is addressable for B-2 un-gating.
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gated modules (real Phase-A draft code, now compiling).
// ──────────────────────────────────────────────────────────────────────────
#[path = "JSPromiseRejectionOperation.rs"] pub mod js_promise_rejection_operation;
#[path = "ScriptExecutionStatus.rs"] pub mod script_execution_status;
#[path = "SourceType.rs"] pub mod source_type;
#[path = "sizes.rs"] pub mod sizes;
#[path = "SourceProvider.rs"] pub mod source_provider;
#[path = "JSRuntimeType.rs"] pub mod js_runtime_type;
#[path = "GetterSetter.rs"] pub mod getter_setter;
#[path = "CustomGetterSetter.rs"] pub mod custom_getter_setter;
#[path = "ZigStackFrameCode.rs"] pub mod zig_stack_frame_code;
#[path = "JSErrorCode.rs"] pub mod js_error_code;
#[path = "EventType.rs"] pub mod event_type;
#[path = "static_export.rs"] pub mod static_export;
#[path = "CommonAbortReason.rs"] pub mod common_abort_reason;
#[path = "JSMap.rs"] pub mod js_map;
#[path = "URLSearchParams.rs"] pub mod url_search_params;
#[path = "RegularExpression.rs"] pub mod regular_expression;
#[path = "TextCodec.rs"] pub mod text_codec;
#[path = "WTF.rs"] pub mod wtf;
#[path = "JSUint8Array.rs"] pub mod js_uint8_array;
#[path = "MarkedArgumentBuffer.rs"] pub mod marked_argument_buffer;
#[path = "JSCell.rs"] pub mod js_cell;
#[path = "ErrorCode.rs"] pub mod error_code;
#[path = "ZigErrorType.rs"] pub mod zig_error_type;
#[path = "Errorable.rs"] pub mod errorable;
#[path = "ZigStackFramePosition.rs"] pub mod zig_stack_frame_position;
#[path = "JSType.rs"] pub mod js_type;
#[path = "Exception.rs"] pub mod exception;
#[path = "TopExceptionScope.rs"] pub mod top_exception_scope;
#[path = "JSBigInt.rs"] pub mod js_big_int;
#[path = "DOMURL.rs"] pub mod dom_url;
#[path = "CommonStrings.rs"] pub mod common_strings;
#[path = "JSModuleLoader.rs"] pub mod js_module_loader;
#[path = "JSFunction.rs"] pub mod js_function;
#[path = "Strong.rs"] pub mod strong;
#[path = "Weak.rs"] pub mod weak;

pub use self::js_module_loader::JSModuleLoader;
pub use self::js_function::JSFunction;
pub use self::strong::{Strong, Optional as StrongOptional};
pub use self::weak::{Weak, WeakRefType};

pub use self::js_type::JSType;
pub use self::exception::Exception;
pub use self::top_exception_scope::{TopExceptionScope, ExceptionValidationScope};
pub use self::js_big_int::JSBigInt;
pub use self::dom_url::DOMURL;
pub use self::common_strings::CommonStrings;

pub use self::js_promise_rejection_operation::JSPromiseRejectionOperation;
pub use self::script_execution_status::ScriptExecutionStatus;
pub use self::source_type::SourceType;
pub use self::source_provider::SourceProvider;
pub use self::js_runtime_type::JSRuntimeType;
pub use self::getter_setter::GetterSetter;
pub use self::custom_getter_setter::CustomGetterSetter;
pub use self::zig_stack_frame_code::ZigStackFrameCode;
pub use self::js_error_code::{JSErrorCode, DOMExceptionCode};
pub use self::event_type::EventType;
pub use self::common_abort_reason::CommonAbortReason;
pub use self::js_map::JSMap;
pub use self::url_search_params::URLSearchParams;
pub use self::regular_expression::RegularExpression;
pub use self::text_codec::TextCodec;
pub use self::js_uint8_array::JSUint8Array;
pub use self::marked_argument_buffer::MarkedArgumentBuffer;
pub use self::js_cell::JSCell;
pub use self::error_code::ErrorCode;
pub use self::zig_error_type::ZigErrorType;
pub use self::errorable::Errorable;
pub use self::zig_stack_frame_position::ZigStackFramePosition;

#[rustfmt::skip]
mod _gated {
    #![cfg(any())]
    #[path = "JSValue.rs"] pub mod js_value;
    #[path = "host_fn.rs"] pub mod host_fn;
    #[path = "AnyPromise.rs"] pub mod any_promise;
    #[path = "array_buffer.rs"] pub mod array_buffer;
    #[path = "CachedBytecode.rs"] pub mod cached_bytecode;
    #[path = "CallFrame.rs"] pub mod call_frame;
    #[path = "DOMFormData.rs"] pub mod dom_form_data;
    #[path = "DecodedJSValue.rs"] pub mod decoded_js_value;
    #[path = "DeferredError.rs"] pub mod deferred_error;
    #[path = "JSArray.rs"] pub mod js_array;
    #[path = "JSArrayIterator.rs"] pub mod js_array_iterator;
    #[path = "JSGlobalObject.rs"] pub mod js_global_object;
    #[path = "JSInternalPromise.rs"] pub mod js_internal_promise;
    #[path = "JSObject.rs"] pub mod js_object;
    #[path = "JSPromise.rs"] pub mod js_promise;
    #[path = "JSRef.rs"] pub mod js_ref;
    #[path = "JSString.rs"] pub mod js_string;
    #[path = "RefString.rs"] pub mod ref_string;
    #[path = "SystemError.rs"] pub mod system_error;
    #[path = "URL.rs"] pub mod url;
    #[path = "VM.rs"] pub mod vm;
    #[path = "ResolvedSource.rs"] pub mod resolved_source;
    #[path = "Debugger.rs"] pub mod debugger;
    #[path = "SavedSourceMap.rs"] pub mod saved_source_map;
    #[path = "VirtualMachine.rs"] pub mod virtual_machine;
    #[path = "ModuleLoader.rs"] pub mod module_loader;
    #[path = "rare_data.rs"] pub mod rare_data;
    #[path = "ZigStackTrace.rs"] pub mod zig_stack_trace;
    #[path = "ZigStackFrame.rs"] pub mod zig_stack_frame;
    #[path = "ZigException.rs"] pub mod zig_exception;
    #[path = "ConsoleObject.rs"] pub mod console_object;
    #[path = "hot_reloader.rs"] pub mod hot_reloader;
    #[path = "JSPropertyIterator.rs"] pub mod js_property_iterator;
    #[path = "event_loop.rs"] pub mod event_loop;
    #[path = "javascript_core_c_api.rs"] pub mod c_api;
    #[path = "sizes.rs"] pub mod sizes;
    #[path = "generated_classes_list.rs"] pub mod generated_classes_list;
    #[path = "RuntimeTranspilerCache.rs"] pub mod runtime_transpiler_cache;
    #[path = "RuntimeTranspilerStore.rs"] pub mod runtime_transpiler_store;
    #[path = "AbortSignal.rs"] pub mod abort_signal;
    #[path = "AsyncModule.rs"] pub mod async_module;
    #[path = "BuildMessage.rs"] pub mod build_message;
    #[path = "BunCPUProfiler.rs"] pub mod bun_cpu_profiler;
    #[path = "BunHeapProfiler.rs"] pub mod bun_heap_profiler;
    #[path = "ConcurrentPromiseTask.rs"] pub mod concurrent_promise_task;
    #[path = "Counters.rs"] pub mod counters;
    #[path = "CppTask.rs"] pub mod cpp_task;
    #[path = "DeprecatedStrong.rs"] pub mod deprecated_strong;
    #[path = "EventLoopHandle.rs"] pub mod event_loop_handle;
    #[path = "FFI.rs"] pub mod ffi;
    #[path = "FetchHeaders.rs"] pub mod fetch_headers;
    #[path = "GarbageCollectionController.rs"] pub mod garbage_collection_controller;
    #[path = "HTTPServerAgent.rs"] pub mod http_server_agent;
    #[path = "JSCScheduler.rs"] pub mod jsc_scheduler;
    #[path = "JSONLineBuffer.rs"] pub mod json_line_buffer;
    #[path = "JSSecrets.rs"] pub mod js_secrets;
    #[path = "NodeModuleModule.rs"] pub mod node_module_module;
    #[path = "PosixSignalHandle.rs"] pub mod posix_signal_handle;
    #[path = "ProcessAutoKiller.rs"] pub mod process_auto_killer;
    #[path = "ResolveMessage.rs"] pub mod resolve_message;
    #[path = "StringBuilder.rs"] pub mod string_builder;
    #[path = "Task.rs"] pub mod task;
    #[path = "WorkTask.rs"] pub mod work_task;
    #[path = "ZigString.rs"] pub mod zig_string;
    #[path = "bindgen.rs"] pub mod bindgen;
    #[path = "bindgen_test.rs"] pub mod bindgen_test;
    #[path = "btjs.rs"] pub mod btjs;
    #[path = "bun_string_jsc.rs"] pub mod bun_string_jsc;
    #[path = "codegen.rs"] pub mod codegen_mod;
    #[path = "comptime_string_map_jsc.rs"] pub mod comptime_string_map_jsc;
    #[path = "config.rs"] pub mod config;
    #[path = "fmt_jsc.rs"] pub mod fmt_jsc;
    #[path = "ipc.rs"] pub mod ipc;
    #[path = "resolve_path_jsc.rs"] pub mod resolve_path_jsc;
    #[path = "resolver_jsc.rs"] pub mod resolver_jsc;
    #[path = "uuid.rs"] pub mod uuid;
    #[path = "virtual_machine_exports.rs"] pub mod virtual_machine_exports;
    #[path = "web_worker.rs"] pub mod web_worker;
}

// ──────────────────────────────────────────────────────────────────────────
// Stub surface (B-1): opaque newtypes / `todo!()` fns for every public symbol
// that lib.rs previously re-exported from a gated module. Downstream crates
// type-check against these; bodies are filled in B-2.
// ──────────────────────────────────────────────────────────────────────────

/// Helper: declare an opaque stub type with a given name.
#[macro_export]
#[doc(hidden)]
macro_rules! stub_ty {
    ($($(#[$m:meta])* $name:ident),* $(,)?) => {
        $(
            $(#[$m])*
            #[repr(transparent)]
            #[derive(Debug, Clone, Copy, Default)]
            pub struct $name(pub usize);
        )*
    };
}

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(_eval_mode: bool) {
    // TODO(b1): gated — bun_core::analytics::Features::jsc_inc / bun_sys::environ missing
    todo!("bun_jsc::initialize")
}

stub_ty!(JSValue);

// B-2: minimal `JSValue` surface so un-gated leaf modules type-check while
// `JSValue.rs` itself remains gated. These match the real definitions in
// `JSValue.rs` (`#[repr(transparent)] i64` — stub uses `usize`, same size).
impl JSValue {
    pub const ZERO: JSValue = JSValue(0);
    pub const UNDEFINED: JSValue = JSValue(0xa);
    pub const NULL: JSValue = JSValue(0x2);
    #[inline] pub fn is_empty(self) -> bool { self.0 == 0 }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSValue surface (signatures sourced from src/jsc/JSValue.zig).
// Bodies wrap the real `extern "C"` symbols where the ABI is trivially known;
// the rest are `todo!()` until JSValue.rs is un-gated.
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    pub const TRUE: JSValue = JSValue(0x7);
    pub const FALSE: JSValue = JSValue(0x6);

    // ── tag predicates (inline mirrors of JSValue.zig) ────────────────────
    #[inline] pub fn is_undefined(self) -> bool { self.0 == Self::UNDEFINED.0 }
    #[inline] pub fn is_null(self) -> bool { self.0 == Self::NULL.0 }
    #[inline] pub fn is_undefined_or_null(self) -> bool {
        // Zig: `return @intFromEnum(this) | 0x8 == 0xa;` (i.e. `this == undefined || this == null`).
        (self.0 | 0x8) == 0xa
    }
    #[inline] pub fn is_empty_or_undefined_or_null(self) -> bool {
        self.is_empty() || self.is_undefined_or_null()
    }
    #[inline] pub fn is_boolean(self) -> bool {
        self.0 == Self::TRUE.0 || self.0 == Self::FALSE.0
    }
    #[inline] pub fn is_cell(self) -> bool {
        // NotCellMask = NumberTag | OtherTag (0xfffe_0000_0000_0000 | 0x2).
        const NOT_CELL_MASK: usize = 0xfffe_0000_0000_0002;
        !self.is_empty() && (self.0 & NOT_CELL_MASK) == 0
    }
    #[inline] pub fn is_int32(self) -> bool {
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        (self.0 & NUMBER_TAG) == NUMBER_TAG
    }
    #[inline] pub fn is_number(self) -> bool {
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        (self.0 & NUMBER_TAG) != 0
    }
    #[inline] pub fn is_any_int(self) -> bool {
        // SAFETY: pure FFI predicate.
        unsafe { JSC__JSValue__isAnyInt(self) }
    }
    #[inline] pub fn is_string(self) -> bool {
        self.is_cell() && self.js_type().is_string_like()
    }
    #[inline] pub fn is_object(self) -> bool {
        self.is_cell() && self.js_type().is_object()
    }
    #[inline] pub fn is_array(self) -> bool {
        self.is_cell() && self.js_type().is_array()
    }
    #[inline] pub fn is_date(self) -> bool {
        self.is_cell() && self.js_type() == JSType::JSDate
    }

    /// `jsType()` — only valid when `is_cell()`. Reads the JSCell type byte.
    #[inline] pub fn js_type(self) -> JSType {
        // SAFETY: cell pointer; caller is expected to have checked `is_cell()`.
        unsafe { JSC__JSValue__jsType(self) }
    }

    // ── constructors ─────────────────────────────────────────────────────
    #[inline] pub fn js_boolean(b: bool) -> JSValue {
        if b { Self::TRUE } else { Self::FALSE }
    }
    #[inline] pub fn js_number_from_int32(i: i32) -> JSValue {
        // NumberTag | i (low 32 bits).
        const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
        JSValue(NUMBER_TAG | (i as u32 as usize))
    }
    pub fn js_number_from_uint64(i: u64) -> JSValue {
        if i <= i32::MAX as u64 {
            Self::js_number_from_int32(i as i32)
        } else {
            Self::js_number(i as f64)
        }
    }
    pub fn js_number(n: f64) -> JSValue {
        // SAFETY: pure FFI; encodes a double into a JSValue.
        unsafe { JSC__JSValue__jsNumberFromDouble(n) }
    }
    pub fn js_empty_string(global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global` is a live JSGlobalObject for the duration of the call.
        unsafe { JSC__JSValue__jsEmptyString(global) }
    }
    pub fn create_empty_object(global: &JSGlobalObject, len: usize) -> JSValue {
        // SAFETY: `global` is a live JSGlobalObject for the duration of the call.
        unsafe { JSC__JSValue__createEmptyObject(global, len) }
    }
    pub fn create_empty_object_with_null_prototype(global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global` is a live JSGlobalObject for the duration of the call.
        unsafe { JSC__JSValue__createEmptyObjectWithNullPrototype(global) }
    }
    pub fn create_empty_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        // SAFETY: `global` is a live JSGlobalObject for the duration of the call.
        let v = unsafe { JSC__JSValue__createEmptyArray(global, len) };
        if v.is_empty() { Err(JsError::Thrown) } else { Ok(v) }
    }
    pub fn create_buffer(global: &JSGlobalObject, slice: &mut [u8]) -> JSValue {
        // JSValue.zig:createBuffer — wraps `JSBuffer__bufferFromPointerAndLengthAndDeinit`
        // with `MarkedArrayBuffer_deallocator` (or null for empty slices).
        // SAFETY: `global` is live; slice ptr/len describe a valid range whose
        // ownership is transferred to JSC (freed via the deallocator).
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global,
                slice.as_mut_ptr(),
                slice.len(),
                core::ptr::null_mut(),
                if slice.is_empty() { None } else { Some(MarkedArrayBuffer_deallocator) },
            )
        }
    }
    pub fn from_date_string(global: &JSGlobalObject, s: &core::ffi::CStr) -> JSValue {
        // SAFETY: `global` is live; `s` is a valid NUL-terminated C string.
        unsafe { JSC__JSValue__dateInstanceFromNullTerminatedString(global, s.as_ptr()) }
    }
    pub fn from_date_number(global: &JSGlobalObject, value: f64) -> JSValue {
        // SAFETY: `global` is live.
        unsafe { JSC__JSValue__dateInstanceFromNumber(global, value) }
    }
    pub fn from_int64_no_truncate(global: &JSGlobalObject, i: i64) -> JSValue {
        // SAFETY: `global` is live.
        unsafe { JSC__JSValue__fromInt64NoTruncate(global, i) }
    }

    // ── conversions ──────────────────────────────────────────────────────
    #[inline] pub fn to_boolean(self) -> bool {
        // JSValue.zig:2103 — `this != .zero and JSC__JSValue__toBoolean(this)`.
        // SAFETY: pure FFI predicate; the zero guard avoids passing empty.
        !self.is_empty() && unsafe { JSC__JSValue__toBoolean(self) }
    }
    pub fn as_number(self) -> f64 {
        // TODO(b2): full `asNumber` impl (int32/double dispatch). Gated in JSValue.rs.
        todo!("JSValue::as_number")
    }
    #[inline] pub fn get_number(self) -> Option<f64> {
        if self.is_number() { Some(self.as_number()) } else { None }
    }
    pub fn to_int32(self) -> i32 {
        if self.is_int32() {
            return (self.0 & 0xffff_ffff) as u32 as i32;
        }
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toInt32(self) }
    }
    pub fn to_int64(self) -> i64 {
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toInt64(self) }
    }
    pub fn coerce_to_i32(self, global: &JSGlobalObject) -> JsResult<i32> {
        // TODO(b2): bun_jsc::cpp::JSC__JSValue__coerceToInt32 — gated.
        let _ = global;
        todo!("JSValue::coerce_to_i32")
    }
    /// Generic coercion (`coerce(comptime T)` in Zig). Per-type helpers are
    /// `coerce_to_i32` / `coerce_f64` etc.; this fronts the i32 path.
    pub fn coerce<T: CoerceTo>(self, global: &JSGlobalObject) -> JsResult<T> {
        T::coerce_from(self, global)
    }
    pub fn to_js_string(self, global: &JSGlobalObject) -> JsResult<*mut JSString> {
        let _ = global;
        // TODO(b2): from_js_host_call wrapper — gated until host_fn.rs un-gates.
        todo!("JSValue::to_js_string")
    }
    pub fn to_bun_string(self, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        bun_string_jsc::from_js(self, global)
    }
    pub fn to_zig_string(self, out: &mut bun_string::ZigString, global: &JSGlobalObject) -> JsResult<()> {
        let _ = (out, global);
        // TODO(b2): JSC__JSValue__toZigString FFI — gated.
        todo!("JSValue::to_zig_string")
    }
    pub fn to_slice(self, global: &JSGlobalObject) -> JsResult<bun_string::ZigStringSlice> {
        Ok(self.to_bun_string(global)?.to_utf8())
    }
    pub fn to_slice_clone(self, global: &JSGlobalObject) -> JsResult<bun_string::ZigStringSlice> {
        // TODO(b2): clone semantics differ from to_slice — gated.
        self.to_slice(global)
    }
    pub fn to_slice_or_null(self, global: &JSGlobalObject) -> JsResult<bun_string::ZigStringSlice> {
        let _ = global;
        // TODO(b2): JSC__JSValue__toSliceOrNull — gated.
        todo!("JSValue::to_slice_or_null")
    }
    pub fn to_zig_exception(self, global: &JSGlobalObject, exception: &mut ZigException) {
        // SAFETY: `global` is live; `exception` is a valid out-param.
        unsafe { JSC__JSValue__toZigException(self, global, exception) }
    }
    pub fn to_error(self) -> Option<JSValue> {
        // SAFETY: pure FFI; returns ZERO when not an error.
        let v = unsafe { JSC__JSValue__toError_(self) };
        if v.is_empty() { None } else { Some(v) }
    }
    /// Map a JS string value to an enum via the type's `phf` map (Zig `toEnum`).
    pub fn to_enum<E: FromJsEnum>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<E> {
        E::from_js_value(self, global, property_name)
    }
    pub fn as_string(self) -> *mut JSString {
        // TODO(b2): cell ptr cast — gated until DecodedJSValue un-gates.
        todo!("JSValue::as_string")
    }
    pub fn as_array_buffer(self, global: &JSGlobalObject) -> Option<ArrayBuffer> {
        let _ = global;
        // TODO(b2): JSC__JSValue__asArrayBuffer_ — gated (needs ArrayBuffer fields).
        todo!("JSValue::as_array_buffer")
    }
    pub fn get_unix_timestamp(self) -> f64 {
        // SAFETY: pure FFI; `self` must be a JSDate cell (caller-checked).
        unsafe { JSC__JSValue__getUnixTimestamp(self) }
    }

    // ── property access ──────────────────────────────────────────────────
    pub fn get(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<JSValue>> {
        let _ = (global, property);
        // TODO(b2): full impl needs BuiltinName fast-path + getIfPropertyExistsImpl — gated.
        todo!("JSValue::get")
    }
    pub fn get_if_property_exists(
        self,
        global: &JSGlobalObject,
        property: &[u8],
    ) -> JsResult<Option<JSValue>> {
        self.get(global, property)
    }
    pub fn get_truthy(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<JSValue>> {
        // JSValue.zig:1625 truthyPropertyValue: filters undef/null AND empty strings.
        Ok(self.get(global, property)?.filter(|v| {
            !v.is_empty_or_undefined_or_null() && !(v.is_string() && !v.to_boolean())
        }))
    }
    pub fn get_stringish(
        self,
        global: &JSGlobalObject,
        property: &[u8],
    ) -> JsResult<Option<bun_string::String>> {
        let _ = (global, property);
        // TODO(b2): full impl — gated.
        todo!("JSValue::get_stringish")
    }
    pub fn get_array(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<JSValue>> {
        let _ = (global, property);
        // TODO(b2): full impl (jsTypeLoose().isArray() filter) — gated.
        todo!("JSValue::get_array")
    }
    pub fn get_own_by_value(self, global: &JSGlobalObject, property_value: JSValue) -> Option<JSValue> {
        // SAFETY: `global` is live; FFI returns ZERO for not-found.
        let v = unsafe { JSC__JSValue__getOwnByValue(self, global, property_value) };
        if v.is_empty() { None } else { Some(v) }
    }
    pub fn get_object(self) -> Option<*mut JSObject> {
        let _ = self.is_object();
        // TODO(b2): cell ptr cast — gated until DecodedJSValue un-gates.
        todo!("JSValue::get_object")
    }
    pub fn get_index(self, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        JSObject::get_index(self, global, i)
    }
    pub fn get_length(self, global: &JSGlobalObject) -> JsResult<u64> {
        let _ = global;
        // TODO(b2): JSC__JSValue__getLengthIfPropertyExistsInternal + fallback — gated.
        todo!("JSValue::get_length")
    }
    pub fn put(self, global: &JSGlobalObject, key: &[u8], value: JSValue) {
        let zs = bun_string::ZigString::init(key);
        // SAFETY: `global` is live; `zs` borrowed for the call.
        unsafe { JSC__JSValue__put(self, global, &zs, value) }
    }
    pub fn put_index(self, global: &JSGlobalObject, i: u32, out: JSValue) -> JsResult<()> {
        // SAFETY: `global` is live; FFI may set an exception.
        unsafe { JSC__JSValue__putIndex(self, global, i, out) };
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(()) }
    }

    pub fn array_iterator<'a>(self, global: &'a JSGlobalObject) -> JsResult<JSArrayIterator<'a>> {
        JSArrayIterator::init(self, global)
    }

    /// Prevents the GC from collecting this value while it's on the stack.
    /// Mirrors `std.mem.doNotOptimizeAway`.
    #[inline]
    pub fn ensure_still_alive(self) {
        if !self.is_cell() { return; }
        core::hint::black_box(self);
    }

    /// `JSValue.parse` — parse a JSON string. Declared on JSValue in Zig but
    /// implemented in C++ via `JSC__JSValue__parseJSON`.
    pub fn parse(global: &JSGlobalObject, string: &bun_string::String) -> JsResult<JSValue> {
        let _ = (global, string);
        // TODO(b2): bun_string_jsc::to_json — gated.
        todo!("JSValue::parse")
    }
}

/// Dispatch trait for `JSValue::coerce::<T>()`. Zig used a comptime type switch.
pub trait CoerceTo: Sized {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<Self>;
}
impl CoerceTo for i32 {
    fn coerce_from(v: JSValue, global: &JSGlobalObject) -> JsResult<i32> { v.coerce_to_i32(global) }
}

/// Dispatch trait for `JSValue::to_enum::<E>()`. Zig used `comptime Enum: type`
/// + a `phf` `Map` decl; the Rust port supplies the map per-enum via this trait.
pub trait FromJsEnum: Sized {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, property_name: &'static str) -> JsResult<Self>;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSValue__isAnyInt(this: JSValue) -> bool;
    fn JSC__JSValue__jsType(this: JSValue) -> JSType;
    fn JSC__JSValue__jsNumberFromDouble(n: f64) -> JSValue;
    fn JSC__JSValue__jsEmptyString(global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__createEmptyObject(global: *const JSGlobalObject, len: usize) -> JSValue;
    fn JSC__JSValue__createEmptyObjectWithNullPrototype(global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__createEmptyArray(global: *const JSGlobalObject, len: usize) -> JSValue;
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *const JSGlobalObject, ptr: *mut u8, len: usize,
        ctx: *mut core::ffi::c_void,
        deallocator: Option<unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void)>,
    ) -> JSValue;
    fn MarkedArrayBuffer_deallocator(bytes: *mut core::ffi::c_void, ctx: *mut core::ffi::c_void);
    fn JSC__JSValue__dateInstanceFromNullTerminatedString(global: *const JSGlobalObject, s: *const c_char) -> JSValue;
    fn JSC__JSValue__dateInstanceFromNumber(global: *const JSGlobalObject, n: f64) -> JSValue;
    fn JSC__JSValue__fromInt64NoTruncate(global: *const JSGlobalObject, i: i64) -> JSValue;
    fn JSC__JSValue__toBoolean(this: JSValue) -> bool;
    fn JSC__JSValue__toInt32(this: JSValue) -> i32;
    fn JSC__JSValue__toInt64(this: JSValue) -> i64;
    fn JSC__JSValue__toError_(this: JSValue) -> JSValue;
    fn JSC__JSValue__toZigException(this: JSValue, global: *const JSGlobalObject, exception: *mut ZigException);
    fn JSC__JSValue__getUnixTimestamp(this: JSValue) -> f64;
    fn JSC__JSValue__getOwnByValue(this: JSValue, global: *const JSGlobalObject, key: JSValue) -> JSValue;
    fn JSC__JSValue__put(this: JSValue, global: *const JSGlobalObject, key: *const bun_string::ZigString, value: JSValue);
    fn JSC__JSValue__putIndex(this: JSValue, global: *const JSGlobalObject, i: u32, value: JSValue);
}

/// `bun.JSError` — the canonical Bun JS error union (`error{Thrown, OutOfMemory, Terminated}`).
/// `JsResult<T>` is the Rust spelling of Zig's `bun.JSError!T`.
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum JsError {
    /// A JavaScript exception is pending in the VM's exception scope.
    Thrown,
    /// Allocation failure; caller must throw an `OutOfMemoryError`.
    OutOfMemory,
    /// The VM is terminating (worker shutdown / `process.exit`).
    Terminated,
}
pub type JsResult<T> = core::result::Result<T, JsError>;

impl From<bun_core::AllocError> for JsError {
    fn from(_: bun_core::AllocError) -> Self { JsError::OutOfMemory }
}

/// Debug-only binding-presence marker. In Zig this is `jsc.markBinding(@src())`;
/// here it's a no-op (track_caller gives us the location if we ever wire it up).
#[macro_export]
macro_rules! mark_binding {
    () => {{
        // TODO(port): bun_output::scoped_log!(.bind, "{}", core::panic::Location::caller())
    }};
}

// B-2 stub: WTF.rs re-exports `crate::string_builder::StringBuilder`; the real
// StringBuilder.rs is still gated (depends on TopExceptionScope FFI). Expose a
// minimal opaque type here so wtf compiles.
pub mod string_builder {
    #[repr(C, align(8))]
    pub struct StringBuilder { bytes: [u8; 24] }
}

// Host functions are the native function pointer type that can be used by a
// JSC::JSFunction to call native code from JavaScript.
pub mod host_fn {
    // TODO(b1): gated — see _gated::host_fn
    pub fn from_js_host_call() { todo!() }
    pub fn from_js_host_call_generic() { todo!() }
    pub fn to_js_host_call() { todo!() }
    pub fn to_js_host_fn() { todo!() }
    pub fn to_js_host_fn_result() { todo!() }
    pub fn to_js_host_fn_with_context() { todo!() }
    // TODO(port): jsc.conv ABI — proc-macro emits `extern "sysv64"` on windows-x64.
    pub type JSHostFn =
        unsafe extern "C" fn(*mut crate::JSGlobalObject, *mut crate::CallFrame) -> crate::JSValue;
    pub type JSHostFnZig =
        fn(&crate::JSGlobalObject, &crate::CallFrame) -> crate::JsResult<crate::JSValue>;
    pub type JSHostFnZigWithContext = unsafe extern "C" fn();
    pub type JSHostFunctionTypeWithContext = unsafe extern "C" fn();

    /// `host_fn::DOMCall` — Zig type-generator that emits a DOM-call put helper +
    /// fast-path/slow-path callbacks. The Rust port encodes this as the
    /// `#[bun_jsc::dom_call]` proc-macro; this struct is the runtime descriptor
    /// the macro fills in (matches `host_fn.zig:447`'s shape).
    // TODO(port): proc-macro — DOMCall type-generator.
    pub struct DomCall {
        pub class_name: &'static str,
        pub function_name: &'static str,
        pub put: unsafe extern "C" fn(*mut crate::JSGlobalObject, crate::JSValue),
    }
}
pub use self::host_fn::{
    from_js_host_call, from_js_host_call_generic, to_js_host_call, to_js_host_fn,
    to_js_host_fn_result, to_js_host_fn_with_context, JSHostFn, JSHostFnZig, JSHostFnZigWithContext,
    JSHostFunctionTypeWithContext,
};

// JSC Classes Bindings — opaque stubs (B-2: trimmed as real modules un-gate)
stub_ty!(
    AnyPromise, CachedBytecode, CallFrame,
    DOMFormData, DecodedJSValue, DeferredError, JSArray,
    JSGlobalObject, JSInternalPromise, JSObject,
    JSPromise, JsRef, JSString,
    URL, VM,
    ResolvedSource, ZigStackTrace, ZigStackFrame,
    ZigException, Formatter, JSPropertyIteratorOptions, RuntimeTranspilerCache,
);

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSGlobalObject surface (signatures from JSGlobalObject.zig).
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    fn JSC__JSGlobalObject__vm(this: *const JSGlobalObject) -> *mut VM;
    fn JSC__JSGlobalObject__bunVM(this: *const JSGlobalObject) -> *mut virtual_machine::VirtualMachine;
    fn JSGlobalObject__hasException(this: *const JSGlobalObject) -> bool;
    fn JSGlobalObject__throwOutOfMemoryError(this: *const JSGlobalObject);
    fn JSC__JSGlobalObject__createAggregateError(
        this: *const JSGlobalObject,
        errors: *const JSValue,
        len: usize,
        message: *const bun_string::ZigString,
    ) -> JSValue;
    fn JSC__JSGlobalObject__createAggregateErrorWithArray(
        this: *const JSGlobalObject,
        errors_array: JSValue,
        message: bun_string::String,
        cause: JSValue,
    ) -> JSValue;
    fn JSC__VM__throwError(vm: *mut VM, global: *const JSGlobalObject, value: JSValue);
}

impl JSGlobalObject {
    /// Raw pointer for FFI (JSGlobalObject is always passed by reference).
    #[inline]
    pub fn as_ptr(&self) -> *mut JSGlobalObject {
        self as *const _ as *mut _
    }

    pub fn vm(&self) -> &VM {
        // SAFETY: `vm()` never returns null for a live global; lifetime tied to &self.
        unsafe { &*JSC__JSGlobalObject__vm(self) }
    }
    pub fn bun_vm(&self) -> &mut virtual_machine::VirtualMachine {
        // SAFETY: `bunVM()` never returns null for a Bun-owned global; lifetime tied
        // to &self (caller must not outlive the global).
        unsafe { &mut *JSC__JSGlobalObject__bunVM(self) }
    }
    #[inline]
    pub fn has_exception(&self) -> bool {
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSGlobalObject__hasException(self) }
    }

    pub fn create_out_of_memory_error(&self) -> JSValue {
        // TODO(b2): JSC__createOutOfMemoryError — gated.
        todo!("JSGlobalObject::create_out_of_memory_error")
    }
    pub fn throw_out_of_memory_value(&self) -> JSValue {
        // JSGlobalObject.zig:21 — dedicated FFI, returns `.zero` (sentinel).
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSGlobalObject__throwOutOfMemoryError(self) };
        JSValue::ZERO
    }
    pub fn throw_out_of_memory(&self) -> JsError {
        // JSGlobalObject.zig:26 — same FFI, returns `error.JSError`.
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSGlobalObject__throwOutOfMemoryError(self) };
        JsError::Thrown
    }
    pub fn create_syntax_error_instance(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let _ = args;
        // TODO(b2): full impl needs ZigString FFI path — gated.
        todo!("JSGlobalObject::create_syntax_error_instance")
    }
    pub fn create_aggregate_error(
        &self,
        errors: &[JSValue],
        message: &bun_string::ZigString,
    ) -> JsResult<JSValue> {
        // SAFETY: `self` is live; slice ptr/len valid for the call.
        let v = unsafe {
            JSC__JSGlobalObject__createAggregateError(self, errors.as_ptr(), errors.len(), message)
        };
        if v.is_empty() { Err(JsError::Thrown) } else { Ok(v) }
    }
    pub fn create_aggregate_error_with_array(
        &self,
        message: bun_string::String,
        errors_array: JSValue,
    ) -> JsResult<JSValue> {
        // SAFETY: `self` is live; `message` passed by value (FFI takes ownership of ref).
        // JSGlobalObject.zig:523 — (errors_array, message, options=.js_undefined).
        let v = unsafe {
            JSC__JSGlobalObject__createAggregateErrorWithArray(
                self, errors_array, message, JSValue::UNDEFINED,
            )
        };
        if v.is_empty() { Err(JsError::Thrown) } else { Ok(v) }
    }

    pub fn throw_value(&self, value: JSValue) -> JsError {
        // JSGlobalObject.zig:474 — guard against an already-pending exception
        // (avoids hitting `releaseAssertNoException` in C++).
        if self.has_exception() {
            return JsError::Thrown;
        }
        // SAFETY: `self` is live; throws into the VM's exception scope.
        unsafe { JSC__VM__throwError(JSC__JSGlobalObject__vm(self), self, value) };
        JsError::Thrown
    }
    pub fn throw(&self, args: core::fmt::Arguments<'_>) -> JsError {
        let _ = args;
        // TODO(b2): createErrorInstance(fmt) + throwValue — gated.
        todo!("JSGlobalObject::throw")
    }
    pub fn throw_error(&self, err: bun_core::Error, msg: &'static str) -> JsError {
        let _ = (err, msg);
        // TODO(b2): SystemError/JSError dispatch — gated.
        todo!("JSGlobalObject::throw_error")
    }
    pub fn throw_type_error(&self, args: core::fmt::Arguments<'_>) -> JsError {
        let _ = args;
        // TODO(b2): createTypeErrorInstance(fmt) + throwValue — gated.
        todo!("JSGlobalObject::throw_type_error")
    }
    pub fn throw_range_error<V: core::fmt::Display>(&self, value: V, options: RangeErrorOptions<'_>) -> JsError {
        let _ = (value, options);
        // TODO(b2): ERR(.OUT_OF_RANGE).throw() — gated.
        todo!("JSGlobalObject::throw_range_error")
    }
    pub fn throw_todo(&self, msg: &str) -> JsError {
        let _ = msg;
        // TODO(b2): full impl — gated.
        todo!("JSGlobalObject::throw_todo")
    }
    pub fn throw_invalid_arguments(&self, args: core::fmt::Arguments<'_>) -> JsError {
        let _ = args;
        // TODO(b2): full impl — gated.
        todo!("JSGlobalObject::throw_invalid_arguments")
    }
    pub fn throw_invalid_argument_type(
        &self,
        name: &'static str,
        field: &'static str,
        typename: &'static str,
    ) -> JsError {
        let _ = (name, field, typename);
        // TODO(b2): full impl — gated.
        todo!("JSGlobalObject::throw_invalid_argument_type")
    }
    /// `globalThis.ERR(.INVALID_ARG_TYPE, fmt, args)` — Node-compat error builder.
    /// Returns the error JSValue; caller decides whether to throw or wrap.
    #[allow(non_snake_case)]
    pub fn ERR_INVALID_ARG_TYPE(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let _ = args;
        // TODO(b2): ErrorBuilder dispatch (ErrorCode.ts codegen) — gated.
        todo!("JSGlobalObject::ERR_INVALID_ARG_TYPE")
    }
    pub fn err_invalid_url(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let _ = args;
        // TODO(b2): ErrorBuilder dispatch (ErrorCode.ts codegen) — gated.
        todo!("JSGlobalObject::err_invalid_url")
    }

    pub fn take_exception(&self, proof: JsError) -> JSValue {
        // JSGlobalObject.zig:561 — for `OutOfMemory` proof, throw OOM first so
        // there IS a pending exception to take.
        if proof == JsError::OutOfMemory {
            let _ = self.throw_out_of_memory();
        }
        self.try_take_exception().unwrap_or_else(|| {
            panic!("A JavaScript exception was thrown, but it was cleared before it could be read.")
        })
    }
    pub fn take_error(&self, proof: JsError) -> JSValue {
        let v = self.take_exception(proof);
        // TODO(b2): unwrap Exception → its value (jsc.Exception cast). For now, pass through.
        v
    }
    pub fn try_take_exception(&self) -> Option<JSValue> {
        // TODO(b2): Bun__JSGlobalObject__tryTakeException FFI — gated.
        todo!("JSGlobalObject::try_take_exception")
    }

    pub fn validate_object(
        &self,
        name: &'static str,
        value: JSValue,
        opts: ValidateObjectOpts,
    ) -> JsResult<()> {
        let _ = (name, value, opts);
        // TODO(b2): full impl — gated.
        todo!("JSGlobalObject::validate_object")
    }

    pub fn run_on_resolve_plugins(
        &self,
        namespace: bun_string::String,
        path: bun_string::String,
        source: bun_string::String,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        let _ = (namespace, path, source, target);
        // TODO(b2): Bun__runOnResolvePlugins FFI — gated.
        todo!("JSGlobalObject::run_on_resolve_plugins")
    }
}

/// `bun.fmt.OutOfRangeOptions` — re-exported here under the name dependents
/// expect (`jsc.RangeErrorOptions`).
pub type RangeErrorOptions<'a> = bun_core::fmt::OutOfRangeOptions<'a>;

#[derive(Default, Copy, Clone)]
pub struct ValidateObjectOpts {
    pub allow_nullable: bool,
    pub allow_array: bool,
    pub allow_function: bool,
}

/// Mirrors `JSGlobalObject.BunPluginTarget` (JSGlobalObject.zig).
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BunPluginTarget {
    Bun = 0,
    Node = 1,
    Browser = 2,
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSObject surface (JSObject.zig).
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    static JSC__JSObject__maxInlineCapacity: core::ffi::c_uint;
    fn JSC__JSObject__getIndex(this: JSValue, global: *const JSGlobalObject, i: u32) -> JSValue;
    fn JSC__createStructure(
        global: *const JSGlobalObject,
        owner: *const JSCell,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue;
}

impl JSObject {
    #[inline]
    pub fn max_inline_capacity() -> core::ffi::c_uint {
        // SAFETY: extern static; read-only.
        unsafe { JSC__JSObject__maxInlineCapacity }
    }
    pub fn get_index(this: JSValue, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        // SAFETY: `global` is live; `this` is a JS object (caller-checked).
        let v = unsafe { JSC__JSObject__getIndex(this, global, i) };
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(v) }
    }
    /// Create a JSObject from a Rust struct's fields (Zig: anytype → reflection).
    pub fn create<T>(_pojo: T, _global: &JSGlobalObject) -> JsResult<*mut JSObject> {
        // TODO(b2): putAllFromStruct via reflection — needs proc-macro.
        todo!("JSObject::create")
    }
    pub fn create_structure(
        global: &JSGlobalObject,
        owner: JSValue,
        length: u32,
        names: *mut ExternColumnIdentifier,
    ) -> JSValue {
        debug_assert!(owner.is_cell());
        // JSObject.zig:118 — passes `owner.asCell()`. A cell-tagged JSValue's
        // payload IS the JSCell* (NotCellMask bits are zero), so the raw usize
        // is the pointer. SAFETY: caller guarantees `owner.is_cell()`.
        let owner_cell = owner.0 as *const JSCell;
        // SAFETY: `global` is live; `names[0..length]` valid.
        unsafe { JSC__createStructure(global, owner_cell, length, names) }
    }
}

/// `JSObject.ExternColumnIdentifier` (extern struct in JSObject.zig).
#[repr(C)]
pub struct ExternColumnIdentifier {
    pub tag: u8,
    pub value: ExternColumnIdentifierValue,
}
#[repr(C)]
pub union ExternColumnIdentifierValue {
    pub index: u32,
    pub name: core::mem::ManuallyDrop<bun_string::String>,
}
impl ExternColumnIdentifier {
    /// JSObject.zig:111 — `deinit()` derefs `name` only when `tag == 2`.
    pub fn deinit(&mut self) {
        if self.tag == 2 {
            // SAFETY: `tag == 2` ⇔ `value.name` is the active union field.
            unsafe { core::mem::ManuallyDrop::drop(&mut self.value.name) }
        }
    }
}
pub mod js_object {
    pub use super::ExternColumnIdentifier;
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — CallFrame / ArgumentsSlice surface (CallFrame.zig).
// ──────────────────────────────────────────────────────────────────────────
pub mod call_frame {
    use super::*;
    /// See CallFrame.zig:212. Advanced iterator used by Node.fs argument parsing.
    pub struct ArgumentsSlice<'a> {
        pub remaining: &'a [JSValue],
        pub vm: &'a virtual_machine::VirtualMachine,
        pub all: &'a [JSValue],
        pub threw: bool,
        pub will_be_async: bool,
    }
    impl<'a> ArgumentsSlice<'a> {
        pub fn init(vm: &'a virtual_machine::VirtualMachine, slice: &'a [JSValue]) -> Self {
            Self { remaining: slice, vm, all: slice, threw: false, will_be_async: false }
        }
        pub fn next(&self) -> Option<JSValue> {
            self.remaining.first().copied()
        }
        pub fn eat(&mut self) {
            if !self.remaining.is_empty() {
                self.remaining = &self.remaining[1..];
            }
        }
        pub fn next_eat(&mut self) -> Option<JSValue> {
            let v = self.next()?;
            self.eat();
            Some(v)
        }
    }

    pub struct Arguments<const MAX: usize> {
        pub ptr: [JSValue; MAX],
        pub len: usize,
    }
    impl<const MAX: usize> Arguments<MAX> {
        #[inline]
        pub fn slice(&self) -> &[JSValue] { &self.ptr[..self.len] }
    }
}
pub use self::call_frame::ArgumentsSlice;

impl CallFrame {
    pub fn arguments(&self) -> &[JSValue] {
        // TODO(b2): register layout offset math — gated until CallFrame.rs un-gates.
        todo!("CallFrame::arguments")
    }
    pub fn argument(&self, i: usize) -> JSValue {
        self.arguments().get(i).copied().unwrap_or(JSValue::UNDEFINED)
    }
    pub fn arguments_count(&self) -> u32 {
        // TODO(b2): register layout offset math — gated.
        todo!("CallFrame::arguments_count")
    }
    pub fn arguments_as_array<const N: usize>(&self) -> [JSValue; N] {
        let args = self.arguments();
        let mut out = [JSValue::UNDEFINED; N];
        for (i, slot) in out.iter_mut().enumerate() {
            if let Some(v) = args.get(i) { *slot = *v; }
        }
        out
    }
    pub fn arguments_old<const MAX: usize>(&self) -> call_frame::Arguments<MAX> {
        let args = self.arguments();
        let len = args.len().min(MAX);
        let mut ptr = [JSValue::ZERO; MAX];
        ptr[..len].copy_from_slice(&args[..len]);
        call_frame::Arguments { ptr, len }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSArrayIterator (real struct; was stub_ty before).
// ──────────────────────────────────────────────────────────────────────────
pub struct JSArrayIterator<'a> {
    pub i: u32,
    pub len: u32,
    pub array: JSValue,
    pub global: &'a JSGlobalObject,
}
impl<'a> JSArrayIterator<'a> {
    pub fn init(value: JSValue, global: &'a JSGlobalObject) -> JsResult<Self> {
        Ok(Self { i: 0, len: value.get_length(global)? as u32, array: value, global })
    }
    pub fn next(&mut self) -> JsResult<Option<JSValue>> {
        if self.i >= self.len { return Ok(None); }
        let i = self.i;
        self.i += 1;
        Ok(Some(JSObject::get_index(self.array, self.global, i)?))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — VM / VirtualMachine / SystemError / URL / JSPromise / JSString.
// ──────────────────────────────────────────────────────────────────────────
impl VM {
    pub fn throw_error(&self, global: &JSGlobalObject, value: JSValue) -> JsError {
        // SAFETY: `self` and `global` are live; throws into the VM's exception scope.
        unsafe { JSC__VM__throwError(self as *const _ as *mut _, global, value) };
        JsError::Thrown
    }
}

/// `jsc.SystemError` — extern struct laid out to match SystemError.zig
/// (field order is ABI-load-bearing: errno, code, message, path, syscall,
/// hostname, fd, dest).
#[repr(C)]
pub struct SystemError {
    pub errno: core::ffi::c_int,
    pub code: bun_string::String,
    pub message: bun_string::String,
    pub path: bun_string::String,
    pub syscall: bun_string::String,
    pub hostname: bun_string::String,
    pub fd: core::ffi::c_int,
    pub dest: bun_string::String,
}
unsafe extern "C" {
    fn SystemError__toErrorInstance(this: *const SystemError, global: *mut JSGlobalObject) -> JSValue;
}
impl SystemError {
    pub fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `self` is a valid extern-layout SystemError; `global` is live.
        unsafe { SystemError__toErrorInstance(self, global.as_ptr()) }
    }
    pub fn to_error_instance_with_async_stack(&self, global: &JSGlobalObject, _promise: &JSPromise) -> JSValue {
        // TODO(b2): JSValue::attach_async_stack_from_promise — gated.
        self.to_error_instance(global)
    }
}

unsafe extern "C" {
    fn URL__pathFromFileURL(input: *mut bun_string::String) -> bun_string::String;
}
impl URL {
    pub fn path_from_file_url(s: bun_string::String) -> bun_string::String {
        let mut input = s;
        // SAFETY: `input` is a valid bun.String passed by mutable pointer (FFI consumes it).
        unsafe { URL__pathFromFileURL(&mut input) }
    }
    pub fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        let _ = (value, global);
        // TODO(b2): from_js_host_call wrapper around URL__hrefFromJS — gated.
        todo!("URL::href_from_js")
    }
}

pub mod js_promise {
    /// `JSPromise.Strong` — wraps a `jsc.Strong.Optional` holding a JSPromise.
    #[derive(Default)]
    pub struct Strong {
        strong: crate::strong::Optional,
    }
    impl Strong {
        pub fn empty() -> Self { Self { strong: crate::strong::Optional::empty() } }
        pub fn get(&self) -> Option<crate::JSValue> { self.strong.get() }
    }
}

impl JSString {
    pub fn to_slice(&self, global: &JSGlobalObject) -> bun_string::ZigStringSlice {
        let _ = global;
        // TODO(b2): get_zig_string + to_slice — gated until JSString.rs un-gates.
        todo!("JSString::to_slice")
    }
}

pub mod array_buffer {
    use super::*;
    crate::stub_ty!(JSCArrayBuffer, MarkedArrayBuffer);

    /// `jsc.ArrayBuffer` — slim mirror of array_buffer.zig:ArrayBuffer (extern struct).
    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct ArrayBuffer {
        pub ptr: *mut u8,
        pub offset: u32,
        pub len: u32,
        pub byte_len: u32,
        pub typed_array_type: JSType,
        pub value: JSValue,
        pub shared: bool,
    }
    impl Default for ArrayBuffer {
        fn default() -> Self {
            Self {
                ptr: core::ptr::null_mut(),
                offset: 0,
                len: 0,
                byte_len: 0,
                typed_array_type: JSType::Cell,
                value: JSValue::ZERO,
                shared: false,
            }
        }
    }
    unsafe extern "C" {
        fn Bun__createUint8ArrayForCopy(
            global: *const JSGlobalObject,
            ptr: *const c_void,
            len: usize,
            buffer: bool,
        ) -> JSValue;
    }
    impl ArrayBuffer {
        /// `byteSlice()` — `[offset..offset+byte_len]` view into the backing store.
        #[inline]
        pub fn byte_slice(&self) -> &mut [u8] {
            if self.ptr.is_null() { return &mut []; }
            // SAFETY: `ptr`/`byte_len` were filled in by JSC for a live ArrayBuffer.
            unsafe { core::slice::from_raw_parts_mut(self.ptr, self.byte_len as usize) }
        }
        pub fn from_bytes(bytes: &mut [u8], typed_array_type: JSType) -> ArrayBuffer {
            ArrayBuffer {
                ptr: bytes.as_mut_ptr(),
                offset: 0,
                len: bytes.len() as u32,
                byte_len: bytes.len() as u32,
                typed_array_type,
                value: JSValue::ZERO,
                shared: false,
            }
        }
        pub fn create_uint8_array(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
            // SAFETY: `global` is live; bytes ptr/len valid for the call (copied by C++).
            let v = unsafe {
                Bun__createUint8ArrayForCopy(global, bytes.as_ptr().cast(), bytes.len(), false)
            };
            if global.has_exception() { Err(JsError::Thrown) } else { Ok(v) }
        }
    }
    /// Mirror of `JSC::TypedArrayType` (used by `JSType::to_typed_array_type`).
    /// Real definition lives in array_buffer.rs (still gated).
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum TypedArrayType {
        TypeNone = 0,
        TypeInt8,
        TypeUint8,
        TypeUint8Clamped,
        TypeInt16,
        TypeUint16,
        TypeInt32,
        TypeUint32,
        TypeFloat16,
        TypeFloat32,
        TypeFloat64,
        TypeBigInt64,
        TypeBigUint64,
        TypeDataView,
    }
}
pub use self::array_buffer::{ArrayBuffer, JSCArrayBuffer, MarkedArrayBuffer, TypedArrayType};

pub mod ref_string {}
pub use self::ref_string as RefString;

pub mod debugger {
    /// `jsc.Debugger.AsyncTaskTracker` — see Debugger.zig.
    #[derive(Debug, Default, Copy, Clone)]
    pub struct AsyncTaskTracker {
        pub id: u64,
    }
    impl AsyncTaskTracker {
        pub fn init(vm: &mut super::virtual_machine::VirtualMachine) -> Self {
            let _ = vm;
            // TODO(b2): vm.nextAsyncTaskID() — gated until Debugger.rs un-gates.
            Self { id: 0 }
        }
    }
}
pub use self::debugger as Debugger;
pub mod saved_source_map {}
pub use self::saved_source_map as SavedSourceMap;

pub mod virtual_machine {
    #[repr(C)]
    #[derive(Debug, Default)]
    pub struct VirtualMachine {
        pub active_tasks: u32,
    }
    impl VirtualMachine {
        /// `jsc.VirtualMachine.get()` — returns the thread-local VM. In Zig this is
        /// `VMHolder.vm.?`; the Rust port stores it in a thread-local once
        /// VirtualMachine.rs un-gates.
        pub fn get() -> &'static mut VirtualMachine {
            // TODO(b2): VMHolder thread-local — gated until VirtualMachine.rs un-gates.
            todo!("VirtualMachine::get")
        }
    }
}
pub use self::virtual_machine as VirtualMachine;

pub mod module_loader {
    /// Re-export of the canonical hard-coded module enum.
    pub use bun_resolve_builtins::HardcodedModule;
}
pub use self::module_loader as ModuleLoader;

pub mod rare_data {
    /// `jsc.RareData` — per-VM bag of optionally-allocated subsystems.
    /// Only the fields/methods dependents need are surfaced here; the full
    /// struct lives in rare_data.rs (gated).
    #[derive(Default)]
    pub struct RareData {
        pub mysql_context: *mut core::ffi::c_void,
        pub postgresql_context: *mut core::ffi::c_void,
        boring_engine_: *mut core::ffi::c_void,
    }
    impl RareData {
        pub fn boring_engine(&mut self) -> *mut core::ffi::c_void {
            // TODO(b2): bun_boringssl::ENGINE_new() lazy-init — gated.
            self.boring_engine_
        }
    }
}
pub use self::rare_data as RareData;

pub type ErrorableResolvedSource = Errorable<ResolvedSource>;
// TODO(b1): bun_str crate does not exist (bun_string?); using local ZigString stub.
pub type ErrorableZigString = Errorable<ZigString>;
pub type ErrorableJSValue = Errorable<JSValue>;
pub type ErrorableString = Errorable<bun_string::String>;

pub mod console_object {
    pub type Formatter = super::Formatter;
    pub mod formatter {
        /// `ConsoleObject.Formatter.Tag` — classifies a JSValue for pretty-printing.
        /// See ConsoleObject.zig:1081 for the full variant list.
        #[repr(u8)]
        #[derive(Copy, Clone, Eq, PartialEq, Debug)]
        pub enum Tag {
            String,
            Undefined,
            Double,
            Integer,
            Null,
            Boolean,
            Symbol,
            BigInt,
            Error,
            Array,
            Object,
            Function,
            Class,
            Map,
            Set,
            Promise,
            JSON,
            NativeCode,
            ArrayBuffer,
            TypedArray,
            // TODO(b2): full list — gated until ConsoleObject.rs un-gates.
        }
    }
}
pub use self::console_object as ConsoleObject;

pub mod hot_reloader {}

// TODO(b1): bun_runtime crate not in dep-graph at this tier; gate re-exports.
#[cfg(any())]
pub use bun_runtime::test_runner::jest as Jest;
#[cfg(any())]
pub use bun_runtime::test_runner::jest::TestScope;
#[cfg(any())]
pub use bun_runtime::test_runner::expect as Expect;
#[cfg(any())]
pub use bun_runtime::test_runner::snapshot as Snapshot;
pub mod Jest {}
pub mod Expect {}
pub mod Snapshot {}
stub_ty!(TestScope);

pub mod js_property_iterator {
    #[derive(Debug, Default)]
    pub struct JSPropertyIterator<T>(pub core::marker::PhantomData<T>);
    impl<T> JSPropertyIterator<T> {
        pub fn init(
            global: &crate::JSGlobalObject,
            object: crate::JSValue,
        ) -> crate::JsResult<Self> {
            let _ = (global, object);
            // TODO(b2): JSC__JSPropertyIterator__create FFI — gated.
            todo!("JSPropertyIterator::init")
        }
    }
    pub type JSPropertyIteratorOptions = super::JSPropertyIteratorOptions;
}
pub use self::js_property_iterator::JSPropertyIterator;

pub mod event_loop {
    // TODO(b1): gated — see _gated::event_loop
    crate::stub_ty!(
        AbstractVM, AnyEventLoop, AnyTask, AnyTaskWithExtraContext, ConcurrentCppTask,
        ConcurrentPromiseTask, ConcurrentTask, CppTask, DeferredTaskQueue, EventLoopHandle,
        EventLoopKind, EventLoopTask, EventLoopTaskPtr, GarbageCollectionController, JsVM,
        ManagedTask, MiniEventLoop, MiniVM, PosixSignalHandle, PosixSignalTask, Task, WorkPool,
        WorkPoolTask, WorkTask,
    );
}
pub use self::event_loop as EventLoop;
pub use self::event_loop::{
    AbstractVM, AnyEventLoop, AnyTask, AnyTaskWithExtraContext, ConcurrentCppTask,
    ConcurrentPromiseTask, ConcurrentTask, CppTask, DeferredTaskQueue, EventLoopHandle,
    EventLoopKind, EventLoopTask, EventLoopTaskPtr, GarbageCollectionController, JsVM, ManagedTask,
    MiniEventLoop, MiniVM, PosixSignalHandle, PosixSignalTask, Task, WorkPool, WorkPoolTask,
    WorkTask,
};
#[cfg(unix)]
pub type PlatformEventLoop = bun_uws::Loop;
#[cfg(not(unix))]
pub type PlatformEventLoop = bun_aio::Loop;

/// Deprecated: Avoid using this in new code.
#[deprecated]
pub mod c_api {
    use super::*;
    use core::marker::{PhantomData, PhantomPinned};

    #[repr(C)]
    pub struct OpaqueJSValue {
        _p: [u8; 0],
        _m: PhantomData<(*mut u8, PhantomPinned)>,
    }
    pub type JSValueRef = *mut OpaqueJSValue;
    pub type JSObjectRef = *mut OpaqueJSValue;
    pub type ExceptionRef = *mut JSValueRef;
    pub type JSTypedArrayBytesDeallocator =
        Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>;

    // TODO(port): move to jsc_sys
    unsafe extern "C" {
        pub fn JSObjectCallAsFunctionReturnValueHoldingAPILock(
            ctx: *mut JSGlobalObject,
            object: JSObjectRef,
            this_object: JSObjectRef,
            argument_count: usize,
            arguments: *const JSValueRef,
        ) -> JSValue;
    }
}
pub use self::c_api as C;
/// Legacy lower-case alias (Zig: `jsc.c`).
pub use self::c_api as c;
/// Deprecated: Remove all of these please.
pub use self::sizes as Sizes;
/// Deprecated: Use `bun_string::ZigString`
#[deprecated]
pub type ZigString = bun_string::ZigString;
/// `ZigString.Slice` — re-exported under the path dependents expect.
pub type ZigStringSlice = bun_string::ZigStringSlice;
pub mod zig_string {
    pub use bun_string::ZigStringSlice as Slice;
    /// `ZigString.static(comptime s)` — borrow a static UTF-8 literal.
    #[inline]
    pub fn static_(s: &'static [u8]) -> bun_string::ZigString {
        let mut z = bun_string::ZigString::init(s);
        z.mark_utf8();
        z
    }
}
/// Deprecated: Use `bun_webcore`
// TODO(b1): bun_webcore crate not available at this tier.
#[cfg(any())]
#[deprecated]
pub use bun_webcore as WebCore;
#[allow(non_snake_case)]
pub mod WebCore {
    // Forward stubs for the webcore types dependents reference. Real defs live
    // in the bun_webcore crate (not available at this tier).
    crate::stub_ty!(Blob, Request, Response);
}
pub use self::WebCore as webcore;
pub mod blob {
    crate::stub_ty!(Store);
}
/// Deprecated: Use `bun_api`
#[deprecated]
pub use bun_api as API;
pub mod api {
    // `bun_api::BuildArtifact` is defined in bun_runtime (not at this tier).
    // Surface an opaque placeholder so dependents type-check.
    crate::stub_ty!(BuildArtifact);
}
/// Deprecated: Use `bun_api::node`
// TODO(b1): bun_api::node missing from stub surface
#[cfg(any())]
#[deprecated]
pub use bun_api::node as Node;
#[allow(non_snake_case)]
pub mod Node {
    // `node.PathLike` / `node.PathOrFileDescriptor` are defined in bun_runtime
    // (forward-dep on bun_jsc). Surface opaque placeholders so this crate's
    // dependents (which import them via `bun_jsc::Node::*`) type-check.
    crate::stub_ty!(PathLike, PathOrFileDescriptor);
}
pub use self::Node as node;

// TODO(b1): bun_output crate not available; scoped logging stubbed.
#[inline]
pub fn mark_binding(_src: &core::panic::Location<'static>) {
    // gated: bun_output::scoped_log!
}

#[inline]
pub fn mark_member_binding(_class: &'static str, _src: &core::panic::Location<'static>) {
    // gated: bun_output::scoped_log!
}

// TODO(b1): bun_api::Subprocess missing from stub surface
#[cfg(any())]
pub use bun_api::Subprocess;
stub_ty!(Subprocess);

/// Generated classes — re-run generate-classes.ts with .rs output.
pub mod codegen {
    // GENERATED: re-run src/codegen/generate-classes.ts with .rs output
    pub mod js {
        /// Generic accessor for the JSC constructor of a `#[bun_jsc::JsClass]` type.
        /// Real impl is emitted per-class by codegen; this generic fronts it.
        pub fn get_constructor<T>(global: &crate::JSGlobalObject) -> crate::JSValue {
            let _ = global;
            // TODO(b2): generated per-class — re-run generate-classes.ts with .rs output.
            todo!("codegen::js::get_constructor")
        }
    }
}
pub use self::codegen as Codegen;
pub mod GeneratedClassesList {}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — bun.String ↔ JS bridges (bun_string_jsc.zig).
// ──────────────────────────────────────────────────────────────────────────
pub mod bun_string_jsc {
    use super::*;
    unsafe extern "C" {
        fn BunString__fromJS(
            global_object: *mut JSGlobalObject,
            value: JSValue,
            out: *mut bun_string::String,
        ) -> bool;
        fn BunString__createUTF8ForJS(
            global_object: *mut JSGlobalObject,
            ptr: *const u8,
            len: usize,
        ) -> JSValue;
    }
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        let mut out = bun_string::String::DEAD;
        // SAFETY: `out` is a valid out-param; `global` is live.
        let ok = unsafe { BunString__fromJS(global.as_ptr(), value, &mut out) };
        if ok { Ok(out) } else { Err(JsError::Thrown) }
    }
    pub fn create_utf8_for_js(global: &JSGlobalObject, utf8: &[u8]) -> JsResult<JSValue> {
        // SAFETY: `global` is live; bytes copied by C++.
        let v = unsafe { BunString__createUTF8ForJS(global.as_ptr(), utf8.as_ptr(), utf8.len()) };
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(v) }
    }
}

/// Extension trait providing JSC-aware methods on `bun_string::String`.
/// Mirrors the `pub usingnamespace` in bun_string_jsc.zig.
pub trait StringJsc {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String>;
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
impl StringJsc for bun_string::String {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        bun_string_jsc::from_js(value, global)
    }
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let _ = global;
        // TODO(b2): BunString__toJS FFI — gated.
        todo!("StringJsc::to_js")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — comptime string-map JSC bridges.
// ──────────────────────────────────────────────────────────────────────────
pub mod comptime_string_map_jsc {
    use super::*;
    /// Look up `input` (after stringifying) in a comptime `phf::Map`.
    pub fn from_js<V: Copy>(
        map: &'static phf::Map<&'static [u8], V>,
        global: &JSGlobalObject,
        input: JSValue,
    ) -> JsResult<Option<V>> {
        let str = bun_string_jsc::from_js(input, global)?;
        let utf8 = str.to_utf8();
        Ok(map.get(utf8.slice()).copied())
    }
}
/// Extension trait so callers can write `MAP.from_js(global, value)`.
pub trait ComptimeStringMapExt<V: Copy> {
    fn from_js(&'static self, global: &JSGlobalObject, input: JSValue) -> JsResult<Option<V>>;
}
impl<V: Copy> ComptimeStringMapExt<V> for phf::Map<&'static [u8], V> {
    fn from_js(&'static self, global: &JSGlobalObject, input: JSValue) -> JsResult<Option<V>> {
        comptime_string_map_jsc::from_js(self, global, input)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — BuildMessage / ResolveMessage / ZigException::Holder / JsClass.
// ──────────────────────────────────────────────────────────────────────────
pub mod build_message {
    /// `jsc.BuildMessage` — wraps a `bun.logger.Msg` for JS exposure.
    pub struct BuildMessage {
        pub msg: bun_logger::Msg,
    }
}
pub use self::build_message::BuildMessage;

pub mod resolve_message {
    /// `jsc.ResolveMessage` — wraps a resolver error for JS exposure.
    pub struct ResolveMessage {
        pub msg: bun_logger::Msg,
        pub referrer: bun_string::String,
    }
}
pub use self::resolve_message::ResolveMessage;

pub mod zig_exception {
    /// `ZigException.Holder` — extern struct that owns the stack-frame storage
    /// passed across the FFI boundary (ZigException.zig:54).
    #[repr(C)]
    pub struct Holder {
        // TODO(b2): full field layout (frames + remapped flag) — gated.
        _bytes: [u8; 0],
    }
    impl Holder {
        pub fn init() -> Self { Self { _bytes: [] } }
    }
}

/// Trait implemented by `#[bun_jsc::JsClass]`-derived types. The proc-macro
/// emits `to_js`/`from_js`/`from_js_direct` per type; this is the trait shape.
pub trait JsClass: Sized {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn from_js(value: JSValue) -> Option<*mut Self>;
    fn from_js_direct(value: JSValue) -> Option<*mut Self>;
}

/// Track whether an object should keep the event loop alive
#[derive(Default)]
pub struct Ref {
    pub has: bool,
}

impl Ref {
    pub fn init() -> Ref {
        Ref::default()
    }

    pub fn unref(&mut self, vm: &mut virtual_machine::VirtualMachine) {
        if !self.has {
            return;
        }
        self.has = false;
        vm.active_tasks -= 1;
    }

    pub fn r#ref(&mut self, vm: &mut virtual_machine::VirtualMachine) {
        if self.has {
            return;
        }
        self.has = true;
        vm.active_tasks += 1;
    }
}

pub type OpaqueCallback = unsafe extern "C" fn(current: *mut c_void);

/// Wrap a typed `fn(&mut Context)` as an `extern "C" fn(*mut c_void)`.
pub fn opaque_wrap<Context, F>() -> OpaqueCallback
where
    F: FnTyped<Context>,
{
    // TODO(port): Zig used `comptime Function: fn(*Context) void` as a value param.
    unsafe extern "C" fn callback<Context, F: FnTyped<Context>>(ctx: *mut c_void) {
        // SAFETY: caller guarantees ctx is a valid *mut Context.
        let context: &mut Context = unsafe { &mut *ctx.cast::<Context>() };
        F::call(context);
    }
    callback::<Context, F>
}

/// Helper trait for [`opaque_wrap`].
pub trait FnTyped<Context> {
    fn call(this: &mut Context);
}

// TODO(port): `@import("ErrorCode").Error` resolves via build-system module name.
pub type Error = ErrorCode; // stub

/// Maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52).
pub const INIT_TIMESTAMP: JSTimeType = (1u64 << 52) - 1;
// TODO(port): Zig u52 — Rust has no u52. Using u64.
pub type JSTimeType = u64;

pub fn to_js_time(sec: isize, nsec: isize) -> JSTimeType {
    const NS_PER_MS: isize = 1_000_000;
    const MS_PER_S: isize = 1_000;
    let millisec: u64 = u64::try_from(nsec / NS_PER_MS).unwrap();
    ((u64::try_from(sec * MS_PER_S).unwrap() + millisec) & ((1u64 << 52) - 1)) as JSTimeType
}

pub const MAX_SAFE_INTEGER: i64 = 9007199254740991;
pub const MIN_SAFE_INTEGER: i64 = -9007199254740991;

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSCInitialize(
        env: *const *const c_char,
        count: usize,
        cb: unsafe extern "C" fn(name: *const u8, len: usize),
        eval_mode: bool,
    );
}

pub mod math {
    unsafe extern "C" {
        fn Bun__JSC__operationMathPow(x: f64, y: f64) -> f64;
    }
    pub fn pow(x: f64, y: f64) -> f64 {
        // SAFETY: pure FFI, no pointers.
        unsafe { Bun__JSC__operationMathPow(x, y) }
    }
}

// TODO(port): generated module — re-run bindgen with .rs output.
pub mod generated {
    // GENERATED: re-run codegen (bindgen_generated) with .rs output
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/jsc.zig (283 lines)
//   confidence: low (B-1 gate-and-stub)
//   todos:      see TODO(b1) markers
//   notes:      crate root; all submodules gated. Stub surface only.
// ──────────────────────────────────────────────────────────────────────────
