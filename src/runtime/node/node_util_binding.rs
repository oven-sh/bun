use bun_core::strings::EncodingNonAscii;
use bun_core::{String as BunString, strings};
use bun_jsc::bindgen::{self, JsHeap, JsLocal};
use bun_jsc::{JSValue, bun_string_jsc};
use bun_sys::UV_E;

use crate::generated_bindgen::node_util_binding::UVError;
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
    clone: impl Fn(&[T]) -> BunString,
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
