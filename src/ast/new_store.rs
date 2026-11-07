//! This "Store" is a specialized memory allocation strategy very similar to an
//! arena, used for allocating expression and statement nodes during JavaScript
//! parsing and visiting. Allocations are grouped into large blocks, where each
//! block is treated as a fixed-buffer arena. When a block runs out of
//! space, a new one is created; all blocks are joined as a linked list.
//!
//! Similarly to an arena, you can call .reset() to reset state, reusing memory
//! across operations.

/// Compile-time membership check for
/// the type list of a `new_store!`-generated store.
///
/// `new_store!` implements this for every `$T` in its list (with `S` = the
/// generated `Store` type), and bounds `Store::allocate`/`Store::append` (and
/// the `thread_local_ast_store!` front-end `append`) on it. Allocating a type
/// the store was not declared with is therefore a compile error.
pub trait StoredIn<S>: sealed::Sealed<S> {}

#[doc(hidden)]
pub mod sealed {
    /// Sealing supertrait — only `new_store!` expansions implement it.
    pub trait Sealed<S> {}
}

/// Rust cannot take a slice of types as a generic parameter, and the body
/// derives array sizes and alignment from that list (which would require
/// `generic_const_exprs`). Per PORTING.md this falls under the
/// `macro_rules!` type-generator exception: heterogeneous type-list
/// iteration that determines struct layout.
///
/// Usage: `new_store!(ExprStore, [EArray, EBinary, /* ... */], 256);`
/// emits `pub mod ExprStore { pub struct Store { ... } /* Block, ... */ }`.
#[macro_export]
macro_rules! new_store {
    ($mod_name:ident, [$($T:ty),+ $(,)?], $count:expr) => {
        pub mod $mod_name {
            #[allow(unused_imports)]
            use super::*;
            use ::core::alloc::Layout;
            use ::core::mem::{align_of, size_of};
            use ::core::ptr::{null_mut, NonNull};

            const LARGEST_SIZE: usize = {
                let sizes = [$(size_of::<$T>()),+];
                let mut largest_size = 0;
                let mut i = 0;
                while i < sizes.len() {
                    assert!(sizes[i] > 0, "NewStore does not support 0 size type");
                    if sizes[i] > largest_size { largest_size = sizes[i]; }
                    i += 1;
                }
                largest_size
            };
            const LARGEST_ALIGN: usize = {
                let aligns = [$(align_of::<$T>()),+];
                let mut largest_align = 1;
                let mut i = 0;
                while i < aligns.len() {
                    if aligns[i] > largest_align { largest_align = aligns[i]; }
                    i += 1;
                }
                largest_align
            };

            // Allocation goes through the global mimalloc allocator
            // (#[global_allocator]); Box/alloc use it.
            // The log scope is declared once at crate level:
            // `bun_output::declare_scope!(Store, hidden);`

            // `cursor` and `end` are apart: aarch64 loads adjacent fields as one pair, which stalls after a store to `cursor`.
            #[repr(C)]
            pub struct Store {
                /// Next free payload byte of `current`.
                cursor: *mut u8,
                /// Head of the chain of blocks that `Store` owns. Null until the first `allocate()`.
                ///
                /// An earlier design co-allocated `Store` + the first
                /// `Block` so `create()` always paid one `~BLOCK_SIZE`
                /// malloc. Splitting them lets a store that is `create()`d but
                /// never written to (e.g. the `Stmt` store during
                /// `Transpiler::configure_defines`, which only emits `E::String`
                /// expression nodes for `--define` / `NODE_ENV`) cost nothing
                /// beyond this small header.
                head: *mut Block,
                /// One past the last payload byte of `current`.
                end: *mut u8,
                /// The block that `cursor` and `end` point into. Null iff `head` is null.
                current: *mut Block,
            }

            // The payload needs `align(LARGEST_ALIGN)` but `#[repr(align(N))]`
            // requires a literal. Over-approximate with align(16) — every AST payload
            // type is `<= 16` aligned (asserted below).
            const _: () = assert!(LARGEST_ALIGN <= 16, "NewStore payload type with align>16; bump Block repr(align)");
            pub(crate) const BLOCK_SIZE: usize = LARGEST_SIZE * $count * 2;
            const _: () = assert!(BLOCK_SIZE >= LARGEST_SIZE, "NewStore block cannot hold its largest type");
            /// Header of a block. `BLOCK_SIZE` payload bytes follow it in the same allocation.
            #[repr(C, align(16))]
            struct Block {
                // The payload is not a field: no `&mut Block` may cover nodes the AST holds.
                next: *mut Block,
            }
            const BLOCK_LAYOUT: Layout =
                match Layout::from_size_align(size_of::<Block>() + BLOCK_SIZE, align_of::<Block>()) {
                    Ok(layout) => layout,
                    Err(_) => panic!("NewStore block is too large"),
                };

            // Only the types listed in this `new_store!`
            // invocation may be allocated from this store. `allocate`/`append`
            // are bounded on `StoredIn<Store>`, so an unsupported type is a
            // compile error.
            $(
                impl $crate::new_store::sealed::Sealed<Store> for $T {}
                impl $crate::new_store::StoredIn<Store> for $T {}
            )+

            impl Block {
                /// A new block with no successor. Its payload stays uninitialized.
                fn alloc() -> *mut Block {
                    #[expect(
                        clippy::cast_ptr_alignment,
                        reason = "`BLOCK_LAYOUT` is aligned for `Block`"
                    )]
                    // SAFETY: `BLOCK_LAYOUT` has a non-zero size.
                    let block = unsafe { ::std::alloc::alloc(BLOCK_LAYOUT) }.cast::<Block>();
                    if block.is_null() {
                        ::std::alloc::handle_alloc_error(BLOCK_LAYOUT);
                    }
                    // SAFETY: a fresh allocation, sized and aligned for the header.
                    unsafe { block.write(Block { next: null_mut() }) };
                    block
                }

                /// First payload byte of `block`.
                #[inline]
                fn payload(block: *mut Block) -> *mut u8 {
                    block.cast::<u8>().wrapping_add(size_of::<Block>())
                }
            }

            impl Drop for Store {
                fn drop(&mut self) {
                    let mut it = self.head;
                    while !it.is_null() {
                        // SAFETY: `it` is a live block of the chain this store
                        // owns, allocated with `BLOCK_LAYOUT`.
                        unsafe {
                            let next = (*it).next;
                            #[cfg(debug_assertions)]
                            Block::payload(it).write_bytes(0xAA, BLOCK_SIZE);
                            ::std::alloc::dealloc(it.cast::<u8>(), BLOCK_LAYOUT);
                            it = next;
                        }
                    }
                }
            }

            impl Store {
                pub fn init() -> *mut Store {
                    /* scoped_log elided — debug_logs feature only */
                    // The first `Block`'s ~`BLOCK_SIZE` heap buffer
                    // is *not* allocated here — only the small `Store` header.
                    // `allocate()` lazily mallocs the first `Block` on the first
                    // `append()` (see the `head` field doc). Box aborts on OOM.
                    bun_core::heap::into_raw(Box::new(Store {
                        cursor: null_mut(),
                        head: null_mut(),
                        end: null_mut(),
                        current: null_mut(),
                    }))
                }

                /// SAFETY: `store` must have been returned by `Store::init()` and not
                /// yet destroyed.
                pub unsafe fn destroy(store: *mut Store) {
                    /* scoped_log elided — debug_logs feature only */
                    // SAFETY: caller contract — reconstitute the `Box<Store>`
                    // leaked in `init()`. Its `Drop` (above) walks the block
                    // chain and frees every block.
                    drop(unsafe { bun_core::heap::take(store) });
                }

                pub fn reset(store: &mut Store) {
                    /* scoped_log elided — debug_logs feature only */

                    // Nothing was ever allocated on this thread — the first
                    // `Block` is still un-materialised (`current` is null; the
                    // next `allocate()` mallocs it). Equivalent to a fresh store.
                    if store.head.is_null() {
                        debug_assert!(store.current.is_null());
                        return;
                    }

                    #[cfg(debug_assertions)]
                    {
                        let mut it = store.head;
                        while !it.is_null() {
                            // SAFETY: `it` is a live block of the chain this
                            // store owns; poisoning its payload.
                            unsafe {
                                Block::payload(it).write_bytes(0xAA, BLOCK_SIZE);
                                it = (*it).next;
                            }
                        }
                    }

                    // Rewind to the head block; `allocate()` enters the overflow blocks again.
                    Store::enter(store, store.head);
                }

                /// Make `block` the active block, with its whole payload free.
                #[inline]
                fn enter(store: &mut Store, block: *mut Block) {
                    store.current = block;
                    store.cursor = Block::payload(block);
                    store.end = store.cursor.wrapping_add(BLOCK_SIZE);
                }

                /// Slow path of `allocate()`: enter the next block and take `size` bytes of it.
                #[cold]
                #[inline(never)]
                fn allocate_in_next_block(store: &mut Store, size: usize) -> NonNull<u8> {
                    assert!(size <= BLOCK_SIZE);

                    let next = if store.current.is_null() {
                        debug_assert!(store.head.is_null());
                        store.head = Block::alloc();
                        store.head
                    } else {
                        // SAFETY: `current` is a live block of the chain this
                        // store owns.
                        unsafe {
                            // Reuse the block that `reset()` kept, or grow the chain.
                            if (*store.current).next.is_null() {
                                (*store.current).next = Block::alloc();
                            }
                            (*store.current).next
                        }
                    };
                    Store::enter(store, next);

                    let node = store.cursor;
                    // SAFETY: `enter()` left `cursor` on the first byte of a
                    // payload of `BLOCK_SIZE` bytes, and `size` is no more.
                    unsafe {
                        store.cursor = node.add(size);
                        NonNull::new_unchecked(node)
                    }
                }

                // Out of line: LLVM copies this body into most `append` call sites when it may.
                #[inline(never)]
                fn allocate<T: $crate::new_store::StoredIn<Store>>(store: &mut Store) -> NonNull<T> {
                    debug_assert!(size_of::<T>() > 0); // don't allocate!

                    let addr = store.cursor.addr();
                    let start = (addr + align_of::<T>() - 1) & !(align_of::<T>() - 1);
                    // A store with no block has null `cursor` and `end`, and takes this branch too.
                    if start + size_of::<T>() > store.end.addr() {
                        // The payload of a block starts aligned for every `T` (asserted above).
                        return Store::allocate_in_next_block(store, size_of::<T>()).cast::<T>();
                    }

                    // SAFETY: `start` is `cursor` moved up to the alignment of
                    // `T`, and the compare proved that the `size_of::<T>()`
                    // bytes from there are free payload of `current`.
                    unsafe {
                        let node = store.cursor.add(start - addr);
                        store.cursor = node.add(size_of::<T>());
                        NonNull::new_unchecked(node.cast::<T>())
                    }
                }

                #[inline]
                pub fn append<T: $crate::new_store::StoredIn<Store>>(
                    store: &mut Store,
                    data: T,
                ) -> NonNull<T> {
                    let ptr = Store::allocate::<T>(store);
                    /* scoped_log elided — debug_logs feature only */
                    // SAFETY: `allocate` returned aligned, in-bounds, exclusive storage for T.
                    unsafe { ptr.as_ptr().write(data) };
                    ptr
                }

                // Type-list membership is enforced by the
                // `StoredIn<Store>` impls generated above `impl Block`.
            }
        }
    };
}

