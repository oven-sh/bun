use crate::emit::source_positions;
use crate::ir::generated::ColumnAdjustment;

fn find_line_starts(text: &str) -> Vec<u32> {
    let mut starts = vec![0];
    for (offset, byte) in (1..).zip(text.bytes()) {
        if byte == b'\n' {
            starts.push(offset);
        }
    }
    starts
}

fn adjustments_of(text: &str) -> Vec<ColumnAdjustment> {
    let positions = source_positions(text.as_bytes(), find_line_starts(text));
    positions.column_adjustments
}

fn adjustment(offset: u32, line: u32, column: u32) -> ColumnAdjustment {
    ColumnAdjustment {
        offset,
        line,
        column,
    }
}

#[test]
fn line_starts_are_kept() {
    let positions = source_positions(b"a\nbc\n", vec![0, 2, 5]);
    assert_eq!(positions.line_starts, [0, 2, 5]);
}

#[test]
fn ascii_has_no_adjustment() {
    assert!(adjustments_of("").is_empty());
    assert!(adjustments_of("let a = 1;\nlet b = 2;\n").is_empty());
}

#[test]
fn each_length() {
    assert_eq!(adjustments_of("\u{e9}"), [adjustment(2, 0, 1)]);
    assert_eq!(adjustments_of("\u{20AC}"), [adjustment(3, 0, 1)]);
    assert_eq!(adjustments_of("\u{1F600}"), [adjustment(4, 0, 2)]);
}

#[test]
fn lines_are_indexed() {
    let expected = [adjustment(2, 0, 1), adjustment(7, 3, 1)];
    assert_eq!(adjustments_of("\u{e9}\n\n\n\u{e9}"), expected);
}

#[test]
fn ascii_lines_between_other_lines_are_skipped() {
    let expected = [adjustment(3, 0, 2), adjustment(13, 2, 1)];
    assert_eq!(adjustments_of("a\u{e9}\nplain\n\u{20AC}"), expected);
}

#[test]
fn adjacent_characters() {
    let expected = [
        adjustment(3, 0, 2),
        adjustment(6, 0, 3),
        adjustment(10, 0, 5),
        adjustment(12, 0, 6),
    ];
    assert_eq!(adjustments_of("a\u{e9}\u{20AC}\u{1F600}\u{e9}b"), expected);
}

#[test]
fn column_formula() {
    let text = "a\u{e9}b\n\u{20AC}\u{1F600}x\nplain\n\u{e9}\u{e9}";
    let line_starts = find_line_starts(text);
    let adjustments = adjustments_of(text);
    assert!(adjustments.is_sorted_by(|first, second| first.offset < second.offset));
    let boundaries = text.char_indices().map(|(offset, _)| offset);
    for position in boundaries.chain([text.len()]) {
        let line = line_starts.partition_point(|&start| start as usize <= position) - 1;
        let line_start = line_starts[line] as usize;
        let preceding = adjustments.partition_point(|it| it.offset as usize <= position);
        let adjustment = preceding.checked_sub(1).map(|last| &adjustments[last]);
        let found = match adjustment.filter(|it| it.offset as usize > line_start) {
            Some(it) => (
                it.line as usize,
                it.column as usize + position - it.offset as usize,
            ),
            None => (line, position - line_start),
        };
        let expected_column = text[line_start..position].encode_utf16().count();
        assert_eq!(found, (line, expected_column), "{position}");
    }
}
