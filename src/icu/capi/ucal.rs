//! `unicode/ucal.h`: calendars and time zones.

use crate::capi::ffi::{
    self, Dest, ErrorCode, NonNullHandle, NulStr, Null, Out, Text, UBool, UChar,
};
use crate::capi::uenum::{self, UEnumeration};
use crate::common::locid::Locale;
use crate::common::memory::try_to_vec;
use crate::common::uloc::ulocimp_set_keyword_value;
use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, CalendarType, Field, SharedCalendar};
use crate::i18n::gregoimp::UDate;
use crate::i18n::timezone::{LocalOptions, TZEnumeration, TimeZone, host_time_zone_id};
use crate::i18n::tzfmt;
use crate::i18n::unicode::ucal::*;
use bun_icu_macros::capi;
use std::ffi::c_char;

pub(crate) type UCalendar = SharedCalendar;

/// Null, for the default zone, is not accepted.
pub(crate) fn zone_for_id(id: Text<'_, UChar>) -> Result<TimeZone, UErrorCode> {
    if id.is_null() {
        return Err(U_UNSUPPORTED_ERROR);
    }
    id.get().map(TimeZone::create_time_zone)
}

/// Null, for the default locale, is not accepted.
pub(crate) fn locale_id(locale: NulStr<'_, u8>) -> Result<&[u8], UErrorCode> {
    locale.get().ok_or(U_UNSUPPORTED_ERROR)
}

/// Accepts the fields that callers get, of which they set and add a part.
fn to_field(field: UCalendarDateFields) -> Result<Field, UErrorCode> {
    Ok(match field {
        UCAL_ERA => Field::Era,
        UCAL_YEAR => Field::Year,
        UCAL_MONTH => Field::Month,
        UCAL_DATE => Field::Date,
        UCAL_DAY_OF_YEAR => Field::DayOfYear,
        UCAL_HOUR_OF_DAY => Field::HourOfDay,
        UCAL_ZONE_OFFSET => Field::ZoneOffset,
        UCAL_DST_OFFSET => Field::DstOffset,
        UCAL_EXTENDED_YEAR => Field::ExtendedYear,
        UCAL_IS_LEAP_MONTH => Field::IsLeapMonth,
        _ => return Err(U_UNSUPPORTED_ERROR),
    })
}

/// A calendar that is opened with a null zone answers only for week data.
#[capi]
fn ucal_open(
    (zone_id, _): Text<UChar>,
    locale: NulStr<u8>,
    cal_type: UCalendarType,
    status: ErrorCode,
) -> Option<Box<UCalendar>> {
    status.open(|| {
        let zone = (!zone_id.is_null()).then(|| zone_for_id(zone_id));
        let locale = locale_id(locale)?;
        let locale = if cal_type == UCAL_GREGORIAN {
            let mut locale = try_to_vec(locale)?;
            ulocimp_set_keyword_value(b"calendar", b"gregorian", &mut locale)?;
            Locale::from_name(&locale)
        } else {
            Locale::from_name(locale)
        };
        Calendar::for_locale(zone.transpose()?, &locale)
    })
}

#[capi]
fn ucal_close(cal: Option<Box<UCalendar>>) {
    drop(cal);
}

#[capi]
fn ucal_clone(cal: Option<&UCalendar>, status: ErrorCode) -> Option<Box<UCalendar>> {
    status.open(|| cal.non_null().map(|cal| Calendar::clone(cal)))
}

#[capi]
fn ucal_setTimeZone(cal: Option<&mut UCalendar>, (zone_id, _): Text<UChar>, status: ErrorCode) {
    status.run((), |_| cal.non_null()?.set_time_zone(zone_for_id(zone_id)?))
}

#[capi]
fn ucal_setGregorianChange(cal: Option<&mut UCalendar>, date: UDate, status: ErrorCode) {
    status.run((), |_| cal.non_null()?.set_gregorian_change(date))
}

/// Accepts `UCAL_FIRST_DAY_OF_WEEK`.
#[capi]
fn ucal_getAttribute(cal: Option<&UCalendar>, attr: UCalendarAttribute) -> i32 {
    debug_assert!(attr == UCAL_FIRST_DAY_OF_WEEK);
    cal.map_or(-1, |cal| cal.first_day_of_week())
}

#[capi]
fn ucal_getMillis(cal: Option<&UCalendar>, status: ErrorCode) -> UDate {
    status.run(0.0, |_| Ok(cal.non_null()?.timed()?.internal_get_time()))
}

