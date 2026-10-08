//! Paths and the patterns of the command line.
//!
//! Every path in this crate is absolute and separated by `/`, which is what the configuration
//! matches its patterns against: `C:\a\b` is `C:/a/b`. [`from_native`] converts what comes from
//! outside. The system takes such a path as it is.

use bun_core::strings;

/// A path of the system, or an argument, with `/` for `\` where that is a separator.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    let mut path = path.to_vec();
    if cfg!(windows) {
        for byte in &mut path {
            if *byte == b'\\' {
                *byte = b'/';
            }
        }
    }
    path
}

/// A path as the system writes it, which is how ESLint prints it.
pub(crate) fn to_native(mut path: Vec<u8>) -> Vec<u8> {
    if cfg!(windows) {
        for byte in &mut path {
            if *byte == b'/' {
                *byte = b'\\';
            }
        }
    }
    path
}

pub(crate) fn is_absolute(path: &[u8]) -> bool {
    path.starts_with(b"/")
        || (cfg!(windows) && matches!(path, [drive, b':', b'/', ..] if drive.is_ascii_alphabetic()))
}

/// `path.resolve(base, path)`. `base` is absolute.
pub(crate) fn resolve(base: &[u8], path: &[u8]) -> Vec<u8> {
    let joined = match is_absolute(path) {
        true => path.to_vec(),
        false => [base, b"/", path].concat(),
    };
    let mut names: Vec<&[u8]> = Vec::new();
    for name in strings::split(&joined, b"/") {
        match name {
            b"" | b"." => {}
            b".." => {
                // The name of a drive stays.
                if names.len() > usize::from(!joined.starts_with(b"/")) {
                    names.pop();
                }
            }
            name => names.push(name),
        }
    }
    let mut out = Vec::with_capacity(joined.len());
    for name in names {
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

/// `path.relative(base, path)` of two resolved paths. Empty if they are the same.
pub(crate) fn relative(base: &[u8], path: &[u8]) -> Vec<u8> {
    if let Some(rest) = inside(base, path) {
        return rest.to_vec();
    }
    let names = |path| strings::split(path, b"/").filter(|name: &&[u8]| !name.is_empty());
    let common = names(base).zip(names(path)).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&[u8]> = vec![b".."; names(base).count() - common];
    parts.extend(names(path).skip(common));
    parts.join(&b'/')
}

/// What follows `directory/` in `path`, if `path` is inside of `directory`. Both are resolved.
pub(crate) fn inside<'p>(directory: &[u8], path: &'p [u8]) -> Option<&'p [u8]> {
    let rest = path.strip_prefix(directory)?;
    match directory.ends_with(b"/") {
        true => Some(rest),
        false => rest.strip_prefix(b"/"),
    }
}

/// `path.dirname(path)` of a resolved path. The root is its own directory.
pub(crate) fn dirname(path: &[u8]) -> &[u8] {
    match strings::last_index_of_char(path, b'/') {
        Some(0) => &path[..1],
        Some(slash) => &path[..slash],
        None => path,
    }
}

/// `path.posix.dirname(path)` of any text.
fn posix_dirname(path: &[u8]) -> &[u8] {
    let has_root = path.starts_with(b"/");
    let mut is_after_name = false;
    for at in (1..path.len()).rev() {
        if path[at] != b'/' {
            is_after_name = true;
        } else if is_after_name {
            return if has_root && at == 1 { b"//" } else { &path[..at] };
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
            b'\\' if text.get(at + 1).is_some_and(|next| !matches!(next, b'\n' | b'\r')) => at += 2,
            b'@' | b'?' | b'!' | b'+' | b'*' if text.get(at + 1) == Some(&b'(') => {
                let line = strings::index_of_any(&text[at + 2..], b"\n\r").map_or(text.len(), |end| at + 2 + end);
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
    while let Some(found) = text.get(from..).and_then(|rest| strings::index_of_any(rest, b"{[")) {
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
        if parent[at] == b'\\' && parent.get(at + 1).is_some_and(|next| strings::contains_char(b"!*?|[](){}", *next)) {
            at += 1;
        }
        out.push(parent[at]);
        at += 1;
    }
    out
}
