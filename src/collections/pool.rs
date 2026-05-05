use core::cell::RefCell;
use core::mem::{offset_of, MaybeUninit};
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
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator` here so `destroyNode`
    // could free via the originating allocator. In Rust the global mimalloc
    // allocator owns every `Box<Node<T>>`, so the field is dropped and
    // `destroy_node` uses `Box::from_raw`.
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
    /// Access the pooled value.
    ///
    /// # Safety
    /// `data` must be initialized: either the pool was instantiated with
    /// `T::INIT == Some(_)`, or the caller wrote to `data` after `get()`,
    /// or the node was created via `push(value)`.
    #[inline]
    pub unsafe fn data_ref(&self) -> &T {
        self.data.assume_init_ref()
    }

    /// See [`Node::data_ref`] for safety requirements.
    #[inline]
    pub unsafe fn data_mut(&mut self) -> &mut T {
        self.data.assume_init_mut()
    }

    /// Insert a new node after the current one.
    ///
    /// Arguments:
    ///     new_node: Pointer to the new node to insert.
    pub fn insert_after(&mut self, new_node: &mut Node<T>) {
        new_node.next = self.next;
        self.next = new_node as *mut Node<T>;
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
        // SAFETY: next_node is non-null (checked above) and points to a live Node
        self.next = unsafe { (*next_node).next };
        Some(next_node)
    }

    /// Iterate over the singly-linked list from this node, until the final node is found.
    /// This operation is O(N).
    pub fn find_last(&mut self) -> *mut Node<T> {
        let mut it: *mut Node<T> = self as *mut Node<T>;
        loop {
            // SAFETY: `it` is always a valid live node in the list
            let next = unsafe { (*it).next };
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
            // SAFETY: `it` is non-null and points to a live Node
            it = unsafe { (*it).next };
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
        Self { first: ptr::null_mut() }
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
            // SAFETY: node == self.first which is non-null and live
            self.first = unsafe { (*node).next };
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
        // SAFETY: first is non-null and live
        self.first = unsafe { (*first).next };
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
pub struct ObjectPool<T: ObjectPoolType, const THREADSAFE: bool, const MAX_COUNT: usize>(
    core::marker::PhantomData<T>,
);

// PORT NOTE: `pub const List = SinglyLinkedList(T)` / `pub const Node = Node(T)`
// inherent assoc types are nightly-only; callers write `SinglyLinkedList<T>` /
// `Node<T>` directly.

impl<T: ObjectPoolType + 'static, const THREADSAFE: bool, const MAX_COUNT: usize>
    ObjectPool<T, THREADSAFE, MAX_COUNT>
{
    // We want this to be global
    // but we don't want to create 3 global variables per pool
    // instead, we create one global variable per pool
    //
    // TODO(port): Rust cannot place a `static` / `thread_local!` inside a
    // generic `impl` — each monomorphization needs its own storage but Rust
    // statics are not monomorphized. Phase B must either (a) require callers
    // to declare the storage via a small `object_pool!` macro that expands to
    // a `thread_local!`/`static` + a unit struct implementing a `PoolStorage`
    // trait, or (b) key a global registry by `TypeId`. The accessor below is
    // the shape the rest of this file expects.
    #[inline]
    fn data() -> &'static RefCell<DataStruct<T>> {
        // TODO(port): per-monomorphization storage; see note above.
        unreachable!("ObjectPool::data() requires Phase-B storage wiring")
    }

    pub fn full() -> bool {
        if MAX_COUNT == 0 {
            return false;
        }
        let d = Self::data().borrow();
        d.loaded && d.count >= MAX_COUNT
    }

    pub fn has() -> bool {
        let d = Self::data().borrow();
        d.loaded && !d.list.first.is_null()
    }

    pub fn push(pooled: T) {
        if cfg!(debug_assertions) {
            // PORT NOTE: Zig gated on `env.allow_assert`; that is
            // `Environment.isDebug` ⇒ `cfg!(debug_assertions)`.
            debug_assert!(!Self::full());
        }

        let new_node = Box::into_raw(Box::new(Node::<T> {
            next: ptr::null_mut(),
            data: MaybeUninit::new(pooled),
        }));
        Self::release(new_node);
    }

    pub fn get_if_exists() -> Option<*mut Node<T>> {
        let mut d = Self::data().borrow_mut();
        if !d.loaded {
            return None;
        }

        let node = match d.list.pop_first() {
            Some(n) => n,
            None => return None,
        };
        // SAFETY: node was just popped from the free list and is exclusively owned;
        // free-list nodes always carry initialized `data` (they reach the list
        // via `push` or `release` of a previously-used node).
        unsafe { (*node).data.assume_init_mut().reset() };
        if MAX_COUNT > 0 {
            d.count = d.count.saturating_sub(1);
        }

        Some(node)
    }

    pub fn first() -> *mut T {
        // SAFETY: `get()` always returns a valid, exclusively-owned node
        unsafe { (*Self::get()).data.as_mut_ptr() }
    }

    pub fn get() -> *mut Node<T> {
        {
            let mut d = Self::data().borrow_mut();
            if d.loaded {
                if let Some(node) = d.list.pop_first() {
                    // SAFETY: node just popped from free list, exclusively owned;
                    // free-list nodes always carry initialized `data`.
                    unsafe { (*node).data.assume_init_mut().reset() };
                    if MAX_COUNT > 0 {
                        d.count = d.count.saturating_sub(1);
                    }
                    return node;
                }
            }
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
        Box::into_raw(Box::new(Node::<T> {
            next: ptr::null_mut(),
            data,
        }))
    }

    pub fn release_value(value: *mut T) {
        // SAFETY: `value` points to the `data` field of a live `Node<T>`
        let node = unsafe {
            (value as *mut u8)
                .sub(offset_of!(Node<T>, data))
                .cast::<Node<T>>()
        };
        Self::release(node);
    }

    pub fn release(node: *mut Node<T>) {
        let mut d = Self::data().borrow_mut();
        if MAX_COUNT > 0 {
            if d.count >= MAX_COUNT {
                if LOG_ALLOCATIONS {
                    // TODO(port): log "Free {type_name} - {size} bytes"
                }
                drop(d);
                Self::destroy_node(node);
                return;
            }
        }

        if MAX_COUNT > 0 {
            d.count = d.count.saturating_add(1);
        }

        if d.loaded {
            d.list.prepend(node);
            return;
        }

        d.list = SinglyLinkedList { first: node };
        d.loaded = true;
    }

    pub fn delete_all() {
        let mut dat = Self::data().borrow_mut();
        if !dat.loaded {
            return;
        }
        dat.loaded = false;
        dat.count = 0;
        let mut next = dat.list.first;
        dat.list.first = ptr::null_mut();
        drop(dat);
        while !next.is_null() {
            let node = next;
            // SAFETY: node is non-null and was on the free list
            next = unsafe { (*node).next };
            Self::destroy_node(node);
        }
    }

    fn destroy_node(node: *mut Node<T>) {
        // TODO(port): Zig special-cased `Type != bun.ByteList` here to skip
        // `bun.memory.deinit(&node.data)` for `ByteList` (a known leak the Zig
        // comment calls out). In Rust, dropping `T` is the moral equivalent of
        // `bun.memory.deinit`. If `BabyList<u8>` (the `ByteList` port) must keep
        // leaking for compat, gate its `Drop` there — not here.
        //
        // SAFETY: `node` was created via `Box::into_raw` in `push`/`get` and
        // is exclusively owned by the caller. `data` is initialized: `destroy_node`
        // is only reached from `release()` (caller had a usable node, so `data`
        // was written) or `delete_all()` (free-list nodes, always initialized).
        unsafe {
            (*node).data.assume_init_drop();
            drop(Box::from_raw(node));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/collections/pool.zig (262 lines)
//   confidence: medium
//   todos:      6
//   notes:      per-monomorphization static/thread_local storage for `data()` cannot be expressed in a generic impl — Phase B needs an `object_pool!` declaration macro or TypeId-keyed registry; `Init`/`reset` folded into `ObjectPoolType` trait; allocator field dropped (global mimalloc).
// ──────────────────────────────────────────────────────────────────────────
