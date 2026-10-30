//! What the three matchfinders share. They keep positions relative to a base that moves up by a window at a time.

use crate::constants::DEFLATE_WINDOW_ORDER;

pub(crate) const WINDOW_SIZE: usize = 1 << DEFLATE_WINDOW_ORDER;

pub(crate) type Pos = i16;

/// A position that is always out of the window.
pub(crate) const INITVAL: Pos = Pos::MIN;

const _: () = assert!(INITVAL as isize == -(WINDOW_SIZE as isize));

/// What the hash table and hash chains matchfinders find.
#[derive(Clone, Copy)]
pub(crate) struct Match {
    pub(crate) length: u32,
    pub(crate) offset: u32,
}

/// A table of `N` times [`INITVAL`] on the heap, or `None` if there is no memory for it.
pub(crate) fn new_table<const N: usize>() -> Option<Box<[Pos; N]>> {
    let mut table = crate::vec_with_capacity(N)?;
    table.resize(N, INITVAL);
    table.into_boxed_slice().try_into().ok()
}

/// Subtracts the window size from every position. Those already before the window stay there.
pub(crate) fn rebase(table: &mut [Pos]) {
    for pos in table {
        *pos = pos.saturating_add(INITVAL);
    }
}

#[inline(always)]
pub(crate) fn lz_hash(seq: u32, num_bits: u32) -> u32 {
    seq.wrapping_mul(0x1E35_A7BD) >> (32 - num_bits)
}

#[inline(always)]
pub(crate) fn load_u32(input: &[u8], pos: usize) -> Option<u32> {
    Some(u32::from_le_bytes(*input.get(pos..)?.first_chunk()?))
}

#[inline(always)]
pub(crate) fn load_u24(input: &[u8], pos: usize) -> Option<u32> {
    Some(load_u32(input, pos)? & 0xFF_FFFF)
}

/// Where the node `node` is in the input.
#[inline(always)]
pub(crate) fn node_pos(in_base: usize, node: i32) -> usize {
    in_base.wrapping_add_signed(node as isize)
}

/// How many bytes at `match_pos` equal those at `str_pos`, up to `max_len`, given that the first `start_len` do.
#[inline(always)]
pub(crate) fn lz_extend(
    input: &[u8],
    str_pos: usize,
    match_pos: usize,
    start_len: u32,
    max_len: u32,
) -> Option<u32> {
    let rest = max_len.checked_sub(start_len)? as usize;
    let str_bytes = input.get(str_pos + start_len as usize..)?.get(..rest)?;
    let match_bytes = input.get(match_pos + start_len as usize..)?.get(..rest)?;

    let (str_words, str_tail) = str_bytes.as_chunks::<8>();
    let (match_words, match_tail) = match_bytes.as_chunks::<8>();
    let mut len = start_len;
    for (a, b) in str_words.iter().zip(match_words) {
        let difference = u64::from_le_bytes(*a) ^ u64::from_le_bytes(*b);
        if difference != 0 {
            return Some(len + (difference.trailing_zeros() >> 3));
        }
        len += 8;
    }
    for (a, b) in str_tail.iter().zip(match_tail) {
        if a != b {
            break;
        }
        len += 1;
    }
    Some(len)
}
