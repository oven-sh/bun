#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge crate for `bun_sys`. Adds `to_js`/`from_js` extension surfaces
//! onto `bun_sys::{Fd, Error, SignalCode}` without pulling JSC types into the
//! syscall layer.

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate: Phase-A draft modules now compile UN-GATED. `bun_jsc` itself
// still does not build (transitive deps `bun_css`/`bun_sourcemap`/`bun_aio`
// fail), so this crate cannot `use bun_jsc::*` directly. Instead, the JSC
// opaque handle types AND the method surface the bodies need are shimmed
// locally below; modules import them from `crate::`. Every shim method body
// is a REAL port of the corresponding `src/jsc/*.zig` logic, calling the
// same `extern "C"` symbols `bun_jsc` would (verified against
// `src/jsc/{JSValue,JSGlobalObject,CallFrame,VM,JSString,SystemError}.rs`).
//
// Once `bun_jsc` is green, replace the entire shim block with
// `pub use bun_jsc::{JSValue, JSGlobalObject, JSPromise, JSString, CallFrame,
// VM, JsResult, JsError, FromJsEnum};` and delete the local impls. The
// `SystemErrorJsc` extension trait stays here (it bridges T1
// `bun_sys::SystemError` → JSC, which is this crate's job).
// ──────────────────────────────────────────────────────────────────────────

pub mod signal_code_jsc;
pub mod error_jsc;
pub mod fd_jsc;

pub use error_jsc::ErrorJsc;
pub use fd_jsc::FdJsc;

// ──────────────────────────────────────────────────────────────────────────
// Crate-local JSC handle types. `bun_jsc` is not yet a usable dependency
// (transitive deps `bun_spawn`/`bun_logger`/`bun_bundler` fail to compile),
// and there is NO dependency cycle here — `bun_jsc → bun_sys` and
// `bun_sys_jsc → bun_jsc` are both acyclic — so the layering fix is simply
// "fix those crates" (out of this file's scope), not "extract a types crate".
//
// These are `#[repr(transparent)]` over the same encoded word / pointer ABI
// as `bun_jsc`'s definitions, with REAL method bodies calling the identical
// `JSC__*` / `Bun__*` C++ symbols, so downstream callers can switch to
// `bun_jsc::*` without signature or ABI churn.
// ──────────────────────────────────────────────────────────────────────────

/// Stand-in for `bun_jsc::JSValue` (`#[repr(transparent)] i64`, `Copy`, `!Send`).
// TODO(b2-blocked): bun_jsc::JSValue
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSValue(pub usize);

/// Stand-in for `bun_jsc::JSGlobalObject` (always borrowed, never owned).
// TODO(b2-blocked): bun_jsc::JSGlobalObject
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSGlobalObject(pub usize);

/// Stand-in for `bun_jsc::JSPromise`.
// TODO(b2-blocked): bun_jsc::JSPromise
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSPromise(pub usize);

/// Stand-in for `bun_jsc::CallFrame`.
// TODO(b2-blocked): bun_jsc::CallFrame
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CallFrame(pub usize);

/// Stand-in for `bun_jsc::JsError` (opaque "exception pending" marker).
// TODO(b2-blocked): bun_jsc::JsError
#[derive(Debug, Clone, Copy, Default)]
pub struct JsError;

/// Stand-in for `bun_jsc::JsResult<T>` (= `Result<T, JsError>`).
// TODO(b2-blocked): bun_jsc::JsResult
pub type JsResult<T> = core::result::Result<T, JsError>;

/// Stand-in for `bun_jsc::JSString`.
// TODO(b2-blocked): bun_jsc::JSString
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSString(pub usize);

/// Stand-in for `bun_jsc::VM`.
// TODO(b2-blocked): bun_jsc::VM
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct VM(pub usize);

