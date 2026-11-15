//! Node's `path.posix` and `path.win32`: the algorithms, on slices of `u8` or `u16`. `node:path`
//! (src/runtime/node/path.rs) and the paths of `bun lint` and `bun fmt` are these.

#![feature(adt_const_params)]

mod tidy;
pub use tidy::{
    ParsedPosixLatin1, RelativePosixLatin1, basename_posix_latin1,
    basename_without_suffix_posix_latin1, dirname_posix_latin1, extname_posix_latin1, is_ascii,
    is_resolved_ascii_posix, is_tidy_ascii_posix, normalize_posix_latin1, parse_posix_latin1,
    relative_posix_latin1, resolve_absolute_posix_latin1,
};

#[cfg(windows)]
use bun_core::strings::CodeUnitsMut;
use bun_core::strings::{self, CodeUnits};
use bun_paths::{self, MAX_PATH_BYTES, Platform};

const PATH_MIN_WIDE: usize = 4096; // 4 KB

/// Canonical path-unit trait — re-export so external callers that named
/// `crate::node::path::PathChar` keep compiling.
pub use bun_paths::PathChar;

/// Runtime-only extension over [`PathChar`]: adds the
/// per-width `get_cwd` plus `Default` for zero-init. Every generic `_t`
/// fn here bounds on `PathCharCwd` (only `u8`/`u16` ever instantiate it).
pub trait PathCharCwd: PathChar + Default {
    /// Per-width `get_cwd` — replaces the `IS_U16` runtime dispatch in `get_cwd_t`.
    fn get_cwd(buf: &mut [Self]) -> &mut [Self];
}
impl PathCharCwd for u8 {
    #[inline]
    fn get_cwd(buf: &mut [u8]) -> &mut [u8] {
        get_cwd_u8(buf)
    }
}
impl PathCharCwd for u16 {
    #[inline]
    fn get_cwd(buf: &mut [u16]) -> &mut [u16] {
        get_cwd_u16(buf)
    }
}

/// Yields a `&'static [T]` for an ASCII literal.
#[inline]
fn l<T: PathCharCwd>(s: &'static [u8]) -> &'static [T] {
    T::lit(s)
}

/// Compares ASCII values case-insensitively, non-ASCII values are compared directly
fn eql_ignore_case_t<T: PathCharCwd>(a: &[T], b: &[T]) -> bool {
    if let (CodeUnits::U8(a), CodeUnits::U8(b)) = (T::units(a), T::units(b)) {
        return strings::eql_case_insensitive_ascii(a, b, true);
    }
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| to_lower_t(*x) == to_lower_t(*y))
}

/// Lowers ASCII values, non-ASCII values are returned directly
#[inline]
fn to_lower_t<T: PathCharCwd>(a_c: T) -> T {
    if !T::IS_U16 {
        return T::from_u8(
            u8::try_from(a_c.as_u32())
                .expect("int cast")
                .to_ascii_lowercase(),
        );
    }
    if a_c.as_u32() < 128 {
        T::from_u8(
            u8::try_from(a_c.as_u32())
                .expect("int cast")
                .to_ascii_lowercase(),
        )
    } else {
        a_c
    }
}

// validatePathT is enforced at compile time by the `PathChar` trait bound.

pub const CHAR_BACKWARD_SLASH: u8 = b'\\';
const CHAR_COLON: u8 = b':';
const CHAR_DOT: u8 = b'.';
pub const CHAR_FORWARD_SLASH: u8 = b'/';
const CHAR_QUESTION_MARK: u8 = b'?';

const CHAR_STR_BACKWARD_SLASH: &[u8] = b"\\";
const CHAR_STR_FORWARD_SLASH: &[u8] = b"/";
pub const CHAR_STR_DOT: &[u8] = b".";

/// Based on Node v21.6.1 path.parse:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L919
/// The structs returned by parse methods.
#[derive(Default)]
pub struct PathParsed<'a, T: PathCharCwd> {
    pub root: &'a [T],
    pub dir: &'a [T],
    pub base: &'a [T],
    pub ext: &'a [T],
    pub name: &'a [T],
}

const fn max_path_size<T: PathCharCwd>() -> usize {
    if T::IS_U16 {
        bun_paths::PATH_MAX_WIDE
    } else {
        MAX_PATH_BYTES
    }
}

/// Upper bound of `max_path_size::<T>()` across both `T = u8` and `T = u16` on
/// the current target. Used for sizing stack buffers where the `T`-dependent
/// array length can't be expressed as a const-generic.
const MAX_PATH_SIZE_UPPER: usize = if MAX_PATH_BYTES > bun_paths::PATH_MAX_WIDE {
    MAX_PATH_BYTES
} else {
    bun_paths::PATH_MAX_WIDE
};

pub const fn path_size<T: PathCharCwd>() -> usize {
    if T::IS_U16 {
        PATH_MIN_WIDE
    } else {
        MAX_PATH_BYTES
    }
}

/// Helper: equal-length copy.
/// (Rust's borrow rules forbid `&mut [T]`/`&[T]` overlap, so memmove ⇒ memcpy.)
#[inline]
fn memmove<T: Copy>(dst: &mut [T], src: &[T]) {
    dst.copy_from_slice(src);
}

/// What `resolve` answers always starts at `buf[0]`.
fn dot<T: PathCharCwd>(buf: &mut [T]) -> &[T] {
    buf[0] = T::from_u8(CHAR_DOT);
    &buf[..1]
}

/// Based on Node v21.6.1 private helper posixCwd:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1074
fn posix_cwd_t<T: PathCharCwd>(buf: &mut [T]) -> &mut [T] {
    let cwd = get_cwd_t(buf);
    let len = cwd.len();
    if len == 0 {
        return cwd;
    }
    #[cfg(windows)]
    {
        // Converts Windows' backslash path separators to POSIX forward slashes
        // and truncates any drive indicator

        // Translated from the following JS code:
        //   const cwd = StringPrototypeReplace(process.cwd(), regexp, '/');
        // cwd already aliases buf, so mutate in place.
        for i in 0..len {
            if cwd[i] == T::from_u8(CHAR_BACKWARD_SLASH) {
                cwd[i] = T::from_u8(CHAR_FORWARD_SLASH);
            }
        }
        let normalized_cwd = &mut cwd[0..len];

        // Translated from the following JS code:
        //   return StringPrototypeSlice(cwd, StringPrototypeIndexOf(cwd, '/'));
        let index = strings::index_of_scalar(normalized_cwd, T::from_u8(CHAR_FORWARD_SLASH));
        // Account for the -1 case of String#slice in JS land
        if let Some(_index) = index {
            return &mut normalized_cwd[_index..len];
        }
        return &mut normalized_cwd[len - 1..len];
    }

    // We're already on POSIX, no need for any transformations
    #[cfg(not(windows))]
    cwd
}

#[cfg(windows)]
#[inline]
fn without_trailing_slash(s: &[u8]) -> &[u8] {
    bun_paths::string_paths::without_trailing_slash_windows_path(s)
}
#[cfg(not(windows))]
#[inline]
fn without_trailing_slash(s: &[u8]) -> &[u8] {
    let mut end = s.len();
    while end > 1 && s[end - 1] == CHAR_FORWARD_SLASH {
        end -= 1;
    }
    &s[..end]
}

/// What [`resolve_posix_t`] puts in front of a path that is not absolute, where the system's own paths are POSIX paths.
#[cfg(not(windows))]
#[inline]
pub fn posix_working_directory() -> &'static [u8] {
    working_directory()
}

fn working_directory() -> &'static [u8] {
    match bun_core::working_directory_in_executable() {
        Some(directory) => directory,
        None => without_trailing_slash(bun_paths::fs::FileSystem::instance().top_level_dir()),
    }
}

fn get_cwd_u8(buf: &mut [u8]) -> &mut [u8] {
    let cached_cwd = working_directory();
    buf[0..cached_cwd.len()].copy_from_slice(cached_cwd);
    &mut buf[0..cached_cwd.len()]
}

fn get_cwd_u16(buf: &mut [u16]) -> &mut [u16] {
    strings::convert_utf8_to_utf16_in_buffer(buf, working_directory())
}

#[inline]
fn get_cwd_t<T: PathCharCwd>(buf: &mut [T]) -> &mut [T] {
    T::get_cwd(buf)
}

