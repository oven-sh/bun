//! Rope-like data structure for joining many small strings into one big string.
//! Implemented as a linked list of potentially-owned slices and a length.

use core::ptr::{self, NonNull};

use bun_alloc::AllocError;
use bun_str::strings;

// PORT NOTE: Zig's `allocator: Allocator` field dropped — global mimalloc is used for
// node and duplicated-string allocations.
// PERF(port): Zig recommended a stack-fallback allocator here — profile in Phase B.
pub struct StringJoiner {
    /// Total length of all nodes
    pub len: usize,

    pub head: Option<Box<Node>>,
    pub tail: Option<NonNull<Node>>,

    /// Avoid an extra pass over the list when joining
    pub watcher: Watcher,
}

impl Default for StringJoiner {
    fn default() -> Self {
        Self {
            len: 0,
            head: None,
            tail: None,
            watcher: Watcher::default(),
        }
    }
}

struct Node {
    /// Replaces Zig's `NullableAllocator`: when `true`, `slice` was heap-allocated by
    /// this joiner (via `push_cloned`) and is freed on node drop; when `false`, `slice`
    /// is borrowed and the caller guarantees it outlives `done()`.
    owns_slice: bool,
    // TODO(port): lifetime — borrowed slices must outlive `done()`; Phase A forbids
    // struct lifetime params so this is stored as a raw fat pointer.
    slice: *const [u8],
    next: *mut Node,
}

impl Node {
    fn init(slice: *const [u8], owns_slice: bool) -> Box<Node> {
        // bun.handleOom(joiner_alloc.create(Node)) → Box::new (aborts on OOM)
        Box::new(Node {
            owns_slice,
            slice,
            next: ptr::null_mut(),
        })
    }

    #[inline]
    fn slice(&self) -> &[u8] {
        // SAFETY: `slice` is either a leaked Box<[u8]> owned by this node, or a caller-
        // provided slice that the caller promised outlives `done()` / drop.
        unsafe { &*self.slice }
    }

}

impl Drop for Node {
    fn drop(&mut self) {
        if self.owns_slice {
            // SAFETY: when owns_slice is true, slice was produced by Box::<[u8]>::into_raw
            // in `push_cloned` and has not been freed.
            drop(unsafe { Box::from_raw(self.slice as *mut [u8]) });
        }
    }
}

#[derive(Default)]
pub struct Watcher {
    // TODO(port): lifetime — callers may assign non-'static data; never freed in Zig.
    pub input: &'static [u8],
    pub estimated_count: u32,
    pub needs_newline: bool,
}

impl StringJoiner {
    /// `data` is expected to live until `.done` is called
    pub fn push_static(&mut self, data: &[u8]) {
        self.push(data, false);
    }

    /// `data` is cloned
    pub fn push_cloned(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        // bun.handleOom(this.allocator.dupe(u8, data)) → Box<[u8]> (aborts on OOM)
        let owned: Box<[u8]> = Box::from(data);
        let raw: *const [u8] = Box::into_raw(owned);
        self.push_raw(raw, true);
    }

    // PORT NOTE: Zig signature was `push(data: []const u8, allocator: ?Allocator)`.
    // The optional allocator only encoded ownership of `data`; replaced with `owned: bool`.
    pub fn push(&mut self, data: &[u8], owned: bool) {
        if data.is_empty() {
            return;
        }
        self.push_raw(data as *const [u8], owned);
    }

    fn push_raw(&mut self, data: *const [u8], owned: bool) {
        // SAFETY: `data` is a valid slice pointer per callers (`push`/`push_cloned`).
        let data_slice = unsafe { &*data };
        if data_slice.is_empty() {
            return;
        }
        self.len += data_slice.len();

        let new_tail = Node::init(data, owned);

        if !data_slice.is_empty() {
            self.watcher.estimated_count += (self.watcher.input.len() > 0
                && strings::index_of(data_slice, self.watcher.input).is_some())
                as u32;
            self.watcher.needs_newline = data_slice[data_slice.len() - 1] != b'\n';
        }

        let new_tail_ptr = Box::into_raw(new_tail);
        if let Some(current_tail) = self.tail {
            // SAFETY: `tail` always points to the last node in the chain owned via `head`.
            unsafe { (*current_tail.as_ptr()).next = new_tail_ptr };
        } else {
            debug_assert!(self.head.is_none());
            // SAFETY: new_tail_ptr just came from Box::into_raw above.
            self.head = Some(unsafe { Box::from_raw(new_tail_ptr) });
        }
        // SAFETY: new_tail_ptr is non-null (from Box::into_raw).
        self.tail = Some(unsafe { NonNull::new_unchecked(new_tail_ptr) });
    }

