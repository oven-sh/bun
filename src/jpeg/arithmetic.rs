//! Scans with arithmetic coding (jdarith.c).

use crate::bit_reader::Window;
use crate::block::{Block, Zigzag, prefetch_after};
use crate::header::{ARITHMETIC_TABLES, Scan, ScanKind, Tables};
use crate::scan::{EntropyDecoder, Slot};
use crate::{MAX_COMPONENTS, Result, wrapped, wrapped_mut};
use core::hint::select_unpredictable;
use core::ops::Range;

/// `Qe`, `Next_Index_LPS`, `Next_Index_MPS` and `Switch_MPS` (ITU-T T.81, table D.3). The last state stays at even odds.
#[rustfmt::skip]
const ESTIMATES: [(u32, u32, u32, u32); 114] = [
    (0x5a1d,   1,   1, 1), (0x2586,  14,   2, 0), (0x1114,  16,   3, 0), (0x080b,  18,   4, 0),
    (0x03d8,  20,   5, 0), (0x01da,  23,   6, 0), (0x00e5,  25,   7, 0), (0x006f,  28,   8, 0),
    (0x0036,  30,   9, 0), (0x001a,  33,  10, 0), (0x000d,  35,  11, 0), (0x0006,   9,  12, 0),
    (0x0003,  10,  13, 0), (0x0001,  12,  13, 0), (0x5a7f,  15,  15, 1), (0x3f25,  36,  16, 0),
    (0x2cf2,  38,  17, 0), (0x207c,  39,  18, 0), (0x17b9,  40,  19, 0), (0x1182,  42,  20, 0),
    (0x0cef,  43,  21, 0), (0x09a1,  45,  22, 0), (0x072f,  46,  23, 0), (0x055c,  48,  24, 0),
    (0x0406,  49,  25, 0), (0x0303,  51,  26, 0), (0x0240,  52,  27, 0), (0x01b1,  54,  28, 0),
    (0x0144,  56,  29, 0), (0x00f5,  57,  30, 0), (0x00b7,  59,  31, 0), (0x008a,  60,  32, 0),
    (0x0068,  62,  33, 0), (0x004e,  63,  34, 0), (0x003b,  32,  35, 0), (0x002c,  33,   9, 0),
    (0x5ae1,  37,  37, 1), (0x484c,  64,  38, 0), (0x3a0d,  65,  39, 0), (0x2ef1,  67,  40, 0),
    (0x261f,  68,  41, 0), (0x1f33,  69,  42, 0), (0x19a8,  70,  43, 0), (0x1518,  72,  44, 0),
    (0x1177,  73,  45, 0), (0x0e74,  74,  46, 0), (0x0bfb,  75,  47, 0), (0x09f8,  77,  48, 0),
    (0x0861,  78,  49, 0), (0x0706,  79,  50, 0), (0x05cd,  48,  51, 0), (0x04de,  50,  52, 0),
    (0x040f,  50,  53, 0), (0x0363,  51,  54, 0), (0x02d4,  52,  55, 0), (0x025c,  53,  56, 0),
    (0x01f8,  54,  57, 0), (0x01a4,  55,  58, 0), (0x0160,  56,  59, 0), (0x0125,  57,  60, 0),
    (0x00f6,  58,  61, 0), (0x00cb,  59,  62, 0), (0x00ab,  61,  63, 0), (0x008f,  61,  32, 0),
    (0x5b12,  65,  65, 1), (0x4d04,  80,  66, 0), (0x412c,  81,  67, 0), (0x37d8,  82,  68, 0),
    (0x2fe8,  83,  69, 0), (0x293c,  84,  70, 0), (0x2379,  86,  71, 0), (0x1edf,  87,  72, 0),
    (0x1aa9,  87,  73, 0), (0x174e,  72,  74, 0), (0x1424,  72,  75, 0), (0x119c,  74,  76, 0),
    (0x0f6b,  74,  77, 0), (0x0d51,  75,  78, 0), (0x0bb6,  77,  79, 0), (0x0a40,  77,  48, 0),
    (0x5832,  80,  81, 1), (0x4d1c,  88,  82, 0), (0x438e,  89,  83, 0), (0x3bdd,  90,  84, 0),
    (0x34ee,  91,  85, 0), (0x2eae,  92,  86, 0), (0x299a,  93,  87, 0), (0x2516,  86,  71, 0),
    (0x5570,  88,  89, 1), (0x4ca9,  95,  90, 0), (0x44d9,  96,  91, 0), (0x3e22,  97,  92, 0),
    (0x3824,  99,  93, 0), (0x32b4,  99,  94, 0), (0x2e17,  93,  86, 0), (0x56a8,  95,  96, 1),
    (0x4f46, 101,  97, 0), (0x47e5, 102,  98, 0), (0x41cf, 103,  99, 0), (0x3c3d, 104, 100, 0),
    (0x375e,  99,  93, 0), (0x5231, 105, 102, 0), (0x4c0f, 106, 103, 0), (0x4639, 107, 104, 0),
    (0x415e, 103,  99, 0), (0x5627, 105, 106, 1), (0x50e7, 108, 107, 0), (0x4b85, 109, 103, 0),
    (0x5597, 110, 109, 0), (0x504f, 111, 107, 0), (0x5a10, 110, 111, 1), (0x5522, 112, 109, 0),
    (0x59eb, 112, 111, 1), (0x5a1d, 113, 113, 0),
];
const EVEN_ODDS: u8 = 113;

