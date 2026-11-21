//! Rules about the text of a path.

use bun_core::strings::{eql_case_insensitive_t, last_index_of_char_t};
use bun_core::{WStr, w, wstr};
use bun_paths::is_sep_any_t;

const BACKSLASH: u16 = b'\\' as u16;
const COLON: u16 = b':' as u16;

fn starts_with(name: &[u16], prefix: &[u8]) -> bool {
    (name.get(..prefix.len())).is_some_and(|start| eql_case_insensitive_t(start, prefix))
}

fn is_volume(path: &[u16]) -> bool {
    let [a, b, 0x2E | 0x3F, c, device @ ..] = path else {
        return false;
    };
    let components = device.split(|&it| is_sep_any_t(it)).count();
    [a, b, c].into_iter().all(|&it| is_sep_any_t(it))
        && (starts_with(device, b"Volume{") && components == 1
            || starts_with(device, b"GLOBALROOT") && components == 3)
}

/// The length of the Win32 path `path` without one separator at its end, unless that makes it the name of something else.
pub(crate) fn len_without_last_separator(path: &[u16]) -> usize {
    match path {
        [rest @ .., before, last] if is_sep_any_t(*last) && *before != COLON => {
            let len = rest.len() + 1;
            len + usize::from(is_volume(&path[..len]))
        }
        _ => path.len(),
    }
}

/// Whether the NT name `name` starts with a device that is neither a volume nor a share of files.
pub(crate) fn names_device(name: &[u16]) -> bool {
    let Some(name) = name.strip_prefix(w!("\\??\\")) else {
        return false;
    };
    if starts_with(name, b"UNC\\") {
        let share = name.split(|&it| it == BACKSLASH).nth(2);
        return share.is_some_and(|share| eql_case_insensitive_t(share, b"pipe"));
    }
    !matches!(name, [_, COLON, ..]) && !starts_with(name, b"Volume{")
}

/// The Win32 path of the console device that has the NT name `name`.
pub(crate) fn console(name: &[u16]) -> Option<&'static WStr> {
    console_device(name.strip_prefix(w!("\\??\\"))?)
}

pub(crate) fn is_console_path(full_path: &[u16]) -> bool {
    (full_path.strip_prefix(w!("\\\\.\\"))).is_some_and(|it| console_device(it).is_some())
}

fn console_device(device: &[u16]) -> Option<&'static WStr> {
    let known = [
        (&b"CON"[..], wstr!("\\\\.\\CON")),
        (b"CONIN$", wstr!("\\\\.\\CONIN$")),
        (b"CONOUT$", wstr!("\\\\.\\CONOUT$")),
    ];
    (known.into_iter()).find_map(|(it, path)| eql_case_insensitive_t(device, it).then_some(path))
}

/// Whether the Win32 path `path` starts with `\\.\`, or has neither a directory nor an extension.
#[cfg(windows)]
pub(crate) fn is_bare(path: &[u8]) -> bool {
    match *path {
        [a, b, b'.' | b'?', c, ..] if [a, b, c].into_iter().all(is_sep_any_t) => true,
        _ => !bun_core::strings::contains_any(path, b"\\/."),
    }
}

/// `\\?\X:\a` as `X:\a`, and `\\?\UNC\s\t` as `\\s\t`.
pub(crate) fn without_verbatim_prefix(path: &mut [u16]) -> Option<&[u16]> {
    if path.starts_with(w!("\\\\?\\UNC\\")) {
        path[6] = BACKSLASH;
        return Some(&path[6..]);
    }
    path.strip_prefix(w!("\\\\?\\"))
}

/// What goes in front, and what stays of a path that `GetFullPathNameW` has nothing to add to.
pub(crate) fn with_verbatim_prefix(full_path: &[u8]) -> [&[u8]; 2] {
    match full_path {
        [b'\\', b'\\', b'.' | b'?', b'\\', rest @ ..] | [b'\\', b'?', b'?', b'\\', rest @ ..] => {
            [b"\\\\?\\", rest]
        }
        [b'\\', b'\\', rest @ ..] => [b"\\\\?\\UNC\\", rest],
        rest => [b"\\\\?\\", rest],
    }
}

