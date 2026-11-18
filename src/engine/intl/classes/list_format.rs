use bun_engine_text::StringRef;
use bun_engine_vm::for_each_in_iterable;

use super::prelude::*;
use super::results::{part_to_object, values_to_array};
use crate::list_format::ListFormat;

#[cell(name = "Object")]
struct JsListFormat {
    base: JsDestructibleObject,
    format: ListFormat,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::format, format, 1),
    StaticProperty::function(names::formatToParts, format_to_parts, 1),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlListFormat),
]);

define_class!(
    ListFormat: JsListFormat, "Intl.ListFormat", length 0, GENERAL_CONSTRUCTOR_PROPERTIES,
    init_list_format_constructor, init_list_format_shape
);

define_throwing_call!("ListFormat");

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::list_format_shape)?;
    let requested = canonicalize_locale_list(cx, frame.argument(0))?;
    let options = OptionBag::require(cx, frame.argument(1))?;
    options.check_locale_matcher(cx)?;
    let kind = options.value_or_default(cx, names::r#type)?;
    let style = options.value_or_default(cx, names::style)?;
    let format = with_cache(cx, |cache| ListFormat::new(cache, &requested, kind, style))?;
    let base = JsObjectInit::new(cx, shape);
    let object = cx.allocate::<JsListFormat>(JsListFormatInit { base, format });
    Ok(object.into())
}

/// StringListFromIterable
fn string_list_from_iterable(cx: &mut Cx, iterable: Value) -> JsResult<Vec<StringRef>> {
    let mut list = Vec::new();
    if iterable.is_undefined() {
        return Ok(list);
    }
    for_each_in_iterable(cx, iterable, |cx, value| {
        let Some(string) = value.as_string() else {
            return Err(cx.throw_type_error("Iterable passed to ListFormat includes non String"));
        };
        list.try_reserve(1).map_err(|_| cx.throw_out_of_memory())?;
        list.push(string.to_string_ref(cx)?);
        Ok(())
    })?;
    Ok(list)
}

#[native_abi]
fn format(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsListFormat> = this!(cx, frame.this_value(), "ListFormat", "format")?;
    let list = string_list_from_iterable(cx, frame.argument(0))?;
    Ok(JsString::new(cx, this.format.format(&list).or_throw(cx)?).into())
}

#[native_abi]
fn format_to_parts(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsListFormat> = this!(cx, frame.this_value(), "ListFormat", "formatToParts")?;
    let list = string_list_from_iterable(cx, frame.argument(0))?;
    let format = this.format.clone();
    let parts = format.format_to_parts(&list).or_throw(cx)?;
    let parts = parts.iter().map(|(kind, value)| {
        let value = JsString::new(cx, value.clone());
        Ok(part_to_object(cx, kind.into(), value.into()))
    });
    values_to_array(cx, parts)
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsListFormat> = this!(cx, frame.this_value(), "ListFormat", "resolvedOptions")?;
    let (kind, style) = (this.format.kind(), this.format.style());
    let options = Record::with_locale(cx, this.format.locale().string().clone());
    options.put_named(names::r#type, kind);
    options.put_named(names::style, style);
    Ok(options.finish())
}
