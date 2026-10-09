//! Paths.
//!
//! Every path of the linter and the formatter is absolute and separated by `/`, which is what a configuration matches its
//! patterns against: `C:\a\b` is `C:/a/b`, and `\\server\share\a` is `//server/share/a`. [`from_native`] converts what comes
//! from outside. Only a root ends with a `/`: `/`, `C:/`, `//server/share/`.
//!
//! The arithmetic is that of `node:path`, which ESLint and Prettier compute with: `bun_node_path`.

use bun_core::strings;
use bun_node_path as node;
use bun_paths::resolve_path::{
    platform_to_posix_in_place, posix_to_platform_in_place, slashes_to_posix_in_place,
};
use bun_sema::resolve::is_same_path;

/// Whose paths. Those of Windows begin with a drive or a share, and upper and lower case are the same in them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Style {
    Posix,
    Windows,
}

impl Style {
    /// Whose `path`, which is absolute, is. It is seen from the path, as in `getPathImpl` of `@eslint/config-array`, not from the
    /// system that this runs on: so the paths of Windows are tested on every system.
    pub fn of(path: &[u8]) -> Style {
        match path {
            [b'/', b'/', ..] => Style::Windows,
            [drive, b':', ..] if drive.is_ascii_alphabetic() => Style::Windows,
            _ => Style::Posix,
        }
    }
}

/// A path of the system, or an argument, with `/` for `\` where that is a separator.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    platform_to_posix_in_place(&mut path);
    path
}

/// A path as the system writes it, which is how ESLint prints it.
pub fn to_native(mut path: Vec<u8>) -> Vec<u8> {
    posix_to_platform_in_place(&mut path);
    path
}

/// `written`, a path as the file at `from`, or a file in that directory, has it: where `from` is a path of Windows, `\` is a
/// separator too.
pub fn portable(from: &[u8], written: &[u8]) -> Vec<u8> {
    of_node(Style::of(from), written)
}

/// What Node answers, which has `\` for the paths of Windows.
fn of_node(style: Style, answer: &[u8]) -> Vec<u8> {
    let mut path = answer.to_vec();
    if style == Style::Windows {
        slashes_to_posix_in_place(&mut path);
    }
    path
}

/// `path.isAbsolute(path)`, on this system.
pub fn is_absolute(path: &[u8]) -> bool {
    is_absolute_as(if cfg!(windows) { Style::Windows } else { Style::Posix }, path)
}

pub(crate) fn is_absolute_as(style: Style, path: &[u8]) -> bool {
    match style {
        Style::Posix => node::is_absolute_posix_t(path),
        Style::Windows => node::is_absolute_windows_t(path),
    }
}

/// `path.resolve(base, path)`. `base` is absolute.
pub fn resolve(base: &[u8], path: &[u8]) -> Vec<u8> {
    resolve_as(Style::of(base), base, path)
}

pub fn resolve_as(style: Style, base: &[u8], path: &[u8]) -> Vec<u8> {
    let paths = [base, path];
    let len = node::resolve_buf_len(style == Style::Windows, &paths);
    let mut buffers = vec![0; 2 * len];
    let (buf, buf2) = buffers.split_at_mut(len);
    let resolved = match style {
        Style::Posix => node::resolve_posix_t(&paths, buf, buf2),
        Style::Windows => node::resolve_windows_t(&paths, buf, buf2),
    };
    // It fails for the name of a server that no system takes.
    of_node(style, resolved.unwrap_or(path))
}

/// `path.relative(base, path)` of two resolved paths. Empty if they are the same.
pub fn relative(base: &[u8], path: &[u8]) -> Vec<u8> {
    relative_as(Style::of(base), base, path)
}

pub fn relative_as(style: Style, base: &[u8], path: &[u8]) -> Vec<u8> {
    // So it is for nearly every file.
    if let Some(rest) = inside_as(style, base, path) {
        return rest.to_vec();
    }
    let len = node::relative_buf_len::<u8>(base, path);
    let mut buffers = vec![0; 3 * len];
    let (buf, rest) = buffers.split_at_mut(len);
    let (buf2, buf3) = rest.split_at_mut(len);
    let relative = match style {
        Style::Posix => node::relative_posix_t(base, path, buf, buf2, buf3),
        Style::Windows => node::relative_windows_t(base, path, buf, buf2, buf3),
    };
    of_node(style, relative.unwrap_or(path))
}

