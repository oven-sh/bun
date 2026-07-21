//! Bindings to JavaScriptCore and other JavaScript primitives such as
//! VirtualMachine, JSGlobalObject (Zig::GlobalObject), and the event loop.
//!
//! Web and runtime-specific APIs should go in `bun.webcore` and `bun.api`.
//!
//! LAYERING: no `WebCore`/`API`/`Node`/`Subprocess` aliases are exported here.
//! Those targets live in `bun_runtime`, which depends on this crate —
//! re-exporting them here would create a cycle. Callers reference
//! `bun_runtime::{webcore,api,node}` directly; lower-tier consumers that
//! constructed those types (e.g. `output_file_jsc`, `BlobArrayBuffer_deallocator`)
//! have been moved up into `bun_runtime`, and the few that only need an opaque
//! borrow (e.g. `DOMFormData::for_each`) are generic over the caller's `Blob`.

#![allow(deprecated, non_snake_case)]
#![allow(unexpected_cfgs)]
// `ConsoleObject::Formatter::print_as` dispatches on `const FORMAT: Tag`.
// `Tag` is a fieldless enum, so this is the structural-match subset of the
// feature.
#![feature(adt_const_params)]
// `#[thread_local]` for the per-JS-thread VM holder and adjacent hot
// per-callback statics — bare `__thread`/`.tbss` instead of the
// `thread_local!` macro's `LocalKey::__getit` wrapper. node:http perf showed
// the wrapper as the next-largest single fan-in after the e0204b3/80284f8
// accessor inlining (every `VirtualMachine::get_or_null()` ≥3×/run_callback).
// Precedent: 064951400fa4 did this for `bun_alloc`/`bun_ast`.
#![feature(thread_local)]
#![allow(incomplete_features)]

extern crate alloc;
// Allow `::bun_jsc::…` paths emitted by the proc-macros to resolve when used
// inside this crate (e.g. `#[JsClass]` on `BuildMessage`).
extern crate self as bun_jsc;

use core::ffi::{c_char, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Proc-macro re-exports. `#[bun_jsc::host_fn]` / `#[bun_jsc::JsClass]` /
// `#[bun_jsc::host_call]` are implemented in the `bun_jsc_macros` crate
// (Rust forbids `proc-macro = true` crates from exporting non-macro items).
// See docs/PORTING.md §JSC types and src/codegen/generate-classes.ts for the
// symbol-naming contract the macros uphold.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_jsc_macros::{JsClass, JsClassDerive, codegen_cached_accessors, host_call, host_fn};

/// The calling convention used for JavaScript functions <> Native.
///
/// Rust cannot express an ABI as a runtime value
/// — `extern "..."` takes a string literal, not an expression. The
/// `#[bun_jsc::host_fn]` / `#[bun_jsc::host_call]` attribute macros emit the
/// correct ABI per-target instead. See PORTING.md §FFI / §JSC types.
#[cfg(all(windows, target_arch = "x86_64"))]
pub const CONV: &str = "sysv64";
#[cfg(not(all(windows, target_arch = "x86_64")))]
pub const CONV: &str = "C";

// ──────────────────────────────────────────────────────────────────────────
// Submodules. Each `#[path]` points at the actual PascalCase / snake_case
// .rs file.
// ──────────────────────────────────────────────────────────────────────────
pub mod error;
pub use error::{Error as CrateError, Result as CrateResult};
#[path = "CommonAbortReason.rs"]
pub mod common_abort_reason;
#[path = "CustomGetterSetter.rs"]
pub mod custom_getter_setter;
#[path = "ErrorCode.rs"]
pub mod error_code;
#[path = "Errorable.rs"]
pub mod errorable;
#[path = "EventType.rs"]
pub mod event_type;
#[path = "GetterSetter.rs"]
pub mod getter_setter;
#[path = "JSCell.rs"]
pub mod js_cell;
#[path = "JSErrorCode.rs"]
pub mod js_error_code;
#[path = "JSMap.rs"]
pub mod js_map;
#[path = "JSPromiseRejectionOperation.rs"]
pub mod js_promise_rejection_operation;
#[path = "JSRuntimeType.rs"]
pub mod js_runtime_type;
#[path = "JSUint8Array.rs"]
pub mod js_uint8_array;
#[path = "MarkedArgumentBuffer.rs"]
pub mod marked_argument_buffer;
#[path = "RegularExpression.rs"]
pub mod regular_expression;
#[path = "ScriptExecutionStatus.rs"]
pub mod script_execution_status;
#[path = "sizes.rs"]
pub mod sizes;
#[path = "SourceProvider.rs"]
pub mod source_provider;
#[path = "SourceType.rs"]
pub mod source_type;
#[path = "TextCodec.rs"]
pub mod text_codec;
#[path = "URLSearchParams.rs"]
pub mod url_search_params;
#[path = "WTF.rs"]
pub mod wtf;
#[path = "ZigErrorType.rs"]
pub mod zig_error_type;
#[path = "ZigStackFrameCode.rs"]
pub mod zig_stack_frame_code;
#[path = "ZigStackFramePosition.rs"]
pub mod zig_stack_frame_position;

/// `bun.schema.api` types that reference `ZigStackFramePosition` (this crate)
/// and so cannot live in `bun_options_types::schema::api` without a dep cycle.
pub mod schema_api {
    use crate::ZigStackFramePosition;

    /// Non-exhaustive stack-frame scope tag. Newtype keeps any-u8 FFI-safe.
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

    /// Line/column position of a stack frame (FFI layout shared with C++).
    pub type StackFramePosition = ZigStackFramePosition;

    /// One captured stack frame: function name, file, position, and scope (FFI layout shared with C++).
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

    /// A line of source text with its line number, used for error previews.
    #[derive(Clone, Default)]
    pub struct SourceLine {
        /// line
        pub line: i32,
        /// text
        pub text: Box<[u8]>,
    }

    /// A captured stack trace: frames plus the source lines used to render previews.
    #[derive(Clone, Default)]
    pub struct StackTrace {
        /// source_lines
        pub source_lines: Vec<SourceLine>,
        /// frames
        pub frames: Vec<StackFrame>,
    }

    /// Lives here (not `bun_options_types::schema::api`) because `stack`'s
    /// [`StackTrace`] transitively names `ZigStackFramePosition` from this
    /// crate; the `bun_options_types` copy omits `stack` to avoid the cycle.
    #[derive(Clone, Default)]
    pub struct JsException {
        pub name: Box<[u8]>,
        pub message: Box<[u8]>,
        pub runtime_type: u16,
        pub code: u16,
        pub stack: StackTrace,
    }
}
#[path = "array_buffer.rs"]
pub mod array_buffer;
#[path = "CommonStrings.rs"]
pub mod common_strings;
#[path = "ConsoleObject.rs"]
pub mod console_object;
#[path = "Counters.rs"]
pub mod counters;
#[path = "DecodedJSValue.rs"]
pub mod decoded_js_value;
#[path = "DeprecatedStrong.rs"]
pub mod deprecated_strong;
#[path = "DOMURL.rs"]
pub mod dom_url;
#[path = "Exception.rs"]
pub mod exception;
#[path = "ipc.rs"]
pub mod ipc;
#[path = "JSArray.rs"]
pub mod js_array;
#[path = "JSBigInt.rs"]
pub mod js_big_int;
#[path = "JSFunction.rs"]
pub mod js_function;
#[path = "JSModuleLoader.rs"]
pub mod js_module_loader;
#[path = "JSPromise.rs"]
pub mod js_promise;
#[path = "JSRef.rs"]
pub mod js_ref;
#[path = "JSType.rs"]
pub mod js_type;
#[path = "JSValue.rs"]
pub mod js_value;
#[path = "rare_data.rs"]
pub mod rare_data;
#[path = "StringBuilder.rs"]
pub mod string_builder;
#[path = "Strong.rs"]
pub mod strong;
#[path = "Task.rs"]
pub mod task;
#[path = "TopExceptionScope.rs"]
pub mod top_exception_scope;
#[path = "uuid.rs"]
pub mod uuid;
#[path = "Weak.rs"]
pub mod weak;
#[path = "ZigString.rs"]
pub mod zig_string;

pub use self::js_value::{
    BackingInt, CoerceTo, ComparisonResult, ForEachCallback, FromAny, FromJsEnum, JSValue,
    PropertyIteratorFn, Protected as ProtectedJSValue, ProxyField, ProxyInternalField,
    SerializedFlags, SerializedScriptValue,
};

// LAYERING (PORTING.md §Dispatch): the task dispatch covers every concrete
// task variant — most of which live in
// `bun_runtime`. Per the §Dispatch convention, this crate
// stores the erased `(tag, *mut ())` `Task` and exposes the queue; the high
// tier (`bun_runtime::dispatch::tick_queue_with_count`) owns the `match` loop
// and is wired into `event_loop::tick` directly at link time. No fn-pointer
// hook is re-exported from the crate root.
pub use self::array_buffer::{
    ArrayBuffer, BinaryType, JSCArrayBuffer, MarkedArrayBuffer, TypedArrayType,
};
pub use self::console_object as ConsoleObject;
pub use self::console_object::Formatter;
/// `ConsoleObject.Formatter.Tag` re-exported under both names downstream
/// drafts use (`FormatAs::Double` in Response.rs, `FormatTag::Private` in
/// Request.rs / S3Client.rs). Same enum; the split is naming drift only.
pub use self::console_object::formatter::Tag as FormatTag;
pub use self::console_object::formatter::Tag as FormatAs;
pub use self::js_array_iterator::JSArrayIterator;
pub use self::js_promise::JSPromise;
/// `JSInternalPromise` was removed upstream; the module loader uses `JSPromise`
/// everywhere now. Alias kept for existing call sites.
pub use self::js_promise::JSPromise as JSInternalPromise;
pub use self::rare_data as RareData;
pub use self::system_error::SystemError;
pub use self::task::Taskable;

/// Trait surface for `write_format`-style hooks on runtime types
/// (`Response::write_format`, `Request::write_format`, `S3File::write_format`,
/// …). Callers only ever touch `globalThis` and `printAs`, so the trait
/// exposes just those two and the `bun_jsc::Formatter` struct provides the
/// canonical impl.
pub trait ConsoleFormatter {
    fn global_this(&self) -> &JSGlobalObject;
    fn print_as<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        tag: FormatTag,
        writer: &mut W,
        value: JSValue,
        cell: JSType,
    ) -> JsResult<()>;

    /// `formatter.indent += 1` — bump nesting level for the duration of a
    /// `{ … }` block. Paired with [`indent_dec`]. Prefer [`IndentScope`] over
    /// calling this pair manually when the indented region contains `?` early
    /// returns.
    fn indent_inc(&mut self);
    /// Saturating decrement of the nesting level.
    fn indent_dec(&mut self);
    /// Shorthand for [`IndentScope::new`]. Shadow the binding for the indented
    /// block; the guard `Deref`s to `&mut Self` so method calls auto-deref, and
    /// `Drop` restores the indent on every exit path (including `?`).
    #[inline]
    fn indented(&mut self) -> IndentScope<'_, Self> {
        IndentScope::new(self)
    }
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

