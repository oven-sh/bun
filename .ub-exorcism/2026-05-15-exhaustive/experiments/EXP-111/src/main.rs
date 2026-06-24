//! EXP-111 reproducer (CONFIRMED_UB under default Miri).
//!
//! SOURCE-ANCHOR:
//!   src/bundler/Chunk.rs:80-84  (`pub renamer: bun_renamer::ChunkRenamer`)
//!   src/bundler/Chunk.rs:114-134 (the `unsafe impl Send/Sync` with multi-paragraph SAFETY comment)
//!   src/bundler/Chunk.rs:130-132 (the explicit author TODO: "Renamer<'r> still borrows
//!                                  &'r mut {Number,Minify}Renamer, ... the borrow should
//!                                  become &'r")
//!
//! WHAT THIS SHOWS:
//! `Chunk` is `unsafe impl Send + Sync` and the bundler fans out one `*mut Chunk`
//! across many `PendingPartRange` worker threads. Each worker re-derives a
//! `Renamer<'r>` which TYPES as `&'r mut {Number,Minify}Renamer` but BEHAVES
//! read-only ("the printer never writes through it" — author's SAFETY comment).
//!
//! Under default Miri, concurrent workers minting `&mut Chunk` from the same raw
//! owner race at the retag itself — even if neither lookup mutates the renamer —
//! because `&mut` retags have write implications for data-race purposes.
//!
//! Run under Miri:
//!     # Default Miri rejects the concurrent retags.
//!     cargo +nightly miri run
//!     # Tree Borrows accepts the current read-only model; keep that distinction.
//!     MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run
//!
//! Expected default-Miri signal:
//!     error: Undefined Behavior: Data race detected between two retag writes
//!     of type `Chunk<'_>`.
//!
//! Tree-Borrows signal:
//!     clean for this read-only model. Do not claim TB failure unless a
//!     source-shaped writing path is added.
//!
//! Falsifiability:
//! - If `Renamer<'r>` is changed to carry `&'r` instead of `&'r mut` (the
//!   author's named fix), this reproducer's multi-worker reborrow becomes
//!   `&'r` reborrows which are SOUND under both SB and TB.
//! - If the bundler ceases the per-chunk reborrow (each worker gets an
//!   owned Renamer snapshot at fan-out), the carry shape becomes irrelevant.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

/// Stand-in for `{Number,Minify}Renamer` — owned, populated before fan-out.
struct ChildRenamer {
    name_table: Vec<String>,
    read_count: AtomicUsize, // workers bump this for proof of "only reads"
}

/// Stand-in for `Renamer<'r>` — carries `&'r mut ChildRenamer` per the current
/// type (the SHAPE the EXP-111 finding is about). The TODO at Chunk.rs:130-132
/// proposes flipping this to `&'r ChildRenamer`.
struct Renamer<'r> {
    inner: &'r mut ChildRenamer, // <-- THE EXP-111 LINE: should be &'r
}

impl<'r> Renamer<'r> {
    /// Read-only lookup (mirrors the "printer never writes through it" claim).
    fn lookup(&self, idx: usize) -> &str {
        self.inner.read_count.fetch_add(1, Ordering::Relaxed);
        &self.inner.name_table[idx]
    }
}

/// Stand-in for `Chunk` — bundles a `Renamer<'r>` and `unsafe impl Send/Sync`.
/// MIRROR of src/bundler/Chunk.rs:80-134.
struct Chunk<'r> {
    renamer: Renamer<'r>,
    chunk_idx: usize,
}

// MIRROR of src/bundler/Chunk.rs:133-134 (the author-acknowledged unsound shape).
unsafe impl Send for Chunk<'_> {}
unsafe impl Sync for Chunk<'_> {}

struct SendChunkPtr<T>(*mut T);

impl<T> Copy for SendChunkPtr<T> {}
impl<T> Clone for SendChunkPtr<T> {
    fn clone(&self) -> Self {
        *self
    }
}

// Mirrors the bundler's worker fan-out contract: the raw pointer is considered
// sendable because each worker is expected to perform read-only work.
unsafe impl<T> Send for SendChunkPtr<T> {}
unsafe impl<T> Sync for SendChunkPtr<T> {}

fn worker(chunk_ptr: SendChunkPtr<Chunk<'_>>, worker_id: usize) {
    // Each worker re-derives a `&mut Chunk` from the shared raw pointer.
    // This is the EXP-111 shape: per-PendingPartRange-task mutable reborrow.
    // SAFETY (CLAIMED): per the Chunk.rs:114-129 SAFETY comment, workers
    // only READ through the Renamer. The reborrow itself is what's UB.
    let chunk: &mut Chunk<'_> = unsafe { &mut *chunk_ptr.0 };

    // Read-only access — mirrors the printer's lookup pattern.
    let n0 = chunk.renamer.lookup(0);
    let n1 = chunk.renamer.lookup(1);
    println!(
        "[exp-111 worker {} chunk {}] lookup(0)='{}' lookup(1)='{}'",
        worker_id, chunk.chunk_idx, n0, n1
    );
}

fn main() {
    // Phase 1: build the populated renamer (mirrors "renamer is fully populated
    // before fan-out").
    let mut child = ChildRenamer {
        name_table: vec![
            "$rename_a".to_string(),
            "$rename_b".to_string(),
            "$rename_c".to_string(),
        ],
        read_count: AtomicUsize::new(0),
    };

    // Phase 2: take the outer `&mut ChildRenamer` (the carry shape under audit).
    let outer_mut: &mut ChildRenamer = &mut child;

    // Phase 3: wrap in a Chunk (mirrors the bundler's per-chunk renamer field).
    let mut chunk = Chunk {
        renamer: Renamer { inner: outer_mut },
        chunk_idx: 0,
    };

    // Phase 4: capture the raw pointer for worker fan-out. In real Bun this
    // happens at the `generate_compile_result_for_*_chunk` call site.
    let chunk_ptr = SendChunkPtr(&mut chunk as *mut Chunk<'_>);

    // Phase 5: spawn N workers, each re-deriving `&mut Chunk` from the shared
    // raw pointer. Under default Miri SB, the second worker's mutable retag
    // invalidates the first. NO WORKER WRITES — but the retag itself is UB.
    thread::scope(|scope| {
        let handles: Vec<_> = (0..4)
            .map(|i| {
                let ptr = chunk_ptr;
                scope.spawn(move || worker(ptr, i))
            })
            .collect();

        for h in handles {
            h.join().unwrap();
        }
    });

    let final_reads = chunk.renamer.inner.read_count.load(Ordering::Relaxed);
    println!("[exp-111] total read_count = {} (expected 8 = 4 workers × 2 lookups)", final_reads);
    println!("[exp-111] If this line printed AND Miri was enabled, retag shape was reconsidered.");
}
