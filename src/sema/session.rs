//! The memory of one check: one arena per thread, all freed together.
//!
//! `bun_alloc::Arena` is a mimalloc heap. A block in it can be freed or resized on its own, so a
//! container that is dropped early returns its memory to the heap. Destroying the heap frees every
//! block that is still allocated. Only the thread that created an arena allocates in it. Any thread
//! may read or free a block of any arena.
//!
//! Everything that is allocated here borrows the `Session`, so the borrow checker proves that the
//! session is dropped last.
//!
//! What lives until the check ends is here, and no destructor runs for it: the program is itself in
//! an arena (`Arena::alloc`). So nothing that is reachable from the program owns memory on the
//! regular heap, except what `Session::keep` has taken over. What a function or a task builds and
//! throws away is on the regular heap, in std containers.
//!
//! - A container that one thread fills holds `&Arena`: `ArenaVec`, `ArenaHashMap`, `LocalVec`.
//! - A container that several threads add to holds `&Session`, which allocates in the arena of the
//!   calling thread: `AppendVec`, `Cells`, `Newest`.
//! - A list that never changes after it is built is `&[T]`, from `Arena::alloc_slice_copy`.

pub use bun_alloc::{Arena, ArenaBox, ArenaVec, ArenaVecExt, transfer_arena, vec_from_iter_in};

use crate::util::FxBuild;
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
    ArenaHashMap::with_hasher_in(FxBuild::default(), arena)
}

#[inline]
pub fn set_in<K>(arena: &Arena) -> ArenaHashSet<'_, K> {
    ArenaHashSet::with_hasher_in(FxBuild::default(), arena)
}

/// Owns the arena of every thread that has allocated for one check.
#[derive(Default)]
pub struct Session {
    /// A linked list that only grows. A thread appends its own node, so each arena is created by
    /// the thread that allocates in it.
    first: Link,
    /// What `keep` was given. A linked list that only grows.
    kept: KeptLink,
}

type Link = OnceLock<Box<ThreadArena>>;
type KeptLink = OnceLock<Box<Kept>>;

struct Kept {
    value: Box<dyn Any + Send + Sync>,
    next: KeptLink,
}

struct ThreadArena {
    thread: ThreadId,
    arena: Arena,
    next: Link,
}

impl Session {
    pub const fn new() -> Session {
        Session {
            first: OnceLock::new(),
            kept: OnceLock::new(),
        }
    }

    /// The arena of the calling thread. The first call from a thread creates it.
    ///
    /// The search is linear in the number of threads. A task calls it once and stores the result.
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

    /// Takes over a value that owns memory on the regular heap, and drops it with the session. For
    /// what the program refers to, since nothing drops the program.
    ///
    /// The search is linear in the number of values: for a few per check, not one per file.
    pub fn keep<T: Send + Sync + 'static>(&self, value: T) -> &T {
        let mut node = Box::new(Kept {
            value: Box::new(value),
            next: OnceLock::new(),
        });
        let mut link = &self.kept;
        while let Err(refused) = link.set(node) {
            node = refused;
            link = &link.get().expect("`set` found a value").next;
        }
        let kept = link.get().expect("set above");
        kept.value.downcast_ref().expect("it was boxed as a `T`")
    }

    /// The number of threads that have an arena.
    pub fn thread_count(&self) -> usize {
        std::iter::successors(self.first.get(), |node| node.next.get()).count()
    }
}

impl Drop for Session {
    /// A loop, so that the stack depth does not depend on the number of threads.
    fn drop(&mut self) {
        let mut next = self.first.take();
        while let Some(mut node) = next {
            next = node.next.take();
        }
        let mut next = self.kept.take();
        while let Some(mut node) = next {
            next = node.next.take();
        }
    }
}

// SAFETY: every method forwards to `&Arena`, which upholds the contract for its own blocks: a block
// is valid until it is freed or the arena is dropped, and the arena is dropped with the session,
// which `&Session` borrows. A block may come from the arena of another thread than the one that
// frees or resizes it. `&Arena` allows that: it frees with `mi_free`, which finds the heap of a
// block from its address, and it resizes with `mi_heap_realloc_aligned`, which either leaves the
// block in place or copies it to the given heap and calls `mi_free`. `bun_alloc::transfer_arena`
// relies on the same two properties.
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

/// mimalloc is foreign code, which Miri does not run.
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
    fn what_is_kept_is_dropped_with_the_session() {
        let counted = std::sync::Arc::new(());
        let session = Session::new();
        let lists: Vec<&Vec<std::sync::Arc<()>>> = std::thread::scope(|scope| {
            let spawned: Vec<_> = (1..5)
                .map(|len| {
                    let (session, counted) = (&session, &counted);
                    scope.spawn(move || session.keep(vec![counted.clone(); len]))
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
    fn a_vector_grows_on_another_thread_than_the_one_that_created_it() {
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
    fn a_block_is_freed_on_another_thread_than_the_one_that_allocated_it() {
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
        // SAFETY: the block was allocated with this length and is initialized with zeros.
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
