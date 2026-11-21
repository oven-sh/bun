//! Tokens for the caller's memory, so that the borrow checker separates reads from writes.

use super::raw::{before_nul, slice};
use super::{Array, NulStr, Out, Retained, Text, UChar, c_bytes};
use crate::common::utypes::*;
use std::marker::PhantomData;
use std::ptr::NonNull;

/// Stands for all memory that the arguments of a call point to, except handles: `&` reads it, `&mut` writes it. One per call.
pub(crate) struct CallerMem(PhantomData<*mut ()>);

/// A code unit.
///
/// # Safety
/// `Default` is NUL, whose bytes are zero, `PartialEq` compares the value, and `strlen` counts no unit from the NUL on.
pub(crate) unsafe trait Unit: Copy + Default + PartialEq {
    /// # Safety
    /// `s` points to a NUL-terminated string.
    #[inline]
    unsafe fn strlen(s: *const Self) -> usize {
        UntilNul {
            next: s,
            text: PhantomData,
        }
        .count()
    }
}

// SAFETY: std's `Default` and `PartialEq` of an integer. `c_bytes` ends before the NUL.
unsafe impl Unit for u8 {
    #[inline]
    unsafe fn strlen(s: *const u8) -> usize {
        // SAFETY: `s` is NUL-terminated.
        unsafe { c_bytes(s.cast()) }.len()
    }
}
// SAFETY: std's `Default` and `PartialEq` of an integer.
unsafe impl Unit for UChar {}

impl CallerMem {
    /// # Safety
    /// During `'a` the call has no other token and no other reference to the caller's memory.
    pub(crate) unsafe fn new<'a>() -> &'a mut Self {
        // SAFETY: the type is zero-sized.
        unsafe { NonNull::dangling().as_mut() }
    }

    /// Returns `U_ILLEGAL_ARGUMENT_ERROR` for a length below -1, or for null with a nonzero length.
    #[inline]
    pub(crate) fn text<'a, T: Unit>(&'a self, s: Text<'a, T>) -> Result<&'a [T], UErrorCode> {
        if s.is_null() {
            return if s.length == 0 {
                Ok(&[])
            } else {
                Err(U_ILLEGAL_ARGUMENT_ERROR)
            };
        }
        let length = match s.length {
            0.. => s.length as usize,
            -1 => {
                // SAFETY: a `Text` of length -1 that is not null ends with a NUL.
                unsafe { T::strlen(s.ptr) }
            }
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        // SAFETY: a `Text` has `length` units, and `&self` excludes writes during `'a`.
        Ok(unsafe { slice(s.ptr, length) })
    }

    /// `text` for two texts. Reads neither if one is invalid.
    #[inline]
    pub(crate) fn texts<'a, T: Unit>(
        &'a self,
        s: Text<'a, T>,
        t: Text<'a, T>,
    ) -> Result<[&'a [T]; 2], UErrorCode> {
        t.check()?;
        self.text(s).and_then(|s| self.text(t).map(|t| [s, t]))
    }

    pub(crate) fn c_str<'a>(&'a self, s: NulStr<'a, u8>) -> Option<&'a [u8]> {
        // SAFETY: a `NulStr` that is not null ends with a NUL, and `&self` excludes writes during `'a`.
        (!s.is_null()).then(|| unsafe { c_bytes(s.ptr.cast()) })
    }

    /// Returns the units before the NUL, at most `limit`. Reads no unit after them.
    pub(crate) fn str_up_to<'a, T: Unit>(
        &'a self,
        s: NulStr<'a, T>,
        limit: usize,
    ) -> Option<&'a [T]> {
        // SAFETY: a `NulStr` that is not null is readable up to its NUL, and `&self` excludes writes during `'a`.
        (!s.is_null()).then(|| unsafe { before_nul(s.ptr, limit) })
    }

    pub(crate) fn until_nul<'a, T>(&'a self, s: NulStr<'a, T>) -> Option<UntilNul<'a, T>> {
        (!s.is_null()).then_some(UntilNul {
            next: s.ptr,
            text: PhantomData,
        })
    }

    /// Returns an empty slice for null or a negative length.
    pub(crate) fn slice<'a, T: Copy>(&'a self, array: Array<'a, T>) -> &'a [T] {
        // SAFETY: an `Array` is null or has `length` values, and `&self` excludes writes during `'a`.
        unsafe { slice(array.ptr, array.length.max(0) as usize) }
    }

    /// Writes `value` unless `out` is null. `T` must have no padding, which could carry old contents of the stack to the caller.
    pub(crate) fn store<'a, T: 'a>(&mut self, out: impl Into<Out<'a, T>>, value: T) {
        let out = out.into();
        if !out.is_null() {
            // SAFETY: an `Out` that is not null is writable, and `&mut self` excludes borrows.
            unsafe { out.ptr.write(value) };
        }
    }
}

impl<T: Unit> Retained<Text<'static, T>> {
    /// Returns the text with its length, so that it is not searched for the NUL again.
    pub(crate) fn measured(self, cx: &CallerMem) -> Result<Self, UErrorCode> {
        let length = i32::try_from(cx.text(self.0)?.len()).or(Err(U_ILLEGAL_ARGUMENT_ERROR))?;
        Ok(Self(Text { length, ..self.0 }))
    }
}

/// Iterates over the units before the NUL.
pub(crate) struct UntilNul<'a, T> {
    /// Does not move past the NUL.
    pub(super) next: *const T,
    pub(super) text: PhantomData<&'a [T]>,
}

impl<T: Unit> Iterator for UntilNul<'_, T> {
    type Item = T;

    #[inline]
    fn next(&mut self) -> Option<T> {
        // SAFETY: no unit before this one is the NUL.
        let unit = unsafe { self.next.read() };
        if unit == T::default() {
            return None;
        }
        // SAFETY: the unit is not the NUL, so the string continues.
        self.next = unsafe { self.next.add(1) };
        Some(unit)
    }
}