/// RAII indent guard for [`ConsoleFormatter`].
///
/// Increments on construction, decrements on `Drop`. `Deref`s to the wrapped
/// formatter so the guard can shadow the original binding for the indented
/// block:
///
/// ```ignore
/// {
///     let mut formatter = IndentScope::new(&mut *formatter);
///     formatter.write_indent(writer)?;   // auto-derefs to &mut F
///     // …
/// } // indent restored here, even on `?` early-return
/// ```
pub struct IndentScope<'a, F: ConsoleFormatter + ?Sized>(&'a mut F);

impl<'a, F: ConsoleFormatter + ?Sized> IndentScope<'a, F> {
    #[inline]
    pub fn new(f: &'a mut F) -> Self {
        f.indent_inc();
        Self(f)
    }
}
impl<F: ConsoleFormatter + ?Sized> core::ops::Deref for IndentScope<'_, F> {
    type Target = F;
    #[inline]
    fn deref(&self) -> &F {
        self.0
    }
}
impl<F: ConsoleFormatter + ?Sized> core::ops::DerefMut for IndentScope<'_, F> {
    #[inline]
    fn deref_mut(&mut self) -> &mut F {
        self.0
    }
}
impl<F: ConsoleFormatter + ?Sized> Drop for IndentScope<'_, F> {
    #[inline]
    fn drop(&mut self) {
        self.0.indent_dec();
    }
}

impl<'a> ConsoleFormatter for self::console_object::Formatter<'a> {
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        self.global_this
    }
    #[inline]
    fn indent_inc(&mut self) {
        self.indent += 1;
    }
    #[inline]
    fn indent_dec(&mut self) {
        self.indent = self.indent.saturating_sub(1);
    }
    #[inline]
    fn reset_line(&mut self) {
        self::console_object::Formatter::reset_line(self)
    }
    fn write_indent<W: core::fmt::Write>(&self, writer: &mut W) -> core::fmt::Result {
        // Inherent `Formatter::write_indent` takes `&mut dyn bun_io::Write`;
        // bridge the `core::fmt::Write` sink the same way `print_as` does.
        let mut sink = bun_io::FmtAdapter::new(writer);
        self::console_object::Formatter::write_indent(self, &mut sink).map_err(|_| core::fmt::Error)
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

pub use self::counters::Counters;
pub use self::decoded_js_value::DecodedJSValue;
pub use self::deprecated_strong::DeprecatedStrong;
pub use self::js_array::JSArray;
pub use self::js_ref::JsRef;
pub use self::string_builder::StringBuilder;
pub use self::uuid::{UUID, UUID5, UUID7};

pub use self::js_function::JSFunction;
pub use self::js_module_loader::JSModuleLoader;
pub use self::strong::{Optional as StrongOptional, Strong};
pub use self::weak::{Weak, WeakRefType};

pub use self::exception::Exception;
pub use self::js_type::JSType;
pub use self::top_exception_scope::{
    ExceptionValidationScope, ExceptionValidationScopeGuard, SourceLocation, TopExceptionScope,
    TopExceptionScopeGuard, call_check_slow, call_check_slow_at, call_check_slow_owned,
    call_false_is_throw, call_false_is_throw_at, call_null_is_throw, call_null_is_throw_at,
    call_zero_is_throw, call_zero_is_throw_at,
};
/// Generated FFI wrappers for C++ `[[ZIG_EXPORT(mode)]]` functions.
/// Emitted by `src/codegen/cppbind.ts` into
/// `${BUN_CODEGEN_DIR}/cpp.rs` and `include!`d here so every throwing C++ FFI
/// is reachable as `bun_jsc::cpp::Name(...)` with a properly-scoped exception
/// check (no `global.has_exception()` after-the-fact).
pub mod cpp;
pub use self::common_strings::CommonStrings;
pub use self::dom_url::DOMURL;
pub use self::js_big_int::JSBigInt;

pub use self::common_abort_reason::{CommonAbortReason, CommonAbortReasonExt};
pub use self::custom_getter_setter::CustomGetterSetter;
/// Some drafts spell this `jsc::ErrCode` — keep both until call-sites converge.
pub use self::error_code::ErrorCode as ErrCode;
pub use self::error_code::{ErrorBuilder, ErrorCode};
pub use self::errorable::Errorable;
pub use self::event_type::EventType;
pub use self::getter_setter::GetterSetter;
pub use self::js_cell::{JSCell, JsCell};
pub use self::js_error_code::{DOMExceptionCode, JSErrorCode};
pub use self::js_map::JSMap;
pub use self::js_promise_rejection_operation::JSPromiseRejectionOperation;
pub use self::js_runtime_type::JSRuntimeType;
pub use self::js_uint8_array::JSUint8Array;
pub use self::marked_argument_buffer::MarkedArgumentBuffer;
pub use self::regular_expression::RegularExpression;
pub use self::script_execution_status::ScriptExecutionStatus;
pub use self::source_provider::SourceProvider;
pub use self::source_type::SourceType;
pub use self::text_codec::TextCodec;
pub use self::url_search_params::URLSearchParams;
pub use self::zig_error_type::ZigErrorType;
pub use self::zig_stack_frame_code::ZigStackFrameCode;
pub use self::zig_stack_frame_position::ZigStackFramePosition;

#[path = "GarbageCollectionController.rs"]
pub mod garbage_collection_controller;

// ──────────────────────────────────────────────────────────────────────────
// `#[no_mangle]` export modules — compiled so the C++ side links against the
// real symbols.
// ──────────────────────────────────────────────────────────────────────────
#[path = "AbortSignal.rs"]
pub mod abort_signal;
#[path = "btjs.rs"]
pub mod btjs;
#[path = "CppTask.rs"]
pub mod cpp_task;
#[path = "fmt_jsc.rs"]
pub mod fmt_jsc;
#[path = "HTTPServerAgent.rs"]
pub mod http_server_agent;
#[path = "JSSecrets.rs"]
pub mod js_secrets;
#[path = "NodeModuleModule.rs"]
pub mod node_module_module;
#[path = "PluginRunner.rs"]
pub mod plugin_runner;
#[path = "PosixSignalHandle.rs"]
pub mod posix_signal_handle;
#[path = "resolve_path_jsc.rs"]
pub mod resolve_path_jsc;
#[path = "resolver_jsc.rs"]
pub mod resolver_jsc;
#[path = "virtual_machine_exports.rs"]
pub mod virtual_machine_exports;

#[rustfmt::skip]
#[path = "host_fn.rs"] pub mod host_fn;
#[path = "AnyPromise.rs"]
pub mod any_promise;
#[path = "CachedBytecode.rs"]
pub mod cached_bytecode;
#[path = "DeferredError.rs"]
pub mod deferred_error;
#[path = "DOMFormData.rs"]
pub mod dom_form_data;
#[path = "host_object.rs"]
pub mod host_object;
#[path = "JSArrayIterator.rs"]
pub mod js_array_iterator;
#[path = "JSGlobalObject.rs"]
pub mod js_global_object;
#[path = "JSPropertyIterator.rs"]
pub mod js_property_iterator;
#[path = "SystemError.rs"]
pub mod system_error;
#[path = "URL.rs"]
pub mod url;
#[path = "VM.rs"]
pub mod vm;
#[path = "ZigException.rs"]
pub mod zig_exception;
#[path = "ZigStackFrame.rs"]
pub mod zig_stack_frame;
#[path = "ZigStackTrace.rs"]
pub mod zig_stack_trace;
// `generated_classes_list.rs` is mounted by `bun_runtime` (see its lib.rs) —
// every aliased type lives in api/webcore/test_runner/bake, so mounting it
// here would create a `bun_jsc → bun_runtime` cycle.
#[path = "AsyncModule.rs"]
pub mod async_module;
#[path = "bindgen.rs"]
pub mod bindgen;
#[path = "bindgen_test.rs"]
pub mod bindgen_test;
#[path = "BunCPUProfiler.rs"]
pub mod bun_cpu_profiler;
#[path = "BunHeapProfiler.rs"]
pub mod bun_heap_profiler;
#[path = "bun_string_jsc.rs"]
pub mod bun_string_jsc;
#[path = "codegen.rs"]
pub mod codegen_mod;
#[path = "comptime_string_map_jsc.rs"]
pub mod comptime_string_map_jsc;
#[path = "ConcurrentPromiseTask.rs"]
pub mod concurrent_promise_task;
#[path = "EventLoopHandle.rs"]
pub mod event_loop_handle;
#[path = "FFI.rs"]
pub mod ffi;
#[path = "JSCScheduler.rs"]
pub mod jsc_scheduler;
#[path = "JSONLineBuffer.rs"]
pub mod json_line_buffer;
#[path = "ProcessAutoKiller.rs"]
pub mod process_auto_killer;
#[path = "WorkTask.rs"]
pub mod work_task;

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) {
    // The counter lives in `bun_core` so this crate doesn't depend on
    // `bun_analytics`.
    bun_core::analytics::Features::jsc_inc();
    let env = bun_sys::environ();
    // One-shot eval invocations (`bun -e ...` / `bun --print ...`) exit before
    // any long-running event loop; tell JSC to skip the worker threads it
    // otherwise spawns eagerly at VM creation (see `JSCInitialize`).
    let one_shot = is_one_shot_eval_invocation();
    // SAFETY: `env` borrows the libc `environ` global for the duration of the
    // call; `on_jsc_invalid_env_var` is `extern "C"` and only reads the (ptr,len)
    // it is handed. JSCInitialize is called exactly once at startup.
    unsafe {
        JSCInitialize(
            env.as_ptr(),
            env.len(),
            on_jsc_invalid_env_var,
            eval_mode,
            one_shot,
        )
    };
}

