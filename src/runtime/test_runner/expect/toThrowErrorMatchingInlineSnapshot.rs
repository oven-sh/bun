use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::throw;
use super::Expect;

impl Expect {
    pub(crate) fn to_throw_error_matching_inline_snapshot(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        if not {
            let signature = Expect::get_signature("toThrowErrorMatchingInlineSnapshot", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n",
            );
        }

        let mut expected_string = None;
        match *args {
            [] => {}
            [expected] if expected.to_js().is_string() => {
                expected_string = Some(expected.to_js().to_js_string_view(global)?);
            }
            [_] => {
                return throw!(
                    this,
                    global,
                    "",
                    "\n\nMatcher error: Expected first argument to be a string\n",
                );
            }
            _ => {
                return throw!(
                    this,
                    global,
                    "",
                    "\n\nMatcher error: Expected zero or one arguments\n",
                );
            }
        }

        let expected = expected_string.as_ref().map(|s| s.to_utf8());

        let expected_slice = expected.as_ref().map(|s| s.slice());

        let received = this.get_value(
            global,
            this_value,
            "toThrowErrorMatchingInlineSnapshot",
            "<green>properties<r><d>, <r>hint",
        )?;
        let Some(value) = this.fn_to_err_string_or_undefined(global, received)? else {
            let signature = Expect::get_signature("toThrowErrorMatchingInlineSnapshot", "", false);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Received function did not throw\n",
            );
        };

        this.inline_snapshot(
            global,
            value,
            None,
            expected_slice,
            "toThrowErrorMatchingInlineSnapshot",
        )
    }
}
