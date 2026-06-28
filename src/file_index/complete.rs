//! Fuzzy filename autocomplete over a [`Store`].
//!
//! Pipeline (per the design contract): candidate enumeration → `bun_fuzzy`'s
//! subsequence prefilter + scorer → a frecency bonus from the store's touch
//! ring → `bun_fuzzy::TopKBy`. Allocation-free per candidate (the scorer
//! holds the scratch, the heap holds at most `limit`).
//!
//! Candidate enumeration picks the cheapest correct source:
//!
//! 1. A reusable [`CompleteCache`] from the previous keystroke (the new
//!    needle extends the cached one against an unmutated store): only the
//!    cached survivors are visited.
//! 2. The arena byte prefilter: one `memchr` sweep of the store's contiguous
//!    path arena for the needle's rarest byte (per the store's incremental
//!    byte-frequency table); only paths containing it can match. Used when
//!    that byte is rare enough ([`PREFILTER_MAX_HITS_DIVISOR`]) and the cwd
//!    range is not already narrow ([`PREFILTER_MIN_RANGE_FRACTION`]).
//! 3. The cwd-narrowed path-sorted range (both bounds binary-searched once).
//!
//! All three produce the same matches; ties (equal score) always break by
//! path order, which the heap resolves by comparing the paths themselves so
//! the candidate visiting order does not matter.

use bun_collections::array_hash_map::{ArrayHashMap, AutoContext};
use bun_fuzzy::{Scorer, TopK, TopKBy};

use crate::store::{EntryKind, FileId, Store};

/// Maximum frecency bonus, awarded to the most recently touched path. The
/// scorer's per-character match score is 16 (`bun_fuzzy::SCORE_MATCH`), so
/// the strongest recency boost is worth about four matched characters —
/// enough to break ties and promote near-misses, not enough to drown out a
/// clearly better textual match.
const FRECENCY_BONUS_MAX: i32 = 64;
/// Bonus floor for any path still in the touch ring.
const FRECENCY_BONUS_MIN: i32 = 8;
/// How much the bonus decays per recency rank.
const FRECENCY_DECAY_PER_RANK: i32 = 4;

/// Default number of results when the caller does not specify one.
pub const DEFAULT_COMPLETE_LIMIT: usize = 64;

/// The arena prefilter runs only when the needle's rarest byte occurs at
/// most `live_entries / PREFILTER_MAX_HITS_DIVISOR` times across the live
/// paths: past that the survivor set is no longer sparse, and the plain
/// range scan (whose subsequence reject is ~20ns) beats sweeping the arena
/// and mapping every hit back to an id.
const PREFILTER_MAX_HITS_DIVISOR: u32 = 4;

/// The arena sweep always reads the WHOLE arena, so once a cwd prefix
/// narrows the candidate range below `live / PREFILTER_MIN_RANGE_FRACTION`
/// entries the range scan is the cheaper plan and the prefilter is skipped.
const PREFILTER_MIN_RANGE_FRACTION: usize = 2;

/// Options for [`complete`].
#[derive(Clone, Copy, Debug)]
pub struct CompleteOptions<'a> {
    /// Maximum number of results.
    pub limit: usize,
    /// Only consider paths starting with this prefix (`b""` = everything,
    /// otherwise a `/`-terminated directory). The needle is matched against
    /// the path *with the prefix stripped* (`Bun.Glob`'s `cwd` semantics), so
    /// `positions` index the cwd-relative path.
    pub cwd_prefix: &'a [u8],
    /// Only consider directories.
    pub dirs_only: bool,
}

impl Default for CompleteOptions<'static> {
    fn default() -> CompleteOptions<'static> {
        CompleteOptions {
            limit: DEFAULT_COMPLETE_LIMIT,
            cwd_prefix: b"",
            dirs_only: false,
        }
    }
}

/// One autocomplete result. `score` includes the frecency bonus; `positions`
/// are the matched byte indices in the *cwd-relative* path (ascending), for
/// highlighting.
#[derive(Clone, Debug)]
pub struct CompleteMatch {
    pub id: FileId,
    pub score: i32,
    pub positions: Vec<u32>,
}

