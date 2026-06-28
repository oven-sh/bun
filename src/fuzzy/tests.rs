//! Crate-level scorer tests: exact-score pins, ranking sanity, positions,
//! case modes, determinism, and the allocation/scratch contracts.
//!
//! The ranking tests encode product expectations for an autocomplete UI; each
//! one says WHY the ordering must hold.

use crate::score::{
    BONUS_BASENAME_START, BONUS_BOUNDARY, BONUS_BOUNDARY_DELIMITER, BONUS_CAMEL123,
    BONUS_CONSECUTIVE, BONUS_FIRST_CHAR_MULTIPLIER, BONUS_NON_WORD, SCORE_GAP_EXTENSION,
    SCORE_GAP_START, SCORE_MATCH,
};
use crate::{CaseMode, MAX_BACKTRACK_HAYSTACK, Scorer, ScorerOptions, TopK, is_subsequence};

fn scorer_with(opts: ScorerOptions, needle: &[u8]) -> Scorer {
    let mut s = Scorer::new(opts);
    s.set_needle(needle);
    s
}

/// Smart case + path bonuses: the configuration the file index uses.
fn path_scorer(needle: &[u8]) -> Scorer {
    scorer_with(ScorerOptions::default(), needle)
}

fn score(needle: &[u8], haystack: &[u8]) -> Option<i32> {
    path_scorer(needle).score(haystack)
}

fn positions(needle: &[u8], haystack: &[u8]) -> Option<(i32, Vec<u32>)> {
    let mut pos = Vec::new();
    let s = path_scorer(needle).score_with_positions(haystack, &mut pos)?;
    Some((s, pos))
}

/// Asserts `better` strictly outranks `worse` for `needle` (a non-match is
/// ranked below every match).
#[track_caller]
fn assert_ranked(needle: &[u8], better: &[u8], worse: &[u8]) {
    let b = score(needle, better);
    let w = score(needle, worse);
    let b = b.unwrap_or_else(|| {
        panic!(
            "{:?} must match {:?}",
            needle.escape_ascii().to_string(),
            better.escape_ascii().to_string()
        )
    });
    if let Some(w) = w {
        assert!(
            b > w,
            "{:?}: expected {:?} ({b}) > {:?} ({w})",
            needle.escape_ascii().to_string(),
            better.escape_ascii().to_string(),
            worse.escape_ascii().to_string(),
        );
    }
}

const M: i64 = SCORE_MATCH;
/// Positional bonus of the first byte of the basename in path mode.
const FIRST_OF_BASENAME: i64 = BONUS_BOUNDARY_DELIMITER + BONUS_BASENAME_START;

fn as_i32(v: i64) -> i32 {
    i32::try_from(v).expect("test constant fits i32")
}

// ── exact score pins ───────────────────────────────────────────────────────
// These pin the DP against the documented model; if a constant or the
// recurrence changes, they must be re-derived, not nudged.

#[test]
fn exact_score_full_consecutive_match() {
    // "abc" in "abc" (path mode): 'a' opens the (one-component) basename so
    // it earns (delimiter boundary + basename) doubled; 'b' and 'c' continue
    // the run and inherit the run-start bonus.
    let expected = 3 * M + FIRST_OF_BASENAME * BONUS_FIRST_CHAR_MULTIPLIER + 2 * FIRST_OF_BASENAME;
    assert_eq!(score(b"abc", b"abc"), Some(as_i32(expected)));
}

#[test]
fn exact_score_with_boundaries_and_gaps() {
    // "abc" in "a-b-c": two single-byte gaps (gap start only) and two
    // boundary bonuses after '-'.
    let expected = 3 * M
        + FIRST_OF_BASENAME * BONUS_FIRST_CHAR_MULTIPLIER
        + 2 * BONUS_BOUNDARY
        + 2 * SCORE_GAP_START;
    assert_eq!(score(b"abc", b"a-b-c"), Some(as_i32(expected)));
}

