//! What all scans have in common: the order of their blocks, and restarts.

use crate::block::Block;
use crate::header::{Frame, Grid, Process, Scan, ScanKind};
use crate::{Error, MAX_COMPONENTS, Result, wrapped, wrapped_mut};
use core::ops::Range;

const MAX_BLOCKS_IN_MCU: usize = 10;

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
            is_band && (ah == 0 || ah - 1 == al) && al <= 13
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

/// How many more steps the scans of a file may take. A step is what one arithmetic decision takes.
pub(crate) struct Allowance(usize);

impl Allowance {
    /// Enough for each of 14 bits of 64 coefficients to have a Huffman-coded scan of its own.
    const SCANS: usize = 1024;
    /// Enough for the same with arithmetic coding, if the image is small.
    const PER_FILE: usize = 1 << 29;
    /// What each bit of an arithmetic-coded file adds, and each bit that is read past its data costs.
    const PER_BIT: usize = 4;
    /// To start a scan, a row of MCUs and an arithmetic-coded restart interval.
    const SCAN_COST: usize = 1 << 15;
    const ROW_COST: usize = 12;
    pub(crate) const INTERVAL_COST: usize = 48;
    /// To skip a block of a progressive scan, as Huffman coding can, and to load it.
    const SKIP_COST: usize = 1;
    const LOAD_COST: usize = 14;
    /// The least that a block costs in [`ScanKind::Whole`].
    const WHOLE_BLOCK_COST: usize = Self::SCANS * Self::SKIP_COST / 2;
    /// [`Self::WHOLE_BLOCK_COST`] covers a restart interval until it has read this many bits past its data.
    const FREE_OVERRUN: usize = 256;

    /// It goes by the size in whole MCUs, whatever the components and their sampling.
    pub(crate) fn new(frame: &Frame, file_len: usize) -> Self {
        let mcus = frame.size_in_mcus();
        let (wide, high) = (mcus.wide * frame.max_h(), mcus.high * frame.max_v());
        let scan = MAX_COMPONENTS * (Self::ROW_COST + Self::SKIP_COST * wide) * high;
        let bits = if frame.is_arithmetic { 8 * file_len } else { 0 };
        Self(Self::SCANS * scan + Self::PER_BIT * bits + Self::PER_FILE)
    }

    /// Pays for the part of a scan that does not depend on its data.
    pub(crate) fn spend_on(&mut self, frame: &Frame, scan: &Scan, layout: &Layout) -> Result<()> {
        let block_cost = match (scan.kind, frame.is_arithmetic) {
            (ScanKind::Whole, _) => Self::WHOLE_BLOCK_COST,
            (_, false) => Self::SKIP_COST,
            (_, true) => Self::LOAD_COST,
        };
        let row_cost = Self::ROW_COST + block_cost * layout.mcus.wide * layout.blocks_in_mcu;
        self.spend(Self::SCAN_COST + row_cost * layout.mcus.high)
    }

    /// Pays for arithmetic-coded `blocks` that took `steps`, and `overrun` of the bits past the data.
    pub(crate) fn spend_on_decisions(
        &mut self,
        kind: ScanKind,
        blocks: usize,
        steps: usize,
        overrun: Range<usize>,
    ) -> Result<()> {
        let steps = steps + Self::PER_BIT * overrun.len();
        match kind {
            ScanKind::Whole if overrun.end < Self::FREE_OVERRUN => Ok(()),
            ScanKind::Whole => self.spend(steps.saturating_sub(Self::WHOLE_BLOCK_COST * blocks)),
            _ => self.spend(steps),
        }
    }

    pub(crate) fn spend(&mut self, steps: usize) -> Result<()> {
        self.0 = self.0.saturating_sub(steps);
        if self.is_spent() {
            return Err(Error::AllowanceSpent);
        }
        Ok(())
    }

    pub(crate) fn is_spent(&self) -> bool {
        self.0 == 0
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
    /// `mcus` are within one restart interval. Returns whether any but the first began while [`Self::has_data`].
    fn decode(&mut self, blocks: &mut [Block], slots: &[Slot], mcus: Range<usize>) -> Result<bool>;
    fn restart(&mut self, number: u8);
    /// Only smoothing asks, and only Huffman coding can tell.
    fn has_data(&self) -> bool {
        true
    }
    /// Whether the rest of the scan leaves all blocks as they are.
    fn is_over(&self) -> bool;

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

    /// Counts off up to `count` MCUs, as far as the next marker.
    pub(crate) fn advance(&mut self, count: usize) -> usize {
        let count = count.min(self.left);
        self.left -= count;
        count
    }
}
