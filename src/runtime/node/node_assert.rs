use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsError, JsResult};
use bun_str::{Encoding, String as BunString};

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
                actual_utf8.byte_slice(),
                expected_utf8.byte_slice(),
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

        // TODO(port): Zig passes `actual.byteSlice()` / `expected.byteSlice()` here (the
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

fn diff_chars<T>(
    global: &JSGlobalObject,
    actual: &[T],
    expected: &[T],
) -> JsResult<JSValue> {
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
) -> JsResult<JSValue> {
    let a = MyersDiff::split::<T>(actual)?;
    let e = MyersDiff::split::<T>(expected)?;

    // TODO(port): `&[T]` as a Differ element type needs a lifetime; revisit when
    // porting myers_diff.zig (DiffList<&[T]> / Differ<&[T], _>).
    let diff: MyersDiff::DiffList<&[T]> = 'blk: {
        if check_comma_disparity {
            type Differ<'a, T> = MyersDiff::Differ<&'a [T], true>;
            break 'blk Differ::diff(a.as_slice(), e.as_slice())
                .map_err(|err| map_diff_error(global, err))?;
        } else {
            type Differ<'a, T> = MyersDiff::Differ<&'a [T], false>;
            break 'blk Differ::diff(a.as_slice(), e.as_slice())
                .map_err(|err| map_diff_error(global, err))?;
        }
    };
    diff_list_to_js::<&[T]>(global, diff)
}

fn diff_list_to_js<T>(
    global: &JSGlobalObject,
    diff_list: MyersDiff::DiffList<T>,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, diff_list.len())?;
    for (i, line) in diff_list.iter().enumerate() {
        // TODO(port): `JSObject::create_null_proto` in Zig reflects over the struct fields of
        // `line` to build a JS object. Needs a trait (e.g. `ToNullProtoObject`) implemented
        // per diff-entry type, or a proc-macro.
        array.put_index(global, i as u32, JSObject::create_null_proto(line, global)?.to_js())?;
    }
    Ok(array)
}

fn map_diff_error(global: &JSGlobalObject, err: MyersDiff::Error) -> JsError {
    match err {
        MyersDiff::Error::OutOfMemory => JsError::OutOfMemory,
        MyersDiff::Error::DiffTooLarge => global.throw_invalid_arguments(
            "Diffing these two values would create a string that is too large. If this was intentional, please open a bug report on GitHub.",
        ),
        MyersDiff::Error::InputsTooLarge => global.throw_invalid_arguments(
            "Input strings are too large to diff. Please open a bug report on GitHub.",
        ),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_assert.zig (128 lines)
//   confidence: medium
//   todos:      3
//   notes:      Differ<&[T], const bool> generic shape and JSObject::create_null_proto reflection both depend on myers_diff.rs port; Zig diffChars mixed-encoding branch looks like it ignores its own utf8 conversion (preserved).
// ──────────────────────────────────────────────────────────────────────────
