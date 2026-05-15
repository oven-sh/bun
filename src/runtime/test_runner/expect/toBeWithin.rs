use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
#[allow(unused_imports)] use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_be_within(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let (this, value, not) = self.matcher_prelude(
            global,
            frame.this(),
            "toBeWithin",
            "<green>start<r><d>, <r><green>end<r>",
        )?;

        let _arguments = frame.arguments_old::<2>();
        let arguments = _arguments.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toBeWithin() requires 2 arguments"
            )));
        }

        let start_value = arguments[0];
        start_value.ensure_still_alive();

        if !start_value.is_number() {
            return Err(global.throw(format_args!(
                "toBeWithin() requires the first argument to be a number"
            )));
        }

        let end_value = arguments[1];
        end_value.ensure_still_alive();

        if !end_value.is_number() {
            return Err(global.throw(format_args!(
                "toBeWithin() requires the second argument to be a number"
            )));
        }

        let mut pass = value.is_number();
        if pass {
            let num = value.as_number();
            pass = num >= start_value.as_number() && num < end_value.as_number();
        }

        if not {
            pass = !pass;
        }

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // Zig: .{ .globalThis = globalThis, .quote_strings = true } — make_formatter sets quote_strings.
        // PORT NOTE: Zig aliased one `*Formatter` for all three fmt adapters; Rust `to_fmt`
        // takes `&mut Formatter` so three live adapters need three formatters (matches
        // toBeLessThan.rs / toContainEqual.rs).
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let mut formatter3 = super::make_formatter(global);
        // defer formatter.deinit(); — handled by Drop
        let start_fmt = start_value.to_fmt(&mut formatter);
        let end_fmt = end_value.to_fmt(&mut formatter2);
        let received_fmt = value.to_fmt(&mut formatter3);

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

// ported from: src/test_runner/expect/toBeWithin.zig
