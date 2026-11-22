#![warn(unused_must_use)]
#![forbid(unsafe_code)]
use bstr::BStr;
use bun_core::strings;
#[cfg(windows)]
use bun_core::w;
#[cfg(not(windows))]
use bun_paths::DELIMITER;
use bun_paths::{MAX_PATH_BYTES, Path, is_absolute};
#[cfg(windows)]
use bun_paths::{OSPath, to_native_in_place};

#[allow(non_upper_case_globals)]
mod scope {
    bun_core::declare_scope!(which, hidden);
}
use scope::which as which_log;

/// Sets `path` to `[cwd/]segment/bin`, each part as it is spelled. Returns whether that is an executable.
#[cfg(not(windows))]
fn is_executable_at(path: &mut Path, cwd: &[u8], segment: &[u8], bin: &[u8]) -> bool {
    path.clear();
    for part in [cwd, segment, bin] {
        path.push_trailing_sep();
        path.extend_from_slice(part);
    }
    bun_sys::is_executable_file_path(path)
}

/// `which()` for spawn-style executable resolution. Windows resolves bare
/// names against the working directory before `$PATH` (CreateProcessW search
/// order; libuv and Node.js spawn behave the same), unlike `which()` which is
/// `$PATH`-only for bare names on every platform.
pub fn which_for_spawn(path: &[u8], cwd: &[u8], bin: &[u8]) -> Option<Path> {
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
            let mut found = OSPath::new();
            let spells_executable_extension = ends_with_extension(bin);
            let extensions: &[&[u16]] = if spells_executable_extension {
                &[]
            } else {
                &WIN_EXTENSIONS_W
            };
            if search_bin_in_path(
                &mut found,
                cwd,
                bin,
                spells_executable_extension,
                extensions,
            ) {
                to_native_in_place(found.as_mut_slice());
                return Some(Path::from(&found));
            }
            if which_win(&mut found, path, cwd, bin) {
                return Some(Path::from(&found));
            }
            if spells_executable_extension
                || !search_bin_in_path(&mut found, cwd, bin, false, &WIN_COM_EXTENSION_W)
            {
                return None;
            }
            to_native_in_place(found.as_mut_slice());
            return Some(Path::from(&found));
        }
    }
    which(path, cwd, bin)
}

// Like /usr/bin/which but without needing to exec a child process
// Remember to resolve the symlink if necessary
pub fn which(path: &[u8], cwd: &[u8], bin: &[u8]) -> Option<Path> {
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
        let mut found = OSPath::new();
        return which_win(&mut found, path, cwd, bin).then(|| Path::from(&found));
    }

    #[cfg(not(windows))]
    {
        if bin.is_empty() {
            return None;
        }

        let mut found = Path::new();

        // Do not look absolute paths in $PATH
        if is_absolute(bin) {
            return is_executable_at(&mut found, b"", b"", bin).then_some(found);
        }

        let cwd_trimmed = bun_paths::without_trailing_sep(cwd);

        // Do not lookup paths with slashes in $PATH
        if strings::contains_char(bin, b'/') {
            if cwd.is_empty() {
                return None;
            }
            let bin = bun_paths::without_leading_dot_slash(bin);
            return is_executable_at(&mut found, b"", cwd_trimmed, bin).then_some(found);
        }

        let cwd_for_relative_segment: &[u8] = if is_absolute(cwd) { cwd_trimmed } else { b"" };
        for segment in strings::tokenize(path, &[DELIMITER]) {
            // execvp resolves relative $PATH entries after the child's chdir.
            let cwd_prefix: &[u8] = if is_absolute(segment) {
                b""
            } else {
                cwd_for_relative_segment
            };
            if is_executable_at(&mut found, cwd_prefix, segment, bin) {
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
/// These run through `cmd.exe`, which re-tokenizes the
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
/// out of MSVCRT-style quoting, `%` expands environment variables
/// even inside quotes, and the rest are command separators / redirection /
/// escape characters in unquoted positions. None of these can be escaped for
/// `cmd.exe`, so callers must reject the spawn instead.
pub fn batch_arg_has_cmd_metachars(arg: &[u8]) -> bool {
    strings::contains_any(arg, b"\"%&|<>^\r\n")
}

/// Stats `path` as spelled, then with each of `extensions` appended. `path` is left at what exists.
#[cfg(windows)]
fn search_bin(path: &mut OSPath, try_as_spelled: bool, extensions: &[&[u16]]) -> bool {
    if try_as_spelled && bun_sys::exists_os_path(path, true) {
        return true;
    }
    path.extend_from_slice(b".");
    let len = path.len();
    extensions.iter().any(|extension| {
        path.truncate(len);
        path.extend_from_slice(extension);
        bun_sys::exists_os_path(path, true)
    })
}

/// Check if bin file exists in this path (internally used by which_win)
#[cfg(windows)]
fn search_bin_in_path(
    found: &mut OSPath,
    path: &[u8],
    bin: &[u8],
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> bool {
    if path.is_empty() {
        return false;
    }
    let mut segment = Path::from(path);
    segment.add_current_drive();
    found.set(bun_paths::without_trailing_sep(&segment));
    found.push_trailing_sep();
    found.extend_from_slice(bin);
    search_bin(found, try_as_spelled, extensions)
}

/// This is the windows version of `which`.
/// It operates on wide strings.
/// It is similar to Get-Command in powershell.
#[cfg(windows)]
fn which_win(found: &mut OSPath, path: &[u8], cwd: &[u8], bin: &[u8]) -> bool {
    if bin.is_empty() {
        return false;
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
        let mut normalized_bin = Path::from(bin);
        normalized_bin.add_current_drive();
        found.set(&normalized_bin);
        return search_bin(found, try_as_spelled, extensions);
    }

    // check if bin is in cwd. Do not lookup paths with slashes in $PATH
    if has_dir {
        let bin = strings::without_prefix_comptime(bin, b"./");
        let exists = search_bin_in_path(found, cwd, bin, try_as_spelled, extensions);
        to_native_in_place(found.as_mut_slice());
        return exists;
    }

    // `.com` gets its own pass once every directory failed `.exe`/`.cmd`/`.bat`.
    if spells_executable_extension {
        return search_bin_in_path_list(found, path, bin, true, &[]);
    }
    search_bin_in_path_list(found, path, bin, false, &WIN_EXTENSIONS_W)
        || search_bin_in_path_list(found, path, bin, false, &WIN_COM_EXTENSION_W)
}

/// `search_bin_in_path` over every `;`-separated directory of `path`.
#[cfg(windows)]
fn search_bin_in_path_list(
    found: &mut OSPath,
    path: &[u8],
    bin: &[u8],
    try_as_spelled: bool,
    extensions: &[&[u16]],
) -> bool {
    strings::tokenize(path, b";")
        .any(|dir| search_bin_in_path(found, dir, bin, try_as_spelled, extensions))
}
