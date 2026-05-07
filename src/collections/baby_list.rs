use core::fmt;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_alloc::AllocError;
// TODO(b0): `strings` arrives in bun_core via move-in (was bun_str::strings — same-tier cycle).
use bun_core::strings;

// TODO(port): Environment.ci_assert — using debug_assertions as the closest analogue.
pub const SAFETY_CHECKS: bool = cfg!(debug_assertions);
const TRACES_ENABLED: bool = cfg!(debug_assertions);

#[derive(Clone)]
enum Origin {
    Owned,
    Borrowed {
        // TODO(port): StoredTrace when traces_enabled, () otherwise — Rust cannot express
        // `if (traces_enabled) StoredTrace else void` as a field type without cfg gymnastics.
        // TODO(b0): StoredTrace arrives in bun_core via move-in (MOVE_DOWN from crash_handler).
        #[cfg(debug_assertions)]
        trace: Option<bun_core::StoredTrace>,
    },
}

/// This is like ArrayList except it stores the length and capacity as u32
/// In practice, it is very unusual to have lengths above 4 GiB
#[repr(C)]
pub struct BabyList<T> {
    // NOTE: If you add, remove, or rename any public fields, you need to update
    // `looksLikeListContainerType` in `meta.zig`.

    /// Don't access this field directly, as it's not safety-checked. Use `.slice()`, `.at()`,
    /// or `.mut()`.
    pub ptr: NonNull<T>,
    pub len: u32,
    pub cap: u32,
    // NOTE: `origin` is intentionally NOT cfg-gated. `from_bump_slice` hands out lists backed by
    // arena memory; if `Drop` cannot see `Origin::Borrowed` in release builds it will pass arena
    // pointers to the global allocator's `free`, which is UB. The trace payload inside `Borrowed`
    // remains debug-only so release builds pay only one discriminant byte.
    origin: Origin,
    // PORT NOTE: Zig had `#allocator: bun.safety.CheckedAllocator` — dropped because Rust uses the
    // global mimalloc allocator (see PORTING.md §Allocators). All `allocator` params are removed.
}

// SAFETY: BabyList<T> owns its buffer like Vec<T>; Send/Sync follow T.
unsafe impl<T: Send> Send for BabyList<T> {}
unsafe impl<T: Sync> Sync for BabyList<T> {}

impl<T> Default for BabyList<T> {
    fn default() -> Self {
        Self {
            ptr: NonNull::dangling(),
            len: 0,
            cap: 0,
            origin: Origin::Owned,
        }
    }
}

impl<T> Drop for BabyList<T> {
    fn drop(&mut self) {
        // PORT NOTE: Zig `deinit` was explicit and took an allocator. In Rust the global allocator
        // is mimalloc and Drop is implicit. Borrowed lists (from `from_bump_slice` /
        // `from_borrowed_slice_dangerous`) point at arena or caller-owned memory, so we MUST NOT
        // hand that pointer to `Vec::from_raw_parts` below — freeing it via the global allocator
        // is UB. This guard is unconditional (not debug-only) for that reason.
        if matches!(self.origin, Origin::Borrowed { .. }) {
            return;
        }
        if self.cap != 0 {
            // SAFETY: ptr/len/cap were obtained from a Vec<T> (or equivalent alloc) and not freed.
            unsafe {
                drop(Vec::from_raw_parts(
                    self.ptr.as_ptr(),
                    self.len as usize,
                    self.cap as usize,
                ));
            }
        }
    }
}

impl<T> BabyList<T> {
    // Zig's `pub const Elem = T;` — inherent assoc types unstable; callers use
    // the generic param directly. Dropped.

    pub const EMPTY: Self = Self {
        ptr: NonNull::dangling(),
        len: 0,
        cap: 0,
        origin: Origin::Owned,
    };

    pub fn init_capacity(len: usize) -> Result<Self, AllocError> {
        let mut v: Vec<T> = Vec::new();
        v.try_reserve_exact(len).map_err(|_| AllocError)?;
        // PORT NOTE: Zig used `allocator.alloc(Type, len)` then `initWithBuffer` (len=0, cap=len).
        Ok(Self::init_with_buffer_vec(v))
    }

