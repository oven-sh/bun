use core::cell::UnsafeCell;

use crate::fs as Fs;
use crate::{
    MAX_PATH_BYTES, PathBuffer, SEP, SEP_POSIX, SEP_WINDOWS, disk_designator_windows,
    is_absolute_posix, is_absolute_windows, is_absolute_windows_t,
};
use bun_alloc::{is_slice_in_buffer, is_slice_in_buffer_t};
use bun_core::{WStr, ZStr, strings};

// PORT NOTE: Zig `threadlocal var` buffers. Stored in `UnsafeCell` (not `RefCell`)
// because callers must receive a raw `&mut` slice that outlives the `.with` closure
// to match Zig's "valid until next call on this thread" pointer semantics. RefCell's
// runtime borrow tracking cannot express that contract and would force an
// unsafe-lifetime-extend through `RefCell::as_ptr` (PORTING.md §Forbidden).
// SAFETY invariant: each buffer has at most one live mutable borrow per thread;
// callers must not re-enter the accessor while a previous borrow is alive.
thread_local! {
    static PARSER_JOIN_INPUT_BUFFER: UnsafeCell<[u8; 4096]> = const { UnsafeCell::new([0u8; 4096]) };
    static PARSER_BUFFER: UnsafeCell<[u8; 1024]> = const { UnsafeCell::new([0u8; 1024]) };
}

/// Project `&'static mut` into a thread-local `UnsafeCell<[u8; N]>` scratch
/// buffer. One `unsafe` site for all `PARSER_BUFFER` / `PARSER_JOIN_INPUT_BUFFER`
/// / `JOIN_BUF` accessors (nonnull-asref reduction: 6 sites → 1).
///
/// The `'static` output lifetime is the honest contract: the buffer is
/// thread-local storage that lives for the thread's lifetime, and the returned
/// slice is "valid until the next call on this thread" (Zig threadlocal-var
/// pointer semantics — see module PORT NOTE above). Callers uphold the
/// single-live-borrow-per-thread invariant.
#[inline]
fn tl_buf_mut<const N: usize>(b: &UnsafeCell<[u8; N]>) -> &'static mut [u8; N] {
    // SAFETY: thread-local UnsafeCell ⇒ this thread is the sole accessor;
    // callers never re-enter while holding the borrow (see fn doc).
    unsafe { &mut *b.get() }
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

    ZStr::from_buf(output, input.len())
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

#[inline(always)]
fn is_dotdot(slice: &[u8]) -> bool {
    slice.len() >= 2 && u16::from_le_bytes([slice[0], slice[1]]) == u16::from_le_bytes(*b"..")
}

#[inline(always)]
fn is_dotdot_with_type<T: PathChar>(slice: &[T]) -> bool {
    // TODO(port): specialization for T==u8 used @bitCast; generic path checks bytewise
    slice.len() >= 2 && slice[0] == T::from_u8(b'.') && slice[1] == T::from_u8(b'.')
}

#[inline(always)]
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

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let contains = strings::contains_case_insensitive_ascii;
    #[cfg(any(target_os = "linux", target_os = "android"))]
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

pub fn get_if_exists_longest_common_path_generic<'a, P: PlatformT>(
    input: &[&'a [u8]],
) -> Option<&'a [u8]> {
    // TODO(port): return lifetime — borrows from `input` strings; caller must ensure outlives
    let separator = P::P.separator();
    let is_path_separator = P::P.get_separator_func();

    let nql_at_index_fn: fn(usize, usize, &[&[u8]]) -> bool = match P::P {
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
                    if P::P == Platform::Windows {
                        if !input[0][index].eq_ignore_ascii_case(&input[string_index][index]) {
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
        return Some(P::P.separator_string().as_bytes());
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
        if !input[0][index].eq_ignore_ascii_case(&input[s][index]) {
            return true;
        }
    }
    false
}

// TODO: is it faster to determine longest_common_separator in the while loop
// or as an extra step at the end?
// only boether to check if this function appears in benchmarking
pub fn longest_common_path_generic<'a, P: PlatformT>(input: &[&'a [u8]]) -> &'a [u8] {
    let separator = P::P.separator();
    let is_path_separator = P::P.get_separator_func();

    let nql_at_index_fn: fn(usize, usize, &[&[u8]]) -> bool = match P::P {
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
            if P::P == Platform::Windows {
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
            if P::P == Platform::Windows {
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
                    if P::P == Platform::Windows {
                        if !input[0][index].eq_ignore_ascii_case(&input[string_index][index]) {
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
        return P::P.separator_string().as_bytes();
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

pub fn longest_common_path<'a>(input: &[&'a [u8]]) -> &'a [u8] {
    longest_common_path_generic::<platform::Loose>(input)
}

pub fn get_if_exists_longest_common_path<'a>(input: &[&'a [u8]]) -> Option<&'a [u8]> {
    get_if_exists_longest_common_path_generic::<platform::Loose>(input)
}

pub fn longest_common_path_windows<'a>(input: &[&'a [u8]]) -> &'a [u8] {
    longest_common_path_generic::<platform::Windows>(input)
}

pub fn longest_common_path_posix<'a>(input: &[&'a [u8]]) -> &'a [u8] {
    longest_common_path_generic::<platform::Posix>(input)
}

// PORT NOTE: bun.ThreadlocalBuffers(struct {...}) heap-allocates on first use and
// stores only a pointer in TLS. Represented as three independent lazily-boxed
// thread-locals so that `relative_platform_buf` can hold disjoint `&mut` to
// from/to buffers while `relative_to_common_path_buf()` is borrowed elsewhere
// without aliasing a single parent payload. Only 3×8 bytes in static TLS instead
// of 3×PathBuffer (see test/js/bun/binary/tls-segment-size).
thread_local! {
    static RELATIVE_TO_COMMON_PATH_BUF: core::cell::Cell<*mut PathBuffer> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
    static RELATIVE_FROM_BUF: core::cell::Cell<*mut PathBuffer> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
    static RELATIVE_TO_BUF: core::cell::Cell<*mut PathBuffer> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
}

