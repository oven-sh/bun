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
// `ConsoleObject::Formatter::print_as` dispatches on `const FORMAT: Tag` to
// preserve Zig's comptime monomorphization (zig:2210). `Tag` is a fieldless
// enum, so this is the structural-match subset of the feature.
#![feature(adt_const_params)]
#![allow(incomplete_features)]

extern crate alloc;
// Allow `::bun_jsc::…` paths emitted by the proc-macros to resolve when used
// inside this crate (e.g. `#[JsClass]` on `BuildMessage`).
extern crate self as bun_jsc;

use core::ffi::{c_char, c_void};
use core::marker::PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// Proc-macro re-exports. `#[bun_jsc::host_fn]` / `#[bun_jsc::JsClass]` /
// `#[bun_jsc::host_call]` are implemented in the `bun_jsc_macros` crate
// (Rust forbids `proc-macro = true` crates from exporting non-macro items).
// See docs/PORTING.md §JSC types and src/codegen/generate-classes.ts for the
// symbol-naming contract the macros uphold.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_jsc_macros::{codegen_cached_accessors, host_call, host_fn, JsClass, JsClassDerive};

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
#[path = "JSInternalPromise.rs"] pub mod js_internal_promise;
#[path = "DecodedJSValue.rs"] pub mod decoded_js_value;
#[path = "JSArray.rs"] pub mod js_array;
#[path = "DeprecatedStrong.rs"] pub mod deprecated_strong;
#[path = "Counters.rs"] pub mod counters;
#[path = "uuid.rs"] pub mod uuid;
#[path = "JSRef.rs"] pub mod js_ref;
#[path = "StringBuilder.rs"] pub mod string_builder;
#[path = "Task.rs"] pub mod task;
#[path = "JSPromise.rs"] pub mod js_promise;
#[path = "array_buffer.rs"] pub mod array_buffer;
#[path = "ZigString.rs"] pub mod zig_string;
#[path = "rare_data.rs"] pub mod rare_data;
#[path = "ipc.rs"] pub mod ipc;
#[path = "ConsoleObject.rs"] pub mod console_object;

pub use self::task::{Taskable, RUN_TASK_HOOK, set_run_task_hook};
pub use self::js_promise::JSPromise;
pub use self::array_buffer::{ArrayBuffer, JSCArrayBuffer, MarkedArrayBuffer, TypedArrayType};
pub use self::rare_data as RareData;
pub use self::console_object as ConsoleObject;
pub use self::console_object::Formatter;
/// `ConsoleObject.Formatter.Tag` re-exported under both names downstream
/// drafts use (`FormatAs::Double` in Response.rs, `FormatTag::Private` in
/// Request.rs / S3Client.rs). Same enum; the split is naming drift only.
pub use self::console_object::formatter::Tag as FormatTag;
pub use self::console_object::formatter::Tag as FormatAs;

/// Trait surface for `write_format`-style hooks on runtime types
/// (`Response::write_format`, `Request::write_format`, `S3File::write_format`,
/// …). Mirrors the duck-typed `*ConsoleObject.Formatter` parameter in Zig —
/// callers only ever touch `globalThis` and `printAs`, so the trait exposes
/// just those two and the `bun_jsc::Formatter` struct provides the canonical
/// impl.
pub trait ConsoleFormatter {
    fn global_this(&self) -> &JSGlobalObject;
    /// `Formatter.printAs(comptime Format, Writer, writer, value, jsType)` —
    /// the const-generic `ENABLE_ANSI_COLORS` mirrors Zig's comptime bool.
    fn print_as<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        tag: FormatTag,
        writer: &mut W,
        value: JSValue,
        cell: JSType,
    ) -> JsResult<()>;
}

impl<'a> ConsoleFormatter for self::console_object::Formatter<'a> {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject { self.global_this }
    fn print_as<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        tag: FormatTag,
        writer: &mut W,
        value: JSValue,
        cell: JSType,
    ) -> JsResult<()> {
        // Downstream `write_format` hooks (Response/Request/S3Client/…) hold a
        // `core::fmt::Write`; the formatter body is byte-oriented
        // (`dyn bun_io::Write`). Bridge via `FmtAdapter`, then route through
        // the runtime-tag dispatcher (`Formatter::format`) which fans out to
        // the const-generic `print_as::<{ Tag::… }, …>` arms.
        let mut sink = bun_io::FmtAdapter::new(writer);
        let result = self::console_object::formatter::TagResult {
            tag: tag.into(),
            cell,
        };
        let global = self.global_this;
        self.format::<ENABLE_ANSI_COLORS>(result, &mut sink, value, global)
    }
}

pub use self::js_ref::JsRef;
pub use self::string_builder::StringBuilder;
pub use self::js_internal_promise::JSInternalPromise;
pub use self::decoded_js_value::DecodedJSValue;
pub use self::js_array::JSArray;
pub use self::deprecated_strong::DeprecatedStrong;
pub use self::counters::Counters;
pub use self::uuid::{UUID, UUID5, UUID7};

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
pub use self::error_code::{ErrorBuilder, ErrorCode};
/// Some drafts spell this `jsc::ErrCode` — keep both until call-sites converge.
pub use self::error_code::ErrorCode as ErrCode;
pub use self::zig_error_type::ZigErrorType;
pub use self::errorable::Errorable;
pub use self::zig_stack_frame_position::ZigStackFramePosition;

#[rustfmt::skip]
mod _gated {
    #![cfg(any())]
    #[path = "JSValue.rs"] pub mod js_value;
    #[path = "host_fn.rs"] pub mod host_fn;
    #[path = "AnyPromise.rs"] pub mod any_promise;
    #[path = "CachedBytecode.rs"] pub mod cached_bytecode;
    #[path = "DOMFormData.rs"] pub mod dom_form_data;
    #[path = "DeferredError.rs"] pub mod deferred_error;
    #[path = "JSArrayIterator.rs"] pub mod js_array_iterator;
    #[path = "JSGlobalObject.rs"] pub mod js_global_object;
    #[path = "RefString.rs"] pub mod ref_string;
    #[path = "SystemError.rs"] pub mod system_error;
    #[path = "URL.rs"] pub mod url;
    #[path = "VM.rs"] pub mod vm;
    #[path = "ZigStackTrace.rs"] pub mod zig_stack_trace;
    #[path = "ZigStackFrame.rs"] pub mod zig_stack_frame;
    #[path = "ZigException.rs"] pub mod zig_exception;
    #[path = "JSPropertyIterator.rs"] pub mod js_property_iterator;
    #[path = "javascript_core_c_api.rs"] pub mod c_api;
    #[path = "sizes.rs"] pub mod sizes;
    #[path = "generated_classes_list.rs"] pub mod generated_classes_list;
    #[path = "AbortSignal.rs"] pub mod abort_signal;
    #[path = "AsyncModule.rs"] pub mod async_module;
    #[path = "BuildMessage.rs"] pub mod build_message;
    #[path = "BunCPUProfiler.rs"] pub mod bun_cpu_profiler;
    #[path = "BunHeapProfiler.rs"] pub mod bun_heap_profiler;
    #[path = "ConcurrentPromiseTask.rs"] pub mod concurrent_promise_task;
    #[path = "CppTask.rs"] pub mod cpp_task;
    #[path = "EventLoopHandle.rs"] pub mod event_loop_handle;
    #[path = "FFI.rs"] pub mod ffi;
    #[path = "GarbageCollectionController.rs"] pub mod garbage_collection_controller;
    #[path = "HTTPServerAgent.rs"] pub mod http_server_agent;
    #[path = "JSCScheduler.rs"] pub mod jsc_scheduler;
    #[path = "JSONLineBuffer.rs"] pub mod json_line_buffer;
    #[path = "JSSecrets.rs"] pub mod js_secrets;
    #[path = "NodeModuleModule.rs"] pub mod node_module_module;
    #[path = "PosixSignalHandle.rs"] pub mod posix_signal_handle;
    #[path = "ProcessAutoKiller.rs"] pub mod process_auto_killer;
    #[path = "ResolveMessage.rs"] pub mod resolve_message;
    #[path = "WorkTask.rs"] pub mod work_task;
    #[path = "bindgen.rs"] pub mod bindgen;
    #[path = "bindgen_test.rs"] pub mod bindgen_test;
    #[path = "btjs.rs"] pub mod btjs;
    #[path = "bun_string_jsc.rs"] pub mod bun_string_jsc;
    #[path = "codegen.rs"] pub mod codegen_mod;
    #[path = "comptime_string_map_jsc.rs"] pub mod comptime_string_map_jsc;
    #[path = "config.rs"] pub mod config;
    #[path = "fmt_jsc.rs"] pub mod fmt_jsc;
    #[path = "resolve_path_jsc.rs"] pub mod resolve_path_jsc;
    #[path = "resolver_jsc.rs"] pub mod resolver_jsc;
    #[path = "virtual_machine_exports.rs"] pub mod virtual_machine_exports;
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
            #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
            pub struct $name(pub usize);
        )*
    };
}

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) {
    // TODO(port): bun_core::analytics::Features::jsc_inc — analytics counter not yet wired.
    let env = bun_sys::environ();
    // SAFETY: `env` borrows the libc `environ` global for the duration of the
    // call; `on_jsc_invalid_env_var` is `extern "C"` and only reads the (ptr,len)
    // it is handed. JSCInitialize is called exactly once at startup.
    unsafe { JSCInitialize(env.as_ptr(), env.len(), on_jsc_invalid_env_var, eval_mode) };
}

/// Port of `onJSCInvalidEnvVar` (jsc.zig:254).
unsafe extern "C" fn on_jsc_invalid_env_var(name: *const u8, len: usize) {
    // SAFETY: C++ guarantees `name[..len]` is valid for the call.
    let name = unsafe { core::slice::from_raw_parts(name, len) };
    bun_core::err_generic!(
        "invalid JSC environment variable\n\n    <b>{}<r>\n\n\
For a list of options, see this file:\n\n    \
https://github.com/oven-sh/webkit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h\n\n\
Environment variables must be prefixed with \"BUN_JSC_\". This code runs before .env files are loaded, so those won't work here.\n\n\
Warning: options change between releases of Bun and WebKit without notice. This is not a stable API, you should not rely on it beyond debugging something, and it may be removed entirely in a future version of Bun.",
        alloc::string::String::from_utf8_lossy(name),
    );
    bun_core::exit(1);
}

// `JSValue` stub — `#[repr(transparent)]` over the encoded 64-bit JSC::JSValue.
// PhantomData<*const ()> makes the type `!Send + !Sync` (PORTING.md §JSC types):
// JSValues are GC-cell pointers and must never cross threads.
// TODO(b2): inner type should be `i64` per spec; kept `usize` (same width on
// all supported 64-bit targets) until `JSValue.rs` is un-gated to avoid a
// cascading bit-twiddle rewrite of the tag-mask helpers below.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JSValue(pub usize, PhantomData<*const ()>);

