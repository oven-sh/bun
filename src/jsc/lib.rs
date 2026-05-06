//! Bindings to JavaScriptCore and other JavaScript primitives such as
//! VirtualMachine, JSGlobalObject (Zig::GlobalObject), and the event loop.
//!
//! Web and runtime-specific APIs should go in `bun.webcore` and `bun.api`.
//!
//! LAYERING: `jsc.zig` carries deprecated aliases `WebCore = bun.webcore`,
//! `API = bun.api`, `Node = bun.api.node`, `Subprocess = bun.api.Subprocess`.
//! In the Rust crate graph those targets live in `bun_runtime`, which depends
//! on this crate — re-exporting them here would create a cycle. The Zig source
//! already marks every one of them `Deprecated` with a "TODO: Remove" header,
//! so the Rust port drops the aliases outright. Callers reference
//! `bun_runtime::{webcore,api,node}` directly; lower-tier crates that touched
//! these types (e.g. `output_file_jsc`) have been moved up into `bun_runtime`.

#![allow(dead_code, unused_imports, unused_variables, deprecated, non_snake_case)]
#![allow(unexpected_cfgs)]
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

/// `bun.schema.api` types that reference `ZigStackFramePosition` (this crate)
/// and so cannot live in `bun_options_types::schema::api` without a dep cycle.
/// Ported from `src/options_types/schema.zig` (`StackFrameScope`, `StackFrame`,
/// `StackFramePosition`, `SourceLine`, `StackTrace`).
pub mod schema_api {
    use crate::ZigStackFramePosition;

    /// schema.zig:373 — `enum(u8) { _none, eval, module, function, global, wasm,
    /// constructor, _ }` (non-exhaustive). Newtype keeps any-u8 FFI-safe.
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub struct StackFrameScope(pub u8);

    impl StackFrameScope {
        pub const NONE: Self = Self(0);
        pub const EVAL: Self = Self(1);
        pub const MODULE: Self = Self(2);
        pub const FUNCTION: Self = Self(3);
        pub const GLOBAL: Self = Self(4);
        pub const WASM: Self = Self(5);
        pub const CONSTRUCTOR: Self = Self(6);
    }

    /// schema.zig:431 — `pub const StackFramePosition = bun.jsc.ZigStackFramePosition;`
    pub type StackFramePosition = ZigStackFramePosition;

    /// schema.zig:401 — `struct StackFrame`.
    #[derive(Clone)]
    pub struct StackFrame {
        /// function_name
        pub function_name: Box<[u8]>,
        /// file
        pub file: Box<[u8]>,
        /// position
        pub position: StackFramePosition,
        /// scope
        pub scope: StackFrameScope,
    }

    impl Default for StackFrame {
        fn default() -> Self {
            Self {
                function_name: Box::default(),
                file: Box::default(),
                position: StackFramePosition::INVALID,
                scope: StackFrameScope::NONE,
            }
        }
    }

    /// schema.zig:433 — `struct SourceLine`.
    #[derive(Clone, Default)]
    pub struct SourceLine {
        /// line
        pub line: i32,
        /// text
        pub text: Box<[u8]>,
    }

    /// schema.zig:455 — `struct StackTrace`.
    #[derive(Clone, Default)]
    pub struct StackTrace {
        /// source_lines
        pub source_lines: Vec<SourceLine>,
        /// frames
        pub frames: Vec<StackFrame>,
    }
}
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
#[path = "JSValue.rs"] pub mod js_value;

pub use self::js_value::{
    js_value_hash, BackingInt, CoerceTo, ComparisonResult, ForEachCallback, FromJsEnum, JSValue,
    PropertyIteratorFn, ProxyField, ProxyInternalField, SerializedFlags, SerializedScriptValue,
};

// LAYERING (PORTING.md §Dispatch): `Task.run` (jsc/Task.zig:39) is a giant
// `switch` over every concrete task variant — most of which live in
// `bun_runtime`. The Rust port follows the §Dispatch convention: this crate
// stores the erased `(tag, *mut ())` `Task` and exposes the queue; the high
// tier (`bun_runtime::dispatch::tick_queue_with_count`) owns the `match` loop
// and is wired into `event_loop::tick` directly at link time. No fn-pointer
// hook is re-exported from the crate root.
pub use self::task::Taskable;
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

    /// `formatter.indent += 1` — bump nesting level for the duration of a
    /// `{ … }` block. Paired with [`indent_dec`].
    fn indent_inc(&mut self);
    /// `formatter.indent -|= 1` — saturating decrement (Zig spelling).
    fn indent_dec(&mut self);
    /// `Formatter.writeIndent(Writer, writer)` — emit `2 * indent` spaces.
    fn write_indent<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result;
    /// `Formatter.resetLine()` — reset `estimated_line_length` to current
    /// indent so wrap heuristics start fresh on the next line.
    fn reset_line(&mut self);
    /// `Formatter.printComma(Writer, writer, enable_ansi_colors)` — dim `,`.
    fn print_comma<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> core::fmt::Result;
}

impl<'a> ConsoleFormatter for self::console_object::Formatter<'a> {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject { self.global_this }
    #[inline]
    fn indent_inc(&mut self) { self.indent += 1; }
    #[inline]
    fn indent_dec(&mut self) { self.indent = self.indent.saturating_sub(1); }
    #[inline]
    fn reset_line(&mut self) { self::console_object::Formatter::reset_line(self) }
    fn write_indent<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result {
        // Inherent `Formatter::write_indent` takes `&mut dyn bun_io::Write`;
        // bridge the `core::fmt::Write` sink the same way `print_as` does.
        let mut sink = bun_io::FmtAdapter::new(writer);
        self::console_object::Formatter::write_indent(self, &mut sink)
            .map_err(|_| core::fmt::Error)
    }
    fn print_comma<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        writer: &mut W,
    ) -> core::fmt::Result {
        let mut sink = bun_io::FmtAdapter::new(writer);
        self::console_object::Formatter::print_comma::<ENABLE_ANSI_COLORS>(self, &mut sink)
            .map_err(|_| core::fmt::Error)
    }
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

#[path = "GarbageCollectionController.rs"]
pub mod garbage_collection_controller;

// ──────────────────────────────────────────────────────────────────────────
// Phase-D un-gated `#[no_mangle]` export modules. These were B-1 gated; now
// compiled so the C++ side links against the real symbols (43 exports per
// /tmp/hw_defined_but_unlinked.txt). Remaining drafts stay in `_gated` below.
// ──────────────────────────────────────────────────────────────────────────
#[path = "AbortSignal.rs"] pub mod abort_signal;
#[path = "CppTask.rs"] pub mod cpp_task;
#[path = "HTTPServerAgent.rs"] pub mod http_server_agent;
#[path = "JSSecrets.rs"] pub mod js_secrets;
#[path = "NodeModuleModule.rs"] pub mod node_module_module;
#[path = "PosixSignalHandle.rs"] pub mod posix_signal_handle;
#[path = "btjs.rs"] pub mod btjs;
#[path = "fmt_jsc.rs"] pub mod fmt_jsc;
#[path = "resolve_path_jsc.rs"] pub mod resolve_path_jsc;
#[path = "resolver_jsc.rs"] pub mod resolver_jsc;
#[path = "virtual_machine_exports.rs"] pub mod virtual_machine_exports;

