//! Long runs of literals. Decoding from a wrong place soon falls in step with the codes, so several parts are decoded at once.

use bun_highway::brotli_decoder::{Root, Symbol};

use super::{LiteralTrees, Tables};

/// With fewer literals, it does not pay.
pub(super) const MIN_COUNT: usize = 384;
const LANES: usize = 4;
/// So many codes from a root fit in a word.
const GROUP: usize = 5;
const MAX_GROUPS: usize = 64;
/// Above the bits, to tell how many are gone.
const MARK: u64 = 1 << 63;

#[inline(always)]
fn word_at(input: &[u8], bit: u32) -> Option<u64> {
    let at = (bit / 8) as usize;
    let word = input.get(at..at + size_of::<u64>())?.as_array()?;
    Some((u64::from_le_bytes(*word) >> (bit % 8)) | MARK)
}

/// What the last literals add to the next context, and to the one after it.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Context([u32; 2]);

impl Context {
    #[inline(always)]
    fn before<T: LiteralTrees>(tables: &Tables<'_>, bytes: &[u8], at: usize) -> Option<Self> {
        if !T::IN_CONTEXT {
            return Some(Self([0; 2]));
        }
        let [second_last, last] = *bytes.get(..at)?.last_chunk()?;
        let [now, next] = tables.codes.mode_in_trees.parts().of(last);
        let [_, more] = tables.codes.mode_in_trees.parts().of(second_last);
        Some(Self([now | more, next].map(u32::from)))
    }

    #[inline(always)]
    fn advance<T: LiteralTrees>(&mut self, symbol: Symbol) {
        if T::IN_CONTEXT {
            let [now, next] = symbol.context_parts();
            self.0 = [now | self.0[1], next];
        }
    }
}

struct Lanes {
    literals: [[[u8; GROUP]; MAX_GROUPS]; LANES],
    /// Where each group starts in the input, and where the last one ends.
    starts: [[u32; MAX_GROUPS + 1]; LANES],
}

impl Lanes {
    /// Fails near the end of the input.
    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Within the sizes of the arrays.
    fn decode<T: LiteralTrees>(
        &mut self,
        trees: &T,
        root: Root,
        input: &[u8],
        context: Context,
        groups: usize,
    ) -> Option<()> {
        let mut contexts = [context; LANES];
        for group in 0..groups.min(MAX_GROUPS) {
            let mut words = [0; LANES];
            for lane in 0..LANES {
                words[lane] = word_at(input, self.starts[lane][group])?;
                self.starts[lane][group + 1] = self.starts[lane][group];
            }
            for at in 0..GROUP {
                for lane in 0..LANES {
                    let tree = trees.of(contexts[lane].0[0]);
                    let mut symbol = Symbol::in_root(tree, root, words[lane]);
                    let word = words[lane];
                    words[lane] >>= symbol.length();
                    if symbol.is_link() {
                        core::hint::cold_path();
                        let bit = &mut self.starts[lane][group + 1];
                        *bit += word.leading_zeros();
                        symbol = symbol.resolve(tree, root, word_at(input, *bit)?);
                        *bit += symbol.length();
                        words[lane] = word_at(input, *bit)?;
                    }
                    self.literals[lane][group][at] = symbol.literal().0;
                    contexts[lane].advance::<T>(symbol);
                }
            }
            for lane in 0..LANES {
                self.starts[lane][group + 1] += words[lane].leading_zeros();
            }
        }
        Some(())
    }
}

/// Moves `position`, which is two or more, closer to the end of `out`, and `bit` on in `input`. Returns whether that paid.
#[inline(always)]
pub(super) fn read<T: LiteralTrees>(
    tables: &Tables<'_>,
    trees: &T,
    can_guess: bool,
    input: &[u8],
    bit: &mut u32,
    out: &mut [u8],
    position: &mut usize,
) -> Option<bool> {
    let root = tables.codes.literal_root;
    let mut context = Context::before::<T>(tables, out, *position)?;
    let tree = trees.of(context.0[0]);
    if can_guess && Symbol::in_root(tree, root, word_at(input, *bit)?).has_usual_length() {
        return Some(false);
    }
    let mut bits_for_256: u32 = tree.iter().take(256).map(|it| it.length().min(11)).sum();
    let mut lanes = Lanes {
        literals: [[[0; _]; _]; _],
        starts: [[0; _]; _],
    };
    let (mut overlap, mut misses) = (3 * GROUP, 0);
    while out.len() - *position >= MIN_COUNT / 2 {
        let in_input = (8 * input.len() - *bit as usize) * 240 / (bits_for_256 as usize + 1);
        let groups = ((out.len() - *position).min(in_input) / (LANES * GROUP)).min(MAX_GROUPS);
        let count = groups * GROUP;
        let stride = (count - overlap.min(count / 3)) as u32 * bits_for_256 / 256;
        for (lane, starts) in lanes.starts.iter_mut().enumerate() {
            starts[0] = *bit + lane as u32 * stride;
        }
        if count * LANES < MIN_COUNT / 2 {
            break;
        }
        lanes.decode(trees, root, input, context, groups)?;

        let (first_bit, first_position, mut one_by_one) = (*bit, *position, 0);
        for (literals, starts) in lanes.literals.iter().zip(&lanes.starts) {
            let (literals, starts) = (
                literals.as_flattened().get(..count)?,
                starts.get(..=groups)?,
            );
            let (&end, starts) = starts.split_last()?;
            let passed = starts.partition_point(|start| start < bit);
            for (group, &start) in starts.iter().enumerate().skip(passed) {
                while *bit < start {
                    let (tree, word) = (trees.of(context.0[0]), word_at(input, *bit)?);
                    let symbol = Symbol::in_root(tree, root, word).resolve(tree, root, word);
                    *out.get_mut(*position)? = symbol.literal().0;
                    (*position, *bit) = (*position + 1, *bit + symbol.length());
                    context.advance::<T>(symbol);
                    one_by_one += 1;
                }
                let in_lane = || Context::before::<T>(tables, literals, group * GROUP);
                if *bit == start && (*position == first_position || in_lane() == Some(context)) {
                    let rest = literals.get(group * GROUP..)?;
                    (out.get_mut(*position..*position + rest.len())?).copy_from_slice(rest);
                    (*position, *bit) = (*position + rest.len(), end);
                    context = Context::before::<T>(tables, out, *position)?;
                    break;
                }
            }
        }
        bits_for_256 = (*bit - first_bit) * 256 / (*position - first_position) as u32;
        overlap = (3 * overlap + one_by_one) / 4 + GROUP / 2;
        misses = if one_by_one > count { misses + 1 } else { 0 };
        if misses == 2 {
            return Some(false);
        }
    }
    Some(misses == 0)
}
