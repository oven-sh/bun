//! The coefficients of a macroblock, RFC 6386 sections 13 and 14.

use super::bool_reader::BoolReader;
use crate::array::At;
use crate::error::Result;
use crate::lossy::BlockType;
use crate::lossy::tables::{
    BANDS, CATEGORY_3_TO_6, COEFFICIENT_UPDATE_PROBABILITIES, DEFAULT_COEFFICIENT_PROBABILITIES,
    ZIGZAG,
};
use crate::vec;

/// Four blocks side by side, in four rows of 16.
pub(super) type BlockRow = [i16; 64];

/// Where in a `BlockRow` the coefficients of its first block go, in the order they are coded.
const POSITIONS: [u8; 16] = {
    let mut positions = ZIGZAG;
    let mut rest = positions.as_mut_slice();
    while let [position, others @ ..] = rest {
        *position = *position / 4 * 16 + *position % 4;
        rest = others;
    }
    positions
};

/// What the first coefficient of a block is multiplied by, and the others.
pub(super) struct Quantizers {
    pub(super) luma: [i32; 2],
    pub(super) y2: [i32; 2],
    pub(super) chroma: [i32; 2],
}

type Tree = [u8; 11];

/// How many coefficients are coded, be they zeros: three masks with a bit for each block. They share a word, so that a
/// block costs one shift and one OR.
type Coded = u64;
const ANY: Coded = 1;
const MORE_THAN_ONE: Coded = 1 << 24;
/// For luma only. The bits of chroma are shifted out.
const TWO_OR_THREE: Coded = 1 << 48;

/// From one coefficient to the next.
#[derive(Default)]
struct Step {
    /// If the block ends in front of the one that is left.
    coded: Coded,
    /// Of the one that is left.
    position: u8,
    is_ac: bool,
    /// Of the next one, by context.
    trees: [Tree; 3],
}

/// The first leads to the first coefficient.
type Steps = [Step; BANDS.len()];

pub(super) struct Probabilities(Box<[Steps; 4]>);

impl Probabilities {
    pub(super) fn read(reader: &mut BoolReader) -> Result<Self> {
        let mut by_band = DEFAULT_COEFFICIENT_PROBABILITIES;
        let values = by_band.as_flattened_mut().as_flattened_mut();
        let updates = COEFFICIENT_UPDATE_PROBABILITIES
            .as_flattened()
            .as_flattened();
        // No call gets to see the copy, so that it stays in registers.
        let mut copy = *reader;
        for (value, &update) in values
            .as_flattened_mut()
            .iter_mut()
            .zip(updates.as_flattened())
        {
            if copy.read_unlikely(update) {
                *value = copy.read_byte();
            }
        }
        *reader = copy;
        let mut by_type = vec::default_array::<Steps, 4>()?;
        // One loop, which is too long to be unrolled.
        for (i, step) in by_type.as_flattened_mut().iter_mut().enumerate() {
            let (block_type, next) = (i / BANDS.len(), i % BANDS.len());
            let index = next.saturating_sub(1);
            *step = Step {
                coded: match index {
                    0..=1 => ANY,
                    2..=3 => ANY | MORE_THAN_ONE | TWO_OR_THREE,
                    _ => ANY | MORE_THAN_ONE,
                },
                position: *POSITIONS.at(index),
                is_ac: index > 0,
                trees: *by_band.at(block_type).at((*BANDS.at(next)).into()),
            };
        }
        Ok(Self(by_type))
    }

    fn of(&self, block_type: BlockType) -> &Steps {
        self.0.at(block_type as usize)
    }
}

/// Which of the blocks along an edge of a macroblock have coefficients.
#[derive(Clone, Copy, Default)]
pub(super) struct Context {
    luma: [bool; 4],
    /// U, then V.
    chroma: [bool; 4],
    y2: bool,
}

impl Context {
    /// For a macroblock without coefficients. One that has no Y2 block leaves that of an earlier one in place.
    pub(super) fn clear(&mut self, has_y2: bool) {
        *self = Self {
            y2: self.y2 && !has_y2,
            ..Self::default()
        };
    }
}

/// Four rows of luma, then two with U on the left and V on the right.
pub(super) struct Residuals {
    pub(super) rows: [BlockRow; 6],
    /// A bit for each block, in the order of `rows`. One that is not set has only zeros. The loop filter asks whether
    /// any is set.
    pub(super) non_zero: u32,
}

impl Residuals {
    pub(super) const fn new() -> Self {
        Self {
            rows: [[0; 64]; 6],
            non_zero: 0,
        }
    }

    pub(super) fn clear(&mut self) {
        for row in &mut self.rows {
            if self.non_zero & 15 != 0 {
                *row = [0; 64];
            }
            self.non_zero >>= 4;
        }
    }

