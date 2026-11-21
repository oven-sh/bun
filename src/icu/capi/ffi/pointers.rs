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

/// Null, or a handle that the call does not modify.
#[repr(transparent)]
pub(crate) struct Ref<'c, T> {
    pub(super) ptr: *const T,
    pub(super) call: Call<'c>,
}

/// Null, or a handle that the call modifies. Only `MayAlias` parameters alias it.
#[repr(transparent)]
pub(crate) struct Mut<'c, T> {
    pub(super) ptr: *mut T,
    pub(super) call: Call<'c>,
}

/// Null, or a handle whose ownership passes to the call.
#[repr(transparent)]
pub(crate) struct Owned<'c, T> {
    pub(super) ptr: *mut T,
    pub(super) call: Call<'c>,
}

/// A source or handle `P` that may equal, point into, or contain the `H` that the call modifies.
#[repr(transparent)]
pub(crate) struct MayAlias<P, H>(pub(super) P, PhantomData<fn() -> H>);

/// A pointer that an object stores. It is valid until the object gets another or is closed.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(crate) struct Retained<P>(pub(super) P);

/// The only value through which an `H` is modified.
/// SAFETY: A shared reference to the value cannot overwrite or free memory of the `H` to which C may point.
pub(crate) unsafe trait Mutates<H> {}
// SAFETY: the methods that overwrite or free such memory take `self`.
unsafe impl<H> Mutates<H> for Mut<'_, H> {}

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
    as_ptr: *const T = ptr for NulStr Ref;
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
impl_is_null!(NulStr Text Dest Out Mut);

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
impl_copy!(NulStr Text Array Dest Out Ref);

macro_rules! impl_tied_to {
    ($($name:ident)+) => {$(
        impl<'c, T, H> MayAlias<$name<'c, T>, H> {
            /// Ties the pointer to the borrow of `object`. `T: 'static` rejects arrays of strings, whose elements would outlive it.
            pub(crate) fn tied_to<'a>(self, _object: &'a impl Mutates<H>) -> $name<'a, T> where 'c: 'a, T: 'static {
                self.0
            }
        }
    )+};
}
impl_tied_to!(Text Array);

impl<T> Retained<Text<'_, T>> {
    pub(crate) fn get(&self) -> Text<'_, T> {
        self.0
    }
}

// SAFETY: dereferencing needs a `CallerMem`, which is neither `Send` nor `Sync`.
unsafe impl<T: Sync> Send for Text<'_, T> {}
// SAFETY: dereferencing needs a `CallerMem`, which is neither `Send` nor `Sync`.
unsafe impl<T: Sync> Sync for Text<'_, T> {}

/// `#[derive(Clone, Copy)]` without the bound on `H`.
impl<P: Copy, H> Clone for MayAlias<P, H> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<P: Copy, H> Copy for MayAlias<P, H> {}

impl<P, H> From<P> for MayAlias<P, H> {
    fn from(pointer: P) -> Self {
        Self(pointer, PhantomData)
    }
}

impl<P: Pair, H> Pair for MayAlias<P, H> {
    type First = P::First;
    type Second = P::Second;
    unsafe fn new(first: P::First, second: P::Second) -> Self {
        // SAFETY: the contract of `MayAlias<P, H>` includes that of `P`.
        unsafe { P::new(first, second) }.into()
    }
}

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