/// [`ESTIMATES`], packed so that each of the low two bytes updates a bin.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static STATES: [u32; 128] = {
    let mut states = [0; 128];
    let mut i = 0;
    while i < ESTIMATES.len() {
        let (qe, next_lps, next_mps, switch) = ESTIMATES[i];
        states[i] = qe << 16 | next_mps << 8 | switch << 7 | next_lps;
        i += 1;
    }
    states
};

// Indices of statistics bins, by their names in ITU-T T.81, tables F.4 and F.5.
const DC_X1: usize = 20;
const AC_X2_UP_TO_KX: usize = 189;
const AC_X2_ABOVE_KX: usize = 217;
const X_TO_M: usize = 14;

/// `SE` of coefficient `k`. `S0` and `SP` follow it.
const fn se(k: usize) -> usize {
    3 * (k - 1)
}

/// The registers of the decoder (ITU-T T.81, D.2).
#[derive(Clone, Copy)]
struct Coder {
    /// `A`
    size: u32,
    /// `C`, less than `size << spare_bits`.
    code: u64,
    spare_bits: u32,
    /// In the window.
    position: usize,
}

impl Coder {
    fn new(window: &mut Window<'_, '_>) -> Self {
        let mut position = 0;
        Self {
            size: 0x10000,
            code: window.take_u32(&mut position).into(),
            spare_bits: 16,
            position,
        }
    }

    /// `bin` has the MPS in its top bit, and an index into [`STATES`] below.
    #[inline(always)]
    fn decide(&mut self, window: &mut Window<'_, '_>, bin: &mut u8) -> bool {
        let entry = *wrapped(&STATES, (*bin & 0x7F).into());
        let qe = entry >> 16;
        let mps = *bin & 0x80;
        self.size -= qe;
        let lower = u64::from(self.size) << self.spare_bits;
        let is_upper = self.code >= lower;
        if !is_upper && self.size >= 0x8000 {
            return mps != 0;
        }
        let is_lps = is_upper != (self.size < qe);
        self.code -= select_unpredictable(is_upper, lower, 0);
        self.size = select_unpredictable(is_upper, qe, self.size);
        *bin = mps ^ select_unpredictable(is_lps, entry, entry >> 8) as u8;

        let shift = self.size.leading_zeros() - 16;
        self.size <<= shift;
        if self.spare_bits < shift {
            self.code = self.code << 32 | u64::from(window.take_u32(&mut self.position));
            self.spare_bits += 32;
        }
        self.spare_bits -= shift;
        (mps != 0) != is_lps
    }

