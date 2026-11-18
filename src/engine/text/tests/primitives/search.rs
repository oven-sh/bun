use bun_engine_text::Text;

use crate::support::*;

fn places(haystack: &[u16], needle: &[u16]) -> Vec<usize> {
    (0..(haystack.len() + 1).saturating_sub(needle.len()))
        .filter(|&at| haystack[at..].starts_with(needle))
        .collect()
}

fn check(haystack: &[u16], needle: &[u16], starts: &[usize]) {
    let places = places(haystack, needle);
    let mut apart: Vec<usize> = Vec::new();
    for &at in &places {
        if apart.last().is_none_or(|&last| at >= last + needle.len()) {
            apart.push(at);
        }
    }
    each_pair(haystack, needle, |text, wanted| {
        assert_eq!(text.matches(wanted).collect::<Vec<_>>(), apart);
        assert_eq!(text.matches(wanted).count(), apart.len());
        for &start in starts {
            let after = places.iter().find(|&&at| at >= start).copied();
            assert_eq!(text.find(wanted, start), after, "{start}");
            let before = places.iter().rfind(|&&at| at <= start).copied();
            assert_eq!(text.rfind(wanted, start), before, "{start}");
        }
    });
}

#[test]
fn one_unit_anywhere() {
    for length in lengths() {
        each_width(&vec![0x61; length], |text| {
            assert_eq!(text.count_unit(0x61), length);
            assert_eq!(text.find_unit(0x161, 0), None);
            assert_eq!(text.rfind_unit(0x62, usize::MAX), None);
        });
        for at in indices(length) {
            let mut units = vec![0x61; length];
            units[at] = 0x62;
            each_width(&units, |text| {
                assert_eq!(text.find_unit(0x62, 0), Some(at));
                assert_eq!(text.find_unit(0x62, at), Some(at));
                assert_eq!(text.find_unit(0x62, at + 1), None);
                assert_eq!(text.rfind_unit(0x62, length), Some(at));
                assert_eq!(text.rfind_unit(0x62, at + 1), Some(at));
                assert_eq!(text.rfind_unit(0x62, at), None);
                assert_eq!(text.count_unit(0x62), 1);
            });
        }
    }
}

#[test]
fn counts_past_the_range_of_a_unit() {
    let length = if cfg!(miri) { 300 } else { 3_000_000 };
    each_width(&vec![7; length], |text| {
        assert_eq!(text.count_unit(7), length)
    });
}

#[test]
fn one_needle_anywhere() {
    for length in lengths() {
        for needle in ["b", "bc", "aba", "baaaaaaab", &"ab".repeat(20)] {
            let needle = wide(needle);
            for at in indices((length + 1).saturating_sub(needle.len())).step_by(3) {
                let mut haystack = vec![0x61; length];
                haystack[at..at + needle.len()].copy_from_slice(&needle);
                check(&haystack, &needle, &[0, at, at + 1, usize::MAX]);
            }
        }
    }
}

#[test]
fn small_alphabets() {
    let mut random = Random::new();
    for round in 0..if cfg!(miri) { 40 } else { 4000 } {
        let alphabet: &[u16] = random.pick(&[&[0x61, 0x62], &[0x61, 0x62, 0x63], &[0x61, 0x161]]);
        let length = random.below(if round % 8 == 0 { 700 } else { 90 });
        let haystack = random.units(length, alphabet);
        let size = random.below(12).min(length);
        let from = random.below(length - size + 1);
        let mut needle = haystack[from..from + size].to_vec();
        if round % 3 == 0 {
            needle.push(random.pick(alphabet));
        }
        check(&haystack, &needle, &[0, random.below(length + 2), length]);
    }
}

#[test]
fn periodic_texts() {
    let mut random = Random::new();
    for round in 0..if cfg!(miri) { 4 } else { 400 } {
        let period = 1 + random.below(5);
        let unit = random.units(period, &[0x61, 0x62]);
        let repeat = |length| {
            unit.iter()
                .copied()
                .cycle()
                .take(length)
                .collect::<Vec<_>>()
        };
        let size = 2 + random.below(80);
        let mut haystack = repeat(if cfg!(miri) { 300 } else { 6000 });
        let gap = size - 1 + random.below(2) * (round % 2);
        for at in (0..haystack.len()).step_by(gap) {
            haystack[at] ^= 3;
        }
        let needle = repeat(size);
        check(&haystack, &needle, &[0, haystack.len()]);
        let at = random.below(haystack.len() - size);
        haystack[at..at + size].copy_from_slice(&needle);
        check(&haystack, &needle, &[0, haystack.len()]);
    }
}

#[test]
fn the_empty_needle_is_everywhere() {
    check(&wide("abc"), &[], &[0, 3, 4]);
    check(&[], &[], &[0, 1]);
}

#[test]
fn ignoring_ascii_case() {
    let text = Text::from_ascii("Connection: keep-alive, UPGRADE");
    assert_eq!(
        text.find_ignore_ascii_case(Text::from_ascii("upgrade")),
        Some(24)
    );
    assert_eq!(
        text.find_ignore_ascii_case(Text::Utf16(&wide("KEEP"))),
        Some(12)
    );
    assert_eq!(
        text.find_ignore_ascii_case(Text::from_ascii("upgrades")),
        None
    );
    assert_eq!(text.find_ignore_ascii_case(Text::EMPTY), Some(0));
}
