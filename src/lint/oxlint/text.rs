//! What the rules of oxlint do with text: the methods of `str` and `Path` that they call, which differ from what
//! JavaScript has, on bytes, and the search in the source text of `LintContext`.

use bun_core::strings;
use bun_lint::prelude::*;

/// `str::trim`, which goes by the property `White_Space` of Unicode.
pub fn trim(s: &[u8]) -> &[u8] {
    let mut rest = trim_start(s);
    while let Some(c) = text::last_code_point(rest)
        .and_then(char::from_u32)
        .filter(|it| it.is_whitespace())
    {
        rest = rest
            .get(..rest.len().saturating_sub(c.len_utf8()))
            .unwrap_or_default();
    }
    rest
}

/// `str::trim_start`. It reads what it takes away and no more: `s` can be the rest of the file.
pub fn trim_start(s: &[u8]) -> &[u8] {
    let mut at = 0;
    loop {
        let (c, size) = text::code_point_at(s, at);
        if size == 0 || !char::from_u32(c).is_some_and(char::is_whitespace) {
            return s.get(at..).unwrap_or_default();
        }
        at += size;
    }
}

/// `s.chars().all(char::is_whitespace)`
pub fn is_whitespace(s: &[u8]) -> bool {
    trim_start(s).is_empty()
}

/// `str::split_whitespace`
pub fn split_whitespace(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    std::str::from_utf8(text)
        .unwrap_or_default()
        .split_whitespace()
        .map(str::as_bytes)
}

/// Whether `name` is in `sorted`, which is sorted.
pub fn contains_name(sorted: &[&str], name: &[u8]) -> bool {
    sorted
        .binary_search_by(|it| it.as_bytes().cmp(name))
        .is_ok()
}

/// `fast_glob::glob_match`
pub fn glob_match(pattern: &[u8], text: &[u8]) -> bool {
    bun_glob::r#match(pattern, text).matches()
}

/// `Path::file_name`
pub fn file_name(file_path: &[u8]) -> &[u8] {
    strings::rsplit_once_char(file_path, b'/').map_or(file_path, |it| it.1)
}

/// `Path::extension`: `tsx` of `a/b.c.tsx`. A name like `.tsx` has none.
pub fn file_extension(path: &[u8]) -> Option<&[u8]> {
    strings::rsplit_once_char(file_name(path), b'.')
        .filter(|it| !it.0.is_empty())
        .map(|it| it.1)
}

/// `LintContext::find_next_token_within`: where the text `token` is first in `within`, not in a comment. It looks at
/// the text only: what is in a string counts.
pub fn find_next_token_within<'a>(file: &'a File<'a>, within: Span, token: &[u8]) -> Option<u32> {
    let mut from = within.start;
    loop {
        let rest = Span::new(from, within.end);
        let at = from + strings::index_of(file.slice(rest), token)? as u32;
        match file.comment_around(at) {
            Some(comment) => from = comment.end().max(at + 1),
            None => return Some(at),
        }
    }
}
