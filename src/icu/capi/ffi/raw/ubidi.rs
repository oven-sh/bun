//! `unicode/ubidi.h`: the arrays whose length is not a parameter.

use super::slice;
use crate::capi::ffi::{Parameter, UChar};
use crate::common::slice_ext::slices_equal;
use crate::common::ubidi::{UBiDi, UBiDiLevel};
use std::marker::PhantomData;
use std::mem::MaybeUninit;

/// `embeddingLevels`: null, or one level per code unit of the text.
#[repr(transparent)]
pub(crate) struct EmbeddingLevels<'c>(*mut UBiDiLevel, PhantomData<&'c ()>);

impl Parameter for EmbeddingLevels<'_> {}

impl EmbeddingLevels<'_> {
    /// `text` is the text passed to the same call.
    pub(crate) fn read(&self, text: &[UChar]) -> Option<&[UBiDiLevel]> {
        // SAFETY: the array is as long as `text`. `write_back` ends the borrow.
        (!self.0.is_null()).then(|| unsafe { slice(self.0, text.len()) })
    }

    /// Writes the array only if it differs. `bidi` is the object that copied the result of `read`.
    pub(crate) fn write_back(self, bidi: &UBiDi) {
        let levels = bidi.embedding_levels();
        // SAFETY: the copy is no longer than the array, and belongs to the object, which shares no memory with the array.
        unsafe {
            if !self.0.is_null() && !slices_equal(slice(self.0, levels.len()), levels) {
                self.0
                    .copy_from_nonoverlapping(levels.as_ptr(), levels.len());
            }
        }
    }
}

/// `indexMap`: null, or an uninitialized array that is as long as the text of the object.
#[repr(transparent)]
pub(crate) struct VisualMap<'c>(*mut MaybeUninit<i32>, PhantomData<&'c ()>);

impl Parameter for VisualMap<'_> {}

impl<'c> VisualMap<'c> {
    pub(crate) fn is_null(&self) -> bool {
        self.0.is_null()
    }

    /// `bidi` is the object passed to the same call.
    pub(crate) fn slots(self, bidi: &UBiDi) -> &'c mut [MaybeUninit<i32>] {
        let length = bidi.get_result_length();
        if self.is_null() || length == 0 {
            return &mut [];
        }
        // SAFETY: the array has this length, and shares no memory with the object.
        unsafe { std::slice::from_raw_parts_mut(self.0, length) }
    }
}
