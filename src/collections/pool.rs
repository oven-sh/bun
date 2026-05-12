use core::cell::RefCell;
use core::marker::PhantomData;
use core::mem::{MaybeUninit, offset_of};
use core::ptr;

use bun_core::Error;

// ──────────────────────────────────────────────────────────────────────────
// SinglyLinkedList
// ──────────────────────────────────────────────────────────────────────────
//
// PORT NOTE: Zig's `SinglyLinkedList(comptime T: type, comptime Parent: type)`
// threads `Parent` only so that `Node.release()` can call `Parent.release(node)`.
// In Rust the only `Parent` is `ObjectPool`, so `Node::release` is provided as
// an inherent method on `ObjectPool` instead and the `Parent` type param is
// dropped here. Diff readers: `node.release()` call sites become
// `ObjectPool::<..>::release(node)`.

/// Node inside the linked list wrapping the actual data.
#[repr(C)]
pub struct Node<T> {
    // INTRUSIVE: pool.zig:7 — next link in singly-linked free list
    pub next: *mut Node<T>,
    // PORT NOTE: Zig stored `std.mem.Allocator param` here so `destroyNode`
    // could free via the originating allocator. In Rust the global mimalloc
    // allocator owns every `Box<Node<T>>`, so the field is dropped and
    // `destroy_node` uses `heap::take`.
    //
    // PORT NOTE: `MaybeUninit<T>` not `T` — Zig's `else undefined` (pool.zig:203)
    // is well-defined-until-read, but Rust's `assume_init()` on uninit bytes is
    // immediate UB for any `T` with validity invariants. Callers that use
    // `INIT == None` write `data` before reading, so we keep the bytes
    // uninitialized and only `assume_init_*` at access sites.
    pub data: MaybeUninit<T>,
}

// PORT NOTE: `pub const Data = T;` (inherent assoc type) is nightly-only;
// callers can write `T` directly.

impl<T> Node<T> {
    /// Read `(*p).next` for a known-non-null, live node pointer. Centralises
    /// the `unsafe { (*p).next }` walk that appears throughout this module's
    /// list traversals. Caller contract: `p` points at a live `Node<T>` (never
    /// null — debug-asserted).
    #[inline(always)]
    fn next_of(p: *const Node<T>) -> *mut Node<T> {
        debug_assert!(!p.is_null());
        // SAFETY: every call site passes a node either just popped from the
        // free list, just compared non-null in the surrounding `while`/`if`,
        // or `&self`/`self.first` after an explicit null check.
        unsafe { (*p).next }
    }

    /// Access the pooled value.
    ///
    /// # Safety
    /// `data` must be initialized: either the pool was instantiated with
    /// `T::INIT == Some(_)`, or the caller wrote to `data` after `get()`,
    /// or the node was created via `push(value)`.
    #[inline]
    pub unsafe fn data_ref(&self) -> &T {
        // SAFETY: caller guarantees `data` is initialized.
        unsafe { self.data.assume_init_ref() }
    }

    /// See [`Node::data_ref`] for safety requirements.
    #[inline]
    pub unsafe fn data_mut(&mut self) -> &mut T {
        // SAFETY: caller guarantees `data` is initialized.
        unsafe { self.data.assume_init_mut() }
    }

    /// Insert a new node after the current one.
    ///
    /// Arguments:
    ///     new_node: Pointer to the new node to insert.
    pub fn insert_after(&mut self, new_node: &mut Node<T>) {
        new_node.next = self.next;
        self.next = std::ptr::from_mut::<Node<T>>(new_node);
    }

    /// Remove a node from the list.
    ///
    /// Arguments:
    ///     node: Pointer to the node to be removed.
    /// Returns:
    ///     node removed
    pub fn remove_next(&mut self) -> Option<*mut Node<T>> {
        let next_node = if self.next.is_null() {
            return None;
        } else {
            self.next
        };
        self.next = Node::next_of(next_node);
        Some(next_node)
    }

