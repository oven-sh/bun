use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use super::throw;
use super::DiffFormatter;
use super::Expect;

fn array_has_symbol(global: &JSGlobalObject, path: JSValue) -> JsResult<bool> {
    if !path.is_array() {
        return Ok(false);
    }
    let mut elements = path.array_iterator(global)?;
    while let Some(element) = elements.next()? {
        if element.is_symbol() {
            return Ok(true);
        }
    }
    Ok(false)
}

impl Expect {
    pub(crate) fn to_have_property(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        key_path: JsLocal<'_>,
        value: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

        this.increment_expect_call_counter();

        let expected_property_path = key_path.to_js();
        let expected_property: Option<JSValue> = value.first().map(|value| value.to_js());

        let value: JSValue = this.get_value(
            global,
            this_value,
            "toHaveProperty",
            "<green>path<r><d>, <r><green>value<r>",
        )?;

        // bun:test has always let `.not.toHaveProperty()` pass on these two.
        if value.is_undefined_or_null() && this.is_vitest() {
            return Err(global.throw_type_error(format_args!(
                ".toHaveProperty() expects to receive a valid object, but got {}",
                if value.is_null() { "null" } else { "undefined" },
            )));
        }

        if !expected_property_path.is_string() && !expected_property_path.is_iterable(global)? {
            return Err(global.throw(format_args!("Expected path must be a string or an array")));
        }

        let not = this.flags.get().not();

        let mut pass = !value.is_undefined_or_null();
        let mut received_property: JSValue = JSValue::ZERO;

        if pass {
            // In Vitest an own key spelled like the whole path, e.g. "a.b", wins over walking the path.
            let own_property = if expected_property_path.is_string() && this.is_vitest() {
                value.get_own(global, &expected_property_path.to_bun_string(global)?)?
            } else {
                None
            };
            received_property = match own_property {
                Some(own_property) => own_property,
                // Vitest reads each element of an array path as a string, so a Symbol finds no symbol key.
                None if !expected_property_path.is_string()
                    && this.is_vitest()
                    && array_has_symbol(global, expected_property_path)? =>
                {
                    JSValue::ZERO
                }
                None => value.get_if_property_exists_from_path(global, expected_property_path)?,
            };
            pass = !received_property.is_empty();
        }

        if pass {
            if let Some(expected_property_value) = expected_property {
                pass = received_property.jest_deep_equals(expected_property_value, global)?;
            }
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        // `defer formatter.deinit()` — handled by Drop.
        if not {
            if let Some(expected_property_value) = expected_property {
                let signature =
                    Expect::get_signature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", true);
                if !received_property.is_empty() {
                    return throw!(
                        this,
                        global,
                        signature,
                        "\n\nExpected path: <green>{}<r>\n\nExpected value: not <green>{}<r>\n",
                        expected_property_path.to_fmt(&mut formatter),
                        expected_property_value.to_fmt(&mut formatter2),
                    );
                }
            }

            let signature = Expect::get_signature("toHaveProperty", "<green>path<r>", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected path: not <green>{}<r>\n\nReceived value: <red>{}<r>\n",
                expected_property_path.to_fmt(&mut formatter),
                received_property.to_fmt(&mut formatter2),
            );
        }

        if let Some(expected_property_value) = expected_property {
            let signature =
                Expect::get_signature("toHaveProperty", "<green>path<r><d>, <r><green>value<r>", false);
            if !received_property.is_empty() {
                // deep equal case
                let diff_format = DiffFormatter::new(global, received_property, expected_property_value, false)?;

                return throw!(this, global, signature, "\n\n{}\n", diff_format);
            }

            return throw!(
                this,
                global,
                signature,
                "\n\nExpected path: <green>{}<r>\n\nExpected value: <green>{}<r>\n\nUnable to find property\n",
                expected_property_path.to_fmt(&mut formatter),
                expected_property_value.to_fmt(&mut formatter2),
            );
        }

        let signature = Expect::get_signature("toHaveProperty", "<green>path<r>", false);
        throw!(
            this,
            global,
            signature,
            "\n\nExpected path: <green>{}<r>\n\nUnable to find property\n",
            expected_property_path.to_fmt(&mut formatter),
        )
    }
}
