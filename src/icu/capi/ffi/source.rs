//! What the caller passes to be read. README.md says when it may overlap what the call writes.

use super::raw::{before_nul, slice};
use super::{Array, NulStr, Text, UChar, c_bytes};
use crate::common::utypes::*;
use std::marker::PhantomData;

/// A code unit.
/// SAFETY: `Default` is NUL, whose bytes are zero, `PartialEq` compares the value, and `strlen` counts no unit from the NUL on.
pub(crate) unsafe trait Unit: Copy + Default + PartialEq {
    /// SAFETY: `s` points to a NUL-terminated string.
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

impl<'c, T: Unit> Text<'c, T> {
    /// Returns `U_ILLEGAL_ARGUMENT_ERROR` for a length below -1, or for null with a nonzero length.
    #[inline]
    pub(crate) fn get(self) -> Result<&'c [T], UErrorCode> {
        if self.is_null() {
            return if self.length == 0 {
                Ok(&[])
            } else {
                Err(U_ILLEGAL_ARGUMENT_ERROR)
            };
        }
        let length = match self.length {
            0.. => self.length as usize,
            -1 => {
                // SAFETY: a `Text` of length -1 that is not null ends with a NUL.
                unsafe { T::strlen(self.ptr) }
            }
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        // SAFETY: a `Text` has `length` units, which are not written while they are read.
        Ok(unsafe { slice(self.ptr, length) })
    }

    /// Returns no units for what `get` rejects.
    #[inline]
    #[cfg_attr(mordant, allow(defaulted_failure))]
    pub(crate) fn get_or_empty(self) -> &'c [T] {
        self.get().unwrap_or_default()
    }
}

impl<'c> NulStr<'c, u8> {
    pub(crate) fn get(self) -> Option<&'c [u8]> {
        // SAFETY: a `NulStr` that is not null ends with a NUL, and is not written while it is read.
        (!self.is_null()).then(|| unsafe { c_bytes(self.ptr.cast()) })
    }
}

impl<'c, T: Unit> NulStr<'c, T> {
    /// Returns the units before the NUL, at most `limit`. Reads no unit after them.
    pub(crate) fn up_to(self, limit: usize) -> Option<&'c [T]> {
        // SAFETY: a `NulStr` that is not null ends with a NUL, and is not written while it is read.
        (!self.is_null()).then(|| unsafe { before_nul(self.ptr, limit) })
    }

    pub(crate) fn units(self) -> Option<UntilNul<'c, T>> {
        (!self.is_null()).then_some(UntilNul {
            next: self.ptr,
            text: PhantomData,
        })
    }
}

impl<'c, T: Copy> Array<'c, T> {
    /// Returns an empty slice for null or a negative length.
    pub(crate) fn get(self) -> &'c [T] {
        // SAFETY: an `Array` is null or has `length` values, which are not written while they are read.
        unsafe { slice(self.ptr, self.length.max(0) as usize) }
    }
}

/// Iterates over the units before the NUL.
pub(crate) struct UntilNul<'a, T> {
    /// Does not move past the NUL.
    next: *const T,
    text: PhantomData<&'a [T]>,
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