    /// Iterate over the singly-linked list from this node, until the final node is found.
    /// This operation is O(N).
    pub fn find_last(&mut self) -> *mut Node<T> {
        let mut it: *mut Node<T> = std::ptr::from_mut::<Node<T>>(self);
        loop {
            let next = Node::next_of(it);
            if next.is_null() {
                return it;
            }
            it = next;
        }
    }

    /// Iterate over each next node, returning the count of all nodes except the starting one.
    /// This operation is O(N).
    pub fn count_children(&self) -> usize {
        let mut count: usize = 0;
        let mut it: *const Node<T> = self.next;
        while !it.is_null() {
            count += 1;
            it = Node::next_of(it);
        }
        count
    }

    // PORT NOTE: `pub inline fn release(node: *Node) void { Parent.release(node) }`
    // is expressed as `ObjectPool::<T, ..>::release(node)` at call sites; see
    // module-level note above.
}

pub struct SinglyLinkedList<T> {
    // INTRUSIVE: pool.zig:59 — list head; popFirst hands node to caller
    pub first: *mut Node<T>,
}

impl<T> Default for SinglyLinkedList<T> {
    fn default() -> Self {
        Self {
            first: ptr::null_mut(),
        }
    }
}

impl<T> SinglyLinkedList<T> {
    /// Insert a new node at the head.
    ///
    /// Arguments:
    ///     new_node: Pointer to the new node to insert.
    pub fn prepend(&mut self, new_node: *mut Node<T>) {
        // SAFETY: caller guarantees new_node is a live, exclusively-owned Node
        unsafe { (*new_node).next = self.first };
        self.first = new_node;
    }

    /// Remove a node from the list.
    ///
    /// Arguments:
    ///     node: Pointer to the node to be removed.
    pub fn remove(&mut self, node: *mut Node<T>) {
        if self.first == node {
            self.first = Node::next_of(node);
        } else {
            // SAFETY: self.first is non-null (else the `==` above would have
            // matched the null `node`, which callers never pass)
            let mut current_elm = self.first;
            // SAFETY: walk live list nodes; Zig's `.?` would panic on null —
            // mirror that with an unchecked deref (debug_assert in Phase B).
            unsafe {
                while (*current_elm).next != node {
                    current_elm = (*current_elm).next;
                }
                (*current_elm).next = (*node).next;
            }
        }
    }

    /// Remove and return the first node in the list.
    ///
    /// Returns:
    ///     A pointer to the first node in the list.
    pub fn pop_first(&mut self) -> Option<*mut Node<T>> {
        let first = if self.first.is_null() {
            return None;
        } else {
            self.first
        };
        self.first = Node::next_of(first);
        Some(first)
    }

