//! Memory for one check: one arena per thread, all freed together.
//!
//! `bun_alloc::Arena` is a mimalloc heap. Its blocks can be freed or resized individually, so a
//! container that's dropped early returns its memory to the heap. Destroying the heap frees every
//! block that's still allocated. Only the thread that created an arena allocates in it. Any thread
//! may read or free a block of any arena.
//!
//! Every allocation made here borrows the `Session`, so the borrow checker proves that the session
//! is dropped last.
//!
//! Data that lives until the check ends is allocated here, and its destructors never run, because
//! the program itself is in an arena (`Arena::alloc`). So nothing reachable from the program owns
//! memory on the regular heap, except values passed to `Session::keep`. Temporary data that a
//! function or a task builds and discards uses std containers on the regular heap.
//!
//! - A container filled by one thread holds `&Arena`: `ArenaVec`, `ArenaHashMap`, `LocalVec`.
//! - A container that several threads append to holds `&Session`, which allocates in the calling
//!   thread's arena: `AppendVec`, `Cells`, `Newest`.
//! - A list that never changes once it's built is a `&[T]` from `Arena::alloc_slice_copy`.

pub use bun_alloc::{Arena, ArenaBox, ArenaVec, ArenaVecExt, transfer_arena, vec_from_iter_in};

use crate::util::{AppendVec, FxBuild};
use bun_threading::Guarded;
use std::alloc::{AllocError, Allocator, Layout};
use std::any::Any;
use std::ptr::NonNull;
use std::sync::OnceLock;
use std::thread::ThreadId;

/// `FxHashMap` in an arena.
pub type ArenaHashMap<'a, K, V> = hashbrown::HashMap<K, V, FxBuild, &'a Arena>;
/// `FxHashSet` in an arena.
pub type ArenaHashSet<'a, K> = hashbrown::HashSet<K, FxBuild, &'a Arena>;

#[inline]
pub fn map_in<K, V>(arena: &Arena) -> ArenaHashMap<'_, K, V> {
    ArenaHashMap::with_hasher_in(FxBuild, arena)
}

#[inline]
pub fn set_in<K>(arena: &Arena) -> ArenaHashSet<'_, K> {
    ArenaHashSet::with_hasher_in(FxBuild, arena)
}

/// Owns the arena of every thread that has allocated for one check.
pub struct Session {
    /// An append-only linked list. Each thread appends its own node, so each arena is created by
    /// the thread that allocates in it.
    first: Link,
    /// Values passed to `keep`.
    kept: AppendVec<Box<dyn Any + Send + Sync>>,
}

type Link = OnceLock<Box<ThreadArena>>;

struct ThreadArena {
    thread: ThreadId,
    arena: Arena,
    next: Link,
}

impl Default for Session {
    fn default() -> Session {
        Session::new()
    }
}

impl Session {
    pub fn new() -> Session {
        Session {
            first: OnceLock::new(),
            kept: AppendVec::new(),
        }
    }

    /// Returns the calling thread's arena, creating it on the thread's first call.
    ///
    /// The lookup is linear in the number of threads, so a task calls this once and stores the result.
    pub fn arena(&self) -> &Arena {
        let thread = std::thread::current().id();
        let mut link = &self.first;
        loop {
            let node = link.get_or_init(|| {
                Box::new(ThreadArena {
                    thread,
                    arena: Arena::new(),
                    next: OnceLock::new(),
                })
            });
            if node.thread == thread {
                return &node.arena;
            }
            link = &node.next;
        }
    }

    /// Returns the bytes in use across all arenas. Call it only while no thread is allocating in them.
    pub fn allocated_bytes(&self) -> usize {
        std::iter::successors(self.first.get(), |node| node.next.get())
            .map(|node| node.arena.allocated_bytes())
            .sum()
    }