    #[inline(always)]
    fn decide_evenly(&mut self, window: &mut Window<'_, '_>) -> bool {
        self.decide(window, &mut { EVEN_ODDS })
    }

    /// Moves `k` to the next coefficient that becomes nonzero. False at the end of the block, none if the data is invalid.
    #[inline(always)]
    fn skip_zeros(
        &mut self,
        window: &mut Window<'_, '_>,
        bins: &mut [u8; 256],
        k: &mut usize,
        last: usize,
    ) -> Option<bool> {
        if *k > last || self.decide(window, wrapped_mut(bins, se(*k))) {
            return Some(false);
        }
        while !self.decide(window, wrapped_mut(bins, se(*k) + 1)) {
            *k += 1;
            if *k > last {
                return None;
            }
        }
        Some(true)
    }

    /// Doubles `magnitude` for each 1 that the bins from `at` on decide. Returns the last index, or none if it gets too large.
    #[inline(always)]
    fn widen<const N: usize>(
        &mut self,
        window: &mut Window<'_, '_>,
        bins: &mut [u8; N],
        mut at: usize,
        magnitude: &mut i32,
    ) -> Option<usize> {
        while self.decide(window, wrapped_mut(bins, at)) {
            *magnitude <<= 1;
            if *magnitude == 0x8000 {
                return None;
            }
            at += 1;
        }
        Some(at)
    }

    /// Decodes the bits below `magnitude`, the top bit of the absolute value less one.
    #[inline(always)]
    fn value(
        &mut self,
        window: &mut Window<'_, '_>,
        bin: &mut u8,
        magnitude: i32,
        is_negative: bool,
    ) -> i32 {
        let (mut value, mut bit) = (magnitude, magnitude >> 1);
        while bit != 0 {
            value |= select_unpredictable(self.decide(window, bin), bit, 0);
            bit >>= 1;
        }
        select_unpredictable(is_negative, -value - 1, value + 1)
    }
}

#[derive(Clone, Copy, Default)]
struct DcState {
    value: i16,
    context: usize,
}

pub(crate) struct Arithmetic<'i, 'a> {
    scan: Scan,
    /// The DC and AC table numbers of each component of the scan.
    tables: [(usize, usize); MAX_COMPONENTS],
    conditioning: [u8; 2 * ARITHMETIC_TABLES],
    dc_bins: [[u8; 64]; ARITHMETIC_TABLES],
    ac_bins: [[u8; 256]; ARITHMETIC_TABLES],
    dc_states: [DcState; MAX_COMPONENTS],
    /// None from an error to the next restart.
    coder: Option<Coder>,
    window: &'i mut Window<'i, 'a>,
    /// For each block of a progressive file: bit `k` is set if AC coefficient `k`, in zigzag order, is not zero.
    nonzero: &'i mut [u64],
}

impl<'i, 'a> Arithmetic<'i, 'a> {
    pub(crate) fn new(
        window: &'i mut Window<'i, 'a>,
        tables: &Tables,
        scan: &Scan,
        nonzero: &'i mut [u64],
    ) -> Self {
        let mut numbers = [(0, 0); MAX_COMPONENTS];
        for (to, component) in numbers.iter_mut().zip(scan.components()) {
            *to = (component.dc_table.into(), component.ac_table.into());
        }
        Self {
            scan: *scan,
            tables: numbers,
            conditioning: tables.conditioning,
            dc_bins: [[0; 64]; ARITHMETIC_TABLES],
            ac_bins: [[0; 256]; ARITHMETIC_TABLES],
            dc_states: Default::default(),
            coder: Some(Coder::new(window)),
            window,
            nonzero,
        }
    }

