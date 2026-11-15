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

type ByContext = [[u8; 11]; 3];
/// For each coefficient those of its band.
type ByCoefficient = [ByContext; BANDS.len()];

pub(super) struct Probabilities(Box<[ByCoefficient; 4]>);

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
            if reader.read(update) {
                *value = reader.read_unsigned(8);
            }
        }
        let mut by_coefficient = vec::default_array::<ByCoefficient, 4>()?;
        for (coefficients, bands) in by_coefficient.iter_mut().zip(&by_band) {
            for (to, band) in coefficients.iter_mut().zip(BANDS) {
                *to = *bands.at(band.into());
            }
        }
        Ok(Self(by_coefficient))
    }

    fn of(&self, block_type: BlockType) -> &ByCoefficient {
        self.0.at(block_type as usize)
    }
}

/// Which of the blocks along an edge of a macroblock have coefficients.
#[derive(Clone, Copy, Default)]
pub(super) struct Context {
    luma: [bool; 4],
    u: [bool; 2],
    v: [bool; 2],
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
        let [luma @ .., upper_chroma, lower_chroma] = &mut self.rows;
        let (luma_type, first) = if has_y2 {
            let mut y2 = [0; 64];
            let block = Block {
                probabilities: probabilities.of(BlockType::Y2),
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
            probabilities: probabilities.of(luma_type),
            quantizers: quantizers.luma,
            first,
        };
        for (y, (row, left)) in luma.iter_mut().zip(&mut left.luma).enumerate() {
            for (x, above) in above.luma.iter_mut().enumerate() {
                let end = block.read(&mut reader, [*above, *left], row, x);
                *left = end > first;
                *above = *left;
                non_zero |= u32::from(is_non_zero(end, row, x)) << (4 * y + x);
            }
        }

        let block = Block {
            probabilities: probabilities.of(BlockType::Chroma),
            quantizers: quantizers.chroma,
            first: 0,
        };
        for (first_x, above, left) in [
            (0, &mut above.u, &mut left.u),
            (2, &mut above.v, &mut left.v),
        ] {
            let rows = [&mut *upper_chroma, &mut *lower_chroma];
            for (y, (row, left)) in (4..).zip(rows.into_iter().zip(left)) {
                for (x, above) in (first_x..).zip(&mut *above) {
                    let end = block.read(&mut reader, [*above, *left], row, x);
                    *left = end > 0;
                    *above = *left;
                    non_zero |= u32::from(is_non_zero(end, row, x)) << (4 * y + x);
                }
            }
        }
        *partition = reader;
        self.non_zero = non_zero;
        bun_highway::webp::inverse_dct(&mut self.rows, non_zero);
    }
}

/// Zeros that were spelled out behind the first coefficient count, for the loop filter.
fn is_non_zero(end: usize, row: &BlockRow, x: usize) -> bool {
    end > 1 || *row.at(4 * x) != 0
}

struct Block<'a> {
    probabilities: &'a ByCoefficient,
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
        let mut index = self.first;
        let context = usize::from(above) + usize::from(left);
        let mut tree = self.probabilities.at(index).at(context);
        while index < 16 {
            if !reader.read(tree[0]) {
                return index;
            }
            while !reader.read(tree[1]) {
                index += 1;
                if index == 16 {
                    return 16;
                }
                tree = &self.probabilities.at(index)[0];
            }
            let [_, after_one, after_more] = self.probabilities.at(index + 1);
            let magnitude;
            (magnitude, tree) = match reader.read(tree[2]) {
                false => (1, after_one),
                true => (read_above_one(reader, tree), after_more),
            };
            let quantizer = *self.quantizers.at(usize::from(index > 0));
            let position = usize::from(*POSITIONS.at(index)) + 4 * x;
            *row.at_mut(position) = (reader.read_sign(magnitude) * quantizer) as i16;
            index += 1;
        }
        16
    }
}

/// Section 13.2.
#[inline(always)]
fn read_above_one(reader: &mut BoolReader, tree: &[u8; 11]) -> i32 {
    let mut read = |probability| i32::from(reader.read(probability));
    if read(tree[3]) == 0 {
        if read(tree[4]) == 0 {
            2
        } else {
            3 + read(tree[5])
        }
    } else if read(tree[6]) == 0 {
        if read(tree[7]) == 0 {
            5 + read(159)
        } else {
            7 + 2 * read(165) + read(145)
        }
    } else {
        let high = read(tree[8]);
        let category = 2 * high + read(*tree.at(9 + high as usize));
        let extra_bits = CATEGORY_3_TO_6.at(category as usize).iter();
        3 + (8 << category) + extra_bits.fold(0, |extra, &it| 2 * extra + read(it))
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