    /// Allocate `cap` uninitialised slots in a bump arena and return a list
    /// with `len = 0, cap = cap, origin = Borrowed`.
    ///
    /// Mirrors Zig `BabyList(T).initCapacity(arena_allocator, cap)`: `Drop` is
    /// a no-op (the arena owns the buffer), so the resulting list — and any
    /// bitwise copy of its header — may be safely dropped without freeing.
    /// Growth via `append`/`ensure_*` is **not** supported; callers must
    /// pre-size and use `append_assume_capacity`.
    pub fn init_capacity_in(arena: &bun_alloc::Arena, cap: usize) -> Self {
        let ptr = if cap == 0 {
            NonNull::dangling()
        } else {
            let layout = core::alloc::Layout::array::<T>(cap).expect("overflow");
            arena.alloc_layout(layout).cast::<T>()
        };
        Self {
            ptr,
            len: 0,
            cap: u32::try_from(cap).unwrap(),
            origin: Origin::Borrowed {
                #[cfg(debug_assertions)]
                trace: None,
            },
        }
    }

    /// Construct from raw `(ptr, len, cap)` triple.
    ///
    /// # Safety
    /// Same invariants as `Vec::from_raw_parts`: `ptr` must be either dangling
    /// (for `cap == 0`) or a global-allocator allocation of `cap` `T`s, of
    /// which the first `len` are initialized.
    pub unsafe fn from_raw_parts(ptr: *mut T, len: u32, cap: u32) -> Self {
        Self {
            // SAFETY: caller contract — ptr is non-null (dangling for cap==0).
            ptr: unsafe { NonNull::new_unchecked(ptr) },
            len,
            cap,
            origin: Origin::Owned,
        }
    }

    pub fn init_one(value: T) -> Result<Self, AllocError> {
        let mut v: Vec<T> = Vec::new();
        v.try_reserve_exact(1).map_err(|_| AllocError)?;
        v.push(value);
        Ok(Self::move_from_list(v))
    }

    /// PORT NOTE: Zig `moveFromList` used `@hasField`/`@hasDecl` reflection to accept any
    /// list-like type (`ArrayList`, `ArrayListUnmanaged`, `BabyList`, ...). In Rust the universal
    /// owned growable buffer is `Vec<T>`; callers convert to `Vec<T>` first.
    // TODO(port): if other source types are needed, add `From<X> for BabyList<T>` impls.
    pub fn move_from_list(mut list: Vec<T>) -> Self {
        let capacity = list.capacity();
        let items_len = list.len();
        if cfg!(debug_assertions) {
            debug_assert!(items_len <= capacity);
        }
        let ptr = list.as_mut_ptr();
        core::mem::forget(list);
        Self {
            // SAFETY: Vec guarantees a non-null pointer (dangling when cap == 0).
            ptr: unsafe { NonNull::new_unchecked(ptr) },
            len: u32::try_from(items_len).unwrap(),
            cap: u32::try_from(capacity).unwrap(),
            origin: Origin::Owned,
        }
    }

    /// Requirements:
    ///
    /// * `items` must be owned memory, allocated with some allocator. That same allocator must
    ///   be passed to methods that expect it, like `append`.
    ///
    /// * `items` must be the *entire* region of allocated memory. It cannot be a subslice.
    ///   If you really need an owned subslice, use `shrinkRetainingCapacity` followed by
    ///   `toOwnedSlice` on an `ArrayList`.
    pub fn from_owned_slice(items: Box<[T]>) -> Self {
        let len = items.len();
        // SAFETY: Box<[T]> pointer is non-null.
        let ptr = unsafe { NonNull::new_unchecked(Box::into_raw(items) as *mut T) };
        Self {
            ptr,
            len: u32::try_from(len).unwrap(),
            cap: u32::try_from(len).unwrap(),
            origin: Origin::Owned,
        }
    }

    /// Wrap a bump-arena (or otherwise externally-owned) slice as a BabyList
    /// without taking ownership. `Drop` will *not* free the buffer (origin is
    /// `Borrowed`, checked unconditionally in `Drop`).
    ///
    /// Used by the JS parser for `&'bump mut [T]` AST node lists where the
    /// Zig side passed `BabyList(T).fromOwnedSlice(arena_slice)`.
    ///
    /// # Safety
    /// Caller must not call any growth method (`append`, `ensure_*`) on the
    /// resulting list — the buffer was not allocated by the global allocator.
    pub unsafe fn from_bump_slice(items: &mut [T]) -> Self {
        let len = items.len();
        Self {
            // SAFETY: slice pointer is non-null (dangling for len==0 via [T]::as_mut_ptr).
            ptr: unsafe { NonNull::new_unchecked(items.as_mut_ptr()) },
            len: u32::try_from(len).unwrap(),
            cap: u32::try_from(len).unwrap(),
            origin: Origin::Borrowed {
                #[cfg(debug_assertions)]
                trace: None,
            },
        }
    }

    /// Same requirements as `from_owned_slice`.
    /// PORT NOTE: takes a `Vec<T>` with len==0 (the buffer); Zig took a raw `[]Type`.
    pub fn init_with_buffer_vec(buffer: Vec<T>) -> Self {
        let mut this = Self::move_from_list(buffer);
        this.len = 0;
        this
    }

