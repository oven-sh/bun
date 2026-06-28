//! Literal content search over one file's bytes.
//!
//! Runs on worker threads against bytes the worker read itself; the store is
//! never involved. Line and column are computed lazily per hit by counting
//! newlines forward from the previous hit (`memchr`), never by pre-splitting
//! the file. Regex is intentionally not here (no regex engine outside JSC);
//! the runtime layer documents string literals as the fast path.

use crate::store::EntryKind;

/// Binary sniff window: a NUL byte in the first 8 KiB marks the file binary
/// (the same heuristic git's `buffer_is_binary` uses over an 8000-byte
/// window).
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

/// A compiled literal query, reusable across files (and threads, by value).
#[derive(Clone, Debug)]
pub struct GrepQuery {
    /// The needle; ASCII-lowercased when `case_sensitive` is false.
    needle: Vec<u8>,
    case_sensitive: bool,
    /// Files larger than this are skipped ([`GrepOutcome::SkippedTooLarge`]).
    max_file_size: usize,
    /// Index of the rarest needle byte: the case-insensitive scan anchors on
    /// it so the per-position work is one `memchr2` plus a short window
    /// compare.
    anchor: usize,
}

impl GrepQuery {
    /// `None` if `needle` is empty (an empty literal matches everywhere and
    /// is always a caller bug).
    pub fn literal(needle: &[u8], case_sensitive: bool, max_file_size: usize) -> Option<GrepQuery> {
        if needle.is_empty() {
            return None;
        }
        let mut stored = needle.to_vec();
        if !case_sensitive {
            stored.make_ascii_lowercase();
        }
        let anchor = rarest_byte_index(&stored);
        Some(GrepQuery {
            needle: stored,
            case_sensitive,
            max_file_size,
            anchor,
        })
    }

    #[inline]
    pub fn needle(&self) -> &[u8] {
        &self.needle
    }

    #[inline]
    pub fn case_sensitive(&self) -> bool {
        self.case_sensitive
    }

    #[inline]
    pub fn max_file_size(&self) -> usize {
        self.max_file_size
    }

    /// Whether an indexed entry of this kind is even a grep candidate. The
    /// index has no crawl-time sizes (the crawl is enumeration-only), so
    /// `max_file_size` and the regular-file check are enforced by the reader
    /// with `fstat(fd)` after the `open()` it already does, never here.
    /// Associated, not a method: candidate admission is shared with the
    /// RegExp path, which has no compiled literal query.
    pub fn admits(kind: EntryKind) -> bool {
        kind == EntryKind::File
    }
}

/// One match. `line` and `column` are 1-based; `column` is a byte offset
/// within the line. `line_text` excludes the trailing `\n` (and `\r`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GrepHit<'a> {
    pub byte_offset: usize,
    pub line: u32,
    pub column: u32,
    pub line_text: &'a [u8],
}

/// Why a file produced no further hits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GrepOutcome {
    /// The file was searched to the end (or until the sink stopped it).
    Searched { hits: usize },
    /// A NUL byte in the first [`BINARY_SNIFF_BYTES`] — not searched.
    SkippedBinary,
    /// Larger than the query's `max_file_size` — not searched.
    SkippedTooLarge,
}

/// Search `haystack` (one whole file) for the query's literal.
///
/// `sink` receives `(path, hit)` per match and returns `false` to stop early
/// (e.g. a global result limit). Matches are non-overlapping, left to right.
pub fn grep_file<'h>(
    haystack: &'h [u8],
    query: &GrepQuery,
    path: &[u8],
    sink: &mut impl FnMut(&[u8], GrepHit<'h>) -> bool,
) -> GrepOutcome {
    if haystack.len() > query.max_file_size {
        return GrepOutcome::SkippedTooLarge;
    }
    let sniff = haystack.len().min(BINARY_SNIFF_BYTES);
    if memchr::memchr(0, &haystack[..sniff]).is_some() {
        return GrepOutcome::SkippedBinary;
    }

    let mut hits = 0usize;
    let mut pos = 0usize;
    // Line state advances monotonically: only the bytes between consecutive
    // hits are ever scanned for newlines.
    let mut line: u32 = 1;
    let mut line_scan_from = 0usize;

    while pos < haystack.len() {
        let Some(at) = find_next(haystack, pos, query) else {
            break;
        };
        line = line.saturating_add(count_newlines(&haystack[line_scan_from..at]));
        line_scan_from = at;
        let line_start = memchr::memrchr(b'\n', &haystack[..at]).map_or(0, |i| i + 1);
        let line_end = memchr::memchr(b'\n', &haystack[at..]).map_or(haystack.len(), |i| at + i);
        let mut line_text = &haystack[line_start..line_end];
        if line_text.last() == Some(&b'\r') {
            line_text = &line_text[..line_text.len() - 1];
        }
        hits += 1;
        let hit = GrepHit {
            byte_offset: at,
            line,
            column: (at - line_start + 1) as u32,
            line_text,
        };
        if !sink(path, hit) {
            break;
        }
        pos = at + query.needle.len().max(1);
    }
    GrepOutcome::Searched { hits }
}

