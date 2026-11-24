//! `unicode/unorm2.h`

use crate::capi::ffi::{Dest, ErrorCode, NulStr, Text, UBool, UChar};
use crate::common::normalizer2::{self, Normalizer2};
use crate::common::sink::{AliasEnd, US_STACKBUF_SIZE, WritableAlias, stack_or_heap};
use crate::common::slice_ext::{SliceExt, to_length};
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ffi::c_int;
use std::ptr::{from_ref, null};

pub(crate) type UNormalizer2 = Normalizer2;

#[capi]
fn unorm2_getNFCInstance(status: ErrorCode) -> *const UNormalizer2 {
    status.run_no_alloc(null(), |_| Ok(from_ref(normalizer2::get_nfc_instance())))
}

#[capi]
fn unorm2_getNFDInstance(status: ErrorCode) -> *const UNormalizer2 {
    status.run_no_alloc(null(), |_| Ok(from_ref(normalizer2::get_nfd_instance())))
}

#[capi]
fn unorm2_getNFKCInstance(status: ErrorCode) -> *const UNormalizer2 {
    status.run(null(), |_| normalizer2::get_nfkc_instance().map(from_ref))
}

#[capi]
fn unorm2_getNFKDInstance(status: ErrorCode) -> *const UNormalizer2 {
    status.run(null(), |_| normalizer2::get_nfkd_instance().map(from_ref))
}

/// Accepts only null, "uts46" and `UNORM2_COMPOSE`.
#[capi]
fn unorm2_getInstance(
    package_name: NulStr<u8>,
    name: NulStr<u8>,
    mode: c_int,
    status: ErrorCode,
) -> *const UNormalizer2 {
    status.run(null(), |_| match (package_name.get(), name.get(), mode) {
        (None, Some(b"uts46"), 0) => normalizer2::get_uts46_instance().map(from_ref),
        _ => Err(U_UNSUPPORTED_ERROR),
    })
}

/// `String.prototype.normalize` passes on the null of a failed `unorm2_get*`, and looks for no other error.
fn normalizer(norm2: Option<&UNormalizer2>) -> Result<&UNormalizer2, UErrorCode> {
    norm2.ok_or(U_MEMORY_ALLOCATION_ERROR)
}

#[capi]
fn unorm2_normalize(
    norm2: Option<&UNormalizer2>,
    (src, _): Text<UChar>,
    (dest, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        dest.check()?;
        let (norm2, mut dest) = (normalizer(norm2)?, dest);
        let src = dest.apart(src.get()?)?;
        let unchanged = norm2.span_unchanged(src);
        if unchanged == src.len() {
            return Ok(dest.extract_to(src, status));
        }
        // Perf: writing to a buffer is faster than appending to a text that has left it.
        if to_length(dest.capacity()) < src.len() {
            let (mut stack, mut heap) = ([0; US_STACKBUF_SIZE], Vec::new());
            let buffer = stack_or_heap(src.len(), &mut stack, &mut heap)?;
            let mut text = WritableAlias::new(buffer, 0);
            norm2.normalize_append(src, unchanged, &mut text)?;
            return match text.end() {
                AliasEnd::InBuffer(length) => Ok(dest.extract_to(buffer.slice(..length), status)),
                end => dest.extract_aliased(end, status),
            };
        }
        let mut text = dest.reborrow().alias();
        norm2.normalize_append(src, unchanged, &mut text)?;
        let end = text.end();
        dest.extract_aliased(end, status)
    })
}

#[capi]
fn unorm2_isNormalized(
    norm2: Option<&UNormalizer2>,
    (s, _): Text<UChar>,
    status: ErrorCode,
) -> UBool {
    status.run(0, |_| {
        normalizer(norm2)?.is_normalized(s.get()?).map(UBool::from)
    })
}
