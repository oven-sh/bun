//! Port of `std.MultiArrayList` with the following Bun-specific additions:
//!
//! * `zero` method to zero-initialize memory.
//! * `memory_cost` method, which returns the memory usage in bytes.
//!
//! Synchronized with std as of Zig 0.14.1.
//!
//! A MultiArrayList stores a list of a struct type. Instead of storing a
//! single list of items, MultiArrayList stores separate lists for each field
//! of the struct. This allows for memory savings if the struct has padding,
//! and also improves cache usage if only some fields are needed for a
//! computation. The primary API for accessing fields is the `slice()`
//! function, which computes the start pointers for the array of each field.
//! From the slice you can call `.items::<"field_name", FieldType>()` to obtain
//! a slice of field values.
//!
//! Implementation note: this port uses nightly `core::mem::type_info`
//! reflection to discover `T`'s fields at compile time, replacing the
//! Phase-A `MultiArrayElement` trait + derive macro. Field metadata (name,
//! size, alignment, in-struct offset) is computed in `const` context; column
//! accessors take a `const NAME: &'static str` generic and verify both the
//! name and the requested column type against the reflected field's `TypeId`
//! at compile time, so the column API is fully type-safe with no derive.

use core::alloc::Layout;
use core::any::TypeId;
use core::marker::PhantomData;
use core::mem::type_info::{Type as TypeInfo, TypeKind};
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr;
use std::alloc::{Allocator, Global};

use bun_alloc::AllocError;