    /// Takes ownership of a value that owns memory on the regular heap and drops it with the session.
    /// Use it for values the program refers to, since nothing drops the program.
    pub fn keep<T: Send + Sync + 'static>(&self, value: T) -> &T {
        let at = self.kept.push(Box::new(value));
        let kept: &(dyn Any + Send + Sync) = &**self.kept.get(at);
        kept.downcast_ref().expect("it was boxed as a `T`")
    }

    /// Drops `sessions` in parallel right before the process exits and returns their memory to the OS immediately.
    /// Values passed to `keep` are dropped first, then the arenas are destroyed. Each thread prefers its own arena, and
    /// after destroying it returns the free pages the allocator caches for that thread, which by then include the kept
    /// values' pages. Without this, a single thread unmaps everything at exit, which costs about 70 ms per GB.
    /// `in_parallel(n, f)` must call `f(i)` for every `i < n`, on any number of threads, starting them in ascending order.
    pub fn drop_before_the_process_ends(
        sessions: Vec<Session>,
        in_parallel: impl FnOnce(usize, &(dyn Fn(usize) + Sync)),
    ) {
        /// How many kept values a thread drops at a time.
        const RUN: usize = 256;
        let mut arenas: Vec<Box<ThreadArena>> = Vec::new();
        let mut kept: Vec<Vec<Box<dyn Any + Send + Sync>>> = Vec::new();
        for mut session in sessions {
            let mut next = session.first.take();
            while let Some(mut node) = next {
                next = node.next.take();
                arenas.push(node);
            }
            session.kept.drain(|_, value| match kept.last_mut() {
                Some(run) if run.len() < RUN => run.push(value),
                _ => kept.push(vec![value]),
            });
        }
        // Make mimalloc return freed pages right away instead of caching them for reuse.
        bun_alloc::mimalloc::mi_option_set(bun_alloc::mimalloc::Option::purge_delay, 0);
        let (runs, count) = (kept.len(), kept.len() + arenas.len());
        let (kept, arenas) = (Guarded::new(kept), Guarded::new(arenas));
        in_parallel(count, &|index| {
            if index < runs {
                let run = kept.lock().pop();
                return drop(run);
            }
            let thread = std::thread::current().id();
            let mut left = arenas.lock();
            let own = left.iter().position(|it| it.thread == thread);
            let one = left.swap_remove(own.unwrap_or(0));
            drop(left);
            drop(one);
            if own.is_some() {
                bun_alloc::mimalloc::mi_collect(true);
            }
        });
    }

    /// The number of threads that have an arena.
    #[cfg(all(test, not(miri)))]
    fn thread_count(&self) -> usize {
        std::iter::successors(self.first.get(), |node| node.next.get()).count()
    }
}

impl Drop for Session {
    /// Unlinks the nodes in a loop so the stack depth doesn't depend on the number of threads.
    ///
    /// This can run on any thread, even while the threads that allocated are working for other
    /// sessions, because `mi_heap_destroy` detaches each thread's part of the heap under that
    /// thread's lock (`_mi_heap_detach_theaps`).
    fn drop(&mut self) {
        let mut next = self.first.take();
        while let Some(mut node) = next {
            next = node.next.take();
        }
    }
}

// SAFETY: every method forwards to `&Arena`, which upholds the contract for its own blocks: a block
// is valid until it's freed or the arena is dropped, and the arena is dropped with the session,
// which `&Session` borrows. The thread that frees or resizes a block may not be the one whose arena
// it came from. `&Arena` allows that, because it frees with `mi_free`, which finds a block's heap
// from its address, and it resizes with `mi_heap_realloc_aligned`, which either leaves the block in
// place or copies it to the given heap and calls `mi_free`. `bun_alloc::transfer_arena` relies on
// the same two properties.
unsafe impl Allocator for &Session {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        self.arena().allocate(layout)
    }

    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        self.arena().allocate_zeroed(layout)
    }

    #[inline]
    unsafe fn deallocate(&self, ptr: NonNull<u8>, layout: Layout) {
        // SAFETY: the caller passes a block of this session with its layout.
        unsafe { self.arena().deallocate(ptr, layout) }
    }

    #[inline]
    unsafe fn grow(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: the caller passes a block of this session with its layout.
        unsafe { self.arena().grow(ptr, old, new) }
    }

    #[inline]
    unsafe fn grow_zeroed(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: the caller passes a block of this session with its layout.
        unsafe { self.arena().grow_zeroed(ptr, old, new) }
    }

    #[inline]
    unsafe fn shrink(
        &self,
        ptr: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: the caller passes a block of this session with its layout.
        unsafe { self.arena().shrink(ptr, old, new) }
    }
}

