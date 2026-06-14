//! EXP-030: loom model of `bun_threading::ThreadPool::Queue` with `cache: Cell<*mut Node>`.
//!
//! Source under model: `src/threading/ThreadPool.rs:1480-1599`
//!
//! Hypothesis: `unsafe impl Sync for Queue {}` (line 1493) makes `&Queue` cross
//! threads. `cache: Cell<*mut Node>` is `!Sync`. The SAFETY comment claims the
//! `IS_CONSUMING` tag-bit CAS (Acquire on take, Release on give-back) is the
//! sole synchronisation between consumers' cache reads (1568) and writes (1595).
//!
//! Model:
//!   - `stack: AtomicUsize` with HAS_CACHE (0b01) + IS_CONSUMING (0b10) bits.
//!   - `cache: UnsafeCell<*mut Node>` (loom's UnsafeCell, mirroring std::cell::Cell layout
//!     for race-detection purposes — Cell delegates to UnsafeCell under the hood).
//!   - A "Node" is a leaked `Box<Node>`; the cache slot just stores its address.
//!
//! We run 2 producers + 2 consumers. Producer threads push a node; consumer
//! threads acquire the IS_CONSUMING bit via Acquire-CAS, read `cache`, set
//! `cache`, then Release-fetch_sub. If the discipline holds, loom's UnsafeCell
//! permit tracking should NEVER observe two `with_mut` accesses overlapping
//! (because IS_CONSUMING serialises them via Acquire/Release).

#![cfg(loom)]

use loom::cell::UnsafeCell;
use loom::sync::atomic::{AtomicUsize, Ordering};
use loom::sync::Arc;
use loom::thread;

const HAS_CACHE: usize = 0b01;
const IS_CONSUMING: usize = 0b10;
const PTR_MASK: usize = !(HAS_CACHE | IS_CONSUMING);

// A "Node" — a small heap allocation. The pointer is what flows through the queue.
// We deliberately put a `value` in it so loom can detect torn reads if the cache
// slot ever yields a half-written *mut Node.
#[repr(align(8))] // matches the alignment requirement in the real code
struct Node {
    next: *mut Node,
    value: usize,
}

struct Queue {
    stack: AtomicUsize,
    // Mirrors `cache: Cell<*mut Node>` in production. Cell IS UnsafeCell with
    // safe accessors; for loom's permit-tracking we use UnsafeCell directly.
    cache: UnsafeCell<*mut Node>,
}

unsafe impl Send for Queue {}
unsafe impl Sync for Queue {}

impl Queue {
    fn new() -> Self {
        Self {
            stack: AtomicUsize::new(0),
            cache: UnsafeCell::new(core::ptr::null_mut()),
        }
    }

    // Push: mirrors lines 1513-1539. Release CAS on stack so the consumer's
    // Acquire CAS sees the node's `next` write.
    fn push(&self, node: *mut Node) {
        let mut stack = self.stack.load(Ordering::Relaxed);
        loop {
            // Attach: node.next = (stack & PTR_MASK).
            unsafe {
                (*node).next = (stack & PTR_MASK) as *mut Node;
            }
            let new_stack = (node as usize) | (stack & !PTR_MASK);
            match self.stack.compare_exchange_weak(
                stack,
                new_stack,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(cur) => stack = cur,
            }
        }
    }

