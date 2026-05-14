use bun_core::strings::EncodingNonAscii;
use bun_core::{self as bstr, OwnedString, String as BunString, ZigString, strings};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc};
use bun_sys::UV_E;

use crate::node::types::Encoding;
use crate::node::util::validators;
use bun_dotenv::env_loader as envloader;

#[bun_jsc::host_fn]
pub fn internal_error_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments("internalErrorName", 1, arguments.len()));
    }

    let err_int = arguments[0].to_int32();
    if let Some(name) = UV_E::name(err_int) {
        return BunString::static_(name).to_js(global);
    }
    let mut fmtstring = BunString::create_format(format_args!("Unknown system error {}", err_int));
    fmtstring.transfer_to_js(global)
}

#[bun_jsc::host_fn]
pub fn etimedout_error_code(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::js_number_from_int32(-UV_E::TIMEDOUT))
}

#[bun_jsc::host_fn]
pub fn enobufs_error_code(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(JSValue::js_number_from_int32(-UV_E::NOBUFS))
}

/// `extractedSplitNewLines` for ASCII/Latin1 strings. Panics if passed a non-string.
/// Returns `undefined` if param is utf8 or utf16 and not fully ascii.
///
/// ```js
/// // util.js
/// const extractedNewLineRe = new RegExp("(?<=\\n)");
/// extractedSplitNewLines = value => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
/// ```
#[bun_jsc::host_fn]
pub fn extracted_split_new_lines_fast_path_strings_only(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    debug_assert!(frame.arguments_count() == 1);
    let value = frame.argument(0);
    debug_assert!(value.is_string());

    // `defer str.deref()` — `to_bun_string` returns +1; `OwnedString`'s Drop
    // releases it on every exit path (bun_core::String itself is Copy, no Drop).
    let str = OwnedString::new(value.to_bun_string(global)?);

    match str.encoding() {
        // `inline .utf16, .latin1 => |encoding| split(encoding, ...)` — runtime → comptime dispatch
        EncodingNonAscii::Utf16 => split(EncodingNonAscii::Utf16, global, &str),
        EncodingNonAscii::Latin1 => split(EncodingNonAscii::Latin1, global, &str),
        EncodingNonAscii::Utf8 => {
            if strings::is_all_ascii(str.byte_slice()) {
                split(EncodingNonAscii::Utf8, global, &str)
            } else {
                Ok(JSValue::UNDEFINED)
            }
        }
    }
}

// PERF(port): `encoding` was a comptime parameter (Zig); demoted to runtime
// because `EncodingNonAscii` doesn't derive `ConstParamTy` (would need nightly
// `adt_const_params`). The hot u8/u16 split is still type-dispatched below.
fn split(
    encoding: EncodingNonAscii,
    global: &JSGlobalObject,
    str: &BunString,
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback (std.heap.stackFallback(1024)) — profile in Phase B.
    // Allocator param dropped (non-AST crate uses global mimalloc).

    // `defer { for (lines.items) |out| out.deref(); lines.deinit(alloc); }`
    // — `Vec<OwnedString>`'s Drop runs `deref()` on every element (covers both
    // the success path after `to_js_array` and any `?` early-return). Raw
    // `bun_core::String` is `Copy` and has NO Drop, so a `Vec<BunString>` would
    // leak; `OwnedString` is the RAII wrapper that mirrors Zig's defer loop.
    let mut lines: Vec<OwnedString> = Vec::new();

    // Zig: `const Char = switch (encoding) { .utf8, .latin1 => u8, .utf16 => u16 };`
    // PORT NOTE: reshaped — comptime enum cannot select an associated type in
    // stable Rust; split into two arms over the buffer's element type.
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

pub struct SplitNewlineIterator<'a, T> {
    buffer: &'a [T],
    index: Option<usize>,
}

impl<'a, T: Copy + PartialEq + From<u8>> SplitNewlineIterator<'a, T> {
    /// Returns a slice of the next field, or null if splitting is complete.
    pub fn next(&mut self) -> Option<&'a [T]> {
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

#[bun_jsc::host_fn]
pub fn normalize_encoding(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let input = frame.argument(0);
    // `defer str.deref()` — `from_js` returns +1; OwnedString releases on Drop.
    let str = OwnedString::new(BunString::from_js(input, global)?);
    debug_assert!(str.tag() != bstr::Tag::Dead);
    if str.length() == 0 {
        return Ok(Encoding::Utf8.to_js(global));
    }
    if let Some(enc) = Encoding::from_bun_string(&str) {
        return Ok(enc.to_js(global));
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn parse_env(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let content = frame.argument(0);
    validators::validate_string(global, content, "content")?;

    // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B.
    // Non-AST crate: arena dropped; Map/Loader use global allocator and Drop.

    // `validate_string` above guarantees `content.is_string()`, so
    // `as_string()` returns a non-null live JSString*. `JSString` is an
    // `opaque_ffi!` ZST handle; `opaque_ref` is the centralised deref proof.
    let str = bun_jsc::JSString::opaque_ref(content.as_string()).to_slice(global);

    let mut map = envloader::Map::init();
    let mut p = envloader::Loader::init(&mut map);
    p.load_from_string::<true, false>(str.slice())?;
    drop(p);

    let obj = JSValue::create_empty_object(global, map.count());
    for (k, v) in map.iter() {
        obj.put(
            global,
            &ZigString::init_utf8(k),
            bun_string_jsc::create_utf8_for_js(global, &v.value)?,
        );
    }
    Ok(obj)
}

// ported from: src/runtime/node/node_util_binding.zig
