use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::throw;
use crate::generated_bindgen::expect::SnapshotArgument;

impl Expect {
    pub(crate) fn to_match_inline_snapshot(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        first: Option<SnapshotArgument<'_>>,
        second: Option<SnapshotArgument<'_>>,
    ) -> JsResult<()> {
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
        match (first, second) {
            (None, _) => {}
            (Some(first), None) => match first {
                SnapshotArgument::String(string) => {
                    expected_string = Some(string.to_js().to_js_string_view(global)?);
                }
                SnapshotArgument::StringObject(object) => {
                    expected_string = Some(object.to_js().to_js_string_view(global)?);
                }
                SnapshotArgument::Object(object) => property_matchers = Some(object.to_js()),
                SnapshotArgument::Absent | SnapshotArgument::Other => {
                    return throw!(
                        this,
                        global,
                        "",
                        "\n\nMatcher error: Expected first argument to be a string or object\n",
                    );
                }
            },
            (Some(first), Some(second)) => {
                property_matchers = Some(match first {
                    SnapshotArgument::StringObject(object) => object.to_js(),
                    SnapshotArgument::Object(object) => object.to_js(),
                    SnapshotArgument::Absent
                    | SnapshotArgument::String(_)
                    | SnapshotArgument::Other => {
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
                });
                match second {
                    SnapshotArgument::String(string) => {
                        expected_string = Some(string.to_js().to_js_string_view(global)?);
                    }
                    SnapshotArgument::StringObject(object) => {
                        expected_string = Some(object.to_js().to_js_string_view(global)?);
                    }
                    SnapshotArgument::Absent
                    | SnapshotArgument::Object(_)
                    | SnapshotArgument::Other => {}
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