#[rustfmt::skip]
#[path = "host_fn.rs"] pub mod host_fn;
#[path = "AnyPromise.rs"] pub mod any_promise;
#[path = "CachedBytecode.rs"] pub mod cached_bytecode;
#[path = "DOMFormData.rs"] pub mod dom_form_data;
#[path = "DeferredError.rs"] pub mod deferred_error;
#[path = "JSArrayIterator.rs"] pub mod js_array_iterator;
#[path = "JSGlobalObject.rs"] pub mod js_global_object;
#[path = "SystemError.rs"] pub mod system_error;
#[path = "URL.rs"] pub mod url;
#[path = "VM.rs"] pub mod vm;
#[path = "ZigStackTrace.rs"] pub mod zig_stack_trace;
#[path = "ZigStackFrame.rs"] pub mod zig_stack_frame;
#[path = "ZigException.rs"] pub mod zig_exception;
#[path = "JSPropertyIterator.rs"] pub mod js_property_iterator;
#[path = "javascript_core_c_api.rs"] pub mod c_api;
#[path = "generated_classes_list.rs"] pub mod generated_classes_list;
#[path = "AsyncModule.rs"] pub mod async_module;
#[path = "BunCPUProfiler.rs"] pub mod bun_cpu_profiler;
#[path = "BunHeapProfiler.rs"] pub mod bun_heap_profiler;
#[path = "ConcurrentPromiseTask.rs"] pub mod concurrent_promise_task;
#[path = "EventLoopHandle.rs"] pub mod event_loop_handle;
#[path = "FFI.rs"] pub mod ffi;
#[path = "JSCScheduler.rs"] pub mod jsc_scheduler;
#[path = "JSONLineBuffer.rs"] pub mod json_line_buffer;
#[path = "ProcessAutoKiller.rs"] pub mod process_auto_killer;
#[path = "WorkTask.rs"] pub mod work_task;
#[path = "bindgen.rs"] pub mod bindgen;
#[path = "bindgen_test.rs"] pub mod bindgen_test;
#[path = "bun_string_jsc.rs"] pub mod bun_string_jsc;
#[path = "codegen.rs"] pub mod codegen_mod;
#[path = "comptime_string_map_jsc.rs"] pub mod comptime_string_map_jsc;
#[path = "config.rs"] pub mod config;

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) {
    // Spec jsc.zig:251 — `bun.analytics.Features.jsc += 1`. Counter lives in
    // `bun_core` (MOVE_DOWN per CYCLEBREAK) so this crate doesn't depend on
    // `bun_analytics`.
    bun_core::analytics::Features::jsc_inc();
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

impl From<bun_event_loop::ErasedJsError> for JsError {
    #[inline]
    fn from(e: bun_event_loop::ErasedJsError) -> Self {
        use bun_event_loop::ErasedJsError as E;
        match e {
            E::Thrown => JsError::Thrown,
            E::OutOfMemory => JsError::OutOfMemory,
            E::Terminated => JsError::Terminated,
        }
    }
}

impl From<JsError> for bun_event_loop::ErasedJsError {
    #[inline]
    fn from(e: JsError) -> Self {
        use bun_event_loop::ErasedJsError as E;
        match e {
            JsError::Thrown => E::Thrown,
            JsError::OutOfMemory => E::OutOfMemory,
            JsError::Terminated => E::Terminated,
        }
    }
}

impl From<JsTerminated> for JsError {
    fn from(_: JsTerminated) -> Self { JsError::Terminated }
}

impl From<bun_core::Error> for JsError {
    fn from(_: bun_core::Error) -> Self {
        // PORT NOTE: Zig coerces arbitrary `anyerror` into the JS error union by
        // throwing a generic Error; the throw happens at the call site. Mapping
        // to `Thrown` here lets `?` propagate while the actual throw is handled
        // by the host-fn wrapper.
        JsError::Thrown
    }
}

/// Adapter for Zig-style `(comptime fmt, args)` throw helpers ported to Rust.
/// During the port, callers use a mix of `&str`, `format_args!(..)`, `()`, and
/// `&[..]` for the trailing "args" tuple — this trait normalizes them so a
/// single method signature works for all of them.
pub trait ThrowFmtArgs {
    fn ignore(self) where Self: Sized {}
}
impl ThrowFmtArgs for () {}
impl<T> ThrowFmtArgs for &[T] {}
impl<T, const N: usize> ThrowFmtArgs for &[T; N] {}
impl ThrowFmtArgs for core::fmt::Arguments<'_> {}

/// Debug-only binding-presence marker. In Zig this is `jsc.markBinding(@src())`.
/// MOVE_DOWN: the macro lives in `bun_core` (no jsc dep) so `bun_aio` /
/// `bun_http_jsc` / `bun_event_loop` can call it without a `bun_jsc` cycle.
/// Re-exported here so existing `crate::mark_binding!()` call sites resolve.
pub use bun_core::mark_binding;

pub use self::host_fn::{
    from_js_host_call, from_js_host_call_generic, host_construct_result, host_fn_result,
    host_setter_result, to_js_host_call, to_js_host_fn, to_js_host_fn_result,
    to_js_host_fn_with_context, JSHostFn, JSHostFnZig, JSHostFnZigWithContext,
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

    /// Normalizes a host-fn body's return type to `JsResult<JSValue>` so the
    /// proc-macro can wrap bodies that return either `JSValue` or
    /// `JsResult<JSValue>` (mirrors Zig's `anytype` dispatch in `toJSHostFn`).
    pub trait IntoHostFnResult {
        fn into_host_fn_result(self) -> JsResult<JSValue>;
    }
    impl IntoHostFnResult for JSValue {
        #[inline] fn into_host_fn_result(self) -> JsResult<JSValue> { Ok(self) }
    }
    impl IntoHostFnResult for JsResult<JSValue> {
        #[inline] fn into_host_fn_result(self) -> JsResult<JSValue> { self }
    }

    /// Normalizes a `construct` body's return type — `*mut T`, `Box<T>`, or
    /// `JsResult<_>` of either — to a nullable `*mut c_void`.
    pub trait IntoConstructResult {
        fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void>;
    }
    impl<T> IntoConstructResult for *mut T {
        #[inline] fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> { Ok(self.cast()) }
    }
    impl<T> IntoConstructResult for alloc::boxed::Box<T> {
        #[inline] fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> {
            Ok(alloc::boxed::Box::into_raw(self).cast())
        }
    }
    impl<T> IntoConstructResult for JsResult<*mut T> {
        #[inline] fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> { self.map(|p| p.cast()) }
    }
    impl<T> IntoConstructResult for JsResult<alloc::boxed::Box<T>> {
        #[inline] fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> {
            self.map(|b| alloc::boxed::Box::into_raw(b).cast())
        }
    }

    /// Map a `JsResult<JSValue>` from a Rust host fn to the raw `JSValue` the
    /// JSC ABI expects (`.ZERO` when an exception is/was thrown). Mirrors
    /// `host_fn.zig:toJSHostFnResult`.
    #[inline]
    pub fn host_fn_result(global: &JSGlobalObject, r: impl IntoHostFnResult) -> JSValue {
        super::host_fn::to_js_host_call(global, r.into_host_fn_result())
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
    pub fn host_fn_construct_result<T: IntoConstructResult>(
        global: &JSGlobalObject,
        r: T,
    ) -> *mut ::core::ffi::c_void {
        match r.into_construct_ptr() {
            Ok(p) => p,
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


// JSC Classes Bindings — re-exported from their per-type modules (declared
// above with `#[path = "…"] pub mod …;`). These were previously placeholder
// newtypes; the real opaque-FFI structs now live in their own files and are
// surfaced here at the crate root to match `jsc.zig`'s flat namespace.
pub use self::cached_bytecode::CachedBytecode;
pub use self::dom_form_data::DOMFormData;
pub use self::deferred_error::DeferredError;
pub use self::url::URL;
pub use self::zig_stack_trace::ZigStackTrace;
pub use self::zig_stack_frame::ZigStackFrame;
pub use abort_signal::AbortSignal;

// ──────────────────────────────────────────────────────────────────────────
// `VM` / `JSGlobalObject` — opaque FFI handles to C++-owned objects.
//
// Unlike the simple re-exports above, these carry an `UnsafeCell`
// marker so a shared `&VM` / `&JSGlobalObject` does **not** assert
// immutability of the pointee. The Zig spec (`VM.zig`, `JSGlobalObject.zig`)
// passes `*VM` / `*JSGlobalObject` everywhere — Zig pointers freely alias and
// the C++ side mutates through them. Modelling that in Rust as `&T` without
// interior mutability would make every `&T -> *mut T` cast (and any C++ write
// behind it) UB under Stacked Borrows. The `UnsafeCell` field opts the bytes
// out of the noalias/readonly guarantee so `as_mut_ptr()` is sound.
//
// Rust never reads or writes these bytes directly; all access is via FFI.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
pub struct VM {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _marker: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
#[repr(C)]
pub struct JSGlobalObject {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _marker: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// Options for `JSGlobalObject::validate_integer_range` / `validate_bigint_range`.
/// Mirrors Zig's `IntegerRange` (comptime min/max collapsed to i128 so every
/// signed/unsigned primitive's bounds + MIN/MAX_SAFE_INTEGER fit without
/// narrowing). Defined here because `JSGlobalObject.rs` is still cfg-gated and
/// callers across `bun_runtime` need a stable name.
#[derive(Clone, Copy)]
pub struct IntegerRange {
    pub min: i128,
    pub max: i128,
    pub field_name: &'static [u8],
    pub always_allow_zero: bool,
}
impl Default for IntegerRange {
    fn default() -> Self {
        Self {
            min: i128::from(MIN_SAFE_INTEGER),
            max: i128::from(MAX_SAFE_INTEGER),
            field_name: b"",
            always_allow_zero: false,
        }
    }
}
/// Back-compat alias — earlier ports spelled this `IntegerRangeOptions`.
pub type IntegerRangeOptions = IntegerRange;

impl VM {
    /// Raw `*mut VM` for FFI. Sound for callees that mutate: `VM` contains
    /// `UnsafeCell`, so `&VM` carries interior-mutable provenance and the
    /// `*const -> *mut` cast does not launder a read-only pointer.
    #[inline]
    pub fn as_mut_ptr(&self) -> *mut VM {
        // UnsafeCell::get yields `*mut` with write provenance from `&self`.
        self._opaque.get() as *mut VM
    }

    /// Spec `VM.zig` `getAPILock` — RAII JSLockHolder. Prefer this over the
    /// callback-style [`Self::hold_api_lock`] when the locked region spans the
    /// rest of a function body (mirrors Zig's `defer api_lock.release()`).
    pub fn get_api_lock(&self) -> ApiLock<'_> {
        unsafe extern "C" {
            fn JSC__VM__getAPILock(vm: *mut VM);
        }
        // SAFETY: `self` is a live opaque JSC VM handle.
        unsafe { JSC__VM__getAPILock(self.as_mut_ptr()) }
        ApiLock { vm: self }
    }

    /// Spec `VM.zig:34` `holdAPILock` — wraps `JSC__VM__holdAPILock`.
    pub fn hold_api_lock(
        &self,
        ctx: *mut core::ffi::c_void,
        callback: extern "C" fn(ctx: *mut core::ffi::c_void),
    ) {
        unsafe extern "C" {
            fn JSC__VM__holdAPILock(
                vm: *mut VM,
                ctx: *mut core::ffi::c_void,
                callback: extern "C" fn(ctx: *mut core::ffi::c_void),
            );
        }
        // SAFETY: `self` is a live opaque JSC VM handle (interior-mutable via
        // `UnsafeCell`); `callback` is a valid C fn pointer.
        unsafe { JSC__VM__holdAPILock(self.as_mut_ptr(), ctx, callback) }
    }

    /// Spec `VM.zig` `executionForbidden` — wraps `JSC__VM__executionForbidden`.
    #[inline]
    pub fn execution_forbidden(&self) -> bool {
        unsafe extern "C" {
            fn JSC__VM__executionForbidden(vm: *mut VM) -> bool;
        }
        // SAFETY: `self` is a live opaque JSC VM handle.
        unsafe { JSC__VM__executionForbidden(self.as_mut_ptr()) }
    }
}

/// RAII guard returned by [`VM::get_api_lock`]. Mirrors Zig `JSC.VM.Lock`
/// (`defer api_lock.release()` → `Drop`).
pub struct ApiLock<'a> {
    vm: &'a VM,
}
impl ApiLock<'_> {
    /// Explicit release (Zig spelling). Equivalent to `drop(self)`.
    #[inline]
    pub fn release(self) {}
}
impl Drop for ApiLock<'_> {
    fn drop(&mut self) {
        unsafe extern "C" {
            fn JSC__VM__releaseAPILock(vm: *mut VM);
        }
        // SAFETY: lock was acquired via JSC__VM__getAPILock on this VM.
        unsafe { JSC__VM__releaseAPILock(self.vm.as_mut_ptr()) }
    }
}

impl JSGlobalObject {
    /// Raw `*mut JSGlobalObject` for FFI. See [`VM::as_mut_ptr`] for the
    /// soundness argument (interior mutability via `UnsafeCell`).
    #[inline]
    pub fn as_mut_ptr(&self) -> *mut JSGlobalObject {
        self._opaque.get() as *mut JSGlobalObject
    }
}

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
    /// `AnyPromise.result` (AnyPromise.zig:31) — settled value (fulfilled or
    /// rejected). Undefined while pending.
    #[inline] pub fn result(self, vm: &VM) -> JSValue {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).result(vm) },
            Self::Internal(p) => unsafe { (*p).result(vm) },
        }
    }
    /// `AnyPromise.status` (AnyPromise.zig:24).
    #[inline] pub fn status(self) -> self::js_promise::Status {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).status() },
            Self::Internal(p) => unsafe { (*p).status() },
        }
    }
    /// `AnyPromise.setHandled` (AnyPromise.zig:42).
    #[inline] pub fn set_handled(self, vm: &VM) {
        let _ = vm;
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).set_handled() },
            Self::Internal(p) => unsafe { (*p).set_handled() },
        }
    }
    /// `AnyPromise.resolve` (AnyPromise.zig:50).
    #[inline] pub fn resolve(self, global: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).resolve(global, value) },
            Self::Internal(p) => unsafe { (*p).resolve(global, value) },
        }
    }
    /// `AnyPromise.reject` (AnyPromise.zig:56). Zig: `JSValue` coerces to
    /// `JSError!JSValue` implicitly; map that with `Ok(value)`.
    #[inline] pub fn reject(self, global: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).reject(global, Ok(value)) },
            Self::Internal(p) => unsafe { (*p).reject(global, Ok(value)) },
        }
    }
    /// `AnyPromise.rejectWithAsyncStack` (AnyPromise.zig:62) — like `reject`
    /// but first attaches async stack frames from this promise's await chain
    /// to the error. Use when rejecting from native code at the top of the
    /// event loop.
    #[inline] pub fn reject_with_async_stack(
        self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), JsTerminated> {
        // SAFETY: variants hold a live JSC heap cell; `as_js_promise` is sound for both.
        value.attach_async_stack_from_promise(global, unsafe { &*self.as_js_promise() });
        self.reject(global, value)
    }
    /// JSInternalPromise subclasses JSPromise in C++ — this cast is safe for
    /// any C++ function taking JSPromise*.
    #[inline] pub fn as_js_promise(self) -> *mut JSPromise {
        match self {
            Self::Normal(p) => p,
            // SAFETY: JSInternalPromise subclasses JSPromise in C++; pointer
            // reinterpretation is valid for any C++ API taking JSPromise*.
            Self::Internal(p) => p as *mut JSPromise,
        }
    }
    /// `AnyPromise.wrap` (AnyPromise.zig) — run `f` through the host-call
    /// wrapper so a thrown exception is converted to an Err, then resolve/
    /// reject this existing promise with the outcome.
    ///
    /// Zig used `std.meta.ArgsTuple(@TypeOf(Function))` to forward arbitrary
    /// argument tuples; Rust takes a closure capturing those arguments.
    pub fn wrap<F>(self, global: &JSGlobalObject, f: F) -> Result<(), JsTerminated>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    {
        match f(global) {
            Ok(v) => self.resolve(global, v),
            Err(_) => {
                let err = global.try_take_exception().unwrap_or(JSValue::UNDEFINED);
                self.reject(global, err)
            }
        }
    }
    /// `AnyPromise.unwrap` (AnyPromise.zig:14).
    #[inline] pub fn unwrap(self, vm: &VM, mode: PromiseUnwrapMode) -> PromiseResult {
        // SAFETY: variants hold a live JSC heap cell; `vm` is the owning VM.
        // `JSPromise::unwrap` takes `&VM` (interior-mutable opaque handle) — no
        // `&mut VM` is materialized, so no aliased exclusive borrow exists.
        match self {
            Self::Normal(p) => unsafe { (*p).unwrap(vm, mode) },
            Self::Internal(p) => unsafe { (*p).unwrap(vm, mode) },
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
/// downstream can use as a runtime flag set. `Default` mirrors the Zig struct's
/// field defaults (JSPropertyIterator.zig:1-7): `own_properties_only = true`,
/// `observable = true`, `only_non_index_properties = false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JSPropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
    pub own_properties_only: bool,
    pub observable: bool,
    pub only_non_index_properties: bool,
}
impl Default for JSPropertyIteratorOptions {
    #[inline]
    fn default() -> Self {
        Self {
            skip_empty_name: false,
            include_value: false,
            own_properties_only: true,
            observable: true,
            only_non_index_properties: false,
        }
    }
}