#[test]
fn exact_score_with_long_gaps() {
    // "abc" in "axxbxxc": two 2-byte gaps (start + one extension each), no
    // boundary bonuses.
    let expected = 3 * M
        + FIRST_OF_BASENAME * BONUS_FIRST_CHAR_MULTIPLIER
        + 2 * (SCORE_GAP_START + SCORE_GAP_EXTENSION);
    assert_eq!(score(b"abc", b"axxbxxc"), Some(as_i32(expected)));
}

#[test]
fn exact_score_camel_case() {
    // "fbr" in "FooBarRenderer": 'F' starts the basename, 'B' and 'R' are
    // lower->Upper camel transitions; both gaps skip two bytes.
    let expected = 3 * M
        + FIRST_OF_BASENAME * BONUS_FIRST_CHAR_MULTIPLIER
        + 2 * BONUS_CAMEL123
        + 2 * (SCORE_GAP_START + SCORE_GAP_EXTENSION);
    assert_eq!(score(b"fbr", b"FooBarRenderer"), Some(as_i32(expected)));
}

#[test]
fn exact_score_basename_component() {
    // "foo" in "src/foo.ts": 'f' follows '/' and starts the basename; "oo"
    // continues the run, inheriting the run-start bonus (fzf carries the
    // first-byte bonus through an unbroken run).
    let expected = 3 * M + FIRST_OF_BASENAME * BONUS_FIRST_CHAR_MULTIPLIER + 2 * FIRST_OF_BASENAME;
    assert_eq!(score(b"foo", b"src/foo.ts"), Some(as_i32(expected)));
    // Same subsequence one directory up: no basename bonus.
    let expected = 3 * M
        + BONUS_BOUNDARY_DELIMITER * BONUS_FIRST_CHAR_MULTIPLIER
        + 2 * BONUS_BOUNDARY_DELIMITER;
    assert_eq!(score(b"foo", b"src/food/index.ts"), Some(as_i32(expected)));
}

#[test]
fn affine_gap_start_costs_more_than_extension() {
    // Skipping one byte costs SCORE_GAP_START; skipping two costs one more
    // SCORE_GAP_EXTENSION, not a second gap-start.
    let one = score(b"ab", b"axb").expect("matches");
    let two = score(b"ab", b"axxb").expect("matches");
    assert_eq!(
        i64::from(one - two),
        -SCORE_GAP_EXTENSION,
        "axb={one} axxb={two}"
    );
    assert!(one > two);
}

#[test]
fn consecutive_floor_bonus_applies_mid_word() {
    // "bc" inside "abcd": 'b' has no positional bonus, but 'c' still earns
    // the consecutive-run floor so the unbroken run beats restarting a gap.
    let expected = 2 * M + BONUS_CONSECUTIVE;
    assert_eq!(score(b"bc", b"abcd"), Some(as_i32(expected)));
}

// ── ranking sanity (design contract) ───────────────────────────────────────

#[test]
fn ranks_tighter_matches_higher() {
    // Fewer / shorter gaps must win: an exact run beats a separated one,
    // which beats a sprawling one.
    assert_ranked(b"abc", b"abc", b"a-b-c");
    assert_ranked(b"abc", b"a-b-c", b"axxbxxc");
}

#[test]
fn ranks_basename_match_over_directory_match() {
    // "foo" as the basename is what the user means; the same letters at the
    // start of a deeper directory must rank below it. "tools/of_old.ts" does
    // not even contain the subsequence and must not match at all.
    assert_ranked(b"foo", b"src/foo.ts", b"src/food/index.ts");
    assert_eq!(score(b"foo", b"tools/of_old.ts"), None);
}

#[test]
fn matches_multi_component_abbreviation() {
    // "srvidx" is a typical per-component abbreviation; it must survive the
    // subsequence prefilter and the DP.
    assert!(is_subsequence(b"src/server/index.ts", b"srvidx", false));
    assert!(score(b"srvidx", b"src/server/index.ts").is_some());
}

