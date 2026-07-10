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
use bun_core::strings;
use bun_core::{WStr, ZStr};

// Generic code-unit bound for fns that operate over both u8 and u16 paths:
// `crate::PathChar` (provides
// `from_u8`/`IS_U16`) plus `Into<u32>` + `NoUninit` for `strings::contains_char_t`.
pub trait Ch: PathChar + Into<u32> + bun_core::NoUninit {}
impl Ch for u8 {}
impl Ch for u16 {}

/// Borrow `wbuf[..len]` as a `&WStr`, where `wbuf[len] == 0`. Safe-surface
/// form of [`WStr::from_raw`] for the dominant call shape in this module: a
/// stack `WPathBuffer` filled to `len` with a NUL written at `wbuf[len]`.
/// The slice borrow proves `wbuf[..=len]` lies in one allocation and ties the
/// returned lifetime to it; the NUL is debug-asserted (release relies on the
/// caller upholding the documented `wbuf[len] == 0` precondition).
/// Mirrors [`ZStr::from_buf`].
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
/// debug-asserts the precondition `Platform.windows.isAbsoluteT(chars)`
/// (bun_core can't, as `bun_paths` would be a tier-0 cycle there).
#[inline]
pub fn is_windows_absolute_path_missing_drive_letter<T: Ch + From<u8>>(chars: &[T]) -> bool {
    debug_assert!(crate::Platform::Windows.is_absolute_t(chars));
    bun_core::strings::is_windows_absolute_path_missing_drive_letter(chars)
}

/// One final-path prefix policy: `\\?\C:\x` → `C:\x`, `\\?\UNC\srv` → `\\srv`
/// (case-insensitive `UNC`), neither shape → unchanged. Canonical body lives
/// in `bun_core` so `fd_path_raw_w` can share it. // quirk: FSMETA-42
pub use bun_core::{FinalPathShape, final_path_shape, rewrite_final_path_prefix};

pub fn from_w_path<'a>(buf: &'a mut [u8], utf16: &[u16]) -> &'a ZStr {
    debug_assert!(!buf.is_empty());
    // Prefix trim per `final_path_shape`; the Unc rewrite (`\` over the `C` of
    // `UNC`) is expressed borrow-only as one lead byte + copy from `utf16[7]`
    // (always `\`). WTF-8-preserving transcode. // quirk: FSIO-40, FSMETA-42
    let (lead, to_copy): (&[u8], &[u16]) = match final_path_shape(utf16) {
        FinalPathShape::Dos => (b"", &utf16[4..]),
        FinalPathShape::Unc => (b"\\", &utf16[7..]),
        FinalPathShape::Other => (b"", utf16),
    };
    let last = buf.len() - 1;
    let lead_n = lead.len().min(last);
    buf[..lead_n].copy_from_slice(&lead[..lead_n]);
    let encode_into_result = strings::copy_wtf16_into_wtf8(&mut buf[lead_n..last], to_copy);
    let written = lead_n + encode_into_result.written as usize;
    debug_assert!(written < buf.len());
    buf[written] = 0;
    ZStr::from_buf(buf, written)
}

pub fn without_nt_prefix<T: Ch>(path: &[T]) -> &[T] {
    if !cfg!(windows) {
        return path;
    }
    // A local `has_prefix_ascii_t` covers both widths (widens each ASCII byte
    // via T::from_u8).
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

pub(crate) fn add_nt_path_prefix<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a WStr {
    let plen = windows::NT_OBJECT_PREFIX.len();
    wbuf[..plen].copy_from_slice(&windows::NT_OBJECT_PREFIX);
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

    // Longer than the pooled scratch buffer (and than any path the OS can
    // address) — fail-safe to "" like `to_w_path_maybe_dir` does, instead of
    // panicking in the `normalize_slashes_only` copy below.
    if utf8.len() > renormalized.len() {
        wbuf[0] = 0;
        return wstr_in_buf(wbuf, 0);
    }

    let mut path_to_use = normalize_slashes_only(&mut renormalized[..], utf8, b'\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if path_to_use.len() > 3 && resolve_path::is_sep_any(path_to_use[path_to_use.len() - 1]) {
        path_to_use = &path_to_use[..path_to_use.len() - 1];
    }

    to_w_path(wbuf, path_to_use)
}

pub(crate) fn to_w_path_normalized16<'a>(wbuf: &'a mut [u16], path: &[u16]) -> &'a WStr {
    // Input (plus the NUL) doesn't fit in `wbuf` — fail-safe to "" like
    // `to_w_path_maybe_dir` does, instead of panicking in the
    // `normalize_slashes_only_t` copy below.
    if path.len() >= wbuf.len() {
        wbuf[0] = 0;
        return wstr_in_buf(wbuf, 0);
    }

    // Capture the length and re-derive the mutable slice (borrowck-friendly
    // alternative to writing into wbuf and re-slicing it).
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

