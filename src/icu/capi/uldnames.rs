//! `unicode/uldnames.h`

use crate::capi::ffi::{Array, Dest, ErrorCode, NulStr, Owned, Ref, UChar};
use crate::common::locdspnm::LocaleDisplayNames;
use crate::common::unicode::udisplaycontext::*;
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ffi::c_int;

pub(crate) type ULocaleDisplayNames = LocaleDisplayNames;

fn write_name(
    ldn: Ref<'_, ULocaleDisplayNames>,
    code: NulStr<'_, u8>,
    result: Dest<'_, UChar>,
    status: ErrorCode<'_>,
    look_up: fn(&LocaleDisplayNames, &[u8]) -> Result<Vec<u16>, UErrorCode>,
) -> i32 {
    status.run(0, |cx, status| {
        result.check()?;
        let name = look_up(ldn.get()?, cx.c_str(code).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?)?;
        Ok(cx.extract_to(&name, result, status))
    })
}

/// Takes four contexts in this order: standard or dialect names, for stand-alone use, full or short, no substitute.
#[capi]
fn uldn_openForContext(
    locale: NulStr<u8>,
    (contexts, _): Array<c_int>,
    status: ErrorCode,
) -> *mut ULocaleDisplayNames {
    status.open(|cx, _| {
        let (
            Some(locale),
            &[
                dialect @ (UDISPCTX_STANDARD_NAMES | UDISPCTX_DIALECT_NAMES),
                UDISPCTX_CAPITALIZATION_FOR_STANDALONE,
                length @ (UDISPCTX_LENGTH_FULL | UDISPCTX_LENGTH_SHORT),
                UDISPCTX_NO_SUBSTITUTE,
            ],
        ) = (cx.c_str(locale), cx.slice(contexts))
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
fn uldn_close(ldn: Owned<ULocaleDisplayNames>) {
    ldn.close()
}

/// `locale` has no keywords, code page or POSIX variant.
#[capi]
fn uldn_localeDisplayName(
    ldn: Ref<ULocaleDisplayNames>,
    locale: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    let look_up = LocaleDisplayNames::locale_display_name;
    write_name(ldn, locale, result, status, look_up)
}

#[capi]
fn uldn_scriptDisplayName(
    ldn: Ref<ULocaleDisplayNames>,
    script: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    let look_up = LocaleDisplayNames::script_display_name;
    write_name(ldn, script, result, status, look_up)
}

#[capi]
fn uldn_regionDisplayName(
    ldn: Ref<ULocaleDisplayNames>,
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
    ldn: Ref<ULocaleDisplayNames>,
    key: NulStr<u8>,
    value: NulStr<u8>,
    (result, _): Dest<UChar>,
    mut status: ErrorCode,
) -> i32 {
    if status.mem().c_str(key) != Some(b"calendar") {
        return status.run(0, |_, _| Err(U_UNSUPPORTED_ERROR));
    }
    let look_up = LocaleDisplayNames::calendar_display_name;
    write_name(ldn, value, result, status, look_up)
}
