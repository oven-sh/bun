use bun_engine_vm::RealmSlot;

use super::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::getCanonicalLocales, get_canonical_locales, 1),
    StaticProperty::function(names::supportedValuesOf, supported_values_of, 1),
    StaticProperty::realm_slot(names::Collator, RealmSlot::collator_constructor),
    StaticProperty::realm_slot(names::DateTimeFormat, RealmSlot::date_time_format_constructor),
    StaticProperty::realm_slot(names::DisplayNames, RealmSlot::display_names_constructor),
    StaticProperty::realm_slot(names::DurationFormat, RealmSlot::duration_format_constructor),
    StaticProperty::realm_slot(names::ListFormat, RealmSlot::list_format_constructor),
    StaticProperty::realm_slot(names::Locale, RealmSlot::locale_constructor),
    StaticProperty::realm_slot(names::NumberFormat, RealmSlot::number_format_constructor),
    StaticProperty::realm_slot(names::PluralRules, RealmSlot::plural_rules_constructor),
    StaticProperty::realm_slot(
        names::RelativeTimeFormat,
        RealmSlot::relative_time_format_constructor
    ),
    StaticProperty::realm_slot(names::Segmenter, RealmSlot::segmenter_constructor),
    StaticProperty::string(symbols::toStringTag, names::Intl),
]);

define_object!(IntlObject, "Intl", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let object = IntlObject::create(cx, cx.object_prototype());
    cx.global().init_intl_object(object);
}

#[native_abi]
fn get_canonical_locales(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let list = canonicalize_locale_list(cx, frame.argument(0))?;
    strings_to_array(cx, list.iter().map(|tag| tag.string().clone()))
}

#[native_abi]
fn supported_values_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let key = frame.argument(0).to_string_view(cx)?;
    strings_to_array(cx, crate::supported_values_of(key.text()).or_throw(cx)?)
}
