//! The third argument of `Bun.YAML.stringify`, `Bun.JSON5.stringify` and `Bun.XML.stringify`.
//!
//! It is a number or a string, as `JSON.stringify`'s `space`, or an options object whose `indent`
//! key takes the same values. Each format reads `space` with its own rules. The other keys of the
//! object belong to the format (`aliases` for YAML).

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub(crate) struct StringifyOptions {
    /// The argument itself, or its `indent` key when the argument is an options object.
    pub(crate) space: JSValue,
    /// The options object, when the argument is one.
    object: Option<JSValue>,
}

impl StringifyOptions {
    pub(crate) fn init(
        global: &JSGlobalObject,
        space_value: JSValue,
    ) -> JsResult<StringifyOptions> {
        let unwrapped = space_value.unwrap_boxed_primitive(global)?;
        if !unwrapped.is_object() {
            return Ok(StringifyOptions {
                space: unwrapped,
                object: None,
            });
        }

        Ok(StringifyOptions {
            space: unwrapped
                .get(global, "indent")?
                .unwrap_or(JSValue::UNDEFINED),
            object: Some(unwrapped),
        })
    }

    /// `None` when there is no options object or the key is missing or `undefined`. A value that is
    /// not a boolean throws `ERR_INVALID_ARG_TYPE`.
    pub(crate) fn boolean(&self, global: &JSGlobalObject, name: &str) -> JsResult<Option<bool>> {
        match self.object {
            Some(object) => object.get_boolean_strict(global, name),
            None => Ok(None),
        }
    }
}