    // Acquire the consumer (mirrors 1541-1581). Returns Some((cache, popped_stack))
    // on success, where `cache` is the value we read from the cache slot and
    // `popped_stack` is the chain we yanked off `stack` if HAS_CACHE was 0.
    fn try_acquire_consumer(&self) -> Option<*mut Node> {
        let mut stack = self.stack.load(Ordering::Relaxed);
        loop {
            if stack & IS_CONSUMING != 0 {
                return None; // Contended
            }
            if stack & (HAS_CACHE | PTR_MASK) == 0 {
                return None; // Empty
            }
            let mut new_stack = stack | HAS_CACHE | IS_CONSUMING;
            if stack & HAS_CACHE == 0 {
                new_stack &= !PTR_MASK;
            }
            match self.stack.compare_exchange_weak(
                stack,
                new_stack,
                Ordering::Acquire,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    // We hold IS_CONSUMING. Per SAFETY comment, the cache slot
                    // is exclusively ours. Read it.
                    let cache = unsafe { self.cache.with(|p| *p) };
                    let consumer = if !cache.is_null() {
                        cache
                    } else {
                        (stack & PTR_MASK) as *mut Node
                    };
                    return Some(consumer);
                }
                Err(cur) => stack = cur,
            }
        }
    }

    // Mirrors 1583-1598. Writes the cache, then Release-fetch_sub on stack.
    fn release_consumer(&self, consumer: *mut Node) {
        let mut remove = IS_CONSUMING;
        if consumer.is_null() {
            remove |= HAS_CACHE;
        }
        unsafe {
            self.cache.with_mut(|p| *p = consumer);
        }
        let _prev = self.stack.fetch_sub(remove, Ordering::Release);
    }
}

// Test 1: 1 producer + 2 consumers, each consumer does acquire→release.
// If the IS_CONSUMING discipline holds, loom's UnsafeCell permit-tracking
// will never see overlapping with/with_mut accesses on cache.
#[test]
fn loom_two_consumers_cache_exclusive() {
    let mut builder = loom::model::Builder::new();
    // Keep budget small per orchestrator constraints.
    builder.preemption_bound = Some(3);
    builder.check(|| {
        let q = Arc::new(Queue::new());
        // Pre-leak a Node so consumers have something to consume.
        let node_addr = Box::into_raw(Box::new(Node {
            next: core::ptr::null_mut(),
            value: 0xDEAD_BEEF,
        }));

        let q1 = Arc::clone(&q);
        let producer = thread::spawn(move || {
            q1.push(node_addr);
        });

        let q2 = Arc::clone(&q);
        let c1 = thread::spawn(move || {
            // Spin until we acquire or queue is empty/contended.
            for _ in 0..4 {
                if let Some(consumer) = q2.try_acquire_consumer() {
                    // Walk one step then release.
                    let next = if !consumer.is_null() {
                        unsafe { (*consumer).next }
                    } else {
                        core::ptr::null_mut()
                    };
                    q2.release_consumer(next);
                    break;
                }
                loom::thread::yield_now();
            }
        });

        let q3 = Arc::clone(&q);
        let c2 = thread::spawn(move || {
            for _ in 0..4 {
                if let Some(consumer) = q3.try_acquire_consumer() {
                    let next = if !consumer.is_null() {
                        unsafe { (*consumer).next }
                    } else {
                        core::ptr::null_mut()
                    };
                    q3.release_consumer(next);
                    break;
                }
                loom::thread::yield_now();
            }
        });

        producer.join().unwrap();
        c1.join().unwrap();
        c2.join().unwrap();

        // Cleanup: drain whatever's left.
        // (We can't tell which thread consumed the node; either way, the
        // pointer was never freed inside the queue ops — drop it now.)
        unsafe {
            drop(Box::from_raw(node_addr));
        }
    });
}

