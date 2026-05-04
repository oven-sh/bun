use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::diff_format::DiffFormatter;
use crate::expect::{Expect, get_signature};

#[bun_jsc::host_fn(method)]
pub fn to_have_been_last_called_with(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let this_value = frame.this();
    let arguments = frame.arguments();

    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: scopeguard over a raw pointer to avoid an exclusive borrow of `this`
    // for the whole fn body. SAFETY: `this` is valid for the entire function; the guard
    // runs at scope exit before `this`'s borrow ends.
    let this_ptr: *mut Expect = this;
    let _post_match = scopeguard::guard((), |_| unsafe {
        (*this_ptr).post_match(global);
    });

    let value: JSValue =
        this.get_value(global, this_value, "toHaveBeenLastCalledWith", "<green>...expected<r>")?;

    this.increment_expect_call_counter();

    let calls = bun_jsc::cpp::js_mock_function_get_calls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        return this.throw(
            global,
            get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", false),
            format_args!(
                "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {}",
                value.to_fmt(&mut formatter),
            ),
        );
    }

    let total_calls: u32 = calls.get_length(global)? as u32;
    let mut last_call_value: JSValue = JSValue::ZERO;

    let mut pass = total_calls > 0;

    if pass {
        last_call_value = calls.get_index(global, total_calls - 1)?;

        if !last_call_value.js_type().is_array() {
            let mut formatter = Formatter {
                global_this: global,
                quote_strings: true,
                ..Default::default()
            };
            return global.throw(format_args!(
                "Expected value must be a mock function with calls: {}",
                value.to_fmt(&mut formatter),
            ));
        }

        if last_call_value.get_length(global)? != arguments.len() {
            pass = false;
        } else {
            let mut itr = last_call_value.array_iterator(global)?;
            while let Some(call_arg) = itr.next()? {
                if !call_arg.jest_deep_equals(arguments[itr.i - 1], global)? {
                    pass = false;
                    break;
                }
            }
        }
    }

    if pass != this.flags.not {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };

    let expected_args_js_array = JSValue::create_empty_array(global, arguments.len())?;
    for (i, arg) in arguments.iter().enumerate() {
        expected_args_js_array.put_index(global, u32::try_from(i).unwrap(), *arg)?;
    }
    expected_args_js_array.ensure_still_alive();

    if this.flags.not {
        let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected last call not to be with: <green>{}<r>\nBut it was.",
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }
    let signature = get_signature("toHaveBeenLastCalledWith", "<green>...expected<r>", false);

    if total_calls == 0 {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected: <green>{}<r>\nBut it was not called.",
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }

    let diff_format = DiffFormatter {
        expected: expected_args_js_array,
        received: last_call_value,
        global_this: global,
        not: false,
    };
    this.throw(global, signature, format_args!("\n\n{}\n", diff_format))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveBeenLastCalledWith.zig (91 lines)
//   confidence: medium
//   todos:      0
//   notes:      `defer this.postMatch` mapped to scopeguard over raw *mut Expect to avoid borrowck conflict; `bun.cpp.JSMockFunction__getCalls` → bun_jsc::cpp::js_mock_function_get_calls; get_signature assumed const fn.
// ──────────────────────────────────────────────────────────────────────────