// B-2: minimal `JSValue` surface so un-gated leaf modules type-check while
// `JSValue.rs` itself remains gated. These match the real definitions in
// `JSValue.rs` (`#[repr(transparent)] i64` — stub uses `usize`, same size).
impl JSValue {
    pub const ZERO: JSValue = JSValue(0, PhantomData);
    pub const UNDEFINED: JSValue = JSValue(0xa, PhantomData);
    pub const NULL: JSValue = JSValue(0x2, PhantomData);
    /// `JSC::JSValue::ValueDeleted` (0x4) — sentinel returned by
    /// `getIfPropertyExistsImpl` when the property does not exist.
    pub const PROPERTY_DOES_NOT_EXIST: JSValue = JSValue(0x4, PhantomData);
    #[inline] pub fn is_empty(self) -> bool { self.0 == 0 }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSValue surface (signatures sourced from src/jsc/JSValue.zig).
// Bodies wrap the real `extern "C"` symbols where the ABI is trivially known;
// the rest are `todo!()` until JSValue.rs is un-gated.
// ──────────────────────────────────────────────────────────────────────────
impl JSValue {
    pub const TRUE: JSValue = JSValue(0x7, PhantomData);
    pub const FALSE: JSValue = JSValue(0x6, PhantomData);

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
    #[inline] pub fn is_symbol(self) -> bool {
        // SAFETY: pure FFI predicate; C++ handles non-cells (JSValue.zig:1067).
        unsafe { JSC__JSValue__isSymbol(self) }
    }
    #[inline] pub fn is_big_int(self) -> bool {
        // SAFETY: pure FFI predicate; C++ handles non-cells incl. BigInt32
        // immediates (JSValue.zig:1076 — no `isCell()` guard).
        unsafe { JSC__JSValue__isBigInt(self) }
    }
    /// `JSValue.isCallable()` (JSValue.zig:1159).
    #[inline] pub fn is_callable(self) -> bool {
        // SAFETY: pure FFI predicate; C++ handles non-cells.
        unsafe { JSC__JSValue__isCallable(self) }
    }
    /// `JSValue.isFunction()` (JSValue.zig:1094) — JSType-byte check, NOT
    /// `isCallable()`. Callable proxies return `false` here but `true` from
    /// `is_callable()`.
    #[inline] pub fn is_function(self) -> bool {
        self.is_cell() && self.js_type().is_function()
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
        JSValue(NUMBER_TAG | (i as u32 as usize), PhantomData)
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
    #[inline] pub fn as_boolean(self) -> bool {
        debug_assert!(self.is_boolean());
        self.0 == Self::TRUE.0
    }
    #[inline] pub fn as_int32(self) -> i32 {
        debug_assert!(self.is_int32());
        (self.0 & 0xffff_ffff) as u32 as i32
    }
    #[inline] pub fn is_double(self) -> bool {
        self.is_number() && !self.is_int32()
    }
    #[inline] pub fn as_double(self) -> f64 {
        debug_assert!(self.is_double());
        // FFI.zig: JSVALUE_TO_DOUBLE — subtract DoubleEncodeOffset, bitcast to f64.
        f64::from_bits((self.0 as i64).wrapping_sub(ffi::DOUBLE_ENCODE_OFFSET) as u64)
    }
    /// Asserts this is a number, undefined, null, or a boolean.
    pub fn as_number(self) -> f64 {
        if self.is_int32() {
            self.as_int32() as f64
        } else if self.is_number() {
            self.as_double()
        } else if self.is_undefined_or_null() {
            0.0
        } else if self.is_boolean() {
            if self.as_boolean() { 1.0 } else { 0.0 }
        } else {
            f64::NAN
        }
    }
    #[inline] pub fn get_number(self) -> Option<f64> {
        if self.is_number() { Some(self.as_number()) } else { None }
    }
    pub fn to_int32(self) -> i32 {
        if self.is_int32() {
            return (self.0 & 0xffff_ffff) as u32 as i32;
        }
        if let Some(num) = self.get_number() {
            // JSValue.zig:2129 — coerceJSValueDoubleTruncatingT(i32, num):
            // NaN → 0, ±Inf/out-of-range → saturate to i32 MIN/MAX, else truncate.
            if num.is_nan() { return 0; }
            return num as i32; // Rust `as` saturates on overflow, matching coerceJSValueDoubleTruncatingT
        }
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toInt32(self) }
    }
    pub fn to_int64(self) -> i64 {
        if self.is_int32() {
            return self.as_int32() as i64;
        }
        if let Some(num) = self.get_number() {
            // JSValue.zig:916 — coerceDoubleTruncatingIntoInt64.
            if num.is_nan() { return 0; }
            return num as i64; // saturating truncation
        }
        // SAFETY: pure FFI conversion (BigInt / cell fallback).
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
        // SAFETY: `global` is live; FFI may set an exception.
        let p = unsafe { JSC__JSValue__toStringOrNull(self, global) };
        if p.is_null() || global.has_exception() { Err(JsError::Thrown) } else { Ok(p) }
    }
    pub fn to_bun_string(self, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        bun_string_jsc::from_js(self, global)
    }
    pub fn to_zig_string(self, out: &mut bun_string::ZigString, global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: `out` is a valid out-param; `global` is live.
        host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__toZigString(self, out, global)
        })
    }
    pub fn to_slice(self, global: &JSGlobalObject) -> JsResult<bun_string::ZigStringSlice> {
        Ok(self.to_bun_string(global)?.to_utf8())
    }
    pub fn to_slice_clone(self, global: &JSGlobalObject) -> JsResult<bun_string::ZigStringSlice> {
        let _ = global;
        // Spec (JSValue.zig `toSliceClone`) returns an owned/cloned slice
        // independent of the backing WTFStringImpl; `to_slice` returns a
        // possibly-borrowed view. Silently aliasing them is wrong — fail loudly
        // until the clone path is ported.
        todo!("JSValue::to_slice_clone")
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
        debug_assert!(self.is_string());
        // SAFETY: `is_string()` ⇒ cell-tagged ⇒ payload is the JSString*.
        unsafe { JSC__JSValue__asString(self) }
    }
    pub fn as_array_buffer(self, global: &JSGlobalObject) -> Option<ArrayBuffer> {
        let mut out = ArrayBuffer::default();
        // SAFETY: `global` is live; `out` is a valid out-param.
        if unsafe { JSC__JSValue__asArrayBuffer(self, global, &mut out) } {
            out.value = self;
            Some(out)
        } else {
            None
        }
    }
    /// Generic downcast (`as(comptime T)` in Zig). Dispatches via [`JsClass::from_js`].
    #[inline]
    pub fn as_<T: JsClass>(self) -> Option<*mut T> {
        if !self.is_cell() { return None; }
        T::from_js(self)
    }
    /// `JSValue.asDirect(T)` (JSValue.zig:431) — unchecked-prototype downcast.
    /// Caller must have already verified `is_cell()`; dispatches via
    /// [`JsClass::from_js_direct`] (skips the prototype-chain walk that `as_`
    /// performs, so subclasses are *not* matched).
    #[inline]
    pub fn as_direct<T: JsClass>(self) -> Option<*mut T> {
        debug_assert!(self.is_cell());
        T::from_js_direct(self)
    }
    /// `JSValue.asPromise()` — downcast to `JSPromise` (matches `JSInternalPromise` too).
    /// Returns a raw pointer (mirrors Zig `?*JSPromise`); conjuring a
    /// `&'static mut` here would permit aliased `&mut` UB across two calls on
    /// the same value (PORTING.md §Forbidden).
    pub fn as_promise(self) -> Option<*mut JSPromise> {
        if !self.is_cell() { return None; }
        // SAFETY: `self` is a cell; FFI returns null when not a promise type.
        let p = unsafe { JSC__JSValue__asPromise(self) };
        if p.is_null() { None } else { Some(p) }
    }
    /// `JSValue.isAnyError()` — Error, Exception, or has `[Symbol.error]`.
    #[inline]
    pub fn is_any_error(self) -> bool {
        if !self.is_cell() { return false; }
        // SAFETY: `self` is a cell.
        unsafe { JSC__JSValue__isAnyError(self) }
    }
    /// `JSValue.attachAsyncStackFromPromise(global, promise)` — append the
    /// promise's await-chain frames to this error's stack.
    pub fn attach_async_stack_from_promise(self, global: &JSGlobalObject, promise: &JSPromise) {
        let _ = (global, promise);
        // Silently dropping async stack frames is a wrong implementation in
        // live code — fail loudly until the C++ shim is wired.
        todo!("JSValue::attach_async_stack_from_promise — JSC__JSValue__attachAsyncStackFromPromise FFI not yet declared")
    }
    pub fn as_any_promise(self) -> Option<AnyPromise> {
        if !self.is_cell() { return None; }
        // JSValue.zig:657 — check internal FIRST (JSInternalPromise extends JSPromise,
        // so `asPromise` would also match it and misclassify).
        // SAFETY: `self` is a cell; FFI returns null when not an internal promise.
        let p = unsafe { JSC__JSValue__asInternalPromise(self) };
        if !p.is_null() { return Some(AnyPromise::Internal(p)); }
        // SAFETY: `self` is a cell; FFI returns null when not a promise type.
        let p = unsafe { JSC__JSValue__asPromise(self) };
        if !p.is_null() { return Some(AnyPromise::Normal(p)); }
        None
    }
    pub fn get_unix_timestamp(self) -> f64 {
        // SAFETY: pure FFI; `self` must be a JSDate cell (caller-checked).
        unsafe { JSC__JSValue__getUnixTimestamp(self) }
    }
    /// Returns `(ptr, len)` of the cell's `ClassInfo` name (static C string).
    pub fn get_class_info_name(self) -> Option<&'static [u8]> {
        if !self.is_cell() { return None; }
        let mut ptr: *const u8 = core::ptr::null();
        let mut len: usize = 0;
        // SAFETY: out-params are valid; FFI writes only when returning true.
        if unsafe { JSC__JSValue__getClassInfoName(self, &mut ptr, &mut len) } {
            // SAFETY: C++ guarantees `ptr[..len]` is a static `ClassInfo::className`.
            Some(unsafe { core::slice::from_raw_parts(ptr, len) })
        } else {
            None
        }
    }

    // ── property access ──────────────────────────────────────────────────
    /// `JSValue.fastGet(global, BuiltinName)` (JSValue.zig:1414) — property
    /// lookup using a preallocated `JSC::Identifier` (avoids allocating a key
    /// string). `self` must be known to be an object.
    pub fn fast_get(self, global: &JSGlobalObject, builtin_name: BuiltinName) -> JsResult<Option<JSValue>> {
        debug_assert!(self.is_object());
        // SAFETY: `global` is live; `builtin_name` is a valid `u8` index into
        // C++ `BuiltinNamesMap`.
        let v = host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__fastGet(self, global, builtin_name as u8)
        })?;
        // JSValue.zig:1424 — `.property_does_not_exist_on_object` (0x4) and
        // `.js_undefined` map to None; `.zero` ⇒ exception (handled above).
        if v.0 == JSValue::PROPERTY_DOES_NOT_EXIST.0 || v.is_undefined() { Ok(None) } else { Ok(Some(v)) }
    }

    /// `JSValue.coerceToInt64` (JSValue.zig:47) — full ToNumber → Int64 path
    /// (may throw via `valueOf`/`toString`).
    pub fn coerce_to_int64(self, global: &JSGlobalObject) -> JsResult<i64> {
        // SAFETY: `global` is live; FFI may set an exception.
        host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__coerceToInt64(self, global)
        })
    }

    /// `JSValue.getZigString` — read a JS string into a `ZigString` view.
    /// Convenience wrapper over [`JSValue::to_zig_string`] that returns the
    /// out-param by value.
    pub fn get_zig_string(self, global: &JSGlobalObject) -> JsResult<bun_string::ZigString> {
        let mut out = bun_string::ZigString::EMPTY;
        self.to_zig_string(&mut out, global)?;
        Ok(out)
    }

    /// `JSValue.jsonStringify` (JSValue.zig:1278).
    pub fn json_stringify(self, global: &JSGlobalObject, indent: u32, out: &mut bun_string::String) -> JsResult<()> {
        // SAFETY: `global` is live; `out` is a valid out-param for the call.
        host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jsonStringify(self, global, indent, out)
        })
    }

    /// `JSValue.jsonStringifyFast` (JSValue.zig:1287) — `JSON.stringify(this)`
    /// with no indent / no replacer (fast path used by SQL value binders).
    pub fn json_stringify_fast(self, global: &JSGlobalObject, out: &mut bun_string::String) -> JsResult<()> {
        // SAFETY: `global` is live; `out` is a valid out-param for the call.
        host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__jsonStringifyFast(self, global, out)
        })
    }

    pub fn get(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<JSValue>> {
        // Spec (JSValue.zig:1536-1540) only routes to `fastGet` when the key is
        // *comptime-known*. A runtime byte-slice match here is wrong because
        // C++ `builtinNameMap` maps e.g. `asyncIterator` → `Symbol.asyncIterator`
        // (and `inspectCustom` → `Symbol.for("nodejs.util.inspect.custom")`), so
        // a dynamic `b"asyncIterator"` would fetch the *symbol* property instead
        // of the *string* property. Always go through the by-name FFI; callers
        // that statically know they want a builtin should call `fast_get` directly.
        // SAFETY: `global` is live; bytes valid for the call.
        let v = unsafe {
            JSC__JSValue__getIfPropertyExistsImpl(self, global, property.as_ptr(), property.len())
        };
        if global.has_exception() { return Err(JsError::Thrown); }
        // JSValue.zig:1545 — `.property_does_not_exist_on_object` (encoded 0x4 = ValueDeleted)
        // and `.js_undefined` map to None. `.zero` ⇒ exception (handled above).
        if v.0 == JSValue::PROPERTY_DOES_NOT_EXIST.0 || v.is_undefined() { Ok(None) } else { Ok(Some(v)) }
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
        // JSValue.zig:1682 `getStringish` — `get(prop)`, filter null/false → None,
        // reject symbols, otherwise coerce via `toBunString` and filter "" → None.
        let Some(prop) = self.get(global, property)? else { return Ok(None) };
        if prop.is_null() || prop == JSValue::FALSE { return Ok(None); }
        if prop.is_symbol() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Expected \"{}\" to be a string",
                alloc::string::String::from_utf8_lossy(property),
            )));
        }
        let s = prop.to_bun_string(global)?;
        if s.is_empty() { Ok(None) } else { Ok(Some(s)) }
    }
    pub fn get_array(self, global: &JSGlobalObject, property: &[u8]) -> JsResult<Option<JSValue>> {
        // JSValue.zig:1784 `getArray` → `coerceToArray`: `get(prop)`, require
        // `jsTypeLoose().isArray()` (numbers map to NumberObject — never an
        // array — so the cell guard is sufficient), then filter empty arrays.
        let Some(prop) = self.get(global, property)? else { return Ok(None) };
        if prop.is_undefined_or_null() { return Ok(None); }
        if !prop.is_cell() || !prop.js_type().is_array() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Expected \"{}\" to be an array",
                alloc::string::String::from_utf8_lossy(property),
            )));
        }
        if prop.get_length(global)? == 0 { return Ok(None); }
        Ok(Some(prop))
    }
    pub fn get_own_by_value(self, global: &JSGlobalObject, property_value: JSValue) -> Option<JSValue> {
        // SAFETY: `global` is live; FFI returns ZERO for not-found.
        let v = unsafe { JSC__JSValue__getOwnByValue(self, global, property_value) };
        if v.is_empty() { None } else { Some(v) }
    }
    pub fn get_object(self) -> Option<*mut JSObject> {
        if !self.is_object() { return None; }
        // Cell-tagged JSValues *are* the cell pointer (NotCellMask bits are zero).
        Some(self.0 as *mut JSObject)
    }
    pub fn get_index(self, global: &JSGlobalObject, i: u32) -> JsResult<JSValue> {
        JSObject::get_index(self, global, i)
    }
    pub fn get_length(self, global: &JSGlobalObject) -> JsResult<u64> {
        // SAFETY: `global` is live; FFI may set an exception.
        let len = host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__getLengthIfPropertyExistsInternal(self, global)
        })?;
        if len == f64::MAX { return Ok(0); }
        // JSValue.zig:2181 — clamps to `std.math.maxInt(i52)` (2^51 − 1), not MAX_SAFE_INTEGER.
        const I52_MAX: i64 = (1i64 << 51) - 1;
        Ok(len.clamp(0.0, I52_MAX as f64) as u64)
    }
    pub fn put(self, global: &JSGlobalObject, key: &[u8], value: JSValue) {
        let zs = bun_string::ZigString::init(key);
        // SAFETY: `global` is live; `zs` borrowed for the call.
        unsafe { JSC__JSValue__put(self, global, &zs, value) }
    }
    pub fn put_to_property_key(target: JSValue, global: &JSGlobalObject, key: JSValue, value: JSValue) -> JsResult<()> {
        // SAFETY: `global` is live; key/value are valid encoded JSValues per caller invariant.
        host_fn::from_js_host_call_generic(global, || unsafe {
            JSC__JSValue__putToPropertyKey(target, global, key, value)
        })
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
    pub fn parse(global: &JSGlobalObject, string: &bun_string::ZigString) -> JsResult<JSValue> {
        // SAFETY: `global` is live; `string` borrowed for the call.
        host_fn::from_js_host_call(global, || unsafe {
            JSC__JSValue__parseJSON(string, global)
        })
    }
}

