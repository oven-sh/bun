//! Huffman decoding of progressive scans (jdphuff.c).

use super::bits::{BitReader, DerivedTable, TableKind, huff_extend};
use super::coef::{CoefBits, McuBlocks};
use super::input::Input;
use super::{Block, Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPS_IN_SCAN, NUM_HUFF_TBLS};
use crate::error::{Error, Result};
use crate::tables::NATURAL_ORDER;

#[derive(Clone, Copy, Default)]
enum Pass {
    #[default]
    DcFirst,
    AcFirst,
    DcRefine,
    AcRefine,
}

#[derive(Default)]
pub(crate) struct PHuffDecoder {
    bits: BitReader,
    /// Blocks still to come whose band is all zero.
    eobrun: u32,
    last_dc_val: [i32; MAX_COMPS_IN_SCAN],
    restarts_to_go: u32,
    restart_interval: u32,
    /// DC and AC tables share these slots: a scan has only one kind.
    tables: [Option<Box<DerivedTable>>; NUM_HUFF_TBLS],
    /// The slot of the one table of an AC scan.
    ac_table: u8,
    coef_bits: CoefBits,

    pass: Pass,
    ss: usize,
    se: usize,
    al: u32,
    blocks_in_mcu: usize,
    /// For each block of an MCU, the index into `last_dc_val` and the slot of the table.
    blocks: [(u8, u8); MAX_BLOCKS_IN_MCU],
}

#[inline(always)]
fn coef_at(block: &mut Block, k: usize) -> Option<&mut i16> {
    let pos = NATURAL_ORDER.get(k).copied().unwrap_or(63);
    block.get_mut(usize::from(pos))
}

/// Records the scan in `coef_bits`. The arithmetic decoder does the same.
pub(crate) fn update_progression(d: &mut Decoder, coef_bits: &mut CoefBits) -> Result<()> {
    let (ss, se) = (usize::from(d.ss), usize::from(d.se));
    for i in 0..d.comps_in_scan {
        let ci = d.scan_comp_index(i)?;
        let current = coef_bits.current.get_mut(ci).ok_or(Error::Internal)?;
        let previous = coef_bits.previous.get_mut(ci).ok_or(Error::Internal)?;
        let saved = ss.min(1)..=se.max(9);
        for (previous, &current) in previous
            .iter_mut()
            .zip(current.iter())
            .skip(*saved.start())
            .take(saved.count())
        {
            *previous = if d.input_scan_number > 1 { current } else { 0 };
        }
        for bits in current
            .iter_mut()
            .skip(ss)
            .take((se + 1).saturating_sub(ss))
        {
            *bits = i32::from(d.al);
        }
    }
    Ok(())
}

/// What any progressive scan has to satisfy.
pub(crate) fn validate_progression(d: &Decoder) -> Result<()> {
    let bad_band = if d.ss == 0 {
        d.se != 0
    } else {
        d.ss > d.se || d.se >= 64 || d.comps_in_scan != 1
    };
    // A refinement scan adds exactly one bit.
    let bad_approximation = (d.ah != 0 && d.al != d.ah - 1) || d.al > 13;
    if bad_band || bad_approximation {
        return Err(Error::BadProgression(d.ss, d.se, d.ah, d.al));
    }
    Ok(())
}

impl PHuffDecoder {
    pub(crate) fn new(d: &Decoder) -> Self {
        PHuffDecoder {
            coef_bits: CoefBits::new(d.comps.len()),
            ..Self::default()
        }
    }

    pub(crate) fn coef_bits(&self) -> &CoefBits {
        &self.coef_bits
    }

