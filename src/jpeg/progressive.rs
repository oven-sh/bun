//! Progressive scans with Huffman coding (jdphuff.c).

use crate::bit_reader::{Bits, Window};
use crate::block::{Block, Zigzag, band, prefetch_after, without_lowest};
use crate::header::{Scan, ScanKind, Tables};
use crate::huffman::{
    Alphabet, DecodeTables, MAX_BITS_AFTER_CODE, QUICK_CODES_IN_REFILL, RUN_OF_EOB, RUN_OF_ZRL,
};
use crate::scan::{EntropyDecoder, Slot};
use crate::{Error, MAX_COMPONENTS, Result, wrapped_mut};
use core::hint::{cold_path, select_unpredictable};
use core::ops::Range;

pub(crate) struct Progressive<'i, 'a> {
    scan: Scan,
    tables: DecodeTables,
    /// For each block: bit `k` is set if AC coefficient `k`, in zigzag order, is not zero.
    nonzero: &'i mut [u64],
    predictions: [i32; MAX_COMPONENTS],
    /// `EOBRUN`: how many more blocks the last EOBn ends.
    eob_run: usize,
    window: &'i mut Window<'i, 'a>,
    bits: Bits,
}

pub(crate) fn tables_for(scan: &Scan, tables: &Tables) -> Result<DecodeTables> {
    let numbers = scan.components().iter().filter_map(|it| match scan.kind {
        ScanKind::DcFirst => Some(it.dc_table),
        ScanKind::DcRefine => None,
        _ => Some(it.ac_table),
    });
    let (specs, alphabet) = match scan.kind {
        ScanKind::DcFirst | ScanKind::DcRefine => (&tables.dc, Alphabet::Dc),
        ScanKind::AcFirst => (&tables.ac, Alphabet::AcFirst { shift: scan.al }),
        _ => (&tables.ac, Alphabet::AcRefine),
    };
    DecodeTables::new(numbers, specs, alphabet)
}

impl<'i, 'a> Progressive<'i, 'a> {
    pub(crate) fn new(
        window: &'i mut Window<'i, 'a>,
        tables: DecodeTables,
        scan: &Scan,
        nonzero: &'i mut [u64],
    ) -> Self {
        Self {
            scan: *scan,
            tables,
            nonzero,
            predictions: [0; MAX_COMPONENTS],
            eob_run: 0,
            bits: window.bits_from(0),
            window,
        }
    }

    /// Like the other three, returns how many MCUs began with data left. Inlined, the DC scans cost the AC scans 2 %.
    #[inline(never)]
    fn dc_first(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let tables = self.tables.by_component()?;
        let (mut bits, window) = (self.bits, &mut *self.window);
        let mut begun = 0;
        for mcu in mcus {
            if !window.has_data(bits) {
                break;
            }
            begun += 1;
            for slot in slots {
                bits.ensure_margin(window);
                let code = slot.pick(&tables).next_code(&mut bits, window);
                let difference = code.value(code.take(&mut bits));
                let prediction = wrapped_mut(&mut self.predictions, slot.component);
                *prediction = prediction
                    .checked_add(difference)
                    .ok_or(Error::InvalidCoefficient)?;
                let block = slot.of(blocks, mcu)?;
                prefetch_after(block, slot.step_right);
                *block.dc_mut() = (*prediction << self.scan.al) as i16;
            }
        }
        self.bits = bits;
        Ok(begun)
    }

    #[inline(never)]
    fn dc_refine(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let (mut bits, window) = (self.bits, &mut *self.window);
        let mut begun = 0;
        for mcu in mcus {
            if !window.has_data(bits) {
                break;
            }
            begun += 1;
            bits.ensure_margin(window);
            bits.refill(window);
            for slot in slots {
                let block = slot.of(blocks, mcu)?;
                prefetch_after(block, slot.step_right);
                *block.dc_mut() |= ((bits.take(1) & 1) << self.scan.al) as i16;
            }
        }
        self.bits = bits;
        Ok(begun)
    }