/// Declares typed column-accessor extension traits for a `MultiArrayList<$T>`
/// element struct, mirroring Zig's `list.items(.field)` calling convention.
///
/// ```ignore
/// multi_array_columns! {
///     pub trait FooColumns for Foo {
///         a: u32,
///         b: Bar,
///     }
/// }
/// // → list.items_a(): &[u32], list.items_a_mut(): &mut [u32], …
/// //   on both MultiArrayList<Foo> and Slice<Foo>.
/// ```
///
/// Each generated method calls `items::<"field", $ty>()`, so the field name
/// and type are checked against `$T`'s reflected layout at compile time —
/// a typo or type mismatch is a const-eval error, not UB.
#[macro_export]
macro_rules! multi_array_columns {
    // Non-generic form.
    (
        $vis:vis trait $trait:ident for $elem:ty {
            $( $field:ident : $ty:ty ),* $(,)?
        }
    ) => {
        $crate::multi_array_columns! {
            @emit $vis $trait [] [] $elem { $( $field : $ty, )* }
        }
    };
    // Lifetime-only generic form: `['a]` / `['a, 'b]`.
    (
        $vis:vis trait $trait:ident [ $($lt:lifetime),+ ] for $elem:ty {
            $( $field:ident : $ty:ty ),* $(,)?
        }
    ) => {
        $crate::multi_array_columns! {
            @emit $vis $trait [$($lt),+] [$($lt),+] $elem { $( $field : $ty, )* }
        }
    };
    // Single bounded type-parameter form: `[T: Bound + ...]`.
    (
        $vis:vis trait $trait:ident [ $param:ident : $($bound:tt)+ ] for $elem:ty {
            $( $field:ident : $ty:ty ),* $(,)?
        }
    ) => {
        $crate::multi_array_columns! {
            @emit $vis $trait [$param: $($bound)+] [$param] $elem { $( $field : $ty, )* }
        }
    };
    (@emit $vis:vis $trait:ident [$($decl:tt)*] [$($use:tt)*] $elem:ty {
        $( $field:ident : $ty:ty, )*
    }) => {
        $crate::__mal_paste! {
            /// Simultaneous `&mut` view of every column. Returned by
            /// [`split_mut`]($trait::split_mut); columns are physically
            /// disjoint (SoA layout — each occupies a distinct
            /// `[COLUMN_OFFSET_PER_CAP[i]*cap ..)` byte range in the single
            /// backing allocation), so holding all of them mutably at once is
            /// sound. This is the safe replacement for the `items_raw` +
            /// per-site `unsafe { &mut * }` pattern.
            #[allow(dead_code, non_snake_case)]
            $vis struct [<$trait Mut>] <'__mal, $($decl)*> {
                $( pub $field: &'__mal mut [$ty], )*
                #[doc(hidden)]
                pub __mal: ::core::marker::PhantomData<&'__mal mut $elem>,
            }

            /// Raw `*mut [T]` view of every column. Returned by
            /// [`split_raw`]($trait::split_raw). Unlike [`split_mut`], the
            /// pointers are derived directly from the SoA buffer's raw `bytes`
            /// base (root/SharedRW provenance) with **no `&mut` intermediate**,
            /// so they remain valid under Stacked Borrows even when interleaved
            /// with other column accessors on the same list — the use case
            /// `split_mut` cannot serve. Dereferencing is the caller's
            /// responsibility (per-site `unsafe`); columns are physically
            /// disjoint by `COLUMN_OFFSET_PER_CAP`, so distinct-column derefs
            /// never alias. Invalidated by any reallocation of the list.
            #[allow(dead_code, non_snake_case)]
            $vis struct [<$trait Raw>] <$($decl)*> {
                $( pub $field: *mut [$ty], )*
                #[doc(hidden)]
                pub __mal: ::core::marker::PhantomData<*mut $elem>,
            }
            #[allow(dead_code, non_snake_case)]
            impl <$($decl)*> ::core::marker::Copy for [<$trait Raw>] <$($use)*> {}
            #[allow(dead_code, non_snake_case)]
            impl <$($decl)*> ::core::clone::Clone for [<$trait Raw>] <$($use)*> {
                #[inline] fn clone(&self) -> Self { *self }
            }

            #[allow(dead_code, non_snake_case)]
            $vis trait $trait <$($decl)*> {
                $( $crate::__mal_column_sig!($field : $ty); )*
                /// Split-borrow every column at once.
                fn split_mut(&mut self) -> [<$trait Mut>]<'_, $($use)*>;
                /// Raw column pointers (root provenance, no `&mut` intermediate).
                fn split_raw(&self) -> [<$trait Raw>]<$($use)*>;
            }
            #[allow(dead_code, non_snake_case)]
            impl <$($decl)*> $trait <$($use)*> for $crate::MultiArrayList<$elem> {
                $( $crate::__mal_column_impl!($field : $ty); )*
                $crate::__mal_split_mut_impl!([<$trait Mut>] [$($use)*] { $( $field : $ty, )* });
                $crate::__mal_split_raw_impl!([<$trait Raw>] [$($use)*] { $( $field : $ty, )* });
            }
            #[allow(dead_code, non_snake_case)]
            impl <$($decl)*> $trait <$($use)*> for $crate::multi_array_list::Slice<$elem> {
                $( $crate::__mal_column_impl!($field : $ty); )*
                $crate::__mal_split_mut_impl!([<$trait Mut>] [$($use)*] { $( $field : $ty, )* });
                $crate::__mal_split_raw_impl!([<$trait Raw>] [$($use)*] { $( $field : $ty, )* });
            }
        }
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __mal_column_sig {
    ($field:ident : $ty:ty) => {
        $crate::__mal_paste! {
            fn [<items_ $field>](&self) -> &[$ty];
            fn [<items_ $field _mut>](&mut self) -> &mut [$ty];
        }
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __mal_split_mut_impl {
    ($struct:ident [$($use:tt)*] { $( $field:ident : $ty:ty, )* }) => {
        #[inline]
        fn split_mut(&mut self) -> $struct<'_, $($use)*> {
            let __len = self.len();
            // SAFETY: distinct columns of a `MultiArrayList` occupy
            // non-overlapping byte ranges within one allocation
            // (`Reflected::<T>::COLUMN_OFFSET_PER_CAP`); `&mut self` guarantees
            // exclusive access to the whole buffer for `'_`, so materializing
            // one `&mut [F]` per column simultaneously cannot alias.
            unsafe {
                $struct {
                    $( $field: ::core::slice::from_raw_parts_mut(
                        self.items_raw::<{ ::core::stringify!($field) }, $ty>(),
                        __len,
                    ), )*
                    __mal: ::core::marker::PhantomData,
                }
            }
        }
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __mal_split_raw_impl {
    ($struct:ident [$($use:tt)*] { $( $field:ident : $ty:ty, )* }) => {
        #[inline]
        fn split_raw(&self) -> $struct<$($use)*> {
            let __len = self.len();
            $struct {
                $( $field: ::core::ptr::slice_from_raw_parts_mut(
                    self.items_raw::<{ ::core::stringify!($field) }, $ty>(),
                    __len,
                ), )*
                __mal: ::core::marker::PhantomData,
            }
        }
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __mal_column_impl {
    ($field:ident : $ty:ty) => {
        $crate::__mal_paste! {
            #[inline]
            fn [<items_ $field>](&self) -> &[$ty] {
                self.items::<{ ::core::stringify!($field) }, $ty>()
            }
            #[inline]
            fn [<items_ $field _mut>](&mut self) -> &mut [$ty] {
                self.items_mut::<{ ::core::stringify!($field) }, $ty>()
            }
        }
    };
}

/// Upper bound on struct field count. The reflected per-field metadata is
/// cached in fixed-size `[_; MAX_FIELDS]` arrays so `Slice<T>` can be a plain
/// value type without a `where [(); field_count::<T>()]:` bound propagating to
/// every caller.
pub const MAX_FIELDS: usize = 32;

// ──────────────────────── const-eval reflection helpers ───────────────────

use crate::const_str_eq;

/// `TypeId` of `F` without the `'static` bound `TypeId::of` imposes — needed
/// because reflected `Field::ty` ids are not `'static`-restricted, and column
/// callers routinely use lifetime-carrying field types (`&'a [u8]`, `Ref<'a>`).
#[inline(always)]
const fn type_id_of<F: ?Sized>() -> TypeId {
    core::intrinsics::type_id::<F>()
}

/// Reflected fields of `T` (struct only). Panics at const-eval for non-structs.
const fn fields_of<T>() -> &'static [core::mem::type_info::Field] {
    match TypeInfo::of::<T>().kind {
        TypeKind::Struct(s) => s.fields,
        _ => panic!("MultiArrayList<T>: T must be a struct with named fields"),
    }
}

/// Number of fields in `T`.
#[inline(always)]
pub const fn field_count<T>() -> usize {
    fields_of::<T>().len()
}

/// Column-layout sort key for a field of `size` bytes within a struct of
/// alignment `struct_align`.
///
/// The reflection API does not expose `align`, and recursing through nested
/// `TypeId::info()` to reconstruct it ICEs on types containing
/// const-expression array lengths (rustc `type_info` MVP limitation). Instead
/// we compute a key with these properties:
///
///   * `key` is a power of two,
///   * `key` divides `size` (since size is a multiple of true alignment, the
///     largest power-of-two factor of `size` is ≥ true alignment),
///   * `key ≤ struct_align` (a field's alignment never exceeds its parent's),
///   * therefore `true_align ≤ key`.
///
/// Sorting columns by `key` descending then packs them as `Σ size[j] * cap`;
/// because each `size[j]` is a multiple of `key[j] ≥ key[k]`, every column
/// start is a multiple of `key[k] ≥ true_align[k]`, so all columns are
/// correctly aligned without knowing their exact alignment.
const fn align_sort_key(size: usize, struct_align: usize) -> usize {
    if size == 0 {
        return 1;
    }
    // Largest power of two dividing `size`.
    let pow2 = size & size.wrapping_neg();
    if pow2 < struct_align {
        pow2
    } else {
        struct_align
    }
}

#[derive(Clone, Copy)]
struct FieldMeta {
    /// `size_of` the field's type.
    size: usize,
    /// In-struct byte offset (for scatter/gather).
    offset: usize,
    /// Effective alignment (sort key); ZST → 1, otherwise see `align_of_tyid`.
    align: usize,
}

const ZERO_META: FieldMeta = FieldMeta {
    size: 0,
    offset: 0,
    align: 1,
};

/// Per-`T` reflected layout, fully const-evaluated.
struct Reflected<T>(PhantomData<T>);

impl<T> Reflected<T> {
    const COUNT: usize = field_count::<T>();
    const ALIGN: usize = core::mem::align_of::<T>();

    /// `[FieldMeta; COUNT]` in declaration order.
    const META: [FieldMeta; MAX_FIELDS] = {
        let fields = fields_of::<T>();
        let n = fields.len();
        assert!(
            n <= MAX_FIELDS,
            "MultiArrayList: too many fields (raise MAX_FIELDS)",
        );
        let mut out = [ZERO_META; MAX_FIELDS];
        let struct_align = core::mem::align_of::<T>();
        let mut i = 0;
        while i < n {
            let f = &fields[i];
            let size = match f.ty.info().size {
                Some(s) => s,
                None => panic!("MultiArrayList: field type must be Sized"),
            };
            let align = align_sort_key(size, struct_align);
            out[i] = FieldMeta {
                size,
                offset: f.offset,
                align,
            };
            i += 1;
        }
        out
    };

    /// Zig `sizes`: `(SIZES_BYTES, SIZES_FIELDS)` — field sizes sorted by
    /// alignment descending, paired with the original field index at each
    /// sorted position. Stable sort so equal-alignment fields keep order.
    const SIZES: ([usize; MAX_FIELDS], [usize; MAX_FIELDS]) = {
        let n = Self::COUNT;
        let mut idx = [0usize; MAX_FIELDS];
        let mut k = 0;
        while k < n {
            idx[k] = k;
            k += 1;
        }
        // Stable bubble sort, descending by `align`.
        let mut i = 0;
        while i < n {
            let mut j = 0;
            while j + 1 + i < n {
                if Self::META[idx[j]].align < Self::META[idx[j + 1]].align {
                    let tmp = idx[j];
                    idx[j] = idx[j + 1];
                    idx[j + 1] = tmp;
                }
                j += 1;
            }
            i += 1;
        }
        let mut bytes = [0usize; MAX_FIELDS];
        let mut k = 0;
        while k < n {
            bytes[k] = Self::META[idx[k]].size;
            k += 1;
        }
        (bytes, idx)
    };

    /// Σ field sizes — bytes per element across all columns.
    const ELEM_BYTES: usize = {
        let mut sum = 0;
        let mut i = 0;
        while i < Self::COUNT {
            sum += Self::META[i].size;
            i += 1;
        }
        sum
    };

    /// Per-field byte offset *within the column buffer* for capacity 1
    /// (multiply by `capacity` at runtime). Indexed by declaration order.
    const COLUMN_OFFSET_PER_CAP: [usize; MAX_FIELDS] = {
        let n = Self::COUNT;
        let (bytes, fields) = Self::SIZES;
        let mut out = [0usize; MAX_FIELDS];
        let mut running = 0usize;
        let mut k = 0;
        while k < n {
            out[fields[k]] = running;
            running += bytes[k];
            k += 1;
        }
        out
    };

    /// Field index for `NAME`; const-panics if no such field.
    const fn index_of<const NAME: &'static str>() -> usize {
        let fields = fields_of::<T>();
        let mut i = 0;
        while i < fields.len() {
            if const_str_eq(fields[i].name, NAME) {
                return i;
            }
            i += 1;
        }
        panic!("MultiArrayList: no such field");
    }

    /// Const-panics unless field `NAME` exists and has type `F`.
    ///
    /// The type check is `TypeId` equality with a fallback to size equality:
    /// the experimental reflection intrinsic occasionally produces a distinct
    /// `TypeId` for the same nominal type when reached through an inherent
    /// associated type alias (e.g. `EntryPoint::Kind` vs `entry_point::Kind`),
    /// so a size match is accepted when ids differ. Size mismatch is always
    /// rejected.
    const fn check<const NAME: &'static str, F>() -> usize {
        let fields = fields_of::<T>();
        let mut i = 0;
        while i < fields.len() {
            if const_str_eq(fields[i].name, NAME) {
                if fields[i].ty == type_id_of::<F>() {
                    return i;
                }
                assert!(
                    Self::META[i].size == core::mem::size_of::<F>(),
                    "MultiArrayList: column type does not match field type",
                );
                return i;
            }
            i += 1;
        }
        panic!("MultiArrayList: no such field");
    }
}

/// Index-based comparison context for `sort` / `sort_span` / `sort_unstable`.
/// Zig: `ctx: anytype` with `fn lessThan(ctx, a_index: usize, b_index: usize) bool`.
pub trait SortContext {
    fn less_than(&self, a_index: usize, b_index: usize) -> bool;
}

/// Struct-of-arrays list. See module docs.
pub struct MultiArrayList<T, A: Allocator = Global> {
    bytes: *mut u8,
    len: usize,
    capacity: usize,
    alloc: A,
    _marker: PhantomData<T>,
}

// SAFETY: `bytes` is uniquely owned; the only shared state is the allocator.
unsafe impl<T: Send, A: Allocator + Send> Send for MultiArrayList<T, A> {}
unsafe impl<T: Sync, A: Allocator + Sync> Sync for MultiArrayList<T, A> {}

/// A `MultiArrayList::Slice` contains cached start pointers for each field in
/// the list. These pointers are not normally stored to reduce the size of the
/// list in memory. If you are accessing multiple fields, call `slice()` first
/// to compute the pointers, and then get the field arrays from the slice.
pub struct Slice<T> {
    /// Indexed by declaration-order field index.
    ptrs: [*mut u8; MAX_FIELDS],
    len: usize,
    capacity: usize,
    _marker: PhantomData<T>,
}

impl<T> Clone for Slice<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Slice<T> {}

// ───────────────────────────── Slice ─────────────────────────────

impl<T> Slice<T> {
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

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Returns the column slice for field `NAME` typed as `&[F]`.
    ///
    /// Compile-time checked: a const-eval assertion verifies that `T` has a
    /// field named `NAME` and that its type is exactly `F`.
    #[inline]
    pub fn items<const NAME: &'static str, F>(&self) -> &[F] {
        let fi = const { Reflected::<T>::check::<NAME, F>() };
        let p = if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            ptr::NonNull::<F>::dangling().as_ptr()
        } else {
            self.ptrs[fi].cast::<F>()
        };
        // SAFETY: ZST/empty → dangling is valid for any length; otherwise
        // column `fi` is `capacity` contiguous `F`s and `len <= capacity`.
        unsafe { core::slice::from_raw_parts(p, self.len) }
    }

    /// Returns the mutable column slice for field `NAME` typed as `&mut [F]`.
    #[inline]
    pub fn items_mut<const NAME: &'static str, F>(&mut self) -> &mut [F] {
        let fi = const { Reflected::<T>::check::<NAME, F>() };
        let p = if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            ptr::NonNull::<F>::dangling().as_ptr()
        } else {
            self.ptrs[fi].cast::<F>()
        };
        // SAFETY: see `items`. `&mut self` enforces exclusive column access.
        unsafe { core::slice::from_raw_parts_mut(p, self.len) }
    }

    /// Raw column pointer for callers that need simultaneous mutable access to
    /// multiple distinct columns (which `items_mut`'s `&mut self` borrow would
    /// otherwise forbid). Compile-time type-checked like `items`.
    ///
    /// Obtaining the pointer is always sound — it is computed by raw `add` on
    /// the heap buffer base with no `&`/`&mut` intermediate, so it carries the
    /// allocation's root provenance. The returned pointer is valid for
    /// `self.len()` reads/writes; the caller must not create overlapping
    /// `&mut` references to the same column when *dereferencing* it.
    #[inline]
    pub fn items_raw<const NAME: &'static str, F>(&self) -> *mut F {
        let fi = const { Reflected::<T>::check::<NAME, F>() };
        if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            return ptr::NonNull::<F>::dangling().as_ptr();
        }
        self.ptrs[fi].cast::<F>()
    }

    /// Raw column pointer for byte-level operations (internal use).
    #[inline]
    fn ptr(&self, field_index: usize) -> *mut u8 {
        self.ptrs[field_index]
    }

    /// Raw byte view of column `field_index` (declaration order). For
    /// serializers that iterate fields by index without knowing their types.
    ///
    /// # Safety
    /// Returned bytes alias the column storage; caller must not hold any other
    /// borrow of the same column. Field bytes may contain padding.
    #[inline]
    pub unsafe fn column_bytes_mut(&mut self, field_index: usize) -> &mut [u8] {
        debug_assert!(field_index < Reflected::<T>::COUNT);
        let size = Reflected::<T>::META[field_index].size;
        if size == 0 || self.capacity == 0 {
            return &mut [];
        }
        // SAFETY: column `field_index` is `len * size` bytes within the allocation.
        unsafe { core::slice::from_raw_parts_mut(self.ptrs[field_index], self.len * size) }
    }

    /// `size_of` the `field_index`th field (declaration order).
    #[inline]
    pub fn field_size(field_index: usize) -> usize {
        Reflected::<T>::META[field_index].size
    }

    pub fn set(&mut self, index: usize, elem: T) {
        assert!(
            index < self.len,
            "MultiArrayList::Slice::set: index out of bounds"
        );
        // SAFETY: `index < len <= capacity`; ptrs are valid columns.
        unsafe { scatter::<T>(&self.ptrs, index, elem) };
    }

    /// Gather a `T` by per-field `ptr::read` from each column.
    ///
    /// The returned value is a **bitwise copy** — the SoA storage retains
    /// ownership of every field. Dropping the gathered struct would free
    /// columns the storage still owns (double-free on next `get` / `Drop`),
    /// so it is wrapped in `ManuallyDrop`. Zig has no destructors so the
    /// by-value copy is harmless there.
    pub fn get(&self, index: usize) -> ManuallyDrop<T> {
        assert!(
            index < self.len,
            "MultiArrayList::Slice::get: index out of bounds"
        );
        // SAFETY: `index < len <= capacity`; ptrs are valid columns.
        ManuallyDrop::new(unsafe { gather::<T>(&self.ptrs, index) })
    }

    pub fn to_multi_array_list(self) -> MultiArrayList<T> {
        if Reflected::<T>::COUNT == 0 || self.capacity == 0 {
            return MultiArrayList::default();
        }
        // The first entry in `SIZES.1` is the highest-alignment field, whose
        // column starts at the buffer base (offset 0).
        let base = self.ptrs[Reflected::<T>::SIZES.1[0]];
        MultiArrayList {
            bytes: base,
            len: self.len,
            capacity: self.capacity,
            alloc: Global,
            _marker: PhantomData,
        }
    }
}

