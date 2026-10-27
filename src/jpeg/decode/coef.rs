//! Between the entropy decoder and the inverse DCT (jdcoefct.c): one MCU at a time if the stream has a single scan, the
//! coefficients of the whole image otherwise.

use super::arith::ArithDecoder;
use super::huff::HuffDecoder;
use super::idct::{self, DctTable};
use super::input::Input;
use super::phuff::PHuffDecoder;
use super::{Block, Decoder, MAX_BLOCKS_IN_MCU, coef_at};
use crate::error::{Error, Result, try_vec};
use crate::tables::natural_order;

/// Where an entropy decoder finds the blocks of the MCU it is decoding.
pub(crate) trait McuBlocks {
    fn block(&mut self, blkn: usize) -> Option<&mut Block>;
}

impl McuBlocks for [Block; MAX_BLOCKS_IN_MCU] {
    #[inline(always)]
    fn block(&mut self, blkn: usize) -> Option<&mut Block> {
        self.get_mut(blkn)
    }
}

pub(crate) enum Entropy {
    Huff(Box<HuffDecoder>),
    PHuff(Box<PHuffDecoder>),
    Arith(Box<ArithDecoder>),
}

impl Entropy {
    pub(crate) fn start_pass(&mut self, d: &mut Decoder) -> Result<()> {
        match self {
            Entropy::Huff(e) => e.start_pass(d),
            Entropy::PHuff(e) => e.start_pass(d),
            Entropy::Arith(e) => e.start_pass(d),
        }
    }

    #[inline(always)]
    fn decode_mcu(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        match self {
            Entropy::Huff(e) => e.decode_mcu(inp, mcu),
            Entropy::PHuff(e) => e.decode_mcu(inp, mcu),
            Entropy::Arith(e) => e.decode_mcu(inp, mcu),
        }
    }

    /// For each component, how precisely each coefficient is known so far, and how precisely it was before the current
    /// scan. Only progressive streams keep track.
    fn coef_bits(&self) -> Option<&CoefBits> {
        match self {
            Entropy::Huff(_) => None,
            Entropy::PHuff(e) => Some(e.coef_bits()),
            Entropy::Arith(e) => e.coef_bits(),
        }
    }
}

/// `current[ci][k]` is the number of low bits of coefficient `k` (in zigzag order) of component `ci` that are still
/// missing, or -1 if nothing of it has been seen. `previous` is the same as of the scan before.
#[derive(Default)]
pub(crate) struct CoefBits {
    pub(crate) current: Vec<[i32; 64]>,
    pub(crate) previous: Vec<[i32; 64]>,
}

impl CoefBits {
    pub(crate) fn new(num_components: usize) -> Self {
        CoefBits {
            current: vec![[-1; 64]; num_components],
            previous: vec![[-1; 64]; num_components],
        }
    }
}

/// The samples of one component for one iMCU row.
#[derive(Default)]
pub(crate) struct Plane {
    pub(crate) data: Vec<u8>,
    pub(crate) stride: usize,
}

impl Plane {
    pub(crate) fn new(stride: usize, rows: usize) -> Result<Self> {
        let data = try_vec(0, stride * rows)?;
        Ok(Plane { data, stride })
    }

    #[inline(always)]
    pub(crate) fn row(&self, y: usize) -> Result<&[u8]> {
        self.data
            .get(y * self.stride..(y + 1) * self.stride)
            .ok_or(Error::Internal)
    }

    #[inline(always)]
    fn put<const N: usize>(&mut self, y: usize, x: usize, samples: &[[u8; N]; N]) -> Result<()> {
        let mut start = y * self.stride + x;
        for row in samples {
            *self
                .data
                .get_mut(start..)
                .and_then(|out| out.first_chunk_mut::<N>())
                .ok_or(Error::Internal)? = *row;
            start += self.stride;
        }
        Ok(())
    }
}

/// The inverse DCT of one component.
#[derive(Clone)]
pub(crate) struct Idct {
    /// The side of the result.
    size: u32,
    table: DctTable,
}

