use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::Expect;
use super::throw;

// Matches ' ' and '\t'..'\r' (0x09–0x0D) — includes VT (0x0B), which Rust's
// u8::is_ascii_whitespace does not.
#[inline]
fn is_zig_whitespace(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | 0x0B | 0x0C | b'\r')
}

impl Expect {
    pub(crate) fn to_equal_ignoring_whitespace(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toEqualIgnoringWhitespace", "<green>expected<r>")?;

        let expected = expected.to_js();

        if !expected.is_string() {
            return Err(global.throw(format_args!(
                "toEqualIgnoringWhitespace() requires argument to be a string"
            )));
        }

        let mut pass = value.is_string() && expected.is_string();

        if pass {
            let value_slice = value.to_utf8(global)?;
            let expected_slice = expected.to_utf8(global)?;

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

        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        // `defer formatter.deinit()` deleted — Drop handles it.
        let expected_fmt = expected.to_fmt(&mut formatter);
        let value_fmt = value.to_fmt(&mut formatter2);

        if not {
            let signature = Expect::get_signature("toEqualIgnoringWhitespace", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                concat!("\n\n", "Expected: not <green>{}<r>\n", "Received: <red>{}<r>\n"),
                expected_fmt, value_fmt
            );
        }

        let signature = Expect::get_signature("toEqualIgnoringWhitespace", "<green>expected<r>", false);
        throw!(
            this,
            global,
            signature,
            concat!("\n\n", "Expected: <green>{}<r>\n", "Received: <red>{}<r>\n"),
            expected_fmt, value_fmt
        )
    }
}
