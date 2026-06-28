//! Parallel candidate scoring for the cold `complete()` path.
//!
//! A short needle over a large index makes [`crate::complete`] visit (and
//! score) almost every live path; single-threaded that is tens of
//! milliseconds at a few hundred thousand entries. When the candidate count
//! crosses [`PARALLEL_MIN_CANDIDATES`], the candidate range is split into
//! contiguous chunks, each scored into its own top-K heap on
//! `bun_threading::WorkPool` workers, and the per-chunk winners are merged on
//! the calling thread. `complete()` stays synchronous: the calling (owning)
//! thread participates and then parks on a [`WaitGroup`] until every chunk is
//! done.
//!
//! # Determinism
//!
//! Results are bit-identical to the sequential path:
//! - every chunk runs the exact same per-candidate pipeline
//!   ([`Query::score_into`] via [`Query::run_in_path_order`] /
//!   [`Query::run_unordered`]) on its own [`bun_fuzzy::Scorer`] built from
//!   the same options and needle (scoring is a pure function of those);
//! - tiebreaks are global, not per-chunk: a path-ordered chunk's heap breaks
//!   ties by `chunk base offset + local index` — the candidate's index in the
//!   full iteration order — and an unordered chunk's heap compares the paths
//!   themselves (the same total order);
//! - the merge re-pushes every chunk's retained candidates into one final
//!   heap with the same `limit` and tiebreak. `(score, tiebreak)` is a strict
//!   total order over distinct candidates, so the retained set of a bounded
//!   heap does not depend on push order; the global top `limit` is contained
//!   in the union of the chunks' top `limit`s;
//! - survivor sets are concatenated in chunk order, i.e. candidate order.
//!
//! # Threading model & liveness
//!
//! The `Store` is single-threaded and never crosses a thread. Before the
//! fan-out the owning thread forces every lazy invariant it needs (the sorted
//! order is already current — `complete()` read it to build the candidate
//! list) and hands the workers only `Sync`, immutable raw views of the
//! store's columns ([`StoreView`]) plus owned copies of the needle, options,
//! candidate ids and frecency ranks. This is sound because the owning thread
//! BLOCKS inside `complete()` until every chunk completes, so nothing can
//! mutate or free the store while a worker reads it (see [`StoreView`]).
//!
//! Liveness does not depend on the pool: every chunk has an atomic `claimed`
//! flag, the calling thread runs the same claim-next-chunk loop as the
//! workers, and the [`WaitGroup`] counts *chunks*, not tasks. If the pool is
//! saturated (or has a single thread) the calling thread simply claims and
//! scores every chunk itself and never waits on work nobody started; it only
//! ever parks on chunks a worker has already begun. A pool task that wakes up
//! after everything was claimed exits without touching the (by then possibly
//! dangling) view.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bun_collections::array_hash_map::{ArrayHashMap, AutoContext};
use bun_fuzzy::{Scorer, ScorerOptions, TopKBy};
use bun_threading::{GuardedBy, Mutex, WaitGroup, WorkPool};

use crate::complete::{CompleteOptions, OrderTie, Query, order_tie};
use crate::store::{FileId, Store, StoreView};

/// Candidate counts below this are scored on the calling thread alone: the
/// fan-out (task scheduling, one `Scorer` per chunk, the parked join) has a
/// fixed cost of a few hundred microseconds, so it only pays for itself once
/// a query visits enough candidates. Measured on a release build (linux
/// x64): the parallel pass loses below ~4k candidates, breaks even around
/// 6k, and is ~1.7-4x faster from 8k up (see `bench/file-index/complete.mjs`
/// for the end-to-end numbers), so the threshold sits at the top of the
/// "sequential is faster" region.
pub(crate) const PARALLEL_MIN_CANDIDATES: usize = 8 * 1024;

/// A chunk is never smaller than `PARALLEL_MIN_CANDIDATES / 2`, so the
/// per-chunk overhead stays amortized just past the threshold (2 chunks).
const CHUNK_MIN_DIVISOR: usize = 2;

type RankMap = ArrayHashMap<u32, u32, AutoContext>;