/// Whether this process was launched as `bun -e <code>` / `bun --eval <code>` /
/// `bun -p <code>` / `bun --print <code>` — i.e. an inline-eval one-shot that
/// runs a trivial script and exits without entering a long-running event loop.
///
/// Kept conservative on purpose: only the explicit eval flags qualify. `bun
/// <file>` is *not* treated as one-shot (it may start a server), so server
/// workloads keep the default multi-threaded JIT/GC configuration.
fn is_one_shot_eval_invocation() -> bool {
    for arg in bun_core::argv().iter().skip(1) {
        if arg == b"-e" || arg == b"--eval" || arg == b"-p" || arg == b"--print" {
            return true;
        }
        if arg.starts_with(b"--eval=") || arg.starts_with(b"--print=") {
            return true;
        }
        // Skip leading flags (e.g. `--smol`) until the first positional, which
        // is the subcommand / entry file — at which point this is not an
        // inline-eval invocation.
        if arg.first() == Some(&b'-') && arg.len() > 1 {
            continue;
        }
        return false;
    }
    false
}

extern "C" fn on_jsc_invalid_env_var(name: *const u8, len: usize) {
    // SAFETY: C++ guarantees `name[..len]` is valid for the call.
    let name = unsafe { bun_core::ffi::slice(name, len) };
    bun_core::err_generic!(
        "invalid JSC environment variable\n\n    <b>{}<r>\n\n\
For a list of options, see this file:\n\n    \
https://github.com/oven-sh/webkit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h\n\n\
Environment variables must be prefixed with \"BUN_JSC_\". This code runs before .env files are loaded, so those won't work here.\n\n\
Warning: options change between releases of Bun and WebKit without notice. This is not a stable API, you should not rely on it beyond debugging something, and it may be removed entirely in a future version of Bun.",
        bstr::BStr::new(name),
    );
    bun_core::exit(1);
}

/// `bun.JSError` — the canonical Bun JS error union (`error{Thrown, OutOfMemory, Terminated}`).
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum JsError {
    /// A JavaScript exception is pending in the VM's exception scope.
    Thrown,
    /// Allocation failure; caller must throw an `OutOfMemoryError`.
    OutOfMemory,
    /// The VM is terminating (worker shutdown / `process.exit`).
    Terminated,
}
/// `bun.JSError!T`. Dropping a `JsResult` swallows a pending JS exception —
/// always `?`-propagate, [`JsResultExt::report_unhandled`], or `let _ =` with a
/// comment justifying the swallow.
///
/// Note: `#[must_use]` cannot be applied to type aliases; `Result` already
/// carries it. We instead `#![warn(unused_must_use)]` in every crate that
/// blanket-`allow(unused)`s so the underlying lint is never silenced.
pub type JsResult<T> = core::result::Result<T, JsError>;

bun_core::oom_from_alloc!(JsError);

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

impl From<JsTerminated> for bun_event_loop::ErasedJsError {
    #[inline]
    fn from(_: JsTerminated) -> Self {
        bun_event_loop::ErasedJsError::Terminated
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

/// Converts `bun.JSError` → `std.Io.Writer.Error` for Console formatting paths.
/// `Display` impls return `fmt::Error`; the JS exception, if any, remains on the VM.
#[inline]
pub fn js_error_to_write_error(e: JsError) -> core::fmt::Error {
    match e {
        // TODO: this might lose a JSTerminated, causing m_terminationException problems
        JsError::Terminated => core::fmt::Error,
        // TODO: this might lose a JSError, causing exception check problems
        JsError::Thrown => core::fmt::Error,
        // `bun.handleOom(error.OutOfMemory)` — panic-on-OOM wrapper fed a literal OOM,
        // i.e. unconditionally abort.
        JsError::OutOfMemory => bun_alloc::out_of_memory(),
    }
}

impl From<JsTerminated> for JsError {
    fn from(_: JsTerminated) -> Self {
        JsError::Terminated
    }
}

/// Extension surface for [`JsResult`]. Gives every `JsResult` a terminal sink
/// so the `unused_must_use` lint can be satisfied without `let _ =` at call
/// sites that legitimately cannot `?`-propagate (FFI thunks, drop glue,
/// fire-and-forget callbacks).
pub trait JsResultExt {
    /// Consume the result; if `Err`, take the pending exception off `global`
    /// and route it through the VM's uncaught-exception handler. Returns the
    /// `Ok` payload (or its `Default`) so callers can chain.
    ///
    /// Use this when an error has nowhere left to bubble — never to paper over
    /// a missing `?`.
    fn report_unhandled(self, global: &JSGlobalObject);
}

impl<T> JsResultExt for JsResult<T> {
    #[inline]
    fn report_unhandled(self, global: &JSGlobalObject) {
        if let Err(e) = self {
            // `Terminated` carries no exception value to report — the VM is
            // already unwinding. `OutOfMemory`/`Thrown` both leave a pending
            // exception that `report_uncaught_exception_from_error` will take.
            if e != JsError::Terminated {
                global.report_uncaught_exception_from_error(e);
            }
        }
    }
}

impl From<crate::CrateError> for JsError {
    fn from(_: crate::CrateError) -> Self {
        // Mapping to `Thrown` here lets `?` propagate while the actual throw
        // is handled by the host-fn wrapper.
        JsError::Thrown
    }
}

impl From<JsError> for crate::CrateError {
    /// Widen a `bun.JSError` value back into the crate error enum. Preserves
    /// the exact error tag so call sites that round-trip through it (e.g. the
    /// `bun_bundler::dispatch::DevServerVTable` boundary) keep
    /// `error.OutOfMemory` distinguishable from `error.JSError`.
    #[inline]
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => crate::CrateError::Alloc(bun_alloc::AllocError),
            // `Terminated` (worker shutdown) has no distinct error tag of its
            // own, so collapse into `JSError` like every other thrown JS
            // exception.
            JsError::Thrown | JsError::Terminated => crate::CrateError::JSError,
        }
    }
}

