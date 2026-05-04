//! Port of `std.MultiArrayList` with the following Bun-specific additions:
//!
//! * `zero` method to zero-initialize memory.
//! * `memory_cost` method, which returns the memory usage in bytes.
//!
//! Synchronized with std as of Zig 0.14.1.
//!
//! A MultiArrayList stores a list of a struct or tagged union type.
//! Instead of storing a single list of items, MultiArrayList stores separate
//! lists for each field of the struct (or lists of tags and bare unions).
//! This allows for memory savings if the struct or union has padding, and also
//! improves cache usage if only some fields or just tags are needed for a
//! computation. The primary API for accessing fields is the `slice()`
//! function, which computes the start pointers for the array of each field.
//! From the slice you can call `.items(.<field_name>)` to obtain a slice of
//! field values. For unions you can call `.items(.tags)` or `.items(.data)`.

use core::alloc::Layout;
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ptr;
use std::alloc;

use bun_alloc::AllocError;

// TODO(port): Zig's MultiArrayList uses `@typeInfo(T)` / `meta.fields(Elem)` /
// `@field` pervasively to iterate struct fields at comptime. Rust has no
// reflection, so element types must implement `MultiArrayElement` (intended to
// be `#[derive(MultiArrayElement)]`-able in Phase B). The trait surfaces the
// per-field metadata the Zig computed via reflection, and the scatter/gather
// hooks replace `inline for (fields) |f| @field(elem, f.name) = ...`.
//
// The Zig also special-cases `union(enum)` by synthesizing an `Elem` struct
// `{ tags: Tag, data: Bare }`. In Rust the derive emits that wrapper directly,
// so the container itself only deals with the struct case.
// TODO(port): proc-macro `#[derive(MultiArrayElement)]`.

/// Trait providing the comptime field metadata that Zig obtained via
/// `@typeInfo` / `meta.fields`. Implemented (typically via derive) for every
/// `T` stored in a `MultiArrayList<T>`.
pub trait MultiArrayElement: Sized {
    /// Enum naming each field of `Self` (Zig: `meta.FieldEnum(Elem)`).
    /// Must be `#[repr(usize)]` so `as usize` yields the field index.
    type Field: Copy;

    /// Number of fields (Zig: `fields.len`).
    const FIELD_COUNT: usize;

    /// `@alignOf(Elem)` — alignment of the backing byte buffer.
    const ALIGN: usize;

    /// `sizes.bytes` — `@sizeOf` of each field, sorted by alignment descending.
    /// Length is `FIELD_COUNT`.
    const SIZES_BYTES: &'static [usize];

    /// `sizes.fields` — mapping from `SIZES_BYTES` index to field index.
    /// Length is `FIELD_COUNT`.
    const SIZES_FIELDS: &'static [usize];

    /// `field as usize` (Zig: `@intFromEnum(field)`).
    fn field_index(field: Self::Field) -> usize;

    /// Scatter `self`'s fields into the per-field column pointers at `index`.
    /// Replaces Zig's `inline for (fields) |f, i| ptrs[i][index] = @field(e, f.name)`.
    ///
    /// # Safety
    /// `ptrs` must contain `FIELD_COUNT` valid column pointers each with
    /// capacity > `index` for their respective field type.
    unsafe fn scatter(self, ptrs: &[*mut u8], index: usize);

    /// Gather a `Self` from the per-field column pointers at `index`.
    /// Replaces Zig's `inline for (fields) |f, i| @field(result, f.name) = ptrs[i][index]`.
    ///
    /// # Safety
    /// Same as `scatter`.
    unsafe fn gather(ptrs: &[*mut u8], index: usize) -> Self;
}

/// Index-based comparison context for `sort` / `sort_span` / `sort_unstable`.
/// Zig: `ctx: anytype` with `fn lessThan(ctx, a_index: usize, b_index: usize) bool`.
pub trait SortContext {
    fn less_than(&self, a_index: usize, b_index: usize) -> bool;
}

#[derive(Clone, Copy, core::marker::ConstParamTy, PartialEq, Eq)]
enum SortMode {
    Stable,
    Unstable,
}

/// Struct-of-arrays list. See module docs.
pub struct MultiArrayList<T: MultiArrayElement> {
    bytes: *mut u8,
    len: usize,
    capacity: usize,
    // Zig `#allocator: bun.safety.CheckedAllocator` dropped — global mimalloc.
    _marker: PhantomData<T>,
}

