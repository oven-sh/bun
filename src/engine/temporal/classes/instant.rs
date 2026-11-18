use core::cmp::Ordering;

use bun_engine_vm::{JsBigInt, PreferredType};

use super::arguments::{require_string, text_value, to_epoch_nanoseconds, to_time_zone};
use super::methods::{
    Compare, Difference, FromItem, add_duration, compare, equals, from, since, to_locale_string,
    until, value_of,
};
use super::options::round_argument;
use super::prelude::*;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Duration, Instant, Precision, Result,
    TextError, ZonedDateTime,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from::<Instant>, 1),
    function(names::fromEpochMilliseconds, from_epoch_milliseconds, 1),
    function(names::fromEpochNanoseconds, from_epoch_nanoseconds, 1),
    function(names::compare, compare::<Instant>, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::until, until::<Instant>, 1),
    function(names::since, since::<Instant>, 1),
    function(names::round, round, 1),
    function(names::equals, equals::<Instant>, 1),
    function(names::toZonedDateTimeISO, to_zoned_date_time_iso, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<Instant>, 0),
    function(names::valueOf, value_of::<Instant>, 0),
    getter(names::epochMilliseconds, epoch_milliseconds),
    getter(names::epochNanoseconds, epoch_nanoseconds),
    StaticProperty::string(symbols::toStringTag, names::temporalInstant),
]);

define_class!(
    Instant, "Temporal.Instant", length 1, InstantValueOf,
    temporal_instant_shape, init_temporal_instant_shape, init_temporal_instant_constructor
);

/// ToTemporalInstant
pub fn to_temporal_instant(cx: &mut Cx, item: Value) -> JsResult<Instant> {
    if let Some(instant) = Instant::of_value(item) {
        return Ok(instant);
    }
    if let Some(zoned) = ZonedDateTime::of_value(item) {
        return Ok(zoned.instant());
    }
    let primitive = item.to_primitive(cx, PreferredType::String)?;
    let string = require_string(cx, primitive, Error::NotConvertibleToInstant)?;
    Instant::parse(string.text()).or_throw(cx)
}

/// For the time value of a `Date`.
pub fn instant_from_epoch_milliseconds(cx: &Cx, milliseconds: i64) -> Gc<JsObject> {
    Instant::clamped(i128::from(milliseconds) * 1_000_000).to_object(cx)
}

impl FromItem for Instant {
    #[inline]
    fn from_item(cx: &mut Cx, item: Value, _: Value) -> JsResult<Instant> {
        to_temporal_instant(cx, item)
    }
}

impl Compare for Instant {
    fn compare(&self, other: &Instant) -> Ordering {
        self.cmp(other)
    }
}

impl Difference for Instant {
    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &Instant,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        self.difference(operation, *other, options)
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    to_epoch_nanoseconds(cx, frame.argument(0), TextError::InstantEpochNanoseconds)?
        .constructed(cx, frame)
}

#[native_abi]
fn from_epoch_milliseconds(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let milliseconds = frame.argument(0).to_number(cx)?;
    (Instant::from_epoch_milliseconds(milliseconds).or_throw(cx)?).returned(cx)
}

#[native_abi]
fn from_epoch_nanoseconds(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    to_epoch_nanoseconds(cx, frame.argument(0), TextError::InstantEpochNanoseconds)?.returned(cx)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration(cx, frame, names::add, Instant::add)
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration(cx, frame, names::subtract, Instant::subtract)
}

#[native_abi]
fn round(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Instant::this(cx, frame.this_value(), names::round)?;
    let options = round_argument(cx, frame.argument(0), Error::InstantRoundWithoutOptions)?;
    this.round(options).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn to_zoned_date_time_iso(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Instant::this(cx, frame.this_value(), names::toZonedDateTimeISO)?;
    let time_zone = to_time_zone(cx, frame.argument(0))?;
    ZonedDateTime::new(this, time_zone, CalendarId::Iso8601).returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Instant::this(cx, frame.this_value(), names::toString)?;
    let options = Options::new(cx, frame.argument(0))?;
    let precision = options.precision(cx)?;
    let time_zone = options.get(cx, names::timeZone)?;
    let precision = Instant::precision(precision).or_throw(cx)?;
    let time_zone = time_zone.map(|it| to_time_zone(cx, it)).transpose()?;
    text_value(cx, &this.to_text(time_zone, precision))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Instant::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(None, Precision::AUTO))
}

#[native_abi]
fn epoch_milliseconds(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    Ok(Instant::this(cx, this, name)?.epoch_milliseconds().into())
}

#[native_abi]
fn epoch_nanoseconds(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let nanoseconds = Instant::this(cx, this, name)?.epoch_nanoseconds();
    Ok(JsBigInt::from_small(cx, nanoseconds).into())
}
