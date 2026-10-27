//! STUB: to be replaced by the port of metablock.c and metablock_inc.h.
use super::Fallible;
use super::block_splitter::BlockSplit;
use super::command::Command;
use super::histogram::{HistogramCommand, HistogramDistance, HistogramLiteral};
use super::params::{DistanceParams, EncoderParams};
use crate::common::context::{ContextLut, ContextType};
use crate::util::{Bug, Checked};

pub(crate) const MAX_STATIC_CONTEXTS: usize = 13;

/// The length of each `Vec` is what the `*_size` field next to the pointer is in the reference encoder.
#[derive(Default)]
pub(crate) struct MetaBlockSplit {
    pub(crate) literal_split: BlockSplit,
    pub(crate) command_split: BlockSplit,
    pub(crate) distance_split: BlockSplit,
    pub(crate) literal_context_map: Vec<u32>,
    pub(crate) distance_context_map: Vec<u32>,
    pub(crate) literal_histograms: Vec<HistogramLiteral>,
    pub(crate) command_histograms: Vec<HistogramCommand>,
    pub(crate) distance_histograms: Vec<HistogramDistance>,
}

/// `dist` starts as a copy of `params.dist` and is what the reference encoder's `params->dist` is here.
pub(crate) fn build_meta_block(
    _ringbuffer: &[u8],
    _pos: usize,
    _mask: usize,
    _params: &EncoderParams,
    _dist: &mut DistanceParams,
    _prev_byte: u8,
    _prev_byte2: u8,
    _cmds: &mut [Command],
    _literal_context_mode: ContextType,
    _mb: &mut MetaBlockSplit,
) -> Fallible {
    Err(Bug.into())
}

pub(crate) fn build_meta_block_greedy(
    _ringbuffer: &[u8],
    _pos: usize,
    _mask: usize,
    _prev_byte: u8,
    _prev_byte2: u8,
    _literal_context_lut: &ContextLut,
    _num_contexts: usize,
    _static_context_map: Option<&[u32; 64]>,
    _commands: &[Command],
    _mb: &mut MetaBlockSplit,
) -> Fallible {
    Err(Bug.into())
}

pub(crate) fn optimize_histograms(_num_distance_codes: u32, _mb: &mut MetaBlockSplit) -> Checked {
    Err(Bug)
}

pub(crate) fn init_distance_params(_dist: &mut DistanceParams, _npostfix: u32, _ndirect: u32, _large_window: bool) {}