/// Lazily allocate (on first use) and borrow a thread-local `PathBuffer`. One
/// `unsafe` site for all `RELATIVE_*_BUF` accessors (nonnull-asref reduction:
/// 5 sites → 1).
#[inline]
fn lazy_path_buf(c: &core::cell::Cell<*mut PathBuffer>) -> &'static mut PathBuffer {
    let mut p = c.get();
    if p.is_null() {
        p = bun_core::heap::into_raw(Box::new(PathBuffer::ZEROED));
        c.set(p);
    }
    // SAFETY: `p` is non-null after the init branch above and points at a
    // leaked `Box<PathBuffer>` (process-lifetime heap allocation). The `Cell`
    // lives in a `thread_local!`, so this thread is the sole accessor; callers
    // uphold the single-live-borrow-per-thread invariant documented at the
    // thread-local declaration.
    unsafe { &mut *p }
}

/// Raw pointer into the thread-local scratch buffer. Callers reborrow
/// per-access — PORTING.md §Global mutable state. Valid until the next call on
/// this thread; do not hold across re-entry (matches Zig threadlocal-var
/// pointer semantics).
#[inline]
pub fn relative_to_common_path_buf() -> *mut PathBuffer {
    RELATIVE_TO_COMMON_PATH_BUF.with(lazy_path_buf)
}

/// Find a relative path from a common path
// Loosely based on Node.js' implementation of path.relative
// https://github.com/nodejs/node/blob/9a7cbe25de88d87429a69050a1a1971234558d97/lib/path.js#L1250-L1259
pub fn relative_to_common_path<'a, const ALWAYS_COPY: bool, P: PlatformT>(
    common_path_: &[u8],
    normalized_from_: &[u8],
    normalized_to_: &'a [u8],
    buf: &'a mut [u8],
) -> &'a [u8] {
    // TODO(port): return borrows either `buf` or `normalized_to_`; lifetime needs unification in Phase B
    let mut normalized_from = normalized_from_;
    let mut normalized_to = normalized_to_;
    let win_root_len: Option<usize> = if P::P == Platform::Windows {
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

    let separator = P::P.separator();

    let common_path = if P::P == Platform::Windows {
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
                if P::P == Platform::Windows
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

                let without_trailing_slash = if P::P == Platform::Windows
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

    let last_common_separator = strings::last_index_of_char_t(
        if P::P == Platform::Windows {
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
        let mut i: usize =
            (P::P.is_separator(normalized_from[0]) as usize) + 1 + last_common_separator;

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
            if P::P.is_separator(tail[0]) {
                tail = &tail[1..];
            }
        }

        // avoid making non-absolute paths absolute
        let insert_leading_slash =
            !P::P.is_separator(tail[0]) && out_len > 0 && !P::P.is_separator(buf[out_len - 1]);

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

pub fn relative_normalized_buf<'a, P: PlatformT, const ALWAYS_COPY: bool>(
    buf: &'a mut [u8],
    from: &'a [u8],
    to: &'a [u8],
) -> &'a [u8] {
    let equal = if P::P == Platform::Windows {
        strings::eql_case_insensitive_ascii(from, to, true)
    } else {
        from.len() == to.len() && strings::eql_long(from, to, false)
    };
    if equal {
        return b"";
    }

    let two: [&[u8]; 2] = [from, to];
    let common_path = longest_common_path_generic::<P>(&two);

    relative_to_common_path::<ALWAYS_COPY, P>(common_path, from, to, buf)
}

// PORT NOTE: result borrows either the thread-local common-path buf ('static)
// or `to` (when !ALWAYS_COPY and result==to). Return lifetime is `'a` (=to's),
// since 'static: 'a. Zig's "valid until next call" semantics still applies for
// the buf-backed case.
pub fn relative_normalized<'a, P: PlatformT, const ALWAYS_COPY: bool>(
    from: &'a [u8],
    to: &'a [u8],
) -> &'a [u8] {
    // SAFETY: thread-local scratch; single live borrow per thread.
    relative_normalized_buf::<P, ALWAYS_COPY>(
        RELATIVE_TO_COMMON_PATH_BUF.with(lazy_path_buf),
        from,
        to,
    )
}

pub fn dirname<P: PlatformT>(str: &[u8]) -> &[u8] {
    match P::P {
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
                return dirname::<P>(&str[..str.len() - 1]);
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

pub fn relative(from: &[u8], to: &[u8]) -> &'static [u8] {
    relative_platform::<platform::Auto, false>(from, to)
}

pub fn relative_z(from: &[u8], to: &[u8]) -> &'static ZStr {
    // SAFETY: thread-local scratch; single live borrow per thread.
    relative_buf_z(RELATIVE_TO_COMMON_PATH_BUF.with(lazy_path_buf), from, to)
}

pub fn relative_buf_z<'a>(buf: &'a mut [u8], from: &[u8], to: &[u8]) -> &'a ZStr {
    let rel = relative_platform_buf::<platform::Auto, true>(buf, from, to);
    let len = rel.len();
    // PORT NOTE: reshaped for borrowck — drop `rel` borrow before mutating buf
    buf[len] = 0;
    // SAFETY: buf[len] == 0 written above
    ZStr::from_buf(&buf[..], len)
}

