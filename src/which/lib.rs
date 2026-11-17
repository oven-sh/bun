#![warn(unused_must_use)]
#![forbid(unsafe_code)]
use bstr::BStr;
#[cfg(windows)]
use bun_core::w;
use bun_core::{ZStr, strings};
#[cfg(not(windows))]
use bun_paths::DELIMITER;
#[cfg(windows)]
use bun_paths::posix_to_platform_in_place;
#[cfg(windows)]
use bun_paths::w_path_buffer_pool;
use bun_paths::{MAX_PATH_BYTES, PathBuffer, SlicePath, is_absolute};
#[cfg(windows)]
use bun_paths::{Path, PoolPath, WPathBuffer};

#[allow(non_upper_case_globals)]
mod scope {
    bun_core::declare_scope!(which, hidden);
}
use scope::which as which_log;

/// Writes `[cwd/]segment/bin` into `buf`, each part as it is spelled. `None` unless that is an executable.
#[cfg(not(windows))]
fn executable_at<'a>(
    buf: &'a mut PathBuffer,
    cwd: &[u8],
    segment: &[u8],
    bin: &[u8],
) -> Option<&'a ZStr> {
    let mut path = SlicePath::new(buf);
    for part in [cwd, segment, bin] {
        path.push_trailing_sep().ok()?;
        path.extend_from_slice(part).ok()?;
    }
    bun_sys::is_executable_file_path(&path).then(|| path.into_zstr())
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
            let spells_executable_extension = ends_with_extension(bin);
            let extensions: &[&[u16]] = if spells_executable_extension {
                &[]
            } else {
                &WIN_EXTENSIONS_W
            };
            if let Some(found) = search_bin_in_path(
                &mut *convert_buf,
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
            let found =
                search_bin_in_path(&mut *convert_buf, cwd, bin, false, &WIN_COM_EXTENSION_W)?;
            posix_to_platform_in_place(found);
            return Some(utf16_result_into(buf, found));
        }
    }
    which(buf, path, cwd, bin)
}

/// Writes `result` into `buf` as NUL-terminated UTF-8.
#[cfg(windows)]
fn utf16_result_into<'a>(buf: &'a mut PathBuffer, result: &[u16]) -> &'a ZStr {
    let mut path = SlicePath::new(buf);
    path.set(result).expect("a wide path fits a path buffer");
    path.into_zstr()
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

        // Do not look absolute paths in $PATH
        if is_absolute(bin) {
            return executable_at(buf, b"", b"", bin);
        }

        let cwd_trimmed = bun_paths::without_trailing_sep(cwd);

        // Do not lookup paths with slashes in $PATH
        if strings::contains_char(bin, b'/') {
            if cwd.is_empty() {
                return None;
            }
            return executable_at(
                buf,
                b"",
                cwd_trimmed,
                bun_paths::without_leading_dot_slash(bin),
            );
        }

        let cwd_for_relative_segment: &[u8] = if is_absolute(cwd) { cwd_trimmed } else { b"" };
        for segment in strings::tokenize(path, &[DELIMITER]) {
            // execvp resolves relative $PATH entries after the child's chdir.
            let cwd_prefix: &[u8] = if is_absolute(segment) {
                b""
            } else {
                cwd_for_relative_segment
            };
            if let Some(found) = executable_at(buf, cwd_prefix, segment, bin) {
                return Some(found);
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

#[cfg(windows)]
type WideSlicePath<'a> = bun_paths::GenericPath<bun_paths::SliceBackend<'a, u16>>;

/// Stats `path` as spelled, then with each of `extensions` appended. Returns the length of what exists.
#[cfg(windows)]
fn search_bin(
    mut path: WideSlicePath<'_>,
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> Option<usize> {
    if try_as_spelled && bun_sys::exists_os_path(&path, true) {
        return Some(path.len());
    }
    path.extend_from_slice(b".").ok()?;
    let len = path.len();
    extensions.iter().find_map(|extension| {
        path.truncate(len);
        path.extend_from_slice(extension).ok()?;
        bun_sys::exists_os_path(&path, true).then(|| path.len())
    })
}

/// Check if bin file exists in this path (internally used by which_win)
#[cfg(windows)]
fn search_bin_in_path<'a>(
    buf: &'a mut WPathBuffer,
    path: &[u8],
    bin: &[u8],
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> Option<&'a mut [u16]> {
    if path.is_empty() {
        return None;
    }
    let mut segment = Path::from(path);
    segment.add_current_drive();
    let mut candidate = WideSlicePath::new(buf);
    (candidate.set(bun_paths::without_trailing_sep(&segment))).ok()?;
    candidate.push_trailing_sep().ok()?;
    candidate.extend_from_slice(bin).ok()?;
    let len = search_bin(candidate, try_as_spelled, extensions)?;
    Some(&mut buf[..len])
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
        let mut normalized_bin = PoolPath::from(bin).ok()?;
        normalized_bin.add_current_drive().ok()?;
        let mut candidate = WideSlicePath::new(buf);
        candidate.set(&normalized_bin).ok()?;
        let len = search_bin(candidate, try_as_spelled, extensions)?;
        return Some(&buf[..len]);
    }

    // check if bin is in cwd
    if has_dir {
        if let Some(bin_path) = search_bin_in_path(
            buf,
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
        return search_bin_in_path_list(buf, path, bin, true, &[]).map(|w| &*w);
    }
    if let Some(bin_path) = search_bin_in_path_list(buf, path, bin, false, &WIN_EXTENSIONS_W) {
        return Some(&*bin_path);
    }
    search_bin_in_path_list(buf, path, bin, false, &WIN_COM_EXTENSION_W).map(|w| &*w)
}

/// `search_bin_in_path` over every `;`-separated directory of `path`.
#[cfg(windows)]
fn search_bin_in_path_list<'a>(
    buf: &'a mut WPathBuffer,
    path: &[u8],
    bin: &[u8],
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> Option<&'a mut [u16]> {
    for segment_part in strings::tokenize(path, b";") {
        if let Some(bin_path) =
            search_bin_in_path(buf, segment_part, bin, try_as_spelled, extensions)
        {
            return Some(bin_path);
        }
    }
    None
}
