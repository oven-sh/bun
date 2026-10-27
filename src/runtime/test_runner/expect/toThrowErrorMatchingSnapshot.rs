use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_throw_error_matching_snapshot(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        hint: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        if not {
            let signature = get_signature("toThrowErrorMatchingSnapshot", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n",
            );
        }

        let Some(bun_test_strong) = this.bun_test() else {
            let signature = get_signature("toThrowErrorMatchingSnapshot", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n",
            );
        };
        let _ = &bun_test_strong;

        let mut hint_string = None;
        let hint = hint.to_js();
        if hint.is_string() {
            hint_string = Some(hint.to_js_string_view(global)?);
        } else if !hint.is_undefined() {
            return throw!(
                this,
                global,
                "",
                "\n\nMatcher error: Expected first argument to be a string\n",
            );
        }

        let hint = hint_string.as_ref().map_or(bun_core::Utf8Bytes::EMPTY, |s| s.to_utf8());

        let Some(value): Option<JSValue> = this.fn_to_err_string_or_undefined(
            global,
            this.get_value(
                global,
                this_value,
                "toThrowErrorMatchingSnapshot",
                "<green>properties<r><d>, <r>hint",
            )?,
        )?
        else {
            let signature = get_signature("toThrowErrorMatchingSnapshot", "", false);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Received function did not throw\n",
            );
        };

        this.snapshot(global, value, None, hint.slice(), "toThrowErrorMatchingSnapshot")
    }
}
