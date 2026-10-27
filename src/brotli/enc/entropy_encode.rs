//! Building prefix codes.

use crate::common::constants::{
    INITIAL_REPEATED_CODE_LENGTH, NUM_COMMAND_SYMBOLS, REPEAT_PREVIOUS_CODE_LENGTH,
    REPEAT_ZERO_CODE_LENGTH,
};
use crate::util::{Bug, Checked, SliceExt};

/// A node of a Huffman tree.
#[derive(Clone, Copy, Default)]
pub(crate) struct HuffmanTree {
    pub(crate) total_count: u32,
    /// Negative for a leaf.
    pub(crate) index_left: i16,
    pub(crate) index_right_or_value: i16,
}

impl HuffmanTree {
    #[inline(always)]
    pub(crate) const fn new(count: u32, left: i16, right: i16) -> Self {
        Self {
            total_count: count,
            index_left: left,
            index_right_or_value: right,
        }
    }
}

static SHELL_GAPS: [usize; 6] = [132, 57, 23, 10, 4, 1];

/// Sorts so that `comparator(a, b)` holds for no `b` before `a`. Where the comparator leaves the order of two items open,
/// the output depends on it, so this has to be the very algorithm of the reference encoder.
#[inline(always)]
fn sort_huffman_tree_items(
    items: &mut [HuffmanTree],
    comparator: impl Fn(&HuffmanTree, &HuffmanTree) -> bool,
) -> Checked {
    let n = items.len();
    if n < 13 {
        // Insertion sort.
        for i in 1..n {
            let tmp = items.at(i)?;
            let mut k = i;
            while k > 0 {
                let previous = items.at(k - 1)?;
                if !comparator(&tmp, &previous) {
                    break;
                }
                items.put(k, previous)?;
                k -= 1;
            }
            items.put(k, tmp)?;
        }
    } else {
        // Shell sort.
        for &gap in SHELL_GAPS.sub(if n < 57 { 2 } else { 0 }..)? {
            for i in gap..n {
                let tmp = items.at(i)?;
                let mut j = i;
                while j >= gap {
                    let previous = items.at(j - gap)?;
                    if !comparator(&tmp, &previous) {
                        break;
                    }
                    items.put(j, previous)?;
                    j -= gap;
                }
                items.put(j, tmp)?;
            }
        }
    }
    Ok(())
}

/// Stores the depth of every leaf below node `p0`. `false` if one is deeper than `max_depth`.
fn set_depth(p0: usize, pool: &[HuffmanTree], depth: &mut [u8], max_depth: usize) -> Checked<bool> {
    let mut stack = [-1i32; 16];
    let mut level = 0usize;
    let mut p = p0;
    loop {
        let node = pool.at(p)?;
        if node.index_left >= 0 {
            level += 1;
            if level > max_depth {
                return Ok(false);
            }
            stack.put(level, i32::from(node.index_right_or_value))?;
            p = node.index_left as usize;
            continue;
        }
        depth.put(node.index_right_or_value as usize, level as u8)?;
        while stack.at(level)? == -1 {
            if level == 0 {
                return Ok(true);
            }
            level -= 1;
        }
        p = stack.at(level)? as usize;
        stack.put(level, -1)?;
    }
}

/// Stores in `depth` the code length of every symbol that occurs in the histogram `data`, none of them over
/// `tree_limit`. `tree` is scratch space of `2 * data.len() + 1` nodes.
///
/// To limit the depth, the smallest counts are raised until the tree fits.
pub(crate) fn create_huffman_tree(
    data: &[u32],
    tree_limit: usize,
    tree: &mut [HuffmanTree],
    depth: &mut [u8],
) -> Checked {
    create_huffman_tree_sorted_by(data, tree_limit, tree, depth, |v0, v1| {
        if v0.total_count != v1.total_count {
            return v0.total_count < v1.total_count;
        }
        v0.index_right_or_value > v1.index_right_or_value
    })
}

