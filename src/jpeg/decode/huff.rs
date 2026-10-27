//! Huffman decoding of sequential scans (jdhuff.c).

use super::bits::{BitReader, DerivedTable, FastBitReader, TableKind, huff_extend};
use super::coef::McuBlocks;
use super::input::Input;
use super::{Block, Decoder, MAX_BLOCKS_IN_MCU, MAX_COMPS_IN_SCAN, NUM_HUFF_TBLS};
use crate::error::{Error, Result};
use crate::tables::{self, NATURAL_ORDER};

#[derive(Default)]
pub(crate) struct HuffDecoder {
    bits: BitReader,
    last_dc_val: [i32; MAX_COMPS_IN_SCAN],
    /// MCUs left in this restart interval.
    restarts_to_go: u32,
    restart_interval: u32,
    dc_tables: [Option<Box<DerivedTable>>; NUM_HUFF_TBLS],
    ac_tables: [Option<Box<DerivedTable>>; NUM_HUFF_TBLS],
    blocks: [BlockInfo; MAX_BLOCKS_IN_MCU],
    blocks_in_mcu: usize,
}

/// What a block of an MCU is decoded with.
#[derive(Default, Clone, Copy)]
struct BlockInfo {
    /// Index into `last_dc_val`.
    scan_comp: u8,
    dc_table: u8,
    ac_table: u8,
    /// An image scaled to 1/8 is made of the DC coefficients alone.
    ac_needed: bool,
}

struct Tables<'a> {
    dc: &'a DerivedTable,
    ac: &'a DerivedTable,
}

impl HuffDecoder {
    /// Motion JPEG frames usually leave out the tables of the standard, so they stand in for whatever is undefined when
    /// decoding begins.
    pub(crate) fn new(d: &mut Decoder) -> Self {
        let [dc0, dc1, ..] = &mut d.dc_huff;
        let [ac0, ac1, ..] = &mut d.ac_huff;
        dc0.get_or_insert_with(|| Box::new(tables::STD_DC_LUMINANCE));
        ac0.get_or_insert_with(|| Box::new(tables::STD_AC_LUMINANCE));
        dc1.get_or_insert_with(|| Box::new(tables::STD_DC_CHROMINANCE));
        ac1.get_or_insert_with(|| Box::new(tables::STD_AC_CHROMINANCE));
        Self::default()
    }

    pub(crate) fn start_pass(&mut self, d: &mut Decoder) -> Result<()> {
        for i in 0..d.comps_in_scan {
            let comp = d.scan_comp(i)?;
            let (dc, ac) = (comp.dc_tbl_no, comp.ac_tbl_no);
            let spec = d.dc_huff.get(usize::from(dc)).and_then(|t| t.as_deref());
            let table = DerivedTable::new(spec.ok_or(Error::NoHuffTable(dc))?, TableKind::Dc)?;
            *self
                .dc_tables
                .get_mut(usize::from(dc))
                .ok_or(Error::Internal)? = Some(table);
            let spec = d.ac_huff.get(usize::from(ac)).and_then(|t| t.as_deref());
            let table = DerivedTable::new(spec.ok_or(Error::NoHuffTable(ac))?, TableKind::Ac)?;
            *self
                .ac_tables
                .get_mut(usize::from(ac))
                .ok_or(Error::Internal)? = Some(table);
        }
        self.last_dc_val = [0; MAX_COMPS_IN_SCAN];

        self.blocks_in_mcu = d.blocks_in_mcu;
        for (info, &scan_comp) in self
            .blocks
            .iter_mut()
            .zip(d.mcu_membership.iter())
            .take(d.blocks_in_mcu)
        {
            let comp = d.scan_comp(usize::from(scan_comp))?;
            *info = BlockInfo {
                scan_comp,
                dc_table: comp.dc_tbl_no,
                ac_table: comp.ac_tbl_no,
                ac_needed: comp.dct_scaled_size > 1,
            };
        }

        self.bits.reset();
        d.inp.insufficient_data = false;
        self.restart_interval = d.restart_interval;
        self.restarts_to_go = d.restart_interval;
        Ok(())
    }

    fn process_restart(&mut self, inp: &mut Input) {
        self.bits.reset();
        inp.read_restart_marker();
        self.last_dc_val = [0; MAX_COMPS_IN_SCAN];
        self.restarts_to_go = self.restart_interval;
        // Up against a marker, the next segment is empty: leaving the flag set keeps it gray instead of garbage.
        if inp.unread_marker == 0 {
            inp.insufficient_data = false;
        }
    }

