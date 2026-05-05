use core::cell::RefCell;

use crate::{PathBuffer, MAX_PATH_BYTES, SEP, SEP_POSIX, SEP_WINDOWS};
// MOVE_DOWN(CYCLEBREAK): ZStr/WStr live in bun_core; `strings` stays in bun_str (T1).
use bun_core::{ZStr, WStr};
use bun_str::strings;
// MOVE_DOWN(CYCLEBREAK): bun_resolver::fs → crate::fs (move-in pass adds the module).
use crate::fs as Fs;

thread_local! {
    static PARSER_JOIN_INPUT_BUFFER: RefCell<[u8; 4096]> = const { RefCell::new([0u8; 4096]) };
    static PARSER_BUFFER: RefCell<[u8; 1024]> = const { RefCell::new([0u8; 1024]) };
}

pub fn z<'a>(input: &[u8], output: &'a mut PathBuffer) -> &'a ZStr {
    if input.len() > MAX_PATH_BYTES {
        if cfg!(debug_assertions) {
            panic!("path too long");
        }
        // SAFETY: empty static string with NUL at [0]
        return ZStr::EMPTY;
    }

    output[..input.len()].copy_from_slice(input);
    output[input.len()] = 0;

    // SAFETY: output[input.len()] == 0 written above
    unsafe { ZStr::from_raw(output.as_ptr(), input.len()) }
}

#[inline]
fn nql_at_index<const STRING_COUNT: usize>(index: usize, input: &[&[u8]]) -> bool {
    // PERF(port): was comptime-unrolled `inline while` — profile in Phase B
    let mut string_index = 1;
    while string_index < STRING_COUNT {
        if input[0][index] != input[string_index][index] {
            return true;
        }
        string_index += 1;
    }
    false
}

#[inline]
fn nql_at_index_case_insensitive<const STRING_COUNT: usize>(index: usize, input: &[&[u8]]) -> bool {
    // PERF(port): was comptime-unrolled `inline while` — profile in Phase B
    let mut string_index = 1;
    while string_index < STRING_COUNT {
        if input[0][index].to_ascii_lowercase() != input[string_index][index].to_ascii_lowercase() {
            return true;
        }
        string_index += 1;
    }
    false
}

/// The given string contains separators that match the platform's path separator style.
pub fn has_platform_path_separators(input_path: &[u8]) -> bool {
    #[cfg(windows)]
    {
        // Windows accepts both forward and backward slashes as path separators
        strings::index_of_any(input_path, b"\\/").is_some()
    }
    #[cfg(not(windows))]
    {
        strings::index_of_char(input_path, b'/').is_some()
    }
}

type IsSeparatorFunc = fn(char: u8) -> bool;
// TODO(port): IsSeparatorFuncT/LastSeparatorFunctionT take `comptime T: type` —
// represented here as generic-over-PathChar fn pointers; Rust cannot express
// "fn<T>(T) -> bool" as a value, so callers dispatch via Platform methods.
type LastSeparatorFunction = fn(slice: &[u8]) -> Option<usize>;

#[inline]
fn is_dotdot(slice: &[u8]) -> bool {
    slice.len() >= 2 && u16::from_le_bytes([slice[0], slice[1]]) == u16::from_le_bytes(*b"..")
}

#[inline]
fn is_dotdot_with_type<T: PathChar>(slice: &[T]) -> bool {
    // TODO(port): specialization for T==u8 used @bitCast; generic path checks bytewise
    slice.len() >= 2 && slice[0] == T::from_u8(b'.') && slice[1] == T::from_u8(b'.')
}

#[inline]
fn is_dotdot_slash(slice: &[u8]) -> bool {
    slice.starts_with(b"../")
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ParentEqual {
    Parent,
    Equal,
    Unrelated,
}

pub fn is_parent_or_equal(parent_: &[u8], child: &[u8]) -> ParentEqual {
    let mut parent = parent_;
    while !parent.is_empty() && is_sep_any(parent[parent.len() - 1]) {
        parent = &parent[..parent.len() - 1];
    }

    #[cfg(not(target_os = "linux"))]
    let contains = strings::contains_case_insensitive_ascii;
    #[cfg(target_os = "linux")]
    let contains = strings::contains;
    if !contains(child, parent) {
        return ParentEqual::Unrelated;
    }

    if child.len() == parent.len() {
        return ParentEqual::Equal;
    }
    if child.len() > parent.len() && is_sep_any(child[parent.len()]) {
        return ParentEqual::Parent;
    }
    ParentEqual::Unrelated
}

pub fn get_if_exists_longest_common_path_generic<const PLATFORM: Platform>(
    input: &[&[u8]],
) -> Option<&[u8]> {
    // TODO(port): return lifetime — borrows from `input` strings; caller must ensure outlives
    let separator = PLATFORM.separator();
    let is_path_separator = PLATFORM.get_separator_func();

    let nql_at_index_fn: fn(usize, usize, &[&[u8]]) -> bool = match PLATFORM {
        Platform::Windows => |n, i, inp| nql_at_index_case_insensitive_dyn(n, i, inp),
        _ => |n, i, inp| nql_at_index_dyn(n, i, inp),
    };
    // PERF(port): Zig used `inline 2..8 => |N|` to unroll per-count; Rust uses
    // a runtime `n` here. Profile in Phase B.

    let mut min_length: usize = usize::MAX;
    for str in input {
        min_length = str.len().min(min_length);
    }

    let mut index: usize = 0;
    let mut last_common_separator: Option<usize> = None;

    match input.len() {
        0 => return Some(b""),
        1 => return Some(input[0]),
        n @ 2..=8 => {
            while index < min_length {
                if nql_at_index_fn(n, index, input) {
                    if last_common_separator.is_none() {
                        return None;
                    }
                    break;
                }
                if is_path_separator(input[0][index]) {
                    last_common_separator = Some(index);
                }
                index += 1;
            }
        }
        _ => {
            let mut string_index: usize = 1;
            while string_index < input.len() {
                while index < min_length {
                    if PLATFORM == Platform::Windows {
                        if input[0][index].to_ascii_lowercase()
                            != input[string_index][index].to_ascii_lowercase()
                        {
                            if last_common_separator.is_none() {
                                return None;
                            }
                            break;
                        }
                    } else {
                        if input[0][index] != input[string_index][index] {
                            if last_common_separator.is_none() {
                                return None;
                            }
                            break;
                        }
                    }
                    index += 1;
                }
                if index == min_length {
                    index -= 1;
                }
                if is_path_separator(input[0][index]) {
                    last_common_separator = Some(index);
                }
                string_index += 1;
            }
        }
    }

    if index == 0 {
        // TODO(port): Zig returned &[_]u8{separator} (static); needs per-platform &'static [u8; 1]
        return Some(PLATFORM.separator_string().as_bytes());
    }

    if last_common_separator.is_none() {
        return Some(b".");
    }

    // The above won't work for a case like this:
    // /app/public/index.js
    // /app/public
    // It will return:
    // /app/
    // It should return:
    // /app/public/
    // To detect /app/public is actually a folder, we do one more loop through the strings
    // and say, "do one of you have a path separator after what we thought was the end?"
    for str in input {
        if str.len() > index {
            if is_path_separator(str[index]) {
                return Some(&str[0..index + 1]);
            }
        }
    }

    Some(&input[0][0..last_common_separator.unwrap() + 1])
}

// Runtime helpers for the demoted comptime-count nql checks above.
#[inline]
fn nql_at_index_dyn(string_count: usize, index: usize, input: &[&[u8]]) -> bool {
    for s in 1..string_count {
        if input[0][index] != input[s][index] {
            return true;
        }
    }
    false
}
#[inline]
fn nql_at_index_case_insensitive_dyn(string_count: usize, index: usize, input: &[&[u8]]) -> bool {
    for s in 1..string_count {
        if input[0][index].to_ascii_lowercase() != input[s][index].to_ascii_lowercase() {
            return true;
        }
    }
    false
}

// TODO: is it faster to determine longest_common_separator in the while loop
// or as an extra step at the end?
// only boether to check if this function appears in benchmarking
pub fn longest_common_path_generic<const PLATFORM: Platform>(input: &[&[u8]]) -> &[u8] {
    let separator = PLATFORM.separator();
    let is_path_separator = PLATFORM.get_separator_func();

    let nql_at_index_fn: fn(usize, usize, &[&[u8]]) -> bool = match PLATFORM {
        Platform::Windows => nql_at_index_case_insensitive_dyn,
        _ => nql_at_index_dyn,
    };
    // PERF(port): Zig used `inline 2..8 => |N|` to unroll per-count — profile in Phase B

    let mut min_length: usize = usize::MAX;
    for str in input {
        min_length = str.len().min(min_length);
    }

    let mut index: usize = 0;
    let mut last_common_separator: usize = 0;

    match input.len() {
        0 => return b"",
        1 => return input[0],
        n @ 2..=8 => {
            // If volume IDs do not match on windows, we can't have a common path
            if PLATFORM == Platform::Windows {
                let first_root = windows_filesystem_root(input[0]);
                let mut i = 1;
                while i < n {
                    let root = windows_filesystem_root(input[i]);
                    if !strings::eql_case_insensitive_ascii_check_length(first_root, root) {
                        return b"";
                    }
                    i += 1;
                }
            }

            while index < min_length {
                if nql_at_index_fn(n, index, input) {
                    break;
                }
                if is_path_separator(input[0][index]) {
                    last_common_separator = index;
                }
                index += 1;
            }
        }
        _ => {
            // If volume IDs do not match on windows, we can't have a common path
            if PLATFORM == Platform::Windows {
                let first_root = windows_filesystem_root(input[0]);
                let mut i: usize = 1;
                while i < input.len() {
                    let root = windows_filesystem_root(input[i]);
                    if !strings::eql_case_insensitive_ascii_check_length(first_root, root) {
                        return b"";
                    }
                    i += 1;
                }
            }

            let mut string_index: usize = 1;
            while string_index < input.len() {
                while index < min_length {
                    if PLATFORM == Platform::Windows {
                        if input[0][index].to_ascii_lowercase()
                            != input[string_index][index].to_ascii_lowercase()
                        {
                            break;
                        }
                    } else {
                        if input[0][index] != input[string_index][index] {
                            break;
                        }
                    }
                    index += 1;
                }
                if index == min_length {
                    index -= 1;
                }
                if is_path_separator(input[0][index]) {
                    last_common_separator = index;
                }
                string_index += 1;
            }
        }
    }

    if index == 0 {
        // TODO(port): Zig returned &[_]u8{separator} (static one-byte slice)
        return PLATFORM.separator_string().as_bytes();
    }

    // The above won't work for a case like this:
    // /app/public/index.js
    // /app/public
    // It will return:
    // /app/
    // It should return:
    // /app/public/
    // To detect /app/public is actually a folder, we do one more loop through the strings
    // and say, "do one of you have a path separator after what we thought was the end?"
    let mut idx = input.len(); // Use this value as an invalid value.
    for (i, str) in input.iter().enumerate() {
        if str.len() > index {
            if is_path_separator(str[index]) {
                idx = i;
            } else {
                idx = input.len();
                break;
            }
        }
    }
    if idx != input.len() {
        return &input[idx][0..index + 1];
    }

    &input[0][0..last_common_separator + 1]
}

pub fn longest_common_path(input: &[&[u8]]) -> &[u8] {
    longest_common_path_generic::<{ Platform::Loose }>(input)
}

pub fn get_if_exists_longest_common_path(input: &[&[u8]]) -> Option<&[u8]> {
    get_if_exists_longest_common_path_generic::<{ Platform::Loose }>(input)
}

pub fn longest_common_path_windows(input: &[&[u8]]) -> &[u8] {
    longest_common_path_generic::<{ Platform::Windows }>(input)
}

pub fn longest_common_path_posix(input: &[&[u8]]) -> &[u8] {
    longest_common_path_generic::<{ Platform::Posix }>(input)
}

// TODO(port): bun.ThreadlocalBuffers(struct {...}) is a typed thread-local pool.
// Represent as plain thread_local! RefCells of PathBuffer.
struct RelativeBufs {
    relative_to_common_path_buf: PathBuffer,
    relative_from_buf: PathBuffer,
    relative_to_buf: PathBuffer,
}
thread_local! {
    static RELATIVE_BUFS: RefCell<RelativeBufs> = const {
        RefCell::new(RelativeBufs {
            relative_to_common_path_buf: PathBuffer::ZEROED,
            relative_from_buf: PathBuffer::ZEROED,
            relative_to_buf: PathBuffer::ZEROED,
        })
    };
}

#[inline]
pub fn relative_to_common_path_buf() -> &'static mut PathBuffer {
    // TODO(port): Zig returned a raw pointer into the thread-local; Rust cannot
    // safely hand out &'static mut from thread_local!. Phase B: change callers
    // to use `.with_borrow_mut(|b| ...)` or expose a guard type.
    RELATIVE_BUFS.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig pointer semantics
        unsafe { &mut (*b.as_ptr()).relative_to_common_path_buf }
    })
}

