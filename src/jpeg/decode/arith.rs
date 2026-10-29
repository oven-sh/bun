//! Arithmetic decoding of sequential and progressive scans (jdarith.c, jaricom.c).

use super::coef::{CoefBits, McuBlocks};
use super::input::{Input, Restarts};
use super::phuff::{Pass, start_progressive_scan};
use super::{
    Block, Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPONENTS_IN_SCAN, McuBlock, NUM_ARITH_TABLES, coef_at,
};
use crate::alloc::try_box;
use crate::error::{Error, Result};

/// Table D.2 of the standard. For each state of the probability estimation: Qe in the high 16 bits, then the next state
/// after the more probable symbol, then the next state after the less probable one, with the bit on top of it that says
/// whether the two symbols trade places. State 113 is a fixed probability of one half.
#[rustfmt::skip]
const ARITAB: [u32; 114] = [
    0x5a1d0181, 0x2586020e, 0x11140310, 0x080b0412, 0x03d80514, 0x01da0617,
    0x00e50719, 0x006f081c, 0x0036091e, 0x001a0a21, 0x000d0b23, 0x00060c09,
    0x00030d0a, 0x00010d0c, 0x5a7f0f8f, 0x3f251024, 0x2cf21126, 0x207c1227,
    0x17b91328, 0x1182142a, 0x0cef152b, 0x09a1162d, 0x072f172e, 0x055c1830,
    0x04061931, 0x03031a33, 0x02401b34, 0x01b11c36, 0x01441d38, 0x00f51e39,
    0x00b71f3b, 0x008a203c, 0x0068213e, 0x004e223f, 0x003b2320, 0x002c0921,
    0x5ae125a5, 0x484c2640, 0x3a0d2741, 0x2ef12843, 0x261f2944, 0x1f332a45,
    0x19a82b46, 0x15182c48, 0x11772d49, 0x0e742e4a, 0x0bfb2f4b, 0x09f8304d,
    0x0861314e, 0x0706324f, 0x05cd3330, 0x04de3432, 0x040f3532, 0x03633633,
    0x02d43734, 0x025c3835, 0x01f83936, 0x01a43a37, 0x01603b38, 0x01253c39,
    0x00f63d3a, 0x00cb3e3b, 0x00ab3f3d, 0x008f203d, 0x5b1241c1, 0x4d044250,
    0x412c4351, 0x37d84452, 0x2fe84553, 0x293c4654, 0x23794756, 0x1edf4857,
    0x1aa94957, 0x174e4a48, 0x14244b48, 0x119c4c4a, 0x0f6b4d4a, 0x0d514e4b,
    0x0bb64f4d, 0x0a40304d, 0x583251d0, 0x4d1c5258, 0x438e5359, 0x3bdd545a,
    0x34ee555b, 0x2eae565c, 0x299a575d, 0x25164756, 0x557059d8, 0x4ca95a5f,
    0x44d95b60, 0x3e225c61, 0x38245d63, 0x32b45e63, 0x2e17565d, 0x56a860df,
    0x4f466165, 0x47e56266, 0x41cf6367, 0x3c3d6468, 0x375e5d63, 0x52316669,
    0x4c0f676a, 0x4639686b, 0x415e6367, 0x56276ae9, 0x50e76b6c, 0x4b85676d,
    0x55976d6e, 0x504f6b6f, 0x5a106fee, 0x55226d70, 0x59eb6ff0, 0x5a1d7171,
];

const DC_STAT_BINS: usize = 64;
const AC_STAT_BINS: usize = 256;

/// The registers of the decoding procedure.
struct Core {
    /// The base of the coding interval, and below it the bits read ahead.
    c: i64,
    /// The size of the coding interval.
    a: i64,
    /// How many bits are read ahead: 0 to 7 in operation, -16 before the first two bytes are in, -1 after an error.
    ct: i32,
}

impl Core {
    fn new() -> Self {
        Core {
            c: 0,
            a: 0,
            ct: -16,
        }
    }

