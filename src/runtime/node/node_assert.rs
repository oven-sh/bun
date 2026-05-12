use bun_core::String as BunString;
use bun_core::strings::EncodingNonAscii;
use bun_jsc::js_object::PojoFields;
use bun_jsc::{FromAny, JSGlobalObject, JSObject, JSValue, JsError, JsResult};

use super::assert::myers_diff as MyersDiff;
use super::assert::myers_diff::{Diff, DiffKind, Line};

/// Compare `actual` and `expected`, producing a diff that would turn `actual`
/// into `expected`.
///
/// Lines in the returned diff have the same encoding as `actual` and
/// `expected`. Lines borrow from these inputs, but the diff list itself must
/// be deallocated.
///
/// Use an arena allocator, otherwise this will leak memory.
///
/// ## Invariants
/// If not met, this function will panic.
/// - `actual` and `expected` are alive and have the same encoding.
pub fn myers_diff(
    global: &JSGlobalObject,
    actual: &BunString,
    expected: &BunString,
    // If true, strings that have a trailing comma but are otherwise equal are
    // considered equal.
    check_comma_disparity: bool,
    // split `actual` and `expected` into lines before diffing
    lines: bool,
) -> JsResult<JSValue> {
    // Short circuit on empty strings. Note that, in release builds where
    // assertions are disabled, if `actual` and `expected` are both dead, this
    // branch will be hit since dead strings have a length of 0. This should be
    // moot since BunStrings with non-zero reference counds should never be
    // dead.
    if actual.length() == 0 && expected.length() == 0 {
        return JSValue::create_empty_array(global, 0);
    }

    let actual_encoding = actual.encoding();
    let expected_encoding = expected.encoding();

    if lines {
        if actual_encoding != expected_encoding {
            let actual_utf8 = actual.to_utf8_without_ref();
            let expected_utf8 = expected.to_utf8_without_ref();

            return diff_lines::<u8>(
                global,
                actual_utf8.slice(),
                expected_utf8.slice(),
                check_comma_disparity,
            );
        }

        return match actual_encoding {
            EncodingNonAscii::Latin1 | EncodingNonAscii::Utf8 => diff_lines::<u8>(
                global,
                actual.byte_slice(),
                expected.byte_slice(),
                check_comma_disparity,
            ),
            EncodingNonAscii::Utf16 => diff_lines::<u16>(
                global,
                actual.utf16(),
                expected.utf16(),
                check_comma_disparity,
            ),
        };
    }

    if actual_encoding != expected_encoding {
        let _actual_utf8 = actual.to_utf8_without_ref();
        let _expected_utf8 = expected.to_utf8_without_ref();

        // PORT NOTE: Zig passes `actual.byteSlice()` / `expected.byteSlice()` here (the
        // originals), not the just-computed utf8 slices. Preserved verbatim for behavioral
        // parity; likely a pre-existing bug in the Zig source.
        return diff_chars::<u8>(global, actual.byte_slice(), expected.byte_slice());
    }

    match actual_encoding {
        EncodingNonAscii::Latin1 | EncodingNonAscii::Utf8 => {
            diff_chars::<u8>(global, actual.byte_slice(), expected.byte_slice())
        }
        EncodingNonAscii::Utf16 => diff_chars::<u16>(global, actual.utf16(), expected.utf16()),
    }
}

fn diff_chars<T>(global: &JSGlobalObject, actual: &[T], expected: &[T]) -> JsResult<JSValue>
where
    T: Line + FromAny,
{
    let diff: MyersDiff::DiffList<T> = MyersDiff::Differ::<T, false>::diff(actual, expected)
        .map_err(|err| map_diff_error(global, err))?;
    diff_list_to_js(global, diff)
}

fn diff_lines<'s, T>(
    global: &JSGlobalObject,
    actual: &'s [T],
    expected: &'s [T],
    check_comma_disparity: bool,
) -> JsResult<JSValue>
where
    T: PartialEq + Copy + From<u8>,
    &'s [T]: Line + FromAny,
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
    diff_list_to_js(global, diff)
}

fn diff_list_to_js<T>(
    global: &JSGlobalObject,
    diff_list: MyersDiff::DiffList<T>,
) -> JsResult<JSValue>
where
    T: FromAny + Copy,
{
    JSValue::create_array_from_iter(global, diff_list.iter(), |line| {
        Ok(JSObject::create_null_proto(line, global)?.to_js())
    })
}

/// Field reflection for `Diff<T>` so [`JSObject::create_null_proto`] can
/// marshal it. Mirrors Zig's `inline for` over `@typeInfo(Diff(T))`:
/// `kind` is a fieldless enum → `jsNumber(@intFromEnum)`; `value` routes
/// through `JSValue::from_any` per `T`.
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
        MyersDiff::Error::OutOfMemory => JsError::OutOfMemory,
        MyersDiff::Error::DiffTooLarge => global.throw_invalid_arguments(format_args!(
            "Diffing these two values would create a string that is too large. If this was intentional, please open a bug report on GitHub.",
        )),
        MyersDiff::Error::InputsTooLarge => global.throw_invalid_arguments(format_args!(
            "Input strings are too large to diff. Please open a bug report on GitHub.",
        )),
    }
}

// Ensure `DiffKind`'s discriminants match the JS-side `DiffType` enum
// (Insert=0, Delete=1, Equal=2). Zig's `@intFromEnum` uses declaration order.
const _: () = {
    assert!(DiffKind::Insert as i32 == 0);
    assert!(DiffKind::Delete as i32 == 1);
    assert!(DiffKind::Equal as i32 == 2);
};

// ported from: src/runtime/node/node_assert.zig
