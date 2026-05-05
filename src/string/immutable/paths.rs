use bun_str::{strings, WStr, ZStr};
// MOVE_DOWN(b0): bun_sys::windows → bun_paths (path-prefix consts only).
use bun_paths::windows;

// Generic code-unit bound for fns that operate over both u8 and u16 paths.
// Zig used `comptime T: type`; the only operations needed are copy + compare-to-ASCII.
// TODO(port): if bun_str already exports a `PathChar`/`CodeUnit` trait, switch to it.
trait Ch: Copy + PartialEq + PartialOrd + From<u8> {}
impl Ch for u8 {}
impl Ch for u16 {}

#[inline(always)]
fn ch<T: Ch>(c: u8) -> T {
    T::from(c)
}

/// Checks if a path is missing a windows drive letter. For windows APIs,
/// this is used for an assertion, and PosixToWinNormalizer can help make
/// an absolute path contain a drive letter.
pub fn is_windows_absolute_path_missing_drive_letter<T: Ch>(chars: &[T]) -> bool {
    debug_assert!(bun_paths::Platform::Windows.is_absolute_t(chars));
    debug_assert!(!chars.is_empty());

    // 'C:\hello' -> false
    // This is the most common situation, so we check it first
    if !(chars[0] == ch(b'/') || chars[0] == ch(b'\\')) {
        debug_assert!(chars.len() > 2);
        debug_assert!(chars[1] == ch(b':'));
        return false;
    }

    if chars.len() > 4 {
        // '\??\hello' -> false (has the NT object prefix)
        if chars[1] == ch(b'?')
            && chars[2] == ch(b'?')
            && (chars[3] == ch(b'/') || chars[3] == ch(b'\\'))
        {
            return false;
        }
        // '\\?\hello' -> false (has the other NT object prefix)
        // '\\.\hello' -> false (has the NT device prefix)
        if (chars[1] == ch(b'/') || chars[1] == ch(b'\\'))
            && (chars[2] == ch(b'?') || chars[2] == ch(b'.'))
            && (chars[3] == ch(b'/') || chars[3] == ch(b'\\'))
        {
            return false;
        }
    }

    // A path starting with `/` can be a UNC path with forward slashes,
    // or actually just a posix path.
    //
    // '\\Server\Share' -> false (unc)
    // '\\Server\\Share' -> true (not unc because extra slashes)
    // '\Server\Share' -> true (posix path)
    bun_paths::windows_filesystem_root_t(chars).len() == 1
}

pub fn from_w_path<'a>(buf: &'a mut [u8], utf16: &[u16]) -> &'a ZStr {
    debug_assert!(!buf.is_empty());
    let to_copy = strings::trim_prefix_t::<u16>(utf16, &windows::LONG_PATH_PREFIX);
    let encode_into_result = strings::copy_utf16_into_utf8(&mut buf[..buf.len() - 1], to_copy);
    debug_assert!(encode_into_result.written < buf.len());
    buf[encode_into_result.written] = 0;
    // SAFETY: buf[encode_into_result.written] == 0 written above
    unsafe { ZStr::from_raw(buf.as_ptr(), encode_into_result.written) }
}

pub fn without_nt_prefix<T: Ch>(path: &[T]) -> &[T] {
    if !cfg!(windows) {
        return path;
    }
    // TODO(port): Zig dispatched hasPrefixComptime vs hasPrefixComptimeUTF16 on T;
    // assume bun_str::strings::has_prefix_ascii_t<T> handles both u8/u16 vs &[u8] literal.
    if strings::has_prefix_ascii_t(path, &windows::NT_OBJECT_PREFIX_U8) {
        return &path[windows::NT_OBJECT_PREFIX.len()..];
    }
    if strings::has_prefix_ascii_t(path, &windows::LONG_PATH_PREFIX_U8) {
        return &path[windows::LONG_PATH_PREFIX.len()..];
    }
    if strings::has_prefix_ascii_t(path, &windows::NT_UNC_OBJECT_PREFIX_U8) {
        return &path[windows::NT_UNC_OBJECT_PREFIX.len()..];
    }
    path
}

