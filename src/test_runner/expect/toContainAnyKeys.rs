use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_contain_any_keys(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): borrowck — `defer this.postMatch(globalThis)` captures &mut self for scope; Phase B may need a guard newtype on Expect
    let _post = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toContainAnyKeys() takes 1 argument"));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    expected.ensure_still_alive();
    let value: JSValue = this.get_value(global, this_value, "toContainAnyKeys", "<green>expected<r>")?;

    if !expected.js_type().is_array() {
        return global.throw_invalid_argument_type("toContainAnyKeys", "expected", "array");
    }

    let not = this.flags.not;
    let mut pass = false;

    let count = expected.get_length(global)?;

    if value.is_object() {
        let mut i: u32 = 0;

        while i < count {
            let key = expected.get_index(global, i)?;

            if value.has_own_property_value(global, key)? {
                pass = true;
                break;
            }
            i += 1;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    // handle failure
    let mut formatter = Formatter { global_this: global, quote_strings: true, ..Default::default() };
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter);
    if not {
        let received_fmt = value.to_fmt(&mut formatter);
        const EXPECTED_LINE: &str = "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n";
        // TODO(port): get_signature should be a const fn / macro to match Zig `comptime`
        let signature = Expect::get_signature("toContainAnyKeys", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            concat!("\n\n", "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n"),
            format_args!("{}{}", expected_fmt, received_fmt),
        );
        // PORT NOTE: Zig passes a tuple .{expected_fmt, received_fmt} threaded into the fmt string;
        // Rust side of `throw` will need to accept fmt::Arguments built against the template above.
        let _ = EXPECTED_LINE;
    }

    const EXPECTED_LINE: &str = "Expected to contain: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let _ = (EXPECTED_LINE, RECEIVED_LINE);
    // TODO(port): get_signature should be a const fn / macro to match Zig `comptime`
    let signature = Expect::get_signature("toContainAnyKeys", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        concat!("\n\n", "Expected to contain: <green>{}<r>\n", "Received: <red>{}<r>\n"),
        format_args!("{}{}", expected_fmt, value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainAnyKeys.zig (72 lines)
//   confidence: medium
//   todos:      3
//   notes:      `defer post_match` needs borrowck reshape; `throw` fmt-tuple plumbing and comptime get_signature deferred to Phase B
// ──────────────────────────────────────────────────────────────────────────
