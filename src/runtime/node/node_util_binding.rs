use bun_core::strings::EncodingNonAscii;
use bun_core::{String as BunString, strings};
use bun_jsc::bindgen::{self, JsHeap, JsLocal};
use bun_jsc::{JSValue, bun_string_jsc};
use bun_sys::UV_E;

use crate::generated_bindgen::node_util_binding::{HandleType, UVError};
use crate::node::types::Encoding;
use bun_dotenv::env_loader as envloader;

pub(crate) fn internal_error_name(err: f64) -> BunString {
    let err_int = err as i32;
    if f64::from(err_int) == err
        && let Some(name) = UV_E::name(err_int)
    {
        return BunString::static_(name);
    }
    BunString::create_format(format_args!("Unknown system error {err}"))
}

/// libuv's full error table for this target. Consumed by node:util's getSystemErrorMap().
pub(crate) fn internal_error_entries() -> impl Iterator<Item = UVError> {
    UV_E::ENTRIES.iter().map(|&(code, name)| UVError {
        code,
        name: BunString::static_(name),
    })
}

pub(crate) fn etimedout_error_code() -> i32 {
    -UV_E::TIMEDOUT
}

pub(crate) fn enobufs_error_code() -> i32 {
    -UV_E::NOBUFS
}

pub(crate) fn uv_translate_sys_error(errno: f64) -> i32 {
    let n = errno as i32;
    if n <= 0 {
        return n;
    }
    #[cfg(windows)]
    {
        // SAFETY: pure translation function.
        let uv_err = unsafe { bun_libuv_sys::uv_translate_sys_error(n) };
        if uv_err != 0 { uv_err } else { -UV_E::INVAL }
    }
    #[cfg(not(windows))]
    {
        -n
    }
}

/// libuv's ECANCELED code (`uv_udp_send` requests cancelled by close). Not a
/// JS-side literal (unlike EBADF/EINVAL, ECANCELED's number differs across the
/// POSIX platforms: Linux 125, Darwin 89, FreeBSD 85; synthetic -4081 on
/// Windows), and NOT `process.binding("uv")` either: that binding negates the
/// compiling host's <errno.h> value, which on Windows is the CRT's 105, not
/// libuv's -4081. `UV_E` is the one table that is libuv-correct everywhere.
pub(crate) fn ecanceled_error_code() -> i32 {
    -UV_E::CANCELED
}

/// `extractedSplitNewLines` for ASCII/Latin1 strings.
/// Returns `undefined` if param is utf8 or utf16 and not fully ascii.
///
/// ```js
/// // util.js
/// const extractedNewLineRe = new RegExp("(?<=\\n)");
/// extractedSplitNewLines = value => RegExpPrototypeSymbolSplit(extractedNewLineRe, value);
/// ```
pub(crate) fn extracted_split_new_lines_fast_path_strings_only(
    value: &BunString,
) -> Option<Vec<BunString>> {
    match value.encoding() {
        EncodingNonAscii::Utf16 => Some(split(value.utf16(), BunString::clone_utf16)),
        EncodingNonAscii::Latin1 => Some(split(value.byte_slice(), BunString::clone_latin1)),
        EncodingNonAscii::Utf8 => strings::is_all_ascii(value.byte_slice())
            .then(|| split(value.byte_slice(), BunString::clone_utf8)),
    }
}

fn split<T: Copy + PartialEq + From<u8>>(
    buffer: &[T],
    clone: fn(&[T]) -> BunString,
) -> Vec<BunString> {
    let mut lines = Vec::new();
    let mut it = SplitNewlineIterator {
        buffer,
        index: Some(0),
    };
    while let Some(line) = it.next() {
        lines.push(clone(line));
    }
    lines
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

pub(crate) fn normalize_encoding<'a>(heap: &JsHeap<'a>, encoding: &BunString) -> JsLocal<'a> {
    // SAFETY: the name of an encoding is a string the VM already has.
    let global = unsafe { heap.global() };
    let found = if encoding.length() == 0 {
        Some(Encoding::Utf8)
    } else {
        Encoding::from_bun_string(encoding)
    };
    found.map_or(JsLocal::UNDEFINED, |found| {
        JsLocal::new(heap, found.to_js(global))
    })
}