pub fn relative_platform_buf<'a, P: PlatformT, const ALWAYS_COPY: bool>(
    buf: &'a mut [u8],
    from: &[u8],
    to: &[u8],
) -> &'a [u8] {
    // RELATIVE_FROM_BUF and RELATIVE_TO_BUF are independent allocations so the
    // two `&mut` borrows below are disjoint.
    let relative_from_buf = RELATIVE_FROM_BUF.with(lazy_path_buf);
    let relative_to_buf = RELATIVE_TO_BUF.with(lazy_path_buf);

    let normalized_from: &[u8] = if P::P.is_absolute(from) {
        'brk: {
            if P::P == Platform::Loose && cfg!(windows) {
                // we want to invoke the windows resolution behavior but end up with a
                // string with forward slashes.
                let normalized = normalize_string_buf::<true, platform::Windows, true>(
                    from,
                    &mut relative_from_buf[1..],
                );
                platform_to_posix_in_place::<u8>(normalized);
                break 'brk &*normalized;
            }
            // PORT NOTE: reshaped for borrowck — capture len, drop inner &mut, re-slice
            let path_len =
                normalize_string_buf::<true, P, true>(from, &mut relative_from_buf[1..]).len();
            if P::P == Platform::Windows {
                break 'brk &relative_from_buf[1..1 + path_len];
            }
            relative_from_buf[0] = P::P.separator();
            break 'brk &relative_from_buf[0..path_len + 1];
        }
    } else {
        // PORT NOTE: Zig aliased relative_from_buf as both input (normalize result)
        // and output (join target). Reshape: normalize into relative_to_buf scratch,
        // then join into relative_from_buf. Safe because normalized_to is computed
        // afterwards (overwrites relative_to_buf anyway).
        let norm_len = normalize_string_buf::<true, P, true>(from, &mut relative_to_buf[..]).len();
        join_abs_string_buf::<P>(
            Fs::FileSystem::instance().top_level_dir(),
            relative_from_buf,
            &[&relative_to_buf[..norm_len]],
        )
    };

    let normalized_to: &[u8] = if P::P.is_absolute(to) {
        'brk: {
            if P::P == Platform::Loose && cfg!(windows) {
                let normalized = normalize_string_buf::<true, platform::Windows, true>(
                    to,
                    &mut relative_to_buf[1..],
                );
                platform_to_posix_in_place::<u8>(normalized);
                break 'brk &*normalized;
            }
            // PORT NOTE: reshaped for borrowck — capture len, drop inner &mut, re-slice
            let path_len =
                normalize_string_buf::<true, P, true>(to, &mut relative_to_buf[1..]).len();
            if P::P == Platform::Windows {
                break 'brk &relative_to_buf[1..1 + path_len];
            }
            relative_to_buf[0] = P::P.separator();
            break 'brk &relative_to_buf[0..path_len + 1];
        }
    } else {
        // PORT NOTE: Zig aliased relative_to_buf as both input (normalize result)
        // and output (join target). Reshape: normalize into `buf` scratch (caller
        // output buffer, untouched until the final relative_normalized_buf call
        // and disjoint from both threadlocals), then join into relative_to_buf.
        let norm_len = normalize_string_buf::<true, P, true>(to, buf).len();
        join_abs_string_buf::<P>(
            Fs::FileSystem::instance().top_level_dir(),
            relative_to_buf,
            &[&buf[..norm_len]],
        )
    };

    relative_normalized_buf::<P, ALWAYS_COPY>(buf, normalized_from, normalized_to)
}

pub fn relative_platform<P: PlatformT, const ALWAYS_COPY: bool>(
    from: &[u8],
    to: &[u8],
) -> &'static [u8] {
    // SAFETY: thread-local scratch; single live borrow per thread.
    relative_platform_buf::<P, ALWAYS_COPY>(
        RELATIVE_TO_COMMON_PATH_BUF.with(lazy_path_buf),
        from,
        to,
    )
}

pub fn relative_alloc(from: &[u8], to: &[u8]) -> Result<Box<[u8]>, bun_alloc::AllocError> {
    let result = relative_platform::<platform::Auto, false>(from, to);
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
        if let Some(idx) = strings::index_of_any_t::<T>(&path[3..], T::lit(b"/\\")) {
            // TODO: handle input "//abc//def" should be picked up as a unc path
            if path.len() > idx + 4 && !Platform::Windows.is_separator_t::<T>(path[idx + 4]) {
                if let Some(idx2) = strings::index_of_any_t::<T>(&path[idx + 4..], T::lit(b"/\\")) {
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
    if path.is_empty() {
        return &path[..0];
    }
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
        if let Some(idx) = strings::index_of_any_t::<T>(&path[3..], T::lit(b"/\\")) {
            if let Some(idx_second) = strings::index_of_any_t::<T>(&path[4 + idx..], T::lit(b"/\\"))
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
    'a,
    const ALLOW_ABOVE_ROOT: bool,
    const SEPARATOR: u8,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    path_: &[u8],
    buf: &'a mut [u8],
    is_separator: impl Fn(u8) -> bool + Copy,
) -> &'a mut [u8] {
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
    'a,
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    path_: &[T],
    buf: &'a mut [T],
    separator: T,
    is_separator_t: impl Fn(T) -> bool + Copy,
) -> &'a mut [T] {
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
    'a,
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
    const ZERO_TERMINATE: bool,
    const ADD_NT_PREFIX: bool,
>(
    path_: &[T],
    buf: &'a mut [T],
    separator: T,
    is_separator: impl Fn(T) -> bool + Copy,
) -> &'a mut [T] {
    let is_windows = separator == T::from_u8(SEP_WINDOWS);
    // sep_str: single-char slice [separator]
    // PERF(port): Zig built `sep_str` at comptime; we build per-call.

    if is_windows && cfg!(debug_assertions) {
        // this is here to catch a potential mistake by the caller
        //
        // since it is theoretically possible to get here in release
        // we will not do this check in release.
        debug_assert!(!strings::has_prefix_t::<T>(path_, T::lit(b":\\")));
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
                buf[buf_i..buf_i + 4].copy_from_slice(T::lit(b"\\??\\"));
                buf_i += 4;
            }
            if path_[1] != T::from_u8(b':') {
                // UNC paths
                if ADD_NT_PREFIX {
                    // "UNC" ++ sep_str
                    buf[buf_i..buf_i + 3].copy_from_slice(T::lit(b"UNC"));
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
        debug_assert!(!strings::has_prefix_t::<T>(result, T::lit(b"\\:\\")));
    }

    result
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, core::marker::ConstParamTy)]
pub enum Platform {
    Loose,
    Windows,
    Posix,
    Nt,
}

// PORT NOTE: Zig used `comptime _platform: Platform` const-generics. Nightly
// `adt_const_params` is now enabled crate-wide (see lib.rs), so `Platform`
// derives `ConstParamTy` and `<const PLATFORM: Platform>` is the preferred
// form for new code. The `PlatformT` sealed-trait shim below is kept for
// existing call sites that haven't been migrated yet — both monomorphize
// identically (`P::P` is a true `const Platform`).
mod sealed {
    pub trait Sealed {}
}
pub trait PlatformT: Copy + sealed::Sealed + 'static {
    const P: Platform;
}
macro_rules! platform_variant {
    ($name:ident => $variant:ident) => {
        #[derive(Copy, Clone)]
        pub struct $name;
        impl sealed::Sealed for $name {}
        impl PlatformT for $name {
            const P: Platform = Platform::$variant;
        }
    };
}
pub mod platform {
    use super::*;
    platform_variant!(Loose   => Loose);
    platform_variant!(Windows => Windows);
    platform_variant!(Posix   => Posix);
    platform_variant!(Nt      => Nt);
    #[cfg(windows)]
    pub type Auto = Windows;
    #[cfg(unix)]
    pub type Auto = Posix;
    #[cfg(all(not(windows), not(unix)))]
    pub type Auto = Loose;
}

impl Platform {
    // Match the `platform::Auto` type alias above: pick by `windows`/`unix`/else
    // rather than enumerating OSes, so a new POSIX target (e.g. Android) doesn't
    // silently leave `Platform::AUTO` undefined.
    #[cfg(windows)]
    pub const AUTO: Platform = Platform::Windows;
    #[cfg(unix)]
    pub const AUTO: Platform = Platform::Posix;
    #[cfg(all(not(windows), not(unix)))]
    pub const AUTO: Platform = Platform::Loose;

    pub fn is_absolute(self, path: &[u8]) -> bool {
        self.is_absolute_t::<u8>(path)
    }

    // PORT NOTE: dropped `const` — PathChar trait methods aren't const-callable
    // on stable. Zig's `comptime` here was for monomorphization, not const-eval.
    pub fn is_absolute_t<T: PathChar>(self, path: &[T]) -> bool {
        match self {
            Platform::Posix => !path.is_empty() && path[0] == T::from_u8(b'/'),
            Platform::Nt | Platform::Windows | Platform::Loose => {
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

    #[inline(always)]
    pub fn is_separator(self, char: u8) -> bool {
        self.is_separator_t::<u8>(char)
    }

    #[inline(always)]
    pub fn is_separator_t<T: PathChar>(self, char: T) -> bool {
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

pub fn normalize_string<const ALLOW_ABOVE_ROOT: bool, P: PlatformT>(str: &[u8]) -> &mut [u8] {
    // PORT NOTE: returns slice into thread-local PARSER_BUFFER; valid until the
    // next call on this thread (Zig threadlocal-var semantics).
    PARSER_BUFFER.with(|b| normalize_string_buf::<ALLOW_ABOVE_ROOT, P, false>(str, tl_buf_mut(b)))
}

pub fn normalize_string_z<const ALLOW_ABOVE_ROOT: bool, P: PlatformT>(str: &[u8]) -> &mut ZStr {
    PARSER_BUFFER.with(|b| {
        let buf = tl_buf_mut(b);
        let normalized = normalize_string_buf::<ALLOW_ABOVE_ROOT, P, false>(str, buf);
        let len = normalized.len();
        buf[len] = 0;
        // SAFETY: buf[len] == 0 written above
        unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) }
    })
}

pub fn normalize_buf<'a, P: PlatformT>(str: &[u8], buf: &'a mut [u8]) -> &'a mut [u8] {
    normalize_buf_t::<u8, P>(str, buf)
}

pub fn normalize_buf_z<'a, P: PlatformT>(str: &[u8], buf: &'a mut [u8]) -> &'a mut ZStr {
    let norm = normalize_buf_t::<u8, P>(str, buf);
    let len = norm.len();
    buf[len] = 0;
    // SAFETY: buf[len] == 0 written above
    unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) }
}

