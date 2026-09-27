//! The child's environment block: UTF-16 `NAME=value\0` strings sorted by name
//! the way Windows sorts them, terminated by an empty string.

use core::cmp::Ordering;

use bun_core::wstr;

/// Variables a child gets from this process when its environment does not
/// define them: Winsock and the legacy CryptoAPI fail to initialize without
/// `SYSTEMROOT`, several APIs read `TEMP`, and Cygwin-based programs need the
/// rest. NUL-terminated, sorted.
static REQUIRED_VARS: [&[u16]; 11] = [
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
/// otherwise). Of entries whose names compare equal the last one is kept, as
/// the last assignment to a variable is: a program is given the first one it
/// finds, and `{ ...process.env, PATH }` comes after the `Path` it replaces.
pub fn make_env_block<'a>(entries: impl Iterator<Item = &'a [u8]>) -> Vec<u16> {
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
    // `=C:` and `=D:` are different variables with an empty name each.
    let is_replaced_by = |v: &Entry, next: &Entry| {
        v.name_len > 0 && compare_names(name(v), name(next)) == Ordering::Equal
    };
    let vars: Vec<&Entry> = vars
        .iter()
        .enumerate()
        .filter(|&(i, v)| !vars.get(i + 1).is_some_and(|next| is_replaced_by(v, next)))
        .map(|(_, v)| v)
        .collect();
    let mut block: Vec<u16> = Vec::with_capacity(strings.len() + vars.len() + 2);
    let mut next_var = 0usize;
    let mut next_required = 0usize;
    while next_var < vars.len() || next_required < REQUIRED_VARS.len() {
        let order = if next_required >= REQUIRED_VARS.len() {
            Ordering::Greater
        } else if next_var >= vars.len() {
            Ordering::Less
        } else {
            let required = REQUIRED_VARS[next_required];
            compare_names(&required[..required.len() - 1], name(vars[next_var]))
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
            let var = vars[next_var];
            block.extend_from_slice(&strings[var.start..var.end]);
            block.push(0);
            next_var += 1;
            if order == Ordering::Equal {
                next_required += 1;
            }
        }
    }
    // "A Unicode environment block is terminated by four zero bytes"
    // (`CreateProcessW`): the last string's and the block's, or both the
    // block's when it has no strings.
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    block
}

/// The value of the `PATH=` entry (any case) of a block.
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
fn compare_names(a: &[u16], b: &[u16]) -> Ordering {
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
