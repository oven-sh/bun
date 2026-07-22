//! Node-compat error codes — generated from `src/jsc/bindings/ErrorCode.ts`.
//!
//! Mirrors C++ `Bun::ErrorCode` in `ErrorCode+List.h`. Discriminants MUST stay
//! index-aligned with the C++ `errors[]` table so `Bun__createErrorWithCode`
//! picks the correct ctor / name / code triple. The constants, `ERR_`-prefixed
//! aliases, `COUNT`, and `CODE_STR` table are emitted by
//! `src/codegen/generate-node-errors.ts` alongside the C++ headers, so the
//! three sides cannot drift.

#![allow(non_upper_case_globals)]

use core::ffi::c_void;
use core::fmt::Arguments;

use crate::{JSGlobalObject, JSPromise, JSValue, JsError};

// ──────────────────────────────────────────────────────────────────────────
// `JSGlobalObject` is currently defined twice during the port: the legacy
// opaque stub at `crate::JSGlobalObject` (lib.rs) and the real port at
// `crate::js_global_object::JSGlobalObject`. Both are `#[repr(C)]` zero-sized
// opaque handles to the same C++ `JSC::JSGlobalObject`, so they are ABI-
// identical and a `&T → *mut c_void` reinterpret is sound. `ErrorCode::fmt`
// et al. are called from both sides; this trait erases the nominal split
// until the stub is removed and `js_global_object::JSGlobalObject` becomes
// the sole re-export.
// ──────────────────────────────────────────────────────────────────────────
pub trait GlobalObjectRef {
    /// Raw `JSC::JSGlobalObject*` for FFI.
    fn as_global_ptr(&self) -> *mut c_void;
    /// `globalThis.vm().throwError(globalThis, value)`.
    fn throw_js_value(&self, value: JSValue) -> JsError;
}

impl GlobalObjectRef for crate::JSGlobalObject {
    #[inline]
    fn as_global_ptr(&self) -> *mut c_void {
        std::ptr::from_ref::<Self>(self).cast_mut().cast::<c_void>()
    }
    #[inline]
    fn throw_js_value(&self, value: JSValue) -> JsError {
        self.throw_value(value)
    }
}

type ErrorCodeInt = u16;

/// `Bun::ErrorCode` in C++. Modelled as a newtype-over-`u16` so the same type
/// can also carry the legacy sentinels (`PARSER_ERROR` / `JS_ERROR_OBJECT`)
/// without an exhaustive-match obligation.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct ErrorCode(pub ErrorCodeInt);

// Generated from `src/jsc/bindings/ErrorCode.ts` alongside the C++
// `ErrorCode+List.h` / `ErrorCode+Data.h`. Provides:
//   impl ErrorCode { pub const <NAME>: ErrorCode; ...; pub const COUNT: u16; }
//   impl ErrorCode { pub const ERR_<NAME>: ErrorCode; ... }
//   static CODE_STR: [&str; ErrorCode::COUNT as usize]
include!(concat!(env!("BUN_CODEGEN_DIR"), "/ErrorCode.generated.rs"));

// NOTE: `ERR_SYSTEM_ERROR` / `ERR_CHILD_CLOSED_BEFORE_REPLY` intentionally
// do NOT live here. They belong to the unrelated enum
// `bun_runtime::node::nodejs_error_code::ErrorCode`, not to the
// ErrorCode.ts-derived table this type mirrors. Adding them here with
// out-of-range discriminants (≥ Self::COUNT) is a memory-safety bug: the
// C++ side does `errors[static_cast<size_t>(code)]` against a fixed
// `errors[COUNT]` array with no bounds check (ErrorCode.cpp /
// ErrorCode+Data.h), so any such value reaching `ErrorCode::fmt()` →
// `Bun__createErrorWithCode` reads past the array and past
// `ErrorCodeCache::internalField`. Callers needing those tags must use
// `bun_runtime::node::nodejs_error_code::ErrorCode` directly.

// ──────────────────────────────────────────────────────────────────────────
// Legacy anyerror-wrapper sentinels.
// ──────────────────────────────────────────────────────────────────────────
impl ErrorCode {
    pub(crate) const PARSER_ERROR: ErrorCodeInt = 0xFFFE;
    pub const JS_ERROR_OBJECT: ErrorCodeInt = 0xFFFD;
}

impl ErrorCode {
    #[inline]
    pub const fn raw(self) -> u16 {
        self.0
    }

