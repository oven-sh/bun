//! [`AstArena`]: a bump allocator for AST nodes, plus a `MimallocArena` for allocations that grow or are freed early.

use core::alloc::{Allocator, Layout};
use core::cell::{Cell, OnceCell};
use core::ops::Deref;
use core::ptr::NonNull;
use std::alloc::Global;

use bun_alloc::Arena;

use crate::{AstVec, StoreRef, StoreStr};

/// Allocation sizes are rounded up to this, so `cursor` is always aligned to it.
const MIN_ALIGN: usize = 8;
const FIRST_CHUNK_SIZE: usize = 16 * 1024;
/// Nine fit in a 512 KiB mimalloc page.
const CHUNK_SIZE: usize = 56 * 1024;
/// A larger allocation that does not fit in `current` goes to `large_chunks`.
const MAX_SMALL_SIZE: usize = 4 * 1024;
/// Off under ASAN, so that a reset frees every chunk and a dangling node is reported.
const REUSE_CHUNKS: bool = !bun_core::Environment::ENABLE_ASAN;

/// The header of an allocation from `Global`.
#[repr(C, align(16))]
struct Chunk {
    next: ChunkList,
    /// In bytes, including this header.
    size: usize,
}

/// An owned singly linked list.
#[derive(Default)]
struct ChunkList(Option<NonNull<Chunk>>);

impl Chunk {
    fn layout(size: usize) -> Layout {
        Layout::from_size_align(size, align_of::<Chunk>())
            .unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    fn allocate(size: usize, next: ChunkList) -> NonNull<Chunk> {
        let chunk = Global
            .allocate(Chunk::layout(size))
            .unwrap_or_else(|_| bun_alloc::out_of_memory())
            .cast::<Chunk>();
        // SAFETY: the allocation is new and aligned for `Chunk`. Every caller passes at least `size_of::<Chunk>()`.
        unsafe { chunk.write(Chunk { next, size }) };
        chunk
    }

    /// # Safety
    /// A live `ChunkList` owns `chunk`.
    unsafe fn data_range(chunk: NonNull<Chunk>) -> (NonNull<u8>, NonNull<u8>) {
        // SAFETY: the allocation has `size` bytes and starts with the header.
        unsafe {
            let size = chunk.as_ref().size;
            (chunk.add(1).cast(), chunk.byte_add(size).cast())
        }
    }
}

impl ChunkList {
    /// Keeps the longest prefix of at most `limit` bytes, and returns its size.
    fn truncate(&mut self, limit: usize) -> usize {
        let mut rest = self;
        let mut kept = 0;
        while let Some(mut chunk) = rest.0 {
            // SAFETY: `self` owns the chunk and is borrowed exclusively. The reference covers the header only.
            let header = unsafe { chunk.as_mut() };
            if header.size > limit - kept {
                break;
            }
            kept += header.size;
            rest = &mut header.next;
        }
        *rest = ChunkList(None);
        kept
    }
}

impl Drop for ChunkList {
    fn drop(&mut self) {
        while let Some(mut chunk) = self.0 {
            // SAFETY: `self` owns the chunk, which `Chunk::allocate` allocated with this layout. It is unlinked first.
            unsafe {
                let header = chunk.as_mut();
                self.0 = header.next.0.take();
                let layout = Chunk::layout(header.size);
                Global.deallocate(chunk.cast(), layout);
            }
        }
    }
}

std::thread_local! {
    /// The first chunk of the last `AstArena` dropped on this thread, for the next one to reuse.
    static SPARE_CHUNK: Cell<ChunkList> = const { Cell::new(ChunkList(None)) };
}

/// Does not run `Drop` for its values. Dereferences to `heap`, which is created on first use.
pub struct AstArena {
    /// `cursor..end` is the free part of `current`.
    cursor: Cell<NonNull<u8>>,
    end: Cell<NonNull<u8>>,
    /// The last entry of `chunks` in use.
    current: Cell<Option<NonNull<Chunk>>>,
    chunks: Cell<ChunkList>,
    chunks_size: Cell<usize>,
    /// One allocation each.
    large_chunks: Cell<ChunkList>,
    heap: OnceCell<Arena>,
    /// Checks callers that bypass `!Sync` with raw pointers.
    #[cfg(debug_assertions)]
    thread_lock: bun_core::ThreadLock,
}

// SAFETY: the pointers point into chunks that the arena owns, and `Global` can free them on any thread.
// The arena neither reads nor drops the values in its chunks.
unsafe impl Send for AstArena {}

impl Default for AstArena {
    fn default() -> Self {
        Self::new()
    }
}

impl AstArena {
    const DANGLING: NonNull<u8> = NonNull::<u64>::dangling().cast();