impl Idct {
    /// A component that no scan has mentioned has no table, and comes out gray.
    pub(crate) fn new(size: u32, quant: Option<&[u16; 64]>) -> Self {
        Idct {
            size,
            table: quant.map_or([0; 64], idct::dct_table),
        }
    }

    #[inline(always)]
    fn run(&self, coefs: &Block, plane: &mut Plane, y: usize, x: usize) -> Result<()> {
        let table = &self.table;
        match self.size {
            8 => plane.put(y, x, &idct::idct8x8(coefs, table)),
            1 => plane.put(y, x, &idct::idct1x1(coefs, table)),
            2 => plane.put(y, x, &idct::idct2x2(coefs, table)),
            3 => plane.put(y, x, &idct::idct3x3(coefs, table)),
            4 => plane.put(y, x, &idct::idct4x4(coefs, table)),
            5 => plane.put(y, x, &idct::idct5x5(coefs, table)),
            6 => plane.put(y, x, &idct::idct6x6(coefs, table)),
            7 => plane.put(y, x, &idct::idct7x7(coefs, table)),
            10 => plane.put(y, x, &idct::idct10x10(coefs, table)),
            12 => plane.put(y, x, &idct::idct12x12(coefs, table)),
            14 => plane.put(y, x, &idct::idct14x14(coefs, table)),
            _ => Err(Error::Internal),
        }
    }
}

/// The coefficients of one component, padded to whole MCUs.
struct CoefArray {
    blocks: Vec<Block>,
    blocks_per_row: usize,
}

impl CoefArray {
    fn row(&self, y: usize) -> Result<&[Block]> {
        self.blocks
            .get(y * self.blocks_per_row..(y + 1) * self.blocks_per_row)
            .ok_or(Error::Internal)
    }
}

/// The blocks of one MCU inside the arrays of the whole image.
struct McuInImage<'a> {
    arrays: &'a mut [CoefArray],
    /// For each block, its component and its index in that component's array.
    at: [(usize, usize); MAX_BLOCKS_IN_MCU],
}

impl McuBlocks for McuInImage<'_> {
    #[inline(always)]
    fn block(&mut self, blkn: usize) -> Option<&mut Block> {
        let &(ci, index) = self.at.get(blkn)?;
        self.arrays.get_mut(ci)?.blocks.get_mut(index)
    }
}

/// How many of `CoefBits`'s entries block smoothing looks at.
const SAVED_COEFS: usize = 10;

/// The first `SAVED_COEFS` in zigzag order of 64 in row-major order.
fn low_frequencies<T: Copy + Default>(block: &[T; 64]) -> [T; SAVED_COEFS] {
    core::array::from_fn(|k| block.get(natural_order(k)).copied().unwrap_or_default())
}

pub(crate) struct CoefController {
    pub(crate) entropy: Entropy,
    input_imcu_row: u32,
    mcu_buffer: Box<[Block; MAX_BLOCKS_IN_MCU]>,
    /// Empty if the stream has a single scan.
    whole_image: Vec<CoefArray>,
    /// The last iMCU row of the current scan that began with data left to decode.
    last_good_imcu_row: u32,
    /// `Some` while the output pass smooths. Per component, the current and the previous precision.
    smoothing: Option<Vec<[[i32; SAVED_COEFS]; 2]>>,
}

impl CoefController {
    pub(crate) fn new(d: &Decoder, entropy: Entropy) -> Result<Self> {
        let mut whole_image = Vec::new();
        if d.has_multiple_scans {
            for comp in &d.comps {
                let blocks_per_row = comp.width_in_blocks.next_multiple_of(comp.h_samp) as usize;
                let rows = comp.height_in_blocks.next_multiple_of(comp.v_samp) as usize;
                let blocks = try_vec([0; 64], blocks_per_row * rows)?;
                whole_image.push(CoefArray {
                    blocks,
                    blocks_per_row,
                });
            }
        }
        Ok(CoefController {
            entropy,
            input_imcu_row: 0,
            mcu_buffer: Box::new([[0; 64]; MAX_BLOCKS_IN_MCU]),
            whole_image,
            last_good_imcu_row: 0,
            smoothing: None,
        })
    }

