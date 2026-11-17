//! The values of `NSUserDefaults`.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::protocol::{Preference, PreferenceValue, Text};
use crate::value::IntoJs;

impl IntoJs for PreferenceValue {
    fn into_js(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            PreferenceValue::Flag(it) => it.into_js(global),
            PreferenceValue::Number(it) => it.into_js(global),
            PreferenceValue::Text(it) => it.into_js(global),
            PreferenceValue::Array(it) => it.into_js(global),
            PreferenceValue::Dictionary(all) => {
                let object = JSValue::create_empty_object(global, 0);
                for Preference { key, value } in all {
                    let key = bun_core::String::clone_utf8(key.as_bytes());
                    object.put_may_be_index(global, &key, value.into_js(global)?)?;
                }
                Ok(object)
            }
        }
    }
}

pub fn from_js(global: &JSGlobalObject, value: JSValue, depth: u8) -> JsResult<PreferenceValue> {
    if depth == 64 {
        return Err(global.throw_type_error(format_args!("The value is nested too deeply")));
    }
    if value.is_boolean() {
        return Ok(PreferenceValue::Flag(value.to_boolean()));
    }
    if value.is_number() {
        return Ok(PreferenceValue::Number(value.as_number()));
    }
    if !value.is_object() {
        return Ok(PreferenceValue::Text(Text::lossy(&value.to_utf8(global)?)));
    }
    if value.is_array() {
        let (mut all, mut items) = (Vec::new(), value.array_iterator(global)?);
        while let Some(item) = items.next()? {
            all.push(from_js(global, item, depth + 1)?);
        }
        return Ok(PreferenceValue::Array(all.into()));
    }
    let (mut all, mut keys) = (Vec::new(), value.keys(global)?.array_iterator(global)?);
    while let Some(key) = keys.next()? {
        let key = key.to_utf8(global)?;
        if let Some(item) = value.get(global, &*key)? {
            all.push(Preference {
                key: Text::lossy(&key),
                value: from_js(global, item, depth + 1)?,
            });
        }
    }
    Ok(PreferenceValue::Dictionary(all.into()))
}