    pub const fn new() -> Self {
        AstArena {
            cursor: Cell::new(Self::DANGLING),
            end: Cell::new(Self::DANGLING),
            current: Cell::new(None),
            chunks: Cell::new(ChunkList(None)),
            chunks_size: Cell::new(0),
            large_chunks: Cell::new(ChunkList(None)),
            heap: OnceCell::new(),
            #[cfg(debug_assertions)]
            thread_lock: bun_core::ThreadLock::init_unlocked(),
        }
    }

    /// `heap` is [`Arena::borrowing_default`], so its allocations outlive this arena.
    pub fn borrowing_default() -> Self {
        let mut arena = Self::new();
        arena.heap = OnceCell::from(Arena::borrowing_default());
        arena
    }

    #[inline]
    pub fn heap(&self) -> &Arena {
        self.heap.get_or_init(Arena::new)
    }

    /// Not inlined: inlining grows the stack frames of the recursive `parse_*` functions.
    #[inline(never)]
    pub fn alloc_node<T>(&self, value: T) -> StoreRef<'_, T> {
        let mut node = self.alloc_layout(Layout::new::<T>()).cast::<T>();
        // SAFETY: the allocation is new, has the layout of `T`, and is only freed through `&mut self`.
        StoreRef::from_bump(unsafe {
            node.write(value);
            node.as_mut()
        })
    }

