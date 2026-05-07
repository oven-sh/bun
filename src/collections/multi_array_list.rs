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
use core::mem::{ManuallyDrop, MaybeUninit};
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
// The derive lives in `bun_collections_macros` and is re-exported from this
// crate, so `#[derive(MultiArrayElement)]` resolves to both macro and trait.

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

#[derive(Clone, Copy, PartialEq, Eq)]
enum SortMode {
    Stable,
    Unstable,
}

/// Struct-of-arrays list. See module docs.
// PORT NOTE: trait bound only on `impl` blocks, not the struct, so downstream
// can name `MultiArrayList<Foo>` before deriving `MultiArrayElement` for `Foo`.
// Drop must therefore not depend on `T: MultiArrayElement`, so we cache the
// allocation Layout (otherwise computable from `T::SIZES_BYTES`/`T::ALIGN`)
// at alloc time. Adds one `Option<Layout>` (16 bytes) vs Zig's 24-byte struct.
pub struct MultiArrayList<T> {
    bytes: *mut u8,
    len: usize,
    capacity: usize,
    // Layout of the `bytes` allocation, or None if `bytes` is dangling.
    alloc_layout: Option<Layout>,
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

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    /// Returns the column slice for `field` typed as `&[F]`.
    ///
    /// # Safety
    /// `F` must be exactly the field's type. The derive macro generates
    /// safe typed wrappers (`slice.field_name()`); prefer those.
    // TODO(port): Zig returns `[]FieldType(field)` with the type computed at
    // comptime from `field`. Rust cannot map a runtime enum value to a type;
    // the derive emits per-field safe accessors that call this with the
    // correct `F`.
    pub unsafe fn items<F>(&self, field: T::Field) -> &[F] {
        if self.capacity == 0 {
            return &[];
        }
        let byte_ptr = self.ptrs[T::field_index(field)];
        if core::mem::size_of::<F>() == 0 {
            // SAFETY: ZST slice; pointer is irrelevant.
            return unsafe { core::slice::from_raw_parts(ptr::NonNull::<F>::dangling().as_ptr(), self.len) };
        }
        // SAFETY: caller guarantees `F` matches the field; `byte_ptr` is the
        // aligned start of `capacity` contiguous `F`s and `len <= capacity`.
        unsafe { core::slice::from_raw_parts(byte_ptr.cast::<F>(), self.len) }
    }

    /// Returns the column slice for `field` typed as `&mut [F]`.
    ///
    /// # Safety
    /// `F` must be exactly the field's type. The derive macro generates
    /// safe typed wrappers (`slice.field_name_mut()`); prefer those.
    // PORT NOTE: Zig's `slice.items(field)` returned a mutable `[]F` freely
    // because Zig has no aliasing model. In Rust, handing out `&mut [F]` from
    // `&self` is UB under Stacked Borrows (PORTING.md §Forbidden: aliased &mut),
    // so the mutable variant requires `&mut self`.
    pub unsafe fn items_mut<F>(&mut self, field: T::Field) -> &mut [F] {
        if self.capacity == 0 {
            return &mut [];
        }
        let byte_ptr = self.ptrs[T::field_index(field)];
        if core::mem::size_of::<F>() == 0 {
            // SAFETY: ZST slice; pointer is irrelevant.
            return unsafe { core::slice::from_raw_parts_mut(ptr::NonNull::<F>::dangling().as_ptr(), self.len) };
        }
        // SAFETY: caller guarantees `F` matches the field; `byte_ptr` is the
        // aligned start of `capacity` contiguous `F`s and `len <= capacity`.
        unsafe { core::slice::from_raw_parts_mut(byte_ptr.cast::<F>(), self.len) }
    }