    fn ac_first(&mut self, blocks: &mut [Block], range: Range<usize>) -> Result<usize> {
        let table = self.tables.first()?;
        let (first, last) = (usize::from(self.scan.ss), usize::from(self.scan.se));
        let shift = self.scan.al;
        let (mut bits, window) = (self.bits, &mut *self.window);
        let mut at = range.start;
        while at < range.end && window.has_data(bits) {
            if self.eob_run != 0 {
                let skipped = self.eob_run.min(range.end - at);
                self.eob_run -= skipped;
                at += skipped;
                continue;
            }
            let block = blocks.get_mut(at).ok_or(Error::Internal)?;
            let nonzero = self.nonzero.get_mut(at).ok_or(Error::Internal)?;
            at += 1;
            bits.ensure_margin(window);
            let (mut k, mut found) = (first, *nonzero);
            'refill: loop {
                let mut code = table.quick(bits.peek());
                bits.refill(window);
                let mut left = QUICK_CODES_IN_REFILL;
                while code.length() != 0 {
                    let taken = code.take(&mut bits);
                    let value = (code.value(taken) << shift) as i16;
                    k += code.run();
                    if k >= last {
                        if k >= RUN_OF_EOB {
                            self.eob_run = code.eob_run(taken);
                        } else if code.run() == RUN_OF_ZRL {
                            k -= RUN_OF_ZRL - 16;
                            if k <= last {
                                continue 'refill;
                            }
                        } else {
                            *block.at_mut(k) = value;
                            found |= 1 << k.min(63);
                        }
                        break 'refill;
                    }
                    *block.at_mut(k) = value;
                    found |= 1 << k;
                    k += 1;
                    left -= 1;
                    if left == 0 {
                        continue 'refill;
                    }
                    code = table.quick(bits.peek());
                }

                bits.refill(window);
                let code = table.search(bits.peek());
                let taken = code.take(&mut bits);
                if code.run() == RUN_OF_EOB {
                    self.eob_run = code.eob_run(taken);
                    break;
                }
                if code.run() == RUN_OF_ZRL {
                    k += 16;
                } else {
                    k += code.run();
                    let value = (code.value(taken) << shift) as i16;
                    *block.at_mut(k) = value;
                    found &= !(1 << k.min(63));
                    found |= u64::from(value != 0) << k.min(63);
                    k += 1;
                }
                if k > last {
                    break;
                }
            }
            *nonzero = found;
        }
        self.bits = bits;
        Ok(at - range.start)
    }

    fn ac_refine(&mut self, blocks: &mut [Block], range: Range<usize>) -> Result<usize> {
        let table = self.tables.first()?;
        let (first, last) = (u32::from(self.scan.ss), u32::from(self.scan.se));
        let band = band(first, last);
        let bit = 1i16 << self.scan.al;
        let (mut bits, window) = (self.bits, &mut *self.window);
        let mut eob_run = self.eob_run;
        let (Some(blocks), Some(nonzero)) = (
            blocks.get_mut(range.start..range.end),
            self.nonzero.get_mut(range),
        ) else {
            return Err(Error::Internal);
        };
        let mut begun = 0;
        for (block, nonzero) in blocks.iter_mut().zip(nonzero) {
            let known = *nonzero & band;
            if eob_run != 0 && known == 0 {
                eob_run -= 1;
                begun += usize::from(window.has_data(bits));
                continue;
            }
            if !window.has_data(bits) {
                break;
            }
            begun += 1;
            prefetch_after(block, 1);
            bits.ensure_margin(window);

            // The correction bits of `known`, in order.
            let mut corrections = 0u64;
            let mut take_corrections = |bits: &mut Bits, mut count: u32| {
                while count > MAX_BITS_AFTER_CODE {
                    cold_path();
                    corrections = corrections << 16 | bits.peek() >> 48;
                    bits.take(16);
                    bits.refill(window);
                    count -= 16;
                }
                corrections = corrections << count | bits.peek() >> 1 >> (63 - count);
                bits.take(count);
            };
            let (mut zeros, mut next) = (band & !known, first);
            let (mut found, mut past_the_band) = (*nonzero, 0);
            while eob_run == 0 && next <= last {
                let code = table.next_code(&mut bits, window);
                let taken = code.take(&mut bits);
                if code.run() == RUN_OF_EOB {
                    eob_run = code.eob_run(taken) + 1;
                    break;
                }
                zeros = without_lowest(zeros, code.run());
                let value = select_unpredictable(taken & 1 != 0, bit, -bit);
                if zeros == 0 {
                    past_the_band = if code.mask() != 0 { value } else { 0 };
                    break;
                }
                let k = zeros.trailing_zeros();
                // All up to `k` that the run does not count are known. `count_ones()` is slower, above all on arm64.
                take_corrections(&mut bits, k - next - code.run() as u32);
                if code.mask() != 0 {
                    *block.at_mut(k as usize) = value;
                    found |= 1 << k;
                }
                (zeros, next) = (zeros & (zeros - 1), k + 1);
            }
            *nonzero = found;
            bits.refill(window);
            take_corrections(&mut bits, known.unbounded_shr(next).count_ones());
            eob_run = eob_run.saturating_sub(1);

            let mut left = known;
            corrections = corrections.unbounded_shl(64 - known.count_ones());
            while corrections != 0 {
                let coefficient = block.at_mut(left.trailing_zeros() as usize);
                let add = (corrections as i64 >> 63) as i16 & bit & !*coefficient;
                let sign = *coefficient >> 15;
                *coefficient = coefficient.wrapping_add((add ^ sign) - sign);
                corrections <<= 1;
                left &= left.wrapping_sub(1);
            }
            if past_the_band != 0 {
                *block.at_mut(last as usize + 1) = past_the_band;
                *nonzero |= 1 << (last + 1).min(63);
            }
        }
        (self.bits, self.eob_run) = (bits, eob_run);
        Ok(begun)
    }
}

impl EntropyDecoder for Progressive<'_, '_> {
    fn decode(&mut self, blocks: &mut [Block], slots: &[Slot], mcus: Range<usize>) -> Result<bool> {
        let start = slots.first().map_or(0, |slot| slot.start);
        let begun = match self.scan.kind {
            ScanKind::DcFirst => self.dc_first(blocks, slots, mcus),
            ScanKind::DcRefine => self.dc_refine(blocks, slots, mcus),
            ScanKind::AcFirst => self.ac_first(blocks, start + mcus.start..start + mcus.end),
            _ => self.ac_refine(blocks, start + mcus.start..start + mcus.end),
        }?;
        Ok(begun > 1)
    }

    fn restart(&mut self, number: u8) {
        self.bits = self.window.restart(self.bits, number);
        self.predictions = [0; MAX_COMPONENTS];
        self.eob_run = 0;
    }

    fn has_data(&self) -> bool {
        self.window.has_data(self.bits)
    }

    fn is_over(&self) -> bool {
        self.window.is_over(self.bits)
    }
}
