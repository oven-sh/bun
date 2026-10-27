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
use crate::tables::{HuffSpec, MAX_DIMENSION, natural_order};
use input::Input;
use marker::Reached;
use std::borrow::Cow;

pub(crate) const NUM_QUANT_TBLS: usize = 4;
pub(crate) const NUM_HUFF_TBLS: usize = 4;
pub(crate) const NUM_ARITH_TBLS: usize = 16;
pub(crate) const MAX_COMPS_IN_SCAN: usize = 4;
pub(crate) const MAX_SAMP_FACTOR: u32 = 4;
pub(crate) const MAX_COMPONENTS: usize = 10;
pub(crate) const MAX_BLOCKS_IN_MCU: usize = 10;
pub(crate) const DCTSIZE: u32 = 8;

/// 64 coefficients in row-major order.
pub(crate) type Block = [i16; 64];

/// The `k`th coefficient in zigzag order.
#[inline(always)]
pub(crate) fn coef_at(block: &mut Block, k: usize) -> Option<&mut i16> {
    block.get_mut(natural_order(k))
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

#[derive(Default, Clone)]
pub(crate) struct Component {
    pub(crate) id: u8,
    pub(crate) h_samp: u32,
    pub(crate) v_samp: u32,
    pub(crate) quant_tbl_no: u8,
    pub(crate) dc_tbl_no: u8,
    pub(crate) ac_tbl_no: u8,

    /// In data units: 8x8 blocks, or single samples in a lossless stream.
    pub(crate) width_in_blocks: u32,
    pub(crate) height_in_blocks: u32,
    /// Rows of data units in the last iMCU row. The others have `v_samp`.
    pub(crate) last_row_height: u32,
    /// The side of the square of samples that the inverse DCT makes of a block.
    pub(crate) dct_scaled_size: u32,
    /// In samples, after the inverse DCT.
    pub(crate) downsampled_width: u32,
    pub(crate) downsampled_height: u32,
    /// The table that was current when the first scan with this component began.
    pub(crate) quant_table: Option<[u16; 64]>,

    // These depend on the scan.
    pub(crate) mcu_width: u32,
    pub(crate) mcu_height: u32,
    pub(crate) last_col_width: u32,
}

pub struct Decoder<'a> {
    pub(crate) inp: Input<'a>,
    saw_soi: bool,
    saw_sof: bool,

    quant_tbls: [Option<[u16; 64]>; NUM_QUANT_TBLS],
    pub(crate) dc_huff: [Option<Box<HuffSpec>>; NUM_HUFF_TBLS],
    pub(crate) ac_huff: [Option<Box<HuffSpec>>; NUM_HUFF_TBLS],
    pub(crate) arith_dc_l: [u8; NUM_ARITH_TBLS],
    pub(crate) arith_dc_u: [u8; NUM_ARITH_TBLS],
    pub(crate) arith_ac_k: [u8; NUM_ARITH_TBLS],
    pub(crate) restart_interval: u32,

    pub(crate) progressive: bool,
    pub(crate) lossless: bool,
    pub(crate) arith_code: bool,
    pub(crate) precision: u8,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) comps: Vec<Component>,

    saw_jfif: bool,
    /// From the Adobe APP14 segment, if there is one.
    adobe_transform: Option<u8>,
    color_space: ColorSpace,
    /// The APP2 segments before the first scan.
    app2: Vec<Cow<'a, [u8]>>,
    in_header: bool,

    pub(crate) comps_in_scan: usize,
    /// Indexes into `comps`.
    pub(crate) cur_comp: [Option<usize>; MAX_COMPS_IN_SCAN],
    pub(crate) ss: u8,
    pub(crate) se: u8,
    pub(crate) ah: u8,
    pub(crate) al: u8,
    pub(crate) input_scan_number: u32,

    pub(crate) has_multiple_scans: bool,
    pub(crate) max_h_samp: u32,
    pub(crate) max_v_samp: u32,
    /// An iMCU row is what a row of MCUs of a scan with all the components covers.
    pub(crate) total_imcu_rows: u32,

    pub(crate) mcus_per_row: u32,
    pub(crate) blocks_in_mcu: usize,
    /// For each block of an MCU, the index into `cur_comp` of its component.
    pub(crate) mcu_membership: [u8; MAX_BLOCKS_IN_MCU],
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
            inp: Input::new(data),
            saw_soi: false,
            saw_sof: false,
            quant_tbls: [None; NUM_QUANT_TBLS],
            dc_huff: [const { None }; NUM_HUFF_TBLS],
            ac_huff: [const { None }; NUM_HUFF_TBLS],
            arith_dc_l: [0; NUM_ARITH_TBLS],
            arith_dc_u: [1; NUM_ARITH_TBLS],
            arith_ac_k: [5; NUM_ARITH_TBLS],
            restart_interval: 0,
            progressive: false,
            lossless: false,
            arith_code: false,
            precision: 0,
            width: 0,
            height: 0,
            comps: Vec::new(),
            saw_jfif: false,
            adobe_transform: None,
            color_space: ColorSpace::Grayscale,
            app2: Vec::new(),
            in_header: true,
            comps_in_scan: 0,
            cur_comp: [None; MAX_COMPS_IN_SCAN],
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
            mcu_membership: [0; MAX_BLOCKS_IN_MCU],
        };
        match this.read_markers()? {
            Reached::Sos => this.initial_setup()?,
            Reached::Eoi if this.saw_sof => return Err(Error::SofNoSos),
            // Only tables.
            Reached::Eoi => return Err(Error::NoImage),
        }
        this.in_header = false;
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

    /// Whether `decode` takes a `scale` other than 8. TurboJPEG allowed a cropping region, which Bun relied on when it
    /// scaled, for exactly these streams.
    pub fn scalable(&self) -> bool {
        !self.lossless && self.precision == 8 && self.subsampling_known()
    }

    /// Whether the sampling factors are one of 4:4:4, 4:2:2, 4:2:0, 4:4:0, 4:1:1 and 4:4:1, or the image is gray.
    fn subsampling_known(&self) -> bool {
        let Some((first, others)) = self.comps.split_first() else {
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

    pub(crate) fn comp(&self, ci: usize) -> Result<&Component> {
        self.comps.get(ci).ok_or(Error::Internal)
    }

    /// The component in slot `i` of the scan, as an index into `comps`.
    pub(crate) fn scan_comp_index(&self, i: usize) -> Result<usize> {
        self.cur_comp
            .get(i)
            .copied()
            .flatten()
            .ok_or(Error::Internal)
    }

    pub(crate) fn scan_comp(&self, i: usize) -> Result<&Component> {
        self.comp(self.scan_comp_index(i)?)
    }

    /// Once, when the first SOS has been read.
    fn initial_setup(&mut self) -> Result<()> {
        let data_unit = if self.lossless { 1 } else { DCTSIZE };

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
        if self.comps.len() > MAX_COMPONENTS {
            return Err(Error::ComponentCount(
                self.comps.len() as u32,
                MAX_COMPONENTS as u32,
            ));
        }

        for comp in &self.comps {
            if !(1..=MAX_SAMP_FACTOR).contains(&comp.h_samp)
                || !(1..=MAX_SAMP_FACTOR).contains(&comp.v_samp)
            {
                return Err(Error::BadSampling);
            }
            self.max_h_samp = self.max_h_samp.max(comp.h_samp);
            self.max_v_samp = self.max_v_samp.max(comp.v_samp);
        }

        for comp in &mut self.comps {
            comp.dct_scaled_size = data_unit;
            comp.width_in_blocks = (self.width * comp.h_samp).div_ceil(self.max_h_samp * data_unit);
            comp.height_in_blocks =
                (self.height * comp.v_samp).div_ceil(self.max_v_samp * data_unit);
            comp.downsampled_width = (self.width * comp.h_samp).div_ceil(self.max_h_samp);
            comp.downsampled_height = (self.height * comp.v_samp).div_ceil(self.max_v_samp);
            comp.last_row_height = last_group(comp.height_in_blocks, comp.v_samp);
        }
        self.total_imcu_rows = self.height.div_ceil(self.max_v_samp * data_unit);
        self.has_multiple_scans = self.comps_in_scan < self.comps.len() || self.progressive;
        Ok(())
    }

    fn guess_color_space(&self) -> Result<ColorSpace> {
        Ok(match (self.comps.as_slice(), self.adobe_transform) {
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
        let data_unit = if self.lossless { 1 } else { DCTSIZE };

        if self.comps_in_scan == 1 {
            let ci = self.scan_comp_index(0)?;
            let comp = self.comps.get_mut(ci).ok_or(Error::Internal)?;
            self.mcus_per_row = comp.width_in_blocks;
            comp.mcu_width = 1;
            comp.mcu_height = 1;
            comp.last_col_width = 1;
            self.blocks_in_mcu = 1;
            self.mcu_membership = [0; MAX_BLOCKS_IN_MCU];
        } else {
            self.mcus_per_row = self.width.div_ceil(self.max_h_samp * data_unit);
            self.blocks_in_mcu = 0;
            for i in 0..self.comps_in_scan {
                let ci = self.scan_comp_index(i)?;
                let comp = self.comps.get_mut(ci).ok_or(Error::Internal)?;
                comp.mcu_width = comp.h_samp;
                comp.mcu_height = comp.v_samp;
                comp.last_col_width = last_group(comp.width_in_blocks, comp.mcu_width);
                for _ in 0..comp.mcu_width * comp.mcu_height {
                    *self
                        .mcu_membership
                        .get_mut(self.blocks_in_mcu)
                        .ok_or(Error::BadMcuSize)? = i as u8;
                    self.blocks_in_mcu += 1;
                }
            }
        }
        Ok(())
    }

    /// An iMCU row of a scan with one component has as many rows of MCUs as the component has rows of data units in it.
    pub(crate) fn mcu_rows_in_imcu_row(&self, imcu_row: u32) -> Result<u32> {
        Ok(if self.comps_in_scan > 1 {
            1
        } else if imcu_row + 1 < self.total_imcu_rows {
            self.scan_comp(0)?.v_samp
        } else {
            self.scan_comp(0)?.last_row_height
        })
    }

    /// A later scan may come after the slot of a quantization table was redefined, so each component keeps the table
    /// its first scan began with.
    pub(crate) fn latch_quant_tables(&mut self) -> Result<()> {
        for i in 0..self.comps_in_scan {
            let ci = self.scan_comp_index(i)?;
            let comp = self.comps.get_mut(ci).ok_or(Error::Internal)?;
            if comp.quant_table.is_some() {
                continue;
            }
            let table = self
                .quant_tbls
                .get(usize::from(comp.quant_tbl_no))
                .copied()
                .flatten();
            comp.quant_table = Some(table.ok_or(Error::NoQuantTable(comp.quant_tbl_no))?);
        }
        Ok(())
    }
}
