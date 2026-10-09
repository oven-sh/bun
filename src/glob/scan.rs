//! `is_glob`, `glob_parent`. They match nothing: they read patterns.

use crate::unit::starts_with_line_terminator;
use bun_core::strings;

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

/// Where a byte is next. What was found serves every later question that starts before it, so `{{{{..\}` is linear.
struct Next {
    byte: u8,
    /// From where it was last looked for, and where it was found.
    last: Option<(usize, Option<usize>)>,
}

impl Next {
    fn new(byte: u8) -> Next {
        Next { byte, last: None }
    }

    fn index_from(&mut self, text: &[u8], from: usize) -> Option<usize> {
        if let Some((looked_from, found)) = self.last
            && from >= looked_from
            && found.is_none_or(|it| it >= from)
        {
            return found;
        }
        let found = strings::index_of_char_pos(text, self.byte, from);
        self.last = Some((from, found));
        found
    }
}

/// Where the line ends that `from` is in.
fn end_of_line(text: &[u8], from: usize) -> usize {
    let mut at = from;
    while at < text.len() && !starts_with_line_terminator(&text[at..]) {
        at += 1;
    }
    at
}

/// The package `is-extglob` 2.1.1: `/(\\).|([@?!+*]\(.*\))/`
fn is_extglob(text: &[u8]) -> bool {
    let mut closes = Next::new(b')');
    // Where the line ends in which a `)` was last looked for.
    let mut line_end = None;
    let mut at = 0;
    while let Some(byte) = text.get(at) {
        let after = text.get(at + 1..).unwrap_or_default();
        match (byte, after) {
            // `.` does not match a line terminator.
            (b'\\', [_, ..]) if !starts_with_line_terminator(after) => at += 2,
            (b'@' | b'?' | b'!' | b'+' | b'*', [b'(', ..]) => {
                let inside = at + 2;
                let end = match line_end {
                    Some(end) if end >= inside => end,
                    _ => end_of_line(text, inside),
                };
                line_end = Some(end);
                if closes.index_from(text, inside).is_some_and(|it| it < end) {
                    return true;
                }
                at += 1;
            }
            _ => at += 1,
        }
    }
    false
}

/// The package `is-glob` 4.0.3, strict.
pub fn is_glob(text: &[u8]) -> bool {
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
    let (mut squares, mut curlies, mut parens) =
        (Next::new(b']'), Next::new(b'}'), Next::new(b')'));
    let (mut pipes, mut backslashes) = (Next::new(b'|'), Next::new(b'\\'));
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
                close_square = Some(squares.index_from(text, index));
            }
            if let Some(Some(close)) = close_square
                && close > index
            {
                if backslash == Some(None) || backslash.flatten().is_some_and(|it| it > close) {
                    return true;
                }
                backslash = Some(backslashes.index_from(text, index));
                if is_before(backslash.flatten(), close) {
                    return true;
                }
            }
        }
        if close_curly != Some(None) && byte == b'{' && at(index + 1) != Some(b'}') {
            close_curly = Some(curlies.index_from(text, index));
            if let Some(Some(close)) = close_curly
                && close > index
            {
                backslash = Some(backslashes.index_from(text, index));
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
            close_paren = Some(parens.index_from(text, index));
            if let Some(Some(close)) = close_paren
                && close > index
            {
                backslash = Some(backslashes.index_from(text, index));
                if is_before(backslash.flatten(), close) {
                    return true;
                }
            }
        }
        if pipe != Some(None) && byte == b'(' && at(index + 1) != Some(b'|') {
            if pipe.flatten().is_none_or(|it| it < index) {
                pipe = Some(pipes.index_from(text, index));
            }
            if let Some(Some(found)) = pipe
                && at(found + 1) != Some(b')')
            {
                close_paren = Some(parens.index_from(text, found));
                if let Some(Some(close)) = close_paren
                    && close > found
                {
                    backslash = Some(backslashes.index_from(text, found));
                    if is_before(backslash.flatten(), close) {
                        return true;
                    }
                }
            }
        }
        if byte == b'\\' {
            let closes = match at(index + 1) {
                Some(b'{') => Some(&mut curlies),
                Some(b'(') => Some(&mut parens),
                Some(b'[') => Some(&mut squares),
                _ => None,
            };
            // The `\\` and one UTF-16 unit.
            index += match at(index + 1) {
                None | Some(0..0xC0) => 2,
                Some(0xE0..0xF0) => 4,
                Some(_) => 3,
            };
            if let Some(found) = closes.and_then(|it| it.index_from(text, index)) {
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

/// Ours: how many names `glob_parent` takes off one by one, which is names x bytes. Beyond it: the top.
const MAX_NAMES: usize = 256;

/// The package `glob-parent` 6.0.2: the directory that everything a pattern matches is in. `.` if there is none.
pub fn glob_parent(pattern: &[u8]) -> Vec<u8> {
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
    let mut taken_off = 0;
    loop {
        parent = match taken_off < MAX_NAMES {
            true => posix_dirname(parent),
            false if parent.starts_with(b"/") => b"/",
            false => b".",
        };
        taken_off += 1;
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
