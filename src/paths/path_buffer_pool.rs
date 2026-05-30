//! This pool exists because on Windows, each path buffer costs 64 KB.
//! This makes the stack memory usage very unpredictable, which means we can't
//! really know how much stack space we have left. This pool is a workaround to
//! make the stack memory usage more predictable.
//!
//! The pool is a process-global, lock-free Treiber stack of heap buffers. It
//! is bounded to `get_thread_count() * 2` cached buffers per process; a `put`
//! that would exceed the bound frees the buffer instead of pushing it. This
//! replaces the previous `thread_local!` + `RefCell<Vec<Box<T>>>` design (cap
//! 4 *per thread*), which grew memory with the thread count and re-allocated
//! every time work migrated between threads.
//!
//! ## Why it is race-free
//!
//! Both the root pointer and a single "popping" flag bit live in one
//! `AtomicUsize` (the node's ≥8-byte alignment leaves the low bits free), so
//! the stack word is mutated atomically:
//!
//! - `put` (push) is a standard lock-free CAS loop that only ever swings the
//!   root at its own, caller-owned node. It never frees a node that is in the
//!   list (the over-capacity path frees the node it is *holding*, which was
//!   never linked), and it never dereferences another thread's node.
//! - `get` (pop) first CAS-acquires the `IS_POPPING` bit. That bit makes the
//!   pop single-consumer: while it is held, no other `get` touches the list,
//!   and `put` never frees, so dereferencing `head.next` can never be a
//!   use-after-free. A `get` that finds the bit already held (or the list
//!   empty) does not block — it allocates a fresh buffer. Releasing the bit
//!   and unlinking the head happen in the same CAS, which retries if a
//!   concurrent `put` pushed in the meantime.
//!
//! This mirrors how `bun_threading::ThreadPool`'s lock-free queue stays
//! ABA-safe via single-consumer exclusion rather than tagged/versioned
//! pointers (the workspace has no double-width CAS or hazard-pointer
//! machinery). The RAII `PoolGuard` returned by `get()` returns its buffer to
//! the pool on `Drop`.

use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{PathBuffer, WPathBuffer};

/// A pooled buffer plus its intrusive stack link. Heap-allocated; the `next`
/// link is only mutated by the thread that owns the node (a pusher before it
/// publishes the node, or the single popper holding `IS_POPPING`).
///
/// Only reachable through the sealed [`PoolStorage`]; fields are private and it
/// is not meant to be named directly.
pub struct Node<T> {
    next: *mut Node<T>,
    buf: T,
}

/// `IS_POPPING` guards the pop path so only one `get` dereferences list nodes
/// at a time; `PTR_MASK` recovers the head pointer. The node's alignment (≥ 8,
/// it leads with a pointer) guarantees the low bit is always free.
const IS_POPPING: usize = 0b1;
const PTR_MASK: usize = !IS_POPPING;

/// Process-global lock-free stack of reusable buffers, bounded by `cap`.
///
/// Only reachable through the sealed [`PoolStorage::pool`]; not meant to be
/// named directly.
pub struct Pool<T> {
    /// Packed `head_ptr | IS_POPPING`.
    stack: AtomicUsize,
    /// Approximate count of buffers currently cached. Bounds the list length;
    /// may transiently overshoot `cap` by the number of concurrent `put`s (each
    /// of which then frees its node), but can never grow without bound.
    len: AtomicUsize,
    _marker: PhantomData<fn() -> T>,
}

impl<T> Pool<T> {
    const fn new() -> Self {
        Self {
            stack: AtomicUsize::new(0),
            len: AtomicUsize::new(0),
            _marker: PhantomData,
        }
    }

    /// `cpu_count * 2`, matching the existing per-process multiplier used by
    /// the install network pool. `get_thread_count()` is the repo-standard
    /// core count (clamped `[2, 1024]`); there is no NUMA-node count in the
    /// tree, so "numa threads" maps to the logical core count.
    #[inline]
    fn cap() -> usize {
        usize::from(bun_core::get_thread_count()) * 2
    }

    /// Pop a node off the stack, or return null if empty or if another `get`
    /// currently holds `IS_POPPING`. A null return means the caller allocates a
    /// fresh buffer — the pool never blocks a `get`.
    fn pop(&self) -> *mut Node<T> {
        let mut stack = self.stack.load(Ordering::Acquire);
        loop {
            if stack & IS_POPPING != 0 {
                // Another thread is popping; don't block — caller allocates.
                return ptr::null_mut();
            }
            let head = ptr::with_exposed_provenance_mut::<Node<T>>(stack & PTR_MASK);
            if head.is_null() {
                return ptr::null_mut();
            }
            // Claim the pop by setting IS_POPPING while keeping the head, so no
            // other popper can observe a non-null head concurrently.
            match self.stack.compare_exchange_weak(
                stack,
                stack | IS_POPPING,
                Ordering::Acquire,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    // The atomic now holds `stack | IS_POPPING`; track that in
                    // the local so the unlink CAS below matches on its first
                    // try instead of eating a guaranteed failed CAS.
                    stack |= IS_POPPING;
                    break;
                }
                Err(cur) => stack = cur,
            }
        }