/// `JSValue.Hash` — `std.hash_map` adapter for using JSValue as a key (Zig: JSValue.zig).
/// Hashes the raw encoded bit-pattern.
pub mod js_value_hash {
    use super::JSValue;
    #[derive(Default, Clone, Copy)]
    pub struct Hash;
    impl Hash {
        #[inline] pub fn hash(_: &Self, v: JSValue) -> u64 {
            bun_wyhash::hash(&v.0.to_ne_bytes())
        }
        #[inline] pub fn eql(_: &Self, a: JSValue, b: JSValue) -> bool { a.0 == b.0 }
    }
}
impl JSValue {
    #[allow(non_upper_case_globals)]
    pub const Hash: js_value_hash::Hash = js_value_hash::Hash;
}
impl core::hash::Hash for JSValue {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) { self.0.hash(state) }
}

// ── `JSValue::from(T)` blanket constructors (Zig: anytype dispatch) ───────
impl From<bool> for JSValue {
    #[inline] fn from(b: bool) -> Self { Self::js_boolean(b) }
}
impl From<i32> for JSValue {
    #[inline] fn from(i: i32) -> Self { Self::js_number_from_int32(i) }
}
impl From<u32> for JSValue {
    #[inline] fn from(i: u32) -> Self {
        if i <= i32::MAX as u32 { Self::js_number_from_int32(i as i32) } else { Self::js_number(i as f64) }
    }
}
impl From<f64> for JSValue {
    #[inline] fn from(n: f64) -> Self { Self::js_number(n) }
}
impl From<u64> for JSValue {
    #[inline] fn from(i: u64) -> Self { Self::js_number_from_uint64(i) }
}
impl From<usize> for JSValue {
    #[inline] fn from(i: usize) -> Self { Self::js_number_from_uint64(i as u64) }
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
    fn JSC__JSValue__isSymbol(this: JSValue) -> bool;
    fn JSC__JSValue__isBigInt(this: JSValue) -> bool;
    fn JSC__JSValue__isCallable(this: JSValue) -> bool;
    fn JSC__JSValue__coerceToInt64(this: JSValue, global: *const JSGlobalObject) -> i64;
    fn JSC__JSValue__fastGet(this: JSValue, global: *const JSGlobalObject, builtin: u8) -> JSValue;
    fn JSC__JSValue__jsonStringify(this: JSValue, global: *const JSGlobalObject, indent: u32, out: *mut bun_string::String);
    fn JSC__JSValue__jsonStringifyFast(this: JSValue, global: *const JSGlobalObject, out: *mut bun_string::String);
    fn JSC__JSValue__toError_(this: JSValue) -> JSValue;
    fn JSC__JSValue__toZigException(this: JSValue, global: *const JSGlobalObject, exception: *mut ZigException);
    fn JSC__JSValue__getUnixTimestamp(this: JSValue) -> f64;
    fn JSC__JSValue__getOwnByValue(this: JSValue, global: *const JSGlobalObject, key: JSValue) -> JSValue;
    fn JSC__JSValue__put(this: JSValue, global: *const JSGlobalObject, key: *const bun_string::ZigString, value: JSValue);
    fn JSC__JSValue__putIndex(this: JSValue, global: *const JSGlobalObject, i: u32, value: JSValue);
    fn JSC__JSValue__putToPropertyKey(target: JSValue, global: *const JSGlobalObject, key: JSValue, value: JSValue);
    fn JSC__JSValue__toStringOrNull(this: JSValue, global: *const JSGlobalObject) -> *mut JSString;
    fn JSC__JSValue__asString(this: JSValue) -> *mut JSString;
    fn JSC__JSValue__asArrayBuffer(this: JSValue, global: *const JSGlobalObject, out: *mut ArrayBuffer) -> bool;
    fn JSC__JSValue__asPromise(this: JSValue) -> *mut JSPromise;
    fn JSC__JSValue__asInternalPromise(this: JSValue) -> *mut JSInternalPromise;
    fn JSC__JSValue__isAnyError(this: JSValue) -> bool;
    fn JSC__JSValue__getClassInfoName(this: JSValue, out: *mut *const u8, len: *mut usize) -> bool;
    fn JSC__JSValue__getLengthIfPropertyExistsInternal(this: JSValue, global: *const JSGlobalObject) -> f64;
    fn JSC__JSValue__parseJSON(string: *const bun_string::ZigString, global: *const JSGlobalObject) -> JSValue;
    fn JSC__JSValue__toZigString(this: JSValue, out: *mut bun_string::ZigString, global: *const JSGlobalObject);
    fn JSC__JSValue__getIfPropertyExistsImpl(target: JSValue, global: *const JSGlobalObject, ptr: *const u8, len: usize) -> JSValue;
    fn JSC__JSValue__isTerminationException(this: JSValue) -> bool;
    fn Bun__JSValue__call(
        global: *const JSGlobalObject,
        function: JSValue,
        this_value: JSValue,
        args_len: usize,
        args_ptr: *const JSValue,
    ) -> JSValue;
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

// Host functions are the native function pointer type that can be used by a
// JSC::JSFunction to call native code from JavaScript.
pub mod host_fn {
    use super::{JSGlobalObject, JSValue, JsError, JsResult};

    /// Call an FFI function that returns a `JSValue`, then check the VM for a
    /// pending exception. Mirrors Zig `bun.jsc.fromJSHostCall(global, @src(), fn, .{args})`;
    /// the Rust port collapses `(fn, args)` into a closure.
    #[inline]
    #[track_caller]
    pub fn from_js_host_call(
        global: &JSGlobalObject,
        f: impl FnOnce() -> JSValue,
    ) -> JsResult<JSValue> {
        let v = f();
        if global.has_exception() { return Err(JsError::Thrown); }
        // Zig: asserts a non-empty return when no exception is pending.
        debug_assert!(!v.is_empty(), "fromJSHostCall: empty JSValue with no pending exception");
        Ok(v)
    }

    /// Generic variant for FFI functions whose return type carries no exception
    /// signal (e.g. `void`, `bool`, `f64`). See host_fn.zig:179.
    #[inline]
    #[track_caller]
    pub fn from_js_host_call_generic<R>(
        global: &JSGlobalObject,
        f: impl FnOnce() -> R,
    ) -> JsResult<R> {
        let r = f();
        if global.has_exception() { Err(JsError::Thrown) } else { Ok(r) }
    }