/// Find a relative path from a common path
// Loosely based on Node.js' implementation of path.relative
// https://github.com/nodejs/node/blob/9a7cbe25de88d87429a69050a1a1971234558d97/lib/path.js#L1250-L1259
pub fn relative_to_common_path<const ALWAYS_COPY: bool, const PLATFORM: Platform>(
    common_path_: &[u8],
    normalized_from_: &[u8],
    normalized_to_: &[u8],
    buf: &mut [u8],
) -> &[u8] {
    // TODO(port): return borrows either `buf` or `normalized_to_`; lifetime needs unification in Phase B
    let mut normalized_from = normalized_from_;
    let mut normalized_to = normalized_to_;
    let win_root_len: Option<usize> = if PLATFORM == Platform::Windows {
        'k: {
            let from_root = windows_filesystem_root(normalized_from_);
            let to_root = windows_filesystem_root(normalized_to_);

            if common_path_.is_empty() {
                // the only case path.relative can return not a relative string
                if !strings::eql_case_insensitive_ascii_check_length(from_root, to_root) {
                    if normalized_to_.len() > to_root.len()
                        && normalized_to_[normalized_to_.len() - 1] == b'\\'
                    {
                        if ALWAYS_COPY {
                            let n = normalized_to_.len() - 1;
                            buf[..n].copy_from_slice(&normalized_to_[..n]);
                            return &buf[..n];
                        } else {
                            return &normalized_to_[..normalized_to_.len() - 1];
                        }
                    } else {
                        if ALWAYS_COPY {
                            buf[..normalized_to_.len()].copy_from_slice(normalized_to_);
                            return &buf[..normalized_to_.len()];
                        } else {
                            return normalized_to_;
                        }
                    }
                }
            }

            normalized_from = &normalized_from_[from_root.len()..];
            normalized_to = &normalized_to_[to_root.len()..];

            break 'k Some(from_root.len());
        }
    } else {
        None
    };

    let separator = PLATFORM.separator();

    let common_path = if PLATFORM == Platform::Windows {
        &common_path_[win_root_len.unwrap()..]
    } else if crate::is_absolute_posix(common_path_) {
        &common_path_[1..]
    } else {
        common_path_
    };

    let shortest = normalized_from.len().min(normalized_to.len());

    if shortest == common_path.len() {
        if normalized_to.len() >= normalized_from.len() {
            if common_path.is_empty() {
                if PLATFORM == Platform::Windows
                    && normalized_to.len() > 3
                    && normalized_to[normalized_to.len() - 1] == separator
                {
                    normalized_to = &normalized_to[..normalized_to.len() - 1];
                }

                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                if ALWAYS_COPY {
                    buf[..normalized_to.len()].copy_from_slice(normalized_to);
                    return &buf[..normalized_to.len()];
                } else {
                    return normalized_to;
                }
            }

            if normalized_to[common_path.len() - 1] == separator {
                let slice = &normalized_to[common_path.len()..];

                let without_trailing_slash = if PLATFORM == Platform::Windows
                    && slice.len() > 3
                    && slice[slice.len() - 1] == separator
                {
                    &slice[..slice.len() - 1]
                } else {
                    slice
                };

                if ALWAYS_COPY {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='/foo/bar'; to='/foo/bar/baz'
                    buf[..without_trailing_slash.len()].copy_from_slice(without_trailing_slash);
                    return &buf[..without_trailing_slash.len()];
                } else {
                    return without_trailing_slash;
                }
            }
        }
    }

    let last_common_separator = strings::last_index_of_char(
        if PLATFORM == Platform::Windows {
            common_path
        } else {
            common_path_
        },
        separator,
    )
    .unwrap_or(0);

    // Generate the relative path based on the path difference between `to`
    // and `from`.

    // PORT NOTE: reshaped for borrowck — Zig used a growing slice `out_slice`
    // pointing into `buf`; we track length and re-slice at end.
    let mut out_len: usize = 0;

    if !normalized_from.is_empty() {
        let mut i: usize = (PLATFORM.is_separator(normalized_from[0]) as usize)
            + 1
            + last_common_separator;

        while i <= normalized_from.len() {
            if i == normalized_from.len()
                || (normalized_from[i] == separator && i + 1 < normalized_from.len())
            {
                if out_len == 0 {
                    buf[0..2].copy_from_slice(b"..");
                    out_len = 2;
                } else {
                    buf[out_len] = separator;
                    buf[out_len + 1..out_len + 3].copy_from_slice(b"..");
                    out_len += 3;
                }
            }
            i += 1;
        }
    }

    if normalized_to.len() > last_common_separator + 1 {
        let mut tail = &normalized_to[last_common_separator..];
        if !normalized_from.is_empty()
            && (last_common_separator == normalized_from.len()
                || last_common_separator == normalized_from.len() - 1)
        {
            if PLATFORM.is_separator(tail[0]) {
                tail = &tail[1..];
            }
        }

        // avoid making non-absolute paths absolute
        let insert_leading_slash = !PLATFORM.is_separator(tail[0])
            && out_len > 0
            && !PLATFORM.is_separator(buf[out_len - 1]);

        if insert_leading_slash {
            buf[out_len] = separator;
            out_len += 1;
        }

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts.
        buf[out_len..out_len + tail.len()].copy_from_slice(tail);
        out_len += tail.len();
    }

    if out_len > 3 && buf[out_len - 1] == separator {
        out_len -= 1;
    }

    &buf[..out_len]
}

pub fn relative_normalized_buf<const PLATFORM: Platform, const ALWAYS_COPY: bool>(
    buf: &mut [u8],
    from: &[u8],
    to: &[u8],
) -> &[u8] {
    let equal = if PLATFORM == Platform::Windows {
        strings::eql_case_insensitive_ascii(from, to, true)
    } else {
        from.len() == to.len() && strings::eql_long(from, to, true)
    };
    if equal {
        return b"";
    }

    let two: [&[u8]; 2] = [from, to];
    let common_path = longest_common_path_generic::<PLATFORM>(&two);

    relative_to_common_path::<ALWAYS_COPY, PLATFORM>(common_path, from, to, buf)
}

pub fn relative_normalized<const PLATFORM: Platform, const ALWAYS_COPY: bool>(
    from: &[u8],
    to: &[u8],
) -> &[u8] {
    relative_normalized_buf::<PLATFORM, ALWAYS_COPY>(relative_to_common_path_buf(), from, to)
}

pub fn dirname<const PLATFORM: Platform>(str: &[u8]) -> &[u8] {
    match PLATFORM {
        Platform::Loose => {
            let Some(separator) = last_index_of_separator_loose(str) else {
                return b"";
            };
            &str[..separator]
        }
        Platform::Posix => {
            let Some(separator) = last_index_of_separator_posix(str) else {
                return b"";
            };
            if separator == 0 {
                return b"/";
            }
            if separator == str.len() - 1 {
                return dirname::<PLATFORM>(&str[..str.len() - 1]);
            }
            &str[..separator]
        }
        Platform::Windows => {
            let Some(separator) = last_index_of_separator_windows(str) else {
                // TODO(port): std.fs.path.diskDesignatorWindows
                return crate::disk_designator_windows(str);
            };
            &str[..separator]
        }
        Platform::Nt => unreachable!("not implemented"),
    }
}

pub fn dirname_w(str: &[u16]) -> &[u16] {
    let Some(separator) = last_index_of_separator_windows_t::<u16>(str) else {
        // return disk designator instead
        if str.len() < 2 {
            return &[];
        }
        if str[1] != b':' as u16 {
            return &[];
        }
        if !is_drive_letter_t::<u16>(str[0]) {
            return &[];
        }
        return &str[0..2];
    };
    &str[..separator]
}

pub fn relative(from: &[u8], to: &[u8]) -> &[u8] {
    relative_platform::<{ Platform::AUTO }, false>(from, to)
}

pub fn relative_z(from: &[u8], to: &[u8]) -> &ZStr {
    relative_buf_z(relative_to_common_path_buf(), from, to)
}

pub fn relative_buf_z<'a>(buf: &'a mut [u8], from: &[u8], to: &[u8]) -> &'a ZStr {
    let rel = relative_platform_buf::<{ Platform::AUTO }, true>(buf, from, to);
    let len = rel.len();
    // PORT NOTE: reshaped for borrowck — drop `rel` borrow before mutating buf
    buf[len] = 0;
    // SAFETY: buf[len] == 0 written above
    unsafe { ZStr::from_raw(buf.as_ptr(), len) }
}

