use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_within(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // defer this.postMatch(globalThis);
        let mut this = scopeguard::guard(this, |t| t.post_match(global));

        let this_value = frame.this_value();
        let _arguments = frame.arguments_old(2);
        let arguments = _arguments.as_slice();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!(
                "toBeWithin() requires 2 arguments"
            ));
        }

        let value: JSValue = this.get_value(
            global,
            this_value,
            "toBeWithin",
            "<green>start<r><d>, <r><green>end<r>",
        )?;

        let start_value = arguments[0];
        start_value.ensure_still_alive();

        if !start_value.is_number() {
            return global.throw(format_args!(
                "toBeWithin() requires the first argument to be a number"
            ));
        }

        let end_value = arguments[1];
        end_value.ensure_still_alive();

        if !end_value.is_number() {
            return global.throw(format_args!(
                "toBeWithin() requires the second argument to be a number"
            ));
        }

        this.increment_expect_call_counter();

        let mut pass = value.is_number();
        if pass {
            let num = value.as_number();
            pass = num >= start_value.as_number() && num < end_value.as_number();
        }

        let not = this.flags.not;
        if not {
            pass = !pass;
        }

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // TODO(port): verify Formatter constructor signature (Zig: .{ .globalThis = globalThis, .quote_strings = true })
        let formatter = Formatter::new(global, /* quote_strings */ true);
        // defer formatter.deinit(); — handled by Drop
        // PORT NOTE: reshaped for borrowck — to_fmt takes &Formatter (shared) so three live wrappers coexist
        let start_fmt = start_value.to_fmt(&formatter);
        let end_fmt = end_value.to_fmt(&formatter);
        let received_fmt = value.to_fmt(&formatter);

        if not {
            let signature = Expect::get_signature(
                "toBeWithin",
                "<green>start<r><d>, <r><green>end<r>",
                true,
            );
            return this.throw(
                global,
                signature,
                format_args!(
                    concat!(
                        "\n\n",
                        "Expected: not between <green>{}<r> <d>(inclusive)<r> and <green>{}<r> <d>(exclusive)<r>\n",
                        "Received: <red>{}<r>\n",
                    ),
                    start_fmt,
                    end_fmt,
                    received_fmt,
                ),
            );
        }

        let signature = Expect::get_signature(
            "toBeWithin",
            "<green>start<r><d>, <r><green>end<r>",
            false,
        );
        this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected: between <green>{}<r> <d>(inclusive)<r> and <green>{}<r> <d>(exclusive)<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                start_fmt,
                end_fmt,
                received_fmt,
            ),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeWithin.zig (68 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard wraps `this` for post_match defer; Formatter ctor + Expect::throw/get_signature signatures need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
