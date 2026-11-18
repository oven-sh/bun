use core::cmp::Ordering;

use super::arguments::{
    calendar_argument, require_string, text_value, to_calendar, to_integer, to_time_zone,
};
use super::fields::read_own_fields;
use super::getters::{self, HasDate};
use super::methods::{
    Compare, Difference, FromItem, add_duration_in_calendar, compare, equals, from, since,
    to_locale_string, until, value_of, with_fields,
};
use super::options::overflow_option;
use super::plain_time::to_optional_time;
use super::prelude::*;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Duration, FieldSet, IsoDate, PlainDate,
    PlainDateTime, PlainTime, Result, ShowCalendar, ZonedDateTime,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from::<PlainDate>, 1),
    function(names::compare, compare::<PlainDate>, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::toPlainMonthDay, to_plain_month_day, 0),
    function(names::toPlainYearMonth, to_plain_year_month, 0),
    function(names::withCalendar, with_calendar, 1),
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::with, with, 1),
    function(names::until, until::<PlainDate>, 1),
    function(names::since, since::<PlainDate>, 1),
    function(names::equals, equals::<PlainDate>, 1),
    function(names::toPlainDateTime, to_plain_date_time, 0),
    function(names::toZonedDateTime, to_zoned_date_time, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<PlainDate>, 0),
    function(names::valueOf, value_of::<PlainDate>, 0),
    getter(names::calendarId, getters::calendar_id::<PlainDate>),
    getter(names::year, getters::year::<PlainDate>),
    getter(names::month, getters::month::<PlainDate>),
    getter(names::monthCode, getters::month_code::<PlainDate>),
    getter(names::day, getters::day::<PlainDate>),
    getter(names::dayOfWeek, getters::day_of_week::<PlainDate>),
    getter(names::dayOfYear, getters::day_of_year::<PlainDate>),
    getter(names::weekOfYear, getters::week_of_year::<PlainDate>),
    getter(names::yearOfWeek, getters::year_of_week::<PlainDate>),
    getter(names::daysInWeek, getters::days_in_week::<PlainDate>),
    getter(names::daysInMonth, getters::days_in_month::<PlainDate>),
    getter(names::daysInYear, getters::days_in_year::<PlainDate>),
    getter(names::monthsInYear, getters::months_in_year::<PlainDate>),
    getter(names::inLeapYear, getters::in_leap_year::<PlainDate>),
    getter(names::era, getters::era::<PlainDate>),
    getter(names::eraYear, getters::era_year::<PlainDate>),
    StaticProperty::string(symbols::toStringTag, names::temporalPlainDate),
]);

define_class!(
    PlainDate, "Temporal.PlainDate", length 3, PlainDateValueOf,
    temporal_plain_date_shape, init_temporal_plain_date_shape, init_temporal_plain_date_constructor
);

/// ToTemporalDate
pub fn to_temporal_date(cx: &mut Cx, item: Value) -> JsResult<PlainDate> {
    PlainDate::from_argument(cx, item)
}

impl FromItem for PlainDate {
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<PlainDate> {
        let Some(object) = item.as_object() else {
            let string = require_string(cx, item, Error::NotConvertibleToPlainDate)?;
            let parsed = PlainDate::parse(string.text()).or_throw(cx)?;
            overflow_option(cx, options)?;
            return parsed.finish().or_throw(cx);
        };
        let known = PlainDate::of(&object)
            .or_else(|| Some(PlainDateTime::of(&object)?.to_plain_date()))
            .or_else(|| Some(ZonedDateTime::of(&object)?.to_plain_date()));
        if let Some(date) = known {
            overflow_option(cx, options)?;
            return Ok(date);
        }
        let fields = read_own_fields(cx, &object, FieldSet::Date)?;
        let options = Options::or_throw(cx, options, Error::OptionsNotObject)?;
        PlainDate::from_fields(&fields, options.overflow(cx)?).or_throw(cx)
    }
}

impl Compare for PlainDate {
    fn compare(&self, other: &PlainDate) -> Ordering {
        self.iso_date().cmp(&other.iso_date())
    }
}

impl Difference for PlainDate {
    fn check_comparable(&self, other: &PlainDate) -> Result<()> {
        self.check_same_calendar(*other)
    }

    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &PlainDate,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        self.difference(operation, *other, options)
    }
}

impl HasDate for PlainDate {
    #[inline(always)]
    fn calendar_id(&self) -> CalendarId {
        self.calendar()
    }

    #[inline(always)]
    fn date(&self) -> IsoDate {
        self.iso_date()
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    const NOT_FINITE: [Error; 3] = [
        Error::PlainDateYearNotFinite,
        Error::PlainDateMonthNotFinite,
        Error::PlainDateDayNotFinite,
    ];
    let mut fields = [0; 3];
    for ((field, &value), error) in fields.iter_mut().zip(frame.arguments()).zip(NOT_FINITE) {
        *field = to_integer(cx, value, error)?;
    }
    let calendar = calendar_argument(cx, frame.argument(3), Error::CalendarIdNotString)?;
    let [year, month, day] = fields;
    let date = IsoDate::new(year, month, day).or_throw(cx)?;
    (PlainDate::new(date, calendar).or_throw(cx)?).constructed(cx, frame)
}

#[native_abi]
fn to_plain_month_day(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::toPlainMonthDay)?;
    this.to_plain_month_day().or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_plain_year_month(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::toPlainYearMonth)?;
    this.to_plain_year_month().or_throw(cx)?.returned(cx)
}

#[native_abi]
fn with_calendar(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::withCalendar)?;
    let calendar = to_calendar(cx, frame.argument(0))?;
    this.with_calendar(calendar).returned(cx)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(cx, frame, names::add, PlainDate::add)
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(cx, frame, names::subtract, PlainDate::subtract)
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let not_partial = Error::PlainDateWithNotPartial;
    with_fields(cx, frame, FieldSet::Date, not_partial, PlainDate::with)
}

#[native_abi]
fn to_plain_date_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::toPlainDateTime)?;
    let time = to_optional_time(cx, frame.argument(0))?.unwrap_or(PlainTime::MIDNIGHT);
    this.to_plain_date_time(time).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_zoned_date_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::toZonedDateTime)?;
    let item = frame.argument(0);
    let (time_zone, time) = if let Some(object) = item.as_object()
        && let Some(time_zone) = Options::from(object).get(cx, names::timeZone)?
    {
        (
            to_time_zone(cx, time_zone)?,
            get(cx, &object, names::plainTime)?,
        )
    } else {
        (to_time_zone(cx, item)?, Value::UNDEFINED)
    };
    let time = to_optional_time(cx, time)?;
    (this.to_zoned_date_time(time_zone, time).or_throw(cx)?).returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::toString)?;
    let show_calendar = Options::new(cx, frame.argument(0))?.show_calendar(cx)?;
    text_value(cx, &this.to_text(show_calendar))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainDate::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(ShowCalendar::Auto))
}
