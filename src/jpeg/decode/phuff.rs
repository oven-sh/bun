//! Huffman decoding of progressive scans (jdphuff.c).

use super::bits::{self, BitReader, DerivedTables, TableKind, huff_extend};
use super::coef::{CoefBits, McuBlocks};
use super::input::Input;
use super::{Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPONENTS_IN_SCAN, McuBlock, coef_at};
use crate::error::{Error, Result};

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
    last_dc_val: [i32; MAX_COMPONENTS_IN_SCAN],
    restarts_to_go: u32,
    restart_interval: u32,
    /// DC or AC: a scan has only one kind.
    tables: DerivedTables,
    coef_bits: CoefBits,

    pass: Pass,
    ss: usize,
    se: usize,
    al: u32,
    blocks_in_mcu: usize,
    blocks: [McuBlock; MAX_BLOCKS_IN_MCU],
}

/// Records the scan in `coef_bits`. The arithmetic decoder does the same.
pub(crate) fn update_progression(decoder: &mut Decoder, coef_bits: &mut CoefBits) -> Result<()> {
    let (ss, se) = (usize::from(decoder.ss), usize::from(decoder.se));
    for i in 0..decoder.components_in_scan {
        let ci = decoder.scan_component_index(i)?;
        let current = coef_bits.current.get_mut(ci).ok_or(Error::Internal)?;
        let previous = coef_bits.previous.get_mut(ci).ok_or(Error::Internal)?;
        let saved = ss.min(1)..=se.max(9);
        for (previous, &current) in previous
            .iter_mut()
            .zip(current.iter())
            .skip(*saved.start())
            .take(saved.count())
        {
            *previous = if decoder.input_scan_number > 1 {
                current
            } else {
                0
            };
        }
        for bits in current
            .iter_mut()
            .skip(ss)
            .take((se + 1).saturating_sub(ss))
        {
            *bits = i32::from(decoder.al);
        }
    }
    Ok(())
}

/// What any progressive scan has to satisfy.
pub(crate) fn validate_progression(decoder: &Decoder) -> Result<()> {
    let bad_band = if decoder.ss == 0 {
        decoder.se != 0
    } else {
        decoder.ss > decoder.se || decoder.se >= 64 || decoder.components_in_scan != 1
    };
    // A refinement scan adds exactly one bit.
    let bad_approximation = (decoder.ah != 0 && decoder.al != decoder.ah - 1) || decoder.al > 13;
    if bad_band || bad_approximation {
        return Err(Error::BadProgression(
            decoder.ss, decoder.se, decoder.ah, decoder.al,
        ));
    }
    Ok(())
}

impl PHuffDecoder {
    pub(crate) fn new(decoder: &Decoder) -> Self {
        PHuffDecoder {
            coef_bits: CoefBits::new(decoder.components.len()),
            ..Self::default()
        }
    }

    pub(crate) fn coef_bits(&self) -> &CoefBits {
        &self.coef_bits
    }

    pub(crate) fn start_pass(&mut self, decoder: &mut Decoder) -> Result<()> {
        validate_progression(decoder)?;
        update_progression(decoder, &mut self.coef_bits)?;

        let is_dc_band = decoder.ss == 0;
        self.pass = match (decoder.ah == 0, is_dc_band) {
            (true, true) => Pass::DcFirst,
            (true, false) => Pass::AcFirst,
            (false, true) => Pass::DcRefine,
            (false, false) => Pass::AcRefine,
        };

        for i in 0..decoder.components_in_scan {
            let comp = decoder.scan_component(i)?;
            let (specs, selector, kind) = if is_dc_band {
                // DC refinement needs no table.
                if decoder.ah != 0 {
                    continue;
                }
                (&decoder.dc_huff, comp.dc_selector, TableKind::Dc)
            } else {
                (&decoder.ac_huff, comp.ac_selector, TableKind::Ac)
            };
            bits::derive(specs, selector, kind, &mut self.tables)?;
        }
        self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];

        self.ss = usize::from(decoder.ss);
        self.se = usize::from(decoder.se);
        self.al = u32::from(decoder.al);
        self.blocks_in_mcu = decoder.blocks_in_mcu;
        self.blocks = decoder.mcu_blocks;

