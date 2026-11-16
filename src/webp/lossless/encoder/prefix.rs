//! How the length and the distance of a copy are stored.

use crate::array::At;
use crate::lossless::NEIGHBORS;

/// A number as a symbol for its highest bits, and the bits below them as they are.
pub(super) struct Prefixed {
    pub(super) symbol: usize,
    pub(super) extra_len: u32,
    pub(super) extra: u32,
}

impl Prefixed {
    /// `number` is 1 or more.
    #[inline(always)]
    pub(super) fn new(number: u32) -> Self {
        let number = number.saturating_sub(1);
        let extra_len = (number | 2).ilog2() - 1;
        Self {
            symbol: (2 * extra_len + (number >> extra_len)) as usize,
            extra_len,
            extra: number & ((1 << extra_len) - 1),
        }
    }
}

pub(super) const fn extra_len(symbol: usize) -> u32 {
    (symbol as u32 / 2).saturating_sub(1)
}

const MAX_UP: usize = 7;
const MAX_LEFT: usize = 8;
const MAX_RIGHT: usize = 7;

/// By rows up, then by `MAX_RIGHT` plus pixels to the left.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static NEIGHBOR_CODES: [[u8; MAX_RIGHT + 1 + MAX_LEFT]; MAX_UP + 1] = {
    let mut codes = [[0; _]; _];
    let mut index = 0;
    while index < NEIGHBORS.len() {
        let (left, up) = NEIGHBORS[index];
        index += 1;
        codes[up as usize][(left + MAX_RIGHT as i8) as usize] = index as u8;
    }
    codes
};

/// What is stored for a `distance` of 1 or more.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L52
#[inline]
pub(super) fn distance_code(distance: usize, width: usize) -> u32 {
    if distance <= MAX_UP * width + MAX_LEFT {
        let up = (distance as u32 / (width as u32).max(1)) as usize;
        let left = distance - up * width;
        let right = width - left;
        if left <= MAX_LEFT && up <= MAX_UP {
            return (*NEIGHBOR_CODES.at(up).at(MAX_RIGHT + left)).into();
        }
        if right <= MAX_RIGHT && up < MAX_UP {
            return (*NEIGHBOR_CODES.at(up + 1).at(MAX_RIGHT - right)).into();
        }
    }
    (distance + NEIGHBORS.len()) as u32
}
