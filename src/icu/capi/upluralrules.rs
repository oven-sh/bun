//! `unicode/upluralrules.h`

use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, NulStr, UChar};
use crate::capi::uenum::{self, UEnumeration};
use crate::capi::uformattednumber::{self, UFormattedNumber};
use crate::capi::unumberrangeformatter::{self, UFormattedNumberRange};
use crate::common::UErrorCode;
use crate::common::arrayvec::ArrayVec;
use crate::common::locid::Locale;
use crate::common::memory::try_collect;
use crate::i18n::plurrule::{PluralRules, UPluralType};
use bun_icu_macros::capi;
use std::ffi::CStr;

pub(crate) type UPluralRules = PluralRules;

fn select_into(
    keyword: Dest<'_, UChar>,
    status: ErrorCode<'_>,
    select: impl FnOnce() -> Result<&'static CStr, UErrorCode>,
) -> i32 {
    status.run(0, |status| {
        keyword.check()?;
        const SHORT: usize = "other".len();
        let units = select()?.to_bytes().iter().map(|&c| UChar::from(c));
        if units.len() > SHORT {
            return Ok(keyword.extract_to(&try_collect(units)?, status));
        }
        let units = ArrayVec::<_, SHORT>::from_iter_truncated(units);
        Ok(keyword.extract_to(&units, status))
    })
}

/// Accepts only `UPLURAL_TYPE_CARDINAL` and `UPLURAL_TYPE_ORDINAL`.
#[capi]
fn uplrules_openForType(
    locale: NulStr<u8>,
    type_: UPluralType,
    status: ErrorCode,
) -> Option<Box<UPluralRules>> {
    status.open(|| PluralRules::for_locale(&Locale::new(locale.get()), type_))
}

#[capi]
fn uplrules_close(uplrules: Option<Box<UPluralRules>>) {
    drop(uplrules);
}

#[capi]
fn uplrules_selectFormatted(
    uplrules: Option<&UPluralRules>,
    number: Option<&UFormattedNumber>,
    (keyword, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    select_into(keyword, status, || {
        let number = uformattednumber::data(number)?;
        Ok(uplrules.non_null()?.select_keyword(&number.quantity))
    })
}

#[capi]
fn uplrules_selectForRange(
    uplrules: Option<&UPluralRules>,
    urange: Option<&UFormattedNumberRange>,
    (keyword, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    select_into(keyword, status, || {
        let range = unumberrangeformatter::data(urange)?;
        let rules = uplrules.non_null()?;
        let form = rules.select_range(&range.quantity1, &range.quantity2);
        Ok(form.keyword())
    })
}

#[capi]
fn uplrules_getKeywords(
    uplrules: Option<&UPluralRules>,
    status: ErrorCode,
) -> Option<Box<UEnumeration>> {
    status.open(|| uenum::open_boxed(uplrules.non_null()?.get_keywords()))
}