pub fn normalize_buf_t<'a, T: PathChar, P: PlatformT>(str: &[T], buf: &'a mut [T]) -> &'a mut [T] {
    if str.is_empty() {
        buf[0] = T::from_u8(b'.');
        return &mut buf[0..1];
    }

    let is_absolute = P::P.is_absolute_t::<T>(str);

    // TODO(port): platform.getLastSeparatorFuncT()(T, str) — dispatched manually
    let trailing_separator = match P::P {
        Platform::Loose => last_index_of_separator_loose_t::<T>(str),
        Platform::Nt | Platform::Windows => last_index_of_separator_windows_t::<T>(str),
        Platform::Posix => last_index_of_separator_posix_t::<T>(str),
    } == Some(str.len() - 1);

    if is_absolute && trailing_separator {
        return normalize_string_buf_t::<T, true, P, true>(str, buf);
    }
    if is_absolute && !trailing_separator {
        return normalize_string_buf_t::<T, true, P, false>(str, buf);
    }
    if !is_absolute && !trailing_separator {
        return normalize_string_buf_t::<T, false, P, false>(str, buf);
    }
    normalize_string_buf_t::<T, false, P, true>(str, buf)
}

pub fn normalize_string_buf<
    'a,
    const ALLOW_ABOVE_ROOT: bool,
    P: PlatformT,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[u8],
    buf: &'a mut [u8],
) -> &'a mut [u8] {
    normalize_string_buf_t::<u8, ALLOW_ABOVE_ROOT, P, PRESERVE_TRAILING_SLASH>(str, buf)
}

pub fn normalize_string_buf_t<
    'a,
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    P: PlatformT,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[T],
    buf: &'a mut [T],
) -> &'a mut [T] {
    match P::P {
        Platform::Nt => unreachable!("not implemented"),
        Platform::Windows => {
            normalize_string_windows_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
        }
        Platform::Posix => {
            normalize_string_loose_buf_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
        }
        Platform::Loose => {
            normalize_string_loose_buf_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
        }
    }
}

pub fn normalize_string_alloc<const ALLOW_ABOVE_ROOT: bool, P: PlatformT>(
    str: &[u8],
) -> Result<Box<[u8]>, bun_alloc::AllocError> {
    Ok(Box::<[u8]>::from(
        &*normalize_string::<ALLOW_ABOVE_ROOT, P>(str),
    ))
}

pub fn join_abs2<P: PlatformT>(
    cwd: &[u8],
    part: impl AsRef<[u8]>,
    part2: impl AsRef<[u8]>,
) -> &[u8] {
    let parts: [&[u8]; 2] = [part.as_ref(), part2.as_ref()];
    join_abs_string::<P>(cwd, &parts)
}

pub fn join_abs<'a, P: PlatformT>(cwd: &'a [u8], part: &[u8]) -> &'a [u8] {
    join_abs_string::<P>(cwd, &[part])
}

/// Convert parts of potentially invalid file paths into a single valid filpeath
/// without querying the filesystem
/// This is the equivalent of path.resolve
///
/// Returned path is stored in a temporary buffer. It must be copied if it needs to be stored.
// PORT NOTE: result borrows the thread-local buffer ('static) OR returns `cwd`
// directly when `parts.is_empty()`. Return tied to `cwd`'s lifetime ('static: 'a).
pub fn join_abs_string<'a, P: PlatformT>(cwd: &'a [u8], parts: &[&[u8]]) -> &'a [u8] {
    PARSER_JOIN_INPUT_BUFFER.with(|b| join_abs_string_buf::<P>(cwd, tl_buf_mut(b), parts))
}

