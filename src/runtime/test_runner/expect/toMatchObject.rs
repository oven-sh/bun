use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::DiffFormatter;
use super::throw;
use super::{get_signature, Expect};

impl Expect {
    pub(crate) fn to_match_object(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, received_object, not) =
            self.matcher_prelude(global, this_value.to_js(), "toMatchObject", "<green>expected<r>")?;
        let expected = expected.to_js();

        // Jest refuses a value that isn't an object. To Vitest it's one that doesn't match.
        if not && !(received_object.is_object() && expected.is_object()) && this.is_vitest() {
            return Ok(JSValue::UNDEFINED);
        }

        if !received_object.is_object() {
            let signature: &str = get_signature("toMatchObject", "<green>expected<r>", not);
            return throw!(
                this, global, signature,
                "\n\n<b>Matcher error<r>: <red>received<r> value must be a non-null object\n",
            );
        }

        if !expected.is_object() {
            let signature: &str = get_signature("toMatchObject", "", not);
            return throw!(
                this, global, signature,
                "\n\n<b>Matcher error<r>: <green>expected<r> value must be a non-null object\n",
            );
        }

        if not {
            // The message shows only the pattern.
            let (matched, _) = received_object.jest_deep_match(expected, global, false)?;
            if !matched {
                return Ok(JSValue::UNDEFINED);
            }
            let diff_formatter = DiffFormatter::new(global, received_object, expected, true)?;
            let signature: &str = get_signature("toMatchObject", "<green>expected<r>", true);
            return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
        }

        // The comparison records nothing. The diff of a failure finds the matchers that passed, from `stop` on.
        let (matched, stop) = received_object.jest_deep_match_telling_where(expected, global)?;
        if matched {
            return Ok(JSValue::UNDEFINED);
        }
        let diff_formatter = DiffFormatter::of_failed_match(global, received_object, expected, &stop)?;
        let signature: &str = get_signature("toMatchObject", "<green>expected<r>", false);
        throw!(this, global, signature, "\n\n{}\n", diff_formatter)
    }
}