#[test]
fn ranks_camel_case_initials_highly() {
    // The uppercase (camelCase) bonus is what makes initial-letter queries
    // work: the camel-cased name must beat the same letters without case
    // boundaries and beat letters buried mid-word.
    assert_ranked(b"fbr", b"FooBarRenderer", b"foobarrenderer");
    assert_ranked(b"fbr", b"FooBarRenderer", b"fxxbxxr");
}

#[test]
fn ranks_basename_start_over_path_start_in_path_mode() {
    // path_mode: a basename hit ("index.ts") outranks the same hit at the
    // start of a parent directory name ("index_helpers/"). This is the whole
    // point of the basename bonus.
    assert_ranked(b"index", b"a/index.ts", b"index_helpers/z.ts");
}

#[test]
fn default_mode_has_no_basename_preference() {
    // Negative contract for the flag: with path_mode off the same pair flips,
    // because the start of the string (after virtual whitespace) is the
    // highest-bonus position in fzf's default scheme.
    let opts = ScorerOptions {
        case: CaseMode::Smart,
        path_mode: false,
    };
    let a = scorer_with(opts, b"index")
        .score(b"index_helpers/z.ts")
        .expect("matches");
    let b = scorer_with(opts, b"index")
        .score(b"a/index.ts")
        .expect("matches");
    assert!(a > b, "default scheme: {a} <= {b}");
}

#[test]
fn ranks_word_start_over_word_middle() {
    // A match at the start of the (sole) component beats the same letters
    // starting mid-word.
    assert_ranked(b"main", b"main.rs", b"domain.rs");
}

#[test]
fn full_haystack_match_is_maximal() {
    // A needle equal to the entire haystack achieves the maximum possible
    // score for that needle: nothing can add bytes and score higher (ties are
    // broken by the caller's tiebreak, e.g. path length).
    let needle = b"abc";
    let exact = score(needle, needle).expect("matches");
    for hay in [
        b"abc".as_slice(),
        b"abcd",
        b"zabc",
        b"a-b-c",
        b"ABC",
        b"xx/abc",
        b"abc/xx",
        b"aabbcc",
        b"axbxc",
    ] {
        let s = score(needle, hay).expect("all contain the subsequence");
        assert!(
            exact >= s,
            "score({:?})={s} > exact={exact}",
            hay.escape_ascii().to_string()
        );
    }
    assert!(exact > score(needle, b"zabc").expect("matches"));
}

#[test]
fn boundary_inside_a_run_restarts_the_carried_bonus() {
    // "a/bc" in "xa/bcy": the whole match is one unbroken run, but '/' and
    // 'b' (start of the basename) are themselves stronger boundaries than the
    // run start 'a', so fzf restarts the run there: 'c' inherits the basename
    // bonus of 'b', not the zero bonus of 'a'.
    let basename = BONUS_BOUNDARY_DELIMITER + BONUS_BASENAME_START;
    let expected = 4 * M + BONUS_NON_WORD + basename + basename;
    assert_eq!(score(b"a/bc", b"xa/bcy"), Some(as_i32(expected)));
}

#[test]
fn scorer_is_reusable_across_needles() {
    // set_needle must fully reset state: growing, shrinking, and changing the
    // resolved case sensitivity must all agree with a fresh scorer.
    let corpus: &[&[u8]] = &[b"src/index.ts", b"FooBar.tsx", b"a", b"", b"x/y/z"];
    let mut reused = Scorer::new(ScorerOptions::default());
    for needle in [
        b"index".as_slice(),
        b"i",
        b"FooBarBazQux",
        b"",
        b"fb",
        b"zzz",
    ] {
        reused.set_needle(needle);
        for &hay in corpus {
            assert_eq!(
                reused.score(hay),
                path_scorer(needle).score(hay),
                "needle={:?} hay={:?}",
                needle.escape_ascii().to_string(),
                hay.escape_ascii().to_string()
            );
        }
    }
}