    pub fn dupe_str(&self, bytes: &[u8]) -> StoreStr<'_> {
        StoreStr::new(AstVec::from_slice_in(bytes, self).leak())
    }

    #[inline]
    pub fn alloc_layout(&self, layout: Layout) -> NonNull<u8> {
        #[cfg(debug_assertions)]
        self.thread_lock.lock_or_assert();
        let cursor = self.cursor.get();
        let padding = if layout.align() > MIN_ALIGN {
            cursor.addr().get().wrapping_neg() & (layout.align() - 1)
        } else {
            0
        };
        let size = padding + layout.size().next_multiple_of(MIN_ALIGN);
        if size > self.end.get().addr().get() - cursor.addr().get() {
            return self.alloc_layout_slow(layout);
        }
        // SAFETY: `cursor..end` is within one chunk or empty, it has `size` bytes, and `padding <= size`.
        unsafe {
            self.cursor.set(cursor.add(size));
            cursor.add(padding)
        }
    }

    #[cold]
    fn alloc_layout_slow(&self, layout: Layout) -> NonNull<u8> {
        let padded = layout.size() + layout.align().saturating_sub(align_of::<Chunk>());
        if padded > MAX_SMALL_SIZE {
            let chunk = Chunk::allocate(size_of::<Chunk>() + padded, self.large_chunks.take());
            self.large_chunks.set(ChunkList(Some(chunk)));
            // SAFETY: `large_chunks` owns the chunk. Its data is aligned for `Chunk` and has `padded` bytes, so
            // `layout.size()` bytes are left after aligning up.
            return unsafe {
                let data = Chunk::data_range(chunk).0;
                data.add(data.addr().get().wrapping_neg() & (layout.align() - 1))
            };
        }
        let chunk = match self.current.get() {
            None => {
                let mut chunks = self.chunks.take();
                if chunks.0.is_none() {
                    chunks = SPARE_CHUNK.try_with(Cell::take).unwrap_or_default();
                    self.chunks_size.set(FIRST_CHUNK_SIZE);
                }
                let first = *chunks
                    .0
                    .get_or_insert_with(|| Chunk::allocate(FIRST_CHUNK_SIZE, ChunkList(None)));
                self.chunks.set(chunks);
                first
            }
            Some(mut current) => {
                // SAFETY: `chunks` owns `current`. The reference covers the header only.
                let next = unsafe { &mut current.as_mut().next };
                *next.0.get_or_insert_with(|| {
                    self.chunks_size.update(|size| size + CHUNK_SIZE);
                    Chunk::allocate(CHUNK_SIZE, ChunkList(None))
                })
            }
        };
        // SAFETY: `chunks` owns the chunk.
        let (start, end) = unsafe { Chunk::data_range(chunk) };
        self.current.set(Some(chunk));
        self.cursor.set(start);
        self.end.set(end);
        self.alloc_layout(layout)
    }

    /// # Safety
    /// `ptr` starts a live allocation of any `AstArena` (or `size` is 0) that fits `size <= layout.size()` bytes at `layout.align()`.
    pub unsafe fn grow(&self, ptr: NonNull<u8>, size: usize, layout: Layout) -> NonNull<u8> {
        #[cfg(debug_assertions)]
        self.thread_lock.lock_or_assert();
        let cursor = self.cursor.get();
        let padded = size.next_multiple_of(MIN_ALIGN);
        let additional = layout.size().next_multiple_of(MIN_ALIGN) - padded;
        if ptr.addr().get() + padded == cursor.addr().get()
            && additional <= self.end.get().addr().get() - cursor.addr().get()
            && size > 0
        {
            // SAFETY: a non-empty allocation that ends at `cursor` is the last one in `current`, because the bytes
            // before the first one are the header. `cursor..end` has `additional` bytes.
            return unsafe {
                self.cursor.set(cursor.add(additional));
                cursor.sub(padded)
            };
        }
        let new_ptr = self.alloc_layout(layout);
        // SAFETY: both allocations have `size` bytes, and `new_ptr` is new.
        unsafe { new_ptr.copy_from_nonoverlapping(ptr, size) };
        new_ptr
    }

    fn reset_chunks(&mut self, limit: usize) {
        let limit = if REUSE_CHUNKS { limit } else { 0 };
        if *self.chunks_size.get_mut() > limit {
            *self.chunks_size.get_mut() = self.chunks.get_mut().truncate(limit);
        }
        #[cfg(debug_assertions)]
        {
            self.poison_used_chunks();
            self.thread_lock = bun_core::ThreadLock::init_unlocked();
        }
        *self.large_chunks.get_mut() = ChunkList(None);
        *self.current.get_mut() = None;
        *self.cursor.get_mut() = Self::DANGLING;
        *self.end.get_mut() = Self::DANGLING;
    }

    #[cfg(debug_assertions)]
    fn poison_used_chunks(&mut self) {
        let Some(last) = self.current.get() else {
            return;
        };
        let mut next = self.chunks.get_mut().0;
        while let Some(chunk) = next {
            // SAFETY: `chunks` owns the chunk, and its allocations are dead once the arena resets.
            unsafe {
                let (start, end) = Chunk::data_range(chunk);
                start.write_bytes(0xAA, end.offset_from_unsigned(start));
                next = chunk.as_ref().next.0.filter(|_| chunk != last);
            }
        }
    }

    pub fn reset(&mut self) {
        self.reset_retain_chunks(FIRST_CHUNK_SIZE);
    }

    /// Keeps up to `limit` bytes of chunks and destroys an owned `heap`.
    pub fn reset_retain_chunks(&mut self, limit: usize) {
        self.reset_chunks(limit);
        if self.heap.get().is_some_and(Arena::owns_heap) {
            self.heap.take();
        }
    }

    /// Keeps up to `limit` bytes of chunks and calls [`Arena::reset_retain_with_limit`] on an owned `heap`.
    pub fn reset_retain_with_limit(&mut self, limit: usize) {
        self.reset_chunks(limit);
        if let Some(heap) = self.heap.get_mut().filter(|heap| heap.owns_heap()) {
            heap.reset_retain_with_limit(limit);
        }
    }
}

impl Drop for AstArena {
    fn drop(&mut self) {
        self.reset_chunks(FIRST_CHUNK_SIZE);
        let first = self.chunks.take();
        if first.0.is_some() {
            let _ = SPARE_CHUNK.try_with(|spare| spare.set(first));
        }
    }
}

