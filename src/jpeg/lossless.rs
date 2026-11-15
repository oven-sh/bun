//! Lossless scans (jdlhuff.c, jddiffct.c, jdlossls.c).

use crate::bit_reader::Window;
use crate::header::{Scan, Segments};
use crate::huffman::{Alphabet, DecodeTables, MAX_QUICK_LENGTH, QUICK_CODES_IN_REFILL};
use crate::output::Output;
use crate::scan::{Layout, Region, Regions, Restarts};
use crate::{Error, Result, filled};

/// Turns `row` into the next row. `predict` gets the samples to the left, above and above left.
#[inline(always)]
fn undifference_with(differences: &[u16], row: &mut [u16], predict: impl Fn(i32, i32, i32) -> i32) {
    // In the first column, these make every predictor give the sample above.
    let [mut left, mut corner] = [row.first().copied().unwrap_or_default(); 2];
    for (sample, difference) in row.iter_mut().zip(differences) {
        left =
            difference.wrapping_add(predict(left.into(), (*sample).into(), corner.into()) as u16);
        corner = core::mem::replace(sample, left);
    }
}

fn undifference(predictor: u8, differences: &[u16], row: &mut [u16]) {
    match predictor {
        1 => undifference_with(differences, row, |a, _, _| a),
        2 => undifference_with(differences, row, |_, b, _| b),
        3 => undifference_with(differences, row, |_, _, c| c),
        4 => undifference_with(differences, row, |a, b, c| a + b - c),
        5 => undifference_with(differences, row, |a, b, c| a + ((b - c) >> 1)),
        6 => undifference_with(differences, row, |a, b, c| b + ((a - c) >> 1)),
        _ => undifference_with(differences, row, |a, b, _| (a + b) >> 1),
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
    let interval = usize::from(tables.restart_interval);
    if !interval.is_multiple_of(layout.mcus.wide) {
        return Err(Error::InvalidRestartInterval);
    }
    let mut restarts = Restarts::new(interval / layout.mcus.wide);

    let numbers = scan.components().iter().map(|it| it.dc_table);
    let shared_tables = DecodeTables::new(numbers, &tables.dc, Alphabet::Lossless)?;
    let tables = shared_tables.by_component()?;
    let from_zeros = tables.map(|table| table.search(0).value(0) as u16);

    if !is_only_scan {
        for part in layout.parts() {
            let plane = output.planes.get_mut(part.index).ok_or(Error::Internal)?;
            plane.make_room(layout.mcus.high.div_ceil(layout.rows_in_strip))?;
        }
    }

    // For each component: the differences of a row of MCUs, then the previous row of samples.
    let parts = layout.parts().iter();
    let regions = Regions::new(parts.map(|it| [it.index, layout.mcus.wide * it.h, it.v + 1]));
    let mut rows = filled(regions.len, 0u16)?;
    let slots = layout.slots(&regions);

    let middle = 1 << (precision - scan.al - 1);
    let mut window = Window::new(input);
    let mut bits = window.bits_from(0);
    for mcu_row in 0..layout.mcus.high {
        let mut starts_over = mcu_row == 0;
        if let Some(number) = restarts.take_due() {
            bits = window.restart(bits, number);
            starts_over = true;
        }
        restarts.advance(1);
        let has_data = window.has_data(bits);
        if has_data {
            let mut until_refill = 0;
            for mcu in 0..layout.mcus.wide {
                for slot in slots.as_slice() {
                    let table = slot.pick(&tables);
                    let quick = table.quick(bits.peek());
                    if until_refill == 0 {
                        if !window.has_data(bits) {
                            *slot.of(&mut rows, mcu)? = slot.pick(&from_zeros);
                            continue;
                        }
                        bits.ensure_margin(&mut window);
                        bits.refill(&window);
                        until_refill = QUICK_CODES_IN_REFILL;
                    }
                    until_refill -= 1;
                    *slot.of(&mut rows, mcu)? = if (1..=MAX_QUICK_LENGTH).contains(&quick.length())
                    {
                        quick.value(quick.take(&mut bits)) as u16
                    } else {
                        bits.refill(&window);
                        until_refill = 0;
                        let code = match quick.length() {
                            0 => table.search(bits.peek()),
                            _ => quick,
                        };
                        code.value(code.take(&mut bits)) as u16
                    };
                }
            }
        }

        for part in layout.parts() {
            let Region { start, stride } = regions.of(part.index);
            let rows = rows.get_mut(start..start + (part.v + 1) * stride);
            let (differences, row) = rows.ok_or(Error::Internal)?.split_at_mut(part.v * stride);
            let plane = output.planes.get_mut(part.index).ok_or(Error::Internal)?;
            for y in 0..part.v {
                let differences = differences.get(y * stride..).unwrap_or_default();
                if !has_data {
                    row.fill(middle);
                } else if starts_over && y == 0 {
                    row.get_mut(..1).unwrap_or_default().fill(middle);
                    undifference(1, differences, row);
                } else {
                    undifference(scan.ss, differences, row);
                }
                let out = plane.rows_from_mut(mcu_row * part.v + y);
                for (out, &sample) in out.iter_mut().zip(&*row) {
                    *out = (sample << scan.al) as u8;
                }
            }
        }
        if is_only_scan {
            output.finish_strip()?;
        }
    }
    Ok(())
}
