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
/// [1]: https://en.wikipedia.org/wiki/Pairing_heap
/// [2]: https://www.boost.org/doc/libs/1_64_0/doc/html/intrusive/intrusive_vs_nontrusive.html
//
// The comparator is a trait on `Context` (`HeapContext<T>::less`) rather than
// a fn-pointer parameter (fn pointers can't be const generics on stable).
// This preserves monomorphization (no indirect call) at the cost of requiring
// the caller to impl the trait instead of passing a free fn.
pub struct Intrusive<T: HeapNode, Context: HeapContext<T>> {
    root: Cell<*mut T>,
    context: Context,
}

/// Trait providing the ordering relation for `Intrusive`.
/// Implement this on your `Context` type (or a ZST if no context is needed).
pub trait HeapContext<T> {
    /// # Safety
    /// `a` and `b` must be non-null, aligned, and point to live nodes currently
    /// owned by the intrusive heap. Only called from `Intrusive` internals.
    unsafe fn less(&self, a: *mut T, b: *mut T) -> bool;
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
    /// Insert a new element v into the heap. An element v can only
    /// be a member of a single heap at any given time. When compiled
    /// with runtime-safety, assertions will help verify this property.
    pub unsafe fn insert(&self, v: *mut T) {
        // SAFETY: caller guarantees `v` is a valid node not
        // currently in any heap; `self.root` is either null or a valid node.
        let root = self.root.get();
        self.root.set(if !root.is_null() {
            self.meld(v, root)
        } else {
            v
        });
    }

    /// Look at the next minimum value but do not remove it.
    pub fn peek(&self) -> *mut T {
        self.root.get()
    }

    /// Count the number of elements in the heap. This is an O(N) operation.
    pub unsafe fn count(&self) -> usize {
        let mut result: usize = 0;
        // SAFETY: all reachable nodes from `self.root` are valid for the heap's lifetime.
        self.for_each(|_| result += 1);
        result
    }

    /// Look at the next maximum value but do not remove it. This is an O(N) operation.
    pub unsafe fn find_max(&self) -> *mut T {
        let mut max_so_far = self.root.get();
        // SAFETY: all reachable nodes from `self.root` are valid for the heap's lifetime.
        self.for_each(|node| {
            if self.context.less(max_so_far, node) {
                max_so_far = node;
            }
        });
        max_so_far
    }

