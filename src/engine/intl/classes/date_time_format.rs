use bun_engine_date::TimeZone;
use bun_engine_temporal::TemporalValue;
use bun_engine_text::{StringRef, Text};

use super::legacy;
use super::prelude::*;
use crate::date_time_format::{
    Component, ComponentValue, DateTimeFormat, DateTimeValue, FormatMatcher, Options, Purpose,
    Style, parse_time_zone,
};
use crate::{Cache, KeywordValue};

#[cell(name = "Object")]
struct JsDateTimeFormat {
    base: JsDestructibleObject,
    format: DateTimeFormat,
    pub(self) bound_format: Field<Option<Gc<JsObject>>>,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    getter(names::format, get_format),
    StaticProperty::function(names::formatRange, format_range, 2),
    StaticProperty::function(names::formatRangeToParts, format_range_to_parts, 2),
    StaticProperty::function(names::formatToParts, format_to_parts, 1),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlDateTimeFormat),
]);

define_class!(
    DateTimeFormat: JsDateTimeFormat, "Intl.DateTimeFormat", length 0,
    GENERAL_CONSTRUCTOR_PROPERTIES,
    init_date_time_format_constructor, init_date_time_format_shape
);

fn system_time_zone(cx: &Cx) -> TimeZone {
    TimeZone::Named(cx.date_cache().time_zone())
}

fn read_time_zone(cx: &mut Cx, bag: OptionBag, fixed: Option<TimeZone>) -> JsResult<TimeZone> {
    let Some(fixed) = fixed else {
        let requested = bag.parse(cx, names::timeZone, parse_time_zone)?;
        return Ok(requested.unwrap_or_else(|| system_time_zone(cx)));
    };
    if bag.get(cx, names::timeZone)?.is_some() {
        return Err(cx.throw_type_error(
            "ZonedDateTime.toLocaleString does not accept a timeZone option; the ZonedDateTime's time zone is used",
        ));
    }
    Ok(fixed)
}

fn read_options(
    cx: &mut Cx,
    bag: OptionBag,
    fixed_time_zone: Option<TimeZone>,
) -> JsResult<(Options, TimeZone)> {
    bag.check_locale_matcher(cx)?;
    let mut options = Options {
        calendar: bag.parse(cx, names::calendar, KeywordValue::calendar)?,
        numbering_system: bag.numbering_system(cx)?,
        hour12: bag.boolean(cx, names::hour12)?,
        hour_cycle: bag.value(cx, names::hourCycle)?,
        ..Options::default()
    };
    let time_zone = read_time_zone(cx, bag, fixed_time_zone)?;
    for component in Component::ALL {
        let (name, components) = (component.property(), &mut options.components);
        if component == Component::FractionalSecondDigits {
            bag.number(cx, name, |it| components.set_fractional_second_digits(it))?;
        } else {
            bag.parse(cx, name, |it| components.set_style(component, it))?;
        }
    }
    bag.value::<FormatMatcher>(cx, names::formatMatcher)?;
    options.date_style = bag.parse(cx, names::dateStyle, Style::parse_date_style)?;
    options.time_style = bag.parse(cx, names::timeStyle, Style::parse_time_style)?;
    Ok((options, time_zone))
}

/// CreateDateTimeFormat. `fixed_time_zone` is `toLocaleStringTimeZone`.
pub(super) fn new_date_time_format(
    cx: &mut Cx,
    locales: Value,
    options: Value,
    purpose: Purpose,
    fixed_time_zone: Option<TimeZone>,
) -> JsResult<DateTimeFormat> {
    let requested = canonicalize_locale_list(cx, locales)?;
    let (options, time_zone) = if options.is_undefined() {
        let time_zone = fixed_time_zone.unwrap_or_else(|| system_time_zone(cx));
        (Options::default(), time_zone)
    } else {
        read_options(cx, OptionBag::coerce(cx, options)?, fixed_time_zone)?
    };
    with_cache(cx, |cache| {
        DateTimeFormat::new(cache, &requested, &options, time_zone, purpose)
    })
}

/// ToDateTimeFormattable
#[inline(always)]
fn to_date_time_value(cx: &mut Cx, value: Value) -> JsResult<DateTimeValue> {
    let temporal = value.as_object().and_then(|it| TemporalValue::of(&it));
    match temporal.as_ref().and_then(DateTimeValue::from_temporal) {
        Some(value) => Ok(value),
        None => value.to_number(cx).map(DateTimeValue::Number),
    }
}

#[inline(always)]
fn to_date_time_value_or_now(cx: &mut Cx, value: Value) -> JsResult<DateTimeValue> {
    if value.is_undefined() {
        return Ok(DateTimeValue::Number(cx.global().date_now()));
    }
    to_date_time_value(cx, value)
}

fn to_range(cx: &mut Cx, frame: &CallFrame) -> JsResult<[DateTimeValue; 2]> {
    let (start, end) = (frame.argument(0), frame.argument(1));
    if start.is_undefined() || end.is_undefined() {
        return Err(cx.throw_type_error("startDate or endDate is undefined"));
    }
    Ok([to_date_time_value(cx, start)?, to_date_time_value(cx, end)?])
}

