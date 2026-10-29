//! The decoder. `Decoder::new` reads up to the first scan, `Decoder::decode` does the rest.

mod arith;
mod bits;
mod coef;
mod color;
mod huff;
mod idct;
mod input;
mod lossless;
mod marker;
mod output;
mod phuff;
mod upsample;

use crate::error::{Error, Result};
use crate::tables::{HuffSpec, MAX_DIMENSION};
use crate::zigzag::natural_order;
use input::Input;
use marker::{IccPiece, Reached};
pub use output::DecodeOptions;

pub(crate) const NUM_QUANT_TABLES: usize = 4;
pub(crate) const NUM_HUFF_TABLES: usize = 4;
pub(crate) const NUM_ARITH_TABLES: usize = 16;
pub(crate) const MAX_COMPONENTS_IN_SCAN: usize = 4;
pub(crate) const MAX_SAMP_FACTOR: u32 = 4;
pub(crate) const MAX_COMPONENTS: usize = 10;
pub(crate) const MAX_BLOCKS_IN_MCU: usize = 10;
pub(crate) const DCTSIZE: u32 = 8;

/// 64 coefficients in row-major order.
pub(crate) type Block = [i16; 64];

/// The `k`th coefficient in zigzag order.
#[inline(always)]
pub(crate) fn coef_at(block: &mut Block, k: usize) -> Result<&mut i16> {
    block.get_mut(natural_order(k)).ok_or(Error::Internal)
}

/// What the components of the stream mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorSpace {
    Grayscale,
    Rgb,
    YCbCr,
    Cmyk,
    Ycck,
}

#[derive(Default)]
pub(crate) struct Component {
    id: u8,
    h_samp: u32,
    v_samp: u32,
    quant_selector: u8,
    dc_selector: u8,
    ac_selector: u8,

    /// In data units: 8x8 blocks, or single samples in a lossless stream.
    width_in_blocks: u32,
    height_in_blocks: u32,
    /// Rows of data units in the last iMCU row. The others have `v_samp`.
    last_row_height: u32,
    /// The side of the square of samples that the inverse DCT makes of a block.
    dct_scaled_size: u32,
    /// In samples, after the inverse DCT.
    downsampled_width: u32,
    downsampled_height: u32,
    /// The table that was current when the first scan with this component began.
    quant_table: Option<[u16; 64]>,
    /// Whether a scan has had this component. Only a progressive stream may come back to one.
    scanned: bool,

    // These depend on the scan.
    mcu_width: u32,
    mcu_height: u32,
    last_col_width: u32,
}

impl Component {
    /// `width_in_blocks` rounded up to whole MCUs of a scan with all the components.
    fn padded_width(&self) -> usize {
        self.width_in_blocks.next_multiple_of(self.h_samp) as usize
    }

    /// `height_in_blocks` rounded up likewise.
    fn padded_height(&self) -> usize {
        self.height_in_blocks.next_multiple_of(self.v_samp) as usize
    }
}

/// What a block of an MCU is decoded with.
#[derive(Default, Clone, Copy)]
pub(crate) struct McuBlock {
    /// Index into `scan_components`.
    scan_component: u8,
    dc_selector: u8,
    ac_selector: u8,
    /// An image scaled to 1/8 is made of the DC coefficients alone.
    ac_needed: bool,
}

pub struct Decoder<'a> {
    input: Input<'a>,
    saw_soi: bool,
    saw_sof: bool,

    quant_tables: [Option<[u16; 64]>; NUM_QUANT_TABLES],
    dc_huff: [Option<Box<HuffSpec>>; NUM_HUFF_TABLES],
    ac_huff: [Option<Box<HuffSpec>>; NUM_HUFF_TABLES],
    arith_dc_l: [u8; NUM_ARITH_TABLES],
    arith_dc_u: [u8; NUM_ARITH_TABLES],
    arith_ac_k: [u8; NUM_ARITH_TABLES],
    restart_interval: u32,

    progressive: bool,
    lossless: bool,
    arith_code: bool,
    precision: u8,
    width: u32,
    height: u32,
    components: Vec<Component>,

    saw_jfif: bool,
    /// From the Adobe APP14 segment, if there is one.
    adobe_transform: Option<u8>,
    color_space: ColorSpace,
    /// From the APP2 segments before the first scan.
    icc_pieces: Vec<IccPiece<'a>>,

    components_in_scan: usize,
    /// Indexes into `components`.
    scan_components: [Option<usize>; MAX_COMPONENTS_IN_SCAN],
    ss: u8,
    se: u8,
    ah: u8,
    al: u8,
    input_scan_number: u32,

    has_multiple_scans: bool,
    max_h_samp: u32,
    max_v_samp: u32,
    /// An iMCU row is what a row of MCUs of a scan with all the components covers.
    total_imcu_rows: u32,

    mcus_per_row: u32,
    blocks_in_mcu: usize,
    mcu_blocks: [McuBlock; MAX_BLOCKS_IN_MCU],
}