// ───────────────────────────────────────────────────────────────────────────
// thread_local_ast_store! — the per-thread *front-end* wrapper around a
// `new_store!`-generated slab.
//
// `Expr` and `Stmt` each need three `#[thread_local]` slots (instance ptr,
// optional `ASTMemoryAllocator` override, `disable_reset` flag) plus the
// twelve identical accessor/lifecycle fns. The two hand-written copies in
// expr.rs / stmt.rs were byte-for-byte twins modulo the backing type and the
// "Expr"/"Stmt" panic-string label. This macro stamps out one
// `pub mod Store { … }` per call site so the duplication lives here once.
//
// Why a macro and not a generic struct: `#[thread_local] static` cannot be
// generic over `T`, so a `struct Front<B>` with `static INSTANCE: Cell<*mut B>`
// is rejected; the storage must be monomorphised at the item level.
//
// Usage (inside `pub mod data { use super::*; … }`):
//   crate::thread_local_ast_store!(expr_store::Store, "Expr");
//
// Expects in scope via `use super::*;`: the `$Backing` path and a
// `type Disabler = DebugOnlyDisabler<…>;` alias for the debug re-entrancy
// guard called from `append()`.
#[macro_export]
macro_rules! thread_local_ast_store {
    ($Backing:path, $label:literal) => {
        #[allow(non_snake_case)]
        pub mod Store {
            use super::*;
            use ::core::cell::Cell;
            type Backing = $Backing;

            // `#[thread_local]` (bare `__thread` slot) — `memory_allocator()` is
            // read on every node `alloc` (the hottest TLS in the parser), and
            // the `thread_local!` macro's `LocalKey` wrapper showed up in
            // next-lint profiles. All three are `Cell<ptr|bool>` (no destructor,
            // const init).
            #[thread_local]
            pub(crate) static INSTANCE: Cell<*mut Backing> = Cell::new(::core::ptr::null_mut());
            /// Back-reference to the `ASTMemoryAllocator` installed by the
            /// enclosing `ASTMemoryAllocatorScope` stack frame. Stored as
            /// `Option<BackRef>` (vs. raw `*mut`) so `append()` can read it via
            /// safe `Deref`; the back-reference invariant (pointee outlives every
            /// copy) is upheld by `ASTMemoryAllocatorScope::{enter,exit}`, which
            /// always restores the previous value before its frame returns.
            #[thread_local]
            pub(crate) static MEMORY_ALLOCATOR: Cell<
                Option<::bun_ptr::BackRef<$crate::ASTMemoryAllocator, ::bun_ptr::Mut>>,
            > = Cell::new(None);
            #[thread_local]
            pub(crate) static DISABLE_RESET: Cell<bool> = Cell::new(false);

            #[inline]
            fn instance() -> *mut Backing {
                INSTANCE.get()
            }
            /// Reborrow the thread-local backing store. Centralises the raw
            /// deref so `begin`/`reset`/`append` stay safe; `None` iff
            /// `create()` has not run (or `deinit()` cleared it).
            #[inline]
            fn instance_mut<'a>() -> Option<&'a mut Backing> {
                // SAFETY: `INSTANCE` is thread-local; the `*mut Backing` it holds
                // is either null or was returned by `Backing::init()` (a `Box`
                // leaked via `bun_core::heap::into_raw`) and remains valid
                // until `deinit()` clears it.
                // Single-threaded access — no other `&mut` to the slab is live.
                unsafe { INSTANCE.get().as_mut() }
            }
            #[inline]
            pub fn memory_allocator() -> *mut $crate::ASTMemoryAllocator {
                MEMORY_ALLOCATOR
                    .get()
                    .map_or(::core::ptr::null_mut(), ::bun_ptr::BackRef::as_ptr)
            }
            #[inline]
            pub(crate) fn set_memory_allocator(p: *mut $crate::ASTMemoryAllocator) {
                MEMORY_ALLOCATOR.set(::core::ptr::NonNull::new(p).map(|nn|
                    // SAFETY: `p` is the caller's live allocator with write provenance.
                    unsafe { ::bun_ptr::BackRef::from_raw_mut(nn.as_ptr()) }));
            }

            pub fn create() {
                if !instance().is_null() || !memory_allocator().is_null() {
                    return;
                }
                INSTANCE.set(Backing::init());
            }

            /// create || reset
            pub(crate) fn begin() {
                if !memory_allocator().is_null() {
                    return;
                }
                match instance_mut() {
                    None => create(),
                    Some(store) => {
                        if !DISABLE_RESET.get() {
                            Backing::reset(store);
                        }
                    }
                }
            }

            pub fn reset() {
                if DISABLE_RESET.get() || !memory_allocator().is_null() {
                    return;
                }
                // Caller contract — instance is set when reset() is called.
                Backing::reset(
                    instance_mut().expect(concat!($label, " Store::reset: instance not set")),
                );
            }

            /// Toggled by long-lived
            /// callers (transpiler, bundler) that want the Store to persist
            /// across multiple parse calls.
            #[inline]
            pub(crate) fn set_disable_reset(b: bool) {
                DISABLE_RESET.set(b);
            }
            #[inline]
            pub fn disable_reset() -> bool {
                DISABLE_RESET.get()
            }

            pub fn deinit() {
                if instance().is_null() || !memory_allocator().is_null() {
                    return;
                }
                // SAFETY: checked non-null above; `destroy` frees the `Store`
                // box and its lazily-allocated block chain.
                unsafe { Backing::destroy(instance()) };
                INSTANCE.set(::core::ptr::null_mut());
            }

            #[inline]
            pub(crate) fn assert() {
                if cfg!(debug_assertions) {
                    if instance().is_null() && memory_allocator().is_null() {
                        unreachable!("Store must be init'd");
                    }
                }
            }

            #[inline]
            pub fn append<T: $crate::new_store::StoredIn<Backing>>(
                value: T,
            ) -> $crate::StoreRef<T> {
                if let Some(ma) = MEMORY_ALLOCATOR.get() {
                    // `BackRef<ASTMemoryAllocator>: Deref` — owning scope outlives this call.
                    return ma.append(value);
                }
                Disabler::assert();
                // assert() guarantees instance is non-null on this thread; slab
                // returns stable addresses until reset().
                $crate::StoreRef::from_non_null(Backing::append(
                    instance_mut().expect(concat!($label, " Store must be init'd")),
                    value,
                ))
            }
        }
    };
}

