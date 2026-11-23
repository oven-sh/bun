//! `unicode/unumberformatter.h`

use crate::capi::ffi::{ErrorCode, NonNullHandle, NulStr, Text, UChar};
use crate::capi::uformattednumber::{UFormattedNumber, data_mut};
use crate::common::locid::Locale;
use crate::common::utypes::*;
use crate::i18n::number_decimalquantity::DecimalQuantity;
use crate::i18n::number_decnum::DecNum;
use crate::i18n::number_fluent::{LocalizedNumberFormatter, MacroProps};
use crate::i18n::number_skeletons;
use bun_icu_macros::capi;

pub(crate) type UNumberFormatter = LocalizedNumberFormatter;

pub(crate) fn read_skeleton(
    skeleton: Text<'_, UChar>,
    locale: NulStr<'_, u8>,
) -> Result<MacroProps, UErrorCode> {
    number_skeletons::parse(skeleton.get()?, Locale::new(locale.get()))
}

/// An error of `set` still resets `uresult`.
fn format(
    uformatter: Option<&UNumberFormatter>,
    uresult: Option<&mut UFormattedNumber>,
    set: impl FnOnce(&mut DecimalQuantity) -> Result<(), UErrorCode>,
) -> Result<(), UErrorCode> {
    let formatter = uformatter.non_null()?;
    let result = data_mut(uresult)?;
    result.base.reset_string();
    result.quantity.clear();
    set(&mut result.quantity)?;
    formatter
        .format(result)
        .inspect_err(|_| result.quantity.clear())
}

pub(crate) fn read_dec_number(number: Text<'_, u8>) -> Result<DecNum, UErrorCode> {
    number.get().and_then(DecNum::parse)
}

/// Accepts only the stems, options and units that express the options of ECMA-402.
#[capi]
fn unumf_openForSkeletonAndLocale(
    (skeleton, _): Text<UChar>,
    locale: NulStr<u8>,
    ec: ErrorCode,
) -> Option<Box<UNumberFormatter>> {
    ec.open(|| read_skeleton(skeleton, locale).map(LocalizedNumberFormatter::new))
}

#[capi]
fn unumf_formatDouble(
    uformatter: Option<&UNumberFormatter>,
    value: f64,
    uresult: Option<&mut UFormattedNumber>,
    ec: ErrorCode,
) {
    ec.run((), |_| {
        format(uformatter, uresult, |quantity| {
            quantity.set_to_double(value);
            Ok(())
        })
    })
}

/// Accepts "infinity" as the only value that is not a number.
#[capi]
fn unumf_formatDecimal(
    uformatter: Option<&UNumberFormatter>,
    (value, _): Text<u8>,
    uresult: Option<&mut UFormattedNumber>,
    ec: ErrorCode,
) {
    ec.run((), |_| {
        let number = read_dec_number(value);
        format(uformatter, uresult, |quantity| {
            quantity.set_to_dec_num(&number?)
        })
    })
}

#[capi]
fn unumf_close(uformatter: Option<Box<UNumberFormatter>>) {
    drop(uformatter);
}