/// The candidate ids of one query, in the enumeration order of the
/// sequential plan the fan-out replaces (see `complete`'s plan selection).
pub(crate) enum Candidates {
    /// A copy of the store's path-sorted id range: ties break by arrival
    /// index, exactly like the sequential range scan.
    PathOrdered(Vec<u32>),
    /// The arena prefilter's (id-ordered) survivors: ties break by comparing
    /// the candidate paths, exactly like the sequential unordered scan.
    Unordered(Vec<FileId>),
}

impl Candidates {
    pub(crate) fn len(&self) -> usize {
        match self {
            Candidates::PathOrdered(ids) => ids.len(),
            Candidates::Unordered(ids) => ids.len(),
        }
    }
}

/// One claimable contiguous sub-range of the candidate list.
struct Chunk {
    lo: usize,
    hi: usize,
    claimed: AtomicBool,
}

/// What one chunk hands back: its top-`limit` candidates (with the global
/// arrival-order tiebreak when path-ordered) and, when the caller wants
/// them, every candidate the needle was a subsequence of.
struct ChunkOut {
    ranked: Vec<(i32, u32, FileId)>,
    survivors: Vec<FileId>,
}

/// Everything a worker needs, owned or pinned by the blocked calling thread.
struct Shared {
    view: StoreView,
    /// The query's frecency ranks, built once by the calling thread on its
    /// stack; never mutated during the fan-out.
    ranks: *const RankMap,
    cands: Candidates,
    needle: Vec<u8>,
    scorer_opts: ScorerOptions,
    strip: usize,
    dirs_only: bool,
    limit: usize,
    want_survivors: bool,
    chunks: Vec<Chunk>,
    /// `out[i]` is written exactly once, by whichever thread claimed chunk
    /// `i`, before that chunk's [`WaitGroup::finish`].
    out: GuardedBy<Vec<Option<ChunkOut>>, Mutex>,
    /// Counts unfinished *chunks* (not tasks); see the module docs.
    done: WaitGroup,
}

// SAFETY: `Shared` is auto-`Send`/`Sync` except for the `ranks` pointer (and
// the raw pointers inside `view`, which carry their own impls). Both point
// into the stack frame / store of the calling thread, which blocks inside
// `complete()` until every chunk has finished and only ever shares them
// read-only — see the module docs and `StoreView`.
unsafe impl Send for Shared {}
// SAFETY: see the `Send` impl above; all access through `Shared` is
// read-only except the per-chunk atomics, the mutex-guarded output slots and
// the wait group, which are synchronization primitives.
unsafe impl Sync for Shared {}

/// Score `cands` against `needle` across the work pool and the calling
/// thread; blocks until done. `scorer` is only read for its options (each
/// chunk builds its own). Survivors (if requested) are appended to
/// `survivors_out` in candidate order. See the module docs.
#[allow(clippy::too_many_arguments)] // a one-call-site internal entry point
pub(crate) fn run(
    store: &Store,
    scorer: &Scorer,
    needle: &[u8],
    ranks: &RankMap,
    cands: Candidates,
    opts: &CompleteOptions<'_>,
    survivors_out: Option<&mut Vec<FileId>>,
    parallel_min: usize,
) -> Vec<(i32, FileId)> {
    let n = cands.len();
    let ordered = matches!(cands, Candidates::PathOrdered(_));
    let chunk_min = (parallel_min / CHUNK_MIN_DIVISOR).max(1);
    // The calling thread is one of the scoring threads, so it is counted.
    let threads = (WorkPool::get().max_threads as usize).max(1);
    let nchunks = (n / chunk_min).clamp(1, threads);

    let mut chunks: Vec<Chunk> = Vec::with_capacity(nchunks);
    let (size, rem) = (n / nchunks, n % nchunks);
    let mut lo = 0usize;
    for i in 0..nchunks {
        let hi = lo + size + usize::from(i < rem);
        chunks.push(Chunk {
            lo,
            hi,
            claimed: AtomicBool::new(false),
        });
        lo = hi;
    }
    debug_assert_eq!(lo, n);

    let shared = Arc::new(Shared {
        view: store.view(),
        ranks: core::ptr::from_ref(ranks),
        cands,
        needle: needle.to_vec(),
        scorer_opts: scorer.options(),
        strip: opts.cwd_prefix.len(),
        dirs_only: opts.dirs_only,
        limit: opts.limit,
        want_survivors: survivors_out.is_some(),
        chunks,
        out: GuardedBy::init(core::iter::repeat_with(|| None).take(nchunks).collect()),
        done: WaitGroup::init_with_count(nchunks),
    });

    // One helper task per chunk beyond the calling thread's. A failed (OOM)
    // schedule or a task the pool never gets to is harmless: the calling
    // thread's loop below claims whatever nobody else did.
    for _ in 1..nchunks {
        let _ = WorkPool::go(Arc::clone(&shared), |shared| run_chunks(&shared));
    }
    run_chunks(&shared);
    shared.done.wait();

    merge(store, &shared, ordered, survivors_out)
}