    /// Decodes one binary decision. `bin` has the state in the low 7 bits and the more probable symbol on top.
    #[inline]
    fn decode(&mut self, input: &mut Input, bin: &mut u8) -> bool {
        while self.a < 0x8000 {
            self.ct -= 1;
            if self.ct < 0 {
                // Unlike with Huffman coding it is legal to run into the marker: zeros follow until decoding is done.
                let mut data = 0;
                if input.unread_marker == 0 {
                    data = input.byte();
                    if data == 0xff {
                        while data == 0xff {
                            data = input.byte();
                        }
                        if data == 0 {
                            data = 0xff;
                        } else {
                            input.unread_marker = data;
                            data = 0;
                        }
                    }
                }
                self.c = (self.c << 8) | i64::from(data);
                self.ct += 8;
                if self.ct < 0 {
                    self.ct += 1;
                    if self.ct == 0 {
                        // The first two bytes are in.
                        self.a = 0x8000;
                    }
                }
            }
            self.a <<= 1;
        }

        let mut state = *bin;
        let entry = ARITAB.get(usize::from(state & 0x7f)).copied().unwrap_or(0);
        let next_lps = entry as u8;
        let next_mps = (entry >> 8) as u8;
        let qe = i64::from(entry >> 16);

        self.a -= qe;
        let temp = self.a << self.ct;
        if self.c >= temp {
            self.c -= temp;
            if self.a < qe {
                *bin = (state & 0x80) ^ next_mps;
            } else {
                *bin = (state & 0x80) ^ next_lps;
                state ^= 0x80;
            }
            self.a = qe;
        } else if self.a < 0x8000 {
            if self.a < qe {
                *bin = (state & 0x80) ^ next_lps;
                state ^= 0x80;
            } else {
                *bin = (state & 0x80) ^ next_mps;
            }
        }
        state >> 7 != 0
    }

    #[inline(always)]
    fn decode_at(&mut self, input: &mut Input, stats: &mut [u8], bin: usize) -> Result<bool> {
        Ok(self.decode(input, stats.get_mut(bin).ok_or(Error::Internal)?))
    }

    /// The rest of a nonzero value. `magnitude` is its leading one, and the bits below that come from `bin`.
    #[inline(always)]
    fn decode_magnitude(
        &mut self,
        input: &mut Input,
        stats: &mut [u8],
        bin: usize,
        mut magnitude: i32,
        sign: bool,
    ) -> Result<i32> {
        let mut value = magnitude;
        loop {
            magnitude >>= 1;
            if magnitude == 0 {
                break;
            }
            if self.decode_at(input, stats, bin)? {
                value |= magnitude;
            }
        }
        value += 1;
        Ok(if sign { -value } else { value })
    }

    /// Damaged data. Nothing more is decoded until the next restart or scan.
    fn fail(&mut self) {
        self.ct = -1;
    }

    fn failed(&self) -> bool {
        self.ct == -1
    }
}

pub(crate) struct ArithDecoder {
    core: Core,
    last_dc_val: [i32; MAX_COMPONENTS_IN_SCAN],
    /// Which bins the next DC difference of a component starts from. It depends on the size of the last one.
    dc_context: [usize; MAX_COMPONENTS_IN_SCAN],
    restarts: Restarts,
    dc_stats: Box<[[u8; DC_STAT_BINS]; NUM_ARITH_TABLES]>,
    ac_stats: Box<[[u8; AC_STAT_BINS]; NUM_ARITH_TABLES]>,
    fixed_bin: u8,
    coef_bits: Option<CoefBits>,

    /// `None` in a sequential stream, where a scan has all of every block.
    pass: Option<Pass>,
    ss: usize,
    se: usize,
    al: u32,
    blocks_in_mcu: usize,
    blocks: [McuBlock; MAX_BLOCKS_IN_MCU],
    dc_l: [u8; NUM_ARITH_TABLES],
    dc_u: [u8; NUM_ARITH_TABLES],
    ac_k: [u8; NUM_ARITH_TABLES],
}

impl ArithDecoder {
    pub(crate) fn new(decoder: &Decoder) -> Result<Self> {
        Ok(ArithDecoder {
            core: Core::new(),
            last_dc_val: [0; MAX_COMPONENTS_IN_SCAN],
            dc_context: [0; MAX_COMPONENTS_IN_SCAN],
            restarts: Restarts::default(),
            dc_stats: try_box([[0; DC_STAT_BINS]; NUM_ARITH_TABLES])?,
            ac_stats: try_box([[0; AC_STAT_BINS]; NUM_ARITH_TABLES])?,
            fixed_bin: 113,
            coef_bits: decoder
                .progressive
                .then(|| CoefBits::new(decoder.components.len()))
                .transpose()?,
            pass: None,
            ss: 0,
            se: 0,
            al: 0,
            blocks_in_mcu: 0,
            blocks: [McuBlock::default(); MAX_BLOCKS_IN_MCU],
            dc_l: [0; NUM_ARITH_TABLES],
            dc_u: [0; NUM_ARITH_TABLES],
            ac_k: [0; NUM_ARITH_TABLES],
        })
    }

