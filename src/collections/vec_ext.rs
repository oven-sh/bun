//! `VecExt` / `ByteVecExt` — Zig-ported method vocabulary on `Vec<T>`.
//!
//! Migration shim from the deleted `BabyList<T>` (see
//! `docs/BABYLIST_REPLACEMENT.md`): every former `BabyList<T>` site is now a
//! plain `Vec<T>`, and these traits supply the Zig method names (`.slice()`,
//! `.append()`, `.init_capacity()`, …) so call sites needed only a type-level
//! rewrite. `Vec` aborts on OOM, so these methods are infallible and return
//! `T` / `()` directly (the original `Result<_, AllocError>` shim has been
//! removed — `?`/`handle_oom` at call sites is no longer needed).
//!
//! NOTE: `.first()`/`.last()`/`.insert()`/`.contains()`/`.clone()` are
//! intentionally *not* provided — they collide with `Vec`/slice inherent
//! methods whose return types differ. Call sites that relied on the old
//! variants are patched at the call site to `.first_mut()` / `.to_vec()` etc.

use core::alloc::Allocator;
use core::fmt;
use core::mem::ManuallyDrop;

use bun_alloc::AllocError;
use bun_core::strings;

pub trait VecExt<T>: Sized {
    // ── constructors ──────────────────────────────────────────────────────
    fn init_capacity(n: usize) -> Self;
    fn init_one(value: T) -> Self;
    fn from_slice(items: &[T]) -> Self
    where
        T: Clone;
    fn move_from_list(list: Vec<T>) -> Self;
    fn from_owned_slice(items: Box<[T]>) -> Self;
    fn init_with_buffer_vec(buffer: Vec<T>) -> Self;
    /// `T: Copy` arena slice → owned `Vec<T>`. Covers the dominant js_parser
    /// pattern `arena.alloc_slice_copy(&[a, b])` → owned list. Callers may
    /// pass the bump slice directly, or skip the intermediate bump alloc
    /// entirely and pass the stack array — both compile to one memcpy into the
    /// global heap.
    fn from_arena_slice(items: &[T]) -> Self
    where
        T: Copy;
    /// Consumes an `ArenaVec` (sole owner of its elements + arena buffer),
    /// bitwise-moves every element into a fresh `Vec<T, A>`, and frees the
    /// now-logically-empty arena buffer. Ownership of every `T` transfers
    /// exactly once, so no double-drop and no allocator-identity confusion is
    /// possible at the call site.
    fn from_bump_vec(v: bun_alloc::ArenaVec<'_, T>) -> Self;
    /// Arena pre-reservation: `Vec` cannot allocate from a bump arena, so this
    /// becomes a global-allocator `with_capacity`.  The arena is ignored.
    fn init_capacity_in(_arena: &bun_alloc::Arena, cap: usize) -> Self;
    /// Wrap a borrowed slice as a `Vec<T>` that **must not be dropped or
    /// grown**.  Same hazard as the original — callers wrap in `ManuallyDrop`.
    /// Kept only for the `StreamResult::Temporary*` pattern; new code should
    /// take `&[T]` instead.
    unsafe fn from_borrowed_slice_dangerous(items: &[T]) -> ManuallyDrop<Self>;

    // ── accessors ─────────────────────────────────────────────────────────
    fn slice(&self) -> &[T];
    fn slice_mut(&mut self) -> &mut [T];
    fn slice_const(&self) -> &[T];
    fn at(&self, index: usize) -> &T;
    fn mut_(&mut self, index: usize) -> &mut T;
    /// `.len` field access (old struct stored a `u32`); kept for sites that did
    /// arithmetic on the raw `u32`.
    fn len_u32(&self) -> u32;
    fn cap_u32(&self) -> u32;

    // ── mutation ──────────────────────────────────────────────────────────
    fn append(&mut self, value: T);
    fn append_assume_capacity(&mut self, value: T);
    fn append_slice(&mut self, vals: &[T])
    where
        T: Clone;
    fn append_slice_assume_capacity(&mut self, vals: &[T])
    where
        T: Copy;
    fn ensure_total_capacity(&mut self, n: usize);
    fn ensure_total_capacity_precise(&mut self, n: usize);
    fn ensure_unused_capacity(&mut self, n: usize);
    fn shrink_retaining_capacity(&mut self, new_len: usize);
    fn shrink_and_free(&mut self, new_len: usize);
    fn clear_retaining_capacity(&mut self);
    fn clear_and_free(&mut self);
    /// Drop the first `n` elements in place via `copy_within(n.., 0)` +
    /// `truncate` (capacity retained). `n == 0` is a no-op; `n >= len`
    /// degenerates to `clear()`. See [`bun_core::vec::drain_front`].
    fn drain_front(&mut self, n: usize)
    where
        T: Copy;
    fn ordered_remove(&mut self, index: usize) -> T;
    fn insert_slice(&mut self, index: usize, vals: &[T])
    where
        T: Clone;
    fn replace_range(&mut self, start: usize, len: usize, new_items: &[T])
    where
        T: Clone;
    /// # Safety
    /// Exposes `self[len..capacity]` as initialized. Every element must be
    /// overwritten before any read (including Drop). Prefer
    /// [`unused_capacity_slice`] for `T` with validity invariants.
    unsafe fn expand_to_capacity(&mut self);
    /// Reserves `additional` and returns the first `additional` slots of
    /// spare capacity as `MaybeUninit<T>`. Caller writes some prefix then
    /// calls `set_len` (or [`bun_core::vec::commit_spare`] for `Vec<u8>`) to
    /// commit. Unlike `spare_capacity_mut()` the returned slice is exactly
    /// `additional` long, not `capacity - len`.
    fn reserve_spare(&mut self, additional: usize) -> &mut [core::mem::MaybeUninit<T>];
    /// `reserve(additional)` then [`expand_to_capacity`], returning the
    /// freshly-exposed tail as a raw `(ptr, len)` pair — i.e.
    /// `(next_out, avail_out)` for C streaming APIs (zlib, brotli, zstd).
    /// Exposes the *full* over-allocated capacity (`cap - prev_len`), not
    /// exactly `additional`, so the FFI callee can use the allocator's slack.
    /// Pass `additional = 0` when the caller has already reserved.
    ///
    /// # Safety
    /// Same as [`expand_to_capacity`]: every byte in `[prev_len, cap)` must be
    /// written by the FFI callee (or `len` truncated back) before any read.
    unsafe fn reserve_expand_tail(&mut self, additional: usize) -> (*mut T, usize);

    // ── ownership transfer ────────────────────────────────────────────────
    fn move_to_list(&mut self) -> Vec<T>;
    fn move_to_list_managed(&mut self) -> Vec<T>;
    fn to_owned_slice(&mut self) -> Box<[T]>;
    /// No-op for `Vec` — already globally owned.  Kept so cat-4 call sites
    /// (`LinkerGraph::load`) compile during incremental migration; delete once
    /// all callers are gone.
    #[inline]
    fn transfer_ownership(&mut self) {}

    // ── misc ──────────────────────────────────────────────────────────────
    fn unused_capacity_slice(&mut self) -> &mut [core::mem::MaybeUninit<T>];
    fn memory_cost(&self) -> usize;
    fn sort_asc(&mut self)
    where
        T: AsRef<[u8]>;
    fn sort(&mut self, less_than: impl FnMut(&T, &T) -> bool);
    fn deep_clone_with<F>(&self, clone_one: F) -> Self
    where
        F: FnMut(&T) -> T;
    fn try_deep_clone_with<F, E>(&self, clone_one: F) -> Result<Self, E>
    where
        F: FnMut(&T) -> Result<T, E>,
        E: From<AllocError>;
}

// Generic over `A` so the impl serves both `Vec<T>` (Global) and
// `Vec<T, AstAlloc>` (AST-arena lists — `ExprNodeList`/`DeclList`/
// `PropertyList`). `A: Default` lets every constructor produce the right
// allocator without a value in hand; both `Global` and `AstAlloc` are ZSTs
// with `Default`, so `A::default()` is free.
impl<T, A: Allocator + Default + 'static> VecExt<T> for Vec<T, A> {
    #[inline]
    fn init_capacity(n: usize) -> Self {
        Vec::with_capacity_in(n, A::default())
    }
    #[inline]
    fn init_one(value: T) -> Self {
        let mut v = Vec::with_capacity_in(1, A::default());
        v.push(value);
        v
    }
    #[inline]
    fn from_slice(items: &[T]) -> Self
    where
        T: Clone,
    {
        let mut v = Vec::with_capacity_in(items.len(), A::default());
        v.extend_from_slice(items);
        v
    }
    #[inline]
    fn move_from_list(list: Vec<T>) -> Self {
        // Mirror of the `move_to_list` fast-path: when `A == Global` this is a
        // pointer adopt (Zig `moveFromList`, baby_list.zig:46), not a realloc.
        // Hot Global callers: `FileReader`, `ByteStream`, `shell::Cmd`.
        if core::any::TypeId::of::<A>() == core::any::TypeId::of::<std::alloc::Global>() {
            // SAFETY: `A == Global`, so `Vec<T>` and `Vec<T, A>` have identical
            // layout, allocator, and drop semantics.
            let mut list = core::mem::ManuallyDrop::new(list);
            return unsafe {
                Vec::from_raw_parts_in(list.as_mut_ptr(), list.len(), list.capacity(), A::default())
            };
        }
        let mut v = Vec::with_capacity_in(list.len(), A::default());
        v.extend(list);
        v
    }
    #[inline]
    fn from_owned_slice(items: Box<[T]>) -> Self {
        Self::move_from_list(items.into_vec())
    }
    #[inline]
    fn init_with_buffer_vec(buffer: Vec<T>) -> Self {
        Self::move_from_list(buffer)
    }
    #[inline]
    fn from_arena_slice(items: &[T]) -> Self
    where
        T: Copy,
    {
        let mut v = Vec::with_capacity_in(items.len(), A::default());
        v.extend_from_slice(items);
        v
    }
    #[inline]
    fn from_bump_vec(mut src: bun_alloc::ArenaVec<'_, T>) -> Self {
        let len = src.len();
        let mut out = Vec::with_capacity_in(len, A::default());
        // SAFETY:
        // - `src` is the unique owner of `len` initialized `T` at
        //   `src.as_ptr()`.
        // - `out` has `cap >= len` uninit slots at `out.as_mut_ptr()`.
        // - Source/dest are distinct allocations (arena heap vs `A` heap),
        //   so they cannot overlap.
        // After the copy, `out` is the sole logical owner of every `T`; its
        // `Drop` will run their destructors exactly once. `src.set_len(0)`
        // marks the source logically empty so its `Drop` skips element
        // destructors but still frees the buffer back to the `MimallocArena`
        // (real `mi_free`, not a bump no-op) — without this the scratch buffer
        // leaks until arena reset, and the parser's per-node
        // `BumpVec → AstVec` pattern (decls/properties/args/items) turns that
        // into O(nodes) dead arena bytes (≈+11% transpile RSS on a 5.7 MB
        // input). Freeing here makes the scratch slot O(1): mimalloc recycles
        // the same size-class block on the next iteration.
        unsafe {
            core::ptr::copy_nonoverlapping(src.as_ptr(), out.as_mut_ptr(), len);
            out.set_len(len);
            src.set_len(0);
        }
        // Buffer freed via `<&MimallocArena as Allocator>::deallocate` → `mi_free`.
        drop(src);
        out
    }
    #[inline]
    fn init_capacity_in(_arena: &bun_alloc::Arena, cap: usize) -> Self {
        Vec::with_capacity_in(cap, A::default())
    }
    #[inline]
    unsafe fn from_borrowed_slice_dangerous(items: &[T]) -> ManuallyDrop<Self> {
        // SAFETY: caller must never drop or grow the returned `Vec` — its
        // buffer is borrowed.  Same contract as the original.
        ManuallyDrop::new(unsafe {
            Vec::from_raw_parts_in(
                items.as_ptr().cast_mut(),
                items.len(),
                items.len(),
                A::default(),
            )
        })
    }

