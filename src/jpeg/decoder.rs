//! Runs the scans of a file, and takes their blocks to the output (jdcoefct.c).

use crate::arithmetic::Arithmetic;
use crate::bit_reader::Window;
use crate::block::{self, Block, Zigzag};
use crate::header::{ColorSpace, Frame, Grid, Header, Process, Scan, Segments, Tables};
use crate::output::Output;
use crate::progressive::{self, Progressive};
use crate::scan::{EntropyDecoder, Layout, Region, Regions, Restarts};
use crate::sequential::{BATCH_ROOM, Sequential, StepTables};
use crate::smoothing::{self, Accuracy, Progress};
use crate::{
    Error, MAX_COMPONENTS, Result, batches, fill_up, filled, lossless, wrapped, wrapped_mut,
};

/// The most blocks that are decoded before they are transformed. They fit in the L1 cache.
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
}

/// The position of a block in the image.
#[derive(Clone, Copy)]
struct Place {
    component: usize,
    x: usize,
    y: usize,
}

struct Coefficients {
    regions: Regions,
    /// These two are empty until a scan reaches its data.
    blocks: Vec<Block>,
    nonzero: Vec<u64>,
}

impl Coefficients {
    fn index(&self, Place { component, x, y }: Place) -> usize {
        let Region { start, stride } = self.regions.of(component);
        start + y * stride + x
    }

    fn blocks_from(&self, place: Place) -> &[Block] {
        self.blocks.get(self.index(place)..).unwrap_or_default()
    }

    fn blocks_from_mut(&mut self, place: Place) -> &mut [Block] {
        let index = self.index(place);
        self.blocks.get_mut(index..).unwrap_or_default()
    }

    /// Smooths the blocks on the way if there is an `accuracy` to go by.
    #[inline(never)] // So that `smoothed` is not on the stack while the scans are decoded.
    fn transform(
        &self,
        frame: &Frame,
        quant: &QuantTables,
        accuracy: Option<&[Accuracy; MAX_COMPONENTS]>,
        last_strip_with_data: usize,
        output: &mut Output,
    ) -> Result<()> {
        let strips = frame.size_in_mcus().high;
        let mut smoothed = [block::ZERO; smoothing::BATCH_LEN];
        for strip in 0..strips {
            let components = frame.components().iter().zip(&mut output.planes);
            for (index, (component, plane)) in components.enumerate() {
                let Grid { wide, high } = frame.size_in_blocks(*component);
                let quant = wrapped(&quant.tables, index);
                let row = |y| {
                    let row = self.blocks_from(Place {
                        component: index,
                        x: 0,
                        y,
                    });
                    row.get(..wide).unwrap_or_default()
                };
                let top = strip * component.v;
                let rows = component.v.min(high - top);
                for y in top..top + rows {
                    let Some(accuracy) = accuracy else {
                        plane.put(row(y), quant, 0, y)?;
                        continue;
                    };
                    // Like libjpeg, this takes all strips to have as many rows of blocks as this one.
                    let nth = strip * rows + y - top;
                    let (above, below) = (nth.min(2), (strips * rows - 1 - nth).min(2));
                    let around = [y - above, y - above.min(1), y, y + below.min(1), y + below];
                    let (around, is_late) = (around.map(row), strip > last_strip_with_data);
                    let accuracy = wrapped(accuracy, index);
                    for x in (0..wide).step_by(smoothed.len()) {
                        let out = accuracy.smooth(is_late, quant, &around, x, &mut smoothed);
                        plane.put(out, quant, x, y)?;
                    }
                }
            }
            output.finish_strip()?;
        }
        Ok(())
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
                plane.put(blocks, wrapped(&quant.tables, component), x, y)?;
            }
            // A repeated scan of a component only overwrites the coefficients that it codes.
            Self::Coefficients(all) => {
                for (old, new) in all.blocks_from_mut(place).iter_mut().zip(blocks) {
                    for (old, &new) in old.0.iter_mut().zip(&new.0) {
                        *old = if new != 0 { new } else { *old };
                    }
                    *old.dc_mut() = new.dc();
                }
            }
        }
        Ok(())
    }
}