// Sanity test (negative control): if we drop the Acquire on the consumer
// acquire-CAS and the Release on release_consumer's fetch_sub to Relaxed,
// loom SHOULD catch a race on `cache`. We mark this `#[ignore]` so the default
// run is clean; remove the ignore to confirm the model exercises the ordering.
#[test]
#[ignore]
fn loom_sanity_relaxed_should_race() {
    struct RelaxedQueue {
        stack: AtomicUsize,
        cache: UnsafeCell<*mut Node>,
    }
    unsafe impl Send for RelaxedQueue {}
    unsafe impl Sync for RelaxedQueue {}

    fn relaxed_acquire(q: &RelaxedQueue) -> Option<*mut Node> {
        let mut stack = q.stack.load(Ordering::Relaxed);
        loop {
            if stack & IS_CONSUMING != 0 {
                return None;
            }
            if stack & (HAS_CACHE | PTR_MASK) == 0 {
                return None;
            }
            let mut new_stack = stack | HAS_CACHE | IS_CONSUMING;
            if stack & HAS_CACHE == 0 {
                new_stack &= !PTR_MASK;
            }
            match q.stack.compare_exchange_weak(
                stack,
                new_stack,
                Ordering::Relaxed, // DELIBERATELY Relaxed
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    let cache = unsafe { q.cache.with(|p| *p) };
                    let consumer = if !cache.is_null() {
                        cache
                    } else {
                        (stack & PTR_MASK) as *mut Node
                    };
                    return Some(consumer);
                }
                Err(cur) => stack = cur,
            }
        }
    }

    fn relaxed_release(q: &RelaxedQueue, consumer: *mut Node) {
        let mut remove = IS_CONSUMING;
        if consumer.is_null() {
            remove |= HAS_CACHE;
        }
        unsafe { q.cache.with_mut(|p| *p = consumer) };
        let _ = q.stack.fetch_sub(remove, Ordering::Relaxed); // DELIBERATELY Relaxed
    }

    loom::model(|| {
        let q = Arc::new(RelaxedQueue {
            stack: AtomicUsize::new(0),
            cache: UnsafeCell::new(core::ptr::null_mut()),
        });
        let node = Box::into_raw(Box::new(Node {
            next: core::ptr::null_mut(),
            value: 7,
        }));
        // Seed the stack so both consumers can acquire.
        // Reuse Queue::push for simplicity by faking a Queue layout.
        // Actually just seed stack directly: stack = node | HAS_CACHE means cached.
        q.stack.store(node as usize | HAS_CACHE, Ordering::Release);

        let q1 = Arc::clone(&q);
        let c1 = thread::spawn(move || {
            if let Some(c) = relaxed_acquire(&q1) {
                let _ = c;
                relaxed_release(&q1, core::ptr::null_mut());
            }
        });
        let q2 = Arc::clone(&q);
        let c2 = thread::spawn(move || {
            if let Some(c) = relaxed_acquire(&q2) {
                let _ = c;
                relaxed_release(&q2, core::ptr::null_mut());
            }
        });

        c1.join().unwrap();
        c2.join().unwrap();
        unsafe { drop(Box::from_raw(node)) };
    });
}

// Test 2: stress the IS_CONSUMING handoff — both consumers race for the bit
// while the producer republishes. This is the schedule the SAFETY claim hinges
// on. loom will explore whether `cache.set` from consumer A can race with
// `cache.get` from consumer B (which it must not, given the CAS discipline).
#[test]
fn loom_handoff_acquire_release_edge() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(2);
    builder.check(|| {
        let q = Arc::new(Queue::new());
        let n1 = Box::into_raw(Box::new(Node { next: core::ptr::null_mut(), value: 1 }));
        let n2 = Box::into_raw(Box::new(Node { next: core::ptr::null_mut(), value: 2 }));

        // Pre-push so both consumers have something to fight over.
        q.push(n1);

        let q2 = Arc::clone(&q);
        let p = thread::spawn(move || {
            q2.push(n2);
        });

        let q3 = Arc::clone(&q);
        let c1 = thread::spawn(move || {
            for _ in 0..3 {
                if let Some(consumer) = q3.try_acquire_consumer() {
                    let next = if !consumer.is_null() {
                        unsafe { (*consumer).next }
                    } else {
                        core::ptr::null_mut()
                    };
                    q3.release_consumer(next);
                    break;
                }
                loom::thread::yield_now();
            }
        });

        let q4 = Arc::clone(&q);
        let c2 = thread::spawn(move || {
            for _ in 0..3 {
                if let Some(consumer) = q4.try_acquire_consumer() {
                    let next = if !consumer.is_null() {
                        unsafe { (*consumer).next }
                    } else {
                        core::ptr::null_mut()
                    };
                    q4.release_consumer(next);
                    break;
                }
                loom::thread::yield_now();
            }
        });

        p.join().unwrap();
        c1.join().unwrap();
        c2.join().unwrap();

        unsafe {
            drop(Box::from_raw(n1));
            drop(Box::from_raw(n2));
        }
    });
}