/// The NT name `name` up to its last separator, and with it.
pub(crate) fn parent(name: &[u16]) -> Option<&[u16]> {
    Some(&name[..=last_index_of_char_t(name, BACKSLASH)?])
}

/// The [`parent`], and a pattern that only matches the entry.
pub(crate) fn split_entry(name: &[u16]) -> Option<(&[u16], &[u16])> {
    let (directory, entry) = name.split_at(parent(name)?.len());
    let is_plain = entry.iter().all(|it| !w!("*?<>\":").contains(it));
    (!entry.is_empty() && is_plain).then_some((directory, entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn drops_the_last_separator() {
        for path in [
            "a\\",
            "a//",
            "C:\\a\\",
            "\\\\s\\t\\",
            "\\\\.\\pipe\\",
            "\\\\?\\Volume{0}\\a\\",
            "Volume{0}\\",
        ] {
            assert_eq!(len_without_last_separator(&wide(path)), path.len() - 1);
        }
        for path in ["", "\\", "a", "C:", "C:/", "\\\\?\\C:\\"] {
            assert_eq!(len_without_last_separator(&wide(path)), path.len());
        }
    }

    #[test]
    fn knows_the_paths_of_the_console() {
        assert!(is_console_path(&wide("\\\\.\\con")) && is_console_path(&wide("\\\\.\\CONOUT$")));
        assert!(!is_console_path(&wide("\\\\.\\NUL")) && !is_console_path(&wide("C:\\con")));
    }

    #[test]
    fn adds_the_verbatim_prefix() {
        for (path, expected) in [
            ("C:\\a", "\\\\?\\C:\\a"),
            ("\\\\s\\t\\a", "\\\\?\\UNC\\s\\t\\a"),
            ("\\\\.\\NUL", "\\\\?\\NUL"),
            ("\\\\?\\C:\\a.", "\\\\?\\C:\\a."),
            ("\\??\\C:\\a", "\\\\?\\C:\\a"),
        ] {
            assert_eq!(
                with_verbatim_prefix(path.as_bytes()).concat(),
                expected.as_bytes()
            );
        }
    }

    #[test]
    fn knows_the_names_of_devices() {
        for name in [
            "\\??\\pipe\\a",
            "\\??\\Global\\pipe\\a",
            "\\??\\NUL",
            "\\??\\unc\\s\\PIPE\\a",
            "\\??\\GLOBALROOT\\Device\\NamedPipe\\a",
        ] {
            assert!(names_device(&wide(name)));
        }
        for name in [
            "",
            "pipe\\a",
            "\\Device\\HarddiskVolume1\\a",
            "\\??\\C:\\pipe\\a",
            "\\??\\Volume{0}\\a",
            "\\??\\UNC\\pipe\\a",
            "\\??\\UNC\\s\\t\\pipe",
        ] {
            assert!(!names_device(&wide(name)));
        }
    }

    #[test]
    fn knows_the_console() {
        let path = console(&wide("\\??\\conin$")).unwrap();
        assert_eq!(path.as_slice(), wide("\\\\.\\CONIN$"));
        for name in ["CON", "\\??\\C:\\CON", "\\??\\CONS", "\\??\\"] {
            assert!(console(&wide(name)).is_none());
        }
    }

    #[test]
    fn drops_the_verbatim_prefix() {
        for (path, expected) in [
            ("\\\\?\\C:\\a", Some("C:\\a")),
            ("\\\\?\\UNC\\s\\t", Some("\\\\s\\t")),
            ("\\Device\\a", None),
        ] {
            let path = without_verbatim_prefix(&mut wide(path)).map(<[u16]>::to_vec);
            assert_eq!(path, expected.map(wide));
        }
    }

    #[test]
    fn splits_off_the_entry() {
        let name = wide("\\??\\C:\\a");
        assert_eq!(split_entry(&name), Some(name.split_at(7)));
        for name in [
            "a",
            "\\??\\C:",
            "\\??\\C:\\",
            "\\??\\C:\\a*",
            "\\??\\C:\\a:b",
        ] {
            assert_eq!(split_entry(&wide(name)), None);
        }
    }
}
