use core::cell::RefCell;
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ptr;

use bun_core::Error;

// ──────────────────────────────────────────────────────────────────────────
// SinglyLinkedList
// ──────────────────────────────────────────────────────────────────────────

/// Node inside the linked list wrapping the actual data.
#[repr(C)]
pub struct Node<T> {
    // INTRUSIVE: next link in singly-linked free list
    pub next: *mut Node<T>,
    // `MaybeUninit<T>` not `T`: `assume_init()` on uninit bytes is
    // immediate UB for any `T` with validity invariants. Callers that use
    // `INIT == None` write `data` before reading, so we keep the bytes
    // uninitialized and only `assume_init_*` at access sites.
    pub data: MaybeUninit<T>,
}

// `pub const Data = T;` (inherent assoc type) is nightly-only;
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
    fn count_children(&self) -> usize {
        let mut count: usize = 0;
        let mut it: *const Node<T> = self.next;
        while !it.is_null() {
            count += 1;
            it = Node::next_of(it);
        }
        count
    }
}

pub struct SinglyLinkedList<T> {
    // INTRUSIVE: list head; pop_first hands node to caller
    pub first: *mut Node<T>,
}

impl<T> Default for SinglyLinkedList<T> {
    fn default() -> Self {
        Self {
            first: ptr::null_mut(),
        }
    }
}

impl<T> Drop for SinglyLinkedList<T> {
    fn drop(&mut self) {
        // The free list owns its nodes (each `release()` hands ownership back).
        // Without this, the TLS-backed pool's `DataStruct` strands every cached
        // node when the thread exits.
        let mut next = core::mem::replace(&mut self.first, ptr::null_mut());
        while !next.is_null() {
            let node = next;
            next = Node::next_of(node);
            // SAFETY: free-list nodes always carry initialized `data`
            // (`release()` only stores nodes that were used) and are
            // exclusively owned by the list.
            unsafe {
                (*node).data.assume_init_drop();
                drop(bun_core::heap::take(node));
            }
        }
    }
}

impl<T> SinglyLinkedList<T> {
    /// Insert a new node at the head.
    ///
    /// `new_node` must be live and exclusively owned by the caller until popped.
    pub fn prepend(&mut self, new_node: &mut Node<T>) {
        new_node.next = self.first;
        self.first = new_node;
    }

