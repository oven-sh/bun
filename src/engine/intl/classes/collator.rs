use core::cmp::Ordering;

use super::locales::supported_locales;
use super::prelude::*;
use crate::collator::{Collator, Options};
use crate::{AvailableLocales, KeywordValue};

#[cell(name = "Object")]
struct JsCollator {
    base: JsDestructibleObject,
    collator: Collator,
    pub(self) bound_compare: Field<Option<Gc<JsObject>>>,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    getter(names::compare, get_compare),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlCollator),
]);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::function(names::supportedLocalesOf, supported_locales_of, 1),
]);

define_class!(
    Collator: JsCollator, "Intl.Collator", length 0, CONSTRUCTOR_PROPERTIES,
    init_collator_constructor, init_collator_shape
);

fn new_collator(cx: &mut Cx, locales: Value, options: Value) -> JsResult<Collator> {
    let requested = canonicalize_locale_list(cx, locales)?;
    let options = OptionBag::coerce(cx, options)?;
    let usage = options.value_or_default(cx, names::usage)?;
    options.check_locale_matcher(cx)?;
    let options = Options {
        usage,
        collation: options.parse(cx, names::collation, KeywordValue::collation)?,
        numeric: options.boolean(cx, names::numeric)?,
        case_first: options.value(cx, names::caseFirst)?,
        sensitivity: options.value_or_default(cx, names::sensitivity)?,
        ignore_punctuation: options.boolean(cx, names::ignorePunctuation)?,
    };
    with_cache(cx, |cache| Collator::new(cache, &requested, &options))
}

fn create(cx: &mut Cx, shape: Gc<Shape>, frame: &CallFrame) -> JsResult<Value> {
    let collator = new_collator(cx, frame.argument(0), frame.argument(1))?;
    let object = cx.allocate::<JsCollator>(JsCollatorInit {
        base: JsObjectInit::new(cx, shape),
        collator,
        bound_compare: None,
    });
    Ok(object.into())
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = cx.collator_shape();
    create(cx, shape, frame)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::collator_shape)?;
    create(cx, shape, frame)
}

#[native_abi]
fn supported_locales_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    supported_locales(cx, frame, AvailableLocales::collator())
}

#[native_abi]
fn get_compare(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let this: Gc<JsCollator> = this!(cx, this, "Collator", "compare")?;
    if let Some(bound) = this.bound_compare() {
        return Ok(bound.into());
    }
    let bound = bind_method(cx, this.upcast(), names::compare, 2, compare)?;
    this.set_bound_compare(Some(bound));
    Ok(bound.into())
}

#[native_abi]
fn compare(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsCollator> = this!(cx, frame.this_value(), "Collator", "compare")?;
    let a = frame.argument(0).to_string(cx)?;
    let b = frame.argument(1).to_string(cx)?;
    let (a, b) = (a.view(cx)?, b.view(cx)?);
    let order = this.collator.compare(a.text(), b.text()).or_throw(cx)?;
    Ok(Value::int32(order as i32))
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsCollator> = this!(cx, frame.this_value(), "Collator", "resolvedOptions")?;
    let collator = this.collator.clone();
    let options = Record::with_locale(cx, collator.locale().string().clone());
    options.put_named(names::usage, collator.usage());
    options.put_named(names::sensitivity, collator.sensitivity());
    options.put(names::ignorePunctuation, collator.ignores_punctuation());
    options.put_string(names::collation, collator.collation());
    options.put(names::numeric, collator.is_numeric());
    options.put_named(names::caseFirst, collator.case_first());
    Ok(options.finish())
}

/// `String.prototype.localeCompare`, after the conversions to strings.
#[inline]
pub fn locale_compare(
    cx: &mut Cx,
    a: Gc<JsString>,
    b: Gc<JsString>,
    locales: Value,
    options: Value,
) -> JsResult<Value> {
    let order = if options.is_undefined() && (locales.is_undefined() || locales.is_string()) {
        compare_in_locale(cx, a, b, locales.as_string())?
    } else {
        let collator = new_collator(cx, locales, options)?;
        let (a, b) = (a.view(cx)?, b.view(cx)?);
        collator.compare(a.text(), b.text()).or_throw(cx)?
    };
    Ok(Value::int32(order as i32))
}

/// The same without options, in the locale with that name or the default one.
#[inline]
pub fn compare_in_locale(
    cx: &Cx,
    a: Gc<JsString>,
    b: Gc<JsString>,
    locale: Option<Gc<JsString>>,
) -> JsResult<Ordering> {
    let locale = locale.map(|it| it.resolve(cx)).transpose()?;
    let (a, b) = (a.view(cx)?, b.view(cx)?);
    with_cache(cx, |cache| {
        Collator::compare_by_default(cache, locale.as_deref(), a.text(), b.text())
    })
}