// Run under Miri: `bun run rust:miri -p bun_ast`.
#[cfg(test)]
#[allow(unreachable_pub, reason = "`new_store!` emits `pub` items")]
mod tests {
    use core::ptr::NonNull;

    // A block has 64 payload bytes: eight `u64` nodes fill it.
    crate::new_store!(probe_store, [u64, u32, [u64; 2]], 2);

    use probe_store::Store;

    /// The widest alignment a block supports.
    #[derive(Clone, Copy, Debug, PartialEq)]
    #[repr(align(16))]
    struct Wide(u64);

    // Four `Wide` nodes fill a block.
    crate::new_store!(wide_store, [Wide], 2);

    /// Like the thread-local front end: a raw pointer to the store, and a fresh `&mut` per call.
    struct Probe(*mut Store);

    impl Probe {
        fn new() -> Self {
            Probe(Store::init())
        }
        fn append<T: crate::new_store::StoredIn<Store>>(&self, value: T) -> NonNull<T> {
            // SAFETY: `init()` returned the pointer and `Drop` has not run.
            Store::append(unsafe { &mut *self.0 }, value)
        }
        fn reset(&self) {
            // SAFETY: as above.
            Store::reset(unsafe { &mut *self.0 });
        }
    }

    impl Drop for Probe {
        fn drop(&mut self) {
            // SAFETY: `init()` returned the pointer; destroyed once, here.
            unsafe { Store::destroy(self.0) };
        }
    }