pub(crate) fn normalize_slashes_only_t<
    'a,
    T: Ch,
    const DESIRED_SLASH: u8,
    const ALWAYS_COPY: bool,
>(
    buf: &'a mut [T],
    path: &'a [T],
) -> &'a [T] {
    // Was `const _: () = assert!(..)` but Rust forbids const items
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

// `desired_slash` is a runtime arg (not a const generic) since a
// const-generic value can't be forwarded from a runtime call site without duplication.
// PERF: profile if it shows up on a hot path.
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

pub fn to_w_dir_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    to_w_path_maybe_dir::<true>(wbuf, utf8)
}

/// Can `utf8`'s UTF-16 form fit a `WPathBuffer` (`PATH_MAX_WIDE` units, the
/// NT maximum path length), leaving room for the longest prefix any converter
/// prepends (`\??\UNC\`, 8 units), a trailing slash, and the NUL? Paths that
/// fail this cannot exist on disk; callers surface `false`/`ENAMETOOLONG`
/// instead of converting (see oven-sh/bun#27775).
///
/// UTF-8 → UTF-16 never expands the unit count, so the byte count fitting
/// already proves the fit; the unit count (simdutf, SIMD) is only computed
/// for longer inputs. The byte length is bounded as well: a converted unit
/// consumes at least a third of a byte triple, so any input past 3×
/// `MAX_UNITS` bytes cannot fit regardless of content — and the cap also
/// bounds the u8-space path copies this check guards.
///
/// simdutf's length is exact for valid WTF-8; on malformed bytes it is an
/// estimate (stray continuation bytes count zero yet convert to one U+FFFD
/// unit each), so a malformed over-long path can pass this check. That is
/// fine: the bounds-checked conversion downstream never overflows and fails
/// safe to an empty path — such input merely gets a generic syscall error
/// instead of the precise `ENAMETOOLONG`.
pub fn fits_in_wide_path_buffer(utf8: &[u8]) -> bool {
    fits_in_wide_buffer(utf8, crate::PATH_MAX_WIDE)
}

/// [`fits_in_wide_path_buffer`] against an arbitrary buffer size: the budget
/// is `buf_units` minus the converter overhead (longest prefix `\??\UNC\`,
/// trailing slash, NUL).
fn fits_in_wide_buffer(utf8: &[u8], buf_units: usize) -> bool {
    const OVERHEAD: usize = windows::NT_UNC_OBJECT_PREFIX.len() + 2;
    let max_units = buf_units.saturating_sub(OVERHEAD);
    utf8.len() <= max_units
        || (utf8.len() <= 3 * max_units
            && strings::element_length_utf8_into_utf16(utf8) <= max_units)
}

/// Why a fallible wide-path conversion refused the input.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum WidePathError {
    /// The UTF-16 form cannot fit the wide-path budget — the smaller of
    /// `PATH_MAX_WIDE` and the caller's buffer, minus converter overhead.
    TooLong,
    /// Genuinely malformed WTF-8 (stray continuation byte, truncated tail,
    /// overlong, >U+10FFFF). Lone surrogates are valid WTF-8 and convert.
    Invalid,
}

/// Shared guard for the fallible converters: strict WTF-8 validation first
/// (malformed paths error instead of converting with U+FFFD), then the fit
/// check, so the infallible converters' silent-`""` fail-safe is unreachable
/// behind an `Ok`. Validating first also makes the simdutf length estimate in
/// [`fits_in_wide_buffer`] exact.
fn check_wide_path(utf8: &[u8], wbuf_units: usize) -> Result<(), WidePathError> {
    if !strings::is_valid_wtf8(utf8) {
        return Err(WidePathError::Invalid);
    }
    if !fits_in_wide_buffer(
        without_nt_prefix(utf8),
        wbuf_units.min(crate::PATH_MAX_WIDE),
    ) {
        return Err(WidePathError::TooLong);
    }
    Ok(())
}

/// Fallible [`to_kernel32_path`]: fuses the two-step
/// [`fits_in_wide_path_buffer`] guard + silent-empty conversion into one call
/// that returns [`WidePathError::TooLong`] instead of `""`. Lone surrogates
/// (WTF-8) remain valid input. // quirk: FSIO-41, FSIO-42
pub fn try_to_kernel32_path<'a>(
    wbuf: &'a mut [u16],
    utf8: &[u8],
) -> Result<&'a WStr, WidePathError> {
    check_wide_path(utf8, wbuf.len())?;
    let w = to_kernel32_path(wbuf, utf8);
    debug_assert!(utf8.is_empty() || w.len() > 0);
    Ok(w)
}

