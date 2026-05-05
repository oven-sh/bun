use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::ZigString;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_match_inline_snapshot(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard here overlaps with &mut this;
    // Phase B should reshape (raw-ptr guard or RAII helper on Expect).
    scopeguard::defer! { this.post_match(global); }

    let this_value = frame.this_value();
    let arguments: &[JSValue] = frame.arguments_old(2);

    this.increment_expect_call_counter();

    let not = this.flags.not;
    if not {
        let signature = Expect::get_signature("toMatchInlineSnapshot", "", true);
        return this.throw(
            global,
            signature,
            format_args!(
                "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n"
            ),
        );
    }

    let mut has_expected = false;
    let mut expected_string: ZigString = ZigString::EMPTY;
    let mut property_matchers: Option<JSValue> = None;
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                has_expected = true;
                arguments[0].to_zig_string(&mut expected_string, global)?;
            } else if arguments[0].is_object() {
                property_matchers = Some(arguments[0]);
            } else {
                return this.throw(
                    global,
                    "",
                    format_args!(
                        "\n\nMatcher error: Expected first argument to be a string or object\n"
                    ),
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
                return this.throw(
                    global,
                    signature,
                    format_args!(
                        "\n\nMatcher error: Expected <green>properties<r> must be an object\n"
                    ),
                );
            }

            property_matchers = Some(arguments[0]);

            if arguments[1].is_string() {
                has_expected = true;
                arguments[1].to_zig_string(&mut expected_string, global)?;
            }
        }
    }

    let expected = expected_string.to_slice();
    // `defer expected.deinit()` — handled by Drop on the returned slice guard.

    let expected_slice: Option<&[u8]> = if has_expected { Some(expected.slice()) } else { None };

    let value = this.get_value(
        global,
        this_value,
        "toMatchInlineSnapshot",
        "<green>properties<r><d>, <r>hint",
    )?;
    this.inline_snapshot(
        global,
        frame,
        value,
        property_matchers,
        expected_slice,
        "toMatchInlineSnapshot",
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toMatchInlineSnapshot.zig (64 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck reshape; get_signature assumed const fn -> &'static str
// ──────────────────────────────────────────────────────────────────────────
