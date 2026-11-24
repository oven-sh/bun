//! `unicode/uldnames.h`

use crate::capi::ffi::{Array, Dest, ErrorCode, NonNullHandle, NulStr, UChar};
use crate::common::locdspnm::LocaleDisplayNames;
use crate::common::unicode::udisplaycontext::*;
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ffi::c_int;

pub(crate) type ULocaleDisplayNames = LocaleDisplayNames;

fn write_name(
    ldn: Option<&ULocaleDisplayNames>,
    code: NulStr<'_, u8>,
    result: Dest<'_, UChar>,
    status: ErrorCode<'_>,
    look_up: fn(&LocaleDisplayNames, &[u8]) -> Result<Vec<u16>, UErrorCode>,
) -> i32 {
    status.run(0, |status| {
        result.check()?;
        let name = look_up(ldn.non_null()?, code.get().ok_or(U_ILLEGAL_ARGUMENT_ERROR)?)?;
        Ok(result.extract_to(&name, status))
    })
}

/// Takes four contexts in this order: standard or dialect names, for stand-alone use, full or short, no substitute.
#[capi]
fn uldn_openForContext(
    locale: NulStr<u8>,
    (contexts, _): Array<c_int>,
    status: ErrorCode,
) -> Option<Box<ULocaleDisplayNames>> {
    status.open(|| {
        let (
            Some(locale),
            &[
                dialect @ (UDISPCTX_STANDARD_NAMES | UDISPCTX_DIALECT_NAMES),
                UDISPCTX_CAPITALIZATION_FOR_STANDALONE,
                length @ (UDISPCTX_LENGTH_FULL | UDISPCTX_LENGTH_SHORT),
                UDISPCTX_NO_SUBSTITUTE,
            ],
        ) = (locale.get(), contexts.get())
        else {
            return Err(U_UNSUPPORTED_ERROR);
        };
        LocaleDisplayNames::new(
            locale,
            dialect == UDISPCTX_DIALECT_NAMES,
            length == UDISPCTX_LENGTH_SHORT,
        )
    })
}

#[capi]
fn uldn_close(ldn: Option<Box<ULocaleDisplayNames>>) {
    drop(ldn);
}

#[capi]
fn uldn_localeDisplayName(
    ldn: Option<&ULocaleDisplayNames>,
    locale: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    let look_up = LocaleDisplayNames::locale_display_name;
    write_name(ldn, locale, result, status, look_up)
}

#[capi]
fn uldn_scriptDisplayName(
    ldn: Option<&ULocaleDisplayNames>,
    script: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    let look_up = LocaleDisplayNames::script_display_name;
    write_name(ldn, script, result, status, look_up)
}

#[capi]
fn uldn_regionDisplayName(
    ldn: Option<&ULocaleDisplayNames>,
    region: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    let look_up = LocaleDisplayNames::region_display_name;
    write_name(ldn, region, result, status, look_up)
}

/// The only key is "calendar".
#[capi]
fn uldn_keyValueDisplayName(
    ldn: Option<&ULocaleDisplayNames>,
    key: NulStr<u8>,
    value: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    if key.get() != Some(b"calendar") {
        return status.run(0, |_| Err(U_UNSUPPORTED_ERROR));
    }
    let look_up = LocaleDisplayNames::calendar_display_name;
    write_name(ldn, value, result, status, look_up)
}
