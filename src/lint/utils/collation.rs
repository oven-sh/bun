//! `String.prototype.localeCompare` and `Intl.Collator`: the root collation of CLDR, which is that
//! of English. Exact for ASCII. Other characters come after ASCII in the order of their code
//! points: no accents are folded (`é` is not an `e`) and nothing expands (`ß` is not `ss`).

use bun_core::strings;
use std::cmp::Ordering;

/// The characters of ASCII before the digits, in the order of the collation.
const BEFORE_DIGITS: &[u8] = b"\t\n\x0B\x0C\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
const DIGITS: u32 = BEFORE_DIGITS.len() as u32;
const LETTERS: u32 = DIGITS + 10;
const AFTER_ASCII: u32 = 0x100;

/// The primary weight of the character at the start of `text`, and its length in bytes. The weight
/// is `None` for a control character, which the collation ignores.
fn primary_weight(text: &[u8]) -> Option<(Option<u32>, usize)> {
    let &byte = text.first()?;
    Some(match byte {
        b'0'..=b'9' => (Some(DIGITS + u32::from(byte - b'0')), 1),
        b'a'..=b'z' | b'A'..=b'Z' => (
            Some(LETTERS + u32::from(byte.to_ascii_lowercase() - b'a')),
            1,
        ),
        0x80.. => {
            let mut code_points = strings::wtf8_codepoints(text);
            let c = code_points.next().map_or(0, |it| it.1);
            let lower = char::from_u32(c)
                .and_then(|c| c.to_lowercase().next())
                .map_or(c, u32::from);
            (
                Some(AFTER_ASCII + lower),
                code_points.next().map_or(text.len(), |it| it.0),
            )
        }
        _ => (
            strings::index_of_char_usize(BEFORE_DIGITS, byte).map(|at| at as u32),
            1,
        ),
    })
}

/// The characters of `text` that the collation does not ignore: the primary weight of each, and
/// whether it is an upper case letter of ASCII.
fn weights(mut text: &[u8]) -> impl Iterator<Item = (u32, bool)> {
    std::iter::from_fn(move || {
        loop {
            let (weight, len) = primary_weight(text)?;
            let is_upper = text[0].is_ascii_uppercase();
            text = &text[len..];
            if let Some(weight) = weight {
                return Some((weight, is_upper));
            }
        }
    })
}

/// `a.localeCompare(b)`: by the letters without regard to case, and if those are the same, lower
/// case before upper case at the first difference.
pub fn locale_compare(a: &[u8], b: &[u8]) -> Ordering {
    let primary = weights(a).map(|it| it.0).cmp(weights(b).map(|it| it.0));
    primary.then_with(|| weights(a).map(|it| it.1).cmp(weights(b).map(|it| it.1)))
}

/// `new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare(a, b)`: without regard to
/// case, and a run of digits counts as the number it is.
pub fn collator_compare_numeric_base(a: &[u8], b: &[u8]) -> Ordering {
    /// What is compared next, and the rest: a weight, and for a run of digits how many there are
    /// without leading zeros, and the digits.
    fn next(mut text: &[u8]) -> Option<((u32, usize, &[u8]), &[u8])> {
        loop {
            let digits = text.iter().take_while(|c| c.is_ascii_digit()).count();
            if digits > 0 {
                let zeros = text[..digits - 1]
                    .iter()
                    .take_while(|c| **c == b'0')
                    .count();
                return Some((
                    (DIGITS, digits - zeros, &text[zeros..digits]),
                    &text[digits..],
                ));
            }
            let (weight, len) = primary_weight(text)?;
            text = &text[len..];
            if let Some(weight) = weight {
                return Some(((weight, 0, b""), text));
            }
        }
    }
    let (mut a, mut b) = (a, b);
    loop {
        match (next(a), next(b)) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some((element_a, rest_a)), Some((element_b, rest_b))) => {
                match element_a.cmp(&element_b) {
                    Ordering::Equal => (a, b) = (rest_a, rest_b),
                    order => return order,
                }
            }
        }
    }
}