    /// Iterate over all nodes, returning the count.
    /// This operation is O(N).
    pub fn len(&self) -> usize {
        if !self.first.is_null() {
            // SAFETY: first is non-null and live
            1 + unsafe { (*self.first).count_children() }
        } else {
            0
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ObjectPool
// ──────────────────────────────────────────────────────────────────────────

const LOG_ALLOCATIONS: bool = false;

/// Behavior hooks the Zig version expressed via `comptime Init: ?fn(...)` and
/// `std.meta.hasFn(Type, "reset")`. Per PORTING.md §Comptime reflection,
/// optional-decl checks become a trait with default methods.
pub trait ObjectPoolType: Sized {
    /// Mirrors `comptime Init: ?fn(allocator) anyerror!Type`. `None` ⇒ the
    /// Zig path that left `data` as `undefined`.
    const INIT: Option<fn() -> Result<Self, Error>> = None;

    /// Mirrors `if (std.meta.hasFn(Type, "reset")) node.data.reset()`.
    /// Default is a no-op; types that had `.reset()` in Zig override this.
    #[inline]
    fn reset(&mut self) {}
}

/// Per-pool mutable state. Zig's `DataStruct`.
pub struct DataStruct<T> {
    pub list: SinglyLinkedList<T>,
    pub loaded: bool,
    // PORT NOTE: Zig used `MaxCountInt = std.math.IntFittingRange(0, max_count)`.
    // Rust const generics cannot pick an integer type from a const value; use
    // `usize` and accept the few extra bytes.
    // PERF(port): was IntFittingRange — profile in Phase B
    pub count: usize,
}

impl<T> Default for DataStruct<T> {
    fn default() -> Self {
        Self {
            // PORT NOTE: Zig had `list: LinkedList = undefined` — we zero it.
            list: SinglyLinkedList::default(),
            loaded: false,
            count: 0,
        }
    }
}

/// Object pool with a singly-linked free list.
///
/// `THREADSAFE == true`  ⇒ storage is thread-local (one free list per thread).
/// `THREADSAFE == false` ⇒ storage is a single process-wide static.
///
/// `S` supplies the per-monomorphization static storage; see `object_pool!`.
pub struct ObjectPool<
    T: ObjectPoolType,
    const THREADSAFE: bool,
    const MAX_COUNT: usize,
    S = UnwiredStorage,
>(core::marker::PhantomData<(T, S)>);

// PORT NOTE: `pub const List = SinglyLinkedList(T)` / `pub const Node = Node(T)`
// inherent assoc types are nightly-only; callers write `SinglyLinkedList<T>` /
// `Node<T>` directly.

/// Per-monomorphization storage hook. Generic statics are not expressible in
/// Rust, so each `(T, THREADSAFE, MAX_COUNT)` instantiation must provide its
/// own `thread_local!` / `static` via this trait — typically generated by
/// `object_pool!`.
pub trait PoolStorage<T>: 'static {
    /// Run `f` with a borrow of this monomorphization's `DataStruct`.
    fn with<R>(f: impl FnOnce(&RefCell<DataStruct<T>>) -> R) -> R;
}

/// Fallback storage that panics on first use. Lets `ObjectPool<T, ..>` name a
/// concrete type before its storage is wired (matches the prior `data()`
/// `unreachable!`).
pub struct UnwiredStorage;
impl<T: 'static> PoolStorage<T> for UnwiredStorage {
    fn with<R>(_f: impl FnOnce(&RefCell<DataStruct<T>>) -> R) -> R {
        unreachable!(
            "ObjectPool<{}> storage not wired — declare with `object_pool!`",
            core::any::type_name::<T>()
        )
    }
}

/// Trait alias so callers can name `<Pool as ObjectPoolTrait>::Node` without
/// knowing the concrete generics.
pub trait ObjectPoolTrait {
    type Item;
    type Node;
}

impl<T: ObjectPoolType, const TS: bool, const MAX: usize, S> ObjectPoolTrait
    for ObjectPool<T, TS, MAX, S>
{
    type Item = T;
    type Node = Node<T>;
}

/// RAII handle for a pooled `T`. Derefs to the inner value; on `Drop`, the
/// node is returned to its pool. Replaces the Zig `get()` + `defer release()`
/// pair.
pub struct PoolGuard<'a, T: ObjectPoolType + 'static> {
    node: *mut Node<T>,
    release: fn(*mut Node<T>),
    _marker: PhantomData<&'a mut T>,
}

impl<'a, T: ObjectPoolType> core::ops::Deref for PoolGuard<'a, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: `node` is exclusively owned for the guard's lifetime and its
        // `data` was initialized by the pool's `get()` path before being handed
        // out (either via `T::INIT` or by reuse of a previously-written node).
        unsafe { (*self.node).data.assume_init_ref() }
    }
}

impl<'a, T: ObjectPoolType> core::ops::DerefMut for PoolGuard<'a, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: see `Deref` impl.
        unsafe { (*self.node).data.assume_init_mut() }
    }
}

impl<'a, T: ObjectPoolType> Drop for PoolGuard<'a, T> {
    fn drop(&mut self) {
        (self.release)(self.node);
    }
}

