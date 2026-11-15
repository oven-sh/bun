//! Scans with arithmetic coding (jdarith.c).

use crate::bit_reader::Window;
use crate::block::{Block, Zigzag};
use crate::header::{Frame, MAX_COMPONENTS, Process, Scan, Tables};
use crate::input::Input;
use crate::scan::{EntropyDecoder, Slot};
use crate::{Result, wrapped, wrapped_mut};
use core::hint::select_unpredictable;
use core::ops::Range;

/// `Qe`, `Next_Index_LPS`, `Next_Index_MPS` and `Switch_MPS` (ITU-T T.81, D.3). The last state stays at even odds.
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

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static STATES: [u32; 128] = {
    let mut states = [0; 128];
    let mut i = 0;
    while i < ESTIMATES.len() {
        let (qe, after_less, after_more, switch) = ESTIMATES[i];
        states[i] = qe << 16 | after_more << 8 | switch << 7 | after_less;
        i += 1;
    }
    states
};

/// An encoder leaves out the zeros that its data ends with. So many bytes of them are taken for granted between restarts.
const FREE_ZEROS: usize = 8;
/// A restart marker that is missing counts as so many zeros.
const MARKER_LEN: usize = 2;

/// How many more all the scans of `frame` get. Those of an image that repeats a block can end with many.
pub(crate) fn spare_zeros(frame: &Frame) -> usize {
    2 * frame.block_count() + 4096
}

#[derive(Clone, Copy)]
struct Interval {
    size: u32,
    /// Less than `size << spare_bits`.
    code: u64,
    spare_bits: u32,
    /// In the window.
    position: usize,
}

impl Interval {
    fn new(window: &mut Window<'_, '_>) -> Self {
        let mut position = 0;
        Self {
            size: 0x10000,
            code: window.word(&mut position).into(),
            spare_bits: 16,
            position,
        }
    }

    /// `state` has the more probable symbol in its highest bit, and an index into [`STATES`] in the others.
    #[inline(always)]
    fn decide(&mut self, window: &mut Window<'_, '_>, state: &mut u8) -> bool {
        let entry = *wrapped(&STATES, (*state).into());
        let qe = entry >> 16;
        let more_probable = *state & 0x80;
        self.size -= qe;
        let lower = u64::from(self.size) << self.spare_bits;
        let is_upper = self.code >= lower;
        if !is_upper && self.size >= 0x8000 {
            return more_probable != 0;
        }
        let is_less_probable = is_upper != (self.size < qe);
        self.code -= select_unpredictable(is_upper, lower, 0);
        self.size = select_unpredictable(is_upper, qe, self.size);
        *state = more_probable ^ select_unpredictable(is_less_probable, entry, entry >> 8) as u8;

        let shift = self.size.leading_zeros() - 16;
        self.size <<= shift;
        if self.spare_bits < shift {
            self.code = self.code << 32 | u64::from(window.word(&mut self.position));
            self.spare_bits += 32;
        }
        self.spare_bits -= shift;
        (more_probable != 0) != is_less_probable
    }

    /// Doubles `magnitude` for as long as the states from `at` on say so. Returns where they stop.
    #[inline(always)]
    fn widen<const N: usize>(
        &mut self,
        window: &mut Window<'_, '_>,
        states: &mut [u8; N],
        mut at: usize,
        magnitude: &mut i32,
    ) -> Option<usize> {
        while self.decide(window, wrapped_mut(states, at)) {
            *magnitude <<= 1;
            if *magnitude == 0x8000 {
                return None;
            }
            at += 1;
        }
        Some(at)
    }

