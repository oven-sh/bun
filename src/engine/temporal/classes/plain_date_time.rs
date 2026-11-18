use core::cmp::Ordering;

use super::arguments::{
    calendar_argument, require_string, text_value, to_calendar, to_integer, to_time_zone,
};
use super::fields::read_own_fields;
use super::getters::{self, HasDate, HasTime};
use super::methods::{
    Compare, Difference, FromItem, add_duration_in_calendar, compare, equals, from, since,
    to_locale_string, until, value_of, with_fields,
};
use super::options::{overflow_option, round_argument};
use super::plain_time::to_optional_time;
use super::prelude::*;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Disambiguation, Duration, FieldSet,
    IsoDate, IsoDateTime, PlainDate, PlainDateTime, PlainTime, Precision, Result, ShowCalendar,
    ZonedDateTime,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from::<PlainDateTime>, 1),
    function(names::compare, compare::<PlainDateTime>, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::until, until::<PlainDateTime>, 1),
    function(names::since, since::<PlainDateTime>, 1),
    function(names::with, with, 1),
    function(names::withCalendar, with_calendar, 1),
    function(names::withPlainTime, with_plain_time, 0),
    function(names::round, round, 1),
    function(names::equals, equals::<PlainDateTime>, 1),
    function(names::toPlainDate, to_plain_date, 0),
    function(names::toPlainTime, to_plain_time, 0),
    function(names::toZonedDateTime, to_zoned_date_time, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<PlainDateTime>, 0),
    function(names::valueOf, value_of::<PlainDateTime>, 0),
    getter(names::calendarId, getters::calendar_id::<PlainDateTime>),
    getter(names::year, getters::year::<PlainDateTime>),
    getter(names::month, getters::month::<PlainDateTime>),
    getter(names::monthCode, getters::month_code::<PlainDateTime>),
    getter(names::day, getters::day::<PlainDateTime>),
    getter(names::hour, getters::hour::<PlainDateTime>),
    getter(names::minute, getters::minute::<PlainDateTime>),
    getter(names::second, getters::second::<PlainDateTime>),
    getter(names::millisecond, getters::millisecond::<PlainDateTime>),
    getter(names::microsecond, getters::microsecond::<PlainDateTime>),
    getter(names::nanosecond, getters::nanosecond::<PlainDateTime>),
    getter(names::dayOfWeek, getters::day_of_week::<PlainDateTime>),
    getter(names::dayOfYear, getters::day_of_year::<PlainDateTime>),
    getter(names::weekOfYear, getters::week_of_year::<PlainDateTime>),
    getter(names::yearOfWeek, getters::year_of_week::<PlainDateTime>),
    getter(names::daysInWeek, getters::days_in_week::<PlainDateTime>),
    getter(names::daysInMonth, getters::days_in_month::<PlainDateTime>),
    getter(names::daysInYear, getters::days_in_year::<PlainDateTime>),
    getter(names::monthsInYear, getters::months_in_year::<PlainDateTime>),
    getter(names::inLeapYear, getters::in_leap_year::<PlainDateTime>),
    getter(names::era, getters::era::<PlainDateTime>),
    getter(names::eraYear, getters::era_year::<PlainDateTime>),
    StaticProperty::string(symbols::toStringTag, names::temporalPlainDateTime),
]);

define_class!(
    PlainDateTime, "Temporal.PlainDateTime", length 3, PlainDateTimeValueOf,
    temporal_plain_date_time_shape, init_temporal_plain_date_time_shape,
    init_temporal_plain_date_time_constructor
);

/// ToTemporalDateTime
pub fn to_temporal_date_time(cx: &mut Cx, item: Value) -> JsResult<PlainDateTime> {
    PlainDateTime::from_argument(cx, item)
}