    #[inline(always)]
    fn dc(&mut self, coder: &mut Coder, component: usize, table: usize) -> Option<i16> {
        let (window, bins) = (&mut *self.window, wrapped_mut(&mut self.dc_bins, table));
        let state = wrapped_mut(&mut self.dc_states, component);
        let context = state.context;
        if !coder.decide(window, wrapped_mut(bins, context)) {
            state.context = 0;
            return Some(state.value);
        }
        let is_negative = coder.decide(window, wrapped_mut(bins, context + 1));
        let mut at = context + 2 + usize::from(is_negative);
        let mut magnitude = i32::from(coder.decide(window, wrapped_mut(bins, at)));
        if magnitude != 0 {
            at = coder.widen(window, bins, DC_X1, &mut magnitude)?;
        }
        let bounds = *wrapped(&self.conditioning, table);
        state.context = if magnitude < 1 << (bounds & 15) >> 1 {
            0
        } else if magnitude > 1 << (bounds >> 4) >> 1 {
            12 + 4 * usize::from(is_negative)
        } else {
            4 + 4 * usize::from(is_negative)
        };
        let bin = wrapped_mut(bins, at + X_TO_M);
        let difference = coder.value(window, bin, magnitude, is_negative);
        state.value = state.value.wrapping_add(difference as i16);
        Some(state.value)
    }

    #[inline(always)]
    fn ac(
        &mut self,
        coder: &mut Coder,
        block: &mut Block,
        index: usize,
        table: usize,
        (mut k, last, shift): (usize, usize, u8),
    ) -> Option<()> {
        let (window, bins) = (&mut *self.window, wrapped_mut(&mut self.ac_bins, table));
        let mut unused = 0;
        let nonzero = self.nonzero.get_mut(index).unwrap_or(&mut unused);
        let kx = usize::from(*wrapped(&self.conditioning, ARITHMETIC_TABLES + table));
        while coder.skip_zeros(window, bins, &mut k, last)? {
            let is_negative = coder.decide_evenly(window);
            let mut at = se(k) + 2;
            let mut magnitude = i32::from(coder.decide(window, wrapped_mut(bins, at)));
            if magnitude != 0 && coder.decide(window, wrapped_mut(bins, at)) {
                magnitude = 2;
                let x2 = if k <= kx {
                    AC_X2_UP_TO_KX
                } else {
                    AC_X2_ABOVE_KX
                };
                at = coder.widen(window, bins, x2, &mut magnitude)?;
            }
            let bin = wrapped_mut(bins, at + X_TO_M);
            let value = (coder.value(window, bin, magnitude, is_negative) << shift) as i16;
            *block.at_mut(k) = value;
            *nonzero = *nonzero & !(1 << k) | u64::from(value != 0) << k;
            k += 1;
        }
        Some(())
    }

    #[inline(always)]
    fn ac_refine(
        &mut self,
        coder: &mut Coder,
        block: &mut Block,
        index: usize,
        table: usize,
    ) -> Option<()> {
        let (window, bins) = (&mut *self.window, wrapped_mut(&mut self.ac_bins, table));
        let (mut k, last) = (usize::from(self.scan.ss), usize::from(self.scan.se));
        let bit = 1i16 << self.scan.al;
        let nonzero = self.nonzero.get_mut(index)?;
        let known = *nonzero & u64::MAX >> (63 - last);
        let last_known = (known | 1).ilog2() as usize;
        // There is no EOB decision up to `last_known`. What is known is unpredictable, so nothing branches on it.
        let (mut ahead, mut ones) = (known >> k, 0);
        let triples = bins.as_chunks_mut().0.get_mut(k - 1..last_known);
        for [_, is_new, is_corrected] in triples.unwrap_or_default() {
            let bin = select_unpredictable(ahead & 1 != 0, is_corrected, is_new);
            let decision = u64::from(coder.decide(window, bin));
            ones |= decision << k;
            if decision > ahead & 1 {
                let is_negative = coder.decide_evenly(window);
                *block.at_mut(k) = select_unpredictable(is_negative, -bit, bit);
            }
            (k, ahead) = (k + 1, ahead >> 1);
        }
        *nonzero |= ones;
        let mut corrections = ones & known;
        while corrections != 0 {
            let coefficient = block.at_mut(corrections.trailing_zeros() as usize);
            *coefficient = coefficient.wrapping_add(if *coefficient < 0 { -bit } else { bit });
            corrections &= corrections - 1;
        }
        while coder.skip_zeros(window, bins, &mut k, last)? {
            let is_negative = coder.decide_evenly(window);
            *block.at_mut(k) = select_unpredictable(is_negative, -bit, bit);
            *nonzero |= 1 << k;
            k += 1;
        }
        Some(())
    }