        // We hold IS_POPPING: `head` is ours exclusively (no other popper) and
        // `put` never frees a linked node, so reading `head.next` is sound.
        loop {
            let head = ptr::with_exposed_provenance_mut::<Node<T>>(stack & PTR_MASK);
            // SAFETY: we hold IS_POPPING, so `head` cannot be concurrently
            // popped or freed; it is a live node we just observed in `stack`.
            let next = unsafe { (*head).next };
            // Release IS_POPPING and unlink `head` in one step. A concurrent
            // `put` may have pushed a new head (changing the pointer but not
            // the bit we own); retry against the updated value.
            match self.stack.compare_exchange_weak(
                stack,
                next.expose_provenance() & PTR_MASK,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    self.len.fetch_sub(1, Ordering::Relaxed);
                    // SAFETY: `head` is unlinked and exclusively ours now.
                    unsafe { (*head).next = ptr::null_mut() };
                    return head;
                }
                Err(cur) => stack = cur,
            }
        }
    }

    /// Push `node` onto the stack, or free it if the pool is at capacity.
    #[inline]
    fn push(&self, node: *mut Node<T>) {
        self.push_with_cap(node, Self::cap());
    }

    /// `push`, with the capacity passed in. Split out so tests can exercise the
    /// over-capacity freeing path with a small, fixed cap without reaching
    /// `Self::cap()` → `get_thread_count()` (which calls a C function Miri
    /// cannot execute).
    fn push_with_cap(&self, node: *mut Node<T>, cap: usize) {
        // Reserve a slot first so the list length stays bounded. If we are at
        // (or over) capacity, free the node rather than linking it.
        if self.len.fetch_add(1, Ordering::Relaxed) >= cap {
            self.len.fetch_sub(1, Ordering::Relaxed);
            // SAFETY: `node` is caller-owned (just handed back, never linked).
            unsafe { drop(Box::from_raw(node)) };
            return;
        }

        let mut stack = self.stack.load(Ordering::Relaxed);
        loop {
            // SAFETY: `node` is caller-owned and not yet published; writing its
            // `next` before the CAS that publishes it is unobserved by others.
            unsafe { (*node).next = ptr::with_exposed_provenance_mut::<Node<T>>(stack & PTR_MASK) };
            // Publish `node` as the new head, preserving the popper's bit.
            let new_stack = node.expose_provenance() | (stack & IS_POPPING);
            match self.stack.compare_exchange_weak(
                stack,
                new_stack,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(cur) => stack = cur,
            }
        }
    }
}

// `Pool<T>` holds only `AtomicUsize`s and a `PhantomData<fn() -> T>`, so it is
// `Send + Sync` automatically. The node pointers it tracks are encoded as
// integers in `stack`; the lock-free access discipline that makes
// dereferencing them sound lives in `pop`/`push` (see their SAFETY comments):
// every `Node` access happens either before the node is published
// (pusher-owned) or while the accessor holds `IS_POPPING` (popper-owned), so a
// `*mut Node` is never aliased across threads.

static U8_POOL: Pool<PathBuffer> = Pool::new();
static U16_POOL: Pool<WPathBuffer> = Pool::new();