/// [`create_huffman_tree`] with nothing to tell symbols of the same count apart, which can give other code lengths.
pub(crate) fn create_huffman_tree_fast(
    data: &[u32],
    tree_limit: usize,
    tree: &mut [HuffmanTree],
    depth: &mut [u8],
) -> Checked {
    create_huffman_tree_sorted_by(data, tree_limit, tree, depth, |v0, v1| {
        v0.total_count < v1.total_count
    })
}

/// `comes_first` puts the leaves in the order of their counts.
#[inline(always)]
fn create_huffman_tree_sorted_by(
    data: &[u32],
    tree_limit: usize,
    tree: &mut [HuffmanTree],
    depth: &mut [u8],
    comes_first: impl Fn(&HuffmanTree, &HuffmanTree) -> bool,
) -> Checked {
    let sentinel = HuffmanTree::new(u32::MAX, -1, -1);
    let mut count_limit = 1u32;
    loop {
        let mut n = 0usize;
        for (i, &count) in data.iter().enumerate().rev() {
            if count != 0 {
                tree.put(n, HuffmanTree::new(count.max(count_limit), -1, i as i16))?;
                n += 1;
            }
        }

        if n == 1 {
            depth.put(tree.at(0)?.index_right_or_value as usize, 1)?;
            return Ok(());
        }

        sort_huffman_tree_items(tree.sub_mut(..n)?, &comes_first)?;

        // [0, n) are the sorted leaves, [n] is a sentinel, parents are added from n + 1 on, in ascending order, and are
        // followed by a sentinel too.
        tree.put(n, sentinel)?;
        tree.put(n + 1, sentinel)?;

        let mut i = 0usize;
        let mut j = n + 1;
        for k in (1..n).rev() {
            let mut take_smaller = |tree: &[HuffmanTree]| -> Checked<usize> {
                if tree.at(i)?.total_count <= tree.at(j)?.total_count {
                    i += 1;
                    Ok(i - 1)
                } else {
                    j += 1;
                    Ok(j - 1)
                }
            };
            let left = take_smaller(tree)?;
            let right = take_smaller(tree)?;
            let j_end = 2 * n - k;
            let total_count = tree
                .at(left)?
                .total_count
                .wrapping_add(tree.at(right)?.total_count);
            tree.put(
                j_end,
                HuffmanTree::new(total_count, left as i16, right as i16),
            )?;
            tree.put(j_end + 1, sentinel)?;
        }
        if set_depth((2 * n).checked_sub(1).ok_or(Bug)?, tree, depth, tree_limit)? {
            return Ok(());
        }
        count_limit = count_limit.wrapping_mul(2);
    }
}

/// The code lengths of a prefix code as they are written: with runs replaced by repeat codes.
pub(crate) struct CodeLengthSymbols {
    len: usize,
    symbols: [u8; Self::MAX_LEN],
    extra_bits: [u8; Self::MAX_LEN],
}

impl CodeLengthSymbols {
    /// The distance alphabet can be larger than that of the commands, but no more than
    /// [`super::histogram::NUM_HISTOGRAM_DISTANCE_SYMBOLS`] of it are in use.
    const MAX_LEN: usize = NUM_COMMAND_SYMBOLS;

    pub(crate) const fn new() -> Self {
        Self {
            len: 0,
            symbols: [0; Self::MAX_LEN],
            extra_bits: [0; Self::MAX_LEN],
        }
    }

    /// The symbols, and the extra bits of each.
    pub(crate) fn get(&self) -> Checked<(&[u8], &[u8])> {
        Ok((
            self.symbols.sub(..self.len)?,
            self.extra_bits.sub(..self.len)?,
        ))
    }

    fn push(&mut self, symbol: u8, extra_bits: u8) -> Checked {
        self.symbols.put(self.len, symbol)?;
        self.extra_bits.put(self.len, extra_bits)?;
        self.len += 1;
        Ok(())
    }

    fn reverse_from(&mut self, start: usize) -> Checked {
        self.symbols.sub_mut(start..self.len)?.reverse();
        self.extra_bits.sub_mut(start..self.len)?.reverse();
        Ok(())
    }

