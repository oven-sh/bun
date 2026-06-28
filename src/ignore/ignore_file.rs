//! One parsed `.gitignore`-format file.

use crate::pattern::{Pattern, parse_line};

/// UTF-8 byte-order mark; git skips it (dir.c `add_patterns_from_buffer()`
/// calls `skip_utf8_bom()`).
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// One parsed `.gitignore`-format file (or an equivalent list of patterns),
/// anchored at `base`: the directory containing it, relative to the index
/// root (`b""` for the root), `/`-separated, no trailing `/`. Patterns
/// inside are matched relative to `base`.
pub struct IgnoreFile {
    base: Vec<u8>,
    /// All pattern bodies, concatenated; `Pattern`s index into it.
    buf: Vec<u8>,
    patterns: Vec<Pattern>,
}

impl IgnoreFile {
    /// Parses the raw bytes of a `.gitignore`-format file.
    ///
    /// Handles: a leading UTF-8 BOM, `#` comments, blank lines,
    /// trailing-space stripping (unless backslash-escaped), CRLF line
    /// endings, `!` negation, leading-`/` anchoring, trailing-`/` dir-only,
    /// `\#`/`\!` escapes, and `**` (via wildmatch).
    pub fn parse(base: &[u8], contents: &[u8]) -> IgnoreFile {
        let contents = contents.strip_prefix(UTF8_BOM).unwrap_or(contents);
        let mut file = IgnoreFile::with_capacity(base, contents.len());
        // git splits on `\n` only and appends a missing final newline, so a
        // trailing unterminated line still counts (dir.c `add_patterns()`).
        for line in contents.split(|&c| c == b'\n') {
            file.push_line(line);
        }
        file
    }

