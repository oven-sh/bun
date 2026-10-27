//! STUB: to be replaced by the port of block_splitter.c and block_splitter_inc.h.
use super::Fallible;
use super::command::Command;
use super::params::EncoderParams;
use crate::util::Bug;

#[derive(Default)]
pub(crate) struct BlockSplit {
    /// How many different types there are.
    pub(crate) num_types: usize,
    /// How many elements of `types` and `lengths` count. Both can be longer.
    pub(crate) num_blocks: usize,
    pub(crate) types: Vec<u8>,
    pub(crate) lengths: Vec<u32>,
}

pub(crate) fn split_block(
    _cmds: &[Command],
    _data: &[u8],
    _offset: usize,
    _mask: usize,
    _params: &EncoderParams,
    _literal_split: &mut BlockSplit,
    _insert_and_copy_split: &mut BlockSplit,
    _dist_split: &mut BlockSplit,
) -> Fallible {
    Err(Bug.into())
}