/// Based on Node v21.6.1 path.posix.basename:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1309
#[inline(always)]
pub fn basename_posix_t<'a, T: PathCharCwd>(path: &'a [T], suffix: Option<&[T]>) -> &'a [T] {
    // validateString of `path` is performed in pub fn basename.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }
    let mut start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;

    let _suffix: &[T] = suffix.unwrap_or(&[]);
    let _suffix_len = _suffix.len();
    if suffix.is_some() && _suffix_len > 0 && _suffix_len <= len {
        if _suffix == path {
            return &[];
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut ext_idx: Option<usize> = Some(_suffix_len - 1);
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut first_non_slash_end: Option<usize> = None;
        let mut i_i64 = i64::try_from(len - 1).expect("int cast");
        while i_i64 >= i64::try_from(start).expect("int cast") {
            let i = usize::try_from(i_i64).expect("int cast");
            let byte = path[i];
            if byte == T::from_u8(CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if !matched_slash {
                    start = i + 1;
                    break;
                }
            } else {
                if first_non_slash_end.is_none() {
                    // We saw the first non-path separator, remember this index in case
                    // we need it if the extension ends up not matching
                    matched_slash = false;
                    first_non_slash_end = Some(i + 1);
                }
                if let Some(_ext_ix) = ext_idx {
                    // Try to match the explicit extension
                    if byte == _suffix[_ext_ix] {
                        if _ext_ix == 0 {
                            // We matched the extension, so mark this as the end of our path
                            // component
                            end = Some(i);
                            ext_idx = None;
                        } else {
                            ext_idx = Some(_ext_ix - 1);
                        }
                    } else {
                        // Extension does not match, so our result is the entire path
                        // component
                        ext_idx = None;
                        end = first_non_slash_end;
                    }
                }
            }
            i_i64 -= 1;
        }

        if let Some(_end) = end {
            if start == _end {
                return &path[start..first_non_slash_end.unwrap()];
            } else {
                return &path[start.._end];
            }
        }
        return &path[start..len];
    }

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 > -1 {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if byte == T::from_u8(CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start = i + 1;
                break;
            }
        } else if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // path component
            matched_slash = false;
            end = Some(i + 1);
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        &path[start.._end]
    } else {
        &[]
    }
}

/// Based on Node v21.6.1 path.win32.basename:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L753
#[inline(always)]
pub fn basename_windows_t<'a, T: PathCharCwd>(path: &'a [T], suffix: Option<&[T]>) -> &'a [T] {
    // validateString of `path` is performed in pub fn basename.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }

    let is_sep_t = is_sep_windows_t::<T>;

    let mut start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded
    if len >= 2 && is_windows_device_root_t(path[0]) && path[1] == T::from_u8(CHAR_COLON) {
        start = 2;
    }

    let _suffix: &[T] = suffix.unwrap_or(&[]);
    let _suffix_len = _suffix.len();
    if suffix.is_some() && _suffix_len > 0 && _suffix_len <= len {
        if _suffix == path {
            return &[];
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut ext_idx: Option<usize> = Some(_suffix_len - 1);
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut first_non_slash_end: Option<usize> = None;
        let mut i_i64 = i64::try_from(len - 1).expect("int cast");
        while i_i64 >= i64::try_from(start).expect("int cast") {
            let i = usize::try_from(i_i64).expect("int cast");
            let byte = path[i];
            if is_sep_t(byte) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if !matched_slash {
                    start = i + 1;
                    break;
                }
            } else {
                if first_non_slash_end.is_none() {
                    // We saw the first non-path separator, remember this index in case
                    // we need it if the extension ends up not matching
                    matched_slash = false;
                    first_non_slash_end = Some(i + 1);
                }
                if let Some(_ext_ix) = ext_idx {
                    // Try to match the explicit extension
                    if byte == _suffix[_ext_ix] {
                        if _ext_ix == 0 {
                            // We matched the extension, so mark this as the end of our path
                            // component
                            end = Some(i);
                            ext_idx = None;
                        } else {
                            ext_idx = Some(_ext_ix - 1);
                        }
                    } else {
                        // Extension does not match, so our result is the entire path
                        // component
                        ext_idx = None;
                        end = first_non_slash_end;
                    }
                }
            }
            i_i64 -= 1;
        }

        if let Some(_end) = end {
            if start == _end {
                return &path[start..first_non_slash_end.unwrap()];
            } else {
                return &path[start.._end];
            }
        }
        return &path[start..len];
    }

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 >= i64::try_from(start).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if is_sep_t(byte) {
            if !matched_slash {
                start = i + 1;
                break;
            }
        } else if end.is_none() {
            matched_slash = false;
            end = Some(i + 1);
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        &path[start.._end]
    } else {
        &[]
    }
}

/// Based on Node v21.6.1 path.posix.dirname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1278
pub fn dirname_posix_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn dirname.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    let has_root = path[0] == T::from_u8(CHAR_FORWARD_SLASH);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;
    let mut i: usize = len - 1;
    while i >= 1 {
        if path[i] == T::from_u8(CHAR_FORWARD_SLASH) {
            if !matched_slash {
                end = Some(i);
                break;
            }
        } else {
            // We saw the first non-path separator
            matched_slash = false;
        }
        i -= 1;
    }

    if let Some(_end) = end {
        return if has_root && _end == 1 {
            l::<T>(b"//")
        } else {
            &path[0.._end]
        };
    }
    if has_root {
        l::<T>(CHAR_STR_FORWARD_SLASH)
    } else {
        l::<T>(CHAR_STR_DOT)
    }
}

/// Based on Node v21.6.1 path.win32.dirname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L657
#[inline(always)]
pub fn dirname_windows_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn dirname.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    let is_sep_t = is_sep_windows_t::<T>;

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut root_end: Option<usize> = None;
    let mut offset: usize = 0;
    let byte0 = path[0];

    if len == 1 {
        // `path` contains just a path separator, exit early to avoid
        // unnecessary work or a dot.
        return if is_sep_t(byte0) {
            path
        } else {
            l::<T>(CHAR_STR_DOT)
        };
    }

    // Try to match a root
    if is_sep_t(byte0) {
        // Possible UNC root

        root_end = Some(1);
        offset = 1;

        if is_sep_t(path[1]) {
            // Matched double path separator at the beginning
            let mut j: usize = 2;
            let mut last: usize = j;

            // Match 1 or more non-path separators
            while j < len && !is_sep_t(path[j]) {
                j += 1;
            }

            if j < len && j != last {
                // Matched!
                last = j;

                // Match 1 or more path separators
                while j < len && is_sep_t(path[j]) {
                    j += 1;
                }

                if j < len && j != last {
                    // Matched!
                    last = j;

                    // Match 1 or more non-path separators
                    while j < len && !is_sep_t(path[j]) {
                        j += 1;
                    }

                    if j == len {
                        // We matched a UNC root only
                        return path;
                    }

                    if j != last {
                        // We matched a UNC root with leftovers

                        // Offset by 1 to include the separator after the UNC root to
                        // treat it as a "normal root" on top of a (UNC) root
                        offset = j + 1;
                        root_end = Some(offset);
                    }
                }
            }
        }
        // Possible device root
    } else if is_windows_device_root_t(byte0) && path[1] == T::from_u8(CHAR_COLON) {
        offset = if len > 2 && is_sep_t(path[2]) { 3 } else { 2 };
        root_end = Some(offset);
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 >= i64::try_from(offset).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        if is_sep_t(path[i]) {
            if !matched_slash {
                end = Some(i);
                break;
            }
        } else {
            // We saw the first non-path separator
            matched_slash = false;
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        return &path[0.._end];
    }

    if let Some(_root_end) = root_end {
        &path[0.._root_end]
    } else {
        l::<T>(CHAR_STR_DOT)
    }
}

/// Based on Node v21.6.1 path.posix.extname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1388
#[inline(always)]
pub fn extname_posix_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn extname.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 > -1 {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if byte == T::from_u8(CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }

        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }

        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if pre_dot_state.is_some() && pre_dot_state.unwrap() != 1 {
                pre_dot_state = Some(1);
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    let _end = end.unwrap_or(0);
    let _pre_dot_state = pre_dot_state.unwrap_or(0);
    let _start_dot = start_dot.unwrap_or(0);
    if start_dot.is_none()
        || end.is_none()
        // We saw a non-dot character immediately before the dot
        || (pre_dot_state.is_some() && _pre_dot_state == 0)
        // The (right-most) trimmed path component is exactly '..'
        || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
    {
        return &[];
    }

    &path[_start_dot.._end]
}

/// Based on Node v21.6.1 path.win32.extname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L840
#[inline(always)]
pub fn extname_windows_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn extname.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }
    let mut start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded

    if len >= 2 && path[1] == T::from_u8(CHAR_COLON) && is_windows_device_root_t(path[0]) {
        start = 2;
        start_part = start;
    }

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 >= i64::try_from(start).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if is_sep_windows_t(byte) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }
        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }
        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if let Some(_pre_dot_state) = pre_dot_state {
                if _pre_dot_state != 1 {
                    pre_dot_state = Some(1);
                }
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    let _end = end.unwrap_or(0);
    let _pre_dot_state = pre_dot_state.unwrap_or(0);
    let _start_dot = start_dot.unwrap_or(0);
    if start_dot.is_none()
        || end.is_none()
        // We saw a non-dot character immediately before the dot
        || (pre_dot_state.is_some() && _pre_dot_state == 0)
        // The (right-most) trimmed path component is exactly '..'
        || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
    {
        return &[];
    }

    &path[_start_dot.._end]
}

use bun_paths::resolve_path::is_sep_posix_t;
// Node `path.win32.isPathSeparator` accepts BOTH `/` and `\` — semantically
// `is_sep_any_t`, NOT `is_sep_win32_t` (which is `\`-only). Keep the Node name.
pub use bun_paths::is_sep_any_t as is_sep_windows_t;

