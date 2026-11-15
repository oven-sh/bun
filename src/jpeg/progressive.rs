//! Progressive scans with Huffman coding (jdphuff.c).

use crate::bit_reader::{Bits, Window};
use crate::block::{Block, Zigzag};
use crate::header::{MAX_COMPONENTS, Scan, Tables};
use crate::huffman::{
    Alphabet, DecodeTable, DecodeTables, END, MAX_BITS_AFTER_CODE, QUICK_CODES_IN_REFILL, ZEROS,
};
use crate::input::Input;
use crate::scan::{EntropyDecoder, Slot};
use crate::{Error, Result, wrapped_mut};
use core::hint::{cold_path, select_unpredictable};
use core::ops::Range;

pub(crate) struct Progressive<'i, 'a> {
    scan: Scan,
    tables: DecodeTables,
    /// For each block: bit `k` is set if AC coefficient `k`, in zigzag order, is not zero.
    nonzero: &'i mut [u64],
    predictions: [i32; MAX_COMPONENTS],
    /// For how many more blocks the last code that ended one counts.
    end_run: usize,
    window: Window<'i, 'a>,
    bits: Bits,
}

impl<'i, 'a> Progressive<'i, 'a> {
    pub(crate) fn new(
        input: &'i mut Input<'a>,
        tables: &Tables,
        scan: &Scan,
        nonzero: &'i mut [u64],
    ) -> Result<Self> {
        let components = scan.components().iter();
        let ac = |alphabet| {
            let numbers = scan.components().iter().map(|it| it.ac_table);
            DecodeTables::new(numbers, &tables.ac, alphabet)
        };
        let dc = |count| {
            let numbers = components.take(count).map(|it| it.dc_table);
            DecodeTables::new(numbers, &tables.dc, Alphabet::Dc)
        };
        let mut window = Window::new(input);
        Ok(Self {
            scan: *scan,
            tables: match (scan.first, scan.previous_shift) {
                (0, 0) => dc(usize::MAX)?,
                (0, _) => dc(0)?,
                (_, 0) => ac(Alphabet::AcFirst { shift: scan.shift })?,
                _ => ac(Alphabet::AcRefine)?,
            },
            nonzero,
            predictions: [0; MAX_COMPONENTS],
            end_run: 0,
            bits: window.bits_from(0),
            window,
        })
    }

    fn dc_first(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let tables = self.tables.dc_by_component(&self.scan)?;
        let (mut bits, window) = (self.bits, &mut self.window);
        let mut begun = 0;
        for mcu in mcus {
            if !window.has_data(bits) {
                break;
            }
            begun += 1;
            for slot in slots {
                bits.start_block(window);
                let code = slot.pick(&tables).find(&mut bits, window);
                let difference = code.value(code.take(&mut bits));
                let prediction = wrapped_mut(&mut self.predictions, slot.component);
                *prediction = prediction
                    .checked_add(difference)
                    .ok_or(Error::InvalidCoefficient)?;
                slot.of(blocks, mcu)?.0[0] = (*prediction << self.scan.shift) as i16;
            }
        }
        self.bits = bits;
        Ok(begun)
    }

    fn dc_refine(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let (mut bits, window) = (self.bits, &mut self.window);
        let mut begun = 0;
        for mcu in mcus {
            if !window.has_data(bits) {
                break;
            }
            begun += 1;
            bits.start_block(window);
            bits.refill(window);
            for slot in slots {
                slot.of(blocks, mcu)?.0[0] |= ((bits.take(1) & 1) << self.scan.shift) as i16;
            }
        }
        self.bits = bits;
        Ok(begun)
    }

