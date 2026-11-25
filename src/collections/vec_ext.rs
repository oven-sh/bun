//! `VecExt` / `ByteVecExt` — extension method vocabulary on `Vec<T>`.
//!
//! Migration shim from the deleted `BabyList<T>` (see
//! `docs/BABYLIST_REPLACEMENT.md`): every former `BabyList<T>` site is now a
//! plain `Vec<T>`, and these traits supply the legacy method names (`.slice()`,
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

use bun_alloc::AllocError;
use bun_core::strings;

/// Empties `list` and returns its allocation, for `U` = `T` with another lifetime. std collects this in place.
pub fn recycle_vec<T, U>(mut list: Vec<T>) -> Vec<U> {
    const { assert!(size_of::<T>() == size_of::<U>() && align_of::<T>() == align_of::<U>()) };
    list.clear();
    list.into_iter().map(|_| unreachable!()).collect()
}

pub trait VecExt<T>: Sized {
    // ── constructors ──────────────────────────────────────────────────────
    fn init_capacity(n: usize) -> Self;
    fn init_one(value: T) -> Self;
    fn from_slice(items: &[T]) -> Self
    where
        T: Clone;
    /// Copies `items` into a fresh `A` allocation.
    fn from_arena_slice(items: &[T]) -> Self
    where
        T: Copy;
    /// Moves the elements of `v` into a fresh `A` allocation and frees `v`'s arena buffer.
    fn from_bump_vec(v: bun_alloc::ArenaVec<'_, T>) -> Self;

    // ── accessors ─────────────────────────────────────────────────────────
    fn slice(&self) -> &[T];
    fn slice_mut(&mut self) -> &mut [T];
    fn slice_const(&self) -> &[T];
    fn at(&self, index: usize) -> &T;
    fn mut_(&mut self, index: usize) -> &mut T;
    /// `.len` field access (old struct stored a `u32`); kept for sites that did
    /// arithmetic on the raw `u32`.
    fn len_u32(&self) -> u32;

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
    fn ensure_unused_capacity(&mut self, n: usize);
    fn shrink_retaining_capacity(&mut self, new_len: usize);
    fn clear_retaining_capacity(&mut self);
    fn clear_and_free(&mut self);
    /// Drop the first `n` elements in place via `copy_within(n.., 0)` +
    /// `truncate` (capacity retained). `n == 0` is a no-op; `n >= len`
    /// degenerates to `clear()`. See [`bun_core::vec::drain_front`].
    fn drain_front(&mut self, n: usize)
    where
        T: Copy;
    fn ordered_remove(&mut self, index: usize) -> T;
    /// Reserves `additional` and returns that many slots of spare capacity. The
    /// caller writes some prefix then calls `set_len` (or [`uv_commit`] for
    /// `Vec<u8>`) to commit. Unlike `spare_capacity_mut()` the returned slice
    /// is exactly `additional` long, not `capacity - len`.
    fn reserve_spare(&mut self, additional: usize) -> &mut [core::mem::MaybeUninit<T>];

    fn memory_cost(&self) -> usize;
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
impl<T, A: Allocator + Default> VecExt<T> for Vec<T, A> {
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
    fn ensure_unused_capacity(&mut self, n: usize) {
        self.reserve(n);
    }
    #[inline]
    fn shrink_retaining_capacity(&mut self, new_len: usize) {
        self.truncate(new_len);
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
    fn reserve_spare(&mut self, additional: usize) -> &mut [core::mem::MaybeUninit<T>] {
        self.reserve(additional);
        &mut self.spare_capacity_mut()[..additional]
    }

    #[inline]
    fn memory_cost(&self) -> usize {
        self.capacity() * core::mem::size_of::<T>()
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

/// `Vec<u8>`-only helpers.
pub trait ByteVecExt {
    fn append_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), AllocError>;
    fn write(&mut self, str: &[u8]) -> Result<u32, AllocError>;
    fn write_latin1(&mut self, str: &[u8]) -> Result<u32, AllocError>;
    fn write_utf16(&mut self, str: &[u16]) -> Result<u32, AllocError>;

    /// `suggested` bytes of spare capacity for libuv to read into.
    fn uv_alloc_spare(&mut self, suggested: usize) -> *mut [u8];
    /// Commit `nread` bytes that the FFI/syscall just wrote into the slice
    /// returned by [`uv_alloc_spare`]: bumps `len` by `nread`. Debug-asserts `len + nread <= capacity`.
    ///
    /// # Safety
    /// The `nread` bytes at `[len, len + nread)` must have been initialised by
    /// the preceding write into the spare slice.
    unsafe fn uv_commit(&mut self, nread: usize);
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
        strings::convert_utf16_to_utf8_append(self, str);
        Ok((self.len() - initial) as u32)
    }
    #[inline]
    fn uv_alloc_spare(&mut self, suggested: usize) -> *mut [u8] {
        self.reserve(suggested);
        &raw mut self.spare_capacity_mut()[..suggested] as *mut [u8]
    }
    #[inline]
    unsafe fn uv_commit(&mut self, nread: usize) {
        // SAFETY: caller contract on `uv_commit` — `[len, len+nread)` was
        // initialised by the preceding write into the spare slice.
        unsafe { bun_core::vec::commit_spare(self, nread) }
    }
}

impl crate::pool::ObjectPoolType for Vec<u8> {
    fn init() -> Self {
        Vec::new()
    }
    #[inline]
    fn reset(&mut self) {
        self.clear();
    }
}

#[derive(Default)]
pub struct OffsetByteList {
    pub head: usize,
    pub byte_list: Vec<u8>,
}

impl OffsetByteList {
    pub fn write(&mut self, bytes: &[u8]) -> Result<(), AllocError> {
        self.byte_list.extend_from_slice(bytes);
        Ok(())
    }

    pub fn remaining(&self) -> &[u8] {
        &self.byte_list[self.head..]
    }

    pub fn consume(&mut self, bytes: usize) {
        self.head = self.head.saturating_add(bytes);
        let head = self.head;
        if head >= self.byte_list.len() {
            self.head = 0;
            self.byte_list.clear();
        } else if head >= self.byte_list.len() - head {
            let new_len = self.byte_list.len() - head;
            self.byte_list.copy_within(head.., 0);
            self.byte_list.truncate(new_len);
            self.head = 0;
        }
    }

    pub fn len(&self) -> usize {
        self.byte_list.len() - self.head
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear_and_free(&mut self) {
        // Drop on the taken value frees `byte_list`; nothing is reused.
        drop(core::mem::take(self));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recycle_vec_keeps_the_allocation() {
        let bytes = [1u8, 2];
        let mut list: Vec<&[u8]> = Vec::with_capacity(8);
        list.push(&bytes);
        let before = (list.as_ptr().addr(), list.capacity());
        let list: Vec<&'static [u8]> = recycle_vec(list);
        assert!(list.is_empty());
        assert_eq!((list.as_ptr().addr(), list.capacity()), before);
    }
}