    /// Reads the coefficients and turns them into what is added to the prediction. They were cleared.
    // Out of line, so that the reader gets the registers.
    #[inline(never)]
    pub(super) fn read(
        &mut self,
        partition: &mut BoolReader,
        probabilities: &Probabilities,
        quantizers: &Quantizers,
        has_y2: bool,
        above: &mut Context,
        left: &mut Context,
    ) {
        let mut reader = *partition;
        let mut coded = 0;
        let [luma @ .., _, _] = &mut self.rows;
        let (luma_type, first) = if has_y2 {
            let mut y2 = [0; 64];
            let block = Block {
                steps: probabilities.of(BlockType::Y2),
                quantizers: quantizers.y2,
                first: 0,
            };
            let context = [&mut above.y2, &mut left.y2];
            block.read(&mut reader, context, &mut y2, 0, &mut coded);
            if coded != 0 {
                inverse_wht(&y2, luma);
                coded = ANY * 0xffff;
            }
            (BlockType::LumaWithoutDc, 1)
        } else {
            (BlockType::LumaWithDc, 0)
        };

        let block = Block {
            steps: probabilities.of(luma_type),
            quantizers: quantizers.luma,
            first,
        };
        // One loop has fewer ends to guess than two.
        for i in 0..16 {
            let (x, y) = (i % 4, i / 4);
            let context = [above.luma.at_mut(x), left.luma.at_mut(y)];
            block.read(&mut reader, context, luma.at_mut(y), i, &mut coded);
        }

        let block = Block {
            steps: probabilities.of(BlockType::Chroma),
            quantizers: quantizers.chroma,
            first: 0,
        };
        let [_, _, _, _, chroma @ ..] = &mut self.rows;
        for i in 0..8 {
            let (x, y) = (i / 4 * 2 + i % 2, i / 2 % 2);
            let context = [above.chroma.at_mut(x), left.chroma.at_mut(i / 2)];
            let index = 16 + 4 * y + x;
            block.read(&mut reader, context, chroma.at_mut(y), index, &mut coded);
        }
        *partition = reader;
        let mask = |first: Coded| (coded >> first.trailing_zeros()) as u32 & 0xff_ffff;
        let (with_any, mut with_more) = (mask(ANY), mask(MORE_THAN_ONE));
        // The blocks of U are treated alike, and so are those of V.
        for plane in [0x33_0000, 0xcc_0000] {
            with_more |= if with_more & plane != 0 { plane } else { 0 };
        }

        let (mut blocks, mut to_transform) = (15, 0);
        // Of the coefficients to transform, ORed.
        let mut magnitudes = [0; 8];
        for row in &mut self.rows {
            if with_more & blocks != 0 {
                to_transform |= with_any & blocks;
                // The first three coefficients are in the upper half.
                for some in row.as_chunks::<8>().0.iter().take(4) {
                    magnitudes =
                        core::array::from_fn(|i| magnitudes.at(i) | some.at(i).unsigned_abs());
                }
            } else if with_any & blocks != 0 && spread_first(row) {
                self.non_zero |= blocks;
            }
            blocks <<= 4;
        }
        if to_transform != 0 {
            self.non_zero |= to_transform;
            if magnitudes.iter().fold(0, |all, it| all | it) >= LARGE {
                let short = mask(TWO_OR_THREE) | to_transform & !with_more;
                return self.transform_short_apart(to_transform, short);
            }
            bun_highway::webp::inverse_dct(&mut self.rows, to_transform);
        }
    }

    /// libwebp has 32 bits for the sums of a `short` block: luma with up to three coefficients, and chroma if all four
    /// have up to one.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dec/frame_dec.c#L54-L80
    #[cold]
    #[inline(never)]
    fn transform_short_apart(&mut self, to_transform: u32, short: u32) {
        let coefficients = self.rows;
        bun_highway::webp::inverse_dct(&mut self.rows, to_transform);
        for i in (0..24).filter(|i| short >> i & 1 != 0) {
            spread_three(coefficients.at(i / 4), self.rows.at_mut(i / 4), i % 4);
        }
    }
}

/// The inverse DCT of three coefficients below this takes no more than 16 bits.
const LARGE: u16 = 1 << 13;
const _: () = assert!(LARGE.is_power_of_two());
const _: () = assert!(LARGE as i32 + 4 + 2 * times_cos(LARGE as i32) <= i16::MAX as i32);

const fn times_cos(it: i32) -> i32 {
    it + ((it * 20091) >> 16)
}

/// The inverse DCT of the `x`-th block, which has no coefficient behind the third.
fn spread_three(coefficients: &BlockRow, residuals: &mut BlockRow, x: usize) {
    let terms = |it: i32| {
        let (cos, sin) = (times_cos(it), (it * 35468) >> 16);
        [cos, sin, -sin, -cos]
    };
    let [first, across, down] = [0, 1, 16].map(|at| i32::from(*coefficients.at(4 * x + at)));
    for (row, down) in terms(down).into_iter().enumerate() {
        for (column, across) in terms(across).into_iter().enumerate() {
            *residuals.at_mut(16 * row + 4 * x + column) =
                ((first + 4 + down + across) >> 3) as i16;
        }
    }
}