/// Fallible [`to_nt_path`]; see [`try_to_kernel32_path`].
/// // quirk: FSIO-41, FSIO-42
pub fn try_to_nt_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> Result<&'a WStr, WidePathError> {
    check_wide_path(utf8, wbuf.len())?;
    let w = to_nt_path(wbuf, utf8);
    debug_assert!(utf8.is_empty() || w.len() > 0);
    Ok(w)
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
        // `\\?\` disables Win32's DOS-to-NT normalization, so mangled
        // spellings (trailing/doubled separators, dot segments) must be
        // normalized before prefixing or they reach NTFS verbatim and fail
        // the open. Lexical semantics match PathLike's pre-normalize; clean
        // paths (the common case) skip the pass. // quirk: FSIO-13
        let dirty = path.iter().enumerate().any(|(i, &c)| {
            c == b'/'
                || (c == b'\\' && (i + 1 == path.len() || path[i + 1] == b'\\'))
                || (c == b'.'
                    && (i + 1 == path.len() || resolve_path::is_sep_any(path[i + 1]))
                    && (i == 0 || resolve_path::is_sep_any(path[i - 1]) || path[i - 1] == b'.'))
        });
        if dirty && path.len() < crate::MAX_PATH_BYTES {
            // Over-long inputs skip the lexical pass (the scratch buffer is
            // narrower than the wide-length guard); verbatim conversion is
            // their pre-existing behavior.
            let mut scratch = crate::path_buffer_pool::get();
            let normalized = resolve_path::normalize_buf::<resolve_path::platform::Windows>(
                path,
                &mut scratch[..],
            );
            wbuf[..4].copy_from_slice(&windows::LONG_PATH_PREFIX);
            let n = to_w_path(&mut wbuf[4..], normalized).len();
            return wstr_in_buf(wbuf, n + 4);
        }
        wbuf[..4].copy_from_slice(&windows::LONG_PATH_PREFIX);
        let n = to_w_path(&mut wbuf[4..], path).len();
        return wstr_in_buf(wbuf, n + 4);
    }
    to_w_path(wbuf, path)
}

pub(crate) fn to_w_path_maybe_dir<'a, const ADD_TRAILING_LASH: bool>(
    wbuf: &'a mut [u16],
    utf8: &[u8],
) -> &'a WStr {
    debug_assert!(!wbuf.is_empty());

    let cap = wbuf.len().saturating_sub(1 + (ADD_TRAILING_LASH as usize));
    // Route through the checked `try_convert_utf8_to_utf16_in_buffer`
    // (simdutf + WTF-8 fallback) to avoid a `bun_simdutf` crate dep.
    //
    // Over-long input is fail-safed to "" instead of overflowing: handing
    // simdutf a buffer it could write past would silently
    // corrupt the stack once a path's UTF-16 form exceeded the wide
    // buffer (32767 units for `WPathBuffer`, i.e. longer than any path NT
    // can address). The empty result makes the consuming syscall fail
    // cleanly; JS-facing paths are rejected with `false`/ENAMETOOLONG before
    // they get here (`PathLikeExt::{slice_w, os_path, os_path_kernel32}` in
    // `runtime/node/types.rs`, via `fits_in_wide_path_buffer`). Prefixing
    // wrappers (`to_kernel32_path`, `to_nt_path`, …) may then yield just
    // their prefix, which likewise fails at the syscall.
    let Some(converted) =
        crate::strings::try_convert_utf8_to_utf16_in_buffer(&mut wbuf[..cap], utf8)
    else {
        wbuf[0] = 0;
        return wstr_in_buf(wbuf, 0);
    };
    let mut count = converted.len();

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
    // Reshaped for borrowck — track index instead of moving slice ptr.
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

// Run with `cargo test -p bun_paths` (also the Miri lane,
// `bun run rust:miri -p bun_paths`). simdutf's C++ implementation is only
// linked into the full binary, so the two externs the conversion path uses
// are satisfied below with faithful pure-Rust scalar stubs — which is also
// what keeps these tests runnable under Miri (no foreign code).
#[cfg(test)]
mod tests {
    use super::*;

    use bun_simdutf_sys::simdutf::{SIMDUTFResult, Status};

