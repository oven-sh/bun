//! The part of the input in which matches are searched.

use crate::format::MAX_MATCH_LEN;
use crate::{Result, chunk_at, chunk_at_mut, copy_prefix, grow_to_array, wrapped_mut};
use core::array::from_fn;
use core::ops::Range;

/// The position of a byte in the window. Tables hold 0 for none.
pub(crate) type Node = u16;

const NODES: usize = 1 << Node::BITS;
/// The node of the first byte. It ends a group that is not inserted, because libdeflate files this byte under the hash 0.
pub(crate) const FIRST_NODE: usize = 63;
pub(crate) const MAX_OFFSET: usize = 32767;
/// How many bytes can be read from any node on.
const REACH: usize = 512 + 8;
/// Has room for all nodes that are indexed but not parsed.
pub(crate) const RING: usize = 1024;
/// More than a parser searches past the node at which it checked its limit: it defers a match by at most (4 * 255 + 15) / 3 nodes.
const LOOKAHEAD: usize = 512;
/// How many nodes are indexed at once, and parsed while what that wrote is in the cache.
pub(crate) const BATCH: usize = RING - LOOKAHEAD;
/// How many nodes are indexed in a turn of a loop.
pub(crate) const GROUP: usize = 4;
/// Keeps all that the parser can still refer to. A multiple of [`RING`], so that nodes keep their places in rings.
pub(crate) const SLIDE: usize = (NODES - LOOKAHEAD - MAX_OFFSET - 1) / RING * RING;
const _: () = assert!(RING.is_multiple_of(BATCH) && BATCH + 3 <= REACH);
const _: () = assert!((FIRST_NODE + 1).is_multiple_of(GROUP));
/// No match starts in this many bytes at the end of the input.
pub(crate) const UNINDEXED: usize = 4;

/// Long enough for any node, so that reading takes no bounds checks.
pub(crate) type Bytes = [u8; NODES + REACH];
pub(crate) type Reach = [u8; REACH];

/// Is told of all nodes after [`FIRST_NODE`] in order, ahead of the parser.
pub(crate) trait MatchFinder {
    /// Adds the nodes of `groups`, which are at most a [`BATCH`].
    fn insert(&mut self, window: &Bytes, groups: Range<usize>);
    /// Makes searches from `nodes` find nothing.
    fn leave_out(&mut self, nodes: Range<usize>);
    /// Lowers all nodes by [`SLIDE`].
    fn slide(&mut self);
}

pub(crate) struct Window<'a> {
    input: &'a [u8],
    /// Stands in for `input` where that has too little before [`FIRST_NODE`] or after it.
    padded: &'a mut Bytes,
    /// Where [`FIRST_NODE`] is in the input.
    start: usize,
    /// The next node to index.
    indexed: usize,
}

impl<'a> Window<'a> {
    pub(crate) fn new(input: &'a [u8], storage: &'a mut Vec<u8>) -> Result<Self> {
        // Copying is slow on some CPUs if one side is a few bytes further into a page than the other.
        let storage: &mut [u8; size_of::<Bytes>() + 64] = grow_to_array(storage)?;
        let first = storage.as_ptr().addr() + FIRST_NODE;
        let skew = input.as_ptr().addr().wrapping_sub(first) % 64;
        let padded = chunk_at_mut(storage, skew).ok_or(bun_alloc::AllocError)?;
        let mut window = Self {
            input,
            padded,
            start: 0,
            indexed: FIRST_NODE + 1,
        };
        window.pad();
        Ok(window)
    }

