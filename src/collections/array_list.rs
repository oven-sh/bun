//! Managed `ArrayList` wrappers.
//!
//! PORT NOTE: The Zig original wraps `std.ArrayListAlignedUnmanaged` to add two things:
//!   1. A stored allocator (managed vs unmanaged split).
//!   2. "Deep" semantics — `deinit`/`clear`/`shrink`/`replaceRange` call `deinit` on each
//!      removed item, with `*Shallow` variants that skip that.
//!
//! In Rust, (1) disappears entirely — `Vec<T>` uses the global mimalloc allocator and the
//! `Allocator` type parameter is dropped per §Allocators in PORTING.md. (2) is the *default*
//! behavior of `Vec<T>`: removing/dropping elements runs their `Drop`. So the "deep" methods
//! map to ordinary `Vec` operations and the `*_shallow` variants are the ones that need
//! special handling (they must leak/forget the removed elements).

use core::mem;

use bun_alloc::AllocError;

use super::vec_ext::VecExt;

/// Managed `ArrayList` using an arbitrary allocator.
/// Prefer using a concrete type, like `ArrayListDefault`.
///
/// NOTE: Unlike Zig's `std.ArrayList`, dropping this type runs `Drop` on each of the items.
// PORT NOTE: `std.mem.Allocator` type param dropped — global mimalloc (non-AST crate).
pub type ArrayList<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayList` using the default allocator. No overhead compared to an unmanaged
/// `ArrayList`.
///
/// NOTE: Unlike Zig's `std.ArrayList`, dropping this type runs `Drop` on each of the items.
// PORT NOTE: `bun.DefaultAllocator` type param dropped — global mimalloc.
pub type ArrayListDefault<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayList` using a specific kind of allocator.
///
/// NOTE: Unlike Zig's `std.ArrayList`, dropping this type runs `Drop` on each of the items.
// PORT NOTE: `Allocator` type param dropped — global mimalloc.
pub type ArrayListIn<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayListAligned` using an arbitrary allocator.
///
/// NOTE: Unlike Zig's `std.ArrayList`, dropping this type runs `Drop` on each of the items.
// TODO(port): const-generic alignment param. Rust `Vec<T>` uses `align_of::<T>()` and has no
// over-alignment knob; if any caller passes a non-null `alignment`, that call site needs a
// `#[repr(align(N))]` newtype wrapper around `T` instead.
pub type ArrayListAligned<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayListAligned` using the default allocator.
///
/// NOTE: Unlike Zig's `std.ArrayList`, dropping this type runs `Drop` on each of the items.
pub type ArrayListAlignedDefault<T> = ArrayListAlignedIn<T>;

/// Managed `ArrayListAligned` using a specific kind of allocator.
///
/// NOTE: Unlike Zig's `std.ArrayList`, dropping this type runs `Drop` on each of the items.
// PORT NOTE: Zig's `fn(...) type` factory → generic struct (PORTING.md §Idiom map).
// Allocator type param dropped; alignment param dropped (see ArrayListAligned TODO above).
#[derive(Default)]
pub struct ArrayListAlignedIn<T> {
    /// Zig: `#unmanaged: Unmanaged = .empty`
    unmanaged: Unmanaged<T>,
    // Zig: `#std.mem.Allocator param` — dropped (global mimalloc).
}

/// Zig: `Unmanaged = std.ArrayListAlignedUnmanaged(T, alignment)`
pub type Unmanaged<T> = Vec<T>;

/// Zig: `Slice = Unmanaged.Slice` (= `[]align(alignment) T`, an owned slice when detached).
// TODO(port): Zig `Slice` is used both as a borrow (`items()`) and as an owned return
// (`toOwnedSlice`). Rust splits these: borrows are `&[T]`/`&mut [T]`, owned is `Box<[T]>`.
pub type Slice<T> = Box<[T]>;

// TODO(port): `SentinelSlice` — sentinel-terminated slices have no std Rust equivalent; only
// needed if a caller uses `fromOwnedSliceSentinel`. Map to `bun_core::ZStr`/`WStr` at call site.

impl<T> ArrayListAlignedIn<T> {
    pub fn items(&self) -> &[T] {
        self.unmanaged.as_slice()
    }

    // PORT NOTE: Zig `items()` returns a mutable `[]T`; Rust splits const/mut borrows.
    pub fn items_mut(&mut self) -> &mut [T] {
        self.unmanaged.as_mut_slice()
    }