    /// Node `error.code` string (e.g. `"ERR_INVALID_ARG_TYPE"`).
    #[inline]
    pub(crate) fn code_str(self) -> &'static str {
        CODE_STR
            .get(self.0 as usize)
            .copied()
            .unwrap_or("ERR_UNKNOWN")
    }

    /// Formats `args` into a `bun.String`, hands it to
    /// `Bun__createErrorWithCode`, and returns the constructed Error JSValue.
    /// The C++ side picks the ctor / `.name` / `.code` from `errors[self.0]`.
    pub fn fmt<G: GlobalObjectRef + ?Sized>(self, global: &G, args: Arguments<'_>) -> JSValue {
        let mut message = bun_core::String::create_format(args);
        // `G` is one of the two `#[repr(C)]` opaque ZST `JSGlobalObject`
        // handles (see `GlobalObjectRef` doc); `opaque_ref` is the safe
        // ZST-handle deref proof (panics on null). C++ clones the impl into a
        // JSString; `message` is deref'd below after the call.
        let global = JSGlobalObject::opaque_ref(global.as_global_ptr().cast::<JSGlobalObject>());
        let v = Bun__createErrorWithCode(global, self, &mut message);
        message.deref();
        v
    }

    /// `Error.throw(this, globalThis, fmt, args)` — `.fmt` then
    /// `globalThis.throwValue`.
    #[inline]
    pub fn throw<G: GlobalObjectRef + ?Sized>(self, global: &G, args: Arguments<'_>) -> JsError {
        global.throw_js_value(self.fmt(global, args))
    }
}

impl From<ErrorCode> for &'static str {
    #[inline]
    fn from(c: ErrorCode) -> &'static str {
        c.code_str()
    }
}

impl core::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.code_str())
    }
}

// safe fn: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*mut`); `bun_core::String` is `#[repr(C)]` and
// the C++ side reads it in-place (clones the impl into a JSString); `ErrorCode`
// is a by-value `#[repr(u16)]` POD.
unsafe extern "C" {
    safe fn Bun__createErrorWithCode(
        global: &JSGlobalObject,
        code: ErrorCode,
        message: &mut bun_core::String,
    ) -> JSValue;
}

/// Pending error (code + format args).
/// Returned from `JSGlobalObject::err(code, args)` so callers can choose
/// `.throw()` / `.to_js()` / `.reject()` at the use site.
pub struct ErrorBuilder<'a, G: GlobalObjectRef + ?Sized = JSGlobalObject> {
    pub(crate) global: &'a G,
    pub(crate) code: ErrorCode,
    pub(crate) args: Arguments<'a>,
}

impl<'a, G: GlobalObjectRef + ?Sized> ErrorBuilder<'a, G> {
    #[inline]
    pub fn new(global: &'a G, code: ErrorCode, args: Arguments<'a>) -> Self {
        Self { global, code, args }
    }

    /// Throw this error as a JS exception.
    #[inline]
    pub fn throw(self) -> JsError {
        self.code.throw(self.global, self.args)
    }

    /// Turn this into a JSValue (the constructed Error object).
    #[inline]
    pub fn to_js(self) -> JSValue {
        self.code.fmt(self.global, self.args)
    }

    /// Turn this into a `JSPromise` that is already rejected with the error.
    #[inline]
    pub fn reject(self) -> JSValue {
        let v = self.code.fmt(self.global, self.args);
        // `G` is one of the two `#[repr(C)]` opaque ZST `JSGlobalObject`
        // handles (see `GlobalObjectRef` doc); both name the same C++ object,
        // so reinterpreting the pointer for `JSPromise::rejected_promise`
        // (which is still typed against the lib.rs stub) is sound. `opaque_ref`
        // is the safe ZST-handle deref (panics on null).
        let global: &JSGlobalObject =
            JSGlobalObject::opaque_ref(self.global.as_global_ptr().cast::<JSGlobalObject>());
        JSPromise::rejected_promise(global, v).to_js()
    }
}

// C++ compares parser-error sentinels against these exported statics
// (`extern "C" ZigErrorCode Zig_ErrorCodeParserError;`, headers-handwritten.h).

#[unsafe(no_mangle)]
static Zig_ErrorCodeParserError: ErrorCodeInt = ErrorCode::PARSER_ERROR;

#[unsafe(no_mangle)]
static Zig_ErrorCodeJSErrorObject: ErrorCodeInt = ErrorCode::JS_ERROR_OBJECT;

// ported from: src/jsc/bindings/ErrorCode.ts