pub fn relative_platform_buf<const PLATFORM: Platform, const ALWAYS_COPY: bool>(
    buf: &mut [u8],
    from: &[u8],
    to: &[u8],
) -> &[u8] {
    // TODO(port): thread-local buffer access via raw pointers; see relative_to_common_path_buf note
    // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
    let relative_from_buf = RELATIVE_BUFS.with(|b| unsafe { &mut (*b.as_ptr()).relative_from_buf });
    // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
    let relative_to_buf = RELATIVE_BUFS.with(|b| unsafe { &mut (*b.as_ptr()).relative_to_buf });

    let normalized_from: &[u8] = if PLATFORM.is_absolute(from) {
        'brk: {
            if PLATFORM == Platform::Loose && cfg!(windows) {
                // we want to invoke the windows resolution behavior but end up with a
                // string with forward slashes.
                let normalized = normalize_string_buf::<true, { Platform::Windows }, true>(
                    from,
                    &mut relative_from_buf[1..],
                );
                platform_to_posix_in_place::<u8>(normalized);
                break 'brk &*normalized;
            }
            let path = normalize_string_buf::<true, PLATFORM, true>(from, &mut relative_from_buf[1..]);
            if PLATFORM == Platform::Windows {
                break 'brk &*path;
            }
            let path_len = path.len();
            relative_from_buf[0] = PLATFORM.separator();
            break 'brk &relative_from_buf[0..path_len + 1];
        }
    } else {
        join_abs_string_buf::<PLATFORM>(
            Fs::FileSystem::instance().top_level_dir(),
            relative_from_buf,
            &[normalize_string_buf::<true, PLATFORM, true>(
                from,
                &mut relative_from_buf[1..],
            )],
        )
        // TODO(port): aliasing — Zig passes a slice of relative_from_buf as both
        // input and output; reshape in Phase B if borrowck rejects.
    };

    let normalized_to: &[u8] = if PLATFORM.is_absolute(to) {
        'brk: {
            if PLATFORM == Platform::Loose && cfg!(windows) {
                let normalized = normalize_string_buf::<true, { Platform::Windows }, true>(
                    to,
                    &mut relative_to_buf[1..],
                );
                platform_to_posix_in_place::<u8>(normalized);
                break 'brk &*normalized;
            }
            let path = normalize_string_buf::<true, PLATFORM, true>(to, &mut relative_to_buf[1..]);
            if PLATFORM == Platform::Windows {
                break 'brk &*path;
            }
            let path_len = path.len();
            relative_to_buf[0] = PLATFORM.separator();
            break 'brk &relative_to_buf[0..path_len + 1];
        }
    } else {
        join_abs_string_buf::<PLATFORM>(
            Fs::FileSystem::instance().top_level_dir(),
            relative_to_buf,
            &[normalize_string_buf::<true, PLATFORM, true>(
                to,
                &mut relative_to_buf[1..],
            )],
        )
    };

    relative_normalized_buf::<PLATFORM, ALWAYS_COPY>(buf, normalized_from, normalized_to)
}

pub fn relative_platform<const PLATFORM: Platform, const ALWAYS_COPY: bool>(
    from: &[u8],
    to: &[u8],
) -> &[u8] {
    relative_platform_buf::<PLATFORM, ALWAYS_COPY>(relative_to_common_path_buf(), from, to)
}

pub fn relative_alloc(from: &[u8], to: &[u8]) -> Result<Box<[u8]>, bun_alloc::AllocError> {
    let result = relative_platform::<{ Platform::AUTO }, false>(from, to);
    Ok(Box::<[u8]>::from(result))
}

// This function is based on Go's volumeNameLen function
// https://cs.opensource.google/go/go/+/refs/tags/go1.17.6:src/path/filepath/path_windows.go;l=57
// volumeNameLen returns length of the leading volume name on Windows.
pub fn windows_volume_name_len(path: &[u8]) -> (usize, usize) {
    windows_volume_name_len_t::<u8>(path)
}

pub fn windows_volume_name_len_t<T: PathChar>(path: &[T]) -> (usize, usize) {
    if path.len() < 2 {
        return (0, 0);
    }
    // with drive letter
    let c = path[0];
    if path[1] == T::from_u8(b':') {
        if is_drive_letter_t::<T>(c) {
            return (2, 0);
        }
    }
    // UNC
    if path.len() >= 5
        && Platform::Windows.is_separator_t::<T>(path[0])
        && Platform::Windows.is_separator_t::<T>(path[1])
        && !Platform::Windows.is_separator_t::<T>(path[2])
        && path[2] != T::from_u8(b'.')
    {
        // TODO(port): Zig branched on T==u8 to use SIMD index_of_any vs generic;
        // collapse to a single generic helper here. PERF(port): profile in Phase B.
        if let Some(idx) = strings::index_of_any_t::<T>(&path[3..], T::lit("/\\")) {
            // TODO: handle input "//abc//def" should be picked up as a unc path
            if path.len() > idx + 4 && !Platform::Windows.is_separator_t::<T>(path[idx + 4]) {
                if let Some(idx2) = strings::index_of_any_t::<T>(&path[idx + 4..], T::lit("/\\")) {
                    return (idx + idx2 + 4, idx + 3);
                } else {
                    return (path.len(), idx + 3);
                }
            }
        }
        return (path.len(), 0);
    }
    (0, 0)
}

pub fn windows_volume_name(path: &[u8]) -> &[u8] {
    &path[0..windows_volume_name_len(path).0]
}

pub fn windows_filesystem_root(path: &[u8]) -> &[u8] {
    windows_filesystem_root_t::<u8>(path)
}

pub fn is_drive_letter(c: u8) -> bool {
    is_drive_letter_t::<u8>(c)
}

pub fn is_drive_letter_t<T: PathChar>(c: T) -> bool {
    (T::from_u8(b'a') <= c && c <= T::from_u8(b'z'))
        || (T::from_u8(b'A') <= c && c <= T::from_u8(b'Z'))
}

pub fn has_any_illegal_chars(maybe_path: &[u8]) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let mut maybe_path_ = maybe_path;
    // check for disk discrimnator; remove it since it has a ':'
    if starts_with_disk_discriminator(maybe_path_) {
        maybe_path_ = &maybe_path_[2..];
    }
    // guard against OBJECT_NAME_INVALID => unreachable
    strings::index_of_any(maybe_path_, b"<>:\"|?*").is_some()
}

pub fn starts_with_disk_discriminator(maybe_path: &[u8]) -> bool {
    if !cfg!(windows) {
        return false;
    }
    if maybe_path.len() < 3 {
        return false;
    }
    if !is_drive_letter(maybe_path[0]) {
        return false;
    }
    if maybe_path[1] != b':' {
        return false;
    }
    if maybe_path[2] != b'\\' {
        return false;
    }
    true
}

// path.relative lets you do relative across different share drives
pub fn windows_filesystem_root_t<T: PathChar>(path: &[T]) -> &[T] {
    // minimum: `C:`
    if path.len() < 2 {
        return if is_sep_any_t::<T>(path[0]) {
            &path[0..1]
        } else {
            &path[0..0]
        };
    }
    // with drive letter
    let c = path[0];
    if path[1] == T::from_u8(b':') {
        if is_drive_letter_t::<T>(c) {
            if path.len() > 2 && is_sep_any_t::<T>(path[2]) {
                return &path[0..3];
            } else {
                return &path[0..2];
            }
        }
    }

    // UNC and device paths
    if path.len() >= 5
        && Platform::Windows.is_separator_t::<T>(path[0])
        && Platform::Windows.is_separator_t::<T>(path[1])
        && !Platform::Windows.is_separator_t::<T>(path[2])
    {
        // device path
        if path[2] == T::from_u8(b'.') && Platform::Windows.is_separator_t::<T>(path[3]) {
            return &path[0..4];
        }

        // UNC
        if let Some(idx) = strings::index_of_any_t::<T>(&path[3..], T::lit("/\\")) {
            if let Some(idx_second) = strings::index_of_any_t::<T>(&path[4 + idx..], T::lit("/\\"))
            {
                return &path[0..idx + idx_second + 4 + 1]; // +1 to skip second separator
            }
        }
        return &path[0..];
    }

    if is_sep_any_t::<T>(path[0]) {
        return &path[0..1];
    }
    &path[0..0]
}

// This function is based on Go's filepath.Clean function
// https://cs.opensource.google/go/go/+/refs/tags/go1.17.6:src/path/filepath/path.go;l=89
pub fn normalize_string_generic<
    const ALLOW_ABOVE_ROOT: bool,
    const SEPARATOR: u8,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    path_: &[u8],
    buf: &mut [u8],
    is_separator: impl Fn(u8) -> bool + Copy,
) -> &mut [u8] {
    normalize_string_generic_t::<u8, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(
        path_,
        buf,
        SEPARATOR,
        |c| is_separator(c),
    )
}

// TODO(port): `separatorAdapter(T, func)` wrapped a `fn(comptime T, char) bool`
// into `fn(T) bool`. In Rust we pass closures directly; no adapter needed.

pub fn normalize_string_generic_t<
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    path_: &[T],
    buf: &mut [T],
    separator: T,
    is_separator_t: impl Fn(T) -> bool + Copy,
) -> &mut [T] {
    normalize_string_generic_tz::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH, false, false>(
        path_,
        buf,
        separator,
        is_separator_t,
    )
}

/// Zig: `pub fn NormalizeOptions(comptime T: type) type { return struct { ... } }`
/// Ported as a plain options struct; the `comptime options:` callsite becomes
/// individual const-generic bools below (separator and is_separator stay
/// runtime since Rust const generics cannot carry fn pointers / non-integral T).
pub struct NormalizeOptions<T: PathChar> {
    pub allow_above_root: bool,
    pub separator: T,
    pub is_separator: fn(T) -> bool,
    pub preserve_trailing_slash: bool,
    pub zero_terminate: bool,
    pub add_nt_prefix: bool,
}

impl<T: PathChar> Default for NormalizeOptions<T> {
    fn default() -> Self {
        Self {
            allow_above_root: false,
            separator: T::from_u8(SEP),
            is_separator: |c| {
                if SEP == SEP_WINDOWS {
                    c == T::from_u8(b'\\') || c == T::from_u8(b'/')
                } else {
                    c == T::from_u8(b'/')
                }
            },
            preserve_trailing_slash: false,
            zero_terminate: false,
            add_nt_prefix: false,
        }
    }
}

// TODO(port): return type was `if (options.zero_terminate) [:0]T else []T`.
// Rust cannot vary the return type on a const-generic bool without specialization;
// we always return `&mut [T]` and write the NUL when `ZERO_TERMINATE`. Callers
// that need `&ZStr`/`&WStr` re-wrap with `from_raw`.
pub fn normalize_string_generic_tz<
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
    const ZERO_TERMINATE: bool,
    const ADD_NT_PREFIX: bool,
