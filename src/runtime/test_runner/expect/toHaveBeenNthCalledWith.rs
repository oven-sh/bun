use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use crate::diff_format::DiffFormatter;
use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_have_been_nth_called_with(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): jsc.markBinding(@src()) — debug-only binding marker

    let this_value = frame.this();
    let arguments = frame.arguments();
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` is expressed by
    // wrapping `this` in a scopeguard so post_match runs on every exit (including `?`).
    let mut this = scopeguard::guard(this, |t| t.post_match(global));
    let value: JSValue = this.get_value(
        global,
        this_value,
        "toHaveBeenNthCalledWith",
        "<green>n<r>, <green>...expected<r>",
    )?;

    this.increment_expect_call_counter();

    let calls = bun_jsc::cpp::JSMockFunction__getCalls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = Formatter { global_this: global, quote_strings: true, ..Default::default() };
        return this.throw(
            global,
            Expect::get_signature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", false),
            format_args!(
                "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {}",
                value.to_fmt(&mut formatter),
            ),
        );
    }

    if arguments.is_empty() || !arguments[0].is_any_int() {
        return global.throw_invalid_arguments(format_args!(
            "toHaveBeenNthCalledWith() requires a positive integer as the first argument"
        ));
    }
    let nth_call_num_i32 = arguments[0].to_int32();

    if nth_call_num_i32 <= 0 {
        return global.throw_invalid_arguments(format_args!(
            "toHaveBeenNthCalledWith() first argument must be a positive integer"
        ));
    }
    let nth_call_num: u32 = u32::try_from(nth_call_num_i32).unwrap();

    let total_calls: u32 = u32::try_from(calls.get_length(global)?).unwrap();
    let mut pass = total_calls >= nth_call_num;
    let mut nth_call_value: JSValue = JSValue::ZERO;

    if pass {
        nth_call_value = calls.get_index(global, nth_call_num - 1)?;
        let expected_args = &arguments[1..];

        if !nth_call_value.js_type().is_array() {
            return global.throw(format_args!(
                "Internal error: expected mock call item to be an array of arguments."
            ));
        }

        if nth_call_value.get_length(global)? != expected_args.len() {
            pass = false;
        } else {
            let mut itr = nth_call_value.array_iterator(global)?;
            while let Some(call_arg) = itr.next()? {
                if !call_arg.jest_deep_equals(expected_args[itr.i - 1], global)? {
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
    let mut formatter = Formatter { global_this: global, quote_strings: true, ..Default::default() };

    let expected_args_slice = &arguments[1..];
    let expected_args_js_array = JSValue::create_empty_array(global, expected_args_slice.len())?;
    for (i, arg) in expected_args_slice.iter().enumerate() {
        expected_args_js_array.put_index(global, u32::try_from(i).unwrap(), *arg)?;
    }
    expected_args_js_array.ensure_still_alive();

    if this.flags.not {
        let signature = Expect::get_signature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected call #{} not to be with: <green>{}<r>\nBut it was.",
                nth_call_num,
                expected_args_js_array.to_fmt(&mut formatter),
            ),
        );
    }
    let signature = Expect::get_signature("toHaveBeenNthCalledWith", "<green>n<r>, <green>...expected<r>", false);

    // Handle case where function was not called enough times
    if total_calls < nth_call_num {
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nThe mock function was called {} time{}, but call {} was requested.",
                total_calls,
                if total_calls == 1 { "" } else { "s" },
                nth_call_num,
            ),
        );
    }

    // The call existed but didn't match. Show a diff.
    let diff_format = DiffFormatter {
        expected: expected_args_js_array,
        received: nth_call_value,
        global_this: global,
        not: false,
    };
    this.throw(
        global,
        signature,
        format_args!("\n\nCall #{}:\n{}\n", nth_call_num, diff_format),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveBeenNthCalledWith.zig (105 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match wrapped via scopeguard for borrowck; bun.cpp/Formatter/throw signatures may need fixup
// ──────────────────────────────────────────────────────────────────────────
