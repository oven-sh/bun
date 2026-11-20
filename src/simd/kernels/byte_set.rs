use core::ops::RangeInclusive;

/// Byte `b` is a member if `rows[b >> 4] & columns[b & 15]` is not zero.
pub struct ByteSet {
    pub rows: [u8; 16],
    pub columns: [u8; 16],
}

impl ByteSet {
    /// Panics if the 16 rows of 16 bytes have more than 8 patterns of members.
    pub const fn new(mut ranges: &[RangeInclusive<u8>]) -> Self {
        let mut members = [0u16; 16];
        while let [range, rest @ ..] = ranges {
            let mut byte = *range.start() as usize;
            while byte <= *range.end() as usize {
                members[byte >> 4] |= 1 << (byte & 15);
                byte += 1;
            }
            ranges = rest;
        }
        let (mut rows, mut columns) = ([0; 16], [0; 16]);
        let (mut row, mut bits) = (0, 0);
        while row < 16 {
            let mut same = 0;
            while members[same] != members[row] {
                same += 1;
            }
            if same < row {
                rows[row] = rows[same];
            } else if members[row] != 0 {
                assert!(bits < 8);
                rows[row] = 1 << bits;
                let mut column = 0;
                while column < 16 {
                    columns[column] |= ((members[row] >> column & 1) as u8) << bits;
                    column += 1;
                }
                bits += 1;
            }
            row += 1;
        }
        Self { rows, columns }
    }

    #[inline]
    const fn class(&self, byte: usize) -> u8 {
        self.rows[byte >> 4] & self.columns[byte & 15]
    }

    /// The bits of each byte can tell kinds of members apart.
    pub(crate) const fn classes(&self) -> [u8; 256] {
        let (mut classes, mut byte) = ([0; 256], 0);
        while byte < 256 {
            classes[byte] = self.class(byte);
            byte += 1;
        }
        classes
    }

    #[inline]
    pub fn contains(&self, byte: u8) -> bool {
        self.class(byte.into()) != 0
    }

    /// How many members `text` starts with.
    #[inline(always)]
    pub fn prefix_len(&self, text: &[u8]) -> usize {
        let len = simd::prefix_len(self, text);
        debug_assert_eq!(
            len,
            text.iter().take_while(|&&it| self.contains(it)).count()
        );
        len
    }
}

/// How far `prefix_len` looks without a dispatch.
const NEAR: usize = 64;

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::U8;

    pub(crate) fn class(v: U8, of: &ByteSet) -> U8 {
        U8::repeat(of.rows).lookup(v >> 4) & U8::repeat(of.columns).lookup(v & 15)
    }

    #[export(up_to = avx2, up_to = neon)]
    pub fn far_prefix_len(set: &ByteSet, text: &[u8]) -> usize {
        let outside = U8::position_near([text], |[v]| class(v, set).simd_eq(0));
        outside.unwrap_or(text.len())
    }

    /// Few runs are long, and a dispatch takes as long as a short one.
    #[export(baseline)]
    #[inline]
    pub fn prefix_len(set: &ByteSet, text: &[u8]) -> usize {
        let is_outside = |v| class(v, set).simd_eq(0);
        let Some((before_last, last)) = text.split_last_chunk() else {
            let outside = U8::position_near([text], |[v]| is_outside(v));
            return outside.unwrap_or(text.len());
        };
        let mut seen = 0;
        while let Some(chunk) = text[seen..].first_chunk() {
            if seen == NEAR {
                return seen + super::far_prefix_len(set, &text[seen..]);
            }
            if let Some(lane) = is_outside(U8::load(chunk)).first_set() {
                return seen + lane;
            }
            seen += U8::LEN;
        }
        let lane = is_outside(U8::load(last)).first_set();
        lane.map_or(text.len(), |lane| before_last.len() + lane)
    }
}