    pub(crate) fn start_pass(&mut self, d: &mut Decoder) -> Result<()> {
        validate_progression(d)?;
        update_progression(d, &mut self.coef_bits)?;

        let is_dc_band = d.ss == 0;
        self.pass = match (d.ah == 0, is_dc_band) {
            (true, true) => Pass::DcFirst,
            (true, false) => Pass::AcFirst,
            (false, true) => Pass::DcRefine,
            (false, false) => Pass::AcRefine,
        };

        for i in 0..d.comps_in_scan {
            let comp = d.scan_comp(i)?;
            let (specs, tbl, kind) = if is_dc_band {
                // DC refinement needs no table.
                if d.ah != 0 {
                    continue;
                }
                (&d.dc_huff, comp.dc_tbl_no, TableKind::Dc)
            } else {
                self.ac_table = comp.ac_tbl_no;
                (&d.ac_huff, comp.ac_tbl_no, TableKind::Ac)
            };
            let spec = specs.get(usize::from(tbl)).and_then(|t| t.as_deref());
            let table = DerivedTable::new(spec.ok_or(Error::NoHuffTable(tbl))?, kind)?;
            *self
                .tables
                .get_mut(usize::from(tbl))
                .ok_or(Error::Internal)? = Some(table);
        }
        self.last_dc_val = [0; MAX_COMPS_IN_SCAN];

        self.ss = usize::from(d.ss);
        self.se = usize::from(d.se);
        self.al = u32::from(d.al);
        self.blocks_in_mcu = d.blocks_in_mcu;
        for (info, &scan_comp) in self
            .blocks
            .iter_mut()
            .zip(d.mcu_membership.iter())
            .take(d.blocks_in_mcu)
        {
            *info = (scan_comp, d.scan_comp(usize::from(scan_comp))?.dc_tbl_no);
        }

        self.bits.reset();
        d.inp.insufficient_data = false;
        self.eobrun = 0;
        self.restart_interval = d.restart_interval;
        self.restarts_to_go = d.restart_interval;
        Ok(())
    }

    fn process_restart(&mut self, inp: &mut Input) {
        self.bits.reset();
        inp.read_restart_marker();
        self.last_dc_val = [0; MAX_COMPS_IN_SCAN];
        self.eobrun = 0;
        self.restarts_to_go = self.restart_interval;
        if inp.unread_marker == 0 {
            inp.insufficient_data = false;
        }
    }

    pub(crate) fn decode_mcu(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if self.restart_interval != 0 && self.restarts_to_go == 0 {
            self.process_restart(inp);
        }
        match self.pass {
            Pass::DcFirst => self.decode_dc_first(inp, mcu)?,
            Pass::AcFirst => self.decode_ac_first(inp, mcu)?,
            Pass::DcRefine => self.decode_dc_refine(inp, mcu)?,
            Pass::AcRefine => self.decode_ac_refine(inp, mcu)?,
        }
        if self.restart_interval != 0 {
            self.restarts_to_go -= 1;
        }
        Ok(())
    }

    fn decode_dc_first(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if inp.insufficient_data {
            return Ok(());
        }
        for (blkn, &(scan_comp, tbl)) in self.blocks.iter().enumerate().take(self.blocks_in_mcu) {
            let table = self
                .tables
                .get(usize::from(tbl))
                .and_then(|t| t.as_deref())
                .ok_or(Error::Internal)?;
            let last_dc = self
                .last_dc_val
                .get_mut(usize::from(scan_comp))
                .ok_or(Error::Internal)?;
            let s = u32::from(self.bits.decode(inp, table));
            let mut diff = 0;
            if s != 0 {
                self.bits.check(inp, s);
                diff = huff_extend(self.bits.get(s), s);
            }
            *last_dc = last_dc.checked_add(diff).ok_or(Error::BadDctCoef)?;
            let [dc, ..] = mcu.block(blkn).ok_or(Error::Internal)?;
            *dc = last_dc.wrapping_shl(self.al) as i16;
        }
        Ok(())
    }