    pub(crate) fn start_input_pass(&mut self) {
        self.input_imcu_row = 0;
    }

    /// Decodes the next iMCU row of a stream with a single scan straight into samples.
    pub(crate) fn decompress_onepass(
        &mut self,
        d: &mut Decoder,
        idcts: &[Idct],
        planes: &mut [Plane],
    ) -> Result<()> {
        let last_mcu_col = d.mcus_per_row - 1;
        let last_imcu_row = d.total_imcu_rows - 1;

        for yoffset in 0..d.mcu_rows_in_imcu_row(self.input_imcu_row)? {
            for mcu_col_num in 0..=last_mcu_col {
                for block in self.mcu_buffer.iter_mut().take(d.blocks_in_mcu) {
                    *block = [0; 64];
                }
                self.entropy.decode_mcu(&mut d.inp, &mut *self.mcu_buffer)?;

                // Blocks past the right and bottom edges of the component are only there to fill up the MCU.
                let mut blkn = 0;
                for i in 0..d.comps_in_scan {
                    let ci = d.scan_comp_index(i)?;
                    let comp = d.comp(ci)?;
                    let (Some(idct), Some(plane)) = (idcts.get(ci), planes.get_mut(ci)) else {
                        return Err(Error::Internal);
                    };
                    let size = comp.dct_scaled_size as usize;
                    let useful_width = if mcu_col_num < last_mcu_col {
                        comp.mcu_width
                    } else {
                        comp.last_col_width
                    };
                    let start_col = mcu_col_num as usize * comp.mcu_width as usize * size;
                    for yindex in 0..comp.mcu_height {
                        if self.input_imcu_row < last_imcu_row
                            || yoffset + yindex < comp.last_row_height
                        {
                            let y = (yoffset + yindex) as usize * size;
                            let blocks = self
                                .mcu_buffer
                                .iter()
                                .skip(blkn)
                                .take(useful_width as usize);
                            for (xindex, block) in blocks.enumerate() {
                                idct.run(block, plane, y, start_col + xindex * size)?;
                            }
                        }
                        blkn += comp.mcu_width as usize;
                    }
                }
            }
        }

        self.input_imcu_row += 1;
        Ok(())
    }

    /// Decodes a whole scan into the coefficient arrays.
    pub(crate) fn consume_scan(&mut self, d: &mut Decoder) -> Result<()> {
        while self.input_imcu_row < d.total_imcu_rows {
            let mut mcu = McuInImage {
                arrays: &mut self.whole_image,
                at: [(0, 0); MAX_BLOCKS_IN_MCU],
            };
            for yoffset in 0..d.mcu_rows_in_imcu_row(self.input_imcu_row)? {
                for mcu_col_num in 0..d.mcus_per_row {
                    let mut at = mcu.at.iter_mut();
                    for i in 0..d.comps_in_scan {
                        let ci = d.scan_comp_index(i)?;
                        let comp = d.comp(ci)?;
                        let blocks_per_row =
                            mcu.arrays.get(ci).ok_or(Error::Internal)?.blocks_per_row;
                        let start_col = (mcu_col_num * comp.mcu_width) as usize;
                        for yindex in 0..comp.mcu_height {
                            let row =
                                (self.input_imcu_row * comp.v_samp + yindex + yoffset) as usize;
                            for xindex in 0..comp.mcu_width as usize {
                                *at.next().ok_or(Error::Internal)? =
                                    (ci, row * blocks_per_row + start_col + xindex);
                            }
                        }
                    }
                    if !d.inp.insufficient_data {
                        self.last_good_imcu_row = self.input_imcu_row;
                    }
                    self.entropy.decode_mcu(&mut d.inp, &mut mcu)?;
                }
            }
            self.input_imcu_row += 1;
        }
        Ok(())
    }