    /// Convenience for user-supplied pattern arrays (each element = one line,
    /// processed with the same rules as [`IgnoreFile::parse`]).
    pub fn from_lines<'a>(base: &[u8], lines: impl IntoIterator<Item = &'a [u8]>) -> IgnoreFile {
        let mut file = IgnoreFile::with_capacity(base, 0);
        for line in lines {
            file.push_line(line);
        }
        file
    }

    fn with_capacity(base: &[u8], bytes: usize) -> IgnoreFile {
        IgnoreFile {
            base: base.to_vec(),
            buf: Vec::with_capacity(bytes),
            patterns: Vec::new(),
        }
    }

    fn push_line(&mut self, line: &[u8]) {
        if let Some(pattern) = parse_line(line, &mut self.buf) {
            self.patterns.push(pattern);
        }
    }

    /// The directory this file is anchored at, relative to the index root.
    pub fn base(&self) -> &[u8] {
        &self.base
    }

    pub fn is_empty(&self) -> bool {
        self.patterns.is_empty()
    }

    /// Number of effective patterns (comments and blank lines excluded).
    pub fn len(&self) -> usize {
        self.patterns.len()
    }

    /// Approximate heap bytes held (for the memory budget).
    pub fn memory_cost(&self) -> usize {
        self.base.capacity() + self.buf.capacity() + self.patterns.capacity() * size_of::<Pattern>()
    }

    /// dir.c `last_matching_pattern_from_list()`: scans the patterns in
    /// reverse so the LAST matching line decides; returns its negation flag.
    ///
    /// `rel_to_base`/`basename` are relative to [`Self::base`].
    pub(crate) fn last_match(
        &self,
        rel_to_base: &[u8],
        basename: &[u8],
        is_dir: bool,
    ) -> Option<bool> {
        self.patterns
            .iter()
            .rev()
            .find(|p| p.matches(&self.buf, rel_to_base, basename, is_dir))
            .map(Pattern::is_negated)
    }

    /// Whether `rel_path` (relative to the INDEX root) lies strictly inside
    /// `base`, returning the remainder relative to `base`.
    ///
    /// A `.gitignore` never applies to its own directory or to anything
    /// outside it (git only ever consults a per-directory list for paths
    /// under that directory: dir.c `prep_exclude()`).
    pub(crate) fn rel_to_base<'a>(&self, rel_path: &'a [u8]) -> Option<&'a [u8]> {
        if self.base.is_empty() {
            return if rel_path.is_empty() {
                None
            } else {
                Some(rel_path)
            };
        }
        if rel_path.len() <= self.base.len() + 1
            || !rel_path.starts_with(&self.base)
            || rel_path[self.base.len()] != b'/'
        {
            return None;
        }
        Some(&rel_path[self.base.len() + 1..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_skips_comments_blanks_and_bom() {
        let file = IgnoreFile::parse(
            b"",
            b"\xEF\xBB\xBF# header\n\none\n   \n#two\n\\#three\nfour\r\n",
        );
        assert_eq!(file.len(), 3);
        assert!(!file.is_empty());
    }

    #[test]
    fn last_unterminated_line_counts() {
        let file = IgnoreFile::parse(b"", b"a\nb");
        assert_eq!(file.len(), 2);
        assert_eq!(file.last_match(b"b", b"b", false), Some(false));
    }

    #[test]
    fn empty_and_cr_only_files() {
        assert!(IgnoreFile::parse(b"", b"").is_empty());
        assert_eq!(IgnoreFile::parse(b"", b"").len(), 0);
        assert!(IgnoreFile::parse(b"", b"\r\n").is_empty());
        assert!(IgnoreFile::parse(b"", b"\n\n\r\n").is_empty());
        assert!(IgnoreFile::parse(b"", UTF8_BOM).is_empty());
    }

    #[test]
    fn last_matching_line_wins_within_a_file() {
        let file = IgnoreFile::parse(b"", b"*.log\n!keep.log\n");
        assert_eq!(file.last_match(b"a.log", b"a.log", false), Some(false));
        assert_eq!(file.last_match(b"keep.log", b"keep.log", false), Some(true));
        assert_eq!(file.last_match(b"a.txt", b"a.txt", false), None);
        // Re-ignoring after a negation: the later line wins again.
        let file = IgnoreFile::parse(b"", b"*.log\n!keep.log\nkeep.log\n");
        assert_eq!(
            file.last_match(b"keep.log", b"keep.log", false),
            Some(false)
        );
    }

    #[test]
    fn from_lines_matches_parse() {
        let a = IgnoreFile::parse(b"x", b"*.o\n!keep.o\nbuild/\n");
        let b = IgnoreFile::from_lines(b"x", [b"*.o".as_slice(), b"!keep.o", b"build/"]);
        assert_eq!(a.len(), b.len());
        for path in [b"y.o".as_slice(), b"keep.o", b"build"] {
            assert_eq!(
                a.last_match(path, path, true),
                b.last_match(path, path, true)
            );
        }
    }

    #[test]
    fn rel_to_base_requires_strict_containment() {
        let root = IgnoreFile::parse(b"", b"x\n");
        assert_eq!(root.rel_to_base(b"a"), Some(b"a".as_slice()));
        assert_eq!(root.rel_to_base(b"a/b"), Some(b"a/b".as_slice()));
        assert_eq!(root.rel_to_base(b""), None);

        let sub = IgnoreFile::parse(b"a/b", b"x\n");
        assert_eq!(sub.rel_to_base(b"a/b/c"), Some(b"c".as_slice()));
        assert_eq!(sub.rel_to_base(b"a/b/c/d"), Some(b"c/d".as_slice()));
        assert_eq!(sub.rel_to_base(b"a/b"), None);
        assert_eq!(sub.rel_to_base(b"a/bc"), None);
        assert_eq!(sub.rel_to_base(b"a/bc/d"), None);
        assert_eq!(sub.rel_to_base(b"a"), None);
        assert_eq!(sub.rel_to_base(b"x/y/z"), None);
    }

    #[test]
    fn memory_cost_is_nonzero_and_monotonic() {
        let small = IgnoreFile::parse(b"", b"a\n");
        let big = IgnoreFile::parse(b"", &b"longer-pattern-name\n".repeat(64));
        assert!(small.memory_cost() > 0);
        assert!(big.memory_cost() > small.memory_cost());
    }

    #[test]
    fn huge_single_line_is_handled() {
        // 64 KiB single-line pattern; must parse and match, never panic.
        let mut line = vec![b'a'; 64 * 1024];
        let file = IgnoreFile::parse(b"", &line);
        assert_eq!(file.len(), 1);
        assert_eq!(file.last_match(&line, &line, false), Some(false));
        line.push(b'b');
        assert_eq!(file.last_match(&line, &line, false), None);
    }
}