    /// `host_fn::toJSHostCall` — convert a `JsResult<JSValue>` returned from a
    /// Rust host function back into the JSC ABI: on `Err`, a pending exception
    /// is set (or already set) and `.zero` is returned. Mirrors host_fn.zig:92.
    #[inline]
    pub fn to_js_host_call(global: &JSGlobalObject, r: JsResult<JSValue>) -> JSValue {
        match r {
            Ok(v) => v,
            Err(JsError::OutOfMemory) => {
                global.throw_out_of_memory_value();
                JSValue::ZERO
            }
            Err(_) => {
                debug_assert!(global.has_exception(), "toJSHostCall: JsError without pending exception");
                JSValue::ZERO
            }
        }
    }
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

// ──────────────────────────────────────────────────────────────────────────
// `__macro_support` — runtime helpers invoked by `#[bun_jsc::host_fn]` /
// `#[bun_jsc::JsClass]` expansions. Not part of the public API; the names are
// load-bearing for the proc-macro crate only.
// ──────────────────────────────────────────────────────────────────────────
#[doc(hidden)]
pub mod __macro_support {
    use super::{JSGlobalObject, JSValue, JsError, JsResult};

    /// Map a `JsResult<JSValue>` from a Rust host fn to the raw `JSValue` the
    /// JSC ABI expects (`.ZERO` when an exception is/was thrown). Mirrors
    /// `host_fn.zig:toJSHostFnResult`.
    #[inline]
    pub fn host_fn_result(global: &JSGlobalObject, r: JsResult<JSValue>) -> JSValue {
        super::host_fn::to_js_host_call(global, r)
    }

    /// Setter result mapping: `JsResult<bool>` → `bool` (false on throw).
    /// Matches generate-classes.ts setter ABI:
    /// `extern bool ${T}Prototype__${name}(void*, JSGlobalObject*, EncodedJSValue)`.
    #[inline]
    pub fn host_fn_setter_result(global: &JSGlobalObject, r: JsResult<bool>) -> bool {
        match r {
            Ok(b) => b,
            Err(JsError::OutOfMemory) => {
                global.throw_out_of_memory_value();
                false
            }
            Err(_) => {
                debug_assert!(
                    global.has_exception(),
                    "host_fn(setter): JsError without pending exception"
                );
                false
            }
        }
    }

    /// Construct result mapping: `JsResult<*mut T>` → `*mut c_void` (null on
    /// throw). Matches generate-classes.ts:
    /// `extern void* ${T}Class__construct(JSGlobalObject*, CallFrame*)`.
    #[inline]
    pub fn host_fn_construct_result<T>(
        global: &JSGlobalObject,
        r: JsResult<*mut T>,
    ) -> *mut ::core::ffi::c_void {
        match r {
            Ok(p) => p.cast(),
            Err(JsError::OutOfMemory) => {
                global.throw_out_of_memory_value();
                ::core::ptr::null_mut()
            }
            Err(_) => {
                debug_assert!(
                    global.has_exception(),
                    "JsClass construct: JsError without pending exception"
                );
                ::core::ptr::null_mut()
            }
        }
    }
}

// Compile-time smoke test for the proc-macros (no runtime body — just asserts
// the expansions type-check against the real `JSGlobalObject`/`CallFrame`/
// `JSValue`/`JsResult` shapes and that the `JsClass` trait impl wires up).
#[cfg(test)]
mod __macro_smoke {
    use super::{CallFrame, JSGlobalObject, JSValue, JsResult};

