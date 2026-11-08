//! The third argument of `Bun.YAML.stringify`, `Bun.JSON5.stringify` and `Bun.XML.stringify`.
//!
//! It is a number or a string, as `JSON.stringify`'s `space`, or an options object whose `indent` key
//! takes the same values. The other keys of the object belong to the caller (`aliases` for YAML).

use bun_core::String as BunString;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

pub(crate) enum Space {
    Minified,
    Number(u32),
    /// +1 WTF ref owned for the lifetime of the stringifier.
    Str(BunString),
}

impl Space {
    /// Same interpretation as `JSON.stringify`'s `space`. `space` has been through
    /// `unwrap_boxed_primitive`.
    fn from_unwrapped(global: &JSGlobalObject, space: JSValue) -> JsResult<Space> {
        if space.is_number() {
            // Clamp on the float to match the spec's min(10, ToIntegerOrInfinity(space)).
            // toInt32() wraps large values and Infinity to 0, which is wrong.
            let num_f = space.as_number();
            if num_f.is_nan() || num_f < 1.0 {
                // handles NaN, -Infinity, 0, negatives
                return Ok(Space::Minified);
            }
            return Ok(Space::Number(if num_f > 10.0 { 10 } else { num_f as u32 }));
        }
        if space.is_string() {
            let str = space.to_bun_string(global)?;
            if str.length() == 0 {
                return Ok(Space::Minified);
            }
            return Ok(Space::Str(str));
        }
        Ok(Space::Minified)
    }

    pub(crate) fn is_pretty(&self) -> bool {
        !matches!(self, Space::Minified)
    }
}

pub(crate) struct StringifyOptions {
    pub(crate) space: Space,
    /// The options object, when the argument is one. An argument is read from it on demand, so a
    /// stringifier with no option of its own reads nothing but `indent`.
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
                space: Space::from_unwrapped(global, unwrapped)?,
                object: None,
            });
        }

        let space = match unwrapped.get(global, "indent")? {
            Some(indent) => Space::from_unwrapped(global, indent.unwrap_boxed_primitive(global)?)?,
            None => Space::Minified,
        };
        Ok(StringifyOptions {
            space,
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
