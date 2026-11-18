use super::prelude::*;
use crate::relative_time_format::RelativeTimeFormat;

#[cell(name = "Object")]
struct JsRelativeTimeFormat {
    base: JsDestructibleObject,
    format: RelativeTimeFormat,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::format, format, 2),
    StaticProperty::function(names::formatToParts, format_to_parts, 2),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlRelativeTimeFormat),
]);

define_class!(
    RelativeTimeFormat: JsRelativeTimeFormat, "Intl.RelativeTimeFormat", length 0,
    GENERAL_CONSTRUCTOR_PROPERTIES,
    init_relative_time_format_constructor, init_relative_time_format_shape
);

define_throwing_call!("RelativeTimeFormat");

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let base = GlobalObject::relative_time_format_shape;
    let shape = cx.shape_from_new_target(new_target, &callee, base)?;
    let requested = canonicalize_locale_list(cx, frame.argument(0))?;
    let options = OptionBag::coerce(cx, frame.argument(1))?;
    options.check_locale_matcher(cx)?;
    let numbering_system = options.numbering_system(cx)?;
    let style = options.value_or_default(cx, names::style)?;
    let numeric = options.value_or_default(cx, names::numeric)?;
    let format = with_cache(cx, |cache| {
        RelativeTimeFormat::new(cache, &requested, numbering_system.as_ref(), style, numeric)
    })?;
    let base = JsObjectInit::new(cx, shape);
    let object = cx.allocate::<JsRelativeTimeFormat>(JsRelativeTimeFormatInit { base, format });
    Ok(object.into())
}

#[native_abi]
fn format(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsRelativeTimeFormat> =
        this!(cx, frame.this_value(), "RelativeTimeFormat", "format")?;
    let value = frame.argument(0).to_number(cx)?;
    let unit = frame.argument(1).to_string_view(cx)?;
    let formatted = this.format.format(value, unit.text()).or_throw(cx)?;
    Ok(JsString::new(cx, formatted).into())
}

#[native_abi]
fn format_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsRelativeTimeFormat> = this!(
        cx,
        frame.this_value(),
        "RelativeTimeFormat",
        "formatToParts"
    )?;
    let value = frame.argument(0).to_number(cx)?;
    let unit = frame.argument(1).to_string_view(cx)?;
    let parts = this.format.format_to_parts(value, unit.text());
    parts_to_array(cx, &parts.or_throw(cx)?)
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsRelativeTimeFormat> = this!(
        cx,
        frame.this_value(),
        "RelativeTimeFormat",
        "resolvedOptions"
    )?;
    let (style, numeric) = (this.format.style(), this.format.numeric());
    let numbering_system = this.format.numbering_system().or_throw(cx)?;
    let options = Record::with_locale(cx, this.format.locale().string().clone());
    options.put_named(names::style, style);
    options.put_named(names::numeric, numeric);
    options.put_string(names::numberingSystem, numbering_system.to_string_ref());
    Ok(options.finish())
}
