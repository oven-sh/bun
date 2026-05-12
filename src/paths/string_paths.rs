//! `bun.strings.paths` — Windows path-shape transcoders (`toNTPath`,
//! `toKernel32Path`, `fromWPath`, …). Hosted in `bun_paths` (not
//! `bun_core::string::immutable`) because it depends on this crate's
//! `resolve_path`/`path_buffer_pool`/`Platform` and would cycle if it lived
//! in `bun_core`. Re-exported as `crate::strings::*` so existing
//! `bun_core::strings::paths::*` callers (rewritten to `crate::strings`)
//! resolve unchanged.

use crate::PathChar;
use crate::resolve_path;
use crate::windows;
use bun_core::string::immutable as strings;
use bun_core::{WStr, ZStr};

// Generic code-unit bound for fns that operate over both u8 and u16 paths.
// Zig used `comptime T: type`; bound on `crate::PathChar` (provides
// `from_u8`/`IS_U16`) plus `Into<u32>` + `NoUninit` for `strings::contains_char_t`.
pub trait Ch: PathChar + Into<u32> + bun_core::NoUninit {}
impl Ch for u8 {}
impl Ch for u16 {}

/// Borrow `wbuf[..len]` as a `&WStr`, where `wbuf[len] == 0`. Safe-surface
/// form of [`WStr::from_raw`] for the dominant call shape in this module: a
/// stack `WPathBuffer` filled to `len` with a NUL written at `wbuf[len]`.
/// The slice borrow proves `wbuf[..=len]` lies in one allocation and ties the
/// returned lifetime to it; the NUL is debug-asserted (release relies on the
/// caller upholding the documented `wbuf[len] == 0` precondition — same
/// contract as Zig `[:0]const u16` slicing). Mirrors [`ZStr::from_buf`].
#[inline(always)]
pub(crate) fn wstr_in_buf(wbuf: &[u16], len: usize) -> &WStr {
    WStr::from_buf(wbuf, len)
}

#[inline(always)]
fn ch<T: Ch>(c: u8) -> T {
    T::from_u8(c)
}

/// Local helper: `has_prefix_ascii_t` — compare `&[T]` against an ASCII `&[u8]`
/// literal by widening each prefix byte via `T::from_u8`.
#[inline]
fn has_prefix_ascii_t<T: Ch>(s: &[T], prefix: &[u8]) -> bool {
    if s.len() < prefix.len() {
        return false;
    }
    for (i, &b) in prefix.iter().enumerate() {
        if s[i] != T::from_u8(b) {
            return false;
        }
    }
    true
}

/// Checks if a path is missing a windows drive letter. For windows APIs,
/// this is used for an assertion, and PosixToWinNormalizer can help make
/// an absolute path contain a drive letter.
///
/// Thin wrapper over the canonical [`crate::strings`] impl that additionally
/// debug-asserts the Zig precondition `Platform.windows.isAbsoluteT(chars)`
/// (bun_core can't, as `bun_paths` would be a tier-0 cycle there).
#[inline]
pub fn is_windows_absolute_path_missing_drive_letter<T: Ch + From<u8>>(chars: &[T]) -> bool {
    debug_assert!(crate::Platform::Windows.is_absolute_t(chars));
    bun_core::strings::is_windows_absolute_path_missing_drive_letter(chars)
}

pub fn from_w_path<'a>(buf: &'a mut [u8], utf16: &[u16]) -> &'a ZStr {
    debug_assert!(!buf.is_empty());
    let to_copy = strings::trim_prefix_comptime::<u16>(utf16, &windows::LONG_PATH_PREFIX);
    let last = buf.len() - 1;
    let encode_into_result = strings::copy_utf16_into_utf8(&mut buf[..last], to_copy);
    let written = encode_into_result.written as usize;
    debug_assert!(written < buf.len());
    buf[written] = 0;
    ZStr::from_buf(buf, written)
}

