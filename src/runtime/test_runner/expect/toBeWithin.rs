use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::{throw, Expect};

impl Expect {
    pub(crate) fn to_be_within(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        start_value: JsLocal<'_>,
        end_value: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) = self.matcher_prelude(
            global,
            this_value.to_js(),
            "toBeWithin",
            "<green>start<r><d>, <r><green>end<r>",
        )?;

        let start_value = start_value.to_js();
        start_value.ensure_still_alive();

        if !start_value.is_number() {
            return Err(global.throw(format_args!(
                "toBeWithin() requires the first argument to be a number"
            )));
        }

        let end_value = end_value.to_js();
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

        // `to_fmt` takes `&mut Formatter` and the adapter holds the borrow, so three
        // live adapters need three formatters (matches toBeLessThan.rs / toContainEqual.rs).
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        let mut formatter3 = super::make_formatter(global);
        let start_fmt = start_value.to_fmt(&mut formatter);
        let end_fmt = end_value.to_fmt(&mut formatter2);
        let received_fmt = value.to_fmt(&mut formatter3);

        if not {
            let signature = Expect::get_signature(
                "toBeWithin",
                "<green>start<r><d>, <r><green>end<r>",
                true,
            );
            return throw!(
                this,
                global,
                signature,
                concat!(
                    "\n\n",
                    "Expected: not between <green>{}<r> <d>(inclusive)<r> and <green>{}<r> <d>(exclusive)<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                start_fmt,
                end_fmt,
                received_fmt,
            );
        }

        let signature = Expect::get_signature(
            "toBeWithin",
            "<green>start<r><d>, <r><green>end<r>",
            false,
        );
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected: between <green>{}<r> <d>(inclusive)<r> and <green>{}<r> <d>(exclusive)<r>\n",
                "Received: <red>{}<r>\n",
            ),
            start_fmt,
            end_fmt,
            received_fmt,
        )
    }
}
