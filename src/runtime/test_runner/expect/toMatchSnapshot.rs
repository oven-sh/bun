use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::ZigString;

use super::Expect;
use super::get_signature;
use super::throw;

pub(crate) fn to_match_snapshot(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // reshaped for borrowck — post-match cleanup is expressed by
    // wrapping `this` in a scopeguard so `post_match` runs on every exit path while we still
    // deref through the guard for the body.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let _arguments = frame.arguments_old::<2>();
    let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

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

    let mut hint_string: ZigString = ZigString::EMPTY;
    let mut property_matchers: Option<JSValue> = None;
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                arguments[0].to_zig_string(&mut hint_string, global)?;
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
                let signature =
                    get_signature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false);
                return throw!(
                    this,
                    global,
                    signature,
                    "\n\nMatcher error: Expected <green>properties<r> must be an object\n",
                );
            }

            property_matchers = Some(arguments[0]);

            if arguments[1].is_string() {
                arguments[1].to_zig_string(&mut hint_string, global)?;
            } else {
                return throw!(
                    this,
                    global,
                    "",
                    "\n\nMatcher error: Expected second argument to be a string\n",
                );
            }
        }
    }

    let hint = hint_string.to_slice();
    // `hint` cleanup handled by Drop.

    let value: JSValue = this.get_value(
        global,
        this_value,
        "toMatchSnapshot",
        "<green>properties<r><d>, <r>hint",
    )?;

    Expect::snapshot(&**this, global, value, property_matchers, hint.slice(), "toMatchSnapshot")
}
