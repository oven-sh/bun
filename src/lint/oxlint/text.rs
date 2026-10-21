//! Text helpers for oxlint's rules: byte-slice versions of the `str` and `Path` methods they call, which behave
//! differently from their JavaScript counterparts, and `LintContext`'s source text search.

use bun_core::strings;
use bun_lint::prelude::*;

/// `oxc_span`'s `best_match`: the closest of `candidates`, which must be ASCII. `None` if `needle` is one of them, or
/// if its distance to every candidate is more than `threshold`.
pub fn best_match(
    needle: &[u8],
    candidates: &[&'static str],
    threshold: usize,
) -> Option<&'static str> {
    let mut best: Option<(&'static str, usize)> = None;
    for candidate in candidates {
        if candidate.len().abs_diff(needle.len()) > threshold {
            continue;
        }
        // Keep only the first byte of each character. For a non-ASCII character, that byte can't equal any byte of a
        // candidate.
        let characters = needle.iter().copied().filter(|it| it & 0xC0 != 0x80);
        match strings::edit_distance(characters, candidate.as_bytes()) {
            0 => return None,
            distance if distance <= threshold && best.is_none_or(|it| distance < it.1) => {
                best = Some((candidate, distance));
            }
            _ => {}
        }
    }
    best.map(|it| it.0)
}

pub fn contains_name(sorted: &[&str], name: &[u8]) -> bool {
    sorted
        .binary_search_by(|it| it.as_bytes().cmp(name))
        .is_ok()
}

/// `fast_glob::glob_match`, with the groups of ESLint's minimatch.
pub fn glob_match(pattern: &[u8], text: &[u8]) -> bool {
    bun_glob::pattern::fast_glob_match_with_groups(pattern, text)
}

/// `Path::file_name`
pub fn file_name(file_path: &[u8]) -> &[u8] {
    strings::rsplit_once_char(file_path, b'/').map_or(file_path, |it| it.1)
}

/// `Path::extension`: `tsx` for `a/b.c.tsx`. A name like `.tsx` has no extension.
pub fn file_extension(path: &[u8]) -> Option<&[u8]> {
    strings::rsplit_once_char(file_name(path), b'.')
        .filter(|it| !it.0.is_empty())
        .map(|it| it.1)
}

/// `LintContext::find_next_token_within`: the first occurrence of the text `token` in `within` that isn't in a comment.
/// It's a plain text search, so a match inside a string counts.
pub fn find_next_token_within<'a>(file: &'a File<'a>, within: Span, token: &[u8]) -> Option<u32> {
    let mut from = within.start;
    loop {
        let rest = Span::new(from, within.end);
        let at = from + strings::index_of(file.slice(rest), token)? as u32;
        match file.comment_containing(at) {
            Some(comment) => from = comment.end().max(at + 1),
            None => return Some(at),
        }
    }
}
