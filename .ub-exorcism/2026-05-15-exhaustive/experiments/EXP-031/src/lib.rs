//! EXP-031: loom model of `WatcherAtomics` triple-buffered HotReloadEvent slots.
//!
//! Source under model: `src/runtime/bake/DevServer/WatcherAtomics.rs`
//!
//! Hypothesis: The watcher thread writes a non-atomic `HotReloadEvent` slot
//! while the JS thread reads/writes a different slot. Handoff is `swap(idx,
//! AcqRel)` on `next_event: AtomicU8`. The claim is that the AcqRel edge plus
//! the `current_event` / `pending_event` accounting (watcher-thread-only)
//! guarantees the JS thread never reads a slot the watcher is still writing.
//!
//! Model (simplified two-thread two-slot variant — three slots are not needed
//! to exhibit the race shape; the AcqRel edge is the load-bearing primitive):
//!   - 2 slots: events[0], events[1], each is an `UnsafeCell<u64>`.
//!   - watcher thread: pick a free slot, write a value to it non-atomically,
//!     then `next_event.swap(idx, AcqRel)`.
//!   - JS thread: spin on `next_event`, when an index appears,
//!     `swap(WAITING, AcqRel)` to claim it, read the slot, then store DONE.
//!
//! If AcqRel suffices, loom's UnsafeCell permit-tracking will never report a
//! concurrent access on the same slot.

#![cfg(loom)]

use loom::cell::UnsafeCell;
use loom::sync::atomic::{AtomicU8, Ordering};
use loom::sync::Arc;
use loom::thread;

const WAITING: u8 = u8::MAX - 1;
const DONE: u8 = u8::MAX;

struct WatcherAtomics {
    events: [UnsafeCell<u64>; 2],
    next_event: AtomicU8,
}

unsafe impl Send for WatcherAtomics {}
unsafe impl Sync for WatcherAtomics {}

impl WatcherAtomics {
    fn new() -> Self {
        Self {
            events: [UnsafeCell::new(0), UnsafeCell::new(0)],
            next_event: AtomicU8::new(DONE),
        }
    }

    // Watcher side: writes the slot, publishes via AcqRel swap.
    // current_idx / pending_idx are passed in to mirror watcher-thread-only state.
    fn watcher_publish(&self, slot_idx: u8, value: u64) -> u8 {
        // SAFETY: caller (this thread) has exclusive access to events[slot_idx]
        // by the watcher's current_event/pending_event bookkeeping. The non-
        // atomic write must happen-before any read by the consumer.
        unsafe {
            self.events[slot_idx as usize].with_mut(|p| *p = value);
        }
        self.next_event.swap(slot_idx, Ordering::AcqRel)
    }

    // JS side: claim WAITING, then read the slot that was published.
    fn js_take(&self) -> Option<u64> {
        let next = self.next_event.swap(WAITING, Ordering::AcqRel);
        if next == DONE || next == WAITING {
            return None;
        }
        let idx = next;
        // SAFETY: AcqRel swap above synchronizes-with the watcher's AcqRel
        // swap that published `idx`. The watcher's non-atomic write to
        // events[idx] happens-before our read, IF the AcqRel edge is sufficient.
        let v = unsafe { self.events[idx as usize].with(|p| *p) };
        // Now reset to DONE so the watcher knows we're not consuming.
        let _ = self.next_event.compare_exchange(
            WAITING,
            DONE,
            Ordering::Release,
            Ordering::Relaxed,
        );
        Some(v)
    }
}

// Test 1: watcher publishes one slot, JS reads it. The minimal happens-before
// shape. If AcqRel is sound, loom finds no race on the slot.
#[test]
fn loom_single_publish_take() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(3);
    builder.check(|| {
        let a = Arc::new(WatcherAtomics::new());

        let a1 = Arc::clone(&a);
        let watcher = thread::spawn(move || {
            a1.watcher_publish(0, 0xCAFE);
        });

        let a2 = Arc::clone(&a);
        let js = thread::spawn(move || {
            // Spin a bounded number of times.
            for _ in 0..3 {
                if let Some(v) = a2.js_take() {
                    assert_eq!(v, 0xCAFE);
                    return;
                }
                loom::thread::yield_now();
            }
        });

        watcher.join().unwrap();
        js.join().unwrap();
    });
}

// Sanity test (negative control): repeat test 1 but with Relaxed instead of
// AcqRel. This SHOULD trigger loom's race detector — if it doesn't, our model
// is not actually exercising the ordering primitive and we cannot trust the
// AcqRel pass as evidence.
//
// We mark this `#[ignore]` so the default run is clean; remove the ignore to
// confirm loom flags it.
#[test]
#[ignore]
fn loom_sanity_relaxed_should_race() {
    loom::model(|| {
        struct WA {
            events: [UnsafeCell<u64>; 2],
            next_event: AtomicU8,
        }
        unsafe impl Send for WA {}
        unsafe impl Sync for WA {}
        let a = Arc::new(WA {
            events: [UnsafeCell::new(0), UnsafeCell::new(0)],
            next_event: AtomicU8::new(DONE),
        });
        let a1 = Arc::clone(&a);
        let watcher = thread::spawn(move || {
            unsafe { a1.events[0].with_mut(|p| *p = 0xCAFE); }
            a1.next_event.swap(0, Ordering::Relaxed); // DELIBERATELY Relaxed
        });
        let a2 = Arc::clone(&a);
        let js = thread::spawn(move || {
            for _ in 0..3 {
                let next = a2.next_event.swap(WAITING, Ordering::Relaxed); // DELIBERATELY Relaxed
                if next != DONE && next != WAITING {
                    let _ = unsafe { a2.events[next as usize].with(|p| *p) };
                    return;
                }
                loom::thread::yield_now();
            }
        });
        watcher.join().unwrap();
        js.join().unwrap();
    });
}

// Test 2: watcher publishes slot 0, then (after JS may or may not have
// consumed) publishes slot 1. Two distinct slots — mirrors the triple-buffer
// rotation. The watcher's bookkeeping guarantees it never re-touches a slot
// the JS thread is reading; this test verifies the AcqRel edge enforces that.
#[test]
fn loom_publish_two_distinct_slots() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(2);
    builder.check(|| {
        let a = Arc::new(WatcherAtomics::new());

        let a1 = Arc::clone(&a);
        let watcher = thread::spawn(move || {
            // Publish slot 0; the watcher's accounting says slot 0 is now
            // "current_event"; it next picks slot 1 (slot 0 in use).
            let old = a1.watcher_publish(0, 0x1111);
            // Bookkeeping: if old != DONE, we'd skip; we only publish to a slot
            // we know is free. Here we deterministically publish slot 1.
            let _ = old;
            a1.watcher_publish(1, 0x2222);
        });

        let a2 = Arc::clone(&a);
        let js = thread::spawn(move || {
            // JS may take 0, 1, or 2 values.
            for _ in 0..3 {
                if let Some(v) = a2.js_take() {
                    assert!(v == 0x1111 || v == 0x2222);
                }
                loom::thread::yield_now();
            }
        });

        watcher.join().unwrap();
        js.join().unwrap();
    });
}
