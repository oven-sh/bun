use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::DiffFormatter;
use crate::test_runner::matched_matchers::MatchedMatchers;
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

        let mut pass = received_object.jest_deep_match(expected, global)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        // Only here is the walk repeated, to learn which matchers passed
        // before it stopped. Their lines are common to both sides of the diff.
        let (_, matched_matchers) = MatchedMatchers::deep_match(received_object, expected, global)?;
        let diff_formatter = DiffFormatter::with_matched_matchers(
            global,
            received_object,
            expected,
            not,
            matched_matchers,
        )?;

        if not {
            let signature: &str = get_signature("toMatchObject", "<green>expected<r>", true);
            return throw!(this, global, signature, "\n\n{}\n", diff_formatter);
        }

        let signature: &str = get_signature("toMatchObject", "<green>expected<r>", false);
        throw!(this, global, signature, "\n\n{}\n", diff_formatter)
    }
}
