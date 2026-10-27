//! A command: some literals, followed by a copy of earlier bytes.

use super::fast_log::log2_floor_nonzero;
use super::params::DistanceParams;
use crate::common::constants::NUM_DISTANCE_SHORT_CODES;

/// A distance symbol in the low 10 bits and the number of its extra bits in the high 6.
#[derive(Clone, Copy)]
pub(crate) struct DistancePrefix(u16);

impl DistancePrefix {
    #[inline(always)]
    pub(crate) fn symbol(self) -> usize {
        usize::from(self.0 & 0x3FF)
    }

    #[inline(always)]
    pub(crate) fn num_extra_bits(self) -> u32 {
        u32::from(self.0 >> 10)
    }
}

/// Returns the distance symbol and its extra bits. `distance_code` is one of the 16 short codes, or the distance + 15.
#[inline(always)]
pub(crate) fn prefix_encode_copy_distance(
    distance_code: usize,
    num_direct_codes: usize,
    postfix_bits: usize,
) -> (DistancePrefix, u32) {
    if distance_code < NUM_DISTANCE_SHORT_CODES as usize + num_direct_codes {
        return (DistancePrefix(distance_code as u16), 0);
    }
    let dist = (1usize << (postfix_bits + 2))
        + (distance_code - NUM_DISTANCE_SHORT_CODES as usize - num_direct_codes);
    let bucket = log2_floor_nonzero(dist) as usize - 1;
    let postfix_mask = (1usize << postfix_bits) - 1;
    let postfix = dist & postfix_mask;
    let prefix = (dist >> bucket) & 1;
    let offset = (2 + prefix) << bucket;
    let nbits = bucket - postfix_bits;
    let code = (nbits << 10)
        | (NUM_DISTANCE_SHORT_CODES as usize
            + num_direct_codes
            + ((2 * (nbits - 1) + prefix) << postfix_bits)
            + postfix);
    (
        DistancePrefix(code as u16),
        ((dist - offset) >> postfix_bits) as u32,
    )
}

#[inline(always)]
pub(crate) fn insert_length_code(insert_len: usize) -> u16 {
    if insert_len < 6 {
        insert_len as u16
    } else if insert_len < 130 {
        let nbits = log2_floor_nonzero(insert_len - 2) - 1;
        ((nbits << 1) as usize + ((insert_len - 2) >> nbits) + 2) as u16
    } else if insert_len < 2114 {
        (log2_floor_nonzero(insert_len - 66) + 10) as u16
    } else if insert_len < 6210 {
        21
    } else if insert_len < 22594 {
        22
    } else {
        23
    }
}

#[inline(always)]
pub(crate) fn copy_length_code(copy_len: usize) -> u16 {
    if copy_len < 10 {
        copy_len.wrapping_sub(2) as u16
    } else if copy_len < 134 {
        let nbits = log2_floor_nonzero(copy_len - 6) - 1;
        ((nbits << 1) as usize + ((copy_len - 6) >> nbits) + 4) as u16
    } else if copy_len < 2118 {
        (log2_floor_nonzero(copy_len - 70) + 12) as u16
    } else {
        23
    }
}

#[inline(always)]
pub(crate) fn combine_length_codes(
    insert_code: u16,
    copy_code: u16,
    use_last_distance: bool,
) -> u16 {
    let bits64 = (copy_code & 7) | ((insert_code & 7) << 3);
    if use_last_distance && insert_code < 8 && copy_code < 16 {
        return if copy_code < 8 { bits64 } else { bits64 | 64 };
    }
    // The cells of the last table of section 5 start at K * 64 with K = 2, 3, 6, 4, 5, 8, 7, 9, 10. K less its position
    // in that list takes 2 bits, and the constant holds those, already shifted by 6.
    let offset = 2 * (u32::from(copy_code >> 3) + 3 * u32::from(insert_code >> 3));
    let offset = (offset << 5) + 0x40 + ((0x52_0D40 >> offset) & 0xC0);
    offset as u16 | bits64
}

#[inline(always)]
fn length_code(insert_len: usize, copy_len: usize, use_last_distance: bool) -> u16 {
    combine_length_codes(
        insert_length_code(insert_len),
        copy_length_code(copy_len),
        use_last_distance,
    )
}

