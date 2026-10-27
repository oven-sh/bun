//! Lossless streams: Huffman-coded differences from a prediction (jdlhuff.c, jdlossls.c, jddiffct.c).

use super::bits::{self, BitReader, DerivedTables, TableKind, huff_extend};
use super::coef::Plane;
use super::{Decoder, MAX_BLOCKS_IN_MCU};
use crate::error::{Error, Result, try_vec};

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
    tables: DerivedTables,
    runs: [Run; MAX_BLOCKS_IN_MCU],
    num_runs: usize,

    /// Per component, whether its next row starts over from the fixed prediction.
    first_row: Vec<bool>,

    input_imcu_row: u32,
    /// MCU rows left in this restart interval.
    restart_rows_to_go: u32,
    diff_buf: Vec<Rows>,
    undiff_buf: Vec<Rows>,
    /// The samples of the whole image, if the stream has several scans. The flag says whether a scan has filled them in.
    whole_image: Vec<(Plane, bool)>,
}

impl DiffController {
    pub(crate) fn new(decoder: &Decoder) -> Result<Self> {
        let mut diff_buf = Vec::new();
        let mut undiff_buf = Vec::new();
        let mut whole_image = Vec::new();
        for comp in &decoder.components {
            let stride = comp.width_in_blocks.next_multiple_of(comp.h_samp) as usize;
            diff_buf.push(Rows::new(stride, comp.v_samp as usize)?);
            undiff_buf.push(Rows::new(stride, comp.v_samp as usize)?);
            if decoder.has_multiple_scans {
                let rows = comp.height_in_blocks.next_multiple_of(comp.v_samp) as usize;
                whole_image.push((Plane::new(stride, rows)?, false));
            }
        }
        Ok(DiffController {
            bits: BitReader::default(),
            tables: Default::default(),
            runs: [Run::default(); MAX_BLOCKS_IN_MCU],
            num_runs: 0,
            first_row: vec![true; decoder.components.len()],
            input_imcu_row: 0,
            restart_rows_to_go: 0,
            diff_buf,
            undiff_buf,
            whole_image,
        })
    }

    /// Ss selects the predictor and Al is the point transform.
    fn start_undifferencing(&mut self, decoder: &Decoder) -> Result<()> {
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
        Ok(())
    }