/// How many are in the last group when `total` are put in groups of `size`.
pub(crate) fn last_group(total: u32, size: u32) -> u32 {
    match total % size {
        0 => size,
        n => n,
    }
}

impl<'a> Decoder<'a> {
    /// Reads everything before the first scan.
    pub fn new(data: &'a [u8]) -> Result<Self> {
        if data.is_empty() {
            return Err(Error::InputEmpty);
        }
        let mut this = Decoder {
            input: Input::new(data),
            saw_soi: false,
            saw_sof: false,
            quant_tables: [None; NUM_QUANT_TABLES],
            dc_huff: [const { None }; NUM_HUFF_TABLES],
            ac_huff: [const { None }; NUM_HUFF_TABLES],
            arith_dc_l: [0; NUM_ARITH_TABLES],
            arith_dc_u: [1; NUM_ARITH_TABLES],
            arith_ac_k: [5; NUM_ARITH_TABLES],
            restart_interval: 0,
            progressive: false,
            lossless: false,
            arith_code: false,
            precision: 0,
            width: 0,
            height: 0,
            components: Vec::new(),
            saw_jfif: false,
            adobe_transform: None,
            color_space: ColorSpace::Grayscale,
            icc_pieces: Vec::new(),
            components_in_scan: 0,
            scan_components: [None; MAX_COMPONENTS_IN_SCAN],
            ss: 0,
            se: 0,
            ah: 0,
            al: 0,
            input_scan_number: 0,
            has_multiple_scans: false,
            max_h_samp: 1,
            max_v_samp: 1,
            total_imcu_rows: 0,
            mcus_per_row: 0,
            blocks_in_mcu: 0,
            mcu_blocks: [McuBlock::default(); MAX_BLOCKS_IN_MCU],
        };
        match this.read_markers()? {
            Reached::Sos => this.initial_setup()?,
            Reached::Eoi if this.saw_sof => return Err(Error::SofNoSos),
            // Only tables.
            Reached::Eoi => return Err(Error::NoImage),
        }
        this.color_space = this.guess_color_space()?;
        Ok(this)
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn color_space(&self) -> ColorSpace {
        self.color_space
    }

    /// Whether `decode` takes fewer than 8 eighths: the streams for which TurboJPEG takes a cropping region.
    pub fn scalable(&self) -> bool {
        !self.lossless && self.precision == 8 && self.subsampling_known()
    }

    /// Whether the sampling factors are one of 4:4:4, 4:2:2, 4:2:0, 4:4:0, 4:1:1 and 4:4:1, or the image is gray.
    fn subsampling_known(&self) -> bool {
        let Some((first, others)) = self.components.split_first() else {
            return false;
        };
        if others.is_empty() {
            return true;
        }
        let first = (first.h_samp, first.v_samp);
        // The fourth component of CMYK and YCCK is sampled like the first.
        let all = |chroma: (u32, u32), fourth: (u32, u32)| {
            others
                .iter()
                .enumerate()
                .all(|(i, c)| (c.h_samp, c.v_samp) == if i == 2 { fourth } else { chroma })
        };
        let usual = matches!(first, (1, 1) | (2, 1) | (2, 2) | (1, 2) | (4, 1) | (1, 4))
            && all((1, 1), first);
        // 4:2:2 and 4:4:0 written with doubled factors.
        let doubled = first == (2, 2) && (all((1, 2), first) || all((2, 1), first));
        // 4:4:4 written with factors other than 1.
        let same = first.0 * first.1 <= MAX_BLOCKS_IN_MCU as u32 / 3 && all(first, first);
        usual || doubled || same
    }

    /// The side of a data unit in samples.
    fn data_unit(&self) -> u32 {
        if self.lossless { 1 } else { DCTSIZE }
    }

    pub(crate) fn component(&self, ci: usize) -> Result<&Component> {
        self.components.get(ci).ok_or(Error::Internal)
    }

    /// The component in slot `i` of the scan, as an index into `components`.
    pub(crate) fn scan_component_index(&self, i: usize) -> Result<usize> {
        self.scan_components
            .get(i)
            .copied()
            .flatten()
            .ok_or(Error::Internal)
    }

    pub(crate) fn scan_component(&self, i: usize) -> Result<&Component> {
        self.component(self.scan_component_index(i)?)
    }

    fn scan_component_mut(&mut self, i: usize) -> Result<&mut Component> {
        let ci = self.scan_component_index(i)?;
        self.components.get_mut(ci).ok_or(Error::Internal)
    }

    /// Once, when the first SOS has been read.
    fn initial_setup(&mut self) -> Result<()> {
        let data_unit = self.data_unit();

        if self.height > MAX_DIMENSION || self.width > MAX_DIMENSION {
            return Err(Error::ImageTooBig(MAX_DIMENSION));
        }
        if self.lossless {
            if !(2..=16).contains(&self.precision) {
                return Err(Error::BadPrecision(self.precision));
            }
        } else if self.precision != 8 && self.precision != 12 {
            return Err(Error::BadPrecision(self.precision));
        }
        if self.components.len() > MAX_COMPONENTS {
            return Err(Error::ComponentCount(
                self.components.len() as u32,
                MAX_COMPONENTS as u32,
            ));
        }

        for comp in &self.components {
            if !(1..=MAX_SAMP_FACTOR).contains(&comp.h_samp)
                || !(1..=MAX_SAMP_FACTOR).contains(&comp.v_samp)
            {
                return Err(Error::BadSampling);
            }
            self.max_h_samp = self.max_h_samp.max(comp.h_samp);
            self.max_v_samp = self.max_v_samp.max(comp.v_samp);
        }

        for comp in &mut self.components {
            comp.dct_scaled_size = data_unit;
            comp.width_in_blocks = (self.width * comp.h_samp).div_ceil(self.max_h_samp * data_unit);
            comp.height_in_blocks =
                (self.height * comp.v_samp).div_ceil(self.max_v_samp * data_unit);
            comp.downsampled_width = (self.width * comp.h_samp).div_ceil(self.max_h_samp);
            comp.downsampled_height = (self.height * comp.v_samp).div_ceil(self.max_v_samp);
            comp.last_row_height = last_group(comp.height_in_blocks, comp.v_samp);
        }
        self.total_imcu_rows = self.height.div_ceil(self.max_v_samp * data_unit);
        self.has_multiple_scans =
            self.components_in_scan < self.components.len() || self.progressive;
        Ok(())
    }

    fn guess_color_space(&self) -> Result<ColorSpace> {
        Ok(match (self.components.as_slice(), self.adobe_transform) {
            ([_], _) => ColorSpace::Grayscale,
            ([_, _, _], _) if self.saw_jfif => ColorSpace::YCbCr,
            ([_, _, _], Some(0)) => ColorSpace::Rgb,
            ([_, _, _], Some(_)) => ColorSpace::YCbCr,
            ([c0, c1, c2], None) if (c0.id, c1.id, c2.id) == (b'R', b'G', b'B') => ColorSpace::Rgb,
            ([_, _, _], None) if self.lossless => ColorSpace::Rgb,
            ([_, _, _], None) => ColorSpace::YCbCr,
            ([_, _, _, _], None | Some(0)) => ColorSpace::Cmyk,
            ([_, _, _, _], Some(_)) => ColorSpace::Ycck,
            _ => return Err(Error::UnknownColorSpace),
        })
    }

    /// Before each scan.
    pub(crate) fn per_scan_setup(&mut self) -> Result<()> {
        let data_unit = self.data_unit();
        let interleaved = self.components_in_scan > 1;
        self.mcus_per_row = if interleaved {
            self.width.div_ceil(self.max_h_samp * data_unit)
        } else {
            self.scan_component(0)?.width_in_blocks
        };
        self.blocks_in_mcu = 0;
        for i in 0..self.components_in_scan {
            let comp = self.scan_component_mut(i)?;
            (comp.mcu_width, comp.mcu_height) = if interleaved {
                (comp.h_samp, comp.v_samp)
            } else {
                (1, 1)
            };
            comp.last_col_width = last_group(comp.width_in_blocks, comp.mcu_width);
            let blocks = comp.mcu_width * comp.mcu_height;
            let block = McuBlock {
                scan_component: i as u8,
                dc_selector: comp.dc_selector,
                ac_selector: comp.ac_selector,
                ac_needed: comp.dct_scaled_size > 1,
            };
            for _ in 0..blocks {
                *self
                    .mcu_blocks
                    .get_mut(self.blocks_in_mcu)
                    .ok_or(Error::BadMcuSize)? = block;
                self.blocks_in_mcu += 1;
            }
        }
        Ok(())
    }

    /// Rows of data units of `comp` in iMCU row `imcu_row`.
    pub(crate) fn rows_in_imcu_row(&self, comp: &Component, imcu_row: u32) -> u32 {
        if imcu_row + 1 < self.total_imcu_rows {
            comp.v_samp
        } else {
            comp.last_row_height
        }
    }

    /// An iMCU row of a scan with one component has as many rows of MCUs as the component has rows of data units in it.
    pub(crate) fn mcu_rows_in_imcu_row(&self, imcu_row: u32) -> Result<u32> {
        Ok(if self.components_in_scan > 1 {
            1
        } else {
            self.rows_in_imcu_row(self.scan_component(0)?, imcu_row)
        })
    }

    /// A later scan may come after the slot of a quantization table was redefined, so each component keeps the table
    /// its first scan began with.
    pub(crate) fn latch_quant_tables(&mut self) -> Result<()> {
        for i in 0..self.components_in_scan {
            let ci = self.scan_component_index(i)?;
            let comp = self.components.get_mut(ci).ok_or(Error::Internal)?;
            if comp.quant_table.is_none() {
                let table = self.quant_tables.get(usize::from(comp.quant_selector));
                let table = table.copied().flatten();
                comp.quant_table = Some(table.ok_or(Error::NoQuantTable(comp.quant_selector))?);
            }
        }
        Ok(())
    }
}
