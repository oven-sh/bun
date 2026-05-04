//! Host function wrappers — the glue between Rust functions and JSC native callbacks.
//!
//! In the Zig source this module is almost entirely `comptime`/`@typeInfo` reflection
//! that inspects a function's signature and emits an `extern callconv(jsc.conv)` shim.
//! Rust has no equivalent runtime/const reflection, so per PORTING.md §"Comptime
//! reflection" the wrapping machinery (`toJSHostFn`, `wrapN`, `wrapInstanceMethod`,
//! `wrapStaticMethod`, `DOMCall`) becomes the `#[bun_jsc::host_fn]` / `#[bun_jsc::host_call]`
//! proc-macro attributes. This file keeps:
//!   - the runtime result-mapping helpers the macros call into,
//!   - the FFI surface for `JSFunction` creation,
//!   - `DomEffect` (plain data),
//! and stubs the reflection-driven generators with `// TODO(port): proc-macro`.

use core::ffi::c_void;
use core::panic::Location;

use bun_core::Environment;
use bun_core::Output;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult};
use bun_str::ZigString;

// ───────────────────────────── type aliases ──────────────────────────────

/// A host function is the native function pointer type that can be used by a
/// `JSC::JSFunction` to call native code from JavaScript.
///
/// NOTE: `callconv(jsc.conv)` is `"sysv64"` on Windows-x64 and `"C"` elsewhere.
/// Rust does not accept a macro in ABI position, so the canonical encoding is the
/// `#[bun_jsc::host_call]` attribute on the concrete `extern fn`. This alias uses
/// `extern "C"` as the placeholder; the proc-macro rewrites it per-target.
// TODO(port): jsc.conv ABI — the proc-macro must emit `extern "sysv64"` on windows-x64.
pub type JsHostFn = unsafe extern "C" fn(*mut JSGlobalObject, *mut CallFrame) -> JSValue;

/// To allow usage of `?` for error handling, Bun provides `to_js_host_fn` to
/// wrap this type into a `JsHostFn`.
pub type JsHostFnZig = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