    #[inline]
    fn slice(&self) -> &[T] {
        self.as_slice()
    }
    #[inline]
    fn slice_mut(&mut self) -> &mut [T] {
        self.as_mut_slice()
    }
    #[inline]
    fn slice_const(&self) -> &[T] {
        self.as_slice()
    }
    #[inline]
    fn at(&self, index: usize) -> &T {
        &self[index]
    }
    #[inline]
    fn mut_(&mut self, index: usize) -> &mut T {
        &mut self[index]
    }
    #[inline]
    fn len_u32(&self) -> u32 {
        self.len() as u32
    }
    #[inline]
    fn cap_u32(&self) -> u32 {
        self.capacity() as u32
    }

    #[inline]
    fn append(&mut self, value: T) {
        self.push(value);
    }
    #[inline]
    fn append_assume_capacity(&mut self, value: T) {
        debug_assert!(self.len() < self.capacity());
        self.push(value);
    }
    #[inline]
    fn append_slice(&mut self, vals: &[T])
    where
        T: Clone,
    {
        self.extend_from_slice(vals);
    }
    #[inline]
    fn append_slice_assume_capacity(&mut self, vals: &[T])
    where
        T: Copy,
    {
        self.extend_from_slice(vals);
    }
    #[inline]
    fn ensure_total_capacity(&mut self, n: usize) {
        let need = n.saturating_sub(self.len());
        self.reserve(need);
    }
    #[inline]
    fn ensure_total_capacity_precise(&mut self, n: usize) {
        let need = n.saturating_sub(self.len());
        self.reserve_exact(need);
    }
    #[inline]
    fn ensure_unused_capacity(&mut self, n: usize) {
        self.reserve(n);
    }
    #[inline]
    fn shrink_retaining_capacity(&mut self, new_len: usize) {
        self.truncate(new_len);
    }
    #[inline]
    fn shrink_and_free(&mut self, new_len: usize) {
        self.truncate(new_len);
        self.shrink_to_fit();
    }
    #[inline]
    fn clear_retaining_capacity(&mut self) {
        self.clear();
    }
    #[inline]
    fn clear_and_free(&mut self) {
        *self = Vec::new_in(A::default());
    }
    #[inline]
    fn drain_front(&mut self, n: usize)
    where
        T: Copy,
    {
        bun_core::vec::drain_front(self, n);
    }
    #[inline]
    fn ordered_remove(&mut self, index: usize) -> T {
        self.remove(index)
    }
    #[inline]
    fn insert_slice(&mut self, index: usize, vals: &[T])
    where
        T: Clone,
    {
        self.splice(index..index, vals.iter().cloned());
    }
    #[inline]
    fn replace_range(&mut self, start: usize, len: usize, new_items: &[T])
    where
        T: Clone,
    {
        self.splice(start..start + len, new_items.iter().cloned());
    }
    #[inline]
    unsafe fn expand_to_capacity(&mut self) {
        // SAFETY: caller contract — every element in `[len, cap)` is written
        // before being observed.
        unsafe { self.set_len(self.capacity()) };
    }
    #[inline]
    fn reserve_spare(&mut self, additional: usize) -> &mut [core::mem::MaybeUninit<T>] {
        self.reserve(additional);
        &mut self.spare_capacity_mut()[..additional]
    }
    #[inline]
    unsafe fn reserve_expand_tail(&mut self, additional: usize) -> (*mut T, usize) {
        let prev = self.len();
        if additional != 0 {
            self.reserve(additional);
        }
        let cap = self.capacity();
        // SAFETY: caller contract — `[prev, cap)` is FFI-written or truncated before any read.
        unsafe { self.set_len(cap) };
        // SAFETY: `prev <= cap`; ptr is within (or one-past) the allocation.
        (unsafe { self.as_mut_ptr().add(prev) }, cap - prev)
    }

