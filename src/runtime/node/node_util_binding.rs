use bun_core::strings::EncodingNonAscii;
use bun_core::{self as bstr, String as BunString, strings};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc};
use bun_sys::UV_E;

use crate::node::types::Encoding;
use crate::node::util::validators;
use bun_dotenv::env_loader as envloader;

#[bun_jsc::host_fn]
pub(crate) fn internal_error_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments("internalErrorName", 1, arguments.len()));
    }

    let err_int = arguments[0].to_int32();
    if let Some(name) = UV_E::name(err_int) {
        return BunString::static_(name).to_js(global);
    }
    BunString::create_format(format_args!("Unknown system error {}", err_int)).into_js(global)
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

#[bun_jsc::host_fn]
pub(crate) fn etimedout_error_code(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_number_from_int32(-UV_E::TIMEDOUT))
}

#[bun_jsc::host_fn]
pub(crate) fn enobufs_error_code(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_number_from_int32(-UV_E::NOBUFS))
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
#[bun_jsc::host_fn]
pub(crate) fn ecanceled_error_code(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_number_from_int32(-UV_E::CANCELED))
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
pub(crate) fn extracted_split_new_lines_fast_path_strings_only(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    debug_assert!(frame.arguments_count() == 1);
    let value = frame.argument(0);
    debug_assert!(value.is_string());

    let str = value.to_bun_string(global)?;

    match str.encoding() {
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

#[bun_jsc::host_fn]
pub(crate) fn normalize_encoding(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let input = frame.argument(0);
    let str = BunString::from_js(input, global)?;
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
pub(crate) fn parse_env(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let content = frame.argument(0);
    validators::validate_string(global, content, "content")?;

    // `validate_string` accepts StringObject, so coerce to a primitive JSString
    // before slicing.
    let view = content.to_js_string_view(global)?;
    let str = view.to_utf8();

    let mut p = envloader::Loader::init();
    p.load_from_string::<true, false>(str.slice())?;

    let obj = JSValue::create_empty_object(global, p.map.map.count());
    for (k, v) in p.map.map.iter() {
        // A key like `0=` or `2023=` is an array index. `put` asserts on those.
        obj.put_may_be_index(
            global,
            &BunString::from_bytes(k),
            bun_string_jsc::create_utf8_for_js(global, &v.value)?,
        )?;
    }
    Ok(obj)
}

/// Node's `util.guessHandleType(fd)` — returns a uint32 index into
/// `["TCP","TTY","UDP","FILE","PIPE","UNKNOWN"]`, matching the libuv
/// `uv_guess_handle` mapping that Node's `createHandle`/`getStdin` rely on.
#[bun_jsc::host_fn]
pub(crate) fn guess_handle_type(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let fd_value = frame.argument(0);
    if !fd_value.is_number() {
        return Err(global.throw_invalid_argument_type_value(b"fd", b"number", fd_value));
    }
    let fd_int = fd_value.to_int32();
    // UNKNOWN for negative fds.
    if fd_int < 0 {
        return Ok(JSValue::js_number_from_int32(HANDLE_UNKNOWN as i32));
    }
    Ok(JSValue::js_number_from_int32(
        guess_handle_type_from_fd(fd_int) as i32,
    ))
}

const HANDLE_TCP: u32 = 0;
const HANDLE_TTY: u32 = 1;
const HANDLE_UDP: u32 = 2;
const HANDLE_FILE: u32 = 3;
const HANDLE_PIPE: u32 = 4;
const HANDLE_UNKNOWN: u32 = 5;

#[cfg(windows)]
fn guess_handle_type_from_fd(fd_int: i32) -> u32 {
    use bun_sys::windows::libuv as uv;
    match uv::uv_guess_handle(fd_int) {
        uv::HandleType::Tcp => HANDLE_TCP,
        uv::HandleType::Tty => HANDLE_TTY,
        uv::HandleType::Udp => HANDLE_UDP,
        uv::HandleType::File => HANDLE_FILE,
        uv::HandleType::NamedPipe => HANDLE_PIPE,
        _ => HANDLE_UNKNOWN,
    }
}

#[cfg(not(windows))]
fn guess_handle_type_from_fd(fd_int: i32) -> u32 {
    let fd = bun_sys::Fd::from_uv(fd_int);

    // SAFETY: `isatty` is a simple fd query with no preconditions.
    if unsafe { libc::isatty(fd_int) } != 0 {
        return HANDLE_TTY;
    }

    let stat = match bun_sys::fstat(fd) {
        Ok(s) => s,
        Err(_) => return HANDLE_UNKNOWN,
    };
    let mode = stat.st_mode as _;
    if bun_sys::S::ISREG(mode) || bun_sys::S::ISCHR(mode) {
        return HANDLE_FILE;
    }
    if bun_sys::S::ISFIFO(mode) {
        return HANDLE_PIPE;
    }
    if !bun_sys::S::ISSOCK(mode) {
        return HANDLE_UNKNOWN;
    }

    // Socket: distinguish TCP / UDP / unix (pipe) by family + socket type.
    let mut ss = std::mem::MaybeUninit::<libc::sockaddr_storage>::uninit();
    let mut ss_len = std::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
    // SAFETY: `ss` is a live stack local sized for `sockaddr_storage` and
    // `ss_len` bounds the write; getsockname fills up to `ss_len` bytes.
    if unsafe { libc::getsockname(fd_int, ss.as_mut_ptr().cast(), &raw mut ss_len) } != 0 {
        return HANDLE_UNKNOWN;
    }
    // SAFETY: getsockname succeeded, so at least `ss_family` was initialized.
    let family = unsafe { ss.assume_init_ref() }.ss_family as libc::c_int;

    let mut so_type: libc::c_int = 0;
    let mut so_type_len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `so_type`/`so_type_len` are live stack locals sized for `c_int`.
    if unsafe {
        libc::getsockopt(
            fd_int,
            libc::SOL_SOCKET,
            libc::SO_TYPE,
            (&raw mut so_type).cast(),
            &raw mut so_type_len,
        )
    } != 0
    {
        return HANDLE_UNKNOWN;
    }

    if so_type == libc::SOCK_DGRAM {
        if family == libc::AF_INET || family == libc::AF_INET6 {
            return HANDLE_UDP;
        }
        return HANDLE_UNKNOWN;
    }
    if so_type == libc::SOCK_STREAM {
        if family == libc::AF_INET || family == libc::AF_INET6 {
            return HANDLE_TCP;
        }
        if family == libc::AF_UNIX {
            return HANDLE_PIPE;
        }
    }
    HANDLE_UNKNOWN
}
