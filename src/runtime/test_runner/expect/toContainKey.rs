use bun_jsc::console_object::Formatter;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_key(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(global)` becomes a
        // scopeguard that owns the &mut and DerefMut's it for the body.
        let mut this = scopeguard::guard(this, |this| this.post_match(global));

        let this_value = frame.this();
        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toContainKey() takes 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        expected.ensure_still_alive();
        let value: JSValue =
            this.get_value(global, this_value, "toContainKey", "<green>expected<r>")?;
        let mut formatter = super::make_formatter(global);
        // `defer formatter.deinit()` — handled by Drop.

        let not = this.flags.not();
        if !value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Expected value must be an object\nReceived: {}",
                value.to_fmt(&mut formatter),
            )));
        }

        let mut pass = value.has_own_property_value(global, expected)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        // handle failure
        // PORT NOTE: Zig held two `value.toFmt(&formatter)` results live at once; in Rust each
        // `to_fmt` borrows `&mut Formatter` for the lifetime of the returned adapter, so allocate
        // a second formatter for the other value.
        let mut formatter2 = super::make_formatter(global);
        if not {
            let expected_fmt = expected.to_fmt(&mut formatter);
            let received_fmt = value.to_fmt(&mut formatter2);
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

        let expected_fmt = expected.to_fmt(&mut formatter);
        let value_fmt = value.to_fmt(&mut formatter2);
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

// ported from: src/test_runner/expect/toContainKey.zig
