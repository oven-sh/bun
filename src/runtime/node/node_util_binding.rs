use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::{self as bstr, strings, String as BunString, ZigString};
use bun_str::strings::EncodingNonAscii;
use bun_sys::UV_E;

use bun_dotenv::env_loader as envloader;
use crate::node::util::validators;

#[bun_jsc::host_fn]
pub fn internal_error_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(1).slice();
    if arguments.len() < 1 {
        return global.throw_not_enough_arguments("internalErrorName", 1, arguments.len());
    }

    let err_value = arguments[0];
    let err_int = err_value.to_int32();

    if err_int == -4095 { return Ok(BunString::static_("EOF").to_js(global)); }
    if err_int == -4094 { return Ok(BunString::static_("UNKNOWN").to_js(global)); }
    if err_int == -3000 { return Ok(BunString::static_("EAI_ADDRFAMILY").to_js(global)); }
    if err_int == -3001 { return Ok(BunString::static_("EAI_AGAIN").to_js(global)); }
    if err_int == -3002 { return Ok(BunString::static_("EAI_BADFLAGS").to_js(global)); }
    if err_int == -3003 { return Ok(BunString::static_("EAI_CANCELED").to_js(global)); }
    if err_int == -3004 { return Ok(BunString::static_("EAI_FAIL").to_js(global)); }
    if err_int == -3005 { return Ok(BunString::static_("EAI_FAMILY").to_js(global)); }
    if err_int == -3006 { return Ok(BunString::static_("EAI_MEMORY").to_js(global)); }
    if err_int == -3007 { return Ok(BunString::static_("EAI_NODATA").to_js(global)); }
    if err_int == -3008 { return Ok(BunString::static_("EAI_NONAME").to_js(global)); }
    if err_int == -3009 { return Ok(BunString::static_("EAI_OVERFLOW").to_js(global)); }
    if err_int == -3010 { return Ok(BunString::static_("EAI_SERVICE").to_js(global)); }
    if err_int == -3011 { return Ok(BunString::static_("EAI_SOCKTYPE").to_js(global)); }
    if err_int == -3013 { return Ok(BunString::static_("EAI_BADHINTS").to_js(global)); }
    if err_int == -3014 { return Ok(BunString::static_("EAI_PROTOCOL").to_js(global)); }

    // TODO(port): Zig `@"2BIG"` — Rust identifiers cannot start with a digit; assuming `UV_E::_2BIG`
    if err_int == -UV_E::_2BIG { return Ok(BunString::static_("E2BIG").to_js(global)); }
    if err_int == -UV_E::ACCES { return Ok(BunString::static_("EACCES").to_js(global)); }
    if err_int == -UV_E::ADDRINUSE { return Ok(BunString::static_("EADDRINUSE").to_js(global)); }
    if err_int == -UV_E::ADDRNOTAVAIL { return Ok(BunString::static_("EADDRNOTAVAIL").to_js(global)); }
    if err_int == -UV_E::AFNOSUPPORT { return Ok(BunString::static_("EAFNOSUPPORT").to_js(global)); }
    if err_int == -UV_E::AGAIN { return Ok(BunString::static_("EAGAIN").to_js(global)); }
    if err_int == -UV_E::ALREADY { return Ok(BunString::static_("EALREADY").to_js(global)); }
    if err_int == -UV_E::BADF { return Ok(BunString::static_("EBADF").to_js(global)); }
    if err_int == -UV_E::BUSY { return Ok(BunString::static_("EBUSY").to_js(global)); }
    if err_int == -UV_E::CANCELED { return Ok(BunString::static_("ECANCELED").to_js(global)); }
    if err_int == -UV_E::CHARSET { return Ok(BunString::static_("ECHARSET").to_js(global)); }
    if err_int == -UV_E::CONNABORTED { return Ok(BunString::static_("ECONNABORTED").to_js(global)); }
    if err_int == -UV_E::CONNREFUSED { return Ok(BunString::static_("ECONNREFUSED").to_js(global)); }
    if err_int == -UV_E::CONNRESET { return Ok(BunString::static_("ECONNRESET").to_js(global)); }
    if err_int == -UV_E::DESTADDRREQ { return Ok(BunString::static_("EDESTADDRREQ").to_js(global)); }
    if err_int == -UV_E::EXIST { return Ok(BunString::static_("EEXIST").to_js(global)); }
    if err_int == -UV_E::FAULT { return Ok(BunString::static_("EFAULT").to_js(global)); }
    if err_int == -UV_E::HOSTUNREACH { return Ok(BunString::static_("EHOSTUNREACH").to_js(global)); }
    if err_int == -UV_E::INTR { return Ok(BunString::static_("EINTR").to_js(global)); }
    if err_int == -UV_E::INVAL { return Ok(BunString::static_("EINVAL").to_js(global)); }
    if err_int == -UV_E::IO { return Ok(BunString::static_("EIO").to_js(global)); }
    if err_int == -UV_E::ISCONN { return Ok(BunString::static_("EISCONN").to_js(global)); }
    if err_int == -UV_E::ISDIR { return Ok(BunString::static_("EISDIR").to_js(global)); }
    if err_int == -UV_E::LOOP { return Ok(BunString::static_("ELOOP").to_js(global)); }
    if err_int == -UV_E::MFILE { return Ok(BunString::static_("EMFILE").to_js(global)); }
    if err_int == -UV_E::MSGSIZE { return Ok(BunString::static_("EMSGSIZE").to_js(global)); }
    if err_int == -UV_E::NAMETOOLONG { return Ok(BunString::static_("ENAMETOOLONG").to_js(global)); }
    if err_int == -UV_E::NETDOWN { return Ok(BunString::static_("ENETDOWN").to_js(global)); }
    if err_int == -UV_E::NETUNREACH { return Ok(BunString::static_("ENETUNREACH").to_js(global)); }
    if err_int == -UV_E::NFILE { return Ok(BunString::static_("ENFILE").to_js(global)); }
    if err_int == -UV_E::NOBUFS { return Ok(BunString::static_("ENOBUFS").to_js(global)); }
    if err_int == -UV_E::NODEV { return Ok(BunString::static_("ENODEV").to_js(global)); }
    if err_int == -UV_E::NOENT { return Ok(BunString::static_("ENOENT").to_js(global)); }
    if err_int == -UV_E::NOMEM { return Ok(BunString::static_("ENOMEM").to_js(global)); }
    if err_int == -UV_E::NONET { return Ok(BunString::static_("ENONET").to_js(global)); }
    if err_int == -UV_E::NOSPC { return Ok(BunString::static_("ENOSPC").to_js(global)); }
    if err_int == -UV_E::NOSYS { return Ok(BunString::static_("ENOSYS").to_js(global)); }
    if err_int == -UV_E::NOTCONN { return Ok(BunString::static_("ENOTCONN").to_js(global)); }
    if err_int == -UV_E::NOTDIR { return Ok(BunString::static_("ENOTDIR").to_js(global)); }
    if err_int == -UV_E::NOTEMPTY { return Ok(BunString::static_("ENOTEMPTY").to_js(global)); }
    if err_int == -UV_E::NOTSOCK { return Ok(BunString::static_("ENOTSOCK").to_js(global)); }
    if err_int == -UV_E::NOTSUP { return Ok(BunString::static_("ENOTSUP").to_js(global)); }
    if err_int == -UV_E::PERM { return Ok(BunString::static_("EPERM").to_js(global)); }
    if err_int == -UV_E::PIPE { return Ok(BunString::static_("EPIPE").to_js(global)); }
    if err_int == -UV_E::PROTO { return Ok(BunString::static_("EPROTO").to_js(global)); }
    if err_int == -UV_E::PROTONOSUPPORT { return Ok(BunString::static_("EPROTONOSUPPORT").to_js(global)); }
    if err_int == -UV_E::PROTOTYPE { return Ok(BunString::static_("EPROTOTYPE").to_js(global)); }
    if err_int == -UV_E::ROFS { return Ok(BunString::static_("EROFS").to_js(global)); }
    if err_int == -UV_E::SHUTDOWN { return Ok(BunString::static_("ESHUTDOWN").to_js(global)); }
    if err_int == -UV_E::SPIPE { return Ok(BunString::static_("ESPIPE").to_js(global)); }
    if err_int == -UV_E::SRCH { return Ok(BunString::static_("ESRCH").to_js(global)); }
    if err_int == -UV_E::TIMEDOUT { return Ok(BunString::static_("ETIMEDOUT").to_js(global)); }
    if err_int == -UV_E::TXTBSY { return Ok(BunString::static_("ETXTBSY").to_js(global)); }
    if err_int == -UV_E::XDEV { return Ok(BunString::static_("EXDEV").to_js(global)); }
    if err_int == -UV_E::FBIG { return Ok(BunString::static_("EFBIG").to_js(global)); }
    if err_int == -UV_E::NOPROTOOPT { return Ok(BunString::static_("ENOPROTOOPT").to_js(global)); }
    if err_int == -UV_E::RANGE { return Ok(BunString::static_("ERANGE").to_js(global)); }
    if err_int == -UV_E::NXIO { return Ok(BunString::static_("ENXIO").to_js(global)); }
    if err_int == -UV_E::MLINK { return Ok(BunString::static_("EMLINK").to_js(global)); }
    if err_int == -UV_E::HOSTDOWN { return Ok(BunString::static_("EHOSTDOWN").to_js(global)); }
    if err_int == -UV_E::REMOTEIO { return Ok(BunString::static_("EREMOTEIO").to_js(global)); }
    if err_int == -UV_E::NOTTY { return Ok(BunString::static_("ENOTTY").to_js(global)); }
    if err_int == -UV_E::FTYPE { return Ok(BunString::static_("EFTYPE").to_js(global)); }
    if err_int == -UV_E::ILSEQ { return Ok(BunString::static_("EILSEQ").to_js(global)); }
    if err_int == -UV_E::OVERFLOW { return Ok(BunString::static_("EOVERFLOW").to_js(global)); }
    if err_int == -UV_E::SOCKTNOSUPPORT { return Ok(BunString::static_("ESOCKTNOSUPPORT").to_js(global)); }
    if err_int == -UV_E::NODATA { return Ok(BunString::static_("ENODATA").to_js(global)); }
    if err_int == -UV_E::UNATCH { return Ok(BunString::static_("EUNATCH").to_js(global)); }
    if err_int == -UV_E::NOEXEC { return Ok(BunString::static_("ENOEXEC").to_js(global)); }

    let mut fmtstring = BunString::create_format(format_args!("Unknown system error {}", err_int));
    Ok(fmtstring.transfer_to_js(global))
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

    let str = value.to_bun_string(global)?;
    // `defer str.deref()` — handled by Drop on bun_str::String

    match str.encoding() {
        // `inline .utf16, .latin1 => |encoding| split(encoding, ...)` — runtime → comptime dispatch
        EncodingNonAscii::Utf16 => split::<{ EncodingNonAscii::Utf16 }>(global, &str),
        EncodingNonAscii::Latin1 => split::<{ EncodingNonAscii::Latin1 }>(global, &str),
        EncodingNonAscii::Utf8 => {
            if strings::is_all_ascii(str.byte_slice()) {
                split::<{ EncodingNonAscii::Utf8 }>(global, &str)
            } else {
                Ok(JSValue::UNDEFINED)
            }
        }
    }
}

