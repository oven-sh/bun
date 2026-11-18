use core::cmp::Ordering;

use super::arguments::{
    calendar_argument, require_object, require_string, text_value, to_integer, to_optional_integer,
};
use super::fields::{read_fields, read_own_fields};
use super::getters::{self, HasDate};
use super::methods::{
    Compare, Difference, FromItem, add_duration_in_calendar, compare, equals, from, since,
    to_locale_string, until, value_of, with_fields,
};
use super::options::overflow_option;
use super::prelude::*;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Duration, FieldSet, IsoDate,
    PlainYearMonth, Result, ShowCalendar,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from::<PlainYearMonth>, 1),
    function(names::compare, compare::<PlainYearMonth>, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::until, until::<PlainYearMonth>, 1),
    function(names::since, since::<PlainYearMonth>, 1),
    function(names::toPlainDate, to_plain_date, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<PlainYearMonth>, 0),
    function(names::with, with, 1),
    function(names::equals, equals::<PlainYearMonth>, 1),
    function(names::valueOf, value_of::<PlainYearMonth>, 0),
    getter(names::calendarId, getters::calendar_id::<PlainYearMonth>),
    getter(names::year, getters::year::<PlainYearMonth>),
    getter(names::month, getters::month::<PlainYearMonth>),
    getter(names::monthCode, getters::month_code::<PlainYearMonth>),
    getter(names::daysInMonth, getters::days_in_month::<PlainYearMonth>),
    getter(names::daysInYear, getters::days_in_year::<PlainYearMonth>),
    getter(names::monthsInYear, getters::months_in_year::<PlainYearMonth>),
    getter(names::inLeapYear, getters::in_leap_year::<PlainYearMonth>),
    getter(names::era, getters::era::<PlainYearMonth>),
    getter(names::eraYear, getters::era_year::<PlainYearMonth>),
    StaticProperty::string(symbols::toStringTag, names::temporalPlainYearMonth),
]);

define_class!(
    PlainYearMonth, "Temporal.PlainYearMonth", length 2, PlainYearMonthValueOf,
    temporal_plain_year_month_shape, init_temporal_plain_year_month_shape,
    init_temporal_plain_year_month_constructor
);

impl FromItem for PlainYearMonth {
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<PlainYearMonth> {
        let Some(object) = item.as_object() else {
            let string = require_string(cx, item, Error::NotConvertibleToPlainYearMonth)?;
            let parsed = PlainYearMonth::parse(string.text()).or_throw(cx)?;
            overflow_option(cx, options)?;
            return parsed.finish().or_throw(cx);
        };
        if let Some(known) = PlainYearMonth::of(&object) {
            overflow_option(cx, options)?;
            return Ok(known);
        }
        let fields = read_own_fields(cx, &object, FieldSet::YearMonth)?;
        let options = Options::or_throw(cx, options, Error::OptionsNotObject)?;
        PlainYearMonth::from_fields(&fields, options.overflow(cx)?).or_throw(cx)
    }
}

impl Compare for PlainYearMonth {
    fn compare(&self, other: &PlainYearMonth) -> Ordering {
        self.iso_date().cmp(&other.iso_date())
    }
}

impl Difference for PlainYearMonth {
    fn check_comparable(&self, other: &PlainYearMonth) -> Result<()> {
        self.check_same_calendar(*other)
    }

    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &PlainYearMonth,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        self.difference(operation, *other, options)
    }
}

impl HasDate for PlainYearMonth {
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
    let year = to_integer(cx, frame.argument(0), Error::PlainYearMonthYearNotFinite)?;
    let month = to_integer(cx, frame.argument(1), Error::PlainYearMonthMonthNotFinite)?;
    let calendar = calendar_argument(cx, frame.argument(2), Error::CalendarIdNotString)?;
    let day = to_optional_integer(cx, frame.argument(3), Error::PlainYearMonthDayNotFinite)?;
    (PlainYearMonth::new(year, month, calendar, day).or_throw(cx)?).constructed(cx, frame)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(cx, frame, names::add, PlainYearMonth::add)
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(cx, frame, names::subtract, PlainYearMonth::subtract)
}

#[native_abi]
fn to_plain_date(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainYearMonth::this(cx, frame.this_value(), names::toPlainDate)?;
    let item = require_object(cx, frame.argument(0), Error::YearMonthItemNotObject)?;
    let fields = read_fields(cx, &item, FieldSet::Day, this.calendar())?;
    this.to_plain_date(&fields).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainYearMonth::this(cx, frame.this_value(), names::toString)?;
    let show_calendar = Options::new(cx, frame.argument(0))?.show_calendar(cx)?;
    text_value(cx, &this.to_text(show_calendar))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainYearMonth::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(ShowCalendar::Auto))
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let not_partial = Error::PlainYearMonthWithNotPartial;
    with_fields(
        cx,
        frame,
        FieldSet::YearMonth,
        not_partial,
        PlainYearMonth::with,
    )
}
