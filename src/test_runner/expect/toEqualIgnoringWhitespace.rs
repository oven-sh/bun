use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_test_runner::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_equal_ignoring_whitespace(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — scopeguard owns the &mut Self for the scope.
    let this = scopeguard::guard(this, |this| this.post_match(global));
    let this = &mut **this;

    let this_value = frame.this();
    // TODO(port): arguments_old(1) returned a struct with ptr/len; assume &[JSValue] here.
    let arguments: &[JSValue] = frame.arguments_old(1);

    if arguments.len() < 1 {
        return global.throw_invalid_arguments(format_args!(
            "toEqualIgnoringWhitespace() requires 1 argument"
        ));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    let value: JSValue =
        this.get_value(global, this_value, "toEqualIgnoringWhitespace", "<green>expected<r>")?;

    if !expected.is_string() {
        return global.throw(format_args!(
            "toEqualIgnoringWhitespace() requires argument to be a string"
        ));
    }

    let not = this.flags.not;
    let mut pass = value.is_string() && expected.is_string();

    if pass {
        // Zig passed `default_allocator`; drop per §Allocators.
        let value_slice = value.to_slice(global)?;
        let expected_slice = expected.to_slice(global)?;
        // `defer ….deinit()` deleted — Drop handles it.

        let value_utf8: &[u8] = value_slice.slice();
        let expected_utf8: &[u8] = expected_slice.slice();

        let mut left: usize = 0;
        let mut right: usize = 0;

        // Skip leading whitespaces
        while left < value_utf8.len() && value_utf8[left].is_ascii_whitespace() {
            left += 1;
        }
        while right < expected_utf8.len() && expected_utf8[right].is_ascii_whitespace() {
            right += 1;
        }

        while left < value_utf8.len() && right < expected_utf8.len() {
            let left_char = value_utf8[left];
            let right_char = expected_utf8[right];

            if left_char != right_char {
                pass = false;
                break;
            }

            left += 1;
            right += 1;

            // Skip trailing whitespaces
            while left < value_utf8.len() && value_utf8[left].is_ascii_whitespace() {
                left += 1;
            }
            while right < expected_utf8.len() && expected_utf8[right].is_ascii_whitespace() {
                right += 1;
            }
        }

        if left < value_utf8.len() || right < expected_utf8.len() {
            pass = false;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // `defer formatter.deinit()` deleted — Drop handles it.
    let expected_fmt = expected.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter);

    if not {
        // TODO(port): get_signature must be `const fn` (was `comptime` in Zig).
        let signature = Expect::get_signature("toEqualIgnoringWhitespace", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!("\n\n", "Expected: not <green>{}<r>\n", "Received: <red>{}<r>\n"),
                expected_fmt, value_fmt
            ),
        );
    }

    let signature = Expect::get_signature("toEqualIgnoringWhitespace", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!("\n\n", "Expected: <green>{}<r>\n", "Received: <red>{}<r>\n"),
            expected_fmt, value_fmt
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toEqualIgnoringWhitespace.zig (91 lines)
//   confidence: medium
//   todos:      2
//   notes:      scopeguard reshape for postMatch defer; Formatter/to_fmt and Expect::throw signatures assumed
// ──────────────────────────────────────────────────────────────────────────