    /// Returns false if the data is invalid.
    #[inline(always)]
    fn decode_mcus(
        &mut self,
        coder: &mut Coder,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<bool> {
        let kind = self.scan.kind;
        let band @ (.., shift) = match kind {
            ScanKind::Whole => (1, 63, 0),
            _ => (self.scan.ss.into(), self.scan.se.into(), self.scan.al),
        };
        for mcu in mcus {
            for slot in slots {
                let (block, index) = (slot.of(blocks, mcu)?, slot.index(mcu));
                prefetch_after(block, slot.step_right);
                let (dc, ac) = slot.pick(&self.tables);
                if !matches!(kind, ScanKind::AcFirst) {
                    let Some(value) = self.dc(coder, slot.component, dc) else {
                        return Ok(false);
                    };
                    *block.dc_mut() = value << shift;
                }
                if !matches!(kind, ScanKind::DcFirst)
                    && self.ac(coder, block, index, ac, band).is_none()
                {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    /// Like [`Self::decode_mcus`]. Refinement is up to 15 % faster in a loop of its own.
    #[inline(always)]
    fn refine_mcus(
        &mut self,
        coder: &mut Coder,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<bool> {
        for mcu in mcus {
            for slot in slots {
                let (block, index) = (slot.of(blocks, mcu)?, slot.index(mcu));
                prefetch_after(block, slot.step_right);
                let (_, ac) = slot.pick(&self.tables);
                if self.scan.ss == 0 {
                    let bit = coder.decide_evenly(self.window);
                    *block.dc_mut() |= i16::from(bit) << self.scan.al;
                } else if self.ac_refine(coder, block, index, ac).is_none() {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}

impl EntropyDecoder for Arithmetic<'_, '_> {
    fn decode(&mut self, blocks: &mut [Block], slots: &[Slot], mcus: Range<usize>) -> Result<bool> {
        let Some(mut coder) = self.coder.take() else {
            return Ok(true);
        };
        let is_valid = match self.scan.kind {
            ScanKind::DcRefine | ScanKind::AcRefine => {
                self.refine_mcus(&mut coder, blocks, slots, mcus)
            }
            _ => self.decode_mcus(&mut coder, blocks, slots, mcus),
        }?;
        self.coder = is_valid.then_some(coder);
        Ok(true)
    }

    fn restart(&mut self, number: u8) {
        self.window.skip_restart_marker(number);
        for &(dc, ac) in self.tables.iter().take(self.scan.components().len()) {
            if matches!(self.scan.kind, ScanKind::Whole | ScanKind::DcFirst) {
                *wrapped_mut(&mut self.dc_bins, dc) = [0; 64];
            }
            if !matches!(self.scan.kind, ScanKind::DcFirst | ScanKind::DcRefine) {
                *wrapped_mut(&mut self.ac_bins, ac) = [0; 256];
            }
        }
        self.dc_states = Default::default();
        self.coder = Some(Coder::new(self.window));
    }

    fn has_data(&self) -> bool {
        self.coder.is_some()
    }
}