/// `'A' <= byte <= 'Z' || 'a' <= byte <= 'z'`
#[inline]
fn is_windows_device_root_t<T: PathCharCwd>(byte: T) -> bool {
    let c = byte.as_u32();
    (b'A' as u32 <= c && c <= b'Z' as u32) || (b'a' as u32 <= c && c <= b'z' as u32)
}

/// Based on Node v21.6.1 path.posix.isAbsolute:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1159
#[inline]
pub fn is_absolute_posix_t<T: PathCharCwd>(path: &[T]) -> bool {
    // validateString of `path` is performed in pub fn isAbsolute.
    !path.is_empty() && path[0] == T::from_u8(CHAR_FORWARD_SLASH)
}

/// Based on Node v21.6.1 path.win32.isAbsolute:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L406
#[inline]
pub fn is_absolute_windows_t<T: PathCharCwd>(path: &[T]) -> bool {
    // validateString of `path` is performed in pub fn isAbsolute.
    let len = path.len();
    if len == 0 {
        return false;
    }
    let byte0 = path[0];
    is_sep_windows_t(byte0)
        || (len > 2
            && is_windows_device_root_t(byte0)
            && path[1] == T::from_u8(CHAR_COLON)
            && is_sep_windows_t(path[2]))
}

/// Based on Node v21.6.1 private helper _format:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L145
pub fn format_t<'a, T: PathCharCwd>(
    path_object: &PathParsed<'a, T>,
    sep: T,
    buf: &'a mut [T],
) -> &'a [T] {
    // validateObject of `pathObject` is performed in pub fn format.
    let root = path_object.root;
    let dir = path_object.dir;
    let base = path_object.base;
    let ext = path_object.ext;
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let _name = path_object.name;

    // Translated from the following JS code:
    //   const dir = pathObject.dir || pathObject.root;
    // Compare as `&[T]` so the comparison is correct for `T == u16` too.
    let dir_is_root = dir.is_empty() || dir == root;
    let dir_or_root = if dir_is_root { root } else { dir };
    let dir_len = dir_or_root.len();

    let mut buf_offset: usize;
    let mut buf_size: usize;

    // Translated from the following JS code:
    //   const base = pathObject.base ||
    //     `${pathObject.name || ''}${formatExt(pathObject.ext)}`;
    let mut base_len = base.len();
    // Borrowck: track range into buf instead of slice.

    let base_or_name_ext_range: (usize, usize) = if base_len > 0 {
        memmove(&mut buf[0..base_len], base);
        (0, base_len)
    } else {
        let formatted_ext_len = {
            // Borrowck: inline format_ext_t to avoid overlapping &mut.
            let ext_len = ext.len();
            if ext_len == 0 {
                0
            } else if ext[0] == T::from_u8(CHAR_DOT) {
                memmove(&mut buf[0..ext_len], ext);
                ext_len
            } else {
                buf[0] = T::from_u8(CHAR_DOT);
                memmove(&mut buf[1..ext_len + 1], ext);
                ext_len + 1
            }
        };
        let name_len = _name.len();
        let ext_len = formatted_ext_len;
        buf_offset = name_len;
        buf_size = buf_offset + ext_len;
        if ext_len > 0 {
            // Move all bytes to the right by _name.len.
            // Use copy_within because formattedExt and buf overlap.
            buf.copy_within(0..ext_len, buf_offset);
        }
        if name_len > 0 {
            memmove(&mut buf[0..name_len], _name);
        }
        if buf_size > 0 {
            (0, buf_size)
        } else {
            (0, base_len)
        }
    };

    // Translated from the following JS code:
    //   if (!dir) {
    //     return base;
    //   }
    if dir_len == 0 {
        return &buf[base_or_name_ext_range.0..base_or_name_ext_range.1];
    }

    // Translated from the following JS code:
    //   return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
    base_len = base_or_name_ext_range.1 - base_or_name_ext_range.0;
    if base_len > 0 {
        buf_offset = if dir_is_root { dir_len } else { dir_len + 1 };
        // Move all bytes to the right by dirLen + (maybe 1 for the separator).
        // Use copy_within because baseOrNameExt and buf overlap.
        buf.copy_within(
            base_or_name_ext_range.0..base_or_name_ext_range.1,
            buf_offset,
        );
    }
    memmove(&mut buf[0..dir_len], dir_or_root);
    buf_size = dir_len + base_len;
    if !dir_is_root {
        buf_size += 1;
        buf[dir_len] = sep;
    }
    &buf[0..buf_size]
}

/// Based on Node v21.6.1 path.posix.join:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1169
pub fn join_posix_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &'a mut [T],
) -> &'a [T] {
    if paths.is_empty() {
        return l::<T>(CHAR_STR_DOT);
    }

    let mut buf_size: usize = 0;
    let mut buf_offset: usize;

    // Back joined by expandable buf2 in case it is long.
    // Borrowck: track length instead of slice into buf2.
    let mut joined_len: usize = 0;

    for path in paths {
        // validateString of `path is performed in pub fn join.
        // Back our virtual "joined" string by expandable buf2 in
        // case it is long.
        let len = path.len();
        if len > 0 {
            // Translated from the following JS code:
            //   if (joined === undefined)
            //     joined = arg;
            //   else
            //     joined += `/${arg}`;
            if buf_size != 0 {
                buf_offset = buf_size;
                buf_size += 1;
                buf2[buf_offset] = T::from_u8(CHAR_FORWARD_SLASH);
            }
            buf_offset = buf_size;
            buf_size += len;
            memmove(&mut buf2[buf_offset..buf_size], path);

            joined_len = buf_size;
        }
    }
    if buf_size == 0 {
        return l::<T>(CHAR_STR_DOT);
    }
    normalize_posix_t(&buf2[0..joined_len], buf)
}

/// Based on Node v21.6.1 path.win32.join:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L425
pub fn join_windows_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &'a mut [T],
) -> &'a [T] {
    if paths.is_empty() {
        return l::<T>(CHAR_STR_DOT);
    }

    let is_sep_t = is_sep_windows_t::<T>;

    let mut buf_size: usize = 0;
    let mut buf_offset: usize;

    // Backed by expandable buf2 in case it is long.
    // Borrowck: track ranges instead of slices into buf2.
    let mut joined_len: usize = 0;
    let mut first_part_len: usize = 0;

    for path in paths {
        // validateString of `path` is performed in pub fn join.
        let len = path.len();
        if len > 0 {
            // Translated from the following JS code:
            //   if (joined === undefined)
            //     joined = firstPart = arg;
            //   else
            //     joined += `\\${arg}`;
            if buf_size == 0 {
                buf_size = len;
                memmove(&mut buf2[0..buf_size], path);

                joined_len = buf_size;
                first_part_len = joined_len;
            } else {
                buf_offset = buf_size;
                buf_size += 1;
                buf2[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf_offset = buf_size;
                buf_size += len;
                memmove(&mut buf2[buf_offset..buf_size], path);

                joined_len = buf_size;
            }
        }
    }
    if buf_size == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    // Make sure that the joined path doesn't start with two slashes, because
    // normalize() will mistake it for a UNC path then.
    //
    // This step is skipped when it is very clear that the user actually
    // intended to point at a UNC path. This is assumed when the first
    // non-empty string arguments starts with exactly two slashes followed by
    // at least one more non-slash character.
    //
    // Note that for normalize() to treat a path as a UNC path it needs to
    // have at least 2 components, so we don't filter for that here.
    // This means that the user can use join to construct UNC paths from
    // a server name and a share name; for example:
    //   path.join('//server', 'share') -> '\\\\server\\share\\')
    let mut needs_replace: bool = true;
    let mut slash_count: usize = 0;
    if is_sep_t(buf2[0]) {
        slash_count += 1;
        let first_len = first_part_len;
        if first_len > 1 && is_sep_t(buf2[1]) {
            slash_count += 1;
            if first_len > 2 {
                if is_sep_t(buf2[2]) {
                    slash_count += 1;
                } else {
                    // We matched a UNC path in the first part
                    needs_replace = false;
                }
            }
        }
    }
    if needs_replace {
        // Find any more consecutive slashes we need to replace
        while slash_count < buf_size && is_sep_t(buf2[slash_count]) {
            slash_count += 1;
        }
        // Replace the slashes if needed
        if slash_count >= 2 {
            // Translated from the following JS code:
            //   joined = `\\${StringPrototypeSlice(joined, slashCount)}`;
            buf_offset = 1;
            buf_size = buf_offset + (buf_size - slash_count);
            // Move all bytes to the right by slashCount - 1.
            // Use copy_within because joined and buf2 overlap.
            buf2.copy_within(slash_count..joined_len, buf_offset);
            // Prepend the separator.
            buf2[0] = T::from_u8(CHAR_BACKWARD_SLASH);

            joined_len = buf_size;
        }
    }
    normalize_windows_t(&buf2[0..joined_len], buf)
}