pub fn without_nt_prefix<T: Ch>(path: &[T]) -> &[T] {
    if !cfg!(windows) {
        return path;
    }
    // PORT NOTE: Zig dispatched hasPrefixComptime vs hasPrefixComptimeUTF16 on T;
    // collapsed to a local `has_prefix_ascii_t` (widens each ASCII byte via T::from_u8).
    if has_prefix_ascii_t(path, &windows::NT_OBJECT_PREFIX_U8) {
        return &path[windows::NT_OBJECT_PREFIX.len()..];
    }
    if has_prefix_ascii_t(path, &windows::LONG_PATH_PREFIX_U8) {
        return &path[windows::LONG_PATH_PREFIX.len()..];
    }
    if has_prefix_ascii_t(path, &windows::NT_UNC_OBJECT_PREFIX_U8) {
        return &path[windows::NT_UNC_OBJECT_PREFIX.len()..];
    }
    path
}

pub fn to_nt_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    if !crate::is_absolute_windows(utf8) {
        return to_w_path_normalized(wbuf, utf8);
    }

    if utf8.starts_with(&windows::NT_OBJECT_PREFIX_U8)
        || utf8.starts_with(&windows::NT_UNC_OBJECT_PREFIX_U8)
    {
        return to_w_path_normalized(wbuf, utf8);
    }

    // UNC absolute path, replace leading '\\' with '\??\UNC\'
    if utf8.starts_with(b"\\\\") {
        if utf8[2..].starts_with(&windows::LONG_PATH_PREFIX_U8[2..]) {
            let prefix = windows::NT_OBJECT_PREFIX;
            wbuf[..prefix.len()].copy_from_slice(&prefix);
            let n = to_w_path_normalized(&mut wbuf[prefix.len()..], &utf8[4..]).len();
            let total = n + prefix.len();
            return wstr_in_buf(wbuf, total);
        }
        let prefix = windows::NT_UNC_OBJECT_PREFIX;
        wbuf[..prefix.len()].copy_from_slice(&prefix);
        let n = to_w_path_normalized(&mut wbuf[prefix.len()..], &utf8[2..]).len();
        let total = n + prefix.len();
        return wstr_in_buf(wbuf, total);
    }

    let prefix = windows::NT_OBJECT_PREFIX;
    wbuf[..prefix.len()].copy_from_slice(&prefix);
    let n = to_w_path_normalized(&mut wbuf[prefix.len()..], utf8).len();
    let total = n + prefix.len();
    wstr_in_buf(wbuf, total)
}

pub fn to_nt_path16<'a>(wbuf: &'a mut [u16], path: &[u16]) -> &'a WStr {
    if !crate::is_absolute_windows_t::<u16>(path) {
        return to_w_path_normalized16(wbuf, path);
    }

    if strings::has_prefix_comptime_utf16(path, &windows::NT_OBJECT_PREFIX_U8)
        || strings::has_prefix_comptime_utf16(path, &windows::NT_UNC_OBJECT_PREFIX_U8)
    {
        return to_w_path_normalized16(wbuf, path);
    }

    if strings::has_prefix_comptime_utf16(path, b"\\\\") {
        if strings::has_prefix_comptime_utf16(&path[2..], &windows::LONG_PATH_PREFIX_U8[2..]) {
            let prefix = windows::NT_OBJECT_PREFIX;
            wbuf[..prefix.len()].copy_from_slice(&prefix);
            let n = to_w_path_normalized16(&mut wbuf[prefix.len()..], &path[4..]).len();
            let total = n + prefix.len();
            return wstr_in_buf(wbuf, total);
        }
        let prefix = windows::NT_UNC_OBJECT_PREFIX;
        wbuf[..prefix.len()].copy_from_slice(&prefix);
        let n = to_w_path_normalized16(&mut wbuf[prefix.len()..], &path[2..]).len();
        let total = n + prefix.len();
        return wstr_in_buf(wbuf, total);
    }

    let prefix = windows::NT_OBJECT_PREFIX;
    wbuf[..prefix.len()].copy_from_slice(&prefix);
    let n = to_w_path_normalized16(&mut wbuf[prefix.len()..], path).len();
    let total = n + prefix.len();
    wstr_in_buf(wbuf, total)
}

pub fn add_nt_path_prefix<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a WStr {
    let plen = windows::NT_OBJECT_PREFIX.len();
    wbuf[..plen].copy_from_slice(&windows::NT_OBJECT_PREFIX);
    wbuf[plen..plen + utf16.len()].copy_from_slice(utf16);
    wbuf[utf16.len() + plen] = 0;
    wstr_in_buf(wbuf, utf16.len() + plen)
}

