use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::{throw, Expect};

impl Expect {
    pub(crate) fn to_be_within(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        start: JsLocal<'_>,
        end: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) = self.matcher_prelude(
            global,
            this_value.to_js(),
            "toBeWithin",
            "<green>start<r><d>, <r><green>end<r>",
        )?;

        let start = start.to_js();

        if !start.is_number() {
            return Err(global.throw(format_args!(
                "toBeWithin() requires the first argument to be a number"
            )));
        }

        let end = end.to_js();

        if !end.is_number() {
            return Err(global.throw(format_args!(
                "toBeWithin() requires the second argument to be a number"
            )));
        }

        let mut pass = value.is_number();
        if pass {
            let num = value.as_number();
            pass = num >= start.as_number() && num < end.as_number();
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
        let start_fmt = start.to_fmt(&mut formatter);
        let end_fmt = end.to_fmt(&mut formatter2);
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
