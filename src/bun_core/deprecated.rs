use core::ptr;

// ──────────────────────────────────────────────────────────────────────────
// BufferedReader
// ──────────────────────────────────────────────────────────────────────────

// Plain storage for Zig's `bun.deprecated.BufferedReader(buffer_size, ReaderType)`.
// Zig's `ReaderType` duck-typing has no Rust trait equivalent here, and the only
// in-tree consumer (`pack_command::BufferedFileReader`) supplies its own read shim
// over `bun_sys::read`, so this stays a bare struct: no reader trait, no methods.
// (The dedicated stdin instance lives at `output::BufferedStdin`.)
pub struct BufferedReader<const BUFFER_SIZE: usize, R> {
    pub unbuffered_reader: R,
    pub buf: [u8; BUFFER_SIZE],
    pub start: usize,
    pub end: usize,
}

// ──────────────────────────────────────────────────────────────────────────
// SinglyLinkedList
// ──────────────────────────────────────────────────────────────────────────
//
// DEDUP(D050): the Rust port of `SinglyLinkedList` / `SinglyLinkedNode` was
// removed — the canonical implementation lives at
// `bun_collections::pool::{SinglyLinkedList, Node}`. The two had diverged
// (`data: T` vs `data: MaybeUninit<T>`, `*mut`-null vs `Option<*mut>` returns)
// and this copy had zero callers outside its own unit test. New consumers
// should depend on `bun_collections::pool` directly.

// ──────────────────────────────────────────────────────────────────────────
// DoublyLinkedList
// ──────────────────────────────────────────────────────────────────────────

/// A doubly-linked list has a pair of pointers to both the head and
/// tail of the list. List elements have pointers to both the previous
/// and next elements in the sequence. The list can be traversed both
/// forward and backward. Some operations that take linear O(n) time
/// with a singly-linked list can be done without traversal in constant
/// O(1) time with a doubly-linked list:
///
/// - Removing an element.
/// - Inserting a new element before an existing element.
/// - Pushing or popping an element from the end of the list.
pub struct DoublyLinkedList<T> {
    pub first: *mut DoublyLinkedNode<T>,
    pub last: *mut DoublyLinkedNode<T>,
    pub len: usize,
}

/// Node inside the linked list wrapping the actual data.
// In Zig this is `DoublyLinkedList(T).Node`.
pub struct DoublyLinkedNode<T> {
    pub prev: *mut DoublyLinkedNode<T>,
    pub next: *mut DoublyLinkedNode<T>,
    pub data: T,
}

impl<T> Default for DoublyLinkedList<T> {
    fn default() -> Self {
        Self {
            first: ptr::null_mut(),
            last: ptr::null_mut(),
            len: 0,
        }
    }
}

impl<T> DoublyLinkedList<T> {
    /// Insert a new node after an existing one.
    ///
    /// Arguments:
    ///     node: Pointer to a node in the list.
    ///     new_node: Pointer to the new node to insert.
    pub unsafe fn insert_after(
        &mut self,
        node: *mut DoublyLinkedNode<T>,
        new_node: *mut DoublyLinkedNode<T>,
    ) {
        // SAFETY: caller guarantees `node` is in this list and `new_node` is valid+unlinked.
        unsafe {
            (*new_node).prev = node;
            let next_node = (*node).next;
            if !next_node.is_null() {
                // Intermediate node.
                (*new_node).next = next_node;
                (*next_node).prev = new_node;
            } else {
                // Last element of the list.
                (*new_node).next = ptr::null_mut();
                self.last = new_node;
            }
            (*node).next = new_node;
        }

        self.len += 1;
    }

    /// Insert a new node before an existing one.
    ///
    /// Arguments:
    ///     node: Pointer to a node in the list.
    ///     new_node: Pointer to the new node to insert.
    pub unsafe fn insert_before(
        &mut self,
        node: *mut DoublyLinkedNode<T>,
        new_node: *mut DoublyLinkedNode<T>,
    ) {
        // SAFETY: caller guarantees `node` is in this list and `new_node` is valid+unlinked.
        unsafe {
            (*new_node).next = node;
            let prev_node = (*node).prev;
            if !prev_node.is_null() {
                // Intermediate node.
                (*new_node).prev = prev_node;
                (*prev_node).next = new_node;
            } else {
                // First element of the list.
                (*new_node).prev = ptr::null_mut();
                self.first = new_node;
            }
            (*node).prev = new_node;
        }

        self.len += 1;
    }