>(
    path_: &[T],
    buf: &mut [T],
    separator: T,
    is_separator: impl Fn(T) -> bool + Copy,
) -> &mut [T] {
    let is_windows = separator == T::from_u8(SEP_WINDOWS);
    // sep_str: single-char slice [separator]
    // PERF(port): Zig built `sep_str` at comptime; we build per-call.

    if is_windows && cfg!(debug_assertions) {
        // this is here to catch a potential mistake by the caller
        //
        // since it is theoretically possible to get here in release
        // we will not do this check in release.
        debug_assert!(!strings::has_prefix_t::<T>(path_, T::lit(":\\")));
    }

    let mut buf_i: usize = 0;
    let mut dotdot: usize = 0;
    let mut path_begin: usize = 0;

    let (vol_len, index_of_third_unc_slash) = if is_windows {
        windows_volume_name_len_t::<T>(path_)
    } else {
        (0, 0)
    };

    if is_windows {
        if vol_len > 0 {
            if ADD_NT_PREFIX {
                buf[buf_i..buf_i + 4].copy_from_slice(T::lit("\\??\\"));
                buf_i += 4;
            }
            if path_[1] != T::from_u8(b':') {
                // UNC paths
                if ADD_NT_PREFIX {
                    // "UNC" ++ sep_str
                    buf[buf_i..buf_i + 3].copy_from_slice(T::lit("UNC"));
                    buf[buf_i + 3] = separator;
                    buf_i += 2;
                } else {
                    buf[buf_i] = separator;
                    buf[buf_i + 1] = separator;
                }
                if index_of_third_unc_slash > 0 {
                    // we have the ending slash
                    buf[buf_i + 2..buf_i + index_of_third_unc_slash + 1]
                        .copy_from_slice(&path_[2..index_of_third_unc_slash + 1]);
                    buf[buf_i + index_of_third_unc_slash] = separator;
                    buf[buf_i + index_of_third_unc_slash + 1..buf_i + vol_len]
                        .copy_from_slice(&path_[index_of_third_unc_slash + 1..vol_len]);
                } else {
                    // we dont have the ending slash
                    buf[buf_i + 2..buf_i + vol_len].copy_from_slice(&path_[2..vol_len]);
                }
                buf[buf_i + vol_len] = separator;
                buf_i += vol_len + 1;
                path_begin = vol_len + 1;

                // it is just a volume name
                if path_begin >= path_.len() {
                    if ZERO_TERMINATE {
                        buf[buf_i] = T::from_u8(0);
                    }
                    return &mut buf[0..buf_i];
                }
            } else {
                // drive letter
                buf[buf_i] = T::to_ascii_upper(path_[0]);
                buf[buf_i + 1] = T::from_u8(b':');
                buf_i += 2;
                dotdot = buf_i;
                path_begin = 2;
            }
        } else if !path_.is_empty() && is_separator(path_[0]) {
            buf[buf_i] = separator;
            buf_i += 1;
            dotdot = buf_i;
            path_begin = 1;
        }
    }

    let mut r: usize = 0;
    let (path, buf_start) = if is_windows {
        (&path_[path_begin..], buf_i)
    } else {
        (&path_[..], 0usize)
    };

    let n = path.len();

    if is_windows && (ALLOW_ABOVE_ROOT || vol_len > 0) {
        // consume leading slashes on windows
        if r < n && is_separator(path[r]) {
            r += 1;
            buf[buf_i] = separator;
            buf_i += 1;

            // win32.resolve("C:\\Users\\bun", "C:\\Users\\bun", "/..\\bar")
            // should be "C:\\bar" not "C:bar"
            dotdot = buf_i;
        }
    }

    while r < n {
        // empty path element
        // or
        // . element
        if is_separator(path[r]) {
            r += 1;
            continue;
        }

        if path[r] == T::from_u8(b'.') && (r + 1 == n || is_separator(path[r + 1])) {
            // skipping two is a windows-specific bugfix
            r += 1;
            continue;
        }

        if is_dotdot_with_type::<T>(&path[r..]) && (r + 2 == n || is_separator(path[r + 2])) {
            r += 2;
            // .. element: remove to last separator
            if buf_i > dotdot {
                buf_i -= 1;
                while buf_i > dotdot && !is_separator(buf[buf_i]) {
                    buf_i -= 1;
                }
            } else if ALLOW_ABOVE_ROOT {
                if buf_i > buf_start {
                    // sep_str ++ ".."
                    buf[buf_i] = separator;
                    buf[buf_i + 1] = T::from_u8(b'.');
                    buf[buf_i + 2] = T::from_u8(b'.');
                    buf_i += 3;
                } else {
                    buf[buf_i] = T::from_u8(b'.');
                    buf[buf_i + 1] = T::from_u8(b'.');
                    buf_i += 2;
                }
                dotdot = buf_i;
            }

            continue;
        }

        // real path element.
        // add slash if needed
        if buf_i != buf_start && buf_i > 0 && !is_separator(buf[buf_i - 1]) {
            buf[buf_i] = separator;
            buf_i += 1;
        }

        let from = r;
        while r < n && !is_separator(path[r]) {
            r += 1;
        }
        let count = r - from;
        buf[buf_i..buf_i + count].copy_from_slice(&path[from..from + count]);
        buf_i += count;
    }

    if PRESERVE_TRAILING_SLASH {
        // Was there a trailing slash? Let's keep it.
        if buf_i > 0 && path_[path_.len() - 1] == separator && buf[buf_i - 1] != separator {
            buf[buf_i] = separator;
            buf_i += 1;
        }
    }

    if is_windows && buf_i == 2 && buf[1] == T::from_u8(b':') {
        // If the original path is just a relative path with a drive letter,
        // add .
        buf[buf_i] = if !path.is_empty() && path[0] == T::from_u8(b'\\') {
            T::from_u8(b'\\')
        } else {
            T::from_u8(b'.')
        };
        buf_i += 1;
    }

    if ZERO_TERMINATE {
        buf[buf_i] = T::from_u8(0);
    }

    let result = &mut buf[0..buf_i];

    if cfg!(debug_assertions) && is_windows {
        debug_assert!(!strings::has_prefix_t::<T>(result, T::lit("\\:\\")));
    }

    result
}

#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Platform {
    Loose,
    Windows,
    Posix,
    Nt,
}

impl Platform {
    #[cfg(windows)]
    pub const AUTO: Platform = Platform::Windows;
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "freebsd"))]
    pub const AUTO: Platform = Platform::Posix;
    #[cfg(target_arch = "wasm32")]
    pub const AUTO: Platform = Platform::Loose;

    pub const fn is_absolute(self, path: &[u8]) -> bool {
        self.is_absolute_t::<u8>(path)
    }

    pub const fn is_absolute_t<T: PathChar>(self, path: &[T]) -> bool {
        // TODO(port): T must be u8 or u16 (Zig @compileError otherwise)
        match self {
            Platform::Posix => !path.is_empty() && path[0] == T::from_u8(b'/'),
            Platform::Nt | Platform::Windows | Platform::Loose => {
                // TODO(port): std.fs.path.isAbsoluteWindows / isAbsoluteWindowsWTF16
                crate::is_absolute_windows_t::<T>(path)
            }
        }
    }

    #[inline]
    pub const fn separator(self) -> u8 {
        match self {
            Platform::Loose | Platform::Posix => SEP_POSIX,
            Platform::Nt | Platform::Windows => SEP_WINDOWS,
        }
    }

    #[inline]
    pub const fn separator_string(self) -> &'static str {
        match self {
            Platform::Loose | Platform::Posix => "/",
            Platform::Nt | Platform::Windows => "\\",
        }
    }

    pub const fn get_separator_func(self) -> IsSeparatorFunc {
        match self {
            Platform::Loose => is_sep_any,
            Platform::Nt | Platform::Windows => is_sep_any,
            Platform::Posix => is_sep_posix,
        }
    }

    // TODO(port): get_separator_func_t returned a generic fn-over-T; Rust cannot
    // express that as a value. Callers use `is_separator_t::<T>` directly instead.

    pub const fn get_last_separator_func(self) -> LastSeparatorFunction {
        match self {
            Platform::Loose => last_index_of_separator_loose,
            Platform::Nt | Platform::Windows => last_index_of_separator_windows,
            Platform::Posix => last_index_of_separator_posix,
        }
    }

    // TODO(port): get_last_separator_func_t — same as above; callers dispatch
    // via `last_index_of_separator_*_t::<T>` directly.

    #[inline]
    pub const fn is_separator(self, char: u8) -> bool {
        self.is_separator_t::<u8>(char)
    }

    #[inline]
    pub const fn is_separator_t<T: PathChar>(self, char: T) -> bool {
        match self {
            Platform::Loose => is_sep_any_t::<T>(char),
            Platform::Nt | Platform::Windows => is_sep_any_t::<T>(char),
            Platform::Posix => is_sep_posix_t::<T>(char),
        }
    }

    pub const fn trailing_separator(self) -> [u8; 2] {
        match self {
            Platform::Nt | Platform::Windows => *b".\\",
            Platform::Posix | Platform::Loose => *b"./",
        }
    }

    pub fn leading_separator_index<T: PathChar>(self, path: &[T]) -> Option<usize> {
        match self {
            Platform::Nt | Platform::Windows => {
                if path.len() < 1 {
                    return None;
                }

                if path[0] == T::from_u8(b'/') {
                    return Some(0);
                }

                if path[0] == T::from_u8(b'\\') {
                    return Some(0);
                }

                if path.len() < 3 {
                    return None;
                }

                // C:\
                // C:/
                if path[0] >= T::from_u8(b'A')
                    && path[0] <= T::from_u8(b'Z')
                    && path[1] == T::from_u8(b':')
                {
                    if path[2] == T::from_u8(b'/') {
                        return Some(2);
                    }
                    if path[2] == T::from_u8(b'\\') {
                        return Some(2);
                    }

                    return Some(1);
                }

                None
            }
            Platform::Posix => {
                if !path.is_empty() && path[0] == T::from_u8(b'/') {
                    Some(0)
                } else {
                    None
                }
            }
            Platform::Loose => Platform::Windows
                .leading_separator_index(path)
                .or_else(|| Platform::Posix.leading_separator_index(path)),
        }
    }
}

pub fn normalize_string<const ALLOW_ABOVE_ROOT: bool, const PLATFORM: Platform>(
    str: &[u8],
) -> &mut [u8] {
    // TODO(port): returns slice into thread-local PARSER_BUFFER; lifetime hazard
    PARSER_BUFFER.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
        let buf = unsafe { &mut *b.as_ptr() };
        normalize_string_buf::<ALLOW_ABOVE_ROOT, PLATFORM, false>(str, buf)
    })
}

pub fn normalize_string_z<const ALLOW_ABOVE_ROOT: bool, const PLATFORM: Platform>(
    str: &[u8],
) -> &mut ZStr {
    PARSER_BUFFER.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
        let buf = unsafe { &mut *b.as_ptr() };
        let normalized = normalize_string_buf::<ALLOW_ABOVE_ROOT, PLATFORM, false>(str, buf);
        let len = normalized.len();
        buf[len] = 0;
        // SAFETY: buf[len] == 0 written above
        unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) }
    })
}

pub fn normalize_buf<const PLATFORM: Platform>(str: &[u8], buf: &mut [u8]) -> &mut [u8] {
    normalize_buf_t::<u8, PLATFORM>(str, buf)
}

pub fn normalize_buf_z<const PLATFORM: Platform>(str: &[u8], buf: &mut [u8]) -> &mut ZStr {
    let norm = normalize_buf_t::<u8, PLATFORM>(str, buf);
    let len = norm.len();
    buf[len] = 0;
    // SAFETY: buf[len] == 0 written above
    unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) }
}