// Zig: `pub fn JSHostFnZigWithContext(comptime ContextType: type) type`
pub type JsHostFnZigWithContext<C> = fn(&mut C, &JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

// Zig: `pub fn JSHostFunctionTypeWithContext(comptime ContextType: type) type`
// TODO(port): jsc.conv ABI (see JsHostFn note)
pub type JsHostFunctionTypeWithContext<C> =
    unsafe extern "C" fn(*mut C, *mut JSGlobalObject, *mut CallFrame) -> JSValue;

// ─────────────────────── comptime fn-wrapping → proc-macro ───────────────────────

// Zig: `pub fn toJSHostFn(comptime functionToWrap: JSHostFnZig) JSHostFn`
//
// In Zig this returns a freshly-monomorphized `extern fn` that closes over a
// `comptime` function pointer. Rust cannot mint an `extern "C" fn` item from a
// const fn pointer without a proc-macro (no `const fn` ABI thunks). Callers use
// `#[bun_jsc::host_fn]` instead, which emits the shim and calls
// `to_js_host_fn_result` for the body.
// TODO(port): proc-macro — `#[bun_jsc::host_fn]` replaces `toJSHostFn`.
#[doc(hidden)]
pub const fn to_js_host_fn(_function_to_wrap: JsHostFnZig) -> ! {
    panic!("use #[bun_jsc::host_fn] instead of to_js_host_fn()");
}

// Zig: `pub fn toJSHostFnWithContext(comptime ContextType: type, comptime Function: ...) ...`
// TODO(port): proc-macro — `#[bun_jsc::host_fn(method)]` replaces `toJSHostFnWithContext`.
#[doc(hidden)]
pub const fn to_js_host_fn_with_context<C>(_function: JsHostFnZigWithContext<C>) -> ! {
    panic!("use #[bun_jsc::host_fn(method)] instead of to_js_host_fn_with_context()");
}

/// Map a `JsResult<JSValue>` to the raw `JSValue` a host fn must return
/// (`.zero` when an exception is pending).
pub fn to_js_host_fn_result(global_this: &JSGlobalObject, result: JsResult<JSValue>) -> JSValue {
    // Zig: `if (Environment.allow_assert and Environment.is_canary)`
    // TODO(port): `Environment.is_canary` cfg — using debug_assertions as proxy.
    if cfg!(debug_assertions) {
        let value = match result {
            Ok(v) => v,
            Err(JsError::Thrown) => JSValue::ZERO,
            Err(JsError::OutOfMemory) => global_this.throw_out_of_memory_value(),
            Err(JsError::Terminated) => JSValue::ZERO,
        };
        debug_exception_assertion(global_this, value, "_unknown_");
        return value;
    }
    match result {
        Ok(v) => v,
        Err(JsError::Thrown) => JSValue::ZERO,
        Err(JsError::OutOfMemory) => global_this.throw_out_of_memory_value(),
        Err(JsError::Terminated) => JSValue::ZERO,
    }
}

fn debug_exception_assertion(global_this: &JSGlobalObject, value: JSValue, func: &'static str) {
    // Zig passed `comptime func: anytype` and printed its address for `image lookup`.
    // Rust passes the fn name string (the proc-macro supplies `stringify!(fn_name)`).
    #[cfg(debug_assertions)]
    {
        if !value.is_empty() {
            if global_this.has_exception() {
                let mut formatter = jsc::ConsoleObject::Formatter::new(global_this);
                Output::err(
                    "Assertion failed",
                    format_args!(
                        "Native function returned a non-zero JSValue while an exception is pending\n\
                         \n\
                         \x20   fn: {}\n\
                         \x20value: {}\n",
                        func,
                        value.to_fmt(&mut formatter),
                    ),
                );
                Output::flush();
                // `formatter` drops here (Zig: `defer formatter.deinit()`).
            }
        }
    }
    let _ = func;
    debug_assert_eq!(value.is_empty(), global_this.has_exception());
}

pub fn to_js_host_setter_value(global_this: &JSGlobalObject, value: JsResult<()>) -> bool {
    match value {
        Err(JsError::Thrown) => false,
        Err(JsError::OutOfMemory) => {
            let _ = global_this.throw_out_of_memory_value();
            false
        }
        Err(JsError::Terminated) => false,
        Ok(()) => true,
    }
}

/// Convert the return value of a function returning an error union into a maybe-empty `JSValue`.
///
/// Zig signature took `comptime function: anytype` + an args tuple and `@call`'d it; in Rust the
/// caller (the proc-macro expansion) passes a closure that performs the call, so this only handles
/// the result mapping + exception-scope assertion.
#[track_caller]
pub fn to_js_host_call(
    global_this: &JSGlobalObject,
    src: &'static Location<'static>,
    f: impl FnOnce() -> JsResult<JSValue>,
) -> JSValue {
    let scope = jsc::ExceptionValidationScope::new(global_this, src);

    let returned: JsResult<JSValue> = f();
    let normal = match returned {
        Ok(v) => v,
        Err(JsError::Thrown) => JSValue::ZERO,
        Err(JsError::OutOfMemory) => global_this.throw_out_of_memory_value(),
        Err(JsError::Terminated) => JSValue::ZERO,
    };
    scope.assert_exception_presence_matches(normal.is_empty());
    normal
    // `scope` drops here (Zig: `defer scope.deinit()`).
}

/// Convert the return value of a function returning a maybe-empty `JSValue` into an error union.
/// The wrapped function must return an empty `JSValue` if and only if it has thrown an exception.
/// If your function does not follow this pattern (if it can return empty without an exception, or
/// throw an exception and return non-empty), either fix the function or write a custom wrapper with
/// `TopExceptionScope`.
#[track_caller]
pub fn from_js_host_call(
    global_this: &JSGlobalObject,
    src: &'static Location<'static>,
    f: impl FnOnce() -> JSValue,
) -> Result<JSValue, JsError> {
    let scope = jsc::ExceptionValidationScope::new(global_this, src);

    let value = f();
    // Zig: `if (@TypeOf(value) != JSValue) @compileError(...)` — enforced by the
    // closure return type here.
    scope.assert_exception_presence_matches(value.is_empty());
    if value.is_empty() { Err(JsError::Thrown) } else { Ok(value) }
}

/// Generic variant for wrapped FFI calls whose return value tells you nothing about
/// whether an exception was thrown.
#[track_caller]
pub fn from_js_host_call_generic<R>(
    global_this: &JSGlobalObject,
    src: &'static Location<'static>,
    f: impl FnOnce() -> R,
) -> Result<R, JsError> {
    let scope = jsc::TopExceptionScope::new(global_this, src);

    let result = f();
    // supporting JSValue would make it too easy to mix up this function with from_js_host_call
    // from_js_host_call has the benefit of checking that the function is correctly returning an
    // empty value if and only if it has thrown.
    // from_js_host_call_generic is only for functions where the return value tells you nothing
    // about whether an exception was thrown.
    //
    // alternatively, we could consider something like `comptime exception_sentinel: ?T`
    // to generically support using a value of any type to signal exceptions (INT_MAX, infinity,
    // nullptr...?) but it's unclear how often that would be useful
    // TODO(port): static-assert `R != JSValue` (Zig used @compileError; Rust needs a
    // negative trait bound or specialization — neither stable). Phase B: sealed trait trick.
    scope.return_if_exception()?;
    Ok(result)
}

// ───────────────────────── error-set parsing (comptime) ─────────────────────────

#[derive(Default, Clone, Copy)]
struct ParsedHostFunctionErrorSet {
    out_of_memory: bool,
    js_error: bool,
}

// Zig: `inline fn parseErrorSet(T: type, errors: []const std.builtin.Type.Error) ...`
// Pure `@typeInfo` reflection over an error set — no Rust equivalent.
// TODO(port): proc-macro — error-set validation moves into `#[bun_jsc::host_fn]`.
#[allow(dead_code)]
fn parse_error_set() -> ParsedHostFunctionErrorSet {
    unimplemented!("comptime error-set reflection; handled by proc-macro")
}

// For when bubbling up errors to functions that require a C ABI boundary
// TODO: make this not need a 'global_this'
pub fn void_from_js_error(err: JsError, global_this: &JSGlobalObject) {
    match err {
        JsError::Thrown => {}
        JsError::OutOfMemory => {
            let _ = global_this.throw_out_of_memory();
        }
        JsError::Terminated => {}
    }
    // TODO: catch exception, declare throw scope, re-throw
    // c++ needs to be able to see that zig functions can throw for BUN_JSC_validateExceptionChecks
}

// ───────────────────────────── wrapN family ──────────────────────────────
//
// Zig `wrap1`..`wrap5` / `wrap4v` each take a `comptime func: anytype`, reflect on
// its parameter list with `@typeInfo`, and return a fresh `extern fn` of matching
// arity that forwards through `toJSHostCall`. This is signature reflection —
// `// TODO(port): proc-macro`. The Rust replacement is a single attribute:
//
//     #[bun_jsc::host_call(wrap)]       // -> extern "C"   (wrap1..wrap5)
//     #[bun_jsc::host_call(wrap, sysv)] // -> jsc.conv ABI (wrap4v)
//
// `checkWrapParams` (arity + first-arg-is-*JSGlobalObject assertion) is enforced by
// the macro at expansion time.
// TODO(port): proc-macro — `wrap1`..`wrap5`, `wrap4v`, `checkWrapParams`.

// ───────────────────────────── FFI: JSFunction creation ──────────────────────────────

mod private {
    use super::*;

    // TODO(port): move to jsc_sys
    unsafe extern "C" {
        pub fn Bun__CreateFFIFunctionWithDataValue(
            global: *mut JSGlobalObject,
            symbol_name: *const ZigString, // ?*const ZigString
            arg_count: u32,
            // Zig `*const JSHostFn` is a fn *pointer*; `JsHostFn` in Rust is already
            // `unsafe extern "C" fn(...)`, i.e. the pointer type.
            function: JsHostFn,
            data: *mut c_void,
        ) -> JSValue;

        pub fn Bun__CreateFFIFunctionValue(
            global_object: *mut JSGlobalObject,
            symbol_name: *const ZigString, // ?*const ZigString
            arg_count: u32,
            function: JsHostFn,
            add_ptr_field: bool,
            input_function_ptr: *mut c_void, // ?*anyopaque
        ) -> JSValue;

        pub fn Bun__FFIFunction_getDataPtr(value: JSValue) -> *mut c_void;
        pub fn Bun__FFIFunction_setDataPtr(value: JSValue, data: *mut c_void);
    }
}

pub fn new_runtime_function(
    global_object: &JSGlobalObject,
    symbol_name: Option<&ZigString>,
    arg_count: u32,
    function_pointer: JsHostFn,
    add_ptr_property: bool,
    input_function_ptr: Option<*mut c_void>,
) -> JSValue {
    jsc::mark_binding(Location::caller());
    // SAFETY: thin FFI wrapper; arguments forwarded as-is from caller-validated values.
    unsafe {
        private::Bun__CreateFFIFunctionValue(
            global_object as *const _ as *mut _,
            symbol_name.map_or(core::ptr::null(), |s| s as *const _),
            arg_count,
            function_pointer,
            add_ptr_property,
            input_function_ptr.unwrap_or(core::ptr::null_mut()),
        )
    }
}

pub fn get_function_data(function: JSValue) -> Option<*mut c_void> {
    jsc::mark_binding(Location::caller());
    // SAFETY: thin FFI wrapper.
    let p = unsafe { private::Bun__FFIFunction_getDataPtr(function) };
    if p.is_null() { None } else { Some(p) }
}

pub fn set_function_data(function: JSValue, value: Option<*mut c_void>) {
    jsc::mark_binding(Location::caller());
    // SAFETY: thin FFI wrapper.
    unsafe {
        private::Bun__FFIFunction_setDataPtr(function, value.unwrap_or(core::ptr::null_mut()))
    }
}

pub fn new_function_with_data(
    global_object: &JSGlobalObject,
    symbol_name: Option<&ZigString>,
    arg_count: u32,
    function: JsHostFn,
    data: *mut c_void,
) -> JSValue {
    jsc::mark_binding(Location::caller());
    // Zig: `toJSHostFn(function)` wrapped a `comptime JSHostFnZig` here. In Rust the
    // caller passes an already-wrapped `JsHostFn` (produced by `#[bun_jsc::host_fn]`).
    // TODO(port): proc-macro — callers must apply `#[bun_jsc::host_fn]` themselves.
    // SAFETY: thin FFI wrapper.
    unsafe {
        private::Bun__CreateFFIFunctionWithDataValue(
            global_object as *const _ as *mut _,
            symbol_name.map_or(core::ptr::null(), |s| s as *const _),
            arg_count,
            function,
            data,
        )
    }
}

// ───────────────────────────── DOMEffect ──────────────────────────────

#[derive(Clone, Copy)]
pub struct DomEffect {
    pub reads: [DomEffectId; 4],
    pub writes: [DomEffectId; 4],
}

impl Default for DomEffect {
    fn default() -> Self {
        // Zig: `std.mem.zeroes([4]ID)` — ID(0) == InvalidAbstractHeap.
        Self {
            reads: [DomEffectId::InvalidAbstractHeap; 4],
            writes: [DomEffectId::InvalidAbstractHeap; 4],
        }
    }
}

impl DomEffect {
    pub const TOP: DomEffect = DomEffect {
        reads: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
        writes: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
    };

    pub const fn for_read(read: DomEffectId) -> DomEffect {
        DomEffect {
            reads: [read, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
            writes: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
        }
    }

    pub const fn for_write(read: DomEffectId) -> DomEffect {
        DomEffect {
            writes: [read, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
            reads: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
        }
    }

    pub const PURE: DomEffect = DomEffect {
        reads: [DomEffectId::InvalidAbstractHeap; 4],
        writes: [DomEffectId::InvalidAbstractHeap; 4],
    };

    pub fn is_pure(self) -> bool {
        matches!(self.reads[0], DomEffectId::InvalidAbstractHeap)
            && matches!(self.writes[0], DomEffectId::InvalidAbstractHeap)
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DomEffectId {
    InvalidAbstractHeap = 0,
    World,
    Stack,
    Heap,
    ButterflyPublicLength,
    ButterflyVectorLength,
    GetterSetterGetter,
    GetterSetterSetter,
    JSCellCellState,
    JSCellIndexingType,
    JSCellStructureID,
    JSCellTypeInfoFlags,
    JSObjectButterfly,
    JSPropertyNameEnumeratorCachedPropertyNames,
    RegExpObjectLastIndex,
    NamedProperties,
    IndexedInt32Properties,
    IndexedDoubleProperties,
    IndexedContiguousProperties,
    IndexedArrayStorageProperties,
    DirectArgumentsProperties,
    ScopeProperties,
    TypedArrayProperties,
    /// Used to reflect the fact that some allocations reveal object identity
    HeapObjectCount,
    RegExpState,
    MathDotRandomState,
    JSDateFields,
    JSMapFields,
    JSSetFields,
    JSWeakMapFields,
    WeakSetFields,
    JSInternalFields,
    InternalState,
    CatchLocals,
    Absolute,
    /// DOMJIT tells the heap range with the pair of integers.
    DOMState,
    /// Use this for writes only, to indicate that this may fire watchpoints. Usually this is never
    /// directly written but instead we test to see if a node clobbers this; it just so happens that
    /// you have to write world to clobber it.
    WatchpointFire,
    /// Use these for reads only, just to indicate that if the world got clobbered, then this
    /// operation will not work.
    MiscFields,
    /// Use this for writes only, just to indicate that hoisting the node is invalid. This works
    /// because we don't hoist anything that has any side effects at all.
    SideState,
}

// ───────────────────────── DOMCall codegen helpers ─────────────────────────
//
// `DOMCallArgumentType` / `DOMCallArgumentTypeWrapper` / `DOMCallResultType` map a
// Zig type to a C++ spec-string at comptime. They feed the C++ codegen
// (`generate-classes.ts`), not runtime. The proc-macro for `#[bun_jsc::dom_call]`
// owns this mapping in Rust.
// TODO(port): proc-macro — DOMCall type→spec-string tables move into the macro crate.

// Zig: `pub fn DOMCall(comptime class_name, comptime Container, comptime functionName,
//                      comptime dom_effect) type`
//
// Returns an `extern struct` that:
//   - `@export`s `<class>__<fn>__slowpath` / `__fastpath` with `callconv(jsc.conv)`,
//   - `@extern`s `<class>__<fn>__put`,
//   - exposes `effect`, `put()`, and `Arguments`.
//
// This is link-name synthesis + signature reflection. Rust replacement:
//
//     #[bun_jsc::dom_call(class = "Foo", effect = DomEffect::PURE)]
//     impl Foo { fn bar(...) -> ... { ... }  fn bar_without_type_checks(...) -> ... { ... } }
//
// TODO(port): proc-macro — `DOMCall` type-generator.

// ───────────────────────── instance/static method wrapping ─────────────────────────

// Zig: `pub fn InstanceMethodType(comptime Container: type) type`
pub type InstanceMethodType<C> = fn(&mut C, &JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

// Zig: `pub fn wrapInstanceMethod(comptime Container, comptime name, comptime auto_protect)
//          InstanceMethodType(Container)`
//
// This is the heaviest reflection in the file: it iterates `@typeInfo(Fn).params`,
// pattern-matches each parameter TYPE (`*JSGlobalObject`, `ZigString`,
// `?jsc.ArrayBuffer`, `*WebCore.Response`, `?HTMLRewriter.ContentOptions`, ...) and
// emits per-param argument-decoding + error-throwing glue, then `@call`s the target.
// There is no value-level translation; the entire body is a type-directed code
// generator. Per PORTING.md §"Comptime reflection":
//
// TODO(port): proc-macro — `#[bun_jsc::host_fn(method, auto_protect)]` replaces
// `wrapInstanceMethod`. The macro must reproduce the per-type decode table:
//   *Container            -> `this`
//   *JSGlobalObject       -> `global`
//   *CallFrame            -> `frame`
//   Node.StringOrBuffer   -> `StringOrBuffer::from_js(global, arena, arg)?` or throw
//   ?Node.StringOrBuffer  -> optional of above (null/undefined -> None)
//   ArrayBuffer           -> `arg.as_array_buffer(global)` or throw "expected TypedArray"
//   ?ArrayBuffer          -> optional of above
//   ZigString             -> `arg.get_zig_string(global)?` (throws on undefined/null)
//   ?HTMLRewriter.ContentOptions -> `{ html: arg.get("html")?.to_boolean() }`
//   *WebCore.Response     -> `arg.as::<Response>()` or throw "Expected Response object"
//   *WebCore.Request      -> `arg.as::<Request>()` or throw "Expected Request object"
//   JSValue               -> required arg or throw "Missing argument"
//   ?JSValue              -> optional arg
//   C.ExceptionRef        -> `&mut exception_slot` (and re-throw on return if set)
//   <else>                -> compile_error!
// `auto_protect` selects `ArgumentsSlice::protect_eat_next` vs `::next_eat`.

// Zig: `pub fn wrapStaticMethod(comptime Container, comptime name, comptime auto_protect)
//          jsc.JSHostFnZig`
//
// Same as `wrapInstanceMethod` minus the `*Container`/`*CallFrame`/`ExceptionRef`
// arms, plus a `Node.BlobOrStringOrBuffer` arm.
// TODO(port): proc-macro — `#[bun_jsc::host_fn(static, auto_protect)]` replaces
// `wrapStaticMethod` (decode table as above + BlobOrStringOrBuffer).

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/host_fn.zig (807 lines)
//   confidence: medium
//   todos:      16
//   notes:      ~70% of source is @typeInfo fn-signature reflection -> #[bun_jsc::host_fn]/host_call/dom_call proc-macros; runtime helpers + FFI + DomEffect ported directly.
// ──────────────────────────────────────────────────────────────────────────