    #[inline]
    fn move_to_list(&mut self) -> Vec<T> {
        let taken = core::mem::replace(self, Vec::new_in(A::default()));
        // Fast path: `Vec<T, Global>` → `Vec<T>` is a pointer move, not a
        // realloc+memcpy. Restores zero-copy behavior on the HTTP streaming
        // paths (`RequestContext::response_buf`, `ByteStream`); the copying
        // path is still required for `AstAlloc` etc. where the buffer must
        // migrate heaps.
        if core::any::TypeId::of::<A>() == core::any::TypeId::of::<std::alloc::Global>() {
            // SAFETY: `A == Global`, so `Vec<T, A>` and `Vec<T>` have the
            // same layout, allocator, and drop semantics.
            let mut taken = core::mem::ManuallyDrop::new(taken);
            return unsafe {
                Vec::from_raw_parts(taken.as_mut_ptr(), taken.len(), taken.capacity())
            };
        }
        let mut out = Vec::with_capacity(taken.len());
        out.extend(taken);
        out
    }
    #[inline]
    fn move_to_list_managed(&mut self) -> Vec<T> {
        self.move_to_list()
    }
    #[inline]
    fn to_owned_slice(&mut self) -> Box<[T]> {
        self.move_to_list().into_boxed_slice()
    }

