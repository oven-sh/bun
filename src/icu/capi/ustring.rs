//! `unicode/ustring.h`

use crate::capi::ffi::{Dest, ErrorCode, NulStr, Text, UChar};
use crate::common::ucase::{CaseLocale, Mapping};
use crate::common::ustrcase;
use crate::common::utypes::*;
use bun_icu_macros::capi;

fn map(
    mapping: impl FnOnce(CaseLocale) -> Mapping,
    mut dest: Dest<'_, UChar>,
    src: Text<'_, UChar>,
    locale: NulStr<'_, u8>,
    status: ErrorCode<'_>,
) -> i32 {
    status.run(0, |status| {
        let locale = match locale.up_to(3) {
            Some([]) => CaseLocale::Root,
            Some(language @ (b"az" | b"el" | b"lt" | b"tr")) => CaseLocale::of(language),
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        dest.check()?;
        let src = dest.apart(src.get()?)?;
        let length = ustrcase::map(mapping(locale), src, dest.reborrow().cleared());
        if length > i32::MAX as usize {
            return Err(U_INDEX_OUTOFBOUNDS_ERROR);
        }
        Ok(dest.terminate(length, status))
    })
}

/// `locale` is "", "az", "el", "lt" or "tr". `src` does not overlap `dest`.
#[capi]
fn u_strToLower(
    (dest, _): Dest<UChar>,
    (src, _): Text<UChar>,
    locale: NulStr<u8>,
    status: ErrorCode,
) -> i32 {
    map(Mapping::lower, dest, src, locale, status)
}

/// `locale` is "", "az", "el", "lt" or "tr". `src` does not overlap `dest`.
#[capi]
fn u_strToUpper(
    (dest, _): Dest<UChar>,
    (src, _): Text<UChar>,
    locale: NulStr<u8>,
    status: ErrorCode,
) -> i32 {
    map(Mapping::upper, dest, src, locale, status)
}
