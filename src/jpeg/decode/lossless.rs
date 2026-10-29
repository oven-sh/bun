//! Lossless streams: Huffman-coded differences from a prediction (jdlhuff.c, jdlossls.c, jddiffct.c).

use super::bits::{BitReader, DerivedTable, TableKind, Tables, huff_extend};
use super::coef::Plane;
use super::input::Restarts;
use super::{Decoder, MAX_BLOCKS_IN_MCU};
use crate::alloc::{try_vec, try_vec_with_capacity};
use crate::error::{Error, Result};
use core::cell::Cell;

/// The rows of one component for one iMCU row, as numbers wider than a sample.
struct Rows {
    data: Vec<i32>,
    stride: usize,
}

impl Rows {
    fn new(stride: usize, rows: usize) -> Result<Self> {
        let data = try_vec(0, stride * rows)?;
        Ok(Rows { data, stride })
    }

    fn row_mut(&mut self, y: usize) -> Result<&mut [i32]> {
        self.data
            .get_mut(y * self.stride..(y + 1) * self.stride)
            .ok_or(Error::Internal)
    }
}

/// Where a run of samples of an MCU goes: `width` samples in a row of a component.
#[derive(Default, Clone, Copy)]
struct Run {
    component: usize,
    yoffset: usize,
    width: usize,
    selector: u8,
}

pub(crate) struct DiffController {
    bits: BitReader,
    tables: Tables<DerivedTable>,
    runs: [Run; MAX_BLOCKS_IN_MCU],
    num_runs: usize,

    /// Per component, whether its next row starts over from the fixed prediction.
    first_row: Vec<bool>,

    input_imcu_row: u32,
    restarts: Restarts,
    diff_buf: Vec<Rows>,
    undiff_buf: Vec<Rows>,
    /// The samples of the whole image, if the stream has several scans. Empty until the component's first scan.
    whole_image: Vec<Plane>,
}

impl DiffController {
    pub(crate) fn new(decoder: &Decoder) -> Result<Self> {
        let mut diff_buf = try_vec_with_capacity(decoder.components.len())?;
        let mut undiff_buf = try_vec_with_capacity(decoder.components.len())?;
        for comp in &decoder.components {
            let stride = comp.padded_width();
            diff_buf.push(Rows::new(stride, comp.v_samp as usize)?);
            undiff_buf.push(Rows::new(stride, comp.v_samp as usize)?);
        }
        Ok(DiffController {
            bits: BitReader::default(),
            tables: Tables::default(),
            runs: [Run::default(); MAX_BLOCKS_IN_MCU],
            num_runs: 0,
            first_row: try_vec(true, decoder.components.len())?,
            input_imcu_row: 0,
            restarts: Restarts::default(),
            diff_buf,
            undiff_buf,
            whole_image: Vec::new(),
        })
    }

    pub(crate) fn start_input_pass(&mut self, decoder: &Decoder) -> Result<()> {
        self.tables = Tables::default();
        for i in 0..decoder.components_in_scan {
            let selector = decoder.scan_component(i)?.dc_selector;
            let table = |spec: &_| DerivedTable::new(spec, TableKind::Lossless);
            self.tables.derive(&decoder.dc_huff, selector, table)?;
        }
        self.num_runs = 0;
        for i in 0..decoder.components_in_scan {
            let ci = decoder.scan_component_index(i)?;
            let comp = decoder.component(ci)?;
            for yoffset in 0..comp.mcu_height as usize {
                *self.runs.get_mut(self.num_runs).ok_or(Error::Internal)? = Run {
                    component: ci,
                    yoffset,
                    width: comp.mcu_width as usize,
                    selector: comp.dc_selector,
                };
                self.num_runs += 1;
            }
        }
        self.bits.reset();

        // Ss selects the predictor and Al is the point transform.
        if !(1..=7).contains(&decoder.ss)
            || decoder.se != 0
            || decoder.ah != 0
            || decoder.al >= decoder.precision
        {
            return Err(Error::BadProgression(
                decoder.ss, decoder.se, decoder.ah, decoder.al,
            ));
        }
        self.first_row.fill(true);
        if !decoder
            .restart_interval
            .is_multiple_of(decoder.mcus_per_row)
        {
            return Err(Error::BadRestart(
                decoder.restart_interval,
                decoder.mcus_per_row,
            ));
        }
        self.restarts = Restarts::new(decoder.restart_interval / decoder.mcus_per_row);
        self.input_imcu_row = 0;
        Ok(())
    }

