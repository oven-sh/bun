//! Rope-like data structure for joining many small strings into one big string.
//! Implemented as a flat `Vec` of potentially-owned slices plus a running
//! length, so the join-time output buffer can be sized exactly once.

use crate::RawSlice;
use crate::string::strings;
use bun_alloc::AllocError;

// PORT NOTE: Zig's `std.mem.Allocator` param field dropped — global mimalloc is used for
// node and duplicated-string allocations.
#[derive(Default)]
pub struct StringJoiner {
    /// Total length of all nodes
    pub len: usize,

    /// Slices in insertion order. Stored flat instead of as a singly-linked
    /// list so a join with N pieces does ~log₂N Vec reallocs instead of N
    /// `Box<Node>` allocations and N pointer-chasing dereferences on drain.
    nodes: Vec<Node>,

    /// Avoid an extra pass over the list when joining
    pub watcher: Watcher,
}

// SAFETY: `nodes` holds `RawSlice<u8>` raw fat pointers which alias
// caller-owned (`owns_slice = false`) or joiner-owned (`owns_slice = true`)
// storage; no aliasing escapes `&mut self` methods. The Zig original is
// passed across bundler worker threads (see Chunk.IntermediateOutput).
unsafe impl Send for StringJoiner {}
// SAFETY: `&StringJoiner` only exposes read-only views (`last_byte`,
// `node_slices`, `contains`) over `RawSlice<u8>` storage with no interior
// mutability; concurrent shared reads of the owned/borrowed-until-`done()`
// byte buffers are data-race-free.
unsafe impl Sync for StringJoiner {}

struct Node {
    /// Replaces Zig's `NullableAllocator`: when `true`, `slice` was heap-allocated by
    /// this joiner (via `push_owned`/`push_cloned`) and is freed on node drop;
    /// when `false`, `slice` is borrowed and the caller guarantees it outlives `done()`.
    owns_slice: bool,
    // TODO(port): lifetime — borrowed slices must outlive `done()`; the port avoids
    // struct lifetime params, so this is stored as a typed raw fat pointer.
    // `RawSlice` (one encapsulated unsafe in `.slice()`) replaces the open-coded
    // raw deref at every read site; the backing storage outlives the node by
    // either ownership (`owns_slice`) or caller contract.
    slice: RawSlice<u8>,
}

impl Node {
    #[inline]
    fn slice(&self) -> &[u8] {
        self.slice.slice()
    }
}

// SAFETY: `Node` is a plain (slice, ownership-bit) record; the `RawSlice` raw
// pointer is uniquely owned (or borrowed under caller contract) through the
// `Vec` rooted at `StringJoiner.nodes` and never shared aliased across threads
// concurrently. The Zig original moves these between bundler worker threads.
unsafe impl Send for Node {}
// SAFETY: `&Node` only reads the immutable `RawSlice<u8>` backing bytes via
// `slice()`; there is no interior mutability, so concurrent shared access from
// multiple threads cannot race.
unsafe impl Sync for Node {}

impl Drop for Node {
    fn drop(&mut self) {
        if self.owns_slice {
            // SAFETY: when owns_slice is true, slice was produced by Box::<[u8]>::into_raw
            // in `push_cloned`/`push_owned` and has not been freed.
            drop(unsafe { crate::heap::take(self.slice.as_ptr().cast_mut()) });
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
    /// Pre-allocate room for `additional` more pushed slices, so a join with a
    /// known piece count does a single nodes allocation instead of log₂N grows.
    pub fn reserve(&mut self, additional: usize) {
        self.nodes.reserve(additional);
    }

    /// `data` is expected to live until `.done` is called
    pub fn push_static(&mut self, data: &[u8]) {
        self.push(data);
    }

    /// Takes ownership of `data` (no copy). Freed when the node is dropped.
    pub fn push_owned(&mut self, data: Box<[u8]>) {
        if data.is_empty() {
            return;
        }
        let raw: *const [u8] = crate::heap::into_raw(data);
        // SAFETY: `raw` is a fresh `Box::into_raw` allocation owned by the node
        // until `Node::drop` reclaims it (`owns_slice = true`).
        self.push_raw(unsafe { RawSlice::from_raw(raw) }, true);
    }

    /// `data` is cloned
    pub fn push_cloned(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        // bun.handleOom(this.allocator.dupe(u8, data)) → Box<[u8]> (aborts on OOM)
        self.push_owned(Box::from(data));
    }

    // PORT NOTE: Zig signature was `push(data: []const u8, ?Allocator param)`.
    // The optional allocator only encoded ownership of `data`, which has no Rust
    // analogue for a borrowed `&[u8]`; callers wanting owned semantics use
    // `push_owned`/`push_cloned` instead.
    pub fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        self.push_raw(RawSlice::new(data), false);
    }

    fn push_raw(&mut self, data: RawSlice<u8>, owned: bool) {
        let data_slice = data.slice();
        if data_slice.is_empty() {
            return;
        }
        self.len += data_slice.len();

        self.watcher.estimated_count += (self.watcher.input.len() > 0
            && strings::index_of(data_slice, self.watcher.input).is_some())
            as u32;
        self.watcher.needs_newline = data_slice[data_slice.len() - 1] != b'\n';

        self.nodes.push(Node {
            owns_slice: owned,
            slice: data,
        });
    }

    /// This deinits the string joiner on success, the new string is owned by the caller.
    pub fn done(&mut self) -> Result<Box<[u8]>, AllocError> {
        if self.nodes.is_empty() {
            debug_assert!(self.len == 0);
            return Ok(Box::default());
        }
        let len = self.len;
        self.len = 0;

        // Zig: `allocator.alloc(u8, this.len)` — allocates uninitialized.
        // `Vec::with_capacity` + `extend_from_slice` is also zero-fill-free
        // (each push is a `memcpy` into spare capacity), and since the final
        // `len == capacity` the `into_boxed_slice` is a no-realloc move.
        let mut out = Vec::<u8>::with_capacity(len);
        for node in self.nodes.drain(..) {
            out.extend_from_slice(node.slice());
            // `drop(node)` runs `Node::drop`, freeing `slice` when owned.
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

// `Drop` for `StringJoiner` is implicit: `Vec<Node>::drop` runs `Node::drop`
// for each element, which frees joiner-owned slices.

// ported from: src/string/StringJoiner.zig
