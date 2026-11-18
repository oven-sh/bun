use super::number_format::{
    put_digit_counts, put_rounding, read_digits, to_mathematical_value, to_range,
};
use super::prelude::*;
use super::results::values_to_array;
use crate::number_format::Notation;
use crate::plural_rules::{Options, PluralRules, resolve_digits};

#[cell(name = "Object")]
struct JsPluralRules {
    base: JsDestructibleObject,
    rules: PluralRules,
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::select, select, 1),
    StaticProperty::function(names::selectRange, select_range, 2),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlPluralRules),
]);

define_class!(
    PluralRules: JsPluralRules, "Intl.PluralRules", length 0, GENERAL_CONSTRUCTOR_PROPERTIES,
    init_plural_rules_constructor, init_plural_rules_shape
);

define_throwing_call!("PluralRules");

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::plural_rules_shape)?;
    let requested = canonicalize_locale_list(cx, frame.argument(0))?;
    let options = OptionBag::coerce(cx, frame.argument(1))?;
    options.check_locale_matcher(cx)?;
    let kind = options.value_or_default(cx, names::r#type)?;
    let notation = options.value_or_default(cx, names::notation)?;
    let options = Options {
        kind,
        notation,
        compact_display: options.value_or_default(cx, names::compactDisplay)?,
        digits: read_digits(cx, options, |digits, to_number| {
            resolve_digits(digits, notation, to_number)
        })?,
    };
    let rules = with_cache(cx, |cache| PluralRules::new(cache, &requested, options))?;
    let base = JsObjectInit::new(cx, shape);
    let object = cx.allocate::<JsPluralRules>(JsPluralRulesInit { base, rules });
    Ok(object.into())
}

#[native_abi]
fn select(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsPluralRules> = this!(cx, frame.this_value(), "PluralRules", "select")?;
    let value = to_mathematical_value(cx, frame.argument(0))?;
    Ok(named(cx, this.rules.select(&value).or_throw(cx)?))
}

#[native_abi]
fn select_range(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsPluralRules> = this!(cx, frame.this_value(), "PluralRules", "selectRange")?;
    let [start, end] = to_range(cx, frame)?;
    let category = with_cache(cx, |cache| this.rules.select_range(cache, &start, &end))?;
    Ok(named(cx, category))
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsPluralRules> = this!(cx, frame.this_value(), "PluralRules", "resolvedOptions")?;
    let resolved = *this.rules.options();
    let categories = this.rules.categories().or_throw(cx)?;
    let categories = values_to_array(cx, categories.map(|category| Ok(named(cx, category))))?;

    let options = Record::with_locale(cx, this.rules.locale().string().clone());
    options.put_named(names::r#type, resolved.kind);
    options.put_named(names::notation, resolved.notation);
    if resolved.notation == Notation::Compact {
        options.put_named(names::compactDisplay, resolved.compact_display);
    }
    put_digit_counts(&options, &resolved.digits);
    options.put(names::pluralCategories, categories);
    put_rounding(&options, &resolved.digits);
    Ok(options.finish())
}
