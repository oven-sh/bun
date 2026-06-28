//! One parsed `.gitignore` line, mirroring git.git `dir.c`
//! (`struct path_pattern` + `parse_path_pattern()`).

use crate::wildmatch::{WildmatchFlags, wildmatch};

bitflags::bitflags! {
    /// dir.h `PATTERN_FLAG_*`.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) struct PatternFlags: u8 {
        /// `!pattern` (dir.h `PATTERN_FLAG_NEGATIVE`).
        const NEGATED = 1 << 0;
        /// Trailing `/` (dir.h `PATTERN_FLAG_MUSTBEDIR`).
        const DIR_ONLY = 1 << 1;
        /// No `/` in the body => matched against the basename at any depth
        /// below the ignore file (dir.h `PATTERN_FLAG_NODIR`).
        const BASENAME = 1 << 2;
        /// No wildcard bytes at all => plain byte comparison.
        const LITERAL = 1 << 3;
    }
}

/// A single parsed pattern. The body bytes live in the owning
/// [`crate::IgnoreFile`]'s shared buffer; this struct is pure POD so a file
/// with thousands of lines stays one allocation.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Pattern {
    start: usize,
    end: usize,
    /// Length of the leading wildcard-free prefix of the body
    /// (dir.c `nowildcardlen` / `simple_length()`).
    nowildcard_len: usize,
    flags: PatternFlags,
}

impl Pattern {
    #[inline]
    pub(crate) fn body<'a>(&self, buf: &'a [u8]) -> &'a [u8] {
        &buf[self.start..self.end]
    }

    #[inline]
    pub(crate) fn is_negated(&self) -> bool {
        self.flags.contains(PatternFlags::NEGATED)
    }

    /// dir.c `last_matching_pattern_from_list()` body, for one pattern.
    ///
    /// `rel_to_base` is the candidate path relative to the directory holding
    /// the ignore file; `basename` is its final component; both are
    /// `/`-separated and non-empty.
    pub(crate) fn matches(
        &self,
        buf: &[u8],
        rel_to_base: &[u8],
        basename: &[u8],
        is_dir: bool,
    ) -> bool {
        if self.flags.contains(PatternFlags::DIR_ONLY) && !is_dir {
            return false;
        }
        let body = self.body(buf);
        if self.flags.contains(PatternFlags::BASENAME) {
            // dir.c `match_basename()`: literal compare, else fnmatch with no
            // WM_PATHNAME (a basename never contains `/`).
            if self.flags.contains(PatternFlags::LITERAL) {
                return body == basename;
            }
            return wildmatch(body, basename, WildmatchFlags::empty());
        }
        // dir.c `match_pathname()`: the pattern (leading `/` already
        // stripped) is implicitly anchored at the ignore file's directory.
        if self.flags.contains(PatternFlags::LITERAL) {
            return body == rel_to_base;
        }
        let prefix = self.nowildcard_len;
        if prefix > rel_to_base.len() || body[..prefix] != rel_to_base[..prefix] {
            return false;
        }
        wildmatch(body, rel_to_base, WildmatchFlags::PATHNAME)
    }
}

/// dir.c `is_glob_special()`: `GIT_GLOB_SPECIAL` = `*`, `?`, `[`, `\`
/// (ctype.c `sane_ctype[]`, entries marked `G`).
#[inline]
fn is_glob_special(c: u8) -> bool {
    matches!(c, b'*' | b'?' | b'[' | b'\\')
}

/// dir.c `simple_length()`: number of leading non-glob-special bytes.
fn simple_length(s: &[u8]) -> usize {
    s.iter()
        .position(|&c| is_glob_special(c))
        .unwrap_or(s.len())
}