/// Handles a `..` segment for `normalize_string_t`: drops the last segment of
/// `res` and returns `(res.len, lastSegmentLength)`. Kept out of line so the
/// per-byte loop in the caller stays call-free.
#[inline(never)]
fn pop_last_segment_t<T: PathCharCwd>(res: &[T], separator: T) -> (usize, usize) {
    match strings::last_index_of_char_t(res, separator) {
        None => (0, 0),
        Some(idx) => {
            // Translated from the following JS code:
            //   lastSegmentLength =
            //     res.length - 1 - StringPrototypeLastIndexOf(res, separator);
            let last_segment_length = match strings::last_index_of_char_t(&res[0..idx], separator) {
                // Yes (>ლ), Node relies on the -1 result of
                // StringPrototypeLastIndexOf(res, separator).
                // A - -1 is a positive 1.
                // So the code becomes
                //   lastSegmentLength = res.length - 1 + 1;
                // or
                //   lastSegmentLength = res.length;
                None => idx,
                Some(sep) => idx - 1 - sep,
            };
            (idx, last_segment_length)
        }
    }
}

/// Based on Node v21.6.1 private helper normalizeString:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L65C1-L66C77
///
/// Resolves . and .. elements in a path with directory names
fn normalize_string_t<T: PathCharCwd, const PLATFORM: Platform>(
    path: &[T],
    allow_above_root: bool,
    separator: T,
    buf: &mut [T],
) -> usize {
    // Returns length into buf (NUL-terminated at buf[len]) instead of `[:0]T` slice,
    // so callers can re-borrow buf (borrowck).
    let len = path.len();
    let is_sep_t: fn(T) -> bool = if matches!(PLATFORM, Platform::Posix) {
        is_sep_posix_t::<T>
    } else {
        is_sep_windows_t::<T>
    };

    let mut buf_offset: usize;
    let mut buf_size: usize = 0;

    let mut last_segment_length: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut last_slash: Option<usize> = None;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut dots: Option<usize> = Some(0);
    let mut byte: T = T::default();

    for i in 0..=len {
        if i < len {
            byte = path[i];
        } else if is_sep_t(byte) {
            break;
        } else {
            byte = T::from_u8(CHAR_FORWARD_SLASH);
        }

        if is_sep_t(byte) {
            // Translated from the following JS code:
            //   if (lastSlash === i - 1 || dots === 1) {
            if last_slash == i.checked_sub(1) || dots == Some(1) {
                // NOOP
            } else if dots == Some(2) {
                if buf_size < 2
                    || last_segment_length != 2
                    || buf[buf_size - 1] != T::from_u8(CHAR_DOT)
                    || buf[buf_size - 2] != T::from_u8(CHAR_DOT)
                {
                    if buf_size > 2 {
                        (buf_size, last_segment_length) =
                            pop_last_segment_t(&buf[0..buf_size], separator);
                        last_slash = Some(i);
                        dots = Some(0);
                        continue;
                    } else if buf_size != 0 {
                        buf_size = 0;
                        last_segment_length = 0;
                        last_slash = Some(i);
                        dots = Some(0);
                        continue;
                    }
                }
                if allow_above_root {
                    // Translated from the following JS code:
                    //   res += res.length > 0 ? `${separator}..` : '..';
                    if buf_size > 0 {
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = separator;
                        buf_offset = buf_size;
                        buf_size += 2;
                        buf[buf_offset] = T::from_u8(CHAR_DOT);
                        buf[buf_offset + 1] = T::from_u8(CHAR_DOT);
                    } else {
                        buf_size = 2;
                        buf[0] = T::from_u8(CHAR_DOT);
                        buf[1] = T::from_u8(CHAR_DOT);
                    }

                    last_segment_length = 2;
                }
            } else {
                // Translated from the following JS code:
                //   if (res.length > 0)
                //     res += `${separator}${StringPrototypeSlice(path, lastSlash + 1, i)}`;
                //   else
                //     res = StringPrototypeSlice(path, lastSlash + 1, i);
                if buf_size > 0 {
                    buf_offset = buf_size;
                    buf_size += 1;
                    buf[buf_offset] = separator;
                }
                let slice_start = last_slash.map_or(0, |ls| ls + 1);
                let slice = &path[slice_start..i];

                buf_offset = buf_size;
                buf_size += slice.len();
                memmove(&mut buf[buf_offset..buf_size], slice);

                // Translated from the following JS code:
                //   lastSegmentLength = i - lastSlash - 1;
                // `lastSlash` starts at -1 in Node, so the first segment's
                // length is `i - 0`, i.e. exactly the slice just appended.
                last_segment_length = slice.len();
            }
            last_slash = Some(i);
            dots = Some(0);
        } else if byte == T::from_u8(CHAR_DOT) && dots.is_some() {
            dots = dots.map(|d| d + 1);
        } else {
            dots = None;
        }
    }

    buf[buf_size] = T::default();
    buf_size
}

/// Based on Node v21.6.1 path.posix.normalize
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1130
pub fn normalize_posix_t<'a, T: PathCharCwd>(path: &[T], buf: &'a mut [T]) -> &'a [T] {
    // validateString of `path` is performed in pub fn normalize.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let _is_absolute = path[0] == T::from_u8(CHAR_FORWARD_SLASH);
    let trailing_separator = path[len - 1] == T::from_u8(CHAR_FORWARD_SLASH);

    // Normalize the path
    let mut buf_size = normalize_string_t::<T, { Platform::Posix }>(
        path,
        !_is_absolute,
        T::from_u8(CHAR_FORWARD_SLASH),
        buf,
    );

    if buf_size == 0 {
        if _is_absolute {
            return l::<T>(CHAR_STR_FORWARD_SLASH);
        }
        return if trailing_separator {
            l::<T>(b"./")
        } else {
            l::<T>(CHAR_STR_DOT)
        };
    }

    let mut buf_offset: usize;

    // Translated from the following JS code:
    //   if (trailingSeparator)
    //     path += '/';
    if trailing_separator {
        buf_offset = buf_size;
        buf_size += 1;
        buf[buf_offset] = T::from_u8(CHAR_FORWARD_SLASH);
        buf[buf_size] = T::default();
    }

    // Translated from the following JS code:
    //   return isAbsolute ? `/${path}` : path;
    if _is_absolute {
        buf_offset = 1;
        let old_size = buf_size;
        buf_size += 1;
        // Move all bytes to the right by 1 for the separator.
        // Use copy_within because normalizedPath and buf overlap.
        buf.copy_within(0..old_size, buf_offset);
        // Prepend the separator.
        buf[0] = T::from_u8(CHAR_FORWARD_SLASH);
        buf[buf_size] = T::default();
    }
    &buf[0..buf_size]
}

/// Based on Node v21.6.1 path.win32.normalize
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L308
pub fn normalize_windows_t<'a, T: PathCharCwd>(path: &[T], buf: &'a mut [T]) -> &'a [T] {
    // validateString of `path` is performed in pub fn normalize.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    let is_sep_t = is_sep_windows_t::<T>;

    // Moved `rootEnd`, `device`, and `_isAbsolute` initialization after
    // the `if (len == 1)` check.
    let byte0: T = path[0];

    // Try to match a root
    if len == 1 {
        // `path` contains just a single char, exit early to avoid
        // unnecessary work
        return if is_sep_t(byte0) {
            l::<T>(CHAR_STR_BACKWARD_SLASH)
        } else {
            // Borrowck: copy single char into buf since path may not outlive buf.
            buf[0] = byte0;
            &buf[0..1]
        };
    }

    let mut root_end: usize = 0;
    // Backed by buf.
    // Borrowck: track device length instead of slice into buf.
    let mut device_len: Option<usize> = None;
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let mut _is_absolute: bool = false;

    let mut buf_offset: usize;
    let mut buf_size: usize;

    if is_sep_t(byte0) {
        // Possible UNC root

        // If we started with a separator, we know we at least have an absolute
        // path of some kind (UNC or otherwise)
        _is_absolute = true;

        if is_sep_t(path[1]) {
            // Matched double path separator at beginning
            let mut j: usize = 2;
            let mut last: usize = j;
            // Match 1 or more non-path separators
            while j < len && !is_sep_t(path[j]) {
                j += 1;
            }
            if j < len && j != last {
                let first_part = &path[last..j];
                // Matched!
                last = j;
                // Match 1 or more path separators
                while j < len && is_sep_t(path[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_sep_t(path[j]) {
                        j += 1;
                    }
                    if j == len {
                        // We matched a UNC root only
                        // Return the normalized version of the UNC root since there
                        // is nothing left to process

                        // Translated from the following JS code:
                        //   return `\\\\${firstPart}\\${StringPrototypeSlice(path, last)}\\`;
                        buf_size = 2;
                        buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += first_part.len();
                        memmove(&mut buf[buf_offset..buf_size], first_part);
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += len - last;
                        memmove(&mut buf[buf_offset..buf_size], &path[last..len]);
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                        return &buf[0..buf_size];
                    }
                    if j != last {
                        // We matched a UNC root with leftovers

                        // Translated from the following JS code:
                        //   device =
                        //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                        //   rootEnd = j;
                        buf_size = 2;
                        buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += first_part.len();
                        memmove(&mut buf[buf_offset..buf_size], first_part);
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += j - last;
                        memmove(&mut buf[buf_offset..buf_size], &path[last..j]);

                        device_len = Some(buf_size);
                        root_end = j;
                    }
                }
            }
        } else {
            root_end = 1;
        }
    } else if is_windows_device_root_t(byte0) && path[1] == T::from_u8(CHAR_COLON) {
        // Possible device root
        buf[0] = byte0;
        buf[1] = T::from_u8(CHAR_COLON);
        device_len = Some(2);
        root_end = 2;
        if len > 2 && is_sep_t(path[2]) {
            // Treat separator following drive name as an absolute path
            // indicator
            _is_absolute = true;
            root_end = 3;
        }
    }

    buf_offset = device_len.unwrap_or(0) + (_is_absolute as usize);
    // Backed by buf at an offset of  device.len + 1 if _isAbsolute is true.
    let mut tail_len = if root_end < len {
        normalize_string_t::<T, { Platform::Windows }>(
            &path[root_end..len],
            !_is_absolute,
            T::from_u8(CHAR_BACKWARD_SLASH),
            &mut buf[buf_offset..],
        )
    } else {
        0
    };
    if tail_len == 0 && !_is_absolute {
        buf[buf_offset] = T::from_u8(CHAR_DOT);
        tail_len = 1;
    }

    if tail_len > 0 && is_sep_t(path[len - 1]) {
        // Translated from the following JS code:
        //   tail += '\\';
        buf[buf_offset + tail_len] = T::from_u8(CHAR_BACKWARD_SLASH);
        tail_len += 1;
    }

    buf_size = buf_offset + tail_len;
    // Translated from the following JS code:
    //   if (device === undefined) {
    //     return isAbsolute ? `\\${tail}` : tail;
    //   }
    //   return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
    if _is_absolute {
        buf_offset -= 1;
        // Prepend the separator.
        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
    }
    &buf[0..buf_size]
}

