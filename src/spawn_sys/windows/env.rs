//! The child's environment block: UTF-16 `NAME=value\0` strings sorted by name
//! the way Windows sorts them, terminated by an empty string.

use core::cmp::Ordering;

use bun_core::wstr;

/// Variables a child gets from this process when its environment does not
/// define them: Winsock and the legacy CryptoAPI fail to initialize without
/// `SYSTEMROOT`, several APIs read `TEMP`, and Cygwin-based programs need the
/// rest. NUL-terminated, sorted.
pub static REQUIRED_VARS: [&[u16]; 11] = [
    wstr!("HOMEDRIVE"),
    wstr!("HOMEPATH"),
    wstr!("LOGONSERVER"),
    wstr!("PATH"),
    wstr!("SYSTEMDRIVE"),
    wstr!("SYSTEMROOT"),
    wstr!("TEMP"),
    wstr!("USERDOMAIN"),
    wstr!("USERNAME"),
    wstr!("USERPROFILE"),
    wstr!("WINDIR"),
];

/// `PATH`, NUL-terminated.
pub static PATH: &[u16] = wstr!("PATH");

struct Entry {
    start: usize,
    /// Length of the name: up to the first `=`, so `=C:=C:\dir` has an empty name.
    name_len: usize,
    end: usize,
}

/// Builds the block from `entries` (WTF-8 `NAME=value`).
///
/// Entries without `=` are dropped (`CreateProcessW` rejects the whole block
/// otherwise). Entries whose names compare equal are all kept, in input order.
/// `compare_names` orders two names; `parent_value` appends this process's
/// value of a NUL-terminated name and returns whether it has one.
pub fn make_env_block<'a>(
    entries: impl Iterator<Item = &'a [u8]>,
    compare_names: impl Fn(&[u16], &[u16]) -> Ordering,
    mut parent_value: impl FnMut(&[u16], &mut Vec<u16>) -> bool,
) -> Vec<u16> {
    let mut strings: Vec<u16> = Vec::new();
    let mut vars: Vec<Entry> = Vec::new();
    for entry in entries {
        if !bun_core::strings::contains_char(entry, b'=') {
            continue;
        }
        let start = strings.len();
        super::args::push_wtf8(&mut strings, entry);
        let end = strings.len();
        let name_len = strings[start..end]
            .iter()
            .position(|&c| c == b'=' as u16)
            .unwrap_or(end - start);
        vars.push(Entry {
            start,
            name_len,
            end,
        });
    }

    let name = |v: &Entry| &strings[v.start..v.start + v.name_len];
    vars.sort_by(|a, b| compare_names(name(a), name(b)));

    let mut block: Vec<u16> = Vec::with_capacity(strings.len() + vars.len() + 1);
    let mut next_var = 0usize;
    let mut next_required = 0usize;
    while next_var < vars.len() || next_required < REQUIRED_VARS.len() {
        let order = if next_required >= REQUIRED_VARS.len() {
            Ordering::Greater
        } else if next_var >= vars.len() {
            Ordering::Less
        } else {
            let required = REQUIRED_VARS[next_required];
            compare_names(&required[..required.len() - 1], name(&vars[next_var]))
        };
        if order == Ordering::Less {
            let required = REQUIRED_VARS[next_required];
            let rollback = block.len();
            block.extend_from_slice(&required[..required.len() - 1]);
            block.push(b'=' as u16);
            if parent_value(required, &mut block) {
                block.push(0);
            } else {
                block.truncate(rollback);
            }
            next_required += 1;
        } else {
            let var = &vars[next_var];
            block.extend_from_slice(&strings[var.start..var.end]);
            block.push(0);
            next_var += 1;
            if order == Ordering::Equal {
                next_required += 1;
            }
        }
    }
    block.push(0);
    block
}

/// The value of the first `PATH=` entry (any case) of a block.
pub fn find_path(block: &[u16]) -> Option<&[u16]> {
    let mut rest = block;
    while !rest.is_empty() && rest[0] != 0 {
        let len = bun_core::strings::index_of_any16(rest, &[0]).unwrap_or(rest.len());
        let entry = &rest[..len];
        if entry.len() >= 5
            && (entry[0] == b'P' as u16 || entry[0] == b'p' as u16)
            && (entry[1] == b'A' as u16 || entry[1] == b'a' as u16)
            && (entry[2] == b'T' as u16 || entry[2] == b't' as u16)
            && (entry[3] == b'H' as u16 || entry[3] == b'h' as u16)
            && entry[4] == b'=' as u16
        {
            return Some(&entry[5..]);
        }
        rest = rest.get(len + 1..).unwrap_or(&[]);
    }
    None
}

