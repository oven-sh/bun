use super::locale::JsLocale;
use super::prelude::*;
use crate::{AvailableLocales, LanguageTag, LocaleList};

static_table!(pub(super) static GENERAL_CONSTRUCTOR_PROPERTIES = [
    StaticProperty::function(names::supportedLocalesOf, supported_locales_of, 1),
]);

#[native_abi]
fn supported_locales_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    supported_locales(cx, frame, AvailableLocales::general())
}

pub(super) fn supported_locales(
    cx: &mut Cx,
    frame: &CallFrame,
    available: &AvailableLocales,
) -> JsResult<Value> {
    let requested = canonicalize_locale_list(cx, frame.argument(0))?;
    OptionBag::coerce(cx, frame.argument(1))?.check_locale_matcher(cx)?;
    let supported = available.filter(&requested);
    strings_to_array(cx, supported.map(|tag| tag.string().clone()))
}

/// CanonicalizeLocaleList
pub(super) fn canonicalize_locale_list(cx: &mut Cx, locales: Value) -> JsResult<LocaleList> {
    let mut list = LocaleList::default();
    if locales.is_undefined() {
        return Ok(list);
    }
    if locales.is_string() || locales.is::<JsLocale>() {
        list.push(canonicalize(cx, locales)?).or_throw(cx)?;
        return Ok(list);
    }
    let object = locales.to_object(cx)?;
    for index in 0..object.length_of_array_like(cx)? {
        cx.check_traps()?;
        if object.has_index(cx, index)? {
            let locale = object.get_index(cx, index)?;
            list.push(canonicalize(cx, locale)?).or_throw(cx)?;
        }
    }
    Ok(list)
}

fn canonicalize(cx: &mut Cx, locale: Value) -> JsResult<LanguageTag> {
    if !locale.is_string() && !locale.is_object() {
        return Err(cx.throw_type_error("locale value must be a string or object"));
    }
    if let Some(locale) = locale.downcast::<JsLocale>() {
        return Ok(locale.tag().clone());
    }
    let tag = locale.to_string(cx)?.resolve(cx)?;
    with_cache(cx, |cache| cache.canonicalize(&tag))
}