    pub fn capacity(&self) -> usize {
        self.unmanaged.capacity()
    }

    pub fn init() -> Self {
        // Zig: `.initIn(bun.memory.initDefault(Allocator))` — allocator dropped.
        Self::init_in()
    }

    pub fn init_in(/* allocator dropped */) -> Self {
        Self {
            unmanaged: Vec::new(),
        }
    }

    pub fn init_capacity(num: usize) -> Result<Self, AllocError> {
        Self::init_capacity_in(num)
    }

    pub fn init_capacity_in(num: usize /* allocator dropped */) -> Result<Self, AllocError> {
        // Zig: `try .initCapacity(bun.allocators.asStd(allocator_), num)`
        // PERF(port): Vec::with_capacity aborts on OOM rather than returning Err — Phase B may
        // swap to `Vec::try_with_capacity` (nightly) or a fallible wrapper if OOM recovery matters.
        Ok(Self {
            unmanaged: Vec::with_capacity(num),
        })
    }

    // Zig `pub fn deinit` → `impl Drop` (see below). Body only deinits items + frees backing,
    // both of which `Vec<T>`'s `Drop` already does, so no explicit `Drop` impl is needed.

    /// Frees the backing allocation **without** running `Drop` on the items.
    pub fn deinit_shallow(mut self) {
        // Zig: `self.#unmanaged.deinit(...)` after the deep `deinit` already consumed items.
        // SAFETY: leaking the logical elements; capacity is still freed by Vec's Drop.
        unsafe { self.unmanaged.set_len(0) };
        // `self.unmanaged` dropped here → frees capacity, drops zero items.
        // Zig also `bun.memory.deinit(&self.#allocator)` — allocator dropped, nothing to do.
    }

    pub fn from_owned_slice(slice: Slice<T>) -> Self {
        Self {
            unmanaged: Vec::from(slice),
        }
    }

    // TODO(port): `from_owned_slice_sentinel` — sentinel-terminated owned slices are not a Rust
    // type. If needed, accept `Box<[T]>` with the sentinel already stripped, or `ZStr`/`WStr`.
    pub fn from_owned_slice_sentinel(/* sentinel: T, */ slice: Slice<T>) -> Self {
        Self {
            unmanaged: Vec::from(slice),
        }
    }

    // TODO(port): `writer()` — Zig returns an `std.io.Writer` that appends bytes. For `T = u8`
    // this is `impl std::io::Write for Vec<u8>` (already in std). For other `T` there is no
    // meaningful writer. Expose only on `ArrayListAlignedIn<u8>` in Phase B.
    pub fn writer(&mut self) -> &mut Vec<T> {
        &mut self.unmanaged
    }

    /// This method empties `self`.
    pub fn move_to_unmanaged(&mut self) -> Unmanaged<T> {
        // Zig: `defer self.#unmanaged = .empty; return self.#unmanaged;`
        mem::take(&mut self.unmanaged)
    }

    /// Unlike `move_to_unmanaged`, this method *consumes* `self`.
    pub fn into_unmanaged_with_allocator(self) -> (Unmanaged<T>, ()) {
        // Zig: returns `(Unmanaged, Allocator)`; allocator dropped → unit.
        (self.unmanaged, ())
    }

    /// The contents of `unmanaged` must have been allocated by the global allocator.
    /// This function takes ownership of `unmanaged`.
    pub fn from_unmanaged(unmanaged: Unmanaged<T>) -> Self {
        Self { unmanaged }
    }

    pub fn to_owned_slice(self) -> Result<Slice<T>, AllocError> {
        // Zig: `self.#unmanaged.toOwnedSlice(...)` — shrinks cap→len then returns the slice.
        Ok(self.unmanaged.into_boxed_slice())
    }

    /// Creates a copy of this `ArrayList` with copies of its items.
    ///
    /// PORT NOTE: Zig makes *bitwise* (shallow) copies regardless of whether `T` has a
    /// `deinit`. Rust cannot bit-copy a non-`Copy` `T` safely. This is bound on `T: Clone`;
    /// callers that relied on shallow-copy-then-`deinitShallow` need a redesign.
    pub fn clone(&self) -> Result<Self, AllocError>
    where
        T: Clone,
    {
        self.clone_in()
    }

