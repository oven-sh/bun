use super::prelude::*;
use crate::display_names::{DisplayNames, Options, Type};

#[cell(name = "Object")]
struct JsDisplayNames {
    base: JsDestructibleObject,
    names: DisplayNames,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::of, of, 1),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlDisplayNames),
]);

define_class!(
    DisplayNames: JsDisplayNames, "Intl.DisplayNames", length 2, GENERAL_CONSTRUCTOR_PROPERTIES,
    init_display_names_constructor, init_display_names_shape
);

define_throwing_call!("DisplayNames");

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::display_names_shape)?;
    let requested = canonicalize_locale_list(cx, frame.argument(0))?;
    let options = OptionBag::require(cx, frame.argument(1))?;
    options.check_locale_matcher(cx)?;
    let options = Options {
        style: options.value_or_default(cx, names::style)?,
        kind: Type::required(options.value(cx, names::r#type)?).or_throw(cx)?,
        fallback: options.value_or_default(cx, names::fallback)?,
        language_display: options.value_or_default(cx, names::languageDisplay)?,
    };
    let names = with_cache(cx, |cache| DisplayNames::new(cache, &requested, options))?;
    let base = JsObjectInit::new(cx, shape);
    let object = cx.allocate::<JsDisplayNames>(JsDisplayNamesInit { base, names });
    Ok(object.into())
}

#[native_abi]
fn of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDisplayNames> = this!(cx, frame.this_value(), "DisplayNames", "of")?;
    let code = frame.argument(0).to_string_view(cx)?;
    let name = with_cache(cx, |cache| this.names.of(cache, code.text()))?;
    Ok(name.map_or(Value::UNDEFINED, |name| JsString::new(cx, name).into()))
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsDisplayNames> =
        this!(cx, frame.this_value(), "DisplayNames", "resolvedOptions")?;
    let resolved = *this.names.options();
    let options = Record::with_locale(cx, this.names.locale().string().clone());
    options.put_named(names::style, resolved.style);
    options.put_named(names::r#type, resolved.kind);
    options.put_named(names::fallback, resolved.fallback);
    if resolved.kind == Type::Language {
        options.put_named(names::languageDisplay, resolved.language_display);
    }
    Ok(options.finish())
}
