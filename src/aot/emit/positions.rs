use crate::ir::generated::{ColumnAdjustment, SourcePositions};

pub fn source_positions(source: &[u8], line_starts: Vec<u32>) -> SourcePositions {
    let column_adjustments = compute_column_adjustments(source, &line_starts);
    SourcePositions {
        line_starts,
        column_adjustments,
    }
}

// `encoded`: pieces of `source` that stand alike, line breaks included, in the text whose lines and columns a stack trace shows (src/codegen/bundled-positions.ts).
pub fn source_positions_in_bundle(source: &[u8], encoded: &[u8]) -> SourcePositions {
    let mut bytes = encoded.iter();
    let mut read_number = || {
        let mut value = 0u32;
        for shift in (0..32).step_by(7) {
            let byte = *bytes.next()?;
            value |= u32::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    };
    let add_signed = |to: u32, difference: u32| match difference & 1 {
        0 => to.wrapping_add(difference >> 1),
        _ => to.wrapping_sub((difference >> 1) + 1),
    };
    let mut adjustments: Vec<ColumnAdjustment> = Vec::new();
    let mut last = ColumnAdjustment {
        offset: 0,
        line: 0,
        column: 0,
    };
    loop {
        let distance = read_number();
        let end = distance.map_or(source.len(), |distance| {
            source.len().min(last.offset as usize + distance as usize)
        });
        let piece = &source[last.offset as usize..end];
        for (line_break, _) in piece.iter().enumerate().filter(|(_, byte)| **byte == b'\n') {
            last = ColumnAdjustment {
                offset: (end - piece.len() + line_break + 1) as u32,
                line: last.line.wrapping_add(1),
                column: 0,
            };
            adjustments.push(last);
        }
        let (Some(_), Some(place)) = (distance, read_number()) else {
            break;
        };
        let column = last.column.wrapping_add(end as u32 - last.offset);
        let (line, column) = match place & 1 {
            0 => (last.line, Some(add_signed(column, place >> 1))),
            _ => (add_signed(last.line, place >> 1), read_number()),
        };
        let Some(column) = column else {
            break;
        };
        last = ColumnAdjustment {
            offset: end as u32,
            line,
            column,
        };
        adjustments.pop_if(|previous| previous.offset == last.offset);
        adjustments.push(last);
    }
    SourcePositions {
        line_starts: Vec::new(),
        column_adjustments: adjustments,
    }
}

fn compute_column_adjustments(source: &[u8], line_starts: &[u32]) -> Vec<ColumnAdjustment> {
    let mut adjustments = Vec::new();
    if source.is_ascii() {
        return adjustments;
    }
    for (line, &start) in line_starts.iter().enumerate() {
        let end = line_starts
            .get(line + 1)
            .map_or(source.len(), |&next| next as usize);
        let line_text = &source[start as usize..end];
        if line_text.is_ascii() {
            continue;
        }
        let mut at = 0;
        let mut line_excess_bytes = 0;
        while at < line_text.len() {
            let (length, excess_bytes) = match line_text[at] {
                0x00..=0xBF => {
                    at += 1;
                    continue;
                }
                0xC0..=0xDF => (2, 1),
                0xE0..=0xEF => (3, 2),
                0xF0..=0xFF => (4, 2),
            };
            at = (at + length).min(line_text.len());
            line_excess_bytes += excess_bytes;
            adjustments.push(ColumnAdjustment {
                offset: start + at as u32,
                line: line as u32,
                column: (at as u32).saturating_sub(line_excess_bytes),
            });
        }
    }
    adjustments
}
