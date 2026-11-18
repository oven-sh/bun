#![allow(dead_code, unreachable_pub)]

use bun_engine_intl::{Cache, Error, LanguageTag, Named, Parts};
use bun_engine_standalone as _;
use bun_engine_text::{StringRef, Text};

pub fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// Latin-1 if the characters allow it.
pub fn narrow(text: &str) -> StringRef {
    StringRef::try_narrowed(Text::Utf16(&units(text))).unwrap()
}

pub fn wide(text: &str) -> StringRef {
    StringRef::from_text(Text::Utf16(&units(text)))
}

pub fn locales(cache: &Cache, tag: &str) -> [LanguageTag; 1] {
    [cache.canonicalize(&narrow(tag)).unwrap()]
}

pub fn strings(list: &[StringRef]) -> Vec<String> {
    list.iter().map(StringRef::to_string).collect()
}

pub fn describe_error(error: &Error) -> String {
    format!("{:?}: {}", error.kind(), error.message())
}

/// `kind:value`, then the unit and the source.
pub fn describe_parts(parts: &Parts) -> Vec<String> {
    (parts.iter().map(Result::unwrap))
        .map(|(part, value)| {
            let mut text = format!("{}:{value}", part.kind.as_str());
            let names = [part.unit.map(Named::as_str), part.source.map(Named::as_str)];
            for name in names.into_iter().flatten() {
                text = text + ":" + name;
            }
            text
        })
        .collect()
}

/// Those that are a language and nothing else.
pub fn languages() -> impl Iterator<Item = &'static str> {
    (bun_icu::locale::available().map(|id| id.to_str().unwrap())).filter(|id| id.len() <= 3)
}

pub struct Random(pub u32);

impl Random {
    pub fn below(&mut self, limit: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0 as usize % limit
    }

    pub fn text(&mut self, alphabet: &[char], max_length: usize) -> String {
        (0..self.below(max_length + 1))
            .map(|_| alphabet[self.below(alphabet.len())])
            .collect()
    }
}