/// Convert parts of potentially invalid file paths into a single valid filpeath
/// without querying the filesystem
/// This is the equivalent of path.resolve
///
/// Returned path is stored in a temporary buffer. It must be copied if it needs to be stored.
pub fn join_abs_string_z<'a, P: PlatformT>(cwd: &'a [u8], parts: &[&[u8]]) -> &'a ZStr {
    PARSER_JOIN_INPUT_BUFFER.with(|b| join_abs_string_buf_z::<P>(cwd, tl_buf_mut(b), parts))
}

thread_local! {
    pub static JOIN_BUF: UnsafeCell<[u8; 4096]> = const { UnsafeCell::new([0u8; 4096]) };
}

pub fn join<P: PlatformT>(parts: &[&[u8]]) -> &'static [u8] {
    JOIN_BUF.with(|b| join_string_buf::<P>(tl_buf_mut(b), parts))
}

pub fn join_z<P: PlatformT>(parts: &[&[u8]]) -> &'static ZStr {
    JOIN_BUF.with(|b| join_z_buf::<P>(tl_buf_mut(b), parts))
}

pub fn join_z_buf<'a, P: PlatformT>(buf: &'a mut [u8], parts: &[&[u8]]) -> &'a ZStr {
    // PORT NOTE: reshaped for borrowck — capture buf base ptr before sub-borrow
    let buf_base = buf.as_mut_ptr();
    let buf_len = buf.len();
    let (start_offset, len) = {
        let joined = join_string_buf::<P>(&mut buf[..buf_len - 1], parts);
        (
            (joined.as_ptr() as usize) - (buf_base as usize),
            joined.len(),
        )
    };
    debug_assert!(start_offset + len < buf_len);
    buf[start_offset + len] = 0;
    // SAFETY: NUL written at buf[start_offset + len]; slice is within buf
    unsafe { ZStr::from_raw(buf_base.add(start_offset), len) }
}

pub fn join_string_buf<'a, P: PlatformT>(buf: &'a mut [u8], parts: &[&[u8]]) -> &'a [u8] {
    join_string_buf_t::<u8, P>(buf, parts)
}

pub fn join_string_buf_w<'a, P: PlatformT>(buf: &'a mut [u16], parts: &[&[u8]]) -> &'a [u16] {
    // TODO(port): Zig `parts: anytype` allowed mixed u8/u16 elements; we accept
    // &[&[u8]] and transcode below to match the common callsite.
    join_string_buf_t::<u16, P>(buf, parts)
}

/// `joinStringBufW` overload for u16 parts (no transcode). Covers the
/// `T == u16 && Elem == u16` arm of Zig's `joinStringBufT` `anytype` dispatch.
pub fn join_string_buf_w_same<'a, P: PlatformT>(buf: &'a mut [u16], parts: &[&[u16]]) -> &'a [u16] {
    join_string_buf_t_same::<u16, P>(buf, parts)
}

/// Same-width `joinStringBufT`: parts already match `T`, so no UTF-8→16 transcode.
/// PORT NOTE: split out of `join_string_buf_t` because Rust can't monomorphize on
/// `parts: anytype` element types like Zig — callers pick the overload.
pub fn join_string_buf_t_same<'a, T: PathChar, P: PlatformT>(
    buf: &'a mut [T],
    parts: &[&[T]],
) -> &'a [T] {
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
            temp_buf[written] = T::from_u8(P::P.separator());
            written += 1;
        }

        temp_buf[written..written + part.len()].copy_from_slice(part);
        written += part.len();
    }

    if written == 0 {
        buf[0] = T::from_u8(b'.');
        return &buf[0..1];
    }

    normalize_string_node_t::<T, P>(&temp_buf[0..written], buf)
}

pub fn join_string_buf_wz<'a, P: PlatformT>(buf: &'a mut [u16], parts: &[&[u8]]) -> &'a WStr {
    // PORT NOTE: reshaped for borrowck — capture buf base ptr before sub-borrow
    let buf_base = buf.as_mut_ptr();
    let buf_len = buf.len();
    let (start_offset, len) = {
        let joined = join_string_buf_t::<u16, P>(&mut buf[..buf_len - 1], parts);
        (
            (joined.as_ptr() as usize - buf_base as usize) / 2,
            joined.len(),
        )
    };
    debug_assert!(start_offset + len < buf_len);
    buf[start_offset + len] = 0;
    // SAFETY: NUL written at buf[start_offset + len]; slice is within buf
    unsafe { WStr::from_raw(buf_base.add(start_offset), len) }
}

pub fn join_string_buf_z<'a, P: PlatformT>(buf: &'a mut [u8], parts: &[&[u8]]) -> &'a ZStr {
    // PORT NOTE: reshaped for borrowck — capture buf base ptr before sub-borrow
    let buf_base = buf.as_mut_ptr();
    let buf_len = buf.len();
    let (start_offset, len) = {
        let joined = join_string_buf_t::<u8, P>(&mut buf[..buf_len - 1], parts);
        (
            (joined.as_ptr() as usize) - (buf_base as usize),
            joined.len(),
        )
    };
    debug_assert!(start_offset + len < buf_len);
    buf[start_offset + len] = 0;
    // SAFETY: NUL written at buf[start_offset + len]; slice is within buf
    unsafe { ZStr::from_raw(buf_base.add(start_offset), len) }
}

pub fn join_string_buf_t<'a, T: PathChar, P: PlatformT>(
    buf: &'a mut [T],
    parts: &[&[u8]],
) -> &'a [T] {
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
            temp_buf[written] = T::from_u8(P::P.separator());
            written += 1;
        }

        // TODO(port): Zig inspected std.meta.Elem(@TypeOf(part)); we always
        // receive u8 parts, so transcode iff T == u16.
        written += T::write_u8_part(&mut temp_buf[written..], part);
    }

    if written == 0 {
        buf[0] = T::from_u8(b'.');
        return &buf[0..1];
    }

    normalize_string_node_t::<T, P>(&temp_buf[0..written], buf)
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
    pub(crate) fn init(base: usize, parts: &[&[u8]]) -> Self {
        let mut total = base + 2;
        for p in parts {
            total += p.len() + 1;
        }
        Self {
            buf: vec![0u8; total],
        }
    }
}

pub fn join_abs_string_buf<'a, P: PlatformT>(
    cwd: &'a [u8],
    buf: &'a mut [u8],
    parts: &[&[u8]],
) -> &'a [u8] {
    _join_abs_string_buf::<false, P>(cwd, buf, parts)
}

