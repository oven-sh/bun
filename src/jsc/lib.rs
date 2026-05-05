//! Bindings to JavaScriptCore and other JavaScript primitives such as
//! VirtualMachine, JSGlobalObject (Zig::GlobalObject), and the event loop.
//!
//! Web and runtime-specific APIs should go in `bun.webcore` and `bun.api`.
//!
//! TODO: Remove remaining aliases to `webcore` and `api`

use core::ffi::{c_char, c_void};

use bun_core::Output;

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

/// Web Template Framework
pub use self::wtf_mod::WTF as wtf;
#[path = "WTF.rs"]
mod wtf_mod;

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) {
    mark_binding(core::panic::Location::caller());
    bun_core::analytics::Features::jsc_inc(1);
    // SAFETY: JSCInitialize reads `environ[0..count]` and invokes `cb` with a
    // valid (ptr, len) pair for any rejected env var. `environ` is the libc
    // global; len matches the array.
    unsafe {
        let environ = bun_sys::environ();
        JSCInitialize(
            environ.as_ptr(),
            environ.len(),
            on_jsc_invalid_env_var,
            eval_mode,
        );
    }
}

mod js_value;
pub use self::js_value::JSValue;

// Host functions are the native function pointer type that can be used by a
// JSC::JSFunction to call native code from JavaScript. To allow usage of `?`
// for error handling, Bun provides to_js_host_fn to wrap JSHostFnZig into JSHostFn.
pub mod host_fn;
pub use self::host_fn::{
    from_js_host_call, from_js_host_call_generic, to_js_host_call, to_js_host_fn,
    to_js_host_fn_result, to_js_host_fn_with_context, JSHostFn, JSHostFnZig, JSHostFnZigWithContext,
    JSHostFunctionTypeWithContext,
};

// JSC Classes Bindings
mod any_promise;
pub use self::any_promise::AnyPromise;
pub mod array_buffer;
pub use self::array_buffer::{ArrayBuffer, JSCArrayBuffer, MarkedArrayBuffer};
mod cached_bytecode;
pub use self::cached_bytecode::CachedBytecode;
mod call_frame;
pub use self::call_frame::CallFrame;
mod common_abort_reason;
pub use self::common_abort_reason::CommonAbortReason;
mod common_strings;
pub use self::common_strings::CommonStrings;
mod custom_getter_setter;
pub use self::custom_getter_setter::CustomGetterSetter;
mod dom_form_data;
pub use self::dom_form_data::DOMFormData;
mod dom_url;
pub use self::dom_url::DOMURL;
mod decoded_js_value;
pub use self::decoded_js_value::DecodedJSValue;
mod deferred_error;
pub use self::deferred_error::DeferredError;
mod getter_setter;
pub use self::getter_setter::GetterSetter;
mod js_array;
pub use self::js_array::JSArray;
mod js_array_iterator;
pub use self::js_array_iterator::JSArrayIterator;
mod js_cell;
pub use self::js_cell::JSCell;
mod js_function;
pub use self::js_function::JSFunction;
mod js_global_object;
pub use self::js_global_object::JSGlobalObject;
mod js_internal_promise;
pub use self::js_internal_promise::JSInternalPromise;
mod js_map;
pub use self::js_map::JSMap;
mod js_module_loader;
pub use self::js_module_loader::JSModuleLoader;
mod js_object;
pub use self::js_object::JSObject;
mod js_promise;
pub use self::js_promise::JSPromise;
mod js_promise_rejection_operation;
pub use self::js_promise_rejection_operation::JSPromiseRejectionOperation;
mod js_ref;
pub use self::js_ref::JsRef;
mod js_string;
pub use self::js_string::JSString;
mod js_uint8_array;
pub use self::js_uint8_array::JSUint8Array;
mod js_big_int;
pub use self::js_big_int::JSBigInt;
pub mod ref_string;
pub use self::ref_string as RefString;
mod script_execution_status;
pub use self::script_execution_status::ScriptExecutionStatus;
mod source_type;
pub use self::source_type::SourceType;
pub mod strong;
pub use self::strong as Strong;
mod system_error;
pub use self::system_error::SystemError;
mod url;
pub use self::url::URL;
mod url_search_params;
pub use self::url_search_params::URLSearchParams;
mod vm;
pub use self::vm::VM;
mod weak;
pub use self::weak::{Weak, WeakRefType};
mod exception;
pub use self::exception::Exception;
mod source_provider;
pub use self::source_provider::SourceProvider;
mod top_exception_scope;
pub use self::top_exception_scope::{ExceptionValidationScope, TopExceptionScope};
mod marked_argument_buffer;
pub use self::marked_argument_buffer::MarkedArgumentBuffer;
mod regular_expression;
pub use self::regular_expression::RegularExpression;