/// The inverse DCT of blocks that have no coefficient but the first. Returns whether one of those is not zero.
#[inline(always)]
fn spread_first(row: &mut BlockRow) -> bool {
    let first: [i16; 16] = core::array::from_fn(|x| *row.at(x & !3));
    let residuals = first.map(|it| it.saturating_add(4) >> 3);
    row.as_chunks_mut().0.fill(residuals);
    first != [0; 16]
}

struct Block<'a> {
    steps: &'a Steps,
    quantizers: [i32; 2],
    /// The index of the first coefficient that is coded.
    first: usize,
}

impl Block<'_> {
    /// `index`: in the order of `Residuals::rows`.
    #[inline(always)]
    fn read(
        &self,
        reader: &mut BoolReader,
        [above, left]: [&mut bool; 2],
        row: &mut BlockRow,
        index: usize,
        coded: &mut Coded,
    ) {
        let context = usize::from(*above) + usize::from(*left);
        let tree = self.steps.at(self.first).trees.at(context);
        if !reader.read(tree[0]) {
            (*above, *left) = (false, false);
            return;
        }
        (*above, *left) = (true, true);
        let this = self.read_to_end(reader, tree, row, index % 4);
        *coded |= this.unwrap_or(ANY | MORE_THAN_ONE) << index;
    }

    /// There is a coefficient to come. `None`: the block was coded up to its last.
    #[inline(always)]
    fn read_to_end<'a>(
        &'a self,
        reader: &mut BoolReader,
        mut tree: &'a Tree,
        row: &mut BlockRow,
        x: usize,
    ) -> Option<Coded> {
        let mut steps = self.steps.iter();
        let mut step = steps.nth(self.first + 1)?;
        loop {
            while !reader.read(tree[1]) {
                tree = &step.trees[0];
                step = steps.next()?;
            }
            let [_, after_one, after_more] = &step.trees;
            let magnitude;
            (magnitude, tree) = match reader.read(tree[2]) {
                false => (1, after_one),
                true => (read_above_one(reader, tree), after_more),
            };
            let quantizer = *self.quantizers.at(step.is_ac.into());
            let position = usize::from(step.position) + 4 * x;
            *row.at_mut(position) = (reader.read_sign(magnitude) * quantizer) as i16;
            step = steps.next()?;
            if !reader.read(tree[0]) {
                return Some(step.coded);
            }
        }
    }
}

/// Section 13.2.
#[inline(always)]
fn read_above_one(reader: &mut BoolReader, tree: &Tree) -> i32 {
    if !reader.read(tree[3]) {
        if !reader.read(tree[4]) {
            2
        } else {
            3 + reader.read_bit(tree[5])
        }
    } else if !reader.read(tree[6]) {
        if !reader.read(tree[7]) {
            5 + reader.read_bit(159)
        } else {
            7 + 2 * reader.read_bit(165) + reader.read_bit(145)
        }
    } else {
        let high = reader.read_bit(tree[8]);
        let category = 2 * high + reader.read_bit(*tree.at(9 + high as usize));
        let extra_bits = CATEGORY_3_TO_6.at(category as usize).iter();
        3 + (8 << category) + extra_bits.fold(0, |extra, &it| 2 * extra + reader.read_bit(it))
    }
}

/// Turns the block at the left of `y2` into the first coefficients of the blocks of `luma`. Section 14.3.
fn inverse_wht(y2: &BlockRow, luma: &mut [BlockRow; 4]) {
    let butterfly = |[i0, i1, i2, i3]: [i32; 4]| {
        let (a, b, c, d) = (i0 + i3, i1 + i2, i1 - i2, i0 - i3);
        [a + b, d + c, a - b, d - c]
    };
    let columns: [_; 4] =
        core::array::from_fn(|x| butterfly([0, 16, 32, 48].map(|y| i32::from(*y2.at(y + x)))));
    for (y, row) in luma.iter_mut().enumerate() {
        let [i0, i1, i2, i3] = columns.map(|column| *column.at(y));
        for (x, value) in butterfly([i0 + 3, i1, i2, i3]).into_iter().enumerate() {
            *row.at_mut(4 * x) = (value >> 3) as i16;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_read_behind_the_last_coefficient() {
        let block = Block {
            steps: &Steps::default(),
            quantizers: [1; 2],
            first: 16,
        };
        let (reader, mut row) = (&mut BoolReader::new(&[254; 8]), [0; 64]);
        assert_eq!(block.read_to_end(reader, &[128; 11], &mut row, 0), None);
        assert_eq!(row, [0; 64]);
    }
}