// Based on Node v21.6.1 path.posix.parse
// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1452
pub fn parse_posix_t<T: PathCharCwd>(path: &[T]) -> PathParsed<'_, T> {
    // validateString of `path` is performed in pub fn parse.
    let len = path.len();
    if len == 0 {
        return PathParsed::default();
    }

    let mut root: &[T] = &[];
    let mut dir: &[T] = &[];
    let mut base: &[T] = &[];
    let mut ext: &[T] = &[];
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let mut _name: &[T] = &[];
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let _is_absolute = path[0] == T::from_u8(CHAR_FORWARD_SLASH);
    let mut start: usize = 0;
    if _is_absolute {
        root = l::<T>(CHAR_STR_FORWARD_SLASH);
        start = 1;
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash = true;
    let mut i_i64 = i64::try_from(len - 1).expect("int cast");

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    // Get non-dir info
    while i_i64 >= i64::try_from(start).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if byte == T::from_u8(CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }
        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }
        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if let Some(_pre_dot_state) = pre_dot_state {
                if _pre_dot_state != 1 {
                    pre_dot_state = Some(1);
                }
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        let _pre_dot_state = pre_dot_state.unwrap_or(0);
        let _start_dot = start_dot.unwrap_or(0);
        start = if start_part == 0 && _is_absolute {
            1
        } else {
            start_part
        };
        if start_dot.is_none()
            // We saw a non-dot character immediately before the dot
            || (pre_dot_state.is_some() && _pre_dot_state == 0)
            // The (right-most) trimmed path component is exactly '..'
            || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
        {
            _name = &path[start.._end];
            base = _name;
        } else {
            _name = &path[start.._start_dot];
            base = &path[start.._end];
            ext = &path[_start_dot.._end];
        }
    }

    if start_part > 0 {
        dir = &path[0..(start_part - 1)];
    } else if _is_absolute {
        dir = l::<T>(CHAR_STR_FORWARD_SLASH);
    }

    PathParsed {
        root,
        dir,
        base,
        ext,
        name: _name,
    }
}

// Based on Node v21.6.1 path.win32.parse
// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L916
pub fn parse_windows_t<T: PathCharCwd>(path: &[T]) -> PathParsed<'_, T> {
    // validateString of `path` is performed in pub fn parse.
    let mut root: &[T] = &[];
    let mut dir: &[T] = &[];
    let mut base: &[T] = &[];
    let mut ext: &[T] = &[];
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let mut _name: &[T] = &[];

    let len = path.len();
    if len == 0 {
        return PathParsed {
            root,
            dir,
            base,
            ext,
            name: _name,
        };
    }

    let is_sep_t = is_sep_windows_t::<T>;

    let mut root_end: usize = 0;
    let mut byte = path[0];

    if len == 1 {
        if is_sep_t(byte) {
            // `path` contains just a path separator, exit early to avoid
            // unnecessary work
            root = path;
            dir = path;
        } else {
            base = path;
            _name = path;
        }
        return PathParsed {
            root,
            dir,
            base,
            ext,
            name: _name,
        };
    }

    // Try to match a root
    if is_sep_t(byte) {
        // Possible UNC root

        root_end = 1;
        if is_sep_t(path[1]) {
            // Matched double path separator at the beginning
            let mut j: usize = 2;
            let mut last: usize = j;
            // Match 1 or more non-path separators
            while j < len && !is_sep_t(path[j]) {
                j += 1;
            }
            if j < len && j != last {
                // Matched!
                last = j;
                // Match 1 or more path separators
                while j < len && is_sep_t(path[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_sep_t(path[j]) {
                        j += 1;
                    }
                    if j == len {
                        // We matched a UNC root only
                        root_end = j;
                    } else if j != last {
                        // We matched a UNC root with leftovers
                        root_end = j + 1;
                    }
                }
            }
        }
    } else if is_windows_device_root_t(byte) && path[1] == T::from_u8(CHAR_COLON) {
        // Possible device root
        if len <= 2 {
            // `path` contains just a drive root, exit early to avoid
            // unnecessary work
            root = path;
            dir = path;
            return PathParsed {
                root,
                dir,
                base,
                ext,
                name: _name,
            };
        }
        root_end = 2;
        if is_sep_t(path[2]) {
            if len == 3 {
                // `path` contains just a drive root, exit early to avoid
                // unnecessary work
                root = path;
                dir = path;
                return PathParsed {
                    root,
                    dir,
                    base,
                    ext,
                    name: _name,
                };
            }
            root_end = 3;
        }
    }
    if root_end > 0 {
        root = &path[0..root_end];
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part = root_end;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash = true;
    let mut i_i64 = i64::try_from(len - 1).expect("int cast");

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    // Get non-dir info
    while i_i64 >= i64::try_from(root_end).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        byte = path[i];
        if is_sep_t(byte) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }
        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }
        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if let Some(_pre_dot_state) = pre_dot_state {
                if _pre_dot_state != 1 {
                    pre_dot_state = Some(1);
                }
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        let _pre_dot_state = pre_dot_state.unwrap_or(0);
        let _start_dot = start_dot.unwrap_or(0);
        if start_dot.is_none()
            // We saw a non-dot character immediately before the dot
            || (pre_dot_state.is_some() && _pre_dot_state == 0)
            // The (right-most) trimmed path component is exactly '..'
            || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
        {
            // Prefix with _ to avoid shadowing the identifier in the outer scope.
            _name = &path[start_part.._end];
            base = _name;
        } else {
            _name = &path[start_part.._start_dot];
            base = &path[start_part.._end];
            ext = &path[_start_dot.._end];
        }
    }

    // If the directory is the root, use the entire root as the `dir` including
    // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
    // trailing slash (`C:\abc\def` -> `C:\abc`).
    if start_part > 0 && start_part != root_end {
        dir = &path[0..(start_part - 1)];
    } else {
        dir = root;
    }

    PathParsed {
        root,
        dir,
        base,
        ext,
        name: _name,
    }
}