/// A `MultiArrayList::Slice` contains cached start pointers for each field in
/// the list. These pointers are not normally stored to reduce the size of the
/// list in memory. If you are accessing multiple fields, call `slice()` first
/// to compute the pointers, and then get the field arrays from the slice.
pub struct Slice<T: MultiArrayElement> {
    /// This array is indexed by the field index which can be obtained
    /// by using `T::field_index()` on the Field enum.
    // TODO(port): Zig is `[fields.len][*]u8`. Stable Rust cannot write
    // `[*mut u8; T::FIELD_COUNT]` (generic_const_exprs). Use a small fixed
    // upper bound; the derive `const_assert!`s `FIELD_COUNT <= MAX_FIELDS`.
    ptrs: [*mut u8; MAX_FIELDS],
    len: usize,
    capacity: usize,
    _marker: PhantomData<T>,
}

/// Upper bound on struct field count. Zig has no limit (comptime array);
/// stable Rust needs a concrete bound until `generic_const_exprs` lands.
// TODO(port): revisit once `generic_const_exprs` is stable.
pub const MAX_FIELDS: usize = 32;

// ───────────────────────────── Slice ─────────────────────────────

impl<T: MultiArrayElement> Slice<T> {
    pub const EMPTY: Self = Self {
        ptrs: [ptr::null_mut(); MAX_FIELDS],
        len: 0,
        capacity: 0,
        _marker: PhantomData,
    };

    /// Returns the column slice for `field` typed as `&mut [F]`.
    ///
    /// # Safety
    /// `F` must be exactly the field's type. The derive macro generates
    /// safe typed wrappers (`slice.field_name()`); prefer those.
    // TODO(port): Zig returns `[]FieldType(field)` with the type computed at
    // comptime from `field`. Rust cannot map a runtime enum value to a type;
    // the derive emits per-field safe accessors that call this with the
    // correct `F`.
    pub unsafe fn items<F>(&self, field: T::Field) -> &mut [F] {
        if self.capacity == 0 {
            return &mut [];
        }
        let byte_ptr = self.ptrs[T::field_index(field)];
        if core::mem::size_of::<F>() == 0 {
            // SAFETY: ZST slice; pointer is irrelevant.
            return core::slice::from_raw_parts_mut(ptr::NonNull::<F>::dangling().as_ptr(), self.len);
        }
        // SAFETY: caller guarantees `F` matches the field; `byte_ptr` is the
        // aligned start of `capacity` contiguous `F`s and `len <= capacity`.
        core::slice::from_raw_parts_mut(byte_ptr.cast::<F>(), self.len)
    }

    /// Raw column pointer for byte-level operations (internal use).
    #[inline]
    fn ptr(&self, field_index: usize) -> *mut u8 {
        self.ptrs[field_index]
    }

    pub fn set(&mut self, index: usize, elem: T) {
        // Zig: `inline for (fields) |f, i| self.items(i)[index] = @field(e, f.name)`
        // SAFETY: `index < len <= capacity`; ptrs are valid columns.
        unsafe { elem.scatter(&self.ptrs[..T::FIELD_COUNT], index) };
    }

    pub fn get(&self, index: usize) -> T {
        // Zig: `inline for (fields) |f, i| @field(result, f.name) = self.items(i)[index]`
        // SAFETY: `index < len <= capacity`; ptrs are valid columns.
        unsafe { T::gather(&self.ptrs[..T::FIELD_COUNT], index) }
    }

    pub fn to_multi_array_list(self) -> MultiArrayList<T> {
        if T::FIELD_COUNT == 0 || self.capacity == 0 {
            return MultiArrayList::default();
        }
        let unaligned_ptr = self.ptrs[T::SIZES_FIELDS[0]];
        // SAFETY: the first entry in `SIZES_FIELDS` is the highest-alignment
        // field, whose column starts at the buffer base (offset 0).
        let aligned_ptr = unaligned_ptr;
        MultiArrayList {
            bytes: aligned_ptr,
            len: self.len,
            capacity: self.capacity,
            _marker: PhantomData,
        }
    }

    // Zig `pub fn deinit(self: *Slice, gpa)` → Drop on the recovered list.
    // Callers should `drop(slice.to_multi_array_list())` or just let the
    // owning `MultiArrayList` drop. No inherent `deinit` exposed.

