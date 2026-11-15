use crate::arithmetic::{self, Arithmetic};
use crate::block::{self, Block};
use crate::header::{
    ColorSpace, Frame, Grid, Header, MAX_COMPONENTS, Process, Scan, Segments, Tables,
};
use crate::output::Output;
use crate::progressive::Progressive;
use crate::scan::{Allowance, EntropyDecoder, Layout, Region, Restarts};
use crate::sequential::{BATCH_ROOM, Sequential, StepTables};
use crate::smoothing::{self, Progress};
use crate::{Error, Result, filled, lossless, wrapped, wrapped_mut};

/// So many blocks wait for their transform at most. They fit in the L1 cache.
const BATCH_LEN: usize = 96;
const _: () = assert!(BATCH_LEN < BATCH_ROOM);

pub struct Image {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub icc_profile: Option<Vec<u8>>,
}

pub struct Decoder<'a> {
    segments: Segments<'a>,
    frame: Frame,
    first_scan: Scan,
    allowance: Allowance,
    spare_zeros: usize,
}

/// Of a block in the image.
#[derive(Clone, Copy)]
struct Place {
    component: usize,
    x: usize,
    y: usize,
}

struct Coefficients {
    blocks: Vec<Block>,
    regions: [Region; MAX_COMPONENTS],
}

impl Coefficients {
    fn blocks_from_mut(&mut self, Place { component, x, y }: Place) -> &mut [Block] {
        let Region { start, stride } = *wrapped(&self.regions, component);
        let blocks = self.blocks.get_mut(start + y * stride + x..);
        blocks.unwrap_or_default()
    }
}

/// Where the blocks of a sequential scan go.
enum Target<'a> {
    Output(&'a mut Output, &'a QuantTables),
    Coefficients(&'a mut Coefficients),
}

impl Target<'_> {
    fn put(&mut self, blocks: &[Block], place: Place) -> Result<()> {
        match self {
            Self::Output(output, quant) => {
                let Place { component, x, y } = place;
                let plane = output.planes.get_mut(component).ok_or(Error::Internal)?;
                plane.put(blocks, wrapped(&quant.tables, component), x, y);
            }
            // What another scan of the same component leaves out stays as it was.
            Self::Coefficients(all) => {
                for (old, new) in all.blocks_from_mut(place).iter_mut().zip(blocks) {
                    for (old, &new) in old.0.iter_mut().zip(&new.0) {
                        *old = if new != 0 { new } else { *old };
                    }
                    old.0[0] = new.0[0];
                }
            }
        }
        Ok(())
    }
}

/// A component keeps the table that is there when its first scan starts.
struct QuantTables {
    tables: [Block; MAX_COMPONENTS],
    is_set: [bool; MAX_COMPONENTS],
}

impl QuantTables {
    const NONE: Self = Self {
        tables: [block::ZERO; MAX_COMPONENTS],
        is_set: [false; MAX_COMPONENTS],
    };

    fn latch(&mut self, frame: &Frame, scan: &Scan, tables: &Tables) -> Result<()> {
        for index in scan.components().iter().map(|it| usize::from(it.index)) {
            if !core::mem::replace(wrapped_mut(&mut self.is_set, index), true) {
                let component = frame.components().get(index).ok_or(Error::Internal)?;
                let table = tables.quant.get(usize::from(component.quant_table));
                *wrapped_mut(&mut self.tables, index) =
                    table.copied().flatten().ok_or(Error::MissingTable)?;
            }
        }
        Ok(())
    }
}

