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
#[rustfmt::skip]
mod _gated {
    #![cfg(any())]
    #[path = "WTF.rs"] pub mod wtf;
    #[path = "JSValue.rs"] pub mod js_value;
    #[path = "host_fn.rs"] pub mod host_fn;
    #[path = "AnyPromise.rs"] pub mod any_promise;
    #[path = "array_buffer.rs"] pub mod array_buffer;
    #[path = "CachedBytecode.rs"] pub mod cached_bytecode;
    #[path = "CallFrame.rs"] pub mod call_frame;
    #[path = "CommonAbortReason.rs"] pub mod common_abort_reason;
    #[path = "CommonStrings.rs"] pub mod common_strings;
    #[path = "CustomGetterSetter.rs"] pub mod custom_getter_setter;
    #[path = "DOMFormData.rs"] pub mod dom_form_data;
    #[path = "DOMURL.rs"] pub mod dom_url;
    #[path = "DecodedJSValue.rs"] pub mod decoded_js_value;
    #[path = "DeferredError.rs"] pub mod deferred_error;
    #[path = "GetterSetter.rs"] pub mod getter_setter;
    #[path = "JSArray.rs"] pub mod js_array;
    #[path = "JSArrayIterator.rs"] pub mod js_array_iterator;
    #[path = "JSCell.rs"] pub mod js_cell;
    #[path = "JSFunction.rs"] pub mod js_function;
    #[path = "JSGlobalObject.rs"] pub mod js_global_object;
    #[path = "JSInternalPromise.rs"] pub mod js_internal_promise;
    #[path = "JSMap.rs"] pub mod js_map;
    #[path = "JSModuleLoader.rs"] pub mod js_module_loader;
    #[path = "JSObject.rs"] pub mod js_object;
    #[path = "JSPromise.rs"] pub mod js_promise;
    #[path = "JSPromiseRejectionOperation.rs"] pub mod js_promise_rejection_operation;
    #[path = "JSRef.rs"] pub mod js_ref;
    #[path = "JSString.rs"] pub mod js_string;
    #[path = "JSUint8Array.rs"] pub mod js_uint8_array;
    #[path = "JSBigInt.rs"] pub mod js_big_int;
    #[path = "RefString.rs"] pub mod ref_string;
    #[path = "ScriptExecutionStatus.rs"] pub mod script_execution_status;
    #[path = "SourceType.rs"] pub mod source_type;
    #[path = "Strong.rs"] pub mod strong;
    #[path = "SystemError.rs"] pub mod system_error;
    #[path = "URL.rs"] pub mod url;
    #[path = "URLSearchParams.rs"] pub mod url_search_params;
    #[path = "VM.rs"] pub mod vm;
    #[path = "Weak.rs"] pub mod weak;
    #[path = "Exception.rs"] pub mod exception;
    #[path = "SourceProvider.rs"] pub mod source_provider;
    #[path = "TopExceptionScope.rs"] pub mod top_exception_scope;
    #[path = "MarkedArgumentBuffer.rs"] pub mod marked_argument_buffer;
    #[path = "RegularExpression.rs"] pub mod regular_expression;
    #[path = "Errorable.rs"] pub mod errorable;
    #[path = "ResolvedSource.rs"] pub mod resolved_source;
    #[path = "ErrorCode.rs"] pub mod error_code;
    #[path = "JSErrorCode.rs"] pub mod js_error_code;
    #[path = "ZigErrorType.rs"] pub mod zig_error_type;
    #[path = "Debugger.rs"] pub mod debugger;
    #[path = "SavedSourceMap.rs"] pub mod saved_source_map;
    #[path = "VirtualMachine.rs"] pub mod virtual_machine;
    #[path = "ModuleLoader.rs"] pub mod module_loader;
    #[path = "rare_data.rs"] pub mod rare_data;
    #[path = "EventType.rs"] pub mod event_type;
    #[path = "JSRuntimeType.rs"] pub mod js_runtime_type;
    #[path = "ZigStackFrameCode.rs"] pub mod zig_stack_frame_code;
    #[path = "ZigStackTrace.rs"] pub mod zig_stack_trace;
    #[path = "ZigStackFrame.rs"] pub mod zig_stack_frame;
    #[path = "ZigStackFramePosition.rs"] pub mod zig_stack_frame_position;
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
    #[path = "JSType.rs"] pub mod js_type;
    #[path = "NodeModuleModule.rs"] pub mod node_module_module;
    #[path = "PosixSignalHandle.rs"] pub mod posix_signal_handle;
    #[path = "ProcessAutoKiller.rs"] pub mod process_auto_killer;
    #[path = "ResolveMessage.rs"] pub mod resolve_message;
    #[path = "StringBuilder.rs"] pub mod string_builder;
    #[path = "Task.rs"] pub mod task;
    #[path = "TextCodec.rs"] pub mod text_codec;
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
    #[path = "static_export.rs"] pub mod static_export;
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

/// Web Template Framework
pub mod wtf {
    // TODO(b1): gated — see _gated::wtf (WTF.rs)
}

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(_eval_mode: bool) {
    // TODO(b1): gated — bun_core::analytics::Features::jsc_inc / bun_sys::environ missing
    todo!("bun_jsc::initialize")
}

stub_ty!(JSValue);

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
    pub type JSHostFn = unsafe extern "C" fn();
    pub type JSHostFnZig = unsafe extern "C" fn();
    pub type JSHostFnZigWithContext = unsafe extern "C" fn();
    pub type JSHostFunctionTypeWithContext = unsafe extern "C" fn();
}
pub use self::host_fn::{
    from_js_host_call, from_js_host_call_generic, to_js_host_call, to_js_host_fn,
    to_js_host_fn_result, to_js_host_fn_with_context, JSHostFn, JSHostFnZig, JSHostFnZigWithContext,
    JSHostFunctionTypeWithContext,
};

