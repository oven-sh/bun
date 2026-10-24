use super::DiffFormatter;
use super::throw;
use super::{Expect, get_signature};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSObject, JsResult};

impl Expect {
    pub(crate) fn to_match_object(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: Option<JsLocal<'_, JSObject>>,
    ) -> JsResult<()> {
        let global = cx.global();
        let (this, received_object, not) = self.matcher_prelude(
            global,
            this_value.to_js(),
            "toMatchObject",
            "<green>expected<r>",
        )?;
        if !received_object.is_object() {
            let signature: &str = get_signature("toMatchObject", "<green>expected<r>", not);
            return throw!(
                this, global, signature,
                "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n",
            );
        }

        let Some(expected) = expected else {
            let signature: &str = get_signature("toMatchObject", "", not);
            return throw!(
                this, global, signature,
                "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n",
            );
        };
        let expected = expected.to_js();

        let mut pass = received_object.jest_deep_match(expected, global, true)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(());
        }

        // handle failure
        let diff_formatter = DiffFormatter::new(global, received_object, expected, not)?;

        if not {
            let signature: &str = get_signature("toMatchObject", "<green>expected<r>", true);
            return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
        }

        let signature: &str = get_signature("toMatchObject", "<green>expected<r>", false);
        throw!(this, global, signature, "\n\n{}\n", diff_formatter)
    }
}