#[test]
fn pathological_repeated_bytes() {
    // Quadratic worst case (every needle byte matches every haystack byte)
    // must stay correct: the best alignment is the run anchored at the
    // high-bonus first byte, and positions/score must agree.
    let hay = vec![b'a'; MAX_BACKTRACK_HAYSTACK];
    let mut s = path_scorer(b"aaaaaaaa");
    let mut pos = Vec::new();
    let got = s.score_with_positions(&hay, &mut pos).expect("matches");
    assert_eq!(Some(got), path_scorer(b"aaaaaaaa").score(&hay));
    assert_eq!(pos, (0u32..8).collect::<Vec<u32>>());
    let expected = 8 * M + FIRST_OF_BASENAME * BONUS_FIRST_CHAR_MULTIPLIER + 7 * FIRST_OF_BASENAME;
    assert_eq!(got, as_i32(expected));
}

#[test]
fn trailing_slash_haystack_has_an_empty_basename() {
    // "src/" has no byte after its last '/', so nothing earns the basename
    // bonus; the match must still succeed.
    let expected = 3 * M
        + BONUS_BOUNDARY_DELIMITER * BONUS_FIRST_CHAR_MULTIPLIER
        + 2 * BONUS_BOUNDARY_DELIMITER;
    assert_eq!(score(b"src", b"src/"), Some(as_i32(expected)));
}

#[test]
fn default_options_are_smart_case_path_mode() {
    let opts = ScorerOptions::default();
    assert_eq!(opts.case, CaseMode::Smart);
    assert!(opts.path_mode);
}

#[test]
fn empty_needle_matches_everything_with_zero() {
    // An empty query must list every candidate, unscored and unhighlighted.
    let mut s = path_scorer(b"");
    let mut pos = vec![1, 2, 3];
    assert_eq!(s.score(b""), Some(0));
    assert_eq!(s.score(b"anything"), Some(0));
    assert_eq!(s.score_with_positions(b"anything", &mut pos), Some(0));
    assert!(pos.is_empty());
    // A scorer that never had a needle set behaves the same.
    assert_eq!(Scorer::new(ScorerOptions::default()).score(b"x"), Some(0));
}

#[test]
fn non_subsequence_returns_none() {
    let cases: &[(&[u8], &[u8])] = &[
        (b"abc", b""),
        (b"abc", b"ab"),
        (b"abc", b"cba"),
        (b"abc", b"axb"),
        (b"zz", b"z"),
    ];
    for &(needle, hay) in cases {
        assert_eq!(score(needle, hay), None);
        assert_eq!(positions(needle, hay), None);
    }
}

// ── case modes ─────────────────────────────────────────────────────────────

#[test]
fn smart_case_is_insensitive_for_lowercase_needles() {
    assert!(score(b"foo", b"FOO_BAR").is_some());
    assert!(score(b"foo", b"FoO").is_some());
}

#[test]
fn smart_case_is_sensitive_when_needle_has_uppercase() {
    let mut s = path_scorer(b"Foo");
    assert!(s.score(b"Foo.ts").is_some());
    assert_eq!(s.score(b"foo.ts"), None);
    assert_eq!(s.score(b"FOO.ts"), None);
}

#[test]
fn explicit_sensitive_and_insensitive_modes() {
    let sensitive = ScorerOptions {
        case: CaseMode::Sensitive,
        path_mode: true,
    };
    assert_eq!(scorer_with(sensitive, b"abc").score(b"ABC"), None);
    assert!(scorer_with(sensitive, b"abc").score(b"abc").is_some());

    let insensitive = ScorerOptions {
        case: CaseMode::Insensitive,
        path_mode: true,
    };
    // The needle is folded too, so an uppercase needle still matches.
    assert!(scorer_with(insensitive, b"ABC").score(b"abc").is_some());
    assert!(scorer_with(insensitive, b"abc").score(b"ABC").is_some());
}