pub fn to_nt_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a mut WStr {
    if !bun_paths::is_absolute_windows(utf8) {
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
            // SAFETY: inner call wrote NUL at wbuf[prefix.len() + n] == wbuf[total]
            return unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), total) };
        }
        let prefix = windows::NT_UNC_OBJECT_PREFIX;
        wbuf[..prefix.len()].copy_from_slice(&prefix);
        let n = to_w_path_normalized(&mut wbuf[prefix.len()..], &utf8[2..]).len();
        let total = n + prefix.len();
        // SAFETY: inner call wrote NUL at wbuf[total]
        return unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), total) };
    }

    let prefix = windows::NT_OBJECT_PREFIX;
    wbuf[..prefix.len()].copy_from_slice(&prefix);
    let n = to_w_path_normalized(&mut wbuf[prefix.len()..], utf8).len();
    let total = n + prefix.len();
    // SAFETY: inner call wrote NUL at wbuf[total]
    unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), total) }
}

pub fn to_nt_path16<'a>(wbuf: &'a mut [u16], path: &[u16]) -> &'a mut WStr {
    if !bun_paths::is_absolute_windows_wtf16(path) {
        return to_w_path_normalized16(wbuf, path);
    }

    if strings::has_prefix_utf16(path, &windows::NT_OBJECT_PREFIX_U8)
        || strings::has_prefix_utf16(path, &windows::NT_UNC_OBJECT_PREFIX_U8)
    {
        return to_w_path_normalized16(wbuf, path);
    }

    if strings::has_prefix_utf16(path, b"\\\\") {
        if strings::has_prefix_utf16(&path[2..], &windows::LONG_PATH_PREFIX_U8[2..]) {
            let prefix = windows::NT_OBJECT_PREFIX;
            wbuf[..prefix.len()].copy_from_slice(&prefix);
            let n = to_w_path_normalized16(&mut wbuf[prefix.len()..], &path[4..]).len();
            let total = n + prefix.len();
            // SAFETY: inner call wrote NUL at wbuf[total]
            return unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), total) };
        }
        let prefix = windows::NT_UNC_OBJECT_PREFIX;
        wbuf[..prefix.len()].copy_from_slice(&prefix);
        let n = to_w_path_normalized16(&mut wbuf[prefix.len()..], &path[2..]).len();
        let total = n + prefix.len();
        // SAFETY: inner call wrote NUL at wbuf[total]
        return unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), total) };
    }

    let prefix = windows::NT_OBJECT_PREFIX;
    wbuf[..prefix.len()].copy_from_slice(&prefix);
    let n = to_w_path_normalized16(&mut wbuf[prefix.len()..], path).len();
    let total = n + prefix.len();
    // SAFETY: inner call wrote NUL at wbuf[total]
    unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), total) }
}

pub fn add_nt_path_prefix<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a mut WStr {
    let plen = windows::NT_OBJECT_PREFIX.len();
    wbuf[..plen].copy_from_slice(&windows::NT_OBJECT_PREFIX);
    wbuf[plen..plen + utf16.len()].copy_from_slice(utf16);
    wbuf[utf16.len() + plen] = 0;
    // SAFETY: wbuf[utf16.len() + plen] == 0 written above
    unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), utf16.len() + plen) }
}

pub fn add_long_path_prefix<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a mut WStr {
    let plen = windows::LONG_PATH_PREFIX.len();
    wbuf[..plen].copy_from_slice(&windows::LONG_PATH_PREFIX);
    wbuf[plen..plen + utf16.len()].copy_from_slice(utf16);
    wbuf[utf16.len() + plen] = 0;
    // SAFETY: wbuf[utf16.len() + plen] == 0 written above
    unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), utf16.len() + plen) }
}

