//! Intrusive doubly-linked list with an external sweep cursor.
//!
//! Replaces the open-coded `prev`/`next` pointer manipulation scattered through
//! `context.rs` and `loop_core.rs` (group/socket link-unlink, timer sweep,
//! low-prio queue, deferred-free lists). Nodes embed a `ListLinks<Self>` and
//! implement [`Linked`]; the list itself is a single `head` cell so it stays
//! `#[repr(C)]`-embeddable inside FFI-visible structs.
//!
//! Single-threaded only — every field is a `Cell`, matching the uSockets loop
//! model where callbacks may re-enter and relink nodes while the caller holds
//! only a shared reference.

use core::cell::Cell;
use core::ptr::NonNull;

/// Per-node `prev`/`next` storage. Embed one of these in every `T` that
/// participates in an [`IntrusiveList<T>`].
#[repr(C)]
pub struct ListLinks<T> {
    prev: Cell<Option<NonNull<T>>>,
    next: Cell<Option<NonNull<T>>>,
}

impl<T> ListLinks<T> {
    #[inline]
    pub const fn new() -> Self {
        Self {
            prev: Cell::new(None),
            next: Cell::new(None),
        }
    }
}

impl<T> Default for ListLinks<T> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

/// Projects a node pointer to its embedded [`ListLinks`].
///
/// # Safety
/// Implementors guarantee that for any live `p`, `links(p)` returns a pointer
/// to a `ListLinks<Self>` that lives exactly as long as `*p` and is used by no
/// other list. All `NonNull<Self>` handed to [`IntrusiveList`] methods must
/// point at live, well-aligned storage for the duration of the call.
pub unsafe trait Linked: Sized {
    fn links(p: NonNull<Self>) -> NonNull<ListLinks<Self>>;
}

/// Singly-headed intrusive doubly-linked list.
///
/// `#[repr(C)]` and pointer-sized so it can replace a raw `*mut T` head field
/// in FFI-visible layouts without changing size or alignment.
#[repr(C)]
pub struct IntrusiveList<T: Linked> {
    head: Cell<Option<NonNull<T>>>,
}

impl<T: Linked> IntrusiveList<T> {
    #[inline]
    pub const fn new() -> Self {
        Self {
            head: Cell::new(None),
        }
    }

    #[inline]
    pub fn head(&self) -> Option<NonNull<T>> {
        self.head.get()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.head.get().is_none()
    }

    /// Link `node` at the front. `node` must be live and not currently linked
    /// in any list that shares these `ListLinks`.
    pub fn push_front(&self, node: NonNull<T>) {
        let head = self.head.replace(Some(node));
        // SAFETY: `Linked` contract — `node` is live and `links` projects into it.
        let node_links = unsafe { T::links(node).as_ref() };
        node_links.prev.set(None);
        node_links.next.set(head);
        if let Some(h) = head {
            // SAFETY: `h` was this list's head and is live by the list invariant.
            unsafe { T::links(h).as_ref() }.prev.set(Some(node));
        }
    }

    /// Unlink `node`. `node` must currently be a member of this list; its
    /// links are cleared on return so it may be re-linked elsewhere.
    pub fn remove(&self, node: NonNull<T>) {
        // SAFETY: `node` is a live list member; its neighbours (if any) are live by invariant.
        unsafe {
            let links = T::links(node).as_ref();
            let prev = links.prev.replace(None);
            let next = links.next.replace(None);
            match prev {
                Some(p) => T::links(p).as_ref().next.set(next),
                None => self.head.set(next),
            }
            if let Some(n) = next {
                T::links(n).as_ref().prev.set(prev);
            }
        }
    }

    /// If `slot` currently points at `node`, advance it to `node`'s successor.
    /// Call this *before* [`Self::remove`] when `node` may be the sweep cursor
    /// for an in-flight [`Sweep`] over this list (see `SocketGroup::unlink_socket`).
    #[inline]
    pub fn advance_cursor(&self, slot: &Cell<Option<NonNull<T>>>, node: NonNull<T>) {
        if slot.get() == Some(node) {
            // SAFETY: `node` is a live member of this list per the `remove` contract.
            slot.set(unsafe { T::links(node).as_ref() }.next.get());
        }
    }

    /// Begin a sweep over the list using `slot` as the externally-visible
    /// cursor. The returned iterator pre-fetches `next` into `slot` before
    /// yielding each node, so removing the *yielded* node during processing is
    /// safe. Callers whose dispatch may unlink *other* nodes can additionally
    /// rewrite `slot` from their unlink path (see `us_internal_loop_unlink_group`).
    #[inline]
    pub fn iter<'a>(&self, slot: &'a Cell<Option<NonNull<T>>>) -> Sweep<'a, T> {
        slot.set(self.head.get());
        Sweep { slot }
    }
}

impl<T: Linked> Default for IntrusiveList<T> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

/// Removal-tolerant forward iterator backed by an external cursor cell.
///
/// `next()` reads the cursor, advances it to the node's `next` link, then
/// yields the node — so `IntrusiveList::remove` on the just-yielded node
/// cannot invalidate the walk. The cursor lives outside the iterator so an
/// out-of-band unlink path can advance it too.
pub struct Sweep<'a, T: Linked> {
    slot: &'a Cell<Option<NonNull<T>>>,
}

impl<'a, T: Linked> Sweep<'a, T> {
    /// Resume a sweep at whatever `slot` currently holds (no reseed).
    #[inline]
    pub fn resume(slot: &'a Cell<Option<NonNull<T>>>) -> Self {
        Self { slot }
    }

    /// The external cursor cell — exposed so unlink paths can advance it.
    #[inline]
    pub fn slot(&self) -> &'a Cell<Option<NonNull<T>>> {
        self.slot
    }
}

impl<'a, T: Linked> Iterator for Sweep<'a, T> {
    type Item = NonNull<T>;

    #[inline]
    fn next(&mut self) -> Option<NonNull<T>> {
        let cur = self.slot.get()?;
        // SAFETY: `cur` was reached via list links from a live head; it is live for this tick.
        self.slot.set(unsafe { T::links(cur).as_ref() }.next.get());
        Some(cur)
    }
}
