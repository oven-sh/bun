use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::ZigString;

use super::throw;
use super::Expect;

pub(crate) fn to_throw_error_matching_inline_snapshot(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // The guard owns the &mut, Derefs to it, and runs post_match on Drop.
    let this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let _arguments = frame.arguments_old::<2>();
    let arguments: &[JSValue] = _arguments.slice();

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

    let mut has_expected = false;
    let mut expected_string: ZigString = ZigString::EMPTY;
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                has_expected = true;
                arguments[0].to_zig_string(&mut expected_string, global)?;
            } else {
                return throw!(
                    this,
                    global,
                    "",
                    "\n\nMatcher error: Expected first argument to be a string\n",
                );
            }
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

    // The returned slice owns its buffer and frees on Drop.
    let expected = expected_string.to_slice();

    let expected_slice: Option<&[u8]> = if has_expected { Some(expected.slice()) } else { None };

    // reshaped for borrowck — hoist get_value out so the two &mut self
    // receivers don't overlap.
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

    Expect::inline_snapshot(
        &**this,
        global,
        frame,
        value,
        None,
        expected_slice,
        "toThrowErrorMatchingInlineSnapshot",
    )
}
