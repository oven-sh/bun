use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::JSValueTestExt;

use super::Expect;
use super::throw;

impl Expect {
    pub(crate) fn to_match(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toMatch", "<green>expected<r>")?;

        let mut formatter = super::make_formatter(global);

        let expected = expected.to_js();
        if !expected.is_string() && !expected.is_reg_exp() {
            return Err(global.throw(format_args!(
                "Expected value must be a string or regular expression: {}",
                expected.to_fmt(&mut formatter),
            )));
        }

        if !value.is_string() {
            return Err(global.throw(format_args!(
                "Received value must be a string: {}",
                value.to_fmt(&mut formatter),
            )));
        }

        let mut pass: bool = 'brk: {
            if expected.is_string() {
                break 'brk value.string_includes(global, expected)?;
            } else if expected.is_reg_exp() {
                break 'brk expected.to_match(global, value)?;
            }
            unreachable!();
        };

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter2 = super::make_formatter(global);
        let expected_fmt = expected.to_fmt(&mut formatter);
        let value_fmt = value.to_fmt(&mut formatter2);

        if not {
            let signature = Expect::get_signature("toMatch", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                concat!(
                    "\n\n",
                    "Expected substring or pattern: not <green>{}<r>\n",
                    "Received: <red>{}<r>\n",
                ),
                expected_fmt,
                value_fmt,
            );
        }

        let signature = Expect::get_signature("toMatch", "<green>expected<r>", false);
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "Expected substring or pattern: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt,
            value_fmt,
        )
    }
}
