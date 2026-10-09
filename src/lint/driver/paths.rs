//! Paths and the patterns of the command line.
//!
//! Every path in this crate is absolute and separated by `/`, which is what the configuration
//! matches its patterns against: `C:\a\b` is `C:/a/b`, and `\\server\share\a` is
//! `//server/share/a`. [`from_native`] converts what comes from outside. Only a root ends with a
//! `/`: `/`, `C:/`, `//server/share/`.

use bun_core::strings;

/// Whose paths. Those of Windows begin with a drive or a share, and upper and lower case are the
/// same in them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Style {
    Posix,
    Windows,
}

impl Style {
    pub(crate) const NATIVE: Style = match cfg!(windows) {
        true => Style::Windows,
        false => Style::Posix,
    };
}

fn replace_byte(path: &mut [u8], from: u8, to: u8) {
    for byte in path {
        if *byte == from {
            *byte = to;
        }
    }
}

/// A path of the system, or an argument, with `/` for `\` where that is a separator.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    if cfg!(windows) {
        replace_byte(&mut path, b'\\', b'/');
    }
    path
}

/// A path as the system writes it, which is how ESLint prints it.
pub(crate) fn to_native(mut path: Vec<u8>) -> Vec<u8> {
    if cfg!(windows) {
        replace_byte(&mut path, b'/', b'\\');
    }
    path
}

pub(crate) fn is_absolute(path: &[u8]) -> bool {
    path.starts_with(b"/")
        || (cfg!(windows) && matches!(path, [drive, b':', b'/', ..] if drive.is_ascii_alphabetic()))
}

/// How long the drive (`C:`) or the share (`//server/share`) is that `path` begins with. 0: it
/// begins with neither.
fn device_len(style: Style, path: &[u8]) -> usize {
    match (style, path) {
        (Style::Posix, _) => 0,
        (Style::Windows, [drive, b':', ..]) if drive.is_ascii_alphabetic() => 2,
        (Style::Windows, [b'/', b'/', rest @ ..]) => {
            let name_len =
                |text: &[u8]| strings::index_of_char_usize(text, b'/').unwrap_or(text.len());
            let server = name_len(rest);
            let between = (rest[server..].iter())
                .take_while(|byte| **byte == b'/')
                .count();
            let share = name_len(&rest[server + between..]);
            match server > 0 && share > 0 {
                true => 2 + server + between + share,
                false => 0,
            }
        }
        (Style::Windows, _) => 0,
    }
}

/// Whether two pieces of paths are the same to Node's `path.relative`, which compares those of
/// Windows in lower case.
fn is_same(style: Style, a: &[u8], b: &[u8]) -> bool {
    match style {
        Style::Posix => a == b,
        Style::Windows => a.eq_ignore_ascii_case(b),
    }
}

/// `path.resolve(base, path)`. `base` is absolute.
pub(crate) fn resolve(base: &[u8], path: &[u8]) -> Vec<u8> {
    resolve_as(Style::NATIVE, base, path)
}

pub(crate) fn resolve_as(style: Style, base: &[u8], path: &[u8]) -> Vec<u8> {
    let (base_device, base_names) = base.split_at(device_len(style, base));
    let (device, names) = path.split_at(device_len(style, path));
    // `before`: what `names` is relative to. Nothing, if it starts at the root.
    let (device, before) = if names.starts_with(b"/") || device.starts_with(b"/") {
        let device = if device.is_empty() {
            base_device
        } else {
            device
        };
        (device, &b""[..])
    } else if device.is_empty() {
        (base_device, base_names)
    } else if is_same(style, device, base_device) {
        (device, base_names)
    } else {
        // `D:a` is relative to the working directory of the drive, which is not known here.
        (device, &b""[..])
    };
    let mut resolved: Vec<&[u8]> = Vec::new();
    for name in strings::split(before, b"/").chain(strings::split(names, b"/")) {
        match name {
            b"" | b"." => {}
            b".." => {
                resolved.pop();
            }
            name => resolved.push(name),
        }
    }
    let mut out = Vec::with_capacity(device.len() + before.len() + names.len() + 2);
    if device.starts_with(b"/") {
        // It can be written `//server//share`.
        let parts: Vec<&[u8]> = strings::split(device, b"/")
            .filter(|name| !name.is_empty())
            .collect();
        out.extend_from_slice(b"//");
        out.extend_from_slice(&parts.join(&b'/'));
    } else {
        out.extend_from_slice(device);
    }
    out.push(b'/');
    out.extend_from_slice(&resolved.join(&b'/'));
    out
}

/// `path.relative(base, path)` of two resolved paths. Empty if they are the same.
pub(crate) fn relative(base: &[u8], path: &[u8]) -> Vec<u8> {
    relative_as(Style::NATIVE, base, path)
}

