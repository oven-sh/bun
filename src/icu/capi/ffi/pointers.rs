//! Typed pointers for signatures. Dereferencing one needs the `CallerMem` token.

use crate::common::utypes::*;
use std::ffi::c_void;
use std::marker::PhantomData;
use std::ops::Range;

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
pub(crate) struct Out<'c, T> {
    pub(super) ptr: *mut T,
    pub(super) call: Call<'c>,
}

/// A pointer that all callers leave null.
#[repr(transparent)]
pub(crate) struct Null(*const c_void);

/// A pointer that an object stores. It is valid until the object gets another or is closed.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(crate) struct Retained<P>(pub(super) P);

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
impl_is_null!(NulStr Text Dest Out);

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
impl_copy!(NulStr Text Array Dest Out);

impl<T> Retained<Text<'_, T>> {
    pub(crate) fn get(&self) -> Text<'_, T> {
        self.0
    }
}

// SAFETY: the units are only read, as through a `&[T]`.
unsafe impl<T: Sync> Send for Text<'_, T> {}
// SAFETY: the units are only read, as through a `&[T]`.
unsafe impl<T: Sync> Sync for Text<'_, T> {}

impl<P: Pair> Pair for Retained<P> {
    type First = P::First;
    type Second = P::Second;
    unsafe fn new(first: P::First, second: P::Second) -> Self {
        // SAFETY: the contract of `Retained<P>` includes that of `P`.
        Self(unsafe { P::new(first, second) })
    }
}

impl<'c, T> Text<'c, T> {
    /// Returns `U_ILLEGAL_ARGUMENT_ERROR` where `CallerMem::text` does, without reading the text.
    pub(crate) fn check(self) -> Result<(), UErrorCode> {
        let is_legal = if self.is_null() {
            self.length == 0
        } else {
            self.length >= -1
        };
        if is_legal {
            Ok(())
        } else {
            Err(U_ILLEGAL_ARGUMENT_ERROR)
        }
    }
}

impl<'c, T> Array<'c, T> {
    pub(crate) fn check(self) -> Result<(), UErrorCode> {
        check_buffer(self.ptr, self.length)
    }
}

impl<T> Dest<'_, T> {
    /// Returns `U_ILLEGAL_ARGUMENT_ERROR` for a negative capacity, or for null with a capacity.
    pub(crate) fn check(self) -> Result<(), UErrorCode> {
        check_buffer(self.ptr, self.capacity)
    }

    pub(crate) fn address_range(self) -> Range<usize> {
        address_range(self.ptr, self.capacity)
    }

    pub(crate) fn at_most(self, capacity: i32) -> Self {
        Self {
            capacity: self.capacity.min(capacity),
            ..self
        }
    }
}

/// Returns the addresses of `count` values at `start`.
pub(crate) fn addresses<T>(start: *const T, count: usize) -> Range<usize> {
    start.addr()
        ..start
            .addr()
            .saturating_add(count.saturating_mul(size_of::<T>()))
}

/// Returns the addresses of the buffer `(T *dest, int32_t capacity)`.
pub(crate) fn address_range<T>(dest: *const T, capacity: i32) -> Range<usize> {
    addresses(dest, capacity.max(0) as usize)
}

/// Returns whether the ranges have an address in common.
pub(crate) fn overlap(one: &Range<usize>, other: &Range<usize>) -> bool {
    one.start.max(other.start) < one.end.min(other.end)
}

pub(crate) fn check_buffer<T>(pointer: *const T, count: i32) -> Result<(), UErrorCode> {
    if count < 0 || (pointer.is_null() && count != 0) {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    } else {
        Ok(())
    }
}