    /// Visits every node depth-first without recursion. A heap can degenerate
    /// into a single chain, so recursing could overflow the stack.
    ///
    /// # Safety
    /// All nodes reachable from `self.root` must be valid.
    unsafe fn for_each(&self, mut f: impl FnMut(*mut T)) {
        let mut node = self.root.get();
        if node.is_null() {
            return;
        }
        'walk: loop {
            f(node);

            // SAFETY: `node` is non-null and valid (invariant).
            let child = (*node).heap().child.get();
            if !child.is_null() {
                node = child;
                continue;
            }

            loop {
                let next = (*node).heap().next.get();
                if !next.is_null() {
                    node = next;
                    continue 'walk;
                }

                // `prev` is the left sibling, or the parent for the leftmost child.
                // Climb to the parent and try its `next`.
                let mut prev = (*node).heap().prev.get();
                while !prev.is_null() && (*prev).heap().child.get() != node {
                    node = prev;
                    prev = (*node).heap().prev.get();
                }
                if prev.is_null() {
                    return;
                }
                node = prev;
            }
        }
    }

    /// Delete the minimum value from the heap and return it.
    pub unsafe fn delete_min(&self) -> *mut T {
        let root = self.root.get();
        if root.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `root` is non-null and valid.
        let child = (*root).heap().child.get();
        self.root.set(if !child.is_null() {
            self.combine_siblings(child)
        } else {
            ptr::null_mut()
        });

        // Clear pointers with runtime safety so we can verify on
        // insert that values aren't incorrectly being set multiple times.
        (*root).heap().clear();

        root
    }

    /// Remove the value v from the heap.
    pub unsafe fn remove(&self, v: *mut T) {
        // If v doesn't have a previous value, this must be the root
        // element. If it is NOT the root element, v can't be in this
        // heap and we trigger an assertion failure.
        // SAFETY: caller guarantees `v` is a valid node currently in this heap.
        let prev = (*v).heap().prev.get();
        if prev.is_null() {
            debug_assert!(self.root.get() == v);
            let _ = self.delete_min();
            return;
        }

        // Detach "v" from the tree and clean up any links so it
        // is as if this node never nexisted. The previous value
        // must point to the proper next value and the pointers
        // must all be cleaned up.
        let v_next = (*v).heap().next.get();
        if !v_next.is_null() {
            (*v_next).heap().prev.set(prev);
        }
        if (*prev).heap().child.get() == v {
            (*prev).heap().child.set(v_next);
        } else {
            (*prev).heap().next.set(v_next);
        }
        (*v).heap().prev.set(ptr::null_mut());
        (*v).heap().next.set(ptr::null_mut());

        // If we have children, then we need to merge them back in.
        let child = (*v).heap().child.get();
        if child.is_null() {
            return;
        }
        (*v).heap().child.set(ptr::null_mut());
        let x = self.combine_siblings(child);
        // SAFETY: `self.root` is non-null here — `v` had a `prev`, so it was not the
        // root, hence the heap is non-empty.
        self.root.set(self.meld(x, self.root.get()));
    }

    /// Meld (union) two heaps together. This isn't a generalized
    /// union. It assumes that a.heap.next is null so this is only
    /// meant in specific scenarios in the pairing heap where meld
    /// is expected.
    ///
    /// For example, when melding a new value "v" with an existing
    /// root "root", "v" must always be the first param.
    unsafe fn meld(&self, a: *mut T, b: *mut T) -> *mut T {
        // SAFETY: `a` and `b` are distinct valid nodes (caller invariant).
        debug_assert!((*a).heap().next.get().is_null());

        if self.context.less(a, b) {
            // B points back to A
            (*b).heap().prev.set(a);

            // If B has siblings, then A inherits B's siblings
            // and B's immediate sibling must point back to A to
            // maintain the doubly linked list.
            let b_next = (*b).heap().next.get();
            if !b_next.is_null() {
                (*a).heap().next.set(b_next);
                (*b_next).heap().prev.set(a);
                (*b).heap().next.set(ptr::null_mut());
            }

            // If A has a child, then B becomes the leftmost sibling
            // of that child.
            let a_child = (*a).heap().child.get();
            if !a_child.is_null() {
                (*b).heap().next.set(a_child);
                (*a_child).heap().prev.set(b);
            }

            // B becomes the leftmost child of A
            (*a).heap().child.set(b);

            return a;
        }

        // Replace A with B in the tree. Any of B's children
        // become siblings of A. A becomes the leftmost child of B.
        // A points back to B
        (*b).heap().prev.set((*a).heap().prev.get());
        (*a).heap().prev.set(b);
        let b_child = (*b).heap().child.get();
        if !b_child.is_null() {
            (*a).heap().next.set(b_child);
            (*b_child).heap().prev.set(a);
        }
        (*b).heap().child.set(a);
        b
    }

    /// Combine the siblings of the leftmost value "left" into a single
    /// new rooted with the minimum value.
    unsafe fn combine_siblings(&self, left: *mut T) -> *mut T {
        // SAFETY: `left` is a valid non-null node (caller invariant).
        (*left).heap().prev.set(ptr::null_mut());

        // Merge pairs right
        let mut root: *mut T = 'root: {
            let mut a: *mut T = left;
            loop {
                let mut b = (*a).heap().next.get();
                if b.is_null() {
                    break 'root a;
                }
                (*a).heap().next.set(ptr::null_mut());
                b = self.meld(a, b);
                let next_a = (*b).heap().next.get();
                if next_a.is_null() {
                    break 'root b;
                }
                a = next_a;
            }
        };

        // Merge pairs left
        loop {
            let b = (*root).heap().prev.get();
            if b.is_null() {
                return root;
            }
            (*b).heap().next.set(ptr::null_mut());
            root = self.meld(b, root);
        }
    }
}

/// The state that is required for IntrusiveHeap element types. This
/// should be set as the "heap" field in the type T.
pub struct IntrusiveField<T> {
    child: Cell<*mut T>,
    prev: Cell<*mut T>,
    next: Cell<*mut T>,
}

impl<T> IntrusiveField<T> {
    pub fn child(&self) -> *mut T {
        self.child.get()
    }

    pub fn next(&self) -> *mut T {
        self.next.get()
    }

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