pub(crate) fn relative_as(style: Style, base: &[u8], path: &[u8]) -> Vec<u8> {
    if let Some(rest) = inside_as(style, base, path) {
        return rest.to_vec();
    }
    let names = |path| strings::split(path, b"/").filter(|name: &&[u8]| !name.is_empty());
    let common = names(base)
        .zip(names(path))
        .take_while(|(a, b)| is_same(style, a, b))
        .count();
    // There is no way from one drive to another.
    if style == Style::Windows && common == 0 {
        return path.to_vec();
    }
    let mut parts: Vec<&[u8]> = vec![b".."; names(base).count() - common];
    parts.extend(names(path).skip(common));
    parts.join(&b'/')
}

/// What follows `directory/` in `path`, if `path` is inside of `directory`. Both are resolved.
pub(crate) fn inside<'p>(directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    inside_as(Style::NATIVE, directory, path)
}

pub(crate) fn inside_as<'p>(style: Style, directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    let (start, rest) = path.split_at_checked(directory.len())?;
    if !is_same(style, start, directory) {
        return None;
    }
    match directory.ends_with(b"/") {
        true => Some(rest),
        false => rest.strip_prefix(b"/"),
    }
}

/// `path.dirname(path)` of a resolved path. A root is its own directory.
pub(crate) fn dirname(path: &[u8]) -> &[u8] {
    dirname_as(Style::NATIVE, path)
}

pub(crate) fn dirname_as(style: Style, path: &[u8]) -> &[u8] {
    let device = device_len(style, path);
    let root = device + usize::from(path.get(device) == Some(&b'/'));
    match strings::last_index_of_char(path, b'/') {
        Some(slash) if slash >= root => &path[..slash],
        Some(_) => &path[..root],
        None => path,
    }
}

/// Node's `path.toNamespacedPath` of a path of Windows, with either separator: `\\?\C:\a`,
/// `\\?\UNC\server\share\a`. The system takes what follows `\\?\` as it is, however long it is.
pub(crate) fn namespaced(path: &[u8]) -> Vec<u8> {
    let mut whole = path.to_vec();
    replace_byte(&mut whole, b'\\', b'/');
    let device = device_len(Style::Windows, &whole);
    let is_namespaced = matches!(&whole[..], [b'/', b'/', b'?' | b'.', b'/', ..]);
    let is_absolute = device > 0 && (whole.starts_with(b"/") || whole.get(device) == Some(&b'/'));
    let mut out = if is_namespaced || !is_absolute {
        whole
    } else {
        let resolved = resolve_as(Style::Windows, &whole, b".");
        match resolved.strip_prefix(b"//") {
            Some(share) => [&b"//?/UNC/"[..], share].concat(),
            None => [&b"//?/"[..], &resolved[..]].concat(),
        }
    };
    replace_byte(&mut out, b'/', b'\\');
    out
}

/// `path.posix.dirname(path)` of any text.
fn posix_dirname(path: &[u8]) -> &[u8] {
    let has_root = path.starts_with(b"/");
    let mut is_after_name = false;
    for at in (1..path.len()).rev() {
        if path[at] != b'/' {
            is_after_name = true;
        } else if is_after_name {
            return if has_root && at == 1 {
                b"//"
            } else {
                &path[..at]
            };
        }
    }
    if has_root { b"/" } else { b"." }
}

pub(crate) fn basename(path: &[u8]) -> &[u8] {
    match strings::last_index_of_char(path, b'/') {
        Some(slash) => &path[slash + 1..],
        None => path,
    }
}

/// `directory/name`
pub(crate) fn join(directory: &[u8], name: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(directory.len() + 1 + name.len());
    out.extend_from_slice(directory);
    if !directory.ends_with(b"/") {
        out.push(b'/');
    }
    out.extend_from_slice(name);
    out
}

/// `directory` and the directories that it is in, up to the root.
pub(crate) fn ancestors(directory: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut next = Some(directory);
    std::iter::from_fn(move || {
        let current = next?;
        let parent = dirname(current);
        next = (parent.len() < current.len()).then_some(parent);
        Some(current)
    })
}

fn index_from(text: &[u8], byte: u8, from: usize) -> Option<usize> {
    strings::index_of_char_usize(text.get(from..)?, byte).map(|at| at + from)
}

/// The package `is-extglob`: `/(\\).|([@?!+*]\(.*\))/`
fn is_extglob(text: &[u8]) -> bool {
    let mut at = 0;
    while at < text.len() {
        match text[at] {
            // `.` does not match a line terminator.
            b'\\'
                if text
                    .get(at + 1)
                    .is_some_and(|next| !matches!(next, b'\n' | b'\r')) =>
            {
                at += 2
            }
            b'@' | b'?' | b'!' | b'+' | b'*' if text.get(at + 1) == Some(&b'(') => {
                let line = strings::index_of_any(&text[at + 2..], b"\n\r")
                    .map_or(text.len(), |end| at + 2 + end);
                if strings::contains_char(&text[at + 2..line], b')') {
                    return true;
                }
                at += 1;
            }
            _ => at += 1,
        }
    }
    false
}

