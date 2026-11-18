use bun_engine_text::{Text, scan, with_text};

use crate::support::*;

#[test]
fn positions_of_a_test() {
    let mut random = Random::new();
    let test = |unit: u16| (unit == 0x62) | (unit > 0xf0);
    for length in lengths() {
        for alphabet in [
            &[0x61, 0x62][..],
            &[0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x63, 0xf1],
        ] {
            let units = random.units(length, alphabet);
            let expected: Vec<usize> = (0..length).filter(|&at| test(units[at])).collect();
            each_width(&units, |text| {
                with_text!(text, |it| {
                    assert_eq!(scan::positions(it, test).collect::<Vec<_>>(), expected);
                    assert_eq!(scan::position(it, test), expected.first().copied());
                    assert_eq!(scan::rposition(it, test), expected.last().copied());
                });
                assert_eq!(text.all(|unit| !test(unit)), expected.is_empty());
                assert_eq!(text.position(length + 1, test), None);
            });
        }
    }
}

#[test]
fn runs_end_at_the_first_other_unit() {
    type Scan = fn(Text<'_>) -> usize;
    let scans: [(Scan, &str, &str); 4] = [
        (
            |text| with_text!(text, |it| scan::json_string_run_len(it)),
            " !#[]\u{7f}\u{a2}\u{ff}\u{122}\u{15c}\u{2028}",
            "\0\n\u{1f}\"\\",
        ),
        (
            |text| with_text!(text, |it| scan::json_white_space_len(it)),
            " \t\r\n",
            "\0\u{b}\u{c}!\u{a0}\u{120}",
        ),
        (
            |text| with_text!(text, |it| scan::ascii_identifier_run_len(it)),
            "azAZ09$_",
            "/:@[`{#%^\u{c1}\u{e1}\u{161}",
        ),
        (
            |text| {
                with_text!(text, |it| scan::find_line_terminator(it)
                    .unwrap_or(it.len()))
            },
            "\t\u{b}\u{c}()\u{85}\u{10a}\u{2027}\u{202a}",
            "\n\r\u{2028}\u{2029}",
        ),
    ];
    let mut random = Random::new();
    for (run_len, inside, outside) in scans {
        let (inside, outside) = (wide(inside), wide(outside));
        let narrow: Vec<u16> = inside.iter().copied().filter(|&it| it < 0x100).collect();
        for length in lengths() {
            let units = random.units(length, if length % 3 == 0 { &inside } else { &narrow });
            each_width(&units, |text| assert_eq!(run_len(text), length));
            for at in indices(length) {
                let mut units = units.clone();
                units[at] = random.pick(&outside);
                each_width(&units, |text| assert_eq!(run_len(text), at));
            }
        }
    }
}

#[test]
fn trimming() {
    let is_space = |unit| unit == 0x20;
    for (text, range) in [("", 0..0), ("   ", 3..3), ("a", 0..1), (" a b  ", 1..4)] {
        each_width(&wide(text), |text| {
            assert_eq!(text.trimmed_range(is_space), range);
            assert!(text.trim_matches(is_space) == text.slice(range.clone()));
        });
    }
}
