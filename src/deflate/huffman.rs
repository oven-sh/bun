//! Huffman codes for the compressor.

use crate::format::Codeword;
use crate::{wrapped, wrapped_mut};
use core::array::from_fn;

const SYMBOL_BITS: u32 = 10;
const SYMBOL_MASK: u32 = (1 << SYMBOL_BITS) - 1;

/// How long the codeword of each symbol is, at most `max_len`. Frequencies add up to less than `1 << 22`.
pub(crate) fn codeword_lens<const N: usize>(frequencies: &[u32; N], max_len: usize) -> [u8; N] {
    let lens = padded_lens(frequencies, max_len);
    from_fn(|symbol| *wrapped(&lens, symbol))
}

fn padded_lens(frequencies: &[u32], max_len: usize) -> [u8; 512] {
    // A symbol in the low bits. Above it a frequency, later the index of a parent, then a depth.
    let mut nodes = [0u32; 512];
    let mut used = 0;
    for (symbol, &frequency) in (0..).zip(frequencies) {
        *wrapped_mut(&mut nodes, used) = (frequency << SYMBOL_BITS) | symbol;
        used += usize::from(frequency != 0);
    }
    let mut lens = [0; _];
    let mut set_len = |node: u32, len: u8| *wrapped_mut(&mut lens, node as usize) = len;

    // Some decoders refuse a code that is not complete.
    if used < 2 {
        let symbol = if used == 1 { nodes[0] & SYMBOL_MASK } else { 0 };
        set_len(0, 1);
        set_len(symbol.max(1), 1);
        return lens;
    }

    nodes.get_mut(..used).unwrap_or_default().sort_unstable();
    link_inner_nodes(&mut nodes, used);
    let counts = count_lens(&mut nodes, used - 2, max_len);

    let mut rarest_first = nodes.iter();
    for len in (1..=max_len).rev() {
        let count = *wrapped(&counts, len) as usize;
        for &node in rarest_first.by_ref().take(count) {
            set_len(node, len as u8);
        }
    }
    lens
}

/// Puts the inner nodes of the tree in the place of the `leaves`, which are sorted, each with the index of its parent.
fn link_inner_nodes(nodes: &mut [u32; 512], leaves: usize) {
    let frequency = |nodes: &[u32; 512], index: usize| wrapped(nodes, index) & !SYMBOL_MASK;
    let set = |nodes: &mut [u32; 512], index: usize, high_bits: u32| {
        let node = wrapped_mut(nodes, index);
        *node = high_bits | (*node & SYMBOL_MASK);
    };

    // The rarest of each kind that have no parent yet.
    let (mut leaf, mut inner) = (0, 0);
    for parent in 0..leaves - 1 {
        let link = (parent as u32) << SYMBOL_BITS;
        let sum;
        if leaf + 1 < leaves
            && (inner == parent || frequency(nodes, leaf + 1) <= frequency(nodes, inner))
        {
            sum = frequency(nodes, leaf).wrapping_add(frequency(nodes, leaf + 1));
            leaf += 2;
        } else if inner + 2 <= parent
            && (leaf == leaves || frequency(nodes, inner + 1) < frequency(nodes, leaf))
        {
            sum = frequency(nodes, inner).wrapping_add(frequency(nodes, inner + 1));
            set(nodes, inner, link);
            set(nodes, inner + 1, link);
            inner += 2;
        } else {
            sum = frequency(nodes, leaf).wrapping_add(frequency(nodes, inner));
            set(nodes, inner, link);
            leaf += 1;
            inner += 1;
        }
        set(nodes, parent, sum);
    }
}

/// How many leaves there are at each depth, with those that would be deeper than `max_len` moved up.
fn count_lens(nodes: &mut [u32; 512], root: usize, max_len: usize) -> [u32; 16] {
    let mut counts = [0; 16];
    counts[1] = 2;
    *wrapped_mut(nodes, root) &= SYMBOL_MASK;
    for index in (0..root).rev() {
        let node = *wrapped(nodes, index);
        let depth = (wrapped(nodes, (node >> SYMBOL_BITS) as usize) >> SYMBOL_BITS) + 1;
        *wrapped_mut(nodes, index) = (depth << SYMBOL_BITS) | (node & SYMBOL_MASK);

        let depth = match depth as usize {
            depth if depth < max_len => depth,
            _ => (1..max_len)
                .rfind(|&depth| *wrapped(&counts, depth) != 0)
                .unwrap_or(1),
        };
        // An inner node turns a leaf into two leaves one deeper.
        *wrapped_mut(&mut counts, depth) -= 1;
        *wrapped_mut(&mut counts, depth + 1) += 2;
    }
    counts
}

/// RFC 1951 3.2.2
pub(crate) fn codewords<const N: usize>(lens: &[u8; N]) -> [Codeword; N] {
    let mut counts = [0u16; 16];
    for &len in lens {
        *wrapped_mut(&mut counts, len.into()) += 1;
    }
    // With the first bit at the top of 16.
    let (mut next, mut code) = ([0u16; 16], 0u16);
    for (len, (next, count)) in next.iter_mut().zip(counts).enumerate().skip(1) {
        *next = code;
        code = code.wrapping_add(count << (16 - len));
    }
    lens.map(|len| {
        let next = wrapped_mut(&mut next, len.into());
        let bits = next.reverse_bits().into();
        *next = next.wrapping_add((0x1_0000u32 >> (len % 16)) as u16);
        Codeword {
            bits,
            len: len.into(),
        }
    })
}
