use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::{get_signature, Expect};

#[bun_jsc::host_fn(method)]
pub fn to_contain_keys(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // defer this.postMatch(globalThis);
    // PORT NOTE: reshaped for borrowck — move `this` into the guard and access via DerefMut.
    let mut this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this_value();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toContainKeys() takes 1 argument"));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    expected.ensure_still_alive();
    let value: JSValue = this.get_value(global, this_value, "toContainKeys", "<green>expected<r>")?;

    if !expected.js_type().is_array() {
        return global.throw_invalid_argument_type("toContainKeys", "expected", "array");
    }

    let not = this.flags.not;
    let mut pass = 'brk: {
        let count = expected.get_length(global)?;

        // jest-extended checks for truthiness before calling hasOwnProperty, and we cannot call hasOwnPropertyValue with non-objects
        // https://github.com/jest-community/jest-extended/blob/711fdcc54d68c2b2c1992c7cfbdf0d0bd6be0f4d/src/matchers/toContainKeys.js#L1-L6
        if !value.is_object() {
            break 'brk count == 0;
        }

        let mut i: u32 = 0;

        while i < count {
            let key = expected.get_index(global, i)?;

            if !value.has_own_property_value(global, key)? {
                break 'brk false;
            }
            i += 1;
        }

        true
    };

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
    // defer formatter.deinit(); — handled by Drop
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    if not {
        let received_fmt = value.to_fmt(&mut formatter);
        const EXPECTED_LINE: &str = "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n";
        // TODO(port): get_signature must be const fn / macro for comptime eval
        let signature = get_signature("toContainKeys", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n"), expected_fmt, received_fmt),
        );
    }

    const EXPECTED_LINE: &str = "Expected to contain: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    // TODO(port): get_signature must be const fn / macro for comptime eval
    let signature = get_signature("toContainKeys", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(concat!("\n\n", "Expected to contain: <green>{}<r>\n", "Received: <red>{}<r>\n"), expected_fmt, value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainKeys.zig (75 lines)
//   confidence: medium
//   todos:      2
//   notes:      Formatter borrow aliasing (to_fmt called 3x on &mut) may need reshape in Phase B
// ──────────────────────────────────────────────────────────────────────────
