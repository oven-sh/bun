mod support;

use std::sync::Arc;

use bun_engine_intl::segmenter::{Granularity, Segment, Segmenter};
use bun_engine_intl::{Cache, Case, Named, NormalizationForm, normalize, transform_case};
use bun_engine_text::{StringRef, Text};
use bun_icu::Buffer;
use bun_icu::break_iterator::{BreakRules, Kind};
use bun_icu::normalizer::Form;
use support::{locales, narrow, units, wide};

fn segments(granularity: Granularity, text: StringRef) -> Vec<Segment> {
    let cache = Cache::default();
    let segmenter = Segmenter::new(&cache, &locales(&cache, "en"), granularity).unwrap();
    let segments = segmenter.segment(text).unwrap();
    let iterator = segments.iterate();
    let all: Vec<_> = core::iter::from_fn(|| iterator.next().unwrap()).collect();
    assert_eq!(iterator.next(), Ok(None));
    for segment in all.iter().rev().take(64) {
        for index in segment.range.clone() {
            assert_eq!(
                segments.containing(index as f64).unwrap().as_ref(),
                Some(segment)
            );
        }
    }
    let length = all.last().map_or(0, |it| it.range.end);
    for outside in [-1.0, length as f64, f64::INFINITY] {
        assert_eq!(segments.containing(outside), Ok(None));
    }
    all
}

fn ends(granularity: Granularity, text: StringRef) -> Vec<usize> {
    (segments(granularity, text).iter().map(|it| it.range.end)).collect()
}

#[test]
fn granularities() {
    assert_eq!(ends(Granularity::Grapheme, narrow("")), [0usize; 0]);
    assert_eq!(
        ends(Granularity::Grapheme, narrow("a\r\n\u{e9}")),
        [1, 3, 4]
    );
    let text = "ab\u{301}\u{1f1ef}\u{1f1f5}\u{1f44d}\u{1f3fd}cd\u{1100}\u{1161}";
    assert_eq!(
        ends(Granularity::Grapheme, narrow(text)),
        [1, 3, 7, 11, 12, 13, 15]
    );
    assert_eq!(ends(Granularity::Sentence, narrow("One. Two!")), [5, 9]);
    let words = segments(Granularity::Word, narrow("can't 3.5, \u{65e5}\u{672c}"));
    let words: Vec<_> = (words.iter())
        .map(|it| (it.range.end, it.is_word_like.unwrap()))
        .collect();
    assert_eq!(
        words,
        [
            (5, true),
            (6, false),
            (9, true),
            (10, false),
            (11, false),
            (13, true)
        ]
    );
}

#[test]
fn segments_far_from_a_boundary() {
    for (granularity, piece, length) in [
        (Granularity::Grapheme, "\u{1f1ef}", 4),
        (Granularity::Word, "\u{e01}\u{e32}", 2),
        (Granularity::Word, "a", 3000),
        (Granularity::Sentence, "a, ", 9000),
    ] {
        let found = segments(granularity, narrow(&piece.repeat(3000)));
        assert!(found.iter().all(|it| it.range.len() == length), "{piece}");
    }
}

#[test]
fn graphemes_around_every_code_unit() {
    let rules = BreakRules::open(Kind::Grapheme, c"en").unwrap();
    for neighbor in [0x61, 0xac00] {
        let text: Vec<u16> = (0..=u16::MAX).flat_map(|it| [it, it, neighbor]).collect();
        let actual = ends(
            Granularity::Grapheme,
            StringRef::from_text(Text::Utf16(&text)),
        );
        let mut expected = rules.iterate(Arc::new(text)).unwrap();
        assert!(
            actual
                .into_iter()
                .eq(core::iter::from_fn(|| expected.next()))
        );
    }
}

#[test]
fn normalization_of_either_width() {
    let forms = [Form::Nfc, Form::Nfd, Form::Nfkc, Form::Nfkd];
    let latin1: String = ('\0'..='\u{ff}').collect();
    let after_ascii = "a".repeat(32) + "\u{30a}\u{212b}\u{fb01}";
    let composing = "x\u{301}\u{3042}";
    for (&form, icu_form) in NormalizationForm::ALL.iter().zip(forms) {
        for text in [&latin1, &after_ascii, composing, "abc", ""] {
            let mut expected = Buffer::new();
            icu_form.normalize(&units(text), &mut expected).unwrap();
            let expected = (*expected != *units(text)).then_some(Text::Utf16(&expected));
            for string in [narrow(text), wide(text)] {
                let normalized = normalize(string.text(), form).unwrap();
                assert_eq!(normalized.as_ref().map(|it| it.text()), expected);
            }
        }
    }
}

#[test]
fn case_by_language() {
    let mut cache = Cache::default();
    let transform = |cache: &Cache, tag: Option<&str>, case, text| {
        let requested = tag.map(|tag| locales(cache, tag));
        let requested = requested.as_ref().map_or(&[][..], |it| it);
        let changed = transform_case(cache, narrow(text).text(), requested, case).unwrap();
        changed.map(|it| it.to_string())
    };
    for (tag, case, text, expected) in [
        ("tr-TR", Case::Lower, "I", Some("\u{131}")),
        ("az-Latn-u-kn", Case::Upper, "i", Some("\u{130}")),
        ("lt", Case::Lower, "\u{cc}", Some("i\u{307}\u{300}")),
        ("el", Case::Upper, "\u{3ac}", Some("\u{391}")),
        ("trv", Case::Lower, "I", Some("i")),
        ("tr", Case::Lower, "a", None),
        ("en", Case::Upper, "A", None),
    ] {
        assert_eq!(
            transform(&cache, Some(tag), case, text).as_deref(),
            expected
        );
    }
    assert_eq!(transform(&cache, None, Case::Lower, "I").unwrap(), "i");
    cache.set_preferred_languages(&["x", "tr-u-kn"].map(Text::from_ascii));
    assert_eq!(
        transform(&cache, None, Case::Lower, "I").unwrap(),
        "\u{131}"
    );
}

#[test]
fn segments_are_found_in_any_order() {
    let stretch = |unit: &str| unit.repeat(1500);
    let parts = [
        "a b. C",
        "\u{e01}\u{e32}",
        " d\n",
        "\u{1f1ef}",
        ". E f",
        "\u{915}\u{94d}",
        "g. h",
    ];
    let (cache, text) = (Cache::default(), wide(&parts.map(stretch).concat()));
    for granularity in [
        Granularity::Grapheme,
        Granularity::Word,
        Granularity::Sentence,
    ] {
        let segmenter = Segmenter::new(&cache, &locales(&cache, "en"), granularity).unwrap();
        let segments = segmenter.segment(text.clone()).unwrap();
        let iterator = segments.iterate();
        let all: Vec<_> = core::iter::from_fn(|| iterator.next().unwrap()).collect();
        for step in 0..600 {
            let index = step * 7919 % text.len();
            let expected = &all[all.partition_point(|it| it.range.end <= index)];
            assert_eq!(
                segments.containing(index as f64).unwrap().as_ref(),
                Some(expected)
            );
        }
    }
}
