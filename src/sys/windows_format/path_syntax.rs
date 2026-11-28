//! Lexical operations on Win32 paths and NT names.

use bun_core::strings::{
    eql_case_insensitive_t, has_prefix_case_insensitive_t, last_index_of_char_t,
};
use bun_core::{WStr, w, wstr};
use bun_paths::portable::is_sep;

const BACKSLASH: u16 = b'\\' as u16;
const COLON: u16 = b':' as u16;
const DOT: u16 = b'.' as u16;
const QUESTION_MARK: u16 = b'?' as u16;

fn is_volume_device(path: &[u16]) -> bool {
    let [a, b, DOT | QUESTION_MARK, c, device @ ..] = path else {
        return false;
    };
    let component_count = device.split(|&unit| is_sep(unit)).count();
    [a, b, c].into_iter().all(|&unit| is_sep(unit))
        && (has_prefix_case_insensitive_t(device, b"Volume{") && component_count == 1
            || has_prefix_case_insensitive_t(device, b"GLOBALROOT") && component_count == 3)
}

/// Length of the Win32 path without one trailing separator. A volume root keeps its separator.
pub(crate) fn len_without_trailing_sep(path: &[u16]) -> usize {
    match path {
        [rest @ .., previous, last] if is_sep(*last) && *previous != COLON => {
            let len = rest.len() + 1;
            if is_volume_device(&path[..len]) {
                path.len()
            } else {
                len
            }
        }
        _ => path.len(),
    }
}

fn is_any_of(component: &[u16], names: &[&[u8]]) -> bool {
    names
        .iter()
        .any(|name| eql_case_insensitive_t(component, name))
}

/// Whether `nt_name` is a pipe, or a device that is not a drive and has no path below it.
pub(crate) fn is_device_name(nt_name: &[u16]) -> bool {
    const OBJECT_DIRECTORIES: &[&[u8]] = &[
        b"Global",
        b"GLOBALROOT",
        b"Device",
        b"??",
        b"GLOBAL??",
        b"DosDevices",
    ];
    let Some(name) = nt_name.strip_prefix(w!("\\??\\")) else {
        return false;
    };
    let mut components = name
        .split(|&unit| unit == BACKSLASH)
        .skip_while(|component| is_any_of(component, OBJECT_DIRECTORIES));
    let device = components.next().unwrap_or_default();
    if let [_, COLON, ..] = device {
        return false;
    }
    if is_any_of(device, &[b"pipe", b"NamedPipe"]) || components.clone().all(<[u16]>::is_empty) {
        return true;
    }
    let is_provider = |component: &&[u16]| component.starts_with(w!(";"));
    let share = components.skip_while(is_provider).nth(1);
    is_any_of(device, &[b"UNC", b"Mup", b"LanmanRedirector"])
        && share.is_some_and(|share| is_any_of(share, &[b"pipe", b"IPC$"]))
}

/// Maps the NT name of a console device to its Win32 path.
pub(crate) fn to_console_path(nt_name: &[u16]) -> Option<&'static WStr> {
    find_console_device(nt_name.strip_prefix(w!("\\??\\"))?)
}

pub(crate) fn is_console_path(full_path: &[u16]) -> bool {
    full_path
        .strip_prefix(w!("\\\\.\\"))
        .is_some_and(|device| find_console_device(device).is_some())
}

fn find_console_device(device: &[u16]) -> Option<&'static WStr> {
    let devices = [
        (&b"CON"[..], wstr!("\\\\.\\CON")),
        (b"CONIN$", wstr!("\\\\.\\CONIN$")),
        (b"CONOUT$", wstr!("\\\\.\\CONOUT$")),
    ];
    devices
        .into_iter()
        .find_map(|(name, path)| eql_case_insensitive_t(device, name).then_some(path))
}

/// Whether the Win32 path starts with `\\.\` or `\\?\`, or has no directory and no extension.
#[cfg(windows)]
pub(crate) fn is_device_path_or_stem(path: &[u8]) -> bool {
    match *path {
        [a, b, b'.' | b'?', c, ..] if [a, b, c].into_iter().all(is_sep) => true,
        _ => !bun_core::strings::contains_any(path, b"\\/."),
    }
}

/// `X:\a` for `\\?\X:\a`, and `\\s\t` for `\\?\UNC\s\t`.
pub(crate) fn strip_verbatim_prefix(path: &mut [u16]) -> Option<&[u16]> {
    if path.starts_with(w!("\\\\?\\UNC\\")) {
        path[6] = BACKSLASH;
        return Some(&path[6..]);
    }
    path.strip_prefix(w!("\\\\?\\"))
}

/// Returns a prefix and a remainder that concatenate to the verbatim form of `full_path`.
pub(crate) fn to_verbatim_parts(full_path: &[u8]) -> [&[u8]; 2] {
    match full_path {
        [b'\\', b'\\', b'.' | b'?', b'\\', rest @ ..] | [b'\\', b'?', b'?', b'\\', rest @ ..] => {
            [b"\\\\?\\", rest]
        }
        [b'\\', b'\\', rest @ ..] => [b"\\\\?\\UNC\\", rest],
        rest => [b"\\\\?\\", rest],
    }
}

/// Includes the trailing separator.
pub(crate) fn parent(nt_name: &[u16]) -> Option<&[u16]> {
    Some(&nt_name[..=last_index_of_char_t(nt_name, BACKSLASH)?])
}