pub fn normalize_buf_t<T: PathChar, const PLATFORM: Platform>(
    str: &[T],
    buf: &mut [T],
) -> &mut [T] {
    if str.is_empty() {
        buf[0] = T::from_u8(b'.');
        return &mut buf[0..1];
    }

    let is_absolute = PLATFORM.is_absolute_t::<T>(str);

    // TODO(port): platform.getLastSeparatorFuncT()(T, str) — dispatched manually
    let trailing_separator = match PLATFORM {
        Platform::Loose => last_index_of_separator_loose_t::<T>(str),
        Platform::Nt | Platform::Windows => last_index_of_separator_windows_t::<T>(str),
        Platform::Posix => last_index_of_separator_posix_t::<T>(str),
    } == Some(str.len() - 1);

    if is_absolute && trailing_separator {
        return normalize_string_buf_t::<T, true, PLATFORM, true>(str, buf);
    }
    if is_absolute && !trailing_separator {
        return normalize_string_buf_t::<T, true, PLATFORM, false>(str, buf);
    }
    if !is_absolute && !trailing_separator {
        return normalize_string_buf_t::<T, false, PLATFORM, false>(str, buf);
    }
    normalize_string_buf_t::<T, false, PLATFORM, true>(str, buf)
}

pub fn normalize_string_buf<
    const ALLOW_ABOVE_ROOT: bool,
    const PLATFORM: Platform,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[u8],
    buf: &mut [u8],
) -> &mut [u8] {
    normalize_string_buf_t::<u8, ALLOW_ABOVE_ROOT, PLATFORM, PRESERVE_TRAILING_SLASH>(str, buf)
}

pub fn normalize_string_buf_t<
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PLATFORM: Platform,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[T],
    buf: &mut [T],
) -> &mut [T] {
    match PLATFORM {
        Platform::Nt => unreachable!("not implemented"),
        Platform::Windows => normalize_string_windows_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf),
        Platform::Posix => normalize_string_loose_buf_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf),
        Platform::Loose => normalize_string_loose_buf_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf),
    }
}

pub fn normalize_string_alloc<const ALLOW_ABOVE_ROOT: bool, const PLATFORM: Platform>(
    str: &[u8],
) -> Result<Box<[u8]>, bun_alloc::AllocError> {
    Ok(Box::<[u8]>::from(
        &*normalize_string::<ALLOW_ABOVE_ROOT, PLATFORM>(str),
    ))
}

pub fn join_abs2<const PLATFORM: Platform>(
    cwd: &[u8],
    part: impl AsRef<[u8]>,
    part2: impl AsRef<[u8]>,
) -> &[u8] {
    let parts: [&[u8]; 2] = [part.as_ref(), part2.as_ref()];
    join_abs_string::<PLATFORM>(cwd, &parts)
}

pub fn join_abs<const PLATFORM: Platform>(cwd: &[u8], part: &[u8]) -> &[u8] {
    join_abs_string::<PLATFORM>(cwd, &[part])
}

/// Convert parts of potentially invalid file paths into a single valid filpeath
/// without querying the filesystem
/// This is the equivalent of path.resolve
///
/// Returned path is stored in a temporary buffer. It must be copied if it needs to be stored.
pub fn join_abs_string<const PLATFORM: Platform>(cwd: &[u8], parts: &[&[u8]]) -> &[u8] {
    PARSER_JOIN_INPUT_BUFFER.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
        let buf = unsafe { &mut *b.as_ptr() };
        join_abs_string_buf::<PLATFORM>(cwd, buf, parts)
    })
}

/// Convert parts of potentially invalid file paths into a single valid filpeath
/// without querying the filesystem
/// This is the equivalent of path.resolve
///
/// Returned path is stored in a temporary buffer. It must be copied if it needs to be stored.
pub fn join_abs_string_z<const PLATFORM: Platform>(cwd: &[u8], parts: &[&[u8]]) -> &ZStr {
    PARSER_JOIN_INPUT_BUFFER.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
        let buf = unsafe { &mut *b.as_ptr() };
        join_abs_string_buf_z::<PLATFORM>(cwd, buf, parts)
    })
}

thread_local! {
    pub static JOIN_BUF: RefCell<[u8; 4096]> = const { RefCell::new([0u8; 4096]) };
}

pub fn join<const PLATFORM: Platform>(parts: &[&[u8]]) -> &[u8] {
    JOIN_BUF.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
        let buf = unsafe { &mut *b.as_ptr() };
        join_string_buf::<PLATFORM>(buf, parts)
    })
}

pub fn join_z<const PLATFORM: Platform>(parts: &[&[u8]]) -> &ZStr {
    JOIN_BUF.with(|b| {
        // SAFETY: thread-local, single-threaded access; matches Zig threadlocal-var pointer semantics
        let buf = unsafe { &mut *b.as_ptr() };
        join_z_buf::<PLATFORM>(buf, parts)
    })
}

pub fn join_z_buf<const PLATFORM: Platform>(buf: &mut [u8], parts: &[&[u8]]) -> &ZStr {
    let buf_len = buf.len();
    let joined = join_string_buf::<PLATFORM>(&mut buf[..buf_len - 1], parts);
    debug_assert!(bun_core::is_slice_in_buffer(joined, buf));
    let start_offset = (joined.as_ptr() as usize) - (buf.as_ptr() as usize);
    let len = joined.len();
    buf[len + start_offset] = 0;
    // SAFETY: NUL written at buf[start_offset + len]
    unsafe { ZStr::from_raw(buf.as_ptr().add(start_offset), len) }
}

pub fn join_string_buf<const PLATFORM: Platform>(buf: &mut [u8], parts: &[&[u8]]) -> &[u8] {
    join_string_buf_t::<u8, PLATFORM>(buf, parts)
}

pub fn join_string_buf_w<const PLATFORM: Platform>(buf: &mut [u16], parts: &[&[u8]]) -> &[u16] {
    // TODO(port): Zig `parts: anytype` allowed mixed u8/u16 elements; we accept
    // &[&[u8]] and transcode below to match the common callsite.
    join_string_buf_t::<u16, PLATFORM>(buf, parts)
}

pub fn join_string_buf_wz<const PLATFORM: Platform>(buf: &mut [u16], parts: &[&[u8]]) -> &WStr {
    let buf_len = buf.len();
    let joined = join_string_buf_t::<u16, PLATFORM>(&mut buf[..buf_len - 1], parts);
    debug_assert!(bun_core::is_slice_in_buffer_t::<u16>(joined, buf));
    let start_offset = (joined.as_ptr() as usize) / 2 - (buf.as_ptr() as usize) / 2;
    let len = joined.len();
    buf[len + start_offset] = 0;
    // SAFETY: NUL written at buf[start_offset + len]
    unsafe { WStr::from_raw(buf.as_ptr().add(start_offset), len) }
}

pub fn join_string_buf_z<const PLATFORM: Platform>(buf: &mut [u8], parts: &[&[u8]]) -> &ZStr {
    let buf_len = buf.len();
    let joined = join_string_buf_t::<u8, PLATFORM>(&mut buf[..buf_len - 1], parts);
    debug_assert!(bun_core::is_slice_in_buffer_t::<u8>(joined, buf));
    let start_offset = (joined.as_ptr() as usize) - (buf.as_ptr() as usize);
    let len = joined.len();
    buf[len + start_offset] = 0;
    // SAFETY: NUL written at buf[start_offset + len]
    unsafe { ZStr::from_raw(buf.as_ptr().add(start_offset), len) }
}

pub fn join_string_buf_t<T: PathChar, const PLATFORM: Platform>(
    buf: &mut [T],
    parts: &[&[u8]],
) -> &[T] {
    // TODO(port): Zig used `parts: anytype` (tuple of slices, possibly mixed
    // element types). Rust takes `&[&[u8]]`; transcoding to u16 handled below.
    let mut written: usize = 0;
    let mut temp_buf_: [T; 4096] = [T::from_u8(0); 4096];
    let mut temp_buf: &mut [T] = &mut temp_buf_;
    let mut heap_temp_buf: Vec<T>;
    // PERF(port): was stack-fallback (manual free) — Vec drops on scope exit

    let mut count: usize = 0;
    for part in parts {
        if part.is_empty() {
            continue;
        }
        count += part.len() + 1;
    }

    if count * 2 > temp_buf.len() {
        heap_temp_buf = vec![T::from_u8(0); count * 2];
        temp_buf = &mut heap_temp_buf;
    }

    temp_buf[0] = T::from_u8(0);

    for part in parts {
        if part.is_empty() {
            continue;
        }

        if written > 0 {
            temp_buf[written] = T::from_u8(PLATFORM.separator());
            written += 1;
        }

        // TODO(port): Zig inspected std.meta.Elem(@TypeOf(part)); we always
        // receive u8 parts, so transcode iff T == u16.
        if T::IS_U16 {
            let wrote = strings::convert_utf8_to_utf16_in_buffer(
                // SAFETY: T::IS_U16 implies T == u16
                unsafe { core::mem::transmute::<&mut [T], &mut [u16]>(&mut temp_buf[written..]) },
                part,
            );
            written += wrote.len();
        } else {
            // SAFETY: T == u8 here
            let dst =
                unsafe { core::mem::transmute::<&mut [T], &mut [u8]>(&mut temp_buf[written..]) };
            dst[..part.len()].copy_from_slice(part);
            written += part.len();
        }
    }

    if written == 0 {
        buf[0] = T::from_u8(b'.');
        return &buf[0..1];
    }

    normalize_string_node_t::<T, PLATFORM>(&temp_buf[0..written], buf)
}

/// Inline `MAX_PATH_BYTES * 2` stack buffer that heap-allocates when the
/// requested size exceeds it. Keeps `_join_abs_string_buf`'s scratch buffer safe
/// for arbitrarily long inputs while preserving zero-alloc behaviour for the
/// common case.
struct JoinScratch {
    // PERF(port): was StackFallbackAllocator(MAX_PATH_BYTES * 2) — using Vec.
    // Phase B: consider smallvec / stack-alloc fast path.
    buf: Vec<u8>,
}

impl JoinScratch {
    pub fn init(base: usize, parts: &[&[u8]]) -> Self {
        let mut total = base + 2;
        for p in parts {
            total += p.len() + 1;
        }
        Self {
            buf: vec![0u8; total],
        }
    }
}

pub fn join_abs_string_buf<const PLATFORM: Platform>(
    cwd: &[u8],
    buf: &mut [u8],
    parts: &[&[u8]],
) -> &[u8] {
    _join_abs_string_buf::<false, PLATFORM>(cwd, buf, parts)
}