    /// Raw column pointer for callers that need simultaneous mutable access to
    /// multiple distinct columns (which `items_mut`'s `&mut self` borrow would
    /// otherwise forbid). Zig allowed this freely via `slice.items(.a)` /
    /// `slice.items(.b)`; in Rust the caller opts in per call site.
    ///
    /// # Safety
    /// `F` must be exactly the field's type. The returned pointer is valid for
    /// `self.len` reads/writes; the caller must not create overlapping `&mut`
    /// references to the same column.
    #[inline]
    pub unsafe fn items_raw<F>(&self, field: T::Field) -> *mut F {
        if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            return ptr::NonNull::<F>::dangling().as_ptr();
        }
        self.ptrs[T::field_index(field)].cast::<F>()
    }

    /// Raw column pointer for byte-level operations (internal use).
    #[inline]
    fn ptr(&self, field_index: usize) -> *mut u8 {
        self.ptrs[field_index]
    }

    pub fn set(&mut self, index: usize, elem: T) {
        // Zig: `inline for (fields) |f, i| self.items(i)[index] = @field(e, f.name)`
        // — Zig's slice index is bounds-checked against `self.len`; mirror it.
        assert!(index < self.len, "MultiArrayList::Slice::set: index out of bounds");
        // SAFETY: `index < len <= capacity`; ptrs are valid columns.
        unsafe { elem.scatter(&self.ptrs[..T::FIELD_COUNT], index) };
    }

    /// Gather a `T` by per-field `ptr::read` from each column.
    ///
    /// The returned value is a **bitwise copy** — the SoA storage retains
    /// ownership of every field. Dropping the gathered struct would free
    /// columns the storage still owns (double-free on next `get` / `Drop`),
    /// so it is wrapped in `ManuallyDrop`. Zig has no destructors so the
    /// by-value copy is harmless there.
    ///
    /// Use this for read-only whole-struct snapshots (fields reachable via
    /// `Deref`); for single columns prefer the derive's `items_<field>()`
    /// accessors which borrow the storage directly. Call `into_inner` only
    /// if ownership is being transferred out (e.g. paired with a `set` of a
    /// replacement, or `pop`).
    pub fn get(&self, index: usize) -> ManuallyDrop<T> {
        // Zig: `inline for (fields) |f, i| @field(result, f.name) = self.items(i)[index]`
        // — Zig's slice index is bounds-checked against `self.len`; mirror it.
        assert!(index < self.len, "MultiArrayList::Slice::get: index out of bounds");
        // SAFETY: `index < len <= capacity`; ptrs are valid columns.
        ManuallyDrop::new(unsafe { T::gather(&self.ptrs[..T::FIELD_COUNT], index) })
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
            alloc_layout: layout_for::<T>(self.capacity),
            _marker: PhantomData,
        }
    }

    // Zig `pub fn deinit(self: *Slice, gpa)` → Drop on the recovered list.
    // Callers should `drop(slice.to_multi_array_list())` or just let the
    // owning `MultiArrayList` drop. No inherent `deinit` exposed.

    // Zig `dbHelper` dropped — debugger pretty-printer hook, not needed.
}

// ───────────────────────────── MultiArrayList ─────────────────────────────

impl<T> Default for MultiArrayList<T> {
    fn default() -> Self {
        Self {
            bytes: ptr::null_mut(),
            len: 0,
            capacity: 0,
            alloc_layout: None,
            _marker: PhantomData,
        }
    }
}

