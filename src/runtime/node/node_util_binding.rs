use bun_jsc::{bun_string_jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_str::{self as bstr, strings, OwnedString, String as BunString, ZigString};
use bun_str::strings::EncodingNonAscii;
use bun_sys::UV_E;

use bun_dotenv::env_loader as envloader;
use crate::node::types::{Encoding, ENCODING_MAP};
use crate::node::util::validators;

#[bun_jsc::host_fn]
pub fn internal_error_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments("internalErrorName", 1, arguments.len()));
    }

    let err_value = arguments[0];
    let err_int = err_value.to_int32();

    if err_int == -4095 { return BunString::static_("EOF").to_js(global); }
    if err_int == -4094 { return BunString::static_("UNKNOWN").to_js(global); }
    if err_int == -3000 { return BunString::static_("EAI_ADDRFAMILY").to_js(global); }
    if err_int == -3001 { return BunString::static_("EAI_AGAIN").to_js(global); }
    if err_int == -3002 { return BunString::static_("EAI_BADFLAGS").to_js(global); }
    if err_int == -3003 { return BunString::static_("EAI_CANCELED").to_js(global); }
    if err_int == -3004 { return BunString::static_("EAI_FAIL").to_js(global); }
    if err_int == -3005 { return BunString::static_("EAI_FAMILY").to_js(global); }
    if err_int == -3006 { return BunString::static_("EAI_MEMORY").to_js(global); }
    if err_int == -3007 { return BunString::static_("EAI_NODATA").to_js(global); }
    if err_int == -3008 { return BunString::static_("EAI_NONAME").to_js(global); }
    if err_int == -3009 { return BunString::static_("EAI_OVERFLOW").to_js(global); }
    if err_int == -3010 { return BunString::static_("EAI_SERVICE").to_js(global); }
    if err_int == -3011 { return BunString::static_("EAI_SOCKTYPE").to_js(global); }
    if err_int == -3013 { return BunString::static_("EAI_BADHINTS").to_js(global); }
    if err_int == -3014 { return BunString::static_("EAI_PROTOCOL").to_js(global); }

    // Zig `@"2BIG"` — Rust identifiers cannot start with a digit; uv_e exposes it as `_2BIG`.
    if err_int == -UV_E::_2BIG { return BunString::static_("E2BIG").to_js(global); }
    if err_int == -UV_E::ACCES { return BunString::static_("EACCES").to_js(global); }
    if err_int == -UV_E::ADDRINUSE { return BunString::static_("EADDRINUSE").to_js(global); }
    if err_int == -UV_E::ADDRNOTAVAIL { return BunString::static_("EADDRNOTAVAIL").to_js(global); }
    if err_int == -UV_E::AFNOSUPPORT { return BunString::static_("EAFNOSUPPORT").to_js(global); }
    if err_int == -UV_E::AGAIN { return BunString::static_("EAGAIN").to_js(global); }
    if err_int == -UV_E::ALREADY { return BunString::static_("EALREADY").to_js(global); }
    if err_int == -UV_E::BADF { return BunString::static_("EBADF").to_js(global); }
    if err_int == -UV_E::BUSY { return BunString::static_("EBUSY").to_js(global); }
    if err_int == -UV_E::CANCELED { return BunString::static_("ECANCELED").to_js(global); }
    if err_int == -UV_E::CHARSET { return BunString::static_("ECHARSET").to_js(global); }
    if err_int == -UV_E::CONNABORTED { return BunString::static_("ECONNABORTED").to_js(global); }
    if err_int == -UV_E::CONNREFUSED { return BunString::static_("ECONNREFUSED").to_js(global); }
    if err_int == -UV_E::CONNRESET { return BunString::static_("ECONNRESET").to_js(global); }
    if err_int == -UV_E::DESTADDRREQ { return BunString::static_("EDESTADDRREQ").to_js(global); }
    if err_int == -UV_E::EXIST { return BunString::static_("EEXIST").to_js(global); }
    if err_int == -UV_E::FAULT { return BunString::static_("EFAULT").to_js(global); }
    if err_int == -UV_E::HOSTUNREACH { return BunString::static_("EHOSTUNREACH").to_js(global); }
    if err_int == -UV_E::INTR { return BunString::static_("EINTR").to_js(global); }
    if err_int == -UV_E::INVAL { return BunString::static_("EINVAL").to_js(global); }
    if err_int == -UV_E::IO { return BunString::static_("EIO").to_js(global); }
    if err_int == -UV_E::ISCONN { return BunString::static_("EISCONN").to_js(global); }
    if err_int == -UV_E::ISDIR { return BunString::static_("EISDIR").to_js(global); }
    if err_int == -UV_E::LOOP { return BunString::static_("ELOOP").to_js(global); }
    if err_int == -UV_E::MFILE { return BunString::static_("EMFILE").to_js(global); }
    if err_int == -UV_E::MSGSIZE { return BunString::static_("EMSGSIZE").to_js(global); }
    if err_int == -UV_E::NAMETOOLONG { return BunString::static_("ENAMETOOLONG").to_js(global); }
    if err_int == -UV_E::NETDOWN { return BunString::static_("ENETDOWN").to_js(global); }
    if err_int == -UV_E::NETUNREACH { return BunString::static_("ENETUNREACH").to_js(global); }
    if err_int == -UV_E::NFILE { return BunString::static_("ENFILE").to_js(global); }
    if err_int == -UV_E::NOBUFS { return BunString::static_("ENOBUFS").to_js(global); }
    if err_int == -UV_E::NODEV { return BunString::static_("ENODEV").to_js(global); }
    if err_int == -UV_E::NOENT { return BunString::static_("ENOENT").to_js(global); }
    if err_int == -UV_E::NOMEM { return BunString::static_("ENOMEM").to_js(global); }
    if err_int == -UV_E::NONET { return BunString::static_("ENONET").to_js(global); }
    if err_int == -UV_E::NOSPC { return BunString::static_("ENOSPC").to_js(global); }
    if err_int == -UV_E::NOSYS { return BunString::static_("ENOSYS").to_js(global); }
    if err_int == -UV_E::NOTCONN { return BunString::static_("ENOTCONN").to_js(global); }
    if err_int == -UV_E::NOTDIR { return BunString::static_("ENOTDIR").to_js(global); }
    if err_int == -UV_E::NOTEMPTY { return BunString::static_("ENOTEMPTY").to_js(global); }
    if err_int == -UV_E::NOTSOCK { return BunString::static_("ENOTSOCK").to_js(global); }
    if err_int == -UV_E::NOTSUP { return BunString::static_("ENOTSUP").to_js(global); }
    if err_int == -UV_E::PERM { return BunString::static_("EPERM").to_js(global); }
    if err_int == -UV_E::PIPE { return BunString::static_("EPIPE").to_js(global); }
    if err_int == -UV_E::PROTO { return BunString::static_("EPROTO").to_js(global); }
    if err_int == -UV_E::PROTONOSUPPORT { return BunString::static_("EPROTONOSUPPORT").to_js(global); }
    if err_int == -UV_E::PROTOTYPE { return BunString::static_("EPROTOTYPE").to_js(global); }
    if err_int == -UV_E::ROFS { return BunString::static_("EROFS").to_js(global); }
    if err_int == -UV_E::SHUTDOWN { return BunString::static_("ESHUTDOWN").to_js(global); }
    if err_int == -UV_E::SPIPE { return BunString::static_("ESPIPE").to_js(global); }
    if err_int == -UV_E::SRCH { return BunString::static_("ESRCH").to_js(global); }
    if err_int == -UV_E::TIMEDOUT { return BunString::static_("ETIMEDOUT").to_js(global); }
    if err_int == -UV_E::TXTBSY { return BunString::static_("ETXTBSY").to_js(global); }
    if err_int == -UV_E::XDEV { return BunString::static_("EXDEV").to_js(global); }
    if err_int == -UV_E::FBIG { return BunString::static_("EFBIG").to_js(global); }
    if err_int == -UV_E::NOPROTOOPT { return BunString::static_("ENOPROTOOPT").to_js(global); }
    if err_int == -UV_E::RANGE { return BunString::static_("ERANGE").to_js(global); }
    if err_int == -UV_E::NXIO { return BunString::static_("ENXIO").to_js(global); }
    if err_int == -UV_E::MLINK { return BunString::static_("EMLINK").to_js(global); }
    if err_int == -UV_E::HOSTDOWN { return BunString::static_("EHOSTDOWN").to_js(global); }
    if err_int == -UV_E::REMOTEIO { return BunString::static_("EREMOTEIO").to_js(global); }
    if err_int == -UV_E::NOTTY { return BunString::static_("ENOTTY").to_js(global); }
    if err_int == -UV_E::FTYPE { return BunString::static_("EFTYPE").to_js(global); }
    if err_int == -UV_E::ILSEQ { return BunString::static_("EILSEQ").to_js(global); }
    if err_int == -UV_E::OVERFLOW { return BunString::static_("EOVERFLOW").to_js(global); }
    if err_int == -UV_E::SOCKTNOSUPPORT { return BunString::static_("ESOCKTNOSUPPORT").to_js(global); }
    if err_int == -UV_E::NODATA { return BunString::static_("ENODATA").to_js(global); }
    if err_int == -UV_E::UNATCH { return BunString::static_("EUNATCH").to_js(global); }
    if err_int == -UV_E::NOEXEC { return BunString::static_("ENOEXEC").to_js(global); }

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
    // releases it on every exit path (bun_str::String itself is Copy, no Drop).
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
fn split(encoding: EncodingNonAscii, global: &JSGlobalObject, str: &BunString) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback (std.heap.stackFallback(1024)) — profile in Phase B.
    // Allocator param dropped (non-AST crate uses global mimalloc).

    // `defer { for (lines.items) |out| out.deref(); lines.deinit(alloc); }`
    // — `Vec<OwnedString>`'s Drop runs `deref()` on every element (covers both
    // the success path after `to_js_array` and any `?` early-return). Raw
    // `bun_str::String` is `Copy` and has NO Drop, so a `Vec<BunString>` would
    // leak; `OwnedString` is the RAII wrapper that mirrors Zig's defer loop.
    let mut lines: Vec<OwnedString> = Vec::new();

    // Zig: `const Char = switch (encoding) { .utf8, .latin1 => u8, .utf16 => u16 };`
    // PORT NOTE: reshaped — comptime enum cannot select an associated type in
    // stable Rust; split into two arms over the buffer's element type.
    match encoding {
        EncodingNonAscii::Utf16 => {
            let buffer: &[u16] = str.utf16();
            let mut it = SplitNewlineIterator { buffer, index: Some(0) };
            while let Some(line) = it.next() {
                // errdefer encoded_line.deref() — folded into OwnedString Drop
                lines.push(OwnedString::new(BunString::borrow_utf16(line)));
            }
        }
        EncodingNonAscii::Utf8 | EncodingNonAscii::Latin1 => {
            let buffer: &[u8] = str.byte_slice();
            let mut it = SplitNewlineIterator { buffer, index: Some(0) };
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
    if let Some(enc) = str.in_map_case_insensitive(&ENCODING_MAP) {
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

    // SAFETY: `validate_string` above guarantees `content.is_string()`, so
    // `as_string()` returns a non-null live JSString*.
    let str = unsafe { &*content.as_string() }.to_slice(global);

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_util_binding.zig (237 lines)
//   confidence: high
//   notes:      split() reshaped for u8/u16 type dispatch; UV_E::@"2BIG" → _2BIG;
//               comptime EncodingNonAscii demoted to runtime arg (no adt_const_params)
// ──────────────────────────────────────────────────────────────────────────
