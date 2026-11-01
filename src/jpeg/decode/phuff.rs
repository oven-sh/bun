//! Huffman decoding of progressive scans (jdphuff.c).

use super::bits::{BitReader, DerivedTable, TableKind, Tables, huff_extend};
use super::coef::{CoefBits, McuBlocks, SAVED_COEFS};
use super::input::{Input, Restarts};
use super::{Block, Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPONENTS_IN_SCAN, McuBlock, coef_at};
use crate::error::{Error, Result};
use crate::zigzag::nonzero;

/// What a progressive scan codes.
#[derive(Clone, Copy, Default)]
pub(crate) enum Pass {
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
    restarts: Restarts,
    /// DC or AC: a scan has only one kind.
    tables: Tables<DerivedTable>,
    coef_bits: CoefBits,

    pass: Pass,
    ss: usize,
    se: usize,
    al: u32,
    blocks_in_mcu: usize,
    /// An AC scan has one component and one block in an MCU.
    blocks: [McuBlock; MAX_BLOCKS_IN_MCU],
}

/// Table B.3 of the standard.
const MAX_AL: u8 = 13;

/// Checks the parameters of a progressive scan and records it in `coef_bits`.
pub(crate) fn start_progressive_scan(decoder: &Decoder, coef_bits: &mut CoefBits) -> Result<Pass> {
    let &Decoder { ss, se, ah, al, .. } = decoder;
    let bad_band = if ss == 0 {
        se != 0
    } else {
        ss > se || se >= 64 || decoder.components_in_scan != 1
    };
    // A refinement scan adds exactly one bit.
    let bad_approximation = (ah != 0 && al != ah - 1) || al > MAX_AL;
    if bad_band || bad_approximation {
        return Err(Error::BadProgression(ss, se, ah, al));
    }

    let (first, last) = (usize::from(ss), usize::from(se));
    for i in 0..decoder.components_in_scan {
        let ci = decoder.scan_component_index(i)?;
        let current = coef_bits.current.get_mut(ci).ok_or(Error::Internal)?;
        let previous = coef_bits.previous.get_mut(ci).ok_or(Error::Internal)?;
        // The band, and whatever the band is, the AC coefficients that block smoothing looks at.
        let saved = first.min(1)..=last.max(SAVED_COEFS - 1);
        let previous = previous.get_mut(saved.clone()).ok_or(Error::Internal)?;
        if decoder.input_scan_number > 1 {
            previous.copy_from_slice(current.get(saved).ok_or(Error::Internal)?);
        } else {
            previous.fill(0);
        }
        let band = current.get_mut(first..=last).ok_or(Error::Internal)?;
        // A coefficient has one first scan, and each later one adds a bit. libjpeg takes any: see `start_input_pass`.
        let al = i32::from(al);
        let coded = |&bits: &i32| bits >= 0 && (ah == 0 || al >= bits);
        if band.iter().any(coded) {
            return Err(Error::RedundantScan);
        }
        band.fill(al);
    }
    Ok(match (ah == 0, ss == 0) {
        (true, true) => Pass::DcFirst,
        (true, false) => Pass::AcFirst,
        (false, true) => Pass::DcRefine,
        (false, false) => Pass::AcRefine,
    })
}

impl PHuffDecoder {
    pub(crate) fn new(decoder: &Decoder) -> Result<Self> {
        Ok(PHuffDecoder {
            coef_bits: CoefBits::new(decoder.components.len())?,
            ..Self::default()
        })
    }

    pub(crate) fn coef_bits(&self) -> &CoefBits {
        &self.coef_bits
    }

    pub(crate) fn start_pass(&mut self, decoder: &Decoder) -> Result<()> {
        self.pass = start_progressive_scan(decoder, &mut self.coef_bits)?;
        self.tables = Tables::default();
        for i in 0..decoder.components_in_scan {
            let comp = decoder.scan_component(i)?;
            let (specs, selector, kind) = match self.pass {
                Pass::DcFirst => (&decoder.dc_huff, comp.dc_selector, TableKind::Dc),
                // A bit for each coefficient takes no table.
                Pass::DcRefine => continue,
                Pass::AcFirst | Pass::AcRefine => {
                    (&decoder.ac_huff, comp.ac_selector, TableKind::Ac)
                }
            };
            let table = |spec: &_| DerivedTable::new(spec, kind);
            self.tables.derive(specs, selector, table)?;
        }
        self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];

        self.ss = usize::from(decoder.ss);
        self.se = usize::from(decoder.se);
        self.al = u32::from(decoder.al);
        self.blocks_in_mcu = decoder.blocks_in_mcu;
        self.blocks = decoder.mcu_blocks;