/// Stand-in for `bun_jsc`'s range-error options bag. Real type in `bun_jsc` is
/// `bun_core::fmt::OutOfRangeOptions<'a>` (`{min: i64, max: i64, field_name:
/// &[u8], msg: &[u8]}`); kept local so this crate need not depend on
/// `bun_core` directly while `bun_jsc` is unavailable.
// TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_range_error (options type)
#[derive(Default)]
pub struct RangeErrorOptions<'a> {
    pub field_name: &'a [u8],
    pub msg: &'a [u8],
    pub min: i64,
    pub max: i64,
}

/// Stand-in for `bun_jsc::FromJsEnum` (string-JSValue → Rust enum bridge used
/// by `JSValue::to_enum`).
// TODO(b2-blocked): bun_jsc::FromJsEnum
pub trait FromJsEnum: Sized {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self>;
}

// ──────────────────────────────────────────────────────────────────────────
// JSC encoded-value tag constants (JSCJSValue.h / src/jsc/FFI.zig).
// ──────────────────────────────────────────────────────────────────────────
const NUMBER_TAG: usize = 0xfffe_0000_0000_0000;
const NOT_CELL_MASK: usize = NUMBER_TAG | 0x2;
const DOUBLE_ENCODE_OFFSET: i64 = 1i64 << 49;

/// `JSType` byte values (src/jsc/JSType.zig) needed for `is_string`.
const JSTYPE_STRING: u8 = 2;
const JSTYPE_STRING_OBJECT: u8 = 94;
const JSTYPE_DERIVED_STRING_OBJECT: u8 = 95;

