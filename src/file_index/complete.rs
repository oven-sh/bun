//! Fuzzy filename autocomplete over a [`Store`].
//!
//! Pipeline (per the design contract): an optional `range_with_prefix(cwd)`
//! narrowing → `bun_fuzzy`'s subsequence prefilter + scorer → a frecency
//! bonus from the store's touch ring → `bun_fuzzy::TopK`. Allocation-free per
//! candidate (the scorer holds the scratch, the heap holds at most `limit`).

use bun_collections::array_hash_map::{ArrayHashMap, AutoContext};
use bun_fuzzy::{Scorer, TopK};

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

/// Options for [`complete`].
#[derive(Clone, Copy, Debug)]
pub struct CompleteOptions<'a> {
    /// Maximum number of results.
    pub limit: usize,
    /// Only consider paths starting with this prefix (`b""` = everything).
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
/// are the matched byte indices in the path (ascending), for highlighting.
#[derive(Clone, Debug)]
pub struct CompleteMatch {
    pub id: FileId,
    pub score: i32,
    pub positions: Vec<u32>,
}

/// Rank the store's paths against `needle`, best first.
///
/// Ties are broken by path order (the candidate iteration order), so results
/// are deterministic. An empty needle matches everything with score 0 plus
/// the frecency bonus, i.e. "most recent first, then path order".
pub fn complete(
    store: &Store,
    scorer: &mut Scorer,
    needle: &[u8],
    opts: &CompleteOptions<'_>,
) -> Vec<CompleteMatch> {
    if opts.limit == 0 {
        return Vec::new();
    }
    scorer.set_needle(needle);
    let ranks = store.touch_ranks();
    let mut topk: TopK<FileId> = TopK::new(opts.limit);
    for (order, id) in store.range_with_prefix(opts.cwd_prefix).enumerate() {
        if opts.dirs_only && store.meta(id).kind != EntryKind::Dir {
            continue;
        }
        let Some(base) = scorer.score(store.path(id)) else {
            continue;
        };
        let score = base.saturating_add(frecency_bonus(&ranks, id));
        topk.push(score, order as u32, id);
    }
    topk.into_sorted_vec()
        .into_iter()
        .map(|(score, id)| {
            let mut positions: Vec<u32> = Vec::new();
            // The candidate scored, so it matches; positions come from the
            // pure alignment (the frecency bonus does not move them).
            let _ = scorer.score_with_positions(store.path(id), &mut positions);
            CompleteMatch {
                id,
                score,
                positions,
            }
        })
        .collect()
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
}