/// dir.c `trim_trailing_spaces()`: drop trailing unescaped SPACE bytes.
/// A `\` consumes the following byte (so `\ ` survives, backslash included —
/// wildmatch later turns `\ ` into a literal space). Returns the kept length.
fn trim_trailing_spaces(line: &[u8]) -> usize {
    let mut last_space: Option<usize> = None;
    let mut i = 0;
    while i < line.len() {
        match line[i] {
            b' ' => {
                if last_space.is_none() {
                    last_space = Some(i);
                }
            }
            b'\\' => {
                i += 1;
                if i == line.len() {
                    return line.len();
                }
                last_space = None;
            }
            _ => last_space = None,
        }
        i += 1;
    }
    last_space.unwrap_or(line.len())
}

/// Parses one logical `.gitignore` line (already split on `\n`).
/// Appends the pattern body to `buf` and returns the `Pattern`, or `None`
/// for blank lines, comments, and patterns that can never match.
///
/// dir.c `add_patterns_from_buffer()` + `parse_path_pattern()`:
/// - a trailing `\r` (CRLF file) is stripped,
/// - blank lines and lines starting with `#` are no-ops (`\#` escapes it),
/// - trailing unescaped spaces are trimmed,
/// - a leading `!` negates,
/// - a trailing `/` restricts the pattern to directories,
/// - a body with no `/` matches basenames; otherwise it is anchored to the
///   ignore file's directory (a leading `/` only forces anchoring).
pub(crate) fn parse_line(raw: &[u8], buf: &mut Vec<u8>) -> Option<Pattern> {
    let mut line = raw;
    if let Some((&b'\r', rest)) = line.split_last() {
        line = rest;
    }
    if line.is_empty() || line[0] == b'#' {
        return None;
    }
    let line = &line[..trim_trailing_spaces(line)];

    let mut flags = PatternFlags::empty();
    let mut body = line;
    if let Some((&b'!', rest)) = body.split_first() {
        flags |= PatternFlags::NEGATED;
        body = rest;
    }
    if let Some((&b'/', rest)) = body.split_last() {
        flags |= PatternFlags::DIR_ONLY;
        body = rest;
    }
    if !body.contains(&b'/') {
        flags |= PatternFlags::BASENAME;
    } else if body[0] == b'/' {
        // dir.c `match_pathname()` skips one leading `/`: it only anchors.
        body = &body[1..];
    }
    // git keeps empty bodies (e.g. a lone `!` or `/`) in its lists, but they
    // can never match a non-empty basename or path, so we drop them.
    if body.is_empty() {
        return None;
    }
    let nowildcard_len = simple_length(body).min(body.len());
    if nowildcard_len == body.len() {
        flags |= PatternFlags::LITERAL;
    }

    let start = buf.len();
    buf.extend_from_slice(body);
    Some(Pattern {
        start,
        end: buf.len(),
        nowildcard_len,
        flags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(line: &[u8]) -> Option<(Vec<u8>, Pattern)> {
        let mut buf = Vec::new();
        parse_line(line, &mut buf).map(|p| (buf, p))
    }

    fn flags_of(line: &[u8]) -> PatternFlags {
        parse(line).expect("expected a pattern").1.flags
    }

    fn body_of(line: &[u8]) -> Vec<u8> {
        let (buf, p) = parse(line).expect("expected a pattern");
        p.body(&buf).to_vec()
    }

    #[test]
    fn skips_blank_comment_and_cr_only_lines() {
        for line in [
            b"".as_slice(),
            b"# comment",
            b"#",
            b"\r",
            b"   ",
            b"   \r",
            b"!",
            b"/",
            b"!/",
        ] {
            assert!(parse(line).is_none(), "{line:?}");
        }
        // An escaped hash is a real pattern for the literal name.
        assert_eq!(body_of(b"\\#name"), b"\\#name");
        // A leading space does not make a comment.
        assert_eq!(body_of(b" #x"), b" #x");
    }

    #[test]
    fn negation_dir_only_and_anchoring() {
        assert_eq!(
            flags_of(b"foo"),
            PatternFlags::BASENAME | PatternFlags::LITERAL
        );
        assert_eq!(
            flags_of(b"!foo"),
            PatternFlags::NEGATED | PatternFlags::BASENAME | PatternFlags::LITERAL
        );
        assert_eq!(
            flags_of(b"foo/"),
            PatternFlags::DIR_ONLY | PatternFlags::BASENAME | PatternFlags::LITERAL
        );
        assert_eq!(flags_of(b"/foo"), PatternFlags::LITERAL);
        assert_eq!(body_of(b"/foo"), b"foo");
        assert_eq!(flags_of(b"a/b"), PatternFlags::LITERAL);
        assert_eq!(
            flags_of(b"!a/b/"),
            PatternFlags::NEGATED | PatternFlags::DIR_ONLY | PatternFlags::LITERAL
        );
        // `\!x` is not a negation; `!` after the first byte is literal.
        assert_eq!(flags_of(b"\\!x"), PatternFlags::BASENAME);
        assert_eq!(
            flags_of(b"a!b"),
            PatternFlags::BASENAME | PatternFlags::LITERAL
        );
        // Only the body decides BASENAME; the stripped leading `/` does not.
        assert_eq!(flags_of(b"*.o"), PatternFlags::BASENAME);
        assert!(!flags_of(b"a/*.o").contains(PatternFlags::BASENAME));
    }

    #[test]
    fn trailing_space_rules() {
        // dir.c trim_trailing_spaces(): unescaped trailing spaces drop,
        // escaped ones survive with their backslash.
        assert_eq!(body_of(b"foo   "), b"foo");
        assert_eq!(body_of(b"foo \\  "), b"foo \\ ");
        assert_eq!(body_of(b"a\\ \\ "), b"a\\ \\ ");
        assert_eq!(body_of(b"a\\\\"), b"a\\\\");
        assert_eq!(body_of(b"a\\\\  "), b"a\\\\");
        assert_eq!(body_of(b"a b"), b"a b");
        // Tabs are not trimmed.
        assert_eq!(body_of(b"a\t"), b"a\t");
        // A line ending in a lone backslash is kept as-is.
        assert_eq!(body_of(b"a \\"), b"a \\");
    }

    #[test]
    fn crlf_is_stripped_once() {
        assert_eq!(body_of(b"foo\r"), b"foo");
        assert_eq!(body_of(b"foo\r\r"), b"foo\r");
    }

    #[test]
    fn nowildcard_prefix_classification() {
        let (buf, p) = parse(b"src/*.o").expect("pattern");
        assert_eq!(p.nowildcard_len, 4);
        assert!(!p.flags.contains(PatternFlags::LITERAL));
        assert_eq!(p.body(&buf), b"src/*.o");
        for line in [b"a?b".as_slice(), b"a[b]c", b"a\\!b"] {
            assert!(!flags_of(line).contains(PatternFlags::LITERAL), "{line:?}");
        }
    }

    #[test]
    fn basename_matching_ignores_directory_depth() {
        let (buf, p) = parse(b"*.o").expect("pattern");
        assert!(p.matches(&buf, b"x.o", b"x.o", false));
        assert!(p.matches(&buf, b"deep/dir/x.o", b"x.o", false));
        assert!(!p.matches(&buf, b"x.c", b"x.c", false));
    }

    #[test]
    fn anchored_matching_is_relative_to_base() {
        let (buf, p) = parse(b"/build").expect("pattern");
        assert!(p.matches(&buf, b"build", b"build", true));
        assert!(!p.matches(&buf, b"sub/build", b"build", true));
        let (buf, p) = parse(b"doc/*.txt").expect("pattern");
        assert!(p.matches(&buf, b"doc/a.txt", b"a.txt", false));
        assert!(!p.matches(&buf, b"doc/sub/a.txt", b"a.txt", false));
        assert!(!p.matches(&buf, b"adoc/a.txt", b"a.txt", false));
    }

    #[test]
    fn dir_only_requires_a_directory() {
        let (buf, p) = parse(b"build/").expect("pattern");
        assert!(p.matches(&buf, b"build", b"build", true));
        assert!(!p.matches(&buf, b"build", b"build", false));
    }
}