    /// Remove a node from the list. `node` must currently be in this list.
    pub fn remove(&mut self, node: &Node<T>) {
        let node = std::ptr::from_ref(node).cast_mut();
        if self.first == node {
            self.first = Node::next_of(node);
        } else {
            // SAFETY: self.first is non-null (else the `==` above would have
            // matched the null `node`, which callers never pass)
            let mut current_elm = self.first;
            // SAFETY: `node` is in this list (caller contract), so the walk
            // visits only live nodes and reaches `node` before hitting null.
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

/// Behavior hooks for pooled types: optional initialization and per-reuse
/// reset.
pub trait ObjectPoolType: Sized {
    /// Optional initializer for freshly allocated nodes. `None` ⇒ `data`
    /// starts uninitialized.
    const INIT: Option<fn() -> Result<Self, Error>> = None;

    /// Called when a node is reused from the free list. Default is a no-op.
    #[inline]
    fn reset(&mut self) {}
}

/// Per-pool mutable state.
pub struct DataStruct<T> {
    list: SinglyLinkedList<T>,
    loaded: bool,
    count: usize,
}

impl<T> Default for DataStruct<T> {
    fn default() -> Self {
        Self {
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

// `pub const List = SinglyLinkedList(T)` / `pub const Node = Node(T)`
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
/// node is returned to its pool.
pub struct PoolGuard<'a, T: ObjectPoolType + 'static> {
    node: *mut Node<T>,
    release: unsafe fn(*mut Node<T>),
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
        // SAFETY: `self.node` was obtained from `ObjectPool::get_node` and is
        // exclusively owned by this guard for its lifetime; ownership returns
        // to the pool's free list. `data` is initialized: either `T::INIT` is
        // `Some` (so `get_node` wrote it), or the guard's `DerefMut` already
        // proved initialization to the borrow checker before any read.
        unsafe { (self.release)(self.node) };
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
    // Rust cannot place a `static` / `thread_local!` inside a
    // generic `impl`; storage is supplied via the `S: PoolStorage<T>` type
    // parameter (see `object_pool!` for the usual declaration).
    #[inline]
    fn data<R>(f: impl FnOnce(&RefCell<DataStruct<T>>) -> R) -> R {
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

    pub fn push(pooled: T) {
        debug_assert!(!Self::full());

        let new_node = bun_core::heap::into_raw(Box::new(Node::<T> {
            next: ptr::null_mut(),
            data: MaybeUninit::new(pooled),
        }));
        // SAFETY: `new_node` is a freshly heap-allocated `Node<T>` we exclusively
        // own, and `data` was initialized to `pooled` just above.
        unsafe { Self::release(new_node) };
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

    /// Pop a node from the free list or allocate a fresh one.
    ///
    /// When `T::INIT == None` and a fresh node is allocated, the returned
    /// node's `data` is **uninitialized**; the caller must write a valid `T`
    /// to it before reading it or passing the node to [`Self::release`].
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
            let _ = bun_core::output::File::stderr().write_fmt(format_args!(
                "Allocate {} - {} bytes\n",
                core::any::type_name::<T>(),
                core::mem::size_of::<T>()
            ));
        }

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

    /// Return the node owning `value` to the pool's free list (or free it if
    /// the pool is full).
    ///
    /// Takes a raw `*mut T` for the same reason [`Self::release`] does: a full
    /// pool frees the `Node<T>` that `value` points into, which would be UB
    /// through a live `&mut` function argument. A `&mut value` reborrow also
    /// does not carry whole-parent provenance, which `from_field_ptr!` requires.
    ///
    /// # Safety
    ///
    /// `value` must point to the initialized `data` field of a live,
    /// exclusively-owned `Node<T>` previously handed out by this pool (e.g. via
    /// [`Self::first`]), carrying that node's provenance. Ownership transfers
    /// back to the pool.
    pub unsafe fn release_value(value: *mut T) {
        // SAFETY: caller contract — `value` is the `data` field of a live node
        // and carries its provenance.
        let node = unsafe { bun_core::from_field_ptr!(Node<T>, data, value) };
        // SAFETY: caller contract — `node` is live, exclusively owned, and its
        // `data` is initialized.
        unsafe { Self::release(node) };
    }

    /// Return a node to the pool's free list (or free it if the pool is full).
    ///
    /// Takes a raw `*mut Node<T>`, not `&mut Node<T>`: when the pool is already
    /// at `MAX_COUNT` this frees the node, and freeing an allocation that a live
    /// `&mut` **function argument** points into is UB (the reference is
    /// protected for the whole call). Same reason
    /// [`CellRefCounted::deref`](bun_ptr::CellRefCounted::deref) takes a raw
    /// pointer.
    ///
    /// # Safety
    ///
    /// `node` must be a live, exclusively-owned `Node<T>` previously handed out
    /// by this pool (e.g. via `get` / `get_node` / `first`), and `node.data`
    /// must be initialized. The free list assumes every stored node carries a
    /// valid `T` so it can `assume_init_mut().reset()` on reuse and
    /// `assume_init_drop()` on teardown — releasing a node that was obtained
    /// from `get_node()` with `T::INIT == None` and never written is UB.
    /// Ownership transfers back to the pool's free list.
    pub unsafe fn release(node: *mut Node<T>) {
        debug_assert!(!node.is_null());
        let overflowed = Self::data(|cell| {
            let mut d = cell.borrow_mut();
            if MAX_COUNT > 0 && d.count >= MAX_COUNT {
                if LOG_ALLOCATIONS {
                    let _ = bun_core::output::File::stderr().write_fmt(format_args!(
                        "Free {} - {} bytes\n",
                        core::any::type_name::<T>(),
                        core::mem::size_of::<T>()
                    ));
                }
                return true;
            }

            if MAX_COUNT > 0 {
                d.count = d.count.saturating_add(1);
            }

            if d.loaded {
                // SAFETY: caller contract — `node` is live and exclusively
                // owned; the list takes ownership of it here.
                d.list.prepend(unsafe { &mut *node });
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
/// multiple threads).
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
                // Rust forbids non-`Sync` statics, so the "global" mode still
                // expands to a thread-local. Single-threaded callers see the
                // same one cell; cross-thread callers get per-thread pools.
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

/// Init = `init2048`; reuse = `.reset()`.
impl ObjectPoolType for bun_core::MutableString {
    const INIT: Option<fn() -> Result<Self, Error>> =
        Some(|| bun_core::MutableString::init2048().map_err(Into::into));
    #[inline]
    fn reset(&mut self) {
        bun_core::MutableString::reset(self);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
//
// Run under Miri (`bun run rust:miri -p bun_collections`): the free list hands
// raw `*mut Node<T>` back and forth across `Box::into_raw`/`heap::take`, so
// Tree Borrows is what proves no node is reused after free or double-dropped.
//
// `object_pool!` names its storage struct `__ObjectPoolStorage` unconditionally,
// so each pool needs its own module.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, MutexGuard, PoisonError};

    static DROPS: AtomicUsize = AtomicUsize::new(0);
    static RESETS: AtomicUsize = AtomicUsize::new(0);

    /// `DROPS`/`RESETS` are process-wide but libtest runs `#[test]`s on parallel
    /// threads, so every test asserting on them holds this for its duration.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn drops() -> usize {
        DROPS.load(Ordering::SeqCst)
    }

    fn resets() -> usize {
        RESETS.load(Ordering::SeqCst)
    }

    /// Owns a heap allocation so a missed `assume_init_drop` leaks (Miri's
    /// leak check catches it) and a double drop is a double free.
    #[derive(Debug)]
    struct Tracked(Box<u32>);

    impl Drop for Tracked {
        fn drop(&mut self) {
            DROPS.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl ObjectPoolType for Tracked {
        const INIT: Option<fn() -> Result<Self, Error>> = Some(|| Ok(Tracked(Box::new(0))));
        fn reset(&mut self) {
            RESETS.fetch_add(1, Ordering::SeqCst);
            *self.0 = 0;
        }
    }

    // ── SinglyLinkedList ──────────────────────────────────────────────────

    #[test]
    fn singly_linked_list_push_pop() {
        let mut list: SinglyLinkedList<u32> = SinglyLinkedList::default();
        assert_eq!(list.len(), 0);
        assert!(list.pop_first().is_none());

        let mut nodes: Vec<Box<Node<u32>>> = (0..3)
            .map(|i| {
                Box::new(Node {
                    next: ptr::null_mut(),
                    data: MaybeUninit::new(i),
                })
            })
            .collect();
        for n in nodes.iter_mut() {
            list.prepend(n);
        }
        assert_eq!(list.len(), 3);

        // LIFO: last prepended comes out first.
        for expect in (0..3).rev() {
            let node = list.pop_first().expect("node");
            // SAFETY: `data` was initialized above; the node is still owned by
            // the `nodes` vec, which outlives the list.
            assert_eq!(unsafe { *(*node).data_ref() }, expect);
        }
        assert!(list.pop_first().is_none());
        // Nothing was handed to the list's `Drop` (it is empty), so `nodes`
        // still owns every allocation.
        core::mem::forget(list);
    }

    #[test]
    fn singly_linked_list_remove_and_walk() {
        let mut list: SinglyLinkedList<u32> = SinglyLinkedList::default();
        let mut nodes: Vec<Box<Node<u32>>> = (0..4)
            .map(|i| {
                Box::new(Node {
                    next: ptr::null_mut(),
                    data: MaybeUninit::new(i),
                })
            })
            .collect();
        for n in nodes.iter_mut() {
            list.prepend(n);
        }

        // Head is node 3; remove a middle node (1) and the head.
        list.remove(&nodes[1]);
        assert_eq!(list.len(), 3);
        let head = nodes[3].as_ref();
        list.remove(head);
        assert_eq!(list.len(), 2);

        // SAFETY: list is non-empty, so `first` is live.
        assert_eq!(unsafe { (*list.first).count_children() }, 1);
        // SAFETY: `first` is live and in the list.
        let last = unsafe { (*list.first).find_last() };
        // SAFETY: `last` is the tail node, still owned by `nodes`.
        assert_eq!(unsafe { *(*last).data_ref() }, 0);

        core::mem::forget(list);
    }

    /// The list owns whatever is still on it at `Drop` — dropping it must run
    /// each element's destructor exactly once and free each node.
    #[test]
    fn singly_linked_list_drop_frees_nodes() {
        let _serial = serial();
        let before = drops();
        let mut list: SinglyLinkedList<Tracked> = SinglyLinkedList::default();
        for i in 0..3 {
            let node = bun_core::heap::into_raw(Box::new(Node {
                next: ptr::null_mut(),
                data: MaybeUninit::new(Tracked(Box::new(i))),
            }));
            // SAFETY: freshly allocated and exclusively owned; ownership moves
            // to the list, whose `Drop` frees it.
            list.prepend(unsafe { &mut *node });
        }
        drop(list);
        assert_eq!(drops(), before + 3);
    }

    // ── ObjectPool: recycling ─────────────────────────────────────────────

    // `object_pool!` emits a `pub` storage struct; unreachable from a
    // private test module, which `unreachable_pub` would otherwise flag.
    #[allow(unreachable_pub)]
    mod recycle {
        use super::*;
        crate::object_pool!(pub Pool: Tracked, threadsafe, 0);

        #[test]
        fn pool_recycles_the_same_node() {
            let _serial = serial();
            let before = drops();
            let resets_before = resets();

            let first_ptr = {
                let mut guard = Pool::get();
                *guard.0 = 11;
                guard.node_ptr()
            }; // guard drop → node returns to the free list

            // Reuse: same allocation, `reset()` ran, value cleared.
            let mut guard = Pool::get();
            assert_eq!(guard.node_ptr(), first_ptr);
            assert_eq!(resets(), resets_before + 1);
            assert_eq!(*guard.0, 0);
            *guard.0 = 22;
            assert_eq!(*guard.0, 22);
            drop(guard);

            // Nothing was destroyed: the free list still owns the node.
            assert_eq!(drops(), before);

            Pool::delete_all();
            assert_eq!(drops(), before + 1);
        }
    }

    // ── ObjectPool: MAX_COUNT overflow frees instead of caching ───────────

    // `object_pool!` emits a `pub` storage struct; unreachable from a
    // private test module, which `unreachable_pub` would otherwise flag.
    #[allow(unreachable_pub)]
    mod capped {
        use super::*;
        crate::object_pool!(pub Pool: Tracked, threadsafe, 1);

        #[test]
        fn pool_over_max_count_destroys_the_node() {
            let _serial = serial();
            let before = drops();

            let a = Pool::get();
            let b = Pool::get();
            assert_ne!(a.node_ptr(), b.node_ptr());
            assert!(!Pool::full());

            drop(a); // cached (count 0 → 1)
            assert!(Pool::full());
            assert_eq!(drops(), before);

            drop(b); // pool full → destroyed
            assert_eq!(drops(), before + 1);

            Pool::delete_all();
            assert_eq!(drops(), before + 2);
        }
    }

    // ── ObjectPool: push / get_if_exists ──────────────────────────────────

    // `object_pool!` emits a `pub` storage struct; unreachable from a
    // private test module, which `unreachable_pub` would otherwise flag.
    #[allow(unreachable_pub)]
    mod push_get {
        use super::*;
        crate::object_pool!(pub Pool: Tracked, threadsafe, 0);

        #[test]
        fn push_then_get_if_exists() {
            let _serial = serial();
            let before = drops();
            // Nothing cached yet: `get_if_exists` must not allocate.
            assert!(Pool::get_if_exists().is_none());

            Pool::push(Tracked(Box::new(5)));
            let node = Pool::get_if_exists().expect("pushed node");
            // SAFETY: `node` was just popped; `push` initialized `data`, and
            // `get_if_exists` already ran `reset()` on it.
            assert_eq!(unsafe { *(*node).data_ref().0 }, 0);
            // The pool is empty again — the node is ours.
            assert!(Pool::get_if_exists().is_none());

            // Hand it back, then tear the pool down. Miri's leak check is what
            // proves `delete_all` actually frees the node it reclaimed.
            // SAFETY: `node` came from this pool and `data` is initialized.
            unsafe { Pool::release(node) };
            assert_eq!(drops(), before);
            Pool::delete_all();
            assert_eq!(drops(), before + 1);
        }
    }

    // ── ObjectPool: `first()` + `release_value()` container_of round-trip ──

    // `object_pool!` emits a `pub` storage struct; unreachable from a
    // private test module, which `unreachable_pub` would otherwise flag.
    #[allow(unreachable_pub)]
    mod field_ptr {
        use super::*;
        crate::object_pool!(pub Pool: Tracked, threadsafe, 0);

        #[test]
        fn first_then_release_value_round_trips_through_the_data_field() {
            let _serial = serial();
            let before = drops();
            let value: *mut Tracked = Pool::first();
            // SAFETY: `first()` hands out the `data` field of a live node whose
            // `T::INIT` already wrote a valid `Tracked`.
            unsafe { *(*value).0 = 7 };
            // `release_value` recovers the node via `offset_of!(Node<T>, data)`.
            // SAFETY: `value` is that node's `data` field, carrying its provenance.
            unsafe { Pool::release_value(value) };

            // The node is back on the free list, unharmed and reusable.
            let guard = Pool::get();
            assert_eq!(*guard.0, 0, "reset() ran on reuse");
            drop(guard);

            Pool::delete_all();
            assert_eq!(drops(), before + 1);
        }
    }

    // ── ObjectPool: `release_value()` on a full pool frees the node ────────

    // `object_pool!` emits a `pub` storage struct; unreachable from a
    // private test module, which `unreachable_pub` would otherwise flag.
    #[allow(unreachable_pub)]
    mod field_ptr_capped {
        use super::*;
        crate::object_pool!(pub Pool: Tracked, threadsafe, 1);

        /// The overflow path frees the very `Node<T>` that `value` points into.
        /// Taking `*mut T` is what makes that sound: a `&mut T` argument is
        /// protected for the whole call, and Tree Borrows rejects deallocating
        /// an allocation a protected reference points into.
        #[test]
        fn release_value_on_a_full_pool_frees_the_node() {
            let _serial = serial();
            let before = drops();

            // Fill the pool (MAX_COUNT = 1), then overflow it through `first()`.
            let cached = Pool::get();
            let overflow: *mut Tracked = Pool::first();
            drop(cached);
            assert!(Pool::full());

            // SAFETY: `overflow` is the `data` field of a live node this pool
            // handed out, carrying its provenance.
            unsafe { Pool::release_value(overflow) };
            assert_eq!(drops(), before + 1, "the overflowing node was freed");

            Pool::delete_all();
            assert_eq!(drops(), before + 2);
        }
    }
}