/// Shorthand of `JSPropertyIteratorOptions` matching the Zig spec's most common
/// call-site shape (`.{ .skip_empty_name = …, .include_value = … }`). Runtime
/// values are accepted by `JSPropertyIterator::init` for source-level parity
/// with Zig; the remaining three options take the Zig struct defaults via the
/// `From` conversion below.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PropertyIteratorOptions {
    pub skip_empty_name: bool,
    pub include_value: bool,
}
impl From<PropertyIteratorOptions> for JSPropertyIteratorOptions {
    #[inline]
    fn from(o: PropertyIteratorOptions) -> Self {
        Self {
            skip_empty_name: o.skip_empty_name,
            include_value: o.include_value,
            ..Self::default()
        }
    }
}

/// Conversion shim so `JSPropertyIterator::init`'s `object` argument accepts
/// the same operand shapes Zig callers use (`JSValue`, `*JSObject`, `&JSObject`).
pub trait IntoIterObject {
    fn into_iter_object(self) -> JSValue;
}
impl IntoIterObject for JSValue {
    #[inline] fn into_iter_object(self) -> JSValue { self }
}
impl IntoIterObject for *mut JSObject {
    #[inline] fn into_iter_object(self) -> JSValue { JSValue::from_cell(self) }
}
impl IntoIterObject for *const JSObject {
    #[inline] fn into_iter_object(self) -> JSValue { JSValue::from_cell(self) }
}
impl IntoIterObject for &JSObject {
    #[inline] fn into_iter_object(self) -> JSValue { JSValue::from_cell(self) }
}
impl IntoIterObject for &mut JSObject {
    #[inline] fn into_iter_object(self) -> JSValue { JSValue::from_cell(&*self) }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — JSGlobalObject surface (signatures from JSGlobalObject.zig).
// ──────────────────────────────────────────────────────────────────────────
#[allow(improper_ctypes)] // VirtualMachine is opaque to C++; passed as `void*`
unsafe extern "C" {
    fn JSC__JSGlobalObject__vm(this: *const JSGlobalObject) -> *mut VM;
    fn JSC__JSGlobalObject__bunVM(this: *const JSGlobalObject) -> *mut virtual_machine::VirtualMachine;
    fn JSGlobalObject__hasException(this: *const JSGlobalObject) -> bool;
    fn JSGlobalObject__throwOutOfMemoryError(this: *const JSGlobalObject);
    fn JSGlobalObject__throwStackOverflow(this: *const JSGlobalObject);
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
    fn JSGlobalObject__clearTerminationException(this: *const JSGlobalObject);
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
        // SAFETY: `JSGlobalObject` is an opaque FFI handle with `UnsafeCell`
        // interior, so `&self` does not carry a read-only/noalias guarantee
        // and the resulting `*mut` may be written through by C++.
        self.as_mut_ptr()
    }

