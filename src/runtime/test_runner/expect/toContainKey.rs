use bun_jsc::console_object::Formatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_key(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(global)` — scopeguard would hold &mut self across the
        // whole body; Phase B should reshape (e.g. RAII guard on Expect or explicit calls per path).
        let _post = scopeguard::guard((), |_| this.post_match(global));

        let this_value = frame.this();
        let arguments_ = frame.arguments_old(1);
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!("toContainKey() takes 1 argument"));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        expected.ensure_still_alive();
        let value: JSValue =
            this.get_value(global, this_value, "toContainKey", "<green>expected<r>")?;
        let mut formatter = Formatter {
            global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` — handled by Drop.

        let not = this.flags.not;
        if !value.is_object() {
            return global.throw_invalid_arguments(format_args!(
                "Expected value must be an object\nReceived: {}",
                value.to_fmt(&mut formatter),
            ));
        }

        let mut pass = value.has_own_property_value(global, expected)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        // handle failure

        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = expected.to_fmt(&mut formatter);
        if not {
            let received_fmt = value.to_fmt(&mut formatter);
            let signature = Expect::get_signature("toContainKey", "<green>expected<r>", true);
            return this.throw(
                global,
                signature,
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                    ),
                    expected_fmt,
                    received_fmt,
                ),
            );
        }

        let signature = Expect::get_signature("toContainKey", "<green>expected<r>", false);
        this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to contain: <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt,
                value_fmt,
            ),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainKey.zig (58 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck reshape
// ──────────────────────────────────────────────────────────────────────────