    /// Smoothing estimates the low AC coefficients that a progressive stream has not delivered in full, which only
    /// happens if it breaks off early.
    pub(crate) fn start_output_pass(&mut self, d: &Decoder) {
        self.smoothing = self.smoothing_latch(d);
    }

    fn smoothing_latch(&self, d: &Decoder) -> Option<Vec<[[i32; SAVED_COEFS]; 2]>> {
        if self.whole_image.is_empty() || !d.progressive {
            return None;
        }
        let coef_bits = self.entropy.coef_bits()?;
        let mut useful = false;
        let mut latch = Vec::new();
        for ((comp, current), previous) in d
            .comps
            .iter()
            .zip(&coef_bits.current)
            .zip(&coef_bits.previous)
        {
            // These divide.
            if low_frequencies(&comp.quant_table?).contains(&0) {
                return None;
            }
            let current = *current.first_chunk::<SAVED_COEFS>()?;
            let mut previous = *previous.first_chunk::<SAVED_COEFS>()?;
            let [dc, ac @ ..] = current;
            if dc < 0 {
                return None;
            }
            if d.input_scan_number <= 1 {
                previous = [-1; SAVED_COEFS];
            }
            useful |= ac.iter().any(|&bits| bits != 0);
            latch.push([current, previous]);
        }
        useful.then_some(latch)
    }

    /// Turns the coefficients of iMCU row `output_imcu_row` into samples.
    pub(crate) fn decompress_data(
        &mut self,
        d: &Decoder,
        output_imcu_row: u32,
        idcts: &[Idct],
        planes: &mut [Plane],
    ) -> Result<()> {
        let last_imcu_row = d.total_imcu_rows - 1;
        let components = d
            .comps
            .iter()
            .zip(&self.whole_image)
            .zip(idcts)
            .zip(planes.iter_mut());
        for (ci, (((comp, array), idct), plane)) in components.enumerate() {
            let block_rows = if output_imcu_row < last_imcu_row {
                comp.v_samp
            } else {
                comp.last_row_height
            };
            let size = comp.dct_scaled_size as usize;
            let first_row = (output_imcu_row * comp.v_samp) as usize;
            let width = comp.width_in_blocks as usize;

            let Some(latch) = self.smoothing.as_ref().and_then(|latch| latch.get(ci)) else {
                for block_row in 0..block_rows as usize {
                    for (block_num, block) in array
                        .row(first_row + block_row)?
                        .iter()
                        .take(width)
                        .enumerate()
                    {
                        idct.run(block, plane, block_row * size, block_num * size)?;
                    }
                }
                continue;
            };

            // Where the last scan ran out of data, what the scan before it achieved is what counts.
            let [current, previous] = latch;
            let coef_bits = if output_imcu_row > self.last_good_imcu_row {
                previous
            } else {
                current
            };
            let smoother =
                Smoother::new(coef_bits, comp.quant_table.as_ref().ok_or(Error::Internal)?);

            // As in libjpeg, these count in the block rows of this iMCU row, of which the last one may have fewer.
            let image_block_rows = block_rows * d.total_imcu_rows;
            for block_row in 0..block_rows {
                let image_block_row = output_imcu_row * block_rows + block_row;
                let y = first_row + block_row as usize;
                let this = array.row(y)?;
                let prev = if image_block_row > 0 {
                    array.row(y - 1)?
                } else {
                    this
                };
                let prev_prev = if image_block_row > 1 {
                    array.row(y - 2)?
                } else {
                    prev
                };
                let next = if image_block_row + 1 < image_block_rows {
                    array.row(y + 1)?
                } else {
                    this
                };
                let next_next = if image_block_row + 2 < image_block_rows {
                    array.row(y + 2)?
                } else {
                    next
                };
                let neighbors = [prev_prev, prev, this, next, next_next];

                let dc_at =
                    |x: usize| neighbors.map(|row| row.get(x).map_or(0, |&[dc, ..]| i32::from(dc)));
                // A window of five columns slides along. Past either edge the edge column repeats.
                let first = dc_at(0);
                let mut window = [first; 5];
                for (block_num, block) in this.iter().take(width).enumerate() {
                    let [_, _, _, c3, c4] = &mut window;
                    if block_num == 0 && block_num + 1 < width {
                        *c3 = dc_at(1);
                        *c4 = *c3;
                    }
                    if block_num + 2 < width {
                        *c4 = dc_at(block_num + 2);
                    }
                    let mut workspace = *block;
                    smoother.smooth(&window, &mut workspace);
                    idct.run(
                        &workspace,
                        plane,
                        block_row as usize * size,
                        block_num * size,
                    )?;
                    let [_, c1, c2, c3, c4] = window;
                    window = [c1, c2, c3, c4, c4];
                }
            }
        }
        Ok(())
    }
}

