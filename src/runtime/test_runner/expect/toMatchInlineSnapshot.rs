use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::throw;
use super::Expect;

pub(crate) fn to_match_inline_snapshot(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // `defer this.postMatch(globalThis)` — wrap `this` in a scopeguard that owns the
    // &mut Expect and runs post_match on drop, so the body can borrow through DerefMut without
    // overlapping with the deferred call (matches toThrowErrorMatchingInlineSnapshot.rs).
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let arguments: &[JSValue] = frame.arguments();

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
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                expected_string = Some(arguments[0].to_js_string_view(global)?);
            } else if arguments[0].is_object() {
                property_matchers = Some(arguments[0]);
            } else {
                return throw!(
                    this,
                    global,
                    "",
                    "\n\nMatcher error: Expected first argument to be a string or object\n",
                );
            }
        }
        _ => {
            if !arguments[0].is_object() {
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

            property_matchers = Some(arguments[0]);

            if arguments[1].is_string() {
                expected_string = Some(arguments[1].to_js_string_view(global)?);
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
    Expect::inline_snapshot(
        &**this,
        global,
        frame,
        value,
        property_matchers,
        expected_slice,
        "toMatchInlineSnapshot",
    )
}