/// The [`parent`], and a file name that matches only itself as a directory query pattern.
pub(crate) fn split_file_name(nt_name: &[u16]) -> Option<(&[u16], &[u16])> {
    let (directory, file_name) = nt_name.split_at(parent(nt_name)?.len());
    let is_literal = file_name.iter().all(|unit| !w!("*?<>\":").contains(unit));
    (!file_name.is_empty() && is_literal).then_some((directory, file_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_wide(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn len_excludes_trailing_sep_except_for_roots() {
        for path in [
            "a\\",
            "a//",
            "C:\\a\\",
            "\\\\s\\t\\",
            "\\\\.\\pipe\\",
            "\\\\?\\Volume{0}\\a\\",
            "Volume{0}\\",
        ] {
            assert_eq!(len_without_trailing_sep(&to_wide(path)), path.len() - 1);
        }
        for path in ["", "\\", "a", "C:", "C:/", "\\\\?\\C:\\"] {
            assert_eq!(len_without_trailing_sep(&to_wide(path)), path.len());
        }
    }

    #[test]
    fn detects_console_paths() {
        assert!(is_console_path(&to_wide("\\\\.\\con")));
        assert!(is_console_path(&to_wide("\\\\.\\CONOUT$")));
        assert!(!is_console_path(&to_wide("\\\\.\\NUL")));
        assert!(!is_console_path(&to_wide("C:\\con")));
    }

    #[test]
    fn adds_verbatim_prefix() {
        for (path, expected) in [
            ("C:\\a", "\\\\?\\C:\\a"),
            ("\\\\s\\t\\a", "\\\\?\\UNC\\s\\t\\a"),
            ("\\\\.\\NUL", "\\\\?\\NUL"),
            ("\\\\?\\C:\\a.", "\\\\?\\C:\\a."),
            ("\\??\\C:\\a", "\\\\?\\C:\\a"),
        ] {
            assert_eq!(
                to_verbatim_parts(path.as_bytes()).concat(),
                expected.as_bytes()
            );
        }
    }

    #[test]
    fn detects_device_names() {
        for name in [
            "\\??\\pipe\\a",
            "\\??\\Global\\pipe\\a",
            "\\??\\NUL",
            "\\??\\NUL\\",
            "\\??\\global\\NUL",
            "\\??\\Volume{0}",
            "\\??\\UNC",
            "\\??\\unc\\s\\PIPE\\a",
            "\\??\\UNC\\s\\ipc$\\a",
            "\\??\\Global\\UNC\\s\\pipe\\a",
            "\\??\\GLOBALROOT\\??\\pipe\\a",
            "\\??\\GLOBALROOT\\GLOBAL??\\pipe\\a",
            "\\??\\GLOBALROOT\\DosDevices\\pipe\\a",
            "\\??\\GLOBALROOT\\Device\\NamedPipe\\a",
            "\\??\\GLOBALROOT\\Device\\Mup\\s\\pipe\\a",
            "\\??\\GLOBALROOT\\Device\\Mup\\;LanmanRedirector\\s\\pipe\\a",
            "\\??\\GLOBALROOT\\Device\\LanmanRedirector\\s\\pipe\\a",
            "\\??\\GLOBALROOT\\Device\\Null",
        ] {
            assert!(is_device_name(&to_wide(name)), "{name}");
        }
        for name in [
            "",
            "pipe\\a",
            "\\Device\\HarddiskVolume1\\a",
            "\\??\\C:",
            "\\??\\C:\\pipe\\a",
            "\\??\\Volume{0}\\a",
            "\\??\\HarddiskVolume1\\a",
            "\\??\\HarddiskVolume1\\a\\pipe\\b",
            "\\??\\mailslot\\a",
            "\\??\\Global\\C:",
            "\\??\\Global\\C:\\a",
            "\\??\\GLOBALROOT\\??\\C:\\a",
            "\\??\\GLOBALROOT\\SystemRoot\\a",
            "\\??\\GLOBALROOT\\Device\\HarddiskVolume1\\pipe\\a",
            "\\??\\GLOBALROOT\\Device\\Mup\\s\\t\\pipe",
            "\\??\\UNC\\pipe\\a",
            "\\??\\UNC\\s\\t\\pipe",
        ] {
            assert!(!is_device_name(&to_wide(name)), "{name}");
        }
    }

    #[test]
    fn maps_console_names_to_win32_paths() {
        let path = to_console_path(&to_wide("\\??\\conin$")).unwrap();
        assert_eq!(path.as_slice(), to_wide("\\\\.\\CONIN$"));
        for name in ["CON", "\\??\\C:\\CON", "\\??\\CONS", "\\??\\"] {
            assert!(to_console_path(&to_wide(name)).is_none());
        }
    }

    #[test]
    fn strips_verbatim_prefix() {
        for (path, expected) in [
            ("\\\\?\\C:\\a", Some("C:\\a")),
            ("\\\\?\\UNC\\s\\t", Some("\\\\s\\t")),
            ("\\Device\\a", None),
        ] {
            let path = strip_verbatim_prefix(&mut to_wide(path)).map(<[u16]>::to_vec);
            assert_eq!(path, expected.map(to_wide));
        }
    }

    #[test]
    fn splits_parent_and_file_name() {
        let name = to_wide("\\??\\C:\\a");
        assert_eq!(split_file_name(&name), Some(name.split_at(7)));
        for name in [
            "a",
            "\\??\\C:",
            "\\??\\C:\\",
            "\\??\\C:\\a*",
            "\\??\\C:\\a:b",
        ] {
            assert_eq!(split_file_name(&to_wide(name)), None);
        }
    }
}
