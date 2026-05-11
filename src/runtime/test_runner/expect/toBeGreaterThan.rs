use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_greater_than(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` is modeled by
        // wrapping `this` in a scopeguard so `post_match` runs on every exit path while the body
        // still has `&mut Expect` access via DerefMut.
        let this = scopeguard::guard(self, |this| this.post_match(global));

        let this_value = frame.this();
        let _arguments = frame.arguments_old::<1>();
        let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toBeGreaterThan() requires 1 argument")));
        }

        this.increment_expect_call_counter();

        let other_value = arguments[0];
        other_value.ensure_still_alive();

        let value: JSValue =
            this.get_value(global, this_value, "toBeGreaterThan", "<green>expected<r>")?;

        if (!value.is_number() && !value.is_big_int())
            || (!other_value.is_number() && !other_value.is_big_int())
        {
            return Err(global.throw(format_args!(
                "Expected and actual values must be numbers or bigints"
            )));
        }

        let not = this.flags.get().not();
        let mut pass = false;

        if !value.is_big_int() && !other_value.is_big_int() {
            pass = value.as_number() > other_value.as_number();
        } else if value.is_big_int() {
            // UFCS: the inherent `JSValue::as_big_int_compare(global, other)` shadows the
            // `JSValueTestExt` adapter that keeps the Phase-A `(other, global)` ordering
            // and returns `BigIntCompare`. Call the trait method explicitly.
            pass = match JSValueTestExt::as_big_int_compare(value, other_value, global) {
                BigIntCompare::GreaterThan => true,
                _ => pass,
            };
        } else {
            pass = match JSValueTestExt::as_big_int_compare(other_value, value, global) {
                BigIntCompare::LessThan => true,
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
        // expected value (matches the toBeOneOf.rs pattern).
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = other_value.to_fmt(&mut formatter2);
        if not {
            // Zig: const expected_line = "Expected: not \\> <green>{f}<r>\n";
            // Zig: const received_line = "Received: <red>{f}<r>\n";
            let signature: &str =
                Expect::get_signature("toBeGreaterThan", "<green>expected<r>", true);
            return this.throw(
                global,
                signature,
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected: not \\> <green>{}<r>\n",
                        "Received: <red>{}<r>\n",
                    ),
                    expected_fmt, value_fmt
                ),
            );
        }

        // Zig: const expected_line = "Expected: \\> <green>{f}<r>\n";
        // Zig: const received_line = "Received: <red>{f}<r>\n";
        let signature: &str =
            Expect::get_signature("toBeGreaterThan", "<green>expected<r>", false);
        this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected: \\> <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt, value_fmt
            ),
        )
    }
}

// ported from: src/test_runner/expect/toBeGreaterThan.zig
