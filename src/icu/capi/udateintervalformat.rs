//! `unicode/udateintervalformat.h`

use crate::capi::ffi::{ErrorCode, NonNullHandle, NulStr, Text, UChar};
use crate::capi::ucal::{UCalendar, locale_id, zone_for_id};
use crate::capi::uformattedvalue::UFormattedValue;
use crate::common::locid::Locale;
use crate::i18n::dtitvfmt::DateIntervalFormat;
use crate::i18n::gregoimp::UDate;
use bun_icu_macros::capi;
use std::ptr::{from_ref, null};

pub(crate) type UDateIntervalFormat = DateIntervalFormat;

pub(crate) type UFormattedDateInterval = UFormattedValue;

/// Accepts skeletons in the order of `udatpg_getSkeleton`.
#[capi]
fn udtitvfmt_open(
    locale: NulStr<u8>,
    (skeleton, _): Text<UChar>,
    (tz_id, _): Text<UChar>,
    status: ErrorCode,
) -> Option<Box<UDateIntervalFormat>> {
    status.open(|| {
        DateIntervalFormat::create_instance(
            skeleton.get()?,
            &Locale::from_name(locale_id(locale)?),
            zone_for_id(tz_id)?,
        )
    })
}

#[capi]
fn udtitvfmt_close(formatter: Option<Box<UDateIntervalFormat>>) {
    drop(formatter);
}

#[capi]
fn udtitvfmt_openResult(ec: ErrorCode) -> Option<Box<UFormattedDateInterval>> {
    ec.open(|| Ok(UFormattedValue::new_unset()))
}

#[capi]
fn udtitvfmt_resultAsValue(
    uresult: Option<&UFormattedDateInterval>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_| uresult.non_null().map(from_ref))
}

#[capi]
fn udtitvfmt_closeResult(uresult: Option<Box<UFormattedDateInterval>>) {
    drop(uresult);
}

#[capi]
fn udtitvfmt_formatToResult(
    formatter: Option<&UDateIntervalFormat>,
    from_date: UDate,
    to_date: UDate,
    result: Option<&mut UFormattedDateInterval>,
    status: ErrorCode,
) {
    status.run((), |_| {
        let result = result.non_null()?;
        result.set(formatter.non_null()?.format_to_value(from_date, to_date))
    })
}

/// Accepts clones of one calendar.
#[capi]
fn udtitvfmt_formatCalendarToResult(
    formatter: Option<&UDateIntervalFormat>,
    from_calendar: Option<&UCalendar>,
    to_calendar: Option<&UCalendar>,
    result: Option<&mut UFormattedDateInterval>,
    status: ErrorCode,
) {
    status.run((), |_| {
        let result = result.non_null()?;
        let (from, to) = (from_calendar.non_null()?, to_calendar.non_null()?);
        let formatter = formatter.non_null()?;
        let format = || formatter.format_calendars_to_value(from.completed()?, to.completed()?);
        result.set(format())
    })
}