    /// The number whose magnitude, less one, has the highest bit of `magnitude`.
    #[inline(always)]
    fn value(
        &mut self,
        window: &mut Window<'_, '_>,
        state: &mut u8,
        magnitude: i32,
        is_negative: bool,
    ) -> i32 {
        let (mut value, mut bit) = (magnitude, magnitude >> 1);
        while bit != 0 {
            value |= select_unpredictable(self.decide(window, state), bit, 0);
            bit >>= 1;
        }
        select_unpredictable(is_negative, -value - 1, value + 1)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pass {
    Sequential,
    DcFirst,
    DcRefine,
    AcFirst,
    AcRefine,
}

#[derive(Clone, Copy, Default)]
struct Predictor {
    value: i16,
    context: usize,
}

pub(crate) struct Arithmetic<'i, 'a> {
    scan: Scan,
    pass: Pass,
    conditioning: [u8; 32],
    dc_states: [[u8; 64]; 16],
    ac_states: [[u8; 256]; 16],
    predictors: [Predictor; MAX_COMPONENTS],
    /// None from an error to the next restart.
    interval: Option<Interval>,
    window: Window<'i, 'a>,
    /// For each block of a progressive file: bit `k` is set if AC coefficient `k`, in zigzag order, is not zero.
    nonzero: &'i mut [u64],
    spare_zeros: &'i mut usize,
}

impl<'i, 'a> Arithmetic<'i, 'a> {
    pub(crate) fn new(
        input: &'i mut Input<'a>,
        tables: &Tables,
        process: Process,
        scan: &Scan,
        nonzero: &'i mut [u64],
        spare_zeros: &'i mut usize,
    ) -> Self {
        let mut window = Window::new(input);
        Self {
            scan: *scan,
            pass: match (process, scan.first, scan.previous_shift) {
                (Process::Progressive, 0, 0) => Pass::DcFirst,
                (Process::Progressive, 0, _) => Pass::DcRefine,
                (Process::Progressive, _, 0) => Pass::AcFirst,
                (Process::Progressive, ..) => Pass::AcRefine,
                _ => Pass::Sequential,
            },
            conditioning: tables.conditioning,
            dc_states: [[0; 64]; 16],
            ac_states: [[0; 256]; 16],
            predictors: Default::default(),
            interval: Some(Interval::new(&mut window)),
            window,
            nonzero,
            spare_zeros,
        }
    }

    #[inline(always)]
    fn dc(&mut self, interval: &mut Interval, component: usize, table: usize) -> Option<i16> {
        let (window, states) = (&mut self.window, wrapped_mut(&mut self.dc_states, table));
        let predictor = wrapped_mut(&mut self.predictors, component);
        let context = predictor.context;
        if !interval.decide(window, wrapped_mut(states, context)) {
            predictor.context = 0;
            return Some(predictor.value);
        }
        let is_negative = interval.decide(window, wrapped_mut(states, context + 1));
        let mut at = context + 2 + usize::from(is_negative);
        let mut magnitude = i32::from(interval.decide(window, wrapped_mut(states, at)));
        if magnitude != 0 {
            at = interval.widen(window, states, 20, &mut magnitude)?;
        }
        let bounds = *wrapped(&self.conditioning, table);
        predictor.context = if magnitude < 1 << (bounds & 15) >> 1 {
            0
        } else if magnitude > 1 << (bounds >> 4) >> 1 {
            12 + 4 * usize::from(is_negative)
        } else {
            4 + 4 * usize::from(is_negative)
        };
        let state = wrapped_mut(states, at + 14);
        let difference = interval.value(window, state, magnitude, is_negative);
        predictor.value = predictor.value.wrapping_add(difference as i16);
        Some(predictor.value)
    }

    #[inline(always)]
    fn ac_first(
        &mut self,
        interval: &mut Interval,
        (block, at): (&mut Block, usize),
        table: usize,
        (mut k, last, shift): (usize, usize, u8),
    ) -> Option<()> {
        let (window, states) = (&mut self.window, wrapped_mut(&mut self.ac_states, table));
        let mut unused = 0;
        let nonzero = self.nonzero.get_mut(at).unwrap_or(&mut unused);
        let last_low = usize::from(*wrapped(&self.conditioning, 16 + table));
        while k <= last && !interval.decide(window, wrapped_mut(states, 3 * k - 3)) {
            while !interval.decide(window, wrapped_mut(states, 3 * k - 2)) {
                k += 1;
                if k > last {
                    return None;
                }
            }
            let is_negative = interval.decide(window, &mut { EVEN_ODDS });
            let mut at = 3 * k - 1;
            let mut magnitude = i32::from(interval.decide(window, wrapped_mut(states, at)));
            if magnitude != 0 && interval.decide(window, wrapped_mut(states, at)) {
                magnitude = 2;
                let first = if k <= last_low { 189 } else { 217 };
                at = interval.widen(window, states, first, &mut magnitude)?;
            }
            let state = wrapped_mut(states, at + 14);
            let value = (interval.value(window, state, magnitude, is_negative) << shift) as i16;
            *block.at_mut(k) = value;
            *nonzero = *nonzero & !(1 << k) | u64::from(value != 0) << k;
            k += 1;
        }
        Some(())
    }

    #[inline(always)]
    fn ac_refine(
        &mut self,
        interval: &mut Interval,
        (block, at): (&mut Block, usize),
        table: usize,
    ) -> Option<()> {
        let (window, states) = (&mut self.window, wrapped_mut(&mut self.ac_states, table));
        let (mut k, last) = (usize::from(self.scan.first), usize::from(self.scan.last));
        let bit = 1i16 << self.scan.shift;
        let nonzero = self.nonzero.get_mut(at)?;
        let known = *nonzero & u64::MAX >> (63 - last);
        let last_known = (known | 1).ilog2() as usize;
        while k <= last
            && (k <= last_known || !interval.decide(window, wrapped_mut(states, 3 * k - 3)))
        {
            loop {
                if known >> k & 1 != 0 {
                    if interval.decide(window, wrapped_mut(states, 3 * k - 1)) {
                        let coefficient = block.at_mut(k);
                        *coefficient =
                            coefficient.wrapping_add(if *coefficient < 0 { -bit } else { bit });
                    }
                    break;
                }
                if interval.decide(window, wrapped_mut(states, 3 * k - 2)) {
                    let is_negative = interval.decide(window, &mut { EVEN_ODDS });
                    *block.at_mut(k) = select_unpredictable(is_negative, -bit, bit);
                    *nonzero |= 1 << k;
                    break;
                }
                k += 1;
                if k > last {
                    return None;
                }
            }
            k += 1;
        }
        Some(())
    }

    /// Whether the data ended so long ago that AC coefficients could only be noise.
    fn is_adrift(&mut self) -> bool {
        let extra = self.window.take_zeros_beyond(FREE_ZEROS);
        let left = self.spare_zeros.checked_sub(extra);
        *self.spare_zeros = left.unwrap_or(0);
        left.is_none()
    }
}

impl EntropyDecoder for Arithmetic<'_, '_> {
    fn decode(
        &mut self,
        blocks: &mut [Block],
        slots: &[Slot],
        mcus: Range<usize>,
    ) -> Result<usize> {
        let count = mcus.len();
        let Some(mut interval) = self.interval.take() else {
            return Ok(count);
        };
        let mut tables = [(0, 0); MAX_COMPONENTS];
        for (to, component) in tables.iter_mut().zip(self.scan.components()) {
            *to = (component.dc_table.into(), component.ac_table.into());
        }
        let (pass, shift) = (self.pass, self.scan.shift);
        let band = match pass {
            Pass::Sequential => (1, 63, 0),
            _ => (self.scan.first.into(), self.scan.last.into(), shift),
        };
        for mcu in mcus {
            if !matches!(pass, Pass::DcFirst | Pass::DcRefine) && self.is_adrift() {
                return Ok(count);
            }
            for slot in slots {
                let (block, at) = (slot.of(blocks, mcu)?, slot.index(mcu));
                let (dc, ac) = slot.pick(&tables);
                if matches!(pass, Pass::Sequential | Pass::DcFirst) {
                    let Some(value) = self.dc(&mut interval, slot.component, dc) else {
                        return Ok(count);
                    };
                    block.0[0] = value << band.2;
                }
                let decoded = match pass {
                    Pass::DcFirst => Some(()),
                    Pass::DcRefine => {
                        let bit = interval.decide(&mut self.window, &mut { EVEN_ODDS });
                        block.0[0] |= i16::from(bit) << shift;
                        Some(())
                    }
                    Pass::Sequential | Pass::AcFirst => {
                        self.ac_first(&mut interval, (block, at), ac, band)
                    }
                    Pass::AcRefine => self.ac_refine(&mut interval, (block, at), ac),
                };
                if decoded.is_none() {
                    return Ok(count);
                }
            }
        }
        self.interval = Some(interval);
        Ok(count)
    }

    fn restart(&mut self, number: u8) {
        self.interval = None;
        if !self.window.skip_restart_marker(number) {
            let Some(left) = self.spare_zeros.checked_sub(MARKER_LEN) else {
                return;
            };
            *self.spare_zeros = left;
        }
        for component in self.scan.components() {
            *wrapped_mut(&mut self.dc_states, component.dc_table.into()) = [0; 64];
            *wrapped_mut(&mut self.ac_states, component.ac_table.into()) = [0; 256];
        }
        self.predictors = Default::default();
        self.interval = Some(Interval::new(&mut self.window));
    }

    fn has_data(&self) -> bool {
        true
    }

    fn is_over(&self) -> bool {
        self.interval.is_none() && *self.spare_zeros < MARKER_LEN && self.window.is_last()
    }
}