impl FromItem for PlainDateTime {
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<PlainDateTime> {
        let Some(object) = item.as_object() else {
            let string = require_string(cx, item, Error::NotConvertibleToPlainDateTime)?;
            let parsed = PlainDateTime::parse(string.text()).or_throw(cx)?;
            overflow_option(cx, options)?;
            return parsed.finish().or_throw(cx);
        };
        let known = (PlainDateTime::of(&object).map(Ok))
            .or_else(|| Some(Ok(ZonedDateTime::of(&object)?.to_plain_date_time())))
            .or_else(|| Some(PlainDate::of(&object)?.to_plain_date_time(PlainTime::MIDNIGHT)));
        if let Some(date_time) = known {
            overflow_option(cx, options)?;
            return date_time.or_throw(cx);
        }
        let fields = read_own_fields(cx, &object, FieldSet::DateTime)?;
        PlainDateTime::from_fields(&fields, overflow_option(cx, options)?).or_throw(cx)
    }
}

impl Compare for PlainDateTime {
    fn compare(&self, other: &PlainDateTime) -> Ordering {
        self.iso_date_time().cmp(&other.iso_date_time())
    }
}

impl Difference for PlainDateTime {
    fn check_comparable(&self, other: &PlainDateTime) -> Result<()> {
        self.check_same_calendar(*other)
    }

    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &PlainDateTime,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        self.difference(operation, *other, options)
    }
}

impl HasDate for PlainDateTime {
    #[inline(always)]
    fn calendar_id(&self) -> CalendarId {
        self.calendar()
    }

    #[inline(always)]
    fn date(&self) -> IsoDate {
        self.iso_date_time().date
    }
}

impl HasTime for PlainDateTime {
    #[inline(always)]
    fn time(&self) -> PlainTime {
        self.iso_date_time().time
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    const DATE_FIELDS: usize = 3;
    let mut fields = [0; 9];
    for (index, field) in fields.iter_mut().enumerate() {
        let value = frame.argument(index);
        if index < DATE_FIELDS || !value.is_undefined() {
            *field = to_integer(cx, value, Error::PlainDateTimeArgumentNotFinite)?;
        }
    }
    let calendar = calendar_argument(cx, frame.argument(9), Error::CalendarIdNotString)?;
    let [year, month, day, time @ ..] = fields;
    let date_time = IsoDateTime {
        date: IsoDate::new(year, month, day).or_throw(cx)?,
        time: PlainTime::new(time).or_throw(cx)?,
    };
    (PlainDateTime::new(date_time, calendar).or_throw(cx)?).constructed(cx, frame)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(cx, frame, names::add, PlainDateTime::add)
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(cx, frame, names::subtract, PlainDateTime::subtract)
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let not_partial = Error::PlainDateTimeWithNotPartial;
    with_fields(
        cx,
        frame,
        FieldSet::DateTime,
        not_partial,
        PlainDateTime::with,
    )
}

#[native_abi]
fn with_calendar(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::withCalendar)?;
    let calendar = to_calendar(cx, frame.argument(0))?;
    this.with_calendar(calendar).returned(cx)
}

#[native_abi]
fn with_plain_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::withPlainTime)?;
    let time = to_optional_time(cx, frame.argument(0))?.unwrap_or(PlainTime::MIDNIGHT);
    this.with_plain_time(time).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn round(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::round)?;
    let missing = Error::PlainDateTimeRoundWithoutOptions;
    let options = round_argument(cx, frame.argument(0), missing)?;
    this.round(options).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_plain_date(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::toPlainDate)?;
    this.to_plain_date().returned(cx)
}

#[native_abi]
fn to_plain_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::toPlainTime)?;
    this.time().returned(cx)
}

#[native_abi]
fn to_zoned_date_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::toZonedDateTime)?;
    let time_zone = to_time_zone(cx, frame.argument(0))?;
    let options = Options::new(cx, frame.argument(1))?;
    let disambiguation = options.value_or(cx, Disambiguation::Compatible)?;
    (this.to_zoned_date_time(time_zone, disambiguation))
        .or_throw(cx)?
        .returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::toString)?;
    let options = Options::new(cx, frame.argument(0))?;
    let show_calendar = options.show_calendar(cx)?;
    let precision = PlainDateTime::precision(options.precision(cx)?).or_throw(cx)?;
    let rounded = this.round_for_text(precision).or_throw(cx)?;
    text_value(cx, &rounded.to_text(precision, show_calendar))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDateTime::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(Precision::AUTO, ShowCalendar::Auto))
}