// JavaScript-related
mod errorable;
pub use self::errorable::Errorable;
mod resolved_source;
pub use self::resolved_source::ResolvedSource;
mod error_code;
pub use self::error_code::ErrorCode;
mod js_error_code;
pub use self::js_error_code::JSErrorCode;
mod zig_error_type;
pub use self::zig_error_type::ZigErrorType;
pub mod debugger;
pub use self::debugger as Debugger;
pub mod saved_source_map;
pub use self::saved_source_map as SavedSourceMap;
pub mod virtual_machine;
pub use self::virtual_machine as VirtualMachine;
pub mod module_loader;
pub use self::module_loader as ModuleLoader;
pub mod rare_data;
pub use self::rare_data as RareData;
mod event_type;
pub use self::event_type::EventType;
mod js_runtime_type;
pub use self::js_runtime_type::JSRuntimeType;
mod zig_stack_frame_code;
pub use self::zig_stack_frame_code::ZigStackFrameCode;

pub type ErrorableResolvedSource = Errorable<ResolvedSource>;
pub type ErrorableZigString = Errorable<bun_str::ZigString>;
pub type ErrorableJSValue = Errorable<JSValue>;
pub type ErrorableString = Errorable<bun_str::String>;

mod zig_stack_trace;
pub use self::zig_stack_trace::ZigStackTrace;
mod zig_stack_frame;
pub use self::zig_stack_frame::ZigStackFrame;
mod zig_stack_frame_position;
pub use self::zig_stack_frame_position::ZigStackFramePosition;
mod zig_exception;
pub use self::zig_exception::ZigException;

pub mod console_object;
pub use self::console_object as ConsoleObject;
pub use self::console_object::Formatter;

pub mod hot_reloader;

// TODO: move into bun.api
pub use bun_runtime::test_runner::jest as Jest;
pub use bun_runtime::test_runner::jest::TestScope;
pub use bun_runtime::test_runner::expect as Expect;
pub use bun_runtime::test_runner::snapshot as Snapshot;

pub mod js_property_iterator;
pub use self::js_property_iterator::{JSPropertyIterator, JSPropertyIteratorOptions};

pub mod event_loop;
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
pub mod c_api;
#[allow(deprecated)]
pub use self::c_api as C;
/// Deprecated: Remove all of these please.
#[deprecated]
pub mod sizes;
#[allow(deprecated)]
pub use self::sizes as Sizes;
/// Deprecated: Use `bun_str::String`
#[deprecated]
pub use bun_str::ZigString;
/// Deprecated: Use `bun_webcore`
#[deprecated]
pub use bun_webcore as WebCore;
/// Deprecated: Use `bun_api`
#[deprecated]
pub use bun_api as API;
/// Deprecated: Use `bun_api::node`
#[deprecated]
pub use bun_api::node as Node;

bun_output::declare_scope!(JSC, hidden);

#[inline]
pub fn mark_binding(src: &core::panic::Location<'static>) {
    // TODO(port): Zig SourceLocation carries fn_name; Rust Location does not. Phase B may switch to a macro.
    bun_output::scoped_log!(JSC, "{} ({}:{})", "<fn>", src.file(), src.line());
}

#[inline]
pub fn mark_member_binding(class: &'static str, src: &core::panic::Location<'static>) {
    if !cfg!(feature = "debug_logs") {
        return;
    }
    // TODO(port): Zig accepted `comptime class: anytype` and used @typeName for non-pointer types.
    // Rust callers pass core::any::type_name::<T>() or a literal directly.
    bun_output::scoped_log!(JSC, "{}.{} ({}:{})", class, "<fn>", src.file(), src.line());
}