    /// Decodes the differences of one row of MCUs. Inlined, it takes a quarter longer.
    #[inline(never)]
    fn decode_mcus(&mut self, decoder: &mut Decoder, mcu_row_num: usize) -> Result<()> {
        let mcus_per_row = decoder.mcus_per_row as usize;
        if decoder.input.insufficient_data {
            // With no differences and the prediction started over, the samples come out gray.
            for run in self.runs.iter().take(self.num_runs) {
                let rows = self
                    .diff_buf
                    .get_mut(run.component)
                    .ok_or(Error::Internal)?;
                rows.row_mut(mcu_row_num + run.yoffset)?
                    .get_mut(..mcus_per_row * run.width)
                    .ok_or(Error::Internal)?
                    .fill(0);
            }
            self.first_row.fill(true);
            return Ok(());
        }

        // Each run's table and what is left of its row, found once for the row of MCUs.
        let mut cursors = [const { None }; MAX_BLOCKS_IN_MCU];
        for (ci, rows) in self.diff_buf.iter_mut().enumerate() {
            for (y, row) in rows.data.chunks_exact_mut(rows.stride).enumerate() {
                for (run, cursor) in self.runs.iter().take(self.num_runs).zip(&mut cursors) {
                    if run.component == ci && mcu_row_num + run.yoffset == y {
                        let table = self.tables.get(run.selector)?;
                        *cursor = Some((table, row.chunks_exact_mut(run.width)));
                        break;
                    }
                }
            }
        }

        let input = &mut decoder.input;
        let mut bits = self.bits;
        for _ in 0..mcus_per_row {
            for (table, row) in cursors.iter_mut().take(self.num_runs).flatten() {
                for diff in row.next().ok_or(Error::Internal)? {
                    let s = u32::from(bits.decode(input, table));
                    *diff = match s {
                        0 => 0,
                        16 => 32768,
                        _ => {
                            bits.ensure(input, s);
                            huff_extend(bits.get(s), s)
                        }
                    };
                }
            }
        }
        self.bits = bits;
        Ok(())
    }

    /// Decodes the next iMCU row of the scan into `planes`, or else into its place in `whole_image`.
    fn decompress_row(
        &mut self,
        decoder: &mut Decoder,
        planes: Option<&mut [Plane]>,
    ) -> Result<()> {
        for yoffset in 0..decoder.mcu_rows_in_imcu_row(self.input_imcu_row)? {
            if self.restarts.due(&mut decoder.input) {
                self.bits.reset();
                self.first_row.fill(true);
            }
            self.decode_mcus(decoder, yoffset as usize)?;
        }

        let (planes, first_imcu_row) = match planes {
            Some(planes) => (planes, 0),
            None => (
                self.whole_image.as_mut_slice(),
                self.input_imcu_row as usize,
            ),
        };
        for i in 0..decoder.components_in_scan {
            let ci = decoder.scan_component_index(i)?;
            let comp = decoder.component(ci)?;
            let plane = planes.get_mut(ci).ok_or(Error::Internal)?;
            let width = comp.width_in_blocks as usize;
            let rows = decoder.rows_in_imcu_row(comp, self.input_imcu_row) as usize;
            let diff_buf = self.diff_buf.get_mut(ci).ok_or(Error::Internal)?;
            let undiff_buf = self.undiff_buf.get_mut(ci).ok_or(Error::Internal)?;
            let first_row = self.first_row.get_mut(ci).ok_or(Error::Internal)?;

            // The row above the first one is the last row of the iMCU row before.
            let mut prev_row = comp.v_samp as usize - 1;
            for row in 0..rows {
                let diffs = diff_buf.row_mut(row)?.get(..width).ok_or(Error::Internal)?;
                if *first_row {
                    let initial = 1 << (decoder.precision - decoder.al - 1);
                    undifference_1d(diffs, initial, undiff_buf.row_mut(row)?);
                    *first_row = false;
                } else {
                    // A component with one row in an iMCU row is predicted from the row that is being replaced.
                    let stride = undiff_buf.stride;
                    let cells = Cell::from_mut(undiff_buf.data.as_mut_slice()).as_slice_of_cells();
                    let prev = cells.get(prev_row * stride..).ok_or(Error::Internal)?;
                    let this = cells.get(row * stride..).ok_or(Error::Internal)?;
                    undifference(decoder.ss, diffs, prev, this);
                }
                let samples = plane.row_mut(first_imcu_row * comp.v_samp as usize + row)?;
                for (sample, &v) in samples
                    .iter_mut()
                    .zip(undiff_buf.row_mut(row)?.iter())
                    .take(width)
                {
                    *sample = (v << decoder.al) as u8;
                }
                prev_row = row;
            }
        }

        self.input_imcu_row += 1;
        Ok(())
    }