/// The survivor set of one [`complete_with_cache`] query, for incremental
/// narrowing: while the user keeps typing (each needle extending the last)
/// against an unmutated store, the next query only visits these survivors.
///
/// The runtime layer owns storing it between keystrokes; the store's
/// [`Store::generation`] guards both staleness and [`FileId`] invalidation
/// (compaction bumps it).
#[derive(Clone, Debug)]
pub struct CompleteCache {
    needle: Vec<u8>,
    cwd_prefix: Vec<u8>,
    dirs_only: bool,
    case_sensitive: bool,
    generation: u64,
    /// Live ids whose path the needle was a subsequence of (after the
    /// `dirs_only` filter), i.e. every candidate any extension of the
    /// needle can still match.
    survivors: Vec<FileId>,
    /// False when the query was not worth caching (empty needle: everything
    /// survives; `limit == 0`: nothing was visited).
    usable: bool,
}

impl CompleteCache {
    /// True when a query for `needle` may visit only this cache's
    /// survivors: the store has not mutated, the candidate restriction is
    /// unchanged, the new needle extends the cached one (a path matching
    /// `needle` necessarily matched its prefix), and case sensitivity did
    /// not relax (`CaseMode::Smart` can only tighten when a needle grows).
    fn reusable_for(
        &self,
        store: &Store,
        scorer: &Scorer,
        needle: &[u8],
        opts: &CompleteOptions<'_>,
    ) -> bool {
        self.usable
            && self.generation == store.generation()
            && self.cwd_prefix == opts.cwd_prefix
            && self.dirs_only == opts.dirs_only
            && (!self.case_sensitive || scorer.case_sensitive())
            && needle.starts_with(&self.needle)
    }

    /// The number of cached survivors (diagnostics / tests).
    pub fn survivor_count(&self) -> usize {
        self.survivors.len()
    }
}

/// Rank the store's paths against `needle`, best first.
///
/// Ties are broken by path order, so results are deterministic regardless of
/// the candidate enumeration strategy. An empty needle matches everything
/// with score 0 plus the frecency bonus, i.e. "most recent first, then path
/// order".
pub fn complete(
    store: &Store,
    scorer: &mut Scorer,
    needle: &[u8],
    opts: &CompleteOptions<'_>,
) -> Vec<CompleteMatch> {
    complete_impl(store, scorer, needle, opts, None, None)
}

/// [`complete`], plus incremental narrowing: when `prev` is the cache of the
/// previous keystroke and still valid for `needle` (see
/// [`CompleteCache::reusable_for`]), only its survivors are visited. Always
/// returns the cache for the *current* query, to be passed to the next one.
/// Results are identical to [`complete`] with or without a usable `prev`.
pub fn complete_with_cache(
    store: &Store,
    scorer: &mut Scorer,
    needle: &[u8],
    opts: &CompleteOptions<'_>,
    prev: Option<&CompleteCache>,
) -> (Vec<CompleteMatch>, CompleteCache) {
    let mut survivors: Vec<FileId> = Vec::new();
    let usable = opts.limit != 0 && !needle.is_empty();
    let out = complete_impl(
        store,
        scorer,
        needle,
        opts,
        prev,
        usable.then_some(&mut survivors),
    );
    let cache = CompleteCache {
        needle: needle.to_vec(),
        cwd_prefix: opts.cwd_prefix.to_vec(),
        dirs_only: opts.dirs_only,
        case_sensitive: scorer.case_sensitive(),
        generation: store.generation(),
        survivors,
        usable,
    };
    (out, cache)
}

