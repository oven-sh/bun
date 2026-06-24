//! Loom model: `EventLoop::concurrent_ref` delta-accumulator swap consistency.
//!
//! SOURCE-ANCHOR: src/jsc/event_loop.rs:91 (`concurrent_ref: AtomicI32`)
//! SOURCE-ANCHOR: src/jsc/event_loop.rs:942-951 (`ref_concurrently` / `unref_concurrently`)
//! SOURCE-ANCHOR: src/jsc/event_loop.rs:602-633 (`update_counts` consumer applies delta)
//!
//! Hypothesis: any thread can call `ref_concurrently()` (fetch_add(+1, SeqCst))
//! or `unref_concurrently()` (fetch_sub(1, SeqCst)) to bump the pending refcount
//! delta. The JS thread runs `update_counts` which `swap(0, SeqCst)` to apply
//! the accumulated delta to the libuv loop's `active` counter exactly once.
//!
//! The hazard: if `swap` loses any ref/unref that happened-before it, the
//! libuv active counter drifts forever — the loop either thinks it has more
//! refs than it does (hangs in `auto_tick_active`) or fewer (exits early).
//! The spec comment in `update_counts` explicitly warns: "refs queued via
//! `ref_concurrently()` would be lost forever" if the delta is dropped.
//!
//! Model: 2 producers do (+1, -1, +1, -1) — net 0. The consumer swap(0)
//! batch + every subsequent swap(0) must accumulate to exactly 0.
//!
//! Why this matters: same shape as `pending_tasks` (counter + consumer
//! observation) but the consumer is RMW (`swap`) not load. Loom proves
//! that `swap(0, SeqCst)` totally-orders with all the fetch_add/fetch_sub
//! and that the sum of (consumer swap returns + final atomic value) equals
//! (sum of all fetch_add deltas).

#![cfg(loom)]

use loom::sync::Arc;
use loom::sync::atomic::{AtomicI32, Ordering};
use loom::thread;

struct EventLoop {
    /// Mirrors `concurrent_ref: AtomicI32` (event_loop.rs:91).
    concurrent_ref: AtomicI32,
}

impl EventLoop {
    fn new() -> Self {
        Self {
            concurrent_ref: AtomicI32::new(0),
        }
    }

    /// Producer: ref_concurrently — event_loop.rs:942.
    fn ref_concurrent(&self) {
        let _ = self.concurrent_ref.fetch_add(1, Ordering::SeqCst);
    }

    /// Producer: unref_concurrently — event_loop.rs:947.
    fn unref_concurrent(&self) {
        let _ = self.concurrent_ref.fetch_sub(1, Ordering::SeqCst);
    }

    /// Consumer: swap-and-apply — event_loop.rs:606.
    /// Returns the delta to apply to libuv's `active` counter.
    fn swap_delta(&self) -> i32 {
        self.concurrent_ref.swap(0, Ordering::SeqCst)
    }
}

/// Test 1: two producers each do +1, -1 (net 0 each). Consumer may swap
/// 0, 1, or more times. Sum of all returned deltas + final atomic value
/// MUST equal 0.
///
/// Expected outcomes:
///   - Default (SeqCst everywhere): PASS — every producer op is observed
///     by exactly one consumer swap or remains in the atomic at end.
///   - Relaxed swap (see `loom_sanity_relaxed_should_lose_deltas`): in
///     theory loom doesn't catch arithmetic loss from Relaxed RMW (RMW is
///     always atomic), but the SeqCst→AcqRel weakening is the realistic
///     audit question — does an AcqRel swap suffice? It DOES for arithmetic;
///     the SeqCst is overkill but matches Zig spec. The sanity test
///     demonstrates the loom run is exercising the schedule space.
#[test]
fn loom_swap_captures_all_deltas() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(3);
    builder.check(|| {
        let el = Arc::new(EventLoop::new());

        let el1 = Arc::clone(&el);
        let p1 = thread::spawn(move || {
            el1.ref_concurrent();
            el1.unref_concurrent();
        });

        let el2 = Arc::clone(&el);
        let p2 = thread::spawn(move || {
            el2.ref_concurrent();
            el2.unref_concurrent();
        });

        let el3 = Arc::clone(&el);
        let c = thread::spawn(move || {
            // Consumer swaps once mid-flight. The remaining delta stays in
            // the atomic for the post-join drain.
            el3.swap_delta()
        });

        p1.join().unwrap();
        p2.join().unwrap();
        let mid_delta = c.join().unwrap();
        let final_delta = el.swap_delta();
        // Sum of all deltas observed across all consumer swaps MUST equal
        // the net producer balance (0 in this case). Loss = lost ref.
        assert_eq!(
            mid_delta + final_delta,
            0,
            "delta sum drifted: mid={mid_delta} final={final_delta} (sum must be 0)",
        );
        // Atomic must also be 0 (last swap drained it).
        assert_eq!(
            el.concurrent_ref.load(Ordering::SeqCst),
            0,
            "atomic not drained",
        );
    });
}

/// Test 2: skewed producers — p1 does +1, p2 does +1, +1. Consumer swaps
/// twice. Sum must equal +3 (no unrefs).
#[test]
fn loom_swap_skewed_producers() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(2);
    builder.check(|| {
        let el = Arc::new(EventLoop::new());

        let el1 = Arc::clone(&el);
        let p1 = thread::spawn(move || {
            el1.ref_concurrent();
        });

        let el2 = Arc::clone(&el);
        let p2 = thread::spawn(move || {
            el2.ref_concurrent();
            el2.ref_concurrent();
        });

        let el3 = Arc::clone(&el);
        let c = thread::spawn(move || el3.swap_delta() + el3.swap_delta());

        p1.join().unwrap();
        p2.join().unwrap();
        let mid = c.join().unwrap();
        let last = el.swap_delta();
        assert_eq!(
            mid + last,
            3,
            "lost ref(s): observed {mid}+{last}={} (expected 3)",
            mid + last,
        );
    });
}

/// Negative control: weakening the swap to Relaxed does NOT break arithmetic
/// (atomic RMW is always atomic in the abstract machine — the orderings are
/// about *other* memory). But Acquire on the swap is load-bearing if any
/// caller reads non-atomic state set by a producer before fetch_add — none
/// do in this struct, so this test exists mostly to document the audit
/// finding. Marked `#[ignore]`.
#[test]
#[ignore]
fn loom_sanity_relaxed_swap_arithmetic_holds() {
    loom::model(|| {
        let el = Arc::new(EventLoop {
            concurrent_ref: AtomicI32::new(0),
        });

        let el1 = Arc::clone(&el);
        let p = thread::spawn(move || {
            // Even Relaxed fetch_add cannot lose an increment; this test
            // confirms loom agrees, so the SeqCst→AcqRel weakening could
            // be safely done if the perf mattered.
            let _ = el1.concurrent_ref.fetch_add(1, Ordering::Relaxed);
            let _ = el1.concurrent_ref.fetch_add(1, Ordering::Relaxed);
        });

        let el2 = Arc::clone(&el);
        let c = thread::spawn(move || el2.concurrent_ref.swap(0, Ordering::Relaxed));

        p.join().unwrap();
        let mid = c.join().unwrap();
        let last = el.concurrent_ref.swap(0, Ordering::Relaxed);
        assert_eq!(mid + last, 2, "lost a Relaxed RMW (would be a loom bug)");
    });
}