    /// Decodes the next iMCU row of a stream with a single scan.
    pub(crate) fn decompress_onepass(
        &mut self,
        decoder: &mut Decoder,
        planes: &mut [Plane],
    ) -> Result<()> {
        self.decompress_row(decoder, Some(planes))
    }

    /// Decodes a whole scan into the samples of the whole image.
    pub(crate) fn consume_scan(&mut self, decoder: &mut Decoder) -> Result<()> {
        // Only now that the first scan has turned out to be valid: a few bytes can ask for gigabytes of zeros.
        if self.whole_image.is_empty() {
            self.whole_image.try_reserve(decoder.components.len())?;
            for comp in &decoder.components {
                let stride = comp.padded_width();
                let data = try_vec_with_capacity(stride * comp.padded_height())?;
                self.whole_image.push(Plane { data, stride });
            }
        }
        for i in 0..decoder.components_in_scan {
            let ci = decoder.scan_component_index(i)?;
            let comp = decoder.component(ci)?;
            let plane = self.whole_image.get_mut(ci).ok_or(Error::Internal)?;
            // Memory that no one has written to costs nothing, so not before the component's first scan.
            plane.data.resize(plane.stride * comp.padded_height(), 0);
        }
        while self.input_imcu_row < decoder.total_imcu_rows {
            self.decompress_row(decoder, None)?;
        }
        Ok(())
    }

    /// Copies iMCU row `output_imcu_row` out of the samples of the whole image.
    pub(crate) fn output_data(
        &self,
        decoder: &Decoder,
        output_imcu_row: u32,
        planes: &mut [Plane],
    ) -> Result<()> {
        for ((comp, image), plane) in decoder.components.iter().zip(&self.whole_image).zip(planes) {
            // libjpeg refuses to read from an array that nothing was written to.
            if image.data.is_empty() {
                return Err(Error::BadVirtualAccess);
            }
            let rows = decoder.rows_in_imcu_row(comp, output_imcu_row) as usize;
            let first = (output_imcu_row * comp.v_samp) as usize;
            let width = comp.width_in_blocks as usize;
            for (row, out) in plane.data.chunks_mut(plane.stride).enumerate().take(rows) {
                for (out, &v) in out.iter_mut().zip(image.row(first + row)?).take(width) {
                    *out = v;
                }
            }
        }
        Ok(())
    }
}

/// Each sample is predicted by the one to its left, and the first one by `initial`.
fn undifference_1d(diffs: &[i32], initial: i32, out: &mut [i32]) {
    let mut ra = initial;
    for (out, &diff) in out.iter_mut().zip(diffs) {
        ra = diff.wrapping_add(ra) & 0xffff;
        *out = ra;
    }
}

/// `ra` is the sample to the left, `rb` the one above and `rc` the one above and to the left.
#[inline(always)]
fn predict(predictor: u8, ra: i32, rb: i32, rc: i32) -> i32 {
    match predictor {
        1 => ra,
        2 => rb,
        3 => rc,
        4 => ra + rb - rc,
        5 => ra + ((rb - rc) >> 1),
        6 => rb + ((ra - rc) >> 1),
        _ => (ra + rb) >> 1,
    }
}

/// The first sample of a row is predicted by the one above it. `prev` and `out` may be the same row.
fn undifference(predictor: u8, diffs: &[i32], prev: &[Cell<i32>], out: &[Cell<i32>]) {
    let mut ra = 0;
    let mut rc = 0;
    for (i, ((out, &diff), prev)) in out.iter().zip(diffs).zip(prev).enumerate() {
        let rb = prev.get();
        let prediction = if i == 0 {
            rb
        } else {
            predict(predictor, ra, rb, rc)
        };
        ra = diff.wrapping_add(prediction) & 0xffff;
        out.set(ra);
        rc = rb;
    }
}