pub fn add_long_path_prefix<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a WStr {
    let plen = windows::LONG_PATH_PREFIX.len();
    wbuf[..plen].copy_from_slice(&windows::LONG_PATH_PREFIX);
    wbuf[plen..plen + utf16.len()].copy_from_slice(utf16);
    wbuf[utf16.len() + plen] = 0;
    wstr_in_buf(wbuf, utf16.len() + plen)
}

pub fn add_nt_path_prefix_if_needed<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a WStr {
    if strings::has_prefix_comptime_type::<u16>(utf16, &windows::NT_OBJECT_PREFIX) {
        wbuf[..utf16.len()].copy_from_slice(utf16);
        wbuf[utf16.len()] = 0;
        return wstr_in_buf(wbuf, utf16.len());
    }
    if strings::has_prefix_comptime_type::<u16>(utf16, &windows::LONG_PATH_PREFIX) {
        // Replace prefix
        return add_nt_path_prefix(wbuf, &utf16[windows::LONG_PATH_PREFIX.len()..]);
    }
    add_nt_path_prefix(wbuf, utf16)
}

// These are the same because they don't have rules like needing a trailing slash
pub use self::to_nt_path as to_nt_dir;

pub fn to_extended_path_normalized<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    debug_assert!(wbuf.len() > 4);
    if utf8.starts_with(&windows::LONG_PATH_PREFIX_U8)
        || utf8.starts_with(&windows::NT_OBJECT_PREFIX_U8)
    {
        return to_w_path_normalized(wbuf, utf8);
    }
    wbuf[..4].copy_from_slice(&windows::LONG_PATH_PREFIX);
    let n = to_w_path_normalized(&mut wbuf[4..], utf8).len();
    wstr_in_buf(wbuf, n + 4)
}

pub fn to_w_path_normalize_auto_extend<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    if crate::is_absolute_windows(utf8) {
        return to_extended_path_normalized(wbuf, utf8);
    }

    to_w_path_normalized(wbuf, utf8)
}

pub fn to_w_path_normalized<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    let mut renormalized = crate::path_buffer_pool::get();

    let mut path_to_use = normalize_slashes_only(&mut renormalized[..], utf8, b'\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if path_to_use.len() > 3 && resolve_path::is_sep_any(path_to_use[path_to_use.len() - 1]) {
        path_to_use = &path_to_use[..path_to_use.len() - 1];
    }

    to_w_path(wbuf, path_to_use)
}

pub fn to_w_path_normalized16<'a>(wbuf: &'a mut [u16], path: &[u16]) -> &'a WStr {
    // PORT NOTE: reshaped for borrowck — Zig wrote into wbuf and then re-sliced wbuf;
    // here we capture the length and re-derive the mutable slice.
    let len = {
        let mut path_to_use = normalize_slashes_only_t::<u16, b'\\', true>(wbuf, path);

        // is there a trailing slash? Let's remove it before converting to UTF-16
        if path_to_use.len() > 3
            && resolve_path::is_sep_any_t::<u16>(path_to_use[path_to_use.len() - 1])
        {
            path_to_use = &path_to_use[..path_to_use.len() - 1];
        }
        path_to_use.len()
    };

    wbuf[len] = 0;

    wstr_in_buf(wbuf, len)
}

pub fn to_path_normalized<'a>(buf: &'a mut [u8], utf8: &[u8]) -> &'a ZStr {
    let mut renormalized = crate::path_buffer_pool::get();

    let mut path_to_use = normalize_slashes_only(&mut renormalized[..], utf8, b'\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if path_to_use.len() > 3 && resolve_path::is_sep_any(path_to_use[path_to_use.len() - 1]) {
        path_to_use = &path_to_use[..path_to_use.len() - 1];
    }

    to_path(buf, path_to_use)
}