    fn write_repetitions(
        &mut self,
        previous_value: u8,
        value: u8,
        mut repetitions: usize,
    ) -> Checked {
        if previous_value != value {
            self.push(value, 0)?;
            repetitions -= 1;
        }
        if repetitions == 7 {
            self.push(value, 0)?;
            repetitions -= 1;
        }
        if repetitions < 3 {
            for _ in 0..repetitions {
                self.push(value, 0)?;
            }
        } else {
            let start = self.len;
            repetitions -= 3;
            loop {
                self.push(REPEAT_PREVIOUS_CODE_LENGTH as u8, (repetitions & 3) as u8)?;
                repetitions >>= 2;
                if repetitions == 0 {
                    break;
                }
                repetitions -= 1;
            }
            self.reverse_from(start)?;
        }
        Ok(())
    }

    fn write_repetitions_zeros(&mut self, mut repetitions: usize) -> Checked {
        if repetitions == 11 {
            self.push(0, 0)?;
            repetitions -= 1;
        }
        if repetitions < 3 {
            for _ in 0..repetitions {
                self.push(0, 0)?;
            }
        } else {
            let start = self.len;
            repetitions -= 3;
            loop {
                self.push(REPEAT_ZERO_CODE_LENGTH as u8, (repetitions & 7) as u8)?;
                repetitions >>= 3;
                if repetitions == 0 {
                    break;
                }
                repetitions -= 1;
            }
            self.reverse_from(start)?;
        }
        Ok(())
    }

    /// Appends the code lengths `depth`.
    pub(crate) fn append(&mut self, depth: &[u8]) -> Checked {
        let length = depth.len();
        let new_length = length - depth.iter().rev().take_while(|&&d| d == 0).count();
        let depth = depth.sub(..new_length)?;

        // Short codes do not seem to benefit from repeat codes.
        let (use_rle_for_non_zero, use_rle_for_zero) = if length > 50 {
            decide_over_rle_use(depth)
        } else {
            (false, false)
        };

        let mut previous_value = INITIAL_REPEATED_CODE_LENGTH as u8;
        let mut i = 0;
        while i < new_length {
            let value = depth.at(i)?;
            let mut reps = 1;
            if (value != 0 && use_rle_for_non_zero) || (value == 0 && use_rle_for_zero) {
                reps = run_length(depth.sub(i..)?);
            }
            if value == 0 {
                self.write_repetitions_zeros(reps)?;
            } else {
                self.write_repetitions(previous_value, value, reps)?;
                previous_value = value;
            }
            i += reps;
        }
        Ok(())
    }
}

/// How many elements at the start of `values` equal the first.
fn run_length(values: &[u8]) -> usize {
    values.first().map_or(0, |first| {
        values.iter().take_while(|&value| value == first).count()
    })
}

