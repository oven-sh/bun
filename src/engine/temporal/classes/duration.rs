use super::arguments::{require_object, require_string, small_integers, text_value};
use super::fields::read_own_fields;
use super::methods::{add_duration, to_locale_string, value_of};
use super::options::round_argument;
use super::prelude::*;
use crate::{
    Duration, DurationRoundOptions, FieldSet, PartialDuration, Precision, RelativeTo,
    TemporalValue, Unit,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from, 1),
    function(names::compare, compare, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::with, with, 1),
    function(names::negated, negated, 0),
    function(names::abs, abs, 0),
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::round, round, 1),
    function(names::total, total, 1),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<Duration>, 0),
    function(names::valueOf, value_of::<Duration>, 0),
    getter(names::years, count::<{ Unit::Year as usize }>),
    getter(names::months, count::<{ Unit::Month as usize }>),
    getter(names::weeks, count::<{ Unit::Week as usize }>),
    getter(names::days, count::<{ Unit::Day as usize }>),
    getter(names::hours, count::<{ Unit::Hour as usize }>),
    getter(names::minutes, count::<{ Unit::Minute as usize }>),
    getter(names::seconds, count::<{ Unit::Second as usize }>),
    getter(names::milliseconds, count::<{ Unit::Millisecond as usize }>),
    getter(names::microseconds, count::<{ Unit::Microsecond as usize }>),
    getter(names::nanoseconds, count::<{ Unit::Nanosecond as usize }>),
    getter(names::sign, sign),
    getter(names::blank, blank),
    StaticProperty::string(symbols::toStringTag, names::temporalDuration),
]);

define_class!(
    Duration, "Temporal.Duration", length 0, DurationValueOf,
    temporal_duration_shape, init_temporal_duration_shape, init_temporal_duration_constructor
);

#[inline(always)]
fn set_field(cx: &mut Cx, fields: &mut PartialDuration, unit: Unit, value: Value) -> JsResult<()> {
    if let Some(integer) = value.as_int32() {
        return fields.set(unit, integer.into()).or_throw(cx);
    }
    if value.is_undefined() {
        return Ok(());
    }
    fields.set(unit, value.to_number(cx)?).or_throw(cx)
}

/// ToTemporalPartialDurationRecord
fn read_fields(cx: &mut Cx, item: &JsObject, fields: &mut PartialDuration) -> JsResult<()> {
    for (unit, property) in PartialDuration::PROPERTIES {
        let value = get(cx, item, property)?;
        set_field(cx, fields, unit, value)?;
    }
    Ok(())
}

/// ToTemporalDuration
pub fn to_temporal_duration(cx: &mut Cx, item: Value) -> JsResult<Duration> {
    with_duration(cx, item, |_, duration| Ok(*duration))
}

/// ToTemporalDuration, without a copy of the result.
#[inline(always)]
pub(super) fn with_duration<T>(
    cx: &mut Cx,
    item: Value,
    then: impl FnOnce(&mut Cx, &Duration) -> JsResult<T>,
) -> JsResult<T> {
    let (instance, mut fields) = (item.downcast::<Object>(), PartialDuration::default());
    let duration = match &instance {
        Some(instance) => &instance.value,
        None => convert(cx, item, &mut fields)?,
    };
    then(cx, duration)
}

fn convert<'a>(
    cx: &mut Cx,
    item: Value,
    fields: &'a mut PartialDuration,
) -> JsResult<&'a Duration> {
    if let Some(object) = item.as_object() {
        read_fields(cx, &object, fields)?;
        return fields.finish_some().or_throw(cx);
    }
    let string = require_string(cx, item, Error::NotConvertibleToDuration)?;
    fields.parse(string.text()).or_throw(cx)
}

