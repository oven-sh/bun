use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_jsc::BigIntCompare;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_greater_than(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard would hold a `&mut self`
        // borrow for the whole body; Phase B should reshape (inner-closure or shared-borrow
        // `post_match`) so this runs on every exit path.
        let _post = scopeguard::guard((), |_| this.post_match(global));

        let this_value = frame.this();
        let _arguments = frame.arguments_old(1);
        let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

        if arguments.len() < 1 {
            return global
                .throw_invalid_arguments(format_args!("toBeGreaterThan() requires 1 argument"));
        }

        this.increment_expect_call_counter();

        let other_value = arguments[0];
        other_value.ensure_still_alive();

        let value: JSValue =
            this.get_value(global, this_value, "toBeGreaterThan", "<green>expected<r>")?;

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
            pass = value.as_number() > other_value.as_number();
        } else if value.is_big_int() {
            pass = match value.as_big_int_compare(global, other_value) {
                BigIntCompare::GreaterThan => true,
                _ => pass,
            };
        } else {
            pass = match other_value.as_big_int_compare(global, value) {
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
        // Rust `to_fmt(&mut formatter)` cannot be borrowed twice concurrently. Phase B may
        // need `Formatter` to use interior mutability or take `&self`.
        let mut formatter = Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = other_value.to_fmt(&mut formatter);
        if not {
            // Zig: const expected_line = "Expected: not \\> <green>{f}<r>\n";
            // Zig: const received_line = "Received: <red>{f}<r>\n";
            const SIGNATURE: &str =
                Expect::get_signature("toBeGreaterThan", "<green>expected<r>", true);
            return this.throw(
                global,
                SIGNATURE,
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
        const SIGNATURE: &str =
            Expect::get_signature("toBeGreaterThan", "<green>expected<r>", false);
        this.throw(
            global,
            SIGNATURE,
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeGreaterThan.zig (69 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match + dual &mut Formatter borrow need Phase B reshape; get_signature assumed const fn
// ──────────────────────────────────────────────────────────────────────────
