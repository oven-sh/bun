use bun_core::strings::EncodingNonAscii;
use bun_core::{self as bstr, EncodedSlice, String as BunString, strings};
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsResult, Local, Scope, StringJsc as _, bun_string_jsc,
};
use bun_sys::UV_E;

use crate::node::types::Encoding;
use crate::node::util::validators;
use bun_dotenv::env_loader as envloader;

#[bun_jsc::host_fn(scoped)]
pub(crate) fn internal_error_name<'s>(
    scope: &mut Scope<'s>,
    frame: &CallFrame,
) -> JsResult<Local<'s>> {
    let arguments = frame.scoped_arguments::<1>(scope);
    let Some(arg) = arguments.get(0) else {
        return Err(scope.throw_not_enough_arguments("internalErrorName", 1, 0));
    };

    let err_int = arg.to_int32(scope);
    if let Some(name) = UV_E::name(err_int) {
        return scope.string(&BunString::static_(name));
    }
    let fmtstring = BunString::create_format(format_args!("Unknown system error {}", err_int));
    scope.transfer_string(fmtstring)
}

#[bun_jsc::host_fn]
pub(crate) fn internal_error_entries(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    // Flat [code, name, code, name, ...] pairs — libuv's full error table for
    // this target. Consumed by node:util's getSystemErrorMap().
    let entries = UV_E::ENTRIES;
    JSValue::create_array_from_iter(global, 0..entries.len() * 2, |i| {
        let (code, name) = entries[i / 2];
        if i % 2 == 0 {
            Ok(JSValue::js_number_from_int32(code))
        } else {
            BunString::static_(name).to_js(global)
        }
    })
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn etimedout_error_code<'s>(
    scope: &mut Scope<'s>,
    _frame: &CallFrame,
) -> JsResult<Local<'s>> {
    Ok(scope.number_from_int32(-UV_E::TIMEDOUT))
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn enobufs_error_code<'s>(
    scope: &mut Scope<'s>,
    _frame: &CallFrame,
) -> JsResult<Local<'s>> {
    Ok(scope.number_from_int32(-UV_E::NOBUFS))
}

#[bun_jsc::host_fn]
pub(crate) fn uv_translate_sys_error(
    _global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arg = frame.arguments_as_array::<1>()[0];
    if !arg.is_number() {
        return Ok(JSValue::js_number_from_int32(-UV_E::INVAL));
    }
    let n = arg.to_int32();
    if n <= 0 {
        return Ok(JSValue::js_number_from_int32(n));
    }
    #[cfg(windows)]
    {
        // SAFETY: pure translation function.
        let uv_err = unsafe { bun_libuv_sys::uv_translate_sys_error(n) };
        return Ok(JSValue::js_number_from_int32(if uv_err != 0 {
            uv_err
        } else {
            -UV_E::INVAL
        }));
    }
    #[cfg(not(windows))]
    {
        Ok(JSValue::js_number_from_int32(-n))
    }
}

/// libuv's ECANCELED code (`uv_udp_send` requests cancelled by close). Not a
/// JS-side literal (unlike EBADF/EINVAL, ECANCELED's number differs across the
/// POSIX platforms: Linux 125, Darwin 89, FreeBSD 85; synthetic -4081 on
/// Windows), and NOT `process.binding("uv")` either: that binding negates the
/// compiling host's <errno.h> value, which on Windows is the CRT's 105, not
/// libuv's -4081. `UV_E` is the one table that is libuv-correct everywhere.
#[bun_jsc::host_fn(scoped)]
pub(crate) fn ecanceled_error_code<'s>(
    scope: &mut Scope<'s>,
    _frame: &CallFrame,
) -> JsResult<Local<'s>> {
    Ok(scope.number_from_int32(-UV_E::CANCELED))
}

/// `extractedSplitNewLines` for ASCII/Latin1 strings. Panics if passed a non-string.
/// Returns `undefined` if param is utf8 or utf16 and not fully ascii.
///
/// ```js
/// // util.js
/// const extractedNewLineRe = new RegExp("(?<=\\n)");
/// extractedSplitNewLines = value => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
/// ```
#[bun_jsc::host_fn(scoped)]
pub(crate) fn extracted_split_new_lines_fast_path_strings_only<'s>(
    scope: &mut Scope<'s>,
    frame: &CallFrame,
) -> JsResult<Local<'s>> {
    debug_assert!(frame.arguments_count() == 1);
    let value = frame.scoped_argument(scope, 0);
    debug_assert!(value.is_string());

    let str = value.to_bun_string(scope)?;

    let global = scope.unscoped_global();
    let v = match str.encoding() {
        EncodingNonAscii::Utf16 => split(EncodingNonAscii::Utf16, global, &str)?,
        EncodingNonAscii::Latin1 => split(EncodingNonAscii::Latin1, global, &str)?,
        EncodingNonAscii::Utf8 => {
            if strings::is_all_ascii(str.byte_slice()) {
                split(EncodingNonAscii::Utf8, global, &str)?
            } else {
                return Ok(scope.undefined());
            }
        }
    };
    Ok(scope.local(v))
}