fn complete_impl(
    store: &Store,
    scorer: &mut Scorer,
    needle: &[u8],
    opts: &CompleteOptions<'_>,
    prev: Option<&CompleteCache>,
    survivors_out: Option<&mut Vec<FileId>>,
) -> Vec<CompleteMatch> {
    if opts.limit == 0 {
        return Vec::new();
    }
    scorer.set_needle(needle);
    // Cheapest correct candidate source. A usable cache is preferred unless
    // the arena prefilter's rare-byte estimate is smaller than the cache's
    // survivor set (e.g. the keystroke that introduced a rare byte): both
    // visit candidates the same way, so the smaller set wins.
    let cached = prev.filter(|c| c.reusable_for(store, scorer, needle, opts));
    let plan = prefilter_plan(store, scorer, needle, opts);
    let use_cache = match (cached, plan) {
        (Some(cache), Some(plan)) => cache.survivors.len() <= plan.estimated_hits as usize,
        (Some(_), None) => true,
        (None, _) => false,
    };
    let prefiltered = if use_cache {
        None
    } else {
        plan.map(|plan| plan.run(store, opts))
    };
    let mut query = Query {
        store,
        opts,
        strip: opts.cwd_prefix.len(),
        ranks: store.touch_ranks(),
        survivors_out,
    };
    let strip = query.strip;
    let ranked = if use_cache {
        // `use_cache` is only true for a present, reusable cache.
        let survivors = cached.map_or(&[][..], |c| c.survivors.as_slice());
        query.run_unordered(scorer, survivors.iter().copied())
    } else if let Some(ids) = &prefiltered {
        query.run_unordered(scorer, ids.iter().copied())
    } else {
        query.run_in_path_order(scorer, store.range_with_prefix(opts.cwd_prefix))
    };
    ranked
        .into_iter()
        .map(|(score, id)| {
            let mut positions: Vec<u32> = Vec::new();
            // The candidate scored, so it matches; positions come from the
            // pure alignment (the frecency bonus does not move them).
            let _ = scorer.score_with_positions(&store.path(id)[strip..], &mut positions);
            CompleteMatch {
                id,
                score,
                positions,
            }
        })
        .collect()
}

/// Per-query candidate pipeline state: the per-candidate work is identical
/// for every candidate source; only the heap's tiebreak differs (see
/// [`Query::run_in_path_order`] / [`Query::run_unordered`]).
struct Query<'q, 'o> {
    store: &'q Store,
    opts: &'q CompleteOptions<'o>,
    /// Bytes of `opts.cwd_prefix` to strip before scoring: the needle is
    /// matched against the cwd-relative path, never the prefix itself.
    strip: usize,
    ranks: ArrayHashMap<u32, u32, AutoContext>,
    survivors_out: Option<&'q mut Vec<FileId>>,
}

impl Query<'_, '_> {
    /// Per-candidate pipeline: the `dirs_only` filter → the scorer (whose
    /// reject path is the subsequence test) → survivor recording → the
    /// frecency bonus → the caller's heap push.
    #[inline]
    fn score_into(&mut self, scorer: &mut Scorer, id: FileId, push: impl FnOnce(i32, FileId)) {
        if self.opts.dirs_only && self.store.kind(id) != EntryKind::Dir {
            return;
        }
        let Some(base) = scorer.score(&self.store.path(id)[self.strip..]) else {
            return;
        };
        if let Some(out) = self.survivors_out.as_deref_mut() {
            out.push(id);
        }
        let score = if self.ranks.is_empty() {
            base
        } else {
            base.saturating_add(frecency_bonus(&self.ranks, id))
        };
        push(score, id);
    }

    /// Candidates arriving in path order (the sorted-range walk): the heap's
    /// tiebreak is the arrival index, which costs nothing to compare.
    fn run_in_path_order(
        &mut self,
        scorer: &mut Scorer,
        candidates: impl Iterator<Item = FileId>,
    ) -> Vec<(i32, FileId)> {
        let mut topk: TopK<FileId> = TopK::new(self.opts.limit);
        for (order, id) in candidates.enumerate() {
            self.score_into(scorer, id, |score, id| topk.push(score, order as u32, id));
        }
        topk.into_sorted_vec()
    }

    /// Candidates in any other order (the arena prefilter's id order, a
    /// cache's survivor order): equal scores compare the paths themselves —
    /// the same total order as the arrival index of a path-ordered walk, so
    /// results are identical to [`Query::run_in_path_order`].
    fn run_unordered(
        &mut self,
        scorer: &mut Scorer,
        candidates: impl Iterator<Item = FileId>,
    ) -> Vec<(i32, FileId)> {
        let store = self.store;
        let mut topk = TopKBy::new(self.opts.limit, |a: &FileId, b: &FileId| {
            store.path(*a).cmp(store.path(*b))
        });
        for id in candidates {
            self.score_into(scorer, id, |score, id| topk.push(score, id));
        }
        topk.into_sorted_vec()
    }
}

