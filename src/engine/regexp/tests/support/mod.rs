use bun_engine_regexp::Flags;
use bun_engine_standalone as _;
use bun_engine_text::Text;

pub(crate) fn flags(letters: &str) -> Flags {
    Flags::parse(Text::from_ascii(letters)).unwrap()
}

/// In each width that holds it.
pub(crate) fn in_each_width(text: &str, mut check: impl FnMut(Text<'_>)) {
    let units: Vec<u16> = text.encode_utf16().collect();
    let narrow: Option<Vec<u8>> = units.iter().map(|&unit| unit.try_into().ok()).collect();
    if let Some(narrow) = &narrow {
        check(Text::Latin1(narrow));
    }
    check(Text::Utf16(&units));
}