    pub(crate) fn coef_bits(&self) -> Option<&CoefBits> {
        self.coef_bits.as_ref()
    }

    fn uses_dc(&self) -> bool {
        matches!(self.pass, None | Some(Pass::DcFirst))
    }

    fn uses_ac(&self) -> bool {
        matches!(self.pass, None | Some(Pass::AcFirst | Pass::AcRefine))
    }

    pub(crate) fn start_pass(&mut self, decoder: &Decoder) -> Result<()> {
        if let Some(coef_bits) = &mut self.coef_bits {
            self.pass = Some(start_progressive_scan(decoder, coef_bits)?);
            self.ss = usize::from(decoder.ss);
            self.se = usize::from(decoder.se);
            self.al = u32::from(decoder.al);
        } else {
            self.pass = None;
            self.ss = 1;
            self.se = 63;
            self.al = 0;
        }

        self.blocks_in_mcu = decoder.blocks_in_mcu;
        self.blocks = decoder.mcu_blocks;
        self.dc_l = decoder.arith_dc_l;
        self.dc_u = decoder.arith_dc_u;
        self.ac_k = decoder.arith_ac_k;

        self.reset_statistics();
        self.restarts = Restarts::new(decoder.restart_interval);
        Ok(())
    }

    fn reset_statistics(&mut self) {
        let (uses_dc, uses_ac) = (self.uses_dc(), self.uses_ac());
        let blocks = self.blocks.get(..self.blocks_in_mcu).unwrap_or(&[]);
        let components = blocks.chunk_by(|a, b| a.scan_component == b.scan_component);
        for info in components.filter_map(<[_]>::first) {
            if uses_dc && let Some(stats) = self.dc_stats.get_mut(usize::from(info.dc_selector)) {
                *stats = [0; DC_STAT_BINS];
            }
            if uses_ac && let Some(stats) = self.ac_stats.get_mut(usize::from(info.ac_selector)) {
                *stats = [0; AC_STAT_BINS];
            }
        }
        if uses_dc {
            self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];
            self.dc_context = [0; MAX_COMPONENTS_IN_SCAN];
        }
        self.core = Core::new();
    }

    pub(crate) fn decode_mcu(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if self.restarts.due(input) {
            self.reset_statistics();
        }

        match self.pass {
            Some(Pass::DcRefine) => {
                let plus_one = 1i16 << self.al;
                for index in 0..self.blocks_in_mcu {
                    if self.core.decode(input, &mut self.fixed_bin) {
                        let [dc, ..] = mcu.block(index).ok_or(Error::Internal)?;
                        *dc |= plus_one;
                    }
                }
            }
            _ if self.core.failed() => {}
            None | Some(Pass::DcFirst) => {
                for index in 0..self.blocks_in_mcu {
                    let info = *self.blocks.get(index).ok_or(Error::Internal)?;
                    let block = mcu.block(index).ok_or(Error::Internal)?;
                    if !self.decode_dc(input, info, block)? {
                        break;
                    }
                    if self.pass.is_none() && !self.decode_ac(input, info.ac_selector, block)? {
                        break;
                    }
                }
            }
            Some(Pass::AcFirst) => {
                let [info, ..] = self.blocks;
                self.decode_ac(
                    input,
                    info.ac_selector,
                    mcu.block(0).ok_or(Error::Internal)?,
                )?;
            }
            Some(Pass::AcRefine) => {
                let [info, ..] = self.blocks;
                self.refine_ac(
                    input,
                    info.ac_selector,
                    mcu.block(0).ok_or(Error::Internal)?,
                )?;
            }
        }
        Ok(())
    }

    /// Returns false after an error in the data.
    fn decode_dc(&mut self, input: &mut Input, info: McuBlock, block: &mut Block) -> Result<bool> {
        let core = &mut self.core;
        let selector = usize::from(info.dc_selector);
        let stats = self.dc_stats.get_mut(selector).ok_or(Error::Internal)?;
        let context = self
            .dc_context
            .get_mut(usize::from(info.scan_component))
            .ok_or(Error::Internal)?;
        let last_dc = self
            .last_dc_val
            .get_mut(usize::from(info.scan_component))
            .ok_or(Error::Internal)?;

        let mut bin = *context;
        if !core.decode_at(input, stats, bin)? {
            *context = 0;
        } else {
            let sign = core.decode_at(input, stats, bin + 1)?;
            bin += 2 + usize::from(sign);
            let mut magnitude = i32::from(core.decode_at(input, stats, bin)?);
            if magnitude != 0 {
                bin = 20;
                while core.decode_at(input, stats, bin)? {
                    magnitude <<= 1;
                    if magnitude == 0x8000 {
                        core.fail();
                        return Ok(false);
                    }
                    bin += 1;
                }
            }
            let small = (1i32 << self.dc_l.get(selector).ok_or(Error::Internal)?) >> 1;
            let large = (1i32 << self.dc_u.get(selector).ok_or(Error::Internal)?) >> 1;
            *context = if magnitude < small {
                0
            } else if magnitude > large {
                12 + usize::from(sign) * 4
            } else {
                4 + usize::from(sign) * 4
            };
            let value = core.decode_magnitude(input, stats, bin + 14, magnitude, sign)?;
            *last_dc = (*last_dc + value) & 0xffff;
        }
        let [dc, ..] = block;
        *dc = last_dc.wrapping_shl(self.al) as i16;
        Ok(true)
    }

    /// Returns false after an error in the data.
    fn decode_ac(&mut self, input: &mut Input, selector: u8, block: &mut Block) -> Result<bool> {
        let core = &mut self.core;
        let selector = usize::from(selector);
        let stats = self.ac_stats.get_mut(selector).ok_or(Error::Internal)?;
        let kx = usize::from(*self.ac_k.get(selector).ok_or(Error::Internal)?);

        let mut k = self.ss;
        while k <= self.se {
            let mut bin = 3 * (k - 1);
            if core.decode_at(input, stats, bin)? {
                // End of block.
                break;
            }
            while !core.decode_at(input, stats, bin + 1)? {
                bin += 3;
                k += 1;
                if k > self.se {
                    core.fail();
                    return Ok(false);
                }
            }
            let sign = core.decode(input, &mut self.fixed_bin);
            bin += 2;
            let mut magnitude = i32::from(core.decode_at(input, stats, bin)?);
            if magnitude != 0 && core.decode_at(input, stats, bin)? {
                magnitude <<= 1;
                bin = if k <= kx { 189 } else { 217 };
                while core.decode_at(input, stats, bin)? {
                    magnitude <<= 1;
                    if magnitude == 0x8000 {
                        core.fail();
                        return Ok(false);
                    }
                    bin += 1;
                }
            }
            let value = core.decode_magnitude(input, stats, bin + 14, magnitude, sign)?;
            *coef_at(block, k)? = value.wrapping_shl(self.al) as i16;
            k += 1;
        }
        Ok(true)
    }

    fn refine_ac(&mut self, input: &mut Input, selector: u8, block: &mut Block) -> Result<()> {
        let core = &mut self.core;
        let stats = self
            .ac_stats
            .get_mut(usize::from(selector))
            .ok_or(Error::Internal)?;
        let plus_one = 1i16 << self.al;
        let minus_one = -1i16 << self.al;

        // Where the block ended as of the previous stage.
        let mut last_nonzero = self.se;
        while last_nonzero > 0 && *coef_at(block, last_nonzero)? == 0 {
            last_nonzero -= 1;
        }

        let mut k = self.ss;
        while k <= self.se {
            let mut bin = 3 * (k - 1);
            if k > last_nonzero && core.decode_at(input, stats, bin)? {
                break;
            }
            loop {
                let coef = coef_at(block, k)?;
                if *coef != 0 {
                    if core.decode_at(input, stats, bin + 2)? {
                        *coef = coef.wrapping_add(if *coef < 0 { minus_one } else { plus_one });
                    }
                    break;
                }
                if core.decode_at(input, stats, bin + 1)? {
                    *coef = if core.decode(input, &mut self.fixed_bin) {
                        minus_one
                    } else {
                        plus_one
                    };
                    break;
                }
                bin += 3;
                k += 1;
                if k > self.se {
                    core.fail();
                    return Ok(());
                }
            }
            k += 1;
        }
        Ok(())
    }
}