/// Adapter for `(fmt, args)`-style throw helpers.
///
/// Call sites pass either `()`
/// (no interpolation — message *is* the literal) or a pre-expanded
/// `format_args!(..)` (interpolation already applied — message *is* the
/// `Arguments` value). This trait dispatches both shapes onto the canonical
/// [`JSGlobalObject::throw`] / [`JSGlobalObject::throw_invalid_arguments`]
/// without requiring every caller to wrap a literal in `format_args!("")`.
pub trait ThrowFmtArgs: Sized {
    /// `globalThis.throw(fmt, args)` — throw a generic `Error`.
    fn dispatch_throw(self, global: &JSGlobalObject, fmt: &'static str) -> JsError;
    /// `globalThis.throwInvalidArguments(fmt, args)` — throw `ERR_INVALID_ARG_TYPE`.
    fn dispatch_throw_invalid_arguments(
        self,
        global: &JSGlobalObject,
        fmt: &'static str,
    ) -> JsError;
}
impl ThrowFmtArgs for () {
    #[inline]
    fn dispatch_throw(self, global: &JSGlobalObject, fmt: &'static str) -> JsError {
        // No interpolation; the literal IS the message. Route
        // through `throw` with an `Arguments` whose `as_str()` is `Some(fmt)`
        // so `create_error_instance` hits its static-string fast path.
        global.throw(format_args!("{fmt}"))
    }
    #[inline]
    fn dispatch_throw_invalid_arguments(
        self,
        global: &JSGlobalObject,
        fmt: &'static str,
    ) -> JsError {
        global.throw_invalid_arguments(format_args!("{fmt}"))
    }
}
impl ThrowFmtArgs for core::fmt::Arguments<'_> {
    #[inline]
    fn dispatch_throw(self, global: &JSGlobalObject, _fmt: &'static str) -> JsError {
        global.throw(self)
    }
    #[inline]
    fn dispatch_throw_invalid_arguments(
        self,
        global: &JSGlobalObject,
        _fmt: &'static str,
    ) -> JsError {
        global.throw_invalid_arguments(self)
    }
}

/// Re-exported for `jsc_macros`-generated code (`to_js`/`to_js_boxed`), which
/// must use absolute `::bun_jsc::` paths and cannot assume `::bun_core` is in
/// the consumer crate's dep graph.
pub use bun_core::heap;
/// Debug-only binding-presence marker.
/// MOVE_DOWN: the macro lives in `bun_core` (no jsc dep) so `bun_io` /
/// `bun_http_jsc` / `bun_event_loop` can call it without a `bun_jsc` cycle.
/// Re-exported here so existing `crate::mark_binding!()` call sites resolve.
pub use bun_core::mark_binding;

pub use self::host_fn::{
    JSHostFn, JSHostFnZig, JSHostFnZigWithContext, JSHostFunctionTypeWithContext,
    from_js_host_call, from_js_host_call_generic, from_js_host_call_owned, host_construct_result,
    host_fn_result, host_setter_result, to_js_host_call, to_js_host_fn, to_js_host_fn_result,
    to_js_host_fn_with_context,
};
pub use self::host_object::{HostFnEntry, create_host_function_object};

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
    /// `JsResult<JSValue>`.
    pub trait IntoHostFnResult {
        fn into_host_fn_result(self) -> JsResult<JSValue>;
    }
    impl IntoHostFnResult for JSValue {
        #[inline]
        fn into_host_fn_result(self) -> JsResult<JSValue> {
            Ok(self)
        }
    }
    impl IntoHostFnResult for JsResult<JSValue> {
        #[inline]
        fn into_host_fn_result(self) -> JsResult<JSValue> {
            self
        }
    }

    /// Normalizes a `construct` body's return type — `*mut T`, `Box<T>`, or
    /// `JsResult<_>` of either — to a nullable `*mut c_void`.
    pub trait IntoConstructResult {
        fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void>;
    }
    impl<T> IntoConstructResult for *mut T {
        #[inline]
        fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> {
            Ok(self.cast())
        }
    }
    impl<T> IntoConstructResult for alloc::boxed::Box<T> {
        #[inline]
        fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> {
            Ok(bun_core::heap::into_raw(self).cast())
        }
    }
    impl<T> IntoConstructResult for JsResult<*mut T> {
        #[inline]
        fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> {
            self.map(|p| p.cast())
        }
    }
    impl<T> IntoConstructResult for JsResult<alloc::boxed::Box<T>> {
        #[inline]
        fn into_construct_ptr(self) -> JsResult<*mut ::core::ffi::c_void> {
            self.map(|b| bun_core::heap::into_raw(b).cast())
        }
    }

    /// Map a `JsResult<JSValue>` from a Rust host fn to the raw `JSValue` the
    /// JSC ABI expects (`.ZERO` when an exception is/was thrown).
    /// Installs an `ExceptionValidationScope`
    /// pinned at the macro caller's `Location` and asserts the empty/thrown
    /// invariant.
    ///
    /// Takes a closure (not a value) so the user-fn body runs *inside*
    /// `to_js_host_call`'s `catch_unwind` barrier — a `panic!` in the body
    /// becomes a JS exception instead of unwinding out of the `extern "C"`
    /// thunk (UB).
    #[inline]
    #[track_caller]
    pub fn host_fn_result<R: IntoHostFnResult>(
        global: &JSGlobalObject,
        f: impl FnOnce() -> R,
    ) -> JSValue {
        // `to_js_host_call` is
        // `#[track_caller]` so the caller's `Location` propagates through this
        // `#[track_caller]` shim into `ExceptionValidationScope::init`.
        super::host_fn::to_js_host_call(global, move || f().into_host_fn_result())
    }

    /// Setter result mapping: `()` / `JsResult<()>` → `bool` (false on throw).
    /// Matches generate-classes.ts setter ABI:
    /// `extern bool ${T}Prototype__${name}(void*, JSGlobalObject*, EncodedJSValue)`.
    ///
    /// Accepts the same [`IntoHostSetterReturn`] surface as
    /// [`super::host_fn::host_setter_result`] so `#[host_fn(setter)]`-tagged
    /// methods type-check against the exact signature the codegen calls.
    /// Takes a closure for the same `catch_unwind` reason as
    /// [`host_fn_result`].
    #[inline]
    #[track_caller]
    pub fn host_fn_setter_result<R>(global: &JSGlobalObject, f: impl FnOnce() -> R) -> bool
    where
        R: super::host_fn::IntoHostSetterReturn,
    {
        super::host_fn::host_setter_result(global, f)
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
        n: u32,
    }
    impl Smoke {
        // Required by the `construct` hook when `no_construct` is omitted; kept
        // here so a future flip exercises it.
        pub fn constructor(_g: &JSGlobalObject, _f: &CallFrame) -> JsResult<*mut Smoke> {
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
        pub fn do_thing(&mut self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
            Ok(JSValue::UNDEFINED)
        }
    }

    // Assert the trait impl exists.
    fn _assert_js_class<T: crate::JsClass>() {}
    fn _wired() {
        _assert_js_class::<Smoke>();
    }
}

// JSC Classes Bindings — re-exported from their per-type modules (declared
// above with `#[path = "…"] pub mod …;`). These were previously placeholder
// newtypes; the real opaque-FFI structs now live in their own files and are
// surfaced here at the crate root.
pub use self::cached_bytecode::CachedBytecode;
pub use self::deferred_error::DeferredError;
pub use self::dom_form_data::DOMFormData;
pub use self::url::URL;
pub use self::zig_stack_frame::ZigStackFrame;
pub use self::zig_stack_trace::ZigStackTrace;
pub use abort_signal::{AbortSignal, AbortSignalRef};

// `VM` / `JSGlobalObject` — opaque FFI handles to C++-owned objects. Defined
// once in their dedicated port files (`VM.rs` / `JSGlobalObject.rs`) and
// re-exported here so `crate::VM` and `crate::vm::VM` name the same nominal
// type (and likewise for `JSGlobalObject`). Both structs carry `UnsafeCell`
// so `&T → *mut T` for FFI is sound under Stacked Borrows.
pub use self::js_global_object::{GlobalRef, JSGlobalObject};
pub use self::vm::{HeapType, Lock as ApiLock, VM};

/// Options for `JSGlobalObject::validate_integer_range` / `validate_bigint_range`.
/// min/max are `i128` so every
/// signed/unsigned primitive's bounds + MIN/MAX_SAFE_INTEGER fit without
/// narrowing. Defined at crate root so `bun_runtime` callers and
/// `JSGlobalObject.rs` (which re-exports it) share one type.
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

