//! Port of `src/bun_alloc/bun_alloc.zig`.

use core::ffi::c_void;
use core::mem::size_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU16, Ordering};


use bun_core::Mutex;

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin — match Zig `pub const X = @import(...)` lines)
// ──────────────────────────────────────────────────────────────────────────

pub use self::basic::c_allocator;
pub use self::basic::z_allocator;
pub use self::basic::free_without_size;
pub use bun_mimalloc_sys as mimalloc;

pub mod mimalloc_arena;
pub use mimalloc_arena::MimallocArena;
// PORTING.md: `MimallocArena` / arena allocator is re-exported as `Arena` (bumpalo::Bump) for AST crates.
pub type Arena = bumpalo::Bump;

pub mod allocation_scope;
pub use allocation_scope::AllocationScope;
pub use allocation_scope::AllocationScopeIn;

pub mod nullable_allocator;
pub use nullable_allocator::NullableAllocator;
pub mod max_heap_allocator;
pub use max_heap_allocator::MaxHeapAllocator;
pub mod linux_mem_fd_allocator;
pub use linux_mem_fd_allocator::LinuxMemFdAllocator;
pub mod buffer_fallback_allocator;
pub use buffer_fallback_allocator::BufferFallbackAllocator;
pub mod maybe_owned;
pub use maybe_owned::MaybeOwned;

// Per PORTING.md type map: `OOM!T` / `error{OutOfMemory}!T` → `Result<T, bun_alloc::AllocError>`.
// This is the crate root, so define it here. Re-exported as `bun_core::OOM`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocError;

/// The mimalloc-backed `#[global_allocator]` payload (see PORTING.md "Prereq for every crate").
/// TODO(port): wire to `mi_malloc`/`mi_free` in Phase B.
pub struct Mimalloc;

// ──────────────────────────────────────────────────────────────────────────
// Slice-in-buffer helpers
// ──────────────────────────────────────────────────────────────────────────

pub fn is_slice_in_buffer_t<T>(slice: &[T], buffer: &[T]) -> bool {
    let slice_ptr = slice.as_ptr() as usize;
    let buffer_ptr = buffer.as_ptr() as usize;
    buffer_ptr <= slice_ptr
        && (slice_ptr + slice.len() * size_of::<T>()) <= (buffer_ptr + buffer.len() * size_of::<T>())
}

/// Checks if a slice's pointer is contained within another slice.
/// If you need to make this generic, use `is_slice_in_buffer_t`.
pub fn is_slice_in_buffer(slice: &[u8], buffer: &[u8]) -> bool {
    is_slice_in_buffer_t::<u8>(slice, buffer)
}

