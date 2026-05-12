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
                current: NonNull<Block>,
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

            /// Zig: `const PreAlloc = struct { metadata: Store, first_block: Block }`
            #[repr(C)]
            struct PreAlloc {
                metadata: Store,
                first_block: Block,
            }

            impl PreAlloc {
                #[inline]
                fn zero(this: *mut PreAlloc) {
                    // Avoid initializing the entire struct.
                    // SAFETY: `this` points to a valid PreAlloc allocation.
                    unsafe {
                        Block::zero(addr_of_mut!((*this).first_block));
                        addr_of_mut!((*this).metadata.current)
                            .write(NonNull::new_unchecked(addr_of_mut!((*this).first_block)));
                        #[cfg(debug_assertions)]
                        addr_of_mut!((*this).metadata.debug_lock)
                            .write(::core::cell::Cell::new(false));
                    }
                }
            }

            impl Store {
                pub fn first_block(store: &mut Store) -> &mut Block {
                    // SAFETY: `store` is always the `metadata` field of a `PreAlloc`
                    // (see `init()`); recover the parent via offset_of.
                    unsafe {
                        let prealloc = bun_core::from_field_ptr!(PreAlloc, metadata, core::ptr::from_mut::<Store>(store));
                        &mut (*prealloc).first_block
                    }
                }

                /// Reborrow the active block. Centralises the raw `NonNull`
                /// deref so `reset`/`allocate` stay safe at every bump.
                #[inline]
                fn current_mut(store: &mut Store) -> &mut Block {
                    // SAFETY: `current` is initialised to `&first_block` in
                    // `PreAlloc::zero` and every reassignment (`reset`,
                    // `allocate`) stores a `NonNull` derived from a live block
                    // in the owned `next` chain; the pointee outlives `store`.
                    unsafe { store.current.as_mut() }
                }

                pub fn init() -> *mut Store {
                    /* scoped_log elided — debug_logs feature only */
                    // Avoid initializing the entire struct.
                    // Zig: `bun.handleOom(backing_allocator.create(PreAlloc))` — Rust Box aborts on OOM.
                    let mut prealloc: Box<MaybeUninit<PreAlloc>> = Box::new_uninit();
                    PreAlloc::zero(prealloc.as_mut_ptr());
                    // SAFETY: `zero` fully initialized `metadata` and the non-buffer
                    // fields of `first_block`; `buffer` is MaybeUninit.
                    let prealloc = bun_core::heap::into_raw(unsafe { prealloc.assume_init() });
                    // SAFETY: prealloc is a valid leaked Box.
                    unsafe { addr_of_mut!((*prealloc).metadata) }
                }

                // PORT NOTE: not `impl Drop` — `Store` is a field inside the `PreAlloc`
                // heap allocation and this frees that enclosing allocation via
                // `container_of`-style recovery. The caller holds `*mut Store`, not
                // `Box<Store>`, so per PORTING.md this is the raw-pointer `destroy`
                // escape hatch rather than `Drop`.
                /// SAFETY: `store` must have been returned by `Store::init()` and not
                /// yet destroyed.
                pub unsafe fn destroy(store: *mut Store) {
                    /* scoped_log elided — debug_logs feature only */
                    // do not free `store.head`
                    // SAFETY: caller contract.
                    let store_ref = unsafe { &mut *store };
                    let mut it = Store::first_block(store_ref).next.take();
                    while let Some(mut next) = it {
                        #[cfg(debug_assertions)]
                        {
                            // Zig: `@memset(next.buffer, undefined);`
                            // SAFETY: poisoning bytes; buffer is MaybeUninit<u8>.
                            unsafe {
                                ::core::ptr::write_bytes(
                                    next.buffer.as_mut_ptr(),
                                    0xAA,
                                    Block::SIZE,
                                );
                            }
                        }
                        it = next.next.take();
                        drop(next);
                    }

                    // SAFETY: `store` is the `metadata` field of a leaked `Box<PreAlloc>`.
                    let prealloc = unsafe {
                        bun_core::from_field_ptr!(PreAlloc, metadata, store)
                    };
                    // TODO(port): Zig source asserts `&prealloc.first_block == store.head`
                    // but `Store` has no `head` field — lazy-compiled dead assertion
                    // upstream. Dropping it here.
                    // SAFETY: reconstitute the Box leaked in `init()`.
                    drop(unsafe { bun_core::heap::take(prealloc) });
                }

                pub fn reset(store: &mut Store) {
                    /* scoped_log elided — debug_logs feature only */

                    #[cfg(debug_assertions)]
                    {
                        // `next: Option<Box<Block>>` makes the chain a safe
                        // singly-linked list; walk it via `&mut` reborrows
                        // instead of round-tripping through `NonNull`.
                        let mut it: Option<&mut Block> = Some(Store::first_block(store));
                        while let Some(next) = it {
                            // Zig: `next.bytes_used = undefined; @memset(&next.buffer, undefined);`
                            // SAFETY: poisoning; buffer is MaybeUninit<u8>.
                            unsafe {
                                ::core::ptr::write_bytes(
                                    next.buffer.as_mut_ptr(),
                                    0xAA,
                                    Block::SIZE,
                                );
                            }
                            it = next.next.as_deref_mut();
                        }
                    }

                    store.current = NonNull::from(Store::first_block(store));
                    Store::current_mut(store).bytes_used = 0;
                }

                fn allocate<T>(store: &mut Store) -> NonNull<T> {
                    debug_assert!(size_of::<T>() > 0); // don't allocate!
                    // TODO(port): `comptime if (!supportsType(T)) @compileError(...)` —
                    // enforce via a sealed trait generated over `$($T),+`.

                    let current = Store::current_mut(store);
                    if let Some(ptr) = Block::try_alloc::<T>(current) {
                        return ptr;
                    }

                    // a new block is needed
                    let next_block: NonNull<Block> = match &mut current.next {
                        Some(next) => {
                            next.bytes_used = 0;
                            NonNull::from(next.as_mut())
                        }
                        none @ None => {
                            let mut new_block = Block::new_boxed();
                            let ptr = NonNull::from(new_block.as_mut());
                            *none = Some(new_block);
                            ptr
                        }
                    };

                    store.current = next_block;

                    Block::try_alloc::<T>(Store::current_mut(store))
                        // newly initialized blocks must have enough space for at least one
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

// ported from: src/js_parser/ast/NewStore.zig
