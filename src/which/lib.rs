#![warn(unused_must_use)]
use bstr::BStr;
#[cfg(windows)]
use bun_core::{WStr, w};
use bun_core::{ZStr, strings};
#[cfg(not(windows))]
use bun_paths::DELIMITER;
#[cfg(windows)]
use bun_paths::resolve_path::PosixToWinNormalizer;
#[cfg(windows)]
use bun_paths::resolve_path::posix_to_platform_in_place;
#[cfg(windows)]
use bun_paths::w_path_buffer_pool;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SEP, is_absolute};
#[cfg(windows)]
use bun_paths::{WPathBuffer, path_buffer_pool};

#[allow(non_upper_case_globals)]
mod scope {
    bun_core::declare_scope!(which, hidden);
}
use scope::which as which_log;

/// Writes `[cwd/]segment/bin\0` into `buf` and stats it as an executable.
#[cfg(not(windows))]
fn is_valid(buf: &mut PathBuffer, cwd: &[u8], segment: &[u8], bin: &[u8]) -> Option<u16> {
    fn len_with_sep(part: &[u8]) -> usize {
        match part.last() {
            None => 0,
            Some(&SEP) => part.len(),
            Some(_) => part.len() + 1,
        }
    }
    let cwd_prefix_len = len_with_sep(cwd);
    let prefix_len = cwd_prefix_len + len_with_sep(segment);
    let len = prefix_len + bin.len();
    let len_z = len + 1; // includes null terminator
    if len_z > MAX_PATH_BYTES {
        return None;
    }

    buf[..cwd.len()].copy_from_slice(cwd);
    if cwd_prefix_len > cwd.len() {
        buf[cwd.len()] = SEP;
    }
    buf[cwd_prefix_len..cwd_prefix_len + segment.len()].copy_from_slice(segment);
    if prefix_len > cwd_prefix_len + segment.len() {
        buf[cwd_prefix_len + segment.len()] = SEP;
    }
    buf[prefix_len..prefix_len + bin.len()].copy_from_slice(bin);
    buf[len] = 0;
    // SAFETY: buf[len] == 0 written above
    let filepath = ZStr::from_buf(&buf[..], len);
    if !bun_sys::is_executable_file_path(filepath) {
        return None;
    }
    Some(u16::try_from(filepath.len()).expect("int cast"))
}

/// `which()` for spawn-style executable resolution. Windows resolves bare
/// names against the working directory before `$PATH` (CreateProcessW search
/// order; libuv and Node.js spawn behave the same), unlike `which()` which is
/// `$PATH`-only for bare names on every platform.
pub fn which_for_spawn<'a>(
    buf: &'a mut PathBuffer,
    path: &[u8],
    cwd: &[u8],
    bin: &[u8],
) -> Option<&'a ZStr> {
    #[cfg(windows)]
    {
        let has_sep = strings::contains_any(bin, b"/\\");
        // The NoDefaultCurrentDirectoryInExePath env var is Windows' standard
        // binary-planting opt-out; libuv gates its cwd search on it via
        // NeedCurrentDirectoryForExePathW (libuv/libuv#3895), so spawn must too.
        if !bin.is_empty()
            && bin.len() < MAX_PATH_BYTES
            && !has_sep
            && !is_absolute(bin)
            && !cwd.is_empty()
            && std::env::var_os("NoDefaultCurrentDirectoryInExePath").is_none()
        {
            // One more `$PATH` directory: .exe/.cmd/.bat before the walk, .com after it.
            let mut convert_buf = w_path_buffer_pool::get();
            let mut path_buf = path_buffer_pool::get();
            let spells_executable_extension = ends_with_extension(bin);
            let extensions: &[&[u16]] = if spells_executable_extension {
                &[]
            } else {
                &WIN_EXTENSIONS_W
            };
            if let Some(found) = search_bin_in_path(
                &mut *convert_buf,
                &mut *path_buf,
                cwd,
                bin,
                spells_executable_extension,
                extensions,
            ) {
                posix_to_platform_in_place(found);
                return Some(utf16_result_into(buf, found));
            }
            if let Some(found) = which_win(&mut *convert_buf, path, cwd, bin) {
                return Some(utf16_result_into(buf, found));
            }
            if spells_executable_extension {
                return None;
            }
            let found = search_bin_in_path(
                &mut *convert_buf,
                &mut *path_buf,
                cwd,
                bin,
                false,
                &WIN_COM_EXTENSION_W,
            )?;
            posix_to_platform_in_place(found);
            return Some(utf16_result_into(buf, found));
        }
    }
    which(buf, path, cwd, bin)
}