/// `ErrorCode` u16 discriminants (codegen ErrorCode.zig / ErrorCode+List.h).
/// Kept local so this crate need not depend on `bun_jsc` while it is broken.
const ERR_INVALID_ARG_TYPE: u16 = 119;
const ERR_OUT_OF_RANGE: u16 = 157;

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — JSC bindings (src/jsc/bindings/bindings.cpp). Shim types are
// `#[repr(transparent)]` over `usize` so passing them by value matches the
// `EncodedJSValue` / pointer ABI on all supported 64-bit targets.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    fn JSC__JSValue__isAnyInt(this: JSValue) -> bool;
    fn JSC__JSValue__jsType(this: JSValue) -> u8;
    fn JSC__JSValue__jsNumberFromDouble(n: f64) -> JSValue;
    fn JSC__JSValue__toInt32(this: JSValue) -> i32;
    fn JSC__JSValue__toInt64(this: JSValue) -> i64;
    fn JSC__JSValue__asString(this: JSValue) -> *mut core::ffi::c_void;
    fn JSC__JSString__length(this: *const core::ffi::c_void) -> usize;
    fn JSC__JSGlobalObject__vm(this: *const JSGlobalObject) -> *const VM;
    fn JSGlobalObject__hasException(this: *const JSGlobalObject) -> bool;
    fn JSC__VM__throwError(vm: *const VM, global: *const JSGlobalObject, value: JSValue);
    fn Bun__createErrorWithCode(
        global: *const JSGlobalObject,
        code: u16,
        message: *mut bun_string::String,
    ) -> JSValue;
    fn BunString__toErrorInstance(
        this: *const bun_string::String,
        global: *const JSGlobalObject,
    ) -> JSValue;
    fn BunString__fromJS(
        global: *const JSGlobalObject,
        value: JSValue,
        out: *mut bun_string::String,
    ) -> bool;
    fn SystemError__toErrorInstance(
        this: *const CSystemError,
        global: *const JSGlobalObject,
    ) -> JSValue;
    fn Bun__attachAsyncStackFromPromise(
        global: *const JSGlobalObject,
        err: JSValue,
        promise: *const JSPromise,
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Shim method surface — REAL bodies ported from `src/jsc/JSValue.zig` /
// `src/jsc/{JSGlobalObject,VM,CallFrame,JSString,SystemError}.zig`.
// ──────────────────────────────────────────────────────────────────────────

impl JSValue {
    pub const ZERO: JSValue = JSValue(0);
    pub const UNDEFINED: JSValue = JSValue(0xa);
    pub const NULL: JSValue = JSValue(0x2);
    pub const TRUE: JSValue = JSValue(0x7);
    pub const FALSE: JSValue = JSValue(0x6);

    // ── tag predicates ────────────────────────────────────────────────────
    #[inline] fn is_empty(self) -> bool { self.0 == 0 }
    #[inline] fn is_undefined_or_null(self) -> bool {
        // Zig: `return @intFromEnum(this) | 0x8 == 0xa;`
        (self.0 | 0x8) == 0xa
    }
    #[inline] fn is_boolean(self) -> bool {
        self.0 == Self::TRUE.0 || self.0 == Self::FALSE.0
    }
    #[inline] fn is_int32(self) -> bool { (self.0 & NUMBER_TAG) == NUMBER_TAG }
    #[inline] fn is_cell(self) -> bool {
        !self.is_empty() && (self.0 & NOT_CELL_MASK) == 0
    }
    #[inline] fn as_int32(self) -> i32 {
        debug_assert!(self.is_int32());
        (self.0 & 0xffff_ffff) as u32 as i32
    }
    #[inline] fn as_double(self) -> f64 {
        debug_assert!(self.is_number() && !self.is_int32());
        // FFI.zig: JSVALUE_TO_DOUBLE — subtract DoubleEncodeOffset, bitcast to f64.
        f64::from_bits((self.0 as i64).wrapping_sub(DOUBLE_ENCODE_OFFSET) as u64)
    }

    /// `JSValue.isNumber()` (FFI.zig `JSVALUE_IS_NUMBER`).
    #[inline]
    pub fn is_number(self) -> bool {
        (self.0 & NUMBER_TAG) != 0
    }
    /// `JSValue.isString()` — cell with `JSType.isStringLike()`.
    #[inline]
    pub fn is_string(self) -> bool {
        if !self.is_cell() { return false; }
        // SAFETY: `is_cell()` guarantees a valid JSCell pointer.
        let ty = unsafe { JSC__JSValue__jsType(self) };
        matches!(ty, JSTYPE_STRING | JSTYPE_STRING_OBJECT | JSTYPE_DERIVED_STRING_OBJECT)
    }
    /// `JSValue.isAnyInt()` (JSValue.zig:960).
    #[inline]
    pub fn is_any_int(self) -> bool {
        // SAFETY: pure FFI predicate; C++ handles non-cells.
        unsafe { JSC__JSValue__isAnyInt(self) }
    }
    /// `JSValue.isEmptyOrUndefinedOrNull()`.
    #[inline]
    pub fn is_empty_or_undefined_or_null(self) -> bool {
        self.is_empty() || self.is_undefined_or_null()
    }
    /// `JSValue.getNumber()` (JSValue.zig:2057).
    #[inline]
    pub fn get_number(self) -> Option<f64> {
        if self.is_number() { Some(self.as_number()) } else { None }
    }
    /// `JSValue.asNumber()` (JSValue.zig:2071) — asserts number/undefined/null/bool.
    #[inline]
    pub fn as_number(self) -> f64 {
        if self.is_int32() {
            self.as_int32() as f64
        } else if self.is_number() {
            self.as_double()
        } else if self.is_undefined_or_null() {
            0.0
        } else if self.is_boolean() {
            if self.0 == Self::TRUE.0 { 1.0 } else { 0.0 }
        } else {
            f64::NAN
        }
    }
    /// `JSValue.toInt32()` (JSValue.zig:2124).
    #[inline]
    pub fn to_int32(self) -> i32 {
        if self.is_int32() {
            return self.as_int32();
        }
        if let Some(num) = self.get_number() {
            // coerceJSValueDoubleTruncatingT(i32, num): NaN→0, ±Inf/OOR saturate.
            if num.is_nan() { return 0; }
            return num as i32; // Rust `as` saturates on overflow — matches Zig helper.
        }
        // SAFETY: pure FFI conversion (BigInt / cell fallback).
        unsafe { JSC__JSValue__toInt32(self) }
    }
    /// `JSValue.toInt64()` (JSValue.zig:911).
    #[inline]
    pub fn to_int64(self) -> i64 {
        if self.is_int32() {
            return self.as_int32() as i64;
        }
        if let Some(num) = self.get_number() {
            // coerceDoubleTruncatingIntoInt64.
            if num.is_nan() { return 0; }
            return num as i64; // saturating truncation
        }
        // SAFETY: pure FFI conversion (BigInt / cell fallback).
        unsafe { JSC__JSValue__toInt64(self) }
    }
    /// `JSValue.asString()` (JSValue.zig:2000). The bun_jsc version returns
    /// `*mut JSString`; the shim wraps the raw cell pointer in the local
    /// `JSString(usize)` newtype so callers can use `.length()` directly.
    #[inline]
    pub fn as_string(self) -> JSString {
        debug_assert!(self.is_string());
        // SAFETY: `is_string()` ⇒ cell-tagged ⇒ payload is the JSString*.
        JSString(unsafe { JSC__JSValue__asString(self) } as usize)
    }
    /// `JSValue.jsNumberFromInt32()` (JSValue.zig:810) — `NumberTag | i`.
    #[inline]
    pub fn js_number_from_int32(i: i32) -> JSValue {
        JSValue(NUMBER_TAG | (i as u32 as usize))
    }
    /// `JSValue.jsNumberFromUint64()` (JSValue.zig:822).
    #[inline]
    pub fn js_number_from_uint64(i: u64) -> JSValue {
        if i <= i32::MAX as u64 {
            Self::js_number_from_int32(i as i32)
        } else {
            // SAFETY: pure FFI; encodes a double into a JSValue.
            unsafe { JSC__JSValue__jsNumberFromDouble(i as f64) }
        }
    }
    pub fn to_enum<E: FromJsEnum>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<E> {
        E::from_js_value(self, global, property_name)
    }
}