/// Types that have a process-global [`Pool`] (`PathBuffer` / `WPathBuffer`).
///
/// Sealed via the private [`Sealed`] supertrait: only `PathBuffer` and
/// `WPathBuffer` implement it. It is a bound on the public [`PoolGuard`], but
/// external crates cannot implement it or observe `pool()`.
pub trait PoolStorage: Sealed + Sized + Default + 'static {
    #[doc(hidden)]
    fn pool() -> &'static Pool<Self>;
    /// Allocate a fresh node directly on the heap (no stack temporary). The
    /// buffer is write-only scratch — callers write every byte they later read
    /// — so the bytes are left zeroed rather than memset'd in a hot loop.
    ///
    /// Implemented per concrete type so the `assume_init` SAFETY obligation is
    /// discharged monomorphically: the generic site cannot assert "all-zero is
    /// a valid bit-pattern" for an arbitrary `T`, but it is for `[u8; N]` /
    /// `[u16; N]` (and a null `next` pointer). Allocating via `new_zeroed`
    /// keeps the ~64 KB (Windows: ~96 KB) buffer off the stack — the whole
    /// reason this pool exists (see the module docs).
    #[doc(hidden)]
    fn new_node() -> *mut Node<Self>;
}
impl PoolStorage for PathBuffer {
    #[inline]
    fn pool() -> &'static Pool<Self> {
        &U8_POOL
    }
    #[inline]
    fn new_node() -> *mut Node<Self> {
        // SAFETY: `Node<PathBuffer>` is `{ *mut Node, [u8; N] }`; all-zero is a
        // valid value (null `next`, zeroed `u8` buffer), so the box is fully
        // initialized before `assume_init`. `alloc_zeroed` for a large block is
        // typically served by fresh OS-zeroed pages, so there is no real
        // memset cost on this (cache-miss-only) path.
        Box::into_raw(unsafe { Box::<Node<Self>>::new_zeroed().assume_init() })
    }
}
impl PoolStorage for WPathBuffer {
    #[inline]
    fn pool() -> &'static Pool<Self> {
        &U16_POOL
    }
    #[inline]
    fn new_node() -> *mut Node<Self> {
        // SAFETY: `Node<WPathBuffer>` is `{ *mut Node, [u16; N] }`; all-zero is
        // a valid value (null `next`, zeroed `u16` buffer). See the `PathBuffer`
        // impl for the `new_zeroed`/perf rationale.
        Box::into_raw(unsafe { Box::<Node<Self>>::new_zeroed().assume_init() })
    }
}

mod private {
    pub trait Sealed {}
    impl Sealed for super::PathBuffer {}
    impl Sealed for super::WPathBuffer {}
}
use private::Sealed;

/// Process-global pool of reusable path buffers.
pub struct PathBufferPoolT<T: PoolStorage>(PhantomData<T>);

impl<T: PoolStorage> PathBufferPoolT<T> {
    /// Returns an RAII guard that derefs to `&mut T` and returns the buffer to
    /// the pool on `Drop`. Replaces manual `get`/`put` pairing.
    pub fn get() -> PoolGuard<T> {
        let mut node = T::pool().pop();
        if node.is_null() {
            // Cache miss (empty or contended): allocate a fresh node directly
            // on the heap (`new_node` avoids materializing the ~64 KB buffer on
            // the stack).
            node = T::new_node();
        }
        PoolGuard {
            node,
            _marker: PhantomData,
        }
    }
}

/// RAII guard returned by `PathBufferPoolT::get()`. Returns its buffer to the
/// pool (or frees it, if the pool is at capacity) on `Drop`.
pub struct PoolGuard<T: PoolStorage> {
    /// Always non-null for the guard's lifetime.
    node: *mut Node<T>,
    _marker: PhantomData<Box<Node<T>>>,
}

// SAFETY: the guard owns its node exclusively for its lifetime (it is unlinked
// from the shared stack in `pop`/freshly allocated in `get`), so it may move
// between threads like any `Box`.
unsafe impl<T: PoolStorage> Send for PoolGuard<T> {}

impl<T: PoolStorage> Deref for PoolGuard<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: `node` is non-null and exclusively owned until `Drop`.
        unsafe { &(*self.node).buf }
    }
}

impl<T: PoolStorage> DerefMut for PoolGuard<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: `node` is non-null and exclusively owned until `Drop`.
        unsafe { &mut (*self.node).buf }
    }
}

impl<T: PoolStorage> Drop for PoolGuard<T> {
    fn drop(&mut self) {
        // Return the node to the pool (push), which frees it if at capacity.
        T::pool().push(self.node);
    }
}

#[allow(non_camel_case_types)]
pub type path_buffer_pool = PathBufferPoolT<PathBuffer>;
#[allow(non_camel_case_types)]
pub type w_path_buffer_pool = PathBufferPoolT<WPathBuffer>;

/// `bun.path_buffer_pool.get()` — convenience wrapper returning the RAII guard.
pub type Guard = PoolGuard<PathBuffer>;
#[inline]
pub fn get() -> PoolGuard<PathBuffer> {
    PathBufferPoolT::<PathBuffer>::get()
}

#[cfg(windows)]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = w_path_buffer_pool;
#[cfg(not(windows))]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = path_buffer_pool;

