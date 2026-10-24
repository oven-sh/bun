use bun_jsc::JsResult;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

use super::Expect;
use super::throw;
use crate::generated_bindgen::expect::StringOrRegExp;

impl Expect {
    pub(crate) fn to_match(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        (pattern, expected): (StringOrRegExp<'_>, JsLocal<'_>),
    ) -> JsResult<()> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toMatch", "<green>expected<r>")?;

        let mut formatter = super::make_formatter(global);

        if matches!(pattern, StringOrRegExp::Other) {
            return Err(global.throw(format_args!(
                "Expected value must be a string or regular expression: {}",
                expected.to_js().to_fmt(&mut formatter),
            )));
        }

        if !value.is_string() {
            return Err(global.throw(format_args!(
                "Received value must be a string: {}",
                value.to_fmt(&mut formatter),
            )));
        }

        let mut pass: bool = match pattern {
            StringOrRegExp::String(string) => value.string_includes(global, string.to_js())?,
            StringOrRegExp::RegExp(reg_exp) => reg_exp.to_js().to_match(global, value)?,
            StringOrRegExp::Other => unreachable!(),
        };

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(());
        }

        let mut formatter2 = super::make_formatter(global);
        let expected_fmt = expected.to_js().to_fmt(&mut formatter);
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
