use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_greater_than_or_equal(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);` — side-effect on all exit paths.
    // PORT NOTE: reshaped for borrowck — wrap `this` in a scopeguard so `post_match` runs on
    // every exit path while the body still has `&mut Expect` access via DerefMut.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>(); let arguments: &[JSValue] = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toBeGreaterThanOrEqual() requires 1 argument"
        )));
    }

    this.increment_expect_call_counter();

    let other_value = arguments[0];
    other_value.ensure_still_alive();

    let value: JSValue =
        this.get_value(global, this_value, "toBeGreaterThanOrEqual", "<green>expected<r>")?;

    if (!value.is_number() && !value.is_big_int())
        || (!other_value.is_number() && !other_value.is_big_int())
    {
        return Err(global.throw(format_args!(
            "Expected and actual values must be numbers or bigints"
        )));
    }

    let not = this.flags.not();
    let mut pass = false;

    if !value.is_big_int() && !other_value.is_big_int() {
        pass = value.as_number() >= other_value.as_number();
    } else if value.is_big_int() {
        // UFCS: the inherent `JSValue::as_big_int_compare(global, other)` shadows the
        // `JSValueTestExt` trait method which keeps the Phase-A `(other, global)` order
        // and returns `BigIntCompare`. Call the trait method explicitly.
        pass = match JSValueTestExt::as_big_int_compare(value, other_value, global) {
            BigIntCompare::GreaterThan | BigIntCompare::Equal => true,
            _ => pass,
        };
    } else {
        pass = match JSValueTestExt::as_big_int_compare(other_value, value, global) {
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
    // PORT NOTE: reshaped for borrowck — Zig held two `*Formatter` aliases via `toFmt`;
    // Rust `to_fmt(&mut Formatter)` borrows exclusively, so use a second formatter for the
    // expected value (matches the toBeGreaterThan.rs pattern).
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let value_fmt = value.to_fmt(&mut formatter);
    let expected_fmt = other_value.to_fmt(&mut formatter2);
    if not {
        const EXPECTED_LINE: &str = "Expected: not \\>= <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature = get_signature("toBeGreaterThanOrEqual", "<green>expected<r>", true);
        return this.throw_fmt(
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
    let signature = get_signature("toBeGreaterThanOrEqual", "<green>expected<r>", false);
    this.throw_fmt(
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

// ported from: src/test_runner/expect/toBeGreaterThanOrEqual.zig
