//! This "Store" is a specialized memory allocation strategy very similar to an
//! arena, used for allocating expression and statement nodes during JavaScript
//! parsing and visiting. Allocations are grouped into large blocks, where each
//! block is treated as a fixed-buffer arena. When a block runs out of
//! space, a new one is created; all blocks are joined as a linked list.
//!
//! Similarly to an arena, you can call .reset() to reset state, reusing memory
//! across operations.

// Scope name distinct from the macro-generated `struct Store`.
::bun_core::declare_scope!(STORE_LOG, hidden);

/// Zig: `pub fn NewStore(comptime types: []const type, comptime count: usize) type`
///
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
            use ::core::mem::{align_of, size_of, MaybeUninit};
            use ::core::ptr::{addr_of_mut, NonNull};

            // Zig: `const largest_size, const largest_align = brk: { ... }`
            const LARGEST_SIZE: usize = {
                let sizes = [$(size_of::<$T>()),+];
                let mut largest_size = 0;
                let mut i = 0;
                while i < sizes.len() {
                    // Zig: `@compileError("NewStore does not support 0 size type: " ++ @typeName(T))`
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

            // Zig: `const backing_allocator = bun.default_allocator;`
            // (deleted — global mimalloc via #[global_allocator]; Box/alloc use it.)

            // Zig: `const log = Output.scoped(.Store, .hidden);`
            // (declared once at crate level: `bun_output::declare_scope!(Store, hidden);`)

            pub struct Store {
                /// Lazily-allocated head of the block chain — `None` until the
                /// first [`Store::allocate`]. Owns the entire `Box<Block>`
                /// `next`-linked list; `Store`'s `Drop` walks it iteratively.
                ///
                /// PERF(port): Zig co-allocated `Store` + the first `Block` in a
                /// single `PreAlloc` so `create()` always paid one `~BLOCK_SIZE`
                /// malloc. Splitting them lets a store that is `create()`d but
                /// never written to (e.g. the `Stmt` store during
                /// `Transpiler::configure_defines`, which only emits `E::String`
                /// expression nodes for `--define` / `NODE_ENV`) cost nothing
                /// beyond this small header.
                head: Option<Box<Block>>,
                /// Bump-pointer target for the active block. Null iff `head` is
                /// `None` (no allocation has happened on this thread yet);
                /// otherwise points into the `head` chain and stays valid until
                /// `destroy()`.
                current: *mut Block,
                #[cfg(debug_assertions)]
                debug_lock: ::core::cell::Cell<bool>,
            }

            /// Zig: `pub const Block = struct { ... }`
            // PORT NOTE: `buffer` needs `align(LARGEST_ALIGN)` but `#[repr(align(N))]`
            // requires a literal. Over-approximate with align(16) — every AST payload
            // type is `<= 16` aligned (asserted below). Phase B can switch to a
            // `#[repr(C)] union AlignUnion { $($T),+ }` element type if a >16-aligned
            // payload is ever introduced.
            const _: () = assert!(LARGEST_ALIGN <= 16, "NewStore payload type with align>16; bump Block repr(align)");
            /// Zig: `pub const size = largest_size * count * 2;`
            pub const BLOCK_SIZE: usize = LARGEST_SIZE * $count * 2;
            #[repr(C, align(16))]
            pub struct Block {
                buffer: [MaybeUninit<u8>; BLOCK_SIZE],
                bytes_used: BlockSize,
                next: Option<Box<Block>>,
            }

            impl Block {
                pub const SIZE: usize = BLOCK_SIZE;

                // Zig: `pub const Size = std.math.IntFittingRange(0, size + largest_size);`
                // PERF(port): was IntFittingRange — picks smallest uN; using u32 (Block::SIZE
                // for AST node stores fits comfortably). Profile.

                #[inline]
                pub fn zero(this: *mut Block) {
                    // Avoid initializing the entire struct.
                    // SAFETY: caller passes a valid (possibly uninit-buffer) Block allocation.
                    unsafe {
                        addr_of_mut!((*this).bytes_used).write(0);
                        addr_of_mut!((*this).next).write(None);
                    }
                }

                pub fn try_alloc<T>(block: &mut Block) -> Option<NonNull<T>> {
                    // Zig: `std.mem.alignForward(usize, block.bytes_used, @alignOf(T))`
                    let start = ((block.bytes_used as usize) + align_of::<T>() - 1)
                        & !(align_of::<T>() - 1);
                    if start + size_of::<T>() > block.buffer.len() {
                        return None;
                    }

                    // it's simpler to use a pointer cast, but as a sanity check, we also
                    // try to compute the slice. Rust will report an out of bounds
                    // panic if the null detection logic above is wrong
                    if cfg!(debug_assertions) {
                        let _ = &block.buffer[block.bytes_used as usize..][..size_of::<T>()];
                    }

                    // Zig: `defer block.bytes_used = @intCast(start + @sizeOf(T));`
                    block.bytes_used =
                        BlockSize::try_from(start + size_of::<T>()).unwrap();

                    // SAFETY: `start` is in-bounds (checked above) and aligned for T
                    // (align_forward above). Buffer base alignment must be >= align_of::<T>()
                    // — see TODO(port) on Block re: LARGEST_ALIGN.
                    Some(unsafe {
                        NonNull::new_unchecked(
                            block.buffer.as_mut_ptr().add(start).cast::<T>(),
                        )
                    })
                }

                /// Heap-allocate a Block without placing the (large) buffer on the stack.
                fn new_boxed() -> Box<Block> {
                    // Zig: `backing_allocator.create(Block)` then `.zero()`
                    let mut b: Box<MaybeUninit<Block>> = Box::new_uninit();
                    Block::zero(b.as_mut_ptr());
                    // SAFETY: `zero` initialized every non-buffer field; `buffer` is
                    // `[MaybeUninit<u8>; _]` and is valid uninitialized.
                    unsafe { b.assume_init() }
                }
            }

            // Zig: `pub const Size = std.math.IntFittingRange(0, size + largest_size);`
            type BlockSize = u32;

            /// `Store` owns its `Box<Block>` chain (`head` → `next` → …). The
            /// derived drop glue for `Box<Block>` is recursive (`Block.next:
            /// Option<Box<Block>>`); a long parse can build a deep chain, so
            /// dismantle it iteratively here to keep `Drop` O(1)-stack.
            impl Drop for Store {
                fn drop(&mut self) {
                    let mut it = self.head.take();
                    while let Some(mut block) = it {
                        #[cfg(debug_assertions)]
                        {
                            // Zig: `@memset(block.buffer, undefined);`
                            // SAFETY: poisoning a buffer that is being freed.
                            unsafe {
                                ::core::ptr::write_bytes(
                                    block.buffer.as_mut_ptr(),
                                    0xAA,
                                    Block::SIZE,
                                );
                            }
                        }
                        it = block.next.take();
                        drop(block);
                    }
                }
            }

            impl Store {
                pub fn init() -> *mut Store {
                    /* scoped_log elided — debug_logs feature only */
                    // PERF(port): the first `Block`'s ~`BLOCK_SIZE` heap buffer
                    // is *not* allocated here — only the small `Store` header.
                    // `allocate()` lazily mallocs the first `Block` on the first
                    // `append()` (see the `head` field doc). Box aborts on OOM
                    // (matches Zig `bun.handleOom`).
                    bun_core::heap::into_raw(Box::new(Store {
                        head: None,
                        current: ::core::ptr::null_mut(),
                        #[cfg(debug_assertions)]
                        debug_lock: ::core::cell::Cell::new(false),
                    }))
                }

                /// SAFETY: `store` must have been returned by `Store::init()` and not
                /// yet destroyed.
                pub unsafe fn destroy(store: *mut Store) {
                    /* scoped_log elided — debug_logs feature only */
                    // SAFETY: caller contract — reconstitute the `Box<Store>`
                    // leaked in `init()`. Its `Drop` (above) walks the block
                    // chain iteratively, so no deep `Box<Block>` drop recursion.
                    drop(unsafe { bun_core::heap::take(store) });
                }

                pub fn reset(store: &mut Store) {
                    /* scoped_log elided — debug_logs feature only */

                    // Nothing was ever allocated on this thread — the first
                    // `Block` is still un-materialised (`current` is null; the
                    // next `allocate()` mallocs it). Equivalent to a fresh store.
                    if store.head.is_none() {
                        debug_assert!(store.current.is_null());
                        return;
                    }

                    #[cfg(debug_assertions)]
                    {
                        // `next: Option<Box<Block>>` makes the chain a safe
                        // singly-linked list; walk it via `&mut` reborrows.
                        let mut it: Option<&mut Block> = store.head.as_deref_mut();
                        while let Some(block) = it {
                            // Zig: `block.bytes_used = undefined; @memset(&block.buffer, undefined);`
                            // SAFETY: poisoning; buffer is MaybeUninit<u8>.
                            unsafe {
                                ::core::ptr::write_bytes(
                                    block.buffer.as_mut_ptr(),
                                    0xAA,
                                    Block::SIZE,
                                );
                            }
                            it = block.next.as_deref_mut();
                        }
                    }

                    // Rewind to the head block; overflow blocks keep their stale
                    // `bytes_used` until `allocate()` advances onto them and
                    // zeroes them then (matches the pre-split behaviour).
                    let head_ptr: *mut Block = {
                        let head = store
                            .head
                            .as_deref_mut()
                            .expect("head is Some — checked above");
                        head.bytes_used = 0;
                        head as *mut Block
                    };
                    store.current = head_ptr;
                }

                fn allocate<T>(store: &mut Store) -> NonNull<T> {
                    debug_assert!(size_of::<T>() > 0); // don't allocate!
                    // TODO(port): `comptime if (!supportsType(T)) @compileError(...)` —
                    // enforce via a sealed trait generated over `$($T),+`.

                    // Lazily materialise the first `Block` on first use — this is
                    // the only `~BLOCK_SIZE` allocation a never-written store
                    // would otherwise pay up front (see `init()` / the `head` doc).
                    if store.current.is_null() {
                        debug_assert!(store.head.is_none());
                        let mut first = Block::new_boxed();
                        store.current = (&mut *first) as *mut Block;
                        store.head = Some(first);
                    }

                    // SAFETY: `current` is non-null (ensured just above, or by a
                    // prior `allocate()`/`reset()`) and points into the owned
                    // `head`/`next` chain; the pointee outlives `store`.
                    let current: &mut Block = unsafe { &mut *store.current };
                    if let Some(ptr) = Block::try_alloc::<T>(current) {
                        return ptr;
                    }

                    // The active block is full — advance to the next one,
                    // allocating it if the chain ends here.
                    let next_block: *mut Block = match &mut current.next {
                        Some(next) => {
                            next.bytes_used = 0;
                            (&mut **next) as *mut Block
                        }
                        slot @ None => {
                            let mut new_block = Block::new_boxed();
                            let ptr = (&mut *new_block) as *mut Block;
                            *slot = Some(new_block);
                            ptr
                        }
                    };
                    store.current = next_block;

                    // SAFETY: a freshly created/reset block always has room for
                    // at least one `T` (`assert!(LARGEST_ALIGN <= 16)` plus
                    // `BLOCK_SIZE = LARGEST_SIZE * count * 2`).
                    Block::try_alloc::<T>(unsafe { &mut *store.current })
                        .unwrap_or_else(|| unreachable!())
                }

                #[inline]
                pub fn append<T>(store: &mut Store, data: T) -> NonNull<T> {
                    let ptr = Store::allocate::<T>(store);
                    /* scoped_log elided — debug_logs feature only */
                    // SAFETY: `allocate` returned aligned, in-bounds, exclusive storage for T.
                    unsafe { ptr.as_ptr().write(data) };
                    ptr
                }

                pub fn lock(store: &Store) {
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(!store.debug_lock.get());
                        store.debug_lock.set(true);
                    }
                    #[cfg(not(debug_assertions))]
                    let _ = store;
                }

                pub fn unlock(store: &Store) {
                    #[cfg(debug_assertions)]
                    {
                        debug_assert!(store.debug_lock.get());
                        store.debug_lock.set(false);
                    }
                    #[cfg(not(debug_assertions))]
                    let _ = store;
                }

                // Zig: `fn supportsType(T: type) bool`
                // TODO(port): comptime type-list membership check; replace with sealed
                // trait `Stored` impl'd for each `$($T),+` and bound `allocate<T: Stored>`.
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
// "Expr"/"Stmt" panic-string label — and so are the Zig originals
// (expr.zig:3117-3196 vs stmt.zig:300-382). This macro stamps out one
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
            // const init); matches Zig `threadlocal var`.
            #[thread_local]
            pub static INSTANCE: Cell<*mut Backing> = Cell::new(::core::ptr::null_mut());
            /// Back-reference to the `ASTMemoryAllocator` installed by the
            /// enclosing `ASTMemoryAllocatorScope` stack frame. Stored as
            /// `Option<BackRef>` (vs. raw `*mut`) so `append()` can read it via
            /// safe `Deref`; the back-reference invariant (pointee outlives every
            /// copy) is upheld by `ASTMemoryAllocatorScope::{enter,exit}`, which
            /// always restores the previous value before its frame returns.
            #[thread_local]
            pub static MEMORY_ALLOCATOR: Cell<Option<::bun_ptr::BackRef<$crate::ASTMemoryAllocator>>> =
                Cell::new(None);
            #[thread_local]
            pub static DISABLE_RESET: Cell<bool> = Cell::new(false);

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
                // is either null or was returned by `Backing::init()` (leaked
                // `PreAlloc`) and remains valid until `deinit()` clears it.
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
            pub fn set_memory_allocator(p: *mut $crate::ASTMemoryAllocator) {
                MEMORY_ALLOCATOR.set(::core::ptr::NonNull::new(p).map(::bun_ptr::BackRef::from));
            }

            pub fn create() {
                if !instance().is_null() || !memory_allocator().is_null() {
                    return;
                }
                INSTANCE.set(Backing::init());
            }

            /// create || reset
            pub fn begin() {
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

            /// Zig: `Data.Store.disable_reset = b;` — toggled by long-lived
            /// callers (transpiler, bundler) that want the Store to persist
            /// across multiple parse calls.
            #[inline]
            pub fn set_disable_reset(b: bool) {
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
            pub fn assert() {
                if cfg!(debug_assertions) {
                    if instance().is_null() && memory_allocator().is_null() {
                        unreachable!("Store must be init'd");
                    }
                }
            }

            #[inline]
            pub fn append<T>(value: T) -> $crate::StoreRef<T> {
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

// ported from: src/js_parser/ast/NewStore.zig
