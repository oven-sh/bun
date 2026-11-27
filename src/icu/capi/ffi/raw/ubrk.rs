//! `unicode/ubrk.h`

use super::slice;
use crate::capi::ffi::{Parameter, Text, UChar};
use crate::capi::ubrk::UBreakIterator;
use crate::common::brkiter::BreakIterator;
use crate::common::utypes::*;

/// A text that outlives the call. The caller may free it before it closes the iterator.
#[derive(Clone, Copy)]
pub(crate) struct KeptText(*const UChar, usize);

// SAFETY: the units are only read, as through a `&[UChar]`.
unsafe impl Send for KeptText {}
// SAFETY: the units are only read, as through a `&[UChar]`.
unsafe impl Sync for KeptText {}

impl Text<'_, UChar> {
    pub(crate) fn keep(self) -> Result<KeptText, UErrorCode> {
        let length = self.get()?.len();
        i32::try_from(length).or(Err(U_ILLEGAL_ARGUMENT_ERROR))?;
        Ok(KeptText(self.ptr, length))
    }
}

/// `UBreakIterator *`: null, or an iterator whose text is still there.
#[repr(transparent)]
pub(crate) struct WithText<'c>(Option<&'c mut UBreakIterator>);

impl Parameter for WithText<'_> {}

impl<'c> WithText<'c> {
    pub(crate) fn get(self) -> Option<(&'c mut BreakIterator, &'c [UChar])> {
        let UBreakIterator { iter, text } = self.0?;
        // SAFETY: `keep` has measured the text, which is still there.
        Some((iter, unsafe { slice(text.0, text.1) }))
    }
}