    // Zig `dbHelper` dropped — debugger pretty-printer hook, not needed.
}

// ───────────────────────────── MultiArrayList ─────────────────────────────

impl<T: MultiArrayElement> Default for MultiArrayList<T> {
    fn default() -> Self {
        Self {
            bytes: ptr::null_mut(),
            len: 0,
            capacity: 0,
            _marker: PhantomData,
        }
    }
}

impl<T: MultiArrayElement> MultiArrayList<T> {
    pub const EMPTY: Self = Self {
        bytes: ptr::null_mut(),
        len: 0,
        capacity: 0,
        _marker: PhantomData,
    };

    // Zig `Elem` / `Field` / `fields` / `sizes` are all on the trait now.
    // The Zig `sizes = blk: { ... sort by alignment descending ... }` block is
    // computed by the derive and exposed as `T::SIZES_BYTES` / `T::SIZES_FIELDS`.

    /// The caller owns the returned memory. Empties this MultiArrayList.
    pub fn to_owned_slice(&mut self) -> Slice<T> {
        let result = self.slice();
        // SAFETY: we are giving ownership of `bytes` to the Slice; reset self
        // to empty so Drop does not double-free.
        *self = Self::default();
        result
    }

    /// Compute pointers to the start of each field of the array.
    /// If you need to access multiple fields, calling this may
    /// be more efficient than calling `items()` multiple times.
    pub fn slice(&self) -> Slice<T> {
        let mut result = Slice::<T> {
            ptrs: [ptr::null_mut(); MAX_FIELDS],
            len: self.len,
            capacity: self.capacity,
            _marker: PhantomData,
        };
        let mut p = self.bytes;
        for (&field_size, &i) in T::SIZES_BYTES.iter().zip(T::SIZES_FIELDS) {
            result.ptrs[i] = p;
            // SAFETY: `p` walks within the single allocation of
            // `capacity_in_bytes(self.capacity)` bytes (or is null when
            // capacity == 0, in which case field_size * 0 == 0 and add(0) is OK).
            p = unsafe { p.add(field_size * self.capacity) };
        }
        result
    }

    /// Get the slice of values for a specified field.
    /// If you need multiple fields, consider calling `slice()` instead.
    ///
    /// # Safety
    /// See `Slice::items`.
    pub unsafe fn items<F>(&self, field: T::Field) -> &mut [F] {
        self.slice().items::<F>(field)
    }

    /// Overwrite one array element with new data.
    pub fn set(&mut self, index: usize, elem: T) {
        let mut slices = self.slice();
        slices.set(index, elem);
    }

    /// Obtain all the data for one array element.
    pub fn get(&self, index: usize) -> T {
        self.slice().get(index)
    }

    /// Extend the list by 1 element. Allocates more memory as necessary.
    pub fn append(&mut self, elem: T) -> Result<(), AllocError> {
        self.ensure_unused_capacity(1)?;
        self.append_assume_capacity(elem);
        Ok(())
    }

    /// Extend the list by 1 element, but asserting `self.capacity`
    /// is sufficient to hold an additional item.
    pub fn append_assume_capacity(&mut self, elem: T) {
        debug_assert!(self.len < self.capacity);
        self.len += 1;
        self.set(self.len - 1, elem);
    }

    /// Extend the list by 1 element, returning the newly reserved
    /// index with uninitialized data.
    /// Allocates more memory as necessary.
    pub fn add_one(&mut self) -> Result<usize, AllocError> {
        self.ensure_unused_capacity(1)?;
        Ok(self.add_one_assume_capacity())
    }

    /// Extend the list by 1 element, asserting `self.capacity`
    /// is sufficient to hold an additional item. Returns the
    /// newly reserved index with uninitialized data.
    pub fn add_one_assume_capacity(&mut self) -> usize {
        debug_assert!(self.len < self.capacity);
        let index = self.len;
        self.len += 1;
        index
    }