    #[crate::host_fn(export = "SmokeFree__call")]
    fn smoke_free(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    #[crate::JsClass(no_construct)]
    pub struct Smoke {
        #[allow(dead_code)]
        n: u32,
    }
    impl Smoke {
        // Required by the `construct` hook when `no_construct` is omitted; kept
        // here so a future flip exercises it.
        #[allow(dead_code)]
        pub fn constructor(
            _g: &JSGlobalObject,
            _f: &CallFrame,
        ) -> JsResult<*mut Smoke> {
            Err(super::JsError::Thrown)
        }
        #[crate::host_fn(getter)]
        pub fn get_n(&self, _g: &JSGlobalObject) -> JsResult<JSValue> {
            Ok(JSValue::js_number_from_int32(self.n as i32))
        }
        #[crate::host_fn(setter)]
        pub fn set_n(&mut self, _g: &JSGlobalObject, _v: JSValue) -> JsResult<bool> {
            Ok(true)
        }
        #[crate::host_fn(method)]
        pub fn do_thing(
            &mut self,
            _g: &JSGlobalObject,
            _f: &CallFrame,
        ) -> JsResult<JSValue> {
            Ok(JSValue::UNDEFINED)
        }
    }

    // Assert the trait impl exists.
    fn _assert_js_class<T: crate::JsClass>() {}
    fn _wired() { _assert_js_class::<Smoke>(); }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSValue tag constants (from FFI.zig). Surfaced as `crate::ffi`
// so leaf modules (DecodedJSValue.rs etc.) compile without un-gating FFI.rs.
// ──────────────────────────────────────────────────────────────────────────
pub mod ffi {
    use core::ffi::c_ulonglong;
    pub const NUMBER_TAG: c_ulonglong = 0xfffe_0000_0000_0000;
    pub const OTHER_TAG: c_ulonglong = 0x2;
    pub const BOOL_TAG: c_ulonglong = 0x4;
    pub const UNDEFINED_TAG: c_ulonglong = 0x8;
    pub const NOT_CELL_MASK: c_ulonglong = NUMBER_TAG | OTHER_TAG;
    pub const DOUBLE_ENCODE_OFFSET_BIT: u32 = 49;
    pub const DOUBLE_ENCODE_OFFSET: i64 = 1i64 << DOUBLE_ENCODE_OFFSET_BIT;
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__JSValue__protect(this: JSValue);
    fn Bun__JSValue__unprotect(this: JSValue);
}

impl JSValue {
    /// Construct a JSValue from an opaque encoded bit-pattern (Zig: `@enumFromInt`).
    #[inline]
    pub const fn from_encoded(bits: usize) -> JSValue { JSValue(bits, PhantomData) }
    /// Read the raw encoded bit-pattern (Zig: `@intFromEnum`).
    #[inline]
    pub const fn encoded(self) -> usize { self.0 }

    /// Wrap a JSCell pointer as a JSValue (cell-tagged JSValues *are* the pointer
    /// — `NotCellMask` bits are zero). Mirrors `JSValue.fromCell`.
    #[inline]
    pub fn from_cell<T>(cell: *const T) -> JSValue {
        debug_assert!(!cell.is_null());
        JSValue(cell as usize, PhantomData)
    }

    /// Protects a JSValue from garbage collection (refcounted). The is_cell
    /// check happens on the C++ side (bindings.cpp).
    #[inline]
    pub fn protect(self) {
        // SAFETY: pure FFI; C++ side handles non-cell values.
        unsafe { Bun__JSValue__protect(self) }
    }
    /// Inverse of `protect`.
    #[inline]
    pub fn unprotect(self) {
        // SAFETY: pure FFI; C++ side handles non-cell values.
        unsafe { Bun__JSValue__unprotect(self) }
    }

    /// `JSValue.isTerminationException()` (JSValue.zig:1182) — true if this
    /// value is the VM's termination-exception sentinel.
    #[inline]
    pub fn is_termination_exception(self) -> bool {
        // SAFETY: pure FFI predicate.
        unsafe { JSC__JSValue__isTerminationException(self) }
    }

    /// `JSValue.call(global, thisValue, args)` (JSValue.zig:249).
    /// Calls `function` with `this_value` as the receiver. Returns
    /// `Err(JsError::Thrown)` if a JS exception was raised.
    #[track_caller]
    pub fn call(
        self,
        global: &JSGlobalObject,
        this_value: JSValue,
        args: &[JSValue],
    ) -> JsResult<JSValue> {
        // PORT NOTE: debug-only event-loop bookkeeping (JSValue.zig:251-258) is
        // omitted while VirtualMachine.rs is gated; restore when it un-gates.
        host_fn::from_js_host_call(global, || {
            // SAFETY: `global` is live; `args` is a contiguous slice of valid
            // JSValues for the duration of the call.
            unsafe {
                Bun__JSValue__call(global, self, this_value, args.len(), args.as_ptr())
            }
        })
    }
}

// JSC Classes Bindings — opaque stubs (B-2: trimmed as real modules un-gate)
stub_ty!(
    CachedBytecode,
    DOMFormData, DeferredError,
    JSGlobalObject,
    URL, VM,
    ZigStackTrace, ZigStackFrame,
    ZigException,
    AbortSignal, JSBundler,
);

// ──────────────────────────────────────────────────────────────────────────
// ResolvedSource — un-gated (B-2). `#[repr(C)]` mirror of the C struct in
// src/jsc/bindings/headers-handwritten.h:115. Passed by value across the
// Zig/Rust → C++ module-loader boundary (`ErrorableResolvedSource`).
// ──────────────────────────────────────────────────────────────────────────
#[path = "ResolvedSource.rs"] pub mod resolved_source;
pub use self::resolved_source::ResolvedSource;

/// `ResolvedSource.Tag` — `enum(u32)` in Zig, plain `uint32_t` in C++
/// (`headers-handwritten.h:123`). Modelled as a transparent `u32` newtype so
/// the generated InternalModuleRegistry IDs (`(1 << 9) | id`, see
/// `build/*/codegen/ResolvedSourceTag.zig`) round-trip without an exhaustive
/// Rust enum.
pub mod resolved_source_tag {
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
    pub struct ResolvedSourceTag(pub u32);

    #[allow(non_upper_case_globals)]
    impl ResolvedSourceTag {
        // Structural variants — keep in lock-step with
        // `build/*/codegen/ResolvedSourceTag.zig` lines 3-16 and
        // `src/jsc/bindings/headers-handwritten.h` (`ResolvedSourceTagPackageJSONTypeModule = 1`).
        pub const Javascript: Self = Self(0);
        pub const PackageJsonTypeModule: Self = Self(1);
        pub const PackageJsonTypeCommonjs: Self = Self(2);
        pub const Wasm: Self = Self(3);
        pub const Object: Self = Self(4);
        pub const File: Self = Self(5);
        pub const Esm: Self = Self(6);
        pub const JsonForObjectLoader: Self = Self(7);
        /// Generate an object with `default` set to all the exports, including a `default` property.
        pub const ExportsObject: Self = Self(8);
        /// Generate a module that only exports `default` = the input JSValue.
        pub const ExportDefaultObject: Self = Self(9);
        /// Signal upwards that the matching value in `require.extensions` should be used.
        pub const CommonJsCustomExtension: Self = Self(10);

        /// Map a canonical builtin-module specifier (e.g. `b"node:fs"`) to its
        /// InternalModuleRegistry tag (`(1 << 9) | id`). Ports Zig's
        /// `@field(ResolvedSource.Tag, @tagName(hardcoded))` (ModuleLoader.zig).
        ///
        /// Unrecognised names debug-panic / release-fall-back to `Javascript`;
        /// callers feed only `HardcodedModule` strum values, so a miss means
        /// the generated table below has drifted from codegen.
        pub fn from_name(name: &[u8]) -> Self {
            if let Some(&tag) = INTERNAL_MODULE_TAG.get(name) {
                return tag;
            }
            debug_assert!(
                false,
                "ResolvedSourceTag::from_name: unknown builtin specifier {:?}",
                bstr::BStr::new(name),
            );
            Self::Javascript
        }
    }

    impl Default for ResolvedSourceTag {
        #[inline]
        fn default() -> Self { Self::Javascript }
    }

    /// Generated from `build/*/codegen/ResolvedSourceTag.zig` — the
    /// `(1 << 9) | id` half of the enum. Keys are the canonical specifier
    /// strings as surfaced by `HardcodedModule`'s `strum::IntoStaticStr` impl
    /// (which is what `jsc_hooks::js_synthetic_module` feeds in).
    // PORT NOTE: `@vercel/fetch` is aliased — Zig's `HardcodedModule` tag-name
    // is `vercel_fetch` but the Rust strum serialisation is the npm specifier.
    static INTERNAL_MODULE_TAG: phf::Map<&'static [u8], ResolvedSourceTag> = phf::phf_map! {
        b"bun:ffi" => ResolvedSourceTag(512),
        b"bun:sql" => ResolvedSourceTag(513),
        b"bun:sqlite" => ResolvedSourceTag(514),
        b"internal:abort_listener" => ResolvedSourceTag(515),
        b"internal:assert/assertion_error" => ResolvedSourceTag(516),
        b"internal:assert/calltracker" => ResolvedSourceTag(517),
        b"internal:assert/myers_diff" => ResolvedSourceTag(518),
        b"internal:assert/utils" => ResolvedSourceTag(519),
        b"internal:buffer" => ResolvedSourceTag(520),
        b"internal:cluster/RoundRobinHandle" => ResolvedSourceTag(521),
        b"internal:cluster/Worker" => ResolvedSourceTag(522),
        b"internal:cluster/child" => ResolvedSourceTag(523),
        b"internal:cluster/isPrimary" => ResolvedSourceTag(524),
        b"internal:cluster/primary" => ResolvedSourceTag(525),
        b"internal:crypto/x509" => ResolvedSourceTag(526),
        b"internal:debugger" => ResolvedSourceTag(527),
        b"internal:errors" => ResolvedSourceTag(528),
        b"internal:fifo" => ResolvedSourceTag(529),
        b"internal:fixed_queue" => ResolvedSourceTag(530),
        b"internal:freelist" => ResolvedSourceTag(531),
        b"internal:fs/cp-sync" => ResolvedSourceTag(532),
        b"internal:fs/cp" => ResolvedSourceTag(533),
        b"internal:fs/glob" => ResolvedSourceTag(534),
        b"internal:fs/streams" => ResolvedSourceTag(535),
        b"internal:html" => ResolvedSourceTag(536),
        b"internal:http" => ResolvedSourceTag(537),
        b"internal:http/FakeSocket" => ResolvedSourceTag(538),
        b"internal:linkedlist" => ResolvedSourceTag(539),
        b"internal:net/isIP" => ResolvedSourceTag(540),
        b"internal:perf_hooks/monitorEventLoopDelay" => ResolvedSourceTag(541),
        b"internal:primordials" => ResolvedSourceTag(542),
        b"internal:promisify" => ResolvedSourceTag(543),
        b"internal:shared" => ResolvedSourceTag(544),
        b"internal:sql/errors" => ResolvedSourceTag(545),
        b"internal:sql/mysql" => ResolvedSourceTag(546),
        b"internal:sql/postgres" => ResolvedSourceTag(547),
        b"internal:sql/query" => ResolvedSourceTag(548),
        b"internal:sql/shared" => ResolvedSourceTag(549),
        b"internal:sql/sqlite" => ResolvedSourceTag(550),
        b"internal:stream/promises" => ResolvedSourceTag(551),
        b"internal:stream" => ResolvedSourceTag(552),
        b"internal:streams/add-abort-signal" => ResolvedSourceTag(553),
        b"internal:streams/compose" => ResolvedSourceTag(554),
        b"internal:streams/destroy" => ResolvedSourceTag(555),
        b"internal:streams/duplex" => ResolvedSourceTag(556),
        b"internal:streams/duplexify" => ResolvedSourceTag(557),
        b"internal:streams/duplexpair" => ResolvedSourceTag(558),
        b"internal:streams/end-of-stream" => ResolvedSourceTag(559),
        b"internal:streams/from" => ResolvedSourceTag(560),
        b"internal:streams/lazy_transform" => ResolvedSourceTag(561),
        b"internal:streams/legacy" => ResolvedSourceTag(562),
        b"internal:streams/native-readable" => ResolvedSourceTag(563),
        b"internal:streams/operators" => ResolvedSourceTag(564),
        b"internal:streams/passthrough" => ResolvedSourceTag(565),
        b"internal:streams/pipeline" => ResolvedSourceTag(566),
        b"internal:streams/readable" => ResolvedSourceTag(567),
        b"internal:streams/state" => ResolvedSourceTag(568),
        b"internal:streams/transform" => ResolvedSourceTag(569),
        b"internal:streams/utils" => ResolvedSourceTag(570),
        b"internal:streams/writable" => ResolvedSourceTag(571),
        b"internal:timers" => ResolvedSourceTag(572),
        b"internal:tls" => ResolvedSourceTag(573),
        b"internal:tty" => ResolvedSourceTag(574),
        b"internal:url" => ResolvedSourceTag(575),
        b"internal:util/colors" => ResolvedSourceTag(576),
        b"internal:util/deprecate" => ResolvedSourceTag(577),
        b"internal:util/inspect" => ResolvedSourceTag(578),
        b"internal:util/mime" => ResolvedSourceTag(579),
        b"internal:validators" => ResolvedSourceTag(580),
        b"internal:webstreams_adapters" => ResolvedSourceTag(581),
        b"node:_http2_upgrade" => ResolvedSourceTag(582),
        b"node:_http_agent" => ResolvedSourceTag(583),
        b"node:_http_client" => ResolvedSourceTag(584),
        b"node:_http_common" => ResolvedSourceTag(585),
        b"node:_http_incoming" => ResolvedSourceTag(586),
        b"node:_http_outgoing" => ResolvedSourceTag(587),
        b"node:_http_server" => ResolvedSourceTag(588),
        b"node:_stream_duplex" => ResolvedSourceTag(589),
        b"node:_stream_passthrough" => ResolvedSourceTag(590),
        b"node:_stream_readable" => ResolvedSourceTag(591),
        b"node:_stream_transform" => ResolvedSourceTag(592),
        b"node:_stream_wrap" => ResolvedSourceTag(593),
        b"node:_stream_writable" => ResolvedSourceTag(594),
        b"node:_tls_common" => ResolvedSourceTag(595),
        b"node:assert/strict" => ResolvedSourceTag(596),
        b"node:assert" => ResolvedSourceTag(597),
        b"node:async_hooks" => ResolvedSourceTag(598),
        b"node:child_process" => ResolvedSourceTag(599),
        b"node:cluster" => ResolvedSourceTag(600),
        b"node:console" => ResolvedSourceTag(601),
        b"node:crypto" => ResolvedSourceTag(602),
        b"node:dgram" => ResolvedSourceTag(603),
        b"node:diagnostics_channel" => ResolvedSourceTag(604),
        b"node:dns/promises" => ResolvedSourceTag(605),
        b"node:dns" => ResolvedSourceTag(606),
        b"node:domain" => ResolvedSourceTag(607),
        b"node:events" => ResolvedSourceTag(608),
        b"node:fs/promises" => ResolvedSourceTag(609),
        b"node:fs" => ResolvedSourceTag(610),
        b"node:http" => ResolvedSourceTag(611),
        b"node:http2" => ResolvedSourceTag(612),
        b"node:https" => ResolvedSourceTag(613),
        b"node:inspector/promises" => ResolvedSourceTag(614),
        b"node:inspector" => ResolvedSourceTag(615),
        b"node:net" => ResolvedSourceTag(616),
        b"node:os" => ResolvedSourceTag(617),
        b"node:path/posix" => ResolvedSourceTag(618),
        b"node:path" => ResolvedSourceTag(619),
        b"node:path/win32" => ResolvedSourceTag(620),
        b"node:perf_hooks" => ResolvedSourceTag(621),
        b"node:punycode" => ResolvedSourceTag(622),
        b"node:querystring" => ResolvedSourceTag(623),
        b"node:readline/promises" => ResolvedSourceTag(624),
        b"node:readline" => ResolvedSourceTag(625),
        b"node:repl" => ResolvedSourceTag(626),
        b"node:stream/consumers" => ResolvedSourceTag(627),
        b"node:stream/promises" => ResolvedSourceTag(628),
        b"node:stream" => ResolvedSourceTag(629),
        b"node:stream/web" => ResolvedSourceTag(630),
        b"node:test" => ResolvedSourceTag(631),
        b"node:timers/promises" => ResolvedSourceTag(632),
        b"node:timers" => ResolvedSourceTag(633),
        b"node:tls" => ResolvedSourceTag(634),
        b"node:trace_events" => ResolvedSourceTag(635),
        b"node:tty" => ResolvedSourceTag(636),
        b"node:url" => ResolvedSourceTag(637),
        b"node:util" => ResolvedSourceTag(638),
        b"node:v8" => ResolvedSourceTag(639),
        b"node:vm" => ResolvedSourceTag(640),
        b"node:wasi" => ResolvedSourceTag(641),
        b"node:worker_threads" => ResolvedSourceTag(642),
        b"node:zlib" => ResolvedSourceTag(643),
        b"isomorphic-fetch" => ResolvedSourceTag(644),
        b"node-fetch" => ResolvedSourceTag(645),
        b"undici" => ResolvedSourceTag(646),
        b"vercel_fetch" => ResolvedSourceTag(647),
        b"@vercel/fetch" => ResolvedSourceTag(647),
        b"ws" => ResolvedSourceTag(648),
        b"bun:internal-for-testing" => ResolvedSourceTag(649),
        // Native modules come after the JS modules.
        b"bun:test" => ResolvedSourceTag(650),
        b"bun:jsc" => ResolvedSourceTag(651),
        b"bun:app" => ResolvedSourceTag(652),
        b"node:buffer" => ResolvedSourceTag(653),
        b"node:constants" => ResolvedSourceTag(654),
        b"node:string_decoder" => ResolvedSourceTag(655),
        b"node:util/types" => ResolvedSourceTag(656),
        b"utf-8-validate" => ResolvedSourceTag(657),
        b"abort-controller" => ResolvedSourceTag(658),
        b"node:module" => ResolvedSourceTag(659),
        b"node:process" => ResolvedSourceTag(660),
        b"bun" => ResolvedSourceTag(661),
    };
}
pub use self::resolved_source_tag::ResolvedSourceTag;

// ──────────────────────────────────────────────────────────────────────────
// FetchHeaders — un-gated (B-2). Opaque C++ `WebCore::FetchHeaders` handle
// plus the `HTTPHeaderName` enum used by `fast_get`/`fast_has`/`put`.
// ──────────────────────────────────────────────────────────────────────────
#[path = "FetchHeaders.rs"] pub mod fetch_headers;
pub use self::fetch_headers::{FetchHeaders, HTTPHeaderName};

/// `BuiltinName` — fast-path property keys preallocated as `JSC::Identifier`s
/// in C++ (`BunBuiltinNames.h`). Passed to `JSValue::fast_get` as a `u8` index
/// into `BuiltinNamesMap` (src/jsc/bindings/bindings.cpp).
///
/// The Zig source (JSValue.zig:1491) uses lowercase variant names; downstream
/// Rust callers were drafted with PascalCase. Associated-const aliases below
/// keep both spellings working until the call sites converge.
#[repr(u8)]
#[allow(non_camel_case_types)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BuiltinName {
    method,
    headers,
    status,
    statusText,
    url,
    body,
    data,
    toString,
    redirect,
    inspectCustom,
    highWaterMark,
    path,
    stream,
    asyncIterator,
    name,
    message,
    error,
    default,
    encoding,
    fatal,
    ignoreBOM,
    type_,
    signal,
    cmd,
}

#[allow(non_upper_case_globals)]
impl BuiltinName {
    // PascalCase aliases for downstream Phase-A drafts (Response.rs / Request.rs
    // / streams.rs / fetch.rs / TextDecoder.rs / pretty_format.rs use these).
    pub const Method: Self = Self::method;
    pub const Headers: Self = Self::headers;
    pub const Status: Self = Self::status;
    pub const StatusText: Self = Self::statusText;
    pub const Url: Self = Self::url;
    pub const Body: Self = Self::body;
    pub const Data: Self = Self::data;
    pub const InspectCustom: Self = Self::inspectCustom;
    pub const HighWaterMark: Self = Self::highWaterMark;
    pub const Path: Self = Self::path;
    pub const Stream: Self = Self::stream;
    pub const Message: Self = Self::message;
    pub const Error: Self = Self::error;
    pub const Encoding: Self = Self::encoding;
    pub const Type: Self = Self::type_;
    pub const Signal: Self = Self::signal;

