//! Path helpers.
//!
//! Every path in the linter and the formatter is absolute and uses `/` as the separator, because that's the form
//! configs match their patterns against: `C:\a\b` is `C:/a/b`, and `\\server\share\a` is `//server/share/a`.
//! [`from_native`] converts paths that come from outside. Only a root ends with a `/`: `/`, `C:/`, `//server/share/`.
//!
//! Path operations go through `bun_node_path`, so they behave like `node:path`, which ESLint and Prettier use.

use bun_core::strings;
use bun_node_path as node;
use bun_paths::resolve_path::{
    platform_to_posix_in_place, posix_to_platform_in_place, slashes_to_posix_in_place,
};
use bun_sema::resolve::is_same_path;

/// The platform whose path rules apply. Windows paths begin with a drive or a share and are case-insensitive.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Style {
    Posix,
    Windows,
}

impl Style {
    /// The style of the absolute path `path`. It's detected from the path itself, like `getPathImpl` in
    /// `@eslint/config-array`, not from the host platform. That way Windows paths can be tested on every platform.
    pub fn of(path: &[u8]) -> Style {
        match path {
            [b'/', b'/', ..] => Style::Windows,
            [drive, b':', ..] if drive.is_ascii_alphabetic() => Style::Windows,
            _ => Style::Posix,
        }
    }
}

/// Converts a native path or a command-line argument. Replaces `\` with `/` on platforms where `\` is a separator.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    platform_to_posix_in_place(&mut path);
    path
}

/// Converts a path to the platform's native form, which is how ESLint prints it.
pub fn to_native(mut path: Vec<u8>) -> Vec<u8> {
    posix_to_platform_in_place(&mut path);
    path
}

/// Converts `raw_path`, a path written in the file at `from` or in a file in the directory `from`. If `from` is a
/// Windows path, `\` is also a separator.
pub fn portable(from: &[u8], raw_path: &[u8]) -> Vec<u8> {
    from_node_path(Style::of(from), raw_path)
}

/// Converts a result from `bun_node_path`, which uses `\` in Windows paths.
fn from_node_path(style: Style, answer: &[u8]) -> Vec<u8> {
    let mut path = answer.to_vec();
    if style == Style::Windows {
        slashes_to_posix_in_place(&mut path);
    }
    path
}

/// `path.isAbsolute(path)`, on this system.
pub fn is_absolute(path: &[u8]) -> bool {
    is_absolute_as(
        if cfg!(windows) {
            Style::Windows
        } else {
            Style::Posix
        },
        path,
    )
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
    // It only fails for an invalid server name.
    from_node_path(style, resolved.unwrap_or(path))
}

/// `path.relative(base, path)` of two resolved paths. Empty if they are the same.
pub fn relative(base: &[u8], path: &[u8]) -> Vec<u8> {
    relative_as(Style::of(base), base, path)
}

/// Escapes `path` for display. A file name can contain a line break or a terminal escape sequence.
pub fn escaped(path: &[u8]) -> Vec<u8> {
    bun_core::fmt::escape_control_chars(path)
        .to_string()
        .into_bytes()
}

/// [`relative`], passed through [`escaped`].
pub fn relative_escaped(base: &[u8], path: &[u8]) -> Vec<u8> {
    escaped(&relative(base, path))
}

pub fn relative_as(style: Style, base: &[u8], path: &[u8]) -> Vec<u8> {
    // Fast path: almost every file is inside `base`.
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
    from_node_path(style, relative.unwrap_or(path))
}

/// The components of `path`, without `.` and with `..` resolved. The drive, or the server and share, come first, and
/// `..` never removes them.
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