#[test]
fn non_ascii_bytes_compare_exactly() {
    // ASCII-only folding: bytes >= 0x80 never fold.
    assert!(score(b"\xc3\xa9", b"x\xc3\xa9y").is_some());
    assert_eq!(score(b"\xc3\xa9", b"x\xc3\x89y"), None);
    let (_, pos) = positions(b"\xc3\xa9", b"x\xc3\xa9y").expect("matches");
    assert_eq!(pos, vec![1, 2]);
}

// ── positions ──────────────────────────────────────────────────────────────

#[test]
fn positions_exact_simple_cases() {
    let cases: &[(&[u8], &[u8], &[u32])] = &[
        (b"abc", b"abc", &[0, 1, 2]),
        (b"abc", b"a-b-c", &[0, 2, 4]),
        // The consecutive run at 3..6 beats the earlier scattered 'a'.
        (b"abc", b"xaxabc", &[3, 4, 5]),
        (b"fbr", b"FooBarRenderer", &[0, 3, 6]),
        (b"main", b"domain.rs", &[2, 3, 4, 5]),
        (b"foo", b"src/foo.ts", &[4, 5, 6]),
        // The basename occurrence wins over the directory occurrence.
        (b"index", b"index_helpers/index.ts", &[14, 15, 16, 17, 18]),
        (b"x", b"x", &[0]),
    ];
    for &(needle, hay, want) in cases {
        let (s, pos) = positions(needle, hay).expect("matches");
        assert_eq!(
            pos,
            want,
            "needle={:?} hay={:?}",
            needle.escape_ascii().to_string(),
            hay.escape_ascii().to_string()
        );
        assert_eq!(
            Some(s),
            score(needle, hay),
            "positions path must not change the score"
        );
    }
}

/// Positions must be strictly ascending, in-bounds, and each matched haystack
/// byte must case-fold to the corresponding needle byte.
#[track_caller]
fn check_positions_invariants(needle: &[u8], hay: &[u8], pos: &[u32], case_sensitive: bool) {
    assert_eq!(pos.len(), needle.len());
    let mut last: Option<u32> = None;
    for (k, &p) in pos.iter().enumerate() {
        if let Some(prev) = last {
            assert!(p > prev, "positions not strictly ascending: {pos:?}");
        }
        last = Some(p);
        let hb = hay[usize::try_from(p).expect("fits usize")];
        let (a, b) = if case_sensitive {
            (hb, needle[k])
        } else {
            (hb.to_ascii_lowercase(), needle[k].to_ascii_lowercase())
        };
        assert_eq!(a, b, "haystack byte at {p} does not fold to needle[{k}]");
    }
}

#[test]
fn positions_fold_to_needle_bytes() {
    let cases: &[(&[u8], &[u8])] = &[
        (b"srvidx", b"src/server/index.ts"),
        (b"FBR", b"FooBarRenderer"),
        (b"readme", b"packages/bun-types/README.md"),
        (b"abc", b"xAxBxC"),
        (b".ts", b"src/a.tsx"),
    ];
    for &(needle, hay) in cases {
        let mut s = path_scorer(needle);
        let mut pos = Vec::new();
        let got = s.score_with_positions(hay, &mut pos).expect("matches");
        assert_eq!(Some(got), path_scorer(needle).score(hay));
        let case_sensitive = needle.iter().any(u8::is_ascii_uppercase);
        let folded: Vec<u8> = if case_sensitive {
            needle.to_vec()
        } else {
            needle.to_ascii_lowercase()
        };
        check_positions_invariants(&folded, hay, &pos, case_sensitive);
    }
}

#[test]
fn positions_fall_back_to_greedy_past_the_backtrack_bound() {
    // Haystack longer than MAX_BACKTRACK_HAYSTACK: the score must still be
    // exact (identical to score()) and the greedy positions must still be a
    // valid ascending fold-matching subsequence.
    let mut hay = vec![b'z'; MAX_BACKTRACK_HAYSTACK * 2];
    hay.extend_from_slice(b"/abc.ts");
    let mut s = path_scorer(b"abc");
    let mut pos = Vec::new();
    let with_pos = s.score_with_positions(&hay, &mut pos).expect("matches");
    assert_eq!(Some(with_pos), path_scorer(b"abc").score(&hay));
    let base = u32::try_from(MAX_BACKTRACK_HAYSTACK * 2 + 1).expect("fits");
    assert_eq!(pos, vec![base, base + 1, base + 2]);
    check_positions_invariants(b"abc", &hay, &pos, false);
}