/// Like `join_abs_string_buf`, but returns null when the *normalized* result is
/// too large for `buf`. Use this when `parts` may contain user-controlled
/// input of arbitrary length. `..` segments are handled correctly: a path
/// whose unnormalized length exceeds `buf.len` but normalizes down will still
/// succeed.
pub fn join_abs_string_buf_checked<'a, P: PlatformT>(
    cwd: &'a [u8],
    buf: &'a mut [u8],
    parts: &[&[u8]],
) -> Option<&'a [u8]> {
    debug_assert!(!matches!(P::P, Platform::Nt));
    // Fast path: size check only — don't allocate a JoinScratch here since the
    // inner join_abs_string_buf already has its own (avoids doubling stack usage).
    let mut total: usize = cwd.len() + 2;
    for p in parts {
        total += p.len() + 1;
    }
    if total < buf.len() {
        return Some(join_abs_string_buf::<P>(cwd, buf, parts));
    }

    // Slow path: allocate a large scratch for the result. The inner
    // join_abs_string_buf will heap-allocate its own temp buffer for the concat
    // since `total > MAX_PATH_BYTES * 2 > sfa inline size` is likely here.
    // PERF(port): was stack-fallback alloc — profile in Phase B
    let mut scratch = vec![0u8; total];
    let joined = join_abs_string_buf::<P>(cwd, &mut scratch, parts);
    if joined.len() > buf.len() {
        return None;
    }
    let len = joined.len();
    buf[..len].copy_from_slice(joined);
    Some(&buf[..len])
}

pub fn join_abs_string_buf_z<'a, P: PlatformT>(
    cwd: &'a [u8],
    buf: &'a mut [u8],
    parts: &[&[u8]],
) -> &'a ZStr {
    let r = _join_abs_string_buf::<true, P>(cwd, buf, parts);
    // SAFETY: IS_SENTINEL=true wrote NUL at r.len()
    unsafe { ZStr::from_raw(r.as_ptr(), r.len()) }
}

pub fn join_abs_string_buf_znt<'a, P: PlatformT>(
    cwd: &'a [u8],
    buf: &'a mut [u8],
    parts: &[&[u8]],
) -> &'a ZStr {
    if (matches!(P::P, Platform::AUTO | Platform::Loose | Platform::Windows)) && cfg!(windows) {
        let r = _join_abs_string_buf::<true, platform::Nt>(cwd, buf, parts);
        // SAFETY: NUL written at r.len()
        return unsafe { ZStr::from_raw(r.as_ptr(), r.len()) };
    }

    let r = _join_abs_string_buf::<true, P>(cwd, buf, parts);
    // SAFETY: NUL written at r.len()
    unsafe { ZStr::from_raw(r.as_ptr(), r.len()) }
}

pub fn join_abs_string_buf_z_trailing_slash<'a, P: PlatformT>(
    cwd: &'a [u8],
    buf: &'a mut [u8],
    parts: &[&[u8]],
) -> &'a ZStr {
    // PORT NOTE: capture last byte of `out` before dropping the borrow so we
    // compare the actual result, not whatever happens to be in buf[out_len-1]
    // (matters if a fast-path ever returns a non-buf[0]-anchored slice).
    let (out_len, out_last) = {
        let out = _join_abs_string_buf::<true, P>(cwd, buf, parts);
        (out.len(), out.last().copied())
    };
    if out_len + 2 < buf.len() && out_len > 0 && out_last != Some(P::P.separator()) {
        buf[out_len] = P::P.separator();
        buf[out_len + 1] = 0;
        // SAFETY: NUL written at out_len + 1
        return ZStr::from_buf(&buf[..], out_len + 1);
    }

    // SAFETY: NUL written at out_len by _join_abs_string_buf::<true, _>
    ZStr::from_buf(&buf[..], out_len)
}

// TODO(port): Zig used `comptime ReturnType: type` to vary `[:0]const u8` vs
// `[]const u8`. We always return `&[u8]`; when `IS_SENTINEL` a NUL is written
// at `result.len()` and callers re-wrap as `ZStr`.
fn _join_abs_string_buf<'a, const IS_SENTINEL: bool, P: PlatformT>(
    _cwd: &'a [u8],
    buf: &'a mut [u8],
    _parts: &[&[u8]],
) -> &'a [u8] {
    if P::P == Platform::Windows || (cfg!(windows) && P::P == Platform::Loose) {
        return _join_abs_string_buf_windows::<IS_SENTINEL>(_cwd, buf, _parts);
    }

    if P::P == Platform::Nt {
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

    if matches!(P::P, Platform::Loose | Platform::Posix)
        && parts.len() == 1
        && parts[0].len() == 1
        && parts[0][0] == SEP_POSIX
    {
        // PORT NOTE: Zig returned the literal `"/"` (`[:0]const u8` — NUL-backed).
        // Rust `b"/"` is NOT NUL-terminated and not in `buf`, breaking callers
        // that assume buf-backing (`ZStr::from_raw`, trailing-slash check).
        // Write into `buf` so the result is always buf-backed and sentinel-safe.
        buf[0] = b'/';
        if IS_SENTINEL {
            buf[1] = 0;
        }
        return &buf[0..1];
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
            if P::P.is_absolute(parts[part_i as usize]) {
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

        if out > 0 && temp_buf[out - 1] != P::P.separator() {
            temp_buf[out] = P::P.separator();
            out += 1;
        }

        temp_buf[out..out + part.len()].copy_from_slice(part);
        out += part.len();
    }

    // PORT NOTE: reshaped for borrowck — stash leading separator into a local
    // [u8; 8] (max len: NT prefix `\\?\` = 4) so we don't hold a borrow into
    // temp_buf across the normalize call below.
    let mut leading_buf = [0u8; 8];
    let leading_len: usize = if let Some(i) = P::P.leading_separator_index::<u8>(&temp_buf[0..out])
    {
        let outdir = &mut temp_buf[0..i + 1];
        if P::P == Platform::Loose {
            slashes_to_posix_in_place(outdir);
        }
        leading_buf[..i + 1].copy_from_slice(&temp_buf[0..i + 1]);
        i + 1
    } else {
        leading_buf[0] = b'/';
        1
    };
    // Copy leading separator into buf (Zig does this after normalize; order-
    // independent since normalize writes into buf[leading_len..]).
    buf[..leading_len].copy_from_slice(&leading_buf[..leading_len]);

    let result = normalize_string_buf::<false, P, true>(
        &temp_buf[leading_len..out],
        &mut buf[leading_len..],
    );
    let result_len = result.len();

    if IS_SENTINEL {
        buf[result_len + leading_len] = 0;
    }
    &buf[0..result_len + leading_len]
}

fn _join_abs_string_buf_windows<'a, const IS_SENTINEL: bool>(
    cwd: &'a [u8],
    buf: &'a mut [u8],
    parts: &[&[u8]],
) -> &'a [u8] {
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

    let result = normalize_string_buf::<false, platform::Windows, true>(&temp_buf[0..out], buf);
    let result_len = result.len();

    if IS_SENTINEL {
        buf[result_len] = 0;
    }
    &buf[0..result_len]
}