impl JSString {
    /// `JSString.length()` (JSString.zig).
    pub fn length(&self) -> usize {
        // SAFETY: `self.0` is a valid JSString cell pointer (set by `as_string`).
        unsafe { JSC__JSString__length(self.0 as *const core::ffi::c_void) }
    }
}

impl JSGlobalObject {
    #[inline]
    fn has_exception(&self) -> bool {
        // SAFETY: `&self` is a valid JSGlobalObject*.
        unsafe { JSGlobalObject__hasException(self) }
    }

    /// `globalThis.throwValue(value)` — guards against an already-pending
    /// termination exception before delegating to `VM.throwError`.
    fn throw_value(&self, value: JSValue) -> JsError {
        if self.has_exception() {
            return JsError;
        }
        self.vm().throw_error(self, value)
    }

    /// Format `args` into a `bun.String`, hand it to `Bun__createErrorWithCode`
    /// (which picks ctor/`.name`/`.code` from `errors[code]`), then throw.
    fn throw_with_code(&self, code: u16, args: core::fmt::Arguments<'_>) -> JsError {
        let mut message = bun_string::String::create_format(args);
        // SAFETY: `&self` is live; `message` is a valid `bun.String` borrowed for
        // the call (C++ clones the impl into a JSString).
        let v = unsafe { Bun__createErrorWithCode(self, code, &mut message) };
        message.deref();
        self.throw_value(v)
    }

