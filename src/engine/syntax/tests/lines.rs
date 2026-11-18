mod support;

use bun_engine_syntax::LineTable;
use support::in_each_width;

#[test]
fn each_terminator_ends_a_line() {
    for (source, starts) in [
        ("", &[0][..]),
        ("a\nb\n", &[0, 2, 4]),
        ("a\r\nb\rc\n\rd", &[0, 3, 5, 7, 8]),
        ("a\u{2028}b\r\u{2029}c", &[0, 2, 4, 5]),
    ] {
        in_each_width(source, |text| {
            let bytes = LineTable::encode(text).unwrap();
            let table = LineTable::read(&bytes).unwrap();
            for (line, &start) in (0..).zip(starts) {
                assert_eq!(table.line_and_column(start), (line, 0));
                assert_eq!(table.offset_of(text, line, 0), start);
            }
            assert_eq!(table.range_of(text, starts.len() as u32), None);
        });
    }
}

#[test]
fn positions_past_an_end_are_that_end() {
    in_each_width("ab\r\ncd", |text| {
        let bytes = LineTable::encode(text).unwrap();
        let table = LineTable::read(&bytes).unwrap();
        assert_eq!(table.range_of(text, 0), Some(0..2));
        assert_eq!(table.offset_of(text, 0, u32::MAX), 2);
        assert_eq!(table.offset_of(text, 2, 0), 6);
        assert_eq!(table.line_and_column(9), (1, 5));
    });
}

#[test]
fn long_lines() {
    let source = [
        "a\n",
        &"b".repeat(70_000),
        "\n\n",
        &"c".repeat(65_534),
        "\nd",
    ]
    .concat();
    in_each_width(&source, |text| {
        let bytes = LineTable::encode(text).unwrap();
        let table = LineTable::read(&bytes).unwrap();
        assert_eq!(table.line_and_column(70_001), (1, 69_999));
        assert_eq!(table.line_and_column(70_003), (2, 0));
        assert_eq!(table.line_and_column(135_539), (4, 0));
        assert_eq!(table.range_of(text, 3), Some(70_004..135_538));
    });
}

#[test]
fn many_lines() {
    let lines = (0..3000).map(|line| "x".repeat(line * 37 % 200));
    let source = lines.collect::<Vec<_>>().join("\r\n");
    in_each_width(&source, |text| {
        let bytes = LineTable::encode(text).unwrap();
        let table = LineTable::read(&bytes).unwrap();
        let mut start = 0;
        for line in 0..3000 {
            let end = start + line * 37 % 200;
            assert_eq!(table.range_of(text, line), Some(start..end));
            assert_eq!(table.line_and_column(start), (line, 0));
            assert_eq!(table.line_and_column(end), (line, end - start));
            start = end + 2;
        }
        assert_eq!(table.range_of(text, 3000), None);
    });
}

#[test]
fn a_pair_is_one_terminator_wherever_it_is() {
    for spaces in 0xfffd..0x1_0001 {
        in_each_width(&format!("{}\r\n\r1", " ".repeat(spaces as usize)), |text| {
            let bytes = LineTable::encode(text).unwrap();
            let table = LineTable::read(&bytes).unwrap();
            let starts = (0..).map_while(|line| Some(table.range_of(text, line)?.start));
            assert_eq!(starts.collect::<Vec<_>>(), [0, spaces + 2, spaces + 3]);
        });
    }
}

#[test]
fn damage_gives_positions_in_the_text() {
    in_each_width(&"line\n".repeat(200), |text| {
        let bytes = LineTable::encode(text).unwrap();
        for at in 0..bytes.len() {
            for byte in [0, 1, 0x7f, 0x80, 0xff] {
                let mut bytes = bytes.clone();
                bytes[at] = byte;
                let table = LineTable::read(&bytes).unwrap_or_default();
                for line in (0..220).step_by(7) {
                    assert!(table.line_and_column(line * 5).1 <= line * 5);
                    assert!(table.offset_of(text, line, 3) as usize <= text.len());
                }
            }
        }
    });
}