pub fn slice_range(slice: &[u8], buffer: &[u8]) -> Option<[u32; 2]> {
    let slice_ptr = slice.as_ptr() as usize;
    let buffer_ptr = buffer.as_ptr() as usize;
    if buffer_ptr <= slice_ptr && (slice_ptr + slice.len()) <= (buffer_ptr + buffer.len()) {
        Some([
            (slice_ptr - buffer_ptr) as u32, // @truncate
            slice.len() as u32,              // @truncate
        ])
    } else {
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IndexType / IndexMap / Result / ItemStatus
// ──────────────────────────────────────────────────────────────────────────

/// `packed struct(u32) { index: u31, is_overflow: bool = false }`
/// Zig packed-struct fields are LSB-first: bits 0..=30 = index, bit 31 = is_overflow.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct IndexType(u32);

impl IndexType {
    #[inline]
    pub const fn new(index: u32, is_overflow: bool) -> Self {
        Self((index & 0x7FFF_FFFF) | ((is_overflow as u32) << 31))
    }
    #[inline]
    pub const fn index(self) -> u32 {
        self.0 & 0x7FFF_FFFF
    }
    #[inline]
    pub const fn is_overflow(self) -> bool {
        (self.0 >> 31) != 0
    }
    #[inline]
    pub fn set_index(&mut self, index: u32) {
        self.0 = (self.0 & 0x8000_0000) | (index & 0x7FFF_FFFF);
    }
    #[inline]
    pub fn set_is_overflow(&mut self, v: bool) {
        self.0 = (self.0 & 0x7FFF_FFFF) | ((v as u32) << 31);
    }
}

type HashKeyType = u64;

// Zig `IndexMapContext` is the identity hash on a u64 key.
// TODO(port): `bun_collections::HashMap` needs an identity-hash builder; using default for now.
pub type IndexMap = HashMap<HashKeyType, IndexType>;
pub type IndexMapManaged = HashMap<HashKeyType, IndexType>;

pub struct Result {
    pub hash: HashKeyType,
    pub index: IndexType,
    pub status: ItemStatus,
}

impl Result {
    pub fn has_checked_if_exists(&self) -> bool {
        self.index.index() != UNASSIGNED.index()
    }

    pub fn is_overflowing<const COUNT: usize>(&self) -> bool {
        // TODO(port): Zig compares the whole packed struct against a usize here
        // (`r.index >= count`); reproduce by comparing the raw u32.
        self.index.0 as usize >= COUNT
    }
}

pub const NOT_FOUND: IndexType = IndexType::new(u32::MAX >> 1, false); // maxInt(u31)
pub const UNASSIGNED: IndexType = IndexType::new((u32::MAX >> 1) - 1, false); // maxInt(u31) - 1

#[repr(u8)] // Zig: enum(u3)
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ItemStatus {
    Unknown,
    Exists,
    NotFound,
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowGroup<Block>
// ──────────────────────────────────────────────────────────────────────────

/// Required interface for the `Block` parameter of `OverflowGroup`/`OverflowList`.
/// TODO(port): Zig used structural duck-typing; this trait names the methods the body calls.
pub trait OverflowBlock {
    fn zero(&mut self);
    fn is_full(&self) -> bool;
    fn used_mut(&mut self) -> &mut u32;
}

const OVERFLOW_GROUP_MAX: usize = 4095;
// Zig: `UsedSize = std.math.IntFittingRange(0, max + 1)` → u13. Rust has no u13; use u16.
type OverflowUsedSize = u16;

pub struct OverflowGroup<Block> {
    // 16 million files should be good enough for anyone
    // ...right?
    pub used: OverflowUsedSize,
    pub allocated: OverflowUsedSize,
    pub ptrs: [Option<Box<Block>>; OVERFLOW_GROUP_MAX],
}

impl<Block: OverflowBlock> OverflowGroup<Block> {
    #[inline]
    pub fn zero(&mut self) {
        self.used = 0;
        self.allocated = 0;
    }

    pub fn tail(&mut self) -> &mut Block {
        if self.allocated > 0
            && self.ptrs[self.used as usize].as_ref().expect("alloc").is_full()
        {
            self.used = self.used.wrapping_add(1);
            if self.allocated > self.used {
                *self.ptrs[self.used as usize].as_mut().expect("alloc").used_mut() = 0;
            }
        }

        if self.allocated <= self.used {
            // Zig: default_allocator.create(Block) catch unreachable
            // SAFETY: Box<MaybeUninit> → zero() initializes the `used` counter; payload array
            // is left uninit exactly as Zig does (only `used` is read before write).
            let mut b: Box<core::mem::MaybeUninit<Block>> = Box::new_uninit();
            // TODO(port): `Block::zero` writes only `used`; rest stays uninit by design.
            unsafe { (*b.as_mut_ptr()).zero() };
            self.ptrs[self.allocated as usize] = Some(unsafe { b.assume_init() });
            self.allocated = self.allocated.wrapping_add(1);
        }

        self.ptrs[self.used as usize].as_mut().expect("alloc")
    }

    #[inline]
    pub fn slice(&mut self) -> &mut [Option<Box<Block>>] {
        &mut self.ptrs[0..self.used as usize]
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OverflowList<ValueType, COUNT>
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): const-generic arithmetic (`[ValueType; COUNT]` inside a generic struct) requires
// `feature(generic_const_exprs)` on stable Rust. Phase B may pin COUNT per instantiation site
// or use a heap `Box<[ValueType]>` with debug_assert on len.

pub struct OverflowListBlock<ValueType, const COUNT: usize> {
    // Zig: `SizeType = std.math.IntFittingRange(0, count)`; use u32 here.
    pub used: u32,
    pub items: [ValueType; COUNT],
}

impl<ValueType, const COUNT: usize> OverflowListBlock<ValueType, COUNT> {
    #[inline]
    pub fn zero(&mut self) {
        self.used = 0;
    }

    #[inline]
    pub fn is_full(&self) -> bool {
        self.used as usize >= COUNT
    }

    pub fn append(&mut self, value: ValueType) -> &mut ValueType {
        debug_assert!((self.used as usize) < COUNT);
        let index = self.used as usize;
        self.items[index] = value;
        self.used = self.used.wrapping_add(1);
        &mut self.items[index]
    }
}

impl<ValueType, const COUNT: usize> OverflowBlock for OverflowListBlock<ValueType, COUNT> {
    fn zero(&mut self) { self.used = 0; }
    fn is_full(&self) -> bool { (self.used as usize) >= COUNT }
    fn used_mut(&mut self) -> &mut u32 { &mut self.used }
}

pub struct OverflowList<ValueType, const COUNT: usize> {
    pub list: OverflowGroup<OverflowListBlock<ValueType, COUNT>>,
    pub count: u32, // Zig: u31
}

impl<ValueType, const COUNT: usize> OverflowList<ValueType, COUNT> {
    #[inline]
    pub fn zero(&mut self) {
        self.list.zero();
        self.count = 0;
    }

    #[inline]
    pub fn len(&self) -> u32 {
        self.count
    }

    #[inline]
    pub fn append(&mut self, value: ValueType) -> &mut ValueType {
        self.count += 1;
        self.list.tail().append(value)
    }

    fn reset(&mut self) {
        for block in self.list.slice() {
            block.as_mut().expect("alloc").used = 0;
        }
        self.list.used = 0;
    }

    #[inline]
    pub fn at_index(&self, index: IndexType) -> &ValueType {
        let idx = index.index() as usize;
        let block_id = if idx > 0 { idx / COUNT } else { 0 };

        debug_assert!(index.is_overflow());
        debug_assert!(self.list.used as usize >= block_id);
        debug_assert!(
            self.list.ptrs[block_id].as_ref().expect("alloc").used as usize > (idx % COUNT)
        );

        &self.list.ptrs[block_id].as_ref().expect("alloc").items[idx % COUNT]
    }

    #[inline]
    pub fn at_index_mut(&mut self, index: IndexType) -> &mut ValueType {
        let idx = index.index() as usize;
        let block_id = if idx > 0 { idx / COUNT } else { 0 };

        debug_assert!(index.is_overflow());
        debug_assert!(self.list.used as usize >= block_id);
        debug_assert!(
            self.list.ptrs[block_id].as_ref().expect("alloc").used as usize > (idx % COUNT)
        );

        &mut self.list.ptrs[block_id].as_mut().expect("alloc").items[idx % COUNT]
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSList<ValueType, _COUNT>
// ──────────────────────────────────────────────────────────────────────────

/// "Formerly-BSSList"
/// It's not actually BSS anymore.
///
/// We do keep a pointer to it globally, but because the data is not zero-initialized, it ends up
/// taking space in the object file. We don't want to spend 1-2 MB on these structs.
///
/// TODO(port): const-generic arithmetic (`COUNT = _COUNT * 2`) and per-monomorphization
/// `static mut INSTANCE` are not expressible on stable Rust. Phase B: instantiate per use-site
/// via `macro_rules!` or pin concrete `COUNT` constants.
pub struct BSSList<ValueType, const COUNT: usize /* = _COUNT * 2 */> {
    pub mutex: Mutex,
    // LIFETIMES.tsv: dual semantics — points at sibling `tail` OR a heap alloc.
    // TODO(port): lifetime — keep raw NonNull; self-referential when `head == &self.tail`.
    pub head: Option<NonNull<BSSListOverflowBlock<ValueType>>>,
    pub tail: BSSListOverflowBlock<ValueType>,
    pub backing_buf: [ValueType; COUNT],
    pub used: u32,
}

const BSS_LIST_CHUNK_SIZE: usize = 256;

pub struct BSSListOverflowBlock<ValueType> {
    pub used: AtomicU16,
    pub data: [ValueType; BSS_LIST_CHUNK_SIZE],
    pub prev: Option<Box<BSSListOverflowBlock<ValueType>>>,
}

impl<ValueType> BSSListOverflowBlock<ValueType> {
    #[inline]
    pub fn zero(&mut self) {
        // Avoid struct initialization syntax.
        // This makes Bun start about 1ms faster.
        // https://github.com/ziglang/zig/issues/24313
        self.used = AtomicU16::new(0);
        self.prev = None;
    }

    pub fn append(&mut self, item: ValueType) -> core::result::Result<&mut ValueType, AllocError> {
        let index = self.used.fetch_add(1, Ordering::AcqRel);
        if index as usize >= BSS_LIST_CHUNK_SIZE {
            return Err(AllocError);
        }
        self.data[index as usize] = item;
        Ok(&mut self.data[index as usize])
    }
}

// `deinit` for OverflowBlock: walks `prev` and frees each. With `prev: Option<Box<..>>`,
// `Drop` handles the chain automatically — no explicit impl needed.

impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> {
    pub const CHUNK_SIZE: usize = BSS_LIST_CHUNK_SIZE;
    const MAX_INDEX: usize = COUNT - 1;

    // Zig: `pub var instance: *Self = undefined; pub var loaded = false;`
    // TODO(port): Rust cannot define generic statics. Phase B: per-instantiation
    // `static INSTANCE: SyncUnsafeCell<*mut BSSList<..>>` at each monomorphization site,
    // or a `OnceLock`-backed registry keyed by `TypeId`.

    #[inline]
    pub fn block_index(index: u32 /* u31 */) -> usize {
        index as usize / BSS_LIST_CHUNK_SIZE
    }

    pub fn init() -> &'static mut Self {
        // TODO(port): per-monomorphization singleton; see note above.
        // Zig: if !loaded { instance = create(Self); ...; loaded = true; } return instance;
        unimplemented!("BSSList::init requires per-type static storage (Phase B)")
    }

    // Zig `deinit` → `impl Drop for BSSList` below (PORTING.md: never expose `pub fn deinit`).
    // The `instance.destroy()` + `loaded = false` half is singleton teardown — Phase B static
    // wrapper owns that; Drop only frees the heap-allocated head chain.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.used as usize >= COUNT
    }

    pub fn exists(&self, value: &[u8]) -> bool
    where
        ValueType: AsRef<[u8]>, // TODO(port): Zig passes ValueType directly to isSliceInBuffer
    {
        // TODO(port): Zig compares against `instance.backing_buf` as a byte buffer; only sound
        // when ValueType is a slice type. Re-examine call sites in Phase B.
        let _ = value;
        unimplemented!()
    }

    fn append_overflow(
        &mut self,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError>
    where
        ValueType: Clone,
    {
        self.used += 1;
        // SAFETY: head is always non-null after init() (points at self.tail or heap block).
        let head = unsafe { self.head.unwrap().as_mut() };
        match head.append(value.clone()) {
            Ok(v) => Ok(v),
            Err(_) => {
                let mut new_block: Box<core::mem::MaybeUninit<BSSListOverflowBlock<ValueType>>> =
                    Box::new_uninit();
                // SAFETY: zero() initializes `used` and `prev`; `data` stays uninit by design.
                unsafe { (*new_block.as_mut_ptr()).zero() };
                let mut new_block = unsafe { new_block.assume_init() };
                // TODO(port): `prev` wants Box ownership of the *current* head, but current head
                // may be `&self.tail` (not Boxed). Dual-semantics — Phase B must split into
                // `enum { Inline, Heap(Box<..>) }` or always heap-allocate the first block.
                new_block.prev = None; // placeholder
                let raw = Box::into_raw(new_block);
                // SAFETY: raw came from Box::into_raw on the line above; non-null and exclusively owned.
                self.head = Some(unsafe { NonNull::new_unchecked(raw) });
                // SAFETY: raw is the freshly-allocated head block; no other alias exists yet.
                unsafe { (*raw).append(value) }
            }
        }
    }

    pub fn append(
        &mut self,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError>
    where
        ValueType: Clone,
    {
        self.mutex.lock();
        let _guard = scopeguard::guard(&mut self.mutex, |m| m.unlock());
        // TODO(port): bun_core::Mutex needs an RAII guard that does not borrow `&mut self`
        // so the lock stays held across append_overflow (Zig: `defer self.mutex.unlock()`).
        // Do NOT release early — append_overflow mutates head/used and must run under the lock.
        // Phase A accepts the borrowck conflict here; correctness > compilation.
        // TODO(port): Zig reads `instance.*` here even though `self == instance`; kept as `self`.
        if self.used as usize > Self::MAX_INDEX {
            self.append_overflow(value)
        } else {
            let index = self.used as usize;
            self.backing_buf[index] = value;
            self.used += 1;
            Ok(&mut self.backing_buf[index])
        }
    }

    // Zig: `pub const Pair = struct { index: IndexType, value: *ValueType };`
    // LIFETIMES.tsv: ARENA → *const ValueType. Type appears unused.
}

impl<ValueType, const COUNT: usize> Drop for BSSList<ValueType, COUNT> {
    fn drop(&mut self) {
        // TODO(port): walk `self.head` chain and Box::from_raw each heap block whose address
        // != `&self.tail`. The inline `tail` block must NOT be Box-dropped. Singleton
        // `loaded = false` reset belongs to the Phase-B static wrapper, not here.
    }
}

pub struct BSSListPair<ValueType> {
    pub index: IndexType,
    pub value: *const ValueType,
}

// ──────────────────────────────────────────────────────────────────────────
// BSSStringList<_COUNT, _ITEM_LENGTH>
// ──────────────────────────────────────────────────────────────────────────

/// Append-only list.
/// Stores an initial count in .bss section of the object file.
/// Overflows to heap when count is exceeded.
///
/// TODO(port): same const-generic-arithmetic and per-type-static caveats as `BSSList`.
pub struct BSSStringList<const COUNT: usize /* = _COUNT * 2 */, const ITEM_LENGTH: usize /* = _ITEM_LENGTH + 1 */> {
    // TODO(port): backing_buf len = COUNT * ITEM_LENGTH (generic_const_exprs).
    pub backing_buf: Box<[u8]>, // logically [u8; COUNT * ITEM_LENGTH]
    pub backing_buf_used: u64,
    // TODO(port): Overflow = OverflowList<&'static [u8], COUNT / 4> (generic_const_exprs).
    pub overflow_list: OverflowList<&'static [u8], 0>, // placeholder COUNT/4
    pub slice_buf: Box<[&'static [u8]]>, // logically [&[u8]; COUNT]
    pub slice_buf_used: u16,
    pub mutex: Mutex,
}

#[derive(Default, Clone, Copy)]
struct EmptyType {
    len: usize,
}

/// Trait modeling Zig's `comptime AppendType` switch in `doAppend`.
/// TODO(port): Zig dispatches on the *type* (EmptyType / single slice / iterable-of-slices).
pub trait BSSAppendable {
    /// Total byte length (excluding sentinel).
    fn total_len(&self) -> usize;
    /// Copy bytes into `dst[..total_len()]`. No-op for `EmptyType`.
    fn copy_into(&self, dst: &mut [u8]);
}

impl BSSAppendable for EmptyType {
    fn total_len(&self) -> usize { self.len }
    fn copy_into(&self, _dst: &mut [u8]) {}
}
impl BSSAppendable for &[u8] {
    fn total_len(&self) -> usize { self.len() }
    fn copy_into(&self, dst: &mut [u8]) { dst[..self.len()].copy_from_slice(self); }
}
impl<const N: usize> BSSAppendable for [&[u8]; N] {
    fn total_len(&self) -> usize { self.iter().map(|s| s.len()).sum() }
    fn copy_into(&self, dst: &mut [u8]) {
        let mut remainder = dst;
        for val in self {
            remainder[..val.len()].copy_from_slice(val);
            remainder = &mut remainder[val.len()..];
        }
    }
}

impl<const COUNT: usize, const ITEM_LENGTH: usize> BSSStringList<COUNT, ITEM_LENGTH> {
    const MAX_INDEX: usize = COUNT - 1;

    pub fn init() -> &'static mut Self {
        // TODO(port): per-monomorphization singleton (see BSSList note).
        unimplemented!("BSSStringList::init requires per-type static storage (Phase B)")
    }

    // Zig `deinit`: just frees `instance`. Handled by dropping the singleton Box in Phase B.

    #[inline]
    pub fn is_overflowing(instance: &Self) -> bool {
        instance.slice_buf_used as usize >= COUNT
    }

    pub fn exists(&self, value: &[u8]) -> bool {
        is_slice_in_buffer(value, &self.backing_buf)
    }

    pub fn editable_slice(slice: &[u8]) -> &mut [u8] {
        // SAFETY: caller contract — slice was returned from `append*` and points into our
        // owned backing storage. Matches Zig `@constCast`.
        unsafe { core::slice::from_raw_parts_mut(slice.as_ptr() as *mut u8, slice.len()) }
    }

    pub fn append_mutable<A: BSSAppendable>(
        &mut self,
        value: A,
    ) -> core::result::Result<&mut [u8], AllocError> {
        let appended = self.append(value)?;
        Ok(Self::editable_slice(appended))
    }

    pub fn get_mutable(&mut self, len: usize) -> core::result::Result<&mut [u8], AllocError> {
        self.append_mutable(EmptyType { len })
    }

    pub fn print_with_type(
        &mut self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&[u8], AllocError> {
        // TODO(port): Zig uses `std.fmt.count(fmt, args)`; `core::fmt::Arguments` has
        // `estimated_capacity()` (nightly) but no exact count. Phase B: count via a counting
        // `Write` adaptor first, then bufPrint.
        let _ = args;
        unimplemented!("print_with_type: needs fmt::count equivalent (Phase B)")
    }

    pub fn print(
        &mut self,
        args: core::fmt::Arguments<'_>,
    ) -> core::result::Result<&[u8], AllocError> {
        self.print_with_type(args)
    }

    pub fn append<A: BSSAppendable>(
        &mut self,
        value: A,
    ) -> core::result::Result<&[u8], AllocError> {
        self.mutex.lock();
        let _guard = scopeguard::guard((), |_| self.mutex.unlock());
        // PORT NOTE: reshaped for borrowck — guard captures self.mutex; Phase B should make
        // bun_core::Mutex return an RAII guard so this is `let _g = self.mutex.lock();`.
        // TODO(port): borrowck conflict between guard closure and self.do_append; fix with RAII Mutex.
        self.do_append(value)
    }

    pub fn append_lower_case(
        &mut self,
        value: &[u8],
    ) -> core::result::Result<&[u8], AllocError> {
        self.mutex.lock();
        // TODO(port): RAII mutex guard (see `append`).

        thread_local! {
            static LOWERCASE_BUF: core::cell::RefCell<bun_core::PathBuffer> =
                const { core::cell::RefCell::new(bun_core::PathBuffer::ZEROED) };
        }
        // TODO(port): can't return a borrow of thread_local across `with_borrow_mut`; copy into
        // backing_buf inside the closure then return that. Phase B reshape.
        LOWERCASE_BUF.with_borrow_mut(|buf| {
            for (i, &c) in value.iter().enumerate() {
                buf[i] = c.to_ascii_lowercase();
            }
            let slice: &[u8] = &buf[..value.len()];
            // SAFETY: do_append copies `slice` into owned storage before returning.
            let slice_static: &'static [u8] =
                unsafe { core::slice::from_raw_parts(slice.as_ptr(), slice.len()) };
            self.do_append(slice_static)
        })
    }

    #[inline]
    fn do_append<A: BSSAppendable>(
        &mut self,
        value: A,
    ) -> core::result::Result<&[u8], AllocError> {
        let value_len: usize = value.total_len() + 1;

        // SAFETY: returned slice points into `self.backing_buf` or a leaked heap alloc;
        // `&mut ZStr` then `&[u8]` reborrow matches Zig `[:0]u8` → `[]const u8`.
        let out: &mut [u8];
        if value_len + self.backing_buf_used as usize < self.backing_buf.len() - 1 {
            let start = self.backing_buf_used as usize;
            self.backing_buf_used += value_len as u64;
            let end = self.backing_buf_used as usize;

            value.copy_into(&mut self.backing_buf[start..end - 1]);
            self.backing_buf[end - 1] = 0;

            out = &mut self.backing_buf[start..end - 1];
        } else {
            // Zig: self.allocator.alloc(u8, value_len) — global mimalloc in Rust.
            let mut value_buf = vec![0u8; value_len].into_boxed_slice();
            value.copy_into(&mut value_buf[..value_len - 1]);
            value_buf[value_len - 1] = 0;
            // Leak: BSSStringList never frees overflow allocations (matches Zig).
            let leaked: &'static mut [u8] = Box::leak(value_buf);
            out = &mut leaked[..value_len - 1];
        }

        let mut result = IndexType::new(u32::MAX >> 1, self.slice_buf_used as usize > Self::MAX_INDEX);

        if result.is_overflow() {
            result.set_index(self.overflow_list.len());
        } else {
            result.set_index(self.slice_buf_used as u32);
            self.slice_buf_used += 1;
        }

        // SAFETY: `out` borrows self.backing_buf or a leaked alloc, both live for 'static
        // (singleton). Zig stores it as `[]const u8` with no lifetime tracking.
        let stored: &'static [u8] =
            unsafe { core::slice::from_raw_parts(out.as_ptr(), out.len()) };

        if result.is_overflow() {
            if self.overflow_list.len() == result.index() {
                let _ = self.overflow_list.append(stored);
            } else {
                *self.overflow_list.at_index_mut(result) = stored;
            }
            Ok(stored)
        } else {
            self.slice_buf[result.index() as usize] = stored;
            Ok(self.slice_buf[result.index() as usize])
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BSSMap<ValueType, COUNT, STORE_KEYS, ESTIMATED_KEY_LENGTH, REMOVE_TRAILING_SLASHES>
// ──────────────────────────────────────────────────────────────────────────

// Zig returns one of two *different* struct types depending on `comptime store_keys: bool`.
// Rust cannot return different types from one generic; we expose both:
//   - `BSSMapInner<V, COUNT, RM_SLASH>` (the `store_keys = false` shape)
//   - `BSSMap<V, COUNT, EST_KEY_LEN, RM_SLASH>` (the `store_keys = true` wrapper)
// TODO(port): callers that passed `store_keys=false` should name `BSSMapInner` directly.

pub struct BSSMapInner<ValueType, const COUNT: usize, const REMOVE_TRAILING_SLASHES: bool> {
    pub index: IndexMap,
    // TODO(port): Overflow = OverflowList<ValueType, COUNT / 4> (generic_const_exprs).
    pub overflow_list: OverflowList<ValueType, 0>, // placeholder COUNT/4
    pub mutex: Mutex,
    pub backing_buf: [ValueType; COUNT],
    pub backing_buf_used: u16,
}

impl<ValueType, const COUNT: usize, const REMOVE_TRAILING_SLASHES: bool>
    BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>
{
    const MAX_INDEX: usize = COUNT - 1;

    pub fn init() -> &'static mut Self {
        // TODO(port): per-monomorphization singleton (see BSSList note).
        unimplemented!("BSSMapInner::init requires per-type static storage (Phase B)")
    }

    // Zig `deinit`: `self.index.deinit(allocator)` then free instance.
    // With `IndexMap = HashMap`, Drop frees it; singleton Box drop frees instance.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.backing_buf_used as usize >= COUNT
    }

    pub fn get_or_put(
        &mut self,
        denormalized_key: &[u8],
    ) -> core::result::Result<Result, AllocError> {
        let key = if REMOVE_TRAILING_SLASHES {
            bun_core::strings::trim_right(denormalized_key, bun_core::SEP_STR.as_bytes())
        } else {
            denormalized_key
        };
        let _key = bun_wyhash::hash(key);

        self.mutex.lock();
        // TODO(port): RAII mutex guard.
        // TODO(port): narrow error set — IndexMap::get_or_put can only OOM.
        // TODO(b0-genuine): bun_collections (T1) — BSSMap needs HashMap; either hoist BSSMap to T≥1
        // or move a minimal HashMap into bun_core.
        match self.index.entry(_key) {
            bun_collections::hash_map::Entry::Occupied(e) => {
                let v = *e.get();
                self.mutex.unlock();
                Ok(Result {
                    hash: _key,
                    index: v,
                    status: match v.index() {
                        i if i == NOT_FOUND.index() => ItemStatus::NotFound,
                        i if i == UNASSIGNED.index() => ItemStatus::Unknown,
                        _ => ItemStatus::Exists,
                    },
                })
            }
            bun_collections::hash_map::Entry::Vacant(e) => {
                e.insert(UNASSIGNED);
                self.mutex.unlock();
                Ok(Result {
                    hash: _key,
                    index: UNASSIGNED,
                    status: ItemStatus::Unknown,
                })
            }
        }
    }

    pub fn get(&mut self, denormalized_key: &[u8]) -> Option<&mut ValueType> {
        let key = if REMOVE_TRAILING_SLASHES {
            bun_core::strings::trim_right(denormalized_key, bun_core::SEP_STR.as_bytes())
        } else {
            denormalized_key
        };
        let _key = bun_wyhash::hash(key);
        self.mutex.lock();
        let index = match self.index.get(&_key).copied() {
            Some(i) => i,
            None => {
                self.mutex.unlock();
                return None;
            }
        };
        self.mutex.unlock();
        self.at_index(index)
    }

    pub fn mark_not_found(&mut self, result: Result) {
        self.mutex.lock();
        self.index.insert(result.hash, NOT_FOUND);
        self.mutex.unlock();
    }

    pub fn at_index(&mut self, index: IndexType) -> Option<&mut ValueType> {
        if index.index() == NOT_FOUND.index() || index.index() == UNASSIGNED.index() {
            return None;
        }

        if index.is_overflow() {
            Some(self.overflow_list.at_index_mut(index))
        } else {
            Some(&mut self.backing_buf[index.index() as usize])
        }
    }

    pub fn put(
        &mut self,
        result: &mut Result,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        self.mutex.lock();
        // TODO(port): RAII mutex guard.

        if result.index.index() == NOT_FOUND.index() || result.index.index() == UNASSIGNED.index() {
            result
                .index
                .set_is_overflow(self.backing_buf_used as usize > Self::MAX_INDEX);
            if result.index.is_overflow() {
                result.index.set_index(self.overflow_list.len());
            } else {
                result.index.set_index(self.backing_buf_used as u32);
                self.backing_buf_used += 1;
            }
        }

        self.index.insert(result.hash, result.index);

        let ret = if result.index.is_overflow() {
            if self.overflow_list.len() == result.index.index() {
                self.overflow_list.append(value)
            } else {
                let ptr = self.overflow_list.at_index_mut(result.index);
                *ptr = value;
                ptr
            }
        } else {
            let idx = result.index.index() as usize;
            self.backing_buf[idx] = value;
            &mut self.backing_buf[idx]
        };
        // TODO(port): unlock before return via RAII guard.
        Ok(ret)
    }

    /// Returns true if the entry was removed.
    pub fn remove(&mut self, denormalized_key: &[u8]) -> bool {
        self.mutex.lock();
        let key = if REMOVE_TRAILING_SLASHES {
            bun_core::strings::trim_right(denormalized_key, bun_core::SEP_STR.as_bytes())
        } else {
            denormalized_key
        };
        let _key = bun_wyhash::hash(key);
        let removed = self.index.remove(&_key).is_some();
        self.mutex.unlock();
        removed
        // (Zig has commented-out per-slot deinit code here; intentionally not ported.)
    }

    pub fn values(&mut self) -> &mut [ValueType] {
        &mut self.backing_buf[..self.backing_buf_used as usize]
    }
}

/// `store_keys = true` wrapper.
pub struct BSSMap<
    ValueType,
    const COUNT: usize,
    const ESTIMATED_KEY_LENGTH: usize,
    const REMOVE_TRAILING_SLASHES: bool,
> {
    pub map: Box<BSSMapInner<ValueType, COUNT, REMOVE_TRAILING_SLASHES>>,
    // TODO(port): len = COUNT * ESTIMATED_KEY_LENGTH (generic_const_exprs).
    pub key_list_buffer: Box<[u8]>,
    pub key_list_buffer_used: usize,
    // TODO(port): len = COUNT (generic_const_exprs); element type is `&'static mut [u8]`-ish.
    pub key_list_slices: Box<[&'static [u8]]>,
    // TODO(port): Zig declares this as `OverflowList([]u8, count / 4)` but then calls
    // `.items[...]` and `.append(allocator, slice)` on it — those are `std.ArrayListUnmanaged`
    // methods, NOT `OverflowList` methods. Likely dead code or a latent bug upstream.
    // Port as `Vec<&'static [u8]>` to match the *called* API; revisit in Phase B.
    pub key_list_overflow: Vec<&'static [u8]>,
}

impl<ValueType, const COUNT: usize, const ESTIMATED_KEY_LENGTH: usize, const REMOVE_TRAILING_SLASHES: bool>
    BSSMap<ValueType, COUNT, ESTIMATED_KEY_LENGTH, REMOVE_TRAILING_SLASHES>
{
    pub fn init() -> &'static mut Self {
        // TODO(port): per-monomorphization singleton.
        unimplemented!("BSSMap::init requires per-type static storage (Phase B)")
    }

    // Zig `deinit`: `self.map.deinit()` then free instance — both handled by Drop.

    pub fn is_overflowing(instance: &Self) -> bool {
        instance.map.backing_buf_used as usize >= COUNT
    }

    pub fn get_or_put(&mut self, key: &[u8]) -> core::result::Result<Result, AllocError> {
        self.map.get_or_put(key)
    }

    pub fn get(&mut self, key: &[u8]) -> Option<&mut ValueType> {
        // PERF(port): Zig uses @call(bun.callmod_inline, ...) — profile in Phase B
        self.map.get(key)
    }

    pub fn at_index(&mut self, index: IndexType) -> Option<&mut ValueType> {
        // PERF(port): Zig uses @call(bun.callmod_inline, ...) — profile in Phase B
        self.map.at_index(index)
    }

    pub fn key_at_index(&self, index: IndexType) -> Option<&[u8]> {
        match index.index() {
            i if i == UNASSIGNED.index() || i == NOT_FOUND.index() => None,
            _ => {
                if !index.is_overflow() {
                    Some(self.key_list_slices[index.index() as usize])
                } else {
                    // TODO(port): see key_list_overflow note — Zig indexes `.items` here.
                    Some(self.key_list_overflow[index.index() as usize])
                }
            }
        }
    }

    pub fn put<const STORE_KEY: bool>(
        &mut self,
        key: &[u8],
        result: &mut Result,
        value: ValueType,
    ) -> core::result::Result<&mut ValueType, AllocError> {
        // PORT NOTE: reshaped for borrowck — Zig returns `ptr` from map.put then calls put_key;
        // Rust can't hold &mut ValueType across &mut self.put_key. Stash as raw, re-borrow after.
        let ptr: *mut ValueType = self.map.put(result, value)?;
        if STORE_KEY {
            self.put_key(key, result)?;
        }
        // SAFETY: ptr points into self.map.backing_buf / overflow_list, which are owned by
        // `self` and not reallocated by put_key (put_key only touches key_list_* fields).
        // We still hold the unique &mut self borrow, so no other alias exists.
        Ok(unsafe { &mut *ptr })
    }

    pub fn is_key_statically_allocated(&self, key: &[u8]) -> bool {
        is_slice_in_buffer(key, &self.key_list_buffer)
    }

    // There's two parts to this.
    // 1. Storing the underlying string.
    // 2. Making the key accessible at the index.
    pub fn put_key(&mut self, key: &[u8], result: &mut Result) -> core::result::Result<(), AllocError> {
        self.map.mutex.lock();
        // TODO(port): RAII mutex guard.

        let slice: &'static [u8];

        // Is this actually a slice into the map? Don't free it.
        if self.is_key_statically_allocated(key) {
            // SAFETY: key points into self.key_list_buffer which lives for the singleton's life.
            slice = unsafe { core::slice::from_raw_parts(key.as_ptr(), key.len()) };
        } else if self.key_list_buffer_used + key.len() < self.key_list_buffer.len() {
            let start = self.key_list_buffer_used;
            self.key_list_buffer_used += key.len();
            let dst = &mut self.key_list_buffer[start..self.key_list_buffer_used];
            dst.copy_from_slice(key);
            // SAFETY: points into self.key_list_buffer (singleton-static lifetime).
            slice = unsafe { core::slice::from_raw_parts(dst.as_ptr(), dst.len()) };
        } else {
            slice = Box::leak(Box::<[u8]>::from(key));
        }

        let slice = if REMOVE_TRAILING_SLASHES {
            bun_core::strings::trim_right(slice, b"/")
        } else {
            slice
        };

        if !result.index.is_overflow() {
            self.key_list_slices[result.index.index() as usize] = slice;
        } else {
            // TODO(port): see key_list_overflow note above re: `.items` / `.append(alloc, _)`.
            let idx = result.index.index() as usize;
            if self.key_list_overflow.len() > idx {
                let existing_slice = self.key_list_overflow[idx];
                if !self.is_key_statically_allocated(existing_slice) {
                    // Zig: self.map.allocator.free(existing_slice).
                    // We Box::leak'd above; reconstruct and drop.
                    // SAFETY: existing_slice was Box::leak'd by a prior put_key call.
                    unsafe {
                        drop(Box::from_raw(core::slice::from_raw_parts_mut(
                            existing_slice.as_ptr() as *mut u8,
                            existing_slice.len(),
                        )));
                    }
                }
                self.key_list_overflow[idx] = slice;
            } else {
                self.key_list_overflow.push(slice);
            }
        }

        self.map.mutex.unlock();
        Ok(())
    }

    pub fn mark_not_found(&mut self, result: Result) {
        self.map.mark_not_found(result);
    }

    /// This does not free the keys.
    /// Returns `true` if an entry had previously existed.
    pub fn remove(&mut self, key: &[u8]) -> bool {
        self.map.remove(key)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GenericAllocator interface
// ──────────────────────────────────────────────────────────────────────────

/// `std.mem.Allocator` analogue. See PORTING.md §Allocators — most call sites should
/// drop allocator params entirely and use the global mimalloc; this trait exists for
/// the few places that thread a real arena/scope.
pub trait Allocator {
    // TODO(port): define alloc/dealloc/realloc to mirror std.mem.Allocator vtable in Phase B.
}

/// Checks whether `allocator` is the default allocator.
pub fn is_default(allocator: &dyn Allocator) -> bool {
    // TODO(port): Zig compares vtable ptrs (`allocator.vtable == c_allocator.vtable`).
    // Rust dyn trait vtable identity is not stable; Phase B: add `Allocator::is_default()`.
    let _ = allocator;
    true
}

/// A type that behaves like a `std.mem.Allocator` source.
///
/// Generic allocators must support being moved. They cannot contain self-references, and they
/// cannot serve allocations from a buffer that exists within the allocator itself (have your
/// allocator type contain a pointer to the buffer instead).
pub trait GenericAllocator: Sized {
    /// Required. `fn allocator(self: Self) std.mem.Allocator;`
    type Std: Allocator;
    fn allocator(&self) -> Self::Std;

    // Zig's optional `deinit` → implementors use `impl Drop` (PORTING.md: never expose
    // `pub fn deinit(&mut self)`). No trait method needed.

    /// Optional. Defining a borrowed type makes it clear who owns the allocator and prevents
    /// `deinit` from being called twice.
    type Borrowed: GenericAllocator;
    fn borrow(&self) -> Self::Borrowed;

    /// Optional. A type that behaves like `?Self`.
    type Nullable;
    fn init_nullable(allocator: Option<Self>) -> Self::Nullable;
    fn unpack_nullable(allocator: Self::Nullable) -> Option<Self>;
}

/// Gets the `std.mem.Allocator` for a given generic allocator.
///
/// Zig special-cases `std.mem.Allocator` itself; in Rust, blanket-impl `GenericAllocator`
/// for `&dyn Allocator` instead.
pub fn as_std<A: GenericAllocator>(allocator: &A) -> A::Std {
    allocator.allocator()
}

/// A borrowed version of an allocator.
///
/// Some allocators have a `deinit` method that would be invalid to call multiple times (e.g.,
/// `AllocationScope` and `MimallocArena`).
///
/// If multiple structs or functions need access to the same allocator, we want to avoid simply
/// passing the allocator by value, as this could easily lead to `deinit` being called multiple
/// times if we forget who really owns the allocator.
///
/// Passing a pointer is not always a good approach, as this results in a performance penalty for
/// zero-sized allocators, and adds another level of indirection in all cases.
///
/// This function allows allocators that have a concept of being "owned" to define a "borrowed"
/// version of the allocator. If no such type is defined, it is assumed the allocator does not
/// own any data, and `Borrowed(Allocator)` is simply the same as `Allocator`.
pub type Borrowed<A> = <A as GenericAllocator>::Borrowed;

/// Borrows an allocator. See `Borrowed` for the rationale.
pub fn borrow<A: GenericAllocator>(allocator: &A) -> Borrowed<A> {
    allocator.borrow()
}

/// A type that behaves like `?Allocator`. This will either be `Option<Allocator>` itself,
/// or an optimized type that behaves like it.
///
/// Use `init_nullable` and `unpack_nullable` to work with the returned type.
pub type Nullable<A> = <A as GenericAllocator>::Nullable;

/// Creates a `Nullable<A>` from an `Option<A>`.
pub fn init_nullable<A: GenericAllocator>(allocator: Option<A>) -> Nullable<A> {
    A::init_nullable(allocator)
}

/// Turns a `Nullable<A>` back into an `Option<A>`.
pub fn unpack_nullable<A: GenericAllocator>(allocator: Nullable<A>) -> Option<A> {
    A::unpack_nullable(allocator)
}

/// The default allocator. This is a zero-sized type whose `allocator` method returns
/// `bun.default_allocator`.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
#[derive(Clone, Copy, Default)]
pub struct DefaultAlloc;

// TODO(port): impl GenericAllocator for DefaultAlloc once `Allocator` trait is fleshed out.
// Zig: `pub fn allocator(self) std.mem.Allocator { return c_allocator; }` and
// `pub const deinit = void;` (sentinel meaning "no deinit").

// ──────────────────────────────────────────────────────────────────────────
// `basic` module selection
// ──────────────────────────────────────────────────────────────────────────

#[cfg(feature = "mimalloc")] // Zig: `if (bun.use_mimalloc)`
mod basic_impl {
    pub use crate::basic::*;
}
#[cfg(not(feature = "mimalloc"))]
mod basic_impl {
    pub use crate::fallback::*;
}
use basic_impl as basic;

pub mod basic_mod; // ./basic.zig — TODO(port): rename to `basic` once cfg-gating settles
pub mod fallback;  // ./fallback.zig

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/bun_alloc.zig (937 lines)
//   confidence: low
//   todos:      32
//   notes:      generic_const_exprs + per-monomorphization statics blocked on stable Rust; BSSMap key_list_overflow calls non-existent OverflowList API in upstream Zig (likely dead code); bun_core::Mutex needs RAII guard (BSSList::append intentionally won't borrowck until then); BSSList.head dual-semantics (sibling-ref vs heap) needs enum split.
// ──────────────────────────────────────────────────────────────────────────
