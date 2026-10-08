//! Paths as `@eslint/config-array` computes with them. All are absolute and separated by `/`: on
//! Windows the caller converts, `C:\a\b` to `C:/a/b`.

use bun_core::strings;

/// The names in `path`, without `.` and with `..` resolved.
fn names(path: &[u8]) -> Vec<&[u8]> {
    let mut names: Vec<&[u8]> = Vec::new();
    for name in strings::split(path, b"/") {
        match name {
            b"" | b"." => {}
            b".." => {
                names.pop();
            }
            name => names.push(name),
        }
    }
    names
}

/// `path.resolve(base, path)`
pub(crate) fn resolve(base: &[u8], path: &[u8]) -> Vec<u8> {
    let is_absolute = path.starts_with(b"/")
        || matches!(path, [drive, b':', b'/', ..] if drive.is_ascii_alphabetic());
    let joined = if is_absolute {
        path.to_vec()
    } else {
        [base, b"/", path].concat()
    };
    let mut out = Vec::with_capacity(joined.len());
    for name in names(&joined) {
        if !out.is_empty() || joined.starts_with(b"/") {
            out.push(b'/');
        }
        out.extend_from_slice(name);
    }
    if out.is_empty() {
        out.push(b'/');
    }
    out
}

/// `toRelativePath`: the way from the directory `base` to `path`. Empty if they are the same. It
/// starts with `..` if `path` is outside of `base`.
pub(crate) fn relative(base: &[u8], path: &[u8]) -> Vec<u8> {
    let (base, path) = (names(base), names(path));
    let common = base.iter().zip(&path).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&[u8]> = vec![b".."; base.len() - common];
    parts.extend_from_slice(&path[common..]);
    parts.join(&b'/')
}

/// `/^\.\.(?:\/|$)/.test(relative)`
pub(crate) fn is_external(relative: &[u8]) -> bool {
    relative == b".." || relative.starts_with(b"../")
}

/// `path.dirname(path)`
pub(crate) fn dirname(path: &[u8]) -> &[u8] {
    let path = match path {
        [rest @ .., b'/'] if !rest.is_empty() => rest,
        path => path,
    };
    match strings::last_index_of_char(path, b'/') {
        Some(0) => b"/",
        Some(slash) => &path[..slash],
        None => b".",
    }
}