pub fn add_nt_path_prefix_if_needed<'a>(wbuf: &'a mut [u16], utf16: &[u16]) -> &'a mut WStr {
    if strings::has_prefix_type::<u16>(utf16, &windows::NT_OBJECT_PREFIX) {
        wbuf[..utf16.len()].copy_from_slice(utf16);
        wbuf[utf16.len()] = 0;
        // SAFETY: wbuf[utf16.len()] == 0 written above
        return unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), utf16.len()) };
    }
    if strings::has_prefix_type::<u16>(utf16, &windows::LONG_PATH_PREFIX) {
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
    // SAFETY: inner call wrote NUL at wbuf[4 + n]
    unsafe { WStr::from_raw(wbuf.as_ptr(), n + 4) }
}

pub fn to_w_path_normalize_auto_extend<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    if bun_paths::is_absolute_windows(utf8) {
        return to_extended_path_normalized(wbuf, utf8);
    }

    to_w_path_normalized(wbuf, utf8)
}

pub fn to_w_path_normalized<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a mut WStr {
    let renormalized = bun_paths::path_buffer_pool().get();

    let mut path_to_use = normalize_slashes_only(&mut *renormalized, utf8, b'\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if path_to_use.len() > 3 && bun_paths::is_sep_any(path_to_use[path_to_use.len() - 1]) {
        path_to_use = &path_to_use[..path_to_use.len() - 1];
    }

    to_w_path(wbuf, path_to_use)
}

pub fn to_w_path_normalized16<'a>(wbuf: &'a mut [u16], path: &[u16]) -> &'a mut WStr {
    // PORT NOTE: reshaped for borrowck — Zig wrote into wbuf and then re-sliced wbuf;
    // here we capture the length and re-derive the mutable slice.
    let len = {
        let mut path_to_use = normalize_slashes_only_t::<u16, b'\\', true>(wbuf, path);

        // is there a trailing slash? Let's remove it before converting to UTF-16
        if path_to_use.len() > 3
            && bun_paths::is_sep_any_t::<u16>(path_to_use[path_to_use.len() - 1])
        {
            path_to_use = &path_to_use[..path_to_use.len() - 1];
        }
        path_to_use.len()
    };

    wbuf[len] = 0;

    // SAFETY: wbuf[len] == 0 written above
    unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), len) }
}

pub fn to_path_normalized<'a>(buf: &'a mut [u8], utf8: &[u8]) -> &'a ZStr {
    let renormalized = bun_paths::path_buffer_pool().get();

    let mut path_to_use = normalize_slashes_only(&mut *renormalized, utf8, b'\\');

    // is there a trailing slash? Let's remove it before converting to UTF-16
    if path_to_use.len() > 3 && bun_paths::is_sep_any(path_to_use[path_to_use.len() - 1]) {
        path_to_use = &path_to_use[..path_to_use.len() - 1];
    }

    to_path(buf, path_to_use)
}

pub fn normalize_slashes_only_t<'a, T: Ch, const DESIRED_SLASH: u8, const ALWAYS_COPY: bool>(
    buf: &'a mut [T],
    path: &'a [T],
) -> &'a [T] {
    const _: () = assert!(DESIRED_SLASH == b'/' || DESIRED_SLASH == b'\\');
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
pub fn normalize_slashes_only<'a>(buf: &'a mut [u8], utf8: &'a [u8], desired_slash: u8) -> &'a [u8] {
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

pub fn to_w_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a mut WStr {
    to_w_path_maybe_dir::<false>(wbuf, utf8)
}

pub fn to_path<'a>(buf: &'a mut [u8], utf8: &[u8]) -> &'a mut ZStr {
    to_path_maybe_dir::<false>(buf, utf8)
}

pub fn to_w_dir_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a WStr {
    to_w_path_maybe_dir::<true>(wbuf, utf8)
}

pub fn to_kernel32_path<'a>(wbuf: &'a mut [u16], utf8: &[u8]) -> &'a mut WStr {
    let path = if utf8.starts_with(&windows::NT_OBJECT_PREFIX_U8) {
        &utf8[windows::NT_OBJECT_PREFIX_U8.len()..]
    } else {
        utf8
    };
    if path.starts_with(&windows::LONG_PATH_PREFIX_U8) {
        return to_w_path(wbuf, path);
    }
    if utf8.len() > 2
        && bun_paths::is_drive_letter(utf8[0])
        && utf8[1] == b':'
        && bun_paths::is_sep_any(utf8[2])
    {
        wbuf[..4].copy_from_slice(&windows::LONG_PATH_PREFIX);
        let n = to_w_path(&mut wbuf[4..], path).len();
        // SAFETY: inner call wrote NUL at wbuf[4 + n]
        return unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), n + 4) };
    }
    to_w_path(wbuf, path)
}

