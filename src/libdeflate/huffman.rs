//! Length-limited canonical Huffman codes from symbol frequencies.

use crate::constants::{MAX_CODEWORD_LEN, MAX_NUM_SYMS};

/// An array entry packs a symbol in the low bits with a frequency, parent index or depth above it.
const NUM_SYMBOL_BITS: u32 = 10;
const SYMBOL_MASK: u32 = (1 << NUM_SYMBOL_BITS) - 1;
const FREQ_MASK: u32 = !SYMBOL_MASK;

/// The most a block's frequencies may add up to.
pub(crate) const MAX_TOTAL_FREQ: usize = (1 << (32 - NUM_SYMBOL_BITS)) - 1;

const _: () = assert!(MAX_NUM_SYMS <= 1 << NUM_SYMBOL_BITS);

type LenCounts = [u32; MAX_CODEWORD_LEN + 1];

/// Fills `symout` with the used symbols sorted by frequency, then value, and zeroes the `lens` of the others.
fn sort_symbols(freqs: &[u32], lens: &mut [u8], symout: &mut [u32]) -> Option<usize> {
    let last_counter = freqs.len().checked_sub(1)?;
    let mut counters = [0u32; MAX_NUM_SYMS];
    let counters = counters.get_mut(..=last_counter)?;
    let counter_of = |freq: u32| (freq as usize).min(last_counter);

    // A counting sort. Frequencies too high to have a counter share the last one and are sorted after.
    for &freq in freqs {
        *counters.get_mut(counter_of(freq))? += 1;
    }
    let mut num_used_syms = 0;
    for counter in counters.iter_mut().skip(1) {
        num_used_syms += core::mem::replace(counter, num_used_syms);
    }
    for ((sym, &freq), len) in freqs.iter().enumerate().zip(lens.iter_mut()) {
        if freq != 0 {
            let slot = counters.get_mut(counter_of(freq))?;
            *symout.get_mut(*slot as usize)? = sym as u32 | (freq << NUM_SYMBOL_BITS);
            *slot += 1;
        } else {
            *len = 0;
        }
    }
    let high_freqs = *counters.get(last_counter.checked_sub(1)?)? as usize..num_used_syms as usize;
    symout.get_mut(high_freqs)?.sort_unstable();

    Some(num_used_syms as usize)
}

/// Turns the sorted frequencies in `a` into the tree's non-leaf nodes, each holding its parent's index. The root is `a[a.len() - 2]`.
fn build_tree(a: &mut [u32]) -> Option<()> {
    let last_idx = a.len().checked_sub(1)?;
    // The next leaf without a parent, the next non-leaf without one, and where the next non-leaf goes.
    let (mut i, mut b, mut e) = (0usize, 0usize, 0usize);
    let freq = |a: &[u32], index: usize| Some(a.get(index)? & FREQ_MASK);
    let set_parent = |a: &mut [u32], index: usize, parent: usize| {
        let node = a.get_mut(index)?;
        *node = ((parent as u32) << NUM_SYMBOL_BITS) | (*node & SYMBOL_MASK);
        Some(())
    };

    loop {
        let new_freq;
        if i < last_idx && (b == e || freq(a, i + 1)? <= freq(a, b)?) {
            new_freq = freq(a, i)? + freq(a, i + 1)?;
            i += 2;
        } else if b + 2 <= e && (i > last_idx || freq(a, b + 1)? < freq(a, i)?) {
            new_freq = freq(a, b)? + freq(a, b + 1)?;
            set_parent(a, b, e)?;
            set_parent(a, b + 1, e)?;
            b += 2;
        } else {
            new_freq = freq(a, i)? + freq(a, b)?;
            set_parent(a, b, e)?;
            i += 1;
            b += 1;
        }
        let node = a.get_mut(e)?;
        *node = new_freq | (*node & SYMBOL_MASK);
        e += 1;
        if e >= last_idx {
            return Some(());
        }
    }
}

/// Counts the codewords of each length in the tree from [`build_tree`], moving those that are too long up.
fn compute_length_counts(
    a: &mut [u32],
    root_idx: usize,
    max_codeword_len: usize,
) -> Option<LenCounts> {
    let mut len_counts: LenCounts = [0; _];
    len_counts[1] = 2;

    *a.get_mut(root_idx)? &= SYMBOL_MASK;

    // A parent always comes after its children, so going backwards its depth is known first.
    for node in (0..root_idx).rev() {
        let parent = (*a.get(node)? >> NUM_SYMBOL_BITS) as usize;
        let parent_depth = *a.get(parent)? >> NUM_SYMBOL_BITS;
        let mut depth = parent_depth as usize + 1;
        let entry = a.get_mut(node)?;
        *entry = (*entry & SYMBOL_MASK) | ((depth as u32) << NUM_SYMBOL_BITS);

        if depth >= max_codeword_len {
            depth = max_codeword_len;
            loop {
                depth = depth.checked_sub(1)?;
                if *len_counts.get(depth)? != 0 {
                    break;
                }
            }
        }

        // This node is not a leaf after all, and for now its two children are.
        *len_counts.get_mut(depth)? -= 1;
        *len_counts.get_mut(depth + 1)? += 2;
    }
    Some(len_counts)
}

/// DEFLATE stores codewords starting from their most significant bit.
#[inline(always)]
fn reverse_codeword(codeword: u32, len: u8) -> u32 {
    u32::from((codeword as u16).reverse_bits()) >> (16 - u32::from(len))
}

/// Gives the longest codewords to the rarest symbols, which come first in `a`, then overwrites `a` with the codewords.
fn gen_codewords(
    a: &mut [u32],
    lens: &mut [u8],
    len_counts: &LenCounts,
    max_codeword_len: usize,
) -> Option<()> {
    let mut sorted = a.iter();
    for len in (1..=max_codeword_len).rev() {
        for _ in 0..*len_counts.get(len)? {
            *lens.get_mut((sorted.next()? & SYMBOL_MASK) as usize)? = len as u8;
        }
    }

    let mut next_codewords = [0u32; MAX_CODEWORD_LEN + 1];
    for len in 2..=max_codeword_len {
        *next_codewords.get_mut(len)? =
            (*next_codewords.get(len - 1)? + *len_counts.get(len - 1)?) << 1;
    }
    for (codeword, &len) in a.iter_mut().zip(lens.iter()) {
        let next = next_codewords.get_mut(usize::from(len))?;
        *codeword = reverse_codeword(*next, len);
        *next += 1;
    }
    Some(())
}

/// Builds the code for `freqs`. A symbol that is not used gets length 0 and a meaningless codeword.
pub(crate) fn make_huffman_code(
    max_codeword_len: usize,
    freqs: &[u32],
    lens: &mut [u8],
    codewords: &mut [u32],
) -> Option<()> {
    let num_used_syms = sort_symbols(freqs, lens, codewords)?;

    // Some decompressors refuse a code of fewer than two codewords, so there are always two.
    if num_used_syms < 2 {
        let sym = if num_used_syms != 0 {
            (codewords.first()? & SYMBOL_MASK) as usize
        } else {
            0
        };
        let nonzero_idx = if sym != 0 { sym } else { 1 };
        *codewords.first_mut()? = 0;
        *lens.first_mut()? = 1;
        *codewords.get_mut(nonzero_idx)? = 1;
        *lens.get_mut(nonzero_idx)? = 1;
        return Some(());
    }

    build_tree(codewords.get_mut(..num_used_syms)?)?;
    let len_counts = compute_length_counts(codewords, num_used_syms - 2, max_codeword_len)?;
    gen_codewords(codewords, lens, &len_counts, max_codeword_len)
}