/// A committed decision to run the arena prefilter for one query: the byte
/// (pair) to sweep for and the store's live occurrence count of it.
#[derive(Clone, Copy)]
struct PrefilterPlan {
    /// Upper bound on the candidates the sweep yields (each occurrence of
    /// the byte is at most one candidate; tombstoned hits are dropped).
    estimated_hits: u32,
    lo: u8,
    up: Option<u8>,
}

impl PrefilterPlan {
    /// One sweep of the path arena → the candidate ids, intersected with the
    /// cwd prefix (id order).
    fn run(self, store: &Store, opts: &CompleteOptions<'_>) -> Vec<FileId> {
        let mut ids: Vec<FileId> = Vec::new();
        if self.estimated_hits == 0 {
            // No live path contains the byte: nothing can match.
            return ids;
        }
        store.ids_with_byte(self.lo, self.up, &mut ids);
        if !opts.cwd_prefix.is_empty() {
            ids.retain(|&id| store.path(id).starts_with(opts.cwd_prefix));
        }
        ids
    }
}

/// Decides whether the arena prefilter is the cheaper plan (see the module
/// docs); `None` means "scan the sorted range".
///
/// Correctness: a path the needle is a subsequence of contains every needle
/// byte (under the scorer's fold rule), in particular the rarest one, so the
/// sweep can never drop a true match. A needle byte with zero live
/// occurrences proves there are no matches at all.
fn prefilter_plan(
    store: &Store,
    scorer: &Scorer,
    needle: &[u8],
    opts: &CompleteOptions<'_>,
) -> Option<PrefilterPlan> {
    if needle.is_empty() || store.is_empty() {
        return None;
    }
    let live = store.len();
    let case_sensitive = scorer.case_sensitive();
    let mut rarest: Option<PrefilterPlan> = None;
    for &raw in needle {
        let probe = if case_sensitive {
            PrefilterPlan {
                estimated_hits: store.live_byte_count(raw),
                lo: raw,
                up: None,
            }
        } else {
            let lo = raw.to_ascii_lowercase();
            if lo.is_ascii_lowercase() {
                let up = lo.to_ascii_uppercase();
                PrefilterPlan {
                    estimated_hits: store.live_byte_count(lo) + store.live_byte_count(up),
                    lo,
                    up: Some(up),
                }
            } else {
                PrefilterPlan {
                    estimated_hits: store.live_byte_count(lo),
                    lo,
                    up: None,
                }
            }
        };
        if rarest.is_none_or(|r| probe.estimated_hits < r.estimated_hits) {
            rarest = Some(probe);
        }
    }
    let plan = rarest?;
    if plan.estimated_hits == 0 {
        return Some(plan);
    }
    if u64::from(plan.estimated_hits) * u64::from(PREFILTER_MAX_HITS_DIVISOR) > live as u64 {
        return None;
    }
    // The sweep covers the whole store; a cwd prefix that already narrows
    // the range to a sliver makes the range scan cheaper.
    if !opts.cwd_prefix.is_empty()
        && store.prefix_range(opts.cwd_prefix).len() * PREFILTER_MIN_RANGE_FRACTION < live
    {
        return None;
    }
    Some(plan)
}

fn frecency_bonus(ranks: &ArrayHashMap<u32, u32, AutoContext>, id: FileId) -> i32 {
    match ranks.get(&(id.index() as u32)) {
        Some(&rank) => {
            let decayed =
                FRECENCY_BONUS_MAX - (rank as i32).saturating_mul(FRECENCY_DECAY_PER_RANK);
            decayed.max(FRECENCY_BONUS_MIN)
        }
        None => 0,
    }
}
#[cfg(test)]
mod tests {
    use bun_fuzzy::ScorerOptions;

    use super::*;
    use crate::store::Meta;

    fn store_with(paths: &[&[u8]]) -> Store {
        let mut s = Store::new(1 << 22);
        for p in paths {
            let kind = if p.ends_with(b"/") {
                EntryKind::Dir
            } else {
                EntryKind::File
            };
            let meta = Meta {
                kind,
                ..Meta::default()
            };
            s.upsert(p, meta).unwrap();
        }
        s
    }

    fn scorer() -> Scorer {
        Scorer::new(ScorerOptions::default())
    }

    fn complete_paths(store: &Store, needle: &[u8], opts: &CompleteOptions<'_>) -> Vec<Vec<u8>> {
        complete(store, &mut scorer(), needle, opts)
            .into_iter()
            .map(|m| store.path(m.id).to_vec())
            .collect()
    }