#[test]
fn positions_exact_at_the_backtrack_boundary() {
    // Exactly MAX_BACKTRACK_HAYSTACK bytes still uses the exact backtrack;
    // the optimal alignment is the trailing consecutive "abc", not the
    // greedy leftmost scattered one.
    let mut hay = vec![0u8; MAX_BACKTRACK_HAYSTACK];
    hay[..3].copy_from_slice(b"axb");
    let n = hay.len();
    hay[n - 3..].copy_from_slice(b"abc");
    let mut s = path_scorer(b"abc");
    let mut pos = Vec::new();
    let got = s.score_with_positions(&hay, &mut pos).expect("matches");
    assert_eq!(Some(got), path_scorer(b"abc").score(&hay));
    let base = u32::try_from(n - 3).expect("fits");
    assert_eq!(pos, vec![base, base + 1, base + 2]);
}

#[test]
fn score_and_positions_agree_on_a_corpus() {
    let corpus: &[&[u8]] = &[
        b"src/runtime/api/FileIndex.rs",
        b"src/runtime/server/mod.rs",
        b"packages/bun-types/index.d.ts",
        b"test/js/bun/http/serve.test.ts",
        b"node_modules/.bin/tsc",
        b"README.md",
        b"a",
        b"a/b/c/d/e/f/g.ts",
        b"\xff\xfe/weird\x00name",
        b"UPPER_CASE_FILE.TXT",
        b"camelCaseName.tsx",
    ];
    let needles: &[&[u8]] = &[
        b"",
        b"a",
        b"fileindex",
        b"srt",
        b"ts",
        b"zzzz",
        b"ccn",
        b".d.ts",
    ];
    for &needle in needles {
        let mut s = path_scorer(needle);
        let mut s2 = path_scorer(needle);
        let mut pos = Vec::new();
        for &hay in corpus {
            let a = s.score(hay);
            let b = s2.score_with_positions(hay, &mut pos);
            assert_eq!(a, b, "needle={needle:?} hay={hay:?}");
            // The prefilter is exact: it agrees with the scorer.
            let folded = needle.to_ascii_lowercase();
            assert_eq!(is_subsequence(hay, &folded, false), a.is_some());
            if a.is_some() && !needle.is_empty() {
                check_positions_invariants(&folded, hay, &pos, false);
            }
            if a.is_none() {
                assert!(pos.is_empty());
            }
        }
    }
}

// ── allocation / determinism contracts ─────────────────────────────────────

fn synthetic_paths(n: usize) -> Vec<Vec<u8>> {
    let words = [
        "src",
        "index",
        "foo",
        "bar",
        "renderer",
        "components",
        "utils",
        "test",
        "node_modules",
        "main",
    ];
    let exts = ["ts", "tsx", "rs", "js", "json"];
    (0..n)
        .map(|i| {
            format!(
                "{}/{}/{}_{}.{}",
                words[i % words.len()],
                words[(i / 7) % words.len()],
                words[(i * 13 + 3) % words.len()],
                i,
                exts[i % exts.len()]
            )
            .into_bytes()
        })
        .collect()
}