    /// `globalThis.throwInvalidArguments(fmt, args)` →
    /// `ErrorCode.INVALID_ARG_TYPE.fmt(...)` then `throwValue`.
    pub fn throw_invalid_arguments(&self, args: core::fmt::Arguments<'_>) -> JsError {
        self.throw_with_code(ERR_INVALID_ARG_TYPE, args)
    }
    /// `globalThis.throw(fmt, args)` — plain Error from a formatted string.
    pub fn throw(&self, args: core::fmt::Arguments<'_>) -> JsError {
        let message = bun_string::String::create_format(args);
        // SAFETY: `&self` is live; `message` is a valid `bun.String`; C++ clones.
        let instance = unsafe { BunString__toErrorInstance(&message, self) };
        message.deref();
        if instance.is_empty() {
            debug_assert!(self.has_exception());
            return JsError;
        }
        self.throw_value(instance)
    }
    /// `globalThis.throwRangeError(value, opts)` →
    /// `ErrorCode.OUT_OF_RANGE.fmt(bun.fmt.outOfRange(value, opts))` then throw.
    pub fn throw_range_error<V: core::fmt::Display>(
        &self,
        value: V,
        options: RangeErrorOptions<'_>,
    ) -> JsError {
        // Port of `bun.fmt.outOfRange` (src/bun_core/fmt.zig): builds the
        // "The value of <field> is out of range. It must be <msg|min..max>.
        // Received <value>" message.
        let field = bstr::BStr::new(options.field_name);
        let received = format_args!("{}", value);
        if !options.msg.is_empty() {
            self.throw_with_code(
                ERR_OUT_OF_RANGE,
                format_args!(
                    "The value of \"{}\" is out of range. It must be {}. Received {}",
                    field,
                    bstr::BStr::new(options.msg),
                    received,
                ),
            )
        } else {
            self.throw_with_code(
                ERR_OUT_OF_RANGE,
                format_args!(
                    "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                    field, options.min, options.max, received,
                ),
            )
        }
    }
    /// `globalThis.vm()`.
    pub fn vm(&self) -> &VM {
        // SAFETY: JSC guarantees the VM outlives the global object; FFI returns
        // a non-null pointer.
        unsafe { &*JSC__JSGlobalObject__vm(self) }
    }
}

impl VM {
    /// `VM.throwError(global, value)` (VM.zig:165).
    pub fn throw_error(&self, global: &JSGlobalObject, value: JSValue) -> JsError {
        // PORT NOTE: Zig wraps this in `ExceptionValidationScope` (debug-build
        // assertion harness keyed by `@src()`). The shim cannot reach
        // `bun_jsc::ExceptionValidationScope` while that crate is broken; the
        // FFI call itself is the entire observable behaviour.
        // SAFETY: `&self`/`global` are valid; `value` is live on this VM.
        unsafe { JSC__VM__throwError(self, global, value) };
        JsError
    }
}

impl CallFrame {
    // JSC register-file slot offsets (CallFrame.zig / JSC CallFrame.h).
    const OFFSET_ARGUMENT_COUNT_INCLUDING_THIS: usize = 4;
    const OFFSET_THIS_ARGUMENT: usize = 5;
    const OFFSET_FIRST_ARGUMENT: usize = 6;

    #[inline]
    fn as_unsafe_js_value_array(&self) -> *const JSValue {
        // SAFETY: CallFrame is an opaque handle whose address IS the base of
        // the JSC register array (Zig: `@ptrCast(@alignCast(self))`).
        (self as *const Self).cast::<JSValue>()
    }

    fn argument_count_including_this(&self) -> u32 {
        // SAFETY: slot OFFSET_ARGUMENT_COUNT_INCLUDING_THIS is a valid Register
        // whose low 32 bits hold the count (`Register::unboxedInt32()`).
        let raw = unsafe {
            *self
                .as_unsafe_js_value_array()
                .add(Self::OFFSET_ARGUMENT_COUNT_INCLUDING_THIS)
        };
        // Little-endian payload extraction (`EncodedValueDescriptor.asBits.payload`).
        u32::try_from((raw.0 & 0xffff_ffff) as u32 as i32).unwrap()
    }

    /// A slice of all passed arguments to this function call.
    pub fn arguments(&self) -> &[JSValue] {
        let count = (self.argument_count_including_this() - 1) as usize;
        // SAFETY: slots OFFSET_FIRST_ARGUMENT..+count are valid JSValue
        // registers per JSC CallFrame layout.
        unsafe {
            core::slice::from_raw_parts(
                self.as_unsafe_js_value_array().add(Self::OFFSET_FIRST_ARGUMENT),
                count,
            )
        }
    }
}

