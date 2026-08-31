use bun_core::String as BunString;
use bun_core::strings::EncodingNonAscii;
use bun_jsc::js_object::PojoFields;
use bun_jsc::{FromAny, JSGlobalObject, JSObject, JSValue, JsError, JsResult, StringJsc};

use super::assert::myers_diff as MyersDiff;
use super::assert::myers_diff::{Diff, DiffKind, Line};

/// Compare `actual` and `expected`, producing a diff that would turn `actual`
/// into `expected`, and hand it to JS in the shape `output` asks for.
///
/// The result has the encoding of the inputs: Latin-1 when both sides are
/// Latin-1, otherwise UTF-16.
///
/// ## Invariants
/// If not met, this function will panic.
/// - `actual` and `expected` are alive.
pub(crate) fn myers_diff(
    global: &JSGlobalObject,
    actual: &BunString,
    expected: &BunString,
    output: &Output<'_>,
) -> JsResult<JSValue> {
    // Short circuit on empty strings. Note that, in release builds where
    // assertions are disabled, if `actual` and `expected` are both dead, this
    // branch will be hit since dead strings have a length of 0. This should be
    // moot since BunStrings with non-zero reference counds should never be
    // dead.
    if actual.length() == 0 && expected.length() == 0 {
        return emit::<u8, u8>(global, &Vec::new(), output);
    }

    let (lines, check_comma_disparity) = match *output {
        Output::List {
            lines,
            check_comma_disparity,
        } => (lines, check_comma_disparity),
        Output::Simple(_) => (false, false),
        Output::Lines {
            check_comma_disparity,
            ..
        } => (true, check_comma_disparity),
    };

    // JS strings arrive as Latin-1 or UTF-16. When the two sides differ, widen the
    // Latin-1 side so both diff over the same code unit.
    let actual_is_16 = actual.encoding() == EncodingNonAscii::Utf16;
    let expected_is_16 = expected.encoding() == EncodingNonAscii::Utf16;
    if !actual_is_16 && !expected_is_16 {
        let (a, e) = (actual.byte_slice(), expected.byte_slice());
        return if lines {
            diff_lines::<u8>(global, a, e, check_comma_disparity, output)
        } else {
            diff_chars::<u8>(global, a, e, output)
        };
    }

    let widen =
        |s: &BunString| -> Vec<u16> { s.byte_slice().iter().map(|&b| u16::from(b)).collect() };
    let actual_wide: Vec<u16>;
    let expected_wide: Vec<u16>;
    let a: &[u16] = if actual_is_16 {
        actual.utf16()
    } else {
        actual_wide = widen(actual);
        &actual_wide
    };
    let e: &[u16] = if expected_is_16 {
        expected.utf16()
    } else {
        expected_wide = widen(expected);
        &expected_wide
    };
    if lines {
        diff_lines::<u16>(global, a, e, check_comma_disparity, output)
    } else {
        diff_chars::<u16>(global, a, e, output)
    }
}

fn diff_chars<T>(
    global: &JSGlobalObject,
    actual: &[T],
    expected: &[T],
    output: &Output<'_>,
) -> JsResult<JSValue>
where
    T: Line + FromAny + CodeUnit + DiffText<T>,
{
    let diff: MyersDiff::DiffList<T> = MyersDiff::Differ::<T, false>::diff(actual, expected)
        .map_err(|err| map_diff_error(global, err))?;
    emit::<T, T>(global, &diff, output)
}

fn diff_lines<'s, T>(
    global: &JSGlobalObject,
    actual: &'s [T],
    expected: &'s [T],
    check_comma_disparity: bool,
    output: &Output<'_>,
) -> JsResult<JSValue>
where
    T: PartialEq + Copy + From<u8> + CodeUnit,
    &'s [T]: Line + FromAny + DiffText<T>,
{
    let a = MyersDiff::split::<T>(actual);
    let e = MyersDiff::split::<T>(expected);

    let diff: MyersDiff::DiffList<&'s [T]> = if check_comma_disparity {
        MyersDiff::Differ::<&'s [T], true>::diff(a.as_slice(), e.as_slice())
            .map_err(|err| map_diff_error(global, err))?
    } else {
        MyersDiff::Differ::<&'s [T], false>::diff(a.as_slice(), e.as_slice())
            .map_err(|err| map_diff_error(global, err))?
    };
    emit::<T, &'s [T]>(global, &diff, output)
}

fn diff_list_to_js<T>(
    global: &JSGlobalObject,
    diff_list: &MyersDiff::DiffList<T>,
) -> JsResult<JSValue>
where
    T: FromAny + Copy,
{
    JSValue::create_array_from_iter(global, diff_list.iter(), |line| {
        Ok(JSObject::create_null_proto(line, global)?.to_js())
    })
}