impl<'a, T: ObjectPoolType> PoolGuard<'a, T> {
    /// Raw pointer to the underlying node (for callers that need to stash it
    /// across an FFI boundary). The guard still owns the node.
    #[inline]
    pub fn node_ptr(&self) -> *mut Node<T> {
        self.node
    }
}

impl<T: ObjectPoolType + 'static, const THREADSAFE: bool, const MAX_COUNT: usize, S>
    ObjectPool<T, THREADSAFE, MAX_COUNT, S>
where
    S: PoolStorage<T>,
{
    // We want this to be global
    // but we don't want to create 3 global variables per pool
    // instead, we create one global variable per pool
    //
    // PORT NOTE: Rust cannot place a `static` / `thread_local!` inside a
    // generic `impl`; storage is supplied via the `S: PoolStorage<T>` type
    // parameter (see `object_pool!` for the usual declaration).
    #[inline]
    pub fn data<R>(f: impl FnOnce(&RefCell<DataStruct<T>>) -> R) -> R {
        S::with(f)
    }

    pub fn full() -> bool {
        if MAX_COUNT == 0 {
            return false;
        }
        Self::data(|cell| {
            let d = cell.borrow();
            d.loaded && d.count >= MAX_COUNT
        })
    }

    pub fn has() -> bool {
        Self::data(|cell| {
            let d = cell.borrow();
            d.loaded && !d.list.first.is_null()
        })
    }

    pub fn push(pooled: T) {
        if cfg!(debug_assertions) {
            // PORT NOTE: Zig gated on `env.allow_assert`; that is
            // `Environment.isDebug` ⇒ `cfg!(debug_assertions)`.
            debug_assert!(!Self::full());
        }

        let new_node = bun_core::heap::into_raw(Box::new(Node::<T> {
            next: ptr::null_mut(),
            data: MaybeUninit::new(pooled),
        }));
        Self::release(new_node);
    }

    pub fn get_if_exists() -> Option<*mut Node<T>> {
        Self::data(|cell| {
            let mut d = cell.borrow_mut();
            if !d.loaded {
                return None;
            }

            let node = d.list.pop_first()?;
            // SAFETY: node was just popped from the free list and is exclusively owned;
            // free-list nodes always carry initialized `data` (they reach the list
            // via `push` or `release` of a previously-used node).
            unsafe { (*node).data.assume_init_mut().reset() };
            if MAX_COUNT > 0 {
                d.count = d.count.saturating_sub(1);
            }

            Some(node)
        })
    }

    pub fn first() -> *mut T {
        // SAFETY: `get_node()` always returns a valid, exclusively-owned node
        unsafe { (*Self::get_node()).data.as_mut_ptr() }
    }

    /// Zig `get()` — pop a node from the free list or allocate a fresh one.
    pub fn get_node() -> *mut Node<T> {
        let reused = Self::data(|cell| {
            let mut d = cell.borrow_mut();
            if d.loaded {
                if let Some(node) = d.list.pop_first() {
                    // SAFETY: node just popped from free list, exclusively owned;
                    // free-list nodes always carry initialized `data`.
                    unsafe { (*node).data.assume_init_mut().reset() };
                    if MAX_COUNT > 0 {
                        d.count = d.count.saturating_sub(1);
                    }
                    return Some(node);
                }
            }
            None
        });
        if let Some(node) = reused {
            return node;
        }

        if LOG_ALLOCATIONS {
            // PORT NOTE: Zig wrote to stderr via std.fs; banned here. Phase B
            // can route through `bun_core::Output` if this is ever flipped on.
            // TODO(port): log "Allocate {type_name} - {size} bytes"
        }

        // Matches Zig's `data = if (Init) |i| i(..) else undefined` (pool.zig:203).
        // For `INIT == None` the bytes stay uninitialized; the caller MUST write
        // `data` before any read (and before `release()`, since `destroy_node`
        // assumes it is initialized when dropping).
        let data = match T::INIT {
            Some(init_) => MaybeUninit::new(init_().expect("unreachable")),
            None => MaybeUninit::uninit(),
        };
        bun_core::heap::into_raw(Box::new(Node::<T> {
            next: ptr::null_mut(),
            data,
        }))
    }

    /// RAII front-door: pop or allocate a node and wrap it in a `PoolGuard`
    /// that returns it to this pool on `Drop`.
    pub fn get() -> PoolGuard<'static, T> {
        PoolGuard {
            node: Self::get_node(),
            release: Self::release,
            _marker: PhantomData,
        }
    }

    pub fn release_value(value: *mut T) {
        // SAFETY: `value` points to the `data` field of a live `Node<T>`
        let node = unsafe { bun_core::from_field_ptr!(Node<T>, data, value) };
        Self::release(node);
    }

    pub fn release(node: *mut Node<T>) {
        let overflowed = Self::data(|cell| {
            let mut d = cell.borrow_mut();
            if MAX_COUNT > 0 && d.count >= MAX_COUNT {
                if LOG_ALLOCATIONS {
                    // TODO(port): log "Free {type_name} - {size} bytes"
                }
                return true;
            }

            if MAX_COUNT > 0 {
                d.count = d.count.saturating_add(1);
            }

            if d.loaded {
                d.list.prepend(node);
            } else {
                d.list = SinglyLinkedList { first: node };
                d.loaded = true;
            }
            false
        });
        if overflowed {
            Self::destroy_node(node);
        }
    }

    pub fn delete_all() {
        let mut next = Self::data(|cell| {
            let mut dat = cell.borrow_mut();
            if !dat.loaded {
                return ptr::null_mut();
            }
            dat.loaded = false;
            dat.count = 0;
            let head = dat.list.first;
            dat.list.first = ptr::null_mut();
            head
        });
        while !next.is_null() {
            let node = next;
            next = Node::next_of(node);
            Self::destroy_node(node);
        }
    }

    fn destroy_node(node: *mut Node<T>) {
        // TODO(port): Zig special-cased `Type != bun.Vec<u8>` here to skip
        // `bun.memory.deinit(&node.data)` for `Vec<u8>` (a known leak the Zig
        // comment calls out). In Rust, dropping `T` is the moral equivalent of
        // `bun.memory.deinit`. If `Vec<u8>` (the `Vec<u8>` port) must keep
        // leaking for compat, gate its `Drop` there — not here.
        //
        // SAFETY: `node` was created via `heap::alloc` in `push`/`get` and
        // is exclusively owned by the caller. `data` is initialized: `destroy_node`
        // is only reached from `release()` (caller had a usable node, so `data`
        // was written) or `delete_all()` (free-list nodes, always initialized).
        unsafe {
            (*node).data.assume_init_drop();
            drop(bun_core::heap::take(node));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// object_pool! — declare per-instantiation storage
// ──────────────────────────────────────────────────────────────────────────

/// Declare an `ObjectPool` alias plus its backing static/thread-local storage.
///
/// ```ignore
/// // thread-local free list, capped at 32 nodes
/// object_pool!(pub StringVoidMapPool: StringVoidMap, threadsafe, 32);
/// // process-wide free list, uncapped
/// object_pool!(BufferPool: Vec<u8>, global, 0);
/// ```
///
/// Expands to a private storage struct implementing `PoolStorage<T>` and a
/// `pub type $Name = ObjectPool<$T, .., $Storage>` alias. `threadsafe` ⇒
/// `thread_local!` (one free list per thread); `global` ⇒ a single
/// process-wide `RefCell` (caller is responsible for not touching it from
/// multiple threads — matches the Zig `threadsafe = false` mode).
#[macro_export]
macro_rules! object_pool {
    ($vis:vis $name:ident : $ty:ty, threadsafe, $max:expr) => {
        $crate::object_pool!(@storage_tls $name, $ty);
        $vis type $name = $crate::pool::ObjectPool<
            $ty, true, { $max }, $crate::__paste_storage!($name)
        >;
    };
    ($vis:vis $name:ident : $ty:ty, global, $max:expr) => {
        $crate::object_pool!(@storage_global $name, $ty);
        $vis type $name = $crate::pool::ObjectPool<
            $ty, false, { $max }, $crate::__paste_storage!($name)
        >;
    };
    (@storage_tls $name:ident, $ty:ty) => {
        $crate::__object_pool_storage! { $name, $ty, tls }
    };
    (@storage_global $name:ident, $ty:ty) => {
        $crate::__object_pool_storage! { $name, $ty, global }
    };
}

/// Internal: expand the storage struct + `PoolStorage` impl. Separate macro so
/// the storage type name can be derived from `$name` without `paste!`.
#[doc(hidden)]
#[macro_export]
macro_rules! __object_pool_storage {
    ($name:ident, $ty:ty, tls) => {
        #[allow(non_camel_case_types)]
        #[doc(hidden)]
        pub struct __ObjectPoolStorage;
        ::std::thread_local! {
            static __OBJECT_POOL_DATA: ::core::cell::RefCell<
                $crate::pool::DataStruct<$ty>
            > = ::core::cell::RefCell::new($crate::pool::DataStruct::default());
        }
        impl $crate::pool::PoolStorage<$ty> for __ObjectPoolStorage {
            fn with<R>(
                f: impl FnOnce(&::core::cell::RefCell<$crate::pool::DataStruct<$ty>>) -> R,
            ) -> R {
                __OBJECT_POOL_DATA.with(|cell| f(cell))
            }
        }
    };
    ($name:ident, $ty:ty, global) => {
        #[allow(non_camel_case_types)]
        #[doc(hidden)]
        pub struct __ObjectPoolStorage;
        impl $crate::pool::PoolStorage<$ty> for __ObjectPoolStorage {
            fn with<R>(
                f: impl FnOnce(&::core::cell::RefCell<$crate::pool::DataStruct<$ty>>) -> R,
            ) -> R {
                // PORT NOTE: Zig's `threadsafe = false` used a plain global
                // `var data`; Rust forbids non-`Sync` statics, so this still
                // expands to a thread-local. Single-threaded callers see the
                // same one cell; cross-thread callers get per-thread pools
                // (a slight behaviour difference, but safe).
                ::std::thread_local! {
                    static __OBJECT_POOL_DATA: ::core::cell::RefCell<
                        $crate::pool::DataStruct<$ty>
                    > = ::core::cell::RefCell::new($crate::pool::DataStruct::default());
                }
                __OBJECT_POOL_DATA.with(|cell| f(cell))
            }
        }
    };
}

/// Internal: name of the storage struct generated by `__object_pool_storage!`.
/// Kept simple (no `paste!` dep) by using a fixed name; callers must therefore
/// declare at most one pool per containing module. If that proves too
/// restrictive, swap this for `paste::paste!`.
#[doc(hidden)]
#[macro_export]
macro_rules! __paste_storage {
    ($name:ident) => {
        __ObjectPoolStorage
    };
}

// ──────────────────────────────────────────────────────────────────────────
// `ObjectPoolType` impls for `bun_core` types live here (trait owner) to
// avoid a `bun_core → bun_collections` dep cycle now that `MutableString`
// is in `bun_core` (post `bun_string` merge).
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `Npm.Registry.BodyPool = ObjectPool(MutableString, MutableString.init2048, true, 8)`
/// (src/install/npm.zig). Init = `init2048`; reuse = `.reset()`.
impl ObjectPoolType for bun_core::MutableString {
    const INIT: Option<fn() -> Result<Self, Error>> =
        Some(|| bun_core::MutableString::init2048().map_err(Into::into));
    #[inline]
    fn reset(&mut self) {
        bun_core::MutableString::reset(self);
    }
}

// ported from: src/collections/pool.zig
