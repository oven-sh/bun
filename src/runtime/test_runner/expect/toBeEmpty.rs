use core::ffi::c_void;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use bun_jsc::{CallFrame, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsResult, VM};

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_empty(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, value, not) = this.matcher_prelude(global, frame.this(), "toBeEmpty", "")?;
    let mut pass = false;
    let mut formatter = super::make_formatter(global);
    // `defer formatter.deinit()` — handled by Drop.

    let actual_length = value.get_length_if_property_exists_internal(global)?;

    if actual_length == f64::INFINITY {
        if value.js_type_loose().is_object() {
            if value.is_iterable(global)? {
                let mut any_properties_in_iterator = false;

                extern "C" fn anything_in_iterator(
                    _: *mut VM,
                    _: &JSGlobalObject,
                    any_: *mut c_void,
                    _: JSValue,
                ) {
                    // SAFETY: `any_` is the `&mut bool` passed to `for_each` below.
                    unsafe { *any_.cast::<bool>() = true };
                }

                value.for_each(
                    global,
                    (&raw mut any_properties_in_iterator).cast::<c_void>(),
                    anything_in_iterator,
                )?;
                pass = !any_properties_in_iterator;
            } else {
                let Some(_cell) = value.to_cell() else {
                    return Err(global.throw_type_error(format_args!(
                        "Expected value to be a string, object, or iterable"
                    )));
                };
                // Zig: `cell.toObject(globalThis)` — `value` is the same cell, so use the
                // JSValue ToObject path directly.
                let object = value.to_object(global)?;
                let props_iter = JSPropertyIterator::init(
                    global,
                    object,
                    JSPropertyIteratorOptions {
                        skip_empty_name: false,
                        own_properties_only: false,
                        include_value: true,
                        // FIXME: can we do this?
                        ..Default::default()
                    },
                )?;
                // `defer props_iter.deinit()` — handled by Drop.
                pass = props_iter.len == 0;
            }
        } else {
            let signature = Expect::get_signature("toBeEmpty", "", false);
            return Err(global.throw_pretty(format_args!(
                "{signature}\n\nExpected value to be a string, object, or iterable\n\nReceived: <red>{}<r>\n",
                value.to_fmt(&mut formatter)
            )));
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
        return Err(global.throw_pretty(format_args!(
            "{signature}\n\nExpected value <b>not<r> to be a string, object, or iterable\n\nReceived: <red>{}<r>\n",
            value.to_fmt(&mut formatter)
        )));
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    if not {
        let signature = Expect::get_signature("toBeEmpty", "", true);
        return Err(global.throw_pretty(format_args!(
            "{signature}\n\nExpected value <b>not<r> to be empty\n\nReceived: <red>{}<r>\n",
            value.to_fmt(&mut formatter)
        )));
    }

    let signature = Expect::get_signature("toBeEmpty", "", false);
    Err(global.throw_pretty(format_args!(
        "{signature}\n\nExpected value to be empty\n\nReceived: <red>{}<r>\n",
        value.to_fmt(&mut formatter)
    )))
}

// ported from: src/test_runner/expect/toBeEmpty.zig
