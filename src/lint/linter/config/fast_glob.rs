//! The patterns of oxlint and oxfmt: `files` and `excludeFiles` of an override, and the patterns on
//! the command line of oxfmt. There they go to `glob_match` of the crate `fast-glob`, a fork of
//! `glob-match`, which `bun_glob` is a port of too.

use super::minimatch::{How, Minimatch, SplitPath};
use bun_core::strings;

/// An element of oxc's `GlobSet`.
pub struct FastGlob {
    pattern: Box<[u8]>,
    /// The names at the start that are without magic, joined by slashes: what matches starts with them.
    head: Box<[u8]>,
    /// What matches ends with.
    tail: Box<[u8]>,
}

/// `Invalid glob pattern ..`: what starts with `open` at `at` in `written` is not closed.
fn unclosed(written: &[u8], what: &str, at: usize, open: char, close: char) -> Vec<u8> {
    let why = format!(
        "`: unclosed {what} at byte {at}; missing '{close}' (to match a literal '{open}', escape it as '\\{open}' or '[{open}]')"
    );
    [b"Invalid glob pattern `", written, why.as_bytes()].concat()
}

impl FastGlob {
    /// What oxlint and oxfmt refuse the pattern `written` with. `None`: they take it.
    pub fn refusal(written: &[u8]) -> Option<Vec<u8>> {
        // How many groups are open, and where the outermost of them starts.
        let (mut depth, mut outermost) = (0_usize, 0);
        let mut at = 0;
        while let Some(&byte) = written.get(at) {
            match byte {
                b'\\' if at + 1 == written.len() => return None,
                b'\\' => at += 1,
                b'[' => {
                    let mut end = at + 1;
                    end += usize::from(matches!(written.get(end), Some(b'!' | b'^')));
                    // Here it is a character of the class.
                    end += usize::from(written.get(end) == Some(&b']'));
                    loop {
                        match written.get(end) {
                            None => {
                                return Some(unclosed(written, "character class", at, '[', ']'));
                            }
                            Some(b']') => break,
                            Some(b'\\') => end += 2,
                            Some(_) => end += 1,
                        }
                    }
                    at = end;
                }
                b'{' => {
                    if depth == 0 {
                        outermost = at;
                    }
                    depth += 1;
                }
                b'}' => depth = depth.saturating_sub(1),
                _ => {}
            }
            at += 1;
        }
        (depth > 0).then(|| unclosed(written, "brace expansion", outermost, '{', '}'))
    }

    /// `GlobSet::new`: a pattern without a slash is for a name in any directory.
    pub fn new(written: &[u8]) -> FastGlob {
        let pattern = match written.strip_prefix(b"./") {
            Some(rest) => rest.to_vec(),
            None if strings::contains_char(written, b'/') => written.to_vec(),
            None => [b"**/", written].concat(),
        };
        let is_negated = pattern.starts_with(b"!");
        let head = match strings::index_of_any(&pattern, b"*?[{\\") {
            _ if is_negated => &b""[..],
            None => &pattern[..],
            Some(magic) => {
                &pattern[..strings::last_index_of_char(&pattern[..magic], b'/').unwrap_or(0)]
            }
        };
        // What is behind a group can be part of one that is not closed. `**/` can be nothing.
        let tail = match strings::index_of_any(&pattern, b"{}\\") {
            None if !is_negated => {
                let tail =
                    &pattern[strings::last_index_of_any(&pattern, b"*?]").map_or(0, |at| at + 1)..];
                tail.strip_prefix(b"/").unwrap_or(tail)
            }
            _ => &b""[..],
        };
        FastGlob {
            head: head.into(),
            tail: tail.into(),
            pattern: pattern.into(),
        }
    }

    /// `glob_match(pattern, path)`. `path` is separated by `/`.
    pub fn matches(&self, path: &[u8]) -> bool {
        path.ends_with(&self.tail) && bun_glob::r#match(&self.pattern, path).matches()
    }
}

/// What a pattern in `files` or `ignores` is matched with.
pub(super) enum Matcher {
    /// ESLint's.
    Minimatch(Minimatch),
    /// oxlint's.
    FastGlob(FastGlob),
}

impl Matcher {
    /// `flip_negate`: a `!` at the start of the pattern is ignored. Only ESLint asks for that.
    pub(super) fn matches(&self, path: &SplitPath, flip_negate: bool) -> bool {
        match self {
            Matcher::Minimatch(it) => it.matches(path, flip_negate),
            Matcher::FastGlob(it) => it.matches(path.whole()),
        }
    }

    /// `match(path, partial)`. A pattern of oxlint does not say what can match in a directory, so anything can.
    pub(super) fn matches_path(&self, path: &[u8], how: How) -> bool {
        match self {
            Matcher::Minimatch(it) => it.matches_path(path, how),
            Matcher::FastGlob(it) => how.partial || it.matches(path),
        }
    }

    /// What a path that matches starts with, up to a slash or to its end: one of these. `None` if the pattern does not say.
    pub(super) fn heads(&self) -> Option<Vec<&[u8]>> {
        match self {
            Matcher::Minimatch(it) => it.heads().map(Vec::from_iter),
            Matcher::FastGlob(it) => (!it.head.is_empty()).then(|| vec![&it.head[..]]),
        }
    }
}
