//! What all scans have in common: the order of their blocks, and restarts.

use crate::block::Block;
use crate::header::{Frame, Grid, MAX_COMPONENTS, Process, Scan};
use crate::{Error, Result, wrapped};
use core::ops::Range;

const MAX_BLOCKS_IN_MCU: usize = 10;

/// Where the blocks of a component are among those of all.
#[derive(Clone, Copy, Default)]
pub(crate) struct Region {
    pub(crate) start: usize,
    /// How far it is from one row to the next.
    pub(crate) stride: usize,
}

/// What a component has in each MCU.
#[derive(Clone, Copy, Default)]
pub(crate) struct Part {
    /// In `Frame::components()`.
    pub(crate) index: usize,
    pub(crate) h: usize,
    pub(crate) v: usize,
}

pub(crate) struct Layout {
    pub(crate) mcus: Grid,
    /// How many rows of them a row of MCUs of the frame has.
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
            let (mut h, mut v) = (component.h.into(), component.v.into());
            if let [_] = scan.components() {
                mcus = frame.size_in_blocks(component);
                (rows_in_strip, h, v) = (v, 1, 1);
            }
            *part = Part { index, h, v };
        }
        let blocks_in_mcu = parts.iter().map(|part| part.h * part.v).sum();
        if blocks_in_mcu > MAX_BLOCKS_IN_MCU {
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

    /// `regions` go by the index of the component in the frame.
    pub(crate) fn slots(&self, regions: &[Region; MAX_COMPONENTS]) -> Slots {
        let mut slots = [Slot::default(); MAX_BLOCKS_IN_MCU];
        let mut free = slots.iter_mut();
        for (component, part) in self.parts().iter().enumerate() {
            let region = wrapped(regions, part.index);
            for y in 0..part.v {
                for (x, slot) in (0..part.h).zip(&mut free) {
                    *slot = Slot {
                        start: region.start + y * region.stride + x,
                        step: part.h,
                        step_down: part.v * region.stride,
                        component,
                    };
                }
            }
        }
        Slots(slots, self.blocks_in_mcu)
    }
}

/// How much more the scans of a frame can cover, by weight.
pub(crate) struct Allowance(usize);

impl Allowance {
    /// The usual progressions take 300 for each block. Any other fits if the image is small.
    pub(crate) fn new(frame: &Frame) -> Self {
        Self(512 * frame.block_count() + (1 << 26))
    }

    pub(crate) fn spend(&mut self, frame: &Frame, scan: &Scan, layout: &Layout) -> Result<()> {
        let weight = match (frame.process, frame.arithmetic) {
            (Process::Progressive, false) => 8,
            (Process::Progressive, true) => match (scan.first, scan.previous_shift) {
                (0, 0) => 64,
                (0, _) => 24,
                _ => 9 + usize::from(scan.last - scan.first),
            },
            _ => 256,
        };
        let blocks = layout.mcus.wide * layout.mcus.high * layout.blocks_in_mcu;
        let left = self.0.checked_sub(4096 + weight * blocks);
        self.0 = left.ok_or(Error::InvalidScan)?;
        Ok(())
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

/// One of the blocks of an MCU.
#[derive(Clone, Copy, Default)]
pub(crate) struct Slot {
    /// Where the block of the first MCU in the row is.
    pub(crate) start: usize,
    /// How far it is from there to the block of the next.
    pub(crate) step: usize,
    /// And to that of the one below.
    step_down: usize,
    /// In `Scan::components()`.
    pub(crate) component: usize,
}

impl Slot {
    #[inline(always)]
    pub(crate) fn index(&self, mcu: usize) -> usize {
        self.start + mcu * self.step
    }

    #[inline(always)]
    pub(crate) fn of<'a, T>(&self, blocks: &'a mut [T], mcu: usize) -> Result<&'a mut T> {
        blocks.get_mut(self.index(mcu)).ok_or(Error::Internal)
    }

    /// Of an array that has something for each component of the scan.
    #[inline(always)]
    pub(crate) fn pick<T: Copy>(&self, from: &[T; MAX_COMPONENTS]) -> T {
        *wrapped(from, self.component)
    }
}

pub(crate) trait EntropyDecoder {
    /// There is no restart marker between `mcus`. Returns for how many of them there was data left to begin with.
    fn decode(&mut self, blocks: &mut [Block], slots: &[Slot], mcus: Range<usize>)
    -> Result<usize>;
    fn restart(&mut self, number: u8);
    fn has_data(&self) -> bool;
    /// Whether the rest of the scan leaves all blocks as they are.
    fn is_over(&self) -> bool;
}

pub(crate) struct Restarts {
    interval: usize,
    left: usize,
    next_number: u8,
}

impl Restarts {
    /// 0 is for no restarts.
    pub(crate) fn new(interval: usize) -> Self {
        let interval = if interval == 0 { usize::MAX } else { interval };
        Self {
            interval,
            left: interval,
            next_number: 0,
        }
    }

    /// The number of the marker that is due, if one is.
    pub(crate) fn due(&mut self) -> Option<u8> {
        if self.left != 0 {
            return None;
        }
        let number = self.next_number;
        (self.left, self.next_number) = (self.interval, (number + 1) % 8);
        Some(number)
    }

    /// How many of `count` come before the next marker.
    pub(crate) fn advance(&mut self, count: usize) -> usize {
        let count = count.min(self.left);
        self.left -= count;
        count
    }

    /// Returns whether there was data left when one of `mcus` began. As in jdcoefct.c, that is before its restart.
    pub(crate) fn decode(
        &mut self,
        decoder: &mut dyn EntropyDecoder,
        blocks: &mut [Block],
        slots: &[Slot],
        mut mcus: Range<usize>,
    ) -> Result<bool> {
        let mut had_data = false;
        while !mcus.is_empty() && !decoder.is_over() {
            had_data |= decoder.has_data();
            if let Some(number) = self.due() {
                decoder.restart(number);
            }
            let end = mcus.start + self.advance(mcus.len());
            had_data |= decoder.decode(blocks, slots, mcus.start..end)? > 1;
            mcus.start = end;
        }
        Ok(had_data)
    }
}
