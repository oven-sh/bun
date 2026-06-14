// EXP-052: model of `bun_threading::UnboundedQueue<T>` (MPSC lock-free).
//
// Mirrors `src/threading/unbounded_queue.rs:216-369`:
//   - producers CAS `back` (AcqRel) then `Release`-store `next` on the previous tail
//   - consumer Acquire-loads `front → next`, then advances `front`
//   - on null `next` the consumer spins (real code uses `hint::spin_loop` @ :324)
//
// We expose two variants:
//   * `correct_push` / `correct_pop` use Bun's Acquire/Release pair.
//   * `racy_push` / `racy_pop` (negative control) drop everything to Relaxed.
//
// Under `--cfg loom`, the tests in tests/unbounded_queue_loom.rs explore
// 2-producer/1-consumer interleavings up to a small bound (≤200 iters).
//
// Notes for loom soundness of the harness itself:
//   * Nodes are reachable from the queue throughout the test; we do not free
//     them inside the model (loom forbids `mut`/non-atomic access concurrent
//     with atomic stores).
//   * Final state is read after `join()` of all threads, so non-atomic reads
//     of `next` for verification would be sound, but we still use Acquire to
//     keep loom happy across both std and loom.

#[cfg(loom)]
pub use loom::sync::atomic::{AtomicPtr, Ordering};

#[cfg(not(loom))]
pub use std::sync::atomic::{AtomicPtr, Ordering};

use core::ptr;

/// Single link node. `next` is loaded by the consumer; producers store it
/// with `Release` in the correct variant.
pub struct Link<T> {
    pub value: T,
    pub next: AtomicPtr<Link<T>>,
}

impl<T> Link<T> {
    pub fn new(value: T) -> Self {
        Self { value, next: AtomicPtr::new(ptr::null_mut()) }
    }
}

/// MPSC unbounded queue. `back` is the producer tail; `front` is the consumer head.
pub struct UnboundedQueue<T> {
    pub front: AtomicPtr<Link<T>>,
    pub back: AtomicPtr<Link<T>>,
}

impl<T> UnboundedQueue<T> {
    /// Construct with a sentinel node already allocated and accessible
    /// (matches Bun: `front == back == sentinel`).
    pub fn new_with_sentinel(sentinel: *mut Link<T>) -> Self {
        Self {
            front: AtomicPtr::new(sentinel),
            back: AtomicPtr::new(sentinel),
        }
    }

    // ── correct (Acquire/Release) variant ─────────────────────────────────

    /// Producer (push_batch :263). Swap `back` with AcqRel, then Release-store
    /// the new node into the previous tail's `next`.
    pub fn correct_push(&self, node: *mut Link<T>) {
        let prev = self.back.swap(node, Ordering::AcqRel);
        // SAFETY: `prev` was the prior tail; it is either the sentinel or a
        // node owned by the producer that previously stored it. Producers
        // only Release-store `next` once (the slot is null until they do),
        // and the consumer never frees nodes during a model run.
        unsafe { (*prev).next.store(node, Ordering::Release) };
    }

    /// Consumer (pop_batch :345 + spin @ :324). Read `front`, then read
    /// `front.next`; if null, spin up to `max_spins`. On success, advance
    /// `front` to the next node and return it.
    pub fn correct_pop(&self, max_spins: usize) -> Option<*mut Link<T>> {
        let front = self.front.load(Ordering::Acquire);
        for _ in 0..max_spins {
            let next = unsafe { (*front).next.load(Ordering::Acquire) };
            if !next.is_null() {
                self.front.store(next, Ordering::Release);
                return Some(next);
            }
            #[cfg(loom)]
            loom::thread::yield_now();
            #[cfg(not(loom))]
            core::hint::spin_loop();
        }
        None
    }

    // ── racy (Relaxed) negative control ───────────────────────────────────

    pub fn racy_push(&self, node: *mut Link<T>) {
        let prev = self.back.swap(node, Ordering::Relaxed);
        unsafe { (*prev).next.store(node, Ordering::Relaxed) };
    }

    pub fn racy_pop(&self, max_spins: usize) -> Option<*mut Link<T>> {
        let front = self.front.load(Ordering::Relaxed);
        for _ in 0..max_spins {
            let next = unsafe { (*front).next.load(Ordering::Relaxed) };
            if !next.is_null() {
                self.front.store(next, Ordering::Relaxed);
                return Some(next);
            }
            #[cfg(loom)]
            loom::thread::yield_now();
            #[cfg(not(loom))]
            core::hint::spin_loop();
        }
        None
    }
}

unsafe impl<T: Send> Send for UnboundedQueue<T> {}
unsafe impl<T: Send> Sync for UnboundedQueue<T> {}

// Re-exports for test files.
pub use core::ptr as core_ptr;
#[cfg(loom)]
pub use loom::sync::Arc as ModelArc;
#[cfg(loom)]
pub use loom::thread as model_thread;
#[cfg(not(loom))]
pub use std::sync::Arc as ModelArc;
#[cfg(not(loom))]
pub use std::thread as model_thread;
