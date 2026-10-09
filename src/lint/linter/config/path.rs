//! Paths as `@eslint/config-array` computes with them. All are absolute and separated by `/`: on
//! Windows the caller converts, `C:\a\b` to `C:/a/b` and `\\server\share\a` to `//server/share/a`.
//!
//! Whether a path is one of Windows is seen from the path, as in `getPathImpl`, not from the system
//! that this runs on.

use bun_core::strings;
use bun_sema::resolve::is_same_path;

/// Whether `path`, which is absolute, is one of Windows.
fn is_of_windows(path: &[u8]) -> bool {
    path.starts_with(b"//") || matches!(path, [drive, b':', ..] if drive.is_ascii_alphabetic())
}

fn is_absolute(path: &[u8]) -> bool {
    path.starts_with(b"/")
        || matches!(path, [drive, b':'] | [drive, b':', b'/', ..] if drive.is_ascii_alphabetic())
}

/// How long the drive (`C:`) or the share (`//server/share`) is that `path`, which is resolved, begins with. 0: with neither.
fn device_len(path: &[u8]) -> usize {
    let name_len = |text: &[u8]| strings::index_of_char_usize(text, b'/').unwrap_or(text.len());
    match path {
        [b'/', b'/', rest @ ..] => {
            let server = name_len(rest);
            let share = rest.get(server + 1..);
            2 + server + share.map_or(0, |share| 1 + name_len(share))
        }
        path if is_of_windows(path) => 2,
        _ => 0,
    }
}

/// The names in `path`, without `.` and with `..` resolved. The drive, or the server and the share,
/// are the first of them, and stay.
fn names(path: &[u8]) -> Vec<&[u8]> {
    let root = match path {
        [b'/', b'/', ..] => 2,
        path if is_of_windows(path) => 1,
        _ => 0,
    };
    let mut names: Vec<&[u8]> = Vec::new();
    for name in strings::split(path, b"/") {
        match name {
            b"" | b"." => {}
            b".." => {
                if names.len() > root {
                    names.pop();
                }
            }
            name => names.push(name),
        }
    }
    names
}

/// `written`, a path as the file at `from`, or a file in that directory, has it: where `from` is a path of Windows, `\` is a
/// separator too.
pub(crate) fn portable(from: &[u8], written: &[u8]) -> Vec<u8> {
    let mut path = written.to_vec();
    if !is_of_windows(from) {
        return path;
    }
    for byte in &mut path {
        if *byte == b'\\' {
            *byte = b'/';
        }
    }
    path
}

/// `path.resolve(base, path)`
pub(crate) fn resolve(base: &[u8], path: &[u8]) -> Vec<u8> {
    let joined = if is_absolute(path) {
        path.to_vec()
    } else {
        [base, b"/", path].concat()
    };
    let mut out = Vec::with_capacity(joined.len());
    if joined.starts_with(b"//") {
        out.push(b'/');
    }
    for name in names(&joined) {
        if !out.is_empty() || joined.starts_with(b"/") {
            out.push(b'/');
        }
        out.extend_from_slice(name);
    }
    // Only a root ends with a `/`: `/`, `C:/`, `//server/share/`.
    if out.is_empty() || out.len() == device_len(&out) {
        out.push(b'/');
    }
    out
}

/// `path`, which is absolute, resolved, with a `/` at its start, also before the name of a drive: no
/// relative path starts so.
pub(crate) fn rooted(path: &[u8]) -> Vec<u8> {
    let resolved = resolve(b"/", path);
    match resolved.starts_with(b"/") {
        true => resolved,
        false => [b"/", &resolved[..]].concat(),
    }
}

/// `toRelativePath`: the way from the directory `base` to `path`. Empty if they are the same. It
/// starts with `..` if `path` is outside of `base`.
pub(crate) fn relative(base: &[u8], path: &[u8]) -> Vec<u8> {
    // What follows the base as it is written is the answer if there is nothing in it to resolve.
    if let Some([b'/', rest @ ..]) = path.strip_prefix(base)
        && strings::split(rest, b"/").all(|name| !matches!(name, b"" | b"." | b".."))
    {
        return rest.to_vec();
    }
    // `relative` of `@std/path/windows` compares what `toLowerCase()` makes of the two.
    let is_case_sensitive = !is_of_windows(base);
    let (base, path) = (names(base), names(path));
    let common = base
        .iter()
        .zip(&path)
        .take_while(|(a, b)| is_same_path(a, b, is_case_sensitive))
        .count();
    let mut parts: Vec<&[u8]> = vec![b".."; base.len() - common];
    parts.extend_from_slice(&path[common..]);
    parts.join(&b'/')
}

/// `/^\.\.(?:\/|$)/.test(relative)`
pub(crate) fn is_external(relative: &[u8]) -> bool {
    relative == b".." || relative.starts_with(b"../")
}

/// `path.dirname(path)`. A root is its own directory.
pub(crate) fn dirname(path: &[u8]) -> &[u8] {
    let device = device_len(path);
    if device > 0 && path.len() <= device + 1 {
        return path;
    }
    let path = match path {
        [rest @ .., b'/'] if !rest.is_empty() => rest,
        path => path,
    };
    match strings::last_index_of_char(path, b'/') {
        Some(0) => b"/",
        Some(slash) if slash == device && device > 0 => &path[..=slash],
        Some(slash) => &path[..slash],
        None => b".",
    }
}
