#[cfg(test)]
mod tests;

use super::generated::NameClass;
use bun_sema::atom::number_to_string;

const MAX_ARRAY_INDEX: u64 = u32::MAX as u64 - 1;
const MAX_EXACT_INTEGER_DIGITS: usize = 15;
const MAX_CANONICAL_NUMERIC_STRING_LENGTH: usize = 32;

type ClassifiedWord = (&'static [u8], NameClass);

const CLASSIFIED_WORD_COUNT: usize = count_classified_words();
const CLASSIFIED_WORDS: [ClassifiedWord; CLASSIFIED_WORD_COUNT] = collect_classified_words();
const MAX_WORD_LENGTH: usize = longest_word_length();

pub fn classify_name(text: &[u8]) -> NameClass {
    match text {
        [] => NameClass::Ordinary,
        b"0" => NameClass::Index,
        b"-0" | b"Infinity" | b"-Infinity" | b"NaN" => NameClass::CanonicalNumericString,
        [b'0'..=b'9' | b'-', ..] => match parse_exact_integer(text) {
            Some(0..=MAX_ARRAY_INDEX) => NameClass::Index,
            Some(_) => NameClass::CanonicalNumericString,
            None if is_canonical_numeric_string(text) => NameClass::CanonicalNumericString,
            None => NameClass::Ordinary,
        },
        _ => classify_word(text),
    }
}

fn parse_exact_integer(text: &[u8]) -> Option<u64> {
    let is_exact_integer = text.len() <= MAX_EXACT_INTEGER_DIGITS
        && !text.starts_with(b"0")
        && text.iter().all(u8::is_ascii_digit);
    let digits = text.iter().map(|digit| u64::from(digit - b'0'));
    is_exact_integer.then(|| digits.fold(0, |value, digit| value * 10 + digit))
}

fn is_canonical_numeric_string(text: &[u8]) -> bool {
    if text.len() > MAX_CANONICAL_NUMERIC_STRING_LENGTH {
        return false;
    }
    let number = core::str::from_utf8(text)
        .ok()
        .and_then(|text| text.parse::<f64>().ok());
    number.is_some_and(|number| number_to_string(number) == text)
}

fn classify_word(text: &[u8]) -> NameClass {
    if text.len() > MAX_WORD_LENGTH {
        return NameClass::Ordinary;
    }
    match CLASSIFIED_WORDS.iter().find(|(word, _)| *word == text) {
        Some(&(_, class)) => class,
        None => NameClass::Ordinary,
    }
}

const fn split_first_word(words: &'static [u8]) -> Option<(&'static [u8], &'static [u8])> {
    let mut start = 0;
    while start < words.len() && words[start] == b' ' {
        start += 1;
    }
    let mut end = start;
    while end < words.len() && words[end] != b' ' {
        end += 1;
    }
    if start == end {
        return None;
    }
    let (through_word, rest) = words.split_at(end);
    let (_, word) = through_word.split_at(start);
    Some((word, rest))
}

const fn count_classified_words() -> usize {
    let mut count = 0;
    let mut class_index = 0;
    while class_index < NameClass::COUNT {
        let mut words = NameClass::ALL[class_index].words().as_bytes();
        while let Some((_, rest)) = split_first_word(words) {
            count += 1;
            words = rest;
        }
        class_index += 1;
    }
    count
}

const fn collect_classified_words() -> [ClassifiedWord; CLASSIFIED_WORD_COUNT] {
    let unfilled: ClassifiedWord = (&[], NameClass::Ordinary);
    let mut classified = [unfilled; CLASSIFIED_WORD_COUNT];
    let mut count = 0;
    let mut class_index = 0;
    while class_index < NameClass::COUNT {
        let class = NameClass::ALL[class_index];
        let mut words = class.words().as_bytes();
        while let Some((text, rest)) = split_first_word(words) {
            classified[count] = (text, class);
            count += 1;
            words = rest;
        }
        class_index += 1;
    }
    classified
}

const fn longest_word_length() -> usize {
    let mut longest = 0;
    let mut index = 0;
    while index < CLASSIFIED_WORD_COUNT {
        let length = CLASSIFIED_WORDS[index].0.len();
        if length > longest {
            longest = length;
        }
        index += 1;
    }
    longest
}
