//! `unicode/unumberformatter.h`

use crate::capi::ffi::{CallerMem, ErrorCode, MayAlias, Mut, NulStr, Owned, Ref, Text, UChar};
use crate::capi::uformattednumber::{UFormattedNumber, data_mut};
use crate::common::locid::Locale;
use crate::common::utypes::*;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_decnum::DecNum;
use crate::i18n::number_fluent::{LocalizedNumberFormatter, MacroProps};
use crate::i18n::number_skeletons;
use bun_icu_macros::capi;

/// "NFR" in ASCII.
pub(crate) const MAGIC: i32 = 0x4E46_5200;

#[repr(C)]
pub(crate) struct UNumberFormatter {
    magic: i32,
    formatter: LocalizedNumberFormatter,
}

pub(crate) fn read_skeleton(
    cx: &CallerMem,
    skeleton: Text<'_, UChar>,
    locale: NulStr<'_, u8>,
) -> Result<MacroProps, UErrorCode> {
    number_skeletons::parse(cx.text(skeleton)?, Locale::new(cx.c_str(locale)))
}

/// An error of `set` still resets `uresult`.
fn format(
    uformatter: Ref<'_, UNumberFormatter>,
    uresult: Mut<'_, UFormattedNumber>,
    set: impl FnOnce(&mut DecimalQuantity) -> Result<(), UErrorCode>,
) -> Result<(), UErrorCode> {
    let formatter = &uformatter.get()?.formatter;
    let result = data_mut(uresult)?;
    result.base.reset_string();
    result.quantity.clear();
    set(&mut result.quantity)?;
    formatter
        .format(result)
        .inspect_err(|_| result.quantity.clear())
}

pub(crate) fn read_dec_number(cx: &CallerMem, number: Text<'_, u8>) -> Result<DecNum, UErrorCode> {
    cx.text(number).and_then(DecNum::parse)
}

/// Accepts only the stems, options and units that express the options of ECMA-402.
#[capi]
fn unumf_openForSkeletonAndLocale(
    (skeleton, _): Text<UChar>,
    locale: NulStr<u8>,
    ec: ErrorCode,
) -> *mut UNumberFormatter {
    ec.open(|cx, _| {
        Ok(UNumberFormatter {
            magic: MAGIC,
            formatter: LocalizedNumberFormatter::new(read_skeleton(cx, skeleton, locale)?),
        })
    })
}

#[capi]
fn unumf_formatDouble(
    uformatter: Ref<UNumberFormatter>,
    value: f64,
    uresult: Mut<UFormattedNumber>,
    ec: ErrorCode,
) {
    ec.run((), |_, _| {
        format(uformatter, uresult, |quantity| {
            quantity.set_to_double(value);
            Ok(())
        })
    })
}

/// Accepts "infinity" as the only value that is not a number.
#[capi]
fn unumf_formatDecimal(
    uformatter: Ref<UNumberFormatter>,
    (value, _): MayAlias<Text<u8>, UFormattedNumber>,
    uresult: Mut<UFormattedNumber>,
    ec: ErrorCode,
) {
    ec.run((), |cx, _| {
        let number = read_dec_number(cx, value.tied_to(&uresult));
        format(uformatter, uresult, |quantity| {
            quantity.set_to_dec_num(&number?)
        })
    })
}

#[capi]
fn unumf_close(uformatter: Owned<UNumberFormatter>) {
    uformatter.close()
}
