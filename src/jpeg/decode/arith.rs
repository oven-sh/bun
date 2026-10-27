//! Arithmetic decoding of sequential and progressive scans (jdarith.c, jaricom.c).

use super::coef::{CoefBits, McuBlocks};
use super::input::Input;
use super::phuff::{update_progression, validate_progression};
use super::{Block, Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPONENTS_IN_SCAN, NUM_ARITH_TABLES, coef_at};
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
    fn reset(&mut self) {
        self.c = 0;
        self.a = 0;
        self.ct = -16;
    }

    /// Decodes one binary decision with the statistics bin `st`: the state in the low 7 bits, the more probable symbol
    /// on top.
    #[inline]
    fn decode(&mut self, input: &mut Input, st: &mut u8) -> bool {
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

        let mut sv = *st;
        let entry = ARITAB.get(usize::from(sv & 0x7f)).copied().unwrap_or(0);
        let next_lps = entry as u8;
        let next_mps = (entry >> 8) as u8;
        let qe = i64::from(entry >> 16);

        self.a -= qe;
        let temp = self.a << self.ct;
        if self.c >= temp {
            self.c -= temp;
            if self.a < qe {
                *st = (sv & 0x80) ^ next_mps;
            } else {
                *st = (sv & 0x80) ^ next_lps;
                sv ^= 0x80;
            }
            self.a = qe;
        } else if self.a < 0x8000 {
            if self.a < qe {
                *st = (sv & 0x80) ^ next_lps;
                sv ^= 0x80;
            } else {
                *st = (sv & 0x80) ^ next_mps;
            }
        }
        sv >> 7 != 0
    }

    #[inline(always)]
    fn decode_at(&mut self, input: &mut Input, stats: &mut [u8], bin: usize) -> Result<bool> {
        Ok(self.decode(input, stats.get_mut(bin).ok_or(Error::Internal)?))
    }

    /// The rest of a nonzero value once its magnitude category `m` is known: the bits below the leading one come from
    /// bin `bin`.
    #[inline(always)]
    fn decode_magnitude(
        &mut self,
        input: &mut Input,
        stats: &mut [u8],
        bin: usize,
        mut m: i32,
        sign: bool,
    ) -> Result<i32> {
        let mut v = m;
        loop {
            m >>= 1;
            if m == 0 {
                break;
            }
            if self.decode_at(input, stats, bin)? {
                v |= m;
            }
        }
        v += 1;
        Ok(if sign { -v } else { v })
    }

    /// Damaged data. Nothing more is decoded until the next restart or scan.
    fn fail(&mut self) {
        self.ct = -1;
    }
}

#[derive(Clone, Copy)]
enum Pass {
    Sequential,
    DcFirst,
    AcFirst,
    DcRefine,
    AcRefine,
}

pub(crate) struct ArithDecoder {
    core: Core,
    last_dc_val: [i32; MAX_COMPONENTS_IN_SCAN],
    /// Which bins the next DC difference of a component starts from. It depends on the size of the last one.
    dc_context: [usize; MAX_COMPONENTS_IN_SCAN],
    restarts_to_go: u32,
    restart_interval: u32,
    dc_stats: Box<[[u8; DC_STAT_BINS]; NUM_ARITH_TABLES]>,
    ac_stats: Box<[[u8; AC_STAT_BINS]; NUM_ARITH_TABLES]>,
    fixed_bin: u8,
    coef_bits: Option<CoefBits>,

    pass: Pass,
    ss: usize,
    se: usize,
    al: u32,
    blocks_in_mcu: usize,
    blocks: [BlockInfo; MAX_BLOCKS_IN_MCU],
    /// The tables of the components of the scan.
    scan_tables: [(u8, u8); MAX_COMPONENTS_IN_SCAN],
    components_in_scan: usize,
    dc_l: [u8; NUM_ARITH_TABLES],
    dc_u: [u8; NUM_ARITH_TABLES],
    ac_k: [u8; NUM_ARITH_TABLES],
}

#[derive(Default, Clone, Copy)]
struct BlockInfo {
    scan_component: u8,
    dc_table: u8,
    ac_table: u8,
}

impl ArithDecoder {
    pub(crate) fn new(decoder: &Decoder) -> Self {
        ArithDecoder {
            core: Core {
                c: 0,
                a: 0,
                ct: -16,
            },
            last_dc_val: [0; MAX_COMPONENTS_IN_SCAN],
            dc_context: [0; MAX_COMPONENTS_IN_SCAN],
            restarts_to_go: 0,
            restart_interval: 0,
            dc_stats: Box::new([[0; DC_STAT_BINS]; NUM_ARITH_TABLES]),
            ac_stats: Box::new([[0; AC_STAT_BINS]; NUM_ARITH_TABLES]),
            fixed_bin: 113,
            coef_bits: decoder
                .progressive
                .then(|| CoefBits::new(decoder.components.len())),
            pass: Pass::Sequential,
            ss: 0,
            se: 0,
            al: 0,
            blocks_in_mcu: 0,
            blocks: [BlockInfo::default(); MAX_BLOCKS_IN_MCU],
            scan_tables: [(0, 0); MAX_COMPONENTS_IN_SCAN],
            components_in_scan: 0,
            dc_l: [0; NUM_ARITH_TABLES],
            dc_u: [0; NUM_ARITH_TABLES],
            ac_k: [0; NUM_ARITH_TABLES],
        }
    }

