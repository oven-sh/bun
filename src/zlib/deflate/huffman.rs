//! Code lengths from frequencies. Where several codes are as good, it picks the one that zlib picks.

use crate::array::At;
use crate::format::{MAX_CODE_BITS, reversed};

/// Room for the leaves and inner nodes of any alphabet.
const MAX_NODES: usize = 1024;
const INDEX_BITS: u32 = 10;
const DEPTH_BITS: u32 = 6;

/// From the highest bit: frequency, depth of the subtree, index.
#[derive(Clone, Copy)]
struct Node(u32);

impl Node {
    const INDEX: u32 = (1 << INDEX_BITS) - 1;
    const DEPTH: u32 = ((1 << DEPTH_BITS) - 1) << INDEX_BITS;
    const FREQUENCY: u32 = !(Self::DEPTH | Self::INDEX);

    fn leaf(symbol: usize, frequency: u16) -> Self {
        Self(u32::from(frequency) << (INDEX_BITS + DEPTH_BITS) | symbol as u32)
    }

    /// The frequencies of a block add up to 16 bits, which is too little for a depth of 25.
    fn parent(index: usize, a: Self, b: Self) -> Self {
        let frequency = (a.0 & Self::FREQUENCY) + (b.0 & Self::FREQUENCY);
        let depth = (a.0 & Self::DEPTH).max(b.0 & Self::DEPTH) + (1 << INDEX_BITS);
        Self(frequency | depth | index as u32)
    }

    #[inline(always)]
    fn index(self) -> usize {
        (self.0 & Self::INDEX) as usize
    }

    #[inline(always)]
    fn is_at_most(self, other: Self) -> bool {
        self.0 <= other.0 | Self::INDEX
    }
}

/// The children of `nodes[n]` are at `2 * n` and `2 * n + 1`. The first is not used.
struct Heap<const N: usize> {
    nodes: [Node; N],
    len: usize,
}

impl<const N: usize> Heap<N> {
    fn push_unordered(&mut self, node: Node) {
        self.len += 1;
        *self.nodes.at_mut(self.len) = node;
    }

    #[inline(always)]
    fn sift_down(&mut self, mut at: usize, node: Node) {
        loop {
            let mut child_at = 2 * at;
            if child_at > self.len {
                break;
            }
            let mut child = *self.nodes.at(child_at);
            let right = *self.nodes.at((child_at + 1) % N);
            if child_at < self.len && right.is_at_most(child) {
                (child, child_at) = (right, child_at + 1);
            }
            if node.is_at_most(child) {
                break;
            }
            *self.nodes.at_mut(at) = child;
            at = child_at;
        }
        *self.nodes.at_mut(at) = node;
    }
}

/// `N` is a power of two, and more than there are symbols.
pub(super) struct Code<const N: usize> {
    pub(super) lengths: [u8; N],
    /// The symbols from here on have no code.
    pub(super) used: usize,
    counts: [u16; MAX_CODE_BITS + 1],
}

impl<const N: usize> Code<N> {
    pub(super) fn new(frequencies: &[u16; N], max_bits: u8) -> Self {
        let mut heap = Heap {
            nodes: [Node(0); N],
            len: 0,
        };
        let mut used = 0;
        for (symbol, &frequency) in frequencies.iter().enumerate() {
            if frequency != 0 {
                heap.push_unordered(Node::leaf(symbol, frequency));
                used = symbol + 1;
            }
        }
        // PKZIP wants a code of at least a bit, even for one symbol or none.
        while heap.len < 2 {
            let symbol = if used <= 2 { used } else { 0 };
            heap.push_unordered(Node::leaf(symbol, 1));
            used = used.max(symbol + 1);
        }
        for at in (1..=heap.len / 2).rev() {
            heap.sift_down(at, *heap.nodes.at(at));
        }

        // From the least frequent on, with siblings side by side. Inner nodes are numbered from `N` on.
        let mut order = [0u16; MAX_NODES];
        let mut parents = 0;
        while heap.len >= 2 {
            let (least, last) = (heap.nodes[1], *heap.nodes.at(heap.len));
            heap.len -= 1;
            heap.sift_down(1, last);
            let next = heap.nodes[1];
            *order.at_mut(2 * parents) = least.index() as u16;
            *order.at_mut(2 * parents + 1) = next.index() as u16;
            heap.sift_down(1, Node::parent(N + parents, least, next));
            parents += 1;
        }
        let order = order.get(..2 * parents).unwrap_or_default();

        let mut code = Self {
            lengths: [0; N],
            used,
            counts: [0; _],
        };
        let mut inner_lengths = [0u8; N];
        let mut too_long = 0usize;
        for (at, &node) in order.iter().enumerate().rev() {
            let bits = inner_lengths.at(at / 2) + 1;
            too_long += usize::from(bits > max_bits);
            let bits = bits.min(max_bits);
            if let Some(inner) = usize::from(node).checked_sub(N) {
                *inner_lengths.at_mut(inner) = bits;
            } else {
                *code.lengths.at_mut(usize::from(node)) = bits;
                *code.counts.at_mut(usize::from(bits)) += 1;
            }
        }
        if too_long != 0 {
            code.shorten(order, too_long, usize::from(max_bits));
        }
        code
    }

    /// The counts have all that are too long at `max_bits`, where there is no room for so many.
    #[cold]
    fn shorten(&mut self, order: &[u16], too_long: usize, max_bits: usize) {
        for _ in 0..too_long.div_ceil(2) {
            let shorter = (1..max_bits).rev().find(|&bits| *self.counts.at(bits) != 0);
            let bits = shorter.unwrap_or_default();
            *self.counts.at_mut(bits) -= 1;
            *self.counts.at_mut(bits + 1) += 2;
            *self.counts.at_mut(max_bits) -= 1;
        }
        let mut leaves = order.iter().filter(|&&node| usize::from(node) < N);
        for bits in (1..=max_bits).rev() {
            for &leaf in leaves.by_ref().take(usize::from(*self.counts.at(bits))) {
                *self.lengths.at_mut(usize::from(leaf)) = bits as u8;
            }
        }
    }

    pub(super) fn used_lengths(&self) -> &[u8] {
        self.lengths.get(..self.used).unwrap_or_default()
    }

    /// In the order in which their bits are written.
    pub(super) fn codes(&self) -> [u16; N] {
        let mut next = [0u16; MAX_CODE_BITS + 1];
        let mut code = 0u16;
        for (next, &shorter) in next.iter_mut().skip(1).zip(&self.counts) {
            code = (code + shorter) << 1;
            *next = code;
        }
        let mut codes = [0; N];
        for (code, &bits) in codes.iter_mut().zip(self.used_lengths()) {
            if bits != 0 {
                let next = next.at_mut(usize::from(bits));
                *code = reversed(*next, u32::from(bits));
                *next += 1;
            }
        }
        codes
    }
}