fn create(cx: &mut Cx, shape: Gc<Shape>, frame: &CallFrame) -> JsResult<Value> {
    let (locales, options) = (frame.argument(0), frame.argument(1));
    let format = new_date_time_format(cx, locales, options, Purpose::Constructor, None)?;
    let object = cx.allocate::<JsDateTimeFormat>(JsDateTimeFormatInit {
        base: JsObjectInit::new(cx, shape),
        format,
        bound_format: None,
    });
    Ok(object.into())
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = cx.date_time_format_shape();
    let instance = create(cx, shape, frame)?;
    legacy::chain(cx, frame, instance)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let base = GlobalObject::date_time_format_shape;
    let shape = cx.shape_from_new_target(new_target, &callee, base)?;
    create(cx, shape, frame)
}

#[native_abi]
fn get_format(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let this = legacy::unwrap::<JsDateTimeFormat>(cx, this, Cx::date_time_format_constructor)?;
    let this: Gc<JsDateTimeFormat> = this!(cx, this, "DateTimeFormat", "format")?;
    if let Some(bound) = this.bound_format() {
        return Ok(bound.into());
    }
    let bound = bind_method(cx, this.upcast(), names::format, 1, format)?;
    this.set_bound_format(Some(bound));
    Ok(bound.into())
}

pub(super) fn string(
    cx: &Cx,
    format: impl FnOnce(&Cache) -> crate::Result<StringRef>,
) -> JsResult<Value> {
    Ok(JsString::new(cx, with_cache(cx, format)?).into())
}

#[native_abi]
fn format(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDateTimeFormat> = this!(cx, frame.this_value(), "DateTimeFormat", "format")?;
    let value = to_date_time_value_or_now(cx, frame.argument(0))?;
    string(cx, |cache| this.format.format(cache, value))
}

#[native_abi]
fn format_range(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDateTimeFormat> =
        this!(cx, frame.this_value(), "DateTimeFormat", "formatRange")?;
    let [start, end] = to_range(cx, frame)?;
    string(cx, |cache| this.format.format_range(cache, start, end))
}

#[native_abi]
fn format_range_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDateTimeFormat> = this!(
        cx,
        frame.this_value(),
        "DateTimeFormat",
        "formatRangeToParts"
    )?;
    let [start, end] = to_range(cx, frame)?;
    let parts = with_cache(cx, |cache| {
        this.format.format_range_to_parts(cache, start, end)
    })?;
    parts_to_array(cx, &parts)
}

#[native_abi]
fn format_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDateTimeFormat> =
        this!(cx, frame.this_value(), "DateTimeFormat", "formatToParts")?;
    let value = to_date_time_value_or_now(cx, frame.argument(0))?;
    let parts = with_cache(cx, |cache| this.format.format_to_parts(cache, value))?;
    parts_to_array(cx, &parts)
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    let this = legacy::unwrap::<JsDateTimeFormat>(cx, this, Cx::date_time_format_constructor)?;
    let this: Gc<JsDateTimeFormat> = this!(cx, this, "DateTimeFormat", "resolvedOptions")?;
    let resolved = this.anchor().format.resolved_options().or_throw(cx)?;

    let options = Record::with_locale(cx, resolved.locale.string().clone());
    let calendar = StringRef::from_literal(resolved.calendar.identifier());
    options.put_string(names::calendar, calendar);
    let numbering_system = resolved.numbering_system.to_string_ref();
    options.put_string(names::numberingSystem, numbering_system);
    let time_zone = resolved.time_zone.identifier();
    let time_zone = JsString::from_text(cx, Text::from_ascii(&time_zone));
    options.put(names::timeZone, time_zone);
    if let Some(cycle) = resolved.hour_cycle {
        options.put_named(names::hourCycle, cycle);
        options.put(names::hour12, cycle.is_twelve_hour());
    }
    for (component, value) in resolved.components.iter() {
        match value {
            ComponentValue::Style(style) => options.put_named(component.property(), style),
            ComponentValue::Digits(count) => {
                options.put(component.property(), Value::int32(count.into()));
            }
        }
    }
    if let Some(style) = resolved.date_style {
        options.put_named(names::dateStyle, style);
    }
    if let Some(style) = resolved.time_style {
        options.put_named(names::timeStyle, style);
    }
    Ok(options.finish())
}

/// `toLocaleString`, `toLocaleDateString` and `toLocaleTimeString` of a `Date` whose time value is not NaN.
pub fn date_to_locale_string(
    cx: &mut Cx,
    time: f64,
    purpose: Purpose,
    locales: Value,
    options: Value,
) -> JsResult<Value> {
    let format = new_date_time_format(cx, locales, options, purpose, None)?;
    string(cx, |cache| {
        format.format(cache, DateTimeValue::Number(time))
    })
}