#[derive(Clone, Copy)]
pub(crate) struct Command {
    pub(crate) insert_len: u32,
    /// The copy length in the low 25 bits. In the high 7, what to add to it for the length that is encoded, which differs
    /// for a transformed dictionary word.
    copy_len_and_delta: u32,
    /// The extra bits of the distance.
    pub(crate) dist_extra: u32,
    pub(crate) cmd_prefix: u16,
    pub(crate) dist_prefix: DistancePrefix,
}

impl Command {
    /// `distance_code` is as for [`prefix_encode_copy_distance`].
    #[inline(always)]
    pub(crate) fn new(
        dist: &DistanceParams,
        insert_len: usize,
        copy_len: usize,
        copy_len_code_delta: i32,
        distance_code: usize,
    ) -> Self {
        let delta = u32::from(copy_len_code_delta as i8 as u8);
        let (dist_prefix, dist_extra) = prefix_encode_copy_distance(
            distance_code,
            dist.num_direct_distance_codes as usize,
            dist.distance_postfix_bits as usize,
        );
        let cmd_prefix = length_code(
            insert_len,
            (copy_len as i32).wrapping_add(copy_len_code_delta) as usize,
            dist_prefix.symbol() == 0,
        );
        Self {
            insert_len: insert_len as u32,
            copy_len_and_delta: copy_len as u32 | (delta << 25),
            dist_extra,
            cmd_prefix,
            dist_prefix,
        }
    }

    /// Literals at the end of a meta-block, with no copy after them.
    pub(crate) fn new_insert(insert_len: usize) -> Self {
        Self {
            insert_len: insert_len as u32,
            copy_len_and_delta: 4 << 25,
            dist_extra: 0,
            cmd_prefix: length_code(insert_len, 4, false),
            dist_prefix: DistancePrefix(NUM_DISTANCE_SHORT_CODES as u16),
        }
    }

    /// The `distance_code` that [`Self::new`] was given.
    #[inline(always)]
    pub(crate) fn restore_distance_code(&self, dist: &DistanceParams) -> u32 {
        let dcode = self.dist_prefix.symbol() as u32;
        if dcode < NUM_DISTANCE_SHORT_CODES + dist.num_direct_distance_codes {
            return dcode;
        }
        let nbits = self.dist_prefix.num_extra_bits();
        let extra = self.dist_extra;
        let postfix_mask = (1u32 << dist.distance_postfix_bits) - 1;
        let xcode = dcode - dist.num_direct_distance_codes - NUM_DISTANCE_SHORT_CODES;
        let hcode = xcode >> dist.distance_postfix_bits;
        let lcode = xcode & postfix_mask;
        let offset = ((2 + (hcode & 1)) << nbits) - 4;
        ((offset + extra) << dist.distance_postfix_bits)
            + lcode
            + dist.num_direct_distance_codes
            + NUM_DISTANCE_SHORT_CODES
    }

    /// 7.2. Context ID for distances.
    #[inline(always)]
    pub(crate) fn distance_context(&self) -> u32 {
        let r = self.cmd_prefix >> 6;
        let c = u32::from(self.cmd_prefix & 7);
        if (r == 0 || r == 2 || r == 4 || r == 7) && c <= 2 {
            return c;
        }
        3
    }

    #[inline(always)]
    pub(crate) fn copy_len(&self) -> u32 {
        self.copy_len_and_delta & 0x1FF_FFFF
    }

    /// Whether the stream has a distance symbol for it: it copies something, and not implicitly from the last distance.
    #[inline(always)]
    pub(crate) fn has_distance_symbol(&self) -> bool {
        self.copy_len() != 0 && self.cmd_prefix >= 128
    }

    /// The copy length that is encoded.
    #[inline(always)]
    pub(crate) fn copy_len_code(&self) -> u32 {
        let modifier = self.copy_len_and_delta >> 25;
        let delta = i32::from((modifier | ((modifier & 0x40) << 1)) as u8 as i8);
        (self.copy_len() as i32).wrapping_add(delta) as u32
    }

    /// Makes the copy `extra` bytes longer. It stays shorter than a meta-block, so there is a code for it.
    pub(crate) fn lengthen_copy(&mut self, extra: u32) {
        self.copy_len_and_delta += extra;
        // The reference encoder adds the high 7 bits as an unsigned number here, and the output depends on it.
        self.cmd_prefix = length_code(
            self.insert_len as usize,
            (self.copy_len() as i32 + (self.copy_len_and_delta >> 25) as i32) as usize,
            self.dist_prefix.symbol() == 0,
        );
    }
}