    /// Creates a copy of this `ArrayList` with copies of its items.
    pub fn clone_in(&self /* allocator dropped */) -> Result<Self, AllocError>
    where
        T: Clone,
    {
        Ok(Self {
            unmanaged: self.unmanaged.clone(),
        })
    }

    pub fn insert(&mut self, i: usize, item: T) -> Result<(), AllocError> {
        self.unmanaged.insert(i, item);
        Ok(())
    }

    pub fn insert_assume_capacity(&mut self, i: usize, item: T) {
        // PERF(port): was assume_capacity — profile in Phase B.
        self.unmanaged.insert(i, item);
    }

    /// Note that this creates *shallow* copies of `value`.
    pub fn add_many_at(
        &mut self,
        index: usize,
        value: T,
        count: usize,
    ) -> Result<&mut [T], AllocError>
    where
        T: Clone,
    {
        // Zig: `addManyAt` reserves `count` uninit slots at `index`, then `@memset(result, value)`.
        self.unmanaged
            .splice(index..index, core::iter::repeat_n(value, count));
        Ok(&mut self.unmanaged[index..index + count])
    }

    /// Note that this creates *shallow* copies of `value`.
    pub fn add_many_at_assume_capacity(&mut self, index: usize, value: T, count: usize) -> &mut [T]
    where
        T: Clone,
    {
        // PERF(port): was assume_capacity — profile in Phase B.
        self.unmanaged
            .splice(index..index, core::iter::repeat_n(value, count));
        &mut self.unmanaged[index..index + count]
    }

    /// This method takes ownership of all elements in `new_items`.
    pub fn insert_slice(&mut self, index: usize, new_items: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // TODO(port): Zig takes `[]const T` and bit-copies, transferring ownership. Rust must
        // `Clone` from a borrowed slice. If callers own the data, change signature to
        // `impl IntoIterator<Item = T>` in Phase B to avoid the clone.
        self.unmanaged
            .splice(index..index, new_items.iter().cloned());
        Ok(())
    }