/// Claim-and-score loop run identically by the calling thread and by every
/// helper task (see the module docs on liveness).
fn run_chunks(shared: &Shared) {
    let mut scorer: Option<Scorer> = None;
    for (i, chunk) in shared.chunks.iter().enumerate() {
        if chunk.claimed.swap(true, Ordering::AcqRel) {
            continue;
        }
        let scorer = scorer.get_or_insert_with(|| {
            let mut s = Scorer::new(shared.scorer_opts);
            s.set_needle(&shared.needle);
            s
        });
        let result = score_chunk(shared, chunk.lo, chunk.hi, scorer);
        *shared
            .out
            .lock()
            .get_mut(i)
            .expect("out has one slot per chunk") = Some(result);
        shared.done.finish();
    }
}

/// The exact sequential per-candidate pipeline over one contiguous chunk.
fn score_chunk(shared: &Shared, lo: usize, hi: usize, scorer: &mut Scorer) -> ChunkOut {
    let mut survivors: Vec<FileId> = Vec::new();
    // SAFETY: the calling thread that owns the pointee blocks until this
    // chunk finishes (see the module docs); it is never mutated meanwhile.
    let ranks: &RankMap = unsafe { &*shared.ranks };
    let mut query = Query {
        src: shared.view,
        strip: shared.strip,
        dirs_only: shared.dirs_only,
        limit: shared.limit,
        ranks,
        survivors_out: shared.want_survivors.then_some(&mut survivors),
    };
    let ranked = match &shared.cands {
        Candidates::PathOrdered(ids) => query.run_in_path_order(
            scorer,
            ids[lo..hi].iter().map(|&raw| FileId::from_raw(raw)),
            lo as u32,
        ),
        Candidates::Unordered(ids) => query
            .run_unordered(scorer, ids[lo..hi].iter().copied())
            .into_iter()
            .map(|(score, id)| (score, 0, id))
            .collect(),
    };
    ChunkOut { ranked, survivors }
}

/// Fold every chunk's winners into the final top-`limit`, with the same
/// tiebreak the chunks used, and the survivor lists in candidate order.
fn merge(
    store: &Store,
    shared: &Shared,
    ordered: bool,
    survivors_out: Option<&mut Vec<FileId>>,
) -> Vec<(i32, FileId)> {
    let outs: Vec<Option<ChunkOut>> = core::mem::take(&mut *shared.out.lock());
    debug_assert!(outs.iter().all(Option::is_some));
    if let Some(out) = survivors_out {
        for chunk in outs.iter().flatten() {
            out.extend_from_slice(&chunk.survivors);
        }
    }
    if ordered {
        let mut topk: TopKBy<(u32, FileId), OrderTie> = TopKBy::new(shared.limit, order_tie);
        for chunk in outs.iter().flatten() {
            for &(score, order, id) in &chunk.ranked {
                topk.push(score, (order, id));
            }
        }
        topk.into_sorted_vec()
            .into_iter()
            .map(|(score, (_, id))| (score, id))
            .collect()
    } else {
        let mut topk = TopKBy::new(shared.limit, |a: &FileId, b: &FileId| {
            store.path(*a).cmp(store.path(*b))
        });
        for chunk in outs.iter().flatten() {
            for &(score, _, id) in &chunk.ranked {
                topk.push(score, id);
            }
        }
        topk.into_sorted_vec()
    }
}