impl FromJsEnum for bun_sys::SignalCode {
    /// `JSValue.toEnumFromMap(global, "signal", SignalCode, SignalCode.Map)`
    /// (JSValue.zig:1703).
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        if !v.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{} must be a string",
                property_name
            )));
        }
        // `StringMap.fromJS` — `bun.String.fromJS` then phf lookup.
        let mut out = bun_string::String::DEAD;
        // SAFETY: `out` is a valid out-param; `global` is live.
        let ok = unsafe { BunString__fromJS(global, v, &mut out) };
        if !ok {
            return Err(JsError);
        }
        let utf8 = out.to_utf8();
        let hit = bun_sys::signal_code::MAP.get(utf8.slice()).copied();
        drop(utf8);
        out.deref();
        match hit {
            Some(code) => Ok(code),
            // Zig builds the `'SIGHUP', 'SIGINT' or ...` list at comptime; at
            // 31 variants the runtime port keeps the message terse.
            None => Err(global.throw_invalid_arguments(format_args!(
                "{} must be one of the SignalCode names",
                property_name
            ))),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SystemErrorJsc — JSC bridge for the T1 `bun_sys::SystemError` data struct.
//
// In Zig there is one `jsc.SystemError` with `.toErrorInstance()`. The Rust
// port split the data (T1 `bun_sys::SystemError`) from the JSC method
// (`bun_jsc::SystemError::to_error_instance`). Per PORTING.md §"_jsc bridge
// crates", this extension trait is the canonical bridge and STAYS in this
// crate after `bun_jsc` is green (its body becomes a thin call into
// `bun_jsc`).
// ──────────────────────────────────────────────────────────────────────────
pub trait SystemErrorJsc {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue;
}

/// `#[repr(C)]` mirror of `jsc.SystemError` (`src/jsc/SystemError.zig`) — the
/// exact field order C++ `SystemError__toErrorInstance` reads. The T1
/// `bun_sys::SystemError` is NOT `#[repr(C)]` and has a different field order,
/// so we marshal through this on the way to FFI.
#[repr(C)]
struct CSystemError {
    errno: core::ffi::c_int,
    code: bun_string::String,
    message: bun_string::String,
    path: bun_string::String,
    syscall: bun_string::String,
    hostname: bun_string::String,
    fd: core::ffi::c_int,
    dest: bun_string::String,
}

impl CSystemError {
    fn from_sys(e: &bun_sys::SystemError) -> Self {
        // Bump refs: C++ consumes one ref per non-empty field; the Zig
        // `toErrorInstance` does `defer this.deref()` which we mirror below.
        e.code.ref_();
        e.message.ref_();
        e.path.ref_();
        e.syscall.ref_();
        e.hostname.ref_();
        e.dest.ref_();
        Self {
            errno: e.errno as core::ffi::c_int,
            code: e.code.clone(),
            message: e.message.clone(),
            path: e.path.clone(),
            syscall: e.syscall.clone(),
            hostname: e.hostname.clone(),
            fd: e.fd as core::ffi::c_int,
            dest: e.dest.clone(),
        }
    }
    fn deref(&self) {
        self.code.deref();
        self.message.deref();
        self.path.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }
}

impl SystemErrorJsc for bun_sys::SystemError {
    /// `SystemError.toErrorInstance(global)` (SystemError.zig).
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        let c = CSystemError::from_sys(self);
        // SAFETY: `c` is a valid `#[repr(C)]` SystemError; `global` is live.
        let result = unsafe { SystemError__toErrorInstance(&c, global) };
        // Zig: `defer this.deref();`
        c.deref();
        result
    }
    /// `SystemError.toErrorInstanceWithAsyncStack(global, promise)`
    /// (SystemError.zig) — `toErrorInstance` then attach the promise's await
    /// chain as async stack frames so threadpool-rejected promises get a
    /// useful trace.
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue {
        let value = self.to_error_instance(global);
        // SAFETY: `global`/`promise` are live; `value` is a fresh Error cell.
        unsafe { Bun__attachAsyncStackFromPromise(global, value, promise) };
        value
    }
}