    /// Distance in bytes from node `a` to node `b`.
    fn gap<A, B>(a: NonNull<A>, b: NonNull<B>) -> usize {
        b.addr().get().wrapping_sub(a.addr().get())
    }

    /// The AST reads and patches a node long after later nodes are appended.
    #[test]
    fn earlier_nodes_survive_later_appends() {
        let store = Probe::new();

        // Enough to spill past the first block.
        let nodes: Vec<NonNull<u64>> = (0..64).map(|i| store.append::<u64>(i)).collect();

        for (i, node) in nodes.iter().enumerate() {
            // SAFETY: a live node of `store`.
            assert_eq!(unsafe { node.read() }, i as u64);
        }
        // SAFETY: as above. Patches the first node in place, as the parser does.
        unsafe {
            nodes[0].write(999);
            assert_eq!(nodes[0].read(), 999);
        }
    }

    /// Mixed sizes and alignments share one cursor.
    #[test]
    fn mixed_types_keep_their_nodes() {
        let store = Probe::new();

        let a = store.append::<u64>(0xdead_beef);
        let b = store.append::<u32>(0x1234);
        let c = store.append::<u64>(0xfeed_face);

        // `c` skips the four bytes after `b` to stay aligned.
        assert_eq!((gap(a, b), gap(a, c)), (8, 16));
        // SAFETY: all three are live nodes of `store`.
        unsafe {
            assert_eq!(a.read(), 0xdead_beef);
            assert_eq!(b.read(), 0x1234);
            assert_eq!(c.read(), 0xfeed_face);
        }
    }