    /// This deinits the string joiner on success, the new string is owned by the caller.
    pub fn done(&mut self) -> Result<Box<[u8]>, AllocError> {
        let Some(head) = self.head.take() else {
            debug_assert!(self.tail.is_none());
            debug_assert!(self.len == 0);
            return Ok(Box::default());
        };
        self.tail = None;
        let len = self.len;
        self.len = 0;
        let mut current: *mut Node = Box::into_raw(head);

        // allocator.alloc(u8, this.len)
        let mut slice = vec![0u8; len].into_boxed_slice();

        let mut remaining: &mut [u8] = &mut slice[..];
        while !current.is_null() {
            // SAFETY: `current` walks the singly-linked chain of Box-allocated nodes.
            let node = unsafe { &*current };
            let s = node.slice();
            remaining[..s.len()].copy_from_slice(s);
            // PORT NOTE: reshaped for borrowck — capture len before reborrow.
            let n = s.len();
            remaining = &mut remaining[n..];

            let prev = current;
            current = node.next;
            // SAFETY: `prev` is a Box-allocated node not yet freed.
            drop(unsafe { Box::from_raw(prev) });
        }

        debug_assert!(remaining.is_empty());

        Ok(slice)
    }

    /// Same as `.done`, but appends extra slice `end`
    pub fn done_with_end(&mut self, end: &[u8]) -> Result<Box<[u8]>, AllocError> {
        let Some(head) = self.head.take() else {
            debug_assert!(self.tail.is_none());
            debug_assert!(self.len == 0);

            if !end.is_empty() {
                return Ok(Box::from(end));
            }

            return Ok(Box::default());
        };
        self.tail = None;
        let len = self.len;
        self.len = 0;
        let mut current: *mut Node = Box::into_raw(head);

        let mut slice = vec![0u8; len + end.len()].into_boxed_slice();

        let mut remaining: &mut [u8] = &mut slice[..];
        while !current.is_null() {
            // SAFETY: `current` walks the singly-linked chain of Box-allocated nodes.
            let node = unsafe { &*current };
            let s = node.slice();
            remaining[..s.len()].copy_from_slice(s);
            // PORT NOTE: reshaped for borrowck — capture len before reborrow.
            let n = s.len();
            remaining = &mut remaining[n..];

            let prev = current;
            current = node.next;
            // SAFETY: `prev` is a Box-allocated node not yet freed.
            drop(unsafe { Box::from_raw(prev) });
        }

        debug_assert!(remaining.len() == end.len());
        remaining.copy_from_slice(end);

        Ok(slice)
    }

    pub fn last_byte(&self) -> u8 {
        let Some(tail) = self.tail else { return 0 };
        // SAFETY: `tail` points to the last node owned via `head`.
        let slice = unsafe { (*tail.as_ptr()).slice() };
        debug_assert!(!slice.is_empty());
        slice[slice.len() - 1]
    }

    pub fn ensure_newline_at_end(&mut self) {
        if self.watcher.needs_newline {
            self.watcher.needs_newline = false;
            self.push_static(b"\n");
        }
    }

    pub fn contains(&self, slice: &[u8]) -> bool {
        let mut el: *const Node = match &self.head {
            Some(h) => &**h as *const Node,
            None => ptr::null(),
        };
        while !el.is_null() {
            // SAFETY: `el` walks the live node chain owned by `self`.
            let node = unsafe { &*el };
            el = node.next;
            if strings::index_of(node.slice(), slice).is_some() {
                return true;
            }
        }

        false
    }
}

impl Drop for StringJoiner {
    fn drop(&mut self) {
        let Some(head) = self.head.take() else {
            debug_assert!(self.tail.is_none());
            debug_assert!(self.len == 0);
            return;
        };
        self.tail = None;
        let mut current: *mut Node = Box::into_raw(head);

        while !current.is_null() {
            // SAFETY: `current` walks the singly-linked chain of Box-allocated nodes.
            let next = unsafe { (*current).next };
            // SAFETY: each node was Box-allocated and not yet freed.
            drop(unsafe { Box::from_raw(current) });
            current = next;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/StringJoiner.zig (180 lines)
//   confidence: medium
//   todos:      2
//   notes:      NullableAllocator collapsed to `owns_slice: bool` + impl Drop for Node; borrowed-slice lifetime unexpressed (raw *const [u8]); done()/done_with_end() reset len=0 so Drop's debug_assert holds; head=Box/tail=NonNull/next=*mut per LIFETIMES.tsv requires Box::into_raw round-trips.
// ──────────────────────────────────────────────────────────────────────────
