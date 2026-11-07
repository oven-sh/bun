use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::throw;
use super::DiffFormatter;
use super::Expect;

impl Expect {
    pub(crate) fn to_equal(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toEqual", "<green>expected<r>")?;

        let expected = expected.to_js();
        let mut pass = value.jest_deep_equals(expected, global)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let diff_formatter = DiffFormatter::new(global, value, expected, not)?;

        if not {
            let signature: &str = Expect::get_signature("toEqual", "<green>expected<r>", true);
            return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
        }

        let signature: &str = Expect::get_signature("toEqual", "<green>expected<r>", false);
        throw!(this, global, signature, "\n\n{}\n", diff_formatter)
    }
}