    /// A node that is larger than its alignment moves the cursor by its size.
    #[test]
    fn node_size_is_not_its_alignment() {
        let store = Probe::new();

        let a = store.append::<u32>(1);
        let b = store.append::<[u64; 2]>([2, 3]);
        let c = store.append::<u64>(4);
        let d = store.append::<[u64; 2]>([5, 6]);
        let e = store.append::<u64>(7);
        assert_eq!(
            (gap(a, b), gap(a, c), gap(a, d), gap(a, e)),
            (8, 24, 32, 48)
        );

        // Eight bytes are free. They do not hold a `[u64; 2]`.
        let f = store.append::<[u64; 2]>([8, 9]);
        assert_ne!(gap(a, f), 56, "a node that does not fit starts a new block");
        // SAFETY: all six are live nodes of `store`.
        unsafe {
            assert_eq!((a.read(), b.read(), c.read()), (1, [2, 3], 4));
            assert_eq!((d.read(), e.read(), f.read()), ([5, 6], 7, [8, 9]));
        }
    }

    /// A block is used to its last byte before the store enters the next one.
    #[test]
    fn a_block_holds_exactly_its_payload() {
        let store = Probe::new();

        let nodes: Vec<NonNull<u64>> = (0..9).map(|i| store.append::<u64>(i)).collect();

        for i in 1..8 {
            assert_eq!(gap(nodes[i - 1], nodes[i]), 8);
        }
        assert_ne!(gap(nodes[7], nodes[8]), 8, "the ninth starts a new block");

        // The second block is full too. Not even a `u32` fits.
        let tail: Vec<NonNull<u64>> = (0..7).map(|i| store.append::<u64>(i)).collect();
        let small = store.append::<u32>(1);
        assert_ne!(gap(tail[6], small), 8, "a full block takes no more nodes");
    }