pub use bun_api::Subprocess;

/// This file is generated by:
///  1. `bun src/codegen/generate-classes.ts`
///  2. Scan for **/*.classes.ts files in src/
///  3. Generate a JS wrapper for each class in:
///     - Zig: generated_classes.zig
///     - C++: ZigGeneratedClasses.h, ZigGeneratedClasses.cpp
///  4. For the Zig code to successfully compile:
///     - Add it to generated_classes_list.zig
///     - Expose the generated methods:
///       ```zig
///       pub const js = JSC.Codegen.JSMyClassName;
///       pub const toJS = js.toJS;
///       pub const fromJS = js.fromJS;
///       pub const fromJSDirect = js.fromJSDirect;
///       ```
///  5. `bun run build`
// TODO(port): generated module — re-run generate-classes.ts with .rs output.
pub mod codegen {
    // GENERATED: re-run src/codegen/generate-classes.ts with .rs output
}
pub use self::codegen as Codegen;
mod generated_classes_list;
pub use self::generated_classes_list::Classes as GeneratedClassesList;

mod runtime_transpiler_cache;
pub use self::runtime_transpiler_cache::RuntimeTranspilerCache;

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
    // Rust cannot take a fn item as a const generic on stable; using a ZST trait
    // (`FnTyped`) so each fn item monomorphizes to its own `callback`. Phase B
    // may replace with a macro if the trait shim proves awkward at call sites.
    unsafe extern "C" fn callback<Context, F: FnTyped<Context>>(ctx: *mut c_void) {
        // SAFETY: caller guarantees ctx is a valid *mut Context (non-null) — Zig unwrapped `ctx.?`.
        let context: &mut Context = &mut *ctx.cast::<Context>();
        F::call(context);
    }
    callback::<Context, F>
}

/// Helper trait for [`opaque_wrap`]: a zero-sized fn-item type implementing `call(&mut Context)`.
pub trait FnTyped<Context> {
    fn call(this: &mut Context);
}

// TODO(port): `@import("ErrorCode").Error` resolves via build-system module name, not a relative path.
pub use self::error_code::Error;

/// According to https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date,
/// maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52).
pub const INIT_TIMESTAMP: JSTimeType = (1u64 << 52) - 1; // = std.math.maxInt(u52)
// TODO(port): Zig u52 — Rust has no u52. Using u64; callers must mask/truncate. Phase B: newtype with 52-bit invariant.
pub type JSTimeType = u64;

pub fn to_js_time(sec: isize, nsec: isize) -> JSTimeType {
    const NS_PER_MS: isize = 1_000_000;
    const MS_PER_S: isize = 1_000;
    let millisec: u64 = u64::try_from(nsec / NS_PER_MS).unwrap();
    // @truncate(u52, ...) — mask to 52 bits to match Zig semantics.
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

unsafe extern "C" fn on_jsc_invalid_env_var(name: *const u8, len: usize) {
    // SAFETY: JSCInitialize passes a valid (ptr, len) byte slice for the rejected env var name.
    let name = unsafe { core::slice::from_raw_parts(name, len) };
    Output::err_generic(format_args!(
        "invalid JSC environment variable\n\
         \n\
         \x20   <b>{}<r>\n\
         \n\
         For a list of options, see this file:\n\
         \n\
         \x20   https://github.com/oven-sh/webkit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h\n\
         \n\
         Environment variables must be prefixed with \"BUN_JSC_\". This code runs before .env files are loaded, so those won't work here.\n\
         \n\
         Warning: options change between releases of Bun and WebKit without notice. This is not a stable API, you should not rely on it beyond debugging something, and it may be removed entirely in a future version of Bun.",
        bstr::BStr::new(name),
    ));
    bun_core::Global::exit(1);
}

pub mod math {
    // TODO(port): move to jsc_sys
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
//   confidence: medium
//   todos:      10
//   notes:      crate root; mostly re-exports. `conv` ABI → host_fn macro; u52 JSTimeType widened to u64 (INIT_TIMESTAMP/to_js_time mask to 52 bits); OpaqueWrap reshaped to trait; mark_binding lost fn_name (Rust Location lacks it).
// ──────────────────────────────────────────────────────────────────────────
