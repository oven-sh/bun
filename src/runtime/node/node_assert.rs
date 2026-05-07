use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};
use bun_jsc::zig_string::ZigString;
use bun_str::strings::EncodingNonAscii as Encoding;
use bun_str::String as BunString;

use super::assert::myers_diff as MyersDiff;

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
            Encoding::Latin1 | Encoding::Utf8 => diff_lines::<u8>(
                global,
                actual.byte_slice(),
                expected.byte_slice(),
                check_comma_disparity,
            ),
            Encoding::Utf16 => diff_lines::<u16>(
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
        Encoding::Latin1 | Encoding::Utf8 => {
            diff_chars::<u8>(global, actual.byte_slice(), expected.byte_slice())
        }
        Encoding::Utf16 => diff_chars::<u16>(global, actual.utf16(), expected.utf16()),
    }
}

fn diff_chars<T>(global: &JSGlobalObject, actual: &[T], expected: &[T]) -> JsResult<JSValue>
where
    T: MyersDiff::Line + DiffValue,
{
    type Differ<T> = MyersDiff::Differ<T, false>;
    let diff: MyersDiff::DiffList<T> =
        Differ::<T>::diff(actual, expected).map_err(|err| map_diff_error(global, err))?;
    diff_list_to_js::<T>(global, diff)
}

fn diff_lines<T>(
    global: &JSGlobalObject,
    actual: &[T],
    expected: &[T],
    check_comma_disparity: bool,
) -> JsResult<JSValue>
where
    T: PartialEq + Copy + From<u8>,
    for<'a> &'a [T]: MyersDiff::Line + DiffValue,
{
    let a = MyersDiff::split::<T>(actual);
    let e = MyersDiff::split::<T>(expected);

    let diff: MyersDiff::DiffList<&[T]> = if check_comma_disparity {
        MyersDiff::Differ::<&[T], true>::diff(a.as_slice(), e.as_slice())
            .map_err(|err| map_diff_error(global, err))?
    } else {
        MyersDiff::Differ::<&[T], false>::diff(a.as_slice(), e.as_slice())
            .map_err(|err| map_diff_error(global, err))?
    };
    diff_list_to_js::<&[T]>(global, diff)
}

fn diff_list_to_js<T: DiffValue>(
    global: &JSGlobalObject,
    diff_list: MyersDiff::DiffList<T>,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, diff_list.len())?;
    for (i, line) in diff_list.iter().enumerate() {
        // PORT NOTE: Zig used `JSObject.createNullProto(line.*, global)` which
        // reflects over `Diff(T)`'s fields at comptime. Rust has no field
        // reflection; the two fields (`kind`, `value`) are emitted directly.
        let obj = JSValue::create_empty_object_with_null_prototype(global);
        if obj.is_empty() {
            return Err(global.throw_out_of_memory());
        }
        obj.put(
            global,
            BunString::static_(b"kind"),
            JSValue::js_number(line.kind as u32 as f64),
        );
        obj.put(
            global,
            BunString::static_(b"value"),
            line.value.to_js_value(global)?,
        );
        array.put_index(global, i as u32, obj)?;
    }
    Ok(array)
}

/// Bridge for the `Diff<T>.value` payload — Zig's `JSValue.fromAny` dispatched
/// on `@TypeOf` at comptime; in Rust each line element type implements this.
trait DiffValue: Copy {
    fn to_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue>;
}

impl DiffValue for u8 {
    #[inline]
    fn to_js_value(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(self as f64))
    }
}

impl DiffValue for u16 {
    #[inline]
    fn to_js_value(self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_number(self as f64))
    }
}

impl DiffValue for &[u8] {
    #[inline]
    fn to_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, self)
    }
}

impl DiffValue for &[u16] {
    #[inline]
    fn to_js_value(self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init_utf16(self).to_js(global))
    }
}

fn map_diff_error(global: &JSGlobalObject, err: MyersDiff::Error) -> JsError {
    match err {
        MyersDiff::Error::OutOfMemory => JsError::OutOfMemory,
        MyersDiff::Error::DiffTooLarge => global.throw_invalid_arguments(format_args!(
            "Diffing these two values would create a string that is too large. If this was intentional, please open a bug report on GitHub."
        )),
        MyersDiff::Error::InputsTooLarge => global.throw_invalid_arguments(format_args!(
            "Input strings are too large to diff. Please open a bug report on GitHub."
        )),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_assert.zig (128 lines)
//   confidence: high
//   todos:      0
//   notes:      JSObject.createNullProto comptime reflection inlined as manual put() calls; Zig diffChars mixed-encoding branch ignores its own utf8 conversion (preserved for parity).
// ──────────────────────────────────────────────────────────────────────────