// Unconstrained accessors so downstream can name `MultiArrayList<Foo>` and
// query length before `Foo: MultiArrayElement` is derived (see PORT NOTE on
// the struct above).
impl<T> MultiArrayList<T> {
    /// Number of elements. Kept unconstrained — does not need column layout.
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl<T: MultiArrayElement> MultiArrayList<T> {
    pub const EMPTY: Self = Self {
        bytes: ptr::null_mut(),
        len: 0,
        capacity: 0,
        alloc_layout: None,
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

    /// Compute the column base pointer for `field` typed as `*mut F`.
    /// Returns a dangling (non-null, aligned) pointer when capacity is 0 or
    /// `F` is a ZST, suitable for `slice::from_raw_parts{,_mut}` of any length.
    ///
    /// # Safety
    /// `F` must be exactly the field's type.
    #[inline]
    unsafe fn column_ptr<F>(&self, field: T::Field) -> *mut F {
        // PORT NOTE: Zig's `self.slice().items(field)` works because the
        // returned slice borrows the underlying allocation, not the temporary
        // `Slice` (which only caches pointers). Reproduce by computing the
        // column ptr directly without the intermediate `Slice` value.
        if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            // Zig returns a ZST slice of length self.len (lib.zig:89-93), not 0.
            return core::ptr::NonNull::<F>::dangling().as_ptr();
        }
        let fi = T::field_index(field);
        let mut ptr = self.bytes;
        // Walk size-sorted columns; SIZES_BYTES is indexed by sorted position k,
        // SIZES_FIELDS[k] gives the original field index at that position.
        // (Bug: previously indexed SIZES_BYTES[si] — wrong axis.)
        for (k, &si) in T::SIZES_FIELDS.iter().enumerate() {
            if si == fi {
                break;
            }
            // SAFETY: column offsets within the single allocation.
            ptr = unsafe { ptr.add(T::SIZES_BYTES[k] * self.capacity) };
        }
        ptr.cast::<F>()
    }

    /// Get the shared slice of values for a specified field.
    /// If you need multiple fields, consider calling `slice()` instead.
    ///
    /// # Safety
    /// See `Slice::items`.
    pub unsafe fn items<F>(&self, field: T::Field) -> &[F] {
        // SAFETY: caller guarantees `F` matches field type; `column_ptr` points
        // to `capacity` aligned `F`s (or dangling for ZST/empty) and
        // `len <= capacity`. Never materialize a `&mut [F]` from `&self`
        // (PORTING.md §Forbidden: aliased &mut).
        unsafe { core::slice::from_raw_parts(self.column_ptr::<F>(field), self.len) }
    }

    /// Get the mutable slice of values for a specified field.
    /// If you need multiple fields, consider calling `slice()` instead.
    ///
    /// # Safety
    /// See `Slice::items_mut`.
    pub unsafe fn items_mut<F>(&mut self, field: T::Field) -> &mut [F] {
        // SAFETY: caller guarantees `F` matches field type; `column_ptr` points
        // to `capacity` aligned `F`s (or dangling for ZST/empty) and
        // `len <= capacity`. `&mut self` enforces exclusive column access.
        unsafe { core::slice::from_raw_parts_mut(self.column_ptr::<F>(field), self.len) }
    }

    /// Overwrite one array element with new data.
    pub fn set(&mut self, index: usize, elem: T) {
        let mut slices = self.slice();
        slices.set(index, elem);
    }

    /// Obtain all the data for one array element.
    ///
    /// Returns `ManuallyDrop<T>` because the gathered struct is a bitwise
    /// copy of column storage that the list still owns; see `Slice::get`.
    pub fn get(&self, index: usize) -> ManuallyDrop<T> {
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
        // Ownership transferred: the storage no longer references this slot,
        // so unwrap the ManuallyDrop and hand the caller a real owned `T`.
        Some(ManuallyDrop::into_inner(val))
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
        // Zig's `field_slice[index]` / `field_slice[self.len - 1]` provide an
        // implicit bounds + underflow check; mirror it explicitly.
        assert!(index < self.len, "MultiArrayList::swap_remove: index out of bounds");
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
        // Zig's `field_slice[index]` provides an implicit bounds + underflow
        // (`self.len - 1` when len==0) check; mirror it explicitly.
        assert!(index < self.len, "MultiArrayList::ordered_remove: index out of bounds");
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

        let other_layout = layout_for::<T>(new_len);
        let other_bytes = match aligned_alloc(other_layout) {
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
            alloc_layout: other_layout,
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
        let new_layout = layout_for::<T>(new_capacity);
        let new_bytes = aligned_alloc(new_layout)?;
        if self.len == 0 {
            // SAFETY: free old (possibly null/empty) buffer.
            unsafe { self.free_allocated_bytes() };
            self.bytes = new_bytes;
            self.capacity = new_capacity;
            self.alloc_layout = new_layout;
            return Ok(());
        }
        let other = Self {
            bytes: new_bytes,
            capacity: new_capacity,
            len: self.len,
            alloc_layout: new_layout,
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
        self.alloc_layout = other.alloc_layout;
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
    // PORT NOTE: `const MODE: SortMode` enum const-generic is unstable
    // (adt_const_params); rewritten as `const STABLE: bool`.
    fn sort_internal<C: SortContext, const STABLE: bool>(&self, a: usize, b: usize, ctx: C) {
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

        // Zig calls `mem.sortContext` / `mem.sortUnstableContext` — index-based
        // in-place sorts parameterized by `swap` + `lessThan`. Rust std has no
        // index-based sort, so we port `std.sort.insertionContext` (stable) and
        // `std.sort.heapContext` (unstable) below.
        match STABLE {
            true => bun_collections_sort_context(a, b, less, swap),
            false => bun_collections_sort_unstable_context(a, b, less, swap),
        }
    }

    /// This function guarantees a stable sort, i.e the relative order of equal elements is preserved during sorting.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// If this guarantee does not matter, `sort_unstable` might be a faster alternative.
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort<C: SortContext>(&self, ctx: C) {
        self.sort_internal::<C, true>(0, self.len, ctx);
    }

    /// Sorts only the subsection of items between indices `a` and `b` (excluding `b`).
    /// This function guarantees a stable sort, i.e the relative order of equal elements is preserved during sorting.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// If this guarantee does not matter, `sort_span_unstable` might be a faster alternative.
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort_span<C: SortContext>(&self, a: usize, b: usize, ctx: C) {
        self.sort_internal::<C, true>(a, b, ctx);
    }

    /// This function does NOT guarantee a stable sort, i.e the relative order of equal elements may change during sorting.
    /// Due to the weaker guarantees of this function, this may be faster than the stable `sort` method.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort_unstable<C: SortContext>(&self, ctx: C) {
        self.sort_internal::<C, false>(0, self.len, ctx);
    }

    /// Sorts only the subsection of items between indices `a` and `b` (excluding `b`).
    /// This function does NOT guarantee a stable sort, i.e the relative order of equal elements may change during sorting.
    /// Due to the weaker guarantees of this function, this may be faster than the stable `sort_span` method.
    /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
    /// `ctx` has the following method:
    /// `fn less_than(&self, a_index: usize, b_index: usize) -> bool`
    pub fn sort_span_unstable<C: SortContext>(&self, a: usize, b: usize, ctx: C) {
        self.sort_internal::<C, false>(a, b, ctx);
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
        if let Some(layout) = self.alloc_layout.take() {
            // SAFETY: `bytes` was allocated with exactly `layout`.
            unsafe { alloc::dealloc(self.bytes, layout) };
        }
    }

    /// Zig `self.len = new_len`. Exposed for callers that pre-reserve capacity
    /// and then bulk-initialize columns out of band (e.g. `Headers::from`).
    ///
    /// # Safety
    /// `new_len <= self.capacity()`, and every column element in
    /// `old_len..new_len` must be initialized before any read (including Drop).
    #[inline]
    pub unsafe fn set_len(&mut self, new_len: usize) {
        debug_assert!(new_len <= self.capacity);
        self.len = new_len;
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

impl<T> Drop for MultiArrayList<T> {
    fn drop(&mut self) {
        // Zig `deinit(self, gpa)`: `gpa.free(self.allocatedBytes())`.
        // PERF(port): Zig callers sometimes pass an arena allocator and rely
        // on bulk-free; this Drop always uses the global allocator. Revisit if
        // an arena-backed variant is needed.
        if let Some(layout) = self.alloc_layout {
            // SAFETY: `bytes` was allocated with exactly `layout` (cached at
            // alloc time) and is freed exactly once here.
            unsafe { alloc::dealloc(self.bytes, layout) };
        }
    }
}

// ───────────────────────────── helpers ─────────────────────────────

/// `std.atomic.cache_line` — **128** on x86_64 and aarch64
/// (vendor/zig/lib/std/atomic.zig:416-422), which is all native Bun targets.
// TODO(port): move to `bun_core` if needed elsewhere; `#[cfg]`-gate to 64 on
// wasm if/when targeted (matches `std.atomic.cacheLineForCpu`).
const CACHE_LINE: usize = 128;

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

/// Layout for `capacity` elements: `(Σ SIZES_BYTES) * capacity` bytes at
/// `T::ALIGN`. `None` for zero-size (no allocation needed).
#[inline]
fn layout_for<T: MultiArrayElement>(capacity: usize) -> Option<Layout> {
    let mut elem_bytes: usize = 0;
    let mut i = 0;
    while i < T::SIZES_BYTES.len() {
        elem_bytes += T::SIZES_BYTES[i];
        i += 1;
    }
    let n = elem_bytes * capacity;
    if n == 0 {
        return None;
    }
    Some(Layout::from_size_align(n, T::ALIGN).expect("MultiArrayList layout overflow"))
}

/// `gpa.alignedAlloc(u8, @alignOf(Elem), n)`
fn aligned_alloc(layout: Option<Layout>) -> Result<*mut u8, AllocError> {
    let Some(layout) = layout else {
        return Ok(ptr::null_mut());
    };
    // SAFETY: layout is non-zero-sized (checked in `layout_for`).
    let p = unsafe { alloc::alloc(layout) };
    if p.is_null() { Err(AllocError) } else { Ok(p) }
}

// Index-based context sorts — port of `mem.sortContext` / `mem.sortUnstableContext`
// (vendor/zig/lib/std/mem.zig:629-635 → std/sort.zig `insertionContext` /
// `heapContext`). Rust std has no sort parameterized purely by index `swap` /
// `less`, so we carry the Zig implementations directly.

/// `std.sort.insertionContext` — stable, O(n²) worst case, O(1) memory.
/// Zig's `mem.sortContext` currently delegates to this (see its TODO re: block
/// sort); we match that behavior exactly.
fn bun_collections_sort_context(
    a: usize,
    b: usize,
    less: impl Fn(usize, usize) -> bool,
    swap: impl Fn(usize, usize),
) {
    debug_assert!(a <= b);
    if a >= b {
        return;
    }
    let mut i = a + 1;
    while i < b {
        let mut j = i;
        while j > a && less(j, j - 1) {
            swap(j, j - 1);
            j -= 1;
        }
        i += 1;
    }
}

/// `std.sort.heapContext` — unstable, O(n·log n) best/worst/average, O(1) memory.
/// Zig's `mem.sortUnstableContext` delegates to `pdqContext`; heap sort is
/// pdqsort's guaranteed-O(n·log n) fallback and preserves the index-based
/// `swap`/`less` contract without the partitioning machinery.
/// PERF(port): upgrade to full `pdqContext` if profiling shows hot SoA sorts.
fn bun_collections_sort_unstable_context(
    a: usize,
    b: usize,
    less: impl Fn(usize, usize) -> bool,
    swap: impl Fn(usize, usize),
) {
    debug_assert!(a <= b);
    if b - a < 2 {
        return;
    }

    // Build the heap in linear time.
    let mut i = a + (b - a) / 2;
    while i > a {
        i -= 1;
        sift_down(a, i, b, &less, &swap);
    }

    // Pop maximal elements from the heap.
    i = b;
    while i > a {
        i -= 1;
        if i == a {
            // Zig issues `swap(a, a)` on the final iteration (a no-op there).
            // Our column-swap closure uses `ptr::swap_nonoverlapping`, which
            // forbids self-aliasing, so elide it; `siftDown(a, a, a)` is also
            // a no-op.
            break;
        }
        swap(a, i);
        sift_down(a, a, i, &less, &swap);
    }
}

/// `std.sort.siftDown` (sort.zig:101-129).
fn sift_down(
    a: usize,
    target: usize,
    b: usize,
    less: &impl Fn(usize, usize) -> bool,
    swap: &impl Fn(usize, usize),
) {
    let mut cur = target;
    loop {
        // When the multiply below does not overflow, this equals
        // `2*cur - 2*a + a + 1`. The `+ a + 1` is safe: for `a > 0`,
        // `2a >= a + 1`; for `a == 0` it is `2*cur + 1` (even + 1).
        let Some(twice) = (cur - a).checked_mul(2) else {
            break;
        };
        let mut child = twice + a + 1;

        // Stop if we overshot the boundary.
        if !(child < b) {
            break;
        }

        // `next_child` is at most `b`, therefore no overflow is possible.
        let next_child = child + 1;

        // Store the greater child in `child`.
        if next_child < b && less(child, next_child) {
            child = next_child;
        }

        // Stop if the heap invariant holds at `cur`.
        if less(child, cur) {
            break;
        }

        // Swap `cur` with the greater child, move one step down, and continue sifting.
        swap(child, cur);
        cur = child;
    }
}

// `MaybeUninit` is referenced in doc comments; keep import to avoid dead-code
// churn in Phase B.
const _: PhantomData<MaybeUninit<u8>> = PhantomData;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MultiArrayElement; // derive

    // Mirror of `multi_array_list.zig`'s `test "basic usage"` element type.
    #[derive(MultiArrayElement, Clone, Copy, PartialEq, Debug)]
    struct Foo {
        a: u32,
        b: u8,
        c: u64,
    }

    #[test]
    fn derive_metadata() {
        assert_eq!(<Foo as super::MultiArrayElement>::FIELD_COUNT, 3);
        // Sorted by alignment descending: c(u64=8), a(u32=4), b(u8=1).
        assert_eq!(Foo::SIZES_BYTES, &[8, 4, 1]);
        assert_eq!(Foo::SIZES_FIELDS, &[2, 0, 1]);
        assert_eq!(Foo::field_index(FooField::b), 1);
    }

    #[test]
    fn derive_roundtrip() {
        let mut list = MultiArrayList::<Foo>::default();
        for i in 0..10u32 {
            list.append(Foo { a: i, b: i as u8, c: i as u64 * 100 }).unwrap();
        }
        let s = list.slice();
        // Typed accessor from generated `FooSliceExt`.
        use self::FooSliceExt;
        assert_eq!(s.c()[7], 700);
        assert_eq!(s.a()[3], 3);
        assert_eq!(*list.get(5), Foo { a: 5, b: 5, c: 500 });
    }

    #[test]
    fn derive_list_ext() {
        // Typed `items_<field>()` accessors directly on `MultiArrayList<T>`.
        use self::FooListExt;
        let mut list = MultiArrayList::<Foo>::default();
        for i in 0..4u32 {
            list.append(Foo { a: i, b: i as u8, c: i as u64 * 10 }).unwrap();
        }
        assert_eq!(list.items_c(), &[0u64, 10, 20, 30]);
        list.items_a_mut()[2] = 99;
        assert_eq!(list.get(2).a, 99);
    }

    // Exercise the generic-struct path: field types referencing a lifetime
    // param must still resolve in the generated `__MAL_SIZES` const and the
    // ext-trait signatures.
    #[derive(MultiArrayElement)]
    struct Borrowed<'a> {
        name: &'a [u8],
        n: u32,
    }

    #[test]
    fn derive_generic_lifetime() {
        use self::BorrowedListExt;
        let mut list = MultiArrayList::<Borrowed<'static>>::default();
        list.append(Borrowed { name: b"hi", n: 7 }).unwrap();
        assert_eq!(list.items_name()[0], b"hi");
        assert_eq!(list.items_n()[0], 7);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/multi_array_list.zig (647 lines)
//   confidence: medium
//   todos:      10
//   notes:      Heavy @typeInfo/@field reflection replaced by MultiArrayElement trait (needs #[derive] proc-macro in Phase B); ptrs array fixed at MAX_FIELDS=32 pending generic_const_exprs; index-based sort_context ported as insertionContext/heapContext; allocator params dropped (global mimalloc); union(enum) Elem wrapper deferred to derive.
// ──────────────────────────────────────────────────────────────────────────