    pub fn vm(&self) -> &VM {
        // SAFETY: `vm()` never returns null for a live global; lifetime tied to &self.
        unsafe { &*JSC__JSGlobalObject__vm(self) }
    }
    /// Raw `*mut VM` for FFI / storage. Unlike [`vm`], this preserves the
    /// mutable provenance returned by C++ instead of narrowing through `&VM`,
    /// so callers may pass it to FFI that mutates the VM without a
    /// `&T -> *mut T` cast (which would be UB to write through).
    #[inline]
    pub fn vm_ptr(&self) -> *mut VM {
        // SAFETY: FFI — &self is a valid JSGlobalObject*; returns the owning VM.
        unsafe { JSC__JSGlobalObject__vm(self) }
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
    pub fn throw_stack_overflow(&self) -> JsError {
        // JSGlobalObject.zig:36 — dedicated FFI, returns `error.JSError`.
        // SAFETY: `self` is a live JSGlobalObject.
        unsafe { JSGlobalObject__throwStackOverflow(self) };
        JsError::Thrown
    }
    /// `createErrorInstance(fmt, args)` — formats `args` into a UTF-8 buffer, wraps
    /// it as a ZigString, and calls `ZigString__toErrorInstance`.
    ///
    /// PORT NOTE: Zig's `(comptime fmt, args)` becomes `impl Display` here so
    /// both `&str` and `format_args!(..)` callers compile.
    pub fn create_error_instance(&self, msg: impl core::fmt::Display) -> JSValue {
        let buf = alloc::format!("{msg}");
        let zs = bun_string::ZigString::init_utf8(buf.as_bytes());
        // SAFETY: `self` is live; `zs` borrowed for the call (C++ clones).
        unsafe { ZigString__toErrorInstance(&zs, self) }
    }
    pub fn create_type_error_instance(&self, args: impl core::fmt::Display) -> JSValue {
        let buf = alloc::format!("{args}");
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
    /// `throw(comptime fmt, args)` (JSGlobalObject.zig:62) — Zig's two-param
    /// form collapses to `impl Display` in Rust. Prefer `format_args!(..)` for
    /// runtime formatting; the legacy second tuple parameter from mechanical
    /// ports is accepted via `throw2`.
    pub fn throw(&self, msg: impl core::fmt::Display) -> JsError {
        let err = self.create_error_instance(msg);
        self.throw_value(err)
    }
    /// Two-arg shim for mechanically-ported `throw("fmt", .{})` call sites.
    /// The `_args` tuple is ignored; callers should migrate to
    /// `throw(format_args!(..))`.
    #[doc(hidden)]
    pub fn throw2(&self, msg: impl core::fmt::Display, _args: impl ThrowFmtArgs) -> JsError {
        self.throw(msg)
    }
    /// `throwError(err: anyerror, comptime fmt)` (JSGlobalObject.zig:492).
    /// Zig formats `"{errorName} " ++ fmt` and throws a plain `Error` instance;
    /// `error.OutOfMemory` short-circuits to `throwOutOfMemory()`.
    pub fn throw_error(&self, err: bun_core::Error, msg: &'static str) -> JsError {
        if err == bun_core::Error::OUT_OF_MEMORY {
            return self.throw_out_of_memory();
        }
        // If we're throwing JSError, that means either an exception is already
        // active or the caller is incorrectly returning JSError without throwing.
        debug_assert_ne!(err.name(), "JSError");
        // PERF(port): Zig used `std.heap.stackFallback(128)` — profile in Phase B.
        let buffer = alloc::format!("{} {msg}", err.name());
        let str = bun_string::ZigString::init_utf8(buffer.as_bytes());
        // SAFETY: `self` is live; `str` borrows `buffer` for the call.
        let err_value = unsafe { ZigString__toErrorInstance(&str, self) };
        self.throw_value(err_value)
    }
    pub fn throw_type_error(&self, args: impl core::fmt::Display) -> JsError {
        let err = self.create_type_error_instance(format_args!("{args}"));
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
    pub fn throw_invalid_arguments(&self, msg: impl core::fmt::Display) -> JsError {
        // JSGlobalObject.zig:73 — `JSC::createInvalidThisError`-style TypeError.
        let err = self.create_type_error_instance(msg);
        self.throw_value(err)
    }
    /// Two-arg shim for mechanically-ported `throwInvalidArguments(fmt, .{})`
    /// call sites. The `_args` tuple is ignored.
    #[doc(hidden)]
    pub fn throw_invalid_arguments2(&self, msg: impl core::fmt::Display, _args: impl ThrowFmtArgs) -> JsError {
        self.throw_invalid_arguments(msg)
    }
    /// `throwInvalidArgumentType(name, field, typename)` (JSGlobalObject.zig:103)
    /// — `"Expected {field} to be a {typename} for '{name}'."` tagged
    /// `ERR_INVALID_ARG_TYPE`.
    pub fn throw_invalid_argument_type(
        &self,
        name: &'static str,
        field: &'static str,
        typename: &'static str,
    ) -> JsError {
        // Zig builds the message via `comptime std.fmt.comptimePrint`; the
        // ported port uses runtime `format_args!` (no comptime in Rust).
        let err = self
            .err(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!("Expected {field} to be a {typename} for '{name}'."),
            )
            .to_js();
        self.throw_value(err)
    }
    /// `globalThis.ERR(.INVALID_ARG_TYPE, fmt, args).toJS()` — Node-compat error
    /// builder. Returns the error JSValue; caller decides whether to throw or wrap.
    #[allow(non_snake_case)]
    pub fn ERR_INVALID_ARG_TYPE(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        ErrorCode::INVALID_ARG_TYPE.fmt(self, args)
    }
    /// `globalThis.ERR(.INVALID_URL, fmt, args).toJS()`.
    pub fn err_invalid_url(&self, args: core::fmt::Arguments<'_>) -> JSValue {
        ErrorCode::INVALID_URL.fmt(self, args)
    }
    /// `determineSpecificType(value)` (JSGlobalObject.zig:155) — calls into C++
    /// (`Bun__ErrorCode__determineSpecificType`) to produce the Node-style
    /// "Received ..." description for an arbitrary JSValue.
    pub fn determine_specific_type(&self, value: JSValue) -> JsResult<bun_string::String> {
        // SAFETY: `self` is a live JSGlobalObject; `value` is a valid JSValue.
        let str = unsafe { Bun__ErrorCode__determineSpecificType(self.as_ptr(), value) };
        if self.has_exception() {
            str.deref();
            return Err(JsError::Thrown);
        }
        Ok(str)
    }
    /// `throwInvalidArgumentTypeValue(argname, typename, value)`
    /// (JSGlobalObject.zig:186) — `"The \"{argname}\" argument must be of type
    /// {typename}. Received {actual}"` tagged `ERR_INVALID_ARG_TYPE`.
    pub fn throw_invalid_argument_type_value(
        &self,
        argname: &str,
        typename: &str,
        value: JSValue,
    ) -> JsError {
        let actual = match self.determine_specific_type(value) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let e = self
            .err(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!(
                    "The \"{argname}\" argument must be of type {typename}. Received {actual}"
                ),
            )
            .throw();
        actual.deref();
        e
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
    /// `takeError(proof)` (JSGlobalObject.zig:573) — like [`take_exception`] but
    /// unwraps a `JSC::Exception` cell to its inner thrown value via
    /// `JSValue::toError()`.
    pub fn take_error(&self, proof: JsError) -> JSValue {
        if proof == JsError::OutOfMemory {
            let _ = self.throw_out_of_memory();
        }
        let exception = self.try_take_exception().unwrap_or_else(|| {
            panic!("A JavaScript exception was thrown, but it was cleared before it could be read.")
        });
        exception.to_error().unwrap_or_else(|| {
            panic!("Couldn't convert a JavaScript exception to an Error instance.")
        })
    }
    pub fn try_take_exception(&self) -> Option<JSValue> {
        // SAFETY: `self` is a live JSGlobalObject.
        let v = unsafe { JSGlobalObject__tryTakeException(self) };
        if v.is_empty() { None } else { Some(v) }
    }
    /// `clearTerminationException` (JSGlobalObject.zig:509) — drop any pending
    /// termination exception so cleanup code can run after `process.exit`.
    pub fn clear_termination_exception(&self) {
        // SAFETY: `self` is a live JSGlobalObject (JSGlobalObject.zig:63 — direct extern).
        unsafe { JSGlobalObject__clearTerminationException(self) }
    }

    /// `validateObject(arg_name, value, opts)` (JSGlobalObject.zig:710) —
    /// Node-compat object validator. Throws `ERR_INVALID_ARG_TYPE` when `value`
    /// fails the (nullable / array / function) gates.
    pub fn validate_object(
        &self,
        name: &'static str,
        value: JSValue,
        opts: ValidateObjectOpts,
    ) -> JsResult<()> {
        if (!opts.allow_nullable && value.is_null())
            || (!opts.allow_array && value.is_array())
            || (!value.is_object() && (!opts.allow_function || !value.is_function()))
        {
            return Err(self.throw_invalid_argument_type_value(name, "object", value));
        }
        Ok(())
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

    /// `runOnResolvePlugins(namespace, path, source, target)`
    /// (JSGlobalObject.zig:280) — invokes the C++-side onResolve plugin chain
    /// (`Bun__runOnResolvePlugins`). Empty namespace is passed as null.
    pub fn run_on_resolve_plugins(
        &self,
        namespace: bun_string::String,
        path: bun_string::String,
        source: bun_string::String,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        crate::mark_binding();
        let ns_ptr: *const bun_string::String = if namespace.length() > 0 {
            &namespace
        } else {
            core::ptr::null()
        };
        let result = host_fn::from_js_host_call(self, || {
            // SAFETY: `self` is live; the `bun.String`s are borrowed for the
            // call (C++ clones what it needs).
            unsafe { Bun__runOnResolvePlugins(self.as_ptr(), ns_ptr, &path, &source, target) }
        })?;
        if result.is_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(result))
    }

    /// `runOnLoadPlugins(namespace, path, target)` (JSGlobalObject.zig:273) —
    /// invokes the C++-side onLoad plugin chain (`Bun__runOnLoadPlugins`).
    /// Empty namespace is passed as null.
    pub fn run_on_load_plugins(
        &self,
        namespace: bun_string::String,
        path: bun_string::String,
        target: BunPluginTarget,
    ) -> JsResult<Option<JSValue>> {
        crate::mark_binding();
        let ns_ptr: *const bun_string::String = if namespace.length() > 0 {
            &namespace
        } else {
            core::ptr::null()
        };
        let result = host_fn::from_js_host_call(self, || {
            // SAFETY: `self` is live; the `bun.String`s are borrowed for the
            // call (C++ clones what it needs).
            unsafe { Bun__runOnLoadPlugins(self.as_ptr(), ns_ptr, &path, target) }
        })?;
        if result.is_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(result))
    }
}

unsafe extern "C" {
    fn Bun__runOnResolvePlugins(
        global: *mut JSGlobalObject,
        namespace: *const bun_string::String,
        path: *const bun_string::String,
        source: *const bun_string::String,
        target: BunPluginTarget,
    ) -> JSValue;
    fn Bun__runOnLoadPlugins(
        global: *mut JSGlobalObject,
        namespace: *const bun_string::String,
        path: *const bun_string::String,
        target: BunPluginTarget,
    ) -> JSValue;
    fn Bun__ErrorCode__determineSpecificType(
        global: *mut JSGlobalObject,
        value: JSValue,
    ) -> bun_string::String;
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

/// `jsc.JSArrayIterator` (jsc.zig:92) — borrowed iterator over a `JSArray`'s
/// indexed slots. `Iterator::next()` returns `Option<JSValue>` (skipping holes
/// is the caller's job, matching Zig).
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
    fn JSC__VM__blockBytesAllocated(vm: *mut VM) -> usize;
    fn JSC__VM__runGC(vm: *mut VM, sync: bool) -> usize;
    fn JSC__VM__notifyNeedTermination(vm: *mut VM);
    fn JSC__JSGlobalObject__handleRejectedPromises(global: *mut JSGlobalObject);
}
impl VM {
    /// `VM.notifyNeedTermination()` (VM.zig:115). Signals the VM to stop
    /// execution at the next safepoint.
    #[inline]
    pub fn notify_need_termination(&self) {
        // SAFETY: `self` is a live JSC::VM; `as_mut_ptr` is sound via `UnsafeCell`.
        unsafe { JSC__VM__notifyNeedTermination(self.as_mut_ptr()) }
    }
    pub fn throw_error(&self, global: &JSGlobalObject, value: JSValue) -> JsError {
        // SAFETY: `self` and `global` are live; throws into the VM's exception
        // scope. `as_mut_ptr` is sound via `UnsafeCell` (interior mutability).
        unsafe { JSC__VM__throwError(self.as_mut_ptr(), global, value) };
        JsError::Thrown
    }
    /// `VM.releaseWeakRefs()` (VM.zig:202).
    #[inline]
    pub fn release_weak_refs(&self) {
        // SAFETY: `self` is a live JSC::VM; `as_mut_ptr` is sound via `UnsafeCell`.
        unsafe { JSC__VM__releaseWeakRefs(self.as_mut_ptr()) }
    }
    /// `VM.collectAsync()` (VM.zig:90).
    #[inline]
    pub fn collect_async(&self) {
        // SAFETY: `self` is a live JSC::VM; `as_mut_ptr` is sound via `UnsafeCell`.
        unsafe { JSC__VM__collectAsync(self.as_mut_ptr()) }
    }
    /// `VM.heapSize()` (VM.zig:98).
    #[inline]
    pub fn heap_size(&self) -> usize {
        // SAFETY: `self` is a live JSC::VM; `as_mut_ptr` is sound via `UnsafeCell`.
        unsafe { JSC__VM__heapSize(self.as_mut_ptr()) }
    }
    /// `VM.blockBytesAllocated()` (VM.zig). Requires `RESOURCE_USAGE` build
    /// option in JavaScriptCore. Faster than checking the heap size.
    #[inline]
    pub fn block_bytes_allocated(&self) -> usize {
        // SAFETY: `self` is a live JSC::VM; `as_mut_ptr` is sound via `UnsafeCell`.
        unsafe { JSC__VM__blockBytesAllocated(self.as_mut_ptr()) }
    }
    /// `VM.runGC(sync)` (VM.zig:80-82).
    pub fn run_gc(&self, sync: bool) -> usize {
        // SAFETY: `self` is a live JSC::VM; `as_mut_ptr` is sound via `UnsafeCell`.
        unsafe { JSC__VM__runGC(self.as_mut_ptr(), sync) }
    }
}

impl JSGlobalObject {
    /// `JSGlobalObject.ERR(code, fmt, args)` (JSGlobalObject.zig:48) — returns an
    /// `ErrorBuilder` that defers `.throw()`/`.to_js()`/`.reject()` to the call site.
    #[inline]
    pub fn err<'a>(&'a self, code: ErrorCode, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a> {
        ErrorBuilder::new(self, code, args)
    }
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
impl Default for SystemError {
    fn default() -> Self {
        Self {
            errno: 0,
            code: bun_string::String::EMPTY,
            message: bun_string::String::EMPTY,
            path: bun_string::String::EMPTY,
            syscall: bun_string::String::EMPTY,
            hostname: bun_string::String::EMPTY,
            fd: core::ffi::c_int::MIN,
            dest: bun_string::String::EMPTY,
        }
    }
}
impl Clone for SystemError {
    /// Zig: `var v = this.*; v.ref();` — bitwise copy then bump every `bun.String`
    /// ref. `bun_string::String` is `Copy` (intrusive-refcounted handle), so the
    /// field copies below are bitwise; `.ref_()` provides the +1 per field.
    fn clone(&self) -> Self {
        self.code.ref_();
        self.message.ref_();
        self.path.ref_();
        self.syscall.ref_();
        self.hostname.ref_();
        self.dest.ref_();
        Self {
            errno: self.errno,
            code: self.code,
            message: self.message,
            path: self.path,
            syscall: self.syscall,
            hostname: self.hostname,
            fd: self.fd,
            dest: self.dest,
        }
    }
}
unsafe extern "C" {
    fn SystemError__toErrorInstance(this: *const SystemError, global: *mut JSGlobalObject) -> JSValue;
}
impl SystemError {
    pub fn deref(&self) {
        self.code.deref();
        self.message.deref();
        self.path.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }
    pub fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // Zig: `defer this.deref();` — C++ clones each `bun.String` into a
        // JSString, so we release the refs `self` holds afterward.
        // SAFETY: `self` is a valid extern-layout SystemError; `global` is live.
        let result = unsafe { SystemError__toErrorInstance(self, global.as_ptr()) };
        self.deref();
        result
    }
    pub fn to_error_instance_with_async_stack(&self, global: &JSGlobalObject, promise: &JSPromise) -> JSValue {
        let value = self.to_error_instance(global);
        value.attach_async_stack_from_promise(global, promise);
        value
    }
}
/// Reshape the T1 `bun_sys::SystemError` (non-`#[repr(C)]`, different field
/// order) into the `#[repr(C)]` extern layout C++ reads. In Zig there is one
/// `jsc.SystemError`; the Rust port split data (T1) from the JSC bridge (T6) —
/// this `From` is the canonical layering seam (see PORTING.md §_jsc bridge).
impl From<bun_sys::SystemError> for SystemError {
    fn from(e: bun_sys::SystemError) -> Self {
        Self {
            errno: e.errno as core::ffi::c_int,
            code: e.code,
            message: e.message,
            path: e.path,
            syscall: e.syscall,
            hostname: e.hostname,
            fd: e.fd as core::ffi::c_int,
            dest: e.dest,
        }
    }
}

/// `JSValue.toEnumFromMap(global, "signal", SignalCode, SignalCode.Map)`
/// (JSValue.zig:1703). Lives here (not in `bun_sys_jsc`) because the orphan
/// rule requires either the trait or the type to be local; `FromJsEnum` is.
impl FromJsEnum for bun_sys::SignalCode {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        if !v.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{property_name} must be a string"
            )));
        }
        let s = bun_string_jsc::from_js(v, global)?;
        let utf8 = s.to_utf8();
        let hit = bun_sys::signal_code::MAP.get(utf8.slice()).copied();
        drop(utf8);
        s.deref();
        match hit {
            Some(code) => Ok(code),
            // Zig builds the `'SIGHUP', 'SIGINT' or ...` list at comptime; at
            // 31 variants the runtime port keeps the message terse.
            None => Err(global.throw_invalid_arguments(format_args!(
                "{property_name} must be one of the SignalCode names"
            ))),
        }
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

