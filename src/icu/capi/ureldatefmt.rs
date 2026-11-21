//! `unicode/ureldatefmt.h`

use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, NulStr, UChar};
use crate::capi::uformattedvalue::UFormattedValue;
use crate::capi::unum::UNumberFormat;
use crate::common::locid::Locale;
use crate::common::unicode::udisplaycontext::UDISPCTX_CAPITALIZATION_FOR_STANDALONE;
use crate::common::utypes::*;
use crate::i18n::number_fluent::UFormattedNumberData;
use crate::i18n::reldatefmt::{Numeric, RelativeDateTimeFormatter, Style};
use bun_icu_macros::capi;
use std::ffi::c_int;
use std::ptr::{from_ref, null};

pub(crate) type URelativeDateTimeFormatter = RelativeDateTimeFormatter;

pub(crate) type UFormattedRelativeDateTime = UFormattedValue;

const UDAT_STYLE_LONG: c_int = 0;
const UDAT_STYLE_SHORT: c_int = 1;
const UDAT_STYLE_NARROW: c_int = 2;

/// Both kinds of output accept only the units from `UDAT_REL_UNIT_YEAR` to `UDAT_REL_UNIT_SECOND`.
fn format_to_buffer(
    reldatefmt: Option<&URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    numeric: Numeric,
    result: Dest<'_, UChar>,
    status: ErrorCode<'_>,
) -> i32 {
    status.run(0, |status| {
        result.check()?;
        let mut output = UFormattedNumberData::new();
        (reldatefmt.non_null()?).format(offset, unit, numeric, &mut output)?;
        Ok(result.extract_to(output.text(), status))
    })
}

fn format_to_result(
    reldatefmt: Option<&URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    numeric: Numeric,
    result: Option<&mut UFormattedRelativeDateTime>,
    status: ErrorCode<'_>,
) {
    status.run((), |_| {
        let result = result.non_null()?;
        result.set(
            reldatefmt
                .non_null()?
                .format_to_value(offset, unit, numeric),
        )
    })
}

/// Needs `nf_to_adopt`, which it closes, and accepts only `UDISPCTX_CAPITALIZATION_FOR_STANDALONE`.
#[capi]
fn ureldatefmt_open(
    locale: NulStr<u8>,
    nf_to_adopt: Option<Box<UNumberFormat>>,
    width: c_int,
    capitalization_context: c_int,
    status: ErrorCode,
) -> Option<Box<URelativeDateTimeFormatter>> {
    status.open(|| {
        let number_format = nf_to_adopt.ok_or(U_UNSUPPORTED_ERROR)?.format()?;
        if capitalization_context != UDISPCTX_CAPITALIZATION_FOR_STANDALONE {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let style = match width {
            UDAT_STYLE_LONG => Style::Long,
            UDAT_STYLE_SHORT => Style::Short,
            UDAT_STYLE_NARROW => Style::Narrow,
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        RelativeDateTimeFormatter::new(&Locale::new(locale.get()), number_format, style)
    })
}

#[capi]
fn ureldatefmt_close(reldatefmt: Option<Box<URelativeDateTimeFormatter>>) {
    drop(reldatefmt);
}

#[capi]
fn ureldatefmt_openResult(ec: ErrorCode) -> Option<Box<UFormattedRelativeDateTime>> {
    ec.open(|| Ok(UFormattedValue::new_unset()))
}

#[capi]
fn ureldatefmt_resultAsValue(
    ufrdt: Option<&UFormattedRelativeDateTime>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_| ufrdt.non_null().map(from_ref))
}

#[capi]
fn ureldatefmt_closeResult(ufrdt: Option<Box<UFormattedRelativeDateTime>>) {
    drop(ufrdt);
}

#[capi]
fn ureldatefmt_formatNumeric(
    reldatefmt: Option<&URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    format_to_buffer(reldatefmt, offset, unit, Numeric::Always, result, status)
}

#[capi]
fn ureldatefmt_formatNumericToResult(
    reldatefmt: Option<&URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    result: Option<&mut UFormattedRelativeDateTime>,
    status: ErrorCode,
) {
    format_to_result(reldatefmt, offset, unit, Numeric::Always, result, status)
}

#[capi]
fn ureldatefmt_format(
    reldatefmt: Option<&URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    format_to_buffer(reldatefmt, offset, unit, Numeric::Auto, result, status)
}

#[capi]
fn ureldatefmt_formatToResult(
    reldatefmt: Option<&URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    result: Option<&mut UFormattedRelativeDateTime>,
    status: ErrorCode,
) {
    format_to_result(reldatefmt, offset, unit, Numeric::Auto, result, status)
}