    /// Scalar `simdutf::convert::utf8::to::utf16::with_errors::le`: writes
    /// the UTF-16LE form of the valid prefix to `utf16_output` and returns
    /// SUCCESS + units written, or a nonzero status + the input position of
    /// the first invalid sequence. Mirrors the semantics
    /// `try_convert_utf8_to_utf16_in_buffer` relies on: the output buffer
    /// length is never communicated, and on error only the valid prefix's
    /// units (≤ the `utf16_length_from_utf8` estimate) have been written.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> SIMDUTFResult {
        // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
        let input = unsafe { core::slice::from_raw_parts(buf, len) };
        let mut written = 0usize;
        let mut i = 0usize;
        while i < len {
            let b = input[i];
            let cont = |off: usize| i + off < len && input[i + off] & 0xC0 == 0x80;
            let (cp, adv): (u32, usize) = if b < 0x80 {
                (b as u32, 1)
            } else if (0xC2..0xE0).contains(&b) && cont(1) {
                (
                    (u32::from(b & 0x1F) << 6) | u32::from(input[i + 1] & 0x3F),
                    2,
                )
            } else if (0xE0..0xF0).contains(&b) && cont(1) && cont(2) {
                let cp = (u32::from(b & 0x0F) << 12)
                    | (u32::from(input[i + 1] & 0x3F) << 6)
                    | u32::from(input[i + 2] & 0x3F);
                if (0xD800..=0xDFFF).contains(&cp) {
                    return SIMDUTFResult {
                        status: Status::SURROGATE,
                        count: i,
                    };
                }
                (cp, 3)
            } else if (0xF0..0xF5).contains(&b) && cont(1) && cont(2) && cont(3) {
                (
                    (u32::from(b & 0x07) << 18)
                        | (u32::from(input[i + 1] & 0x3F) << 12)
                        | (u32::from(input[i + 2] & 0x3F) << 6)
                        | u32::from(input[i + 3] & 0x3F),
                    4,
                )
            } else {
                return SIMDUTFResult {
                    status: Status::TOO_SHORT,
                    count: i,
                };
            };
            // SAFETY: test stub mirroring simdutf — the caller guarantees
            // capacity for the full conversion before calling (that is the
            // invariant under test).
            unsafe {
                if cp <= 0xFFFF {
                    utf16_output.add(written).write(cp as u16);
                    written += 1;
                } else {
                    let v = cp - 0x10000;
                    utf16_output.add(written).write(0xD800 + (v >> 10) as u16);
                    utf16_output
                        .add(written + 1)
                        .write(0xDC00 + (v & 0x3FF) as u16);
                    written += 2;
                }
            }
            i += adv;
        }
        SIMDUTFResult {
            status: Status::SUCCESS,
            count: written,
        }
    }

    /// Scalar `simdutf::length::utf16::from::utf8`: one unit per
    /// non-continuation byte plus one more per 4-byte lead — including the
    /// real implementation's undercount on invalid input (stray continuation
    /// bytes count zero), which `to_w_path_overlong_invalid_utf8` depends on.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize {
        // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
        let input = unsafe { core::slice::from_raw_parts(input, length) };
        input
            .iter()
            .map(|&b| {
                if b & 0xC0 == 0x80 {
                    0
                } else if b >= 0xF0 {
                    2
                } else {
                    1
                }
            })
            .sum()
    }

    /// Scalar `bun_highway::index_of_char` — backs
    /// `strings::contains_char_t` in `normalize_slashes_only` (the
    /// `to_nt_path` success path). Returns `haystack_len` when absent.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_index_of_char(
        haystack: *const u8,
        haystack_len: usize,
        needle: u8,
    ) -> usize {
        // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
        let input = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
        input
            .iter()
            .position(|&b| b == needle)
            .unwrap_or(haystack_len)
    }

    /// Scalar `simdutf::validate::with_errors::ascii` — backs
    /// `first_non_ascii_usize` for >32-byte inputs (the WTF-8 validator's
    /// ASCII fast path). Error position in `count`, like the real one.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__validate_ascii_with_errors(
        buf: *const u8,
        len: usize,
    ) -> SIMDUTFResult {
        // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
        let input = unsafe { core::slice::from_raw_parts(buf, len) };
        match input.iter().position(|&b| b >= 0x80) {
            None => SIMDUTFResult {
                status: Status::SUCCESS,
                count: len,
            },
            Some(i) => SIMDUTFResult {
                status: Status::TOO_LARGE,
                count: i,
            },
        }
    }

    /// Scalar `simdutf::convert::utf16::to::utf8::with_errors::le`: writes
    /// UTF-8 for the valid prefix; an unpaired surrogate yields SURROGATE +
    /// its input-unit position (the WTF-8 fallbacks then re-encode from
    /// scratch). Success `count` is bytes written.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
        buf: *const u16,
        len: usize,
        utf8_output: *mut u8,
    ) -> SIMDUTFResult {
        // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
        let input = unsafe { core::slice::from_raw_parts(buf, len) };
        let mut written = 0usize;
        let mut i = 0usize;
        while i < len {
            let c0 = input[i];
            let (cp, adv): (u32, usize) = if (0xD800..0xDC00).contains(&c0) {
                match input.get(i + 1) {
                    Some(&c1) if (0xDC00..0xE000).contains(&c1) => (
                        0x10000 + ((u32::from(c0) - 0xD800) << 10) + (u32::from(c1) - 0xDC00),
                        2,
                    ),
                    _ => {
                        return SIMDUTFResult {
                            status: Status::SURROGATE,
                            count: i,
                        };
                    }
                }
            } else if (0xDC00..0xE000).contains(&c0) {
                return SIMDUTFResult {
                    status: Status::SURROGATE,
                    count: i,
                };
            } else {
                (u32::from(c0), 1)
            };
            // SAFETY: test stub mirroring simdutf — the caller guarantees
            // output capacity for the full conversion before calling (that is
            // the invariant under test).
            unsafe {
                if cp < 0x80 {
                    utf8_output.add(written).write(cp as u8);
                    written += 1;
                } else if cp < 0x800 {
                    utf8_output.add(written).write(0xC0 | (cp >> 6) as u8);
                    utf8_output.add(written + 1).write(0x80 | (cp & 0x3F) as u8);
                    written += 2;
                } else if cp < 0x10000 {
                    utf8_output.add(written).write(0xE0 | (cp >> 12) as u8);
                    utf8_output
                        .add(written + 1)
                        .write(0x80 | ((cp >> 6) & 0x3F) as u8);
                    utf8_output.add(written + 2).write(0x80 | (cp & 0x3F) as u8);
                    written += 3;
                } else {
                    utf8_output.add(written).write(0xF0 | (cp >> 18) as u8);
                    utf8_output
                        .add(written + 1)
                        .write(0x80 | ((cp >> 12) & 0x3F) as u8);
                    utf8_output
                        .add(written + 2)
                        .write(0x80 | ((cp >> 6) & 0x3F) as u8);
                    utf8_output.add(written + 3).write(0x80 | (cp & 0x3F) as u8);
                    written += 4;
                }
            }
            i += adv;
        }
        SIMDUTFResult {
            status: Status::SUCCESS,
            count: written,
        }
    }

    /// Scalar `simdutf::length::utf8::from::utf16::le_with_replacement`:
    /// exact UTF-8 length charging 3 bytes per unpaired surrogate — the same
    /// count both U+FFFD replacement and WTF-8 passthrough produce.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
        input: *const u16,
        length: usize,
    ) -> usize {
        // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
        let input = unsafe { core::slice::from_raw_parts(input, length) };
        let mut n = 0usize;
        let mut i = 0usize;
        while i < input.len() {
            let c0 = input[i];
            if (0xD800..0xDC00).contains(&c0)
                && input
                    .get(i + 1)
                    .is_some_and(|&c1| (0xDC00..0xE000).contains(&c1))
            {
                n += 4;
                i += 2;
            } else if c0 < 0x80 {
                n += 1;
                i += 1;
            } else if c0 < 0x800 {
                n += 2;
                i += 1;
            } else {
                // BMP scalar or unpaired surrogate: 3 bytes either way.
                n += 3;
                i += 1;
            }
        }
        n
    }

    /// The u16 length of the buffer `PathLike::os_path_kernel32` uses on
    /// Windows: the 98302-byte (3 × PATH_MAX_WIDE + 1) `PathBuffer`
    /// reinterpreted as `[u16]`.
    const KERNEL32_WIDE_LEN: usize = (3 * crate::PATH_MAX_WIDE + 1) / 2;

    #[test]
    fn to_w_path_fills_to_capacity() {
        // cap = wbuf.len() - 1 (NUL); an input of exactly `cap` units fits.
        let mut wbuf = [0u16; 9];
        let result = to_w_path(&mut wbuf, b"abcdefgh");
        assert_eq!(result.len(), 8);
        assert_eq!(wbuf[8], 0);
    }

    #[test]
    fn to_w_path_overlong_yields_empty() {
        // Used to hand simdutf a buffer it would write past (then panic
        // slicing the result); must fail safe to "" instead.
        let mut wbuf = [1u16; 32];
        let result = to_w_path(&mut wbuf, &[b'a'; 64]);
        assert_eq!(result.len(), 0);
        assert_eq!(wbuf[0], 0);
    }

    #[test]
    fn to_w_path_overlong_invalid_utf8_yields_empty() {
        // Stray continuation bytes defeat the simdutf length estimate (they
        // count as zero units) but each becomes one U+FFFD in the WTF-8
        // fallback — the bounded fallback must still refuse to write past
        // the buffer.
        let mut wbuf = [1u16; 32];
        let result = to_w_path(&mut wbuf, &[0x80u8; 64]);
        assert_eq!(result.len(), 0);
        assert_eq!(wbuf[0], 0);
    }

    #[test]
    fn to_w_path_multibyte_longer_in_bytes_than_buffer_fits() {
        // 20 × U+4E16 = 60 UTF-8 bytes but only 20 UTF-16 units; must
        // convert even though the byte length exceeds the buffer length.
        let input: Vec<u8> = "世".repeat(20).into_bytes();
        let mut wbuf = [0u16; 32];
        let result = to_w_path(&mut wbuf, &input);
        assert_eq!(result.len(), 20);
        assert!(result.as_slice().iter().all(|&u| u == 0x4E16));
    }

    #[test]
    fn to_kernel32_path_adds_long_prefix() {
        let mut wbuf = [0u16; 16];
        let result = to_kernel32_path(&mut wbuf, b"C:\\foo");
        let expected: Vec<u16> = "\\\\?\\C:\\foo".encode_utf16().collect();
        assert_eq!(result.as_slice(), &expected[..]);
    }

    #[test]
    fn to_kernel32_path_overlong_windows_sized_buffer() {
        // The exact shape of the crash seen in production (and of
        // oven-sh/bun#20258): `PathLike::os_path_kernel32` reinterprets the
        // 98302-byte Windows `PathBuffer` as 49151 u16s; a drive-letter path
        // longer than that in UTF-16 units used to write past the buffer
        // inside simdutf and panic slicing the result. It must now fail safe
        // (prefix-only output, which the consuming syscall rejects) — and
        // `PathLikeExt` rejects such paths with NameTooLong before this
        // conversion is even reached.
        let mut wbuf = vec![0u16; KERNEL32_WIDE_LEN];
        let mut path = b"C:\\".to_vec();
        path.resize(3 + KERNEL32_WIDE_LEN, b'a');
        let result = to_kernel32_path(&mut wbuf, &path);
        assert_eq!(result.as_slice(), &windows::LONG_PATH_PREFIX[..]);

        // Without the drive-letter prefix it degrades to "".
        let result = to_w_path(&mut wbuf, &path[3..]);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn to_kernel32_path_just_under_the_buffer_converts() {
        // One unit of headroom below the prefix + NUL overhead: must still
        // convert (guards against over-rejection at the boundary).
        let mut wbuf = vec![0u16; KERNEL32_WIDE_LEN];
        let mut path = b"C:\\".to_vec();
        path.resize(KERNEL32_WIDE_LEN - 5, b'a');
        let result = to_kernel32_path(&mut wbuf, &path);
        assert_eq!(result.len(), path.len() + 4);
        assert_eq!(&result.as_slice()[..4], &windows::LONG_PATH_PREFIX[..]);
    }

    #[test]
    fn convert_z_bounds() {
        // The NUL-terminating conversion (used by the Windows profilers'
        // path widening) shares the checked core: exact fit converts with
        // the NUL in the reserved slot, over-long fails safe to "".
        let mut wbuf = [1u16; 9];
        let result = bun_core::strings::convert_utf8_to_utf16_in_buffer_z(&mut wbuf, b"abcdefgh");
        assert_eq!(result.len(), 8);
        assert_eq!(wbuf[8], 0);

        let result = bun_core::strings::convert_utf8_to_utf16_in_buffer_z(&mut wbuf, &[b'a'; 16]);
        assert_eq!(result.len(), 0);
        assert_eq!(wbuf[0], 0);
    }

    #[test]
    fn lone_surrogate_round_trips_through_wide_and_back() {
        // quirk: FSIO-40
        // WTF-8 U+D800 (ED A0 80) → UTF-16 0xD800 → identical WTF-8 back.
        let wtf8: &[u8] = b"C:\\a\xED\xA0\x80b";
        let mut wbuf = [0u16; 64];
        let wide = try_to_kernel32_path(&mut wbuf, wtf8).unwrap();
        let prefix: Vec<u16> = "\\\\?\\C:\\a".encode_utf16().collect();
        assert_eq!(&wide.as_slice()[..8], &prefix[..]);
        assert_eq!(wide.as_slice()[8], 0xD800);
        assert_eq!(wide.as_slice()[9], u16::from(b'b'));
        assert_eq!(wide.len(), 10);

        let mut buf = [0u8; 64];
        let back = from_w_path(&mut buf, wide.as_slice());
        assert_eq!(back.as_bytes(), wtf8);
    }

    #[test]
    fn rewrite_final_path_prefix_shapes() {
        // quirk: FSMETA-42
        let w = |s: &str| s.encode_utf16().collect::<Vec<u16>>();

        let mut dos = w("\\\\?\\C:\\x");
        let (shape, out) = rewrite_final_path_prefix(&mut dos);
        assert_eq!(shape, FinalPathShape::Dos);
        assert_eq!(&out[..], &w("C:\\x")[..]);

        let mut unc = w("\\\\?\\UNC\\srv\\sh");
        let (shape, out) = rewrite_final_path_prefix(&mut unc);
        assert_eq!(shape, FinalPathShape::Unc);
        assert_eq!(&out[..], &w("\\\\srv\\sh")[..]);

        // `UNC` matches case-insensitively.
        let mut lower = w("\\\\?\\unc\\srv");
        let (shape, out) = rewrite_final_path_prefix(&mut lower);
        assert_eq!(shape, FinalPathShape::Unc);
        assert_eq!(&out[..], &w("\\\\srv")[..]);

        let mut plain = w("C:\\plain");
        let (shape, out) = rewrite_final_path_prefix(&mut plain);
        assert_eq!(shape, FinalPathShape::Other);
        assert_eq!(&out[..], &w("C:\\plain")[..]);
    }

    #[test]
    fn from_w_path_rewrites_prefixes() {
        // quirk: FSMETA-42
        let w = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
        let mut buf = [0u8; 32];
        let cases: &[(&str, &[u8])] = &[
            ("\\\\?\\UNC\\srv\\sh", b"\\\\srv\\sh"),
            ("\\\\?\\unc\\srv\\sh", b"\\\\srv\\sh"),
            ("\\\\?\\C:\\x", b"C:\\x"),
            ("D:\\y", b"D:\\y"),
        ];
        for &(wide, expected) in cases {
            assert_eq!(from_w_path(&mut buf, &w(wide)).as_bytes(), expected);
        }
    }

    #[test]
    fn try_to_paths_reject_over_budget_input() {
        // PATH_MAX_WIDE (32767) minus the 10-unit converter overhead = 32757
        // is the largest accepted size (mirrors `fits_in_wide_path_buffer`).
        let mut wbuf = vec![0u16; crate::PATH_MAX_WIDE];
        let over = vec![b'a'; 32758];
        assert_eq!(
            try_to_kernel32_path(&mut wbuf, &over).err(),
            Some(WidePathError::TooLong)
        );
        assert_eq!(
            try_to_nt_path(&mut wbuf, &over).err(),
            Some(WidePathError::TooLong)
        );
        // At the limit converts.
        assert_eq!(
            try_to_kernel32_path(&mut wbuf, &vec![b'a'; 32757])
                .unwrap()
                .len(),
            32757
        );

        // Long enough to trip the wide conversion itself: the fallible form
        // reports TooLong where the legacy infallible form fail-safes to "".
        let far_over = vec![b'a'; 40_000];
        assert_eq!(
            try_to_kernel32_path(&mut wbuf, &far_over).err(),
            Some(WidePathError::TooLong)
        );
        assert_eq!(to_kernel32_path(&mut wbuf, &far_over).len(), 0);
    }

    #[test]
    fn try_to_paths_reject_malformed_wtf8() {
        // quirk: FSIO-42
        // Stray continuation byte: genuinely malformed (unlike a lone
        // surrogate, which is valid WTF-8 and converts).
        let bad: &[u8] = b"C:\\\x80x";
        let mut wbuf = [0u16; 32];
        assert_eq!(
            try_to_kernel32_path(&mut wbuf, bad).err(),
            Some(WidePathError::Invalid)
        );
        assert_eq!(
            try_to_nt_path(&mut wbuf, bad).err(),
            Some(WidePathError::Invalid)
        );
        // The legacy lenient form still converts (U+FFFD), unchanged.
        assert!(to_kernel32_path(&mut wbuf, bad).len() > 0);
    }

    #[test]
    fn try_to_nt_path_prefixes_drive_paths() {
        let mut wbuf = [0u16; 32];
        let wide = try_to_nt_path(&mut wbuf, b"C:\\x").unwrap();
        let expected: Vec<u16> = "\\??\\C:\\x".encode_utf16().collect();
        assert_eq!(wide.as_slice(), &expected[..]);
    }

    #[test]
    fn copy_wtf16_into_wtf8_diverges_from_utf8_on_lone_surrogates() {
        // quirk: FSIO-40
        // The intentional difference: WTF-8 passthrough vs U+FFFD.
        let mut wtf8 = [0u8; 8];
        let r = strings::copy_wtf16_into_wtf8(&mut wtf8, &[0xD800]);
        assert_eq!((r.read, r.written), (1, 3));
        assert_eq!(&wtf8[..3], b"\xED\xA0\x80");

        let mut utf8 = [0u8; 8];
        let r = strings::copy_utf16_into_utf8(&mut utf8, &[0xD800]);
        assert_eq!((r.read, r.written), (1, 3));
        assert_eq!(&utf8[..3], b"\xEF\xBF\xBD");

        // Well-formed pairs combine identically in both.
        let pair = [0xD83D, 0xDE00]; // U+1F600
        let mut a = [0u8; 8];
        let mut b = [0u8; 8];
        let ra = strings::copy_wtf16_into_wtf8(&mut a, &pair);
        let rb = strings::copy_utf16_into_utf8(&mut b, &pair);
        assert_eq!((ra.read, ra.written), (2, 4));
        assert_eq!((rb.read, rb.written), (2, 4));
        assert_eq!(&a[..4], b"\xF0\x9F\x98\x80");
        assert_eq!(&a[..4], &b[..4]);
    }

    #[test]
    fn convert_wtf16_to_wtf8_append_preserves_lone_surrogates() {
        // quirk: FSIO-40
        // simdutf fast path (valid input)…
        let mut list = b"x".to_vec();
        let valid: Vec<u16> = "a\u{4E16}".encode_utf16().collect();
        strings::convert_wtf16_to_wtf8_append(&mut list, &valid);
        assert_eq!(list, b"xa\xE4\xB8\x96");
        // …and the scalar WTF-8 fallback on a lone surrogate.
        let mut list = Vec::new();
        strings::convert_wtf16_to_wtf8_append(&mut list, &[u16::from(b'a'), 0xD800, 0x4E16]);
        assert_eq!(list, b"a\xED\xA0\x80\xE4\xB8\x96");
    }

    // Pure-closure coverage of the Win32 two-call grow probe (no FFI).
    // quirk: SIGEV-33, OS-19
    #[cfg(windows)]
    mod grow_probe {
        use bun_core::util::{ProbeResult, win32_grow_probe};

        #[test]
        fn zero_return_fails() {
            let mut stack = [0u16; 4];
            let mut heap = Vec::new();
            assert!(matches!(
                win32_grow_probe(&mut stack, &mut heap, |_| 0),
                ProbeResult::Failed
            ));
            assert!(heap.is_empty());
        }

        #[test]
        fn fits_in_stack() {
            let mut stack = [0u16; 8];
            let mut heap = Vec::new();
            let r = win32_grow_probe(&mut stack, &mut heap, |buf| {
                buf[..3].copy_from_slice(&[7, 8, 9]);
                3
            });
            match r {
                ProbeResult::Done(s) => assert_eq!(s[..], [7u16, 8, 9]),
                ProbeResult::Failed => panic!("expected Done"),
            }
            assert!(heap.is_empty());
        }

        #[test]
        fn grows_then_fits() {
            let mut stack = [0u16; 4];
            let mut heap = Vec::new();
            let mut calls = 0u32;
            let r = win32_grow_probe(&mut stack, &mut heap, |buf| {
                calls += 1;
                // Too small → required size *incl.* NUL (14).
                if buf.len() < 14 {
                    return 14;
                }
                for (i, c) in buf[..13].iter_mut().enumerate() {
                    *c = i as u16;
                }
                13
            });
            match r {
                ProbeResult::Done(s) => {
                    assert_eq!(s.len(), 13);
                    assert_eq!(s[12], 12);
                }
                ProbeResult::Failed => panic!("expected Done"),
            }
            assert_eq!(calls, 2);
            assert_eq!(heap.len(), 14);
        }

        #[test]
        fn return_equal_to_len_means_grow() {
            // ret == buf.len() is the required-size sentinel, not success.
            let mut stack = [0u16; 4];
            let mut heap = Vec::new();
            let mut heap_calls = 0u32;
            let r = win32_grow_probe(&mut stack, &mut heap, |buf| {
                if buf.len() < 6 {
                    return 6;
                }
                heap_calls += 1;
                if heap_calls == 1 { 6 } else { 5 }
            });
            match r {
                ProbeResult::Done(s) => assert_eq!(s.len(), 5),
                ProbeResult::Failed => panic!("expected Done"),
            }
            assert_eq!(heap_calls, 2);
        }

        #[test]
        fn unbounded_growth_fails() {
            let mut stack = [0u16; 4];
            let mut heap = Vec::new();
            let mut calls = 0u32;
            let r = win32_grow_probe(&mut stack, &mut heap, |buf| {
                calls += 1;
                (buf.len() as u32) * 2
            });
            assert!(matches!(r, ProbeResult::Failed));
            // 1 stack probe + the 8 bounded heap rounds.
            assert_eq!(calls, 9);
        }
    }

    #[test]
    fn fits_in_wide_path_buffer_bounds() {
        // PATH_MAX_WIDE (32767) minus the 10-unit overhead (`\??\UNC\` +
        // trailing slash + NUL) = 32757 is the largest accepted size.
        assert!(fits_in_wide_path_buffer(&vec![b'a'; 32757]));
        assert!(!fits_in_wide_path_buffer(&vec![b'a'; 32758]));

        // Long in bytes but short in UTF-16 units: 3-byte chars count once,
        // so the exact length must be computed, not the byte length.
        let cjk: Vec<u8> = "世".repeat(20000).into_bytes(); // 60000 B, 20000 u16
        assert!(fits_in_wide_path_buffer(&cjk));
        let cjk_long: Vec<u8> = "世".repeat(32758).into_bytes();
        assert!(!fits_in_wide_path_buffer(&cjk_long));
        // The largest fitting valid path in bytes: 32757 3-byte units.
        let cjk_max: Vec<u8> = "世".repeat(32757).into_bytes(); // 98271 B
        assert!(fits_in_wide_path_buffer(&cjk_max));

        // Malformed bytes: simdutf's length is an estimate there (stray
        // continuation bytes count zero yet convert to one U+FFFD unit
        // each), so the check stays permissive for such input and the
        // bounds-checked conversion fails safe downstream instead
        // (`to_w_path_overlong_invalid_utf8_yields_empty`). The byte cap
        // still rejects anything no fitting path could occupy.
        assert!(!fits_in_wide_path_buffer(&vec![0x80u8; 98300]));
        assert!(fits_in_wide_path_buffer(&vec![0x80u8; 32758]));
        assert!(fits_in_wide_path_buffer(&vec![0x80u8; 32757]));
    }
}