    pub(crate) fn input(&self) -> &'a [u8] {
        self.input
    }

    fn unpadded(&self) -> Option<&'a Bytes> {
        chunk_at(self.input, self.start.wrapping_sub(FIRST_NODE))
    }

    /// Leaves what follows the input as it is, which does not change the result.
    fn pad(&mut self) {
        let (_, to) = self.padded.split_at_mut(FIRST_NODE);
        copy_prefix(to, self.input.get(self.start..).unwrap_or_default());
    }

    pub(crate) fn bytes(&self) -> &Bytes {
        self.unpadded().unwrap_or(self.padded)
    }

    pub(crate) fn node_at(&self, position: usize) -> usize {
        position + FIRST_NODE - self.start
    }

    /// The node after the last byte of the input.
    pub(crate) fn input_end(&self) -> usize {
        self.node_at(self.input.len())
    }

    pub(crate) fn position_of(&self, node: usize) -> usize {
        node + self.start - FIRST_NODE
    }

    /// Indexes ahead of `position`. Returns the position up to which to parse.
    #[inline(never)]
    pub(crate) fn advance(&mut self, position: usize, finder: &mut impl MatchFinder) -> usize {
        loop {
            let end = self.input_end();
            if self.indexed >= end {
                return self.input.len();
            }
            if self.node_at(position) + LOOKAHEAD < self.indexed {
                return self.position_of(self.indexed - LOOKAHEAD);
            }
            if self.indexed == NODES {
                self.start += SLIDE;
                self.indexed -= SLIDE;
                if self.unpadded().is_none() {
                    self.pad();
                }
                finder.slide();
                continue;
            }
            let next = (self.indexed + 1).next_multiple_of(BATCH).min(end);
            finder.insert(self.bytes(), self.indexed / GROUP..next.div_ceil(GROUP));
            finder.leave_out(end.saturating_sub(UNINDEXED).min(next)..next);
            self.indexed = next;
        }
    }
}

/// The length of a list with an entry for each node, in whole groups.
pub(crate) fn node_count(input_len: usize) -> usize {
    input_len
        .saturating_add(FIRST_NODE)
        .min(NODES)
        .next_multiple_of(GROUP)
}

pub(crate) fn slide_table(nodes: &mut [Node]) {
    for node in nodes {
        *node = node.saturating_sub(SLIDE as Node);
    }
}

/// For a list with `N` entries per node, which also move down.
pub(crate) fn slide_list<const N: usize>(nodes: &mut [Node]) {
    let mut parts = nodes.chunks_mut(N * SLIDE);
    let mut to = parts.next().unwrap_or_default();
    for from in parts {
        for (to, from) in to.iter_mut().zip(&*from) {
            *to = from.saturating_sub(SLIDE as Node);
        }
        to = from;
    }
}

/// Puts the nodes of `group` in `table`, by the hash of their first `PREFIX_LEN` bytes, and those that were there in `old`.
#[inline(always)]
pub(crate) fn replace<const PREFIX_LEN: u32, const N: usize>(
    table: &mut [Node; N],
    window: &Bytes,
    group: usize,
    old: &mut [Node; GROUP],
) {
    let bytes = reach(window, group * GROUP);
    let replaced: [Node; GROUP] = from_fn(|index| {
        let prefix = u32_at(bytes, index) & (u32::MAX >> (32 - 8 * PREFIX_LEN));
        let hash = prefix.wrapping_mul(0x1E35_A7BD) >> (32 - N.ilog2());
        let node = (group * GROUP + index) as Node;
        core::mem::replace(wrapped_mut(table, hash as usize), node)
    });
    // Stores to one cache line are faster in a row, and each on its own than packed first.
    [old[0], old[1], old[2], old[3]] = replaced;
}

/// The first node that `node` can match.
#[inline(always)]
pub(crate) fn oldest_for(node: usize) -> usize {
    node.max(MAX_OFFSET + FIRST_NODE) - MAX_OFFSET
}

#[inline(always)]
pub(crate) fn reach(window: &Bytes, node: usize) -> &Reach {
    chunk_at(window, node % NODES).unwrap_or(&[0; REACH])
}

#[inline(always)]
pub(crate) fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(chunk_at(bytes, at).copied().unwrap_or_default())
}

#[inline(always)]
pub(crate) fn u64_at(bytes: &Reach, at: usize) -> u64 {
    u64::from_le_bytes(chunk_at(bytes, at).copied().unwrap_or_default())
}

/// The length of the common prefix, at most `max_len`. The first `len` bytes are known to be the same.
#[inline(always)]
pub(crate) fn match_len(a: &Reach, b: &Reach, mut len: usize, max_len: usize) -> usize {
    let max_len = max_len.min(MAX_MATCH_LEN);
    while len < max_len {
        let difference = u64_at(a, len) ^ u64_at(b, len);
        if difference != 0 {
            return max_len.min(len + difference.trailing_zeros() as usize / 8);
        }
        len += 8;
    }
    max_len
}
