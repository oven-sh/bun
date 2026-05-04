use bun_jsc::console_object::Formatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_contain_all_values(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalObject)` — needs an RAII PostMatch guard;
    // a scopeguard capturing `&mut Expect` conflicts with the uses of `this` below.
    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global
            .throw_invalid_arguments(format_args!("toContainAllValues() takes 1 argument"));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    if !expected.js_type().is_array() {
        return global.throw_invalid_argument_type("toContainAllValues", "expected", "array");
    }
    expected.ensure_still_alive();
    let value: JSValue =
        this.get_value(global, this_value, "toContainAllValues", "<green>expected<r>")?;

    let not = this.flags.not;
    let mut pass = false;

    if !value.is_undefined_or_null() {
        let values = value.values(global)?;
        let mut itr = expected.array_iterator(global)?;
        let count = values.get_length(global)?;
        let expected_length = expected.get_length(global)?;

        if count == expected_length {
            // PORT NOTE: reshaped Zig inner `while ... else` (Rust has no while-else);
            // `found` tracks whether the inner loop broke early.
            while let Some(item) = itr.next()? {
                let mut i: u32 = 0;
                let mut found = false;
                while u64::from(i) < count {
                    let key = values.get_index(global, i)?;
                    if key.jest_deep_equals(item, global)? {
                        pass = true;
                        found = true;
                        break;
                    }
                    i += 1;
                }
                if !found {
                    pass = false;
                    break;
                }
            }
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` — handled by Drop.
    // TODO(port): `to_fmt(&mut formatter)` below yields overlapping &mut borrows of `formatter`;
    // Phase B may need interior mutability on Formatter or to inline the Display wrappers.
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    if not {
        let received_fmt = value.to_fmt(&mut formatter);
        return this.throw(
            global,
            Expect::get_signature("toContainAllValues", "<green>expected<r>", true),
            format_args!(
                "\n\nExpected to not contain all values: <green>{}<r>\nReceived: <red>{}<r>\n",
                expected_fmt, received_fmt,
            ),
        );
    }

    return this.throw(
        global,
        Expect::get_signature("toContainAllValues", "<green>expected<r>", false),
        format_args!(
            "\n\nExpected to contain all values: <green>{}<r>\nReceived: <red>{}<r>\n",
            expected_fmt, value_fmt,
        ),
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainAllValues.zig (79 lines)
//   confidence: medium
//   todos:      2
//   notes:      defer postMatch needs RAII guard; to_fmt(&mut Formatter) aliases — both patterns recur across all expect matchers
// ──────────────────────────────────────────────────────────────────────────
