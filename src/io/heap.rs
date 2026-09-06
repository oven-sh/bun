use core::cell::Cell;
use core::ptr;

/// An intrusive heap implementation backed by a pairing heap[1] implementation.
///
/// Why? Intrusive data structures require the element type to hold the metadata
/// required for the structure, rather than an additional container structure.
/// There are numerous pros/cons that are documented well by Boost[2]. Here
/// the primary benefits are making data structures allocation free
/// (rather, shifting allocation up to the consumer which can choose how they
/// want the memory to be available). There are various costs to this such as
/// the costs of pointer chasing, larger memory overhead, requiring the element
/// type to be aware of its container, etc. But for certain use cases an intrusive
/// data structure can yield much better performance.
///
/// Usage notes:
/// - The element T is expected to have a field "heap" of type IntrusiveField.
///   See the tests for a full example of how to set this.
/// - You can easily make this a min or max heap by inverting the result of
///   "less" below.
///
/// Invariant: every node reachable from `root` was handed to [`insert`] and has
/// not been returned by [`delete_min`] / passed to [`remove`] since, so by
/// `insert`'s contract it is live. All node access goes through `&T` and the
/// `Cell` links, so the heap never forms a `&mut T`.
///
/// [1]: https://en.wikipedia.org/wiki/Pairing_heap
/// [2]: https://www.boost.org/doc/libs/1_64_0/doc/html/intrusive/intrusive_vs_nontrusive.html
///
/// [`insert`]: Intrusive::insert
/// [`delete_min`]: Intrusive::delete_min
/// [`remove`]: Intrusive::remove
//
// The comparator is a trait on `Context` (`HeapContext<T>::less`) rather than
// a fn-pointer parameter (fn pointers can't be const generics on stable).
// This preserves monomorphization (no indirect call) at the cost of requiring
// the caller to impl the trait instead of passing a free fn.
pub struct Intrusive<T: HeapNode, Context: HeapContext<T>> {
    root: Cell<*mut T>,
    pub context: Context,
}

/// Trait providing the ordering relation for `Intrusive`.
/// Implement this on your `Context` type (or a ZST if no context is needed).
pub trait HeapContext<T> {
    fn less(&self, a: &T, b: &T) -> bool;
}

/// Trait giving generic access to the embedded `IntrusiveField` on `T`.
pub trait HeapNode: Sized {
    fn heap(&self) -> &IntrusiveField<Self>;
}

impl<T: HeapNode, Context: HeapContext<T>> Default for Intrusive<T, Context>
where
    Context: Default,
{
    fn default() -> Self {
        Self {
            root: Cell::new(ptr::null_mut()),
            context: Context::default(),
        }
    }
}

impl<T: HeapNode, Context: HeapContext<T>> Intrusive<T, Context> {
    /// Borrow a linked node.
    ///
    /// # Safety
    /// `n` is non-null and linked into this heap (struct invariant ⇒ live).
    #[inline]
    unsafe fn node<'a>(n: *mut T) -> &'a T {
        // SAFETY: caller contract.
        unsafe { &*n }
    }

    /// Insert a new element v into the heap. An element v can only
    /// be a member of a single heap at any given time. When compiled
    /// with runtime-safety, assertions will help verify this property.
    ///
    /// # Safety
    /// `v` points at a live `T` that is not linked into any heap, and it stays
    /// live at that address until it leaves this heap again (via
    /// [`delete_min`](Self::delete_min) or [`remove`](Self::remove)).
    pub unsafe fn insert(&self, v: *mut T) {
        // SAFETY: `v` is live per fn contract.
        debug_assert!(!unsafe { Self::node(v) }.heap().is_linked() && !self.is_root(v));
        let root = self.root.get();
        self.root.set(if !root.is_null() {
            // SAFETY: `v` per fn contract; `root` per struct invariant.
            unsafe { self.meld(v, root) }
        } else {
            v
        });
    }

    /// Look at the next minimum value but do not remove it.
    pub fn peek(&self) -> *mut T {
        self.root.get()
    }

    /// `true` if `v` is the root of this heap.
    pub fn is_root(&self, v: *const T) -> bool {
        ptr::eq(self.root.get(), v)
    }