/// Name order of an environment block: `CompareStringOrdinal` ignoring case,
/// the same order the kernel keeps a process's block in (it compares
/// upper-cased, so `_` sorts after the letters, unlike `_wcsicmp`).
pub fn compare_names_ordinal(a: &[u16], b: &[u16]) -> Ordering {
    use super::win32;
    // Names here are slices of one spawn's arguments, far below `c_int::MAX`.
    // SAFETY: both pointers are valid for the given lengths.
    let r = unsafe {
        win32::CompareStringOrdinal(a.as_ptr(), a.len() as i32, b.as_ptr(), b.len() as i32, 1)
    };
    r.cmp(&win32::CSTR_EQUAL)
}

/// Appends this process's value of `name` (NUL-terminated); false when unset.
pub fn parent_value(name: &[u16], out: &mut Vec<u16>) -> bool {
    use super::win32;
    debug_assert_eq!(name.last(), Some(&0));
    let start = out.len();
    let mut capacity: usize = 256;
    loop {
        out.resize(start + capacity, 0);
        win32::SetLastError(0);
        // SAFETY: `name` is NUL-terminated; `out[start..]` holds `capacity` units.
        let n = unsafe {
            win32::GetEnvironmentVariableW(
                name.as_ptr(),
                out[start..].as_mut_ptr(),
                capacity as win32::DWORD,
            )
        } as usize;
        if n == 0 {
            out.truncate(start);
            // 0 is also the length of a variable set to the empty string.
            return win32::GetLastError() == 0;
        }
        if n < capacity {
            out.truncate(start + n);
            return true;
        }
        // Too small: `n` is the size needed, including the terminator.
        capacity = n;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upper(c: u16) -> u16 {
        if (b'a' as u16..=b'z' as u16).contains(&c) {
            c - 32
        } else {
            c
        }
    }

    fn compare(a: &[u16], b: &[u16]) -> Ordering {
        a.iter().map(|&c| upper(c)).cmp(b.iter().map(|&c| upper(c)))
    }

    fn block_strings(block: &[u16]) -> Vec<String> {
        assert_eq!(block.last(), Some(&0));
        let mut rest = &block[..block.len() - 1];
        let mut strings = Vec::new();
        while !rest.is_empty() {
            let len = bun_core::strings::index_of_any16(rest, &[0]).unwrap_or(rest.len());
            if len != 0 {
                strings.push(String::from_utf16(&rest[..len]).unwrap());
            }
            rest = &rest[(len + 1).min(rest.len())..];
        }
        strings
    }

    fn build(entries: &[&str], parent: &[(&str, &str)]) -> Vec<String> {
        let block = make_env_block(
            entries.iter().map(|s| s.as_bytes()),
            compare,
            |name, out| {
                let name = String::from_utf16(&name[..name.len() - 1]).unwrap();
                match parent.iter().find(|(k, _)| *k == name) {
                    Some((_, v)) => {
                        out.extend(v.encode_utf16());
                        true
                    }
                    None => false,
                }
            },
        );
        assert!(block.ends_with(&[0]));
        block_strings(&block)
    }

    #[test]
    fn sorts_case_insensitively_with_underscore_after_letters() {
        assert_eq!(
            build(&["foo_bar=1", "FOOBAR=2", "b=3", "A=4"], &[]),
            ["A=4", "b=3", "FOOBAR=2", "foo_bar=1"]
        );
    }

    #[test]
    fn injects_missing_required_variables_in_order() {
        assert_eq!(
            build(
                &["ZED=1", "Path=C:\\bin", "NOEQUALS", "AAA=0"],
                &[
                    ("SYSTEMROOT", "C:\\Windows"),
                    ("PATH", "ignored"),
                    ("TEMP", "C:\\T"),
                ],
            ),
            [
                "AAA=0",
                "Path=C:\\bin",
                "SYSTEMROOT=C:\\Windows",
                "TEMP=C:\\T",
                "ZED=1",
            ]
        );
    }

    #[test]
    fn keeps_duplicates_and_hidden_drive_entries() {
        assert_eq!(
            build(&["foo=1", "FOO=2", "=C:=C:\\dir", "EMPTY="], &[]),
            ["=C:=C:\\dir", "EMPTY=", "foo=1", "FOO=2"]
        );
    }

    #[test]
    fn empty_environment_is_a_valid_block() {
        let block = make_env_block(core::iter::empty(), compare, |_, _| false);
        assert_eq!(block, [0]);
    }

    #[test]
    fn finds_path_in_any_case() {
        let block: Vec<u16> = "A=1\0pAtH=C:\\x;D:\\y\0Z=2\0\0".encode_utf16().collect();
        assert_eq!(
            find_path(&block).map(|p| String::from_utf16(p).unwrap()),
            Some("C:\\x;D:\\y".to_string())
        );
        let none: Vec<u16> = "PATHS=1\0\0".encode_utf16().collect();
        assert_eq!(find_path(&none), None);
    }
}
