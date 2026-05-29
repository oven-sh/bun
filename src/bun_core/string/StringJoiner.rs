//! Rope-like data structure for joining many small strings into one big string.
//! Implemented as a flat `Vec` of borrowed-or-owned slices plus a running
//! length, so the join-time output buffer can be sized exactly once.

use crate::string::strings;
use bun_alloc::AllocError;

// PORT NOTE: Zig's `std.mem.Allocator` param field dropped — global mimalloc is used for
// node and duplicated-string allocations.
#[derive(Default)]
pub struct StringJoiner<'a> {
    /// Total length of all nodes
    pub len: usize,

    /// Slices in insertion order. Stored flat instead of as a singly-linked
    /// list so a join with N pieces does ~log₂N Vec reallocs instead of N
    /// `Box<Node>` allocations and N pointer-chasing dereferences on drain.
    nodes: Vec<Node<'a>>,

    /// Avoid an extra pass over the list when joining
    pub watcher: Watcher<'a>,
}

enum Node<'a> {
    /// Borrowed for `'a`; the caller's data must stay valid until the joiner's
    /// last read (`done`/`done_with_end`/`node_slices`/`contains`/`last_byte`).
    Borrowed(&'a [u8]),
    /// Heap-allocated by this joiner (via `push_owned`/`push_cloned`); freed
    /// when the node drops.
    Owned(Box<[u8]>),
}

impl Node<'_> {
    #[inline]
    fn slice(&self) -> &[u8] {
        match self {
            Node::Borrowed(slice) => slice,
            Node::Owned(boxed) => boxed,
        }
    }
}

#[derive(Default)]
pub struct Watcher<'a> {
    pub input: &'a [u8],
    pub estimated_count: u32,
    pub needs_newline: bool,
}

impl<'a> StringJoiner<'a> {
    /// Pre-allocate room for `additional` more pushed slices, so a join with a
    /// known piece count does a single nodes allocation instead of log₂N grows.
    pub fn reserve(&mut self, additional: usize) {
        self.nodes.reserve(additional);
    }

    /// `data` is expected to live until `.done` is called
    pub fn push_static(&mut self, data: &'a [u8]) {
        self.push(data);
    }

    /// Takes ownership of `data` (no copy). Freed when the node is dropped.
    pub fn push_owned(&mut self, data: Box<[u8]>) {
        if data.is_empty() {
            return;
        }
        self.push_node(Node::Owned(data));
    }

    /// `data` is cloned
    pub fn push_cloned(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        // bun.handleOom(this.allocator.dupe(u8, data)) → Box<[u8]> (aborts on OOM)
        self.push_owned(Box::from(data));
    }

    pub fn push(&mut self, data: &'a [u8]) {
        if data.is_empty() {
            return;
        }
        self.push_node(Node::Borrowed(data));
    }

    fn push_node(&mut self, node: Node<'a>) {
        let data_slice = node.slice();
        debug_assert!(!data_slice.is_empty());
        self.len += data_slice.len();

        self.watcher.estimated_count += (self.watcher.input.len() > 0
            && strings::index_of(data_slice, self.watcher.input).is_some())
            as u32;
        self.watcher.needs_newline = data_slice[data_slice.len() - 1] != b'\n';

        self.nodes.push(node);
    }

    /// Re-tag every borrowed segment (and `watcher.input`) as `'static` so the
    /// joiner can be stored in lifetime-free storage and read later (e.g. the
    /// bundler's deferred `Chunk.intermediate_output`).
    ///
    /// # Safety
    /// Every borrowed segment previously pushed (`push`/`push_static`) and
    /// `watcher.input` must remain valid — not freed, moved, or reallocated —
    /// for as long as the returned joiner (or anything it is moved into) is
    /// alive.
    pub unsafe fn detach_lifetime(self) -> StringJoiner<'static> {
        StringJoiner {
            len: self.len,
            nodes: self
                .nodes
                .into_iter()
                .map(|node| match node {
                    Node::Borrowed(slice) => {
                        // SAFETY: caller contract — the backing storage outlives
                        // the returned joiner.
                        Node::Borrowed(unsafe { &*core::ptr::from_ref::<[u8]>(slice) })
                    }
                    Node::Owned(boxed) => Node::Owned(boxed),
                })
                .collect(),
            watcher: Watcher {
                // SAFETY: caller contract — `watcher.input` outlives the
                // returned joiner.
                input: unsafe { &*core::ptr::from_ref::<[u8]>(self.watcher.input) },
                estimated_count: self.watcher.estimated_count,
                needs_newline: self.watcher.needs_newline,
            },
        }
    }

    /// This deinits the string joiner on success, the new string is owned by the caller.
    pub fn done(&mut self) -> Result<Box<[u8]>, AllocError> {
        if self.nodes.is_empty() {
            debug_assert!(self.len == 0);
            return Ok(Box::default());
        }
        let len = self.len;
        self.len = 0;

        let mut out = Vec::<u8>::with_capacity(len);
        for node in self.nodes.drain(..) {
            out.extend_from_slice(node.slice());
            // `drop(node)` frees the buffer when owned.
        }
        debug_assert_eq!(out.len(), len);
        Ok(out.into_boxed_slice())
    }

    /// Same as `.done`, but appends extra slice `end`
    pub fn done_with_end(&mut self, end: &[u8]) -> Result<Box<[u8]>, AllocError> {
        if self.nodes.is_empty() {
            debug_assert!(self.len == 0);
            if !end.is_empty() {
                return Ok(Box::from(end));
            }
            return Ok(Box::default());
        }
        let len = self.len;
        self.len = 0;

        let mut out = Vec::<u8>::with_capacity(len + end.len());
        for node in self.nodes.drain(..) {
            out.extend_from_slice(node.slice());
        }
        debug_assert_eq!(out.len(), len);
        out.extend_from_slice(end);
        Ok(out.into_boxed_slice())
    }

    pub fn last_byte(&self) -> u8 {
        let Some(tail) = self.nodes.last() else {
            return 0;
        };
        let slice = tail.slice();
        debug_assert!(!slice.is_empty());
        slice[slice.len() - 1]
    }

    pub fn ensure_newline_at_end(&mut self) {
        if self.watcher.needs_newline {
            self.watcher.needs_newline = false;
            self.push_static(b"\n");
        }
    }

    /// Iterate each node's slice in insertion order without consuming.
    pub fn node_slices(&self) -> impl Iterator<Item = &[u8]> {
        self.nodes.iter().map(Node::slice)
    }

    pub fn contains(&self, slice: &[u8]) -> bool {
        self.node_slices()
            .any(|s| strings::index_of(s, slice).is_some())
    }
}

