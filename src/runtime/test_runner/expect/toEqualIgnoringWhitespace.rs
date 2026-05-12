use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;

// PORT NOTE: std.ascii.isWhitespace includes VT (0x0B); Rust's u8::is_ascii_whitespace does not.
// Zig matches ' ' and '\t'..'\r' (0x09–0x0D).
#[inline]
fn is_zig_whitespace(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | 0x0B | 0x0C | b'\r')
}

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_equal_ignoring_whitespace(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, value, not) =
        this.matcher_prelude(global, frame.this(), "toEqualIgnoringWhitespace", "<green>expected<r>")?;

    let arguments_ = frame.arguments_old::<1>(); let arguments: &[JSValue] = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toEqualIgnoringWhitespace() requires 1 argument"
        )));
    }

    let expected = arguments[0];

    if !expected.is_string() {
        return Err(global.throw(format_args!(
            "toEqualIgnoringWhitespace() requires argument to be a string"
        )));
    }

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
        while left < value_utf8.len() && is_zig_whitespace(value_utf8[left]) {
            left += 1;
        }
        while right < expected_utf8.len() && is_zig_whitespace(expected_utf8[right]) {
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
            while left < value_utf8.len() && is_zig_whitespace(value_utf8[left]) {
                left += 1;
            }
            while right < expected_utf8.len() && is_zig_whitespace(expected_utf8[right]) {
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
    // PORT NOTE: `to_fmt` returns a `ZigFormatter<'a, 'b>` that mutably borrows the
    // backing formatter. Use a second formatter for the received value — `make_formatter` is
    // cheap (no alloc) and this matches sibling matchers (toContainEqual, toBeCloseTo).
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    // `defer formatter.deinit()` deleted — Drop handles it.
    let expected_fmt = expected.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter2);

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

// ported from: src/test_runner/expect/toEqualIgnoringWhitespace.zig
