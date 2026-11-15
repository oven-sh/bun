//! Lossless scans (jdlhuff.c, jddiffct.c, jdlossls.c).

use crate::bit_reader::Window;
use crate::header::{MAX_COMPONENTS, Scan, Segments};
use crate::huffman::{Alphabet, DecodeTables, QUICK_CODES_IN_REFILL};
use crate::output::Output;
use crate::scan::{Layout, Region, Restarts};
use crate::{Error, Result, filled, wrapped, wrapped_mut};

/// Turns differences into samples. `predict` gets the sample to the left, the one above and the one above the first.
#[inline(always)]
fn undo(row: &mut [u16], above: &[u16], predict: impl Fn(i32, i32, i32) -> i32) {
    let ([first, row @ ..], [corner, above @ ..]) = (row, above) else {
        return;
    };
    *first = first.wrapping_add(*corner);
    let (mut left, mut corner) = (*first, *corner);
    for (sample, &up) in row.iter_mut().zip(above) {
        left = sample.wrapping_add(predict(left.into(), up.into(), corner.into()) as u16);
        (*sample, corner) = (left, up);
    }
}

fn undo_predictor(predictor: u8, row: &mut [u16], above: &[u16]) {
    match predictor {
        1 => undo(row, above, |a, _, _| a),
        2 => undo(row, above, |_, b, _| b),
        3 => undo(row, above, |_, _, c| c),
        4 => undo(row, above, |a, b, c| a + b - c),
        5 => undo(row, above, |a, b, c| a + ((b - c) >> 1)),
        6 => undo(row, above, |a, b, c| b + ((a - c) >> 1)),
        _ => undo(row, above, |a, b, _| (a + b) >> 1),
    }
}

/// Puts the samples into the planes of `output`. If `is_only_scan`, it also converts them.
pub(crate) fn decode_scan(
    Segments { input, tables, .. }: &mut Segments<'_>,
    precision: u8,
    scan: &Scan,
    layout: &Layout,
    output: &mut Output,
    is_only_scan: bool,
) -> Result<()> {
    if !matches!((scan.first, scan.last, scan.previous_shift), (1..=7, 0, 0))
        || scan.shift >= precision
    {
        return Err(Error::InvalidScan);
    }
    let interval = usize::from(tables.restart_interval);
    if !interval.is_multiple_of(layout.mcus.wide) {
        return Err(Error::InvalidRestartInterval);
    }
    let mut restarts = Restarts::new(interval / layout.mcus.wide);

    let numbers = scan.components().iter().map(|it| it.dc_table);
    let shared_tables = DecodeTables::new(numbers, &tables.dc, Alphabet::Lossless)?;
    let tables = shared_tables.dc_by_component(scan)?;
    let from_zeros = tables.map(|table| table.search(0).value(0) as u16);

    // For each component: the row above those of a row of MCUs, then those.
    let (mut regions, mut len) = ([Region::default(); MAX_COMPONENTS], 0);
    for part in layout.parts() {
        let stride = layout.mcus.wide * part.h;
        *wrapped_mut(&mut regions, part.index) = Region {
            start: len + stride,
            stride,
        };
        len += (1 + part.v) * stride;
    }
    let mut samples = filled(len, 0u16)?;
    let slots = layout.slots(&regions);

    let middle = 1 << (precision - scan.shift - 1);
    let mut window = Window::new(input);
    let mut bits = window.bits_from(0);
    for mcu_row in 0..layout.mcus.high {
        let mut starts_over = mcu_row == 0;
        if let Some(number) = restarts.due() {
            bits = window.restart(bits, number);
            starts_over = true;
        }
        restarts.advance(1);
        let has_data = window.has_data(bits);
        if has_data {
            let mut left = 0;
            for mcu in 0..layout.mcus.wide {
                for slot in slots.as_slice() {
                    let table = slot.pick(&tables);
                    let quick = table.quick(bits.peek());
                    if left == 0 {
                        if !window.has_data(bits) {
                            *slot.of(&mut samples, mcu)? = slot.pick(&from_zeros);
                            continue;
                        }
                        bits.start_block(&mut window);
                        bits.refill(&window);
                        left = QUICK_CODES_IN_REFILL;
                    }
                    left -= 1;
                    *slot.of(&mut samples, mcu)? = if quick.length() != 0 {
                        quick.value(quick.take(&mut bits)) as u16
                    } else {
                        bits.refill(&window);
                        left = 0;
                        let code = table.search(bits.peek());
                        code.value(code.take(&mut bits)) as u16
                    };
                }
            }
        }

        for part in layout.parts() {
            let Region { start, stride } = *wrapped(&regions, part.index);
            let rows = samples.get_mut(start - stride..start + part.v * stride);
            let rows = rows.ok_or(Error::Internal)?;
            let plane = output.planes.get_mut(part.index).ok_or(Error::Internal)?;
            for y in 0..part.v {
                let (above, below) = rows.split_at_mut((1 + y) * stride);
                let above = above.get_mut(y * stride..).unwrap_or_default();
                let row = below.get_mut(..stride).unwrap_or_default();
                if !has_data {
                    row.fill(middle);
                } else if starts_over && y == 0 {
                    if let [corner, ..] = above {
                        *corner = middle;
                    }
                    undo_predictor(1, row, above);
                } else {
                    undo_predictor(scan.first, row, above);
                }
                let out = plane.rows_from_mut(mcu_row * part.v + y);
                for (out, &sample) in out.iter_mut().zip(&*row) {
                    *out = (sample << scan.shift) as u8;
                }
            }
            rows.copy_within(part.v * stride.., 0);
        }
        if is_only_scan {
            output.finish_strip()?;
        }
    }
    Ok(())
}