/// Strings and growing buffers use the heap; nodes use [`AstArena::alloc_node`].
impl Deref for AstArena {
    type Target = Arena;
    #[inline]
    fn deref(&self) -> &Arena {
        self.heap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy)]
    #[repr(align(64))]
    struct Aligned(u8);

    fn address<T>(node: StoreRef<T>) -> usize {
        node.as_ptr().addr()
    }

    fn fill(arena: &AstArena, bytes: usize) -> Vec<StoreRef<'_, [usize; 32]>> {
        let count = bytes / size_of::<[usize; 32]>();
        (0..count).map(|i| arena.alloc_node([i; 32])).collect()
    }

    #[test]
    fn values_survive_new_chunks() {
        let arena = AstArena::new();
        let nodes = fill(&arena, FIRST_CHUNK_SIZE + 3 * CHUNK_SIZE);
        for (i, node) in nodes.iter().enumerate() {
            assert_eq!(**node, [i; 32]);
        }
    }

    #[test]
    fn allocations_are_aligned() {
        let arena = AstArena::new();
        assert_eq!(address(arena.alloc_node(())) % MIN_ALIGN, 0);
        for i in 0..=u8::MAX {
            let (byte, aligned) = (arena.alloc_node(i), arena.alloc_node(Aligned(i)));
            assert_eq!(address(aligned) % align_of::<Aligned>(), 0);
            assert_eq!((*byte, aligned.0), (i, i));
        }
        let large = arena.alloc_node([Aligned(1); 128]);
        assert_eq!(address(large) % align_of::<Aligned>(), 0);
        assert!(large.iter().all(|item| item.0 == 1));
    }

    #[test]
    fn large_allocation_does_not_move_cursor() {
        let arena = AstArena::new();
        let before = arena.alloc_node(1u64);
        let large = arena.alloc_node([2u8; FIRST_CHUNK_SIZE]);
        let after = arena.alloc_node(3u64);
        assert_eq!(address(after), address(before) + MIN_ALIGN);
        assert_eq!((*before, large[FIRST_CHUNK_SIZE - 1], *after), (1, 2, 3));
    }

    #[test]
    fn reset_retains_chunks_up_to_limit() {
        let mut arena = AstArena::new();
        let bytes = FIRST_CHUNK_SIZE + 2 * CHUNK_SIZE;
        let addresses = |arena: &AstArena| -> Vec<usize> {
            fill(arena, bytes - 1024).into_iter().map(address).collect()
        };
        let first = addresses(&arena);
        assert_eq!(arena.chunks_size.get(), bytes);

        arena.reset_retain_with_limit(bytes);
        let second = addresses(&arena);
        assert_eq!(arena.chunks_size.get(), bytes);
        assert!(!REUSE_CHUNKS || first == second);

        for (limit, kept) in [
            (bytes - 1, FIRST_CHUNK_SIZE + CHUNK_SIZE),
            (FIRST_CHUNK_SIZE, FIRST_CHUNK_SIZE),
            (FIRST_CHUNK_SIZE - 1, 0),
        ] {
            arena.reset_retain_chunks(limit);
            let kept = if REUSE_CHUNKS { kept } else { 0 };
            assert_eq!(arena.chunks_size.get(), kept);
            addresses(&arena);
            assert_eq!(arena.chunks_size.get(), bytes);
        }
    }

    #[test]
    fn new_arena_reuses_spare_chunk() {
        let first = address(AstArena::new().alloc_node(0u64));
        let (outer, inner) = (AstArena::new(), AstArena::new());
        let (a, b) = (outer.alloc_node(1u64), address(inner.alloc_node(2u64)));
        assert!(!REUSE_CHUNKS || address(a) == first);
        drop(inner);
        assert_ne!(address(a), b);
        assert_eq!(*a, 1);
    }

    #[test]
    fn arena_can_move_to_another_thread() {
        let mut arena = AstArena::new();
        fill(&arena, 2 * FIRST_CHUNK_SIZE);
        let value = std::thread::spawn(move || {
            arena.reset();
            *arena.alloc_node(7u64)
        });
        assert_eq!(value.join().unwrap(), 7);
    }
}
