use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_jsc::BigIntCompare;

use super::Expect;
use super::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_greater_than_or_equal(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);` — side-effect on all exit paths.
    let _post = scopeguard::guard((), |_| this.post_match(global));
    // TODO(port): errdefer — scopeguard borrows `this`/`global`; Phase B may need to
    // restructure if borrowck rejects the overlapping &mut on `this` below.

    let this_value = frame.this_value();
    let arguments: &[JSValue] = frame.arguments_old(1);

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!(
            "toBeGreaterThanOrEqual() requires 1 argument"
        ));
    }

    this.increment_expect_call_counter();

    let other_value = arguments[0];
    other_value.ensure_still_alive();

    let value: JSValue =
        this.get_value(global, this_value, "toBeGreaterThanOrEqual", "<green>expected<r>")?;

    if (!value.is_number() && !value.is_big_int())
        || (!other_value.is_number() && !other_value.is_big_int())
    {
        return global.throw(format_args!(
            "Expected and actual values must be numbers or bigints"
        ));
    }

    let not = this.flags.not;
    let mut pass = false;

    if !value.is_big_int() && !other_value.is_big_int() {
        pass = value.as_number() >= other_value.as_number();
    } else if value.is_big_int() {
        pass = match value.as_big_int_compare(global, other_value) {
            BigIntCompare::GreaterThan | BigIntCompare::Equal => true,
            _ => pass,
        };
    } else {
        pass = match other_value.as_big_int_compare(global, value) {
            BigIntCompare::LessThan | BigIntCompare::Equal => true,
            _ => pass,
        };
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = other_value.to_fmt(&mut formatter);
    if not {
        const EXPECTED_LINE: &str = "Expected: not \\>= <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature = const { get_signature("toBeGreaterThanOrEqual", "<green>expected<r>", true) };
        return this.throw(
            global,
            signature,
            concat!("\n\n", "Expected: not \\>= <green>{}<r>\n", "Received: <red>{}<r>\n"),
            format_args!(
                concat!("\n\n", "Expected: not \\>= <green>{}<r>\n", "Received: <red>{}<r>\n"),
                expected_fmt,
                value_fmt
            ),
        );
        // TODO(port): Zig passes `comptime fmt ++` and `.{args}` separately; Rust collapses
        // into `format_args!`. Phase B: settle on `Expect::throw` signature (likely takes
        // `core::fmt::Arguments` only — drop the redundant fmt-string param above).
    }

    const EXPECTED_LINE: &str = "Expected: \\>= <green>{}<r>\n";
    const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
    let signature = const { get_signature("toBeGreaterThanOrEqual", "<green>expected<r>", false) };
    this.throw(
        global,
        signature,
        concat!("\n\n", "Expected: \\>= <green>{}<r>\n", "Received: <red>{}<r>\n"),
        format_args!(
            concat!("\n\n", "Expected: \\>= <green>{}<r>\n", "Received: <red>{}<r>\n"),
            expected_fmt,
            value_fmt
        ),
    )
    // TODO(port): same as above — collapse fmt-string + args once `Expect::throw` is ported.
}

// PORT NOTE: unused `EXPECTED_LINE`/`RECEIVED_LINE` consts kept to mirror Zig structure for
// side-by-side diff; `concat!` requires literals so they are inlined at the call site.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeGreaterThanOrEqual.zig (69 lines)
//   confidence: medium
//   todos:      3
//   notes:      `defer postMatch` via scopeguard may fight borrowck; `Expect::throw` fmt-string/args split needs Phase B API decision
// ──────────────────────────────────────────────────────────────────────────