    /// Same requirements as `from_owned_slice`.
    ///
    /// # Safety
    /// `buffer` must be the entire region of an allocation from the global allocator with
    /// `Layout::array::<T>(buffer.len())`.
    pub unsafe fn init_with_buffer(buffer: *mut T, buffer_len: usize) -> Self {
        Self {
            // SAFETY: caller contract.
            ptr: unsafe { NonNull::new_unchecked(buffer) },
            len: 0,
            cap: u32::try_from(buffer_len).unwrap(),
            origin: Origin::Owned,
        }
    }

    /// Copies all elements of `items` into new memory. Creates shallow copies.
    pub fn from_slice(items: &[T]) -> Result<Self, AllocError>
    where
        T: Clone,
    {
        let mut allocated: Vec<T> = Vec::new();
        allocated
            .try_reserve_exact(items.len())
            .map_err(|_| AllocError)?;
        allocated.extend_from_slice(items);
        Ok(Self::move_from_list(allocated))
    }

    // PORT NOTE: `pub fn deinit` → `impl Drop` (see above). The Zig version invalidated `*this`;
    // Rust ownership makes that implicit.

    pub fn clear_and_free(&mut self) {
        *self = Self::default();
    }

    pub fn clear_retaining_capacity(&mut self) {
        // PORT NOTE: Zig set len=0 without dropping elements (Zig has no destructors). In Rust we
        // must drop the live elements first.
        let mut v = self.list_managed();
        v.clear();
        self.update(v);
    }

    #[inline]
    pub fn slice(&self) -> &[T] {
        // SAFETY: ptr is valid for len elements.
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }

    #[inline]
    pub fn slice_mut(&mut self) -> &mut [T] {
        // SAFETY: ptr is valid for len elements; we have &mut self.
        unsafe { core::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len as usize) }
    }

    /// Same as `.slice()`, with an explicit coercion to const.
    #[inline]
    pub fn slice_const(&self) -> &[T] {
        self.slice()
    }

    #[inline]
    pub fn at(&self, index: usize) -> &T {
        debug_assert!(index < self.len as usize);
        // SAFETY: asserted in-bounds.
        unsafe { &*self.ptr.as_ptr().add(index) }
    }

    #[inline]
    pub fn mut_(&mut self, index: usize) -> &mut T {
        debug_assert!(index < self.len as usize);
        // SAFETY: asserted in-bounds; we have &mut self.
        unsafe { &mut *self.ptr.as_ptr().add(index) }
    }

    #[inline]
    pub fn first(&mut self) -> Option<&mut T> {
        if self.len > 0 {
            // SAFETY: len > 0 so ptr[0] is initialized; `&mut self` gives exclusive access to the
            // buffer (no other `&mut` to this allocation can be live), and the returned borrow is
            // tied to `'_` of `self`.
            Some(unsafe { &mut *self.ptr.as_ptr() })
        } else {
            None
        }
    }

    #[inline]
    pub fn last(&mut self) -> Option<&mut T> {
        if self.len > 0 {
            // SAFETY: len > 0 so ptr[len-1] is initialized; `&mut self` gives exclusive access to
            // the buffer (no other `&mut` to this allocation can be live), and the returned borrow
            // is tied to `'_` of `self`.
            Some(unsafe { &mut *self.ptr.as_ptr().add(self.len as usize - 1) })
        } else {
            None
        }
    }

    /// Empties the `BabyList`.
    pub fn to_owned_slice(&mut self) -> Result<Box<[T]>, AllocError> {
        if SAFETY_CHECKS && self.len != self.cap {
            self.assert_owned();
        }
        let list_ = ManuallyDrop::into_inner(self.list_managed());
        // PERF(port): Zig `toOwnedSlice` may shrink the allocation; `into_boxed_slice` does too.
        let result = list_.into_boxed_slice();
        // SAFETY: ownership moved into `result`; reset self without dropping.
        unsafe { core::ptr::write(self, Self::default()) };
        Ok(result)
    }

    pub fn move_to_list(&mut self) -> Vec<T> {
        self.assert_owned();
        let v = ManuallyDrop::into_inner(self.list());
        // SAFETY: ownership moved into `v`; reset self without dropping.
        unsafe { core::ptr::write(self, Self::default()) };
        v
    }

    // PORT NOTE: `moveToListManaged` collapses into `move_to_list` — Rust has no managed/unmanaged
    // ArrayList split.
    pub fn move_to_list_managed(&mut self) -> Vec<T> {
        self.move_to_list()
    }

    pub fn expand_to_capacity(&mut self) {
        // TODO(port): this exposes uninitialized elements when T is not zero-init-safe. Zig allowed
        // it because Zig has no destructors and treats uninit reads as the caller's problem.
        self.len = self.cap;
    }

    pub fn ensure_total_capacity(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        if SAFETY_CHECKS && new_capacity > self.cap as usize {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        let additional = new_capacity.saturating_sub(list_.len());
        list_.try_reserve(additional).map_err(|_| AllocError)?;
        self.update(list_);
        Ok(())
    }

    pub fn ensure_total_capacity_precise(&mut self, new_capacity: usize) -> Result<(), AllocError> {
        if SAFETY_CHECKS && new_capacity > self.cap as usize {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        let additional = new_capacity.saturating_sub(list_.len());
        list_.try_reserve_exact(additional).map_err(|_| AllocError)?;
        self.update(list_);
        Ok(())
    }

    pub fn ensure_unused_capacity(&mut self, count: usize) -> Result<(), AllocError> {
        if SAFETY_CHECKS && count > (self.cap - self.len) as usize {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.try_reserve(count).map_err(|_| AllocError)?;
        self.update(list_);
        Ok(())
    }

    pub fn shrink_and_free(&mut self, new_len: usize) {
        if SAFETY_CHECKS && new_len < self.cap as usize {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.truncate(new_len);
        list_.shrink_to_fit();
        self.update(list_);
    }

    pub fn shrink_retaining_capacity(&mut self, new_len: usize) {
        debug_assert!(
            new_len <= self.len as usize,
            "shrinkRetainingCapacity: new len ({}) cannot exceed old ({})",
            new_len,
            self.len,
        );
        // PORT NOTE: drop truncated elements (Zig had no destructors).
        let mut list_ = self.list_managed();
        list_.truncate(new_len);
        self.update(list_);
    }

    pub fn append(&mut self, value: T) -> Result<(), AllocError> {
        if SAFETY_CHECKS && self.len == self.cap {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.try_reserve(1).map_err(|_| AllocError)?;
        list_.push(value);
        self.update(list_);
        Ok(())
    }

    pub fn append_assume_capacity(&mut self, value: T) {
        debug_assert!(self.cap > self.len);
        // SAFETY: cap > len, so ptr[len] is within the allocated, uninitialized tail.
        unsafe { self.ptr.as_ptr().add(self.len as usize).write(value) };
        self.len += 1;
    }

    pub fn append_slice(&mut self, vals: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        if SAFETY_CHECKS && ((self.cap - self.len) as usize) < vals.len() {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.try_reserve(vals.len()).map_err(|_| AllocError)?;
        list_.extend_from_slice(vals);
        self.update(list_);
        Ok(())
    }

    pub fn append_slice_assume_capacity(&mut self, values: &[T])
    where
        T: Copy,
    {
        debug_assert!(self.cap >= self.len + u32::try_from(values.len()).unwrap());
        // SAFETY: capacity asserted above; tail is uninitialized.
        unsafe {
            let tail = self.ptr.as_ptr().add(self.len as usize);
            core::ptr::copy_nonoverlapping(values.as_ptr(), tail, values.len());
        }
        self.len += u32::try_from(values.len()).unwrap();
        debug_assert!(self.cap >= self.len);
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            return None;
        }
        self.len -= 1;
        // SAFETY: element at index `len` (post-decrement) is initialized; we move it out.
        Some(unsafe { self.ptr.as_ptr().add(self.len as usize).read() })
    }

    pub fn ordered_remove(&mut self, index: usize) -> T {
        let mut l = self.list_managed();
        let out = l.remove(index);
        self.update(l);
        out
    }

    pub fn swap_remove(&mut self, index: usize) -> T {
        let mut l = self.list_managed();
        let out = l.swap_remove(index);
        self.update(l);
        out
    }

    pub fn insert(&mut self, index: usize, val: T) -> Result<(), AllocError> {
        if SAFETY_CHECKS && self.len == self.cap {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.try_reserve(1).map_err(|_| AllocError)?;
        list_.insert(index, val);
        self.update(list_);
        Ok(())
    }

    pub fn insert_slice(&mut self, index: usize, vals: &[T]) -> Result<(), AllocError>
    where
        T: Clone,
    {
        if SAFETY_CHECKS && ((self.cap - self.len) as usize) < vals.len() {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.try_reserve(vals.len()).map_err(|_| AllocError)?;
        list_.splice(index..index, vals.iter().cloned());
        self.update(list_);
        Ok(())
    }

    pub fn replace_range(
        &mut self,
        start: usize,
        len_: usize,
        new_items: &[T],
    ) -> Result<(), AllocError>
    where
        T: Clone,
    {
        let mut list_ = self.list_managed();
        if new_items.len() > len_ {
            list_
                .try_reserve(new_items.len() - len_)
                .map_err(|_| AllocError)?;
        }
        list_.splice(start..start + len_, new_items.iter().cloned());
        self.update(list_);
        Ok(())
    }

    /// Bitwise-alias the `(ptr, len, cap)` header without taking ownership.
    ///
    /// Mirrors Zig's struct-copy `list.*` semantics for the many call sites
    /// that fork a `BabyList` view, mutate it, and write it back (e.g.
    /// `var obj = e_object.*; obj.put(...);`). The returned list is tagged
    /// `Origin::Borrowed` so its `Drop` is a no-op; the original retains
    /// ownership of the allocation. Appending to either alias may leave the
    /// other dangling — callers must uphold the same single-writer discipline
    /// the Zig code already relies on.
    #[inline]
    pub fn shallow_clone(&self) -> Self {
        Self {
            ptr: self.ptr,
            len: self.len,
            cap: self.cap,
            origin: Origin::Borrowed {
                #[cfg(debug_assertions)]
                trace: None,
            },
        }
    }

    pub fn clone(&self) -> Result<Self, AllocError>
    where
        T: Clone,
    {
        // TODO(port): narrow error set
        let mut copy: Vec<T> = Vec::new();
        copy.try_reserve_exact(self.cap as usize)
            .map_err(|_| AllocError)?;
        copy.extend_from_slice(self.slice());
        Ok(Self::move_from_list(copy))
    }

    pub fn unused_capacity_slice(&mut self) -> &mut [core::mem::MaybeUninit<T>] {
        // SAFETY: ptr[len..cap] is allocated but uninitialized.
        unsafe {
            core::slice::from_raw_parts_mut(
                self.ptr.as_ptr().add(self.len as usize) as *mut core::mem::MaybeUninit<T>,
                (self.cap - self.len) as usize,
            )
        }
    }

    pub fn contains(&self, item: &[T]) -> bool {
        self.len > 0
            && (item.as_ptr() as usize) >= (self.ptr.as_ptr() as usize)
            && (item.as_ptr() as usize) < (self.ptr.as_ptr() as usize) + self.len as usize
        // TODO(port): Zig adds `this.len` (element count) to a byte address — looks like an
        // upstream bug when sizeof(T) != 1. Preserved verbatim.
    }

    pub fn sort_asc(&mut self)
    where
        T: AsRef<[u8]>,
    {
        // bun.strings.sortAsc — lex byte-slice sort. Zig std.sort.pdq is
        // unstable, so use sort_unstable_by (no alloc, same algorithm family).
        self.slice_mut().sort_unstable_by(|a, b| a.as_ref().cmp(b.as_ref()));
    }

    // PORT NOTE: reshaped — Zig took `comptime Context: type, context: Context` and called
    // `Context.lessThan`. Rust expresses this as a comparator closure.
    pub fn sort(&mut self, mut less_than: impl FnMut(&T, &T) -> bool) {
        // PERF(port): std.sort.pdq → slice::sort_unstable_by (also pdqsort).
        // The comparator must be a total order: since Rust 1.81 `sort_unstable_by` panics if it
        // observes `cmp(a, b) == Greater && cmp(b, a) == Greater`. Derive `Equal` by probing the
        // `less_than` predicate in both directions.
        self.slice_mut().sort_unstable_by(|a, b| {
            if less_than(a, b) {
                core::cmp::Ordering::Less
            } else if less_than(b, a) {
                core::cmp::Ordering::Greater
            } else {
                core::cmp::Ordering::Equal
            }
        });
    }

    pub fn writable_slice(&mut self, additional: usize) -> Result<&mut [T], AllocError> {
        if SAFETY_CHECKS && additional > (self.cap - self.len) as usize {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        list_.try_reserve(additional).map_err(|_| AllocError)?;
        let prev_len = list_.len();
        // TODO(port): Zig grows len over uninitialized memory. For T: !Copy this is unsound in
        // Rust without MaybeUninit. Preserving behavior; callers must treat as write-only.
        // SAFETY: capacity reserved above.
        unsafe { list_.set_len(prev_len + additional) };
        self.update(list_);
        // PORT NOTE: returning &mut [T] over uninit is technically UB for non-Copy T; Phase B
        // should change return type to &mut [MaybeUninit<T>].
        // SAFETY: indices [prev_len, prev_len+additional) are within len.
        Ok(unsafe { core::slice::from_raw_parts_mut(self.ptr.as_ptr().add(prev_len), additional) })
    }

    pub fn allocated_slice(&mut self) -> &mut [core::mem::MaybeUninit<T>] {
        // SAFETY: ptr[0..cap] is the full allocation.
        unsafe {
            core::slice::from_raw_parts_mut(
                self.ptr.as_ptr() as *mut core::mem::MaybeUninit<T>,
                self.cap as usize,
            )
        }
    }

    pub fn memory_cost(&self) -> usize {
        self.cap as usize * core::mem::size_of::<T>()
    }

    // CYCLEBREAK(b0): `parse` / `to_css` / `eql` depend on bun_css (T4) and have moved to
    // bun_css as an extension trait on BabyList<T> (`bun_css::BabyListCssExt`). Bodies
    // deleted here — see `git log -p -- src/collections/baby_list.zig` for the originals.
    // TODO(b0-genuine): bun_css::generic — verify BabyListCssExt move-in (CYCLEBREAK §css).

    /// Allocator-fallible deep clone (Zig `BabyList.deepClone`).
    ///
    /// **Not** named `deep_clone`: `bun_css::generics` provides a blanket
    /// `impl DeepClone<'bump> for BabyList<T>` whose `deep_clone(&self, &Arena)`
    /// is what `#[derive(DeepClone)]` expands to via UFCS. Keeping the inherent
    /// under a distinct name avoids any ambiguity at non-derive call sites that
    /// *do* use method syntax.
    pub fn deep_clone_fallible(&self) -> Result<Self, bun_core::Error>
    where
        T: DeepClone,
    {
        // TODO(port): narrow error set
        let mut list_ = Self::init_capacity(self.len as usize)?;
        for item in self.slice() {
            // PORT NOTE: Zig branched on `@typeInfo(@TypeOf(clone_result))` to optionally `try`.
            // The `DeepClone` trait normalizes to always returning Result.
            let cloned_item = item.deep_clone()?;
            list_.append_assume_capacity(cloned_item);
        }
        Ok(list_)
    }

    /// Like `deep_clone_fallible` but the per-element clone is supplied as a closure
    /// (e.g. an arena-aware `|x| x.deep_clone(bump)`). This is the variant
    /// `bun_css::generic::DeepClone for BabyList<T>` needs, where the element
    /// trait carries an arena lifetime that the in-crate `DeepClone` trait
    /// cannot express.
    pub fn deep_clone_with<F>(&self, mut clone_one: F) -> Self
    where
        F: FnMut(&T) -> T,
    {
        let mut list_ =
            Self::init_capacity(self.len as usize).expect("OutOfMemory");
        for item in self.slice_const() {
            list_.append_assume_capacity(clone_one(item));
        }
        list_
    }

    /// Fallible variant of `deep_clone_with`.
    pub fn try_deep_clone_with<F, E>(&self, mut clone_one: F) -> Result<Self, E>
    where
        F: FnMut(&T) -> Result<T, E>,
        E: From<AllocError>,
    {
        let mut list_ = Self::init_capacity(self.len as usize).map_err(E::from)?;
        for item in self.slice_const() {
            list_.append_assume_capacity(clone_one(item)?);
        }
        Ok(list_)
    }

    /// Same as `deep_clone_fallible` but calls `bun.outOfMemory` instead of returning an error.
    /// `T::deep_clone` must not return any error except `error.OutOfMemory`.
    pub fn deep_clone_infallible(&self) -> Self
    where
        T: DeepClone,
    {
        // PORT NOTE: bun.handleOom(expr) → expr (Rust aborts on OOM by default); but
        // deep_clone_fallible returns Result, so unwrap.
        self.deep_clone_fallible().expect("OutOfMemory")
    }

    /// Avoid using this function. It creates a `BabyList` that will immediately invoke
    /// illegal behavior if you call any method that could allocate or free memory. On top of
    /// that, if `items` points to read-only memory, any attempt to modify a list element (which
    /// is very easy given how many methods return non-const pointers and slices) will also
    /// invoke illegal behavior.
    ///
    /// To find an alternative:
    ///
    /// 1. Determine how the resulting `BabyList` is being used. Is it stored in a struct field?
    ///    Is it passed to a function?
    ///
    /// 2. Determine whether that struct field or function parameter expects the list to be
    ///    mutable. Does it potentially call any methods that could allocate or free, like
    ///    `append` or `deinit`?
    ///
    /// 3. If the list is expected to be mutable, don't use this function, because the returned
    ///    list will invoke illegal behavior if mutated. Use `fromSlice` or another allocating
    ///    function instead.
    ///
    /// 4. If the list is *not* expected to be mutable, don't use a `BabyList` at all. Change
    ///    the field or parameter to be a plain slice instead.
    ///
    /// Requirements:
    ///
    /// * Methods that could potentially free, remap, or resize `items` cannot be called.
    ///
    /// # Safety
    /// The returned `BabyList` must NOT be dropped (wrap in `ManuallyDrop`) and must not have any
    /// growing/freeing method called on it.
    pub unsafe fn from_borrowed_slice_dangerous(items: &[T]) -> ManuallyDrop<Self> {
        let this = Self {
            // SAFETY: slice pointer is non-null.
            ptr: unsafe { NonNull::new_unchecked(items.as_ptr() as *mut T) },
            len: u32::try_from(items.len()).unwrap(),
            cap: u32::try_from(items.len()).unwrap(),
            origin: Origin::Borrowed {
                #[cfg(debug_assertions)]
                trace: if TRACES_ENABLED {
                    Some(bun_core::StoredTrace::capture(None))
                } else {
                    None
                },
            },
        };
        ManuallyDrop::new(this)
    }

    /// Transfers ownership of this `BabyList` to a new allocator.
    ///
    /// This method is valid only if both the old allocator and new allocator are
    /// `MimallocArena`s. See `bun.safety.CheckedAllocator.transferOwnership`.
    pub fn transfer_ownership(&mut self) {
        // TODO(port): CheckedAllocator tracking dropped — global mimalloc only. No-op.
    }

    fn assert_owned(&self) {
        if matches!(self.origin, Origin::Owned) {
            return;
        }
        #[cfg(debug_assertions)]
        if TRACES_ENABLED {
            if let Origin::Borrowed { trace: Some(trace) } = &self.origin {
                bun_core::Output::note("borrowed BabyList created here:");
                bun_core::dump_stack_trace(
                    &trace.trace(),
                    bun_core::DumpStackTraceOptions {
                        frame_count: 10,
                        stop_at_jsc_llint: true,
                        ..Default::default()
                    },
                );
            }
        }
        panic!("cannot perform this operation on a BabyList that doesn't own its data");
    }

    /// Returns a `Vec<T>` view over the same buffer. The returned `ManuallyDrop` MUST be passed
    /// to `update()` (or `into_inner` + forgotten) — dropping it would double-free.
    fn list(&self) -> ManuallyDrop<Vec<T>> {
        // SAFETY: ptr/len/cap describe a valid allocation from the global allocator (or dangling
        // with cap==0). Wrapped in ManuallyDrop so Drop never runs unless caller takes ownership.
        ManuallyDrop::new(unsafe {
            Vec::from_raw_parts(self.ptr.as_ptr(), self.len as usize, self.cap as usize)
        })
    }

    fn list_managed(&mut self) -> ManuallyDrop<Vec<T>> {
        // PORT NOTE: Zig version also called `#allocator.set(allocator)` — dropped (global alloc).
        self.list()
    }

    fn update(&mut self, list_: ManuallyDrop<Vec<T>>) {
        let mut list_ = ManuallyDrop::into_inner(list_);
        // SAFETY: Vec guarantees a non-null pointer (dangling when cap == 0).
        self.ptr = unsafe { NonNull::new_unchecked(list_.as_mut_ptr()) };
        self.len = u32::try_from(list_.len()).unwrap();
        self.cap = u32::try_from(list_.capacity()).unwrap();
        core::mem::forget(list_);
        if cfg!(debug_assertions) {
            debug_assert!(self.len <= self.cap);
        }
    }

    // PORT NOTE: `pub const looksLikeContainerTypeBabyList = Type;` — comptime reflection marker
    // for `meta.zig`. Not needed in Rust; dropped.
}

/// Trait for `BabyList::deep_clone_fallible`.
// TODO(port): unify with whatever trait the CSS/AST crates define for `deepClone`.
pub trait DeepClone: Sized {
    fn deep_clone(&self) -> Result<Self, bun_core::Error>;
}

// ─── BabyList<u8>-only methods ──────────────────────────────────────────────

impl BabyList<u8> {
    /// This method is available only for `BabyList(u8)`.
    pub fn append_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), AllocError> {
        if SAFETY_CHECKS && self.len == self.cap {
            self.assert_owned();
        }
        let mut list_ = self.list_managed();
        use std::io::Write;
        // TODO(port): narrow error set — write into Vec<u8> only fails on OOM.
        write!(&mut *list_, "{}", args).map_err(|_| AllocError)?;
        self.update(list_);
        Ok(())
    }

    /// This method is available only for `BabyList(u8)`.
    pub fn write(&mut self, str: &[u8]) -> Result<u32, AllocError> {
        if SAFETY_CHECKS && ((self.cap - self.len) as usize) < str.len() {
            self.assert_owned();
        }
        let initial = self.len;
        let mut list_ = self.list_managed();
        list_.try_reserve(str.len()).map_err(|_| AllocError)?;
        list_.extend_from_slice(str);
        self.update(list_);
        Ok(self.len - initial)
    }

    /// This method is available only for `BabyList(u8)`.
    pub fn write_latin1(&mut self, str: &[u8]) -> Result<u32, AllocError> {
        if SAFETY_CHECKS && !str.is_empty() {
            self.assert_owned();
        }
        let initial = self.len;
        let old = self.list_managed();
        let old_len = old.len();
        let new = strings::allocate_latin1_into_utf8_with_list(
            core::mem::ManuallyDrop::into_inner(old),
            old_len,
            str,
        );
        self.update(core::mem::ManuallyDrop::new(new));
        Ok(self.len - initial)
    }

    /// This method is available only for `BabyList(u8)`. Invalid characters are encoded as WTF-8.
    pub fn write_utf16(&mut self, str: &[u16]) -> Result<u32, AllocError> {
        if SAFETY_CHECKS && !str.is_empty() {
            self.assert_owned();
        }
        let initial_len = self.len;
        let mut list_ = self.list_managed();
        {
            let length_estimate = if (list_.capacity() - list_.len()) <= (str.len() * 3 + 2) {
                bun_simdutf_sys::simdutf::length::utf8::from::utf16::le(str)
            } else {
                str.len()
            };
            list_.try_reserve(length_estimate).map_err(|_| AllocError)?;
            strings::convert_utf16_to_utf8_append(&mut list_, str);
        }
        self.update(list_);
        Ok(self.len - initial_len)
    }

    /// This method is available only for `BabyList(u8)`.
    pub fn write_type_as_bytes_assume_capacity<Int: Copy>(&mut self, int: Int) {
        let size = core::mem::size_of::<Int>();
        debug_assert!(self.cap as usize >= self.len as usize + size);
        // SAFETY: capacity asserted; writing `size` bytes into the uninitialized tail.
        unsafe {
            let dst = self.ptr.as_ptr().add(self.len as usize) as *mut Int;
            dst.write_unaligned(int);
        }
        self.len += u32::try_from(size).unwrap();
    }
}

impl<T: fmt::Debug> fmt::Display for BabyList<T> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            writer,
            "BabyList({}){{{:?}}}",
            core::any::type_name::<T>(),
            self.slice(),
        )
    }
}

pub type ByteList = BabyList<u8>;

/// `ByteList` is the canonical pooled scratch buffer (`ObjectPool<ByteList, ..>`
/// in Zig). `INIT` allocates an empty list; `reset` truncates to len=0 while
/// keeping capacity so the next user reuses the buffer.
impl crate::pool::ObjectPoolType for ByteList {
    const INIT: Option<fn() -> Result<Self, bun_core::Error>> = Some(|| Ok(ByteList::default()));
    #[inline]
    fn reset(&mut self) {
        self.clear_retaining_capacity();
    }
}

#[derive(Default)]
pub struct OffsetByteList {
    pub head: u32,
    pub byte_list: ByteList,
}

impl OffsetByteList {
    pub fn init(head: u32, byte_list: ByteList) -> Self {
        Self { head, byte_list }
    }

    pub fn write(&mut self, bytes: &[u8]) -> Result<(), AllocError> {
        // TODO(port): narrow error set
        let _ = self.byte_list.write(bytes)?;
        Ok(())
    }

    pub fn slice(&self) -> &[u8] {
        &self.byte_list.slice()[0..self.head as usize]
    }

    pub fn remaining(&self) -> &[u8] {
        &self.byte_list.slice()[self.head as usize..]
    }

    pub fn consume(&mut self, bytes: u32) {
        self.head = self.head.saturating_add(bytes);
        if self.head >= self.byte_list.len {
            self.head = 0;
            self.byte_list.len = 0;
        }
    }

    pub fn len(&self) -> u32 {
        self.byte_list.len - self.head
    }

    pub fn clear(&mut self) {
        self.head = 0;
        self.byte_list.len = 0;
    }

    // PORT NOTE: `deinit` → handled by `impl Drop for ByteList` on the `byte_list` field.

    pub fn clear_and_free(&mut self) {
        *self = Self::default();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/baby_list.zig (660 lines)
//   confidence: medium
//   todos:      17
//   notes:      Drop semantics vs from_borrowed_slice_dangerous need Phase-B audit; css methods should move to bun_css ext trait; allocator params dropped per §Allocators
// ──────────────────────────────────────────────────────────────────────────