/// Miri can't run mimalloc, which is foreign code.
#[cfg(all(test, not(miri)))]
mod tests {
    use super::*;

    #[test]
    fn a_thread_has_one_arena_and_two_threads_have_two() {
        let session = Session::new();
        assert_eq!(session.thread_count(), 0);
        let own = std::ptr::from_ref(session.arena());
        assert_eq!(own, std::ptr::from_ref(session.arena()));
        assert_eq!(session.thread_count(), 1);
        let other = std::thread::scope(|scope| {
            let spawned = scope.spawn(|| std::ptr::from_ref(session.arena()).addr());
            spawned.join().unwrap()
        });
        assert_ne!(own.addr(), other);
        assert_eq!(session.thread_count(), 2);
    }

    #[test]
    fn threads_that_start_together_each_get_their_own_arena() {
        let session = Session::new();
        let barrier = std::sync::Barrier::new(8);
        let mut arenas: Vec<usize> = std::thread::scope(|scope| {
            let spawned: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        barrier.wait();
                        std::ptr::from_ref(session.arena()).addr()
                    })
                })
                .collect();
            spawned.into_iter().map(|it| it.join().unwrap()).collect()
        });
        arenas.sort_unstable();
        arenas.dedup();
        assert_eq!(arenas.len(), 8);
        assert_eq!(session.thread_count(), 8);
    }

    #[test]
    fn a_slice_outlives_the_thread_that_allocated_it() {
        let session = Session::new();
        let slices: Vec<&[u32]> = std::thread::scope(|scope| {
            let spawned: Vec<_> = (0..4u32)
                .map(|n| {
                    let session = &session;
                    scope.spawn(move || &*session.arena().alloc_slice_copy(&[n, n + 1, n + 2]))
                })
                .collect();
            spawned.into_iter().map(|it| it.join().unwrap()).collect()
        });
        for (n, slice) in slices.iter().enumerate() {
            let n = n as u32;
            assert_eq!(**slice, [n, n + 1, n + 2]);
        }
    }

    #[test]
    fn kept_values_are_dropped_with_the_session() {
        let counted = std::sync::Arc::new(());
        let session = Session::new();
        let lists: Vec<&Vec<std::sync::Arc<()>>> = std::thread::scope(|scope| {
            let spawned: Vec<_> = (1..5)
                .map(|len| {
                    let (session, counted) = (&session, &counted);
                    scope.spawn(move || session.keep(vec![std::sync::Arc::clone(counted); len]))
                })
                .collect();
            spawned.into_iter().map(|it| it.join().unwrap()).collect()
        });
        assert_eq!(*session.keep(7u32), 7);
        assert!(lists.iter().map(|list| list.len()).eq(1..5));
        assert_eq!(std::sync::Arc::strong_count(&counted), 1 + 1 + 2 + 3 + 4);
        drop(session);
        assert_eq!(std::sync::Arc::strong_count(&counted), 1);
    }

    #[test]
    fn threads_drop_sessions_before_the_process_ends() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let counted = std::sync::Arc::new(());
        let sessions: Vec<Session> = (0..2).map(|_| Session::new()).collect();
        std::thread::scope(|scope| {
            for session in sessions.iter().cycle().take(6) {
                let counted = &counted;
                scope.spawn(move || {
                    for n in 0..200u32 {
                        let kept = session.keep(vec![std::sync::Arc::clone(counted); 2]);
                        assert_eq!(kept.len(), 2);
                        assert_eq!(*session.arena().alloc_slice_copy(&[n; 100]), [n; 100]);
                    }
                });
            }
        });
        assert_eq!(std::sync::Arc::strong_count(&counted), 1 + 6 * 200 * 2);
        let (next, done) = (AtomicUsize::new(0), AtomicUsize::new(0));
        Session::drop_before_the_process_ends(sessions, |count, work| {
            std::thread::scope(|scope| {
                for _ in 0..3 {
                    scope.spawn(|| {
                        while next.fetch_add(1, Ordering::Relaxed) < count {
                            work(done.fetch_add(1, Ordering::Relaxed));
                        }
                    });
                }
            });
            assert_eq!(done.load(Ordering::Relaxed), count);
        });
        assert_eq!(std::sync::Arc::strong_count(&counted), 1);
    }

    #[test]
    fn vector_grows_on_a_different_thread() {
        let session = Session::new();
        let mut list: Vec<u32, &Session> = Vec::new_in(&session);
        list.extend(0..100);
        std::thread::scope(|scope| {
            scope.spawn(|| list.extend(100..10_000));
        });
        assert!(list.iter().copied().eq(0..10_000));
        assert_eq!(session.thread_count(), 2);
    }

    #[test]
    fn block_is_freed_on_a_different_thread() {
        let session = Session::new();
        let mut list = ArenaVec::new_in(session.arena());
        list.extend(0..1_000u32);
        std::thread::scope(|scope| {
            scope.spawn(move || drop(list));
        });
    }

    #[test]
    fn zeroed_memory_is_zero() {
        let session = Session::new();
        let layout = Layout::array::<u64>(1 << 12).unwrap();
        let block = (&session).allocate_zeroed(layout).unwrap();
        // SAFETY: the block was allocated with this length and is zero-initialized.
        let bytes = unsafe { block.as_ref() };
        assert!(bytes.len() >= layout.size());
        assert!(bytes.iter().all(|&byte| byte == 0));
        // SAFETY: allocated above with this layout.
        unsafe { (&session).deallocate(block.cast(), layout) };
    }

    #[test]
    fn a_map_and_a_set_grow_in_an_arena() {
        let session = Session::new();
        let mut squares = map_in(session.arena());
        let mut even = set_in(session.arena());
        for n in 0..1_000u32 {
            squares.insert(n, n * n);
            if n % 2 == 0 {
                even.insert(n);
            }
        }
        assert_eq!(squares.len(), 1_000);
        assert_eq!(squares[&31], 961);
        assert_eq!(even.len(), 500);
        assert!(!even.contains(&7));
    }

    #[test]
    fn a_vector_that_was_shrunk_keeps_its_elements_and_grows_again() {
        let session = Session::new();
        for len in [0u32, 1, 3, 4, 5, 1_000] {
            let mut vector = ArenaVec::with_capacity_in(len as usize + 9, session.arena());
            vector.extend(0..len);
            vector.shrink_to_fit();
            assert_eq!(vector.capacity(), len as usize);
            assert!(vector.iter().copied().eq(0..len));
            vector.push(len);
            assert!(vector.iter().copied().eq(0..=len));
        }
    }

    #[test]
    fn a_box_made_from_a_vector_owns_its_elements() {
        let session = Session::new();
        let counted = std::rc::Rc::new(());
        for len in [0usize, 1, 2, 7, 300] {
            let mut vector = ArenaVec::with_capacity_in(len + 5, session.arena());
            vector.extend(std::iter::repeat_n(&counted, len).cloned());
            let boxed: ArenaBox<[std::rc::Rc<()>]> = vector.into();
            assert_eq!(boxed.len(), len);
            assert_eq!(std::rc::Rc::strong_count(&counted), len + 1);
            drop(boxed);
            assert_eq!(std::rc::Rc::strong_count(&counted), 1);
        }
    }
}
