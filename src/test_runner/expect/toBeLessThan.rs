use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_jsc::BigIntCompare;

use super::Expect;
use super::get_signature;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_less_than(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // `defer this.postMatch(globalThis)` — side effect on every exit path.
        let _post = scopeguard::guard((), |_| this.post_match(global));
        // TODO(port): scopeguard borrows `this` mutably across the fn body; Phase B may need to
        // restructure (e.g. call post_match explicitly on each return) if borrowck rejects this.

        let this_value = frame.this_value();
        let arguments: &[JSValue] = frame.arguments_old(1);

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!(
                "toBeLessThan() requires 1 argument"
            ));
        }

        this.increment_expect_call_counter();

        let other_value = arguments[0];
        other_value.ensure_still_alive();

        let value: JSValue =
            this.get_value(global, this_value, "toBeLessThan", "<green>expected<r>")?;

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
            pass = value.as_number() < other_value.as_number();
        } else if value.is_big_int() {
            pass = match value.as_big_int_compare(global, other_value) {
                BigIntCompare::LessThan => true,
                _ => pass,
            };
        } else {
            pass = match other_value.as_big_int_compare(global, value) {
                BigIntCompare::GreaterThan => true,
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
        // `defer formatter.deinit()` — handled by Drop.
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = other_value.to_fmt(&mut formatter);
        // PORT NOTE: reshaped for borrowck — Zig held two fmt borrows on the same formatter.
        // TODO(port): if to_fmt needs &mut Formatter exclusively, render to owned strings first.

        if not {
            const EXPECTED_LINE: &str = "Expected: not \\< <green>{}<r>\n";
            const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
            let signature = get_signature::<true>("toBeLessThan", "<green>expected<r>");
            return this.throw(
                global,
                signature,
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected: not \\< <green>{}<r>\n",
                        "Received: <red>{}<r>\n"
                    ),
                    expected_fmt, value_fmt
                ),
            );
            // PERF(port): Zig used comptime string concat (`++`); concat! is the Rust equivalent.
            // The separate EXPECTED_LINE/RECEIVED_LINE consts above are kept for diff parity only.
            #[allow(unused)]
            let _ = (EXPECTED_LINE, RECEIVED_LINE);
        }

        const EXPECTED_LINE: &str = "Expected: \\< <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        let signature = get_signature::<false>("toBeLessThan", "<green>expected<r>");
        #[allow(unused)]
        let _ = (EXPECTED_LINE, RECEIVED_LINE);
        this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected: \\< <green>{}<r>\n",
                    "Received: <red>{}<r>\n"
                ),
                expected_fmt, value_fmt
            ),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeLessThan.zig (69 lines)
//   confidence: medium
//   todos:      2
//   notes:      scopeguard for post_match conflicts with &mut self; to_fmt double-borrow on Formatter
// ──────────────────────────────────────────────────────────────────────────