/// `toRelativePath` in `@eslint/config-array`: the relative path from the directory `base` to `path`. Empty if they're
/// the same. It starts with `..` if `path` is outside `base`, even on another drive. That's because it isn't
/// `path.relative` of the two paths but of their `path.toNamespacedPath` forms, which all begin with `\\?\`.
pub(crate) fn relative_to_base(base: &[u8], path: &[u8]) -> Vec<u8> {
    // Fast path: if `path` starts with `base` and the rest has nothing to resolve, the rest is the result.
    let rest = match path.strip_prefix(base) {
        Some([b'/', rest @ ..]) => Some(rest),
        Some(rest) if base.ends_with(b"/") => Some(rest),
        _ => None,
    };
    if let Some(rest) = rest
        && strings::split(rest, b"/").all(|name| !matches!(name, b"" | b"." | b".."))
    {
        return rest.to_vec();
    }
    // `relative` in `@std/path/windows` compares the two paths after `toLowerCase()`.
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

/// The prefix that [`relative_to_base`] puts before the name of any entry of `directory`. `None` if `base` is below
/// `directory`, where the prefix differs between entries.
pub(crate) fn relative_to_base_before_name(base: &[u8], directory: &[u8]) -> Option<Vec<u8>> {
    let mut relative = relative_to_base(base, directory);
    if !relative.is_empty() {
        if strings::split(&relative, b"/").all(|name| name == b"..") {
            return None;
        }
        relative.push(b'/');
    }
    Some(relative)
}

/// `/^\.\.(?:\/|$)/.test(relative)`
pub fn is_external(relative: &[u8]) -> bool {
    relative == b".." || relative.starts_with(b"../")
}

/// The part of `path` after `directory/`, if `path` is inside `directory`. Both must be resolved.
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

/// True if `path` is `outer` or inside it. Both must be resolved.
pub fn is_at_or_inside(outer: &[u8], path: &[u8]) -> bool {
    let is_same = match Style::of(outer) {
        Style::Posix => outer == path,
        Style::Windows => outer.eq_ignore_ascii_case(path),
    };
    is_same || inside(outer, path).is_some()
}

/// `path.dirname(path)`. A root is its own parent.
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

/// `path.win32.basename(path)`: the file name of `path`, whichever separator it uses.
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

/// `path.win32.toNamespacedPath(path)`: `\\?\C:\a`, `\\?\UNC\server\share\a`. Windows doesn't normalize what follows
/// `\\?\` or limit its length.
pub fn namespaced(path: &[u8]) -> Vec<u8> {
    let len = node::to_namespaced_path_buf_len::<u8>(path);
    let mut buffers = vec![0; 2 * len];
    let (buf, buf2) = buffers.split_at_mut(len);
    node::to_namespaced_path_windows_t(path, buf, buf2)
        .unwrap_or(path)
        .to_vec()
}

/// Resolves `path`. A relative path is resolved against `/`.
pub(crate) fn absolute(path: &[u8]) -> Vec<u8> {
    match path {
        // The root of the drive, not the working directory on it.
        [drive, b':'] if drive.is_ascii_alphabetic() => [path, b"/"].concat(),
        _ => resolve_as(Style::of(path), b"/", path),
    }
}

/// Resolves the absolute path `path` and makes it start with a `/`, even before a drive name. No relative path starts
/// that way.
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
    from_node_path(style, joined)
}

/// `path.normalize(path)`
pub fn normalize(path: &[u8]) -> Vec<u8> {
    let style = Style::of(path);
    let mut buf = vec![0; node::normalize_buf_len(path)];
    let normalized = match style {
        Style::Posix => node::normalize_posix_t(path, &mut buf),
        Style::Windows => node::normalize_windows_t(path, &mut buf),
    };
    from_node_path(style, normalized)
}

/// The package that `name` belongs to. `name` is a package name or a path to a file inside one, because eslint-config-next
/// writes `require.resolve("eslint-import-resolver-node")`.
pub fn package_of(name: &[u8]) -> &[u8] {
    const FOLDER: &[u8] = b"node_modules";
    let after =
        bun_core::strings::last_index_of(name, FOLDER).and_then(|at| name.get(at + FOLDER.len()..));
    let Some([b'/' | b'\\', inside @ ..]) = after else {
        return name;
    };
    let end_of_part =
        |from: usize| Some(from + bun_core::strings::index_of_any(inside.get(from..)?, b"/\\")?);
    let end = match (inside.first(), end_of_part(0)) {
        (Some(b'@'), Some(scope)) => end_of_part(scope + 1),
        (_, end) => end,
    };
    &inside[..end.unwrap_or(inside.len())]
}

/// `directory` and its ancestors, up to the root.
pub fn ancestors(directory: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut next = Some(directory);
    std::iter::from_fn(move || {
        let current = next?;
        let parent = dirname(current);
        next = (parent.len() < current.len()).then_some(parent);
        Some(current)
    })
}