    /// Count the number of elements in the heap. This is an O(N) operation.
    pub fn count(&self) -> usize {
        let mut n = 0;
        self.for_each(|_| n += 1);
        n
    }

    /// Visit every linked node (in no particular order). `f` must not link or
    /// unlink nodes of this heap.
    pub fn for_each(&self, mut f: impl FnMut(*mut T)) {
        let root = self.root.get();
        if root.is_null() {
            return;
        }
        let mut stack: Vec<*mut T> = vec![root];
        while let Some(node) = stack.pop() {
            // SAFETY: struct invariant — reachable nodes are live.
            let links = unsafe { Self::node(node) }.heap();
            let (child, next) = (links.child.get(), links.next.get());
            if !child.is_null() {
                stack.push(child);
            }
            if !next.is_null() {
                stack.push(next);
            }
            f(node);
        }
    }

    /// Look at the next maximum value but do not remove it. This is an O(N) operation.
    pub fn find_max(&self) -> *mut T {
        let mut max = self.root.get();
        self.for_each(|node| {
            // SAFETY: struct invariant — both are linked, live nodes.
            let (a, b) = unsafe { (Self::node(max), Self::node(node)) };
            if self.context.less(a, b) {
                max = node;
            }
        });
        max
    }

    /// Delete the minimum value from the heap and return it.
    pub fn delete_min(&self) -> *mut T {
        let root = self.root.get();
        if root.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: struct invariant — `root` is a linked, live node.
        let root_links = unsafe { Self::node(root) }.heap();
        let child = root_links.child.get();
        self.root.set(if !child.is_null() {
            // SAFETY: `child` is linked (reachable from root).
            unsafe { self.combine_siblings(child) }
        } else {
            ptr::null_mut()
        });

        // Clear pointers with runtime safety so we can verify on
        // insert that values aren't incorrectly being set multiple times.
        root_links.clear();

        root
    }

    /// Remove the value v from the heap.
    ///
    /// # Safety
    /// `v` points at a live `T` currently linked into this heap.
    pub unsafe fn remove(&self, v: *mut T) {
        // If v doesn't have a previous value, this must be the root
        // element. If it is NOT the root element, v can't be in this
        // heap and we trigger an assertion failure.
        // SAFETY: fn contract.
        let v_links = unsafe { Self::node(v) }.heap();
        let prev = v_links.prev.get();
        if prev.is_null() {
            debug_assert!(self.is_root(v));
            let _ = self.delete_min();
            return;
        }

        // Detach "v" from the tree and clean up any links so it
        // is as if this node never nexisted. The previous value
        // must point to the proper next value and the pointers
        // must all be cleaned up.
        let v_next = v_links.next.get();
        if !v_next.is_null() {
            // SAFETY: linked from `v`, hence in this heap.
            unsafe { Self::node(v_next) }.heap().prev.set(prev);
        }
        // SAFETY: linked from `v`, hence in this heap.
        let prev_links = unsafe { Self::node(prev) }.heap();
        if ptr::eq(prev_links.child.get(), v) {
            prev_links.child.set(v_next);
        } else {
            prev_links.next.set(v_next);
        }
        v_links.prev.set(ptr::null_mut());
        v_links.next.set(ptr::null_mut());

        // If we have children, then we need to merge them back in.
        let child = v_links.child.get();
        if child.is_null() {
            return;
        }
        v_links.child.set(ptr::null_mut());
        // SAFETY: `child` was linked under `v`; `self.root` is non-null here —
        // `v` had a `prev`, so it was not the root, hence the heap is non-empty.
        unsafe {
            let x = self.combine_siblings(child);
            self.root.set(self.meld(x, self.root.get()));
        }
    }