#[path = "RefString.rs"]
pub mod ref_string;
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


pub type ErrorableResolvedSource = Errorable<ResolvedSource>;
pub type ErrorableZigString = Errorable<bun_string::ZigString>;
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

// LAYERING: `jsc.zig:121-124` re-exports `Jest`/`TestScope`/`Expect`/`Snapshot`
// from `../runtime/test_runner/` — a forward-dep on `bun_runtime`, which itself
// depends on `bun_jsc`. The Zig side gets away with this via lazy compilation;
// in Rust it is a hard cycle. The Zig spec already marks these
// `// TODO: move into bun.api`, so the Rust port executes that TODO: callers
// reference `bun_runtime::test_runner::{jest, expect, snapshot}` directly
// instead of routing through `bun_jsc`. No alias is exported here.

pub use self::js_property_iterator::JSPropertyIterator;

#[path = "event_loop.rs"] pub mod event_loop;
pub use self::event_loop as EventLoop;
pub use self::event_loop::{
    AbstractVM, AnyEventLoop, AnyTask, AnyTaskWithExtraContext, ConcurrentCppTask,
    ConcurrentPromiseTask, ConcurrentTask, CppTask, DeferredTaskQueue, EventLoopHandle,
    EventLoopKind, EventLoopTask, EventLoopTaskPtr, GarbageCollectionController, JsTerminated,
    JsTerminatedResult,
    JsVM, ManagedTask, MiniEventLoop, MiniVM, PosixSignalHandle, PosixSignalTask, Task, WorkPool,
    WorkPoolTask, WorkTask, WorkTaskContext,
};
#[cfg(unix)]
pub type PlatformEventLoop = bun_uws::Loop;
#[cfg(not(unix))]
pub type PlatformEventLoop = bun_aio::Loop;

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
/// `jsc.zig:170 markBinding(@src())` — opt-in `BUN_DEBUG_JSC=1` trace of every
/// FFI binding entry. Zig: `log("{s} ({s}:{d})", .{src.fn_name, src.file, src.line})`
/// where `log = Output.scoped(.JSC, .hidden)`.
///
/// LAYERING: the `JSC` scoped logger lives in `bun_core::Global::JSC_SCOPE` (it
/// has no jsc dep) so lower-tier crates can mark bindings without depending on
/// `bun_jsc`. This fn is the thin wrapper `jsc.zig` exposes for in-crate use.
///
/// PORT NOTE: `std.builtin.SourceLocation.fn_name` has no Rust equivalent;
/// `#[track_caller]` only surfaces file/line, so the leading `{fn_name}` is
/// dropped. Prefer the `mark_binding!()` macro form (re-exported above) which
/// captures `module_path!()` at the call site.
#[track_caller]
#[inline]
pub fn mark_binding() {
    if cfg!(debug_assertions) && bun_core::Global::JSC_SCOPE.is_visible() {
        let loc = core::panic::Location::caller();
        bun_core::Global::JSC_SCOPE
            .log(format_args!("[jsc] ({}:{})\n", loc.file(), loc.line()));
    }
}

