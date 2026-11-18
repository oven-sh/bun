//! RFC 7932 section 7.3.

use super::bit_reader::BitReader;
use super::huffman::{Forest, Symbol, read_symbol};
use super::prefix_code::PrefixCodeReader;
use super::{Stop, read_count};
use crate::format::Alphabet;
use crate::{DecodeError, memory};

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
    pub(super) trees: Vec<u8>,
    pub(super) tree_count: u32,
    phase: Phase,
    max_run_length_code: u32,
    next: usize,
}

impl ContextMap {
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
                    self.trees.clear();
                    self.trees
                        .try_reserve(size)
                        .map_err(|_| DecodeError::AllocContextMap)?;
                    memory::resize(&mut self.trees, size, 0);
                    if self.tree_count == 1 {
                        return Ok(());
                    }
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
        while let Some(slot) = self.trees.get_mut(self.next) {
            // A code and its extra bits.
            reader.refill_for(32);
            let mut bits = reader.bits;
            let code = read_symbol(tree, &mut bits)?;
            if code > self.max_run_length_code {
                *slot = (code - self.max_run_length_code) as u8;
                self.next += 1;
            } else {
                self.next += (1 << code) + bits.read(code)? as usize;
            }
            reader.bits = bits;
        }
        if self.next > self.trees.len() {
            return Err(DecodeError::ContextMapRepeat.into());
        }
        Ok(())
    }
}

fn inverse_move_to_front(values: &mut [u8]) {
    // The first eight entries of the list, which most values refer to.
    let mut front = u64::from_le_bytes([0, 1, 2, 3, 4, 5, 6, 7]);
    let mut others: [u8; 248] = core::array::from_fn(|i| i as u8 + 8);
    for value in values {
        let index = usize::from(*value);
        if index == 0 {
            *value = front as u8;
            continue;
        }
        let kept = match others.get(index.wrapping_sub(8)) {
            None => {
                *value = (front >> (8 * index)) as u8;
                (u64::MAX << 8) << (8 * index)
            }
            Some(&moved) => {
                *value = moved;
                others.copy_within(..index - 8, 1);
                others[0] = (front >> 56) as u8;
                0
            }
        };
        front = (front & kept) | (((front << 8) | u64::from(*value)) & !kept);
    }
}