#[test]
fn scoring_10k_paths_twice_is_deterministic() {
    let paths = synthetic_paths(10_000);
    let mut s = path_scorer(b"sridx");
    let run = |s: &mut Scorer| -> (Vec<Option<i32>>, Vec<(i32, usize)>) {
        let mut topk = TopK::new(32);
        let mut all = Vec::with_capacity(paths.len());
        for (i, p) in paths.iter().enumerate() {
            let r = s.score(p);
            if let Some(score) = r {
                topk.push(score, u32::try_from(i).expect("fits"), i);
            }
            all.push(r);
        }
        (all, topk.into_sorted_vec())
    };
    let (a_scores, a_top) = run(&mut s);
    let (b_scores, b_top) = run(&mut s);
    assert_eq!(a_scores, b_scores);
    assert_eq!(a_top, b_top);
    assert!(
        a_scores.iter().any(Option::is_some),
        "needle must match some paths"
    );
    assert!(
        a_scores.iter().any(Option::is_none),
        "needle must reject some paths"
    );
    // A fresh scorer agrees with the warm one.
    let (c_scores, c_top) = run(&mut path_scorer(b"sridx"));
    assert_eq!(a_scores, c_scores);
    assert_eq!(a_top, c_top);
}

#[test]
fn score_does_not_allocate_after_set_needle() {
    let paths = synthetic_paths(2_000);
    let mut s = path_scorer(b"index");
    // Warm-up is not even needed: set_needle sizes every buffer score() uses.
    let before = s.scratch_capacity_bytes();
    let mut big = vec![b'q'; 1 << 16];
    big.extend_from_slice(b"/index.ts");
    for p in &paths {
        let _ = s.score(p);
    }
    let _ = s.score(&big);
    assert_eq!(
        s.scratch_capacity_bytes(),
        before,
        "score() must not grow any scratch buffer"
    );
}

#[test]
fn positions_scratch_is_bounded() {
    use crate::MAX_BACKTRACK_CELLS;
    // The backtrack matrices are two i64 lanes plus one u8 lane per cell.
    const BYTES_PER_CELL: usize = 2 * size_of::<i64>() + 1;
    let needle = b"abcdefgh";
    let mut s = path_scorer(needle);
    let mut pos = Vec::new();
    let mut big = vec![b'z'; 1 << 17];
    big.extend_from_slice(b"/abcdefgh.ts");
    // A mix of exact-backtrack and greedy-fallback haystacks of many sizes.
    for len in [1usize, 8, 64, 1000, 1024, 1025, 4096, 1 << 15] {
        let mut hay = vec![b'-'; len];
        let keep = hay.len().min(needle.len());
        hay[..keep].copy_from_slice(&needle[..keep]);
        let _ = s.score_with_positions(&hay, &mut pos);
    }
    let _ = s.score_with_positions(&big, &mut pos);
    // O(needle) rolling state + the capped matrices, with slack for Vec
    // capacity rounding.
    let rolling = (needle.len() + 1) * (6 * size_of::<i64>() + 2 * size_of::<u32>());
    let bound = 2 * (MAX_BACKTRACK_CELLS * BYTES_PER_CELL + rolling + needle.len() + 64);
    assert!(
        s.scratch_capacity_bytes() <= bound,
        "scratch {} > bound {bound}",
        s.scratch_capacity_bytes()
    );
}

#[test]
fn topk_with_scorer_ranks_a_small_corpus() {
    // End-to-end: prefilter + scorer + TopK, tiebreak = path length so the
    // shortest path wins among equal scores.
    let corpus: &[&[u8]] = &[
        b"docs/index.md",
        b"src/index.ts",
        b"src/index/extra/index.ts",
        b"index.ts",
        b"src/lib.rs",
        b"indexer/nope.txt",
    ];
    let mut s = path_scorer(b"index");
    let mut topk = TopK::new(3);
    for &hay in corpus {
        if !is_subsequence(hay, b"index", false) {
            continue;
        }
        if let Some(sc) = s.score(hay) {
            topk.push(sc, u32::try_from(hay.len()).expect("fits"), hay);
        }
    }
    let got: Vec<&[u8]> = topk.into_sorted_vec().into_iter().map(|(_, v)| v).collect();
    // All four "index"-basename candidates score identically (the basename
    // bonus is path-depth independent); the tiebreak orders them by length.
    assert_eq!(
        got,
        vec![b"index.ts".as_slice(), b"src/index.ts", b"docs/index.md"]
    );
}