struct Smoother {
    coef_bits: [i32; SAVED_COEFS],
    /// With no AC coefficient seen at all, more of them are estimated and the DC coefficient is smoothed too.
    change_dc: bool,
    quant: [i64; SAVED_COEFS],
}

impl Smoother {
    fn new(coef_bits: &[i32; SAVED_COEFS], quant: &[u16; 64]) -> Self {
        let [_, ac @ ..] = coef_bits;
        Smoother {
            coef_bits: *coef_bits,
            change_dc: ac.iter().all(|&bits| bits == -1),
            quant: low_frequencies(quant).map(i64::from),
        }
    }

    /// `num / (256 * q)` rounded to nearest, and no larger than the bits that are missing allow.
    fn predict(num: i64, q: i64, al: i32) -> i16 {
        let limit = |pred: i32| {
            if al > 0 && pred >= 1 << al {
                (1 << al) - 1
            } else {
                pred
            }
        };
        let pred = if num >= 0 {
            limit((((q << 7) + num) / (q << 8)) as i32)
        } else {
            limit((((q << 7) - num) / (q << 8)) as i32).wrapping_neg()
        };
        pred as i16
    }

    /// `window[x][y]` is the DC coefficient of the block `x - 2` to the right and `y - 2` below.
    fn smooth(&self, window: &[[i32; 5]; 5], block: &mut Block) {
        let [
            [dc01, dc06, dc11, dc16, dc21],
            [dc02, dc07, dc12, dc17, dc22],
            [dc03, dc08, dc13, dc18, dc23],
            [dc04, dc09, dc14, dc19, dc24],
            [dc05, dc10, dc15, dc20, dc25],
        ] = *window;
        let [_, al01, al10, al20, al11, al02, al03, al12, al21, al30] = self.coef_bits;
        let [q00, q01, q10, q20, q11, q02, q03, q12, q21, q30] = self.quant;
        let mut coefs = low_frequencies(block);
        let [c00, c01, c10, c20, c11, c02, c03, c12, c21, c30] = &mut coefs;
        let change_dc = self.change_dc;

        // Only a coefficient that is still zero and not known in full is estimated.
        if al01 != 0 && *c01 == 0 {
            let num = q00
                * i64::from(if change_dc {
                    -dc01 - dc02 + dc04 + dc05 - 3 * dc06 + 13 * dc07 - 13 * dc09 + 3 * dc10
                        - 3 * dc11
                        + 38 * dc12
                        - 38 * dc14
                        + 3 * dc15
                        - 3 * dc16
                        + 13 * dc17
                        - 13 * dc19
                        + 3 * dc20
                        - dc21
                        - dc22
                        + dc24
                        + dc25
                } else {
                    -7 * dc11 + 50 * dc12 - 50 * dc14 + 7 * dc15
                });
            *c01 = Self::predict(num, q01, al01);
        }
        if al10 != 0 && *c10 == 0 {
            let num = q00
                * i64::from(if change_dc {
                    -dc01 - 3 * dc02 - 3 * dc03 - 3 * dc04 - dc05 - dc06
                        + 13 * dc07
                        + 38 * dc08
                        + 13 * dc09
                        - dc10
                        + dc16
                        - 13 * dc17
                        - 38 * dc18
                        - 13 * dc19
                        + dc20
                        + dc21
                        + 3 * dc22
                        + 3 * dc23
                        + 3 * dc24
                        + dc25
                } else {
                    -7 * dc03 + 50 * dc08 - 50 * dc18 + 7 * dc23
                });
            *c10 = Self::predict(num, q10, al10);
        }
        if al20 != 0 && *c20 == 0 {
            let num = q00
                * i64::from(if change_dc {
                    dc03 + 2 * dc07 + 7 * dc08 + 2 * dc09 - 5 * dc12 - 14 * dc13 - 5 * dc14
                        + 2 * dc17
                        + 7 * dc18
                        + 2 * dc19
                        + dc23
                } else {
                    -dc03 + 13 * dc08 - 24 * dc13 + 13 * dc18 - dc23
                });
            *c20 = Self::predict(num, q20, al20);
        }
        if al11 != 0 && *c11 == 0 {
            let num = q00
                * i64::from(if change_dc {
                    -dc01 + dc05 + 9 * dc07 - 9 * dc09 - 9 * dc17 + 9 * dc19 + dc21 - dc25
                } else {
                    dc10 + dc16 - 10 * dc17 + 10 * dc19 - dc02 - dc20 + dc22 - dc24 + dc04 - dc06
                        + 10 * dc07
                        - 10 * dc09
                });
            *c11 = Self::predict(num, q11, al11);
        }
        if al02 != 0 && *c02 == 0 {
            let num = q00
                * i64::from(if change_dc {
                    2 * dc07 - 5 * dc08 + 2 * dc09 + dc11 + 7 * dc12 - 14 * dc13
                        + 7 * dc14
                        + dc15
                        + 2 * dc17
                        - 5 * dc18
                        + 2 * dc19
                } else {
                    -dc11 + 13 * dc12 - 24 * dc13 + 13 * dc14 - dc15
                });
            *c02 = Self::predict(num, q02, al02);
        }
        if change_dc {
            if al03 != 0 && *c03 == 0 {
                let num = q00 * i64::from(dc07 - dc09 + 2 * dc12 - 2 * dc14 + dc17 - dc19);
                *c03 = Self::predict(num, q03, al03);
            }
            if al12 != 0 && *c12 == 0 {
                let num = q00 * i64::from(dc07 - 3 * dc08 + dc09 - dc17 + 3 * dc18 - dc19);
                *c12 = Self::predict(num, q12, al12);
            }
            if al21 != 0 && *c21 == 0 {
                let num = q00 * i64::from(dc07 - dc09 - 3 * dc12 + 3 * dc14 + dc17 - dc19);
                *c21 = Self::predict(num, q21, al21);
            }
            if al30 != 0 && *c30 == 0 {
                let num = q00 * i64::from(dc07 + 2 * dc08 + dc09 - dc17 - 2 * dc18 - dc19);
                *c30 = Self::predict(num, q30, al30);
            }
            let num = q00
                * i64::from(
                    -2 * dc01 - 6 * dc02 - 8 * dc03 - 6 * dc04 - 2 * dc05 - 6 * dc06
                        + 6 * dc07
                        + 42 * dc08
                        + 6 * dc09
                        - 6 * dc10
                        - 8 * dc11
                        + 42 * dc12
                        + 152 * dc13
                        + 42 * dc14
                        - 8 * dc15
                        - 6 * dc16
                        + 6 * dc17
                        + 42 * dc18
                        + 6 * dc19
                        - 6 * dc20
                        - 2 * dc21
                        - 6 * dc22
                        - 8 * dc23
                        - 6 * dc24
                        - 2 * dc25,
                );
            *c00 = Self::predict(num, q00, 0);
        }
        for (k, coef) in coefs.into_iter().enumerate() {
            if let Some(out) = coef_at(block, k) {
                *out = coef;
            }
        }
    }
}