    pub(crate) fn coef_bits(&self) -> Option<&CoefBits> {
        self.coef_bits.as_ref()
    }

    fn uses_dc(&self) -> bool {
        matches!(self.pass, Pass::Sequential | Pass::DcFirst)
    }

    fn uses_ac(&self) -> bool {
        matches!(self.pass, Pass::Sequential | Pass::AcFirst | Pass::AcRefine)
    }

    pub(crate) fn start_pass(&mut self, decoder: &mut Decoder) -> Result<()> {
        if let Some(coef_bits) = &mut self.coef_bits {
            validate_progression(decoder)?;
            update_progression(decoder, coef_bits)?;
            self.pass = match (decoder.ah == 0, decoder.ss == 0) {
                (true, true) => Pass::DcFirst,
                (true, false) => Pass::AcFirst,
                (false, true) => Pass::DcRefine,
                (false, false) => Pass::AcRefine,
            };
            self.ss = usize::from(decoder.ss);
            self.se = usize::from(decoder.se);
            self.al = u32::from(decoder.al);
        } else {
            self.pass = Pass::Sequential;
            self.ss = 1;
            self.se = 63;
            self.al = 0;
        }

        self.components_in_scan = decoder.components_in_scan;
        for (i, tables) in self
            .scan_tables
            .iter_mut()
            .enumerate()
            .take(decoder.components_in_scan)
        {
            let comp = decoder.scan_component(i)?;
            *tables = (comp.dc_selector, comp.ac_selector);
        }
        self.blocks_in_mcu = decoder.blocks_in_mcu;
        for (info, &scan_component) in self
            .blocks
            .iter_mut()
            .zip(decoder.mcu_membership.iter())
            .take(decoder.blocks_in_mcu)
        {
            let comp = decoder.scan_component(usize::from(scan_component))?;
            *info = BlockInfo {
                scan_component,
                dc_table: comp.dc_selector,
                ac_table: comp.ac_selector,
            };
        }
        self.dc_l = decoder.arith_dc_l;
        self.dc_u = decoder.arith_dc_u;
        self.ac_k = decoder.arith_ac_k;

        self.reset_statistics();
        decoder.input.insufficient_data = false;
        self.restart_interval = decoder.restart_interval;
        self.restarts_to_go = decoder.restart_interval;
        Ok(())
    }