/// GetTemporalRelativeToOption
fn relative_to_option(cx: &mut Cx, options: Options) -> JsResult<Option<RelativeTo>> {
    let Some(value) = options.get(cx, names::relativeTo)? else {
        return Ok(None);
    };
    let Some(object) = value.as_object() else {
        let string = require_string(cx, value, Error::NotConvertibleToRelativeTo)?;
        return RelativeTo::parse(string.text()).or_throw(cx).map(Some);
    };
    Ok(Some(match TemporalValue::of(&object) {
        Some(TemporalValue::ZonedDateTime(zoned)) => RelativeTo::Zoned(zoned),
        Some(TemporalValue::PlainDate(date)) => RelativeTo::Plain(date),
        Some(TemporalValue::PlainDateTime(value)) => RelativeTo::Plain(value.to_plain_date()),
        _ => {
            let fields = read_own_fields(cx, &object, FieldSet::RelativeTo)?;
            RelativeTo::from_fields(&fields).or_throw(cx)?
        }
    }))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let Some(fields) = small_integers(frame) {
        return (Duration::from_small_integers(fields).or_throw(cx)?).constructed(cx, frame);
    }
    let mut fields = PartialDuration::default();
    for unit in Unit::ALL {
        set_field(cx, &mut fields, unit, frame.argument(unit as usize))?;
    }
    fields.finish().or_throw(cx)?.constructed(cx, frame)
}

#[native_abi]
fn from(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    with_duration(cx, frame.argument(0), |cx, duration| duration.returned(cx))
}

#[native_abi]
fn compare(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let one = to_temporal_duration(cx, frame.argument(0))?;
    let two = to_temporal_duration(cx, frame.argument(1))?;
    let options = Options::new(cx, frame.argument(2))?;
    let relative_to = relative_to_option(cx, options)?;
    let order = one.compare(&two, relative_to.as_ref()).or_throw(cx)?;
    Ok((order as i32).into())
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::with)?;
    let item = require_object(cx, frame.argument(0), Error::DurationWithNotObject)?;
    let mut fields = PartialDuration::over(&this);
    read_fields(cx, &item, &mut fields)?;
    fields.finish_some().or_throw(cx)?.returned(cx)
}

#[native_abi]
fn negated(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::negated)?;
    this.negated().returned(cx)
}

#[native_abi]
fn abs(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::abs)?;
    this.abs().returned(cx)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration(cx, frame, names::add, |this: Duration, other| {
        this.add(other)
    })
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration(cx, frame, names::subtract, |this: Duration, other| {
        this.subtract(other)
    })
}

#[native_abi]
fn round(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::round)?;
    let options = match frame.argument(0).as_object().map(Options::from) {
        Some(options) => DurationRoundOptions {
            largest_unit: options.unit(cx, names::largestUnit)?,
            relative_to: relative_to_option(cx, options)?,
            rounding: options.round(cx)?,
        },
        None => DurationRoundOptions {
            rounding: round_argument(cx, frame.argument(0), Error::DurationRoundWithoutOptions)?,
            ..DurationRoundOptions::default()
        },
    };
    this.round(&options).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn total(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::total)?;
    let argument = frame.argument(0);
    if argument.is_undefined() {
        return Err(throw(cx, Error::DurationTotalWithoutOptions));
    }
    if let Some(unit) = argument.as_string() {
        let unit = Duration::total_unit(unit.view(cx)?.text()).or_throw(cx)?;
        return Ok(this.total(unit, None).or_throw(cx)?.into());
    }
    let options = Options::new(cx, argument)?;
    let relative_to = relative_to_option(cx, options)?;
    let unit = get(cx, &argument.cast::<JsObject>(), names::unit)?.to_string_view(cx)?;
    let unit = Duration::total_unit(unit.text()).or_throw(cx)?;
    Ok(this.total(unit, relative_to.as_ref()).or_throw(cx)?.into())
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::toString)?;
    let options = Options::new(cx, frame.argument(0))?.precision(cx)?;
    let precision = Duration::precision(options).or_throw(cx)?;
    let rounded = this.round_for_text(precision).or_throw(cx)?;
    text_value(cx, &rounded.to_text(precision))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = Duration::this(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(Precision::AUTO))
}

#[native_abi]
fn count<const UNIT: usize>(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    Ok(Duration::this(cx, this, name)?.get(Unit::ALL[UNIT]).into())
}

#[native_abi]
fn sign(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    Ok(i32::from(Duration::this(cx, this, name)?.sign()).into())
}

#[native_abi]
fn blank(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    Ok((Duration::this(cx, this, name)?.sign() == 0).into())
}