/// Writes `result` into `buf` as NUL-terminated UTF-8.
#[cfg(windows)]
fn utf16_result_into<'a>(buf: &'a mut PathBuffer, result: &[u16]) -> &'a ZStr {
    let result_converted = bun_core::strings::convert_utf16_to_utf8_in_buffer(&mut buf[..], result);
    // Capture len/ptr before re-borrowing buf (borrowck).
    let result_converted_len = result_converted.len();
    let result_converted_ptr = result_converted.as_ptr();
    buf[result_converted_len] = 0;
    debug_assert!(result_converted_ptr == buf.as_ptr());
    // SAFETY: buf[result_converted_len] == 0 written above
    ZStr::from_buf(&buf[..], result_converted_len)
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which<'a>(buf: &'a mut PathBuffer, path: &[u8], cwd: &[u8], bin: &[u8]) -> Option<&'a ZStr> {
    if bin.len() >= MAX_PATH_BYTES {
        return None;
    }
    bun_core::scoped_log!(
        which_log,
        "path={} cwd={} bin={}",
        BStr::new(path),
        BStr::new(cwd),
        BStr::new(bin)
    );

    #[cfg(windows)]
    {
        let mut convert_buf = w_path_buffer_pool::get();
        let result = which_win(&mut *convert_buf, path, cwd, bin)?;
        return Some(utf16_result_into(buf, result));
    }

    #[cfg(not(windows))]
    {
        if bin.is_empty() {
            return None;
        }

        // handle absolute paths
        if is_absolute(bin) {
            buf[..bin.len()].copy_from_slice(bin);
            buf[bin.len()] = 0;
            // SAFETY: buf[bin.len()] == 0 written above
            let bin_z = unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), bin.len()) };
            if bun_sys::is_executable_file_path(&*bin_z) {
                return Some(&*bin_z);
            }
            // Do not look absolute paths in $PATH
            return None;
        }

        // Strip trailing SEP bytes from cwd, keeping a bare "/".
        let mut cwd_trimmed = cwd;
        while cwd_trimmed.len() > 1 && cwd_trimmed.last() == Some(&SEP) {
            cwd_trimmed = &cwd_trimmed[..cwd_trimmed.len() - 1];
        }

        if strings::index_of_char(bin, b'/').is_some() {
            if !cwd.is_empty() {
                if let Some(len) = is_valid(
                    buf,
                    b"",
                    cwd_trimmed,
                    strings::without_prefix_comptime(bin, b"./"),
                ) {
                    // SAFETY: is_valid wrote NUL at buf[len]
                    return Some(ZStr::from_buf(&buf[..], len as usize));
                }
            }
            // Do not lookup paths with slashes in $PATH
            return None;
        }

        let cwd_for_relative_segment: &[u8] = if is_absolute(cwd) { cwd_trimmed } else { b"" };
        for segment in strings::tokenize(path, &[DELIMITER]) {
            // execvp resolves relative $PATH entries after the child's chdir.
            let cwd_prefix: &[u8] = if is_absolute(segment) {
                b""
            } else {
                cwd_for_relative_segment
            };
            if let Some(len) = is_valid(buf, cwd_prefix, segment, bin) {
                // SAFETY: is_valid wrote NUL at buf[len]
                return Some(ZStr::from_buf(&buf[..], len as usize));
            }
        }

        None
    }
}

#[cfg(windows)]
static WIN_EXTENSIONS_W: [&[u16]; 3] = [w!("exe"), w!("cmd"), w!("bat")];
/// Probed in a last pass over `$PATH`: the rare `.com` is not worth a stat per directory.
#[cfg(windows)]
static WIN_COM_EXTENSION_W: [&[u16]; 1] = [w!("com")];
#[cfg(windows)]
static WIN_ALL_EXTENSIONS_W: [&[u16]; 4] = [w!("exe"), w!("cmd"), w!("bat"), w!("com")];
const WIN_EXTENSIONS: [&[u8]; 4] = [b"exe", b"cmd", b"bat", b"com"];

pub(crate) fn ends_with_extension(str: &[u8]) -> bool {
    if str.len() < 4 {
        return false;
    }
    if str[str.len() - 4] != b'.' {
        return false;
    }
    let file_ext = &str[str.len() - 3..];
    for ext in WIN_EXTENSIONS {
        // all WIN_EXTENSIONS literals are 3 bytes
        if strings::eql_case_insensitive_asciii_check_length(file_ext, ext) {
            return true;
        }
    }
    false
}

