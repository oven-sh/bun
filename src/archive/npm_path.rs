//! Where node-tar extracts the files of a package.
// https://github.com/isaacs/node-tar/blob/v7.5.19/src/unpack.ts

use bun_core::strings;
use bun_errno::SystemErrno;
use bun_paths::resolve_path::is_drive_letter;
use bun_paths::{PathChar, SEP, is_sep_any};
use bun_tar::Entry;

const MAX_DEPTH: usize = 1024;
const ANY_SEPARATOR: &[u8] = b"/\\";
const SEPARATORS: &[u8] = if cfg!(windows) { ANY_SEPARATOR } else { b"/" };

/// Returns the path in the package where node-tar would extract `entry`. It is empty for an entry
/// that node-tar skips, and `None` for a name that does not fit in `buf` with a NUL behind it.
pub fn normalize_npm_entry_path<'a, T: PathChar>(
    entry: &Entry,
    buf: &'a mut [T],
) -> Result<Option<&'a mut [T]>, SystemErrno> {
    let mut len = 0;
    for name in strings::tokenize_any(strip(entry.path()).unwrap_or_default(), SEPARATORS) {
        if name == b"." {
            continue;
        }
        let start = len + usize::from(len != 0);
        if start + name.len() >= buf.len() {
            // node-tar leaves the directories that fit behind, in the way of later files.
            return if len == 0 {
                Ok(None)
            } else {
                Err(SystemErrno::ENAMETOOLONG)
            };
        }
        if len != 0 {
            buf[len] = T::from_u8(SEP);
        }
        len = start + T::write_u8_part(&mut buf[start..], name);
    }
    Ok(Some(&mut buf[..len]))
}

fn strip(path: &[u8]) -> Option<&[u8]> {
    // The empty name before a leading `/` counts as the folder of the package.
    let mut path = &path[strings::index_of_any(path, SEPARATORS)? + 1..];
    if path.len() >= MAX_DEPTH && strings::split_any(path, SEPARATORS).count() > MAX_DEPTH {
        return None;
    }
    while let root @ 1.. = root_len(path) {
        path = &path[root..];
    }
    let climbs = strings::contains(path, b"..")
        && strings::split_any(path, ANY_SEPARATOR).any(|name| name == b"..");
    (!climbs).then_some(path)
}

/// What is a root on Windows is one on every platform.
// https://github.com/isaacs/node-tar/blob/v7.5.19/src/strip-absolute-path.ts
fn root_len(path: &[u8]) -> usize {
    let is_slash = |c: u8| c == b'/' || (cfg!(windows) && c == b'\\');
    match *path {
        [a, b, b'?', c, ..] if [a, b, c].into_iter().all(is_slash) => share_len(path),
        [a, ..] if is_slash(a) => 1,
        [b'\\', b'/' | b'\\', ..] => share_len(path),
        [b'\\', ..] => 1,
        [letter, b':', c, ..] if is_drive_letter(letter) && is_sep_any(c) => 3,
        [letter, b':', ..] if is_drive_letter(letter) => 2,
        _ => 0,
    }
}

/// `\\server\share\`, or else the first separator.
fn share_len(path: &[u8]) -> usize {
    let server = &path[2..];
    let Some(server_len @ 1..) = strings::index_of_any(server, ANY_SEPARATOR) else {
        return 1;
    };
    let share = strings::trim_left(&server[server_len..], ANY_SEPARATOR);
    if share.is_empty() {
        return 1;
    }
    let share_len = strings::index_of_any(share, ANY_SEPARATOR).map_or(share.len(), |at| at + 1);
    path.len() - share.len() + share_len
}