/// What `myers_diff` should hand back to JS. The variant also decides how the
/// inputs are diffed: by char or by line.
pub(crate) enum Output<'a> {
    /// `Diff[]` of `{ kind, value }` objects (internal/assert/myers_diff `myersDiff`).
    List {
        /// Split `actual` and `expected` into lines before diffing.
        lines: bool,
        /// Lines that differ only by a trailing comma compare equal.
        check_comma_disparity: bool,
    },
    /// The `printSimpleMyersDiff` string for a char diff.
    Simple(&'a Colors),
    /// The `printMyersDiff` `{ message, skipped }` object for a line diff.
    Lines {
        colors: &'a Colors,
        /// Lines that differ only by a trailing comma compare equal.
        check_comma_disparity: bool,
    },
}

/// ANSI sequences from internal/util/colors (empty when colors are off).
pub(crate) struct Colors {
    pub green: Vec<u8>,
    pub red: Vec<u8>,
    pub white: Vec<u8>,
    pub blue: Vec<u8>,
}

/// Output code unit: Latin-1 bytes or UTF-16.
pub(crate) trait CodeUnit: Copy + From<u8> + PartialEq {
    fn to_bun_string(out: &[Self]) -> BunString;
    fn as_u32(self) -> u32;
}
impl CodeUnit for u8 {
    fn to_bun_string(out: &[u8]) -> BunString {
        BunString::clone_latin1(out)
    }
    fn as_u32(self) -> u32 {
        self as u32
    }
}
impl CodeUnit for u16 {
    fn to_bun_string(out: &[u16]) -> BunString {
        BunString::clone_utf16(out)
    }
    fn as_u32(self) -> u32 {
        self as u32
    }
}

/// A diff value (single char or borrowed line) that can be appended to the output.
pub(crate) trait DiffText<C: CodeUnit>: Copy {
    fn append_to(self, out: &mut Vec<C>);
}
impl DiffText<u8> for u8 {
    fn append_to(self, out: &mut Vec<u8>) {
        out.push(self);
    }
}
impl DiffText<u16> for u16 {
    fn append_to(self, out: &mut Vec<u16>) {
        out.push(self);
    }
}
impl<'a, C: CodeUnit> DiffText<C> for &'a [C] {
    fn append_to(self, out: &mut Vec<C>) {
        out.extend_from_slice(self);
    }
}

#[inline]
fn append_ascii<C: CodeUnit>(out: &mut Vec<C>, bytes: &[u8]) {
    out.extend(bytes.iter().map(|&b| C::from(b)));
}

/// `String.prototype.trimEnd` whitespace set (WhiteSpace + LineTerminator).
fn is_js_whitespace(c: u32) -> bool {
    matches!(
        c,
        0x09..=0x0D
            | 0x20
            | 0xA0
            | 0x1680
            | 0x2000..=0x200A
            | 0x2028
            | 0x2029
            | 0x202F
            | 0x205F
            | 0x3000
            | 0xFEFF
    )
}

fn emit<C, T>(
    global: &JSGlobalObject,
    diff_list: &MyersDiff::DiffList<T>,
    output: &Output<'_>,
) -> JsResult<JSValue>
where
    C: CodeUnit,
    T: FromAny + Copy + DiffText<C>,
{
    match *output {
        Output::List { .. } => diff_list_to_js(global, diff_list),
        Output::Simple(colors) => {
            let out = render_simple::<C, T>(diff_list, colors);
            C::to_bun_string(&out).into_js(global)
        }
        Output::Lines { colors, .. } => {
            let (out, skipped) = render_lines::<C, T>(diff_list, colors);
            let result = JSValue::create_empty_object(global, 2);
            result.put(global, b"message", C::to_bun_string(&out).into_js(global)?);
            result.put(global, b"skipped", JSValue::from(skipped));
            Ok(result)
        }
    }
}

/// internal/assert/myers_diff `printSimpleMyersDiff`: the char diff inline, colored per op.
fn render_simple<C: CodeUnit, T: DiffText<C>>(diff: &[Diff<T>], colors: &Colors) -> Vec<C> {
    let mut out: Vec<C> = Vec::with_capacity(diff.len() + 1);
    append_ascii(&mut out, b"\n");
    for d in diff.iter().rev() {
        let color = match d.kind {
            DiffKind::Insert => &colors.green,
            DiffKind::Delete => &colors.red,
            DiffKind::Equal => &colors.white,
        };
        append_ascii(&mut out, color);
        d.value.append_to(&mut out);
        append_ascii(&mut out, &colors.white);
    }
    out
}