/// libuv's `name_has_ext`: a `.` in the last component with something after it.
#[cfg(windows)]
fn has_extension(bin: &[u8]) -> bool {
    let name_start = strings::last_index_of_any(bin, b"/\\:").map_or(0, |i| i + 1);
    let name = &bin[name_start..];
    match strings::index_of_char_usize(name, b'.') {
        Some(dot) => dot + 1 < name.len(),
        None => false,
    }
}

/// `C:\Windows\System32\chcp.com`: nothing to complete, spawn skips the lookup.
pub fn is_windows_path_with_executable_extension(bin: &[u8]) -> bool {
    strings::contains_any(bin, b"/\\") && ends_with_extension(bin)
}

/// Returns true when `path` names a Windows batch script (`.cmd` / `.bat`).
///
/// `CreateProcessW` runs these through `cmd.exe`, which re-tokenizes the
/// command line with shell metacharacter rules ("BatBadBut",
/// CVE-2024-24576 / CVE-2024-27980). Spawn paths must not pass untrusted
/// arguments to one without checking [`batch_arg_has_cmd_metachars`].
pub fn is_batch_file(path: &[u8]) -> bool {
    // Windows strips trailing ASCII spaces and periods from the final path
    // component, so `foo.cmd.` / `foo.cmd ` still run `foo.cmd` through
    // cmd.exe (CVE-2024-43402). Trim them before checking the extension.
    let mut end = path.len();
    while end > 0 && matches!(path[end - 1], b' ' | b'.') {
        end -= 1;
    }
    if end < 4 || path[end - 4] != b'.' {
        return false;
    }
    let file_ext = &path[end - 3..end];
    strings::eql_case_insensitive_asciii_check_length(file_ext, b"cmd")
        || strings::eql_case_insensitive_asciii_check_length(file_ext, b"bat")
}

/// Returns true when `arg` contains a byte `cmd.exe` would reinterpret while
/// re-tokenizing the command line of a `.bat`/`.cmd` invocation: `"` breaks
/// out of libuv's MSVCRT-style quoting, `%` expands environment variables
/// even inside quotes, and the rest are command separators / redirection /
/// escape characters in unquoted positions. None of these can be escaped for
/// `cmd.exe`, so callers must reject the spawn instead.
pub fn batch_arg_has_cmd_metachars(arg: &[u8]) -> bool {
    strings::contains_any(arg, b"\"%&|<>^\r\n")
}

/// Stats `buf[..path_size]` as spelled, then with each of `extensions` appended.
#[cfg(windows)]
fn search_bin<'a>(
    buf: &'a mut WPathBuffer,
    path_size: usize,
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> Option<&'a mut [u16]> {
    {
        if try_as_spelled {
            // SAFETY: caller wrote NUL at buf[path_size]
            if bun_sys::exists_os_path(WStr::from_buf(&buf[..], path_size), true) {
                return Some(&mut buf[..path_size]);
            }
        }

        if !extensions.is_empty() {
            buf[path_size] = b'.' as u16;
            for ext in extensions {
                let end = path_size + 1 + ext.len();
                buf[path_size + 1..end].copy_from_slice(ext);
                buf[end] = 0;
                // SAFETY: buf[end] == 0 written above
                if bun_sys::exists_os_path(WStr::from_buf(&buf[..], end), true) {
                    return Some(&mut buf[..end]);
                }
            }
        }
        None
    }
}

/// Check if bin file exists in this path (internally used by which_win)
#[cfg(windows)]
fn search_bin_in_path<'a>(
    buf: &'a mut WPathBuffer,
    path_buf: &mut PathBuffer,
    path: &[u8],
    bin: &[u8],
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> Option<&'a mut [u16]> {
    if path.is_empty() {
        return None;
    }
    let segment: &[u8] = if is_absolute(path) {
        match PosixToWinNormalizer::resolve_cwd_with_external_buf(path_buf, path) {
            Ok(s) => s,
            Err(_) => return None,
        }
    } else {
        path
    };
    let tail_units = if extensions.is_empty() { 1 } else { 5 };
    if segment.len() + 1 + bin.len() + tail_units > buf.len()
        && bun_core::strings::element_length_utf8_into_utf16(segment)
            + 1
            + bun_core::strings::element_length_utf8_into_utf16(bin)
            + tail_units
            > buf.len()
    {
        return None;
    }
    let segment_utf16 = bun_core::strings::convert_utf8_to_utf16_in_buffer(
        &mut buf[..],
        bun_core::strings::without_trailing_slash(segment),
    );
    // Capture len before re-borrowing buf (borrowck).
    let segment_utf16_len = segment_utf16.len();

    buf[segment_utf16_len] = SEP as u16;

    let bin_utf16 =
        bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut buf[segment_utf16_len + 1..], bin);
    let path_size = segment_utf16_len + 1 + bin_utf16.len();
    buf[path_size] = 0;

    search_bin(buf, path_size, try_as_spelled, extensions)
}