/// The package `is-glob`, which is strict unless told otherwise.
pub(crate) fn is_glob(text: &[u8]) -> bool {
    if text.is_empty() {
        return false;
    }
    if is_extglob(text) || text[0] == b'!' {
        return true;
    }
    let at = |index: usize| text.get(index).copied();
    // `None`: not looked for yet. `Some(None)`: there is none.
    type Found = Option<Option<usize>>;
    let (mut pipe, mut close_square, mut close_curly): (Found, Found, Found) = (None, None, None);
    let (mut close_paren, mut backslash): (Found, Found) = (None, None);
    let is_before = |backslash: Option<usize>, close: usize| backslash.is_none_or(|it| it > close);
    let mut index = 0;
    while index < text.len() {
        let byte = text[index];
        if byte == b'*' {
            return true;
        }
        if at(index + 1) == Some(b'?') && matches!(byte, b']' | b'.' | b'+' | b')') {
            return true;
        }
        if close_square != Some(None) && byte == b'[' && at(index + 1) != Some(b']') {
            if close_square.flatten().is_none_or(|it| it < index) {
                close_square = Some(index_from(text, b']', index));
            }
            if let Some(Some(close)) = close_square
                && close > index
            {
                if backslash == Some(None) || backslash.flatten().is_some_and(|it| it > close) {
                    return true;
                }
                backslash = Some(index_from(text, b'\\', index));
                if is_before(backslash.flatten(), close) {
                    return true;
                }
            }
        }
        if close_curly != Some(None) && byte == b'{' && at(index + 1) != Some(b'}') {
            close_curly = Some(index_from(text, b'}', index));
            if let Some(Some(close)) = close_curly
                && close > index
            {
                backslash = Some(index_from(text, b'\\', index));
                if is_before(backslash.flatten(), close) {
                    return true;
                }
            }
        }
        if close_paren != Some(None)
            && byte == b'('
            && at(index + 1) == Some(b'?')
            && matches!(at(index + 2), Some(b':' | b'!' | b'='))
            && at(index + 3) != Some(b')')
        {
            close_paren = Some(index_from(text, b')', index));
            if let Some(Some(close)) = close_paren
                && close > index
            {
                backslash = Some(index_from(text, b'\\', index));
                if is_before(backslash.flatten(), close) {
                    return true;
                }
            }
        }
        if pipe != Some(None) && byte == b'(' && at(index + 1) != Some(b'|') {
            if pipe.flatten().is_none_or(|it| it < index) {
                pipe = Some(index_from(text, b'|', index));
            }
            if let Some(Some(found)) = pipe
                && at(found + 1) != Some(b')')
            {
                close_paren = Some(index_from(text, b')', found));
                if let Some(Some(close)) = close_paren
                    && close > found
                {
                    backslash = Some(index_from(text, b'\\', found));
                    if is_before(backslash.flatten(), close) {
                        return true;
                    }
                }
            }
        }
        if byte == b'\\' {
            let close = match at(index + 1) {
                Some(b'{') => Some(b'}'),
                Some(b'(') => Some(b')'),
                Some(b'[') => Some(b']'),
                _ => None,
            };
            index += 2;
            if let Some(found) = close.and_then(|close| index_from(text, close, index)) {
                index = found + 1;
            }
            if at(index) == Some(b'!') {
                return true;
            }
        } else {
            index += 1;
        }
    }
    false
}

/// `isGlobby` of the package `glob-parent`.
fn is_globby(text: &[u8]) -> bool {
    // `/\([^()]+$/`
    if let Some(open) = strings::last_index_of_char(text, b'(')
        && open + 1 < text.len()
        && !strings::contains_char(&text[open..], b')')
    {
        return true;
    }
    if matches!(text.first(), Some(b'{' | b'[')) {
        return true;
    }
    // `/[^\\][{[]/`
    let mut from = 1;
    while let Some(found) = text
        .get(from..)
        .and_then(|rest| strings::index_of_any(rest, b"{["))
    {
        if text[from + found - 1] != b'\\' {
            return true;
        }
        from += found + 1;
    }
    is_glob(text)
}

/// The package `glob-parent`: the directory that everything a pattern matches is in.
pub(crate) fn glob_parent(pattern: &[u8]) -> Vec<u8> {
    let mut text = pattern.to_vec();
    // `isEnclosure`
    let open = match text.last() {
        Some(b'}') => strings::index_of_char_usize(&text, b'{'),
        Some(b']') => strings::index_of_char_usize(&text, b'['),
        _ => None,
    };
    if open.is_some_and(|open| strings::contains_char(&text[open + 1..text.len() - 1], b'/')) {
        text.push(b'/');
    }
    text.push(b'a');
    let mut parent: &[u8] = &text;
    loop {
        parent = posix_dirname(parent);
        if !is_globby(parent) {
            break;
        }
    }
    // `/\\([!*?|[\](){}])/g`
    let mut out = Vec::with_capacity(parent.len());
    let mut at = 0;
    while at < parent.len() {
        if parent[at] == b'\\'
            && parent
                .get(at + 1)
                .is_some_and(|next| strings::contains_char(b"!*?|[](){}", *next))
        {
            at += 1;
        }
        out.push(parent[at]);
        at += 1;
    }
    out
}
