use bun_engine_temporal::TemporalValue;

use super::date_time_format::{new_date_time_format, string};
use super::duration_format::new_duration_format;
use super::prelude::*;
use crate::date_time_format::{DateTimeValue, Purpose};

/// `toLocaleString` of the classes of `Temporal`, after RequireInternalSlot.
pub fn temporal_to_locale_string(
    cx: &mut Cx,
    this: Gc<JsObject>,
    locales: Value,
    options: Value,
) -> JsResult<Value> {
    let (purpose, value) = match TemporalValue::of(&this).expect("checked by the method") {
        TemporalValue::Duration(duration) => {
            let format = new_duration_format(cx, locales, options)?;
            return string(cx, |_| format.format(&duration));
        }
        TemporalValue::ZonedDateTime(value) => {
            let (purpose, time_zone) = (Purpose::ZonedDateTime, Some(value.time_zone()));
            let format = new_date_time_format(cx, locales, options, purpose, time_zone)?;
            return string(cx, |cache| format.format_zoned_date_time(cache, &value));
        }
        TemporalValue::Instant(it) => (Purpose::DateAndTime, DateTimeValue::Instant(it)),
        TemporalValue::PlainDate(it) => (Purpose::Date, DateTimeValue::PlainDate(it)),
        TemporalValue::PlainDateTime(it) => {
            (Purpose::DateAndTime, DateTimeValue::PlainDateTime(it))
        }
        TemporalValue::PlainMonthDay(it) => (Purpose::Date, DateTimeValue::PlainMonthDay(it)),
        TemporalValue::PlainTime(it) => (Purpose::Time, DateTimeValue::PlainTime(it)),
        TemporalValue::PlainYearMonth(it) => (Purpose::Date, DateTimeValue::PlainYearMonth(it)),
    };
    let format = new_date_time_format(cx, locales, options, purpose, None)?;
    string(cx, |cache| format.format(cache, value))
}
