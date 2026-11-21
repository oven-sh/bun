//! `unicode/udateintervalformat.h`

use crate::capi::ffi::{ErrorCode, MayAlias, Mut, NulStr, Owned, Ref, Text, UChar};
use crate::capi::ucal::{UCalendar, locale_id, zone_for_id};
use crate::capi::uformattedvalue::UFormattedValue;
use crate::common::locid::Locale;
use crate::common::utypes::U_UNSUPPORTED_ERROR;
use crate::i18n::dtitvfmt::DateIntervalFormat;
use crate::i18n::gregoimp::UDate;
use bun_icu_macros::capi;
use std::ptr::null;

pub(crate) type UDateIntervalFormat = DateIntervalFormat;

pub(crate) type UFormattedDateInterval = UFormattedValue;

/// "FDIV"
const MAGIC: i32 = 0x4644_4956;

/// Accepts the skeletons that `udatpg_getSkeleton` returns, unless they are empty or contain `Z`.
#[capi]
fn udtitvfmt_open(
    locale: NulStr<u8>,
    (skeleton, _): Text<UChar>,
    (tz_id, _): Text<UChar>,
    status: ErrorCode,
) -> *mut UDateIntervalFormat {
    status.open(|cx, _| {
        DateIntervalFormat::create_instance(
            cx.text(skeleton)?,
            &Locale::from_name(locale_id(cx, locale)?),
            zone_for_id(cx, tz_id)?,
        )
    })
}

#[capi]
fn udtitvfmt_close(formatter: Owned<UDateIntervalFormat>) {
    formatter.close()
}

#[capi]
fn udtitvfmt_openResult(ec: ErrorCode) -> *mut UFormattedDateInterval {
    ec.open(|_, _| Ok(UFormattedValue::new_unset(MAGIC)))
}

#[capi]
fn udtitvfmt_resultAsValue(
    uresult: Ref<UFormattedDateInterval>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_, _| {
        UFormattedValue::validate(uresult, MAGIC).map(|_| uresult.as_ptr())
    })
}

#[capi]
fn udtitvfmt_closeResult(uresult: Owned<UFormattedDateInterval>) {
    UFormattedValue::close(uresult, MAGIC)
}

#[capi]
fn udtitvfmt_formatToResult(
    formatter: Ref<UDateIntervalFormat>,
    from_date: UDate,
    to_date: UDate,
    result: Mut<UFormattedDateInterval>,
    status: ErrorCode,
) {
    status.run((), |_, _| {
        let result = UFormattedValue::validate_mut(result, MAGIC)?;
        result.set(formatter.get()?.format_to_value(from_date, to_date))
    })
}

/// Accepts two clones of one calendar, which has the type of the formatter's calendar.
#[capi]
fn udtitvfmt_formatCalendarToResult(
    formatter: Ref<UDateIntervalFormat>,
    from_calendar: Mut<UCalendar>,
    to_calendar: MayAlias<Mut<UCalendar>, UCalendar>,
    result: Mut<UFormattedDateInterval>,
    status: ErrorCode,
) {
    status.run((), |_, _| {
        let result = UFormattedValue::validate_mut(result, MAGIC)?;
        let to = to_calendar.if_distinct(&from_calendar);
        let to = to.ok_or(U_UNSUPPORTED_ERROR)?.get_mut()?;
        let (formatter, from) = (formatter.get()?, from_calendar.get_mut()?);
        result.set(formatter.format_calendars_to_value(from, to))
    })
}