fn is_unc_path<T: Ch>(path: &[T]) -> bool {
    path.len() >= 3
        && bun_paths::Platform::Windows.is_separator_t(path[0])
        && bun_paths::Platform::Windows.is_separator_t(path[1])
        && !bun_paths::Platform::Windows.is_separator_t(path[2])
        && path[2] != ch(b'.')
}

pub fn to_w_path_maybe_dir<'a, const ADD_TRAILING_LASH: bool>(
    wbuf: &'a mut [u16],
    utf8: &[u8],
) -> &'a mut WStr {
    debug_assert!(!wbuf.is_empty());

    let cap = wbuf
        .len()
        .saturating_sub(1 + (ADD_TRAILING_LASH as usize));
    let mut result = bun_simdutf::convert::utf8_to_utf16_le_with_errors(utf8, &mut wbuf[..cap]);

    // Many Windows APIs expect normalized path slashes, particularly when the
    // long path prefix is added or the nt object prefix. To make this easier,
    // but a little redundant, this function always normalizes the slashes here.
    //
    // An example of this is GetFileAttributesW(L"C:\\hello/world.txt") being OK
    // but GetFileAttributesW(L"\\\\?\\C:\\hello/world.txt") is NOT
    bun_paths::dangerously_convert_path_to_windows_in_place::<u16>(&mut wbuf[..result.count]);

    if ADD_TRAILING_LASH && result.count > 0 && wbuf[result.count - 1] != u16::from(b'\\') {
        wbuf[result.count] = u16::from(b'\\');
        result.count += 1;
    }

    wbuf[result.count] = 0;

    // SAFETY: wbuf[result.count] == 0 written above
    unsafe { WStr::from_raw_mut(wbuf.as_mut_ptr(), result.count) }
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
    // SAFETY: buf[len] == 0 written above
    unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) }
}

pub fn clone_normalizing_separators(input: &[u8]) -> Vec<u8> {
    // remove duplicate slashes in the file path
    let base = without_trailing_slash(input);
    let mut buf = vec![0u8; base.len() + 2];
    if cfg!(debug_assertions) {
        debug_assert!(!base.is_empty());
    }
    if base[0] == bun_paths::SEP {
        buf[0] = bun_paths::SEP;
    }
    // PORT NOTE: reshaped for borrowck — track index instead of moving slice ptr.
    let mut i: usize = (base[0] == bun_paths::SEP) as usize;

    for token in base.split(|b| *b == bun_paths::SEP).filter(|s| !s.is_empty()) {
        if token.is_empty() {
            continue;
        }
        buf[i..i + token.len()].copy_from_slice(token);
        buf[i + token.len()] = bun_paths::SEP;
        i += token.len() + 1;
    }
    if i >= 1 && buf[i - 1] != bun_paths::SEP {
        buf[i] = bun_paths::SEP;
        i += 1;
    }
    buf[i] = 0;

    buf.truncate(i);
    buf
}

pub fn path_contains_node_modules_folder(path: &[u8]) -> bool {
    // PERF(port): was comptime string concatenation
    let needle: &'static [u8] = const_format::concatcp!(
        bun_paths::SEP_STR,
        "node_modules",
        bun_paths::SEP_STR
    )
    .as_bytes();
    strings::index_of(path, needle).is_some()
}

#[inline(always)]
pub fn char_is_any_slash(char: u8) -> bool {
    char == b'/' || char == b'\\'
}

#[inline(always)]
pub fn starts_with_windows_drive_letter(s: &[u8]) -> bool {
    starts_with_windows_drive_letter_t(s)
}

