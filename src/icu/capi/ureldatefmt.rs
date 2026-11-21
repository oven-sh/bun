//! `unicode/ureldatefmt.h`

use crate::capi::ffi::{Dest, ErrorCode, Mut, NulStr, Owned, Ref, UChar};
use crate::capi::uformattedvalue::UFormattedValue;
use crate::capi::unum::UNumberFormat;
use crate::common::locid::Locale;
use crate::common::unicode::udisplaycontext::UDISPCTX_CAPITALIZATION_FOR_STANDALONE;
use crate::common::utypes::*;
use crate::i18n::number_fluent::UFormattedNumberData;
use crate::i18n::reldatefmt::{Numeric, RelativeDateTimeFormatter, Style};
use bun_icu_macros::capi;
use std::ffi::c_int;
use std::ptr::null;

pub(crate) type URelativeDateTimeFormatter = RelativeDateTimeFormatter;

pub(crate) type UFormattedRelativeDateTime = UFormattedValue;

const UDAT_STYLE_LONG: c_int = 0;
const UDAT_STYLE_SHORT: c_int = 1;
const UDAT_STYLE_NARROW: c_int = 2;

/// "FRDT" in ASCII.
const MAGIC: i32 = 0x4652_4454;

/// Both kinds of output accept only the units from `UDAT_REL_UNIT_YEAR` to `UDAT_REL_UNIT_SECOND`.
fn format_to_buffer(
    reldatefmt: Ref<'_, URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    numeric: Numeric,
    result: Dest<'_, UChar>,
    status: ErrorCode<'_>,
) -> i32 {
    status.run(0, |cx, status| {
        result.check()?;
        let mut output = UFormattedNumberData::new();
        (reldatefmt.get()?).format(offset, unit, numeric, &mut output)?;
        Ok(cx.extract_to(output.text(), result, status))
    })
}

fn format_to_result(
    reldatefmt: Ref<'_, URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    numeric: Numeric,
    result: Mut<'_, UFormattedRelativeDateTime>,
    status: ErrorCode<'_>,
) {
    status.run((), |_, _| {
        let result = UFormattedValue::validate_mut(result, MAGIC)?;
        result.set(reldatefmt.get()?.format_to_value(offset, unit, numeric))
    })
}

/// Needs `nf_to_adopt`, which it closes, and accepts only `UDISPCTX_CAPITALIZATION_FOR_STANDALONE`.
#[capi]
fn ureldatefmt_open(
    locale: NulStr<u8>,
    nf_to_adopt: Owned<UNumberFormat>,
    width: c_int,
    capitalization_context: c_int,
    status: ErrorCode,
) -> *mut URelativeDateTimeFormatter {
    status.open(|cx, _| {
        let number_format = nf_to_adopt.adopt().ok_or(U_UNSUPPORTED_ERROR)?.format()?;
        if capitalization_context != UDISPCTX_CAPITALIZATION_FOR_STANDALONE {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let style = match width {
            UDAT_STYLE_LONG => Style::Long,
            UDAT_STYLE_SHORT => Style::Short,
            UDAT_STYLE_NARROW => Style::Narrow,
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        RelativeDateTimeFormatter::new(&Locale::new(cx.c_str(locale)), number_format, style)
    })
}

#[capi]
fn ureldatefmt_close(reldatefmt: Owned<URelativeDateTimeFormatter>) {
    reldatefmt.close()
}

#[capi]
fn ureldatefmt_openResult(ec: ErrorCode) -> *mut UFormattedRelativeDateTime {
    ec.open(|_, _| Ok(UFormattedValue::new_unset(MAGIC)))
}

#[capi]
fn ureldatefmt_resultAsValue(
    ufrdt: Ref<UFormattedRelativeDateTime>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_, _| {
        UFormattedValue::validate(ufrdt, MAGIC).map(|_| ufrdt.as_ptr())
    })
}

#[capi]
fn ureldatefmt_closeResult(ufrdt: Owned<UFormattedRelativeDateTime>) {
    UFormattedValue::close(ufrdt, MAGIC)
}

#[capi]
fn ureldatefmt_formatNumeric(
    reldatefmt: Ref<URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    format_to_buffer(reldatefmt, offset, unit, Numeric::Always, result, status)
}

#[capi]
fn ureldatefmt_formatNumericToResult(
    reldatefmt: Ref<URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    result: Mut<UFormattedRelativeDateTime>,
    status: ErrorCode,
) {
    format_to_result(reldatefmt, offset, unit, Numeric::Always, result, status)
}

#[capi]
fn ureldatefmt_format(
    reldatefmt: Ref<URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    format_to_buffer(reldatefmt, offset, unit, Numeric::Auto, result, status)
}

#[capi]
fn ureldatefmt_formatToResult(
    reldatefmt: Ref<URelativeDateTimeFormatter>,
    offset: f64,
    unit: c_int,
    result: Mut<UFormattedRelativeDateTime>,
    status: ErrorCode,
) {
    format_to_result(reldatefmt, offset, unit, Numeric::Auto, result, status)
}
