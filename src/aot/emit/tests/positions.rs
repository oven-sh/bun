use crate::emit::{source_positions, source_positions_in_bundle};
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

const WRITTEN: &str = r#"const stream = require("node:stream");
// Nothing of this line is evaluated.
function check(value: unknown, name: string): void {
  if (typeof value !== "string") {
    throw $ERR_INVALID_ARG_TYPE(name, "string", value);
  }
  stream.$call(value!, false);
  (stream as any).end(name);
}
export default check;
"#;

const EVALUATED: &str = r#"(function (){"use strict";// module.ts
var $, stream = @getInternalField(12) || @createInternalModuleById(12);
function check(value, name) {
  if (typeof value !== "string")
    throw @makeErrorWithCode(118, name, "string", value);
  stream.@call(value, !1), stream.end(name);
}
$ = check;
done($);})"#;

fn find_text_behind(adjustments: &[ColumnAdjustment], in_written: &str) -> &'static str {
    let offset = WRITTEN.find(in_written).unwrap();
    let preceding = adjustments.partition_point(|it| it.offset as usize <= offset);
    let adjustment = &adjustments[preceding - 1];
    let line = EVALUATED.split('\n').nth(adjustment.line as usize).unwrap();
    &line[adjustment.column as usize + offset - adjustment.offset as usize..]
}

#[test]
fn tokens_of_a_module_are_found_in_the_text_that_is_evaluated() {
    // Word 2, `require`, stands for the word 2 words behind the one that a reading side by side comes to.
    let positions = source_positions_in_bundle(WRITTEN.as_bytes(), EVALUATED.as_bytes(), &[2, 5]);
    assert!(positions.line_starts.is_empty());
    let adjustments = &positions.column_adjustments;
    assert!(adjustments.is_sorted_by(|first, second| first.offset < second.offset));
    for (in_written, expected) in [
        (r#"("node:stream")"#, "(12)"),
        (
            r#"(name, "string", value)"#,
            r#"(118, name, "string", value)"#,
        ),
        ("$ERR_INVALID_ARG_TYPE", "@makeErrorWithCode("),
        ("(value!, false)", "(value, !1)"),
        ("false)", "!1)"),
        (".$call", ".@call("),
        (" as any).end(name)", ".end(name)"),
        ("(name);", "(name)"),
        ("check(value", "check(value"),
        ("check;", "check;"),
    ] {
        let found = find_text_behind(adjustments, in_written);
        assert!(found.starts_with(expected), "{in_written}: {found}");
    }
}

#[test]
fn what_stands_alike_in_a_bundle_goes_on_over_line_breaks() {
    let positions = source_positions_in_bundle(b"ab cd\nef  gh\n\nk", b"{ab cd\nef gh\nk", &[]);
    assert_eq!(
        positions.column_adjustments,
        [
            adjustment(0, 0, 1),
            adjustment(6, 1, 0),
            adjustment(10, 1, 3),
            adjustment(13, 2, 0),
            adjustment(14, 2, 0),
        ]
    );
}

#[test]
fn a_word_that_was_moved_to_the_front_is_found_there() {
    let written = b"first(a);\nif (second) third();";
    let evaluated = b"if (first(a), second)\n  third();";
    let positions = source_positions_in_bundle(written, evaluated, &[]);
    let find = |offset: u32| {
        let adjustments = &positions.column_adjustments;
        let preceding = adjustments.partition_point(|it| it.offset <= offset);
        let adjustment = &adjustments[preceding - 1];
        (
            adjustment.line,
            adjustment.column + offset - adjustment.offset,
        )
    };
    assert_eq!(find(0), (0, 4));
    assert_eq!(find(5), (0, 9));
    assert_eq!(find(6), (0, 10));
    assert_eq!(find(10), (0, 0));
    assert_eq!(find(14), (0, 14));
    assert_eq!(find(22), (1, 2));
    assert_eq!(find(27), (1, 7));
}

#[test]
fn the_words_of_a_comment_are_passed_over() {
    let written = "//a b c d e f g h i j\nk /* a b c d e f g h i j\na */ l /**/ x m /* */ n";
    let positions = source_positions_in_bundle(written.as_bytes(), b"k l m n", &[]);
    let adjustments = &positions.column_adjustments;
    for (word, column) in [("k", 0), ("l", 2), ("m", 4), ("n", 6)] {
        let offset = written.find(word).unwrap() as u32;
        let preceding = adjustments.partition_point(|it| it.offset <= offset);
        let adjustment = &adjustments[preceding - 1];
        let place = (
            adjustment.line,
            adjustment.column + offset - adjustment.offset,
        );
        assert_eq!(place, (0, column), "{word}");
    }
}

#[test]
fn corrections_that_do_not_fit_the_texts_stop_nothing() {
    let far = [0xFF, 0xFF, 0xFF, 0xFF, 0x0F];
    let records: [&[u8]; 8] = [
        &[],
        &[0x80],
        &[0],
        &[0, 0, 0, 0, 0, 0],
        &[0, 2, 0, 2, 0, 2],
        &[1, 200, 1, 1, 201, 1],
        &[
            0, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 1, 0xFE, 0xFF, 0xFF, 0xFF, 0x0F,
        ],
        &far,
    ];
    let texts: [&[u8]; 6] = [
        b"",
        b"a",
        b"!",
        b"// a b c",
        b"a /* b\nc",
        WRITTEN.as_bytes(),
    ];
    for corrections in records {
        for written in texts {
            for evaluated in texts {
                let positions = source_positions_in_bundle(written, evaluated, corrections);
                let adjustments = positions.column_adjustments;
                assert!(adjustments.is_sorted_by(|first, second| first.offset < second.offset));
            }
        }
    }
}