// ───────────────────── scatter / gather (byte-level) ──────────────────────

/// Scatter `elem`'s fields into the per-field column pointers at `index`.
///
/// # Safety
/// `ptrs[i]` must point to a column of at least `index + 1` elements of the
/// `i`th field's type.
#[inline]
unsafe fn scatter<T>(ptrs: &[*mut u8; MAX_FIELDS], index: usize, elem: T) {
    let elem = ManuallyDrop::new(elem);
    let src = (&raw const *elem).cast::<u8>();
    let n = Reflected::<T>::COUNT;
    let mut i = 0;
    while i < n {
        let m = Reflected::<T>::META[i];
        if m.size != 0 {
            // SAFETY: `src + offset` points to the field within `elem`;
            // `ptrs[i] + index * size` is the column slot. Both regions are
            // `m.size` bytes and do not overlap (stack vs heap).
            unsafe {
                ptr::copy_nonoverlapping(src.add(m.offset), ptrs[i].add(index * m.size), m.size);
            }
        }
        i += 1;
    }
}

/// Gather a `T` from the per-field column pointers at `index`.
///
/// # Safety
/// `ptrs[i]` must point to a column of at least `index + 1` initialized
/// elements of the `i`th field's type.
#[inline]
unsafe fn gather<T>(ptrs: &[*mut u8; MAX_FIELDS], index: usize) -> T {
    let mut out = MaybeUninit::<T>::uninit();
    let dst = out.as_mut_ptr().cast::<u8>();
    let n = Reflected::<T>::COUNT;
    let mut i = 0;
    while i < n {
        let m = Reflected::<T>::META[i];
        if m.size != 0 {
            // SAFETY: see `scatter`.
            unsafe {
                ptr::copy_nonoverlapping(ptrs[i].add(index * m.size), dst.add(m.offset), m.size);
            }
        }
        i += 1;
    }
    // SAFETY: every named field byte has been written; padding bytes remain
    // uninitialized, which is permitted for `T` (matches `ptr::read` semantics).
    unsafe { out.assume_init() }
}