fn split<const ENCODING: EncodingNonAscii>(
    global: &JSGlobalObject,
    str: &BunString,
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback (std.heap.stackFallback(1024)) — profile in Phase B
    // Allocator param dropped (non-AST crate uses global mimalloc).

    // Zig: `const Char = switch (encoding) { .utf8, .latin1 => u8, .utf16 => u16 };`
    // TODO(port): const-generic enum cannot select an associated type directly in stable Rust.
    // Reshaped into two arms over the buffer's element type; logic is identical.
    // PORT NOTE: reshaped for type-level dispatch on ENCODING.

    // `defer { for (lines.items) |out| out.deref(); lines.deinit(alloc); }`
    // — Vec<BunString> dropping at scope exit derefs each element via bun_str::String's Drop.
    let mut lines: Vec<BunString> = Vec::new();

    match ENCODING {
        EncodingNonAscii::Utf16 => {
            let buffer: &[u16] = str.utf16();
            let mut it = SplitNewlineIterator { buffer, index: Some(0) };
            while let Some(line) = it.next() {
                let encoded_line = BunString::borrow_utf16(line);
                // errdefer encoded_line.deref() — Drop on BunString handles error path
                lines.push(encoded_line);
            }
        }
        EncodingNonAscii::Utf8 | EncodingNonAscii::Latin1 => {
            let buffer: &[u8] = str.byte_slice();
            let mut it = SplitNewlineIterator { buffer, index: Some(0) };
            while let Some(line) = it.next() {
                let encoded_line = match ENCODING {
                    EncodingNonAscii::Utf8 => BunString::borrow_utf8(line),
                    EncodingNonAscii::Latin1 => BunString::clone_latin1(line),
                    EncodingNonAscii::Utf16 => unreachable!(),
                };
                // errdefer encoded_line.deref() — Drop on BunString handles error path
                lines.push(encoded_line);
            }
        }
    }

    BunString::to_js_array(global, lines.as_slice())
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
    let str = BunString::from_js(input, global)?;
    debug_assert!(str.tag() != bstr::Tag::Dead);
    // `defer str.deref()` — handled by Drop
    if str.length() == 0 {
        return Ok(bun_jsc::node::Encoding::Utf8.to_js(global));
    }
    if let Some(enc) = str.in_map_case_insensitive(&bun_jsc::node::Encoding::MAP) {
        return Ok(enc.to_js(global));
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn parse_env(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let content = frame.argument(0);
    validators::validate_string(global, content, "content", format_args!(""))?;

    // PERF(port): was arena bulk-free (std.heap.ArenaAllocator) — profile in Phase B.
    // Non-AST crate: arena dropped; Map/Loader/to_slice use global allocator and Drop.

    let str = content.as_string().to_slice(global);

    let mut map = envloader::Map::init();
    let mut p = envloader::Loader::init(&mut map);
    p.load_from_string(str.slice(), true, false)?;

    let obj = JSValue::create_empty_object(global, map.map.count());
    debug_assert_eq!(map.map.keys().len(), map.map.values().len());
    for (k, v) in map.map.keys().iter().zip(map.map.values()) {
        obj.put(
            global,
            ZigString::init_utf8(k),
            BunString::create_utf8_for_js(global, v.value)?,
        );
    }
    Ok(obj)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_util_binding.zig (237 lines)
//   confidence: medium
//   todos:      2
//   notes:      split() reshaped for const-generic type dispatch (u8/u16); UV_E::@"2BIG" → _2BIG
// ──────────────────────────────────────────────────────────────────────────