/// The names in `path`, without `.` and with `..` resolved. The drive, or the server and the share, are the first of them, and
/// stay.
fn names(path: &[u8]) -> Vec<&[u8]> {
    let root = match (path, Style::of(path)) {
        ([b'/', b'/', ..], _) => 2,
        (_, Style::Windows) => 1,
        (_, Style::Posix) => 0,
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

/// `toRelativePath` of `@eslint/config-array`: the way from the directory `base` to `path`. Empty if they are the same. It
/// starts with `..` if `path` is outside of `base`, also on another drive: it is not `path.relative` of the two, but of what
/// `path.toNamespacedPath` makes of them, which all begins with `\\?\`.
pub(crate) fn relative_to_base(base: &[u8], path: &[u8]) -> Vec<u8> {
    // What follows the base as it is written is the answer if there is nothing in it to resolve.
    if let Some([b'/', rest @ ..]) = path.strip_prefix(base)
        && strings::split(rest, b"/").all(|name| !matches!(name, b"" | b"." | b".."))
    {
        return rest.to_vec();
    }
    // `relative` of `@std/path/windows` compares what `toLowerCase()` makes of the two.
    let is_case_sensitive = Style::of(base) == Style::Posix;
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
pub fn is_external(relative: &[u8]) -> bool {
    relative == b".." || relative.starts_with(b"../")
}

/// What follows `directory/` in `path`, if `path` is inside of `directory`. Both are resolved.
pub fn inside<'p>(directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    inside_as(Style::of(directory), directory, path)
}

pub fn inside_as<'p>(style: Style, directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    let (start, rest) = path.split_at_checked(directory.len())?;
    let is_same = match style {
        Style::Posix => start == directory,
        Style::Windows => start.eq_ignore_ascii_case(directory),
    };
    match (is_same, directory.ends_with(b"/")) {
        (false, _) => None,
        (true, true) => Some(rest),
        (true, false) => rest.strip_prefix(b"/"),
    }
}

/// `path.dirname(path)`. A root is its own directory.
pub fn dirname(path: &[u8]) -> &[u8] {
    dirname_as(Style::of(path), path)
}

pub fn dirname_as(style: Style, path: &[u8]) -> &[u8] {
    match style {
        Style::Posix => node::dirname_posix_t(path),
        Style::Windows => node::dirname_windows_t(path),
    }
}

/// `path.basename(path)`
pub fn basename(path: &[u8]) -> &[u8] {
    match Style::of(path) {
        Style::Posix => node::basename_posix_t(path, None),
        Style::Windows => node::basename_windows_t(path, None),
    }
}

/// The name of the file at `path`, whichever separator it is written with: `path.win32.basename(path)`.
pub fn file_name(path: &[u8]) -> &[u8] {
    node::basename_windows_t(path, None)
}

/// `path.extname(path)`
pub fn extname(path: &[u8]) -> &[u8] {
    match Style::of(path) {
        Style::Posix => node::extname_posix_t(path),
        Style::Windows => node::extname_windows_t(path),
    }
}

/// `path.win32.toNamespacedPath(path)`: `\\?\C:\a`, `\\?\UNC\server\share\a`. The system takes what follows `\\?\` as it is,
/// however long it is.
pub fn namespaced(path: &[u8]) -> Vec<u8> {
    let len = node::to_namespaced_path_buf_len::<u8>(path);
    let mut buffers = vec![0; 2 * len];
    let (buf, buf2) = buffers.split_at_mut(len);
    node::to_namespaced_path_windows_t(path, buf, buf2)
        .unwrap_or(path)
        .to_vec()
}

/// `path` resolved. One that is not absolute is in `/`.
pub(crate) fn absolute(path: &[u8]) -> Vec<u8> {
    match path {
        // The root of the drive, not the working directory on it.
        [drive, b':'] if drive.is_ascii_alphabetic() => [path, b"/"].concat(),
        _ => resolve_as(Style::of(path), b"/", path),
    }
}

/// `path`, which is absolute, resolved, with a `/` at its start, also before the name of a drive: no relative path starts so.
pub(crate) fn rooted(path: &[u8]) -> Vec<u8> {
    let resolved = absolute(path);
    match resolved.starts_with(b"/") {
        true => resolved,
        false => [b"/", &resolved[..]].concat(),
    }
}

/// `directory/name`
pub fn join(directory: &[u8], name: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(directory.len() + 1 + name.len());
    out.extend_from_slice(directory);
    if !directory.ends_with(b"/") {
        out.push(b'/');
    }
    out.extend_from_slice(name);
    out
}

/// `path.join(a, b)`
pub fn join_normalized(a: &[u8], b: &[u8]) -> Vec<u8> {
    let (style, paths) = (Style::of(a), [a, b]);
    let len = node::join_buf_len(style == Style::Windows, &paths);
    let mut buffers = vec![0; 2 * len];
    let (buf, buf2) = buffers.split_at_mut(len);
    let joined = match style {
        Style::Posix => node::join_posix_t(&paths, buf, buf2),
        Style::Windows => node::join_windows_t(&paths, buf, buf2),
    };
    of_node(style, joined)
}

/// `path.normalize(path)`
pub fn normalize(path: &[u8]) -> Vec<u8> {
    let style = Style::of(path);
    let mut buf = vec![0; node::normalize_buf_len(path)];
    let normalized = match style {
        Style::Posix => node::normalize_posix_t(path, &mut buf),
        Style::Windows => node::normalize_windows_t(path, &mut buf),
    };
    of_node(style, normalized)
}

/// `directory` and the directories that it is in, up to the root.
pub fn ancestors(directory: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut next = Some(directory);
    std::iter::from_fn(move || {
        let current = next?;
        let parent = dirname(current);
        next = (parent.len() < current.len()).then_some(parent);
        Some(current)
    })
}
