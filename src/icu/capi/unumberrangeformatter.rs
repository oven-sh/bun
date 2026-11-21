//! `unicode/unumberrangeformatter.h`

use crate::capi::ffi::{ErrorCode, MayAlias, Mut, NulStr, Null, Owned, Ref, Text, UChar};
use crate::capi::uformattednumber::MAGIC as RESULT_MAGIC;
use crate::capi::uformattedvalue::{UFormattedValue, Value};
use crate::capi::unumberformatter::{read_dec_number, read_skeleton};
use crate::common::utypes::*;
use crate::i18n::measunit::MeasureUnit;
use crate::i18n::numrange_impl::{LocalizedNumberRangeFormatter, UFormattedNumberRangeData};
use bun_icu_macros::capi;
use std::ptr::null;

type UNumberRangeCollapse = i32;
const UNUM_RANGE_COLLAPSE_AUTO: UNumberRangeCollapse = 0;
const UNUM_RANGE_COLLAPSE_NONE: UNumberRangeCollapse = 1;

type UNumberRangeIdentityFallback = i32;
const UNUM_IDENTITY_FALLBACK_APPROXIMATELY: UNumberRangeIdentityFallback = 2;
const UNUM_IDENTITY_FALLBACK_RANGE: UNumberRangeIdentityFallback = 3;

/// "NRF" in ASCII.
pub(crate) const MAGIC: i32 = 0x4E52_4600;

#[repr(C)]
pub(crate) struct UNumberRangeFormatter {
    magic: i32,
    formatter: LocalizedNumberRangeFormatter,
}

pub(crate) type UFormattedNumberRange = UFormattedValue;

pub(crate) fn data(
    uresult: Ref<'_, UFormattedNumberRange>,
) -> Result<&UFormattedNumberRangeData, UErrorCode> {
    match &UFormattedValue::validate(uresult, RESULT_MAGIC)?.value {
        Value::Range(range) => Ok(range),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

/// `set` returns whether the numbers are equal. An error of `set` still resets `uresult`.
fn format(
    uformatter: Ref<'_, UNumberRangeFormatter>,
    uresult: Mut<'_, UFormattedNumberRange>,
    set: impl FnOnce(&mut UFormattedNumberRangeData) -> Result<bool, UErrorCode>,
) -> Result<(), UErrorCode> {
    let formatter = &uformatter.get()?.formatter;
    let Value::Range(result) = &mut UFormattedValue::validate_mut(uresult, RESULT_MAGIC)?.value
    else {
        return Err(U_INVALID_FORMAT_ERROR);
    };
    result.reset();
    set(result)
        .and_then(|are_equal| formatter.format(result, are_equal))
        .inspect_err(|_| {
            result.quantity1.clear();
            result.quantity2.clear();
        })
}

/// Accepts only `AUTO` with `APPROXIMATELY`, and `NONE` with `RANGE` for a skeleton without a unit.
#[capi]
fn unumrf_openForSkeletonWithCollapseAndIdentityFallback(
    (skeleton, _): Text<UChar>,
    collapse: UNumberRangeCollapse,
    identity_fallback: UNumberRangeIdentityFallback,
    locale: NulStr<u8>,
    perror: Null,
    ec: ErrorCode,
) -> *mut UNumberRangeFormatter {
    ec.open(|cx, _| {
        let macros = read_skeleton(cx, skeleton, locale)?;
        let collapses = match (collapse, identity_fallback, macros.unit) {
            _ if !perror.is_null() => return Err(U_UNSUPPORTED_ERROR),
            (UNUM_RANGE_COLLAPSE_AUTO, UNUM_IDENTITY_FALLBACK_APPROXIMATELY, _) => true,
            (UNUM_RANGE_COLLAPSE_NONE, UNUM_IDENTITY_FALLBACK_RANGE, MeasureUnit::None) => false,
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        Ok(UNumberRangeFormatter {
            magic: MAGIC,
            formatter: LocalizedNumberRangeFormatter::new(macros, collapses),
        })
    })
}

#[capi]
fn unumrf_openResult(ec: ErrorCode) -> *mut UFormattedNumberRange {
    let value = || Value::Range(UFormattedNumberRangeData::new());
    UFormattedValue::open(RESULT_MAGIC, value, ec)
}

#[capi]
fn unumrf_formatDoubleRange(
    uformatter: Ref<UNumberRangeFormatter>,
    first: f64,
    second: f64,
    uresult: Mut<UFormattedNumberRange>,
    ec: ErrorCode,
) {
    ec.run((), |_, _| {
        format(uformatter, uresult, |result| {
            result.quantity1.set_to_double(first);
            result.quantity2.set_to_double(second);
            Ok(first == second)
        })
    })
}

#[capi]
fn unumrf_formatDecimalRange(
    uformatter: Ref<UNumberRangeFormatter>,
    (first, _): MayAlias<Text<u8>, UFormattedNumberRange>,
    (second, _): MayAlias<Text<u8>, UFormattedNumberRange>,
    uresult: Mut<UFormattedNumberRange>,
    ec: ErrorCode,
) {
    ec.run((), |cx, _| {
        let [first, second] =
            [first, second].map(|number| read_dec_number(cx, number.tied_to(&uresult)));
        format(uformatter, uresult, |result| {
            result.quantity1.set_to_dec_num(&first?)?;
            result.quantity2.set_to_dec_num(&second?)?;
            Ok(result.quantity1 == result.quantity2)
        })
    })
}

#[capi]
fn unumrf_resultAsValue(
    uresult: Ref<UFormattedNumberRange>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_, _| {
        UFormattedValue::validate(uresult, RESULT_MAGIC).map(|_| uresult.as_ptr())
    })
}

#[capi]
fn unumrf_close(uformatter: Owned<UNumberRangeFormatter>) {
    uformatter.close()
}

#[capi]
fn unumrf_closeResult(uresult: Owned<UFormattedNumberRange>) {
    UFormattedValue::close(uresult, RESULT_MAGIC)
}
