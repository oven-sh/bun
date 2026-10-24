use bun_jsc::JsResult;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

use super::DiffFormatter;
use super::Expect;
use super::throw;

impl Expect {
    pub(crate) fn to_strict_equal(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toStrictEqual", "<green>expected<r>")?;

        let mut pass = value.jest_strict_deep_equals(expected.to_js(), global)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(());
        }

        // handle failure
        let diff_formatter = DiffFormatter::new(global, value, expected.to_js(), not)?;

        if not {
            let signature = Expect::get_signature("toStrictEqual", "<green>expected<r>", true);
            return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
        }

        let signature = Expect::get_signature("toStrictEqual", "<green>expected<r>", false);
        throw!(this, global, signature, "\n\n{}\n", diff_formatter)
    }
}