    /// Remove and return the last element from the list, or return `None` if list is empty.
    /// Invalidates pointers to fields of the removed element.
    pub fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            return None;
        }
        let val = self.get(self.len - 1);
        self.len -= 1;
        Some(val)
    }

    /// Inserts an item into an ordered list. Shifts all elements
    /// after and including the specified index back by one and
    /// sets the given index to the specified element. May reallocate
    /// and invalidate iterators.
    pub fn insert(&mut self, index: usize, elem: T) -> Result<(), AllocError> {
        self.ensure_unused_capacity(1)?;
        self.insert_assume_capacity(index, elem);
        Ok(())
    }

    /// Inserts an item into an ordered list which has room for it.
    /// Shifts all elements after and including the specified index
    /// back by one and sets the given index to the specified element.
    /// Will not reallocate the array, does not invalidate iterators.
    pub fn insert_assume_capacity(&mut self, index: usize, elem: T) {
        debug_assert!(self.len < self.capacity);
        debug_assert!(index <= self.len);
        self.len += 1;
        let slices = self.slice();
        // Zig: `inline for (fields) |f, fi| { shift; field_slice[index] = @field(entry, f.name); }`
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size == 0 {
                continue;
            }
            let base = slices.ptr(fi);
            let mut i = self.len - 1;
            while i > index {
                // SAFETY: `i` and `i-1` are < len <= capacity; column is contiguous.
                unsafe {
                    ptr::copy_nonoverlapping(
                        base.add((i - 1) * size),
                        base.add(i * size),
                        size,
                    );
                }
                i -= 1;
            }
        }
        // SAFETY: slot at `index` is now the hole; scatter elem into it.
        unsafe { elem.scatter(&slices.ptrs[..T::FIELD_COUNT], index) };
    }

    pub fn append_list_assume_capacity(&mut self, other: &Self) {
        let offset = self.len;
        self.len += other.len;
        let other_slice = other.slice();
        let this_slice = self.slice();
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size != 0 {
                // SAFETY: `offset + other.len <= self.capacity` (caller contract);
                // columns are contiguous and non-overlapping (distinct allocations).
                unsafe {
                    ptr::copy_nonoverlapping(
                        other_slice.ptr(fi),
                        this_slice.ptr(fi).add(offset * size),
                        other.len * size,
                    );
                }
            }
        }
    }

    /// Remove the specified item from the list, swapping the last
    /// item in the list into its position. Fast, but does not
    /// retain list ordering.
    pub fn swap_remove(&mut self, index: usize) {
        let slices = self.slice();
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size == 0 {
                continue;
            }
            let base = slices.ptr(fi);
            // SAFETY: `index < len` and `len-1 < len <= capacity`. Regions overlap
            // exactly when `index == len-1` (src == dst), which `copy` handles;
            // `copy_nonoverlapping` would be UB there.
            unsafe {
                ptr::copy(
                    base.add((self.len - 1) * size),
                    base.add(index * size),
                    size,
                );
                // Zig: `field_slice[self.len - 1] = undefined;` — no-op in release.
            }
        }
        self.len -= 1;
    }

    /// Remove the specified item from the list, shifting items
    /// after it to preserve order.
    pub fn ordered_remove(&mut self, index: usize) {
        let slices = self.slice();
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size == 0 {
                continue;
            }
            let base = slices.ptr(fi);
            let mut i = index;
            while i < self.len - 1 {
                // SAFETY: `i` and `i+1` are < len <= capacity.
                unsafe {
                    ptr::copy_nonoverlapping(
                        base.add((i + 1) * size),
                        base.add(i * size),
                        size,
                    );
                }
                i += 1;
            }
            // Zig: `field_slice[i] = undefined;` — no-op.
        }
        self.len -= 1;
    }

    /// Adjust the list's length to `new_len`.
    /// Does not initialize added items, if any.
    pub fn resize(&mut self, new_len: usize) -> Result<(), AllocError> {
        self.ensure_total_capacity(new_len)?;
        self.len = new_len;
        Ok(())
    }

    /// Attempt to reduce allocated capacity to `new_len`.
    /// If `new_len` is greater than zero, this may fail to reduce the capacity,
    /// but the data remains intact and the length is updated to new_len.
    pub fn shrink_and_free(&mut self, new_len: usize) {
        if new_len == 0 {
            return self.clear_and_free();
        }

        debug_assert!(new_len <= self.capacity);
        debug_assert!(new_len <= self.len);

        let other_bytes = match aligned_alloc::<T>(Self::capacity_in_bytes(new_len)) {
            Ok(p) => p,
            Err(_) => {
                // Zig: on alloc failure, memset tail to undefined and shrink len.
                // The memset is a safety/valgrind aid; skip in Rust.
                self.len = new_len;
                return;
            }
        };
        let mut other = Self {
            bytes: other_bytes,
            capacity: new_len,
            len: new_len,
            _marker: PhantomData,
        };
        self.len = new_len;
        let self_slice = self.slice();
        let other_slice = other.slice();
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size != 0 {
                // SAFETY: both columns hold `new_len` elements; allocations are distinct.
                unsafe {
                    ptr::copy_nonoverlapping(
                        self_slice.ptr(fi),
                        other_slice.ptr(fi),
                        new_len * size,
                    );
                }
            }
        }
        // SAFETY: free old backing store before overwriting self.
        unsafe { self.free_allocated_bytes() };
        // PORT NOTE: reshaped for borrowck — move `other` into self, then
        // forget the moved-from `other` so its Drop doesn't run on the buffer
        // we just took.
        core::mem::swap(self, &mut other);
        core::mem::forget(other);
    }

    pub fn clear_and_free(&mut self) {
        // SAFETY: frees current buffer (if any) then resets to empty.
        unsafe { self.free_allocated_bytes() };
        *self = Self::default();
    }

    /// Reduce length to `new_len`.
    /// Invalidates pointers to elements `items[new_len..]`.
    /// Keeps capacity the same.
    pub fn shrink_retaining_capacity(&mut self, new_len: usize) {
        self.len = new_len;
    }

    /// Invalidates all element pointers.
    pub fn clear_retaining_capacity(&mut self) {
        self.len = 0;
    }

    /// Modify the array so that it can hold at least `new_capacity` items.
    /// Implements super-linear growth to achieve amortized O(1) append operations.
    /// Invalidates element pointers if additional memory is needed.
    pub fn ensure_total_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        if self.capacity >= new_capacity {
            return Ok(());
        }
        self.set_capacity(Self::grow_capacity(self.capacity, new_capacity))
    }

    const INIT_CAPACITY: usize = {
        let mut max = 1usize;
        let mut i = 0;
        while i < T::SIZES_BYTES.len() {
            if T::SIZES_BYTES[i] > max {
                max = T::SIZES_BYTES[i];
            }
            i += 1;
        }
        let cl = CACHE_LINE / max;
        if cl > 1 { cl } else { 1 }
    };

    /// Called when memory growth is necessary. Returns a capacity larger than
    /// minimum that grows super-linearly.
    fn grow_capacity(current: usize, minimum: usize) -> usize {
        let mut new = current;
        loop {
            new = new.saturating_add(new / 2 + Self::INIT_CAPACITY);
            if new >= minimum {
                return new;
            }
        }
    }

    /// Modify the array so that it can hold at least `additional_count` **more** items.
    /// Invalidates pointers if additional memory is needed.
    pub fn ensure_unused_capacity(&mut self, additional_count: usize) -> Result<(), AllocError> {
        self.ensure_total_capacity(self.len + additional_count)
    }

    /// Modify the array so that it can hold exactly `new_capacity` items.
    /// Invalidates pointers if additional memory is needed.
    /// `new_capacity` must be greater or equal to `len`.
    pub fn set_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        debug_assert!(new_capacity >= self.len);
        let new_bytes = aligned_alloc::<T>(Self::capacity_in_bytes(new_capacity))?;
        if self.len == 0 {
            // SAFETY: free old (possibly null/empty) buffer.
            unsafe { self.free_allocated_bytes() };
            self.bytes = new_bytes;
            self.capacity = new_capacity;
            return Ok(());
        }
        let other = Self {
            bytes: new_bytes,
            capacity: new_capacity,
            len: self.len,
            _marker: PhantomData,
        };
        let self_slice = self.slice();
        let other_slice = other.slice();
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size != 0 {
                // SAFETY: both columns hold `self.len` elements; allocations distinct.
                unsafe {
                    ptr::copy_nonoverlapping(
                        self_slice.ptr(fi),
                        other_slice.ptr(fi),
                        self.len * size,
                    );
                }
            }
        }
        // SAFETY: free old backing store before taking new one.
        unsafe { self.free_allocated_bytes() };
        self.bytes = other.bytes;
        self.capacity = other.capacity;
        self.len = other.len;
        core::mem::forget(other);
        Ok(())
    }

    /// Create a copy of this list with a new backing store.
    pub fn clone(&self) -> Result<Self, AllocError> {
        let mut result = Self::default();
        // errdefer result.deinit(gpa) → Drop handles this on `?`.
        result.ensure_total_capacity(self.len)?;
        result.len = self.len;
        let self_slice = self.slice();
        let result_slice = result.slice();
        for fi in 0..T::FIELD_COUNT {
            let size = field_size_unsorted::<T>(fi);
            if size != 0 {
                // SAFETY: both columns hold `self.len` elements; allocations distinct.
                unsafe {
                    ptr::copy_nonoverlapping(
                        self_slice.ptr(fi),
                        result_slice.ptr(fi),
                        self.len * size,
                    );
                }
            }
        }
        Ok(result)
    }

    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    fn sort_internal<C: SortContext, const MODE: SortMode>(&self, a: usize, b: usize, ctx: C) {
        let slice = self.slice();
        let swap = |a_index: usize, b_index: usize| {
            for fi in 0..T::FIELD_COUNT {
                let size = field_size_unsorted::<T>(fi);
                if size != 0 {
                    let base = slice.ptr(fi);
                    // SAFETY: indices are < len; columns are contiguous; a_index != b_index
                    // is guaranteed by sort impls (and swap_nonoverlapping requires it).
                    unsafe {
                        ptr::swap_nonoverlapping(
                            base.add(a_index * size),
                            base.add(b_index * size),
                            size,
                        );
                    }
                }
            }
        };
        let less = |ai: usize, bi: usize| ctx.less_than(ai, bi);

        // TODO(port): Zig calls `mem.sortContext` / `mem.sortUnstableContext`,
        // index-based in-place sorts (timsort / pdqsort) parameterized by
        // `swap` + `lessThan`. Rust std has no index-based sort; provide
        // `bun_collections::sort_context` / `sort_unstable_context` in Phase B.
        match MODE {
            SortMode::Stable => bun_collections_sort_context(a, b, less, swap),
            SortMode::Unstable => bun_collections_sort_unstable_context(a, b, less, swap),
        }
    }

    /// This function guarantees a stable sort, i.e the relative order of equal elements is preserved during sorting.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// If this guarantee does not matter, `sort_unstable` might be a faster alternative.
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort<C: SortContext>(&self, ctx: C) {
        self.sort_internal::<C, { SortMode::Stable }>(0, self.len, ctx);
    }

    /// Sorts only the subsection of items between indices `a` and `b` (excluding `b`).
    /// This function guarantees a stable sort, i.e the relative order of equal elements is preserved during sorting.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// If this guarantee does not matter, `sort_span_unstable` might be a faster alternative.
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort_span<C: SortContext>(&self, a: usize, b: usize, ctx: C) {
        self.sort_internal::<C, { SortMode::Stable }>(a, b, ctx);
    }

    /// This function does NOT guarantee a stable sort, i.e the relative order of equal elements may change during sorting.
    /// Due to the weaker guarantees of this function, this may be faster than the stable `sort` method.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort_unstable<C: SortContext>(&self, ctx: C) {
        self.sort_internal::<C, { SortMode::Unstable }>(0, self.len, ctx);
    }

    /// Sorts only the subsection of items between indices `a` and `b` (excluding `b`).
    /// This function does NOT guarantee a stable sort, i.e the relative order of equal elements may change during sorting.
    /// Due to the weaker guarantees of this function, this may be faster than the stable `sort_span` method.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort_span_unstable<C: SortContext>(&self, a: usize, b: usize, ctx: C) {
        self.sort_internal::<C, { SortMode::Unstable }>(a, b, ctx);
    }

    pub fn capacity_in_bytes(capacity: usize) -> usize {
        let mut elem_bytes: usize = 0;
        let mut i = 0;
        while i < T::SIZES_BYTES.len() {
            elem_bytes += T::SIZES_BYTES[i];
            i += 1;
        }
        elem_bytes * capacity
    }

    fn allocated_bytes(&self) -> (*mut u8, usize) {
        (self.bytes, Self::capacity_in_bytes(self.capacity))
    }

    /// Returns the amount of memory used by this list, in bytes.
    pub fn memory_cost(&self) -> usize {
        Self::capacity_in_bytes(self.capacity)
    }

    /// Zero-initialize all allocated memory.
    pub fn zero(&self) {
        let (p, n) = self.allocated_bytes();
        if n != 0 {
            // SAFETY: `p` is the start of an allocation of `n` bytes.
            unsafe { ptr::write_bytes(p, 0, n) };
        }
    }

    // Zig `FieldType(comptime field)` is replaced by per-field typed accessors
    // generated by the derive; no generic equivalent here.

    // Zig `Entry` type and `dbHelper` are debugger pretty-printer aids only —
    // dropped. The `comptime { if (builtin.zig_backend == .stage2_llvm ...) }`
    // force-reference block is likewise dropped.

    /// # Safety
    /// Must not be called twice without an intervening allocation.
    unsafe fn free_allocated_bytes(&mut self) {
        let (p, n) = self.allocated_bytes();
        if !p.is_null() && n != 0 {
            // SAFETY: `p` was allocated with this exact layout in
            // `aligned_alloc::<T>`.
            alloc::dealloc(p, Layout::from_size_align_unchecked(n, T::ALIGN));
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

impl<T: MultiArrayElement> Drop for MultiArrayList<T> {
    fn drop(&mut self) {
        // Zig `deinit(self, gpa)`: `gpa.free(self.allocatedBytes())`.
        // PERF(port): Zig callers sometimes pass an arena allocator and rely
        // on bulk-free; this Drop always uses the global allocator. Revisit if
        // an arena-backed variant is needed.
        // SAFETY: called once at end of life.
        unsafe { self.free_allocated_bytes() };
    }
}

// ───────────────────────────── helpers ─────────────────────────────

/// `std.atomic.cache_line` — 64 on x86_64/aarch64, which is all Bun targets.
// TODO(port): move to `bun_core` if needed elsewhere.
const CACHE_LINE: usize = 64;

/// Look up the size of field index `fi` (unsorted / `Field`-enum order) by
/// reverse-mapping through `SIZES_FIELDS`.
#[inline]
fn field_size_unsorted<T: MultiArrayElement>(fi: usize) -> usize {
    // SIZES_FIELDS[k] = field index; SIZES_BYTES[k] = its size.
    let mut k = 0;
    while k < T::FIELD_COUNT {
        if T::SIZES_FIELDS[k] == fi {
            return T::SIZES_BYTES[k];
        }
        k += 1;
    }
    unreachable!()
}

/// `gpa.alignedAlloc(u8, @alignOf(Elem), n)`
fn aligned_alloc<T: MultiArrayElement>(n: usize) -> Result<*mut u8, AllocError> {
    if n == 0 {
        return Ok(ptr::null_mut());
    }
    let layout = Layout::from_size_align(n, T::ALIGN).map_err(|_| AllocError)?;
    // SAFETY: layout is non-zero-sized.
    let p = unsafe { alloc::alloc(layout) };
    if p.is_null() {
        Err(AllocError)
    } else {
        Ok(p)
    }
}

// TODO(port): index-based context sorts (`mem.sortContext` /
// `mem.sortUnstableContext`). Phase B: implement in `bun_collections::sort`.
fn bun_collections_sort_context(
    _a: usize,
    _b: usize,
    _less: impl Fn(usize, usize) -> bool,
    _swap: impl Fn(usize, usize),
) {
    // TODO(port): stable index-based sort (timsort).
    todo!("bun_collections::sort_context")
}

fn bun_collections_sort_unstable_context(
    _a: usize,
    _b: usize,
    _less: impl Fn(usize, usize) -> bool,
    _swap: impl Fn(usize, usize),
) {
    // TODO(port): unstable index-based sort (pdqsort).
    todo!("bun_collections::sort_unstable_context")
}

// `MaybeUninit` is referenced in doc comments; keep import to avoid dead-code
// churn in Phase B.
const _: PhantomData<MaybeUninit<u8>> = PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/multi_array_list.zig (647 lines)
//   confidence: medium
//   todos:      10
//   notes:      Heavy @typeInfo/@field reflection replaced by MultiArrayElement trait (needs #[derive] proc-macro in Phase B); ptrs array fixed at MAX_FIELDS=32 pending generic_const_exprs; index-based sort_context stubbed; allocator params dropped (global mimalloc); union(enum) Elem wrapper deferred to derive.
// ──────────────────────────────────────────────────────────────────────────
