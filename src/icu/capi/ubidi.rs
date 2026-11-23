//! `unicode/ubidi.h`
//!
//! `ubidi_setPara` works on a copy of `embeddingLevels`, and writes it back before it returns, also after a failure
//! other than for lack of memory.

use crate::capi::ffi::raw::ubidi::{EmbeddingLevels, VisualMap};
use crate::capi::ffi::{self, ErrorCode, NonNullHandle, Text, UChar, to_int32};
use crate::common::memory::try_box;
use crate::common::slice_ext::SliceExt;
use crate::common::ubidi::{UBiDi, UBiDiLevel};
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::hint::black_box;

// ICU4C: ubidiimp.h, RETURN_IF_NOT_VALID_PARA_OR_LINE
fn valid_para(bidi: Option<&UBiDi>) -> Result<&UBiDi, UErrorCode> {
    bidi.filter(|bidi| bidi.is_valid())
        .ok_or(U_INVALID_STATE_ERROR)
}

#[capi]
fn ubidi_open() -> Option<Box<UBiDi>> {
    ffi::on_oom(None, || try_box(UBiDi::default()).ok())
}

#[capi]
fn ubidi_close(bidi: Option<Box<UBiDi>>) {
    // Like ICU4C, leaves an object without a text in the block. `black_box` keeps the write.
    if let Some(mut bidi) = bidi {
        *bidi = UBiDi::default();
        black_box(&*bidi);
    }
}

#[capi]
fn ubidi_setPara(
    bidi: Option<&mut UBiDi>,
    (text, _): Text<UChar>,
    para_level: UBiDiLevel,
    embedding_levels: EmbeddingLevels,
    status: ErrorCode,
) {
    status.run((), |_| {
        let bidi = bidi.non_null()?;
        if text.is_null() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        UBiDi::check_para_level(para_level)?;
        let text = text.get()?;
        let text = text.slice(..text.len().min(i32::MAX as usize));
        let result = bidi.set_para(text, para_level, embedding_levels.read(text));
        if result != Err(U_MEMORY_ALLOCATION_ERROR) {
            embedding_levels.write_back(bidi);
        }
        result
    })
}

#[capi]
fn ubidi_countRuns(bidi: Option<&UBiDi>, status: ErrorCode) -> i32 {
    status.run(-1, |_| valid_para(bidi)?.count_runs().map(to_int32))
}

#[capi]
fn ubidi_getVisualMap(bidi: Option<&UBiDi>, index_map: VisualMap, status: ErrorCode) {
    status.run((), |_| {
        if index_map.is_null() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let bidi = valid_para(bidi)?;
        bidi.get_visual_map(index_map.slots(bidi))
    })
}
