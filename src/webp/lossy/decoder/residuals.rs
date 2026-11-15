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
#[derive(Clone, Copy, Default)]
pub(super) struct Quantizers {
    pub(super) luma: [i32; 2],
    pub(super) y2: [i32; 2],
    pub(super) chroma: [i32; 2],
}

type Tree = [u8; 11];

/// From one coefficient to the next.
#[derive(Clone, Copy, Default)]
struct Step {
    /// Of the one that is left.
    index: u8,
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
        for (value, &update) in values
            .as_flattened_mut()
            .iter_mut()
            .zip(updates.as_flattened())
        {
            if reader.read_unlikely(update) {
                *value = reader.read_unsigned(8);
            }
        }
        let mut by_type = vec::default_array::<Steps, 4>()?;
        for (steps, bands) in by_type.iter_mut().zip(&by_band) {
            for (step, band) in steps.iter_mut().zip(BANDS) {
                step.trees = *bands.at(band.into());
            }
            for (step, (index, position)) in steps.iter_mut().skip(1).zip((0..).zip(POSITIONS)) {
                (step.index, step.position, step.is_ac) = (index, position, index > 0);
            }
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
    /// A bit for each block, in the order of `rows`. One that is not set has only zeros.
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
        let mut non_zero = 0;
        let [luma @ .., _, _] = &mut self.rows;
        let (luma_type, first) = if has_y2 {
            let mut y2 = [0; 64];
            let block = Block {
                steps: probabilities.of(BlockType::Y2),
                quantizers: quantizers.y2,
                first: 0,
            };
            let end = block.read(&mut reader, [above.y2, left.y2], &mut y2, 0);
            above.y2 = end > 0;
            left.y2 = end > 0;
            if end > 0 {
                inverse_wht(&y2, luma);
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
            let (above, left, row) = (above.luma.at_mut(x), left.luma.at_mut(y), luma.at_mut(y));
            let end = block.read(&mut reader, [*above, *left], row, x);
            *left = end > first;
            *above = *left;
            non_zero |= u32::from(is_non_zero(end, row, x)) << i;
        }

        let block = Block {
            steps: probabilities.of(BlockType::Chroma),
            quantizers: quantizers.chroma,
            first: 0,
        };
        let [_, _, _, _, chroma @ ..] = &mut self.rows;
        for i in 0..8 {
            let (x, y) = (i / 4 * 2 + i % 2, i / 2 % 2);
            let (above, left) = (above.chroma.at_mut(x), left.chroma.at_mut(i / 2));
            let row = chroma.at_mut(y);
            let end = block.read(&mut reader, [*above, *left], row, x);
            *left = end > 0;
            *above = *left;
            non_zero |= u32::from(is_non_zero(end, row, x)) << (16 + 4 * y + x);
        }
        *partition = reader;
        self.non_zero = non_zero;
        bun_highway::webp::inverse_dct(&mut self.rows, non_zero);
    }
}

/// Zeros that were spelled out behind the first coefficient count, for the loop filter.
fn is_non_zero(end: usize, row: &BlockRow, x: usize) -> bool {
    (end > 1) | (*row.at(4 * x) != 0)
}

struct Block<'a> {
    steps: &'a Steps,
    quantizers: [i32; 2],
    /// The index of the first coefficient that is coded.
    first: usize,
}

impl Block<'_> {
    /// Returns the index behind the last coefficient that was coded.
    #[inline(always)]
    fn read(
        &self,
        reader: &mut BoolReader,
        [above, left]: [bool; 2],
        row: &mut BlockRow,
        x: usize,
    ) -> usize {
        let context = usize::from(above) + usize::from(left);
        let mut tree = self.steps.at(self.first).trees.at(context);
        let mut steps = self.steps.iter();
        steps.nth(self.first);
        while let Some(mut step) = steps.next() {
            if !reader.read(tree[0]) {
                return step.index.into();
            }
            while !reader.read(tree[1]) {
                tree = &step.trees[0];
                let Some(next) = steps.next() else {
                    return 16;
                };
                step = next;
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
        }
        16
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
