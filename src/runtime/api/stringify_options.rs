//! The `space` argument of `Bun.*.stringify`: a `JSON.stringify` space, or `{ indent, ... }`.

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

    /// `None` without an options object or without the key. A non-boolean throws.
    pub(crate) fn boolean(&self, global: &JSGlobalObject, name: &str) -> JsResult<Option<bool>> {
        match self.object {
            Some(object) => object.get_boolean_strict(global, name),
            None => Ok(None),
        }
    }
}