// ───────────────────────────── MultiArrayList ─────────────────────────────

impl<T> Default for MultiArrayList<T, Global> {
    fn default() -> Self {
        Self::new_in(Global)
    }
}

impl<T> MultiArrayList<T, Global> {
    pub const EMPTY: Self = Self {
        bytes: ptr::null_mut(),
        len: 0,
        capacity: 0,
        alloc: Global,
        _marker: PhantomData,
    };
}

impl<T, A: Allocator> MultiArrayList<T, A> {
    /// Construct an empty list backed by `alloc`.
    #[inline]
    pub const fn new_in(alloc: A) -> Self {
        Self {
            bytes: ptr::null_mut(),
            len: 0,
            capacity: 0,
            alloc,
            _marker: PhantomData,
        }
    }

    /// Number of elements.
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// The caller owns the returned memory. Empties this MultiArrayList.
    /// Only available with the global allocator (the returned `Slice` carries
    /// no allocator handle).
    pub fn to_owned_slice(&mut self) -> Slice<T>
    where
        A: Default,
    {
        let old = core::mem::replace(self, Self::new_in(A::default()));
        let result = old.slice();
        core::mem::forget(old);
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
        let (bytes, fields) = Reflected::<T>::SIZES;
        let mut p = self.bytes;
        let mut k = 0;
        while k < Reflected::<T>::COUNT {
            result.ptrs[fields[k]] = p;
            // SAFETY: `p` walks within the single allocation of
            // `capacity_in_bytes(self.capacity)` bytes (or is null when
            // capacity == 0, in which case bytes[k] * 0 == 0 and add(0) is OK).
            // `add` keeps the `inbounds` GEP hint that `wrapping_add` drops.
            p = unsafe { p.add(bytes[k] * self.capacity) };
            k += 1;
        }
        result
    }