/// `jsc.zig:173 markMemberBinding(class, @src())` —
/// `log("{s}.{s} ({s}:{d})", .{class, src.fn_name, src.file, src.line})`.
#[inline]
pub fn mark_member_binding(class: &'static str, src: &core::panic::Location<'static>) {
    if cfg!(debug_assertions) && bun_core::Global::JSC_SCOPE.is_visible() {
        bun_core::Global::JSC_SCOPE
            .log(format_args!("[jsc] {} ({}:{})\n", class, src.file(), src.line()));
    }
}

// LAYERING: `jsc.zig:183` aliases `Subprocess = bun.api.Subprocess`, but that
// type lives in `bun_runtime::api` (forward-dep). The Rust port drops the
// alias; callers reference `bun_runtime::api::Subprocess` directly.

/// Generated classes — re-run generate-classes.ts with .rs output.
pub mod codegen {
    // GENERATED: re-run src/codegen/generate-classes.ts with .rs output
    pub mod js {
        /// Generic accessor for the JSC constructor of a `#[bun_jsc::JsClass]` type.
        /// The per-class extern (`${TypeName}__getConstructor`) is wired by the
        /// `#[bun_jsc::JsClass]` proc-macro into [`JsClass::get_constructor`];
        /// this generic just fronts that trait method (mirrors codegen
        /// `pub fn getConstructor(global) JSValue` in
        /// generate-classes.ts:2449).
        #[inline]
        pub fn get_constructor<T: crate::JsClass>(global: &crate::JSGlobalObject) -> crate::JSValue {
            T::get_constructor(global)
        }
    }
}
pub use self::codegen as Codegen;
/// `jsc.zig:202` — `GeneratedClassesList = @import("./generated_classes_list.zig").Classes`.
pub use self::generated_classes_list::Classes as GeneratedClassesList;


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