// ──────────────────────────────────────────────────────────────────────────
// ResolvedSource — `#[repr(C)]` mirror of the C struct in
// src/jsc/bindings/headers-handwritten.h:115. Passed by value across the
// Rust → C++ module-loader boundary (`ErrorableResolvedSource`).
// ──────────────────────────────────────────────────────────────────────────
#[path = "ResolvedSource.rs"]
pub mod resolved_source;
pub use self::resolved_source::ResolvedSource;

/// `ResolvedSource.Tag` — plain `uint32_t` in C++
/// (`headers-handwritten.h:123`). Modelled as a transparent `u32` newtype so
/// the generated InternalModuleRegistry IDs (`(1 << 9) | id`, see
/// `build/*/codegen/generated_resolved_source_tag.rs`) round-trip without an
/// exhaustive Rust enum.
pub mod resolved_source_tag {
    #[repr(transparent)]
    #[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
    pub struct ResolvedSourceTag(pub u32);

    #[allow(non_upper_case_globals)]
    impl ResolvedSourceTag {
        // Structural variants — keep in lock-step with the generated
        // `build/*/codegen/SyntheticModuleType.h` and
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
        /// InternalModuleRegistry tag (`(1 << 9) | id`).
        ///
        /// Unrecognised names debug-panic / release-fall-back to `Javascript`;
        /// callers feed only `HardcodedModule` strum values, so a miss means a
        /// `HardcodedModule` variant has no matching entry in the generated
        /// module table (`INTERNAL_MODULE_TAG`).
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
        fn default() -> Self {
            Self::Javascript
        }
    }

    // Generated by `src/codegen/bundle-modules.ts` alongside
    // `SyntheticModuleType.h`, so this table can never drift from the
    // generated InternalModuleRegistry module IDs.
    // Defines `INTERNAL_MODULE_TAG`: keys are the canonical specifier strings
    // surfaced by `HardcodedModule`'s `strum::IntoStaticStr` impl (which is
    // what `jsc_hooks::js_synthetic_module` feeds in).
    include!(concat!(
        env!("BUN_CODEGEN_DIR"),
        "/generated_resolved_source_tag.rs"
    ));
}
pub use self::resolved_source_tag::ResolvedSourceTag;

// ──────────────────────────────────────────────────────────────────────────
// FetchHeaders — opaque C++ `WebCore::FetchHeaders` handle plus the
// `HTTPHeaderName` enum used by `fast_get`/`fast_has`/`put`.
// ──────────────────────────────────────────────────────────────────────────
#[path = "FetchHeaders.rs"]
pub mod fetch_headers;
pub use self::fetch_headers::{FetchHeaders, HTTPHeaderName};

/// `BuiltinName` — fast-path property keys preallocated as `JSC::Identifier`s
/// in C++ (`BunBuiltinNames.h`). Passed to `JSValue::fast_get` as a `u8` index
/// into `BuiltinNamesMap` (src/jsc/bindings/bindings.cpp).
///
/// Variant names are lowercase; downstream
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
    // PascalCase aliases for downstream callers (Response.rs / Request.rs /
    // streams.rs / fetch.rs / TextDecoder.rs / pretty_format.rs use these).
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

    pub fn has(property: &[u8]) -> bool {
        Self::get(property).is_some()
    }
    pub fn get(property: &[u8]) -> Option<BuiltinName> {
        BUILTIN_NAME_MAP.get(property).copied()
    }
}

bun_core::comptime_string_map! {
    static BUILTIN_NAME_MAP: BuiltinName = {
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
}

/// RAII guard that keeps a `JSValue` reachable across an FFI call by emitting
/// a use of the value at scope exit. Mirrors `JSC::EnsureStillAliveScope`.
#[repr(transparent)]
pub struct EnsureStillAlive(pub JSValue);
impl Drop for EnsureStillAlive {
    #[inline]
    fn drop(&mut self) {
        self.0.ensure_still_alive();
    }
}

/// `jsc.JSPromise.Strong` — a `Strong.Optional` typed to hold a `JSPromise`.
pub use self::js_promise::Strong as JSPromiseStrong;

/// `JSPromise.Status` — surfaced at the crate root as
/// `PromiseStatus` for downstream callers (web_worker.rs / fetch.rs reference
/// it via `jsc::PromiseStatus::{Pending,Fulfilled,Rejected}`).
pub use self::js_promise::Status as PromiseStatus;

/// `bun_ptr::RefPtr` — intrusive refcounted smart pointer. Re-exported here so
/// `crate::RefPtr<SourceProvider>` (ZigStackTrace.rs) resolves without every
/// submodule taking a direct `bun_ptr` dep.
pub use bun_ptr::RefPtr;

/// `bun.String` — refcounted WTF-backed string. Re-exported at the crate root
/// so submodules can write `crate::String`.
pub use bun_core::String;

/// Legacy alias used by runtime drafts: `VirtualMachineRef` is just the
/// `VirtualMachine` struct itself (callers hold `*mut VirtualMachineRef`).
pub use self::virtual_machine::VirtualMachine as VirtualMachineRef;

/// `jsc.AnyPromise` — `JSPromise | JSInternalPromise`.
pub use self::any_promise::AnyPromise;

pub use self::js_promise::UnwrapMode as PromiseUnwrapMode;

/// `JSPromise.Unwrapped` — surfaced at the crate root as
/// `PromiseResult` for downstream callers (Macro.rs / JSBundler.rs reference it
/// via `jsc::PromiseResult::{Pending,Fulfilled,Rejected}`).
pub use self::js_promise::Unwrapped as PromiseResult;

// `JSPropertyIteratorOptions` / `PropertyIteratorOptions` / `IntoIterObject` are
// defined in `js_property_iterator` and re-exported below alongside
// `JSPropertyIterator`.

// `ZigString` → JS bridges used by the `ZigStringJsc` extension trait below
// (the rest of the `JSGlobalObject` extern surface lives in `JSGlobalObject.rs`).
unsafe extern "C" {
    // safe: `ZigString` is `#[repr(C)]` and read-only across the call; `JSGlobalObject` is an
    // opaque `UnsafeCell`-backed ZST handle. `&T` is ABI-identical to a non-null `*const T`.
    safe fn ZigString__toErrorInstance(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
    ) -> JSValue;
    safe fn ZigString__toTypeErrorInstance(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
    ) -> JSValue;
    safe fn ZigString__toSyntaxErrorInstance(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
    ) -> JSValue;
    safe fn ZigString__toRangeErrorInstance(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
    ) -> JSValue;
    safe fn ZigString__toDOMExceptionInstance(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
        code: u8,
    ) -> JSValue;
    safe fn ZigString__toValueGC(this: &bun_core::ZigString, global: &JSGlobalObject) -> JSValue;
    safe fn ZigString__toAtomicValue(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
    ) -> JSValue;
    // ZigString__toExternalValue: use the generated `cpp::` re-export (canonical signature).
    safe fn ZigString__toJSONObject(this: &bun_core::ZigString, global: &JSGlobalObject)
    -> JSValue;
    // safe: `ZigString`/`JSGlobalObject` are `#[repr(C)]`/opaque-ZST handles (`&`
    // is ABI-identical to non-null `*const`); `ctx` is an opaque round-trip
    // pointer C++ stores into the external string's finalizer slot and forwards
    // to `callback` on GC (never dereferenced as Rust data) — same contract as
    // `JSC__JSGlobalObject__queueMicrotaskCallback`. The caller-side ownership
    // transfer is documented at the (already-safe) public wrapper.
    safe fn ZigString__external(
        this: &bun_core::ZigString,
        global: &JSGlobalObject,
        ctx: *mut core::ffi::c_void,
        callback: unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize),
    ) -> JSValue;
}

// `JSGlobalObject` inherent methods that are NOT covered by the dedicated
// port file (`JSGlobalObject.rs`). The bulk of the surface (throw_*, vm,
// bun_vm, take_exception, …) lives there; this block only adds the handful
// of helpers that grew on the lib.rs side during the port.
impl JSGlobalObject {
    // `vm_ptr()` lives in `JSGlobalObject.rs` (canonical impl block); the
    // duplicate that grew here during the port has been removed to avoid
    // E0034 multiple-applicable-items at every call site.

    /// Two-arg shim for mechanically-ported `throw("fmt", .{…})` call sites.
    /// Dispatches via [`ThrowFmtArgs`] so both `()` and `format_args!(..)`
    /// callers reach [`JSGlobalObject::throw`] with the right `Arguments`.
    #[doc(hidden)]
    #[inline]
    pub fn throw2(&self, fmt: &'static str, args: impl ThrowFmtArgs) -> JsError {
        args.dispatch_throw(self, fmt)
    }

