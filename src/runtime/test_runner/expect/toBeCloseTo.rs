use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_close_to(
        &self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);

        let this_value = call_frame.this();
        let arguments = call_frame.arguments();

        this.increment_expect_call_counter();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toBeCloseTo() requires at least 1 argument. Expected value must be a number"
            )));
        }

        let expected_ = arguments[0];
        if !expected_.is_number() {
            return Err(global.throw_invalid_argument_type("toBeCloseTo", "expected", "number"));
        }

        let mut precision: f64 = 2.0;
        if arguments.len() > 1 {
            let precision_ = arguments[1];
            if !precision_.is_number() {
                return Err(global.throw_invalid_argument_type("toBeCloseTo", "precision", "number"));
            }

            precision = precision_.as_number();
        }

        let received_: JSValue =
            this.get_value(global, this_value, "toBeCloseTo", "<green>expected<r>, precision")?;
        if !received_.is_number() {
            return Err(global.throw_invalid_argument_type("expect", "received", "number"));
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

        let expected_diff = 10.0_f64.powf(-precision) / 2.0;
        let actual_diff = (received - expected).abs();
        let mut pass = actual_diff < expected_diff;

        let not = this.flags.get().not();
        if not {
            pass = !pass;
        }

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // The `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters
        // cannot alias the same backing formatter. Use a second formatter for the
        // received value — `make_formatter` is a trivial struct init and the
        // formatters carry no shared state between values.
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        // `defer formatter.deinit()` — handled by Drop.

        let expected_fmt = expected_.to_fmt(&mut formatter);
        let received_fmt = received_.to_fmt(&mut formatter2);

        if not {
            let signature = get_signature("toBeCloseTo", "<green>expected<r>, precision", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n\nExpected precision: {}\nExpected difference: \\< <green>{}<r>\nReceived difference: <red>{}<r>\n",
                expected_fmt, received_fmt, precision, expected_diff, actual_diff
            );
        }

        let signature = get_signature("toBeCloseTo", "<green>expected<r>, precision", false);
        throw!(
            this,
            global,
            signature,
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n\nExpected precision: {}\nExpected difference: \\< <green>{}<r>\nReceived difference: <red>{}<r>\n",
            expected_fmt, received_fmt, precision, expected_diff, actual_diff
        )
    }
}