// PERF: `encoding` is a runtime parameter
// because `EncodingNonAscii` doesn't derive `ConstParamTy` (would need nightly
// `adt_const_params`). The hot u8/u16 split is still type-dispatched below.
fn split(
    encoding: EncodingNonAscii,
    global: &JSGlobalObject,
    str: &BunString,
) -> JsResult<JSValue> {
    let mut lines: Vec<bun_core::String> = Vec::new();

    // Split into two arms over the buffer's element type (u8 for
    // utf8/latin1, u16 for utf16).
    match encoding {
        EncodingNonAscii::Utf16 => {
            let buffer: &[u16] = str.utf16();
            let mut it = SplitNewlineIterator {
                buffer,
                index: Some(0),
            };
            while let Some(line) = it.next() {
                lines.push(BunString::borrow_utf16(line));
            }
        }
        EncodingNonAscii::Utf8 | EncodingNonAscii::Latin1 => {
            let buffer: &[u8] = str.byte_slice();
            let mut it = SplitNewlineIterator {
                buffer,
                index: Some(0),
            };
            while let Some(line) = it.next() {
                let encoded_line = if encoding == EncodingNonAscii::Utf8 {
                    BunString::borrow_utf8(line)
                } else {
                    BunString::clone_latin1(line)
                };
                lines.push(encoded_line);
            }
        }
    }

    bun_string_jsc::to_js_array(global, &lines)
}

struct SplitNewlineIterator<'a, T> {
    buffer: &'a [T],
    index: Option<usize>,
}

impl<'a, T: Copy + PartialEq + From<u8>> SplitNewlineIterator<'a, T> {
    /// Returns a slice of the next field, or null if splitting is complete.
    fn next(&mut self) -> Option<&'a [T]> {
        let start = self.index?;

        // A lookbehind split emits no trailing empty field when the input ends
        // with '\n' (but "" still splits to [""]).
        if start == self.buffer.len() && start != 0 {
            self.index = None;
            return None;
        }

        if let Some(delim_start) = self.buffer[start..]
            .iter()
            .position(|&b| b == T::from(b'\n'))
            .map(|i| start + i)
        {
            let end = delim_start + 1;
            let slice = &self.buffer[start..end];
            self.index = Some(end);
            Some(slice)
        } else {
            self.index = None;
            Some(&self.buffer[start..])
        }
    }
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn normalize_encoding<'s>(
    scope: &mut Scope<'s>,
    frame: &CallFrame,
) -> JsResult<Local<'s>> {
    let input = frame.scoped_argument(scope, 0);
    let global = scope.unscoped_global();
    let str = input.to_bun_string(scope)?;
    debug_assert!(str.tag() != bstr::Tag::Dead);
    if str.length() == 0 {
        return Ok(scope.local(Encoding::Utf8.to_js(global)));
    }
    if let Some(enc) = Encoding::from_bun_string(&str) {
        return Ok(scope.local(enc.to_js(global)));
    }
    Ok(scope.undefined())
}

#[bun_jsc::host_fn(scoped)]
pub(crate) fn parse_env<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let content = frame.scoped_argument(scope, 0);
    let global = scope.unscoped_global();
    validators::validate_string(global, content.unscoped(), "content")?;

    // `validate_string` accepts StringObject, so coerce to a primitive JSString
    // before slicing.
    let view = content.to_js_string_view(scope)?;
    let str = view.to_utf8();

    let mut p = envloader::Loader::init();
    p.load_from_string::<true, false>(str.slice())?;

    let obj = JSValue::create_empty_object(global, p.map.map.count());
    for (k, v) in p.map.map.iter() {
        obj.put(
            global,
            EncodedSlice::from_bytes(k),
            bun_string_jsc::create_utf8_for_js(global, &v.value)?,
        );
    }
    Ok(scope.local(obj))
}