/// Based on Node v21.6.1 path.posix.relative:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1193
pub fn relative_posix_t<'a, T: PathCharCwd>(
    from: &[T],
    to: &[T],
    buf: &'a mut [T],
    from_buf: &mut [T],
    tmp_buf: &mut [T],
) -> &'a [T] {
    // validateString of `from` and `to` are performed in pub fn relative.
    if from == to {
        return &[];
    }

    // Trim leading forward slashes.
    // Backed by from_buf.
    let from_orig = resolve_posix_t(&[from], from_buf, tmp_buf);
    let from_orig_len = from_orig.len();
    // Backed by buf.
    let to_orig_len = resolve_posix_t(&[to], buf, tmp_buf).len();
    let to_orig = &buf[0..to_orig_len];

    if from_orig == to_orig {
        return &[];
    }

    let from_start = 1usize;
    let from_end = from_orig_len;
    let from_len = from_end - from_start;
    let mut to_start: usize = 1;
    let to_len = to_orig_len - to_start;

    // Compare paths to find the longest common path from root
    let smallest_length = from_len.min(to_len);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut last_common_sep: Option<usize> = None;

    let matches_all_of_smallest;
    // Add a block to isolate `i`.
    {
        let mut i: usize = 0;
        while i < smallest_length {
            let from_byte = from_orig[from_start + i];
            if from_byte != to_orig[to_start + i] {
                break;
            } else if from_byte == T::from_u8(CHAR_FORWARD_SLASH) {
                last_common_sep = Some(i);
            }
            i += 1;
        }
        matches_all_of_smallest = i == smallest_length;
    }
    if matches_all_of_smallest {
        if to_len > smallest_length {
            if to_orig[to_start + smallest_length] == T::from_u8(CHAR_FORWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='/foo/bar'; to='/foo/bar/baz'
                return &buf[to_start + smallest_length + 1..to_orig_len];
            }
            if smallest_length == 0 {
                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                return &buf[to_start + smallest_length..to_orig_len];
            }
        } else if from_len > smallest_length {
            if from_orig[from_start + smallest_length] == T::from_u8(CHAR_FORWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='/foo/bar/baz'; to='/foo/bar'
                last_common_sep = Some(smallest_length);
            } else if smallest_length == 0 {
                // We get here if `to` is the root.
                // For example: from='/foo/bar'; to='/'
                last_common_sep = Some(0);
            }
        }
    }

    let mut buf_offset: usize;
    let mut buf_size: usize = 0;

    // Backed by tmp_buf.
    let mut out_len: usize = 0;
    // Add a block to isolate `i`.
    {
        // Generate the relative path based on the path difference between `to`
        // and `from`.

        // Translated from the following JS code:
        //  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        let mut i: usize = from_start + last_common_sep.map_or(0, |v| v + 1);
        while i <= from_end {
            if i == from_end || from_orig[i] == T::from_u8(CHAR_FORWARD_SLASH) {
                // Translated from the following JS code:
                //   out += out.length === 0 ? '..' : '/..';
                if out_len > 0 {
                    buf_offset = buf_size;
                    buf_size += 3;
                    tmp_buf[buf_offset] = T::from_u8(CHAR_FORWARD_SLASH);
                    tmp_buf[buf_offset + 1] = T::from_u8(CHAR_DOT);
                    tmp_buf[buf_offset + 2] = T::from_u8(CHAR_DOT);
                } else {
                    buf_size = 2;
                    tmp_buf[0] = T::from_u8(CHAR_DOT);
                    tmp_buf[1] = T::from_u8(CHAR_DOT);
                }
                out_len = buf_size;
            }
            i += 1;
        }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts.

    // Translated from the following JS code:
    //   return `${out}${StringPrototypeSlice(to, toStart + lastCommonSep)}`;
    to_start = last_common_sep.map_or(0, |v| to_start + v);
    let slice_size = to_orig_len - to_start;
    buf_size = out_len;
    if slice_size > 0 {
        buf_offset = buf_size;
        buf_size += slice_size;
        // Use copy_within because toOrig and buf overlap.
        buf.copy_within(to_start..to_start + slice_size, buf_offset);
    }
    if out_len > 0 {
        memmove(&mut buf[0..out_len], &tmp_buf[0..out_len]);
    }
    buf[buf_size] = T::default();
    &buf[0..buf_size]
}

/// Based on Node v21.6.1 path.win32.relative:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L500
pub fn relative_windows_t<'a, T: PathCharCwd>(
    from: &[T],
    to: &[T],
    buf: &'a mut [T],
    from_buf: &mut [T],
    tmp_buf: &mut [T],
) -> &'a [T] {
    // validateString of `from` and `to` are performed in pub fn relative.
    if from == to {
        return &[];
    }

    // Backed by from_buf.
    let from_orig = resolve_windows_t(&[from], from_buf, tmp_buf);
    let from_orig_len = from_orig.len();
    // Backed by buf.
    let to_orig_len = resolve_windows_t(&[to], buf, tmp_buf).len();

    if from_orig == &buf[0..to_orig_len] || eql_ignore_case_t(from_orig, &buf[0..to_orig_len]) {
        return &[];
    }

    // Trim leading backslashes
    let mut from_start: usize = 0;
    while from_start < from_orig_len && from_orig[from_start] == T::from_u8(CHAR_BACKWARD_SLASH) {
        from_start += 1;
    }

    // Trim trailing backslashes (applicable to UNC paths only)
    let mut from_end = from_orig_len;
    while from_end - 1 > from_start && from_orig[from_end - 1] == T::from_u8(CHAR_BACKWARD_SLASH) {
        from_end -= 1;
    }

    let from_len = from_end - from_start;

    // Trim leading backslashes
    let mut to_start: usize = 0;
    while to_start < to_orig_len && buf[to_start] == T::from_u8(CHAR_BACKWARD_SLASH) {
        to_start += 1;
    }

    // Trim trailing backslashes (applicable to UNC paths only)
    let mut to_end = to_orig_len;
    while to_end - 1 > to_start && buf[to_end - 1] == T::from_u8(CHAR_BACKWARD_SLASH) {
        to_end -= 1;
    }

    let to_len = to_end - to_start;

    // Compare paths to find the longest common path from root
    let smallest_length = from_len.min(to_len);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut last_common_sep: Option<usize> = None;

    let matches_all_of_smallest;
    // Add a block to isolate `i`.
    {
        let mut i: usize = 0;
        while i < smallest_length {
            let from_byte = from_orig[from_start + i];
            if to_lower_t(from_byte) != to_lower_t(buf[to_start + i]) {
                break;
            } else if from_byte == T::from_u8(CHAR_BACKWARD_SLASH) {
                last_common_sep = Some(i);
            }
            i += 1;
        }
        matches_all_of_smallest = i == smallest_length;
    }

    // We found a mismatch before the first common path separator was seen, so
    // return the original `to`.
    if !matches_all_of_smallest {
        if last_common_sep.is_none() {
            return &buf[0..to_orig_len];
        }
    } else {
        if to_len > smallest_length {
            if buf[to_start + smallest_length] == T::from_u8(CHAR_BACKWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='C:\foo\bar'; to='C:\foo\bar\baz'
                return &buf[to_start + smallest_length + 1..to_orig_len];
            }
            if smallest_length == 2 {
                // We get here if `from` is the device root.
                // For example: from='C:\'; to='C:\foo'
                return &buf[to_start + smallest_length..to_orig_len];
            }
        }
        if from_len > smallest_length {
            if from_orig[from_start + smallest_length] == T::from_u8(CHAR_BACKWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='C:\foo\bar'; to='C:\foo'
                last_common_sep = Some(smallest_length);
            } else if smallest_length == 2 {
                // We get here if `to` is the device root.
                // For example: from='C:\foo\bar'; to='C:\'
                last_common_sep = Some(3);
            }
        }
        if last_common_sep.is_none() {
            last_common_sep = Some(0);
        }
    }

    let mut buf_offset: usize;
    let mut buf_size: usize = 0;

    // Backed by tmp_buf.
    let mut out_len: usize = 0;
    // Add a block to isolate `i`.
    {
        // Generate the relative path based on the path difference between `to`
        // and `from`.
        let mut i: usize = from_start + last_common_sep.map_or(0, |v| v + 1);
        while i <= from_end {
            if i == from_end || from_orig[i] == T::from_u8(CHAR_BACKWARD_SLASH) {
                // Translated from the following JS code:
                //   out += out.length === 0 ? '..' : '\\..';
                if out_len > 0 {
                    buf_offset = buf_size;
                    buf_size += 3;
                    tmp_buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                    tmp_buf[buf_offset + 1] = T::from_u8(CHAR_DOT);
                    tmp_buf[buf_offset + 2] = T::from_u8(CHAR_DOT);
                } else {
                    buf_size = 2;
                    tmp_buf[0] = T::from_u8(CHAR_DOT);
                    tmp_buf[1] = T::from_u8(CHAR_DOT);
                }
                out_len = buf_size;
            }
            i += 1;
        }
    }

    // Translated from the following JS code:
    //   toStart += lastCommonSep;
    if let Some(sep) = last_common_sep {
        to_start += sep;
    } else {
        // If toStart would go negative make it toOrigLen - 1 to
        // mimic String#slice with a negative start.
        to_start = if to_start > 0 {
            to_start - 1
        } else {
            to_orig_len - 1
        };
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    if out_len > 0 {
        // JS `String.prototype.slice(toStart, toEnd)` yields "" when toStart > toEnd.
        let slice_size = to_end.saturating_sub(to_start);
        buf_size = out_len;
        if slice_size > 0 {
            buf_offset = buf_size;
            buf_size += slice_size;
            // Use copy_within because toOrig and buf overlap.
            buf.copy_within(to_start..to_start + slice_size, buf_offset);
        }
        memmove(&mut buf[0..out_len], &tmp_buf[0..out_len]);
        buf[buf_size] = T::default();
        return &buf[0..buf_size];
    }

    // JS `charCodeAt` returns NaN past the end, which never equals '\'.
    if to_start < to_orig_len && buf[to_start] == T::from_u8(CHAR_BACKWARD_SLASH) {
        to_start += 1;
    }
    &buf[to_start.min(to_end)..to_end]
}

