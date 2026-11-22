//! Where node-tar extracts the files of a package.
// https://github.com/isaacs/node-tar/blob/v7.5.19/src/unpack.ts

use bun_core::strings;
use bun_errno::SystemErrno;
use bun_paths::{OSPath, OSPathChar, SEP, is_sep};
use bun_tar::Entry;

use crate::MAX_OS_PATH;

const MAX_DEPTH: usize = 1024;
const ANY_SEPARATOR: &[u8] = b"/\\";
const SEPARATORS: &[u8] = if cfg!(windows) { ANY_SEPARATOR } else { b"/" };

/// The path in the package where node-tar would extract `entry`. Empty for an entry that it skips.
pub fn normalize_npm_entry_path(entry: &Entry) -> OSPath {
    let mut path = OSPath::new();
    for name in strings::tokenize_any(strip(entry.path()).unwrap_or_default(), SEPARATORS) {
        if name != b"." {
            path.push(name);
        }
    }
    path
}

/// [`normalize_npm_entry_path`] as the name of the file to create. `None` for a name that is too long.
pub fn npm_entry_destination(entry: &Entry) -> Result<Option<OSPath>, SystemErrno> {
    let mut path = normalize_npm_entry_path(entry);
    if path.len() >= MAX_OS_PATH {
        // node-tar leaves the directories that fit behind, in the way of later files.
        return match strings::index_of_scalar(&path[..MAX_OS_PATH], SEP as OSPathChar) {
            Some(_) => Err(SystemErrno::ENAMETOOLONG),
            None => Ok(None),
        };
    }
    // https://github.com/isaacs/node-tar/blob/0510c9ea6d000c40446d56674a7efeec8e72f052/lib/winchars.js
    #[cfg(windows)]
    for unit in path.as_mut_slice() {
        if matches!(u8::try_from(*unit), Ok(b'|' | b'<' | b'>' | b'?' | b':')) {
            *unit += 0xf000;
        }
    }
    // `strip` has tested the name before it was decoded.
    if bun_paths::climbs_out(&path) {
        path.clear();
    }
    Ok(Some(path))
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
    match *path {
        [a, b, b'?', c, ..] if [a, b, c].into_iter().all(is_sep) => share_len(path),
        [a, ..] if is_sep(a) => 1,
        [b'\\', b'/' | b'\\', ..] => share_len(path),
        [b'\\', ..] => 1,
        [letter, b':', b'/' | b'\\', ..] if letter.is_ascii_alphabetic() => 3,
        [letter, b':', ..] if letter.is_ascii_alphabetic() => 2,
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
