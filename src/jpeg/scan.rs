//! What all scans have in common: the order of their blocks, and restarts.

use crate::block::Block;
use crate::header::{Frame, Grid, Process, Scan};
use crate::{Error, MAX_COMPONENTS, Result, wrapped, wrapped_mut};
use core::ops::Range;

const MAX_BLOCKS_IN_MCU: usize = 10;
/// In a progressive scan (ITU-T T.81, table B.3).
const MAX_AL: u8 = 13;

/// Where the blocks of a component are in a buffer that all components share.
#[derive(Clone, Copy, Default)]
pub(crate) struct Region {
    pub(crate) start: usize,
    pub(crate) stride: usize,
}

/// The components back to back.
pub(crate) struct Regions {
    by_component: [Region; MAX_COMPONENTS],
    pub(crate) len: usize,
}

impl Regions {
    /// `sizes` has the index in the frame, the stride and the number of rows of each component.
    pub(crate) fn new(sizes: impl Iterator<Item = [usize; 3]>) -> Self {
        let (mut by_component, mut len) = ([Region::default(); MAX_COMPONENTS], 0);
        for [index, stride, rows] in sizes {
            *wrapped_mut(&mut by_component, index) = Region { start: len, stride };
            len += rows * stride;
        }
        Self { by_component, len }
    }

    pub(crate) fn of(&self, index: usize) -> Region {
        *wrapped(&self.by_component, index)
    }
}

/// A component's share of an MCU.
#[derive(Clone, Copy, Default)]
pub(crate) struct Part {
    /// In `Frame::components()`.
    pub(crate) index: usize,
    pub(crate) h: usize,
    pub(crate) v: usize,
}

fn has_valid_parameters(frame: &Frame, scan: &Scan) -> bool {
    let Scan { ss, se, ah, al, .. } = *scan;
    match frame.process {
        Process::Sequential => true,
        Process::Progressive => {
            let is_band = match ss {
                0 => se == 0,
                _ => (ss..64).contains(&se) && scan.components().len() == 1,
            };
            is_band && (ah == 0 || ah - 1 == al) && al <= MAX_AL
        }
        Process::Lossless => matches!((ss, se, ah), (1..=7, 0, 0)) && al < frame.precision,
    }
}

/// Only valid scans have one.
pub(crate) struct Layout {
    pub(crate) mcus: Grid,
    /// How many rows of `mcus` make a strip: one row of the frame's interleaved MCUs.
    pub(crate) rows_in_strip: usize,
    pub(crate) blocks_in_mcu: usize,
    parts: [Part; MAX_COMPONENTS],
    count: usize,
}

impl Layout {
    pub(crate) fn new(frame: &Frame, scan: &Scan) -> Result<Self> {
        let mut parts = [Part::default(); MAX_COMPONENTS];
        let (mut mcus, mut rows_in_strip) = (frame.size_in_mcus(), 1);
        for (part, in_scan) in parts.iter_mut().zip(scan.components()) {
            let index = usize::from(in_scan.index);
            let component = *frame.components().get(index).ok_or(Error::Internal)?;
            let (mut h, mut v) = (component.h, component.v);
            if let [_] = scan.components() {
                mcus = frame.size_in_blocks(component);
                (rows_in_strip, h, v) = (v, 1, 1);
            }
            *part = Part { index, h, v };
        }
        let blocks_in_mcu = parts.iter().map(|part| part.h * part.v).sum();
        if blocks_in_mcu > MAX_BLOCKS_IN_MCU || !has_valid_parameters(frame, scan) {
            return Err(Error::InvalidScan);
        }
        Ok(Self {
            mcus,
            rows_in_strip,
            blocks_in_mcu,
            parts,
            count: scan.components().len(),
        })
    }

    pub(crate) fn parts(&self) -> &[Part] {
        self.parts.get(..self.count).unwrap_or_default()
    }