/// A component keeps the table that is defined when its first scan starts.
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
        let frame = segments.read_frame()?;
        let first_scan = segments.next_scan(&frame)?.ok_or(Error::MissingScan)?;
        Ok(Self {
            segments,
            frame,
            first_scan,
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
        let needs_conversion = !matches!(color_space, ColorSpace::Rgb | ColorSpace::Cmyk);
        if self.frame.precision > 8 || is_lossless && (self.frame.is_arithmetic || needs_conversion)
        {
            return Err(Error::Unsupported);
        }
        let icc_profile = match color_space {
            // A CMYK profile does not describe RGBA.
            ColorSpace::Cmyk | ColorSpace::Ycck => None,
            _ => self.segments.icc_profile()?,
        };

        let is_only_scan = self.frame.process != Process::Progressive
            && self.first_scan.components().len() == self.frame.components().len();
        if is_only_scan {
            self.frame.ignore_lone_sampling();
        }
        let mut output = Output::new(&self.frame, color_space, eighths.clamp(1, 8))?;
        match (is_lossless, is_only_scan) {
            (true, _) => self.decode_lossless(&mut output, is_only_scan)?,
            (false, true) => self.decode_only_scan(&mut output)?,
            (false, false) => self.decode_scans(&mut output)?,
        }
        if is_only_scan && self.segments.next_scan(&self.frame)?.is_some() {
            return Err(Error::MarkerOutOfPlace);
        }
        Ok(Image {
            width: output.width as u32,
            height: output.height as u32,
            rgba: output.into_rgba()?,
            icc_profile,
        })
    }

    // This and the next two are not inlined, so that only one at a time has its buffers on the stack.
    #[inline(never)]
    fn decode_lossless(&mut self, output: &mut Output, is_only_scan: bool) -> Result<()> {
        let mut missing = (1 << self.frame.components().len()) - 1;
        let mut scan = self.first_scan;
        loop {
            let layout = Layout::new(&self.frame, &scan)?;
            let (segments, precision) = (&mut self.segments, self.frame.precision);
            lossless::decode_scan(segments, precision, &scan, &layout, output, is_only_scan)?;
            if is_only_scan {
                return Ok(());
            }
            for component in scan.components() {
                missing &= !(1 << component.index);
            }
            match self.segments.next_scan(&self.frame)? {
                Some(next) => scan = next,
                None if missing != 0 => return Err(Error::MissingScan),
                None => return output.convert_strips(self.frame.size_in_mcus().high),
            }
        }
    }

    #[inline(never)]
    fn decode_sequential(&mut self, scan: &Scan, mut target: Target<'_>) -> Result<()> {
        let layout = Layout::new(&self.frame, scan)?;
        let batch = (BATCH_LEN / layout.blocks_in_mcu).min(layout.mcus.wide);
        let parts = layout.parts().iter();
        let regions = Regions::new(parts.map(|it| [it.index, batch * it.h, it.v]));
        let mut blocks = filled(BATCH_ROOM, block::ZERO)?;
        let slots = layout.slots(&regions);

        let Segments { input, tables, .. } = &mut self.segments;
        let mut restarts = Restarts::new(tables.restart_interval.into());
        let step_tables = if self.frame.is_arithmetic {
            None
        } else {
            Some(StepTables::new(tables, scan, input.len_left())?)
        };
        let window = &mut Window::new(input);
        let (mut huffman, mut arithmetic);
        let decoder: &mut dyn EntropyDecoder = if let Some(tables) = &step_tables {
            let tables = tables.by_component()?;
            huffman = Sequential::new(window, tables, slots.as_slice(), regions.len);
            &mut huffman
        } else {
            arithmetic = Arithmetic::new(window, tables, scan, &mut []);
            &mut arithmetic
        };
        if let Target::Coefficients(all) = &mut target {
            fill_up(&mut all.blocks, all.regions.len, block::ZERO)?;
        }

        for mcu_row in 0..layout.mcus.high {
            for [first, count] in batches(layout.mcus.wide, batch) {
                if matches!(target, Target::Coefficients(_))
                    && !decoder.has_data()
                    && (decoder.is_over() || restarts.skip(count))
                {
                    continue;
                }
                let rows = || {
                    layout.parts().iter().flat_map(|part| {
                        let Region { start, stride } = regions.of(part.index);
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
                // `put` always takes the DC, so the blocks that the data does not reach need the old one.
                if let Target::Coefficients(all) = &mut target {
                    for (row, place) in rows() {
                        let row = blocks.get_mut(row).ok_or(Error::Internal)?;
                        for (new, old) in row.iter_mut().zip(all.blocks_from(place)) {
                            *new.dc_mut() = old.dc();
                        }
                    }
                }
                decoder.decode_with_restarts(
                    &mut restarts,
                    &mut blocks,
                    slots.as_slice(),
                    0..count,
                )?;
                for (row, place) in rows() {
                    target.put(blocks.get(row).ok_or(Error::Internal)?, place)?;
                }
                let used = blocks.get_mut(..regions.len);
                used.unwrap_or_default().fill(block::ZERO);
            }
            if let Target::Output(output, _) = &mut target {
                output.finish_strip()?;
            }
        }
        Ok(())
    }

    /// Returns the last strip that the scan had data for.
    #[inline(never)]
    fn decode_progressive(&mut self, scan: &Scan, all: &mut Coefficients) -> Result<usize> {
        let layout = Layout::new(&self.frame, scan)?;
        let Segments { input, tables, .. } = &mut self.segments;
        let mut restarts = Restarts::new(tables.restart_interval.into());
        let huffman_tables = if self.frame.is_arithmetic {
            None
        } else {
            Some(progressive::tables_for(scan, tables)?)
        };
        fill_up(&mut all.blocks, all.regions.len, block::ZERO)?;
        fill_up(&mut all.nonzero, all.regions.len, 0)?;

        let window = &mut Window::new(input);
        let (mut huffman, mut arithmetic);
        let decoder: &mut dyn EntropyDecoder = if let Some(tables) = huffman_tables {
            huffman = Progressive::new(window, tables, scan, &mut all.nonzero);
            &mut huffman
        } else {
            arithmetic = Arithmetic::new(window, tables, scan, &mut all.nonzero);
            &mut arithmetic
        };

        let (mut slots, mut last_row_with_data) = (layout.slots(&all.regions), 0);
        for mcu_row in 0..layout.mcus.high {
            let mcus = 0..layout.mcus.wide;
            if decoder.decode_with_restarts(
                &mut restarts,
                &mut all.blocks,
                slots.as_slice(),
                mcus,
            )? {
                last_row_with_data = mcu_row;
            } else if decoder.is_over() {
                break;
            }
            slots.move_down();
        }
        Ok(last_row_with_data / layout.rows_in_strip)
    }

    fn decode_only_scan(&mut self, output: &mut Output) -> Result<()> {
        let scan = self.first_scan;
        let mut quant = QuantTables::NONE;
        quant.latch(&self.frame, &scan, &self.segments.tables)?;
        self.decode_sequential(&scan, Target::Output(output, &quant))
    }

    fn decode_scans(&mut self, output: &mut Output) -> Result<()> {
        let frame = self.frame;
        let mcus = frame.size_in_mcus();
        let components = frame.components().iter().enumerate();
        let mut all = Coefficients {
            regions: Regions::new(
                components.map(|(index, it)| [index, mcus.wide * it.h, mcus.high * it.v]),
            ),
            blocks: Vec::new(),
            nonzero: Vec::new(),
        };

        let (mut quant, mut progress) = (QuantTables::NONE, Progress::NONE);
        let mut last_strip_with_data = 0;
        let mut next = Some(self.first_scan);
        while let Some(scan) = next {
            quant.latch(&frame, &scan, &self.segments.tables)?;
            if frame.process == Process::Progressive {
                progress.add(&scan);
                last_strip_with_data = self.decode_progressive(&scan, &mut all)?;
            } else {
                self.decode_sequential(&scan, Target::Coefficients(&mut all))?;
            }
            next = self.segments.next_scan(&frame)?;
        }
        all.nonzero = Vec::new();

        let used_tables = quant.tables.get(..frame.components().len());
        let accuracy = progress.accuracy(used_tables.unwrap_or_default());
        all.transform(
            &frame,
            &quant,
            accuracy.as_ref(),
            last_strip_with_data,
            output,
        )
    }
}
