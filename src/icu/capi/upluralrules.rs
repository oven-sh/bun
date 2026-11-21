//! `unicode/upluralrules.h`

use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, NulStr, UChar};
use crate::capi::uenum::{self, UEnumeration};
use crate::capi::uformattednumber::{self, UFormattedNumber};
use crate::capi::unumberrangeformatter::{self, UFormattedNumberRange};
use crate::common::UErrorCode;
use crate::common::arrayvec::ArrayVec;
use crate::common::locid::Locale;
use crate::i18n::plurrule::{PluralRules, UPluralType};
use crate::i18n::standardplural::PluralForm;
use bun_icu_macros::capi;

pub(crate) type UPluralRules = PluralRules;

fn select_into(
    keyword: Dest<'_, UChar>,
    status: ErrorCode<'_>,
    select: impl FnOnce() -> Result<PluralForm, UErrorCode>,
) -> i32 {
    status.run(0, |cx, status| {
        keyword.check()?;
        let chars = select()?.keyword().to_bytes().iter();
        let units = ArrayVec::<_, 5>::from_iter_truncated(chars.map(|&c| UChar::from(c)));
        Ok(cx.extract_to(&units, keyword, status))
    })
}

/// Accepts only `UPLURAL_TYPE_CARDINAL` and `UPLURAL_TYPE_ORDINAL`.
#[capi]
fn uplrules_openForType(
    locale: NulStr<u8>,
    type_: UPluralType,
    status: ErrorCode,
) -> Option<Box<UPluralRules>> {
    status.open(|cx, _| PluralRules::for_locale(&Locale::new(cx.c_str(locale)), type_))
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
        Ok(uplrules.non_null()?.select(&number.quantity))
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
        Ok(uplrules
            .non_null()?
            .select_range(&range.quantity1, &range.quantity2))
    })
}

#[capi]
fn uplrules_getKeywords(
    uplrules: Option<&UPluralRules>,
    status: ErrorCode,
) -> Option<Box<UEnumeration>> {
    status.open(|_, _| uenum::open_boxed(uplrules.non_null()?.get_keywords()))
}