    /// Concatenate list2 onto the end of list1, removing all entries from the former.
    ///
    /// Arguments:
    ///     list1: the list to concatenate onto
    ///     list2: the list to be concatenated
    pub unsafe fn concat_by_moving(&mut self, list2: &mut Self) {
        let l2_first = list2.first;
        if l2_first.is_null() {
            return;
        }
        let l1_last = self.last;
        if !l1_last.is_null() {
            // SAFETY: `l1_last` and `l2_first` are non-null linked nodes.
            unsafe {
                (*l1_last).next = list2.first;
                (*l2_first).prev = self.last;
            }
            self.len += list2.len;
        } else {
            // list1 was empty
            self.first = list2.first;
            self.len = list2.len;
        }
        self.last = list2.last;
        list2.first = ptr::null_mut();
        list2.last = ptr::null_mut();
        list2.len = 0;
    }

    /// Insert a new node at the end of the list.
    ///
    /// Arguments:
    ///     new_node: Pointer to the new node to insert.
    pub unsafe fn append(&mut self, new_node: *mut DoublyLinkedNode<T>) {
        let last = self.last;
        if !last.is_null() {
            // Insert after last.
            // SAFETY: `last` is a valid node in this list.
            unsafe { self.insert_after(last, new_node) };
        } else {
            // Empty list.
            // SAFETY: forwards caller's guarantee on `new_node`.
            unsafe { self.prepend(new_node) };
        }
    }

    /// Insert a new node at the beginning of the list.
    ///
    /// Arguments:
    ///     new_node: Pointer to the new node to insert.
    pub unsafe fn prepend(&mut self, new_node: *mut DoublyLinkedNode<T>) {
        let first = self.first;
        if !first.is_null() {
            // Insert before first.
            // SAFETY: `first` is a valid node in this list.
            unsafe { self.insert_before(first, new_node) };
        } else {
            // Empty list.
            self.first = new_node;
            self.last = new_node;
            // SAFETY: caller guarantees `new_node` is valid.
            unsafe {
                (*new_node).prev = ptr::null_mut();
                (*new_node).next = ptr::null_mut();
            }

            self.len = 1;
        }
    }

    /// Remove a node from the list.
    ///
    /// Arguments:
    ///     node: Pointer to the node to be removed.
    pub unsafe fn remove(&mut self, node: *mut DoublyLinkedNode<T>) {
        // SAFETY: caller guarantees `node` is a valid node currently in this list.
        unsafe {
            let prev_node = (*node).prev;
            if !prev_node.is_null() {
                // Intermediate node.
                (*prev_node).next = (*node).next;
            } else {
                // First element of the list.
                self.first = (*node).next;
            }

            let next_node = (*node).next;
            if !next_node.is_null() {
                // Intermediate node.
                (*next_node).prev = (*node).prev;
            } else {
                // Last element of the list.
                self.last = (*node).prev;
            }
        }

        self.len -= 1;
        debug_assert!(self.len == 0 || (!self.first.is_null() && !self.last.is_null()));
    }

    /// Remove and return the last node in the list.
    ///
    /// Returns:
    ///     A pointer to the last node in the list.
    pub unsafe fn pop(&mut self) -> *mut DoublyLinkedNode<T> {
        let last = self.last;
        if last.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `last` is a valid node in this list.
        unsafe { self.remove(last) };
        last
    }