pub(crate) fn parse_env<'a>(heap: &JsHeap<'a>, content: &[u8]) -> bindgen::Result<'a, JsLocal<'a>> {
    let mut p = envloader::Loader::init();
    p.load_from_string::<true, false>(content)?;

    // SAFETY: the object is new and plain, and its properties are defined and not set.
    let global = unsafe { heap.global() };
    let obj = JSValue::create_empty_object(global, p.map.map.count());
    for (k, v) in p.map.map.iter() {
        // A key like `0=` or `2023=` is an array index. `put` asserts on those.
        obj.put_may_be_index(
            global,
            &BunString::from_bytes(k),
            bun_string_jsc::create_utf8_for_js(global, &v.value)?,
        )?;
    }
    Ok(JsLocal::new(heap, obj))
}

/// node's `guessHandleType(fd)`: the kind of handle that libuv's
/// `uv_guess_handle` sees in the fd.
pub(crate) fn guess_handle_type(fd: i32) -> HandleType {
    if fd < 0 {
        return HandleType::UNKNOWN;
    }
    guess_handle_type_from_fd(fd)
}

#[cfg(windows)]
fn guess_handle_type_from_fd(fd_int: i32) -> HandleType {
    use bun_sys::windows::libuv as uv;
    match uv::uv_guess_handle(fd_int) {
        uv::HandleType::Tcp => HandleType::TCP,
        uv::HandleType::Tty => HandleType::TTY,
        uv::HandleType::Udp => HandleType::UDP,
        uv::HandleType::File => HandleType::FILE,
        uv::HandleType::NamedPipe => HandleType::PIPE,
        _ => HandleType::UNKNOWN,
    }
}

#[cfg(not(windows))]
fn guess_handle_type_from_fd(fd_int: i32) -> HandleType {
    let fd = bun_sys::Fd::from_uv(fd_int);

    // SAFETY: `isatty` is a simple fd query with no preconditions.
    if unsafe { libc::isatty(fd_int) } != 0 {
        return HandleType::TTY;
    }

    let stat = match bun_sys::fstat(fd) {
        Ok(s) => s,
        Err(_) => return HandleType::UNKNOWN,
    };
    let mode = stat.st_mode as _;
    if bun_sys::S::ISREG(mode) || bun_sys::S::ISCHR(mode) {
        return HandleType::FILE;
    }
    if bun_sys::S::ISFIFO(mode) {
        return HandleType::PIPE;
    }
    if !bun_sys::S::ISSOCK(mode) {
        return HandleType::UNKNOWN;
    }

    // Socket: distinguish TCP / UDP / unix (pipe) by family + socket type.
    let mut ss = std::mem::MaybeUninit::<libc::sockaddr_storage>::uninit();
    let mut ss_len = std::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
    // SAFETY: `ss` is a live stack local sized for `sockaddr_storage` and
    // `ss_len` bounds the write; getsockname fills up to `ss_len` bytes.
    if unsafe { libc::getsockname(fd_int, ss.as_mut_ptr().cast(), &raw mut ss_len) } != 0 {
        return HandleType::UNKNOWN;
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
        return HandleType::UNKNOWN;
    }

    if so_type == libc::SOCK_DGRAM {
        if family == libc::AF_INET || family == libc::AF_INET6 {
            return HandleType::UDP;
        }
        return HandleType::UNKNOWN;
    }
    if so_type == libc::SOCK_STREAM {
        if family == libc::AF_INET || family == libc::AF_INET6 {
            return HandleType::TCP;
        }
        if family == libc::AF_UNIX {
            return HandleType::PIPE;
        }
    }
    HandleType::UNKNOWN
}
