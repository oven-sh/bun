use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_match_snapshot(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        property_matchers: JsLocal<'_>,
        hint: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();
        let first = property_matchers.to_js();
        let second = hint.to_js();

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        if not {
            let signature = get_signature("toMatchSnapshot", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n",
            );
        }

        let Some(buntest_strong) = this.bun_test() else {
            let signature = get_signature("toMatchSnapshot", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n",
            );
        };
        let _ = buntest_strong; // released by Drop at scope exit.

        let mut hint_string = None;
        let mut property_matchers: Option<JSValue> = None;
        if !second.is_undefined() {
            if !first.is_object() {
                let signature =
                    get_signature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
                return throw!(
                    this,
                    global,
                    signature,
                    "\n\nMatcher error: Expected <green>properties<r> must be an object\n",
                );
            }

            property_matchers = Some(first);

            if second.is_string() {
                hint_string = Some(second.to_js_string_view(global)?);
            } else {
                return throw!(
                    this,
                    global,
                    "",
                    "\n\nMatcher error: Expected second argument to be a string\n",
                );
            }
        } else if first.is_string() {
            hint_string = Some(first.to_js_string_view(global)?);
        } else if first.is_object() {
            property_matchers = Some(first);
        } else if !first.is_undefined() {
            return throw!(
                this,
                global,
                "",
                "\n\nMatcher error: Expected first argument to be a string or object\n",
            );
        }

        let hint = hint_string.as_ref().map_or(bun_core::Utf8Bytes::EMPTY, |s| s.to_utf8());

        let value: JSValue = this.get_value(
            global,
            this_value,
            "toMatchSnapshot",
            "<green>properties<r><d>, <r>hint",
        )?;

        this.snapshot(global, value, property_matchers, hint.slice(), "toMatchSnapshot")
    }
}