/// Based on Node v21.6.1 path.posix.resolve:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1095
pub fn resolve_posix_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &mut [T],
) -> &'a [T] {
    // Backed by expandable buf2 because resolvedPath may be long.
    // We use buf2 here because resolvePosixT is called by other methods and using
    // buf2 here avoids stepping on others' toes.
    let mut resolved_path_len: usize = 0;
    let mut resolved_absolute: bool = false;

    let mut buf_size: usize;

    let mut i_i64: i64 = if paths.is_empty() {
        -1
    } else {
        i64::try_from(paths.len() - 1).expect("int cast")
    };
    while i_i64 > -2 && !resolved_absolute {
        // Borrowck: `path` may borrow from tmp_buf which lives
        // in this scope; copy into buf2 before reusing.
        // Sized to the larger of the two T variants.
        let mut tmp_buf: [T; MAX_PATH_SIZE_UPPER];
        let path: &[T] = if i_i64 >= 0 {
            paths[usize::try_from(i_i64).expect("int cast")]
        } else {
            // cwd is limited to MAX_PATH_BYTES.
            tmp_buf = [T::default(); MAX_PATH_SIZE_UPPER];
            &*posix_cwd_t(&mut tmp_buf)
        };
        // validateString of `path` is performed in pub fn resolve.
        let len = path.len();

        // Skip empty paths.
        if len == 0 {
            i_i64 -= 1;
            continue;
        }

        // Translated from the following JS code:
        //   resolvedPath = `${path}/${resolvedPath}`;
        if resolved_path_len > 0 {
            let buf_offset = len + 1;
            // Move all bytes to the right by path.len + 1 for the separator.
            // Use copy_within because resolvedPath and buf2 overlap.
            buf2.copy_within(0..resolved_path_len, buf_offset);
        }
        buf_size = len;
        memmove(&mut buf2[0..buf_size], path);
        buf_size += 1;
        buf2[len] = T::from_u8(CHAR_FORWARD_SLASH);
        buf_size += resolved_path_len;

        buf2[buf_size] = T::default();
        resolved_path_len = buf_size;
        resolved_absolute = path[0] == T::from_u8(CHAR_FORWARD_SLASH);

        i_i64 -= 1;
    }

    // Exit early for empty path.
    if resolved_path_len == 0 {
        return dot(buf);
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    let normalized_len = normalize_string_t::<T, { Platform::Posix }>(
        &buf2[0..resolved_path_len],
        !resolved_absolute,
        T::from_u8(CHAR_FORWARD_SLASH),
        buf,
    );
    // resolvedPath is now backed by buf.
    resolved_path_len = normalized_len;

    // Translated from the following JS code:
    //   if (resolvedAbsolute) {
    //     return `/${resolvedPath}`;
    //   }
    if resolved_absolute {
        buf_size = resolved_path_len + 1;
        // Use copy_within because resolvedPath and buf overlap.
        buf.copy_within(0..resolved_path_len, 1);
        buf[0] = T::from_u8(CHAR_FORWARD_SLASH);
        buf[buf_size] = T::default();
        return &buf[0..buf_size];
    }
    // Translated from the following JS code:
    //   return resolvedPath.length > 0 ? resolvedPath : '.';
    if resolved_path_len > 0 {
        &buf[0..resolved_path_len]
    } else {
        dot(buf)
    }
}

#[derive(Clone, Copy)]
enum Device<'a, T> {
    /// `C:`
    Drive(T),
    /// `\\server\share`
    Unc(&'a [T], &'a [T]),
}

