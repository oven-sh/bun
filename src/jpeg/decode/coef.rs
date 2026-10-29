//! Between the entropy decoder and the inverse DCT (jdcoefct.c): one MCU at a time if the stream has a single scan, the
//! coefficients of the whole image otherwise.

use super::arith::ArithDecoder;
use super::huff::HuffDecoder;
use super::idct::{self, DctTable};
use super::input::Input;
use super::phuff::PHuffDecoder;
use super::{Block, Component, Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPONENTS, coef_at};
use crate::alloc::{try_box, try_collect, try_vec, try_vec_with_capacity};
use crate::error::{Error, Result};
use crate::zigzag::natural_order;

/// Where an entropy decoder finds the blocks of the MCU it is decoding.
pub(crate) trait McuBlocks {
    fn block(&mut self, index: usize) -> Option<&mut Block>;
}

impl McuBlocks for [Block; MAX_BLOCKS_IN_MCU] {
    #[inline(always)]
    fn block(&mut self, index: usize) -> Option<&mut Block> {
        self.get_mut(index)
    }
}

pub(crate) enum Entropy {
    Huff(Box<HuffDecoder>),
    PHuff(Box<PHuffDecoder>),
    Arith(Box<ArithDecoder>),
}

impl Entropy {
    pub(crate) fn start_pass(&mut self, decoder: &Decoder) -> Result<()> {
        match self {
            Entropy::Huff(e) => e.start_pass(decoder),
            Entropy::PHuff(e) => e.start_pass(decoder),
            Entropy::Arith(e) => e.start_pass(decoder),
        }
    }