    /// The payload of every block starts aligned for the widest type, also after `reset`.
    #[test]
    fn block_payload_is_aligned_for_the_widest_type() {
        let store = wide_store::Store::init();
        // SAFETY: `init()` returned the pointer; destroyed at the end.
        let append = move |i: u64| wide_store::Store::append(unsafe { &mut *store }, Wide(i));

        let before: Vec<NonNull<Wide>> = (0..9).map(append).collect();
        // SAFETY: as above.
        wide_store::Store::reset(unsafe { &mut *store });
        let after: Vec<NonNull<Wide>> = (0..9).map(append).collect();

        assert_eq!(before, after);
        for (i, node) in after.iter().enumerate() {
            assert_eq!(node.addr().get() % 16, 0);
            // SAFETY: a live node of `store`.
            assert_eq!(unsafe { node.read() }, Wide(i as u64));
        }
        // SAFETY: `init()` returned the pointer; destroyed once, here.
        unsafe { wide_store::Store::destroy(store) };
    }

    /// `reset` rewinds to the head block and hands the same addresses back out.
    #[test]
    fn reset_rewinds_and_reuses_the_head_block() {
        let store = Probe::new();

        let first = store.append::<u64>(1);
        store.reset();
        let again = store.append::<u64>(2);

        assert_eq!(first, again, "reset rewinds to the head");
        // SAFETY: `again` is a live node.
        assert_eq!(unsafe { again.read() }, 2);
    }

