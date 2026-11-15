use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsResult, VM};

use super::{throw, Expect};

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_be_empty(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) = self.matcher_prelude(global, this_value.to_js(), "toBeEmpty", "")?;
        let mut pass;

        let actual_length = value.get_length_if_property_exists_internal(global)?;

        if actual_length == f64::INFINITY {
            if value.js_type_loose().is_object() {
                if value.is_iterable(global)? {
                    let mut any_properties_in_iterator = false;

                    extern "C" fn anything_in_iterator(
                        _: &VM,
                        _: &JSGlobalObject,
                        any_: &mut bool,
                        _: JSValue,
                    ) {
                        *any_ = true;
                    }

                    value.for_each(
                        global,
                        &mut any_properties_in_iterator,
                        anything_in_iterator,
                    )?;
                    pass = !any_properties_in_iterator;
                } else {
                    if !value.is_cell() {
                        return Err(global.throw_type_error(format_args!(
                            "Expected value to be a string, object, or iterable"
                        )));
                    }
                    let object = value.to_object(global)?;
                    let props_iter = JSPropertyIterator::init(
                        global,
                        &object,
                        JSPropertyIteratorOptions {
                            skip_empty_name: false,
                            own_properties_only: false,
                            include_value: true,
                            // jest-extended compares against `{}` with an equality that sees enumerable Symbol keys.
                            include_symbols: true,
                            // FIXME: can we do this?
                            ..Default::default()
                        },
                    )?;
                    // `defer props_iter.deinit()` — handled by Drop.
                    pass = props_iter.len == 0;
                }
            } else {
                let signature = Expect::get_signature("toBeEmpty", "", false);
                return throw!(
                    this,
                    global,
                    signature,
                    "\n\nExpected value to be a string, object, or iterable\n\nReceived: <red>{}<r>\n",
                    value.to_fmt(&mut super::make_formatter(global))
                );
            }
        } else if actual_length.is_nan() {
            return Err(global.throw(format_args!(
                "Received value has non-number length property: {}",
                actual_length
            )));
        } else {
            pass = actual_length == 0.0;
        }

        if not && pass {
            let signature = Expect::get_signature("toBeEmpty", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected value <b>not<r> to be a string, object, or iterable\n\nReceived: <red>{}<r>\n",
                value.to_fmt(&mut super::make_formatter(global))
            );
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        if not {
            let signature = Expect::get_signature("toBeEmpty", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected value <b>not<r> to be empty\n\nReceived: <red>{}<r>\n",
                value.to_fmt(&mut super::make_formatter(global))
            );
        }

        let signature = Expect::get_signature("toBeEmpty", "", false);
        throw!(
            this,
            global,
            signature,
            "\n\nExpected value to be empty\n\nReceived: <red>{}<r>\n",
            value.to_fmt(&mut super::make_formatter(global))
        )
    }
}