pub fn normalize_slashes_only_t<'a, T: Ch, const DESIRED_SLASH: u8, const ALWAYS_COPY: bool>(
    buf: &'a mut [T],
    path: &'a [T],
) -> &'a [T] {
    // PORT NOTE: was `const _: () = assert!(..)` but Rust forbids const items
    // referencing outer const-generic params (E0401). Debug-assert instead.
    debug_assert!(DESIRED_SLASH == b'/' || DESIRED_SLASH == b'\\');
    let undesired_slash: u8 = if DESIRED_SLASH == b'/' { b'\\' } else { b'/' };

    if strings::contains_char_t(path, undesired_slash) {
        buf[..path.len()].copy_from_slice(path);
        for c in buf[..path.len()].iter_mut() {
            if *c == ch(undesired_slash) {
                *c = ch(DESIRED_SLASH);
            }
        }
        return &buf[..path.len()];
    }

    if ALWAYS_COPY {
        buf[..path.len()].copy_from_slice(path);
        return &buf[..path.len()];
    }
    path
}

// TODO(port): `desired_slash` was `comptime u8` in Zig; kept as runtime arg here since
// const-generic value can't be forwarded from a runtime call site without duplication.
// PERF(port): was comptime monomorphization — profile in Phase B.
pub fn normalize_slashes_only<'a>(
    buf: &'a mut [u8],
    utf8: &'a [u8],
    desired_slash: u8,
) -> &'a [u8] {
    debug_assert!(desired_slash == b'/' || desired_slash == b'\\');
    let undesired_slash: u8 = if desired_slash == b'/' { b'\\' } else { b'/' };

    if strings::contains_char_t(utf8, undesired_slash) {
        buf[..utf8.len()].copy_from_slice(utf8);
        for c in buf[..utf8.len()].iter_mut() {
            if *c == undesired_slash {
                *c = desired_slash;
            }
        }
        return &buf[..utf8.len()];
    }

    utf8
}

pub fn to_w_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    to_w_path_maybe_dir::<false>(wbuf, utf8)
}

pub fn to_path<'a>(buf: &'a mut [u8], utf8: &[u8]) -> &'a mut ZStr {
    to_path_maybe_dir::<false>(buf, utf8)
}

pub fn to_w_dir_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    to_w_path_maybe_dir::<true>(wbuf, utf8)
}

pub fn to_kernel32_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    let path = if utf8.starts_with(&windows::NT_OBJECT_PREFIX_U8) {
        &utf8[windows::NT_OBJECT_PREFIX_U8.len()..]
    } else {
        utf8
    };
    if path.starts_with(&windows::LONG_PATH_PREFIX_U8) {
        return to_w_path(wbuf, path);
    }
    if utf8.len() > 2
        && resolve_path::is_drive_letter(utf8[0])
        && utf8[1] == b':'
        && resolve_path::is_sep_any(utf8[2])
    {
        wbuf[..4].copy_from_slice(&windows::LONG_PATH_PREFIX);
        let n = to_w_path(&mut wbuf[4..], path).len();
        return wstr_in_buf(wbuf, n + 4);
    }
    to_w_path(wbuf, path)
}

fn is_unc_path<T: Ch>(path: &[T]) -> bool {
    path.len() >= 3
        && crate::Platform::Windows.is_separator_t(path[0])
        && crate::Platform::Windows.is_separator_t(path[1])
        && !crate::Platform::Windows.is_separator_t(path[2])
        && path[2] != ch(b'.')
}

pub fn to_w_path_maybe_dir<'a, const ADD_TRAILING_LASH: bool>(
    wbuf: &'a mut [u16],
    utf8: &[u8],
) -> &'a WStr {
    debug_assert!(!wbuf.is_empty());

    let cap = wbuf.len().saturating_sub(1 + (ADD_TRAILING_LASH as usize));
    // PORT NOTE: Zig used `bun.simdutf.convert.utf8.to.utf16.le.with_errors`;
    // route through `crate::strings::convert_utf8_to_utf16_in_buffer` (same
    // simdutf primitive + WTF-8 fallback) to avoid a `bun_simdutf` crate dep.
    let mut count = crate::strings::convert_utf8_to_utf16_in_buffer(&mut wbuf[..cap], utf8).len();

    // Many Windows APIs expect normalized path slashes, particularly when the
    // long path prefix is added or the nt object prefix. To make this easier,
    // but a little redundant, this function always normalizes the slashes here.
    //
    // An example of this is GetFileAttributesW(L"C:\\hello/world.txt") being OK
    // but GetFileAttributesW(L"\\\\?\\C:\\hello/world.txt") is NOT
    resolve_path::dangerously_convert_path_to_windows_in_place::<u16>(&mut wbuf[..count]);

    if ADD_TRAILING_LASH && count > 0 && wbuf[count - 1] != u16::from(b'\\') {
        wbuf[count] = u16::from(b'\\');
        count += 1;
    }

    wbuf[count] = 0;

    wstr_in_buf(wbuf, count)
}

