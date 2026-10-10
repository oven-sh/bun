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

/// `Bun::ErrorCode` in C++.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct ErrorCode(pub ErrorCodeInt);

// Generated from `src/jsc/bindings/ErrorCode.ts` alongside the C++
// `ErrorCode+List.h` / `ErrorCode+Data.h`. Provides:
//   impl ErrorCode { pub const <NAME>: ErrorCode; ...; pub const COUNT: u16; }
//   impl ErrorCode { pub const ERR_<NAME>: ErrorCode; ... }
//   static CODE_STR: [&str; ErrorCode::COUNT as usize]
include!(concat!(env!("BUN_CODEGEN_DIR"), "/ErrorCode.generated.rs"));

// Do NOT add constants here with discriminants ≥ Self::COUNT (e.g.
// `ERR_SYSTEM_ERROR`): `Bun__createErrorWithCode` indexes `errors[COUNT]`
// unchecked. Codes outside ErrorCode.ts go on `SystemError.code` as a literal.

impl ErrorCode {
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
        let message = bun_core::String::create_format(args);
        // `G` is one of the two `#[repr(C)]` opaque ZST `JSGlobalObject`
        // handles (see `GlobalObjectRef` doc); `opaque_ref` is the safe
        // ZST-handle deref proof (panics on null).
        let global = JSGlobalObject::opaque_ref(global.as_global_ptr().cast::<JSGlobalObject>());
        Bun__createErrorWithCode(global, self, &message)
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
        message: &bun_core::String,
    ) -> JSValue;
}

/// Pending error (code + format args).
/// Returned from `JSGlobalObject::err(code, args)` so callers can choose
/// `.throw()` / `.to_js()` / `.reject()` at the use site.
pub struct ErrorBuilder<'a, G: GlobalObjectRef + ?Sized = JSGlobalObject> {
    pub global: &'a G,
    pub(crate) code: ErrorCode,
    pub args: Arguments<'a>,
}

impl<'a, G: GlobalObjectRef + ?Sized> ErrorBuilder<'a, G> {
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

// ported from: src/jsc/bindings/ErrorCode.ts
