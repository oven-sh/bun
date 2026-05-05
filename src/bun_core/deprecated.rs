use core::ptr;



// ──────────────────────────────────────────────────────────────────────────
// BufferedReader
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): Zig's `ReaderType` only needs `.read(&mut [u8]) -> Result<usize, Self::Error>`
// and an associated `Error` type. There is no `bun_io::Read` trait yet; Phase B should
// introduce one (or reuse whatever the `std.Io.GenericReader` port lands as) and bound `R` on it.
pub struct BufferedReader<const BUFFER_SIZE: usize, R> {
    pub unbuffered_reader: R,
    pub buf: [u8; BUFFER_SIZE],
    pub start: usize,
    pub end: usize,
}

impl<const BUFFER_SIZE: usize, R> BufferedReader<BUFFER_SIZE, R>
where
    // TODO(port): replace with the real reader trait once it exists.
    R: DeprecatedRead,
{
    pub type Error = R::Error;
    // TODO(port): `pub const Reader = std.Io.GenericReader(*Self, Error, read);` —
    // depends on the Rust port of `std.Io.GenericReader`. Left unported; `reader()`
    // below is stubbed accordingly.

    pub fn read(&mut self, dest: &mut [u8]) -> Result<usize, R::Error> {
        // First try reading from the already buffered data onto the destination.
        let current = &self.buf[self.start..self.end];
        if !current.is_empty() {
            let to_transfer = current.len().min(dest.len());
            dest[0..to_transfer].copy_from_slice(&current[0..to_transfer]);
            self.start += to_transfer;
            return Ok(to_transfer);
        }

        // If dest is large, read from the unbuffered reader directly into the destination.
        if dest.len() >= BUFFER_SIZE {
            return self.unbuffered_reader.read(dest);
        }

        // If dest is small, read from the unbuffered reader into our own internal buffer,
        // and then transfer to destination.
        self.end = self.unbuffered_reader.read(&mut self.buf)?;
        let to_transfer = self.end.min(dest.len());
        dest[0..to_transfer].copy_from_slice(&self.buf[0..to_transfer]);
        self.start = to_transfer;
        Ok(to_transfer)
    }

    pub fn reader(&mut self) -> &mut Self {
        // TODO(port): Zig returned a `std.Io.GenericReader` adapter wrapping `self`.
        // Until the generic-reader port exists, hand back `&mut Self` (which already
        // exposes `read`). Phase B: wire to the real adapter type.
        self
    }
}

// TODO(port): placeholder trait standing in for `ReaderType` duck-typing. Remove once
// the shared reader trait exists and bound `R` on that instead.
pub trait DeprecatedRead {
    type Error;
    fn read(&mut self, dest: &mut [u8]) -> Result<usize, Self::Error>;
}

pub fn buffered_reader<R: DeprecatedRead>(reader: R) -> BufferedReader<4096, R> {
    BufferedReader {
        unbuffered_reader: reader,
        // PERF(port): Zig left `buf` undefined; zero-init here is an extra 4 KiB memset.
        buf: [0u8; 4096],
        start: 0,
        end: 0,
    }
}

