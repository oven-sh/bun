use core::cmp::Ordering;

use super::arguments::{require_object, require_string, small_integers, text_value};
use super::fields::{read_fields, read_partial_fields};
use super::getters::{HasTime, hour, microsecond, millisecond, minute, nanosecond, second};
use super::methods::{
    Compare, Difference, FromItem, add_duration, compare, equals, from, since, to_locale_string,
    until, value_of,
};
use super::options::{overflow_option, round_argument};
use super::prelude::*;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Duration, FieldSet, PlainDateTime,
    PlainTime, Precision, Result, ZonedDateTime,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from::<PlainTime>, 1),
    function(names::compare, compare::<PlainTime>, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::with, with, 1),
    function(names::until, until::<PlainTime>, 1),
    function(names::since, since::<PlainTime>, 1),
    function(names::round, round, 1),
    function(names::equals, equals::<PlainTime>, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<PlainTime>, 0),
    function(names::valueOf, value_of::<PlainTime>, 0),
    getter(names::hour, hour::<PlainTime>),
    getter(names::minute, minute::<PlainTime>),
    getter(names::second, second::<PlainTime>),
    getter(names::millisecond, millisecond::<PlainTime>),
    getter(names::microsecond, microsecond::<PlainTime>),
    getter(names::nanosecond, nanosecond::<PlainTime>),
    StaticProperty::string(symbols::toStringTag, names::temporalPlainTime),
]);

define_class!(
    PlainTime, "Temporal.PlainTime", length 0, PlainTimeValueOf,
    temporal_plain_time_shape, init_temporal_plain_time_shape, init_temporal_plain_time_constructor
);

/// ToTemporalTime
pub fn to_temporal_time(cx: &mut Cx, item: Value) -> JsResult<PlainTime> {
    PlainTime::from_argument(cx, item)
}

/// `None` for undefined.
pub(super) fn to_optional_time(cx: &mut Cx, item: Value) -> JsResult<Option<PlainTime>> {
    if item.is_undefined() {
        return Ok(None);
    }
    to_temporal_time(cx, item).map(Some)
}

impl FromItem for PlainTime {
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<PlainTime> {
        let time = if let Some(object) = item.as_object() {
            let known = PlainTime::of(&object)
                .or_else(|| Some(PlainDateTime::of(&object)?.time()))
                .or_else(|| Some(ZonedDateTime::of(&object)?.time()));
            let Some(time) = known else {
                let fields = read_fields(cx, &object, FieldSet::Time, CalendarId::Iso8601)?;
                fields.require_any().or_throw(cx)?;
                let options = Options::or_throw(cx, options, Error::OptionsNotObject)?;
                return PlainTime::from_fields(&fields, options.overflow(cx)?).or_throw(cx);
            };
            time
        } else {
            let string = require_string(cx, item, Error::NotConvertibleToPlainTime)?;
            PlainTime::parse(string.text()).or_throw(cx)?
        };
        overflow_option(cx, options)?;
        Ok(time)
    }
}

impl Compare for PlainTime {
    fn compare(&self, other: &PlainTime) -> Ordering {
        self.cmp(other)
    }
}

impl Difference for PlainTime {
    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &PlainTime,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        self.difference(operation, *other, options)
    }
}

impl HasTime for PlainTime {
    #[inline(always)]
    fn time(&self) -> PlainTime {
        *self
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(fields) = small_integers(frame) {
        return PlainTime::new(fields).or_throw(cx)?.constructed(cx, frame);
    }
    let mut fields = [0; 6];
    for (field, &value) in fields.iter_mut().zip(frame.arguments()) {
        if !value.is_undefined() {
            *field = PlainTime::argument(value.to_number(cx)?).or_throw(cx)?;
        }
    }
    PlainTime::new(fields).or_throw(cx)?.constructed(cx, frame)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration(cx, frame, names::add, |this: PlainTime, duration| {
        Ok(this.add(duration))
    })
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration(cx, frame, names::subtract, |this: PlainTime, duration| {
        Ok(this.subtract(duration))
    })
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainTime::this(cx, frame.this_value(), names::with)?;
    let item = require_object(cx, frame.argument(0), Error::PlainTimeWithNotObject)?;
    let fields = read_partial_fields(
        cx,
        item.into(),
        FieldSet::Time,
        CalendarId::Iso8601,
        Error::PlainTimeWithNotPartial,
    )?;
    let overflow = overflow_option(cx, frame.argument(1))?;
    this.with(&fields, overflow).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn round(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainTime::this(cx, frame.this_value(), names::round)?;
    let options = round_argument(cx, frame.argument(0), Error::PlainTimeRoundWithoutOptions)?;
    this.round(options).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainTime::this(cx, frame.this_value(), names::toString)?;
    let options = Options::new(cx, frame.argument(0))?.precision(cx)?;
    let precision = PlainTime::precision(options).or_throw(cx)?;
    text_value(cx, &this.to_text(precision))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = PlainTime::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(Precision::AUTO))
}