    /// Two-arg shim for mechanically-ported `throwInvalidArguments(fmt, .{…})`
    /// call sites. Dispatches via [`ThrowFmtArgs`].
    #[doc(hidden)]
    #[inline]
    pub fn throw_invalid_arguments2(&self, fmt: &'static str, args: impl ThrowFmtArgs) -> JsError {
        args.dispatch_throw_invalid_arguments(self, fmt)
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
}

/// `bun.fmt.OutOfRangeOptions` — re-exported here under the name dependents
/// expect (`jsc.RangeErrorOptions`).
pub type RangeErrorOptions<'a> = bun_core::fmt::OutOfRangeOptions<'a>;

/// Broken-down calendar date/time exchanged with C++.
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

/// Options for `JSGlobalObject::validate_object`.
#[derive(Default, Copy, Clone)]
pub struct ValidateObjectOpts {
    pub allow_array: bool,
    pub allow_function: bool,
    pub nullable: bool,
}

/// `BunPluginTarget` is defined once
/// in `bun_bundler::transpiler` (lowest tier) and re-exported via
/// `js_global_object` so `crate::BunPluginTarget` and every consumer share one
/// nominal type.
pub use self::js_global_object::BunPluginTarget;

// ──────────────────────────────────────────────────────────────────────────
// JSObject (real module in JSObject.rs).
// ──────────────────────────────────────────────────────────────────────────
#[path = "JSObject.rs"]
pub mod js_object;
pub use self::js_object::{ExternColumnIdentifier, ExternColumnIdentifierValue, JSObject};

// ──────────────────────────────────────────────────────────────────────────
// CallFrame / ArgumentsSlice (real module in CallFrame.rs).
// ──────────────────────────────────────────────────────────────────────────
#[path = "CallFrame.rs"]
pub mod call_frame;
pub use self::call_frame::{ArgumentsSlice, CallFrame};

/// Lives here (not in `bun_sys_jsc`) because the orphan
/// rule requires either the trait or the type to be local; `FromJsEnum` is.
impl FromJsEnum for bun_sys::SignalCode {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        if !v.is_string() {
            return Err(
                global.throw_invalid_arguments(format_args!("{property_name} must be a string"))
            );
        }
        let s = bun_string_jsc::from_js(v, global)?;
        let utf8 = s.to_utf8();
        let hit = bun_sys::signal_code::from_name(utf8.slice());
        drop(utf8);
        s.deref();
        match hit {
            Some(code) => Ok(code),
            None => {
                // Expected-names list
                // (`'SIGHUP', 'SIGINT', … or 'SIGSYS'`), built from the
                // canonical signal X-macro so names are never re-spelled.
                let names = &bun_core::SIGNAL_NAMES[1..];
                let mut one_of = std::string::String::from("'");
                for (i, entry) in names.iter().enumerate() {
                    one_of.push_str(entry);
                    one_of.push('\'');
                    if i < names.len() - 2 {
                        one_of.push_str(", '");
                    } else if i == names.len() - 2 {
                        one_of.push_str(" or '");
                    }
                }
                Err(global.throw_invalid_arguments(format_args!(
                    "{property_name} must be one of {one_of}"
                )))
            }
        }
    }
}

// `FromJsEnum` impls for the `bun_http_types` Fetch* enums. Orphan rule forces
// these here (the trait crate) — `bun_http_types` is jsc-free and `bun_http_jsc`
// owns neither the trait nor the type. Powers
// `JSValue::get_optional_enum::<FetchRedirect>()` in `Request::construct_into`
// / `fetch.rs`. The `to_js` direction stays in `bun_http_jsc::fetch_enums_jsc`.
impl FromJsEnum for bun_http_types::FetchRedirect::FetchRedirect {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        v.to_enum_from_map(
            global,
            property_name,
            &bun_http_types::FetchRedirect::MAP,
            "'follow', 'manual' or 'error'",
        )
    }
}

impl FromJsEnum for bun_http_types::FetchRequestMode::FetchRequestMode {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        use bun_http_types::FetchRequestMode::FetchRequestMode;
        v.to_enum_from_map(
            global,
            property_name,
            &FetchRequestMode::MAP,
            "'same-origin', 'no-cors', 'cors' or 'navigate'",
        )
    }
}

impl FromJsEnum for bun_http_types::FetchCacheMode::FetchCacheMode {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        use bun_http_types::FetchCacheMode::FetchCacheMode;
        v.to_enum_from_map(
            global,
            property_name,
            &FetchCacheMode::MAP,
            "'default', 'no-store', 'reload', 'no-cache', 'force-cache' or 'only-if-cached'",
        )
    }
}

// `URL::path_from_file_url` / `URL::href_from_js` live in `URL.rs` (the
// dedicated port file); the lib.rs copies were duplicate definitions.

// JSString (real module in JSString.rs).
#[path = "JSString.rs"]
pub mod js_string;
pub use self::js_string::JSString;

#[path = "RefString.rs"]
pub mod ref_string;
pub use self::ref_string as RefString;

pub mod jsc_abi;

#[path = "Debugger.rs"]
pub mod debugger;
pub use self::debugger as Debugger;
#[path = "SavedSourceMap.rs"]
pub mod saved_source_map;
pub use self::saved_source_map as SavedSourceMap;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / ModuleLoader / event_loop. Downstream-compat re-exports
// (`VirtualMachine`, `ModuleLoader`, `EventLoop`, `VirtualMachineInitOptions`)
// are preserved.
// ──────────────────────────────────────────────────────────────────────────
#[path = "VirtualMachine.rs"]
pub mod virtual_machine;
pub use self::virtual_machine as VirtualMachine;
pub use self::virtual_machine::InitOptions as VirtualMachineInitOptions;

#[path = "ModuleLoader.rs"]
pub mod module_loader;
pub use self::module_loader as ModuleLoader;

pub type ErrorableResolvedSource = Errorable<ResolvedSource>;
pub type ErrorableString = Errorable<bun_core::String>;

#[path = "hot_reloader.rs"]
pub mod hot_reloader;
pub use self::hot_reloader::{HotReloader, ImportWatcher, NewHotReloader, WatchReloader};

#[path = "RuntimeTranspilerCache.rs"]
pub mod runtime_transpiler_cache;
pub use self::runtime_transpiler_cache::RuntimeTranspilerCache;

#[path = "RuntimeTranspilerStore.rs"]
pub mod runtime_transpiler_store;
pub use self::runtime_transpiler_store::RuntimeTranspilerStore;

#[path = "web_worker.rs"]
pub mod web_worker;
pub use self::web_worker::WebWorker;

// LAYERING: `Jest`/`TestScope`/`Expect`/`Snapshot` live in
// `bun_runtime::test_runner` — a forward-dep on `bun_runtime`, which itself
// depends on `bun_jsc`, so aliasing them here would be a hard cycle. Callers
// reference `bun_runtime::test_runner::{jest, expect, snapshot}` directly
// instead of routing through `bun_jsc`. No alias is exported here.

pub use self::js_property_iterator::{
    IntoIterObject, JSPropertyIterator, JSPropertyIteratorOptions, PropertyIteratorOptions,
};

#[path = "event_loop.rs"]
pub mod event_loop;
pub use self::event_loop as EventLoop;
#[path = "any_task_job.rs"]
pub mod any_task_job;
pub use self::any_task_job::{AnyTaskJob, AnyTaskJobCtx};
pub use self::event_loop::{
    AbstractVM, AnyEventLoop, AnyTask, AnyTaskWithExtraContext, ConcurrentCppTask,
    ConcurrentPromiseTask, ConcurrentTask, CppTask, DeferredTaskQueue, EventLoopHandle,
    EventLoopKind, EventLoopTask, EventLoopTaskPtr, GarbageCollectionController, JsTerminated,
    JsTerminatedResult, ManagedTask, MiniEventLoop, MiniVM, PosixSignalHandle, PosixSignalTask,
    Task, WorkPool, WorkPoolTask, WorkTask, WorkTaskContext,
};
#[cfg(unix)]
pub type PlatformEventLoop = bun_uws::Loop;
#[cfg(not(unix))]
pub type PlatformEventLoop = bun_io::Loop;

pub use self::array_buffer::JSTypedArrayBytesDeallocator;
/// Deprecated: Remove all of these please.
pub use self::sizes as Sizes;
/// Deprecated: Use `bun_core::ZigString`
#[deprecated]
pub type ZigString = bun_core::ZigString;
/// `ZigString.Slice` — re-exported under the path dependents expect.
pub type ZigStringSlice = bun_core::ZigStringSlice;

// ──────────────────────────────────────────────────────────────────────────
// Core webcore data types (Blob/Store/BuildArtifact) and node path types,
// moved DOWN from `bun_runtime` so lower-tier crates (`bun_bundler_jsc`,
// `bun_http_jsc`, `bun_js_parser_jsc`, `bun_sql_jsc`) can name them without a
// forward dep. `bun_runtime::webcore` re-exports these and layers behaviour
// (S3 I/O, streaming, Body mixin, JS host-fns) on top.
//
// `Request`/`Response` are NOT defined here: their Body-mixin behaviour is
// inseparable from `bun_runtime` (streams/fetch). Code that needs to downcast
// a `JSValue` to `Request`/`Response` lives in `bun_runtime`.
// ──────────────────────────────────────────────────────────────────────────
#[path = "node_path.rs"]
pub mod node_path;
#[path = "webcore_types.rs"]
pub mod webcore_types;
// RAII pair for `to_thread_safe()`/`unprotect()` — re-exported at crate root
// so `bun_runtime` callers don't reach through `node_path`.
pub use self::node_path::{ThreadSafe, Unprotect};

