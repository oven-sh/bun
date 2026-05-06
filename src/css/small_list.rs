use core::mem::MaybeUninit;
use core::ptr;

use bun_collections::BabyList;
use crate::generics as generic;
use crate::css_parser::{CssResult, Delimiters, Parser, void_wrap};

// PORT NOTE on `mem::forget` below: every `forget` is paired with a later
// `Vec::from_raw_parts` reconstruction in `Drop` / `to_owned_slice` /
// `try_reserve_heap`. This is the standard `Vec::into_raw_parts` pattern (still
// unstable), not a `&'static`-lifetime leak (PORTING.md §Forbidden targets the
// latter). The Zig original does the same with `Allocator.alloc`/`free`.

/// This is a type whose items can either be heap-allocated (essentially the
/// same as a BabyList(T)) or inlined in the struct itself.
///
/// This type is a performance optimization for avoiding allocations, especially when you know the list
/// will commonly have N or fewer items.
///
/// The `capacity` field is used to disambiguate between the two states: - When
/// `capacity <= N`, the items are stored inline, and `capacity` is the length
/// of the items.  - When `capacity > N`, the items are stored on the heap, and
/// this type essentially becomes a BabyList(T), but with the fields reordered.
///
/// This code is based on servo/rust-smallvec and the Zig std.ArrayList source.
pub struct SmallList<T, const N: usize> {
    capacity: u32,
    data: Data<T, N>,
}

#[repr(C)]
union Data<T, const N: usize> {
    // ManuallyDrop is required by Rust for non-Copy union fields. The wrapped
    // type `[MaybeUninit<T>; N]` has no Drop glue, so this is purely a
    // type-system formality — element destruction is handled explicitly in
    // `Drop for SmallList` / `clear_retaining_capacity` (mirrors Zig deinit).
    inlined: core::mem::ManuallyDrop<[MaybeUninit<T>; N]>,
    heap: HeapData<T>,
}

#[repr(C)]
struct HeapData<T> {
    len: u32,
    ptr: *mut T,
}
// Manual impls: derive(Copy) would add a spurious `T: Copy` bound, but
// HeapData is just `(u32, *mut T)` — always Copy regardless of T.
impl<T> Clone for HeapData<T> { fn clone(&self) -> Self { *self } }
impl<T> Copy for HeapData<T> {}

impl<T> HeapData<T> {
    pub fn init_capacity(capacity: u32) -> HeapData<T> {
        // PERF(port): was arena allocator.alloc — now global mimalloc
        let mut v: Vec<T> = Vec::with_capacity(capacity as usize);
        let ptr = v.as_mut_ptr();
        core::mem::forget(v);
        HeapData { len: 0, ptr }
    }
}

impl<T, const N: usize> Default for SmallList<T, N> {
    fn default() -> Self {
        SmallList {
            capacity: 0,
            data: Data {
                // SAFETY: an array of MaybeUninit needs no initialization
                inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }),
            },
        }
    }
}

