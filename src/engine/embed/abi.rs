//! How the types of an `#[export]` function cross to C++. `src/codegen/generate-engine-headers.ts` writes the other side.
//!
//! - A slice, a `Text` and an `AsciiLiteral` are passed in parts.
//! - What can be empty is an `Option`. A `&StringImpl`, `StringRef` or `&Identifier` is empty where C++ has a null one.
//! - A `JsResult` comes back as zero when it is an error, and the exception is pending in the `Vm`.
//! - A counted reference that is passed or returned by value changes hands.
//!
//! C++ keeps what it passes valid for the call, and passes a `Cx` or a `Vm` only on the thread of that `Vm`.

use core::ffi::c_void;

use bun_engine_text::{Atom, Identifier, PropertyName, StringRef, SymbolRef, Text};
use bun_engine_vm::{AsciiLiteral, Gc, JsResult, Value};

pub(crate) trait Returned {
    type Abi;
    const FAILED: Self::Abi;

    fn into_abi(self) -> Self::Abi;
}

impl<T: Returned> Returned for JsResult<T> {
    type Abi = T::Abi;
    const FAILED: T::Abi = T::FAILED;

    #[inline(always)]
    fn into_abi(self) -> T::Abi {
        self.map_or(T::FAILED, T::into_abi)
    }
}

/// Types that are returned as they are, and what stands for them after an error.
macro_rules! returned_by_value {
    ($($type:ty = $failed:expr,)*) => {$(
        impl $crate::abi::Returned for $type {
            type Abi = $type;
            const FAILED: $type = $failed;

            #[inline(always)]
            fn into_abi(self) -> $type {
                self
            }
        }
    )*};
}

/// Types of one word that is not zero.
macro_rules! returned_as_pointer {
    ($($type:ty $(where $parameter:ident)?,)*) => {$(
        impl$(<$parameter>)? $crate::abi::Returned for $type {
            type Abi = Option<Self>;
            const FAILED: Option<Self> = None;

            #[inline(always)]
            fn into_abi(self) -> Option<Self> {
                Some(self)
            }
        }

        impl$(<$parameter>)? $crate::abi::Returned for Option<$type> {
            type Abi = Self;
            const FAILED: Self = None;

            #[inline(always)]
            fn into_abi(self) -> Self {
                self
            }
        }
    )*};
}

pub(crate) use {returned_as_pointer, returned_by_value};

returned_by_value! {
    () = (),
    bool = false,
    u8 = 0,
    u16 = 0,
    u32 = 0,
    u64 = 0,
    usize = 0,
    i32 = 0,
    i64 = 0,
    f64 = 0.0,
}

returned_as_pointer! {
    Value,
    Gc<T> where T,
    &T where T,
    &mut T where T,
    StringRef,
    Atom,
    Identifier,
    SymbolRef,
    PropertyName<'_>,
}

impl<T> Returned for *const T {
    type Abi = *const T;
    const FAILED: *const T = core::ptr::null();

    #[inline(always)]
    fn into_abi(self) -> *const T {
        self
    }
}

impl<T> Returned for *mut T {
    type Abi = *mut T;
    const FAILED: *mut T = core::ptr::null_mut();

    #[inline(always)]
    fn into_abi(self) -> *mut T {
        self
    }
}

/// C++ may pass on what a call that threw has returned before it looks for the exception.
#[inline(always)]
pub(crate) fn value(value: Option<Value>) -> Value {
    value.unwrap_or_default()
}

/// For a result that C++ may look at before it looks for the exception, which stays pending.
#[inline(always)]
pub(crate) fn or_undefined(result: JsResult<Value>) -> JsResult<Value> {
    Ok(result.unwrap_or_default())
}

/// # Safety
/// `length` elements that nothing changes for `'a`.
#[inline(always)]
pub(crate) unsafe fn slice<'a, T>(first: *const T, length: usize) -> &'a [T] {
    if length == 0 {
        return &[];
    }
    // SAFETY: the caller's.
    unsafe { core::slice::from_raw_parts(first, length) }
}

/// # Safety
/// As for `slice`, with units of the width that `is_latin1` names.
#[inline(always)]
pub(crate) unsafe fn text<'a>(first: *const c_void, length: usize, is_latin1: bool) -> Text<'a> {
    // SAFETY: the caller's.
    unsafe {
        if is_latin1 {
            Text::Latin1(slice(first.cast(), length))
        } else {
            Text::Utf16(slice(first.cast(), length))
        }
    }
}

/// # Safety
/// Null, or `length` ASCII characters and a zero byte in static memory.
#[inline(always)]
pub(crate) unsafe fn literal(first: *const u8, length: usize) -> AsciiLiteral {
    if first.is_null() {
        return AsciiLiteral::NULL;
    }
    // SAFETY: the caller's.
    unsafe { AsciiLiteral::from_raw_parts(first, length + 1) }
}