    /// Meld (union) two heaps together. This isn't a generalized
    /// union. It assumes that a.heap.next is null so this is only
    /// meant in specific scenarios in the pairing heap where meld
    /// is expected.
    ///
    /// For example, when melding a new value "v" with an existing
    /// root "root", "v" must always be the first param.
    ///
    /// # Safety
    /// `a` and `b` are distinct, live nodes (linked, or being linked by `insert`).
    unsafe fn meld(&self, a: *mut T, b: *mut T) -> *mut T {
        // SAFETY: fn contract.
        let (a_ref, b_ref) = unsafe { (Self::node(a), Self::node(b)) };
        let (al, bl) = (a_ref.heap(), b_ref.heap());
        debug_assert!(al.next.get().is_null());

        if self.context.less(a_ref, b_ref) {
            // B points back to A
            bl.prev.set(a);

            // If B has siblings, then A inherits B's siblings
            // and B's immediate sibling must point back to A to
            // maintain the doubly linked list.
            let b_next = bl.next.get();
            if !b_next.is_null() {
                al.next.set(b_next);
                // SAFETY: linked from `b`.
                unsafe { Self::node(b_next) }.heap().prev.set(a);
                bl.next.set(ptr::null_mut());
            }

            // If A has a child, then B becomes the leftmost sibling
            // of that child.
            let a_child = al.child.get();
            if !a_child.is_null() {
                bl.next.set(a_child);
                // SAFETY: linked from `a`.
                unsafe { Self::node(a_child) }.heap().prev.set(b);
            }

            // B becomes the leftmost child of A
            al.child.set(b);

            return a;
        }

        // Replace A with B in the tree. Any of B's children
        // become siblings of A. A becomes the leftmost child of B.
        // A points back to B
        bl.prev.set(al.prev.get());
        al.prev.set(b);
        let b_child = bl.child.get();
        if !b_child.is_null() {
            al.next.set(b_child);
            // SAFETY: linked from `b`.
            unsafe { Self::node(b_child) }.heap().prev.set(a);
        }
        bl.child.set(a);
        b
    }

    /// Combine the siblings of the leftmost value "left" into a single
    /// new rooted with the minimum value.
    ///
    /// # Safety
    /// `left` is a non-null node linked into this heap.
    unsafe fn combine_siblings(&self, left: *mut T) -> *mut T {
        // SAFETY: (whole body) every pointer followed is a link of a node
        // reachable from `left`, hence linked and live (struct invariant).
        unsafe {
            Self::node(left).heap().prev.set(ptr::null_mut());

            // Merge pairs right
            let mut root: *mut T = 'root: {
                let mut a: *mut T = left;
                loop {
                    let mut b = Self::node(a).heap().next.get();
                    if b.is_null() {
                        break 'root a;
                    }
                    Self::node(a).heap().next.set(ptr::null_mut());
                    b = self.meld(a, b);
                    let next_a = Self::node(b).heap().next.get();
                    if next_a.is_null() {
                        break 'root b;
                    }
                    a = next_a;
                }
            };

            // Merge pairs left
            loop {
                let b = Self::node(root).heap().prev.get();
                if b.is_null() {
                    return root;
                }
                Self::node(b).heap().next.set(ptr::null_mut());
                root = self.meld(b, root);
            }
        }
    }
}

/// The state that is required for IntrusiveHeap element types. This
/// should be set as the "heap" field in the type T.
/// The links are private: only [`Intrusive`] writes them, which is what lets its
/// safe methods trust them.
pub struct IntrusiveField<T> {
    child: Cell<*mut T>,
    prev: Cell<*mut T>,
    next: Cell<*mut T>,
}

impl<T> IntrusiveField<T> {
    /// `true` while any link is set. A lone root has no links, so callers that
    /// need "is in heap H" must also ask [`Intrusive::is_root`].
    #[inline]
    pub fn is_linked(&self) -> bool {
        !self.child.get().is_null() || !self.prev.get().is_null() || !self.next.get().is_null()
    }

    #[inline]
    fn clear(&self) {
        self.child.set(ptr::null_mut());
        self.prev.set(ptr::null_mut());
        self.next.set(ptr::null_mut());
    }
}

impl<T> Default for IntrusiveField<T> {
    fn default() -> Self {
        Self {
            child: Cell::new(ptr::null_mut()),
            prev: Cell::new(ptr::null_mut()),
            next: Cell::new(ptr::null_mut()),
        }
    }
}