    pub(crate) fn start_input_pass(&mut self, decoder: &mut Decoder) -> Result<()> {
        for i in 0..decoder.components_in_scan {
            let selector = decoder.scan_component(i)?.dc_selector;
            let tables = &mut self.tables;
            bits::derive(&decoder.dc_huff, selector, TableKind::Lossless, tables)?;
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
        decoder.input.insufficient_data = false;

        self.start_undifferencing(decoder)?;
        if !decoder
            .restart_interval
            .is_multiple_of(decoder.mcus_per_row)
        {
            return Err(Error::BadRestart(
                decoder.restart_interval,
                decoder.mcus_per_row,
            ));
        }
        self.restart_rows_to_go = decoder.restart_interval / decoder.mcus_per_row;
        self.input_imcu_row = 0;
        Ok(())
    }

    /// Decodes the differences of one row of MCUs.
    fn decode_mcus(&mut self, decoder: &mut Decoder, mcu_row_num: usize) -> Result<()> {
        let mcus_per_row = decoder.mcus_per_row as usize;
        if decoder.input.insufficient_data {
            // With no differences and the prediction started over, the samples come out gray.
            for run in self.runs.iter().take(self.num_runs) {
                let rows = self
                    .diff_buf
                    .get_mut(run.component)
                    .ok_or(Error::Internal)?;
                for diff in rows
                    .row_mut(mcu_row_num + run.yoffset)?
                    .iter_mut()
                    .take(mcus_per_row * run.width)
                {
                    *diff = 0;
                }
            }
            return self.start_undifferencing(decoder);
        }

        let input = &mut decoder.input;
        for mcu_num in 0..mcus_per_row {
            for run in self.runs.iter().take(self.num_runs) {
                let table = bits::table(&self.tables, run.selector)?;
                let rows = self
                    .diff_buf
                    .get_mut(run.component)
                    .ok_or(Error::Internal)?;
                let row = rows.row_mut(mcu_row_num + run.yoffset)?;
                for diff in row.iter_mut().skip(mcu_num * run.width).take(run.width) {
                    let s = u32::from(self.bits.decode(input, table));
                    *diff = match s {
                        0 => 0,
                        16 => 32768,
                        _ => {
                            self.bits.ensure(input, s);
                            huff_extend(self.bits.get(s), s)
                        }
                    };
                }
            }
        }
        Ok(())
    }

    /// Decodes the next iMCU row of the scan. `output` finds the row of samples to write for a component and a row
    /// within the iMCU row.
    fn decompress_row<'p>(
        &mut self,
        decoder: &mut Decoder,
        mut output: impl FnMut(usize, usize) -> Option<&'p mut [u8]>,
    ) -> Result<()> {
        for yoffset in 0..decoder.mcu_rows_in_imcu_row(self.input_imcu_row)? {
            if decoder.restart_interval != 0 && self.restart_rows_to_go == 0 {
                self.bits.reset();
                decoder.input.read_restart_marker();
                if decoder.input.unread_marker == 0 {
                    decoder.input.insufficient_data = false;
                }
                self.start_undifferencing(decoder)?;
                self.restart_rows_to_go = decoder.restart_interval / decoder.mcus_per_row;
            }
            self.decode_mcus(decoder, yoffset as usize)?;
            if decoder.restart_interval != 0 {
                self.restart_rows_to_go -= 1;
            }
        }

        for i in 0..decoder.components_in_scan {
            let ci = decoder.scan_component_index(i)?;
            let comp = decoder.component(ci)?;
            let width = comp.width_in_blocks as usize;
            let rows = decoder.rows_in_imcu_row(comp, self.input_imcu_row) as usize;
            let diff_buf = self.diff_buf.get_mut(ci).ok_or(Error::Internal)?;
            let undiff_buf = self.undiff_buf.get_mut(ci).ok_or(Error::Internal)?;
            let first_row = self.first_row.get_mut(ci).ok_or(Error::Internal)?;

            // The row above the first one is the last row of the iMCU row before.
            let mut prev_row = comp.v_samp as usize - 1;
            for row in 0..rows {
                let diffs = diff_buf.row_mut(row)?.get(..width).ok_or(Error::Internal)?;
                let stride = undiff_buf.stride;
                if *first_row {
                    let initial = 1 << (decoder.precision - decoder.al - 1);
                    undifference_1d(diffs, initial, undiff_buf.row_mut(row)?);
                    *first_row = false;
                } else if prev_row == row {
                    // A component with one row in an iMCU row is predicted from the row that is being replaced.
                    undifference_in_place(decoder.ss, diffs, undiff_buf.row_mut(row)?);
                } else {
                    let split = undiff_buf
                        .data
                        .split_at_mut_checked(prev_row.max(row) * stride);
                    let (above, below) = split.ok_or(Error::Internal)?;
                    let (prev, this) = if prev_row < row {
                        (above.get(prev_row * stride..), Some(below))
                    } else {
                        (Some(&*below), above.get_mut(row * stride..))
                    };
                    let (prev, this) = prev.zip(this).ok_or(Error::Internal)?;
                    undifference(decoder.ss, diffs, prev, this);
                }
                let samples = output(ci, row).ok_or(Error::Internal)?;
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
        // One row is handed out at a time, so the planes are taken apart row by row as the rows are asked for.
        let mut rest: Vec<(usize, usize, &mut [u8])> = planes
            .iter_mut()
            .map(|plane| (plane.stride, 0, plane.data.as_mut_slice()))
            .collect();
        self.decompress_row(decoder, |ci, row| take_row(rest.get_mut(ci)?, row))
    }

    /// Decodes a whole scan into the samples of the whole image.
    pub(crate) fn consume_scan(&mut self, decoder: &mut Decoder) -> Result<()> {
        let mut whole_image = core::mem::take(&mut self.whole_image);
        let result = (|| {
            for i in 0..decoder.components_in_scan {
                whole_image
                    .get_mut(decoder.scan_component_index(i)?)
                    .ok_or(Error::Internal)?
                    .1 = true;
            }
            let mut rest: Vec<(usize, usize, &mut [u8])> = whole_image
                .iter_mut()
                .map(|(plane, _)| (plane.stride, 0, plane.data.as_mut_slice()))
                .collect();
            let v_samp: Vec<usize> = decoder
                .components
                .iter()
                .map(|comp| comp.v_samp as usize)
                .collect();
            while self.input_imcu_row < decoder.total_imcu_rows {
                let imcu_row = self.input_imcu_row as usize;
                self.decompress_row(decoder, |ci, row| {
                    take_row(rest.get_mut(ci)?, imcu_row * v_samp.get(ci)? + row)
                })?;
            }
            Ok(())
        })();
        self.whole_image = whole_image;
        result
    }

    /// Copies iMCU row `output_imcu_row` out of the samples of the whole image.
    pub(crate) fn output_data(
        &self,
        decoder: &Decoder,
        output_imcu_row: u32,
        planes: &mut [Plane],
    ) -> Result<()> {
        for ((comp, (image, defined)), plane) in
            decoder.components.iter().zip(&self.whole_image).zip(planes)
        {
            // libjpeg refuses to read from an array that nothing was written to.
            if !defined {
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

/// Splits row `row` off `rest`, which is `(stride, rows already split off, what is left)`. Rows are asked for in
/// increasing order.
fn take_row<'p>(rest: &mut (usize, usize, &'p mut [u8]), row: usize) -> Option<&'p mut [u8]> {
    let (stride, taken, data) = rest;
    let skip = row.checked_sub(*taken)?.checked_mul(*stride)?;
    let (_, tail) = core::mem::take(data).split_at_mut_checked(skip)?;
    let (out, tail) = tail.split_at_mut_checked(*stride)?;
    *data = tail;
    *taken = row + 1;
    Some(out)
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

/// The first sample of a row is predicted by the one above it.
fn undifference(predictor: u8, diffs: &[i32], prev: &[i32], out: &mut [i32]) {
    let mut ra = 0;
    let mut rc = 0;
    for (i, ((out, &diff), &rb)) in out.iter_mut().zip(diffs).zip(prev).enumerate() {
        let prediction = if i == 0 {
            rb
        } else {
            predict(predictor, ra, rb, rc)
        };
        ra = diff.wrapping_add(prediction) & 0xffff;
        *out = ra;
        rc = rb;
    }
}

/// `undifference` where `row` holds the row above and receives the result.
fn undifference_in_place(predictor: u8, diffs: &[i32], row: &mut [i32]) {
    let mut ra = 0;
    let mut rc = 0;
    for (i, (out, &diff)) in row.iter_mut().zip(diffs).enumerate() {
        let rb = *out;
        let prediction = if i == 0 {
            rb
        } else {
            predict(predictor, ra, rb, rc)
        };
        ra = diff.wrapping_add(prediction) & 0xffff;
        *out = ra;
        rc = rb;
    }
}