/// internal/assert/myers_diff `printMyersDiff`: one line per entry with `+`/`-`/`  `
/// prefixes, collapsing runs of more than 5 unchanged lines into `...`.
fn render_lines<C: CodeUnit, T: DiffText<C>>(diff: &[Diff<T>], colors: &Colors) -> (Vec<C>, bool) {
    const NOP_LINES_TO_COLLAPSE: usize = 5;
    let mut out: Vec<C> = Vec::new();
    append_ascii(&mut out, b"\n");
    let mut skipped = false;
    let mut nop_count: usize = 0;

    let equal_line = |out: &mut Vec<C>, value: T| {
        append_ascii(out, &colors.white);
        append_ascii(out, b"  ");
        value.append_to(out);
        append_ascii(out, b"\n");
    };

    for idx in (0..diff.len()).rev() {
        let Diff { kind, value } = diff[idx];
        let previous_kind = if idx + 1 < diff.len() {
            Some(diff[idx + 1].kind)
        } else {
            None
        };

        if previous_kind == Some(DiffKind::Equal) && kind != DiffKind::Equal {
            // Avoid grouping if only one line would have been grouped otherwise
            if nop_count == NOP_LINES_TO_COLLAPSE + 1 {
                equal_line(&mut out, diff[idx + 1].value);
            } else if nop_count == NOP_LINES_TO_COLLAPSE + 2 {
                equal_line(&mut out, diff[idx + 2].value);
                equal_line(&mut out, diff[idx + 1].value);
            }
            if nop_count >= NOP_LINES_TO_COLLAPSE + 3 {
                append_ascii(&mut out, &colors.blue);
                append_ascii(&mut out, b"...");
                append_ascii(&mut out, &colors.white);
                append_ascii(&mut out, b"\n");
                equal_line(&mut out, diff[idx + 1].value);
                skipped = true;
            }
            nop_count = 0;
        }

        match kind {
            DiffKind::Insert => {
                append_ascii(&mut out, &colors.green);
                append_ascii(&mut out, b"+");
                append_ascii(&mut out, &colors.white);
                append_ascii(&mut out, b" ");
                value.append_to(&mut out);
                append_ascii(&mut out, b"\n");
            }
            DiffKind::Delete => {
                append_ascii(&mut out, &colors.red);
                append_ascii(&mut out, b"-");
                append_ascii(&mut out, &colors.white);
                append_ascii(&mut out, b" ");
                value.append_to(&mut out);
                append_ascii(&mut out, b"\n");
            }
            DiffKind::Equal => {
                if nop_count < NOP_LINES_TO_COLLAPSE {
                    equal_line(&mut out, value);
                }
                nop_count += 1;
            }
        }
    }

    // `message.trimEnd()` (the leading "\n" is prepended after trimming in JS, so keep it).
    while out.len() > 1 && is_js_whitespace(out[out.len() - 1].as_u32()) {
        out.pop();
    }
    (out, skipped)
}

/// Field reflection for `Diff<T>` so [`JSObject::create_null_proto`] can
/// marshal it: `kind` is a fieldless enum marshalled as its discriminant;
/// `value` routes through `JSValue::from_any` per `T`.
impl<T: FromAny + Copy> PojoFields for Diff<T> {
    const FIELD_COUNT: usize = 2;
    fn put_fields(
        &self,
        global: &JSGlobalObject,
        mut put: impl FnMut(&'static [u8], JSValue) -> JsResult<()>,
    ) -> JsResult<()> {
        put(b"kind", JSValue::js_number_from_int32(self.kind as i32))?;
        put(b"value", JSValue::from_any(global, self.value)?)?;
        Ok(())
    }
}

fn map_diff_error(global: &JSGlobalObject, err: MyersDiff::Error) -> JsError {
    match err {
        MyersDiff::Error::DiffTooLarge => global.throw_invalid_arguments(format_args!(
            "Diffing these two values would create a string that is too large. If this was intentional, please open a bug report on GitHub.",
        )),
        MyersDiff::Error::InputsTooLarge => global.throw_invalid_arguments(format_args!(
            "Input strings are too large to diff. Please open a bug report on GitHub.",
        )),
    }
}

// Ensure `DiffKind`'s discriminants match the JS-side `DiffType` enum
// (Insert=0, Delete=1, Equal=2).
const _: () = {
    assert!(DiffKind::Insert as i32 == 0);
    assert!(DiffKind::Delete as i32 == 1);
    assert!(DiffKind::Equal as i32 == 2);
};