/// `jsc.WebCore` (deprecated alias) — only the data-shape subset
/// that was hoisted to this tier. Reach for `bun_runtime::webcore` for the
/// full API surface.
#[allow(non_snake_case)]
pub mod WebCore {
    pub use crate::webcore_types::store::{Store, StoreRef};
    pub use crate::webcore_types::{Blob, MAX_SIZE, SizeType};
}
/// Lower-case alias + nested `blob` namespace.
pub mod webcore {
    pub use crate::webcore_types::{Blob, MAX_SIZE, SizeType};
    pub mod blob {
        pub use crate::webcore_types::store::*;
        pub use crate::webcore_types::{MAX_SIZE, SizeType};
    }
}
/// `jsc.Node` (deprecated alias) — `PathLike`/`PathOrFileDescriptor`
/// hoisted to this tier; full `bun.api.node` lives in `bun_runtime::node`.
#[allow(non_snake_case)]
pub mod Node {
    /// `bun.api.node.ErrorCode` — the Node-compat `ERR_*` codes; the
    /// `node::ErrorCode` alias resolves directly to [`crate::ErrorCode`]
    /// (LAYERING: avoids a
    /// `bun_jsc → bun_runtime` cycle for `DeferredError` / `node_error_binding`).
    pub use crate::ErrorCode;
    pub use crate::node_path::*;
}
pub use self::Node as node;

/// Opt-in `BUN_DEBUG_JSC=1` trace of every FFI binding entry.
///
/// LAYERING: the `JSC` scoped logger lives in `bun_core::Global::JSC_SCOPE` (it
/// has no jsc dep) so lower-tier crates can mark bindings without depending on
/// `bun_jsc`. This fn is the thin wrapper exposed for in-crate use.
///
/// Note: `#[track_caller]` only surfaces file/line, so no function name is
/// logged. Prefer the `mark_binding!()` macro form (re-exported above) which
/// captures `module_path!()` at the call site.
#[track_caller]
#[inline]
pub fn mark_binding() {
    if bun_core::env::IS_DEBUG && bun_core::Global::JSC_SCOPE.is_visible() {
        let loc = core::panic::Location::caller();
        bun_core::Global::JSC_SCOPE.log(format_args!("[jsc] ({}:{})\n", loc.file(), loc.line()));
    }
}

/// Like [`mark_binding`], with a class-name prefix.
#[inline]
pub fn mark_member_binding(class: &'static str, src: &core::panic::Location<'static>) {
    if bun_core::env::IS_DEBUG && bun_core::Global::JSC_SCOPE.is_visible() {
        bun_core::Global::JSC_SCOPE.log(format_args!(
            "[jsc] {} ({}:{})\n",
            class,
            src.file(),
            src.line()
        ));
    }
}

// LAYERING: no `Subprocess` alias is exported here — that type lives in
// `bun_runtime::api` (forward-dep); callers reference
// `bun_runtime::api::Subprocess` directly.

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
        pub fn get_constructor<T: crate::JsClass>(
            global: &crate::JSGlobalObject,
        ) -> crate::JSValue {
            T::get_constructor(global)
        }
    }
}
pub use self::codegen as Codegen;
// `GeneratedClassesList` lives in `bun_runtime::GeneratedClassesList`
// (layering: every aliased type is defined above `bun_jsc`).

/// Extension trait providing JSC-aware methods on `bun_core::String`.
pub trait StringJsc {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_core::String>;
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn transfer_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_js_by_parse_json(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue;
}
impl StringJsc for bun_core::String {
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<bun_core::String> {
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
    fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        bun_string_jsc::to_range_error_instance(self, global)
    }
}

/// Extension trait providing JSC-aware methods on
/// `bun_core::SliceWithUnderlyingString` (lower-tier, no JSC dep) —
/// `to_js`, `transfer_to_js`, `report_extra_memory`; the free-function bodies
/// live in [`bun_string_jsc`].
pub trait SliceWithUnderlyingStringJsc {
    fn to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn transfer_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn report_extra_memory(&mut self, vm: &VM);
}
impl SliceWithUnderlyingStringJsc for bun_core::SliceWithUnderlyingString {
    #[inline]
    fn to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::slice_with_underlying_string_to_js(self, global)
    }
    #[inline]
    fn transfer_to_js(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::slice_with_underlying_string_transfer_to_js(self, global)
    }
    /// Account `utf8`'s backing allocation against the GC heap unless it is
    /// already JSC-owned (WTF-backed) or borrowed.
    fn report_extra_memory(&mut self, vm: &VM) {
        #[cfg(debug_assertions)]
        {
            debug_assert!(!self.did_report_extra_memory_debug);
            self.did_report_extra_memory_debug = true;
        }
        // Don't report it if the memory is actually owned by JSC.
        if self.utf8.is_allocated() && !self.utf8.is_wtf_allocated() {
            vm.report_extra_memory(self.utf8.length());
        }
    }
}

/// Extension trait providing JSC-aware methods on `bun_core::ZigString`.
///
/// `bun_core::ZigString` is a lower-tier (no JSC dep) `#[repr(C)]` struct;
/// JSC-side conversions (`toJS`, `toExternalValue`, `external`,
/// `toJSONObject`, `toErrorInstance`, …) live as inherent methods on the
/// `bun_jsc::zig_string::ZigString` twin. Higher-tier crates that import
/// `bun_core::ZigString` (e.g. `bun_runtime::webcore::Blob`) cannot reach those
/// inherent methods cross-crate, so this trait re-surfaces them on the
/// canonical type.
pub trait ZigStringJsc: Sized {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_dom_exception_instance(&self, global: &JSGlobalObject, code: DOMExceptionCode)
    -> JSValue;
    /// `ZigString.toJS` — copies into a GC-managed `JSString` (or hands an
    /// external value if globally allocated).
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    /// `ZigString.toAtomicValue` — interns the string as a `JSC::Identifier`
    /// (atom). Prefer for short strings that will be compared by identity.
    fn to_atomic_value(&self, global: &JSGlobalObject) -> JSValue;
    /// `ZigString.toExternalValue` — transfers ownership of a globally-allocated
    /// buffer to JSC's external-string finalizer.
    fn to_external_value(&self, global: &JSGlobalObject) -> JSValue;
    /// `ZigString.toJSONObject` — `JSON.parse` over the bytes.
    fn to_json_object(&self, global: &JSGlobalObject) -> JSValue;
    /// `ZigString.external` — like `to_external_value` but with a caller-supplied
    /// `ctx` + finalizer callback (used to keep a `Blob::Store` ref alive).
    ///
    /// # Safety
    /// `ctx` and the string's backing buffer must satisfy `callback`'s contract;
    /// ownership of both transfers to JSC, which invokes `callback` exactly once.
    unsafe fn external(
        &self,
        global: &JSGlobalObject,
        ctx: *mut core::ffi::c_void,
        callback: unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize),
    ) -> JSValue;
    /// `ZigString.withEncoding` — returns `self` tagged UTF-8 if its bytes
    /// contain non-ASCII (mirrors `setOutputEncoding`'s effect for the value
    /// case).
    fn with_encoding(self) -> Self;
}
impl ZigStringJsc for bun_core::ZigString {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        ZigString__toErrorInstance(self, global)
    }
    fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        ZigString__toTypeErrorInstance(self, global)
    }
    #[inline]
    fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        ZigString__toSyntaxErrorInstance(self, global)
    }
    #[inline]
    fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        ZigString__toRangeErrorInstance(self, global)
    }
    #[inline]
    fn to_dom_exception_instance(
        &self,
        global: &JSGlobalObject,
        code: DOMExceptionCode,
    ) -> JSValue {
        ZigString__toDOMExceptionInstance(self, global, code as u8)
    }
    #[inline]
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        if self.is_globally_allocated() {
            return self.to_external_value(global);
        }
        ZigString__toValueGC(self, global)
    }
    #[inline]
    fn to_atomic_value(&self, global: &JSGlobalObject) -> JSValue {
        ZigString__toAtomicValue(self, global)
    }
    #[inline]
    fn to_external_value(&self, global: &JSGlobalObject) -> JSValue {
        if self.len > bun_core::String::max_length() {
            // SAFETY: contract — bytes were allocated by the default (global)
            // allocator. `default_alloc::free` agrees with the
            // `#[global_allocator]` (`mi_free` normally; libc free under ASAN).
            unsafe {
                bun_alloc::default_alloc::free(
                    self.byte_slice()
                        .as_ptr()
                        .cast_mut()
                        .cast::<core::ffi::c_void>(),
                )
            };
            let _ = global
                .err(
                    crate::ErrorCode::STRING_TOO_LONG,
                    format_args!("Cannot create a string longer than 2^32-1 characters"),
                )
                .throw();
            return JSValue::ZERO;
        }
        // SAFETY: `self` is a valid `&ZigString`; `JSGlobalObject` is an opaque
        // `UnsafeCell`-backed handle so `&` → `*mut` is its intended FFI shape.
        unsafe { cpp::ZigString__toExternalValue(self, global.as_ptr()) }
    }
    #[inline]
    fn to_json_object(&self, global: &JSGlobalObject) -> JSValue {
        ZigString__toJSONObject(self, global)
    }
    #[inline]
    unsafe fn external(
        &self,
        global: &JSGlobalObject,
        ctx: *mut core::ffi::c_void,
        callback: unsafe extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize),
    ) -> JSValue {
        if self.len > bun_core::String::max_length() {
            // SAFETY: invoking the caller-supplied finalizer on the buffer it owns.
            unsafe {
                callback(
                    ctx,
                    self.byte_slice()
                        .as_ptr()
                        .cast_mut()
                        .cast::<core::ffi::c_void>(),
                    self.len,
                )
            };
            let _ = global
                .err(
                    crate::ErrorCode::STRING_TOO_LONG,
                    format_args!("Cannot create a string longer than 2^32-1 characters"),
                )
                .throw();
            return JSValue::ZERO;
        }
        // Ownership of the buffer + `ctx` transfers to JSC's finalizer.
        ZigString__external(self, global, ctx, callback)
    }
    #[inline]
    fn with_encoding(mut self) -> Self {
        if !bun_core::is_all_ascii(self.byte_slice()) {
            self.mark_utf8();
        }
        self
    }
}

