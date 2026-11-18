//! Code lengths from frequencies. Where several codes are as good, it picks the one that zlib picks.

use bun_deflate::format::{Codeword, MAX_CODEWORD_LEN};

use crate::array::At;
use crate::format::reversed;

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

/// How many bits the symbols take.
pub(super) fn cost<const N: usize>(frequencies: &[u16; N], bits: &[u8; N]) -> u32 {
    let each = frequencies.iter().zip(bits);
    each.map(|(&frequency, &bits)| u32::from(frequency) * u32::from(bits))
        .sum()
}

/// For each length.
type Counts = [u16; MAX_CODEWORD_LEN as usize + 1];

/// Leaves out the symbols that have no code, which are most in a short block.
#[inline(never)]
fn assign_codes(counts: &Counts, lengths: &[u8], codes: &mut [Codeword]) {
    let (mut next, mut first) = (Counts::default(), 0);
    for (next, &shorter) in next.iter_mut().skip(1).zip(counts) {
        first = (first + shorter) << 1;
        *next = first;
    }
    for (code, &len) in codes.iter_mut().zip(lengths).filter(|&(_, &len)| len != 0) {
        let next = next.at_mut(len.into());
        (code.bits, code.len) = (reversed(*next, len.into()).into(), len.into());
        *next += 1;
    }
}

/// There is room for `N` symbols.
pub(super) struct Code<const N: usize> {
    pub(super) lengths: [u8; N],
    /// The symbols from here on have no code.
    pub(super) used: usize,
    counts: Counts,
}

impl<const N: usize> Code<N> {
    /// `HEAP` is a power of two, at least `N`, and more than there are symbols with a frequency.
    pub(super) fn new<const HEAP: usize>(frequencies: &[u16; N], max_bits: u8) -> Self {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/trees.c#L184
        let mut heap = Heap {
            nodes: [Node(0); HEAP],
            len: 0,
        };
        let mut used = 0;
        for (first, group) in (0..).step_by(4).zip(frequencies.as_chunks::<4>().0) {
            if *group == [0; 4] {
                continue;
            }
            for (symbol, &frequency) in (first..).zip(group) {
                if frequency != 0 {
                    heap.push_unordered(Node::leaf(symbol, frequency));
                    used = symbol + 1;
                }
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

        // For each inner node. They are numbered from `HEAP` on, and the last is the root.
        let mut children = [[0u16; 2]; HEAP];
        let mut parents = 0;
        while heap.len >= 2 {
            let (least, last) = (heap.nodes[1], *heap.nodes.at(heap.len));
            heap.len -= 1;
            heap.sift_down(1, last);
            let next = heap.nodes[1];
            *children.at_mut(parents) = [least.index() as u16, next.index() as u16];
            heap.sift_down(1, Node::parent(HEAP + parents, least, next));
            parents += 1;
        }
        let children = children.get(..parents).unwrap_or_default();

        let mut code = Self {
            lengths: [0; N],
            used,
            counts: [0; _],
        };
        let mut inner_lengths = [0u8; HEAP];
        let mut too_long = 0usize;
        for (parent, pair) in children.iter().enumerate().rev() {
            let bits = inner_lengths.at(parent) + 1;
            too_long += 2 * usize::from(bits > max_bits);
            let bits = bits.min(max_bits);
            for node in pair.map(usize::from) {
                if let Some(inner) = node.checked_sub(HEAP) {
                    *inner_lengths.at_mut(inner) = bits;
                } else {
                    *code.lengths.at_mut(node) = bits;
                    *code.counts.at_mut(usize::from(bits)) += 1;
                }
            }
        }
        if too_long != 0 {
            code.shorten(children.as_flattened(), too_long, usize::from(max_bits));
        }
        code
    }

    /// `too_long` nodes were cut to `max_bits`, where there is no room for them. `order` starts with the rarest.
    #[cold]
    fn shorten(&mut self, order: &[u16], too_long: usize, max_bits: usize) {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/trees.c#L332
        for _ in 0..too_long / 2 {
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

    pub(super) fn codes(&self) -> [Codeword; N] {
        let mut codes = [Codeword::default(); N];
        assign_codes(&self.counts, self.used_lengths(), &mut codes);
        codes
    }
}