/// Like `join_abs_string_buf`, but returns null when the *normalized* result is
/// too large for `buf`. Use this when `parts` may contain user-controlled
/// input of arbitrary length. `..` segments are handled correctly: a path
/// whose unnormalized length exceeds `buf.len` but normalizes down will still
/// succeed.
pub fn join_abs_string_buf_checked<const PLATFORM: Platform>(
    cwd: &[u8],
    buf: &mut [u8],
    parts: &[&[u8]],
) -> Option<&[u8]> {
    const _: () = assert!(!matches!(PLATFORM, Platform::Nt));
    // Fast path: size check only — don't allocate a JoinScratch here since the
    // inner join_abs_string_buf already has its own (avoids doubling stack usage).
    let mut total: usize = cwd.len() + 2;
    for p in parts {
        total += p.len() + 1;
    }
    if total < buf.len() {
        return Some(join_abs_string_buf::<PLATFORM>(cwd, buf, parts));
    }

    // Slow path: allocate a large scratch for the result. The inner
    // join_abs_string_buf will heap-allocate its own temp buffer for the concat
    // since `total > MAX_PATH_BYTES * 2 > sfa inline size` is likely here.
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let mut scratch = vec![0u8; total];
    let joined = join_abs_string_buf::<PLATFORM>(cwd, &mut scratch, parts);
    if joined.len() > buf.len() {
        return None;
    }
    let len = joined.len();
    buf[..len].copy_from_slice(joined);
    Some(&buf[..len])
}

pub fn join_abs_string_buf_z<const PLATFORM: Platform>(
    cwd: &[u8],
    buf: &mut [u8],
    parts: &[&[u8]],
) -> &ZStr {
    let r = _join_abs_string_buf::<true, PLATFORM>(cwd, buf, parts);
    // SAFETY: IS_SENTINEL=true wrote NUL at r.len()
    unsafe { ZStr::from_raw(r.as_ptr(), r.len()) }
}

pub fn join_abs_string_buf_znt<const PLATFORM: Platform>(
    cwd: &[u8],
    buf: &mut [u8],
    parts: &[&[u8]],
) -> &ZStr {
    if (matches!(PLATFORM, Platform::AUTO | Platform::Loose | Platform::Windows)) && cfg!(windows) {
        let r = _join_abs_string_buf::<true, { Platform::Nt }>(cwd, buf, parts);
        // SAFETY: NUL written at r.len()
        return unsafe { ZStr::from_raw(r.as_ptr(), r.len()) };
    }

    let r = _join_abs_string_buf::<true, PLATFORM>(cwd, buf, parts);
    // SAFETY: NUL written at r.len()
    unsafe { ZStr::from_raw(r.as_ptr(), r.len()) }
}

pub fn join_abs_string_buf_z_trailing_slash<const PLATFORM: Platform>(
    cwd: &[u8],
    buf: &mut [u8],
    parts: &[&[u8]],
) -> &ZStr {
    let out = _join_abs_string_buf::<true, PLATFORM>(cwd, buf, parts);
    let out_len = out.len();
    if out_len + 2 < buf.len() && out_len > 0 && buf[out_len - 1] != PLATFORM.separator() {
        buf[out_len] = PLATFORM.separator();
        buf[out_len + 1] = 0;
        // SAFETY: NUL written at out_len + 1
        return unsafe { ZStr::from_raw(buf.as_ptr(), out_len + 1) };
    }

    // SAFETY: NUL written at out_len by _join_abs_string_buf::<true, _>
    unsafe { ZStr::from_raw(buf.as_ptr(), out_len) }
}

// TODO(port): Zig used `comptime ReturnType: type` to vary `[:0]const u8` vs
// `[]const u8`. We always return `&[u8]`; when `IS_SENTINEL` a NUL is written
// at `result.len()` and callers re-wrap as `ZStr`.
fn _join_abs_string_buf<const IS_SENTINEL: bool, const PLATFORM: Platform>(
    _cwd: &[u8],
    buf: &mut [u8],
    _parts: &[&[u8]],
) -> &[u8] {
    if PLATFORM == Platform::Windows || (cfg!(windows) && PLATFORM == Platform::Loose) {
        return _join_abs_string_buf_windows::<IS_SENTINEL>(_cwd, buf, _parts);
    }

    if PLATFORM == Platform::Nt {
        let end_path = _join_abs_string_buf_windows::<IS_SENTINEL>(_cwd, &mut buf[4..], _parts);
        let end_len = end_path.len();
        buf[0..4].copy_from_slice(b"\\\\?\\");
        if IS_SENTINEL {
            buf[end_len + 4] = 0;
        }
        return &buf[0..end_len + 4];
    }

    let mut parts: &[&[u8]] = _parts;
    if parts.is_empty() {
        if IS_SENTINEL {
            unreachable!();
        }
        return _cwd;
    }

    if matches!(PLATFORM, Platform::Loose | Platform::Posix)
        && parts.len() == 1
        && parts[0].len() == 1
        && parts[0][0] == SEP_POSIX
    {
        return b"/";
    }

    let mut out: usize = 0;
    let mut cwd = if cfg!(windows) && _cwd.len() >= 3 && _cwd[1] == b':' {
        &_cwd[2..]
    } else {
        _cwd
    };

    {
        let mut part_i: u16 = 0;
        let mut part_len: u16 = parts.len() as u16;

        while part_i < part_len {
            if PLATFORM.is_absolute(parts[part_i as usize]) {
                cwd = parts[part_i as usize];
                parts = &parts[part_i as usize + 1..];

                part_len = parts.len() as u16;
                part_i = 0;
                continue;
            }
            part_i += 1;
        }
    }

    let mut scratch = JoinScratch::init(cwd.len(), parts);
    let temp_buf = &mut scratch.buf;

    temp_buf[..cwd.len()].copy_from_slice(cwd);
    out = cwd.len();

    for &_part in parts {
        if _part.is_empty() {
            continue;
        }

        let part = _part;

        if out > 0 && temp_buf[out - 1] != PLATFORM.separator() {
            temp_buf[out] = PLATFORM.separator();
            out += 1;
        }

        temp_buf[out..out + part.len()].copy_from_slice(part);
        out += part.len();
    }

    let leading_separator: &[u8] =
        if let Some(i) = PLATFORM.leading_separator_index::<u8>(&temp_buf[0..out]) {
            let outdir = &mut temp_buf[0..i + 1];
            if PLATFORM == Platform::Loose {
                for c in outdir.iter_mut() {
                    if *c == b'\\' {
                        *c = b'/';
                    }
                }
            }
            // PORT NOTE: reshaped for borrowck — we borrow from temp_buf below;
            // capture leading separator length and re-slice.
            &temp_buf[0..i + 1]
        } else {
            b"/"
        };
    let leading_len = leading_separator.len();
    // copy leading separator into buf first (Zig does this after normalize, but
    // the normalize writes into buf[leading_len..] so it's order-independent)
    // PORT NOTE: reshaped for borrowck — copy leading_separator now while
    // temp_buf borrow is still valid.
    buf[..leading_len].copy_from_slice(&temp_buf[0..leading_len].to_owned());
    // TODO(port): the .to_owned() above is a workaround for overlapping borrows
    // (leading_separator may point into temp_buf or a static). Phase B: avoid copy.

    let result = normalize_string_buf::<false, PLATFORM, true>(
        &temp_buf[leading_len..out],
        &mut buf[leading_len..],
    );
    let result_len = result.len();

    if IS_SENTINEL {
        buf[result_len + leading_len] = 0;
    }
    &buf[0..result_len + leading_len]
}

fn _join_abs_string_buf_windows<const IS_SENTINEL: bool>(
    cwd: &[u8],
    buf: &mut [u8],
    parts: &[&[u8]],
) -> &[u8] {
    debug_assert!(crate::is_absolute_windows(cwd));

    if parts.is_empty() {
        if IS_SENTINEL {
            unreachable!();
        }
        return cwd;
    }

    // path.resolve is a bit different on Windows, as there are multiple possible filesystem roots.
    // When you resolve(`C:\hello`, `C:world`), the second arg is a drive letter relative path, so
    // the result of such is `C:\hello\world`, but if you used D:world, you would switch roots and
    // end up with `D:\world`. this root handling basically means a different algorithm.
    //
    // to complicate things, it seems node.js will first figure out what the last root is, then
    // in a separate search, figure out the last absolute path.
    //
    // Given the case `resolve("/one", "D:two", "three", "F:four", "five")`
    // Root is "F:", cwd is "/one", then join all paths that dont exist on other drives.
    //
    // Also, the special root "/" can match into anything, but we have to resolve it to a real
    // root at some point. That is what the `root_of_part.len == 0` check is doing.
    let (root, set_cwd, n_start) = 'base: {
        let root = 'root: {
            let mut n = parts.len();
            while n > 0 {
                n -= 1;
                let len = windows_volume_name_len(parts[n]).0;
                if len > 0 {
                    break 'root &parts[n][0..len];
                }
            }
            // use cwd
            let len = windows_volume_name_len(cwd).0;
            break 'root &cwd[0..len];
        };

        let mut n = parts.len();
        while n > 0 {
            n -= 1;
            if crate::is_absolute_windows(parts[n]) {
                let root_of_part = &parts[n][0..windows_volume_name_len(parts[n]).0];
                if root_of_part.is_empty() || root_of_part == root {
                    break 'base (root, &parts[n][root_of_part.len()..], n + 1);
                }
            }
        }
        // use cwd only if the root matches
        let cwd_root = &cwd[0..windows_volume_name_len(cwd).0];
        if cwd_root == root {
            break 'base (root, &cwd[cwd_root.len()..], 0);
        } else {
            break 'base (root, b"/".as_slice(), 0);
        }
    };

    if !set_cwd.is_empty() {
        debug_assert!(is_sep_any(set_cwd[0]));
    }

    let mut scratch = JoinScratch::init(root.len() + set_cwd.len(), &parts[n_start..]);
    let temp_buf = &mut scratch.buf;

    temp_buf[0..root.len()].copy_from_slice(root);
    temp_buf[root.len()..root.len() + set_cwd.len()].copy_from_slice(set_cwd);
    let mut out: usize = root.len() + set_cwd.len();

    if set_cwd.is_empty() {
        // when cwd is `//server/share` without a suffix `/`, the path is considered absolute
        temp_buf[out] = b'\\';
        out += 1;
    }

    for &part in &parts[n_start..] {
        if part.is_empty() {
            continue;
        }

        if out > 0 && temp_buf[out - 1] != b'\\' {
            temp_buf[out] = b'\\';
            out += 1;
        }

        // skip over volume name
        let volume = &part[0..windows_volume_name_len(part).0];
        if !volume.is_empty() && !strings::eql_long(volume, root, true) {
            continue;
        }

        let part_without_vol = &part[volume.len()..];
        temp_buf[out..out + part_without_vol.len()].copy_from_slice(part_without_vol);
        out += part_without_vol.len();
    }

    // if (out > 0 and temp_buf[out - 1] != '\\') {
    //     temp_buf[out] = '\\';
    //     out += 1;
    // }

    let result =
        normalize_string_buf::<false, { Platform::Windows }, true>(&temp_buf[0..out], buf);
    let result_len = result.len();

    if IS_SENTINEL {
        buf[result_len] = 0;
    }
    &buf[0..result_len]
}