/// Panics if `cal` is null: `DateCache` keeps the result of a failed `ucal_open`, and takes each error for UTC.
#[capi]
fn ucal_setMillis(cal: Option<&mut UCalendar>, date_time: UDate, status: ErrorCode) {
    status.run_no_alloc((), |_| {
        assert!(cal.is_some(), "ucal_open has failed");
        cal.non_null()?.set_time(date_time)
    })
}

/// Accepts the extended year, the month and the date of a calendar that is not Gregorian, while the offset stays.
#[capi]
fn ucal_add(
    cal: Option<&mut UCalendar>,
    field: UCalendarDateFields,
    amount: i32,
    status: ErrorCode,
) {
    status.run((), |_| cal.non_null()?.add(to_field(field)?, amount))
}

#[capi]
fn ucal_get(cal: Option<&UCalendar>, field: UCalendarDateFields, status: ErrorCode) -> i32 {
    status.run(-1, |status| {
        let field = to_field(field)?;
        Ok(ffi::unwrap_or_set(cal.non_null()?.get(field), 0, status))
    })
}

/// Accepts the extended year, a month in range, the leap month, the date, the hour, and the era and year of "ethioaa".
#[capi]
fn ucal_set(cal: Option<&mut UCalendar>, field: UCalendarDateFields, value: i32) {
    let Some(cal) = cal else {
        return;
    };
    debug_assert!(match field {
        UCAL_MONTH => (0..=cal.last_month()).contains(&value),
        UCAL_DAY_OF_YEAR | UCAL_ZONE_OFFSET | UCAL_DST_OFFSET => false,
        _ => to_field(field).is_ok(),
    });
    if let Ok(field) = to_field(field) {
        cal.set(field, value);
    }
}

#[capi]
fn ucal_clear(calendar: Option<&mut UCalendar>) {
    if let Some(cal) = calendar {
        cal.clear();
    }
}

/// Accepts the actual maximum of the month, the date and the day of the year, and the least maximum of the latter.
#[capi]
fn ucal_getLimit(
    cal: Option<&UCalendar>,
    field: UCalendarDateFields,
    limit_type: UCalendarLimitType,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |_| {
        let cal = cal.non_null()?;
        match (field, limit_type) {
            (UCAL_MONTH, UCAL_ACTUAL_MAXIMUM) => Ok(cal.last_month()),
            (UCAL_DATE, UCAL_ACTUAL_MAXIMUM) => cal.days_in_month(),
            (UCAL_DAY_OF_YEAR, UCAL_ACTUAL_MAXIMUM) => cal.days_in_year(),
            (UCAL_DAY_OF_YEAR, UCAL_LEAST_MAXIMUM) => Ok(cal.days_in_shortest_year()),
            _ => Err(U_UNSUPPORTED_ERROR),
        }
    })
}

#[capi]
fn ucal_getKeywordValuesForLocale(
    _key: NulStr<u8>,
    locale: NulStr<u8>,
    commonly_used: UBool,
    status: ErrorCode,
) -> Option<Box<UEnumeration>> {
    status.open(|| {
        uenum::open_boxed(CalendarType::keyword_values_for_locale(
            locale_id(locale)?,
            commonly_used != 0,
        )?)
    })
}