impl<'a> Decoder<'a> {
    /// Reads as far as the data of the first scan.
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        let mut segments = Segments::new(bytes)?;
        let (frame, first_scan) = segments.next_scan()?.ok_or(Error::MissingScan)?;
        Ok(Self {
            segments,
            frame,
            first_scan,
            allowance: Allowance::new(&frame),
            spare_zeros: arithmetic::spare_zeros(&frame),
        })
    }

    pub fn header(&self) -> Header {
        Header {
            width: self.frame.width.into(),
            height: self.frame.height.into(),
        }
    }

    /// The image is `eighths / 8` of its size, rounded up, for `eighths` from 1 to 8. A lossless one keeps its size.
    pub fn decode(mut self, eighths: u8) -> Result<Image> {
        let color_space = self.segments.color_space(&self.frame);
        let is_lossless = self.frame.process == Process::Lossless;
        let needs_no_conversion = matches!(color_space, ColorSpace::Rgb | ColorSpace::Cmyk);
        if self.frame.precision > 8
            || is_lossless && (self.frame.arithmetic || !needs_no_conversion)
        {
            return Err(Error::Unsupported);
        }
        let icc_profile = match color_space {
            // It would be about inks.
            ColorSpace::Cmyk | ColorSpace::Ycck => None,
            _ => self.segments.icc_profile()?,
        };

        let is_only_scan = self.frame.process != Process::Progressive
            && self.first_scan.components().len() == self.frame.components().len();
        if is_only_scan {
            self.frame.ignore_lone_sampling();
        }
        let strips = match is_lossless && !is_only_scan {
            true => self.frame.size_in_mcus().high,
            false => 1,
        };
        let mut output = Output::new(&self.frame, color_space, eighths.clamp(1, 8), strips)?;
        match (is_lossless, is_only_scan) {
            (true, _) => self.decode_lossless(&mut output, is_only_scan)?,
            (false, true) => self.decode_only_scan(&mut output)?,
            (false, false) => self.decode_scans(&mut output)?,
        }
        if is_only_scan && self.segments.next_scan()?.is_some() {
            return Err(Error::MarkerOutOfPlace);
        }
        Ok(Image {
            width: output.width as u32,
            height: output.height as u32,
            rgba: output.into_rgba()?,
            icc_profile,
        })
    }

    fn lay_out(&mut self, scan: &Scan) -> Result<Layout> {
        let layout = Layout::new(&self.frame, scan)?;
        self.allowance.spend(&self.frame, scan, &layout)?;
        Ok(layout)
    }

    fn decode_lossless(&mut self, output: &mut Output, is_only_scan: bool) -> Result<()> {
        let mut missing = (1 << self.frame.components().len()) - 1;
        let mut scan = self.first_scan;
        loop {
            let layout = self.lay_out(&scan)?;
            let (segments, precision) = (&mut self.segments, self.frame.precision);
            lossless::decode_scan(segments, precision, &scan, &layout, output, is_only_scan)?;
            if is_only_scan {
                return Ok(());
            }
            for component in scan.components() {
                missing &= !(1 << component.index);
            }
            match self.segments.next_scan()? {
                Some((_, next)) => scan = next,
                None if missing != 0 => return Err(Error::MissingScan),
                None => return output.convert_strips(self.frame.size_in_mcus().high),
            }
        }
    }

    fn decode_sequential(&mut self, scan: &Scan, mut target: Target<'_>) -> Result<()> {
        let layout = self.lay_out(scan)?;
        let batch = (BATCH_LEN / layout.blocks_in_mcu).min(layout.mcus.wide);
        let (mut regions, mut len) = ([Region::default(); MAX_COMPONENTS], 0);
        for part in layout.parts() {
            let stride = batch * part.h;
            *wrapped_mut(&mut regions, part.index) = Region { start: len, stride };
            len += part.v * stride;
        }
        let mut blocks = filled(BATCH_ROOM, block::ZERO)?;
        let slots = layout.slots(&regions);

        let Segments { input, tables, .. } = &mut self.segments;
        let mut restarts = Restarts::new(tables.restart_interval.into());
        let (step_tables, mut huffman, mut arithmetic);
        let decoder: &mut dyn EntropyDecoder = if self.frame.arithmetic {
            let (process, spare_zeros) = (Process::Sequential, &mut self.spare_zeros);
            arithmetic = Arithmetic::new(input, tables, process, scan, &mut [], spare_zeros);
            &mut arithmetic
        } else {
            step_tables = StepTables::new(tables, scan, input)?;
            huffman = Sequential::new(input, &step_tables, slots.as_slice(), len)?;
            &mut huffman
        };

        for mcu_row in 0..layout.mcus.high {
            for first in (0..layout.mcus.wide).step_by(batch) {
                let count = batch.min(layout.mcus.wide - first);
                let rows = || {
                    layout.parts().iter().flat_map(|part| {
                        let Region { start, stride } = *wrapped(&regions, part.index);
                        (0..part.v).map(move |y| {
                            let place = Place {
                                component: part.index,
                                x: first * part.h,
                                y: mcu_row * part.v + y,
                            };
                            let start = start + y * stride;
                            (start..start + count * part.h, place)
                        })
                    })
                };
                if let Target::Coefficients(all) = &mut target {
                    for (row, place) in rows() {
                        let row = blocks.get_mut(row).ok_or(Error::Internal)?;
                        for (new, old) in row.iter_mut().zip(all.blocks_from_mut(place)) {
                            new.0[0] = old.0[0];
                        }
                    }
                }
                restarts.decode(decoder, &mut blocks, slots.as_slice(), 0..count)?;
                for (row, place) in rows() {
                    target.put(blocks.get(row).ok_or(Error::Internal)?, place)?;
                }
                blocks.get_mut(..len).unwrap_or_default().fill(block::ZERO);
            }
            if let Target::Output(output, _) = &mut target {
                output.finish_strip()?;
            }
        }
        Ok(())
    }

    fn decode_only_scan(&mut self, output: &mut Output) -> Result<()> {
        let scan = self.first_scan;
        let mut quant = QuantTables::NONE;
        quant.latch(&self.frame, &scan, &self.segments.tables)?;
        self.decode_sequential(&scan, Target::Output(output, &quant))
    }

    /// Returns the last row of MCUs of the frame that the scan had data for.
    fn decode_progressive(
        &mut self,
        scan: &Scan,
        Coefficients { blocks, regions }: &mut Coefficients,
        nonzero: &mut [u64],
    ) -> Result<usize> {
        let layout = self.lay_out(scan)?;
        let Segments { input, tables, .. } = &mut self.segments;
        let mut restarts = Restarts::new(tables.restart_interval.into());
        let (mut huffman, mut arithmetic);
        let decoder: &mut dyn EntropyDecoder = if self.frame.arithmetic {
            let (process, spare_zeros) = (Process::Progressive, &mut self.spare_zeros);
            arithmetic = Arithmetic::new(input, tables, process, scan, nonzero, spare_zeros);
            &mut arithmetic
        } else {
            huffman = Progressive::new(input, tables, scan, nonzero)?;
            &mut huffman
        };

        let (mut slots, mut last_row_with_data) = (layout.slots(regions), 0);
        for mcu_row in 0..layout.mcus.high {
            if restarts.decode(decoder, blocks, slots.as_slice(), 0..layout.mcus.wide)? {
                last_row_with_data = mcu_row;
            }
            slots.move_down();
        }
        Ok(last_row_with_data / layout.rows_in_strip)
    }

    fn decode_scans(&mut self, output: &mut Output) -> Result<()> {
        let frame = self.frame;
        let is_progressive = frame.process == Process::Progressive;
        let mcus = frame.size_in_mcus();
        let (mut regions, mut len) = ([Region::default(); MAX_COMPONENTS], 0);
        for (region, component) in regions.iter_mut().zip(frame.components()) {
            let stride = mcus.wide * usize::from(component.h);
            *region = Region { start: len, stride };
            len += mcus.high * usize::from(component.v) * stride;
        }
        let blocks = filled(len, block::ZERO)?;
        let mut all = Coefficients { blocks, regions };
        let mut nonzero = filled(if is_progressive { len } else { 0 }, 0)?;

        let (mut quant, mut progress) = (QuantTables::NONE, Progress::NONE);
        let mut last_strip_with_data = 0;
        let mut next = Some(self.first_scan);
        while let Some(scan) = next {
            if is_progressive {
                check_progression(&scan)?;
            }
            quant.latch(&frame, &scan, &self.segments.tables)?;
            if is_progressive {
                progress.add(&scan);
                last_strip_with_data = self.decode_progressive(&scan, &mut all, &mut nonzero)?;
            } else {
                self.decode_sequential(&scan, Target::Coefficients(&mut all))?;
            }
            next = self.segments.next_scan()?.map(|(_, scan)| scan);
        }
        drop(nonzero);

        let used_tables = quant.tables.get(..frame.components().len());
        let accuracy = progress.accuracy(used_tables.unwrap_or_default());
        let mut smoothed = [block::ZERO; smoothing::BATCH_LEN];
        for strip in 0..mcus.high {
            let components = frame.components().iter().zip(&mut output.planes);
            for (index, (component, plane)) in components.enumerate() {
                let Grid { wide, high } = frame.size_in_blocks(*component);
                let (region, quant) = (wrapped(&regions, index), wrapped(&quant.tables, index));
                let row = |y: usize| {
                    let row = all.blocks.get(region.start + y * region.stride..);
                    row.and_then(|row| row.get(..wide)).unwrap_or_default()
                };
                let top = strip * usize::from(component.v);
                let rows = usize::from(component.v).min(high - top);
                for y in top..top + rows {
                    let Some(accuracy) = &accuracy else {
                        plane.put(row(y), quant, 0, y);
                        continue;
                    };
                    // All rows of MCUs count as having as many rows of blocks as this one.
                    let above = (strip * rows + y - top).min(2);
                    let below = (mcus.high * rows - 1 - (strip * rows + y - top)).min(2);
                    let around = [
                        row(y - above),
                        row(y - above.min(1)),
                        row(y),
                        row(y + below.min(1)),
                        row(y + below),
                    ];
                    let is_late = strip > last_strip_with_data;
                    let accuracy = wrapped(accuracy, index);
                    for x in (0..wide).step_by(smoothed.len()) {
                        let out = accuracy.smooth(is_late, quant, &around, x, &mut smoothed);
                        plane.put(out, quant, x, y);
                    }
                }
            }
            output.finish_strip()?;
        }
        Ok(())
    }
}

fn check_progression(scan: &Scan) -> Result<()> {
    let is_band = match scan.first {
        0 => scan.last == 0,
        first => (first..64).contains(&scan.last) && scan.components().len() == 1,
    };
    let is_next_bit = scan.previous_shift == 0 || scan.previous_shift - 1 == scan.shift;
    if is_band && is_next_bit && scan.shift <= 13 {
        Ok(())
    } else {
        Err(Error::InvalidScan)
    }
}
