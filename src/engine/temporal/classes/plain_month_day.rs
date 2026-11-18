use super::arguments::{
    calendar_argument, require_object, require_string, text_value, to_integer, to_optional_integer,
};
use super::fields::{read_fields, read_own_fields};
use super::getters::{self, HasDate};
use super::methods::{FromItem, equals, from, to_locale_string, value_of, with_fields};
use super::options::overflow_option;
use super::prelude::*;
use crate::{CalendarId, FieldSet, IsoDate, PlainMonthDay, ShowCalendar};

static_table!(static CONSTRUCTOR_PROPERTIES = [function(names::from, from::<PlainMonthDay>, 1)]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::toPlainDate, to_plain_date, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<PlainMonthDay>, 0),
    function(names::with, with, 1),
    function(names::equals, equals::<PlainMonthDay>, 1),
    function(names::valueOf, value_of::<PlainMonthDay>, 0),
    getter(names::calendarId, getters::calendar_id::<PlainMonthDay>),
    getter(names::day, getters::day::<PlainMonthDay>),
    getter(names::monthCode, getters::month_code::<PlainMonthDay>),
    StaticProperty::string(symbols::toStringTag, names::temporalPlainMonthDay),
]);

define_class!(
    PlainMonthDay, "Temporal.PlainMonthDay", length 2, PlainMonthDayValueOf,
    temporal_plain_month_day_shape, init_temporal_plain_month_day_shape,
    init_temporal_plain_month_day_constructor
);

impl FromItem for PlainMonthDay {
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<PlainMonthDay> {
        let Some(object) = item.as_object() else {
            let string = require_string(cx, item, Error::NotConvertibleToPlainMonthDay)?;
            let parsed = PlainMonthDay::parse(string.text()).or_throw(cx)?;
            overflow_option(cx, options)?;
            return parsed.finish().or_throw(cx);
        };
        if let Some(known) = PlainMonthDay::of(&object) {
            overflow_option(cx, options)?;
            return Ok(known);
        }
        let fields = read_own_fields(cx, &object, FieldSet::Date)?;
        let options = Options::or_throw(cx, options, Error::OptionsNotObject)?;
        PlainMonthDay::from_fields(&fields, options.overflow(cx)?).or_throw(cx)
    }
}

impl HasDate for PlainMonthDay {
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
    let month = to_integer(cx, frame.argument(0), Error::PlainMonthDayMonthNotFinite)?;
    let day = to_integer(cx, frame.argument(1), Error::PlainMonthDayDayNotFinite)?;
    let calendar = calendar_argument(cx, frame.argument(2), Error::MonthDayCalendarNotString)?;
    let year = to_optional_integer(cx, frame.argument(3), Error::PlainMonthDayYearNotFinite)?;
    (PlainMonthDay::new(month, day, calendar, year).or_throw(cx)?).constructed(cx, frame)
}

#[native_abi]
fn to_plain_date(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainMonthDay::this(cx, frame.this_value(), names::toPlainDate)?;
    let item = require_object(cx, frame.argument(0), Error::MonthDayItemNotObject)?;
    let fields = read_fields(cx, &item, FieldSet::Year, this.calendar())?;
    this.to_plain_date(&fields).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainMonthDay::this(cx, frame.this_value(), names::toString)?;
    let show_calendar = Options::new(cx, frame.argument(0))?.show_calendar(cx)?;
    text_value(cx, &this.to_text(show_calendar))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainMonthDay::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(ShowCalendar::Auto))
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let not_partial = Error::PlainMonthDayWithNotPartial;
    with_fields(cx, frame, FieldSet::Date, not_partial, PlainMonthDay::with)
}
