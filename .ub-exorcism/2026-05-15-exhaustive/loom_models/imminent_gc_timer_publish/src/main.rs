//! Loom model: `EventLoop::imminent_gc_timer` publish/observe pair.
//!
//! SOURCE-ANCHOR: src/jsc/event_loop.rs:98 (`imminent_gc_timer: AtomicPtr<()>`)
//! SOURCE-ANCHOR: src/jsc/event_loop.rs:526-538 (`run_imminent_gc_timer` consumer)
//! SOURCE-ANCHOR: src/runtime/timer/WTFTimer.rs:135-190 (`WTFTimer::update` producer)
//!
//! Hypothesis: a non-JS thread calls `WTFTimer::update`, which races to
//! `compare_exchange(null -> self, SeqCst, SeqCst)` on the JS thread's
//! `EventLoop::imminent_gc_timer` slot. The JS thread later runs
//! `run_imminent_gc_timer`, which does `swap(null, SeqCst)` and — if it
//! observed a non-null pointer — synchronously calls `__bun_run_wtf_timer(ptr)`,
//! which dereferences `*WTFTimer` to access fields the producer set BEFORE
//! installing the pointer in the slot (e.g. `event_loop_timer`, `repeat`,
//! script_execution_context_id). If that "before" store ever reordered past
//! the cmpxchg, the consumer would read garbage.
//!
//! The SeqCst pair is sufficient to prevent that; this model verifies it, and
//! the `#[ignore]` sanity test demonstrates loom catching a Relaxed regression.
//!
//! Why this matters: the slot is the only synchronisation between a non-JS
//! producer and a JS-thread consumer that immediately deref's the pointer.
//! Weakening the ordering by accident (Relaxed/Release-only-store) would be
//! a UB bug that *cannot* be exposed by tests on x86 (TSO collapses these)
//! and would only manifest on ARM under sustained load.

#![cfg(loom)]

use loom::cell::UnsafeCell;
use loom::sync::Arc;
use loom::sync::atomic::{AtomicPtr, Ordering};
use loom::thread;

/// Faithful subset of the real `WTFTimer`: a payload field set by the producer
/// BEFORE publishing the pointer into `imminent_gc_timer`. If the producer's
/// payload write reorders past the publish, the consumer sees stale memory.
struct WTFTimer {
    /// Producer writes this with `payload.with_mut(|p| *p = 0xCAFE)` BEFORE
    /// the cmpxchg. The consumer reads it after swap-and-deref.
    /// `UnsafeCell` so loom can track the unsynchronized data accesses.
    payload: UnsafeCell<u64>,
}

unsafe impl Send for WTFTimer {}
unsafe impl Sync for WTFTimer {}

/// Faithful subset of `EventLoop`: the single AtomicPtr slot.
struct EventLoop {
    imminent_gc_timer: AtomicPtr<WTFTimer>,
}

impl EventLoop {
    fn new() -> Self {
        Self {
            imminent_gc_timer: AtomicPtr::new(core::ptr::null_mut()),
        }
    }
}