/// Extension trait providing JSC-aware methods on `bun_string::ZigString`.
/// Mirrors `ZigString.toErrorInstance` / `ZigString.toTypeErrorInstance`
/// (src/string/ZigString.zig) which are used directly at call sites in Zig.
pub trait ZigStringJsc {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue;
}
impl ZigStringJsc for bun_string::ZigString {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `self` is borrowed for the call; `global` is live.
        unsafe { ZigString__toErrorInstance(self, global) }
    }
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `self` is borrowed for the call; `global` is live.
        unsafe { ZigString__toTypeErrorInstance(self, global) }
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
    /// `bun.sys.Error.toSystemError()` (src/sys/Error.zig:toSystemError).
    ///
    /// The full errno→code/message/path/syscall/dest/fd mapping is implemented
    /// once in `bun_sys::Error::to_system_error()` (returning the lower-tier
    /// `bun_sys::SystemError`, which has the same field set but is not
    /// `#[repr(C)]`). This impl re-packs that result into the FFI-layout
    /// [`SystemError`] expected by `SystemError__toErrorInstance`.
    fn to_system_error(&self) -> SystemError {
        let sys = bun_sys::Error::to_system_error(self);
        SystemError {
            errno: sys.errno,
            code: sys.code,
            message: sys.message,
            path: sys.path,
            syscall: sys.syscall,
            hostname: sys.hostname,
            fd: sys.fd,
            dest: sys.dest,
        }
    }
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
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
/// Spec `msgToJS` (src/logger_jsc/logger_jsc.zig:23) — wrap a single `Msg` in
/// either a `BuildMessage` or `ResolveMessage` JS cell, dispatching on metadata.
fn msg_to_js(msg: &bun_logger::Msg, global: &JSGlobalObject) -> JsResult<JSValue> {
    match msg.metadata {
        bun_logger::Metadata::Build => BuildMessage::create(global, msg.clone()?),
        bun_logger::Metadata::Resolve(_) => ResolveMessage::create(global, msg, b""),
    }
}
impl LogJsc for bun_logger::Log {
    fn to_js(&self, global: &JSGlobalObject, message: &str) -> JsResult<JSValue> {
        let msgs = &self.msgs;
        // Spec: `@min(msgs.len, errors_stack.len)` — errors_stack is `[256]JSValue`.
        let count = msgs.len().min(256);
        match count {
            0 => Ok(JSValue::UNDEFINED),
            1 => msg_to_js(&msgs[0], global),
            _ => {
                let mut errors_stack: Vec<JSValue> = Vec::with_capacity(count);
                for msg in &msgs[0..count] {
                    errors_stack.push(msg_to_js(msg, global)?);
                }
                let out = bun_string::ZigString::init(message.as_bytes());
                global.create_aggregate_error(&errors_stack, &out)
            }
        }
    }
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let msgs = &self.msgs;
        let arr = JSValue::create_empty_array(global, msgs.len())?;
        for (i, msg) in msgs.iter().enumerate() {
            arr.put_index(global, u32::try_from(i).unwrap(), msg_to_js(msg, global)?)?;
        }
        Ok(arr)
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
#[path = "BuildMessage.rs"]
pub mod build_message;
pub use self::build_message::BuildMessage;

#[path = "ResolveMessage.rs"]
pub mod resolve_message;
pub use self::resolve_message::ResolveMessage;

pub use self::zig_exception::ZigException;

/// Trait implemented by `#[bun_jsc::JsClass]`-derived types. The proc-macro
/// emits `to_js`/`from_js`/`from_js_direct` per type; this is the trait shape.
pub trait JsClass: Sized {
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn from_js(value: JSValue) -> Option<*mut Self>;
    fn from_js_direct(value: JSValue) -> Option<*mut Self>;