    fn decode_ac_first(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if inp.insufficient_data {
            return Ok(());
        }
        if self.eobrun > 0 {
            self.eobrun -= 1;
            return Ok(());
        }
        let table = self
            .tables
            .get(usize::from(self.ac_table))
            .and_then(|t| t.as_deref());
        let table = table.ok_or(Error::Internal)?;
        let block = mcu.block(0).ok_or(Error::Internal)?;
        let bits = &mut self.bits;

        let mut k = self.ss;
        while k <= self.se {
            let symbol = bits.decode(inp, table);
            let r = u32::from(symbol >> 4);
            let s = u32::from(symbol & 15);
            if s != 0 {
                k += r as usize;
                bits.check(inp, s);
                let value = huff_extend(bits.get(s), s);
                if let Some(coef) = coef_at(block, k) {
                    *coef = value.wrapping_shl(self.al) as i16;
                }
            } else if r == 15 {
                k += 15;
            } else {
                // The band ends here, in this block and in 2^r - 1 plus the appended bits more.
                self.eobrun = 1 << r;
                if r != 0 {
                    bits.check(inp, r);
                    self.eobrun += bits.get(r) as u32;
                }
                self.eobrun -= 1;
                break;
            }
            k += 1;
        }
        Ok(())
    }

    fn decode_dc_refine(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        // Made-up zeros change nothing, so running out of data needs no check.
        let p1 = 1i16 << self.al;
        for blkn in 0..self.blocks_in_mcu {
            self.bits.check(inp, 1);
            if self.bits.get(1) != 0 {
                let [dc, ..] = mcu.block(blkn).ok_or(Error::Internal)?;
                *dc |= p1;
            }
        }
        Ok(())
    }

    fn decode_ac_refine(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if inp.insufficient_data {
            return Ok(());
        }
        let table = self
            .tables
            .get(usize::from(self.ac_table))
            .and_then(|t| t.as_deref());
        let table = table.ok_or(Error::Internal)?;
        let block = mcu.block(0).ok_or(Error::Internal)?;
        let bits = &mut self.bits;
        let se = self.se;
        // 1 and -1 in the bit position being coded.
        let p1 = 1i16 << self.al;
        let m1 = -1i16 << self.al;

        /// A correction bit of 1 moves a coefficient that is already nonzero away from zero.
        #[inline(always)]
        fn correct(bits: &mut BitReader, inp: &mut Input, coef: &mut i16, p1: i16, m1: i16) {
            bits.check(inp, 1);
            if bits.get(1) != 0 && *coef & p1 == 0 {
                *coef = coef.wrapping_add(if *coef >= 0 { p1 } else { m1 });
            }
        }

        let mut k = self.ss;
        if self.eobrun == 0 {
            while k <= se {
                let symbol = bits.decode(inp, table);
                let mut r = i32::from(symbol >> 4);
                let s = symbol & 15;
                let mut value = 0;
                if s != 0 {
                    // A coefficient that turns nonzero is 1 or -1, whatever `s` says.
                    bits.check(inp, 1);
                    value = if bits.get(1) != 0 { p1 } else { m1 };
                } else if r != 15 {
                    self.eobrun = 1 << r;
                    if r != 0 {
                        bits.check(inp, r as u32);
                        self.eobrun += bits.get(r as u32) as u32;
                    }
                    break;
                }
                // Go past the nonzero coefficients, correcting them, and past `r` zero ones.
                loop {
                    let Some(coef) = coef_at(block, k) else { break };
                    if *coef != 0 {
                        correct(bits, inp, coef, p1, m1);
                    } else {
                        r -= 1;
                        if r < 0 {
                            break;
                        }
                    }
                    k += 1;
                    if k > se {
                        break;
                    }
                }
                if value != 0
                    && let Some(coef) = coef_at(block, k)
                {
                    *coef = value;
                }
                k += 1;
            }
        }

        if self.eobrun > 0 {
            // What is left of the band only gets correction bits.
            while k <= se {
                if let Some(coef) = coef_at(block, k)
                    && *coef != 0
                {
                    correct(bits, inp, coef, p1, m1);
                }
                k += 1;
            }
            self.eobrun -= 1;
        }
        Ok(())
    }
}