// JSC Classes Bindings — opaque stubs
stub_ty!(
    AnyPromise, CachedBytecode, CallFrame, CommonAbortReason, CommonStrings, CustomGetterSetter,
    DOMFormData, DOMURL, DecodedJSValue, DeferredError, GetterSetter, JSArray, JSArrayIterator,
    JSCell, JSFunction, JSGlobalObject, JSInternalPromise, JSMap, JSModuleLoader, JSObject,
    JSPromise, JSPromiseRejectionOperation, JsRef, JSString, JSUint8Array, JSBigInt,
    ScriptExecutionStatus, SourceType, SystemError, URL, URLSearchParams, VM, Exception,
    SourceProvider, ExceptionValidationScope, TopExceptionScope, MarkedArgumentBuffer,
    RegularExpression, ResolvedSource, ErrorCode, JSErrorCode, ZigErrorType, EventType,
    JSRuntimeType, ZigStackFrameCode, ZigStackTrace, ZigStackFrame, ZigStackFramePosition,
    ZigException, Formatter, JSPropertyIteratorOptions, RuntimeTranspilerCache,
);

pub mod array_buffer {
    crate::stub_ty!(ArrayBuffer, JSCArrayBuffer, MarkedArrayBuffer);
}
pub use self::array_buffer::{ArrayBuffer, JSCArrayBuffer, MarkedArrayBuffer};

pub mod ref_string {}
pub use self::ref_string as RefString;
pub mod strong {}
pub use self::strong as Strong;

pub mod weak {
    crate::stub_ty!(Weak, WeakRefType);
}
pub use self::weak::{Weak, WeakRefType};

// JavaScript-related
#[derive(Debug, Default)]
pub struct Errorable<T>(pub core::marker::PhantomData<T>);

pub mod debugger {}
pub use self::debugger as Debugger;
pub mod saved_source_map {}
pub use self::saved_source_map as SavedSourceMap;

pub mod virtual_machine {
    #[derive(Debug, Default)]
    pub struct VirtualMachine {
        pub active_tasks: u32,
    }
}
pub use self::virtual_machine as VirtualMachine;

pub mod module_loader {}
pub use self::module_loader as ModuleLoader;
pub mod rare_data {}
pub use self::rare_data as RareData;

pub type ErrorableResolvedSource = Errorable<ResolvedSource>;
// TODO(b1): bun_str crate does not exist (bun_string?); using local ZigString stub.
pub type ErrorableZigString = Errorable<ZigString>;
pub type ErrorableJSValue = Errorable<JSValue>;
pub type ErrorableString = Errorable<bun_string::String>;

pub mod console_object {
    pub type Formatter = super::Formatter;
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
pub mod c_api {}
pub use self::c_api as C;
/// Deprecated: Remove all of these please.
#[deprecated]
pub mod sizes {}
pub use self::sizes as Sizes;
/// Deprecated: Use `bun_string::String`
#[deprecated]
pub type ZigString = bun_string::String; // TODO(b1): bun_str::ZigString missing
/// Deprecated: Use `bun_webcore`
// TODO(b1): bun_webcore crate not available at this tier.
#[cfg(any())]
#[deprecated]
pub use bun_webcore as WebCore;
pub mod WebCore {}
/// Deprecated: Use `bun_api`
#[deprecated]
pub use bun_api as API;
/// Deprecated: Use `bun_api::node`
// TODO(b1): bun_api::node missing from stub surface
#[cfg(any())]
#[deprecated]
pub use bun_api::node as Node;
pub mod Node {}

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
}
pub use self::codegen as Codegen;
pub mod GeneratedClassesList {}

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