        self.bits.reset();
        self.eobrun = 0;
        self.restarts = Restarts::new(decoder.restart_interval);
        Ok(())
    }

    pub(crate) fn decode_mcu(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if self.restarts.due(input) {
            self.bits.reset();
            self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];
            self.eobrun = 0;
        }
        match self.pass {
            Pass::DcFirst => self.decode_dc_first(input, mcu),
            Pass::AcFirst => self.decode_ac_first(input, mcu),
            Pass::DcRefine => self.decode_dc_refine(input, mcu),
            Pass::AcRefine => self.decode_ac_refine(input, mcu),
        }
    }

    fn decode_dc_first(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if input.insufficient_data {
            return Ok(());
        }
        let mut bits = self.bits;
        for (index, info) in self.blocks.iter().enumerate().take(self.blocks_in_mcu) {
            let table = self.tables.get(info.dc_selector)?;
            let last_dc = self
                .last_dc_val
                .get_mut(usize::from(info.scan_component))
                .ok_or(Error::Internal)?;
            let s = u32::from(bits.decode(input, table));
            let mut diff = 0;
            if s != 0 {
                bits.ensure(input, s);
                diff = huff_extend(bits.get(s), s);
            }
            // jdhuff.c lets this sum wrap.
            *last_dc = last_dc.checked_add(diff).ok_or(Error::BadDctCoef)?;
            let [dc, ..] = mcu.block(index).ok_or(Error::Internal)?;
            *dc = last_dc.wrapping_shl(self.al) as i16;
        }
        self.bits = bits;
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
        let [info, ..] = self.blocks;
        let table = self.tables.get(info.ac_selector)?;
        let block = mcu.block(0).ok_or(Error::Internal)?;
        let mut bits = self.bits;

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
        self.bits = bits;
        Ok(())
    }

    fn decode_dc_refine(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        // Made-up zeros change nothing, so running out of data needs no check.
        let plus_one = 1i16 << self.al;
        let mut bits = self.bits;
        for index in 0..self.blocks_in_mcu {
            bits.ensure(input, 1);
            if bits.get(1) != 0 {
                let [dc, ..] = mcu.block(index).ok_or(Error::Internal)?;
                *dc |= plus_one;
            }
        }
        self.bits = bits;
        Ok(())
    }

    fn decode_ac_refine(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        if input.insufficient_data {
            return Ok(());
        }
        let [info, ..] = self.blocks;
        let table = self.tables.get(info.ac_selector)?;
        let block = mcu.block(0).ok_or(Error::Internal)?;
        let mut bits = self.bits;
        let se = self.se;
        // 1 and -1 in the bit position being coded.
        let plus_one = 1i16 << self.al;
        let minus_one = -1i16 << self.al;

        // Most coefficients are zero, so the band is gone through by bits, in zigzag order, instead of one by one.
        let (rows, _) = block.as_chunks::<8>();
        let rows = rows.try_into().map_err(|_| Error::Internal)?;
        let band = (u64::MAX << self.ss) & (u64::MAX >> (63 - se));
        let nonzero = nonzero(rows) & band;

        // A correction bit for each coefficient in `coefs`: a 1 moves it away from zero.
        let correct =
            |bits: &mut BitReader, input: &mut Input, block: &mut Block, mut coefs: u64| {
                while coefs != 0 {
                    let coef = coef_at(block, coefs.trailing_zeros() as usize)?;
                    coefs &= coefs - 1;
                    bits.ensure(input, 1);
                    if bits.get(1) != 0 && *coef & plus_one == 0 {
                        *coef = coef.wrapping_add(if *coef >= 0 { plus_one } else { minus_one });
                    }
                }
                Ok::<(), Error>(())
            };

        let mut k = self.ss;
        if self.eobrun == 0 {
            while k <= se {
                let symbol = bits.decode(input, table);
                let r = symbol >> 4;
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
                        bits.ensure(input, u32::from(r));
                        self.eobrun += bits.get(u32::from(r)) as u32;
                    }
                    break;
                }
                // Go past `r` zero coefficients and stop at the next one, correcting the nonzero ones on the way.
                let mut zeros = !nonzero & band & (u64::MAX << k);
                for _ in 0..r {
                    zeros &= zeros.wrapping_sub(1);
                }
                // All ones if the band ends first.
                let before_stop = zeros.isolate_lowest_one().wrapping_sub(1);
                correct(
                    &mut bits,
                    input,
                    block,
                    nonzero & (u64::MAX << k) & before_stop,
                )?;
                k = (zeros.trailing_zeros() as usize).min(se + 1);
                if value != 0 {
                    *coef_at(block, k)? = value;
                }
                k += 1;
            }
        }

        if self.eobrun > 0 {
            // What is left of the band only gets correction bits.
            correct(&mut bits, input, block, nonzero & (u64::MAX << k))?;
            self.eobrun -= 1;
        }
        self.bits = bits;
        Ok(())
    }
}
