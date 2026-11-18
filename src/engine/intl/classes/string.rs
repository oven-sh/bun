use super::prelude::*;
use crate::{Case, NormalizationForm, OptionValue, normalize, transform_case};

/// `toLocaleLowerCase` and `toLocaleUpperCase` of `String.prototype`, after the conversion to a string.
pub fn to_locale_case(
    cx: &mut Cx,
    string: Gc<JsString>,
    locales: Value,
    case: Case,
) -> JsResult<Gc<JsString>> {
    let requested = canonicalize_locale_list(cx, locales)?;
    let view = string.view(cx)?;
    let changed = with_cache(cx, |cache| {
        transform_case(cache, view.text(), &requested, case)
    })?;
    Ok(changed.map_or(string, |changed| JsString::new(cx, changed)))
}

/// `String.prototype.normalize`, after the conversion to a string.
pub fn normalize_string(cx: &mut Cx, string: Gc<JsString>, form: Value) -> JsResult<Gc<JsString>> {
    let form = if form.is_undefined() {
        NormalizationForm::default()
    } else {
        NormalizationForm::parse(form.to_string_view(cx)?.text()).or_throw(cx)?
    };
    let normalized = normalize(string.view(cx)?.text(), form).or_throw(cx)?;
    Ok(normalized.map_or(string, |normalized| JsString::new(cx, normalized)))
}
