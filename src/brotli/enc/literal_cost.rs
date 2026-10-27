//! STUB: to be replaced by the port of literal_cost.c.
use crate::util::{Bug, Checked};

pub(crate) fn estimate_bit_costs_for_literals(
    _pos: usize,
    _len: usize,
    _mask: usize,
    _data: &[u8],
    _histogram: &mut [usize],
    _cost: &mut [f32],
) -> Checked {
    Err(Bug)
}
