//! RFC 7932 section 7.3.

use super::bit_reader::BitReader;
use super::huffman::{Forest, read_symbol};
use super::prefix_code::PrefixCodeReader;
use super::{Stop, read_count};
use crate::format::Alphabet;
use crate::{DecodeError, memory};
use bun_highway::brotli_decoder::Symbol;
use core::hint::select_unpredictable;

#[derive(Default, Clone, Copy)]
enum Phase {
    #[default]
    TreeCount,
    MaxRunLength,
    Code,
    Values,
    Transform,
}

/// Which tree each context of each block type uses.
#[derive(Default)]
pub(super) struct ContextMap {
    trees: Vec<u8>,
    pub(super) tree_count: u32,
    phase: Phase,
    max_run_length_code: u32,
    next: usize,
}

impl ContextMap {
    /// For the `N` contexts of a block type.
    #[inline(always)]
    pub(super) fn of<const N: usize>(&self, block_type: usize) -> &[u8; N] {
        let trees = self.trees.as_chunks().0.get(block_type);
        trees.filter(|_| self.tree_count > 1).unwrap_or(&[0; N])
    }

    pub(super) fn read(
        &mut self,
        size: usize,
        reader: &mut BitReader<'_>,
        codes: &mut PrefixCodeReader,
        forest: &mut Forest<Symbol>,
    ) -> Result<(), Stop> {
        loop {
            self.phase = match self.phase {
                Phase::TreeCount => {
                    self.tree_count = reader.step(read_count)?;
                    if self.tree_count == 1 {
                        return Ok(());
                    }
                    self.trees.clear();
                    self.trees
                        .try_reserve(size)
                        .map_err(|_| DecodeError::AllocContextMap)?;
                    memory::resize(&mut self.trees, size, 0);
                    self.next = 0;
                    Phase::MaxRunLength
                }
                Phase::MaxRunLength => {
                    self.max_run_length_code = reader.step(|bits| {
                        Ok(if bits.read_flag()? {
                            bits.read(4)? + 1
                        } else {
                            0
                        })
                    })?;
                    Phase::Code
                }
                Phase::Code => {
                    let alphabet = Alphabet::new(self.tree_count + self.max_run_length_code);
                    forest.push_symbols(codes.read(alphabet, reader)?)?;
                    Phase::Values
                }
                Phase::Values => {
                    self.read_values(reader, forest)?;
                    forest.pop();
                    Phase::Transform
                }
                Phase::Transform => {
                    if reader.read(1)? != 0 {
                        inverse_move_to_front(&mut self.trees);
                    }
                    self.phase = Phase::TreeCount;
                    return Ok(());
                }
            };
        }
    }

    fn read_values(
        &mut self,
        reader: &mut BitReader<'_>,
        forest: &Forest<Symbol>,
    ) -> Result<(), Stop> {
        let tree = forest.tree(forest.len().wrapping_sub(1))?;
        let (mut local, mut next, max_run) = (*reader, self.next, self.max_run_length_code);
        let mut read = || -> Result<(), Stop> {
            while let Some(slot) = self.trees.get_mut(next) {
                local.refill();
                let mut bits = local.bits;
                let code = read_symbol(tree, &mut bits)?;
                let extra_bits = select_unpredictable(code > max_run, 0, code);
                next += (1 << extra_bits) + bits.read(extra_bits)? as usize;
                *slot = code.saturating_sub(max_run) as u8;
                local.bits = bits;
            }
            Ok(())
        };
        let result = read();
        (*reader, self.next) = (local, next);
        result?;
        if self.next > self.trees.len() {
            return Err(DecodeError::ContextMapRepeat.into());
        }
        Ok(())
    }
}

#[allow(clippy::indexing_slicing)] // Reduced to the size of the tables.
fn inverse_move_to_front(values: &mut [u8]) {
    const ONES: u64 = u64::MAX / 0xFF;
    // The first eight entries of the list, which most values refer to.
    let mut front = u64::from_le_bytes([0, 1, 2, 3, 4, 5, 6, 7]);
    let mut others: [u8; 248] = core::array::from_fn(|i| i as u8 + 8);
    for part in values.chunks_mut(32) {
        let mut indexes = [0; 32];
        indexes[..part.len()].copy_from_slice(part);
        let words = indexes
            .as_chunks()
            .0
            .iter()
            .map(|&it| u64::from_le_bytes(it));
        let mut changes = words.rfold(0, |all, word| {
            let non_zero = ((((word & (0x7F * ONES)) + 0x7F * ONES) | word) >> 7) & ONES;
            (all << 8) | (non_zero.wrapping_mul(0x0102_0408_1020_4080) >> 56)
        });
        let mut result = [front as u8; 64];
        while changes != 0 {
            let at = changes.trailing_zeros() as usize % 32;
            changes &= changes - 1;
            let index = usize::from(indexes[at]);
            let (value, kept) = match others.get(index.wrapping_sub(8)) {
                None => ((front >> (8 * index)) as u8, (u64::MAX << 8) << (8 * index)),
                Some(&moved) => {
                    others.copy_within(..index - 8, 1);
                    others[0] = (front >> 56) as u8;
                    (moved, 0)
                }
            };
            front = (front & kept) | (((front << 8) | u64::from(value)) & !kept);
            result[at..at + 32].fill(value);
        }
        part.copy_from_slice(&result[..part.len()]);
    }
}
