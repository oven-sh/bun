//! STUB: to be replaced by the port of static_dict.c.
use crate::util::{Bug, Checked};

pub(crate) const MAX_STATIC_DICTIONARY_MATCH_LEN: usize = 37;
pub(crate) const INVALID_MATCH: u32 = 0xFFF_FFFF;

pub(crate) fn find_all_static_dictionary_matches(
    _data: &[u8],
    _min_length: usize,
    _max_length: usize,
    _matches: &mut [u32; MAX_STATIC_DICTIONARY_MATCH_LEN + 1],
) -> Checked<bool> {
    Err(Bug)
}
