use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::expect::Expect;
use crate::expect::get_signature;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_close_to(
        this: &mut Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard captures &mut self and
        // conflicts with later borrows; Phase B reshape (inner fn or explicit calls on each return).
        let _post = scopeguard::guard((), |_| this.post_match(global));

        let this_value = call_frame.this();
        let this_arguments = call_frame.arguments_old(2);
        let arguments = this_arguments.as_slice();

        this.increment_expect_call_counter();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!(
                "toBeCloseTo() requires at least 1 argument. Expected value must be a number"
            ));
        }

        let expected_ = arguments[0];
        if !expected_.is_number() {
            return global.throw_invalid_argument_type("toBeCloseTo", "expected", "number");
        }

        let mut precision: f64 = 2.0;
        if arguments.len() > 1 {
            let precision_ = arguments[1];
            if !precision_.is_number() {
                return global.throw_invalid_argument_type("toBeCloseTo", "precision", "number");
            }

            precision = precision_.as_number();
        }

        let received_: JSValue =
            this.get_value(global, this_value, "toBeCloseTo", "<green>expected<r>, precision")?;
        if !received_.is_number() {
            return global.throw_invalid_argument_type("expect", "received", "number");
        }

        let mut expected = expected_.as_number();
        let mut received = received_.as_number();

        if expected == f64::NEG_INFINITY {
            expected = -expected;
        }

        if received == f64::NEG_INFINITY {
            received = -received;
        }

        if expected == f64::INFINITY && received == f64::INFINITY {
            return Ok(JSValue::UNDEFINED);
        }

        let expected_diff = bun_core::pow(10.0, -precision) / 2.0;
        let actual_diff = (received - expected).abs();
        let mut pass = actual_diff < expected_diff;

        let not = this.flags.not;
        if not {
            pass = !pass;
        }

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = bun_jsc::console_object::Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` — handled by Drop.

        let expected_fmt = expected_.to_fmt(&mut formatter);
        let received_fmt = received_.to_fmt(&mut formatter);

        const EXPECTED_LINE: &str = "Expected: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        const EXPECTED_PRECISION: &str = "Expected precision: {}\n";
        const EXPECTED_DIFFERENCE: &str = "Expected difference: \\< <green>{}<r>\n";
        const RECEIVED_DIFFERENCE: &str = "Received difference: <red>{}<r>\n";

        const SUFFIX_FMT: &str = const_format::concatcp!(
            "\n\n",
            EXPECTED_LINE,
            RECEIVED_LINE,
            "\n",
            EXPECTED_PRECISION,
            EXPECTED_DIFFERENCE,
            RECEIVED_DIFFERENCE,
        );

        // TODO(port): Zig `this.throw(global, signature, fmt, .{args})` passes fmt-string + tuple
        // separately. Rust `format_args!` requires a literal fmt string, so SUFFIX_FMT cannot be
        // threaded as a runtime arg. Phase B: decide `Expect::throw` signature — likely
        // `fn throw(&self, &JSGlobalObject, &str, fmt::Arguments) -> JsResult<JSValue>` and inline
        // SUFFIX_FMT into the `format_args!` call (or make `throw!` a macro).
        if not {
            let signature = get_signature("toBeCloseTo", "<green>expected<r>, precision", true);
            return this.throw(
                global,
                signature,
                SUFFIX_FMT,
                format_args!(
                    "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n\nExpected precision: {}\nExpected difference: \\< <green>{}<r>\nReceived difference: <red>{}<r>\n",
                    expected_fmt, received_fmt, precision, expected_diff, actual_diff
                ),
            );
        }

        let signature = get_signature("toBeCloseTo", "<green>expected<r>, precision", false);
        this.throw(
            global,
            signature,
            SUFFIX_FMT,
            format_args!(
                "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n\nExpected precision: {}\nExpected difference: \\< <green>{}<r>\nReceived difference: <red>{}<r>\n",
                expected_fmt, received_fmt, precision, expected_diff, actual_diff
            ),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeCloseTo.zig (90 lines)
//   confidence: medium
//   todos:      2
//   notes:      defer post_match needs borrowck reshape; Expect::throw fmt-string/args threading undecided
// ──────────────────────────────────────────────────────────────────────────