    pub fn has(property: &[u8]) -> bool { Self::get(property).is_some() }
    pub fn get(property: &[u8]) -> Option<BuiltinName> {
        BUILTIN_NAME_MAP.get(property).copied()
    }
}

static BUILTIN_NAME_MAP: phf::Map<&'static [u8], BuiltinName> = phf::phf_map! {
    b"method" => BuiltinName::method,
    b"headers" => BuiltinName::headers,
    b"status" => BuiltinName::status,
    b"statusText" => BuiltinName::statusText,
    b"url" => BuiltinName::url,
    b"body" => BuiltinName::body,
    b"data" => BuiltinName::data,
    b"toString" => BuiltinName::toString,
    b"redirect" => BuiltinName::redirect,
    b"inspectCustom" => BuiltinName::inspectCustom,
    b"highWaterMark" => BuiltinName::highWaterMark,
    b"path" => BuiltinName::path,
    b"stream" => BuiltinName::stream,
    b"asyncIterator" => BuiltinName::asyncIterator,
    b"name" => BuiltinName::name,
    b"message" => BuiltinName::message,
    b"error" => BuiltinName::error,
    b"default" => BuiltinName::default,
    b"encoding" => BuiltinName::encoding,
    b"fatal" => BuiltinName::fatal,
    b"ignoreBOM" => BuiltinName::ignoreBOM,
    b"type" => BuiltinName::type_,
    b"signal" => BuiltinName::signal,
    b"cmd" => BuiltinName::cmd,
};

/// `jsc.BinaryType` — how raw bytes surface to JS (`Buffer` | `Uint8Array` |
/// `ArrayBuffer`). Mirrors `src/jsc/BinaryType.zig`.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BinaryType {
    #[default]
    Buffer,
    Uint8Array,
    ArrayBuffer,
}

/// RAII guard that keeps a `JSValue` reachable across an FFI call by emitting
/// a use of the value at scope exit. Mirrors `JSC::EnsureStillAliveScope`.
#[repr(transparent)]
pub struct EnsureStillAlive(pub JSValue);
impl Drop for EnsureStillAlive {
    #[inline]
    fn drop(&mut self) { self.0.ensure_still_alive(); }
}

/// `jsc.JSPromise.Strong` — a `Strong.Optional` typed to hold a `JSPromise`.
pub use self::js_promise::Strong as JSPromiseStrong;

/// Legacy alias used by runtime drafts: `VirtualMachineRef` is just the
/// `VirtualMachine` struct itself (callers hold `*mut VirtualMachineRef`).
pub use self::virtual_machine::VirtualMachine as VirtualMachineRef;

/// `jsc.AnyPromise` — `JSPromise | JSInternalPromise` (AnyPromise.zig).
#[derive(Debug, Clone, Copy)]
pub enum AnyPromise {
    Normal(*mut JSPromise),
    Internal(*mut JSInternalPromise),
}
impl AnyPromise {
    #[inline] pub fn as_value(self) -> JSValue {
        match self {
            Self::Normal(p) => JSValue::from_cell(p),
            Self::Internal(p) => JSValue::from_cell(p),
        }
    }
}

/// `JSPromise.UnwrapMode` (JSPromise.zig:349).
pub use self::js_promise::UnwrapMode as PromiseUnwrapMode;

/// `JSPromise.Unwrapped` (JSPromise.zig:343) — surfaced at the crate root as
/// `PromiseResult` for downstream callers (Macro.rs / JSBundler.rs reference it
/// via `jsc::PromiseResult::{Pending,Fulfilled,Rejected}`).
pub use self::js_promise::Unwrapped as PromiseResult;