    /// Compute the column base pointer for field index `fi`.
    #[inline]
    fn column_ptr_by_index(&self, fi: usize) -> *mut u8 {
        if self.capacity == 0 {
            return ptr::null_mut();
        }
        // SAFETY: column offset within the single allocation; always in-bounds.
        // `add` keeps the `inbounds` GEP hint that `wrapping_add` drops.
        unsafe {
            self.bytes
                .add(Reflected::<T>::COLUMN_OFFSET_PER_CAP[fi] * self.capacity)
        }
    }

    /// Get the shared slice of values for field `NAME`.
    ///
    /// Compile-time checked: const-eval verifies `NAME` is a field of `T` and
    /// `F` is exactly its type.
    #[inline]
    pub fn items<const NAME: &'static str, F>(&self) -> &[F] {
        let fi = const { Reflected::<T>::check::<NAME, F>() };
        let p = if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            ptr::NonNull::<F>::dangling().as_ptr()
        } else {
            self.column_ptr_by_index(fi).cast::<F>()
        };
        // SAFETY: ZST/empty → dangling is valid for any length; otherwise the
        // column holds `capacity` aligned `F`s and `len <= capacity`.
        unsafe { core::slice::from_raw_parts(p, self.len) }
    }

    /// Get the mutable slice of values for field `NAME`.
    #[inline]
    pub fn items_mut<const NAME: &'static str, F>(&mut self) -> &mut [F] {
        let fi = const { Reflected::<T>::check::<NAME, F>() };
        let p = if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            ptr::NonNull::<F>::dangling().as_ptr()
        } else {
            self.column_ptr_by_index(fi).cast::<F>()
        };
        // SAFETY: see `items`. `&mut self` enforces exclusive column access.
        unsafe { core::slice::from_raw_parts_mut(p, self.len) }
    }

    /// Raw column pointer; see [`Slice::items_raw`]. Obtaining the pointer is
    /// always sound; the read/write contract is on the caller's *dereference*.
    #[inline]
    pub fn items_raw<const NAME: &'static str, F>(&self) -> *mut F {
        let fi = const { Reflected::<T>::check::<NAME, F>() };
        if self.capacity == 0 || core::mem::size_of::<F>() == 0 {
            return ptr::NonNull::<F>::dangling().as_ptr();
        }
        self.column_ptr_by_index(fi).cast::<F>()
    }

    /// Overwrite one array element with new data.
    pub fn set(&mut self, index: usize, elem: T) {
        let mut s = self.slice();
        s.set(index, elem);
    }

    /// Obtain all the data for one array element.
    ///
    /// Returns `ManuallyDrop<T>` because the gathered struct is a bitwise
    /// copy of column storage that the list still owns; see [`Slice::get`].
    pub fn get(&self, index: usize) -> ManuallyDrop<T> {
        self.slice().get(index)
    }

    /// Extend the list by 1 element. Allocates more memory as necessary.
    pub fn push(&mut self, elem: T) -> Result<(), AllocError> {
        self.ensure_unused_capacity(1)?;
        self.append_assume_capacity(elem);
        Ok(())
    }

    /// Alias for [`push`] (Zig: `append`).
    #[inline]
    pub fn append(&mut self, elem: T) -> Result<(), AllocError> {
        self.push(elem)
    }

    /// Extend the list by 1 element, asserting `self.capacity` is sufficient
    /// to hold an additional item.
    pub fn append_assume_capacity(&mut self, elem: T) {
        debug_assert!(self.len < self.capacity);
        self.len += 1;
        let mut s = self.slice();
        s.set(self.len - 1, elem);
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
        // Ownership transferred: the storage no longer references this slot.
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
    pub fn insert_assume_capacity(&mut self, index: usize, elem: T) {
        debug_assert!(self.len < self.capacity);
        debug_assert!(index <= self.len);
        self.len += 1;
        let mut slices = self.slice();
        for fi in 0..Reflected::<T>::COUNT {
            let size = Reflected::<T>::META[fi].size;
            if size == 0 {
                continue;
            }
            let base = slices.ptr(fi);
            let mut i = self.len - 1;
            while i > index {
                // SAFETY: `i` and `i-1` are < len <= capacity; column is contiguous.
                unsafe {
                    ptr::copy_nonoverlapping(base.add((i - 1) * size), base.add(i * size), size);
                }
                i -= 1;
            }
        }
        slices.set(index, elem);
    }

    pub fn append_list_assume_capacity(&mut self, other: &Self) {
        let offset = self.len;
        self.len += other.len;
        let other_slice = other.slice();
        let this_slice = self.slice();
        for fi in 0..Reflected::<T>::COUNT {
            let size = Reflected::<T>::META[fi].size;
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
        assert!(
            index < self.len,
            "MultiArrayList::swap_remove: index out of bounds"
        );
        let slices = self.slice();
        for fi in 0..Reflected::<T>::COUNT {
            let size = Reflected::<T>::META[fi].size;
            if size == 0 {
                continue;
            }
            let base = slices.ptr(fi);
            // SAFETY: `index < len` and `len-1 < len <= capacity`. Regions overlap
            // exactly when `index == len-1` (src == dst), which `copy` handles.
            unsafe {
                ptr::copy(
                    base.add((self.len - 1) * size),
                    base.add(index * size),
                    size,
                );
            }
        }
        self.len -= 1;
    }

    /// Remove the specified item from the list, shifting items
    /// after it to preserve order.
    pub fn ordered_remove(&mut self, index: usize) {
        assert!(
            index < self.len,
            "MultiArrayList::ordered_remove: index out of bounds"
        );
        let slices = self.slice();
        for fi in 0..Reflected::<T>::COUNT {
            let size = Reflected::<T>::META[fi].size;
            if size == 0 {
                continue;
            }
            let base = slices.ptr(fi);
            let mut i = index;
            while i < self.len - 1 {
                // SAFETY: `i` and `i+1` are < len <= capacity.
                unsafe {
                    ptr::copy_nonoverlapping(base.add((i + 1) * size), base.add(i * size), size);
                }
                i += 1;
            }
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
    pub fn shrink_and_free(&mut self, new_len: usize) {
        if new_len == 0 {
            return self.clear_and_free();
        }
        debug_assert!(new_len <= self.capacity);
        debug_assert!(new_len <= self.len);

        let other_layout = layout_for::<T>(new_len);
        let other_bytes = match aligned_alloc(&self.alloc, other_layout) {
            Ok(p) => p,
            Err(_) => {
                self.len = new_len;
                return;
            }
        };
        // Copy columns into the fresh allocation.
        self.len = new_len;
        let self_slice = self.slice();
        let mut dst = other_bytes;
        let (bytes, fields) = Reflected::<T>::SIZES;
        for k in 0..Reflected::<T>::COUNT {
            let size = bytes[k];
            if size != 0 {
                // SAFETY: both columns hold `new_len` elements; allocations distinct.
                unsafe {
                    ptr::copy_nonoverlapping(self_slice.ptr(fields[k]), dst, new_len * size);
                }
            }
            // SAFETY: within the fresh allocation; always in-bounds.
            dst = unsafe { dst.add(size * new_len) };
        }
        self.free_allocated_bytes();
        self.bytes = other_bytes;
        self.capacity = new_len;
    }

    pub fn clear_and_free(&mut self) {
        self.free_allocated_bytes();
        self.bytes = ptr::null_mut();
        self.len = 0;
        self.capacity = 0;
    }

    /// Run every element's destructor, then reset to empty (`len = 0`,
    /// capacity retained).
    ///
    /// `Drop` for this type is **slab-only** — it frees the SoA backing buffer
    /// but never runs column destructors (see the `Drop` impl for why: bitwise
    /// [`clone`] aliasing). When `T` has fields that own global-heap resources
    /// and the list is the unique owner, call this before the list goes out of
    /// scope or those payloads leak. No-op when `!needs_drop::<T>()`.
    ///
    /// Elements are dropped by gathering each row's column bytes back into a
    /// stack `T` (the inverse of [`scatter`]) and letting it drop, so every
    /// field — not just one named column — is destructed.
    pub fn drop_elements(&mut self) {
        if core::mem::needs_drop::<T>() && self.len != 0 {
            let s = self.slice();
            for i in 0..self.len {
                // SAFETY: `i < len <= capacity`; every column holds an
                // initialized field at `i`. `gather` bit-copies those bytes
                // into a stack `T`; dropping it runs each field's destructor
                // exactly once. The SoA bytes for row `i` are not read again:
                // `len` is zeroed immediately after the loop.
                unsafe { drop(gather::<T>(&s.ptrs, i)) };
            }
        }
        self.len = 0;
    }

    /// Reduce length to `new_len`.
    pub fn shrink_retaining_capacity(&mut self, new_len: usize) {
        self.len = new_len;
    }

    /// Invalidates all element pointers.
    pub fn clear_retaining_capacity(&mut self) {
        self.len = 0;
    }

    /// Modify the array so that it can hold at least `new_capacity` items.
    pub fn ensure_total_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        if self.capacity >= new_capacity {
            return Ok(());
        }
        self.set_capacity(grow_capacity::<T>(self.capacity, new_capacity))
    }

    /// Modify the array so that it can hold at least `additional_count` **more** items.
    pub fn ensure_unused_capacity(&mut self, additional_count: usize) -> Result<(), AllocError> {
        self.ensure_total_capacity(self.len + additional_count)
    }

    /// Modify the array so that it can hold exactly `new_capacity` items.
    /// `new_capacity` must be greater or equal to `len`.
    pub fn set_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        debug_assert!(new_capacity >= self.len);
        let new_layout = layout_for::<T>(new_capacity);
        let new_bytes = aligned_alloc(&self.alloc, new_layout)?;
        if self.len == 0 {
            self.free_allocated_bytes();
            self.bytes = new_bytes;
            self.capacity = new_capacity;
            return Ok(());
        }
        // Copy each column into the new allocation, then free the old one.
        let self_slice = self.slice();
        let mut dst = new_bytes;
        let (bytes, fields) = Reflected::<T>::SIZES;
        for k in 0..Reflected::<T>::COUNT {
            let size = bytes[k];
            if size != 0 {
                // SAFETY: both columns hold `self.len` elements; allocations distinct.
                unsafe {
                    ptr::copy_nonoverlapping(self_slice.ptr(fields[k]), dst, self.len * size);
                }
            }
            // SAFETY: within the fresh allocation; always in-bounds.
            dst = unsafe { dst.add(size * new_capacity) };
        }
        self.free_allocated_bytes();
        self.bytes = new_bytes;
        self.capacity = new_capacity;
        Ok(())
    }

    /// Create a copy of this list with a new backing store.
    pub fn clone(&self) -> Result<Self, AllocError>
    where
        A: Clone,
    {
        let mut result = Self::new_in(self.alloc.clone());
        result.ensure_total_capacity(self.len)?;
        result.len = self.len;
        let self_slice = self.slice();
        let result_slice = result.slice();
        for fi in 0..Reflected::<T>::COUNT {
            let size = Reflected::<T>::META[fi].size;
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

    fn sort_internal<C: SortContext, const STABLE: bool>(&self, a: usize, b: usize, ctx: C) {
        let slice = self.slice();
        let swap = |a_index: usize, b_index: usize| {
            for fi in 0..Reflected::<T>::COUNT {
                let size = Reflected::<T>::META[fi].size;
                if size != 0 {
                    let base = slice.ptr(fi);
                    // SAFETY: indices are < len; columns are contiguous; a != b
                    // is guaranteed by sort impls.
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

        match STABLE {
            true => bun_collections_sort_context(a, b, less, swap),
            false => bun_collections_sort_unstable_context(a, b, less, swap),
        }
    }

    /// Stable sort by index-based context.
    pub fn sort<C: SortContext>(&self, ctx: C) {
        self.sort_internal::<C, true>(0, self.len, ctx);
    }

    /// Stable sort of `[a, b)` by index-based context.
    pub fn sort_span<C: SortContext>(&self, a: usize, b: usize, ctx: C) {
        self.sort_internal::<C, true>(a, b, ctx);
    }

    /// Unstable sort by index-based context.
    pub fn sort_unstable<C: SortContext>(&self, ctx: C) {
        self.sort_internal::<C, false>(0, self.len, ctx);
    }

    /// Unstable sort of `[a, b)` by index-based context.
    pub fn sort_span_unstable<C: SortContext>(&self, a: usize, b: usize, ctx: C) {
        self.sort_internal::<C, false>(a, b, ctx);
    }

    pub fn capacity_in_bytes(capacity: usize) -> usize {
        Reflected::<T>::ELEM_BYTES * capacity
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

    /// Free the current backing allocation (if any) and reset `capacity` so a
    /// repeat call is a no-op. Safe: `bytes`/`capacity` are private and every
    /// constructor/mutator upholds the invariant that when
    /// `layout_for::<T>(self.capacity)` is `Some(layout)`, `self.bytes` is a
    /// live non-null allocation from `self.alloc` with exactly `layout` (see
    /// [`aligned_alloc`] / [`set_capacity`]).
    fn free_allocated_bytes(&mut self) {
        if let Some(layout) = layout_for::<T>(self.capacity) {
            // SAFETY: type invariant above — `self.bytes` is non-null and was
            // allocated by `self.alloc` with exactly `layout`.
            unsafe {
                self.alloc
                    .deallocate(ptr::NonNull::new_unchecked(self.bytes), layout)
            };
            // Re-establish the invariant immediately so an (accidental) second
            // call before the caller installs a new buffer is a no-op rather
            // than a double-free. Callers overwrite both fields right after.
            self.capacity = 0;
        }
    }

    /// # Safety
    /// `new_len <= self.capacity()`, and every column element in
    /// `old_len..new_len` must be initialized before any read.
    #[inline]
    pub unsafe fn set_len(&mut self, new_len: usize) {
        debug_assert!(new_len <= self.capacity);
        self.len = new_len;
    }
}

impl<T, A: Allocator> Drop for MultiArrayList<T, A> {
    fn drop(&mut self) {
        // Zig `deinit(self, gpa)`: `gpa.free(self.allocatedBytes())` — slab
        // only, no per-element destructors. This is **intentionally preserved**:
        // [`clone`] is a bitwise SoA memcpy (Zig semantics), so two live lists
        // can alias the same column heap pointers — see `bundle_v2.rs`
        // `clone_ast` / `deinit_without_freeing_arena`, which drains exactly
        // one alias and relies on the other dropping slab-only. Running
        // element destructors here would double-free that side.
        //
        // For lists that *do* uniquely own heap-backed columns (e.g.
        // `LineOffsetTable.columns_for_non_ascii: Vec<i32>`), call
        // [`MultiArrayList::drop_elements`] before letting this run, or the
        // column payloads leak.
        if let Some(layout) = layout_for::<T>(self.capacity) {
            // SAFETY: `bytes` was allocated with exactly `layout` and is
            // freed exactly once here.
            unsafe {
                self.alloc
                    .deallocate(ptr::NonNull::new_unchecked(self.bytes), layout)
            };
        }
    }
}

// ───────────────────────────── helpers ─────────────────────────────

/// `std.atomic.cache_line` — **128** on x86_64 and aarch64, all native targets.
const CACHE_LINE: usize = 128;

const fn init_capacity<T>() -> usize {
    let mut max = 1usize;
    let mut i = 0;
    while i < Reflected::<T>::COUNT {
        if Reflected::<T>::META[i].size > max {
            max = Reflected::<T>::META[i].size;
        }
        i += 1;
    }
    let cl = CACHE_LINE / max;
    if cl > 1 { cl } else { 1 }
}

/// Called when memory growth is necessary. Returns a capacity larger than
/// minimum that grows super-linearly.
fn grow_capacity<T>(current: usize, minimum: usize) -> usize {
    let init = const { init_capacity::<T>() };
    let mut new = current;
    loop {
        new = new.saturating_add(new / 2 + init);
        if new >= minimum {
            return new;
        }
    }
}

/// Layout for `capacity` elements: `(Σ field sizes) * capacity` bytes at
/// `align_of::<T>()`. `None` for zero-size (no allocation needed).
#[inline]
fn layout_for<T>(capacity: usize) -> Option<Layout> {
    let n = Reflected::<T>::ELEM_BYTES * capacity;
    if n == 0 {
        return None;
    }
    Some(Layout::from_size_align(n, Reflected::<T>::ALIGN).expect("MultiArrayList layout overflow"))
}

fn aligned_alloc<A: Allocator>(alloc: &A, layout: Option<Layout>) -> Result<*mut u8, AllocError> {
    let Some(layout) = layout else {
        return Ok(ptr::null_mut());
    };
    alloc
        .allocate(layout)
        .map(|p| p.as_ptr().cast::<u8>())
        .map_err(|_| AllocError)
}

// Index-based context sorts — port of `mem.sortContext` / `mem.sortUnstableContext`.

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

    let mut i = a + (b - a) / 2;
    while i > a {
        i -= 1;
        sift_down(a, i, b, &less, &swap);
    }

    i = b;
    while i > a {
        i -= 1;
        if i == a {
            break;
        }
        swap(a, i);
        sift_down(a, a, i, &less, &swap);
    }
}

fn sift_down(
    a: usize,
    target: usize,
    b: usize,
    less: &impl Fn(usize, usize) -> bool,
    swap: &impl Fn(usize, usize),
) {
    let mut cur = target;
    loop {
        let Some(twice) = (cur - a).checked_mul(2) else {
            break;
        };
        let mut child = twice + a + 1;
        if !(child < b) {
            break;
        }
        let next_child = child + 1;
        if next_child < b && less(child, next_child) {
            child = next_child;
        }
        if less(child, cur) {
            break;
        }
        swap(child, cur);
        cur = child;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Debug)]
    struct Foo {
        a: u32,
        b: u8,
        c: u64,
    }

    #[test]
    fn reflected_metadata() {
        assert_eq!(Reflected::<Foo>::COUNT, 3);
        // Sorted by alignment descending: c(u64=8), a(u32=4), b(u8=1).
        assert_eq!(&Reflected::<Foo>::SIZES.0[..3], &[8, 4, 1]);
        assert_eq!(&Reflected::<Foo>::SIZES.1[..3], &[2, 0, 1]);
        assert_eq!(const { Reflected::<Foo>::index_of::<"b">() }, 1);
    }

    #[test]
    fn roundtrip() {
        let mut list = MultiArrayList::<Foo>::default();
        for i in 0..10u32 {
            list.push(Foo {
                a: i,
                b: i as u8,
                c: i as u64 * 100,
            })
            .unwrap();
        }
        let s = list.slice();
        assert_eq!(s.items::<"c", u64>()[7], 700);
        assert_eq!(s.items::<"a", u32>()[3], 3);
        assert_eq!(*list.get(5), Foo { a: 5, b: 5, c: 500 });
    }

    #[test]
    fn list_items() {
        let mut list = MultiArrayList::<Foo>::default();
        for i in 0..4u32 {
            list.push(Foo {
                a: i,
                b: i as u8,
                c: i as u64 * 10,
            })
            .unwrap();
        }
        assert_eq!(list.items::<"c", u64>(), &[0u64, 10, 20, 30]);
        list.items_mut::<"a", u32>()[2] = 99;
        assert_eq!(list.get(2).a, 99);
        assert_eq!(list.pop().unwrap().c, 30);
        assert_eq!(list.len(), 3);
    }

    struct Borrowed<'a> {
        name: &'a [u8],
        n: u32,
    }

    #[test]
    fn generic_lifetime() {
        let mut list = MultiArrayList::<Borrowed<'static>>::default();
        list.push(Borrowed { name: b"hi", n: 7 }).unwrap();
        assert_eq!(list.items::<"name", &[u8]>()[0], b"hi");
        assert_eq!(list.items::<"n", u32>()[0], 7);
    }
}

// ported from: src/collections/multi_array_list.zig
