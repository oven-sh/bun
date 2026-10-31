use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::throw;
use super::Expect;

impl Expect {
    pub(crate) fn to_match_inline_snapshot(
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
            let signature = Expect::get_signature("toMatchInlineSnapshot", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n",
            );
        }

        let mut expected_string = None;
        let mut property_matchers: Option<JSValue> = None;
        match *args {
            [] => {}
            [first] => {
                let first = first.to_js();
                if first.is_string() {
                    expected_string = Some(first.to_js_string_view(global)?);
                } else if first.is_object() {
                    property_matchers = Some(first);
                } else {
                    return throw!(
                        this,
                        global,
                        "",
                        "\n\nMatcher error: Expected first argument to be a string or object\n",
                    );
                }
            }
            [first, second, ..] => {
                let (first, second) = (first.to_js(), second.to_js());
                if !first.is_object() {
                    let signature = Expect::get_signature(
                        "toMatchInlineSnapshot",
                        "<green>properties<r><d>, <r>hint",
                        false,
                    );
                    return throw!(
                        this,
                        global,
                        signature,
                        "\n\nMatcher error: Expected <green>properties<r> must be an object\n",
                    );
                }

                property_matchers = Some(first);

                if second.is_string() {
                    expected_string = Some(second.to_js_string_view(global)?);
                }
            }
        }

        let expected = expected_string.as_ref().map(|s| s.to_utf8());

        let expected_slice = expected.as_ref().map(|s| s.slice());

        let value = this.get_value(
            global,
            this_value,
            "toMatchInlineSnapshot",
            "<green>properties<r><d>, <r>hint",
        )?;
        this.inline_snapshot(
            global,
            value,
            property_matchers,
            expected_slice,
            "toMatchInlineSnapshot",
        )
    }
}
