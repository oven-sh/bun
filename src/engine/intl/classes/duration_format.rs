use bun_engine_temporal::{Duration, Unit, to_temporal_duration};

use super::prelude::*;
use crate::duration_format::{
    DurationFormat, FractionalDigits, Options, UnitStyle, Units, properties,
};

#[cell(name = "Object")]
struct JsDurationFormat {
    base: JsDestructibleObject,
    format: DurationFormat,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::format, format, 1),
    StaticProperty::function(names::formatToParts, format_to_parts, 1),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlDurationFormat),
]);

define_class!(
    DurationFormat: JsDurationFormat, "Intl.DurationFormat", length 0,
    GENERAL_CONSTRUCTOR_PROPERTIES,
    init_duration_format_constructor, init_duration_format_shape
);

define_throwing_call!("DurationFormat");

pub(super) fn new_duration_format(
    cx: &mut Cx,
    locales: Value,
    options: Value,
) -> JsResult<DurationFormat> {
    let requested = canonicalize_locale_list(cx, locales)?;
    let bag = OptionBag::require(cx, options)?;
    bag.check_locale_matcher(cx)?;
    let numbering_system = bag.numbering_system(cx)?;
    let mut units = Units::new(bag.value_or_default(cx, names::style)?);
    for unit in Unit::ALL {
        let [style, display] = properties(unit);
        let style = bag.parse(cx, style, |it| UnitStyle::parse(unit, it))?;
        let display = bag.value(cx, display)?;
        units.set(unit, style, display).or_throw(cx)?;
    }
    let options = Options {
        numbering_system,
        units,
        fractional_digits: bag.number(cx, names::fractionalDigits, FractionalDigits::new)?,
    };
    with_cache(cx, |cache| DurationFormat::new(cache, &requested, &options))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let base = GlobalObject::duration_format_shape;
    let shape = cx.shape_from_new_target(new_target, &callee, base)?;
    let format = new_duration_format(cx, frame.argument(0), frame.argument(1))?;
    let base = JsObjectInit::new(cx, shape);
    let object = cx.allocate::<JsDurationFormat>(JsDurationFormatInit { base, format });
    Ok(object.into())
}

fn to_duration(cx: &mut Cx, value: Value, wrong_type: &'static str) -> JsResult<Duration> {
    if !value.is_object() && !value.is_string() {
        return Err(cx.throw_type_error(wrong_type));
    }
    to_temporal_duration(cx, value)
}

#[native_abi]
fn format(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDurationFormat> = this!(cx, frame.this_value(), "DurationFormat", "format")?;
    let duration = to_duration(
        cx,
        frame.argument(0),
        "Intl.DurationFormat.prototype.format argument needs to be an object or a string",
    )?;
    Ok(JsString::new(cx, this.format.format(&duration).or_throw(cx)?).into())
}

#[native_abi]
fn format_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDurationFormat> =
        this!(cx, frame.this_value(), "DurationFormat", "formatToParts")?;
    let duration = to_duration(
        cx,
        frame.argument(0),
        "Intl.DurationFormat.prototype.formatToParts argument needs to be an object or a string",
    )?;
    parts_to_array(cx, &this.format.format_to_parts(&duration).or_throw(cx)?)
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDurationFormat> =
        this!(cx, frame.this_value(), "DurationFormat", "resolvedOptions")?;
    let resolved = this.anchor().format.resolved_options().or_throw(cx)?;

    let options = Record::with_locale(cx, resolved.locale.string().clone());
    let numbering_system = resolved.numbering_system.to_string_ref();
    options.put_string(names::numberingSystem, numbering_system);
    options.put_named(names::style, resolved.units.style());
    for unit in Unit::ALL {
        let [style, display] = properties(unit);
        options.put_named(style, resolved.units.get(unit).style);
        options.put_named(display, resolved.units.get(unit).display);
    }
    if let Some(digits) = resolved.fractional_digits {
        options.put(names::fractionalDigits, Value::int32(digits.get().into()));
    }
    Ok(options.finish())
}