    #[inline(always)]
    fn decode_mcu(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        match self {
            Entropy::Huff(e) => e.decode_mcu(input, mcu),
            Entropy::PHuff(e) => e.decode_mcu(input, mcu),
            Entropy::Arith(e) => e.decode_mcu(input, mcu),
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
    pub(crate) fn new(num_components: usize) -> Result<Self> {
        Ok(CoefBits {
            current: try_vec([-1; 64], num_components)?,
            previous: try_vec([-1; 64], num_components)?,
        })
    }
}

/// Rows of samples, differences or blocks of one component.
pub(crate) struct Rows<T> {
    pub(crate) data: Vec<T>,
    pub(crate) stride: usize,
}

pub(crate) type Plane = Rows<u8>;

impl<T: Clone> Rows<T> {
    pub(crate) fn new(stride: usize, rows: usize) -> Result<Self>
    where
        T: Default,
    {
        let data = try_vec(T::default(), stride * rows)?;
        Ok(Rows { data, stride })
    }

    /// All of `comp`, padded to whole MCUs. Empty until `fill`: memory that no one has written to costs nothing.
    fn with_room_for(comp: &Component) -> Result<Self> {
        let stride = comp.padded_width();
        let data = try_vec_with_capacity(stride * comp.padded_height())?;
        Ok(Rows { data, stride })
    }

    fn fill(&mut self, comp: &Component, zero: T) {
        self.data.resize(self.stride * comp.padded_height(), zero);
    }

    #[inline(always)]
    pub(crate) fn row(&self, y: usize) -> Result<&[T]> {
        self.data
            .get(y * self.stride..(y + 1) * self.stride)
            .ok_or(Error::Internal)
    }

    pub(crate) fn row_mut(&mut self, y: usize) -> Result<&mut [T]> {
        self.data
            .get_mut(y * self.stride..(y + 1) * self.stride)
            .ok_or(Error::Internal)
    }
}

/// Before each scan of a stream with several: room for every component, and zeros for the components of the scan.
pub(crate) fn start_scan_into<T: Clone>(
    whole_image: &mut Vec<Rows<T>>,
    decoder: &Decoder,
    zero: T,
) -> Result<()> {
    // Only now that the first scan has turned out to be valid: a few bytes can ask for gigabytes of zeros.
    if whole_image.is_empty() {
        whole_image.try_reserve(decoder.components.len())?;
        for comp in &decoder.components {
            whole_image.push(Rows::with_room_for(comp)?);
        }
    }
    for i in 0..decoder.components_in_scan {
        let ci = decoder.scan_component_index(i)?;
        let rows = whole_image.get_mut(ci).ok_or(Error::Internal)?;
        rows.fill(decoder.component(ci)?, zero.clone());
    }
    Ok(())
}

impl Plane {
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

/// Puts the `size` by `size` samples that `coefs` make at column `x` of row `y` of `plane`.
#[inline(always)]
fn inverse_dct(
    coefs: &Block,
    table: &DctTable,
    size: usize,
    plane: &mut Plane,
    y: usize,
    x: usize,
) -> Result<()> {
    match size {
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

/// The blocks of one MCU inside the arrays of the whole image.
struct McuInImage<'a> {
    arrays: &'a mut [Rows<Block>],
    /// For each block, its component and its index in that component's array.
    at: [(usize, usize); MAX_BLOCKS_IN_MCU],
}

impl McuBlocks for McuInImage<'_> {
    #[inline(always)]
    fn block(&mut self, index: usize) -> Option<&mut Block> {
        let &(ci, position) = self.at.get(index)?;
        self.arrays.get_mut(ci)?.data.get_mut(position)
    }
}

/// How many of `CoefBits`'s entries block smoothing looks at.
pub(crate) const SAVED_COEFS: usize = 10;

/// The current and the previous precision of a component's first coefficients.
type Latch = [[i32; SAVED_COEFS]; 2];

/// The first `SAVED_COEFS` in zigzag order of 64 in row-major order.
fn low_frequencies<T: Copy + Default>(block: &[T; 64]) -> [T; SAVED_COEFS] {
    core::array::from_fn(|k| block.get(natural_order(k)).copied().unwrap_or_default())
}

pub(crate) struct CoefController {
    pub(crate) entropy: Entropy,
    input_imcu_row: u32,
    mcu_buffer: Box<[Block; MAX_BLOCKS_IN_MCU]>,
    /// Per component, from `start_output_pass` on.
    dct_tables: Vec<DctTable>,
    /// Empty if the stream has a single scan.
    whole_image: Vec<Rows<Block>>,
    /// The last iMCU row of the current scan that began with data left to decode.
    last_good_imcu_row: u32,
    /// `Some` while the output pass smooths. Per component, the current and the previous precision.
    smoothing: Option<Box<[Latch; MAX_COMPONENTS]>>,
}

impl CoefController {
    pub(crate) fn new(entropy: Entropy) -> Result<Self> {
        Ok(CoefController {
            entropy,
            input_imcu_row: 0,
            mcu_buffer: try_box([[0; 64]; MAX_BLOCKS_IN_MCU])?,
            dct_tables: Vec::new(),
            whole_image: Vec::new(),
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
        decoder: &mut Decoder,
        planes: &mut [Plane],
    ) -> Result<()> {
        let last_mcu_col = decoder.mcus_per_row - 1;

        for yoffset in 0..decoder.mcu_rows_in_imcu_row(self.input_imcu_row)? {
            for mcu_col_num in 0..=last_mcu_col {
                for block in self.mcu_buffer.iter_mut().take(decoder.blocks_in_mcu) {
                    *block = [0; 64];
                }
                self.entropy
                    .decode_mcu(&mut decoder.input, &mut *self.mcu_buffer)?;

                // Blocks past the right and bottom edges of the component are only there to fill up the MCU.
                let mut index = 0;
                for i in 0..decoder.components_in_scan {
                    let ci = decoder.scan_component_index(i)?;
                    let comp = decoder.component(ci)?;
                    let table = self.dct_tables.get(ci).ok_or(Error::Internal)?;
                    let plane = planes.get_mut(ci).ok_or(Error::Internal)?;
                    let size = comp.dct_scaled_size as usize;
                    let useful_width = if mcu_col_num < last_mcu_col {
                        comp.mcu_width
                    } else {
                        comp.last_col_width
                    };
                    let start_col = mcu_col_num as usize * comp.mcu_width as usize * size;
                    for yindex in 0..comp.mcu_height {
                        if yoffset + yindex < decoder.rows_in_imcu_row(comp, self.input_imcu_row) {
                            let y = (yoffset + yindex) as usize * size;
                            let blocks = self
                                .mcu_buffer
                                .iter()
                                .skip(index)
                                .take(useful_width as usize);
                            for (xindex, block) in blocks.enumerate() {
                                let x = start_col + xindex * size;
                                inverse_dct(block, table, size, plane, y, x)?;
                            }
                        }
                        index += comp.mcu_width as usize;
                    }
                }
            }
        }

        self.input_imcu_row += 1;
        Ok(())
    }

    /// Decodes a whole scan into the coefficient arrays.
    pub(crate) fn consume_scan(&mut self, decoder: &mut Decoder) -> Result<()> {
        start_scan_into(&mut self.whole_image, decoder, [0; 64])?;
        while self.input_imcu_row < decoder.total_imcu_rows {
            let mut mcu = McuInImage {
                arrays: &mut self.whole_image,
                at: [(0, 0); MAX_BLOCKS_IN_MCU],
            };
            for yoffset in 0..decoder.mcu_rows_in_imcu_row(self.input_imcu_row)? {
                for mcu_col_num in 0..decoder.mcus_per_row {
                    let mut at = mcu.at.iter_mut();
                    for i in 0..decoder.components_in_scan {
                        let ci = decoder.scan_component_index(i)?;
                        let comp = decoder.component(ci)?;
                        let blocks_per_row = mcu.arrays.get(ci).ok_or(Error::Internal)?.stride;
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
                    if !decoder.input.insufficient_data {
                        self.last_good_imcu_row = self.input_imcu_row;
                    }
                    self.entropy.decode_mcu(&mut decoder.input, &mut mcu)?;
                }
            }
            self.input_imcu_row += 1;
        }
        Ok(())
    }

    /// Smoothing estimates the low AC coefficients that a progressive stream has not delivered in full, which only
    /// happens if it breaks off early.
    pub(crate) fn start_output_pass(&mut self, decoder: &Decoder) -> Result<()> {
        // A component that no scan has mentioned has no table, and comes out gray.
        let tables = decoder
            .components
            .iter()
            .map(|comp| comp.quant_table.as_ref());
        self.dct_tables = try_collect(tables.map(|quant| quant.map_or([0; 64], idct::dct_table)))?;
        for (comp, array) in decoder.components.iter().zip(&mut self.whole_image) {
            array.fill(comp, [0; 64]);
        }
        self.smoothing = self.smoothing_latch(decoder).map(try_box).transpose()?;
        Ok(())
    }

    fn smoothing_latch(&self, decoder: &Decoder) -> Option<[Latch; MAX_COMPONENTS]> {
        let coef_bits = self.entropy.coef_bits()?;
        let mut latches = [Latch::default(); MAX_COMPONENTS];
        let mut useful = false;
        for (((comp, current), previous), latch) in decoder
            .components
            .iter()
            .zip(&coef_bits.current)
            .zip(&coef_bits.previous)
            .zip(&mut latches)
        {
            // These divide.
            if low_frequencies(&comp.quant_table?).contains(&0u16) {
                return None;
            }
            let current = *current.first_chunk::<SAVED_COEFS>()?;
            let mut previous = *previous.first_chunk::<SAVED_COEFS>()?;
            let [dc, ac @ ..] = current;
            if dc < 0 {
                return None;
            }
            if decoder.input_scan_number <= 1 {
                previous = [-1; SAVED_COEFS];
            }
            useful |= ac.iter().any(|&bits| bits != 0);
            *latch = [current, previous];
        }
        useful.then_some(latches)
    }

    /// Turns the coefficients of iMCU row `output_imcu_row` into samples.
    pub(crate) fn decompress_data(
        &self,
        decoder: &Decoder,
        output_imcu_row: u32,
        planes: &mut [Plane],
    ) -> Result<()> {
        for (ci, (comp, plane)) in decoder.components.iter().zip(planes).enumerate() {
            let array = self.whole_image.get(ci).ok_or(Error::Internal)?;
            let table = self.dct_tables.get(ci).ok_or(Error::Internal)?;
            let block_rows = decoder.rows_in_imcu_row(comp, output_imcu_row);
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
                        let (y, x) = (block_row * size, block_num * size);
                        inverse_dct(block, table, size, plane, y, x)?;
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
            let image_block_rows = block_rows * decoder.total_imcu_rows;
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

                let dc_at = |x: usize| -> Result<[i32; 5]> {
                    let mut column = [0; 5];
                    for (out, row) in column.iter_mut().zip(neighbors) {
                        let [dc, ..] = row.get(x).ok_or(Error::Internal)?;
                        *out = i32::from(*dc);
                    }
                    Ok(column)
                };
                // A window of five columns slides along. Past either edge the edge column repeats.
                let first = dc_at(0)?;
                let mut window = [first; 5];
                for (block_num, block) in this.iter().take(width).enumerate() {
                    let [_, _, _, c3, c4] = &mut window;
                    if block_num == 0 && block_num + 1 < width {
                        *c3 = dc_at(1)?;
                        *c4 = *c3;
                    }
                    if block_num + 2 < width {
                        *c4 = dc_at(block_num + 2)?;
                    }
                    let mut workspace = *block;
                    smoother.smooth(&window, &mut workspace)?;
                    let (y, x) = (block_row as usize * size, block_num * size);
                    inverse_dct(&workspace, table, size, plane, y, x)?;
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
    fn smooth(&self, window: &[[i32; 5]; 5], block: &mut Block) -> Result<()> {
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
            if *c03 == 0 {
                let num = q00 * i64::from(dc07 - dc09 + 2 * dc12 - 2 * dc14 + dc17 - dc19);
                *c03 = Self::predict(num, q03, al03);
            }
            if *c12 == 0 {
                let num = q00 * i64::from(dc07 - 3 * dc08 + dc09 - dc17 + 3 * dc18 - dc19);
                *c12 = Self::predict(num, q12, al12);
            }
            if *c21 == 0 {
                let num = q00 * i64::from(dc07 - dc09 - 3 * dc12 + 3 * dc14 + dc17 - dc19);
                *c21 = Self::predict(num, q21, al21);
            }
            if *c30 == 0 {
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
            *coef_at(block, k)? = coef;
        }
        Ok(())
    }
}