    fn ac_first(&mut self, blocks: &mut [Block], range: Range<usize>) -> Result<usize> {
        let table = ac_table(&self.tables, &self.scan)?;
        let (first, last) = (usize::from(self.scan.first), usize::from(self.scan.last));
        let shift = self.scan.shift;
        let (mut bits, window) = (self.bits, &mut self.window);
        let mut at = range.start;
        while at < range.end && window.has_data(bits) {
            if self.end_run != 0 {
                let skipped = self.end_run.min(range.end - at);
                self.end_run -= skipped;
                at += skipped;
                continue;
            }
            let (Some(block), Some(nonzero)) = (blocks.get_mut(at), self.nonzero.get_mut(at))
            else {
                return Err(Error::Internal);
            };
            at += 1;
            bits.start_block(window);
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
                        if k >= END {
                            self.end_run = code.end_run(taken);
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
                if code.run() == END {
                    self.end_run = code.end_run(taken);
                    break;
                }
                k += code.run();
                if code.run() != ZEROS {
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
        let table = ac_table(&self.tables, &self.scan)?;
        let (first, last) = (u32::from(self.scan.first), u32::from(self.scan.last));
        let band = u64::MAX << first & u64::MAX >> (63 - last);
        let bit = 1i16 << self.scan.shift;
        let (mut bits, window) = (self.bits, &mut self.window);
        let mut end_run = self.end_run;
        let (Some(blocks), Some(nonzero)) = (
            blocks.get_mut(range.start..range.end),
            self.nonzero.get_mut(range),
        ) else {
            return Err(Error::Internal);
        };
        let mut begun = 0;
        for (block, nonzero) in blocks.iter_mut().zip(nonzero) {
            let known = *nonzero & band;
            if end_run != 0 && known == 0 {
                end_run -= 1;
                begun += usize::from(window.has_data(bits));
                continue;
            }
            if !window.has_data(bits) {
                break;
            }
            begun += 1;
            bits.start_block(window);

            // One bit for each coefficient in `known`, the first at the top once they are all there.
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
            let (mut zeros, mut known_ahead) = (band & !known, known);
            let mut past_the_band = 0;
            while end_run == 0 && zeros | known_ahead != 0 {
                let code = table.find(&mut bits, window);
                let taken = code.take(&mut bits);
                if code.run() == END {
                    end_run = code.end_run(taken) + 1;
                    break;
                }
                zeros = without_lowest(zeros, code.run());
                let through = zeros ^ zeros.wrapping_sub(1);
                take_corrections(&mut bits, (known_ahead & through).count_ones());
                known_ahead &= !through;
                let value = (code.value(taken) << self.scan.shift) as i16;
                if value != 0 {
                    if zeros == 0 {
                        past_the_band = value;
                        break;
                    }
                    *block.at_mut(zeros.trailing_zeros() as usize) = value;
                    *nonzero |= zeros & through;
                }
                zeros &= !through;
            }
            if end_run != 0 {
                bits.refill(window);
                take_corrections(&mut bits, known_ahead.count_ones());
                end_run -= 1;
            }

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
        (self.bits, self.end_run) = (bits, end_run);
        Ok(begun)
    }
}

/// Clears the lowest `count` bits that are set. How many they are cannot be foreseen, but mostly they are few.
#[inline(always)]
fn without_lowest(bits: u64, count: usize) -> u64 {
    let next = |bits: u64| bits & bits.wrapping_sub(1);
    let (one, two) = (next(bits), next(next(bits)));
    let mut left = select_unpredictable(
        count & 2 == 0,
        select_unpredictable(count & 1 == 0, bits, one),
        select_unpredictable(count & 1 == 0, two, next(two)),
    );
    for _ in 0..count / 4 {
        left = next(next(next(next(left))));
    }
    left
}

fn ac_table<'t>(tables: &'t DecodeTables, scan: &Scan) -> Result<&'t DecodeTable> {
    tables.get(scan.components().first().ok_or(Error::Internal)?.ac_table)
}

impl EntropyDecoder for Progressive<'_, '_> {
    fn decode(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let start = slots.first().map_or(0, |slot| slot.start);
        match (self.scan.first, self.scan.previous_shift) {
            (0, 0) => self.dc_first(blocks, slots, mcus),
            (0, _) => self.dc_refine(blocks, slots, mcus),
            (_, 0) => self.ac_first(blocks, start + mcus.start..start + mcus.end),
            _ => self.ac_refine(blocks, start + mcus.start..start + mcus.end),
        }
    }

    fn restart(&mut self, number: u8) {
        self.bits = self.window.restart(self.bits, number);
        self.predictions = [0; MAX_COMPONENTS];
        self.end_run = 0;
    }

    fn has_data(&self) -> bool {
        self.window.has_data(self.bits)
    }

    fn is_over(&self) -> bool {
        self.window.is_over(self.bits)
    }
}