#[cfg(test)]
mod tests {
    //! Exercises the lock-free [`Pool`] on *local* instances (isolated from the
    //! process-global `U8_POOL`/`U16_POOL` and from each other). These run under
    //! `cargo miri test -p bun_paths` (the repo's only Rust-test runner, wired
    //! into CI via `bun run rust:miri`), so they avoid calling `Self::cap()` →
    //! `get_thread_count()` — that reaches a C function Miri cannot execute —
    //! by going through `push_with_cap` with a fixed cap. Every node allocated
    //! is freed before the test returns so Miri reports no leak.

    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    impl<T> Pool<T> {
        fn cached_len(&self) -> usize {
            self.len.load(Ordering::Relaxed)
        }
        /// Pop, or allocate a fresh node on miss — the fallback
        /// `PathBufferPoolT::get` uses. Returns an owned node pointer.
        fn get_or_alloc(&self) -> *mut Node<T>
        where
            T: PoolStorage,
        {
            let node = self.pop();
            if node.is_null() { T::new_node() } else { node }
        }
        /// Free every cached node (test cleanup).
        fn drain(&self) {
            loop {
                let node = self.pop();
                if node.is_null() {
                    break;
                }
                // SAFETY: `pop` returns an unlinked, owned node.
                unsafe { drop(Box::from_raw(node)) };
            }
        }
    }

    /// A node popped right after being pushed is the same allocation, and its
    /// buffer contents survive the round-trip — the pool reuses buffers rather
    /// than reallocating.
    #[test]
    fn reuses_pushed_buffer() {
        let pool = Pool::<PathBuffer>::new();
        let node = PathBuffer::new_node();
        // SAFETY: freshly allocated, exclusively owned node.
        unsafe { (*node).buf.0[0] = 42 };
        let addr = node.addr();
        pool.push_with_cap(node, 4);

        let node2 = pool.pop();
        assert_eq!(node2.addr(), addr, "pushed buffer should be reused");
        // SAFETY: exclusively owned; the byte written before the push is intact.
        unsafe { assert_eq!((*node2).buf.0[0], 42) };
        // SAFETY: `node2` is unlinked and owned.
        unsafe { drop(Box::from_raw(node2)) };
        assert_eq!(pool.cached_len(), 0);
    }

    /// Pushes beyond `cap` free the node instead of growing the list, and the
    /// list holds exactly `cap` distinct nodes afterward.
    #[test]
    fn over_capacity_frees() {
        const CAP: usize = 3;
        let pool = Pool::<PathBuffer>::new();
        // Acquire 4x cap distinct nodes, then return them all.
        let nodes: Vec<*mut Node<PathBuffer>> =
            (0..CAP * 4).map(|_| PathBuffer::new_node()).collect();
        for n in nodes {
            pool.push_with_cap(n, CAP);
        }
        assert_eq!(pool.cached_len(), CAP, "list must be capped at {CAP}");

        // Exactly CAP nodes can be popped, all distinct, then the list is empty.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..CAP {
            let n = pool.pop();
            assert!(!n.is_null());
            assert!(seen.insert(n.addr()), "pop returned a duplicate node");
            // SAFETY: `pop` hands back an unlinked, owned node.
            unsafe { drop(Box::from_raw(n)) };
        }
        assert!(pool.pop().is_null(), "list should be empty after CAP pops");
        assert_eq!(pool.cached_len(), 0);
    }

    /// Two threads hammer the stack concurrently. Under Miri (tree-borrows) this
    /// surfaces any data race or provenance/aliasing violation in `pop`/`push`.
    /// Each thread stamps a thread-unique byte into a node it exclusively holds
    /// and reads it back, catching a node handed to both threads at once.
    /// Iteration counts are deliberately small — Miri is ~2 orders of magnitude
    /// slower than native.
    #[test]
    fn concurrent_pop_push_no_race() {
        const THREADS: u8 = 2;
        const ITERS: usize = 30;
        const CAP: usize = 4;
        let pool = Arc::new(Pool::<PathBuffer>::new());
        let start = Arc::new(AtomicBool::new(false));

        let handles: Vec<_> = (0..THREADS)
            .map(|t| {
                let pool = Arc::clone(&pool);
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    while !start.load(Ordering::Acquire) {
                        std::hint::spin_loop();
                    }
                    let tag = t.wrapping_add(1);
                    for _ in 0..ITERS {
                        let a = pool.get_or_alloc();
                        let b = pool.get_or_alloc();
                        // SAFETY: `a`/`b` are distinct, exclusively-owned nodes.
                        unsafe {
                            (*a).buf.0[0] = tag;
                            (*b).buf.0[0] = tag;
                            assert_eq!((*a).buf.0[0], tag);
                            assert_eq!((*b).buf.0[0], tag);
                        }
                        pool.push_with_cap(b, CAP);
                        pool.push_with_cap(a, CAP);
                    }
                })
            })
            .collect();

        start.store(true, Ordering::Release);
        for h in handles {
            h.join().unwrap();
        }
        assert!(pool.cached_len() <= CAP);
        pool.drain();
    }
}
