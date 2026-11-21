//! Output buffers, and sources that are read while a buffer is written. A source that overlaps the buffer is copied.

use super::{CallerMem, Dest, Text, UChar, Unit, addresses, overlap, to_int32};
use crate::common::memory;
use crate::common::sink::{AliasEnd, MAX_STRING_CAPACITY, WritableAlias};
use crate::common::slice_ext::to_length;
use crate::common::utypes::*;
use std::borrow::Cow;
use std::cmp::Ordering;
use std::marker::PhantomData;

#[cold]
fn copy<'a, T: Copy>(source: &[T]) -> Result<Cow<'a, [T]>, UErrorCode> {
    memory::try_to_vec(source).map(Cow::Owned)
}

impl<D> Dest<'_, D> {
    #[inline]
    fn shares_memory_with<T>(self, source: &[T]) -> bool {
        overlap(
            &addresses(source.as_ptr(), source.len()),
            &self.address_range(),
        )
    }
}

/// A buffer that borrows the `CallerMem` mutably. Nothing else is written, so disjoint sources can be read meanwhile.
pub(crate) struct DestWriter<'a, T>(Dest<'a, T>, PhantomData<&'a mut CallerMem>);

/// Read access for `'x`. The inner reference gives closures the implied bound `'a: 'x`.
pub(crate) type ReadScope<'x, 'a> = &'x &'a mut CallerMem;

impl<'a, T> DestWriter<'a, T> {
    pub(crate) fn dest(&self) -> Dest<'a, T> {
        self.0
    }

    /// Returns what `read` returns: `Ok` if it is disjoint from the buffer, else `Err`, which borrows `self`.
    #[inline]
    fn read_if_disjoint<S>(
        &self,
        read: impl for<'x> FnOnce(ReadScope<'x, 'a>) -> Result<&'x [S], UErrorCode>,
    ) -> Result<Result<&'a [S], &[S]>, UErrorCode> {
        // SAFETY: `read` is generic over `'x`, so the slice is valid for `'a`. `self` holds the only `CallerMem` for
        // `'a` and writes only to the buffer.
        let source = unsafe { &*std::ptr::from_ref(read(&CallerMem::new())?) };
        Ok(if self.0.shares_memory_with(source) {
            Err(source)
        } else {
            Ok(source)
        })
    }

    /// Returns the slice that `read` returns, or a copy if it overlaps the buffer.
    pub(crate) fn read_disjoint<S: Copy>(
        &self,
        read: impl for<'x> FnOnce(ReadScope<'x, 'a>) -> Result<&'x [S], UErrorCode>,
    ) -> Result<Cow<'a, [S]>, UErrorCode> {
        self.read_if_disjoint(read)?
            .map(Cow::Borrowed)
            .or_else(copy)
    }

    pub(crate) fn text_disjoint<S: Unit>(
        &self,
        s: Text<'a, S>,
    ) -> Result<Cow<'a, [S]>, UErrorCode> {
        self.read_disjoint(|cx| cx.text(s))
    }

    pub(crate) fn reborrow(&mut self) -> DestWriter<'_, T> {
        DestWriter(self.0, PhantomData)
    }
}

impl<T: Copy> DestWriter<'_, T> {
    /// Writes `values` from index `at` on if they fit, else nothing.
    #[inline]
    pub(crate) fn write_at(&mut self, at: usize, values: &[T]) {
        let capacity = if self.0.is_null() {
            0
        } else {
            to_length(self.0.capacity)
        };
        if !values.is_empty() && at.saturating_add(values.len()) <= capacity {
            // SAFETY: `Dest` guarantees the buffer, and all borrowed sources are disjoint from it.
            unsafe {
                self.0
                    .ptr
                    .add(at)
                    .copy_from_nonoverlapping(values.as_ptr(), values.len())
            };
        }
    }
}

impl<'a, T: Unit> DestWriter<'a, T> {
    /// Clears the buffer and returns it. It is empty if `Dest::check` fails.
    #[inline]
    pub(crate) fn cleared(self) -> &'a mut [T] {
        let Dest { ptr, capacity, .. } = self.0;
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
            match length.cmp(&to_length(self.0.capacity)) {
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
        if let Err(code) = self.0.check() {
            *status = code;
            return to_int32(text.len());
        }
        self.write_at(0, text);
        self.terminate(text.len(), status)
    }
}

impl<'a> DestWriter<'a, UChar> {
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

impl CallerMem {
    pub(crate) fn writer<'a, T>(&'a mut self, dest: Dest<'a, T>) -> DestWriter<'a, T> {
        DestWriter(dest, PhantomData)
    }

    /// For functions that read no source while they write.
    #[inline(always)]
    pub(crate) fn extract_to<T: Unit>(
        &mut self,
        text: &[T],
        dest: Dest<'_, T>,
        status: &mut UErrorCode,
    ) -> i32 {
        self.writer(dest).extract_to(text, status)
    }
}
