use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;
use crate::expect::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_instance_of(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck (was `defer this.postMatch(globalThis)`).
    // Run the matcher body in an inner closure so `this` is released when it returns,
    // then call `post_match` exactly once on every exit path (success or throw).
    let res = (|| -> JsResult<JSValue> {
    let this_value = frame.this_value();
    // PORT NOTE: collapsed `arguments_old(1)` + ptr/len slice into a single &[JSValue].
    let arguments: &[JSValue] = frame.arguments_old(1);

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!(
            "toBeInstanceOf() requires 1 argument"
        ));
    }

    this.increment_expect_call_counter();
    let mut formatter = Formatter {
        global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` → handled by Drop.

    let expected_value = arguments[0];
    if !expected_value.is_constructor() {
        return global.throw(format_args!(
            "Expected value must be a function: {}",
            expected_value.to_fmt(&mut formatter),
        ));
    }
    expected_value.ensure_still_alive();

    let value: JSValue =
        this.get_value(global, this_value, "toBeInstanceOf", "<green>expected<r>")?;

    let not = this.flags.not;
    let mut pass = value.is_instance_of(global, expected_value);
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let expected_fmt = expected_value.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        // PORT NOTE: Zig built the fmt string via comptime `++` concatenation of
        // `expected_line`/`received_line` consts; inlined here because Rust `concat!`
        // only accepts literals (and `format_args!` needs a literal anyway).
        // TODO(port): get_signature should be a `const fn` (was `comptime` in Zig).
        let signature = get_signature("toBeInstanceOf", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\nExpected constructor: not <green>{}<r>\nReceived value: <red>{}<r>\n",
                expected_fmt, value_fmt,
            ),
        );
    }

    let signature = get_signature("toBeInstanceOf", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            "\n\nExpected constructor: <green>{}<r>\nReceived value: <red>{}<r>\n",
            expected_fmt, value_fmt,
        ),
    )
    })();
    this.post_match(global);
    res
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeInstanceOf.zig (53 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match reshaped as inner-closure + trailing call; two &mut formatter borrows at expected_fmt/value_fmt may need reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────