    #[test]
    fn ranks_basename_hit_over_scattered_match() {
        // "foo" should prefer the file literally named foo over a longer
        // basename containing it, over a scattered (gapped) match — the
        // ordering bun_fuzzy guarantees, surfaced through the store pipeline.
        let s = store_with(&[b"src/fxoxo.ts", b"src/food/index.ts", b"src/foo.ts"]);
        let got = complete_paths(&s, b"foo", &CompleteOptions::default());
        assert_eq!(
            got,
            vec![
                b"src/foo.ts".to_vec(),
                b"src/food/index.ts".to_vec(),
                b"src/fxoxo.ts".to_vec()
            ]
        );
        // A path the needle is not even a subsequence of never appears.
        assert!(!got.contains(&b"tools/of_old.ts".to_vec()));
    }

    #[test]
    fn non_matching_candidates_are_dropped() {
        let s = store_with(&[b"a.rs", b"b.rs", b"zzz"]);
        let got = complete_paths(&s, b"q", &CompleteOptions::default());
        assert!(got.is_empty());
    }

    #[test]
    fn limit_caps_results_and_zero_limit_returns_nothing() {
        let s = store_with(&[b"a1", b"a2", b"a3", b"a4"]);
        let opts = CompleteOptions {
            limit: 2,
            ..CompleteOptions::default()
        };
        assert_eq!(complete_paths(&s, b"a", &opts).len(), 2);
        let none = CompleteOptions {
            limit: 0,
            ..CompleteOptions::default()
        };
        assert!(complete_paths(&s, b"a", &none).is_empty());
    }

    #[test]
    fn cwd_prefix_restricts_candidates() {
        let s = store_with(&[b"src/app.ts", b"test/app.ts", b"srclike/app.ts"]);
        let opts = CompleteOptions {
            cwd_prefix: b"src/",
            ..CompleteOptions::default()
        };
        assert_eq!(
            complete_paths(&s, b"app", &opts),
            vec![b"src/app.ts".to_vec()]
        );
    }

    #[test]
    fn cwd_prefix_rebases_the_needle_and_the_positions() {
        // `Bun.Glob`-style cwd: the needle never matches the prefix itself,
        // and positions index the cwd-relative path.
        let s = store_with(&[b"src/app.ts", b"src/main.rs", b"other/srcish.ts"]);
        let scoped = CompleteOptions {
            cwd_prefix: b"src/",
            ..CompleteOptions::default()
        };
        assert!(complete_paths(&s, b"src", &scoped).is_empty());
        let got = complete(&s, &mut scorer(), b"app", &scoped);
        assert_eq!(got.len(), 1);
        assert_eq!(s.path(got[0].id), b"src/app.ts");
        // "app" aligns at bytes 0..3 of "app.ts" (not 4..7 of the full path).
        assert_eq!(got[0].positions, vec![0, 1, 2]);
    }

    #[test]
    fn dirs_only_filters_files() {
        let s = store_with(&[b"src/app.ts", b"src/app/", b"app2/"]);
        let opts = CompleteOptions {
            dirs_only: true,
            ..CompleteOptions::default()
        };
        let mut got = complete_paths(&s, b"app", &opts);
        got.sort();
        assert_eq!(got, vec![b"app2/".to_vec(), b"src/app/".to_vec()]);
    }

    #[test]
    fn frecency_promotes_a_recently_touched_path_over_an_equal_match() {
        // Identical basenames in different (equal-length) directories score
        // identically; touching one must rank it first.
        let mut s = store_with(&[b"aaa/file.ts", b"bbb/file.ts"]);
        let baseline = complete_paths(&s, b"file", &CompleteOptions::default());
        assert_eq!(
            baseline[0],
            b"aaa/file.ts".to_vec(),
            "path order breaks the tie"
        );

        let id = s.get(b"bbb/file.ts").unwrap();
        s.touch(id);
        let boosted = complete(&s, &mut scorer(), b"file", &CompleteOptions::default());
        assert_eq!(s.path(boosted[0].id), b"bbb/file.ts");
        assert!(boosted[0].score > boosted[1].score);
    }

