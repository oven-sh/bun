//! STUB: to be replaced by the port of hash.h and the hash_*_inc.h files.
use super::Fallible;
use super::compound_dictionary::CompoundDictionary;
use super::params::EncoderParams;
use crate::util::{Bug, Checked};

pub(crate) const HASH_MUL_32: u32 = 0x1E35_A7BD;

#[derive(Clone, Copy, Default)]
pub(crate) struct BackwardMatch {
    pub(crate) distance: u32,
    pub(crate) length_and_code: u32,
}

pub(crate) const MAX_NUM_MATCHES_H10: usize = 128;

pub(crate) struct H10 {}

impl H10 {
    pub(crate) fn find_all_matches(
        &mut self,
        _data: &[u8],
        _ring_buffer_mask: usize,
        _cur_ix: usize,
        _max_length: usize,
        _max_backward: usize,
        _dictionary_distance: usize,
        _params: &EncoderParams,
        _matches: &mut [BackwardMatch],
    ) -> Checked<usize> {
        Err(Bug)
    }
    pub(crate) fn store(&mut self, _data: &[u8], _mask: usize, _ix: usize) -> Checked {
        Err(Bug)
    }
    pub(crate) fn store_range(&mut self, _data: &[u8], _mask: usize, _ix_start: usize, _ix_end: usize) -> Checked {
        Err(Bug)
    }
}

pub(crate) struct Hasher {}

impl Hasher {
    pub(crate) fn new() -> Self {
        Self {}
    }
    pub(crate) fn reset(&mut self) {}
    pub(crate) fn init_or_stitch_to_previous_block(
        &mut self,
        _data: &[u8],
        _mask: usize,
        _params: &mut EncoderParams,
        _position: usize,
        _input_size: usize,
        _is_last: bool,
    ) -> Fallible {
        Err(Bug.into())
    }
    pub(crate) fn h10_mut(&mut self) -> Checked<&mut H10> {
        Err(Bug)
    }
}

pub(crate) fn lookup_all_compound_dictionary_matches(
    _addon: &CompoundDictionary,
    _data: &[u8],
    _ring_buffer_mask: usize,
    _cur_ix: usize,
    _min_length: usize,
    _max_length: usize,
    _max_ring_buffer_distance: usize,
    _max_distance: usize,
    _matches: &mut [BackwardMatch],
) -> Checked<usize> {
    Err(Bug)
}
