//! Huffman decoding of sequential scans (jdhuff.c).

use super::bits::{
    AcTable, BitReader, Bits, DerivedTable, FastBitReader, SlowBits, TableKind, Tables, huff_extend,
};
use super::coef::McuBlocks;
use super::input::{Input, Restarts};
use super::{Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPONENTS_IN_SCAN, McuBlock, coef_at};
use crate::alloc::try_box;
use crate::error::{Error, Result};
use crate::tables;

#[derive(Default)]
pub(crate) struct HuffDecoder {
    bits: BitReader,
    last_dc_val: [i32; MAX_COMPONENTS_IN_SCAN],
    restarts: Restarts,
    dc_tables: Tables<DerivedTable>,
    ac_tables: Tables<AcTable>,
    blocks: [McuBlock; MAX_BLOCKS_IN_MCU],
    blocks_in_mcu: usize,
}

impl HuffDecoder {
    /// Motion JPEG frames usually leave out the tables of the standard, so they stand in for what is undefined by now.
    pub(crate) fn new(decoder: &mut Decoder) -> Result<Self> {
        let [dc0, dc1, ..] = &mut decoder.dc_huff;
        let [ac0, ac1, ..] = &mut decoder.ac_huff;
        for (table, standard) in [
            (dc0, &tables::STD_DC_LUMINANCE),
            (ac0, &tables::STD_AC_LUMINANCE),
            (dc1, &tables::STD_DC_CHROMINANCE),
            (ac1, &tables::STD_AC_CHROMINANCE),
        ] {
            if table.is_none() {
                *table = Some(try_box(standard.clone())?);
            }
        }
        Ok(Self::default())
    }

    pub(crate) fn start_pass(&mut self, decoder: &Decoder) -> Result<()> {
        (self.dc_tables, self.ac_tables) = Default::default();
        for i in 0..decoder.components_in_scan {
            let comp = decoder.scan_component(i)?;
            let dc_table = |spec: &_| DerivedTable::new(spec, TableKind::Dc);
            self.dc_tables
                .derive(&decoder.dc_huff, comp.dc_selector, dc_table)?;
            self.ac_tables
                .derive(&decoder.ac_huff, comp.ac_selector, AcTable::new)?;
        }
        self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];

        self.blocks = decoder.mcu_blocks;
        self.blocks_in_mcu = decoder.blocks_in_mcu;

        self.bits.reset();
        self.restarts = Restarts::new(decoder.restart_interval);
        Ok(())
    }

    /// Decodes one MCU into zeroed blocks. As in libjpeg-turbo, the slow way starts over where the fast one gives up.
    #[inline]
    pub(crate) fn decode_mcu(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        let use_fast = self.start_mcu(input);

        // Out of data, the rest of the segment stays zero.
        if !input.insufficient_data {
            let done = use_fast && self.decode_mcu_fast(input, mcu)?;
            if !done {
                self.decode_mcu_slow(input, mcu)?;
            }
        }
        Ok(())
    }

    /// Takes care of a restart marker that is due. Returns whether the fast way is safe, which never looks for the end.
    #[inline]
    fn start_mcu(&mut self, input: &mut Input) -> bool {
        /// The most that a block can take up, generously.
        const BUFSIZE: usize = 64 * 8;

        if self.restarts.due(input) {
            self.bits.reset();
            self.last_dc_val = [0; MAX_COMPONENTS_IN_SCAN];
        }
        !self.restarts.in_use()
            && input.remaining().len() >= BUFSIZE * self.blocks_in_mcu
            && input.unread_marker == 0
    }

    /// The blocks of an MCU, from either source of bits. Returns the new DC predictions.
    #[inline(always)]
    fn decode_blocks(
        &self,
        bits: &mut impl Bits,
        mcu: &mut impl McuBlocks,
    ) -> Result<[i32; MAX_COMPONENTS_IN_SCAN]> {
        let mut last_dc_val = self.last_dc_val;
        for (index, info) in self.blocks.iter().enumerate().take(self.blocks_in_mcu) {
            let dc_table = self.dc_tables.get(info.dc_selector)?;
            let ac_table = self.ac_tables.get(info.ac_selector)?;
            let block = mcu.block(index).ok_or(Error::Internal)?;
            let last_dc = last_dc_val
                .get_mut(usize::from(info.scan_component))
                .ok_or(Error::Internal)?;

            let s = u32::from(bits.symbol(dc_table));
            let diff = if s != 0 {
                huff_extend(bits.bits(s), s)
            } else {
                0
            };
            // Damaged data can take this around the range of an i32.
            *last_dc = last_dc.wrapping_add(diff);
            let [dc, ..] = block;
            *dc = *last_dc as i16;

            let mut k = 1;
            while k < 64 {
                if let Some(short) = bits.short_coefficient(ac_table) {
                    k += usize::from(short.run);
                    if info.ac_needed {
                        *coef_at(block, k)? = short.value;
                    }
                    k += 1;
                    if k >= 64 {
                        bits.catch_up(short);
                    }
                    continue;
                }
                let symbol = bits.symbol(&ac_table.codes);
                let r = usize::from(symbol >> 4);
                let s = u32::from(symbol & 15);
                if s != 0 {
                    k += r;
                    let value = bits.bits(s);
                    if info.ac_needed {
                        *coef_at(block, k)? = huff_extend(value, s) as i16;
                    }
                } else {
                    if r != 15 {
                        break;
                    }
                    k += 15;
                }
                k += 1;
            }
        }
        Ok(last_dc_val)
    }

    /// Only stores what is not zero, and takes FF FF 00 for data: there what the fast way stored shows in the pixels.
    fn decode_mcu_slow(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        let mut bits = SlowBits {
            bits: self.bits,
            input,
        };
        self.last_dc_val = self.decode_blocks(&mut bits, mcu)?;
        self.bits = bits.bits;
        Ok(())
    }

    /// Returns false, with no state changed but with coefficients stored, if it came upon what may be a marker.
    #[inline(never)]
    fn decode_mcu_fast(&mut self, input: &mut Input, mcu: &mut impl McuBlocks) -> Result<bool> {
        let mut bits = FastBitReader::new(self.bits, input.remaining());
        let last_dc_val = self.decode_blocks(&mut bits, mcu)?;
        let Some((bits, consumed)) = bits.finish() else {
            return Ok(false);
        };
        input.skip(consumed);
        self.bits = bits;
        self.last_dc_val = last_dc_val;
        Ok(true)
    }
}