pub fn buffered_reader_size<const SIZE: usize, R: DeprecatedRead>(
    reader: R,
) -> BufferedReader<SIZE, R> {
    BufferedReader {
        unbuffered_reader: reader,
        // PERF(port): Zig left `buf` undefined; zero-init here is an extra memset.
        buf: [0u8; SIZE],
        start: 0,
        end: 0,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SinglyLinkedList
// ──────────────────────────────────────────────────────────────────────────

/// A singly-linked list is headed by a single forward pointer. The elements
/// are singly-linked for minimum space and pointer manipulation overhead at
/// the expense of O(n) removal for arbitrary elements. New elements can be
/// added to the list after an existing element or at the head of the list.
/// A singly-linked list may only be traversed in the forward direction.
/// Singly-linked lists are ideal for applications with large datasets and
/// few or no removals or for implementing a LIFO queue.
pub struct SinglyLinkedList<T> {
    pub first: *mut SinglyLinkedNode<T>,
}

/// Node inside the linked list wrapping the actual data.
// In Zig this is `SinglyLinkedList(T).Node`; Rust has no inherent nested struct
// capturing the outer generic, so it lives alongside the list type.
pub struct SinglyLinkedNode<T> {
    pub next: *mut SinglyLinkedNode<T>,
    pub data: T,
}

impl<T> SinglyLinkedNode<T> {
    pub type Data = T;
    // TODO(port): inherent associated types are unstable; Phase B may need to
    // expose `Data` differently (or drop it — Zig only used it for reflection).

    /// Insert a new node after the current one.
    ///
    /// Arguments:
    ///     new_node: Pointer to the new node to insert.
    pub unsafe fn insert_after(&mut self, new_node: *mut SinglyLinkedNode<T>) {
        // SAFETY: caller guarantees `new_node` is a valid, exclusively-accessed node
        // not already linked elsewhere (intrusive list invariant from Zig).
        unsafe {
            (*new_node).next = self.next;
        }
        self.next = new_node;
    }

    /// Remove a node from the list.
    ///
    /// Arguments:
    ///     node: Pointer to the node to be removed.
    /// Returns:
    ///     node removed
    pub unsafe fn remove_next(&mut self) -> *mut SinglyLinkedNode<T> {
        let next_node = self.next;
        if next_node.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `next_node` is non-null and was linked by us; intrusive invariant
        // guarantees it points at a live node.
        self.next = unsafe { (*next_node).next };
        next_node
    }

    /// Iterate over the singly-linked list from this node, until the final node is found.
    /// This operation is O(N).
    pub unsafe fn find_last(&mut self) -> *mut SinglyLinkedNode<T> {
        let mut it: *mut SinglyLinkedNode<T> = self;
        loop {
            // SAFETY: `it` starts at `self` and only advances along `.next` links
            // populated by this list; null terminates.
            let next = unsafe { (*it).next };
            if next.is_null() {
                return it;
            }
            it = next;
        }
    }

    /// Iterate over each next node, returning the count of all nodes except the starting one.
    /// This operation is O(N).
    pub unsafe fn count_children(&self) -> usize {
        let mut count: usize = 0;
        let mut it: *const SinglyLinkedNode<T> = self.next;
        while !it.is_null() {
            count += 1;
            // SAFETY: `it` is non-null and reached via list links.
            it = unsafe { (*it).next };
        }
        count
    }

    /// Reverse the list starting from this node in-place.
    /// This operation is O(N).
    pub unsafe fn reverse(indirect: &mut *mut SinglyLinkedNode<T>) {
        if indirect.is_null() {
            return;
        }
        let mut current: *mut SinglyLinkedNode<T> = *indirect;
        // SAFETY: `current` is non-null (checked above) and every `next` we follow was
        // linked by this list.
        unsafe {
            while !(*current).next.is_null() {
                let next = (*current).next;
                (*current).next = (*next).next;
                (*next).next = *indirect;
                *indirect = next;
            }
        }
    }
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
    pub unsafe fn prepend(&mut self, new_node: *mut SinglyLinkedNode<T>) {
        // SAFETY: caller guarantees `new_node` is valid and unlinked.
        unsafe {
            (*new_node).next = self.first;
        }
        self.first = new_node;
    }

    /// Remove a node from the list.
    ///
    /// Arguments:
    ///     node: Pointer to the node to be removed.
    pub unsafe fn remove(&mut self, node: *mut SinglyLinkedNode<T>) {
        if self.first == node {
            // SAFETY: `node` equals `first`, which is a valid linked node.
            self.first = unsafe { (*node).next };
        } else {
            // SAFETY: caller guarantees `node` is in this list, so `first` is non-null
            // and the chain reaches `node` before null.
            let mut current_elm = self.first;
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
    pub unsafe fn pop_first(&mut self) -> *mut SinglyLinkedNode<T> {
        let first = self.first;
        if first.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `first` is non-null and a valid linked node.
        self.first = unsafe { (*first).next };
        first
    }

    /// Iterate over all nodes, returning the count.
    /// This operation is O(N).
    pub unsafe fn len(&self) -> usize {
        if !self.first.is_null() {
            // SAFETY: `first` is non-null and a valid linked node.
            1 + unsafe { (*self.first).count_children() }
        } else {
            0
        }
    }
}

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

pub struct RapidHash;

impl RapidHash {
    pub const RAPID_SEED: u64 = 0xbdd89aa982704029;
    const RAPID_SECRET: [u64; 3] = [0x2d358dccaa6c78a5, 0x8bb84b93962eacc9, 0x4b33a62ed433d4a3];

    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        let sc = Self::RAPID_SECRET;
        let len = input.len();
        let mut a: u64 = 0;
        let mut b: u64 = 0;
        let mut k = input;
        let mut is: [u64; 3] = [seed, 0, 0];

        is[0] ^= Self::mix(seed ^ sc[0], sc[1]) ^ (len as u64);

        if len <= 16 {
            if len >= 4 {
                let d: usize = (len & 24) >> (len >> 3);
                let e = len - 4;
                a = (Self::r32(k) << 32) | Self::r32(&k[e..]);
                b = (Self::r32(&k[d..]) << 32) | Self::r32(&k[(e - d)..]);
            } else if len > 0 {
                a = ((k[0] as u64) << 56) | ((k[len >> 1] as u64) << 32) | (k[len - 1] as u64);
            }
        } else {
            let mut remain = len;
            if len > 48 {
                is[1] = is[0];
                is[2] = is[0];
                while remain >= 96 {
                    // PERF(port): was `inline for (0..6)` — profile in Phase B
                    for i in 0..6usize {
                        let m1 = Self::r64(&k[8 * i * 2..]);
                        let m2 = Self::r64(&k[8 * (i * 2 + 1)..]);
                        is[i % 3] = Self::mix(m1 ^ sc[i % 3], m2 ^ is[i % 3]);
                    }
                    k = &k[96..];
                    remain -= 96;
                }
                if remain >= 48 {
                    // PERF(port): was `inline for (0..3)` — profile in Phase B
                    for i in 0..3usize {
                        let m1 = Self::r64(&k[8 * i * 2..]);
                        let m2 = Self::r64(&k[8 * (i * 2 + 1)..]);
                        is[i] = Self::mix(m1 ^ sc[i], m2 ^ is[i]);
                    }
                    k = &k[48..];
                    remain -= 48;
                }

                is[0] ^= is[1] ^ is[2];
            }

            if remain > 16 {
                is[0] = Self::mix(Self::r64(k) ^ sc[2], Self::r64(&k[8..]) ^ is[0] ^ sc[1]);
                if remain > 32 {
                    is[0] = Self::mix(Self::r64(&k[16..]) ^ sc[2], Self::r64(&k[24..]) ^ is[0]);
                }
            }

            a = Self::r64(&input[len - 16..]);
            b = Self::r64(&input[len - 8..]);
        }

        a ^= sc[1];
        b ^= is[0];
        Self::mum(&mut a, &mut b);
        Self::mix(a ^ sc[0] ^ (len as u64), b ^ sc[1])
    }

    #[inline]
    fn mum(a: &mut u64, b: &mut u64) {
        let r = (*a as u128) * (*b as u128);
        *a = r as u64;
        *b = (r >> 64) as u64;
    }

    #[inline]
    fn mix(a: u64, b: u64) -> u64 {
        let mut copy_a = a;
        let mut copy_b = b;
        Self::mum(&mut copy_a, &mut copy_b);
        copy_a ^ copy_b
    }

    #[inline]
    fn r64(p: &[u8]) -> u64 {
        u64::from_le_bytes(p[0..8].try_into().expect("unreachable"))
    }

    #[inline]
    fn r32(p: &[u8]) -> u64 {
        u32::from_le_bytes(p[0..4].try_into().expect("unreachable")) as u64
    }
}

// ──────────────────────────────────────────────────────────────────────────
// misc
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): `std.Io.Writer.Error` has no Rust port yet. Using `bun_core::Error`
// (interned tag) so callers can compare against `err!("WriteFailed")`. Revisit once
// the writer error type lands.
pub fn js_error_to_write_error(e: JsError) -> bun_core::Error {
    match e {
        // TODO: this might lose a JSTerminated, causing m_terminationException problems
        JsError::Terminated => bun_core::err!("WriteFailed"),
        // TODO: this might lose a JSError, causing exception check problems
        JsError::Thrown => bun_core::err!("WriteFailed"),
        // `bun.handleOom(error.OutOfMemory)` — panic-on-OOM wrapper fed a literal OOM,
        // i.e. unconditionally abort.
        JsError::OutOfMemory => bun_alloc::abort_on_oom(),
        // TODO(port): Zig `bun.JSError` has exactly {JSTerminated, JSError, OutOfMemory};
        // `bun_jsc::JsError` is {Thrown, OutOfMemory, Terminated}. Mapping is 1:1 above.
    }
}

// TODO(port): comptime reflection — Zig picks "{f}" if `ty` has a `format` method,
// otherwise `fallback`. Rust has no `@hasDecl`; the equivalent is "does `T: Display`?".
// Format specifiers also differ (Rust uses "{}" for both). Callers should be migrated
// to use `Display` directly; until then this returns the fallback unconditionally.
pub const fn auto_format_label_fallback<T>(fallback: &'static str) -> &'static str {
    // TODO(port): `std.meta.hasFn(ty, "format")` reflection — see note above.
    let _ = core::marker::PhantomData::<T>;
    fallback
}

pub const fn auto_format_label<T>() -> &'static str {
    auto_format_label_fallback::<T>("{s}")
}

// ──────────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn snode(data: u32) -> SinglyLinkedNode<u32> {
        SinglyLinkedNode { next: ptr::null_mut(), data }
    }

    fn dnode(data: u32) -> DoublyLinkedNode<u32> {
        DoublyLinkedNode { prev: ptr::null_mut(), next: ptr::null_mut(), data }
    }

    #[test]
    fn basic_singly_linked_list_test() {
        // SAFETY: all nodes are stack-locals that outlive the list; intrusive-list invariants upheld by test sequencing
        unsafe {
            let mut list: SinglyLinkedList<u32> = SinglyLinkedList::default();

            assert!(list.len() == 0);

            let mut one = snode(1);
            let mut two = snode(2);
            let mut three = snode(3);
            let mut four = snode(4);
            let mut five = snode(5);

            list.prepend(&mut two); // {2}
            two.insert_after(&mut five); // {2, 5}
            list.prepend(&mut one); // {1, 2, 5}
            two.insert_after(&mut three); // {1, 2, 3, 5}
            three.insert_after(&mut four); // {1, 2, 3, 4, 5}

            assert!(list.len() == 5);

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

            let _ = list.pop_first(); // {2, 3, 4, 5}
            list.remove(&mut five); // {2, 3, 4}
            let _ = two.remove_next(); // {2, 4}

            assert!((*list.first).data == 2);
            assert!((*(*list.first).next).data == 4);
            assert!((*(*list.first).next).next.is_null());

            SinglyLinkedNode::reverse(&mut list.first);

            assert!((*list.first).data == 4);
            assert!((*(*list.first).next).data == 2);
            assert!((*(*list.first).next).next.is_null());
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

            assert!(list1.last == &mut five as *mut _);
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

    #[test]
    fn rapid_hash_hash() {
        const BYTES: &[u8] = b"abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh\
abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh";
        // "abcdefgh" ** 128 == 1024 bytes
        debug_assert_eq!(BYTES.len(), 1024);

        let sizes: [u64; 13] = [0, 1, 2, 3, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

        let outcomes: [u64; 13] = [
            0x5a6ef77074ebc84b,
            0xc11328477bc0f5d1,
            0x5644ac035e40d569,
            0x347080fbf5fcd81,
            0x56b66b8dc802bcc,
            0xb6bf9055973aac7c,
            0xed56d62eead1e402,
            0xc19072d767da8ffb,
            0x89bb40a9928a4f0d,
            0xe0af7c5e7b6e29fd,
            0x9a3ed35fbedfa11a,
            0x4c684b2119ca19fb,
            0x4b575f5bf25600d6,
        ];

        debug_assert_eq!(sizes.len(), outcomes.len());
        for (s, e) in sizes.iter().zip(outcomes.iter()) {
            let r = RapidHash::hash(RapidHash::RAPID_SEED, &BYTES[0..usize::try_from(*s).unwrap()]);
            assert_eq!(*e, r);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/deprecated.zig (649 lines)
//   confidence: medium
//   todos:      10
//   notes:      BufferedReader needs a real Read trait + GenericReader port; auto_format_label is comptime-reflection and stubbed; intrusive lists use raw *mut Node per LIFETIMES.tsv (all ops are unsafe fn).
// ──────────────────────────────────────────────────────────────────────────
