//! `unicode/ulistformatter.h`

use crate::capi::ffi::{Array, Pair, Parameter, Text, UChar};

/// `const UChar *const strings[]` with its count.
pub(crate) type StringPtrs<'c> = Array<'c, StringPtr>;

/// Null, or valid for the length at the same index of `Lengths`. NUL-terminated if that length is negative or missing.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(crate) struct StringPtr(*const UChar);

/// `const int32_t *stringLengths` with the count of strings. Null means that all strings are NUL-terminated.
pub(crate) struct Lengths<'c>(Array<'c, i32>);

impl Parameter for Lengths<'_> {}

impl Pair for Lengths<'_> {
    type First = *const i32;
    type Second = i32;
    unsafe fn new(lengths: *const i32, count: i32) -> Self {
        // SAFETY: the caller guarantees that `lengths` is null or valid for `count` reads.
        Self(unsafe { Array::new(lengths, count) })
    }
}

impl<'c> StringPtrs<'c> {
    /// Pairs each pointer with its length. `self` and `lengths` are the arguments of one C call.
    pub(crate) fn texts(
        self,
        Lengths(lengths): Lengths<'c>,
    ) -> impl Iterator<Item = Text<'c, UChar>> {
        let lengths = lengths.get();
        // SAFETY: the contract of `StringPtr` is that of `Text` for `lengths[index]`. `lengths` has as many elements as
        // `self`, or is empty if the caller passed null, and then all strings are NUL-terminated.
        let text = |(index, s): (usize, &StringPtr)| unsafe {
            Text::new(s.0, lengths.get(index).map_or(-1, |&n| n.max(-1)))
        };
        self.get().iter().enumerate().map(text)
    }
}