/// Based on Node v21.6.1 path.win32.resolve:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L162
pub fn resolve_windows_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &mut [T],
) -> &'a [T] {
    let is_sep_t = is_sep_windows_t::<T>;
    // Sized to the larger of the two T variants.
    let mut tmp_buf = [T::default(); MAX_PATH_SIZE_UPPER + 1];
    // Taken by the last iteration.
    let mut cwd_buf = &mut tmp_buf[..];

    let mut resolved_device: Option<Device<'_, T>> = None;
    // Backed by expandable buf2 because resolvedTail may be long.
    // We use buf2 here because resolvePosixT is called by other methods and using
    // buf2 here avoids stepping on others' toes.
    let mut resolved_tail_len: usize = 0;
    let mut resolved_absolute: bool = false;

    let mut i_i64: i64 = if paths.is_empty() {
        -1
    } else {
        i64::try_from(paths.len() - 1).expect("int cast")
    };
    while i_i64 > -2 {
        let path: &[T] = if i_i64 >= 0 {
            let p = paths[usize::try_from(i_i64).expect("int cast")];
            // validateString of `path` is performed in pub fn resolve.

            // Skip empty paths.
            if p.is_empty() {
                i_i64 -= 1;
                continue;
            }
            p
        } else if let Some(Device::Drive(drive)) = resolved_device {
            let cwd_buf = core::mem::take(&mut cwd_buf);
            // Translated from the following JS code:
            //   path = process.env[`=${resolvedDevice}`] || process.cwd();
            #[cfg(not(windows))]
            let env_path_len: Option<usize> = None;
            #[cfg(windows)]
            let env_path_len = {
                // Windows has the concept of drive-specific current working
                // directories. If we've resolved a drive letter but not yet an
                // absolute path, get cwd for that drive, or the process cwd if
                // the drive cwd is not available. We're sure the device is not
                // a UNC path at this points, because UNC paths are always absolute.

                // Translated from the following JS code:
                //   process.env[`=${resolvedDevice}`]
                let key_w = [
                    b'=' as u16,
                    u16::try_from(drive.as_u32()).expect("int cast"),
                    CHAR_COLON as u16,
                    // `getenv_w` hands the pointer to `GetEnvironmentVariableW`.
                    0,
                ];
                // TODO: Enable test once spawnResult.stdout works on Windows.
                // test/js/node/path/resolve.test.js
                bun_sys::windows::getenv_w(&key_w).map(|r| match T::units_mut(cwd_buf) {
                    CodeUnitsMut::U16(dst) => {
                        let n = r.len().min(dst.len());
                        memmove(&mut dst[..n], &r[..n]);
                        n
                    }
                    CodeUnitsMut::U8(dst) => {
                        strings::convert_utf16_to_utf8_in_buffer(dst, &r).len()
                    }
                })
            };
            let len = match env_path_len {
                Some(len) => len,
                // cwd is limited to MAX_PATH_BYTES.
                None => get_cwd_t(cwd_buf).len(),
            };

            // Verify that a cwd was found and that it actually points
            // to our drive. If not, default to the drive's root.

            // Translated from the following JS code:
            //   if (path === undefined ||
            //     (StringPrototypeToLowerCase(StringPrototypeSlice(path, 0, 2)) !==
            //     StringPrototypeToLowerCase(resolvedDevice) &&
            //     StringPrototypeCharCodeAt(path, 2) === CHAR_BACKWARD_SLASH)) {
            if len > 2
                && cwd_buf[2] == T::from_u8(CHAR_BACKWARD_SLASH)
                && !eql_ignore_case_t(&cwd_buf[0..2], &[drive, T::from_u8(CHAR_COLON)])
            {
                // Translated from the following JS code:
                //   path = `${resolvedDevice}\\`;
                cwd_buf[0] = drive;
                cwd_buf[1] = T::from_u8(CHAR_COLON);
                &cwd_buf[0..3]
            } else {
                &cwd_buf[0..len]
            }
        } else {
            // cwd is limited to MAX_PATH_BYTES.
            get_cwd_t(core::mem::take(&mut cwd_buf))
        };

        let len = path.len();
        let mut root_end: usize = 0;
        let mut device: Option<Device<'_, T>> = None;
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        let mut _is_absolute: bool = false;
        let byte0 = if len > 0 { path[0] } else { T::default() };

        // Try to match a root
        if len == 1 {
            if is_sep_t(byte0) {
                // `path` contains just a path separator
                root_end = 1;
                _is_absolute = true;
            }
        } else if is_sep_t(byte0) {
            // Possible UNC root

            // If we started with a separator, we know we at least have an
            // absolute path of some kind (UNC or otherwise)
            _is_absolute = true;

            if is_sep_t(path[1]) {
                // Matched double path separator at the beginning
                let mut j: usize = 2;
                let mut last: usize = j;
                // Match 1 or more non-path separators
                while j < len && !is_sep_t(path[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    let first_part = &path[last..j];
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while j < len && is_sep_t(path[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while j < len && !is_sep_t(path[j]) {
                            j += 1;
                        }
                        if j == len || j != last {
                            // We matched a UNC root

                            // Translated from the following JS code:
                            //   device =
                            //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                            //   rootEnd = j;
                            device = Some(Device::Unc(first_part, &path[last..j]));
                            root_end = j;
                        }
                    }
                }
            } else {
                root_end = 1;
            }
        } else if is_windows_device_root_t(byte0) && path[1] == T::from_u8(CHAR_COLON) {
            // Possible device root
            device = Some(Device::Drive(byte0));
            root_end = 2;
            if len > 2 && is_sep_t(path[2]) {
                // Treat separator following the drive name as an absolute path
                // indicator
                _is_absolute = true;
                root_end = 3;
            }
        }

        match (device, resolved_device) {
            (None, _) => {}
            (Some(_), None) => resolved_device = device,
            (Some(Device::Drive(a)), Some(Device::Drive(b))) if to_lower_t(a) == to_lower_t(b) => {}
            // A UNC root ends the loop, so it is never compared with another one.
            (Some(_), Some(_)) => {
                // This path points to another device, so it is not applicable
                i_i64 -= 1;
                continue;
            }
        }

        if resolved_absolute {
            if resolved_device.is_some() {
                break;
            }
        } else {
            // Translated from the following JS code:
            //   resolvedTail = `${StringPrototypeSlice(path, rootEnd)}\\${resolvedTail}`;
            let slice_len = len - root_end;
            if resolved_tail_len > 0 {
                let buf_offset = slice_len + 1;
                // Move all bytes to the right by path slice.len + 1 for the separator
                // Use copy_within because resolvedTail and buf2 overlap.
                buf2.copy_within(0..resolved_tail_len, buf_offset);
            }
            buf2[slice_len] = T::from_u8(CHAR_BACKWARD_SLASH);
            memmove(&mut buf2[0..slice_len], &path[root_end..]);

            resolved_tail_len += slice_len + 1;
            resolved_absolute = _is_absolute;

            if _is_absolute && resolved_device.is_some() {
                break;
            }
        }
        i_i64 -= 1;
    }

    // Exit early for empty path.
    if resolved_tail_len == 0 {
        return dot(buf);
    }

    // At this point, the path should be resolved to a full absolute path,
    // but handle relative paths to be safe (can happen if reading the cwd fails).

    // Normalize the tail path
    let normalized_len = normalize_string_t::<T, { Platform::Windows }>(
        &buf2[0..resolved_tail_len],
        !resolved_absolute,
        T::from_u8(CHAR_BACKWARD_SLASH),
        buf,
    );
    // resolvedTail is now backed by buf.
    resolved_tail_len = normalized_len;

    let resolved_device_len = match resolved_device {
        None => 0,
        Some(Device::Drive(_)) => 2,
        Some(Device::Unc(server, share)) => 2 + server.len() + 1 + share.len(),
    };

    // Translated from the following JS code:
    //   resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}`
    //   : `${resolvedDevice}${resolvedTail}` || '.'
    let buf_offset = resolved_device_len + usize::from(resolved_absolute);
    let buf_size = buf_offset + resolved_tail_len;
    if buf_size == 0 {
        return dot(buf);
    }
    buf[buf_size] = T::default();
    // Use copy_within because resolvedTail and buf overlap.
    buf.copy_within(0..resolved_tail_len, buf_offset);
    if resolved_absolute {
        buf[resolved_device_len] = T::from_u8(CHAR_BACKWARD_SLASH);
    }
    match resolved_device {
        None => {}
        Some(Device::Drive(drive)) => {
            buf[0] = drive;
            buf[1] = T::from_u8(CHAR_COLON);
        }
        Some(Device::Unc(server, share)) => {
            let server_end = 2 + server.len();
            buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
            buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
            memmove(&mut buf[2..server_end], server);
            buf[server_end] = T::from_u8(CHAR_BACKWARD_SLASH);
            memmove(&mut buf[server_end + 1..resolved_device_len], share);
        }
    }
    &buf[0..buf_size]
}

/// Based on Node v21.6.1 path.win32.toNamespacedPath:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L622
pub fn to_namespaced_path_windows_t<'a, T: PathCharCwd>(
    path: &[T],
    buf: &'a mut [T],
    buf2: &mut [T],
) -> &'a [T] {
    // validateString of `path` is performed in pub fn toNamespacedPath.
    // Backed by buf.
    // Borrowck: capture length, then re-borrow buf.
    let resolved_len = resolve_windows_t(&[path], buf, buf2).len();

    let len = resolved_len;
    if len <= 2 {
        buf[0..path.len()].copy_from_slice(path);
        buf[path.len()] = T::default();
        return &buf[0..path.len()];
    }

    let buf_offset: usize;
    let buf_size: usize;

    let byte0 = buf[0];
    if byte0 == T::from_u8(CHAR_BACKWARD_SLASH) {
        // Possible UNC root
        if buf[1] == T::from_u8(CHAR_BACKWARD_SLASH) {
            let byte2 = buf[2];
            if byte2 != T::from_u8(CHAR_QUESTION_MARK) && byte2 != T::from_u8(CHAR_DOT) {
                // Matched non-long UNC root, convert the path to a long UNC path

                // Translated from the following JS code:
                //   return `\\\\?\\UNC\\${StringPrototypeSlice(resolvedPath, 2)}`;
                buf_offset = 6;
                buf_size = len + 6;
                // Move all bytes to the right by 6 so that the first two bytes are
                // overwritten by "\\\\?\\UNC\\" which is 8 bytes long.
                // Use copy_within because resolvedPath and buf overlap.
                buf.copy_within(0..len, buf_offset);
                buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[2] = T::from_u8(CHAR_QUESTION_MARK);
                buf[3] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[4] = T::from_u8(b'U');
                buf[5] = T::from_u8(b'N');
                buf[6] = T::from_u8(b'C');
                buf[7] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[buf_size] = T::default();
                return &buf[0..buf_size];
            }
        }
    } else if is_windows_device_root_t(byte0)
        && buf[1] == T::from_u8(CHAR_COLON)
        && buf[2] == T::from_u8(CHAR_BACKWARD_SLASH)
    {
        // Matched device root, convert the path to a long UNC path

        // Translated from the following JS code:
        //   return `\\\\?\\${resolvedPath}`
        buf_offset = 4;
        buf_size = len + 4;
        // Move all bytes to the right by 4
        // Use copy_within because resolvedPath and buf overlap.
        buf.copy_within(0..len, buf_offset);
        buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
        buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
        buf[2] = T::from_u8(CHAR_QUESTION_MARK);
        buf[3] = T::from_u8(CHAR_BACKWARD_SLASH);
        buf[buf_size] = T::default();
        return &buf[0..buf_size];
    }
    &buf[0..resolved_len]
}

/// How long each of the two buffers of [`resolve_posix_t`] and [`resolve_windows_t`] has to be.
pub fn resolve_buf_len<T: PathCharCwd>(is_windows: bool, paths: &[&[T]]) -> usize {
    // Adding 8 bytes when Windows for the possible UNC root.
    let mut buf_len: usize = if is_windows { 8 } else { 0 };
    for path in paths {
        buf_len += if buf_len > 0 && !path.is_empty() {
            path.len() + 1
        } else {
            path.len()
        };
    }
    // When no path is absolute, the CWD (up to MAX_PATH_SIZE bytes) is prepended
    // with a separator. Account for this to prevent buffer overflow.
    buf_len += max_path_size::<T>() + 1;
    buf_len = buf_len.max(path_size::<T>());
    // +2 to account for separator and null terminator during path resolution.
    buf_len + 2
}

/// How long each of the three buffers of [`relative_posix_t`] and [`relative_windows_t`] has to be.
pub fn relative_buf_len<T: PathCharCwd>(from: &[T], to: &[T]) -> usize {
    // Account for CWD (up to MAX_PATH_SIZE) that resolve may prepend, and for
    // worst-case ".." expansion: each 2-byte path component (e.g. "a/") generates
    // 3 bytes of output ("/..", ~1.5x). Use 2x as a safe upper bound.
    let buf_len =
        ((from.len() + max_path_size::<T>() + 1) * 2 + to.len() + max_path_size::<T>() + 1)
            .max(path_size::<T>());
    // +1 for null terminator.
    buf_len + 1
}

/// How long each of the two buffers of [`to_namespaced_path_windows_t`] has to be.
pub fn to_namespaced_path_buf_len<T: PathCharCwd>(path: &[T]) -> usize {
    // Account for CWD (up to MAX_PATH_SIZE) that resolve may prepend to relative paths.
    let buf_len = (path.len() + max_path_size::<T>() + 1).max(path_size::<T>());
    // +8 for possible UNC prefix, +1 for null terminator.
    buf_len + 8 + 1
}

/// How long each of the two buffers of [`join_posix_t`] and [`join_windows_t`] has to be.
pub fn join_buf_len<T: PathCharCwd>(is_windows: bool, paths: &[&[T]]) -> usize {
    // Adding 8 bytes when Windows for the possible UNC root.
    let mut buf_len: usize = if is_windows { 8 } else { 0 };
    for path in paths {
        buf_len += if !path.is_empty() {
            path.len() + 1
        } else {
            path.len()
        };
    }
    buf_len.max(path_size::<T>())
}

/// How long the buffer of [`normalize_posix_t`] and [`normalize_windows_t`] has to be.
pub fn normalize_buf_len<T: PathCharCwd>(path: &[T]) -> usize {
    // +1 for null terminator
    path.len().max(path_size::<T>()) + 1
}