pub fn to_path_maybe_dir<'a, const ADD_TRAILING_LASH: bool>(
    buf: &'a mut [u8],
    utf8: &[u8],
) -> &'a mut ZStr {
    debug_assert!(!buf.is_empty());

    let mut len = utf8.len();
    buf[..len].copy_from_slice(&utf8[..len]);

    if ADD_TRAILING_LASH && len > 0 && buf[len - 1] != b'\\' {
        buf[len] = b'\\';
        len += 1;
    }
    buf[len] = 0;
    ZStr::from_buf_mut(buf, len)
}

pub fn clone_normalizing_separators(input: &[u8]) -> Vec<u8> {
    // remove duplicate slashes in the file path
    let base = without_trailing_slash(input);
    let mut buf = vec![0u8; base.len() + 2];
    if cfg!(debug_assertions) {
        debug_assert!(!base.is_empty());
    }
    if base[0] == crate::SEP {
        buf[0] = crate::SEP;
    }
    // PORT NOTE: reshaped for borrowck — track index instead of moving slice ptr.
    let mut i: usize = (base[0] == crate::SEP) as usize;

    for token in base.split(|b| *b == crate::SEP).filter(|s| !s.is_empty()) {
        if token.is_empty() {
            continue;
        }
        buf[i..i + token.len()].copy_from_slice(token);
        buf[i + token.len()] = crate::SEP;
        i += token.len() + 1;
    }
    if i >= 1 && buf[i - 1] != crate::SEP {
        buf[i] = crate::SEP;
        i += 1;
    }
    buf[i] = 0;

    buf.truncate(i);
    buf
}

pub fn path_contains_node_modules_folder(path: &[u8]) -> bool {
    strings::index_of(path, crate::NODE_MODULES_NEEDLE).is_some()
}

pub use crate::is_sep_any as char_is_any_slash;

#[inline(always)]
pub fn starts_with_windows_drive_letter(s: &[u8]) -> bool {
    starts_with_windows_drive_letter_t(s)
}

#[inline(always)]
pub fn starts_with_windows_drive_letter_t<T: Ch>(s: &[T]) -> bool {
    s.len() > 2 && s[1] == ch(b':') && {
        let c = s[0];
        (c >= ch(b'a') && c <= ch(b'z')) || (c >= ch(b'A') && c <= ch(b'Z'))
    }
}

pub use crate::strings::without_trailing_slash;

/// Does not strip the device root (C:\ or \\Server\Share\ portion off of the path)
pub fn without_trailing_slash_windows_path(input: &[u8]) -> &[u8] {
    if cfg!(unix) || input.len() < 3 || input[1] != b':' {
        return without_trailing_slash(input);
    }

    let root_len = resolve_path::windows_filesystem_root(input).len() + 1;

    let mut path = input;
    while path.len() > root_len && matches!(path[path.len() - 1], b'/' | b'\\') {
        path = &path[..path.len() - 1];
    }

    if cfg!(debug_assertions) {
        debug_assert!(
            !crate::is_absolute(path) || !is_windows_absolute_path_missing_drive_letter::<u8>(path)
        );
    }

    path
}

pub fn without_leading_slash(this: &[u8]) -> &[u8] {
    strings::trim_left(this, b"/")
}

pub fn without_leading_path_separator(this: &[u8]) -> &[u8] {
    strings::trim_left(this, &[crate::SEP])
}

pub use bun_core::strings::remove_leading_dot_slash;

// Copied from std, modified to accept input type — canonical impl lives in
// `crate::{basename_posix, basename_windows}` (generic over `PathChar`);
// this is a thin re-wrapper preserving the `Ch` bound for this module's API.
#[inline]
pub fn basename<T: Ch>(input: &[T]) -> &[T] {
    #[cfg(windows)]
    {
        return crate::basename_windows::<T>(input);
    }
    #[cfg(not(windows))]
    {
        crate::basename_posix::<T>(input)
    }
}

// ported from: src/string/immutable/paths.zig