    /// Fetch the JSC constructor object for this class
    /// (`${TypeName}__getConstructor(global)` — generate-classes.ts:2449/2539).
    /// The proc-macro wires the per-type extern; manual impls bind it directly.
    ///
    /// Classes declared `noConstructor: true` in `.classes.ts` get NO C++-side
    /// `${T}__getConstructor` export, so the default body returns `undefined`
    /// instead of forcing every `#[JsClass(no_constructor)]` site to declare a
    /// dangling extern.
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        let _ = global;
        JSValue::UNDEFINED
    }

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

/// `jsc.zig:239` — `Error = @import("ErrorCode").Error`. The codegen module
/// (`build/*/codegen/ErrorCode.zig`) defines `pub const Error = enum(u16)`;
/// the Rust port of that enum is [`ErrorCode`] (`src/jsc/ErrorCode.rs`), so
/// this alias resolves to the same type under both names.
pub type Error = ErrorCode;

/// Maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52).
pub const INIT_TIMESTAMP: JSTimeType = (1u64 << 52) - 1;
// TODO(port): Zig u52 — Rust has no u52. Using u64.
pub type JSTimeType = u64;

/// `jsc.zig:245 toJSTime(sec, nsec)`. Zig: `@intCast` (safety-checked sign
/// cast) into `u64`, then `@truncate(u52)`. Compute in `i128` first so the
/// `sec * 1000` widening cannot overflow `isize`, then cast to `u64` (matching
/// `@intCast` for non-negative inputs) before masking to 52 bits (`@truncate`).
pub fn to_js_time(sec: isize, nsec: isize) -> JSTimeType {
    const NS_PER_MS: i128 = 1_000_000;
    const MS_PER_S: i128 = 1_000;
    let millisec = (nsec as i128) / NS_PER_MS;
    let total = (sec as i128) * MS_PER_S + millisec;
    (total as u64) & ((1u64 << 52) - 1)
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
//   confidence: medium
//   notes:      crate root + submodule wiring. Deprecated `WebCore`/`API`/
//               `Node`/`Subprocess` aliases dropped (see crate doc-header).
// ──────────────────────────────────────────────────────────────────────────