/// Free-function form of `ZigString.toExternalU16` for callers that import
/// `bun_core::ZigString`. Forwards to the canonical impl in [`zig_string`].
///
/// # Safety
/// See [`zig_string::to_external_u16`].
#[inline]
pub unsafe fn zig_string_to_external_u16(
    ptr: *const u16,
    len: usize,
    global: &JSGlobalObject,
) -> JSValue {
    // SAFETY: caller upholds `to_external_u16`'s contract.
    unsafe { crate::zig_string::to_external_u16(ptr, len, global) }
}

/// Extension trait providing JSC-aware methods on `bun_sys::Error` (`bun.sys.Error`).
pub trait SysErrorJsc {
    fn to_system_error(&self) -> SystemError;
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    fn throw(&self, global: &JSGlobalObject) -> JsError;
}
impl SysErrorJsc for bun_sys::Error {
    fn to_system_error(&self) -> SystemError {
        SystemError::from(bun_sys::Error::to_system_error(self))
    }
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        <Self as SysErrorJsc>::to_system_error(self).to_error_instance(global)
    }
    fn throw(&self, global: &JSGlobalObject) -> JsError {
        global.throw_value(<Self as SysErrorJsc>::to_js(self, global))
    }
}

/// Extension trait providing JSC-aware methods on `bun_ast::Log`.
pub trait LogJsc {
    fn to_js(&self, global: &JSGlobalObject, message: &str) -> JsResult<JSValue>;
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
}
/// Wrap a single `Msg` in
/// either a `BuildMessage` or `ResolveMessage` JS cell, dispatching on metadata.
fn msg_to_js(msg: &bun_ast::Msg, global: &JSGlobalObject) -> JsResult<JSValue> {
    match msg.metadata {
        bun_ast::Metadata::Build => BuildMessage::create(global, msg.clone()),
        bun_ast::Metadata::Resolve(_) => ResolveMessage::create(global, msg, b""),
    }
}
impl LogJsc for bun_ast::Log {
    fn to_js(&self, global: &JSGlobalObject, message: &str) -> JsResult<JSValue> {
        let msgs = &self.msgs;
        // Cap at 256 — the consumer's stack buffer holds at most 256 JSValues.
        let count = msgs.len().min(256);
        match count {
            0 => Ok(JSValue::UNDEFINED),
            1 => msg_to_js(&msgs[0], global),
            _ => {
                // On-stack array: conservative GC stack scan keeps these
                // JSValues alive until `create_aggregate_error` stores them;
                // a heap `Vec` is invisible to the scan, so a GC triggered by
                // a later `msg_to_js` could sweep the earlier wrappers.
                let mut errors_stack: [JSValue; 256] = [JSValue::default(); 256];
                for (i, msg) in msgs[0..count].iter().enumerate() {
                    errors_stack[i] = msg_to_js(msg, global)?;
                }
                let out = bun_core::ZigString::init(message.as_bytes());
                global.create_aggregate_error(&errors_stack[..count], &out)
            }
        }
    }
    fn to_js_array(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::create_array_from_iter(global, self.msgs.iter(), |msg| msg_to_js(msg, global))
    }
}

/// Extension trait so callers can write `MAP.from_js(global, value)`.
pub trait ComptimeStringMapExt<V: Copy> {
    fn from_js(&'static self, global: &JSGlobalObject, input: JSValue) -> JsResult<Option<V>>;
}
impl<M> ComptimeStringMapExt<M::Value> for M
where
    M: bun_core::comptime_string_map::ComptimeStringMap,
    M::Value: Copy,
{
    fn from_js(
        &'static self,
        global: &JSGlobalObject,
        input: JSValue,
    ) -> JsResult<Option<M::Value>> {
        comptime_string_map_jsc::from_js(self, global, input)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BuildMessage / ResolveMessage / ZigException::Holder / JsClass.
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
    /// (generate-classes.ts:1656-1660, 1913-1916). Implements the
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

/// GC-finalize hook resolved by the generated `${T}Class__finalize` thunk
/// (generate-classes.ts:2893-2902). The thunk body is
/// `host_fn::host_fn_finalize(this, |b| ${T}::finalize(b))` — Rust path
/// resolution on `${T}::finalize` picks an *inherent* `fn finalize(self:
/// Box<Self>)` first when one exists (refcounted / leak-on-pending types),
/// otherwise falls through to this trait's default: drop the `Box`, running
/// `T`'s `Drop` glue and freeing the allocation.
///
/// **Override by defining an inherent `pub fn finalize(self: Box<Self>)` on
/// the concrete type** — do *not* `impl JsFinalize for MyType`; the blanket
/// impl below already covers every `Sized` type and a second impl would
/// conflict. The generated thunk file imports `JsFinalize as _` so the trait
/// is in scope for path resolution without polluting any per-type module.
pub trait JsFinalize: Sized {
    #[inline]
    fn finalize(self: Box<Self>) {
        drop(self)
    }
}
impl<T: Sized> JsFinalize for T {}

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
    extern "C" fn callback<Context, F: FnTyped<Context>>(ctx: *mut c_void) {
        // SAFETY: caller guarantees ctx is a valid *mut Context.
        let context: &mut Context = unsafe { bun_ptr::callback_ctx::<Context>(ctx) };
        F::call(context);
    }
    callback::<Context, F>
}

/// Helper trait for [`opaque_wrap`].
pub trait FnTyped<Context> {
    fn call(this: &mut Context);
}

/// Legacy alias for [`ErrorCode`] (`src/jsc/ErrorCode.rs`) — the same type
/// under both names.
pub type Error = ErrorCode;

/// Maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52).
pub const INIT_TIMESTAMP: JSTimeType = (1u64 << 52) - 1;
pub type JSTimeType = u64;

/// Compute in `i128` first so the
/// `sec * 1000` widening cannot overflow `isize`, then cast to `u64`
/// (non-negative inputs) before masking to 52 bits.
pub fn to_js_time(sec: isize, nsec: isize) -> JSTimeType {
    const MS_PER_S: i128 = bun_core::time::MS_PER_S as i128;
    let millisec = (nsec as i128) / bun_core::time::NS_PER_MS as i128;
    let total = (sec as i128) * MS_PER_S + millisec;
    (total as u64) & ((1u64 << 52) - 1)
}

pub const MAX_SAFE_INTEGER: i64 = 9007199254740991;
pub const MIN_SAFE_INTEGER: i64 = -9007199254740991;

unsafe extern "C" {
    fn JSCInitialize(
        env: *const *const c_char,
        count: usize,
        cb: extern "C" fn(name: *const u8, len: usize),
        eval_mode: bool,
        one_shot_startup: bool,
    );
}

// Hand-stubbed in `generated.rs` until `src/codegen/generate-classes.ts`
// grows a `.rs` backend (same arrangement as `r#gen` below).
#[path = "generated.rs"]
pub mod generated;

/// `bun.gen` — bindgen dispatch shims.
/// Hand-written per-module until `src/codegen/bindgen.ts` grows a `.rs` backend.
/// (`gen` is a reserved keyword in edition 2024; use `r#gen` at call sites.)
#[path = "bindings/GeneratedBindings.rs"]
pub mod r#gen;
