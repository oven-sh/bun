//! Output buffers.

use super::pointers::check_buffer;
use super::{Dest, UChar, Unit, to_int32};
use crate::common::sink::{AliasEnd, MAX_STRING_CAPACITY, WritableAlias};
use crate::common::slice_ext::to_length;
use crate::common::utypes::*;
use std::cmp::Ordering;
use std::marker::PhantomData;

impl<T> Dest<'_, T> {
    /// Returns `U_ILLEGAL_ARGUMENT_ERROR` for a negative capacity, or for null with a capacity.
    pub(crate) fn check(&self) -> Result<(), UErrorCode> {
        check_buffer(self.ptr, self.capacity)
    }

    /// For a source that is read after the first write. Returns `U_UNSUPPORTED_ERROR` if it overlaps the buffer.
    #[inline]
    pub(crate) fn apart<'s>(&self, source: &'s [T]) -> Result<&'s [T], UErrorCode> {
        let (range, start) = (source.as_ptr_range(), self.ptr.cast_const());
        if start.max(range.start) < start.wrapping_add(to_length(self.capacity)).min(range.end) {
            Err(U_UNSUPPORTED_ERROR)
        } else {
            Ok(source)
        }
    }

    pub(crate) fn at_most(self, capacity: i32) -> Self {
        Self {
            capacity: self.capacity.min(capacity),
            ..self
        }
    }

    pub(crate) fn reborrow(&mut self) -> Dest<'_, T> {
        Dest {
            call: PhantomData,
            ..*self
        }
    }
}

impl<T: Copy> Dest<'_, T> {
    /// Writes `values` from index `at` on if they fit, else nothing.
    #[inline]
    pub(crate) fn write_at(&mut self, at: usize, values: &[T]) {
        let capacity = if self.is_null() {
            0
        } else {
            to_length(self.capacity)
        };
        if !values.is_empty() && at.saturating_add(values.len()) <= capacity {
            // SAFETY: `Dest` guarantees the buffer, and the sources that are still read are apart from it.
            unsafe {
                self.ptr
                    .add(at)
                    .copy_from_nonoverlapping(values.as_ptr(), values.len())
            };
        }
    }
}

impl<'a, T: Unit> Dest<'a, T> {
    /// Clears the buffer and returns it. It is empty if `Dest::check` fails.
    #[inline]
    pub(crate) fn cleared(self) -> &'a mut [T] {
        let Dest { ptr, capacity, .. } = self;
        if capacity <= 0 || ptr.is_null() {
            return &mut [];
        }
        // SAFETY: as in `write_at`. A `Unit` may be zero.
        unsafe {
            ptr.write_bytes(0, capacity as usize);
            std::slice::from_raw_parts_mut(ptr, capacity as usize)
        }
    }

    /// `u_terminateChars`. `length` is that of the whole text and may exceed the capacity.
    #[inline]
    pub(crate) fn terminate(mut self, length: usize, status: &mut UErrorCode) -> i32 {
        if status.is_success() {
            match length.cmp(&to_length(self.capacity)) {
                Ordering::Less => {
                    self.write_at(length, &[T::default()]);
                    if *status == U_STRING_NOT_TERMINATED_WARNING {
                        *status = U_ZERO_ERROR;
                    }
                }
                Ordering::Equal => *status = U_STRING_NOT_TERMINATED_WARNING,
                Ordering::Greater => *status = U_BUFFER_OVERFLOW_ERROR,
            }
        }
        to_int32(length)
    }

    /// Writes `text` if it fits, else nothing. Returns its length, even for invalid arguments.
    pub(crate) fn extract_to(mut self, text: &[T], status: &mut UErrorCode) -> i32 {
        if size_of::<T>() == 2 && text.len() > MAX_STRING_CAPACITY {
            *status = U_ILLEGAL_ARGUMENT_ERROR;
            return 0;
        }
        if let Err(code) = self.check() {
            *status = code;
            return to_int32(text.len());
        }
        self.write_at(0, text);
        self.terminate(text.len(), status)
    }
}

impl<'a> Dest<'a, UChar> {
    /// `UnicodeString::setTo(dest, 0, capacity)`, after `Dest::check`.
    #[inline]
    pub(crate) fn alias(self) -> WritableAlias<'a> {
        WritableAlias::new(self.cleared(), 0)
    }

    /// `extract_to` for a `text` that aliased the buffer.
    #[inline]
    pub(crate) fn extract_aliased(
        self,
        text: AliasEnd,
        status: &mut UErrorCode,
    ) -> Result<i32, UErrorCode> {
        match text {
            AliasEnd::InBuffer(length) => Ok(self.terminate(length, status)),
            AliasEnd::Spilled(text) => Ok(self.extract_to(&text, status)),
            AliasEnd::Bogus => Err(U_ILLEGAL_ARGUMENT_ERROR),
        }
    }
}