/// This is the windows version of `which`.
/// It operates on wide strings.
/// It is similar to Get-Command in powershell.
#[cfg(windows)]
pub(crate) fn which_win<'a>(
    buf: &'a mut WPathBuffer,
    path: &[u8],
    cwd: &[u8],
    bin: &[u8],
) -> Option<&'a [u16]> {
    if bin.is_empty() {
        return None;
    }
    let mut path_buf = path_buffer_pool::get();

    let spells_executable_extension = ends_with_extension(bin);
    let has_dir = strings::contains_any(bin, b"/\\");
    // `bun run` puts the package dir on `$PATH`, so a bare `x.ts` must not match.
    let try_as_spelled = spells_executable_extension || (has_dir && has_extension(bin));
    let extensions: &[&[u16]] = if spells_executable_extension {
        &[]
    } else {
        &WIN_ALL_EXTENSIONS_W
    };

    // handle absolute paths
    if is_absolute(bin) {
        let normalized_bin =
            match PosixToWinNormalizer::resolve_cwd_with_external_buf(&mut *path_buf, bin) {
                Ok(s) => s,
                Err(_) => return None,
            };
        let bin_utf16 =
            bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut buf[..], normalized_bin);
        // Capture len before re-borrowing buf (borrowck).
        let bin_utf16_len = bin_utf16.len();
        buf[bin_utf16_len] = 0;
        return search_bin(buf, bin_utf16_len, try_as_spelled, extensions).map(|w| &*w);
    }

    // check if bin is in cwd
    if has_dir {
        // NLL/Polonius limitation — raw-ptr reborrow so the None branch can
        // fall through without `buf` appearing borrowed.
        // SAFETY: bin_path borrow does not escape this block on the None path.
        let buf_reborrow: &'a mut WPathBuffer =
            unsafe { &mut *std::ptr::from_mut::<WPathBuffer>(buf) };
        if let Some(bin_path) = search_bin_in_path(
            buf_reborrow,
            &mut *path_buf,
            cwd,
            strings::without_prefix_comptime(bin, b"./"),
            try_as_spelled,
            extensions,
        ) {
            posix_to_platform_in_place(bin_path);
            return Some(&*bin_path);
        }
        // Do not lookup paths with slashes in $PATH
        return None;
    }

    // `.com` gets its own pass once every directory failed `.exe`/`.cmd`/`.bat`.
    if spells_executable_extension {
        return search_bin_in_path_list(buf, &mut *path_buf, path, bin, true, &[]).map(|w| &*w);
    }
    // NLL/Polonius limitation — raw-ptr reborrow so the None branch can fall
    // through without `buf` appearing borrowed.
    // SAFETY: bin_path borrow does not escape this block on the None path.
    let buf_reborrow: &'a mut WPathBuffer = unsafe { &mut *std::ptr::from_mut::<WPathBuffer>(buf) };
    if let Some(bin_path) = search_bin_in_path_list(
        buf_reborrow,
        &mut *path_buf,
        path,
        bin,
        false,
        &WIN_EXTENSIONS_W,
    ) {
        return Some(&*bin_path);
    }
    search_bin_in_path_list(buf, &mut *path_buf, path, bin, false, &WIN_COM_EXTENSION_W)
        .map(|w| &*w)
}

/// `search_bin_in_path` over every `;`-separated directory of `path`.
#[cfg(windows)]
fn search_bin_in_path_list<'a>(
    buf: &'a mut WPathBuffer,
    path_buf: &mut PathBuffer,
    path: &[u8],
    bin: &[u8],
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> Option<&'a mut [u16]> {
    for segment_part in strings::tokenize(path, b";") {
        // NLL/Polonius limitation — re-borrowing `buf` across loop iterations
        // when returning a reference tied to its lifetime.
        // SAFETY: on None the borrow ends; on Some we return immediately.
        let buf_reborrow: &'a mut WPathBuffer =
            unsafe { &mut *std::ptr::from_mut::<WPathBuffer>(buf) };
        if let Some(bin_path) = search_bin_in_path(
            buf_reborrow,
            path_buf,
            segment_part,
            bin,
            try_as_spelled,
            extensions,
        ) {
            return Some(bin_path);
        }
    }
    None
}