// `Drop` for `StringJoiner` is implicit: `Vec<Node>::drop` frees joiner-owned
// slices (`Node::Owned`); borrowed nodes are not freed.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_kinds_concatenate_in_insertion_order() {
        let owned: Box<[u8]> = Box::from(b"owned".as_slice());
        let cloned_src = b"cloned".to_vec();
        let mut j = StringJoiner::default();
        j.push(b"borrowed ");
        j.push_static(b"static ");
        j.push_owned(owned);
        j.push_cloned(&cloned_src);
        drop(cloned_src);
        assert_eq!(j.len, "borrowed static ownedcloned".len());
        assert_eq!(&*j.done().unwrap(), b"borrowed static ownedcloned");
        assert_eq!(j.len, 0);
    }

    #[test]
    fn empty_pushes_are_skipped() {
        let mut j = StringJoiner::default();
        j.push(b"");
        j.push_static(b"");
        j.push_owned(Box::default());
        j.push_cloned(b"");
        assert_eq!(j.len, 0);
        assert_eq!(j.node_slices().count(), 0);
        assert_eq!(&*j.done().unwrap(), b"");
    }

    #[test]
    fn done_with_end_appends_suffix() {
        let mut j = StringJoiner::default();
        assert_eq!(&*j.done_with_end(b"").unwrap(), b"");
        assert_eq!(&*j.done_with_end(b"suffix").unwrap(), b"suffix");
        j.push(b"body");
        assert_eq!(&*j.done_with_end(b"!\n").unwrap(), b"body!\n");
    }

    #[test]
    fn last_byte_contains_and_node_slices() {
        let mut j = StringJoiner::default();
        assert_eq!(j.last_byte(), 0);
        j.push(b"abc");
        j.push_cloned(b"def");
        assert_eq!(j.last_byte(), b'f');
        assert!(!j.contains(b"cd"));
        assert!(j.contains(b"de"));
        let slices: Vec<&[u8]> = j.node_slices().collect();
        assert_eq!(slices, vec![b"abc".as_slice(), b"def".as_slice()]);
    }

    #[test]
    fn ensure_newline_at_end_tracks_watcher() {
        let mut j = StringJoiner::default();
        j.push(b"no newline");
        j.ensure_newline_at_end();
        j.ensure_newline_at_end();
        assert_eq!(&*j.done().unwrap(), b"no newline\n");

        let mut j = StringJoiner::default();
        j.push(b"has newline\n");
        j.ensure_newline_at_end();
        assert_eq!(&*j.done().unwrap(), b"has newline\n");
    }

    #[test]
    fn watcher_estimates_unique_key_occurrences() {
        let mut j = StringJoiner {
            watcher: Watcher {
                input: b"KEY",
                ..Default::default()
            },
            ..Default::default()
        };
        j.push(b"prefix KEY suffix");
        j.push(b"no match");
        j.push_cloned(b"another KEY");
        assert_eq!(j.watcher.estimated_count, 2);
    }

    #[test]
    fn detach_lifetime_round_trips_borrowed_data() {
        let borrowed = b"KEY borrowed ".to_vec();
        let input = b"KEY".to_vec();
        let mut j = StringJoiner {
            watcher: Watcher {
                input: &input,
                ..Default::default()
            },
            ..Default::default()
        };
        j.push(&borrowed);
        j.push_cloned(b"cloned KEY");
        // SAFETY: `borrowed` and `input` are declared before `detached`, so they outlive it.
        let mut detached = unsafe { j.detach_lifetime() };
        assert_eq!(detached.len, "KEY borrowed cloned KEY".len());
        assert_eq!(detached.watcher.input, b"KEY");
        assert_eq!(detached.watcher.estimated_count, 2);
        assert!(detached.watcher.needs_newline);
        assert_eq!(&*detached.done().unwrap(), b"KEY borrowed cloned KEY");
    }
}

// ported from: src/string/StringJoiner.zig
