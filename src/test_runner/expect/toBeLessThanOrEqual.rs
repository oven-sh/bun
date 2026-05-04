use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter as ConsoleFormatter;
use bun_jsc::BigIntCompare;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_less_than_or_equal(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let _post = scopeguard::guard((), |_| this.post_match(global));
        // TODO(port): errdefer — scopeguard above borrows `this` and `global` for the whole scope; Phase B may need to reshape if borrowck rejects.

        let this_value = frame.this();
        let _arguments = frame.arguments_old(1);
        let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!(
                "toBeLessThanOrEqual() requires 1 argument"
            ));
        }

        this.increment_expect_call_counter();

        let other_value = arguments[0];
        other_value.ensure_still_alive();

        let value: JSValue =
            this.get_value(global, this_value, "toBeLessThanOrEqual", "<green>expected<r>")?;

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
            pass = value.as_number() <= other_value.as_number();
        } else if value.is_big_int() {
            pass = match value.as_big_int_compare(global, other_value) {
                BigIntCompare::LessThan | BigIntCompare::Equal => true,
                _ => pass,
            };
        } else {
            pass = match other_value.as_big_int_compare(global, value) {
                BigIntCompare::GreaterThan | BigIntCompare::Equal => true,
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
        let mut formatter = ConsoleFormatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = other_value.to_fmt(&mut formatter);
        if not {
            const EXPECTED_LINE: &str = "Expected: not \\<= <green>{}<r>\n";
            const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
            let signature = const { Expect::get_signature("toBeLessThanOrEqual", "<green>expected<r>", true) };
            return this.throw(
                global,
                signature,
                concat!("\n\n", "Expected: not \\<= <green>{}<r>\n", "Received: <red>{}<r>\n"),
                format_args!(
                    "\n\nExpected: not \\<= <green>{}<r>\nReceived: <red>{}<r>\n",
                    expected_fmt, value_fmt
                ),
            );
            // TODO(port): Zig passes (signature, fmt, args) — Rust `throw` likely takes (signature, format_args!); the `concat!` literal above mirrors the Zig `++` for diff parity. Phase B: collapse to a single format_args! arg.
        }

        const EXPECTED_LINE: &str = "Expected: \\<= <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature = const { Expect::get_signature("toBeLessThanOrEqual", "<green>expected<r>", false) };
        this.throw(
            global,
            signature,
            concat!("\n\n", "Expected: \\<= <green>{}<r>\n", "Received: <red>{}<r>\n"),
            format_args!(
                "\n\nExpected: \\<= <green>{}<r>\nReceived: <red>{}<r>\n",
                expected_fmt, value_fmt
            ),
        )
        // TODO(port): same as above — reconcile `throw` arity in Phase B.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeLessThanOrEqual.zig (69 lines)
//   confidence: medium
//   todos:      3
//   notes:      scopeguard for postMatch borrows `this`+`global` (borrowck risk); Expect.throw signature in Rust unclear (Zig: signature, fmt, args tuple).
// ──────────────────────────────────────────────────────────────────────────