    #[test]
    fn empty_needle_lists_recent_first_then_path_order() {
        let mut s = store_with(&[b"c", b"a", b"b"]);
        let b = s.get(b"b").unwrap();
        s.touch(b);
        let got = complete_paths(&s, b"", &CompleteOptions::default());
        assert_eq!(got, vec![b"b".to_vec(), b"a".to_vec(), b"c".to_vec()]);
    }

    #[test]
    fn positions_are_ascending_and_case_fold_to_the_needle() {
        let s = store_with(&[b"src/FooBarRenderer.ts"]);
        let got = complete(&s, &mut scorer(), b"fbr", &CompleteOptions::default());
        assert_eq!(got.len(), 1);
        let path = s.path(got[0].id);
        let pos = &got[0].positions;
        assert_eq!(pos.len(), 3);
        assert!(pos.windows(2).all(|w| w[0] < w[1]));
        for (&p, &n) in pos.iter().zip(b"fbr") {
            assert_eq!(path[p as usize].to_ascii_lowercase(), n);
        }
    }

    #[test]
    fn results_are_stable_across_repeated_queries() {
        let mut s = Store::new(1 << 24);
        for i in 0..2_000u32 {
            let p = format!("pkg{}/src/module_{i}.ts", i % 13).into_bytes();
            s.upsert(&p, Meta::default()).unwrap();
        }
        let mut sc = scorer();
        let opts = CompleteOptions {
            limit: 25,
            ..CompleteOptions::default()
        };
        let first = complete(&s, &mut sc, b"module1", &opts);
        for _ in 0..3 {
            let again = complete(&s, &mut sc, b"module1", &opts);
            assert_eq!(again.len(), first.len());
            for (a, b) in again.iter().zip(&first) {
                assert_eq!((a.id, a.score, &a.positions), (b.id, b.score, &b.positions));
            }
        }
        assert_eq!(first.len(), 25);
    }

    // ── candidate-enumeration equivalence (prefilter / cache / linear) ────