/// `JSPropertyIteratorOptions` — comptime config struct in Zig; here a value type
/// downstream can use as a const-generic carrier or runtime flag set.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JSPropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
    pub own_properties_only: bool,
    pub observable: bool,
    pub only_non_index_properties: bool,
}

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
    fn JSGlobalObject__createOutOfMemoryError(this: *const JSGlobalObject) -> JSValue;
    fn JSGlobalObject__tryTakeException(this: *const JSGlobalObject) -> JSValue;
    fn JSC__JSGlobalObject__queueMicrotaskCallback(
        this: *const JSGlobalObject,
        ctx: *mut c_void,
        function: unsafe extern "C" fn(*mut c_void),
    );
    fn Bun__msToGregorianDateTime(
        this: *const JSGlobalObject,
        ms: f64,
        input_is_utc: bool,
        year: *mut i32,
        month: *mut i32,
        day: *mut i32,
        hour: *mut i32,
        minute: *mut i32,
        second: *mut i32,
        weekday: *mut i32,
    );
    fn ZigString__toErrorInstance(this: *const bun_string::ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toTypeErrorInstance(this: *const bun_string::ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toSyntaxErrorInstance(this: *const bun_string::ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toRangeErrorInstance(this: *const bun_string::ZigString, global: *const JSGlobalObject) -> JSValue;
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
    pub fn bun_vm(&self) -> *mut virtual_machine::VirtualMachine {
        // Spec (JSGlobalObject.zig:620) returns `*jsc.VirtualMachine` (raw
        // pointer). Returning `&mut` from `&self` would permit two callers to
        // hold aliased `&mut VirtualMachine` simultaneously — UB per
        // PORTING.md §Forbidden.
        // SAFETY: `bunVM()` never returns null for a Bun-owned global.
        unsafe { JSC__JSGlobalObject__bunVM(self) }
    }
    #[inline]
    pub fn has_exception(&self) -> bool {
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSGlobalObject__hasException(self) }
    }

    pub fn create_out_of_memory_error(&self) -> JSValue {
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSGlobalObject__createOutOfMemoryError(self) }
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
    /// `createErrorInstance(fmt, args)` — formats `args` into a UTF-8 buffer, wraps
    /// it as a ZigString, and calls `ZigString__toErrorInstance`.
    pub fn create_error_instance(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let buf = alloc::fmt::format(args);
        let zs = bun_string::ZigString::init_utf8(buf.as_bytes());
        // SAFETY: `self` is live; `zs` borrowed for the call (C++ clones).
        unsafe { ZigString__toErrorInstance(&zs, self) }
    }
    pub fn create_type_error_instance(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let buf = alloc::fmt::format(args);
        let zs = bun_string::ZigString::init_utf8(buf.as_bytes());
        // SAFETY: `self` is live; `zs` borrowed for the call.
        unsafe { ZigString__toTypeErrorInstance(&zs, self) }
    }
    pub fn create_syntax_error_instance(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let buf = alloc::fmt::format(args);
        let zs = bun_string::ZigString::init_utf8(buf.as_bytes());
        // SAFETY: `self` is live; `zs` borrowed for the call.
        unsafe { ZigString__toSyntaxErrorInstance(&zs, self) }
    }
    pub fn create_range_error_instance(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        let buf = alloc::fmt::format(args);
        let zs = bun_string::ZigString::init_utf8(buf.as_bytes());
        // SAFETY: `self` is live; `zs` borrowed for the call.
        unsafe { ZigString__toRangeErrorInstance(&zs, self) }
    }
    /// `JSGlobalObject.commonStrings()` (JSGlobalObject.zig:840) — accessor for
    /// the lazily-initialized `BunCommonStrings.h` `JSString` table. The
    /// returned struct is a thin view borrowing `self`.
    #[inline]
    pub fn common_strings(&self) -> CommonStrings<'_> {
        crate::mark_binding!();
        CommonStrings { global_object: self }
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
        let err = self.create_error_instance(args);
        self.throw_value(err)
    }
    pub fn throw_error(&self, err: bun_core::Error, msg: &'static str) -> JsError {
        // TODO(b2): SystemError/JSError dispatch — for now, format both.
        self.throw(format_args!("{msg}: {err:?}"))
    }
    pub fn throw_type_error(&self, args: core::fmt::Arguments<'_>) -> JsError {
        let err = self.create_type_error_instance(args);
        self.throw_value(err)
    }
    pub fn throw_range_error<V: bun_core::fmt::OutOfRangeValue>(&self, value: V, options: RangeErrorOptions<'_>) -> JsError {
        // JSGlobalObject.zig:729 — `ERR(.OUT_OF_RANGE, "{}", bun.fmt.outOfRange(value, options)).throw()`.
        // Delegate formatting to the ported `out_of_range` formatter so min/max/msg
        // branching matches Zig.
        let buf = alloc::format!("{}", bun_core::fmt::out_of_range(value, options));
        let zs = bun_string::ZigString::init_utf8(buf.as_bytes());
        // SAFETY: `self` is live; `zs` borrowed for the call.
        let err = unsafe { ZigString__toRangeErrorInstance(&zs, self) };
        // Zig routes via `ERR(.OUT_OF_RANGE)` which tags `code: 'ERR_OUT_OF_RANGE'`.
        if let Ok(code) = bun_string_jsc::create_utf8_for_js(self, b"ERR_OUT_OF_RANGE") {
            err.put(self, b"code", code);
        }
        self.throw_value(err)
    }
    pub fn throw_todo(&self, msg: &str) -> JsError {
        // JSGlobalObject.zig:52-59 — Error with raw `msg` (no prefix), then `name = "TODOError"`.
        let err = self.create_error_instance(format_args!("{msg}"));
        if let Ok(name) = bun_string_jsc::create_utf8_for_js(self, b"TODOError") {
            err.put(self, b"name", name);
        }
        self.throw_value(err)
    }
    pub fn throw_invalid_arguments(&self, args: core::fmt::Arguments<'_>) -> JsError {
        // JSGlobalObject.zig:73 — `JSC::createInvalidThisError`-style TypeError.
        let err = self.create_type_error_instance(args);
        self.throw_value(err)
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
        // SAFETY: `self` is a live JSGlobalObject.
        let v = unsafe { JSGlobalObject__tryTakeException(self) };
        if v.is_empty() { None } else { Some(v) }
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

    /// `JSGlobalObject.queueMicrotaskCallback(ctx, comptime fn(ctx))` —
    /// enqueue a native microtask. Zig used a comptime fn param + `anyopaque`
    /// thunk; the Rust port takes an already-thunked `extern "C" fn(*mut c_void)`
    /// (callers produce one via `bun_jsc::opaque_wrap` or a hand-written shim).
    pub fn queue_microtask_callback(
        &self,
        ctx: *mut c_void,
        function: unsafe extern "C" fn(*mut c_void),
    ) {
        // SAFETY: `self` is live; `ctx`/`function` are forwarded to C++ which
        // calls `function(ctx)` from the microtask queue.
        unsafe { JSC__JSGlobalObject__queueMicrotaskCallback(self, ctx, function) }
    }

    /// `JSGlobalObject.msToGregorianDateTimeUTC(ms)` (JSGlobalObject.zig:45).
    pub fn ms_to_gregorian_date_time_utc(&self, ms: f64) -> GregorianDateTime {
        let mut dt = GregorianDateTime::default();
        // SAFETY: `self` is live; out-params are valid for the call.
        unsafe {
            Bun__msToGregorianDateTime(
                self, ms, false,
                &mut dt.year, &mut dt.month, &mut dt.day,
                &mut dt.hour, &mut dt.minute, &mut dt.second, &mut dt.weekday,
            )
        };
        dt
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

/// `JSGlobalObject.GregorianDateTime` (JSGlobalObject.zig:35).
#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
pub struct GregorianDateTime {
    pub year: i32,
    pub month: i32,
    pub day: i32,
    pub hour: i32,
    pub minute: i32,
    pub second: i32,
    pub weekday: i32,
}

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
// B-2 Track A — JSObject (un-gated; real module in JSObject.rs).
// ──────────────────────────────────────────────────────────────────────────
#[path = "JSObject.rs"] pub mod js_object;
pub use self::js_object::{JSObject, ExternColumnIdentifier, ExternColumnIdentifierValue};

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — CallFrame / ArgumentsSlice (un-gated; real module in CallFrame.rs).
// ──────────────────────────────────────────────────────────────────────────
#[path = "CallFrame.rs"] pub mod call_frame;
pub use self::call_frame::{CallFrame, ArgumentsSlice};

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
unsafe extern "C" {
    fn JSC__VM__releaseWeakRefs(vm: *mut VM);
    fn JSC__VM__collectAsync(vm: *mut VM);
    fn JSC__VM__heapSize(vm: *mut VM) -> usize;
    fn JSC__VM__runGC(vm: *mut VM, sync: bool) -> usize;
    fn JSC__JSGlobalObject__handleRejectedPromises(global: *mut JSGlobalObject);
}
impl VM {
    pub fn throw_error(&self, global: &JSGlobalObject, value: JSValue) -> JsError {
        // SAFETY: `self` and `global` are live; throws into the VM's exception scope.
        unsafe { JSC__VM__throwError(self as *const _ as *mut _, global, value) };
        JsError::Thrown
    }
    /// `VM.releaseWeakRefs()` (VM.zig:202).
    #[inline]
    pub fn release_weak_refs(&self) {
        // SAFETY: `self` is a live JSC::VM.
        unsafe { JSC__VM__releaseWeakRefs(self as *const _ as *mut _) }
    }
    /// `VM.collectAsync()` (VM.zig:90).
    #[inline]
    pub fn collect_async(&self) {
        // SAFETY: `self` is a live JSC::VM.
        unsafe { JSC__VM__collectAsync(self as *const _ as *mut _) }
    }
    /// `VM.heapSize()` (VM.zig:98).
    #[inline]
    pub fn heap_size(&self) -> usize {
        // SAFETY: `self` is a live JSC::VM.
        unsafe { JSC__VM__heapSize(self as *const _ as *mut _) }
    }
    /// `VM.runGC(sync)` (VM.zig:80-82).
    pub fn run_gc(&self, sync: bool) -> usize {
        // SAFETY: `self` is a live JSC::VM.
        unsafe { JSC__VM__runGC(self as *const _ as *mut _, sync) }
    }
}

impl JSGlobalObject {
    /// `JSGlobalObject.handleRejectedPromises()` (JSGlobalObject.zig:659) —
    /// catches and reports its own exceptions; only TerminationException escapes.
    #[inline]
    pub fn handle_rejected_promises(&self) {
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSC__JSGlobalObject__handleRejectedPromises(self.as_ptr()) }
        // Swallow any termination/exception per Zig (`catch return`).
    }
    /// `JSGlobalObject.reportActiveExceptionAsUnhandled(err)` (JSGlobalObject.zig:601)
    /// — takes the pending exception (proven by `err`) and routes it through
    /// `bunVM().uncaughtException()`.
    pub fn report_active_exception_as_unhandled(&self, err: JsError) {
        let exception = self.take_exception(err);
        if !exception.is_termination_exception() {
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global; we
            // hold the only `&mut` to it for the duration of this call.
            let _ = unsafe { (*self.bun_vm()).uncaught_exception(self, exception, false) };
        }
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
    fn URL__getHrefFromJS(value: JSValue, global: *mut JSGlobalObject) -> bun_string::String;
}
impl URL {
    pub fn path_from_file_url(s: bun_string::String) -> bun_string::String {
        let mut input = s;
        // SAFETY: `input` is a valid bun.String passed by mutable pointer (FFI consumes it).
        unsafe { URL__pathFromFileURL(&mut input) }
    }
    pub fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        // SAFETY: `global` is live; FFI may set an exception.
        host_fn::from_js_host_call_generic(global, || unsafe {
            URL__getHrefFromJS(value, global.as_ptr())
        })
    }
}

// B-2 Track A — JSString (un-gated; real module in JSString.rs).
#[path = "JSString.rs"] pub mod js_string;
pub use self::js_string::JSString;

pub mod ref_string {}
pub use self::ref_string as RefString;

#[path = "Debugger.rs"] pub mod debugger;
pub use self::debugger as Debugger;
#[path = "SavedSourceMap.rs"] pub mod saved_source_map;
pub use self::saved_source_map as SavedSourceMap;

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gated: VirtualMachine / ModuleLoader / event_loop now compile from
// their real Phase-A draft files. The stub `pub mod` blocks that lived here
// in B-1 are replaced with `#[path]` decls; downstream-compat re-exports
// (`VirtualMachine`, `ModuleLoader`, `EventLoop`, `VirtualMachineInitOptions`)
// are preserved.
// ──────────────────────────────────────────────────────────────────────────
#[path = "VirtualMachine.rs"] pub mod virtual_machine;
pub use self::virtual_machine as VirtualMachine;
pub use self::virtual_machine::InitOptions as VirtualMachineInitOptions;

#[path = "ModuleLoader.rs"] pub mod module_loader;
pub use self::module_loader as ModuleLoader;

/// `jsc.ProcessAutoKiller` — gated sibling, surfaced as opaque so
/// `VirtualMachine.rs` can re-export it.
pub mod process_auto_killer {
    crate::stub_ty!(ProcessAutoKiller);
}

pub type ErrorableResolvedSource = Errorable<ResolvedSource>;
// TODO(b1): bun_str crate does not exist (bun_string?); using local ZigString stub.
pub type ErrorableZigString = Errorable<ZigString>;
pub type ErrorableJSValue = Errorable<JSValue>;
pub type ErrorableString = Errorable<bun_string::String>;

#[path = "hot_reloader.rs"] pub mod hot_reloader;
pub use self::hot_reloader::{HotReloader, ImportWatcher, NewHotReloader, WatchReloader};

#[path = "RuntimeTranspilerCache.rs"] pub mod runtime_transpiler_cache;
pub use self::runtime_transpiler_cache::RuntimeTranspilerCache;

#[path = "RuntimeTranspilerStore.rs"] pub mod runtime_transpiler_store;
pub use self::runtime_transpiler_store::RuntimeTranspilerStore;

#[path = "web_worker.rs"] pub mod web_worker;
pub use self::web_worker::WebWorker;

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
    use super::*;

    /// Const-generic wrapper over the C++ `JSPropertyIteratorImpl`. The bool
    /// params mirror `JSPropertyIteratorOptions` (Zig comptime config).
    pub struct JSPropertyIterator<
        const SKIP_EMPTY_NAME: bool = false,
        const INCLUDE_VALUE: bool = true,
        const OWN_ONLY: bool = true,
    > {
        impl_: *mut core::ffi::c_void,
        object: *mut JSObject,
        global: *mut JSGlobalObject,
        i: usize,
        pub len: usize,
        pub value: JSValue,
    }

    unsafe extern "C" {
        fn Bun__JSPropertyIterator__create(
            global: *mut JSGlobalObject,
            object: JSValue,
            count: *mut usize,
            own_properties_only: bool,
            only_non_index_properties: bool,
        ) -> *mut core::ffi::c_void;
        fn Bun__JSPropertyIterator__getNameAndValue(
            iter: *mut core::ffi::c_void,
            global: *mut JSGlobalObject,
            object: *mut JSObject,
            name: *mut bun_string::String,
            i: usize,
        ) -> JSValue;
        fn Bun__JSPropertyIterator__getName(
            iter: *mut core::ffi::c_void,
            name: *mut bun_string::String,
            i: usize,
        );
        fn Bun__JSPropertyIterator__deinit(iter: *mut core::ffi::c_void);
    }

    impl<const SKIP_EMPTY_NAME: bool, const INCLUDE_VALUE: bool, const OWN_ONLY: bool>
        JSPropertyIterator<SKIP_EMPTY_NAME, INCLUDE_VALUE, OWN_ONLY>
    {
        pub fn init(global: &JSGlobalObject, object: JSValue) -> JsResult<Self> {
            let mut len: usize = 0;
            // SAFETY: `global` is live; `len` valid out-param.
            let impl_ = unsafe {
                Bun__JSPropertyIterator__create(global.as_ptr(), object, &mut len, OWN_ONLY, false)
            };
            if global.has_exception() { return Err(JsError::Thrown); }
            Ok(Self {
                impl_,
                object: object.get_object().unwrap_or(core::ptr::null_mut()),
                global: global.as_ptr(),
                i: 0,
                len,
                value: JSValue::ZERO,
            })
        }
        pub fn next(&mut self) -> JsResult<Option<bun_string::String>> {
            loop {
                if self.i >= self.len { return Ok(None); }
                let i = self.i;
                self.i += 1;
                let mut name = bun_string::String::DEAD;
                if INCLUDE_VALUE {
                    // SAFETY: `impl_`/`object` live for `self`'s lifetime.
                    let v = unsafe {
                        Bun__JSPropertyIterator__getNameAndValue(
                            self.impl_, self.global, self.object, &mut name, i,
                        )
                    };
                    // SAFETY: `global` was live when stored.
                    if unsafe { (*self.global).has_exception() } { return Err(JsError::Thrown); }
                    if v.is_empty() { continue; }
                    v.ensure_still_alive();
                    self.value = v;
                } else {
                    // SAFETY: `impl_` live for `self`'s lifetime.
                    unsafe { Bun__JSPropertyIterator__getName(self.impl_, &mut name, i) };
                }
                if SKIP_EMPTY_NAME && name.is_empty() { continue; }
                return Ok(Some(name));
            }
        }
        pub fn deinit(&mut self) {
            if !self.impl_.is_null() {
                // SAFETY: `impl_` was returned by `create`; deinit is idempotent-guarded.
                unsafe { Bun__JSPropertyIterator__deinit(self.impl_) };
                self.impl_ = core::ptr::null_mut();
            }
        }
    }
    impl<const A: bool, const B: bool, const S: bool> Drop for JSPropertyIterator<A, B, S> {
        fn drop(&mut self) { self.deinit(); }
    }

    pub type JSPropertyIteratorOptions = super::JSPropertyIteratorOptions;
}
pub use self::js_property_iterator::JSPropertyIterator;

#[path = "event_loop.rs"] pub mod event_loop;
pub use self::event_loop as EventLoop;
pub use self::event_loop::{
    AbstractVM, AnyEventLoop, AnyTask, AnyTaskWithExtraContext, ConcurrentCppTask,
    ConcurrentPromiseTask, ConcurrentTask, CppTask, DeferredTaskQueue, EventLoopHandle,
    EventLoopKind, EventLoopTask, EventLoopTaskPtr, GarbageCollectionController, JsTerminated,
    JsVM, ManagedTask, MiniEventLoop, MiniVM, PosixSignalHandle, PosixSignalTask, Task, WorkPool,
    WorkPoolTask, WorkTask,
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
        pub fn JSValueMakeBoolean(ctx: *mut JSGlobalObject, value: bool) -> JSValueRef;
        pub fn JSValueMakeNull(ctx: *mut JSGlobalObject) -> JSValueRef;
        pub fn JSValueToNumber(ctx: *mut JSGlobalObject, value: JSValueRef, exception: ExceptionRef) -> f64;
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
/// `jsc.webcore` — lower-case alias for [`WebCore`] plus the nested `blob`
/// namespace dependents reach for (`bun_jsc::webcore::blob::Store`).
pub mod webcore {
    pub use super::WebCore::{Blob, Request, Response};
    pub mod blob {
        /// `webcore.Blob.Store` — backing store (bytes / file / S3). Full impl
        /// lives in `bun_webcore` (forward-dep, not at this tier).
        #[repr(C)]
        #[derive(Debug)]
        pub struct Store {
            _opaque: [u8; 0],
        }
        impl Store {
            /// `Store.initFile(pathlike, mime_type, allocator)`
            /// (src/runtime/webcore/blob/Store.zig:125). Allocates a new
            /// file-backed `Store`.
            pub fn init_file(
                pathlike: crate::node::PathOrFileDescriptor,
                mime_type: Option<&bun_http::MimeType::MimeType>,
            ) -> Result<*mut Store, bun_core::AllocError> {
                let _ = (pathlike, mime_type);
                // TODO(b2): bun_webcore forward-dep — gated.
                todo!("webcore::blob::Store::init_file")
            }
        }
    }
}
pub mod blob {
    pub use super::webcore::blob::Store;
}
/// Deprecated: Use `bun_api`
#[deprecated]
pub use bun_api as API;
pub mod api {
    // `bun_api::BuildArtifact` is defined in bun_runtime (not at this tier).
    // Surface an opaque placeholder so dependents type-check.
    crate::stub_ty!(BuildArtifact);

    /// `bun.api.NewSocket(comptime ssl)` — type-generator for the JS `Socket`
    /// wrapper (src/runtime/socket/socket.zig:39). Real impl lives in
    /// `bun_runtime` (forward-dep). Surfaced as a const-generic opaque so
    /// dependents like `uws_dispatch.rs` can name `NewSocket<true>` /
    /// `NewSocket<false>`.
    #[repr(C)]
    pub struct NewSocket<const SSL: bool> {
        _opaque: [u8; 0],
        _m: core::marker::PhantomData<*mut u8>,
    }
}
/// Deprecated: Use `bun_api::node`
// TODO(b1): bun_api::node missing from stub surface
#[cfg(any())]
#[deprecated]
pub use bun_api::node as Node;
#[allow(non_snake_case)]
pub mod Node {
    // `node.PathLike` / `node.PathOrFileDescriptor` / `node.BlobOrStringOrBuffer`
    // are defined in bun_runtime (forward-dep on bun_jsc). Surface opaque
    // placeholders so this crate's dependents (which import them via
    // `bun_jsc::Node::*`) type-check.
    crate::stub_ty!(PathLike, PathOrFileDescriptor, BlobOrStringOrBuffer);
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
        fn BunString__toJS(this: *const bun_string::String, global: *mut JSGlobalObject) -> JSValue;
        fn BunString__transferToJS(this: *mut bun_string::String, global: *mut JSGlobalObject) -> JSValue;
        fn BunString__toJSON(this: *mut bun_string::String, global: *mut JSGlobalObject) -> JSValue;
        fn BunString__toErrorInstance(this: *const bun_string::String, global: *mut JSGlobalObject) -> JSValue;
        fn BunString__toTypeErrorInstance(this: *const bun_string::String, global: *mut JSGlobalObject) -> JSValue;
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
    pub fn to_js(this: &bun_string::String, global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `this` borrowed; `global` is live.
        host_fn::from_js_host_call(global, || unsafe { BunString__toJS(this, global.as_ptr()) })
    }
    /// Transfers ownership of `this` to JS (decrements ref on the Rust side).
    pub fn transfer_to_js(this: &mut bun_string::String, global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `this` is live; FFI consumes the ref.
        host_fn::from_js_host_call(global, || unsafe { BunString__transferToJS(this, global.as_ptr()) })
    }
    pub fn to_js_by_parse_json(this: &mut bun_string::String, global: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: `this` borrowed mutably for the call; `global` is live.
        host_fn::from_js_host_call(global, || unsafe { BunString__toJSON(this, global.as_ptr()) })
    }
    pub fn to_error_instance(this: &bun_string::String, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `this` borrowed; `global` is live.
        unsafe { BunString__toErrorInstance(this, global.as_ptr()) }
    }
    pub fn to_type_error_instance(this: &bun_string::String, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `this` borrowed; `global` is live.
        unsafe { BunString__toTypeErrorInstance(this, global.as_ptr()) }
    }
}

/// Extension trait providing JSC-aware methods on `bun_string::String`.
/// Mirrors the `pub usingnamespace` in bun_string_jsc.zig.
pub trait StringJsc {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String>;
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn transfer_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_js_by_parse_json(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue;
}
impl StringJsc for bun_string::String {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_string::String> {
        bun_string_jsc::from_js(value, global)
    }
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::to_js(self, global)
    }
    fn transfer_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::transfer_to_js(self, global)
    }
    fn to_js_by_parse_json(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::to_js_by_parse_json(self, global)
    }
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        bun_string_jsc::to_error_instance(self, global)
    }
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        bun_string_jsc::to_type_error_instance(self, global)
    }
}