        self.bits.reset();
        decoder.input.insufficient_data = false;
        self.eobrun = 0;
        self.restart_interval = decoder.restart_interval;
        self.restarts_to_go = decoder.restart_interval;
        Ok(())
    }

    fn process_restart(&mut self, input: &mut Input) {
        self.bits.reset();
        input.read_restart_marker();
        self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];
        self.eobrun = 0;
        self.restarts_to_go = self.restart_interval;
        if input.unread_marker == 0 {
            input.insufficient_data = false;
        }
    }

    pub(crate) fn decode_mcu(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if self.restart_interval != 0 && self.restarts_to_go == 0 {
            self.process_restart(input);
        }
        match self.pass {
            Pass::DcFirst => self.decode_dc_first(input, mcu)?,
            Pass::AcFirst => self.decode_ac_first(input, mcu)?,
            Pass::DcRefine => self.decode_dc_refine(input, mcu)?,
            Pass::AcRefine => self.decode_ac_refine(input, mcu)?,
        }
        if self.restart_interval != 0 {
            self.restarts_to_go -= 1;
        }
        Ok(())
    }

    fn decode_dc_first(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if input.insufficient_data {
            return Ok(());
        }
        for (index, info) in self.blocks.iter().enumerate().take(self.blocks_in_mcu) {
            let table = bits::table(&self.tables, info.dc_selector)?;
            let last_dc = self
                .last_dc_val
                .get_mut(usize::from(info.scan_component))
                .ok_or(Error::Internal)?;
            let s = u32::from(self.bits.decode(input, table));
            let mut diff = 0;
            if s != 0 {
                self.bits.ensure(input, s);
                diff = huff_extend(self.bits.get(s), s);
            }
            *last_dc = last_dc.checked_add(diff).ok_or(Error::BadDctCoef)?;
            let [dc, ..] = mcu.block(index).ok_or(Error::Internal)?;
            *dc = last_dc.wrapping_shl(self.al) as i16;
        }
        Ok(())
    }

    fn decode_ac_first(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if input.insufficient_data {
            return Ok(());
        }
        if self.eobrun > 0 {
            self.eobrun -= 1;
            return Ok(());
        }
        // An AC scan has one component and one block in an MCU.
        let [info, ..] = self.blocks;
        let table = bits::table(&self.tables, info.ac_selector)?;
        let block = mcu.block(0).ok_or(Error::Internal)?;
        let bits = &mut self.bits;

        let mut k = self.ss;
        while k <= self.se {
            let symbol = bits.decode(input, table);
            let r = u32::from(symbol >> 4);
            let s = u32::from(symbol & 15);
            if s != 0 {
                k += r as usize;
                bits.ensure(input, s);
                let value = huff_extend(bits.get(s), s);
                *coef_at(block, k)? = value.wrapping_shl(self.al) as i16;
            } else if r == 15 {
                k += 15;
            } else {
                // The band ends here, in this block and in 2^r - 1 plus the appended bits more.
                self.eobrun = 1 << r;
                if r != 0 {
                    bits.ensure(input, r);
                    self.eobrun += bits.get(r) as u32;
                }
                self.eobrun -= 1;
                break;
            }
            k += 1;
        }
        Ok(())
    }

    fn decode_dc_refine(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        // Made-up zeros change nothing, so running out of data needs no check.
        let plus_one = 1i16 << self.al;
        for index in 0..self.blocks_in_mcu {
            self.bits.ensure(input, 1);
            if self.bits.get(1) != 0 {
                let [dc, ..] = mcu.block(index).ok_or(Error::Internal)?;
                *dc |= plus_one;
            }
        }
        Ok(())
    }

    fn decode_ac_refine(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if input.insufficient_data {
            return Ok(());
        }
        // An AC scan has one component and one block in an MCU.
        let [info, ..] = self.blocks;
        let table = bits::table(&self.tables, info.ac_selector)?;
        let block = mcu.block(0).ok_or(Error::Internal)?;
        let bits = &mut self.bits;
        let se = self.se;
        // 1 and -1 in the bit position being coded.
        let plus_one = 1i16 << self.al;
        let minus_one = -1i16 << self.al;

        /// A correction bit of 1 moves a coefficient that is already nonzero away from zero.
        #[inline(always)]
        fn correct(
            bits: &mut BitReader,
            input: &mut Input,
            coef: &mut i16,
            plus_one: i16,
            minus_one: i16,
        ) {
            bits.ensure(input, 1);
            if bits.get(1) != 0 && *coef & plus_one == 0 {
                *coef = coef.wrapping_add(if *coef >= 0 { plus_one } else { minus_one });
            }
        }

        let mut k = self.ss;
        if self.eobrun == 0 {
            while k <= se {
                let symbol = bits.decode(input, table);
                let mut r = i32::from(symbol >> 4);
                let s = symbol & 15;
                let mut value = 0;
                if s != 0 {
                    // A coefficient that turns nonzero is 1 or -1, whatever `s` says.
                    bits.ensure(input, 1);
                    value = if bits.get(1) != 0 {
                        plus_one
                    } else {
                        minus_one
                    };
                } else if r != 15 {
                    self.eobrun = 1 << r;
                    if r != 0 {
                        bits.ensure(input, r as u32);
                        self.eobrun += bits.get(r as u32) as u32;
                    }
                    break;
                }
                // Go past the nonzero coefficients, correcting them, and past `r` zero ones.
                loop {
                    let coef = coef_at(block, k)?;
                    if *coef != 0 {
                        correct(bits, input, coef, plus_one, minus_one);
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
                if value != 0 {
                    *coef_at(block, k)? = value;
                }
                k += 1;
            }
        }

        if self.eobrun > 0 {
            // What is left of the band only gets correction bits.
            while k <= se {
                let coef = coef_at(block, k)?;
                if *coef != 0 {
                    correct(bits, input, coef, plus_one, minus_one);
                }
                k += 1;
            }
            self.eobrun -= 1;
        }
        Ok(())
    }
}