    /// Decodes one MCU into blocks that the caller has zeroed.
    ///
    /// libjpeg-turbo has two ways to do it. The fast one does not know what to do about a marker: it takes any FF that
    /// is not followed by 00 for one, goes on with zeros, and at the end of the MCU throws its state away so that the
    /// slow one starts the MCU over. The coefficients it stored stay, though, and the slow one only stores nonzero
    /// ones. They read the same bits unless the FF was padding before a stuffed FF 00, which the slow one takes for
    /// data. Then the MCU ends up with coefficients from both, so both are here, with how far ahead they read, which
    /// decides when the fast one gets to see an FF and when it is used at all.
    #[inline]
    pub(crate) fn decode_mcu(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        let use_fast = self.start_mcu(inp);

        // Out of data, the rest of the segment stays zero.
        if !inp.insufficient_data && !(use_fast && self.decode_mcu_fast(inp, mcu)?) {
            self.decode_mcu_slow(inp, mcu)?;
        }

        if self.restart_interval != 0 {
            self.restarts_to_go -= 1;
        }
        Ok(())
    }

    /// Takes care of a restart marker that is due. Returns whether the fast way is safe: it does not look for the end of
    /// the data.
    #[inline]
    fn start_mcu(&mut self, inp: &mut Input) -> bool {
        /// The most that a block can take up, generously.
        const BUFSIZE: usize = 64 * 8;

        if self.restart_interval != 0 {
            if self.restarts_to_go == 0 {
                self.process_restart(inp);
            }
            return false;
        }
        inp.remaining().len() >= BUFSIZE * self.blocks_in_mcu && inp.unread_marker == 0
    }

    #[inline(always)]
    fn tables(&self, info: BlockInfo) -> Result<Tables<'_>> {
        let dc = self
            .dc_tables
            .get(usize::from(info.dc_table))
            .and_then(|t| t.as_deref());
        let ac = self
            .ac_tables
            .get(usize::from(info.ac_table))
            .and_then(|t| t.as_deref());
        match (dc, ac) {
            (Some(dc), Some(ac)) => Ok(Tables { dc, ac }),
            _ => Err(Error::Internal),
        }
    }

    /// The blocks of an MCU, from either source of bits. Returns the new DC predictions.
    #[inline(always)]
    fn decode_blocks(
        &self,
        bits: &mut impl Bits,
        mcu: &mut impl McuBlocks,
    ) -> Result<[i32; MAX_COMPS_IN_SCAN]> {
        let mut last_dc_val = self.last_dc_val;
        for (blkn, info) in self.blocks.iter().enumerate().take(self.blocks_in_mcu) {
            let tables = self.tables(*info)?;
            let block = mcu.block(blkn).ok_or(Error::Internal)?;
            let last_dc = last_dc_val
                .get_mut(usize::from(info.scan_comp))
                .ok_or(Error::Internal)?;

            let s = u32::from(bits.symbol(tables.dc));
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
                let symbol = bits.symbol(tables.ac);
                let r = usize::from(symbol >> 4);
                let s = u32::from(symbol & 15);
                if s != 0 {
                    k += r;
                    let value = bits.bits(s);
                    if info.ac_needed {
                        store(block, k, huff_extend(value, s));
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

    fn decode_mcu_slow(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<()> {
        let mut bits = SlowBits {
            bits: self.bits,
            inp,
        };
        self.last_dc_val = self.decode_blocks(&mut bits, mcu)?;
        self.bits = bits.bits;
        Ok(())
    }

    /// Returns false, with no state changed but with coefficients stored, if it came upon what may be a marker.
    #[inline(never)]
    fn decode_mcu_fast(&mut self, inp: &mut Input, mcu: &mut impl McuBlocks) -> Result<bool> {
        let mut bits = FastBitReader::new(self.bits, inp.remaining());
        let last_dc_val = self.decode_blocks(&mut bits, mcu)?;
        let Some((bits, consumed)) = bits.finish() else {
            return Ok(false);
        };
        inp.skip(consumed);
        self.bits = bits;
        self.last_dc_val = last_dc_val;
        Ok(true)
    }
}

/// Where the bits of an MCU come from.
trait Bits {
    /// The next symbol.
    fn symbol(&mut self, table: &DerivedTable) -> u8;
    /// The next `n` bits, from 1 to 15.
    fn bits(&mut self, n: u32) -> i32;
}

struct SlowBits<'a, 'b> {
    bits: BitReader,
    inp: &'a mut Input<'b>,
}

impl Bits for SlowBits<'_, '_> {
    #[inline(always)]
    fn symbol(&mut self, table: &DerivedTable) -> u8 {
        self.bits.decode(self.inp, table)
    }

    #[inline(always)]
    fn bits(&mut self, n: u32) -> i32 {
        self.bits.check(self.inp, n);
        self.bits.get(n)
    }
}

impl Bits for FastBitReader<'_> {
    #[inline(always)]
    fn symbol(&mut self, table: &DerivedTable) -> u8 {
        self.decode(table)
    }

    #[inline(always)]
    fn bits(&mut self, n: u32) -> i32 {
        self.fill();
        self.get(n)
    }
}

#[inline(always)]
fn store(block: &mut Block, k: usize, value: i32) {
    let pos = NATURAL_ORDER.get(k).copied().unwrap_or(63);
    if let Some(coef) = block.get_mut(usize::from(pos)) {
        *coef = value as i16;
    }
}