/// Producer side (`WTFTimer::update` at WTFTimer.rs:135-190).
/// May run on a non-JS thread.
fn producer_update(el: &EventLoop, timer: *mut WTFTimer) {
    // The real code writes `(*this).repeat = repeat;` (and earlier mutates
    // `event_loop_timer`) BEFORE this cmpxchg. Model that as a payload write
    // through the UnsafeCell so loom tracks it as an unsynchronized store
    // that needs the cmpxchg-release to make visible.
    //
    // SAFETY: the producer owns `timer` exclusively at this point (the
    // `cancel`/`fire` paths also use cmpxchg, so the slot is the rendezvous).
    unsafe {
        (*timer)
            .payload
            .with_mut(|p| core::ptr::write_volatile(p, 0xCAFE_F00Du64));
    }
    let _ = el.imminent_gc_timer.compare_exchange(
        core::ptr::null_mut(),
        timer,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
}

/// Consumer side (`EventLoop::run_imminent_gc_timer` at event_loop.rs:526-538).
/// Runs on the JS thread.
fn consumer_run(el: &EventLoop) -> Option<u64> {
    let ptr = el
        .imminent_gc_timer
        .swap(core::ptr::null_mut(), Ordering::SeqCst);
    if ptr.is_null() {
        return None;
    }
    // SAFETY: the SeqCst pair establishes happens-before between the
    // producer's payload write and this read. If the model is sound, the
    // value here is always exactly `0xCAFE_F00D`.
    let v = unsafe { (*ptr).payload.with(|p| core::ptr::read_volatile(p)) };
    Some(v)
}

/// Test 1: one producer + one consumer.
///
/// Expected outcomes:
///   - Default (SeqCst pair): PASS — consumer either sees None (cmpxchg
///     hadn't happened) or sees `0xCAFE_F00D`. Never sees a non-CAFE value.
///   - Relaxed variant (see `loom_sanity_relaxed_should_race`): FAIL — loom
///     reports a data race on `payload` because the unsynchronized write
///     can be reordered past the cmpxchg.
#[test]
fn loom_publish_observe_seqcst() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(3);
    builder.check(|| {
        let el = Arc::new(EventLoop::new());
        // Pre-leak a WTFTimer the producer will publish.
        let timer = Box::into_raw(Box::new(WTFTimer {
            payload: UnsafeCell::new(0),
        }));

        let el_prod = Arc::clone(&el);
        let p = thread::spawn(move || {
            producer_update(&el_prod, timer);
        });

        let el_cons = Arc::clone(&el);
        let c = thread::spawn(move || {
            // The consumer may run before or after the producer; both are
            // legal schedules and either outcome is fine for soundness.
            if let Some(v) = consumer_run(&el_cons) {
                assert_eq!(v, 0xCAFE_F00Du64, "consumer saw torn or stale payload");
            }
        });

        p.join().unwrap();
        c.join().unwrap();

        // If the consumer didn't drain it, drain now so we can free.
        let _ = consumer_run(&el);

        // SAFETY: timer ownership returned via either the consumer (which
        // didn't free in this model) or the post-loop drain.
        unsafe { drop(Box::from_raw(timer)) };
    });
}

/// Negative control: drop the SeqCst on the producer's cmpxchg success-order
/// to Relaxed. This should let loom move the payload write past the cmpxchg
/// and the consumer's read should observe 0 (the init value) instead of the
/// published payload — i.e. the assertion fires.
///
/// Marked `#[ignore]` so the default run is clean; un-ignore to confirm the
/// model exercises the ordering (used as the "Relaxed run" cell in the
/// expected-outcomes matrix below).
#[test]
#[ignore]
fn loom_sanity_relaxed_should_race() {
    fn producer_relaxed(el: &EventLoop, timer: *mut WTFTimer) {
        unsafe {
            (*timer)
                .payload
                .with_mut(|p| core::ptr::write_volatile(p, 0xCAFE_F00Du64));
        }
        let _ = el.imminent_gc_timer.compare_exchange(
            core::ptr::null_mut(),
            timer,
            Ordering::Relaxed, // DELIBERATELY weakened — should race
            Ordering::Relaxed,
        );
    }

    loom::model(|| {
        let el = Arc::new(EventLoop::new());
        let timer = Box::into_raw(Box::new(WTFTimer {
            payload: UnsafeCell::new(0),
        }));

        let el_prod = Arc::clone(&el);
        let p = thread::spawn(move || producer_relaxed(&el_prod, timer));

        let el_cons = Arc::clone(&el);
        let c = thread::spawn(move || {
            // Consumer keeps SeqCst — only the producer side is weakened —
            // so the failure isolates the producer's release responsibility.
            if let Some(v) = consumer_run(&el_cons) {
                assert_eq!(v, 0xCAFE_F00Du64, "consumer saw stale payload");
            }
        });

        p.join().unwrap();
        c.join().unwrap();
        let _ = consumer_run(&el);
        unsafe { drop(Box::from_raw(timer)) };
    });
}