/// Extension trait providing JSC-aware methods on `bun_sys::Error` (`bun.sys.Error`).
/// Mirrors `Error.toJS` / `Error.throw` in src/sys/Error.zig.
pub trait SysErrorJsc {
    fn to_system_error(&self) -> SystemError;
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    fn throw(&self, global: &JSGlobalObject) -> JsError;
}
impl SysErrorJsc for bun_sys::Error {
    fn to_system_error(&self) -> SystemError {
        // TODO(b2): full field mapping (path/syscall/dest) — see src/sys/Error.zig.
        SystemError {
            errno: self.errno as core::ffi::c_int,
            code: bun_string::String::EMPTY,
            message: bun_string::String::EMPTY,
            path: bun_string::String::EMPTY,
            syscall: bun_string::String::EMPTY,
            hostname: bun_string::String::EMPTY,
            fd: -1,
            dest: bun_string::String::EMPTY,
        }
    }
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        // UFCS: bun_sys::Error has its own inherent `to_system_error()`
        // returning `bun_sys::SystemError` (different type); we want the trait
        // method that returns the jsc-layout `SystemError` defined above.
        <Self as SysErrorJsc>::to_system_error(self).to_error_instance(global)
    }
    fn throw(&self, global: &JSGlobalObject) -> JsError {
        global.throw_value(<Self as SysErrorJsc>::to_js(self, global))
    }
}

/// Extension trait providing JSC-aware methods on `bun_logger::Log`.
/// Mirrors `Log.toJS` / `Log.toJSArray` in src/logger.zig.
pub trait LogJsc {
    fn to_js(&self, global: &JSGlobalObject, message: &str) -> JsResult<JSValue>;
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
impl LogJsc for bun_logger::Log {
    fn to_js(&self, global: &JSGlobalObject, message: &str) -> JsResult<JSValue> {
        // TODO(b2): full impl wraps msgs into an AggregateError with `message`.
        let arr = self.to_js_array(global)?;
        global.create_aggregate_error_with_array(
            bun_string::String::borrow_utf8(message.as_bytes()),
            arr,
        )
    }
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(b2): wrap each Msg in BuildMessage/ResolveMessage per kind — gated.
        JSValue::create_empty_array(global, self.msgs.len())
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
    use super::*;
    /// `jsc.BuildMessage` — wraps a `bun.logger.Msg` for JS exposure.
    pub struct BuildMessage {
        pub msg: bun_logger::Msg,
    }
    impl BuildMessage {
        /// Create a JS `BuildMessage` instance from a logger `Msg`.
        pub fn create(global: &JSGlobalObject, msg: bun_logger::Msg) -> JsResult<JSValue> {
            let _ = (global, msg);
            // TODO(b2): codegen `BuildMessage__create` — needs JsClass derive.
            todo!("BuildMessage::create")
        }
    }
}
pub use self::build_message::BuildMessage;

pub mod resolve_message {
    use super::*;
    /// `jsc.ResolveMessage` — wraps a resolver error for JS exposure.
    pub struct ResolveMessage {
        pub msg: bun_logger::Msg,
        pub referrer: bun_string::String,
    }
    impl ResolveMessage {
        /// Create a JS `ResolveMessage` instance from a logger `Msg` + referrer.
        pub fn create(
            global: &JSGlobalObject,
            msg: bun_logger::Msg,
            referrer: bun_string::String,
        ) -> JsResult<JSValue> {
            let _ = (global, msg, referrer);
            // TODO(b2): codegen `ResolveMessage__create` — needs JsClass derive.
            todo!("ResolveMessage::create")
        }
    }
}
pub use self::resolve_message::ResolveMessage;

pub mod zig_exception {
    /// `ZigException.Holder` — extern struct that owns the stack-frame storage
    /// passed across the FFI boundary (ZigException.zig:54).
    #[repr(C)]
    pub struct Holder {
        // TODO(b2): full field layout (frames + remapped flag) — gated.
        loaded: bool,
        zig_exception_: super::ZigException,
    }
    impl Holder {
        pub fn init() -> Self {
            Self { loaded: false, zig_exception_: super::ZigException::default() }
        }
        /// `Holder.zigException()` (ZigException.zig:98) — lazy-init the inner
        /// `ZigException` (wiring up `frames`/`source_lines` storage) and
        /// return a mutable pointer to it.
        pub fn zig_exception(&mut self) -> &mut super::ZigException {
            if !self.loaded {
                // TODO(b2): wire frames_ptr/source_lines_ptr to Holder-owned arrays —
                // gated until ZigException.rs / ZigStackTrace.rs un-gate.
                self.zig_exception_ = super::ZigException::default();
                self.loaded = true;
            }
            &mut self.zig_exception_
        }
    }
}

/// Trait implemented by `#[bun_jsc::JsClass]`-derived types. The proc-macro
/// emits `to_js`/`from_js`/`from_js_direct` per type; this is the trait shape.
pub trait JsClass: Sized {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn from_js(value: JSValue) -> Option<*mut Self>;
    fn from_js_direct(value: JSValue) -> Option<*mut Self>;

    /// Dynamic heap footprint reported to JSC's GC via
    /// `reportExtraMemoryAllocated` / `reportExtraMemoryVisited`
    /// (generate-classes.ts:1656-1660, 1913-1916). Mirrors the Zig
    /// `${typeName}.estimatedSize(thisValue)` contract: types that own large
    /// out-of-line buffers (Blob/Request/Response bodies) override this so the
    /// collector sees real memory pressure, not just `size_of::<Self>()`.
    ///
    /// Override with an inherent `fn estimated_size(&self) -> usize` on the
    /// concrete type — the `#[JsClass(estimated_size)]` hook resolves via
    /// method syntax, so an inherent impl shadows this default.
    fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>()
    }
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

// TODO(port): generated module — re-run bindgen with .rs output. Hand-stubbed
// in `generated.rs` until `src/codegen/generate-classes.ts` grows a `.rs`
// backend.
#[path = "generated.rs"]
pub mod generated;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/jsc.zig (283 lines)
//   confidence: low (B-1 gate-and-stub)
//   todos:      see TODO(b1) markers
//   notes:      crate root; all submodules gated. Stub surface only.
// ──────────────────────────────────────────────────────────────────────────
