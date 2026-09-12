use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::CodeUnitPair;
use super::Expect;
use super::throw;

// Matches ' ' and '\t'..'\r' (0x09–0x0D) — includes VT (0x0B), which Rust's
// u8::is_ascii_whitespace does not.
#[inline]
fn is_zig_whitespace(unit: u16) -> bool {
    matches!(unit, 0x20 | 0x09..=0x0D)
}

fn without_whitespace<T: Copy + Into<u16>>(units: &[T]) -> impl Iterator<Item = u16> + '_ {
    units.iter().map(|&unit| unit.into()).filter(|&unit| !is_zig_whitespace(unit))
}

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_equal_ignoring_whitespace(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let (this, value, not) =
        this.matcher_prelude(global, frame.this(), "toEqualIgnoringWhitespace", "<green>expected<r>")?;

    let arguments: &[JSValue] = frame.arguments();

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
        let value_view = value.to_js_string_view(global)?;
        let expected_view = expected.to_js_string_view(global)?;
        pass = match CodeUnitPair::new(&value_view, &expected_view) {
            CodeUnitPair::Latin1(left, right) => {
                without_whitespace(left).eq(without_whitespace(right))
            }
            CodeUnitPair::Utf16(left, right) => {
                without_whitespace(&left).eq(without_whitespace(&right))
            }
        };
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // `to_fmt` returns a `ZigFormatter<'a, 'b>` that mutably borrows the
    // backing formatter. Use a second formatter for the received value — `make_formatter` is
    // cheap (no alloc) and this matches sibling matchers (toContainEqual, toBeCloseTo).
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