// Separator predicates live in T0 `bun_core::path_sep`; re-export the full set
// so existing `bun_paths::is_sep_*` callers are unchanged.
pub use bun_core::path_sep::{
    is_sep_any, is_sep_any_t, is_sep_native, is_sep_native_t, is_sep_posix_t, is_sep_win32_t,
};
#[inline(always)]
pub fn is_sep_posix(c: u8) -> bool {
    is_sep_posix_t::<u8>(c)
}
#[inline(always)]
pub fn is_sep_win32(c: u8) -> bool {
    is_sep_win32_t::<u8>(c)
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
            return Some(u32::try_from(i).expect("int cast"));
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
    'a,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[u8],
    buf: &'a mut [u8],
) -> &'a mut [u8] {
    normalize_string_loose_buf_t::<u8, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
}

pub fn normalize_string_loose_buf_t<
    'a,
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[T],
    buf: &'a mut [T],
) -> &'a mut [T] {
    normalize_string_generic_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(
        str,
        buf,
        T::from_u8(SEP_POSIX),
        is_sep_any_t::<T>,
    )
}

pub fn normalize_string_windows<
    'a,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[u8],
    buf: &'a mut [u8],
) -> &'a mut [u8] {
    normalize_string_windows_t::<u8, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(str, buf)
}

pub fn normalize_string_windows_t<
    'a,
    T: PathChar,
    const ALLOW_ABOVE_ROOT: bool,
    const PRESERVE_TRAILING_SLASH: bool,
>(
    str: &[T],
    buf: &'a mut [T],
) -> &'a mut [T] {
    normalize_string_generic_t::<T, ALLOW_ABOVE_ROOT, PRESERVE_TRAILING_SLASH>(
        str,
        buf,
        T::from_u8(SEP_WINDOWS),
        is_sep_any_t::<T>,
    )
}

pub fn normalize_string_node<'a, P: PlatformT>(str: &[u8], buf: &'a mut [u8]) -> &'a mut [u8] {
    normalize_string_node_t::<u8, P>(str, buf)
}

pub fn normalize_string_node_t<'a, T: PathChar, P: PlatformT>(
    str: &[T],
    buf: &'a mut [T],
) -> &'a mut [T] {
    if str.is_empty() {
        buf[0] = T::from_u8(b'.');
        return &mut buf[0..1];
    }

    let is_absolute = P::P.is_absolute_t::<T>(str);
    let trailing_separator = P::P.is_separator_t::<T>(str[str.len() - 1]);

    // `normalize_string_generic` handles absolute path cases for windows
    // we should not prefix with /
    // PORT NOTE: reshaped for borrowck — track an offset instead of reslicing.
    let buf_off: usize = if P::P == Platform::Windows { 0 } else { 1 };

    let separator_t = T::from_u8(P::P.separator());
    let is_sep_fn = |c: T| P::P.is_separator_t::<T>(c);

    let out_len = if !is_absolute {
        normalize_string_generic_t::<T, true, false>(
            str,
            &mut buf[buf_off..],
            separator_t,
            is_sep_fn,
        )
        .len()
    } else {
        normalize_string_generic_t::<T, false, false>(
            str,
            &mut buf[buf_off..],
            separator_t,
            is_sep_fn,
        )
        .len()
    };
    let mut out_len = out_len;

    if out_len == 0 {
        if is_absolute {
            buf[0] = separator_t;
            return &mut buf[0..1];
        }

        if trailing_separator {
            let sep = P::P.trailing_separator();
            buf[0] = T::from_u8(sep[0]);
            buf[1] = T::from_u8(sep[1]);
            return &mut buf[0..2];
        }

        buf[0] = T::from_u8(b'.');
        return &mut buf[0..1];
    }

    if trailing_separator {
        if !P::P.is_separator_t::<T>(buf[buf_off + out_len - 1]) {
            buf[buf_off + out_len] = separator_t;
            out_len += 1;
        }
    }

    if is_absolute {
        if P::P == Platform::Windows {
            return &mut buf[buf_off..buf_off + out_len];
        }
        buf[0] = separator_t;
        return &mut buf[0..out_len + 1];
    }

    &mut buf[buf_off..buf_off + out_len]
}