pub const fn is_sep_posix(char: u8) -> bool {
    is_sep_posix_t::<u8>(char)
}

pub const fn is_sep_posix_t<T: PathChar>(char: T) -> bool {
    char == T::from_u8(SEP_POSIX)
}

pub const fn is_sep_win32(char: u8) -> bool {
    is_sep_win32_t::<u8>(char)
}

pub const fn is_sep_win32_t<T: PathChar>(char: T) -> bool {
    char == T::from_u8(SEP_WINDOWS)
}

pub const fn is_sep_any(char: u8) -> bool {
    is_sep_any_t::<u8>(char)
}

#[inline]
pub const fn is_sep_any_t<T: PathChar>(char: T) -> bool {
    is_sep_posix_t::<T>(char) || is_sep_win32_t::<T>(char)
}

pub fn last_index_of_separator_windows(slice: &[u8]) -> Option<usize> {
    last_index_of_separator_windows_t::<u8>(slice)
}

pub fn last_index_of_separator_windows_t<T: PathChar>(slice: &[T]) -> Option<usize> {
    // std.mem.lastIndexOfAny(T, slice, "\\/")
    slice.iter().rposition(|&c| is_sep_any_t::<T>(c))
}

pub fn last_index_of_separator_posix(slice: &[u8]) -> Option<usize> {
    last_index_of_separator_posix_t::<u8>(slice)
}

pub fn last_index_of_separator_posix_t<T: PathChar>(slice: &[T]) -> Option<usize> {
    slice.iter().rposition(|&c| c == T::from_u8(SEP_POSIX))
}

pub fn last_index_of_non_separator_posix(slice: &[u8]) -> Option<u32> {
    let mut i: usize = slice.len();
    while i != 0 {
        if slice[i] != SEP_POSIX {
            return Some(u32::try_from(i).unwrap());
        }
        i -= 1;
    }
    None
}

pub fn last_index_of_separator_loose(slice: &[u8]) -> Option<usize> {
    last_index_of_separator_loose_t::<u8>(slice)
}

pub fn last_index_of_separator_loose_t<T: PathChar>(slice: &[T]) -> Option<usize> {
    last_index_of_sep_t::<T>(slice)
}

pub fn normalize_string_loose_buf<
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[u8],
    buf: &mut [u8],
) -> &mut [u8] {
    normalize_string_loose_buf_t::<u8, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
}

pub fn normalize_string_loose_buf_t<
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[T],
    buf: &mut [T],
) -> &mut [T] {
    normalize_string_generic_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(
        str,
        buf,
        T::from_u8(SEP_POSIX),
        is_sep_any_t::<T>,
    )
}

pub fn normalize_string_windows<
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[u8],
    buf: &mut [u8],
) -> &mut [u8] {
    normalize_string_windows_t::<u8, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
}

pub fn normalize_string_windows_t<
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[T],
    buf: &mut [T],
) -> &mut [T] {
    normalize_string_generic_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(
        str,
        buf,
        T::from_u8(SEP_WINDOWS),
        is_sep_any_t::<T>,
    )
}

pub fn normalize_string_node<const PLATFORM: Platform>(str: &[u8], buf: &mut [u8]) -> &mut [u8] {
    // TODO(port): Zig returned []u8 here but []const T from the T variant; we
    // unify to &[T] in the T variant and cast here.
    let r = normalize_string_node_t::<u8, PLATFORM>(str, buf);
    // SAFETY: result always points into `buf`
    unsafe { core::slice::from_raw_parts_mut(r.as_ptr() as *mut u8, r.len()) }
}

pub fn normalize_string_node_t<T: PathChar, const PLATFORM: Platform>(
    str: &[T],
    buf: &mut [T],
) -> &[T] {
    if str.is_empty() {
        buf[0] = T::from_u8(b'.');
        return &buf[0..1];
    }

    let is_absolute = PLATFORM.is_absolute_t::<T>(str);
    let trailing_separator = PLATFORM.is_separator_t::<T>(str[str.len() - 1]);

    // `normalize_string_generic` handles absolute path cases for windows
    // we should not prefix with /
    // PORT NOTE: reshaped for borrowck — track an offset instead of reslicing.
    let buf_off: usize = if PLATFORM == Platform::Windows { 0 } else { 1 };

    let separator_t = T::from_u8(PLATFORM.separator());
    let is_sep_fn = |c: T| PLATFORM.is_separator_t::<T>(c);

    let out_len = if !is_absolute {
        normalize_string_generic_t::<T, true, false>(str, &mut buf[buf_off..], separator_t, is_sep_fn)
            .len()
    } else {
        normalize_string_generic_t::<T, false, false>(str, &mut buf[buf_off..], separator_t, is_sep_fn)
            .len()
    };
    let mut out_len = out_len;

    if out_len == 0 {
        if is_absolute {
            buf[0] = separator_t;
            return &buf[0..1];
        }

        if trailing_separator {
            let sep = PLATFORM.trailing_separator();
            buf[0] = T::from_u8(sep[0]);
            buf[1] = T::from_u8(sep[1]);
            return &buf[0..2];
        }

        buf[0] = T::from_u8(b'.');
        return &buf[0..1];
    }

    if trailing_separator {
        if !PLATFORM.is_separator_t::<T>(buf[buf_off + out_len - 1]) {
            buf[buf_off + out_len] = separator_t;
            out_len += 1;
        }
    }

    if is_absolute {
        if PLATFORM == Platform::Windows {
            return &buf[buf_off..buf_off + out_len];
        }
        buf[0] = separator_t;
        return &buf[0..out_len + 1];
    }

    &buf[buf_off..buf_off + out_len]
}

pub fn basename(path: &[u8]) -> &[u8] {
    if path.is_empty() {
        return &[];
    }

    let mut end_index: usize = path.len() - 1;
    while is_sep_any(path[end_index]) {
        if end_index == 0 {
            return b"/";
        }
        end_index -= 1;
    }
    let mut start_index: usize = end_index;
    end_index += 1;
    while !is_sep_any(path[start_index]) {
        if start_index == 0 {
            return &path[0..end_index];
        }
        start_index -= 1;
    }

    &path[start_index + 1..end_index]
}

pub fn last_index_of_sep(path: &[u8]) -> Option<usize> {
    last_index_of_sep_t::<u8>(path)
}

pub fn last_index_of_sep_t<T: PathChar>(path: &[T]) -> Option<usize> {
    #[cfg(not(windows))]
    {
        return strings::last_index_of_char_t::<T>(path, T::from_u8(b'/'));
    }
    #[cfg(windows)]
    {
        path.iter().rposition(|&c| is_sep_any_t::<T>(c))
    }
}

pub fn next_dirname(path_: &[u8]) -> Option<&[u8]> {
    let path = path_;
    let mut root_prefix: &[u8] = b"";
    if path.len() > 3 {
        // disk designator
        if path[1] == b':' && is_sep_any(path[2]) {
            root_prefix = &path[0..3];
        }

        // TODO: unc path
    }

    if path.is_empty() {
        return if !root_prefix.is_empty() {
            Some(root_prefix)
        } else {
            None
        };
    }

    let mut end_index: usize = path.len() - 1;
    while is_sep_any(path[end_index]) {
        if end_index == 0 {
            return if !root_prefix.is_empty() {
                Some(root_prefix)
            } else {
                None
            };
        }
        end_index -= 1;
    }

    while !is_sep_any(path[end_index]) {
        if end_index == 0 {
            return if !root_prefix.is_empty() {
                Some(root_prefix)
            } else {
                None
            };
        }
        end_index -= 1;
    }

    if end_index == 0 && is_sep_any(path[0]) {
        return Some(&path[0..1]);
    }

    if end_index == 0 {
        return if !root_prefix.is_empty() {
            Some(root_prefix)
        } else {
            None
        };
    }

    Some(&path[0..end_index + 1])
}

/// The use case of this is when you do
///     "import '/hello/world'"
/// The windows disk designator is missing!
///
/// Defaulting to C would work but the correct behavior is to use a known disk designator,
/// via an absolute path from the referrer or what not.
///
/// I've made it so that trying to read a file with a posix path is a debug assertion failure.
///
/// To use this, stack allocate the following struct, and then call `resolve`.
///
///     let mut normalizer = PosixToWinNormalizer::default();
///     let result = normalizer.resolve(b"C:\\dev\\bun", b"/dev/bun/test/etc.js");
///
/// When you are certain that using the current working directory is fine, you can use
///
///     let result = normalizer.resolve_cwd(b"/dev/bun/test/etc.js");
///
/// This API does nothing on Linux (it has a size of zero)
pub struct PosixToWinNormalizer {
    #[cfg(windows)]
    _raw_bytes: PathBuffer,
    #[cfg(not(windows))]
    _raw_bytes: (),
}

#[cfg(windows)]
type PosixToWinBuf = PathBuffer;
#[cfg(not(windows))]
type PosixToWinBuf = ();

impl Default for PosixToWinNormalizer {
    fn default() -> Self {
        #[cfg(windows)]
        {
            Self { _raw_bytes: PathBuffer::uninit() }
        }
        #[cfg(not(windows))]
        {
            Self { _raw_bytes: () }
        }
    }
}

impl PosixToWinNormalizer {
    // methods on PosixToWinNormalizer, to be minimal yet stack allocate the PathBuffer
    // these do not force inline of much code
    #[inline]
    pub fn resolve<'a>(&'a mut self, source_dir: &[u8], maybe_posix_path: &'a [u8]) -> &'a [u8] {
        Self::resolve_with_external_buf(&mut self._raw_bytes, source_dir, maybe_posix_path)
    }