    /// `reset` keeps the overflow blocks; later appends fill them in order before the chain grows.
    #[test]
    fn reset_keeps_and_reuses_the_overflow_blocks() {
        let store = Probe::new();

        // Three blocks of eight `u64`.
        let before: Vec<NonNull<u64>> = (0..24).map(|i| store.append::<u64>(i)).collect();
        store.reset();
        // The same three blocks, then a fourth.
        let after: Vec<NonNull<u64>> = (0..32).map(|i| store.append::<u64>(100 + i)).collect();

        assert_eq!(before, after[..24]);
        for (i, node) in after.iter().enumerate() {
            // SAFETY: a live node of `store`.
            assert_eq!(unsafe { node.read() }, 100 + i as u64);
        }
    }

    /// Debug builds poison every block on `reset`, so a stale node does not read like a live one.
    #[test]
    #[cfg(debug_assertions)]
    fn reset_poisons_every_block() {
        let store = Probe::new();

        let nodes: Vec<NonNull<u64>> = (0..24).map(|i| store.append::<u64>(i)).collect();
        store.reset();

        for node in nodes {
            // SAFETY: `reset` keeps the blocks allocated, and it has just
            // written every payload byte.
            assert_eq!(unsafe { node.read() }, 0xAAAA_AAAA_AAAA_AAAA);
        }
    }

    /// `reset` leaves a store with no block as it is, and the first append still finds a block.
    #[test]
    fn store_with_no_block_resets_then_appends() {
        let untouched = Probe::new();
        untouched.reset();
        drop(untouched);

        let store = Probe::new();
        store.reset();
        let node = store.append::<u64>(7);
        // SAFETY: a live node of `store`.
        assert_eq!(unsafe { node.read() }, 7);
    }

    /// The parser holds a `&mut` node (`StoreRef::deref_mut`) while it appends the node's children.
    #[test]
    fn node_reference_survives_later_appends() {
        let store = Probe::new();

        // SAFETY: a live node of `store`, and the only reference to it.
        let parent: &mut u64 = unsafe { store.append::<u64>(1).as_mut() };
        *parent = 2;
        // The first block holds eight `u64`; these spill into two more.
        for child in 0..20 {
            store.append::<u64>(child);
        }
        *parent += 20;

        assert_eq!(*parent, 22);
    }

    /// A visitor takes a node by `&mut` and appends before it returns. The argument stays usable.
    #[test]
    fn node_argument_survives_an_append_in_the_callee() {
        fn visit(node: &mut u64, store: &Probe) -> NonNull<u64> {
            let child = store.append::<u64>(*node + 1);
            *node += 10;
            child
        }

        let store = Probe::new();
        let mut parent = store.append::<u64>(1);
        // SAFETY: a live node of `store`, and the only reference to it.
        let child = visit(unsafe { parent.as_mut() }, &store);

        // SAFETY: live nodes of `store`.
        unsafe {
            assert_eq!(parent.read(), 11);
            assert_eq!(child.read(), 2);
        }
    }

