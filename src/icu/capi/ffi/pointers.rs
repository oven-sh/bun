//! Typed pointers for signatures.

use crate::common::utypes::*;
use std::cell::Cell;
use std::ffi::c_void;
use std::marker::PhantomData;
use std::mem::MaybeUninit;

/// A type that is made of two C parameters: `(s, length): Text<UChar>`.
pub(crate) trait Pair {
    type First;
    type Second: Copy;
    /// SAFETY: The arguments satisfy the contract of the type for its lifetime.
    unsafe fn new(first: Self::First, second: Self::Second) -> Self;
}

type Call<'c> = PhantomData<&'c ()>;

/// `const T *`: null, or a NUL-terminated string.
#[repr(transparent)]
pub(crate) struct NulStr<'c, T> {
    pub(super) ptr: *const T,
    pub(super) call: Call<'c>,
}

/// `const T *, int32_t`: null, or `length` units, or a NUL-terminated string if `length` is negative.
pub(crate) struct Text<'c, T> {
    pub(super) ptr: *const T,
    pub(super) length: i32,
    pub(super) call: Call<'c>,
}

/// `const T *, int32_t`: null, or `length` values.
pub(crate) struct Array<'c, T> {
    pub(super) ptr: *const T,
    pub(super) length: i32,
    pub(super) call: Call<'c>,
}

/// `T *, int32_t`: null, or an uninitialized buffer of `capacity` values.
pub(crate) struct Dest<'c, T> {
    pub(super) ptr: *mut T,
    pub(super) capacity: i32,
    pub(super) call: Call<'c>,
}

/// `T *`: null, or an uninitialized variable.
#[repr(transparent)]
pub(crate) struct Out<'c, T>(Option<&'c Cell<MaybeUninit<T>>>);

impl<T> Out<'_, T> {
    pub(crate) fn is_null(self) -> bool {
        self.0.is_none()
    }

    /// `T` must have no padding, which could carry old contents of the stack to the caller.
    pub(crate) fn set(self, value: T) {
        if let Some(out) = self.0 {
            out.set(MaybeUninit::new(value));
        }
    }
}

/// A pointer that all callers leave null.
#[repr(transparent)]
pub(crate) struct Null(*const c_void);

/// For handles, which are `Option<&H>`, `Option<&mut H>` or `Option<Box<H>>`.
pub(crate) trait NonNullHandle<T> {
    fn non_null(self) -> Result<T, UErrorCode>;
}

impl<T> NonNullHandle<T> for Option<T> {
    fn non_null(self) -> Result<T, UErrorCode> {
        self.ok_or(U_ILLEGAL_ARGUMENT_ERROR)
    }
}

macro_rules! impl_accessors {
    ($($method:ident: $type:ty = $field:ident for $($name:ident)+;)+) => {$($(
        impl<T> $name<'_, T> {
            pub(crate) fn $method(&self) -> $type {
                self.$field
            }
        }
    )+)+};
}
impl_accessors! {
    as_ptr: *const T = ptr for NulStr;
    length: i32 = length for Text Array;
    capacity: i32 = capacity for Dest;
}

macro_rules! impl_is_null {
    ($($name:ident)+) => {$(
        impl<T> $name<'_, T> {
            pub(crate) fn is_null(&self) -> bool {
                self.ptr.is_null()
            }
        }
    )+};
}
impl_is_null!(NulStr Text Dest);

impl Null {
    pub(crate) fn is_null(&self) -> bool {
        self.0.is_null()
    }
}

macro_rules! impl_pair {
    ($($name:ident(*$kind:tt, $count:ident))+) => {$(
        impl<T> Pair for $name<'_, T> {
            type First = *$kind T;
            type Second = i32;
            unsafe fn new(ptr: *$kind T, $count: i32) -> Self {
                Self { ptr, $count, call: PhantomData }
            }
        }
    )+};
}
impl_pair!(Text(*const, length) Array(*const, length) Dest(*mut, capacity));

/// `#[derive(Clone, Copy)]` without the bound on `T`.
macro_rules! impl_copy {
    ($($name:ident)+) => {$(
        impl<T> Clone for $name<'_, T> {
            fn clone(&self) -> Self {
                *self
            }
        }

        impl<T> Copy for $name<'_, T> {}
    )+};
}
impl_copy!(NulStr Text Array Out);

impl<'c, T> Array<'c, T> {
    pub(crate) fn check(self) -> Result<(), UErrorCode> {
        check_buffer(self.ptr, self.length)
    }
}

pub(super) fn check_buffer<T>(pointer: *const T, count: i32) -> Result<(), UErrorCode> {
    if count < 0 || (pointer.is_null() && count != 0) {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    } else {
        Ok(())
    }
}