    /// This method `Drop`s the removed items.
    /// This method takes ownership of all elements in `new_items`.
    pub fn replace_range(
        &mut self,
        start: usize,
        len: usize,
        new_items: &[T],
    ) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // PORT NOTE: Zig deinits `items[start..start+len]` then calls the shallow path.
        // `Vec::splice` already drops the removed range, so deep == direct splice.
        self.replace_range_shallow_impl::<true>(start, len, new_items)
    }

    /// This method does *not* `Drop` the removed items.
    /// This method takes ownership of all elements in `new_items`.
    pub fn replace_range_shallow(
        &mut self,
        start: usize,
        len: usize,
        new_items: &[T],
    ) -> Result<(), AllocError>
    where
        T: Clone,
    {
        self.replace_range_shallow_impl::<false>(start, len, new_items)
    }

    fn replace_range_shallow_impl<const DROP_REMOVED: bool>(
        &mut self,
        start: usize,
        len: usize,
        new_items: &[T],
    ) -> Result<(), AllocError>
    where
        T: Clone,
    {
        let removed = self
            .unmanaged
            .splice(start..start + len, new_items.iter().cloned());
        if DROP_REMOVED {
            drop(removed);
        } else {
            removed.for_each(mem::forget);
        }
        Ok(())
    }

    /// This method `Drop`s the removed items.
    /// This method takes ownership of all elements in `new_items`.
    pub fn replace_range_assume_capacity(&mut self, start: usize, len: usize, new_items: &[T])
    where
        T: Clone,
    {
        // PERF(port): was assume_capacity — profile in Phase B.
        // Zig: loop `bun.memory.deinit(item)` over the removed range, then shallow replace.
        let _ = self.replace_range_shallow_impl::<true>(start, len, new_items);
    }

    /// This method does *not* `Drop` the removed items.
    /// This method takes ownership of all elements in `new_items`.
    pub fn replace_range_assume_capacity_shallow(
        &mut self,
        start: usize,
        len: usize,
        new_items: &[T],
    ) where
        T: Clone,
    {
        // PERF(port): was assume_capacity — profile in Phase B.
        let _ = self.replace_range_shallow_impl::<false>(start, len, new_items);
    }

    pub fn append(&mut self, item: T) -> Result<(), AllocError> {
        self.unmanaged.push(item);
        Ok(())
    }

    pub fn append_assume_capacity(&mut self, item: T) {
        // PERF(port): was assume_capacity — profile in Phase B.
        self.unmanaged.push(item);
    }

    pub fn ordered_remove(&mut self, i: usize) -> T {
        self.unmanaged.remove(i)
    }

    pub fn swap_remove(&mut self, i: usize) -> T {
        self.unmanaged.swap_remove(i)
    }

    /// This method takes ownership of all elements in `new_items`.
    pub fn append_slice(&mut self, new_items: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // TODO(port): see `insert_slice` note re: Clone vs ownership transfer.
        self.unmanaged.extend_from_slice(new_items);
        Ok(())
    }

    /// This method takes ownership of all elements in `new_items`.
    pub fn append_slice_assume_capacity(&mut self, new_items: &[T])
    where
        T: Clone,
    {
        // PERF(port): was assume_capacity — profile in Phase B.
        self.unmanaged.extend_from_slice(new_items);
    }

    /// This method takes ownership of all elements in `new_items`.
    pub fn append_unaligned_slice(&mut self, new_items: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // TODO(port): Zig `[]align(1) const T` allows reading T from an under-aligned address.
        // Rust `&[T]` is always naturally aligned. If a caller truly has unaligned bytes, it
        // needs `ptr::read_unaligned` at the call site. Treat as aligned here.
        self.unmanaged.extend_from_slice(new_items);
        Ok(())
    }

    /// This method takes ownership of all elements in `new_items`.
    pub fn append_unaligned_slice_assume_capacity(&mut self, new_items: &[T])
    where
        T: Clone,
    {
        // PERF(port): was assume_capacity — profile in Phase B.
        self.unmanaged.extend_from_slice(new_items);
    }

    /// Note that this creates *shallow* copies of `value`.
    #[inline]
    pub fn append_n_times(&mut self, value: T, n: usize) -> Result<(), AllocError>
    where
        T: Clone,
    {
        self.unmanaged.extend(core::iter::repeat_n(value, n));
        Ok(())
    }

    /// Note that this creates *shallow* copies of `value`.
    #[inline]
    pub fn append_n_times_assume_capacity(&mut self, value: T, n: usize)
    where
        T: Clone,
    {
        // PERF(port): was assume_capacity — profile in Phase B.
        self.unmanaged.extend(core::iter::repeat_n(value, n));
    }

    /// If `new_len` is less than the current length, this method will `Drop` the removed items.
    ///
    /// If `new_len` is greater than the current length, note that this creates copies of
    /// `init_value`.
    pub fn resize(&mut self, init_value: T, new_len: usize) -> Result<(), AllocError>
    where
        T: Clone,
    {
        // PORT NOTE: Zig calls `resizeWithoutDeinit` first, *then* deinits the tail via a raw
        // pointer past `len` (`items().ptr[new_len..len]`). That ordering is to avoid a failed
        // realloc leaving already-deinited items in the list. `Vec::resize` already drops the
        // truncated tail in the shrink case and never fails, so the ordering concern vanishes.
        self.unmanaged.resize(new_len, init_value);
        Ok(())
    }

    /// If `new_len` is less than the current length, this method will *not* `Drop` the removed
    /// items.
    ///
    /// If `new_len` is greater than the current length, note that this creates copies of
    /// `init_value`.
    pub fn resize_without_deinit(&mut self, init_value: T, new_len: usize) -> Result<(), AllocError>
    where
        T: Clone,
    {
        let len = self.unmanaged.len();
        if new_len > len {
            self.unmanaged.resize(new_len, init_value);
        } else {
            // SAFETY: new_len <= len; elements in [new_len, len) are leaked intentionally.
            unsafe { self.unmanaged.set_len(new_len) };
        }
        Ok(())
    }

    /// This method `Drop`s the removed items.
    pub fn shrink_and_free(&mut self, new_len: usize) {
        self.prepare_for_deep_shrink(new_len);
        // PORT NOTE: `prepare_for_deep_shrink` already truncated (dropping items); now free.
        self.unmanaged.shrink_to_fit();
    }

    /// This method does *not* `Drop` the removed items.
    pub fn shrink_and_free_shallow(&mut self, new_len: usize) {
        // SAFETY: caller asserts new_len <= len; leaked elements are intentionally not dropped.
        unsafe { self.unmanaged.set_len(new_len) };
        self.unmanaged.shrink_to_fit();
    }

    /// This method `Drop`s the removed items.
    pub fn shrink_retaining_capacity(&mut self, new_len: usize) {
        self.prepare_for_deep_shrink(new_len);
        // `truncate` inside `prepare_for_deep_shrink` already retained capacity.
    }

    /// This method does *not* `Drop` the removed items.
    pub fn shrink_retaining_capacity_shallow(&mut self, new_len: usize) {
        // SAFETY: caller asserts new_len <= len; leaked elements are intentionally not dropped.
        unsafe { self.unmanaged.set_len(new_len) };
    }

    /// This method `Drop`s all items.
    pub fn clear_retaining_capacity(&mut self) {
        // Zig: `bun.memory.deinit(self.items()); self.clearRetainingCapacityShallow();`
        // `Vec::clear` drops all items and retains capacity — exactly the deep semantics.
        self.unmanaged.clear();
    }

    /// This method does *not* `Drop` any items.
    pub fn clear_retaining_capacity_shallow(&mut self) {
        // SAFETY: intentionally leaking all elements.
        unsafe { self.unmanaged.set_len(0) };
    }

    /// This method `Drop`s all items.
    pub fn clear_and_free(&mut self) {
        // Zig: `bun.memory.deinit(self.items()); self.clearAndFreeShallow();`
        self.unmanaged = Vec::new();
    }

    /// This method does *not* `Drop` any items.
    pub fn clear_and_free_shallow(&mut self) {
        // SAFETY: intentionally leaking all elements before freeing capacity.
        unsafe { self.unmanaged.set_len(0) };
        self.unmanaged = Vec::new();
    }

    pub fn ensure_total_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        self.unmanaged.ensure_total_capacity(new_capacity);
        Ok(())
    }

    pub fn ensure_total_capacity_precise(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        self.unmanaged.ensure_total_capacity_precise(new_capacity);
        Ok(())
    }

    pub fn ensure_unused_capacity(&mut self, additional_count: usize) -> Result<(), AllocError> {
        self.unmanaged.ensure_unused_capacity(additional_count);
        Ok(())
    }

    /// Note that this creates copies of `init_value`.
    pub fn expand_to_capacity(&mut self, init_value: T)
    where
        T: Clone,
    {
        let len = self.unmanaged.len();
        let cap = self.unmanaged.capacity();
        // Zig: `self.#unmanaged.expandToCapacity(); @memset(self.items()[len..], init_value);`
        self.unmanaged
            .extend(core::iter::repeat_n(init_value, cap - len));
        debug_assert_eq!(self.unmanaged.len(), cap);
    }

    pub fn pop(&mut self) -> Option<T> {
        self.unmanaged.pop()
    }

    pub fn get_last(&self) -> &T {
        // Zig: `&items_[items_.len - 1]` — panics on empty, same as `[len-1]` here.
        let items = self.items();
        &items[items.len() - 1]
    }

    // PORT NOTE: Zig returns `*T` (mutable) from a `*const Self` receiver via interior aliasing.
    // Rust splits this into `&T` / `&mut T` accessors.
    pub fn get_last_mut(&mut self) -> &mut T {
        let len = self.unmanaged.len();
        &mut self.unmanaged[len - 1]
    }

    pub fn get_last_or_null(&self) -> Option<&T> {
        if self.is_empty() {
            None
        } else {
            Some(self.get_last())
        }
    }

    pub fn is_empty(&self) -> bool {
        self.items().is_empty()
    }

    fn prepare_for_deep_shrink(&mut self, new_len: usize) {
        let items_len = self.unmanaged.len();
        debug_assert!(
            new_len <= items_len,
            "new_len ({new_len}) cannot exceed current len ({items_len})",
        );
        // Zig: `bun.memory.deinit(items_[new_len..])` — drop the tail in place.
        // `Vec::truncate` does exactly that and keeps capacity.
        self.unmanaged.truncate(new_len);
    }

    // Zig `getStdAllocator` — dropped (no allocator field).
}

// PORT NOTE: Zig `pub fn deinit` → `impl Drop`. The Zig body is
//   `bun.memory.deinit(self.items()); self.deinitShallow();`
// i.e. drop every item, then free the backing buffer. `Vec<T>`'s own `Drop` does both, so per
// PORTING.md ("If the body only frees/deinits owned fields, delete the body entirely") no
// explicit `impl Drop for ArrayListAlignedIn<T>` is written.

// ported from: src/collections/array_list.zig