    /// The same shapes through the thread-local front end and the real `Expr` and `Stmt` stores.
    mod front_end {
        use crate::expr::data::Store as ExprStore;
        use crate::expr::{Data, Expr};
        use crate::stmt::data::Store as StmtStore;
        use crate::{E, G, Loc, S, StoreRef};
        use bun_alloc::ast_alloc::{DetachAstHeap, ScopedAstAlloc};

        /// Both thread-local stores, for one test. libtest runs every test on a thread of its own.
        struct Stores;

        impl Stores {
            fn create() -> Self {
                ExprStore::create();
                StmtStore::create();
                Stores
            }
        }

        impl Drop for Stores {
            fn drop(&mut self) {
                ExprStore::deinit();
                StmtStore::deinit();
            }
        }

        #[test]
        fn expr_node_is_patched_after_its_children_are_appended() {
            let _stores = Stores::create();

            let mut parent = ExprStore::append(E::Number::new(1.0));
            let node: &mut E::Number = &mut parent;
            *node = E::Number::new(2.0);
            let child = ExprStore::append(E::Number::new(3.0));
            *node = E::Number::new(node.value() + child.value());

            assert_eq!(parent.value(), 5.0);
        }

        #[test]
        fn expr_nodes_survive_a_block_overflow() {
            let _stores = Stores::create();

            let per_block = crate::expr::expr_store::BLOCK_SIZE / size_of::<E::Function>();
            let mut nodes: Vec<StoreRef<E::Function>> = (0..per_block + 2)
                .map(|_| {
                    ExprStore::append(E::Function {
                        func: G::Fn::default(),
                    })
                })
                .collect();

            for node in &mut nodes {
                node.func.open_parens_loc = Loc::EMPTY;
            }
        }

        #[test]
        fn stmt_store_hands_the_head_block_out_again_after_reset() {
            let _stores = Stores::create();

            let mut first = StmtStore::append(S::Return { value: None });
            let _second = StmtStore::append(S::Break { label: None });
            first.value = None;
            StmtStore::reset();
            let again = StmtStore::append(S::Return { value: None });

            assert_eq!(first.as_ptr(), again.as_ptr());
        }

        #[test]
        fn stores_with_no_block_reset_and_deinit() {
            let _stores = Stores::create();

            ExprStore::reset();
            StmtStore::reset();
        }

        fn number(value: f64) -> Expr {
            Expr {
                loc: Loc::EMPTY,
                data: Data::ENumber(E::Number::new(value)),
            }
        }

        /// A visitor writes an item of a node's child list after a later list is allocated.
        #[test]
        fn child_list_is_written_after_a_later_list() {
            let _stores = Stores::create();
            let _lists = ScopedAstAlloc::with_spill(core::ptr::null_mut());

            let mut first = ExprStore::append(E::Array::default());
            first.items.push(number(1.0));
            let mut second = ExprStore::append(E::Array::default());
            second.items.push(number(2.0));
            first.items[0] = number(3.0);

            assert!(matches!(first.items[0].data, Data::ENumber(n) if n.value() == 3.0));
            assert!(matches!(second.items[0].data, Data::ENumber(n) if n.value() == 2.0));
        }

        /// `DetachAstHeap` moves the list state out and back in the middle of a parse.
        #[test]
        fn child_list_is_written_after_its_state_moves() {
            let _stores = Stores::create();
            let _lists = ScopedAstAlloc::with_spill(core::ptr::null_mut());

            let mut array = ExprStore::append(E::Array::default());
            array.items.push(number(1.0));
            drop(DetachAstHeap::new());
            array.items[0] = number(2.0);
            array.items.push(number(3.0));

            assert!(matches!(array.items[0].data, Data::ENumber(n) if n.value() == 2.0));
        }
    }
}
