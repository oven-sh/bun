use core::ffi::c_void;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VM};

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_empty(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig `defer this.postMatch(globalThis)` — reshaped via scopeguard over a raw
    // pointer so `this` remains usable below without a borrowck conflict.
    let this_ptr: *mut Expect = this;
    let _post_match = scopeguard::guard((), move |_| {
        // SAFETY: `this` is the host-fn receiver and outlives this guard (drops at fn exit).
        unsafe { (*this_ptr).post_match(global) };
    });

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, "toBeEmpty", "")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = false;
    // TODO(port): ConsoleObject.Formatter field init — assumes remaining fields are Default.
    let mut formatter = bun_jsc::console_object::Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` — handled by Drop.

    let actual_length = value.get_length_if_property_exists_internal(global)?;

    if actual_length == f64::INFINITY {
        if value.js_type_loose().is_object() {
            if value.is_iterable(global)? {
                let mut any_properties_in_iterator = false;

                extern "C" fn anything_in_iterator(
                    _: *mut VM,
                    _: *mut JSGlobalObject,
                    any_: *mut c_void,
                    _: JSValue,
                ) {
                    // SAFETY: `any_` is the `&mut bool` passed to `for_each` below.
                    unsafe { *(any_ as *mut bool) = true };
                }

                value.for_each(
                    global,
                    &mut any_properties_in_iterator as *mut bool as *mut c_void,
                    anything_in_iterator,
                )?;
                pass = !any_properties_in_iterator;
            } else {
                let Some(cell) = value.to_cell() else {
                    return global.throw_type_error(format_args!(
                        "Expected value to be a string, object, or iterable"
                    ));
                };
                // TODO(port): JSPropertyIterator was comptime-parameterized in Zig; pass options at runtime for now.
                let props_iter = bun_jsc::JSPropertyIterator::init(
                    global,
                    cell.to_object(global),
                    bun_jsc::JSPropertyIteratorOptions {
                        skip_empty_name: false,
                        own_properties_only: false,
                        include_value: true,
                        // FIXME: can we do this?
                    },
                )?;
                // `defer props_iter.deinit()` — handled by Drop.
                pass = props_iter.len == 0;
            }
        } else {
            // TODO(port): get_signature must be a `const fn -> &'static str` for concatcp!.
            const FMT: &str = const_format::concatcp!(
                Expect::get_signature("toBeEmpty", "", false),
                "\n\nExpected value to be a string, object, or iterable",
                "\n\nReceived: <red>{}<r>\n",
            );
            return global.throw_pretty(FMT, format_args!("{}", value.to_fmt(&mut formatter)));
        }
    } else if actual_length.is_nan() {
        return global.throw(format_args!(
            "Received value has non-number length property: {}",
            actual_length
        ));
    } else {
        pass = actual_length == 0.0;
    }

    if not && pass {
        const FMT: &str = const_format::concatcp!(
            Expect::get_signature("toBeEmpty", "", true),
            "\n\nExpected value <b>not<r> to be a string, object, or iterable",
            "\n\nReceived: <red>{}<r>\n",
        );
        return global.throw_pretty(FMT, format_args!("{}", value.to_fmt(&mut formatter)));
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    if not {
        const FMT: &str = const_format::concatcp!(
            Expect::get_signature("toBeEmpty", "", true),
            "\n\nExpected value <b>not<r> to be empty",
            "\n\nReceived: <red>{}<r>\n",
        );
        return global.throw_pretty(FMT, format_args!("{}", value.to_fmt(&mut formatter)));
    }

    const FMT: &str = const_format::concatcp!(
        Expect::get_signature("toBeEmpty", "", false),
        "\n\nExpected value to be empty",
        "\n\nReceived: <red>{}<r>\n",
    );
    global.throw_pretty(FMT, format_args!("{}", value.to_fmt(&mut formatter)))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeEmpty.zig (88 lines)
//   confidence: medium
//   todos:      3
//   notes:      defer postMatch reshaped via scopeguard+raw ptr; throw_pretty/get_signature signatures guessed; JSPropertyIterator comptime opts passed at runtime
// ──────────────────────────────────────────────────────────────────────────