    /// Deterministic xorshift64* for the randomized property tests.
    struct TestRng(u64);
    impl TestRng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: usize) -> usize {
            usize::try_from(self.next() % n as u64).expect("fits")
        }
    }

    /// Reference: brute-force every live entry (no prefix range, no
    /// prefilter, no cache), then sort by (score desc, path asc) — the
    /// documented result order. Equality against this proves every candidate
    /// enumeration strategy in `complete()` drops nothing and reorders
    /// nothing.
    fn reference_complete(
        store: &Store,
        needle: &[u8],
        opts: &CompleteOptions<'_>,
    ) -> Vec<(i32, Vec<u8>)> {
        let mut sc = scorer();
        sc.set_needle(needle);
        let ranks = store.touch_ranks();
        let mut all: Vec<(i32, Vec<u8>)> = Vec::new();
        for id in store.iter_sorted() {
            let path = store.path(id);
            if !path.starts_with(opts.cwd_prefix) {
                continue;
            }
            if opts.dirs_only && store.kind(id) != EntryKind::Dir {
                continue;
            }
            // The needle is matched against the cwd-relative path.
            let Some(base) = sc.score(&path[opts.cwd_prefix.len()..]) else {
                continue;
            };
            all.push((
                base.saturating_add(frecency_bonus(&ranks, id)),
                path.to_vec(),
            ));
        }
        all.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        all.truncate(opts.limit);
        all
    }

    fn as_pairs(store: &Store, ms: &[CompleteMatch]) -> Vec<(i32, Vec<u8>)> {
        ms.iter()
            .map(|m| (m.score, store.path(m.id).to_vec()))
            .collect()
    }

    fn random_store(rng: &mut TestRng, n: usize) -> Store {
        // 'q', 'z' and upper-case letters are deliberately rare so the
        // prefilter kicks in for needles containing them, and 'i'/'n'/'a'
        // are common so those needles take the linear path.
        const DIRS: &[&str] = &["src", "lib", "test", "api", "internal", "qz", "Zed"];
        const NAMES: &[&str] = &[
            "index", "main", "name", "alpha", "infra", "input", "anchor", "quark", "zebra", "Quill",
        ];
        const EXTS: &[&str] = &[".ts", ".rs", ".md", ".tsx"];
        let mut s = Store::new(1 << 26);
        let mut i = 0usize;
        while s.len() < n {
            let depth = rng.below(3);
            let mut p = String::new();
            for _ in 0..depth {
                p.push_str(DIRS[rng.below(DIRS.len())]);
                p.push('/');
            }
            p.push_str(NAMES[rng.below(NAMES.len())]);
            p.push_str(&format!("_{i}"));
            p.push_str(EXTS[rng.below(EXTS.len())]);
            let kind = if rng.below(8) == 0 {
                EntryKind::Dir
            } else {
                EntryKind::File
            };
            let _ = s.upsert(
                p.as_bytes(),
                Meta {
                    kind,
                    ..Meta::default()
                },
            );
            i += 1;
        }
        s
    }

    #[test]
    fn every_candidate_strategy_matches_the_brute_force_reference() {
        let mut rng = TestRng(0x00C0_FFEE);
        let needles: &[&[u8]] = &[
            b"", b"q", b"z", b"Q", b"qz", b"zb", b"in", b"index", b"a", b"nx", b"Zq", b"%%",
            b"zzzzqqq",
        ];
        for round in 0..6 {
            let mut store = random_store(&mut rng, 40 + round * 70);
            // Touch a few entries so the frecency bonus is exercised.
            for _ in 0..rng.below(6) {
                let pick = rng.below(store.len());
                let id = store.iter_sorted().nth(pick).expect("in range");
                store.touch(id);
            }
            for &cwd in &[b"".as_slice(), b"src/", b"qz/", b"nope/"] {
                for &needle in needles {
                    for dirs_only in [false, true] {
                        for limit in [3usize, DEFAULT_COMPLETE_LIMIT] {
                            let opts = CompleteOptions {
                                limit,
                                cwd_prefix: cwd,
                                dirs_only,
                            };
                            let want = reference_complete(&store, needle, &opts);
                            let got = complete(&store, &mut scorer(), needle, &opts);
                            assert_eq!(
                                as_pairs(&store, &got),
                                want,
                                "needle={:?} cwd={:?} dirs_only={dirs_only} limit={limit}",
                                needle.escape_ascii().to_string(),
                                cwd.escape_ascii().to_string(),
                            );
                            // The cached-survivor strategy: prime the cache
                            // with every prefix of the needle, then answer
                            // from it. Results must be identical.
                            let mut sc = scorer();
                            let mut cache: Option<CompleteCache> = None;
                            for end in 0..=needle.len() {
                                let (step, next) = complete_with_cache(
                                    &store,
                                    &mut sc,
                                    &needle[..end],
                                    &opts,
                                    cache.as_ref(),
                                );
                                if end == needle.len() {
                                    assert_eq!(
                                        as_pairs(&store, &step),
                                        want,
                                        "cached path diverged: needle={:?} cwd={:?}",
                                        needle.escape_ascii().to_string(),
                                        cwd.escape_ascii().to_string(),
                                    );
                                }
                                cache = Some(next);
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn needle_with_a_byte_no_path_contains_matches_nothing() {
        let s = store_with(&[b"src/index.ts", b"lib/main.rs"]);
        assert!(complete_paths(&s, b"zzzzqqq", &CompleteOptions::default()).is_empty());
        assert!(complete_paths(&s, b"\xff", &CompleteOptions::default()).is_empty());
    }

    // ── incremental narrowing (CompleteCache) ─────────────────────────────

    #[test]
    fn cache_narrows_to_survivors_and_matches_a_fresh_query() {
        let mut rng = TestRng(0xFEED);
        let s = random_store(&mut rng, 400);
        let mut sc = scorer();
        let opts = CompleteOptions::default();
        let (first, c1) = complete_with_cache(&s, &mut sc, b"q", &opts, None);
        assert!(!first.is_empty());
        assert!(c1.survivor_count() < s.len(), "survivors must narrow");
        let (narrowed, c2) = complete_with_cache(&s, &mut sc, b"qr", &opts, Some(&c1));
        assert_eq!(
            as_pairs(&s, &narrowed),
            as_pairs(&s, &complete(&s, &mut scorer(), b"qr", &opts)),
            "narrowing from the cache must not change results"
        );
        assert!(c2.survivor_count() <= c1.survivor_count());
        // A third keystroke off the second cache.
        let (third, _) = complete_with_cache(&s, &mut sc, b"qrk", &opts, Some(&c2));
        assert_eq!(
            as_pairs(&s, &third),
            as_pairs(&s, &complete(&s, &mut scorer(), b"qrk", &opts))
        );
    }

    #[test]
    fn cache_is_invalidated_by_a_store_mutation() {
        let mut s = store_with(&[b"src/alpha.ts", b"src/beta.ts"]);
        let mut sc = scorer();
        let opts = CompleteOptions::default();
        let (_, cache) = complete_with_cache(&s, &mut sc, b"al", &opts, None);
        // The cache's survivor set cannot contain this new match; the
        // generation bump must force a full re-enumeration that finds it.
        s.upsert(b"src/alamo.ts", Meta::default()).unwrap();
        let (got, _) = complete_with_cache(&s, &mut sc, b"ala", &opts, Some(&cache));
        let paths: Vec<Vec<u8>> = got.iter().map(|m| s.path(m.id).to_vec()).collect();
        assert!(paths.contains(&b"src/alamo.ts".to_vec()), "{paths:?}");
        assert!(paths.contains(&b"src/alpha.ts".to_vec()));
    }

    #[test]
    fn cache_is_ignored_for_a_non_extending_needle_or_changed_options() {
        let s = store_with(&[b"src/alpha.ts", b"src/beta.ts", b"other/alpha.ts"]);
        let mut sc = scorer();
        let opts = CompleteOptions::default();
        let (_, c_beta) = complete_with_cache(&s, &mut sc, b"bet", &opts, None);
        // "alp" does not extend "bet": the cache must be bypassed.
        let (got, _) = complete_with_cache(&s, &mut sc, b"alp", &opts, Some(&c_beta));
        assert_eq!(got.len(), 2);
        // Same needle, different cwd restriction: bypassed too.
        let (_, c_root) = complete_with_cache(&s, &mut sc, b"alp", &opts, None);
        let scoped = CompleteOptions {
            cwd_prefix: b"other/",
            ..CompleteOptions::default()
        };
        let (got, _) = complete_with_cache(&s, &mut sc, b"alpha", &scoped, Some(&c_root));
        assert_eq!(
            as_pairs(&s, &got),
            as_pairs(&s, &complete(&s, &mut scorer(), b"alpha", &scoped))
        );
        // dirs_only flipped: bypassed.
        let dirs = CompleteOptions {
            dirs_only: true,
            ..CompleteOptions::default()
        };
        let (got, _) = complete_with_cache(&s, &mut sc, b"alpha", &dirs, Some(&c_root));
        assert!(got.is_empty());
        // An empty-needle cache is never reusable (everything survives).
        let (_, c_empty) = complete_with_cache(&s, &mut sc, b"", &opts, None);
        assert_eq!(c_empty.survivor_count(), 0);
        let (got, _) = complete_with_cache(&s, &mut sc, b"alpha", &opts, Some(&c_empty));
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn cache_narrowing_handles_a_smart_case_upgrade() {
        // The cached needle resolved case-insensitive; the extension turns
        // case sensitivity on. The sensitive matches are a subset of the
        // insensitive survivors, so the cache stays valid — results must
        // equal a fresh sensitive query.
        let s = store_with(&[b"src/Reader.ts", b"src/render.ts", b"src/REadme.md"]);
        let mut sc = scorer();
        let opts = CompleteOptions::default();
        let (_, c) = complete_with_cache(&s, &mut sc, b"re", &opts, None);
        assert_eq!(c.survivor_count(), 3);
        let (got, _) = complete_with_cache(&s, &mut sc, b"reA", &opts, Some(&c));
        assert_eq!(
            as_pairs(&s, &got),
            as_pairs(&s, &complete(&s, &mut scorer(), b"reA", &opts))
        );
        // And never the reverse: a sensitive cache is not reused by an
        // insensitive query (which would need candidates it never saw).
        let (_, c_upper) = complete_with_cache(&s, &mut sc, b"RE", &opts, None);
        assert_eq!(c_upper.survivor_count(), 1);
        let (got, _) = complete_with_cache(&s, &mut sc, b"re", &opts, Some(&c_upper));
        assert_eq!(got.len(), 3, "must not narrow to the sensitive survivors");
    }
}
