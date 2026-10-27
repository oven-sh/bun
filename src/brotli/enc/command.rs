//! A command: some literals, followed by a copy of earlier bytes.

use super::fast_log::log2_floor_nonzero;
use super::params::DistanceParams;
use crate::common::constants::{NUM_DISTANCE_SHORT_CODES, NUM_INS_COPY_CODES};
use crate::util::{Checked, SliceExt};

static INS_BASE: [u32; NUM_INS_COPY_CODES] = [
    0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210,
    22594,
];
static INS_EXTRA: [u32; NUM_INS_COPY_CODES] = [
    0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24,
];
static COPY_BASE: [u32; NUM_INS_COPY_CODES] = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 102, 134, 198, 326, 582, 1094, 2118,
];
static COPY_EXTRA: [u32; NUM_INS_COPY_CODES] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24,
];

/// Returns the distance symbol, with the number of extra bits in its high 6 bits, and the extra bits. `distance_code` is
/// one of the 16 short codes, or the distance + 15.
#[inline(always)]
pub(crate) fn prefix_encode_copy_distance(
    distance_code: usize,
    num_direct_codes: usize,
    postfix_bits: usize,
) -> (u16, u32) {
    if distance_code < NUM_DISTANCE_SHORT_CODES as usize + num_direct_codes {
        return (distance_code as u16, 0);
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
    (code as u16, ((dist - offset) >> postfix_bits) as u32)
}

#[inline(always)]
pub(crate) fn get_insert_length_code(insertlen: usize) -> u16 {
    if insertlen < 6 {
        insertlen as u16
    } else if insertlen < 130 {
        let nbits = log2_floor_nonzero(insertlen - 2) - 1;
        ((nbits << 1) as usize + ((insertlen - 2) >> nbits) + 2) as u16
    } else if insertlen < 2114 {
        (log2_floor_nonzero(insertlen - 66) + 10) as u16
    } else if insertlen < 6210 {
        21
    } else if insertlen < 22594 {
        22
    } else {
        23
    }
}

#[inline(always)]
pub(crate) fn get_copy_length_code(copylen: usize) -> u16 {
    if copylen < 10 {
        copylen.wrapping_sub(2) as u16
    } else if copylen < 134 {
        let nbits = log2_floor_nonzero(copylen - 6) - 1;
        ((nbits << 1) as usize + ((copylen - 6) >> nbits) + 4) as u16
    } else if copylen < 2118 {
        (log2_floor_nonzero(copylen - 70) + 12) as u16
    } else {
        23
    }
}

#[inline(always)]
pub(crate) fn combine_length_codes(inscode: u16, copycode: u16, use_last_distance: bool) -> u16 {
    let bits64 = (copycode & 7) | ((inscode & 7) << 3);
    if use_last_distance && inscode < 8 && copycode < 16 {
        return if copycode < 8 { bits64 } else { bits64 | 64 };
    }
    // The cells of the last table of section 5 start at K * 64 with K = 2, 3, 6, 4, 5, 8, 7, 9, 10. K less its position
    // in that list takes 2 bits, and the constant holds those, already shifted by 6.
    let offset = 2 * (u32::from(copycode >> 3) + 3 * u32::from(inscode >> 3));
    let offset = (offset << 5) + 0x40 + ((0x52_0D40 >> offset) & 0xC0);
    offset as u16 | bits64
}

#[inline(always)]
pub(crate) fn get_length_code(insertlen: usize, copylen: usize, use_last_distance: bool) -> u16 {
    combine_length_codes(
        get_insert_length_code(insertlen),
        get_copy_length_code(copylen),
        use_last_distance,
    )
}

#[inline(always)]
pub(crate) fn get_insert_base(inscode: u16) -> Checked<u32> {
    INS_BASE.at(usize::from(inscode))
}

#[inline(always)]
pub(crate) fn get_insert_extra(inscode: u16) -> Checked<u32> {
    INS_EXTRA.at(usize::from(inscode))
}

#[inline(always)]
pub(crate) fn get_copy_base(copycode: u16) -> Checked<u32> {
    COPY_BASE.at(usize::from(copycode))
}

#[inline(always)]
pub(crate) fn get_copy_extra(copycode: u16) -> Checked<u32> {
    COPY_EXTRA.at(usize::from(copycode))
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Command {
    pub(crate) insert_len: u32,
    /// The copy length in the low 25 bits. In the high 7, what to add to it for the length that is encoded, which differs
    /// for a transformed dictionary word.
    pub(crate) copy_len: u32,
    /// The extra bits of the distance.
    pub(crate) dist_extra: u32,
    pub(crate) cmd_prefix: u16,
    /// The distance symbol in the low 10 bits and the number of extra bits in the high 6.
    pub(crate) dist_prefix: u16,
}

impl Command {
    /// `distance_code` is as for [`prefix_encode_copy_distance`].
    #[inline(always)]
    pub(crate) fn new(
        dist: &DistanceParams,
        insertlen: usize,
        copylen: usize,
        copylen_code_delta: i32,
        distance_code: usize,
    ) -> Self {
        let delta = u32::from(copylen_code_delta as i8 as u8);
        let (dist_prefix, dist_extra) = prefix_encode_copy_distance(
            distance_code,
            dist.num_direct_distance_codes as usize,
            dist.distance_postfix_bits as usize,
        );
        let cmd_prefix = get_length_code(
            insertlen,
            (copylen as i32).wrapping_add(copylen_code_delta) as usize,
            dist_prefix & 0x3FF == 0,
        );
        Self {
            insert_len: insertlen as u32,
            copy_len: copylen as u32 | (delta << 25),
            dist_extra,
            cmd_prefix,
            dist_prefix,
        }
    }

    /// Literals at the end of a meta-block, with no copy after them.
    #[inline(always)]
    pub(crate) fn new_insert(insertlen: usize) -> Self {
        Self {
            insert_len: insertlen as u32,
            copy_len: 4 << 25,
            dist_extra: 0,
            cmd_prefix: get_length_code(insertlen, 4, false),
            dist_prefix: NUM_DISTANCE_SHORT_CODES as u16,
        }
    }

    /// The `distance_code` that [`Self::new`] was given.
    #[inline(always)]
    pub(crate) fn restore_distance_code(&self, dist: &DistanceParams) -> u32 {
        let dcode = u32::from(self.dist_prefix & 0x3FF);
        if dcode < NUM_DISTANCE_SHORT_CODES + dist.num_direct_distance_codes {
            return dcode;
        }
        let nbits = u32::from(self.dist_prefix >> 10);
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
        self.copy_len & 0x1FF_FFFF
    }

    /// The copy length that is encoded.
    #[inline(always)]
    pub(crate) fn copy_len_code(&self) -> u32 {
        let modifier = self.copy_len >> 25;
        let delta = i32::from((modifier | ((modifier & 0x40) << 1)) as u8 as i8);
        ((self.copy_len & 0x1FF_FFFF) as i32).wrapping_add(delta) as u32
    }
}
