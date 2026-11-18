use bun_engine_standalone as _;
use bun_engine_text::{AllocError, StringRef, Text};
use bun_engine_unicode::{to_lower_case, to_upper_case};

type Convert = fn(Text<'_>) -> Result<Option<StringRef>, AllocError>;

/// In each width that holds it, and at each position of a chunk.
fn check(convert: Convert, padding: char, text: &str, expected: &str) {
    for (before, after) in (0..34).flat_map(|before| [(before, 0), (before, 20)]) {
        let pad = |middle: &str| {
            let padding = padding.to_string();
            padding.repeat(before) + middle + &padding.repeat(after)
        };
        let units: Vec<u16> = pad(text).encode_utf16().collect();
        let narrow: Option<Vec<u8>> = units.iter().map(|&unit| unit.try_into().ok()).collect();
        let narrow = narrow.as_deref().map(Text::Latin1);
        for input in narrow.into_iter().chain([Text::Utf16(&units)]) {
            let output = convert(input).unwrap().map(|it| it.to_string());
            assert_eq!(output, (text != expected).then(|| pad(expected)));
        }
    }
}

#[test]
fn lower_case() {
    for (text, expected) in [
        ("", ""),
        ("abc×÷ßÿµ", "abc×÷ßÿµ"),
        ("@AZ[`az{", "@az[`az{"),
        ("ÀÖ×ØÞß", "àö×øþß"),
        ("İI", "i\u{307}i"),
        ("ǄǅΩK", "ǆǆωk"),
        ("𐐀😀𞤡", "𐐨😀𞥃"),
        ("Ａ漢ᲐᎠ", "ａ漢აꭰ"),
        ("Σ", "σ"),
        ("AΣ", "aς"),
        ("AΣB", "aσb"),
        ("A.'Σ.", "a.'ς."),
        ("AΣ.𐐨", "aσ.𐐨"),
        ("𐐨\u{1d242}Σ", "𐐨\u{1d242}ς"),
        ("\u{345}Σ", "\u{345}σ"),
        ("AΣ\u{345}", "aς\u{345}"),
    ] {
        check(to_lower_case, ' ', text, expected);
        check(to_lower_case, '字', text, expected);
    }
}

#[test]
fn upper_case() {
    for (text, expected) in [
        ("", ""),
        ("ABC×÷ª", "ABC×÷ª"),
        ("@AZ[`az{", "@AZ[`AZ{"),
        ("àö÷øþ", "ÀÖ÷ØÞ"),
        ("aßb", "ASSB"),
        ("µ", "Μ"),
        ("ßÿ", "SSŸ"),
        ("ıſǅς", "ISǄΣ"),
        ("ŉΐﬃßᾳ", "ʼNΙ\u{308}\u{301}FFISSΑΙ"),
        ("𐐨😀𞥃", "𐐀😀𞤡"),
        ("ａ漢აꭰ", "Ａ漢ᲐᎠ"),
    ] {
        check(to_upper_case, ' ', text, expected);
        check(to_upper_case, '😀', text, expected);
    }
}

#[test]
fn a_character_converts_alike_wherever_it_is() {
    for convert in [to_lower_case as Convert, to_upper_case] {
        for unit in (0..=u16::MAX).filter(|&unit| unit != 0x3a3) {
            let alone = convert(Text::Utf16(&[unit])).unwrap();
            let repeated = convert(Text::Utf16(&[unit; 16])).unwrap();
            assert_eq!(
                repeated.map(|it| it.to_string()),
                alone.map(|it| it.to_string().repeat(16))
            );
        }
        for c in (0x1_0000..0x2_0000).filter_map(char::from_u32) {
            let units: Vec<u16> = c.to_string().repeat(8).encode_utf16().collect();
            let alone = convert(Text::Utf16(&units[..2])).unwrap();
            assert_eq!(
                convert(Text::Utf16(&units))
                    .unwrap()
                    .map(|it| it.to_string()),
                alone.map(|it| it.to_string().repeat(8))
            );
        }
    }
}

#[test]
fn lone_surrogates_stay() {
    let units = [0xdc28, 0x61, 0xd801, 0x61, 0xd801];
    let upper = to_upper_case(Text::Utf16(&units)).unwrap().unwrap();
    assert_eq!(
        upper.text(),
        Text::Utf16(&[0xdc28, 0x41, 0xd801, 0x41, 0xd801])
    );
}