    pub(crate) fn slots(&self, regions: &Regions) -> Slots {
        let mut slots = [Slot::default(); MAX_BLOCKS_IN_MCU];
        let mut free = slots.iter_mut();
        for (component, part) in self.parts().iter().enumerate() {
            let region = regions.of(part.index);
            for y in 0..part.v {
                for (x, slot) in (0..part.h).zip(&mut free) {
                    *slot = Slot {
                        start: region.start + y * region.stride + x,
                        step_right: part.h,
                        step_down: part.v * region.stride,
                        component,
                    };
                }
            }
        }
        Slots(slots, self.blocks_in_mcu)
    }
}

pub(crate) struct Slots([Slot; MAX_BLOCKS_IN_MCU], usize);

impl Slots {
    pub(crate) fn as_slice(&self) -> &[Slot] {
        self.0.get(..self.1).unwrap_or_default()
    }

    pub(crate) fn move_down(&mut self) {
        for slot in self.0.iter_mut().take(self.1) {
            slot.start += slot.step_down;
        }
    }
}

/// One block of an MCU.
#[derive(Clone, Copy, Default)]
pub(crate) struct Slot {
    /// Its index for the first MCU of the row.
    pub(crate) start: usize,
    /// From one MCU to the next.
    pub(crate) step_right: usize,
    /// From one row of MCUs to the next.
    step_down: usize,
    /// In `Scan::components()`.
    pub(crate) component: usize,
}

impl Slot {
    #[inline(always)]
    pub(crate) fn index(&self, mcu: usize) -> usize {
        self.start + mcu * self.step_right
    }

    #[inline(always)]
    pub(crate) fn of<'a, T>(&self, blocks: &'a mut [T], mcu: usize) -> Result<&'a mut T> {
        blocks.get_mut(self.index(mcu)).ok_or(Error::Internal)
    }

    /// `from` is indexed by the components of the scan.
    #[inline(always)]
    pub(crate) fn pick<T: Copy>(&self, from: &[T; MAX_COMPONENTS]) -> T {
        *wrapped(from, self.component)
    }
}

/// Used as `dyn`, so that the loops over rows exist once. They only call it once for each row or batch.
pub(crate) trait EntropyDecoder {
    /// `mcus` are within one restart interval. Returns false if smoothing has to take all but the first as missing.
    fn decode(&mut self, blocks: &mut [Block], slots: &[Slot], mcus: Range<usize>) -> Result<bool>;
    fn restart(&mut self, number: u8);
    /// If not, all blocks up to the next restart stay as they are.
    fn has_data(&self) -> bool;
    /// Whether the rest of the scan leaves all blocks as they are.
    fn is_over(&self) -> bool {
        false
    }

    /// Returns whether any of `mcus` began with data left. As in jdcoefct.c, that is judged before its restart.
    fn decode_with_restarts(
        &mut self,
        restarts: &mut Restarts,
        blocks: &mut [Block],
        slots: &[Slot],
        mut mcus: Range<usize>,
    ) -> Result<bool> {
        let mut had_data = false;
        while !mcus.is_empty() && !self.is_over() {
            had_data |= self.has_data();
            if let Some(number) = restarts.take_due() {
                self.restart(number);
            }
            let end = mcus.start + restarts.advance(mcus.len());
            had_data |= self.decode(blocks, slots, mcus.start..end)?;
            mcus.start = end;
        }
        Ok(had_data)
    }
}

pub(crate) struct Restarts {
    interval: usize,
    left: usize,
    next_number: u8,
}

impl Restarts {
    /// 0 means no restarts.
    pub(crate) fn new(interval: usize) -> Self {
        let interval = if interval == 0 { usize::MAX } else { interval };
        Self {
            interval,
            left: interval,
            next_number: 0,
        }
    }

    /// The number of the marker that is due, if one is.
    pub(crate) fn take_due(&mut self) -> Option<u8> {
        if self.left != 0 {
            return None;
        }
        let number = self.next_number;
        (self.left, self.next_number) = (self.interval, (number + 1) % 8);
        Some(number)
    }

    /// Counts off `count` MCUs, unless a marker comes before the last.
    pub(crate) fn skip(&mut self, count: usize) -> bool {
        count <= self.left && self.advance(count) == count
    }

    /// Counts off up to `count` MCUs, as far as the next marker.
    pub(crate) fn advance(&mut self, count: usize) -> usize {
        let count = count.min(self.left);
        self.left -= count;
        count
    }
}
