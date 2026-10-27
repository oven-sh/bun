//! STUB: to be replaced by the port of backward_references_hq.c.
use super::Fallible;
use super::command::Command;
use super::hash::Hasher;
use super::params::EncoderParams;
use crate::common::context::ContextLut;
use crate::util::Bug;

pub(crate) fn create_zopfli_backward_references(
    _num_bytes: usize,
    _position: usize,
    _ringbuffer: &[u8],
    _ringbuffer_mask: usize,
    _literal_context_lut: &ContextLut,
    _params: &EncoderParams,
    _hasher: &mut Hasher,
    _dist_cache: &mut [i32; 16],
    _last_insert_len: &mut usize,
    _commands: &mut Vec<Command>,
    _num_literals: &mut usize,
) -> Fallible {
    Err(Bug.into())
}

pub(crate) fn create_hq_zopfli_backward_references(
    _num_bytes: usize,
    _position: usize,
    _ringbuffer: &[u8],
    _ringbuffer_mask: usize,
    _literal_context_lut: &ContextLut,
    _params: &EncoderParams,
    _hasher: &mut Hasher,
    _dist_cache: &mut [i32; 16],
    _last_insert_len: &mut usize,
    _commands: &mut Vec<Command>,
    _num_literals: &mut usize,
) -> Fallible {
    Err(Bug.into())
}