fn count_newlines(bytes: &[u8]) -> u32 {
    let n = memchr::memchr_iter(b'\n', bytes).count();
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Next match at or after `from`, or `None`.
fn find_next(haystack: &[u8], from: usize, query: &GrepQuery) -> Option<usize> {
    let needle = &query.needle;
    if query.case_sensitive {
        // In the shipped binary this is the SIMD `memmem` kernel (the build
        // aliases it to highway); in a test binary it is libc `memmem`.
        return bun_core::strings::memmem(&haystack[from..], needle).map(|i| from + i);
    }
    // Case-insensitive: hop between occurrences of the rarest needle byte
    // (either case) and compare the candidate window ignoring ASCII case.
    let nlen = needle.len();
    let anchor_byte = needle[query.anchor];
    let mut anchor_at = from.checked_add(query.anchor)?;
    while anchor_at < haystack.len() {
        let rel = find_byte_ignore_case(anchor_byte, &haystack[anchor_at..])?;
        anchor_at += rel;
        let start = anchor_at - query.anchor;
        match haystack.get(start..start + nlen) {
            Some(window) if window.eq_ignore_ascii_case(needle) => return Some(start),
            Some(_) => {}
            // The window runs past the end: no later start can fit either.
            None => return None,
        }
        anchor_at += 1;
    }
    None
}

/// First occurrence of `b` (an already-lowercased byte) in either case.
#[inline]
fn find_byte_ignore_case(b: u8, hay: &[u8]) -> Option<usize> {
    if b.is_ascii_lowercase() {
        memchr::memchr2(b, b.to_ascii_uppercase(), hay)
    } else {
        memchr::memchr(b, hay)
    }
}

/// Index of the needle byte least common in typical source text, so the
/// case-insensitive anchor scan stops as rarely as possible. The buckets are
/// a coarse static ranking, not a measured corpus; ties keep the first.
fn rarest_byte_index(needle: &[u8]) -> usize {
    let mut best = 0usize;
    let mut best_rank = u8::MAX;
    for (i, &b) in needle.iter().enumerate() {
        let rank = commonness(b);
        if rank < best_rank {
            best_rank = rank;
            best = i;
        }
    }
    best
}

fn commonness(b: u8) -> u8 {
    match b.to_ascii_lowercase() {
        b' ' | b'e' | b't' | b'a' | b'o' | b'i' | b'n' | b's' | b'r' => 4,
        b'h' | b'l' | b'd' | b'c' | b'u' | b'm' | b'f' | b'_' | b'.' | b'/' => 3,
        b'p' | b'g' | b'w' | b'y' | b'b' | b'v' | b'(' | b')' | b'=' | b'"' => 2,
        b'k' | b'x' | b'j' | b'q' | b'z' | b'0'..=b'9' => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_LIMIT: usize = 1 << 20;

    fn collect<'h>(haystack: &'h [u8], query: &GrepQuery) -> (Vec<GrepHit<'h>>, GrepOutcome) {
        let mut hits = Vec::new();
        let outcome = grep_file(haystack, query, b"x", &mut |path, hit| {
            assert_eq!(path, b"x");
            hits.push(hit);
            true
        });
        (hits, outcome)
    }

    fn q(needle: &[u8]) -> GrepQuery {
        GrepQuery::literal(needle, true, NO_LIMIT).unwrap()
    }

    fn qi(needle: &[u8]) -> GrepQuery {
        GrepQuery::literal(needle, false, NO_LIMIT).unwrap()
    }

    #[test]
    fn empty_needle_is_rejected() {
        assert!(GrepQuery::literal(b"", true, NO_LIMIT).is_none());
        assert!(GrepQuery::literal(b"", false, NO_LIMIT).is_none());
    }

    #[test]
    fn hit_at_offset_zero_and_exact_line_columns() {
        let hay = b"needle at start\nthen a needle here\n";
        let (hits, outcome) = collect(hay, &q(b"needle"));
        assert_eq!(outcome, GrepOutcome::Searched { hits: 2 });
        assert_eq!(
            hits,
            vec![
                GrepHit {
                    byte_offset: 0,
                    line: 1,
                    column: 1,
                    line_text: b"needle at start"
                },
                GrepHit {
                    byte_offset: 23,
                    line: 2,
                    column: 8,
                    line_text: b"then a needle here"
                },
            ]
        );
    }

    #[test]
    fn multiple_hits_on_one_line_are_non_overlapping() {
        let hay = b"aba abab ab\n";
        let (hits, _) = collect(hay, &q(b"ab"));
        let offsets: Vec<usize> = hits.iter().map(|h| h.byte_offset).collect();
        assert_eq!(offsets, vec![0, 4, 6, 9]);
        assert!(hits.iter().all(|h| h.line == 1));
        assert_eq!(
            hits.iter().map(|h| h.column).collect::<Vec<_>>(),
            vec![1, 5, 7, 10]
        );
        // Overlap check: "aaa" contains "aa" once non-overlapping at 0.
        let (hits, _) = collect(b"aaa", &q(b"aa"));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].byte_offset, 0);
    }

    #[test]
    fn last_line_without_trailing_newline() {
        let hay = b"first\nlast line match";
        let (hits, _) = collect(hay, &q(b"match"));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].column, 11);
        assert_eq!(hits[0].line_text, b"last line match");
    }

    #[test]
    fn crlf_lines_strip_the_carriage_return_from_line_text() {
        let hay = b"alpha\r\nbeta target\r\ngamma\r\n";
        let (hits, _) = collect(hay, &q(b"target"));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].column, 6);
        assert_eq!(hits[0].line_text, b"beta target");
    }

    #[test]
    fn nul_byte_in_sniff_window_skips_as_binary() {
        let hay = b"text \x00 more needle";
        assert_eq!(collect(hay, &q(b"needle")).1, GrepOutcome::SkippedBinary);
        // A NUL past the sniff window does not mark the file binary.
        let mut big = vec![b'a'; BINARY_SNIFF_BYTES];
        big.extend_from_slice(b"needle\x00");
        let (hits, outcome) = collect(&big, &q(b"needle"));
        assert_eq!(outcome, GrepOutcome::Searched { hits: 1 });
        assert_eq!(hits[0].byte_offset, BINARY_SNIFF_BYTES);
    }

    #[test]
    fn over_max_file_size_is_skipped_before_any_work() {
        let query = GrepQuery::literal(b"x", true, 4).unwrap();
        assert_eq!(collect(b"xxxxx", &query).1, GrepOutcome::SkippedTooLarge);
        // Exactly at the limit is searched.
        assert_eq!(
            collect(b"xxxx", &query).1,
            GrepOutcome::Searched { hits: 4 }
        );
    }

    #[test]
    fn case_insensitive_matches_any_casing_and_reports_the_original_line() {
        let hay = b"FooBar\nfoobar\nFOOBAR\nf00bar\n";
        let (hits, _) = collect(hay, &qi(b"fooBAR"));
        assert_eq!(hits.len(), 3);
        assert_eq!(
            hits.iter().map(|h| h.line).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(hits[0].line_text, b"FooBar");
        // Case-sensitive sees exactly one.
        let (hits, _) = collect(hay, &q(b"foobar"));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
    }

    #[test]
    fn case_insensitive_anchor_is_correct_at_window_edges() {
        // Anchor lands on 'z' (rarest); candidates near both ends of the
        // haystack exercise the window bounds checks.
        let query = qi(b"xyz");
        let (hits, _) = collect(b"XYZ", &query);
        assert_eq!(hits.len(), 1);
        let (hits, _) = collect(b"zzxy", &query);
        assert!(hits.is_empty());
        let (hits, _) = collect(b"xy", &query);
        assert!(hits.is_empty());
        let (hits, _) = collect(b"--xYz", &query);
        assert_eq!(hits[0].byte_offset, 2);
        // Non-letter anchors (no case fold) still match.
        let (hits, _) = collect(b"A_B a_b", &qi(b"a_b"));
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn non_ascii_bytes_match_exactly_in_both_modes() {
        let hay = "préfix\nPRÉFIX\n".as_bytes();
        let (hits, _) = collect(hay, &q("préfix".as_bytes()));
        assert_eq!(hits.len(), 1);
        // ASCII letters fold; the é bytes must still compare exactly, so the
        // capital-É line never matches a lowercase-é needle (and vice versa).
        let (hits, _) = collect(hay, &qi("PRéFIX".as_bytes()));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 1);
        let (hits, _) = collect(hay, &qi("prÉfix".as_bytes()));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
    }

    #[test]
    fn sink_returning_false_stops_the_scan() {
        let hay = b"x\nx\nx\nx\n";
        let query = q(b"x");
        let mut seen = 0;
        let outcome = grep_file(hay, &query, b"p", &mut |_, _| {
            seen += 1;
            seen < 2
        });
        assert_eq!(seen, 2);
        assert_eq!(outcome, GrepOutcome::Searched { hits: 2 });
    }

    #[test]
    fn empty_file_and_needle_longer_than_file() {
        assert_eq!(collect(b"", &q(b"a")).1, GrepOutcome::Searched { hits: 0 });
        assert_eq!(
            collect(b"ab", &q(b"abc")).1,
            GrepOutcome::Searched { hits: 0 }
        );
        let (hits, _) = collect(b"ab", &qi(b"abc"));
        assert!(hits.is_empty());
    }

    #[test]
    fn admits_filters_on_kind_only() {
        // The size limit is enforced by the reader (`fstat` after `open`),
        // never from the index: the crawl records no sizes.
        assert!(GrepQuery::admits(EntryKind::File));
        assert!(!GrepQuery::admits(EntryKind::Dir));
        assert!(!GrepQuery::admits(EntryKind::Symlink));
    }

    #[test]
    fn rarest_byte_prefers_uncommon_characters() {
        assert_eq!(rarest_byte_index(b"sez"), 2);
        assert_eq!(rarest_byte_index(b"@aa"), 0);
        assert_eq!(rarest_byte_index(b"aaa"), 0);
    }
}