#[inline(always)]
pub fn starts_with_windows_drive_letter_t<T: Ch>(s: &[T]) -> bool {
    s.len() > 2
        && s[1] == ch(b':')
        && {
            let c = s[0];
            (c >= ch(b'a') && c <= ch(b'z')) || (c >= ch(b'A') && c <= ch(b'Z'))
        }
}

pub fn without_trailing_slash(this: &[u8]) -> &[u8] {
    let mut href = this;
    while href.len() > 1
        && matches!(href[href.len() - 1], b'/' | b'\\')
    {
        href = &href[..href.len() - 1];
    }

    href
}

/// Does not strip the device root (C:\ or \\Server\Share\ portion off of the path)
pub fn without_trailing_slash_windows_path(input: &[u8]) -> &[u8] {
    if cfg!(unix) || input.len() < 3 || input[1] != b':' {
        return without_trailing_slash(input);
    }

    let root_len = bun_paths::windows_filesystem_root(input).len() + 1;

    let mut path = input;
    while path.len() > root_len
        && matches!(path[path.len() - 1], b'/' | b'\\')
    {
        path = &path[..path.len() - 1];
    }

    if cfg!(debug_assertions) {
        debug_assert!(
            !bun_paths::is_absolute(path)
                || !is_windows_absolute_path_missing_drive_letter::<u8>(path)
        );
    }

    path
}

pub fn without_leading_slash(this: &[u8]) -> &[u8] {
    strings::trim_left(this, b"/")
}

pub fn without_leading_path_separator(this: &[u8]) -> &[u8] {
    strings::trim_left(this, &[bun_paths::SEP])
}

#[inline(always)]
pub fn remove_leading_dot_slash(slice: &[u8]) -> &[u8] {
    if slice.len() >= 2 {
        // PERF(port): Zig bitcast slice[0..2] to u16 and compared against LE-encoded "./";
        // direct 2-byte slice comparison compiles to the same thing.
        if &slice[..2] == b"./" || (cfg!(windows) && &slice[..2] == b".\\") {
            return &slice[2..];
        }
    }
    slice
}

// Copied from std, modified to accept input type
pub fn basename<T: Ch>(input: &[T]) -> &[T] {
    #[cfg(windows)]
    {
        return basename_windows(input);
    }
    #[cfg(not(windows))]
    {
        basename_posix(input)
    }
}

fn basename_posix<T: Ch>(input: &[T]) -> &[T] {
    if input.is_empty() {
        return &[];
    }

    let mut end_index: usize = input.len() - 1;
    while input[end_index] == ch(b'/') {
        if end_index == 0 {
            return &[];
        }
        end_index -= 1;
    }
    let mut start_index: usize = end_index;
    end_index += 1;
    while input[start_index] != ch(b'/') {
        if start_index == 0 {
            return &input[..end_index];
        }
        start_index -= 1;
    }

    &input[start_index + 1..end_index]
}

fn basename_windows<T: Ch>(input: &[T]) -> &[T] {
    if input.is_empty() {
        return &[];
    }

    let mut end_index: usize = input.len() - 1;
    loop {
        let byte = input[end_index];
        if byte == ch(b'/') || byte == ch(b'\\') {
            if end_index == 0 {
                return &[];
            }
            end_index -= 1;
            continue;
        }
        if byte == ch(b':') && end_index == 1 {
            return &[];
        }
        break;
    }

    let mut start_index: usize = end_index;
    end_index += 1;
    while input[start_index] != ch(b'/')
        && input[start_index] != ch(b'\\')
        && !(input[start_index] == ch(b':') && start_index == 1)
    {
        if start_index == 0 {
            return &input[..end_index];
        }
        start_index -= 1;
    }

    &input[start_index + 1..end_index]
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable/paths.zig (486 lines)
//   confidence: medium
//   todos:      3
//   notes:      Generic Ch trait stands in for comptime T (u8/u16); several bun_paths/bun_str helper fn names assumed (has_prefix_ascii_t, is_absolute_windows, trim_left, contains_char_t); WStr/ZStr from_raw_mut used for all sentinel-slice returns.
// ──────────────────────────────────────────────────────────────────────────