// TODO(port): css is an AST crate (PORTING.md §Allocators) — `std.mem.Allocator` params should
// become `bump: &'bump Bump` and ArrayListUnmanaged → `bumpalo::collections::Vec<'bump, T>`.
// Dropped here because the heap path needs realloc/free (incompatible with bumpalo's bump-pointer
// model). Phase B must reconcile: either thread `&'bump Bump` and leak-on-reset for the heap path,
// or confirm SmallList callers in css always use the global allocator (not the parser arena).
impl<T, const N: usize> SmallList<T, N> {
    pub fn init_inlined(values: &[T]) -> Self
    where
        T: Copy,
    {
        debug_assert!(values.len() <= N);
        let mut this = SmallList::<T, N> {
            capacity: u32::try_from(values.len()).unwrap(),
            data: Data {
                // SAFETY: array of MaybeUninit<T> needs no initialization
                inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }),
            },
        };
        // SAFETY: values.len() <= N asserted above; inlined storage active.
        unsafe {
            ptr::copy_nonoverlapping(
                values.as_ptr(),
                (*this.data.inlined).as_mut_ptr().cast::<T>(),
                values.len(),
            );
        }
        this
    }

    // `parse` depends on still-gated `css_parser` internals (`Parser` methods,
    // `Delimiters`, `Result<T>`, `generic::parse_for`). Re-enables when that
    // hub un-gates. `to_css` is un-gated below (B-2) — `Printer::delim` is
    // stubbed in the lib.rs printer shim until `printer.rs` un-gates.
    
    pub fn parse(input: &mut Parser) -> CssResult<Self> {
        // TODO(port): trait bound — T must implement css generic parse protocol
        let parse_fn = void_wrap::<T>(generic::parse_for::<T>());
        let mut values: Self = Self::default();
        loop {
            input.skip_whitespace();
            match input.parse_until_before(Delimiters { comma: true, ..Default::default() }, (), parse_fn) {
                CssResult::Ok(v) => {
                    values.append(v);
                }
                CssResult::Err(e) => return CssResult::Err(e),
            }
            match input.next() {
                CssResult::Err(_) => return CssResult::Ok(values),
                CssResult::Ok(t) => {
                    if t.is_comma() {
                        continue;
                    }
                    unreachable!("Expected a comma");
                }
            }
        }
    }

    pub fn to_css(&self, dest: &mut crate::printer::Printer) -> Result<(), crate::PrintErr>
    where
        T: generic::ToCss,
    {
        let length = self.len();
        for (idx, val) in self.slice().iter().enumerate() {
            generic::to_css(val, dest)?;
            // widen u32→usize (infallible) instead of narrowing idx
            if idx + 1 < length as usize {
                dest.delim(b',', false)?;
            }
        }
        Ok(())
    }

    /// NOTE: This will deinit the list
    // TODO(port): bumpalo::collections::Vec<'bump, T> in css arena context (see impl-block note)
    pub fn from_list(list: Vec<T>) -> Self {
        if list.capacity() > N {
            let cap = u32::try_from(list.capacity()).unwrap();
            let len = u32::try_from(list.len()).unwrap();
            let mut list = list;
            let ptr = list.as_mut_ptr();
            core::mem::forget(list);
            return SmallList {
                capacity: cap,
                data: Data { heap: HeapData { len, ptr } },
            };
        }
        let len = u32::try_from(list.len()).unwrap();
        let mut this = SmallList::<T, N> {
            capacity: len,
            // SAFETY: array of MaybeUninit<T> needs no initialization
            data: Data { inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }) },
        };
        // SAFETY: len <= N; moving elements out of list into inlined storage.
        unsafe {
            ptr::copy_nonoverlapping(list.as_ptr(), (*this.data.inlined).as_mut_ptr().cast::<T>(), list.len());
        }
        // Prevent double-drop of moved elements; Vec's buffer is freed.
        let mut list = list;
        // SAFETY: elements [0..len) were bitwise-moved out above; setting len=0 prevents Vec from dropping them
        unsafe { list.set_len(0) };
        drop(list);
        this
    }

    // TODO(port): bumpalo::collections::Vec<'bump, T> in css arena context.
    /// Transfers the buffer from `list` without freeing it (Zig
    /// `fromListNoDeinit` took the list by value; the caller relinquished it).
    /// Taking `Vec<T>` by value here matches that contract; the Vec's Drop is
    /// suppressed via `ManuallyDrop` so SmallList becomes the sole owner of
    /// the heap buffer.
    pub fn from_list_no_deinit(list: Vec<T>) -> Self
    where
        T: Copy,
    {
        let mut list = core::mem::ManuallyDrop::new(list);
        if list.capacity() > N {
            return SmallList {
                capacity: u32::try_from(list.capacity()).unwrap(),
                data: Data {
                    heap: HeapData {
                        len: u32::try_from(list.len()).unwrap(),
                        ptr: list.as_mut_ptr(),
                    },
                },
            };
        }
        let len = list.len();
        let mut this = SmallList::<T, N> {
            capacity: u32::try_from(len).unwrap(),
            // SAFETY: array of MaybeUninit<T> needs no initialization
            data: Data { inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }) },
        };
        // SAFETY: len <= N; T: Copy so bitwise copy is sound; inlined storage active
        unsafe {
            ptr::copy_nonoverlapping(list.as_ptr(), (*this.data.inlined).as_mut_ptr().cast::<T>(), len);
        }
        // Inline path: free the now-unused source buffer (Zig leaves it for the
        // arena; with global mimalloc we free explicitly via the suppressed Vec).
        // SAFETY: T: Copy so dropping the Vec's elements is a no-op.
        unsafe { core::mem::ManuallyDrop::drop(&mut list) };
        this
    }

    /// NOTE: This will deinit the list
    pub fn from_baby_list(list: BabyList<T>) -> Self {
        if list.cap > u32::try_from(N).unwrap() {
            let cap = list.cap;
            let len = list.len;
            let ptr = list.ptr.as_ptr();
            // Ownership of the buffer transfers to SmallList; suppress BabyList's Drop to avoid double-free.
            core::mem::forget(list);
            return SmallList {
                capacity: cap,
                data: Data { heap: HeapData { len, ptr } },
            };
        }
        let mut this = SmallList::<T, N> {
            capacity: list.len,
            // SAFETY: array of MaybeUninit<T> needs no initialization
            data: Data { inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }) },
        };
        // SAFETY: list.len <= N
        unsafe {
            ptr::copy_nonoverlapping(list.ptr.as_ptr(), (*this.data.inlined).as_mut_ptr().cast::<T>(), list.len as usize);
        }
        // Elements were bitwise-moved out. BabyList::Drop reconstructs
        // `Vec::from_raw_parts(ptr, len, cap)` which would drop elements
        // [0..len) again — double-drop. Zero `len` first so only the buffer is
        // freed (matching Zig `list_.deinit(allocator)` which never destructs).
        let mut list = list;
        list.len = 0;
        drop(list);
        this
    }

    /// Transfers the buffer from `list` without dropping its elements (Zig
    /// `fromBabyListNoDeinit` took the list by value). See
    /// [`from_list_no_deinit`] for the ownership contract.
    pub fn from_baby_list_no_deinit(list: BabyList<T>) -> Self
    where
        T: Copy,
    {
        if list.cap > u32::try_from(N).unwrap() {
            let cap = list.cap;
            let len = list.len;
            let ptr = list.ptr.as_ptr();
            core::mem::forget(list);
            return SmallList {
                capacity: cap,
                data: Data { heap: HeapData { len, ptr } },
            };
        }
        let len = list.len as usize;
        let mut this = SmallList::<T, N> {
            capacity: list.len,
            // SAFETY: array of MaybeUninit<T> needs no initialization
            data: Data { inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }) },
        };
        // SAFETY: len <= N; T: Copy so bitwise copy is sound; inlined storage active
        unsafe {
            ptr::copy_nonoverlapping(list.ptr.as_ptr(), (*this.data.inlined).as_mut_ptr().cast::<T>(), len);
        }
        // T: Copy so element drop is a no-op; let BabyList free the source buffer.
        let mut list = list;
        list.len = 0;
        drop(list);
        this
    }

    pub fn with_one(val: T) -> Self {
        let mut ret = Self::default();
        ret.capacity = 1;
        // SAFETY: capacity 1 <= N (N >= 1 assumed for all instantiations); inlined active.
        unsafe { (*ret.data.inlined)[0].write(val) };
        ret
    }

    #[inline]
    pub fn get_last_unchecked(&self) -> &T {
        if self.spilled() {
            // SAFETY: spilled => heap active, len >= 1 (caller contract)
            unsafe { &*self.data.heap.ptr.add(self.data.heap.len as usize - 1) }
        } else {
            // SAFETY: !spilled => inlined active, capacity >= 1 (caller contract)
            unsafe { &*self.data.inlined.as_ptr().cast::<T>().add(self.capacity as usize - 1) }
        }
    }

    #[inline]
    pub fn at(&self, idx: u32) -> &T {
        // SAFETY: caller guarantees idx < len
        unsafe { &*self.as_const_ptr().add(idx as usize) }
    }

    #[inline]
    pub fn r#mut(&mut self, idx: u32) -> &mut T {
        // SAFETY: caller guarantees idx < len
        unsafe { &mut *self.as_ptr().add(idx as usize) }
    }

    #[inline]
    pub fn last(&self) -> Option<&T> {
        let sl = self.slice();
        if sl.is_empty() {
            return None;
        }
        Some(&sl[sl.len() - 1])
    }

    #[inline]
    pub fn last_mut(&mut self) -> Option<&mut T> {
        let sl = self.slice_mut();
        if sl.is_empty() {
            return None;
        }
        let last = sl.len() - 1;
        Some(&mut sl[last])
    }

    #[inline]
    pub fn to_owned_slice(self) -> Box<[T]> {
        // TODO(port): Zig signature was &self returning aliased heap slice; reshaped to consume self.
        if self.spilled() {
            // SAFETY: spilled => heap.ptr was allocated with capacity == self.capacity via global allocator
            let v = unsafe {
                Vec::from_raw_parts(self.data.heap.ptr, self.data.heap.len as usize, self.capacity as usize)
            };
            core::mem::forget(self);
            return v.into_boxed_slice();
        }
        let len = self.capacity as usize;
        let mut v: Vec<T> = Vec::with_capacity(len);
        // SAFETY: inlined active; moving len elements out
        unsafe {
            ptr::copy_nonoverlapping(self.data.inlined.as_ptr().cast::<T>(), v.as_mut_ptr(), len);
            v.set_len(len);
        }
        core::mem::forget(self);
        v.into_boxed_slice()
    }

    /// NOTE: If this is inlined then this will refer to stack memory, if
    /// need it to be stable then you should use `.to_owned_slice()`
    #[inline]
    pub fn slice(&self) -> &[T] {
        if self.capacity > u32::try_from(N).unwrap() {
            // SAFETY: spilled => heap active
            unsafe { core::slice::from_raw_parts(self.data.heap.ptr, self.data.heap.len as usize) }
        } else {
            // SAFETY: !spilled => inlined active, first `capacity` slots initialized
            unsafe { core::slice::from_raw_parts(self.data.inlined.as_ptr().cast::<T>(), self.capacity as usize) }
        }
    }

    /// NOTE: If this is inlined then this will refer to stack memory, if
    /// need it to be stable then you should use `.to_owned_slice()`
    #[inline]
    pub fn slice_mut(&mut self) -> &mut [T] {
        if self.capacity > u32::try_from(N).unwrap() {
            // SAFETY: spilled => heap active
            unsafe { core::slice::from_raw_parts_mut(self.data.heap.ptr, self.data.heap.len as usize) }
        } else {
            // SAFETY: !spilled => inlined active, first `capacity` slots initialized
            unsafe {
                core::slice::from_raw_parts_mut((*self.data.inlined).as_mut_ptr().cast::<T>(), self.capacity as usize)
            }
        }
    }

    pub fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool
    where
        T: generic::IsCompatible,
    {
        for v in self.slice() {
            if !generic::is_compatible(v, browsers) {
                return false;
            }
        }
        true
    }

    // TODO: remove this stupid function
    pub fn map(&mut self, func: impl Fn(&mut T)) {
        for item in self.slice_mut() {
            func(item);
        }
    }

    /// `predicate` must be: `fn(&T) -> bool`
    pub fn any(&self, predicate: impl Fn(&T) -> bool) -> bool {
        for item in self.slice() {
            if predicate(item) {
                return true;
            }
        }
        false
    }

    pub fn ordered_remove(&mut self, idx: u32) -> T {
        let (ptr_, len_ptr, _capp) = self.triple_mut();
        // SAFETY: triple_mut returns valid ptr/len for current storage variant
        unsafe {
            debug_assert!(idx < *len_ptr);
            let length = *len_ptr;
            *len_ptr -= 1;
            let ptr_ = ptr_.add(idx as usize);
            let item = ptr::read(ptr_);
            ptr::copy(ptr_.add(1), ptr_, (length - idx - 1) as usize);
            item
        }
    }

    pub fn swap_remove(&mut self, idx: u32) -> T {
        let (ptr_, len_ptr, _capp) = self.triple_mut();
        // SAFETY: triple_mut returns valid ptr/len for current storage variant
        unsafe {
            debug_assert!(idx < *len_ptr);
            let ret = ptr::read(ptr_.add(idx as usize));
            ptr::copy(ptr_.add((*len_ptr).saturating_sub(1) as usize), ptr_.add(idx as usize), 1);
            *len_ptr -= 1;
            ret
        }
    }

    pub fn clear_retaining_capacity(&mut self) {
        // TODO(port): does not drop elements (matches Zig). Callers must ensure T has no Drop side effects
        // or elements are otherwise handled.
        if self.spilled() {
            // SAFETY: spilled() => heap variant active
            unsafe { self.data.heap.len = 0 };
        } else {
            self.capacity = 0;
        }
    }

    pub fn shallow_clone(&self) -> Self
    where
        T: Copy,
    {
        if !self.spilled() {
            // SAFETY: inlined storage of Copy T is bitwise-copyable
            return SmallList {
                capacity: self.capacity,
                data: Data { inlined: unsafe { core::mem::ManuallyDrop::new(*self.data.inlined) } },
            };
        }
        let mut h = HeapData::<T>::init_capacity(self.capacity);
        // SAFETY: spilled => heap active
        unsafe {
            h.len = self.data.heap.len;
            ptr::copy_nonoverlapping(self.data.heap.ptr, h.ptr, h.len as usize);
        }
        SmallList { capacity: self.capacity, data: Data { heap: h } }
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        T: generic::DeepClone<'bump>,
    {
        // PORT NOTE: append-loop instead of `set_len` + raw `ptr::write` — keeps
        // every slot initialized at all times so an unwind in T::deep_clone
        // doesn't drop uninitialized memory.
        let mut ret = Self::init_capacity(self.len());
        for in_ in self.slice() {
            ret.append(generic::deep_clone(in_, bump));
        }
        ret
    }

    pub fn eql(lhs: &Self, rhs: &Self) -> bool
    where
        T: generic::CssEql,
    {
        if lhs.len() != rhs.len() {
            return false;
        }
        for (a, b) in lhs.slice().iter().zip(rhs.slice()) {
            if !generic::eql(a, b) {
                return false;
            }
        }
        true
    }

    /// Shallow clone
    pub fn clone(&self) -> Self
    where
        T: Copy,
    {
        if !self.spilled() {
            return SmallList {
                capacity: self.capacity,
                // SAFETY: !spilled() => inlined variant active; T: Copy so array bitwise copy is sound
                data: Data { inlined: unsafe { core::mem::ManuallyDrop::new(*self.data.inlined) } },
            };
        }
        // Preserve the invariant that the heap allocation holds `capacity` elements,
        // otherwise a later append that trusts `capacity` would write out of bounds.
        let mut buf: Vec<T> = Vec::with_capacity(self.capacity as usize);
        let buf_ptr = buf.as_mut_ptr();
        core::mem::forget(buf);
        // SAFETY: spilled => heap active; copying len <= capacity Copy elements
        let heap_len = unsafe { self.data.heap.len };
        unsafe {
            ptr::copy_nonoverlapping(self.data.heap.ptr, buf_ptr, heap_len as usize);
        }
        SmallList {
            capacity: self.capacity,
            data: Data { heap: HeapData { len: heap_len, ptr: buf_ptr } },
        }
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash)
    where
        T: generic::CssHash,
    {
        for item in self.slice() {
            generic::hash(item, hasher);
        }
    }

    #[inline]
    pub fn len(&self) -> u32 {
        if self.spilled() {
            // SAFETY: spilled => heap active
            unsafe { self.data.heap.len }
        } else {
            self.capacity
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn init_capacity(capacity: u32) -> Self {
        if capacity > u32::try_from(N).unwrap() {
            let mut list = Self::default();
            list.capacity = capacity;
            list.data = Data { heap: HeapData::init_capacity(capacity) };
            return list;
        }
        // SAFETY: array of MaybeUninit<T> needs no initialization
        SmallList { capacity: 0, data: Data { inlined: core::mem::ManuallyDrop::new(unsafe { MaybeUninit::uninit().assume_init() }) } }
    }

    pub fn ensure_total_capacity(&mut self, new_capacity: u32) {
        if self.capacity >= new_capacity {
            return;
        }
        self.try_grow(new_capacity);
    }

    pub fn insert(&mut self, index: u32, item: T) {
        let (mut ptr_, mut len_ptr, capp) = self.triple_mut();
        // SAFETY: triple_mut returns valid raw ptr/len for current storage
        unsafe {
            if *len_ptr == capp {
                self.reserve_one_unchecked();
                let (heap_ptr, heap_len_ptr) = self.heap();
                ptr_ = heap_ptr;
                len_ptr = heap_len_ptr;
            }
            let length = *len_ptr;
            let ptr_ = ptr_.add(index as usize);
            if index < length {
                let count = (length - index) as usize;
                ptr::copy(ptr_, ptr_.add(1), count);
            } else if index == length {
                // No elements need shifting.
            } else {
                panic!("index exceeds length");
            }
            *len_ptr = length + 1;
            ptr::write(ptr_, item);
        }
    }

    pub fn append_assume_capacity(&mut self, item: T) {
        let (ptr_, len_ptr, capp) = self.triple_mut();
        // SAFETY: caller guarantees len < cap
        unsafe {
            debug_assert!(*len_ptr < capp);
            ptr::write(ptr_.add(*len_ptr as usize), item);
            *len_ptr += 1;
        }
    }

    pub fn pop(&mut self) -> Option<T> {
        let (ptr_, len_ptr, _) = self.triple_mut();
        // SAFETY: triple_mut returns valid ptr/len
        unsafe {
            if *len_ptr == 0 {
                return None;
            }
            let last_index = *len_ptr - 1;
            *len_ptr = last_index;
            Some(ptr::read(ptr_.add(last_index as usize)))
        }
    }

    pub fn append(&mut self, item: T) {
        let (mut ptr_, mut len_ptr, capp) = self.triple_mut();
        // SAFETY: triple_mut returns valid raw ptr/len for current storage
        unsafe {
            if *len_ptr == capp {
                self.reserve_one_unchecked();
                let (heap_ptr, heap_len) = self.heap();
                ptr_ = heap_ptr;
                len_ptr = heap_len;
            }
            ptr::write(ptr_.add(*len_ptr as usize), item);
            *len_ptr += 1;
        }
    }

    pub fn append_slice(&mut self, items: &[T])
    where
        T: Copy,
    {
        self.insert_slice(self.len(), items);
    }

    pub fn append_slice_assume_capacity(&mut self, items: &[T])
    where
        T: Copy,
    {
        debug_assert!((self.len() as usize) + items.len() <= self.capacity as usize);
        self.insert_slice_assume_capacity(self.len(), items);
    }

    #[inline]
    pub fn insert_slice(&mut self, index: u32, items: &[T])
    where
        T: Copy,
    {
        self.reserve(u32::try_from(items.len()).unwrap());
        self.insert_slice_assume_capacity(index, items);
    }

    #[inline]
    pub fn insert_slice_assume_capacity(&mut self, index: u32, items: &[T])
    where
        T: Copy,
    {
        let length = self.len();
        debug_assert!(index <= length);
        // SAFETY: index <= length, capacity reserved by caller
        unsafe {
            let ptr_: *mut T = self.as_ptr().add(index as usize);
            let count = (length - index) as usize;
            ptr::copy(ptr_, ptr_.add(items.len()), count);
            ptr::copy_nonoverlapping(items.as_ptr(), ptr_, items.len());
        }
        self.set_len(length + u32::try_from(items.len()).unwrap());
    }

    pub fn set_len(&mut self, new_len: u32) {
        let len_ptr = self.len_mut();
        // SAFETY: len_mut returns valid &mut u32 into self
        unsafe { *len_ptr = new_len };
    }

    #[inline]
    fn heap(&mut self) -> (*mut T, *mut u32) {
        // SAFETY: caller ensures spilled
        unsafe { (self.data.heap.ptr, &mut self.data.heap.len as *mut u32) }
    }

    fn as_const_ptr(&self) -> *const T {
        if self.spilled() {
            // SAFETY: spilled() => heap variant active
            unsafe { self.data.heap.ptr }
        } else {
            // SAFETY: !spilled() => inlined variant active
            unsafe { self.data.inlined.as_ptr().cast::<T>() }
        }
    }

    fn as_ptr(&mut self) -> *mut T {
        if self.spilled() {
            // SAFETY: spilled() => heap variant active
            unsafe { self.data.heap.ptr }
        } else {
            // SAFETY: !spilled() => inlined variant active
            unsafe { (*self.data.inlined).as_mut_ptr().cast::<T>() }
        }
    }

    fn reserve(&mut self, additional: u32) {
        let (_ptr, len_ptr, capp) = self.triple_mut();
        // SAFETY: len_ptr returned by triple_mut points into self (heap.len or self.capacity)
        let len_ = unsafe { *len_ptr };

        if capp - len_ >= additional {
            return;
        }
        let new_cap = grow_capacity(capp, len_ + additional);
        self.try_grow(new_cap);
    }

    #[cold]
    fn reserve_one_unchecked(&mut self) {
        debug_assert!(self.len() == self.capacity);
        let new_cap = grow_capacity(self.capacity, self.len() + 1);
        self.try_grow(new_cap);
    }

    fn try_grow(&mut self, new_cap: u32) {
        let unspilled = !self.spilled();
        let (ptr_, len_ptr, cap) = self.triple_mut();
        // SAFETY: len_ptr returned by triple_mut points into self (heap.len or self.capacity)
        let length = unsafe { *len_ptr };
        debug_assert!(new_cap >= length);
        if new_cap <= u32::try_from(N).unwrap() {
            if unspilled {
                return;
            }
            // SAFETY: was spilled; ptr_ is heap ptr with `cap` capacity, `length` initialized
            unsafe {
                let mut inlined: [MaybeUninit<T>; N] = MaybeUninit::uninit().assume_init();
                ptr::copy_nonoverlapping(ptr_, inlined.as_mut_ptr().cast::<T>(), length as usize);
                self.data = Data { inlined: core::mem::ManuallyDrop::new(inlined) };
                self.capacity = length;
                // free old heap buffer (elements moved out)
                drop(Vec::from_raw_parts(ptr_, 0, cap as usize));
            }
        } else if new_cap != cap {
            let new_alloc: *mut T = if unspilled {
                // SAFETY: ptr_ points to inlined storage with `length` initialized elements
                let mut new_alloc: Vec<T> = Vec::with_capacity(new_cap as usize);
                let new_ptr = new_alloc.as_mut_ptr();
                core::mem::forget(new_alloc);
                unsafe { ptr::copy_nonoverlapping(ptr_, new_ptr, length as usize) };
                new_ptr
            } else {
                // SAFETY: ptr_ is heap ptr allocated with capacity `cap` via global allocator
                // PERF(port): was allocator.realloc — using Vec reserve_exact
                unsafe {
                    let mut v = Vec::from_raw_parts(ptr_, length as usize, cap as usize);
                    v.reserve_exact((new_cap - length) as usize);
                    let new_ptr = v.as_mut_ptr();
                    core::mem::forget(v);
                    new_ptr
                }
            };
            self.data = Data { heap: HeapData { ptr: new_alloc, len: length } };
            self.capacity = new_cap;
        }
    }

    /// Returns a tuple with (data ptr, len, capacity)
    /// Useful to get all SmallVec properties with a single check of the current storage variant.
    #[inline]
    fn triple_mut(&mut self) -> (*mut T, *mut u32, u32) {
        if self.spilled() {
            // SAFETY: spilled => heap active
            unsafe { (self.data.heap.ptr, &mut self.data.heap.len as *mut u32, self.capacity) }
        } else {
            // SAFETY: !spilled => inlined active
            (
                unsafe { (*self.data.inlined).as_mut_ptr().cast::<T>() },
                &mut self.capacity as *mut u32,
                u32::try_from(N).unwrap(),
            )
        }
    }

    #[inline]
    fn len_mut(&mut self) -> *mut u32 {
        if self.spilled() {
            // SAFETY: spilled() => heap variant active
            unsafe { &mut self.data.heap.len as *mut u32 }
        } else {
            &mut self.capacity as *mut u32
        }
    }

    fn grow_to_heap(&mut self, additional: usize) {
        debug_assert!(!self.spilled());
        let new_size = grow_capacity(self.capacity, self.capacity + u32::try_from(additional).unwrap());
        let mut slc: Vec<T> = Vec::with_capacity(new_size as usize);
        let slc_ptr = slc.as_mut_ptr();
        core::mem::forget(slc);
        // SAFETY: !spilled => inlined active with `capacity` initialized elements
        unsafe {
            ptr::copy_nonoverlapping(
                self.data.inlined.as_ptr().cast::<T>(),
                slc_ptr,
                self.capacity as usize,
            );
        }
        self.data = Data { heap: HeapData { len: self.capacity, ptr: slc_ptr } };
        self.capacity = new_size;
    }

    #[inline]
    fn spilled(&self) -> bool {
        self.capacity > u32::try_from(N).unwrap()
    }

    // TODO(port): Zig had `pub const looksLikeContainerTypeSmallList = T;` — used for comptime
    // type detection. In Rust, replace with a marker trait if needed.
}

impl<T, const N: usize> Drop for SmallList<T, N> {
    fn drop(&mut self) {
        // TODO(port): Zig deinit only freed heap buffer, never dropped elements. Matching that
        // here exactly. If T has Drop, elements leak — same as Zig (caller responsible).
        if self.spilled() {
            // SAFETY: spilled => heap.ptr allocated with capacity == self.capacity
            unsafe {
                drop(Vec::from_raw_parts(self.data.heap.ptr, 0, self.capacity as usize));
            }
        }
    }
}

// ─── getFallbacks ──────────────────────────────────────────────────────────
// The Zig version uses `@hasDecl(T, "getImage")` and `T == TextShadow` comptime
// dispatch with a comptime-computed return type. In Rust this becomes a trait
// with associated type for the return.

// TODO(port): proc-macro / trait — getFallbacks dispatches on whether T implements
// ImageFallback (has getImage/withImage/getFallback) vs T == TextShadow. The two
// bodies below are direct ports of each comptime branch; wire via trait in Phase B.

pub trait GetFallbacks<const N: usize>: Sized {
    type Output;
    fn get_fallbacks(this: &mut SmallList<Self, N>, targets: crate::targets::Targets) -> Self::Output;
}

/// Duck-typed protocol from the Zig source (`@hasDecl(T, "getImage")`): any
/// value type that carries an `Image` and can produce color/prefix fallbacks
/// of itself. Implemented by `values::image::Image` and
/// `properties::background::Background`.
pub trait ImageFallback: Sized {
    fn get_image(&self) -> &crate::values::image::Image;
    fn with_image(&self, allocator: &bun_alloc::Arena, image: crate::values::image::Image) -> Self;
    fn get_fallback(&self, allocator: &bun_alloc::Arena, kind: crate::values::color::ColorFallbackKind) -> Self;
    fn get_necessary_fallbacks(
        &self,
        targets: crate::targets::Targets,
    ) -> crate::values::color::ColorFallbackKind;
}

impl<T: ImageFallback> SmallList<T, 1> {
    /// Port of Zig `SmallList(T, N).getFallbacks` for the `@hasDecl(T, "getImage")`
    /// branch. The TextShadow branch is `get_fallbacks_text_shadow`.
    #[inline]
    pub fn get_fallbacks(
        &mut self,
        allocator: &bun_alloc::Arena,
        targets: crate::targets::Targets,
    ) -> BabyList<SmallList<T, 1>> {
        fallbacks_gated::get_fallbacks_image(self, allocator, targets)
    }
}

// `get_fallbacks_image` / `get_fallbacks_text_shadow` depend on still-gated
// values::color, properties::text, css_parser::ImageFallback. Re-enable with
// those modules.

pub use fallbacks_gated::{get_fallbacks_image, get_fallbacks_text_shadow};

pub mod fallbacks_gated {
use super::*;
use crate::css_parser as css;
use crate::properties::text::TextShadow;

// TODO(port): trait bound placeholder — any T with getImage()/withImage()/getFallback()/getNecessaryFallbacks()
pub fn get_fallbacks_image<T>(this: &mut SmallList<T, 1>, targets: css::targets::Targets) -> BabyList<SmallList<T, 1>>
where
    T: css::ImageFallback, // TODO(port): define this trait in css crate
{
    use css::css_values::color::ColorFallbackKind;
    // Determine what vendor prefixes and color fallbacks are needed.
    let mut prefixes = css::VendorPrefix::default();
    let mut fallbacks = ColorFallbackKind::default();
    let mut res: BabyList<SmallList<T, 1>> = BabyList::default();
    for item in this.slice() {
        prefixes.insert(item.get_image().get_necessary_prefixes(targets));
        fallbacks.insert(item.get_necessary_fallbacks(targets));
    }

    // Get RGB fallbacks if needed.
    let rgb: Option<SmallList<T, 1>> = if fallbacks.rgb {
        let mut shallow_clone = this.shallow_clone();
        // PORT NOTE: reshaped for borrowck — index instead of zip over two &mut self slices
        let len = shallow_clone.len();
        for i in 0..len {
            let in_ = this.r#mut(i);
            let out_val = in_.get_fallback(ColorFallbackKind { rgb: true, ..Default::default() });
            *shallow_clone.r#mut(i) = out_val;
        }
        Some(shallow_clone)
    } else {
        None
    };

    // Prefixed properties only support RGB.
    let prefix_images: &SmallList<T, 1> = if let Some(ref r) = rgb { r } else { &*this };

    // Legacy -webkit-gradient()
    if prefixes.webkit
        && targets.browsers.is_some()
        && css::prefixes::Feature::is_webkit_gradient(targets.browsers.unwrap())
    {
        let images = 'images: {
            let mut images = SmallList::<T, 1>::default();
            for item in prefix_images.slice() {
                if let Some(img) = item.get_image().get_legacy_webkit() {
                    images.append(item.with_image(img));
                }
            }
            break 'images images;
        };
        if !images.is_empty() {
            res.push(images);
        }
    }

    #[inline]
    fn prefix_helper<T: ImageFallback>(
        prefix: &'static str,
        pfs: &css::VendorPrefix,
        pfi: &SmallList<T, 1>,
        r: &mut BabyList<SmallList<T, 1>>,
        alloc: &bun_alloc::Arena,
    ) {
        if pfs.contains(css::VendorPrefix::from_name(prefix)) {
            let mut images = SmallList::<T, 1>::init_capacity(pfi.len());
            images.set_len(pfi.len());
            // PORT NOTE: reshaped for borrowck — index instead of zip
            for i in 0..pfi.len() {
                let in_ = pfi.at(i);
                let image = in_.get_image().get_prefixed(alloc, css::VendorPrefix::from_name(prefix));
                // SAFETY: i < len; slot uninitialized after set_len
                unsafe { ptr::write(images.as_ptr().add(i as usize), in_.with_image(image)) };
            }
            r.push(images);
        }
    }

    prefix_helper("webkit", &prefixes, prefix_images, &mut res, allocator);
    prefix_helper("moz", &prefixes, prefix_images, &mut res, allocator);
    prefix_helper("o", &prefixes, prefix_images, &mut res, allocator);

    if prefixes.none {
        if let Some(r) = rgb {
            res.push(r);
        }

        if fallbacks.p3 {
            let mut p3_images = this.shallow_clone();
            let len = p3_images.len();
            for i in 0..len {
                let in_ = this.r#mut(i);
                let out_val = in_.get_fallback(ColorFallbackKind { p3: true, ..Default::default() });
                *p3_images.r#mut(i) = out_val;
            }
            res.push(p3_images);
        }

        // Convert to lab if needed (e.g. if oklab is not supported but lab is).
        if fallbacks.lab {
            for item in this.slice_mut() {
                let new = item.get_fallback(ColorFallbackKind { lab: true, ..Default::default() });
                let old = core::mem::replace(item, new);
                drop(old);
            }
        }
    } else if let Some(the_last) = res.pop() {
        // Prefixed property with no unprefixed version.
        // Replace self with the last prefixed version so that it doesn't
        // get duplicated when the caller pushes the original value.
        let old = core::mem::replace(this, the_last);
        drop(old);
    }
    res
}

pub fn get_fallbacks_text_shadow(
    this: &mut SmallList<TextShadow, 1>,
    targets: css::targets::Targets,
) -> SmallList<SmallList<TextShadow, 1>, 2> {
    let mut fallbacks = css::ColorFallbackKind::default();
    for shadow in this.slice() {
        fallbacks.insert(shadow.color.get_necessary_fallbacks(targets));
    }

    let mut res = SmallList::<SmallList<TextShadow, 1>, 2>::default();
    if fallbacks.rgb {
        let mut rgb = SmallList::<TextShadow, 1>::init_capacity(this.len());
        for shadow in this.slice() {
            let mut new_shadow = *shadow;
            // dummy non-alloced color to avoid deep cloning the real one since we will replace it
            new_shadow.color = css::css_values::color::CssColor::CurrentColor;
            new_shadow = new_shadow.deep_clone();
            new_shadow.color = shadow.color.to_rgb().unwrap();
            rgb.append_assume_capacity(new_shadow);
        }
        res.append(rgb);
    }

    if fallbacks.p3 {
        let mut p3 = SmallList::<TextShadow, 1>::init_capacity(this.len());
        for shadow in this.slice() {
            let mut new_shadow = *shadow;
            // dummy non-alloced color to avoid deep cloning the real one since we will replace it
            new_shadow.color = css::css_values::color::CssColor::CurrentColor;
            new_shadow = new_shadow.deep_clone();
            new_shadow.color = shadow.color.to_p3().unwrap();
            p3.append_assume_capacity(new_shadow);
        }
        res.append(p3);
    }

    if fallbacks.lab {
        for shadow in this.slice_mut() {
            let out = shadow.color.to_lab().unwrap();
            // old color dropped via replace
            let _ = core::mem::replace(&mut shadow.color, out);
        }
    }

    res
}
} // mod fallbacks_gated

/// Copy pasted from Zig std in array list:
///
/// Called when memory growth is necessary. Returns a capacity larger than
/// minimum that grows super-linearly.
fn grow_capacity(current: u32, minimum: u32) -> u32 {
    let mut new = current;
    loop {
        new = new.saturating_add(new / 2 + 8);
        if new >= minimum {
            return new;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/small_list.zig (672 lines)
//   confidence: medium
//   todos:      19
//   notes:      Allocator params dropped (global mimalloc) — css is an AST crate so Phase B must reconcile arena vs realloc (see TODO at impl block). getFallbacks split into trait + 2 free fns (was @hasDecl/@TypeOf comptime dispatch). triple_mut returns raw ptrs to dodge borrowck on self-referential len ptr. Drop matches Zig deinit (frees buffer only, not elements).
// ──────────────────────────────────────────────────────────────────────────
