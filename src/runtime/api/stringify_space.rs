//! The `space` (indentation) argument shared by the `JSON5.stringify` and
//! `YAML.stringify` implementations.

use bun_core::{OwnedString, String as BunString};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, wtf};

pub(crate) enum Space {
    Minified,
    Number(u32),
    /// +1 WTF ref owned for the lifetime of the holder.
    Str(OwnedString),
}

impl Space {
    pub(crate) fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Space> {
        let space = space_value.unwrap_boxed_primitive(global)?;
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
            let str = OwnedString::new(space.to_bun_string(global)?);
            if str.length() == 0 {
                return Ok(Space::Minified);
            }
            return Ok(Space::Str(str));
        }

        Ok(Space::Minified)
    }

    /// Append `'\n'` followed by `indent` levels of indentation
    /// (no-op when `Minified`).
    pub(crate) fn append_newline_indent(&self, builder: &mut wtf::StringBuilder, indent: usize) {
        match self {
            Space::Minified => {}
            Space::Number(space_num) => {
                let space_num = *space_num as usize;
                builder.append_lchar(b'\n');
                builder.ensure_unused_capacity(indent * space_num);
                for _ in 0..indent * space_num {
                    builder.append_lchar(b' ');
                }
            }
            Space::Str(space_str) => {
                builder.append_lchar(b'\n');

                let clamped: BunString = if space_str.length() > 10 {
                    space_str.substring_with_len(0, 10)
                } else {
                    **space_str
                };

                builder.ensure_unused_capacity(indent * clamped.length());
                for _ in 0..indent {
                    builder.append_string(clamped);
                }
            }
        }
    }
}