#[capi]
fn ucal_getDayOfWeekType(
    cal: Option<&UCalendar>,
    day_of_week: UCalendarDaysOfWeek,
    status: ErrorCode,
) -> UCalendarWeekdayType {
    status.run_no_alloc(UCAL_WEEKDAY, |_| {
        if !(UCAL_SUNDAY..=UCAL_SATURDAY).contains(&day_of_week) {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        Ok(if cal.non_null()?.is_weekend(day_of_week) {
            UCAL_WEEKEND
        } else {
            UCAL_WEEKDAY
        })
    })
}

/// Accepts all types but `UCAL_TZ_TRANSITION_NEXT_INCLUSIVE`.
#[capi]
fn ucal_getTimeZoneTransitionDate(
    cal: Option<&UCalendar>,
    transition_type: UTimeZoneTransitionType,
    transition: Out<UDate>,
    status: ErrorCode,
) -> UBool {
    status.run(0, |_| {
        let cal = cal.non_null()?.timed()?;
        let (zone, base) = (cal.time_zone()?, cal.internal_get_time());
        let found = match transition_type {
            UCAL_TZ_TRANSITION_NEXT => zone.get_next_transition(base),
            UCAL_TZ_TRANSITION_PREVIOUS => zone.get_previous_transition(base, false),
            UCAL_TZ_TRANSITION_PREVIOUS_INCLUSIVE => zone.get_previous_transition(base, true),
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        let Some(found) = found else {
            return Ok(0);
        };
        if transition.is_null() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        transition.set(found.time);
        Ok(1)
    })
}

/// Accepts `UCAL_TZ_LOCAL_FORMER` and `UCAL_TZ_LOCAL_LATTER`.
#[capi]
fn ucal_getTimeZoneOffsetFromLocal(
    cal: Option<&UCalendar>,
    non_existing_time_opt: UTimeZoneLocalOption,
    duplicated_time_opt: UTimeZoneLocalOption,
    raw_offset: Out<i32>,
    dst_offset: Out<i32>,
    status: ErrorCode,
) {
    let is_latter = |option| match option {
        UCAL_TZ_LOCAL_FORMER => Ok(false),
        UCAL_TZ_LOCAL_LATTER => Ok(true),
        _ => Err(U_UNSUPPORTED_ERROR),
    };
    status.run((), |_| {
        let cal = cal.non_null()?.timed()?;
        if raw_offset.is_null() || dst_offset.is_null() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let options = LocalOptions {
            skipped_is_latter: is_latter(non_existing_time_opt)?,
            repeated_is_latter: is_latter(duplicated_time_opt)?,
        };
        let offsets = cal
            .time_zone()?
            .get_offset_from_local(cal.internal_get_time(), options)?;
        raw_offset.set(offsets.raw_offset);
        dst_offset.set(offsets.dst_savings);
        Ok(())
    })
}

/// Accepts `UCAL_ZONE_TYPE_CANONICAL` without a raw offset.
#[capi]
fn ucal_openTimeZoneIDEnumeration(
    zone_type: USystemTimeZoneType,
    region: NulStr<u8>,
    raw_offset: Null,
    ec: ErrorCode,
) -> Option<Box<UEnumeration>> {
    ec.open(|| {
        if zone_type != UCAL_ZONE_TYPE_CANONICAL || !raw_offset.is_null() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let zones = TZEnumeration::canonical()?;
        uenum::open_boxed(match region.get() {
            Some(region) => zones.in_region(region)?,
            None => zones,
        })
    })
}

#[capi]
fn ucal_openTimeZones(ec: ErrorCode) -> Option<Box<UEnumeration>> {
    ec.open(|| uenum::open_boxed(TZEnumeration::all()?))
}

#[capi]
fn ucal_getHostTimeZone((result, _): Dest<UChar>, ec: ErrorCode) -> i32 {
    ec.run(0, |ec| Ok(result.extract_to(&host_time_zone_id()?, ec)))
}

#[capi]
fn ucal_getTZDataVersion(status: ErrorCode) -> *const c_char {
    status.run(c"".as_ptr(), |_| {
        TimeZone::get_tz_data_version().map(|version| version.as_ptr().cast())
    })
}

/// Accepts a null `is_system_id`.
#[capi]
fn ucal_getCanonicalTimeZoneID(
    (id, _): Text<UChar>,
    (result, result_capacity): Dest<UChar>,
    is_system_id: Null,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        if !is_system_id.is_null() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        if result.is_null() || result_capacity <= 0 {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let canonical = TimeZone::get_canonical_id(id.get()?)?;
        Ok(result.extract_to(&canonical, status))
    })
}

#[capi]
fn ucal_getIanaTimeZoneID(
    (id, _): Text<UChar>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        let iana_id = TimeZone::get_iana_id(id.get()?)?;
        Ok(result.extract_to(&iana_id, status))
    })
}

/// Accepts `UCAL_STANDARD` and `UCAL_DST`.
#[capi]
fn ucal_getTimeZoneDisplayName(
    cal: Option<&UCalendar>,
    display_type: UCalendarDisplayNameType,
    locale: NulStr<u8>,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |status| {
        let is_daylight = match display_type {
            UCAL_STANDARD => false,
            UCAL_DST => true,
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        let locale = Locale::from_name(locale_id(locale)?);
        let name = tzfmt::display_name(cal.non_null()?.time_zone()?, is_daylight, &locale);
        Ok(result.extract_to(&name, status))
    })
}