/// Changes the histogram `counts`, of at most [`NUM_COMMAND_SYMBOLS`], so that the code lengths of its prefix code have
/// longer runs, which take less room.
pub(crate) fn optimize_huffman_counts_for_rle(counts: &mut [u32]) -> Checked {
    const STREAK_LIMIT: usize = 1240;
    let nonzeros = counts.iter().filter(|&&count| count != 0).count();
    if nonzeros < 16 {
        return Ok(());
    }
    let length = counts.len() - counts.iter().rev().take_while(|&&count| count == 0).count();
    let counts = counts.sub_mut(..length)?;
    if length - nonzeros < 6 && counts.iter().any(|&count| count != 0 && count < 4) {
        for i in 1..length - 1 {
            if counts.at(i - 1)? != 0 && counts.at(i)? == 0 && counts.at(i + 1)? != 0 {
                counts.put(i, 1)?;
            }
        }
    }
    if nonzeros < 28 {
        return Ok(());
    }
    // Mark the runs that are already good, so as not to spoil them: 5 zeros or more, or 7 equal counts or more.
    let mut good_for_rle = [false; NUM_COMMAND_SYMBOLS];
    let good_for_rle = good_for_rle.sub_mut(..length)?;
    {
        let mut symbol = counts.at(0)?;
        let mut step = 0usize;
        for i in 0..=length {
            if i == length || counts.at(i)? != symbol {
                if (symbol == 0 && step >= 5) || (symbol != 0 && step >= 7) {
                    good_for_rle.sub_mut(i - step..i)?.fill(true);
                }
                step = 1;
                if i != length {
                    symbol = counts.at(i)?;
                }
            } else {
                step += 1;
            }
        }
    }
    // Replace counts that are close to each other by their average. The math is in 24.8 fixed point.
    let limit_of_three = |a: u32, b: u32, c: u32| {
        (256u32.wrapping_mul(a.wrapping_add(b).wrapping_add(c)) / 3 + 420) as usize
    };
    let mut stride = 0usize;
    let mut limit = limit_of_three(counts.at(0)?, counts.at(1)?, counts.at(2)?);
    let mut sum = 0usize;
    for i in 0..=length {
        if i == length
            || good_for_rle.at(i)?
            || (i != 0 && good_for_rle.at(i - 1)?)
            || (256u32.wrapping_mul(counts.at(i)?) as usize)
                .wrapping_sub(limit)
                .wrapping_add(STREAK_LIMIT)
                >= 2 * STREAK_LIMIT
        {
            if stride >= 4 || (stride >= 3 && sum == 0) {
                // The stride ends here. A stride of zeros stays one.
                let count = if sum == 0 {
                    0
                } else {
                    ((sum + stride / 2) / stride).max(1)
                };
                counts.sub_mut(i - stride..i)?.fill(count as u32);
            }
            stride = 0;
            sum = 0;
            limit = if i + 2 < length {
                limit_of_three(counts.at(i)?, counts.at(i + 1)?, counts.at(i + 2)?)
            } else if i < length {
                256u32.wrapping_mul(counts.at(i)?) as usize
            } else {
                0
            };
        }
        stride += 1;
        if i != length {
            sum += counts.at(i)? as usize;
            if stride >= 4 {
                limit = (256 * sum + stride / 2) / stride;
            }
            if stride == 4 {
                limit += 120;
            }
        }
    }
    Ok(())
}

/// Whether to use the repeat codes for lengths other than 0, and for 0.
fn decide_over_rle_use(depth: &[u8]) -> (bool, bool) {
    let mut total_reps_zero = 0usize;
    let mut total_reps_non_zero = 0usize;
    let mut count_reps_zero = 1usize;
    let mut count_reps_non_zero = 1usize;
    let mut rest = depth;
    while let Some(&value) = rest.first() {
        let reps = run_length(rest);
        if reps >= 3 && value == 0 {
            total_reps_zero += reps;
            count_reps_zero += 1;
        }
        if reps >= 4 && value != 0 {
            total_reps_non_zero += reps;
            count_reps_non_zero += 1;
        }
        rest = rest.get(reps..).unwrap_or_default();
    }
    (
        total_reps_non_zero > count_reps_non_zero * 2,
        total_reps_zero > count_reps_zero * 2,
    )
}

/// The low `num_bits` of `bits` in reverse order.
fn reverse_bits(num_bits: u32, bits: u16) -> u16 {
    bits.reverse_bits() >> (16 - num_bits)
}

/// Stores in `bits` the code of every symbol whose code length in `depth` is not 0.
pub(crate) fn convert_bit_depths_to_symbols(depth: &[u8], bits: &mut [u16]) -> Checked {
    const MAX_HUFFMAN_BITS: usize = 16;
    let mut bl_count = [0u16; MAX_HUFFMAN_BITS];
    let mut next_code = [0u16; MAX_HUFFMAN_BITS];
    for &d in depth {
        *bl_count.at_mut(usize::from(d))? += 1;
    }
    bl_count[0] = 0;
    let mut code = 0u32;
    for (next_code, &count) in next_code.iter_mut().skip(1).zip(&bl_count) {
        code = (code + u32::from(count)) << 1;
        *next_code = code as u16;
    }
    for (&d, bits) in depth.iter().zip(bits) {
        if d != 0 {
            let next_code = next_code.at_mut(usize::from(d))?;
            *bits = reverse_bits(u32::from(d), *next_code);
            *next_code = next_code.wrapping_add(1);
        }
    }
    Ok(())
}
