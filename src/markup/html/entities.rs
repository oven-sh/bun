//! <https://html.spec.whatwg.org/multipage/parsing.html#character-reference-state>

use core::cell::Cell;

use crate::chars::ONES;
use crate::{Text, Unit};

const LONGEST_NAME: usize = 31;

const WINDOWS_1252: [u16; 32] = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039,
    0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc,
    0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/// The code points of `&name;`. The second is 0 if there is only one.
pub fn named_reference<U: Unit>(name: &[U]) -> Option<[u32; 2]> {
    if name.len() > LONGEST_NAME {
        return None;
    }
    let mut buffer = [b';'; LONGEST_NAME + 2];
    buffer[0] = b'&';
    for (to, from) in buffer[1..].iter_mut().zip(name) {
        *to = from.low();
    }
    bun_md::entity::lookup(&buffer[..name.len() + 2])
}

const RECENT_BITS: u32 = 6;

thread_local! {
    /// Names of up to seven letters, as words, with their only code points.
    static RECENT: Box<[Cell<(u64, u32)>; 1 << RECENT_BITS]> = Box::new([const { Cell::new((0, 0)) }; _]);
}

/// With its length, if it has a semicolon.
#[inline]
fn short_reference<U: Unit>(after_amp: &[U]) -> Option<(u32, usize)> {
    let word = U::word(after_amp, 0).unwrap_or_else(|| {
        after_amp
            .iter()
            .rev()
            .fold(0, |word, it| word << 8 | u64::from(it.low()))
    });
    let differs = word ^ (ONES * u64::from(b';'));
    let len = (differs.wrapping_sub(ONES) & !differs & (ONES << 7)).trailing_zeros() / 8;
    (2..8).contains(&len).then_some(())?;
    let name = word & ((1 << (len * 8)) - 1) | u64::from(len) << 56;
    RECENT.with(|recent| {
        let slot =
            &recent[(name.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (64 - RECENT_BITS)) as usize];
        if slot.get().0 != name {
            let [code, 0] = named_reference(&after_amp[..len as usize])? else {
                return None;
            };
            slot.set((name, code));
        }
        Some((slot.get().1, len as usize + 1))
    })
}

fn numeric<U: Unit>(after_hash: &[U], out: &mut Text) -> Option<usize> {
    let is_hex = after_hash.first().is_some_and(|it| it.low() | 0x20 == b'x');
    let (radix, start) = if is_hex { (16, 1) } else { (10, 0) };
    let (mut code, mut end) = (0u32, start);
    while let Some(digit) = after_hash
        .get(end)
        .and_then(|it| char::from(it.low()).to_digit(radix))
    {
        code = (code * radix + digit).min(0x11_0000);
        end += 1;
    }
    if end == start {
        return None;
    }
    out.push_code_point(match code {
        0 | 0xd800..0xe000 | 0x11_0000.. => 0xfffd,
        0x80..0xa0 => WINDOWS_1252[code as usize - 0x80].into(),
        _ => code,
    });
    Some(end + usize::from(after_hash.get(end).is_some_and(|it| it.low() == b';')))
}

fn named<U: Unit>(after_amp: &[U], in_attribute: bool, out: &mut Text) -> Option<usize> {
    if let Some((code, used)) = short_reference(after_amp) {
        out.push_code_point(code);
        return Some(used);
    }
    let len = after_amp
        .iter()
        .take(LONGEST_NAME + 1)
        .take_while(|it| it.low().is_ascii_alphanumeric())
        .count();
    let next = after_amp.get(len).map(|it| it.low());
    let terminated = if next == Some(b';') {
        named_reference(&after_amp[..len])
    } else {
        None
    };
    let (codes, used) = match terminated {
        Some(codes) => (codes, len + 1),
        None => {
            let is_legacy = |len: &usize| {
                let name = after_amp[..*len].iter().map(|it| it.low());
                WITHOUT_SEMICOLON
                    .binary_search_by(|it| it.bytes().cmp(name.clone()))
                    .is_ok()
            };
            let used = (2..=len.min(6)).rev().find(is_legacy)?;
            if in_attribute && (used < len || next == Some(b'=')) {
                return None;
            }
            (named_reference(&after_amp[..used])?, used)
        }
    };
    out.push_code_point(codes[0]);
    if codes[1] != 0 {
        out.push_code_point(codes[1]);
    }
    Some(used)
}

/// Appends `text` with its character references replaced.
pub fn decode<U: Unit>(text: &[U], in_attribute: bool, out: &mut Text) {
    let mut copied = 0;
    let mut amp = U::find(text, 0, b'&');
    while amp < text.len() {
        out.push(U::chars(&text[copied..amp]));
        let after = &text[amp + 1..];
        let used = match after.first() {
            Some(first) if first.low() == b'#' => numeric(&after[1..], out).map(|it| it + 1),
            _ => named(after, in_attribute, out),
        };
        copied = used.map_or(amp, |it| amp + 1 + it);
        amp = U::find(text, copied.max(amp + 1), b'&');
    }
    out.push(U::chars(&text[copied..]));
}

#[rustfmt::skip]
const WITHOUT_SEMICOLON: &[&str] = &[
    "AElig", "AMP", "Aacute", "Acirc", "Agrave", "Aring", "Atilde", "Auml", "COPY", "Ccedil", "ETH", "Eacute",
    "Ecirc", "Egrave", "Euml", "GT", "Iacute", "Icirc", "Igrave", "Iuml", "LT", "Ntilde", "Oacute", "Ocirc",
    "Ograve", "Oslash", "Otilde", "Ouml", "QUOT", "REG", "THORN", "Uacute", "Ucirc", "Ugrave", "Uuml", "Yacute",
    "aacute", "acirc", "acute", "aelig", "agrave", "amp", "aring", "atilde", "auml", "brvbar", "ccedil", "cedil",
    "cent", "copy", "curren", "deg", "divide", "eacute", "ecirc", "egrave", "eth", "euml", "frac12", "frac14",
    "frac34", "gt", "iacute", "icirc", "iexcl", "igrave", "iquest", "iuml", "laquo", "lt", "macr", "micro",
    "middot", "nbsp", "not", "ntilde", "oacute", "ocirc", "ograve", "ordf", "ordm", "oslash", "otilde", "ouml",
    "para", "plusmn", "pound", "quot", "raquo", "reg", "sect", "shy", "sup1", "sup2", "sup3", "szlig", "thorn",
    "times", "uacute", "ucirc", "ugrave", "uml", "uuml", "yacute", "yen", "yuml",
];
