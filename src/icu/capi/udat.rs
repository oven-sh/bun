//! `unicode/udat.h`

use crate::capi::ffi::{self, Dest, ErrorCode, NonNullHandle, NulStr, Null, Text, UBool, UChar};
use crate::capi::ucal::{UCalendar, locale_id, zone_for_id};
use crate::capi::ufieldpositer::UFieldPositionIterator;
use crate::common::locid::Locale;
use crate::common::memory::{TryClone, try_box_result};
use crate::common::sink::WritableAlias;
use crate::common::utypes::*;
use crate::i18n::fphdlimp::FieldPositionIteratorHandler;
use crate::i18n::gregoimp::UDate;
use crate::i18n::smpdtfmt::SimpleDateFormat;
use crate::i18n::unicode::udat::*;
use crate::sys::ptr::AliasableBox;
use bun_icu_macros::capi;
use std::mem::offset_of;
use std::ptr::null;

/// `udat_getCalendar` returns a pointer into the box.
pub(crate) type UDateFormat = AliasableBox<SimpleDateFormat>;

fn boxed(mut format: Result<SimpleDateFormat, UErrorCode>) -> Result<UDateFormat, UErrorCode> {
    try_box_result(&mut format).map(AliasableBox::from)
}

/// Accepts `UDAT_PATTERN` twice, or styles that are not relative and not both `UDAT_NONE`.
#[capi]
fn udat_open(
    time_style: UDateFormatStyle,
    date_style: UDateFormatStyle,
    locale: NulStr<u8>,
    (tz_id, _): Text<UChar>,
    (pattern, _): Text<UChar>,
    status: ErrorCode,
) -> Option<Box<UDateFormat>> {
    status.open(|| {
        let locale = &Locale::from_name(locale_id(locale)?);
        let zone = zone_for_id(tz_id)?;
        match (time_style, date_style) {
            (UDAT_PATTERN, UDAT_PATTERN) => {
                boxed(SimpleDateFormat::with_pattern(pattern.get()?, locale, zone))
            }
            (UDAT_NONE, UDAT_NONE) => Err(U_UNSUPPORTED_ERROR),
            (UDAT_NONE..=UDAT_SHORT, UDAT_NONE..=UDAT_SHORT) => {
                let [time, date] = [time_style, date_style].map(|it| usize::try_from(it).ok());
                // Every failure has this code.
                boxed(SimpleDateFormat::with_styles(time, date, locale, zone))
                    .or(Err(U_MEMORY_ALLOCATION_ERROR))
            }
            _ => Err(U_UNSUPPORTED_ERROR),
        }
    })
}

#[capi]
fn udat_close(format: Option<Box<UDateFormat>>) {
    drop(format);
}

#[capi]
fn udat_clone(fmt: Option<&UDateFormat>, status: ErrorCode) -> Option<Box<UDateFormat>> {
    status.open(|| boxed(fmt.non_null()?.try_clone()))
}

/// Calls `format` with an alias of `result` and terminates the text. Returns the length.
fn format_with(
    mut result: Dest<'_, UChar>,
    status: &mut UErrorCode,
    format: impl FnOnce(&mut WritableAlias) -> Result<(), UErrorCode>,
) -> Result<i32, UErrorCode> {
    let mut text = result.reborrow().alias();
    format(&mut text)?;
    let end = text.end();
    result.extract_aliased(end, status)
}

/// Accepts a null `position` and the letters GyYrUMLEcdaBHkhKmsSvzO. Other failures only truncate the text.
#[capi]
fn udat_format(
    fmt: Option<&UDateFormat>,
    date: UDate,
    (result, _): Dest<UChar>,
    position: Null,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |status| {
        result.check()?;
        if !position.is_null() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let format = fmt.non_null()?;
        format_with(result, status, |text| {
            match format.format(date, text, None) {
                Err(code @ (U_INVALID_STATE_ERROR | U_UNSUPPORTED_ERROR)) => Err(code),
                _ => Ok(()),
            }
        })
    })
}

/// Accepts an iterator that is not null, and the letters GyYrUMLEcdaBHkhKmsSvzO.
#[capi]
fn udat_formatForFields(
    fmt: Option<&UDateFormat>,
    date: UDate,
    (result, _): Dest<UChar>,
    fpositer: Option<&mut UFieldPositionIterator>,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |status| {
        result.check()?;
        let format = fmt.non_null()?;
        let fpositer = fpositer.ok_or(U_UNSUPPORTED_ERROR)?;
        format_with(result, status, |text| {
            let mut handler = FieldPositionIteratorHandler::new();
            let written = format.format(date, text, Some(&mut handler));
            _ = handler.finish_into(fpositer);
            written
        })
    })
}

/// Returns a pointer that is valid for writes: callers cast `const` away and modify the calendar.
#[capi]
fn udat_getCalendar(fmt: Option<&UDateFormat>) -> *const UCalendar {
    fmt.map_or(null(), |format| {
        AliasableBox::as_ptr(format)
            .wrapping_byte_add(offset_of!(SimpleDateFormat, calendar))
            .cast()
    })
}

/// Accepts `localized` false.
#[capi]
fn udat_toPattern(
    fmt: Option<&UDateFormat>,
    localized: UBool,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |status| {
        result.check()?;
        if localized != 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let pattern = fmt
            .non_null()?
            .to_pattern()
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        Ok(result.extract_to(pattern, status))
    })
}

/// Accepts `localized` false.
#[capi]
fn udat_applyPattern(fmt: Option<&mut UDateFormat>, localized: UBool, (pattern, _): Text<UChar>) {
    debug_assert!(localized == 0);
    if let Some(format) = fmt {
        ffi::ignore_oom(|| format.apply_pattern(pattern.get_or_empty()));
    }
}