    #[inline]
    fn unused_capacity_slice(&mut self) -> &mut [core::mem::MaybeUninit<T>] {
        self.spare_capacity_mut()
    }
    #[inline]
    fn memory_cost(&self) -> usize {
        self.capacity() * core::mem::size_of::<T>()
    }
    #[inline]
    fn sort_asc(&mut self)
    where
        T: AsRef<[u8]>,
    {
        self.sort_unstable_by(|a, b| a.as_ref().cmp(b.as_ref()));
    }
    #[inline]
    fn sort(&mut self, mut less_than: impl FnMut(&T, &T) -> bool) {
        self.sort_by(|a, b| {
            if less_than(a, b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
    }
    fn deep_clone_with<F>(&self, mut clone_one: F) -> Self
    where
        F: FnMut(&T) -> T,
    {
        let mut v = Vec::with_capacity_in(self.len(), A::default());
        for item in self.iter() {
            v.push(clone_one(item));
        }
        v
    }
    fn try_deep_clone_with<F, E>(&self, mut clone_one: F) -> Result<Self, E>
    where
        F: FnMut(&T) -> Result<T, E>,
        E: From<AllocError>,
    {
        let mut v = Vec::with_capacity_in(self.len(), A::default());
        for item in self.iter() {
            v.push(clone_one(item)?);
        }
        Ok(v)
    }
}

/// `Vec<u8>`-only helpers (Zig `Vec(u8)` extension methods).
pub trait ByteVecExt {
    fn append_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), AllocError>;
    fn write(&mut self, str: &[u8]) -> Result<u32, AllocError>;
    fn write_latin1(&mut self, str: &[u8]) -> Result<u32, AllocError>;
    fn write_utf16(&mut self, str: &[u16]) -> Result<u32, AllocError>;

    /// libuv `uv_alloc_cb`-style: ensure **at least** `suggested` bytes of
    /// spare capacity past `len()`, then return the *full* spare-capacity
    /// slice (`len == capacity - len()`, which may exceed `suggested`).
    ///
    /// Callers that must hand libuv exactly `suggested` bytes slice the
    /// result themselves: `&mut v.uv_alloc_spare(n)[..n]`. For a `&mut [u8]`
    /// view (libuv `uv_buf_t` / `read(2)` target), call
    /// [`bun_core::vec::reserve_spare_bytes`] / [`bun_core::vec::commit_spare`]
    /// directly.
    fn uv_alloc_spare(&mut self, suggested: usize) -> &mut [core::mem::MaybeUninit<u8>];
}

impl ByteVecExt for Vec<u8> {
    fn append_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), AllocError> {
        use std::io::Write;
        write!(self, "{}", args).map_err(|_| AllocError)
    }
    fn write(&mut self, str: &[u8]) -> Result<u32, AllocError> {
        let initial = self.len();
        self.extend_from_slice(str);
        Ok((self.len() - initial) as u32)
    }
    fn write_latin1(&mut self, str: &[u8]) -> Result<u32, AllocError> {
        let initial = self.len();
        let old = core::mem::take(self);
        let old_len = old.len();
        *self = strings::allocate_latin1_into_utf8_with_list(old, old_len, str);
        Ok((self.len() - initial) as u32)
    }
    fn write_utf16(&mut self, str: &[u16]) -> Result<u32, AllocError> {
        let initial = self.len();
        let estimate = if (self.capacity() - self.len()) <= (str.len() * 3 + 2) {
            bun_simdutf_sys::simdutf::length::utf8::from::utf16::le(str)
        } else {
            str.len()
        };
        self.reserve(estimate);
        strings::convert_utf16_to_utf8_append(self, str);
        Ok((self.len() - initial) as u32)
    }
    #[inline]
    fn uv_alloc_spare(&mut self, suggested: usize) -> &mut [core::mem::MaybeUninit<u8>] {
        // `Vec::reserve` already amortises by doubling, so a plain
        // `reserve(suggested)` suffices — no manual `cap - len < suggested`
        // dance is needed (it short-circuits internally).
        self.reserve(suggested);
        self.spare_capacity_mut()
    }
}

impl crate::pool::ObjectPoolType for Vec<u8> {
    const INIT: Option<fn() -> Result<Self, bun_core::Error>> = Some(|| Ok(Vec::new()));
    #[inline]
    fn reset(&mut self) {
        self.clear();
    }
}

#[derive(Default)]
pub struct OffsetByteList {
    pub head: u32,
    pub byte_list: Vec<u8>,
}

impl OffsetByteList {
    pub fn init(head: u32, byte_list: Vec<u8>) -> Self {
        Self { head, byte_list }
    }

