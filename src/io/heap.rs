use core::ptr;

/// An intrusive heap implementation backed by a pairing heap[1] implementation.
///
/// Why? Intrusive data structures require the element type to hold the metadata
/// required for the structure, rather than an additional container structure.
/// There are numerous pros/cons that are documented well by Boost[2]. For Zig,
/// I think the primary benefits are making data structures allocation free
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
// PORT NOTE: Zig's `Intrusive(T, Context, less)` takes `less` as a comptime fn-pointer
// parameter. Rust cannot use fn pointers as const generics on stable, so the comparator
// is folded into a trait on `Context` (`HeapContext<T>::less`). This preserves
// monomorphization (no indirect call) at the cost of requiring the caller to impl the
// trait instead of passing a free fn.
// PERF(port): was comptime fn-pointer monomorphization — profile in Phase B.
pub struct Intrusive<T: HeapNode, Context: HeapContext<T>> {
    pub root: *mut T,
    pub context: Context,
}

/// Trait providing the ordering relation for `Intrusive`.
/// Implement this on your `Context` type (or a ZST if no context is needed).
pub trait HeapContext<T> {
    fn less(&self, a: *mut T, b: *mut T) -> bool;
}

/// Trait giving generic access to the embedded `IntrusiveField` on `T`.
/// In Zig this is duck-typed via `v.heap`; Rust needs an explicit bound.
pub trait HeapNode: Sized {
    fn heap(&mut self) -> &mut IntrusiveField<Self>;
}

impl<T: HeapNode, Context: HeapContext<T>> Default for Intrusive<T, Context>
where
    Context: Default,
{
    fn default() -> Self {
        Self { root: ptr::null_mut(), context: Context::default() }
    }
}

impl<T: HeapNode, Context: HeapContext<T>> Intrusive<T, Context> {
    /// Insert a new element v into the heap. An element v can only
    /// be a member of a single heap at any given time. When compiled
    /// with runtime-safety, assertions will help verify this property.
    pub unsafe fn insert(&mut self, v: *mut T) {
        // SAFETY: caller guarantees `v` is a valid, exclusively-owned node not
        // currently in any heap; `self.root` is either null or a valid node.
        self.root = if !self.root.is_null() {
            let root = self.root;
            self.meld(v, root)
        } else {
            v
        };
    }

    /// Look at the next minimum value but do not remove it.
    pub fn peek(&self) -> *mut T {
        self.root
    }

    /// Count the number of elements in the heap. This is an O(N) operation.
    pub unsafe fn count(&self) -> usize {
        // SAFETY: all reachable nodes from `self.root` are valid for the heap's lifetime.
        Self::count_internal(self.root)
    }

    unsafe fn count_internal(node: *mut T) -> usize {
        if node.is_null() {
            return 0;
        }
        let current = node;
        let mut result: usize = 1;

        // Count children
        // SAFETY: `current` is non-null and valid (checked above / invariant).
        result += Self::count_internal((*current).heap().child);

        // Count siblings
        result += Self::count_internal((*current).heap().next);

        result
    }

    /// Look at the next maximum value but do not remove it. This is an O(N) operation.
    pub unsafe fn find_max(&self) -> *mut T {
        if self.root.is_null() {
            return ptr::null_mut();
        }
        let root = self.root;
        // SAFETY: `root` is non-null and valid.
        Self::find_max_internal(&self.context, root, root)
    }

    unsafe fn find_max_internal(ctx: &Context, node: *mut T, current_max: *mut T) -> *mut T {
        let mut max_so_far = current_max;

        // Update max if current node is greater
        if ctx.less(max_so_far, node) {
            max_so_far = node;
        }

        // Traverse children
        // SAFETY: `node` is a valid heap node (caller invariant).
        let child = (*node).heap().child;
        if !child.is_null() {
            max_so_far = Self::find_max_internal(ctx, child, max_so_far);
        }

        // Traverse siblings
        let next_sibling = (*node).heap().next;
        if !next_sibling.is_null() {
            max_so_far = Self::find_max_internal(ctx, next_sibling, max_so_far);
        }

        max_so_far
    }

    /// Delete the minimum value from the heap and return it.
    pub unsafe fn delete_min(&mut self) -> *mut T {
        if self.root.is_null() {
            return ptr::null_mut();
        }
        let root = self.root;
        // SAFETY: `root` is non-null and valid.
        let child = (*root).heap().child;
        self.root = if !child.is_null() {
            self.combine_siblings(child)
        } else {
            ptr::null_mut()
        };

        // Clear pointers with runtime safety so we can verify on
        // insert that values aren't incorrectly being set multiple times.
        *(*root).heap() = IntrusiveField::default();

        root
    }