/// Port of `resolve_path.zig:basename` — **NOT** `std.fs.path.basename` (see
/// [`crate::basename`] for that). Differs in two load-bearing ways: treats
/// `\` as a separator on all platforms (`is_sep_any`), and returns `b"/"`
/// (not `b""`) when the input is all separators. Shell builtins
/// (`basename`/`mv`/`cp`) rely on both for POSIX-shell-correct `basename /`.
/// Do not dedup against `crate::basename`.
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
            Self {
                _raw_bytes: PathBuffer::uninit(),
            }
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
    pub fn resolve_z<'a>(&'a mut self, source_dir: &[u8], maybe_posix_path: &'a ZStr) -> &'a ZStr {
        Self::resolve_with_external_buf_z(&mut self._raw_bytes, source_dir, maybe_posix_path)
    }

    #[inline]
    pub fn resolve_cwd<'a>(
        &'a mut self,
        maybe_posix_path: &'a [u8],
    ) -> Result<&'a [u8], bun_core::Error> {
        Self::resolve_cwd_with_external_buf(&mut self._raw_bytes, maybe_posix_path)
    }

    #[cfg(windows)]
    #[inline]
    pub fn resolve_cwd_z<'a>(
        &'a mut self,
        maybe_posix_path: &'a [u8],
    ) -> Result<&'a mut ZStr, bun_core::Error> {
        Self::resolve_cwd_with_external_buf_z(&mut self._raw_bytes, maybe_posix_path)
    }
    // TODO(b2-windows): on posix `_raw_bytes` is `()`; the Zig version still
    // null-terminates into a buffer. Callers on posix should use
    // `resolve_cwd_with_external_buf_z` with an explicit PathBuffer.

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
                    debug_assert!(
                        !strings::is_windows_absolute_path_missing_drive_letter::<u8>(res)
                    );
                    debug_assert!(crate::is_absolute_windows(res));
                    return res;
                }
            }
            debug_assert!(
                !strings::is_windows_absolute_path_missing_drive_letter::<u8>(maybe_posix_path)
            );
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
                    let res = ZStr::from_buf(&buf[..], len);
                    debug_assert!(
                        !strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                            res.as_bytes()
                        )
                    );
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
                    // PORT NOTE: reshaped for borrowck — `getcwd` writes into
                    // `buf` and returns a borrow of it; capture the lengths we
                    // need, drop the borrow, then re-slice `buf`.
                    let sr_len = {
                        let cwd = bun_core::getcwd(buf)?;
                        windows_filesystem_root(cwd.as_bytes()).len()
                    };
                    buf[sr_len..sr_len + maybe_posix_path.len() - 1]
                        .copy_from_slice(&maybe_posix_path[1..]);
                    let res = &buf[0..sr_len + maybe_posix_path.len() - 1];
                    debug_assert!(
                        !strings::is_windows_absolute_path_missing_drive_letter::<u8>(res)
                    );
                    debug_assert!(crate::is_absolute_windows(res));
                    return Ok(res);
                }
            }
            debug_assert!(
                !strings::is_windows_absolute_path_missing_drive_letter::<u8>(maybe_posix_path)
            );
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
                    // PORT NOTE: reshaped for borrowck — see resolve_cwd above.
                    let sr_len = {
                        let cwd = bun_core::getcwd(buf)?;
                        windows_filesystem_root(cwd.as_bytes()).len()
                    };
                    buf[sr_len..sr_len + maybe_posix_path.len() - 1]
                        .copy_from_slice(&maybe_posix_path[1..]);
                    buf[sr_len + maybe_posix_path.len() - 1] = 0;
                    let len = sr_len + maybe_posix_path.len() - 1;
                    // SAFETY: NUL at buf[len]
                    let res = unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) };
                    debug_assert!(
                        !strings::is_windows_absolute_path_missing_drive_letter::<u8>(
                            res.as_bytes()
                        )
                    );
                    debug_assert!(crate::is_absolute_windows(res.as_bytes()));
                    return Ok(res);
                }
            }
            debug_assert!(
                !strings::is_windows_absolute_path_missing_drive_letter::<u8>(maybe_posix_path)
            );
        }

        buf[..maybe_posix_path.len()].copy_from_slice(maybe_posix_path);
        buf[maybe_posix_path.len()] = 0;
        // SAFETY: NUL at buf[maybe_posix_path.len()]
        Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), maybe_posix_path.len()) })
    }
}

// ResolvePath__joinAbsStringBufCurrentPlatformBunString: see src/jsc/resolve_path_jsc.zig
// (reaches into the VM for cwd; paths/ is JSC-free).

// ─────────────────────────────────────────────────────────────────────────────
// In-place separator rewrites.
//
// `slashes_to_{posix,windows}_in_place` are the two PRIMITIVES — unconditional,
// no host-OS gating, no drive-letter touch. They are the Rust analogue of Zig's
// `std.mem.replaceScalar(T, buf, '\\', '/')` (and inverse), which is what Zig
// callers handroll at the sites this dedup targets.
//
// The four pre-existing public fns below are now thin wrappers over the
// primitives so that Zig grep-parity (`platformToPosixInPlace`,
// `dangerouslyConvertPathTo{Posix,Windows}InPlace`, `posixToPlatformInPlace`)
// is preserved without a fourth/fifth copy of the loop body.
//
// Encoding safety: both 0x2F ('/') and 0x5C ('\\') are single-unit ASCII in
// UTF-8 and UTF-16 and never appear as a sub-unit of a multi-unit sequence, so
// a scalar replace is sound for `u8` and `u16` alike.
// ─────────────────────────────────────────────────────────────────────────────

/// Unconditional `'\\' → '/'` in place. No host-OS gate, no drive-letter touch.
#[inline]
pub fn slashes_to_posix_in_place<T: PathChar>(path: &mut [T]) {
    let bslash = T::from_u8(b'\\');
    let fslash = T::from_u8(b'/');
    for c in path.iter_mut() {
        if *c == bslash {
            *c = fslash;
        }
    }
}

/// Unconditional `'/' → '\\'` in place. No host-OS gate.
#[inline]
pub fn slashes_to_windows_in_place<T: PathChar>(path: &mut [T]) {
    let fslash = T::from_u8(b'/');
    let bslash = T::from_u8(b'\\');
    for c in path.iter_mut() {
        if *c == fslash {
            *c = bslash;
        }
    }
}

#[inline]
pub fn platform_to_posix_in_place<T: PathChar>(path_buffer: &mut [T]) {
    if SEP == b'/' {
        return;
    }
    slashes_to_posix_in_place(path_buffer);
}

pub fn dangerously_convert_path_to_posix_in_place<T: PathChar>(path: &mut [T]) {
    #[cfg(windows)]
    {
        if path.len() > 2
            && is_drive_letter_t::<T>(path[0])
            && path[1] == T::from_u8(b':')
            && is_sep_any_t::<T>(path[2])
        {
            // Uppercase drive letter (is_drive_letter_t guarantees [A-Za-z]).
            path[0] = T::to_ascii_upper(path[0]);
        }
    }
    slashes_to_posix_in_place(path);
}

#[inline]
pub fn dangerously_convert_path_to_windows_in_place<T: PathChar>(path: &mut [T]) {
    slashes_to_windows_in_place(path);
}

pub fn path_to_posix_buf<'a, T: PathChar>(path: &[T], buf: &'a mut [T]) -> &'a mut [T] {
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

#[inline]
pub fn posix_to_platform_in_place<T: PathChar>(path_buffer: &mut [T]) {
    if SEP == b'/' {
        return;
    }
    slashes_to_windows_in_place(path_buffer);
}

// `PathChar` is now canonical at `crate::path_char`; re-export for callers
// that still path through `resolve_path::PathChar`.
pub use crate::PathChar;

// ported from: src/paths/resolve_path.zig
