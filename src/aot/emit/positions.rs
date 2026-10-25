use crate::ir::generated::{ColumnAdjustment, SourcePositions};

pub fn source_positions(source: &[u8], line_starts: Vec<u32>) -> SourcePositions {
    let column_adjustments = compute_column_adjustments(source, &line_starts);
    SourcePositions {
        line_starts,
        column_adjustments,
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
