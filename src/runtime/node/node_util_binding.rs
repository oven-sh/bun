use bun_core::strings::EncodingNonAscii;
use bun_core::{self as bstr, OwnedString, String as BunString, ZigString, strings};
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

    // `defer str.deref()` — `to_bun_string` returns +1; `OwnedString`'s Drop
    // releases it on every exit path (bun_core::String itself is Copy, no Drop).
    let str = OwnedString::new(value.to_bun_string(scope)?);

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
    // `Vec<OwnedString>`'s Drop runs `deref()` on every element (covers both
    // the success path after `to_js_array` and any `?` early-return). Raw
    // `bun_core::String` is `Copy` and has NO Drop, so a `Vec<BunString>` would
    // leak; `OwnedString` is the RAII wrapper that releases each ref.
    let mut lines: Vec<OwnedString> = Vec::new();

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
                // errdefer encoded_line.deref() — folded into OwnedString Drop
                lines.push(OwnedString::new(BunString::borrow_utf16(line)));
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
                // errdefer encoded_line.deref() — folded into OwnedString Drop
                lines.push(OwnedString::new(encoded_line));
            }
        }
    }

    bun_string_jsc::to_js_array(global, OwnedString::as_raw_slice(&lines))
}

pub(crate) struct SplitNewlineIterator<'a, T> {
    buffer: &'a [T],
    index: Option<usize>,
}

impl<'a, T: Copy + PartialEq + From<u8>> SplitNewlineIterator<'a, T> {
    /// Returns a slice of the next field, or null if splitting is complete.
    pub(crate) fn next(&mut self) -> Option<&'a [T]> {
        let start = self.index?;

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
    // `defer str.deref()` — `from_js` returns +1; OwnedString releases on Drop.
    let str = OwnedString::new(BunString::from_js(input.unscoped(), global)?);
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
pub fn parse_env<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let content = frame.scoped_argument(scope, 0);
    let global = scope.unscoped_global();
    validators::validate_string(global, content.unscoped(), "content")?;

    // `validate_string` accepts StringObject, so coerce to a primitive JSString
    // before slicing.
    let str = content.to_js_string(scope)?.to_slice(global);

    let mut map = envloader::Map::init();
    let mut p = envloader::Loader::init(&mut map);
    p.load_from_string::<true, false>(str.slice())?;
    drop(p);

    let obj = JSValue::create_empty_object(global, map.map.count());
    for (k, v) in map.map.iter() {
        obj.put(
            global,
            ZigString::init_utf8(k),
            bun_string_jsc::create_utf8_for_js(global, &v.value)?,
        );
    }
    Ok(scope.local(obj))
}