    /// Remove and return the first node in the list.
    ///
    /// Returns:
    ///     A pointer to the first node in the list.
    pub unsafe fn pop_first(&mut self) -> *mut DoublyLinkedNode<T> {
        let first = self.first;
        if first.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `first` is a valid node in this list.
        unsafe { self.remove(first) };
        first
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RapidHash
// ──────────────────────────────────────────────────────────────────────────

// Canonical impl lives in the leaf `bun_hash` crate; re-export so the
// historical `crate::deprecated::RapidHash` path keeps resolving.
pub use bun_hash::RapidHash;

// ──────────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn dnode(data: u32) -> DoublyLinkedNode<u32> {
        DoublyLinkedNode {
            prev: ptr::null_mut(),
            next: ptr::null_mut(),
            data,
        }
    }

    #[test]
    fn basic_doubly_linked_list_test() {
        // SAFETY: all nodes are stack-locals that outlive the list; intrusive-list invariants upheld by test sequencing
        unsafe {
            let mut list: DoublyLinkedList<u32> = DoublyLinkedList::default();

            let mut one = dnode(1);
            let mut two = dnode(2);
            let mut three = dnode(3);
            let mut four = dnode(4);
            let mut five = dnode(5);

            list.append(&mut two); // {2}
            list.append(&mut five); // {2, 5}
            list.prepend(&mut one); // {1, 2, 5}
            list.insert_before(&mut five, &mut four); // {1, 2, 4, 5}
            list.insert_after(&mut two, &mut three); // {1, 2, 3, 4, 5}

            // Traverse forwards.
            {
                let mut it = list.first;
                let mut index: u32 = 1;
                while !it.is_null() {
                    assert!((*it).data == index);
                    index += 1;
                    it = (*it).next;
                }
            }

            // Traverse backwards.
            {
                let mut it = list.last;
                let mut index: u32 = 1;
                while !it.is_null() {
                    assert!((*it).data == (6 - index));
                    index += 1;
                    it = (*it).prev;
                }
            }

            let _ = list.pop_first(); // {2, 3, 4, 5}
            let _ = list.pop(); // {2, 3, 4}
            list.remove(&mut three); // {2, 4}

            assert!((*list.first).data == 2);
            assert!((*list.last).data == 4);
            assert!(list.len == 2);
        }
    }

    #[test]
    fn doubly_linked_list_concatenation() {
        // SAFETY: all nodes are stack-locals that outlive the list; intrusive-list invariants upheld by test sequencing
        unsafe {
            let mut list1: DoublyLinkedList<u32> = DoublyLinkedList::default();
            let mut list2: DoublyLinkedList<u32> = DoublyLinkedList::default();

            let mut one = dnode(1);
            let mut two = dnode(2);
            let mut three = dnode(3);
            let mut four = dnode(4);
            let mut five = dnode(5);

            list1.append(&mut one);
            list1.append(&mut two);
            list2.append(&mut three);
            list2.append(&mut four);
            list2.append(&mut five);

            list1.concat_by_moving(&mut list2);

            assert!(list1.last == core::ptr::from_mut(&mut five));
            assert!(list1.len == 5);
            assert!(list2.first.is_null());
            assert!(list2.last.is_null());
            assert!(list2.len == 0);

            // Traverse forwards.
            {
                let mut it = list1.first;
                let mut index: u32 = 1;
                while !it.is_null() {
                    assert!((*it).data == index);
                    index += 1;
                    it = (*it).next;
                }
            }

            // Traverse backwards.
            {
                let mut it = list1.last;
                let mut index: u32 = 1;
                while !it.is_null() {
                    assert!((*it).data == (6 - index));
                    index += 1;
                    it = (*it).prev;
                }
            }

            // Swap them back, this verifies that concatenating to an empty list works.
            list2.concat_by_moving(&mut list1);

            // Traverse forwards.
            {
                let mut it = list2.first;
                let mut index: u32 = 1;
                while !it.is_null() {
                    assert!((*it).data == index);
                    index += 1;
                    it = (*it).next;
                }
            }

            // Traverse backwards.
            {
                let mut it = list2.last;
                let mut index: u32 = 1;
                while !it.is_null() {
                    assert!((*it).data == (6 - index));
                    index += 1;
                    it = (*it).prev;
                }
            }
        }
    }

    // RapidHash test vectors live alongside the canonical impl in `bun_hash::rapidhash`.
}

// ported from: src/bun_core/deprecated.zig
