//! STUB: to be replaced by the port of backward_references.c and backward_references_inc.h.
use super::command::Command;
use super::hash::Hasher;
use super::params::EncoderParams;
use crate::common::context::ContextLut;
use crate::util::{Bug, Checked};

pub(crate) fn create_backward_references(
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
) -> Checked {
    Err(Bug)
}
