use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;
use crate::generated_bindgen::expect::SnapshotArgument;

impl Expect {
    pub(crate) fn to_match_snapshot(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        first: SnapshotArgument<'_>,
        second: SnapshotArgument<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

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
        if !matches!(second, SnapshotArgument::Absent) {
            property_matchers = Some(match first {
                SnapshotArgument::StringObject(object) => object.to_js(),
                SnapshotArgument::Object(object) => object.to_js(),
                SnapshotArgument::Absent
                | SnapshotArgument::String(_)
                | SnapshotArgument::Other => {
                    let signature =
                        get_signature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
                    return throw!(
                        this,
                        global,
                        signature,
                        "\n\nMatcher error: Expected <green>properties<r> must be an object\n",
                    );
                }
            });
            hint_string = Some(match second {
                SnapshotArgument::String(string) => string.to_js().to_js_string_view(global)?,
                SnapshotArgument::StringObject(object) => {
                    object.to_js().to_js_string_view(global)?
                }
                SnapshotArgument::Absent
                | SnapshotArgument::Object(_)
                | SnapshotArgument::Other => {
                    return throw!(
                        this,
                        global,
                        "",
                        "\n\nMatcher error: Expected second argument to be a string\n",
                    );
                }
            });
        } else {
            match first {
                SnapshotArgument::String(string) => {
                    hint_string = Some(string.to_js().to_js_string_view(global)?);
                }
                SnapshotArgument::StringObject(object) => {
                    hint_string = Some(object.to_js().to_js_string_view(global)?);
                }
                SnapshotArgument::Object(object) => property_matchers = Some(object.to_js()),
                SnapshotArgument::Absent => {}
                SnapshotArgument::Other => {
                    return throw!(
                        this,
                        global,
                        "",
                        "\n\nMatcher error: Expected first argument to be a string or object\n",
                    );
                }
            }
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