    fn reset_statistics(&mut self) {
        let (uses_dc, uses_ac) = (self.uses_dc(), self.uses_ac());
        for &(dc, ac) in self.scan_tables.iter().take(self.components_in_scan) {
            if uses_dc && let Some(stats) = self.dc_stats.get_mut(usize::from(dc)) {
                *stats = [0; DC_STAT_BINS];
            }
            if uses_ac && let Some(stats) = self.ac_stats.get_mut(usize::from(ac)) {
                *stats = [0; AC_STAT_BINS];
            }
        }
        if uses_dc {
            self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];
            self.dc_context = [0; MAX_COMPONENTS_IN_SCAN];
        }
        self.core.reset();
    }

    pub(crate) fn decode_mcu(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if self.restart_interval != 0 {
            if self.restarts_to_go == 0 {
                input.read_restart_marker();
                self.reset_statistics();
                self.restarts_to_go = self.restart_interval;
            }
            self.restarts_to_go -= 1;
        }

        if let Pass::DcRefine = self.pass {
            let p1 = 1i16 << self.al;
            for index in 0..self.blocks_in_mcu {
                if self.core.decode(input, &mut self.fixed_bin) {
                    let [dc, ..] = mcu.block(index).ok_or(Error::Internal)?;
                    *dc |= p1;
                }
            }
            return Ok(());
        }
        if self.core.ct == -1 {
            return Ok(());
        }

        match self.pass {
            Pass::Sequential | Pass::DcFirst => {
                for index in 0..self.blocks_in_mcu {
                    let info = *self.blocks.get(index).ok_or(Error::Internal)?;
                    let block = mcu.block(index).ok_or(Error::Internal)?;
                    if !self.decode_dc(input, info, block)? {
                        break;
                    }
                    if let Pass::Sequential = self.pass
                        && !self.decode_ac(input, info.ac_table, block)?
                    {
                        break;
                    }
                }
            }
            Pass::AcFirst => {
                let [(_, ac_table), ..] = self.scan_tables;
                self.decode_ac(input, ac_table, mcu.block(0).ok_or(Error::Internal)?)?;
            }
            Pass::AcRefine => {
                let [(_, ac_table), ..] = self.scan_tables;
                self.refine_ac(input, ac_table, mcu.block(0).ok_or(Error::Internal)?)?;
            }
            Pass::DcRefine => {}
        }
        Ok(())
    }

    /// Returns false after an error in the data.
    fn decode_dc(&mut self, input: &mut Input, info: BlockInfo, block: &mut Block) -> Result<bool> {
        let core = &mut self.core;
        let selector = usize::from(info.dc_table);
        let stats = self.dc_stats.get_mut(selector).ok_or(Error::Internal)?;
        let context = self
            .dc_context
            .get_mut(usize::from(info.scan_component))
            .ok_or(Error::Internal)?;
        let last_dc = self
            .last_dc_val
            .get_mut(usize::from(info.scan_component))
            .ok_or(Error::Internal)?;

        let mut st = *context;
        if !core.decode_at(input, stats, st)? {
            *context = 0;
        } else {
            let sign = core.decode_at(input, stats, st + 1)?;
            st += 2 + usize::from(sign);
            let mut m = i32::from(core.decode_at(input, stats, st)?);
            if m != 0 {
                st = 20;
                while core.decode_at(input, stats, st)? {
                    m <<= 1;
                    if m == 0x8000 {
                        core.fail();
                        return Ok(false);
                    }
                    st += 1;
                }
            }
            let small = (1i32 << self.dc_l.get(selector).copied().unwrap_or(0)) >> 1;
            let large = (1i32 << self.dc_u.get(selector).copied().unwrap_or(0)) >> 1;
            *context = if m < small {
                0
            } else if m > large {
                12 + usize::from(sign) * 4
            } else {
                4 + usize::from(sign) * 4
            };
            let v = core.decode_magnitude(input, stats, st + 14, m, sign)?;
            *last_dc = (*last_dc + v) & 0xffff;
        }
        let [dc, ..] = block;
        *dc = last_dc.wrapping_shl(self.al) as i16;
        Ok(true)
    }

    /// Returns false after an error in the data.
    fn decode_ac(&mut self, input: &mut Input, ac_table: u8, block: &mut Block) -> Result<bool> {
        let core = &mut self.core;
        let selector = usize::from(ac_table);
        let stats = self.ac_stats.get_mut(selector).ok_or(Error::Internal)?;
        let kx = usize::from(self.ac_k.get(selector).copied().unwrap_or(0));

        let mut k = self.ss;
        while k <= self.se {
            let mut st = 3 * (k - 1);
            if core.decode_at(input, stats, st)? {
                // End of block.
                break;
            }
            while !core.decode_at(input, stats, st + 1)? {
                st += 3;
                k += 1;
                if k > self.se {
                    core.fail();
                    return Ok(false);
                }
            }
            let sign = core.decode(input, &mut self.fixed_bin);
            st += 2;
            let mut m = i32::from(core.decode_at(input, stats, st)?);
            if m != 0 && core.decode_at(input, stats, st)? {
                m <<= 1;
                st = if k <= kx { 189 } else { 217 };
                while core.decode_at(input, stats, st)? {
                    m <<= 1;
                    if m == 0x8000 {
                        core.fail();
                        return Ok(false);
                    }
                    st += 1;
                }
            }
            let v = core.decode_magnitude(input, stats, st + 14, m, sign)?;
            if let Some(coef) = coef_at(block, k) {
                *coef = v.wrapping_shl(self.al) as i16;
            }
            k += 1;
        }
        Ok(true)
    }

    fn refine_ac(&mut self, input: &mut Input, ac_table: u8, block: &mut Block) -> Result<()> {
        let core = &mut self.core;
        let stats = self
            .ac_stats
            .get_mut(usize::from(ac_table))
            .ok_or(Error::Internal)?;
        let p1 = 1i16 << self.al;
        let m1 = -1i16 << self.al;

        // Where the block ended as of the previous stage.
        let mut kex = self.se;
        while kex > 0 && coef_at(block, kex).is_none_or(|coef| *coef == 0) {
            kex -= 1;
        }

        let mut k = self.ss;
        while k <= self.se {
            let mut st = 3 * (k - 1);
            if k > kex && core.decode_at(input, stats, st)? {
                break;
            }
            loop {
                let coef = coef_at(block, k).ok_or(Error::Internal)?;
                if *coef != 0 {
                    if core.decode_at(input, stats, st + 2)? {
                        *coef = coef.wrapping_add(if *coef < 0 { m1 } else { p1 });
                    }
                    break;
                }
                if core.decode_at(input, stats, st + 1)? {
                    *coef = if core.decode(input, &mut self.fixed_bin) {
                        m1
                    } else {
                        p1
                    };
                    break;
                }
                st += 3;
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