    pub fn write(&mut self, bytes: &[u8]) -> Result<(), AllocError> {
        self.byte_list.extend_from_slice(bytes);
        Ok(())
    }

    pub fn slice(&self) -> &[u8] {
        &self.byte_list[..self.head as usize]
    }

    pub fn remaining(&self) -> &[u8] {
        &self.byte_list[self.head as usize..]
    }

    pub fn consume(&mut self, bytes: u32) {
        self.head = self.head.saturating_add(bytes);
        if self.head as usize >= self.byte_list.len() {
            self.head = 0;
            self.byte_list.clear();
        }
    }

    pub fn len(&self) -> u32 {
        self.byte_list.len() as u32 - self.head
    }

    pub fn clear(&mut self) {
        self.head = 0;
        self.byte_list.clear();
    }

    pub fn clear_and_free(&mut self) {
        // Drop on the taken value frees `byte_list`; nothing is reused.
        drop(core::mem::take(self));
    }
}

/// Bitwise-move every element of `src` to the **front** of `dst`, shifting
/// `dst`'s existing contents right by `src.len()`. `src` is left empty
/// (capacity retained). This is the mirror of std [`Vec::append`], which
/// moves to the back.
///
/// Free function (not a `VecExt` method) so it is generic over *any*
/// `A: Allocator` — the `VecExt` blanket impl carries an
/// `A: Default + 'static` bound that `&'a MimallocArena` (i.e.
/// [`bun_alloc::ArenaVec`]) does not satisfy. `src` and `dst` may use
/// distinct allocators.
pub fn prepend_from<T, A: Allocator, B: Allocator>(dst: &mut Vec<T, A>, src: &mut Vec<T, B>) {
    if src.is_empty() {
        return;
    }
    // `Drain<'_, T, B>` is `ExactSizeIterator`, so `splice` reserves once and
    // shifts the existing tail with a single memmove.
    dst.splice(0..0, src.drain(..));
}