    #[inline]
    pub fn resolve_z<'a>(
        &'a mut self,
        source_dir: &[u8],
        maybe_posix_path: &'a ZStr,
    ) -> &'a ZStr {
        Self::resolve_with_external_buf_z(&mut self._raw_bytes, source_dir, maybe_posix_path)
    }

    #[inline]
    pub fn resolve_cwd<'a>(
        &'a mut self,
        maybe_posix_path: &'a [u8],
    ) -> Result<&'a [u8], bun_core::Error> {
        Self::resolve_cwd_with_external_buf(&mut self._raw_bytes, maybe_posix_path)
    }

    #[inline]
    pub fn resolve_cwd_z<'a>(
        &'a mut self,
        maybe_posix_path: &'a [u8],
    ) -> Result<&'a mut ZStr, bun_core::Error> {
        // TODO(port): on non-windows this needs a real PathBuffer to copy into
        Self::resolve_cwd_with_external_buf_z(&mut self._raw_bytes, maybe_posix_path)
    }

    // underlying implementation:

    fn resolve_with_external_buf<'a>(
        buf: &'a mut PosixToWinBuf,
        source_dir: &[u8],
        maybe_posix_path: &'a [u8],
    ) -> &'a [u8] {
        debug_assert!(crate::is_absolute_windows(maybe_posix_path));
        #[cfg(windows)]
        {
            let root = windows_filesystem_root(maybe_posix_path);
            if root.len() == 1 {
                debug_assert!(is_sep_any(root[0]));
                if strings::is_windows_absolute_path_missing_drive_letter::<u8>(maybe_posix_path) {
                    let source_root = windows_filesystem_root(source_dir);
                    buf[0..source_root.len()].copy_from_slice(source_root);
                    buf[source_root.len()..source_root.len() + maybe_posix_path.len() - 1]
                        .copy_from_slice(&maybe_posix_path[1..]);
                    let res = &buf[0..source_root.len() + maybe_posix_path.len() - 1];
                    debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(res));
                    debug_assert!(crate::is_absolute_windows(res));
                    return res;
                }
            }
            debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                maybe_posix_path
            ));
        }
        let _ = (buf, source_dir);
        maybe_posix_path
    }

    fn resolve_with_external_buf_z<'a>(
        buf: &'a mut PosixToWinBuf,
        source_dir: &[u8],
        maybe_posix_path: &'a ZStr,
    ) -> &'a ZStr {
        debug_assert!(crate::is_absolute_windows(maybe_posix_path.as_bytes()));
        #[cfg(windows)]
        {
            let mp = maybe_posix_path.as_bytes();
            let root = windows_filesystem_root(mp);
            if root.len() == 1 {
                debug_assert!(is_sep_any(root[0]));
                if strings::is_windows_absolute_path_missing_drive_letter::<u8>(mp) {
                    let source_root = windows_filesystem_root(source_dir);
                    buf[0..source_root.len()].copy_from_slice(source_root);
                    buf[source_root.len()..source_root.len() + mp.len() - 1]
                        .copy_from_slice(&mp[1..]);
                    buf[source_root.len() + mp.len() - 1] = 0;
                    let len = source_root.len() + mp.len() - 1;
                    // SAFETY: NUL written at buf[len]
                    let res = unsafe { ZStr::from_raw(buf.as_ptr(), len) };
                    debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                        res.as_bytes()
                    ));
                    debug_assert!(crate::is_absolute_windows(res.as_bytes()));
                    return res;
                }
            }
            debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(mp));
        }
        let _ = (buf, source_dir);
        maybe_posix_path
    }

    pub fn resolve_cwd_with_external_buf<'a>(
        buf: &'a mut PosixToWinBuf,
        maybe_posix_path: &'a [u8],
    ) -> Result<&'a [u8], bun_core::Error> {
        debug_assert!(crate::is_absolute_windows(maybe_posix_path));

        #[cfg(windows)]
        {
            let root = windows_filesystem_root(maybe_posix_path);
            if root.len() == 1 {
                debug_assert!(is_sep_any(root[0]));
                if strings::is_windows_absolute_path_missing_drive_letter::<u8>(maybe_posix_path) {
                    // TODO(port): std.posix.getcwd → bun_sys::getcwd
                    let cwd = bun_sys::getcwd(buf)?;
                    debug_assert!(cwd.as_ptr() == buf.as_ptr());
                    let source_root = windows_filesystem_root(cwd);
                    debug_assert!(source_root.as_ptr() == source_root.as_ptr());
                    let sr_len = source_root.len();
                    buf[sr_len..sr_len + maybe_posix_path.len() - 1]
                        .copy_from_slice(&maybe_posix_path[1..]);
                    let res = &buf[0..sr_len + maybe_posix_path.len() - 1];
                    debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(res));
                    debug_assert!(crate::is_absolute_windows(res));
                    return Ok(res);
                }
            }
            debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                maybe_posix_path
            ));
        }

        let _ = buf;
        Ok(maybe_posix_path)
    }

    pub fn resolve_cwd_with_external_buf_z<'a>(
        buf: &'a mut PathBuffer,
        maybe_posix_path: &[u8],
    ) -> Result<&'a mut ZStr, bun_core::Error> {
        debug_assert!(crate::is_absolute_windows(maybe_posix_path));

        #[cfg(windows)]
        {
            let root = windows_filesystem_root(maybe_posix_path);
            if root.len() == 1 {
                debug_assert!(is_sep_any(root[0]));
                if strings::is_windows_absolute_path_missing_drive_letter::<u8>(maybe_posix_path) {
                    let cwd = bun_sys::getcwd(buf)?;
                    debug_assert!(cwd.as_ptr() == buf.as_ptr());
                    let source_root = windows_filesystem_root(cwd);
                    debug_assert!(source_root.as_ptr() == source_root.as_ptr());
                    let sr_len = source_root.len();
                    buf[sr_len..sr_len + maybe_posix_path.len() - 1]
                        .copy_from_slice(&maybe_posix_path[1..]);
                    buf[sr_len + maybe_posix_path.len() - 1] = 0;
                    let len = sr_len + maybe_posix_path.len() - 1;
                    // SAFETY: NUL at buf[len]
                    let res = unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) };
                    debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                        res.as_bytes()
                    ));
                    debug_assert!(crate::is_absolute_windows(res.as_bytes()));
                    return Ok(res);
                }
            }
            debug_assert!(!strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                maybe_posix_path
            ));
        }

        buf[..maybe_posix_path.len()].copy_from_slice(maybe_posix_path);
        buf[maybe_posix_path.len()] = 0;
        // SAFETY: NUL at buf[maybe_posix_path.len()]
        Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), maybe_posix_path.len()) })
    }
}

// ResolvePath__joinAbsStringBufCurrentPlatformBunString: see src/jsc/resolve_path_jsc.zig
// (reaches into the VM for cwd; paths/ is JSC-free).

pub fn platform_to_posix_in_place<T: PathChar>(path_buffer: &mut [T]) {
    if SEP == b'/' {
        return;
    }
    let mut idx: usize = 0;
    while let Some(index) =
        path_buffer[idx..].iter().position(|&c| c == T::from_u8(SEP)).map(|p| p + idx)
    {
        path_buffer[index] = T::from_u8(b'/');
        idx = index + 1;
    }
}

pub fn dangerously_convert_path_to_posix_in_place<T: PathChar>(path: &mut [T]) {
    let mut idx: usize = 0;
    #[cfg(windows)]
    {
        if path.len() > 2
            && is_drive_letter_t::<T>(path[0])
            && path[1] == T::from_u8(b':')
            && is_sep_any_t::<T>(path[2])
        {
            // Uppercase drive letter
            let c = path[0];
            if c >= T::from_u8(b'a') && c <= T::from_u8(b'z') {
                path[0] = T::to_ascii_upper(c);
            } else if c >= T::from_u8(b'A') && c <= T::from_u8(b'Z') {
                // no-op
            } else {
                unreachable!();
            }
        }
    }

    while let Some(index) = path[idx..]
        .iter()
        .position(|&c| c == T::from_u8(SEP_WINDOWS))
        .map(|p| p + idx)
    {
        path[index] = T::from_u8(b'/');
        idx = index + 1;
    }
}

pub fn dangerously_convert_path_to_windows_in_place<T: PathChar>(path: &mut [T]) {
    let mut idx: usize = 0;
    while let Some(index) = path[idx..]
        .iter()
        .position(|&c| c == T::from_u8(SEP_POSIX))
        .map(|p| p + idx)
    {
        path[index] = T::from_u8(b'\\');
        idx = index + 1;
    }
}

pub fn path_to_posix_buf<T: PathChar>(path: &[T], buf: &mut [T]) -> &mut [T] {
    let mut idx: usize = 0;
    while let Some(index) = path[idx..]
        .iter()
        .position(|&c| c == T::from_u8(SEP_WINDOWS))
        .map(|p| p + idx)
    {
        buf[idx..index].copy_from_slice(&path[idx..index]);
        buf[index] = T::from_u8(SEP_POSIX);
        idx = index + 1;
    }
    buf[idx..path.len()].copy_from_slice(&path[idx..path.len()]);
    &mut buf[0..path.len()]
}

pub fn platform_to_posix_buf<'a, T: PathChar>(path: &'a [T], buf: &'a mut [T]) -> &'a [T] {
    if SEP == b'/' {
        return path;
    }
    let mut idx: usize = 0;
    while let Some(index) = path[idx..]
        .iter()
        .position(|&c| c == T::from_u8(SEP))
        .map(|p| p + idx)
    {
        buf[idx..index].copy_from_slice(&path[idx..index]);
        buf[index] = T::from_u8(b'/');
        idx = index + 1;
    }
    buf[idx..path.len()].copy_from_slice(&path[idx..path.len()]);
    &buf[0..path.len()]
}

pub fn posix_to_platform_in_place<T: PathChar>(path_buffer: &mut [T]) {
    if SEP == b'/' {
        return;
    }
    let mut idx: usize = 0;
    while let Some(index) = path_buffer[idx..]
        .iter()
        .position(|&c| c == T::from_u8(b'/'))
        .map(|p| p + idx)
    {
        path_buffer[index] = T::from_u8(SEP);
        idx = index + 1;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Port helper: trait abstracting over u8/u16 for the `comptime T: type` params.
// Zig had no trait — it relied on duck-typed comptime. Phase B may move this
// into bun_paths or bun_str.
// ─────────────────────────────────────────────────────────────────────────────
pub trait PathChar: Copy + Eq + Ord + 'static {
    const IS_U16: bool;
    fn from_u8(b: u8) -> Self;
    fn to_u8(self) -> u8;
    fn to_ascii_upper(self) -> Self;
    /// Comptime literal: `strings.literal(T, "...")`
    fn lit(s: &'static str) -> &'static [Self];
}

impl PathChar for u8 {
    const IS_U16: bool = false;
    #[inline]
    fn from_u8(b: u8) -> Self {
        b
    }
    #[inline]
    fn to_u8(self) -> u8 {
        self
    }
    #[inline]
    fn to_ascii_upper(self) -> Self {
        self.to_ascii_uppercase()
    }
    #[inline]
    fn lit(s: &'static str) -> &'static [Self] {
        s.as_bytes()
    }
}

impl PathChar for u16 {
    const IS_U16: bool = true;
    #[inline]
    fn from_u8(b: u8) -> Self {
        b as u16
    }
    #[inline]
    fn to_u8(self) -> u8 {
        // narrowing u16→u8: callers only pass ASCII-range values
        u8::try_from(self).unwrap()
    }
    #[inline]
    fn to_ascii_upper(self) -> Self {
        if (b'a' as u16..=b'z' as u16).contains(&self) {
            self - 32
        } else {
            self
        }
    }
    #[inline]
    fn lit(s: &'static str) -> &'static [Self] {
        // TODO(port): needs `bun_str::w!("...")` macro to produce &'static [u16].
        // Placeholder: callers only use ASCII literals; Phase B replaces with w!().
        bun_str::w_static(s)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/resolve_path.zig (2119 lines)
//   confidence: medium
//   todos:      30
//   notes:      heavy comptime → const-generics reshaping; thread-local buffer accessors return raw &mut (unsound in safe Rust, matches Zig semantics — Phase B should guard); `parts: anytype` collapsed to &[&[u8]]; PathChar trait introduced for u8/u16 generics; many return-lifetimes need unification.
// ──────────────────────────────────────────────────────────────────────────
