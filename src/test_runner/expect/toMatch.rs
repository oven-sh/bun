use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::ConsoleObject;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_match(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only source marker; no-op in Rust.

    // Zig: `defer this.postMatch(globalThis);`
    // TODO(port): borrowck — this guard borrows `this` for the whole scope and
    // conflicts with later `&mut self` uses. Phase B should expose
    // `Expect::post_match_guard(global)` as an RAII type instead.
    let _post_match = scopeguard::guard((), |_| this.post_match(global));

    let this_value = frame.this_value();
    let arguments: &[JSValue] = frame.arguments();

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!("toMatch() requires 1 argument"));
    }

    this.increment_expect_call_counter();

    // Zig: `var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };`
    //      `defer formatter.deinit();` — handled by Drop.
    let mut formatter = ConsoleObject::Formatter {
        global,
        quote_strings: true,
        ..Default::default()
    };

    let expected_value = arguments[0];
    if !expected_value.is_string() && !expected_value.is_reg_exp() {
        return global.throw(format_args!(
            "Expected value must be a string or regular expression: {}",
            expected_value.to_fmt(&mut formatter),
        ));
    }
    expected_value.ensure_still_alive();

    let value: JSValue = this.get_value(global, this_value, "toMatch", "<green>expected<r>")?;

    if !value.is_string() {
        return global.throw(format_args!(
            "Received value must be a string: {}",
            value.to_fmt(&mut formatter),
        ));
    }

    let not = this.flags.not;
    let mut pass: bool = 'brk: {
        if expected_value.is_string() {
            break 'brk value.string_includes(global, expected_value);
        } else if expected_value.is_reg_exp() {
            break 'brk expected_value.to_match(global, value)?;
        }
        unreachable!();
    };

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // TODO(port): two `&mut formatter` borrows alive across the same format_args! —
    // Phase B may need `to_fmt(&formatter)` (shared) or interior mutability on Formatter.
    let expected_fmt = expected_value.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter);

    if not {
        const EXPECTED_LINE: &str = "Expected substring or pattern: not <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        // TODO(port): `comptime getSignature(...)` — ensure `get_signature` is `const fn` (or macro) returning &'static str.
        let signature = Expect::get_signature("toMatch", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected substring or pattern: not <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt,
                value_fmt,
            ),
        );
    }

    const EXPECTED_LINE: &str = "Expected substring or pattern: <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature = Expect::get_signature("toMatch", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected substring or pattern: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt,
            value_fmt,
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toMatch.zig (69 lines)
//   confidence: medium
//   todos:      3
//   notes:      `defer this.postMatch` and dual `to_fmt(&mut formatter)` need borrowck reshape; `get_signature` must be const.
// ──────────────────────────────────────────────────────────────────────────
