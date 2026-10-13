//! What the rules of oxlint do with text: the methods of `str` and `Path` that they call, which differ from what
//! JavaScript has, on bytes, and the search in the source text of `LintContext`.

use bun_core::strings;
use bun_lint::prelude::*;

/// Whether `name` is in `sorted`, which is sorted.
/// `oxc_span`'s `best_match`: the closest of `candidates`, which are ASCII. `None` if `needle` is one of them, or
/// further than `threshold` from all.
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
        // The first byte of each character: that of one that is not ASCII is like nothing in a candidate.
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