    /// Remove the value v from the heap.
    pub unsafe fn remove(&mut self, v: *mut T) {
        // If v doesn't have a previous value, this must be the root
        // element. If it is NOT the root element, v can't be in this
        // heap and we trigger an assertion failure.
        // SAFETY: caller guarantees `v` is a valid node currently in this heap.
        let prev = (*v).heap().prev;
        if prev.is_null() {
            debug_assert!(self.root == v);
            let _ = self.delete_min();
            return;
        }

        // Detach "v" from the tree and clean up any links so it
        // is as if this node never nexisted. The previous value
        // must point to the proper next value and the pointers
        // must all be cleaned up.
        let v_next = (*v).heap().next;
        if !v_next.is_null() {
            (*v_next).heap().prev = prev;
        }
        if (*prev).heap().child == v {
            (*prev).heap().child = v_next;
        } else {
            (*prev).heap().next = v_next;
        }
        (*v).heap().prev = ptr::null_mut();
        (*v).heap().next = ptr::null_mut();

        // If we have children, then we need to merge them back in.
        let child = (*v).heap().child;
        if child.is_null() {
            return;
        }
        (*v).heap().child = ptr::null_mut();
        let x = self.combine_siblings(child);
        // SAFETY: `self.root` is non-null here — `v` had a `prev`, so it was not the
        // root, hence the heap is non-empty.
        self.root = self.meld(x, self.root);
    }

    /// Meld (union) two heaps together. This isn't a generalized
    /// union. It assumes that a.heap.next is null so this is only
    /// meant in specific scenarios in the pairing heap where meld
    /// is expected.
    ///
    /// For example, when melding a new value "v" with an existing
    /// root "root", "v" must always be the first param.
    unsafe fn meld(&mut self, a: *mut T, b: *mut T) -> *mut T {
        // SAFETY: `a` and `b` are distinct valid nodes (caller invariant).
        debug_assert!((*a).heap().next.is_null());

        if self.context.less(a, b) {
            // B points back to A
            (*b).heap().prev = a;

            // If B has siblings, then A inherits B's siblings
            // and B's immediate sibling must point back to A to
            // maintain the doubly linked list.
            let b_next = (*b).heap().next;
            if !b_next.is_null() {
                (*a).heap().next = b_next;
                (*b_next).heap().prev = a;
                (*b).heap().next = ptr::null_mut();
            }

            // If A has a child, then B becomes the leftmost sibling
            // of that child.
            let a_child = (*a).heap().child;
            if !a_child.is_null() {
                (*b).heap().next = a_child;
                (*a_child).heap().prev = b;
            }

            // B becomes the leftmost child of A
            (*a).heap().child = b;

            return a;
        }

        // Replace A with B in the tree. Any of B's children
        // become siblings of A. A becomes the leftmost child of B.
        // A points back to B
        (*b).heap().prev = (*a).heap().prev;
        (*a).heap().prev = b;
        let b_child = (*b).heap().child;
        if !b_child.is_null() {
            (*a).heap().next = b_child;
            (*b_child).heap().prev = a;
        }
        (*b).heap().child = a;
        b
    }

    /// Combine the siblings of the leftmost value "left" into a single
    /// new rooted with the minimum value.
    unsafe fn combine_siblings(&mut self, left: *mut T) -> *mut T {
        // SAFETY: `left` is a valid non-null node (caller invariant).
        (*left).heap().prev = ptr::null_mut();

        // Merge pairs right
        let mut root: *mut T = 'root: {
            let mut a: *mut T = left;
            loop {
                let mut b = (*a).heap().next;
                if b.is_null() {
                    break 'root a;
                }
                (*a).heap().next = ptr::null_mut();
                b = self.meld(a, b);
                let next_a = (*b).heap().next;
                if next_a.is_null() {
                    break 'root b;
                }
                a = next_a;
            }
        };

        // Merge pairs left
        loop {
            let b = (*root).heap().prev;
            if b.is_null() {
                return root;
            }
            (*b).heap().next = ptr::null_mut();
            root = self.meld(b, root);
        }
    }
}

/// The state that is required for IntrusiveHeap element types. This
/// should be set as the "heap" field in the type T.
pub struct IntrusiveField<T> {
    pub child: *mut T,
    pub prev: *mut T,
    pub next: *mut T,
}

impl<T> Default for IntrusiveField<T> {
    fn default() -> Self {
        Self {
            child: ptr::null_mut(),
            prev: ptr::null_mut(),
            next: ptr::null_mut(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/heap.zig (220 lines)
//   confidence: medium
//   todos:      0
//   notes:      comptime `less` fn-ptr folded into HeapContext<T> trait; duck-typed `.heap` field access expressed via HeapNode trait; all node links kept as raw *mut T per INTRUSIVE classification — public methods are `unsafe fn`.
// ──────────────────────────────────────────────────────────────────────────
