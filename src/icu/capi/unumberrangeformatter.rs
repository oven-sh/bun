//! `unicode/unumberrangeformatter.h`

use crate::capi::ffi::{ErrorCode, NonNullHandle, NulStr, Null, Text, UChar};
use crate::capi::uformattedvalue::UFormattedValue;
use crate::capi::unumberformatter::{read_dec_number, read_skeleton};
use crate::common::utypes::*;
use crate::i18n::measunit::MeasureUnit;
use crate::i18n::numrange_impl::{LocalizedNumberRangeFormatter, UFormattedNumberRangeData};
use bun_icu_macros::capi;
use std::ptr::{from_ref, null};

type UNumberRangeCollapse = i32;
const UNUM_RANGE_COLLAPSE_AUTO: UNumberRangeCollapse = 0;
const UNUM_RANGE_COLLAPSE_NONE: UNumberRangeCollapse = 1;

type UNumberRangeIdentityFallback = i32;
const UNUM_IDENTITY_FALLBACK_APPROXIMATELY: UNumberRangeIdentityFallback = 2;
const UNUM_IDENTITY_FALLBACK_RANGE: UNumberRangeIdentityFallback = 3;

pub(crate) type UNumberRangeFormatter = LocalizedNumberRangeFormatter;

pub(crate) type UFormattedNumberRange = UFormattedValue;

pub(crate) fn data(
    uresult: Option<&UFormattedNumberRange>,
) -> Result<&UFormattedNumberRangeData, UErrorCode> {
    match uresult.non_null()? {
        UFormattedValue::Range(range) => Ok(range),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

/// `set` returns whether the numbers are equal. An error of `set` still resets `uresult`.
fn format(
    uformatter: Option<&UNumberRangeFormatter>,
    uresult: Option<&mut UFormattedNumberRange>,
    set: impl FnOnce(&mut UFormattedNumberRangeData) -> Result<bool, UErrorCode>,
) -> Result<(), UErrorCode> {
    let formatter = uformatter.non_null()?;
    let UFormattedValue::Range(result) = uresult.non_null()? else {
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
) -> Option<Box<UNumberRangeFormatter>> {
    ec.open(|| {
        let macros = read_skeleton(skeleton, locale)?;
        let collapses = match (collapse, identity_fallback, &macros.unit) {
            _ if !perror.is_null() => return Err(U_UNSUPPORTED_ERROR),
            (UNUM_RANGE_COLLAPSE_AUTO, UNUM_IDENTITY_FALLBACK_APPROXIMATELY, _) => true,
            (UNUM_RANGE_COLLAPSE_NONE, UNUM_IDENTITY_FALLBACK_RANGE, MeasureUnit::None) => false,
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        Ok(LocalizedNumberRangeFormatter::new(macros, collapses))
    })
}

#[capi]
fn unumrf_openResult(ec: ErrorCode) -> Option<Box<UFormattedNumberRange>> {
    let value = || UFormattedValue::Range(UFormattedNumberRangeData::new());
    UFormattedValue::open(value, ec)
}

#[capi]
fn unumrf_formatDoubleRange(
    uformatter: Option<&UNumberRangeFormatter>,
    first: f64,
    second: f64,
    uresult: Option<&mut UFormattedNumberRange>,
    ec: ErrorCode,
) {
    ec.run((), |_| {
        format(uformatter, uresult, |result| {
            result.quantity1.set_to_double(first);
            result.quantity2.set_to_double(second);
            Ok(first == second)
        })
    })
}

#[capi]
fn unumrf_formatDecimalRange(
    uformatter: Option<&UNumberRangeFormatter>,
    (first, _): Text<u8>,
    (second, _): Text<u8>,
    uresult: Option<&mut UFormattedNumberRange>,
    ec: ErrorCode,
) {
    ec.run((), |_| {
        let [first, second] = [first, second].map(read_dec_number);
        format(uformatter, uresult, |result| {
            result.quantity1.set_to_dec_num(&first?)?;
            result.quantity2.set_to_dec_num(&second?)?;
            Ok(result.quantity1 == result.quantity2)
        })
    })
}

#[capi]
fn unumrf_resultAsValue(
    uresult: Option<&UFormattedNumberRange>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_| uresult.non_null().map(from_ref))
}

#[capi]
fn unumrf_close(uformatter: Option<Box<UNumberRangeFormatter>>) {
    drop(uformatter);
}

#[capi]
fn unumrf_closeResult(uresult: Option<Box<UFormattedNumberRange>>) {
    drop(uresult);
}
