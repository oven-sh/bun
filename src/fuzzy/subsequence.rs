//! Stage-1 prefilter: "is the needle a subsequence of the haystack".
//!
//! Uses `memchr`/`memchr2` to skip runs of non-matching haystack bytes, so the
//! overwhelming majority of candidates are rejected in a few nanoseconds each.
//! The fold rules are byte-for-byte the same ones the scorer uses (ASCII-only
//! case folding), so the prefilter can never reject a candidate the scorer
//! would have scored.

/// Returns true iff `needle_lower` is a (not necessarily contiguous)
/// subsequence of `haystack`.
///
/// When `case_sensitive` is false, `needle_lower` must already be
/// ASCII-lowercased (it is defensively re-folded byte by byte) and ASCII
/// letters in the haystack match either case. Non-ASCII bytes always compare
/// exactly. An empty needle matches everything.
pub fn is_subsequence(haystack: &[u8], needle_lower: &[u8], case_sensitive: bool) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    if needle_lower.len() > haystack.len() {
        return false;
    }
    let mut rest = haystack;
    for &raw in needle_lower {
        let found = find_folded(raw, rest, case_sensitive);
        match found {
            Some(i) => rest = &rest[i + 1..],
            None => return false,
        }
    }
    true
}

/// First index of a byte matching `needle_byte` under the crate's fold rules.
#[inline]
fn find_folded(needle_byte: u8, hay: &[u8], case_sensitive: bool) -> Option<usize> {
    if case_sensitive {
        return memchr::memchr(needle_byte, hay);
    }
    let lower = needle_byte.to_ascii_lowercase();
    if lower.is_ascii_lowercase() {
        memchr::memchr2(lower, lower.to_ascii_uppercase(), hay)
    } else {
        memchr::memchr(lower, hay)
    }
}

/// Greedy leftmost subsequence positions, written into `out` (cleared first).
///
/// Used as the documented fallback for `score_with_positions` past the exact
/// backtracking bounds; the positions are a valid match but not necessarily
/// the optimal-scoring alignment. Returns false (and leaves `out` empty) if
/// the needle is not a subsequence or an index does not fit in `u32`.
pub(crate) fn greedy_positions(
    haystack: &[u8],
    needle: &[u8],
    case_sensitive: bool,
    out: &mut Vec<u32>,
) -> bool {
    out.clear();
    let mut offset = 0usize;
    for &raw in needle {
        let Some(i) = find_folded(raw, &haystack[offset..], case_sensitive) else {
            out.clear();
            return false;
        };
        let abs = offset + i;
        let Ok(idx) = u32::try_from(abs) else {
            out.clear();
            return false;
        };
        out.push(idx);
        offset = abs + 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_driven() {
        // (haystack, needle, case_sensitive, expected)
        let cases: &[(&[u8], &[u8], bool, bool)] = &[
            (b"", b"", true, true),
            (b"", b"", false, true),
            (b"abc", b"", false, true),
            (b"", b"a", false, false),
            (b"abc", b"abc", true, true),
            (b"abc", b"abcd", true, false),
            (b"abc", b"ac", true, true),
            (b"abc", b"ca", true, false),
            (b"src/server/index.ts", b"srvidx", false, true),
            (b"src/server/index.ts", b"srvidz", false, false),
            // Case folding: ASCII only.
            (b"FooBar", b"foobar", false, true),
            (b"FooBar", b"foobar", true, false),
            (b"FooBar", b"FB", true, true),
            (b"foobar", b"FB", true, false),
            // Non-letter needle bytes are unaffected by folding.
            (b"a-b_c", b"-_", false, true),
            (b"a-b_c", b"-_", true, true),
            // Non-ASCII bytes compare exactly in both modes.
            (b"a\xc3\xa9b", b"\xc3\xa9", false, true),
            (b"a\xc3\xa9b", b"\xc3\xa9", true, true),
            (b"a\xc3\xa9b", b"\xc3\x89", false, false),
            // Repeated needle bytes need distinct haystack bytes.
            (b"aa", b"aaa", false, false),
            (b"aaa", b"aaa", false, true),
            (b"aXa", b"aaa", false, false),
            (b"aXaA", b"aaa", false, true),
        ];
        for &(hay, needle, cs, want) in cases {
            assert_eq!(
                is_subsequence(hay, needle, cs),
                want,
                "hay={:?} needle={:?} cs={cs}",
                hay.escape_ascii().to_string(),
                needle.escape_ascii().to_string(),
            );
        }
    }

    #[test]
    fn greedy_positions_are_leftmost_and_ascending() {
        let mut out = Vec::new();
        assert!(greedy_positions(b"xaxbxcx", b"abc", false, &mut out));
        assert_eq!(out, vec![1, 3, 5]);

        assert!(greedy_positions(b"aabbcc", b"abc", false, &mut out));
        assert_eq!(out, vec![0, 2, 4]);

        assert!(greedy_positions(b"FooBar", b"ob", false, &mut out));
        assert_eq!(out, vec![1, 3]);

        assert!(!greedy_positions(b"abc", b"abx", false, &mut out));
        assert!(out.is_empty());

        assert!(greedy_positions(b"abc", b"", false, &mut out));
        assert!(out.is_empty());
    }
}
