use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::ConsoleObject;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_match(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only source marker; no-op in Rust.

    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: borrowck — wrap `this` in a scopeguard that owns the &mut Expect
    // and runs post_match on drop; the body accesses `this` via the guard's DerefMut.
    let mut this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let arguments: &[JSValue] = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toMatch() requires 1 argument")));
    }

    this.increment_expect_call_counter();

    // Zig: `var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis, .quote_strings = true };`
    //      `defer formatter.deinit();` — handled by Drop.
    let mut formatter = super::make_formatter(global);

    let expected_value = arguments[0];
    if !expected_value.is_string() && !expected_value.is_reg_exp() {
        return Err(global.throw(format_args!(
            "Expected value must be a string or regular expression: {}",
            expected_value.to_fmt(&mut formatter),
        )));
    }
    expected_value.ensure_still_alive();

    let value: JSValue = this.get_value(global, this_value, "toMatch", "<green>expected<r>")?;

    if !value.is_string() {
        return Err(global.throw(format_args!(
            "Received value must be a string: {}",
            value.to_fmt(&mut formatter),
        )));
    }

    let not = this.flags.not();
    let mut pass: bool = 'brk: {
        if expected_value.is_string() {
            break 'brk value.string_includes(global, expected_value)?;
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
    // PORT NOTE: Zig shares one Formatter across both `to_fmt` calls; in Rust each
    // `to_fmt` borrows `&mut Formatter` for the lifetime of the returned wrapper, so
    // we need a second Formatter for the second value (matches toContain.rs / toBe.rs).
    let mut formatter2 = super::make_formatter(global);
    let expected_fmt = expected_value.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter2);

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
//   todos:      1
//   notes:      scopeguard owns &mut Expect for `defer postMatch`; second Formatter for dual to_fmt borrow; `get_signature` must be const.
// ──────────────────────────────────────────────────────────────────────────
