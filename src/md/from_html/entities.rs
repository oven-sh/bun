//! Character-reference decoding and input-stream normalisation for the
//! text and attribute values lol-html hands over raw: named, decimal and hex
//! references with the HTML tokenizer's rules (the legacy no-semicolon
//! names, the attribute-value exception, windows-1252 remapping of C1
//! numeric references), CR/CRLF → LF, and NUL handling.

use std::borrow::Cow;

use super::scan;

/// How lol-html's text types map onto decoding: whether character
/// references are live, and whether U+0000 is dropped (the "in body" rule for
/// ordinary text) or becomes U+FFFD (RCDATA, RAWTEXT, script, CDATA,
/// attribute values).
#[derive(Clone, Copy)]
pub(crate) struct TextRules {
    pub(crate) decode_refs: bool,
    pub(crate) nul_is_fffd: bool,
}

pub(crate) const DATA: TextRules = TextRules {
    decode_refs: true,
    nul_is_fffd: false,
};
pub(crate) const RCDATA: TextRules = TextRules {
    decode_refs: true,
    nul_is_fffd: true,
};
pub(crate) const RAW: TextRules = TextRules {
    decode_refs: false,
    nul_is_fffd: true,
};
const ATTRIBUTE: TextRules = TextRules {
    decode_refs: true,
    nul_is_fffd: true,
};

/// Decodes character references and normalises newlines / NULs in text.
pub(crate) fn decode_text(s: &str, rules: TextRules) -> Cow<'_, str> {
    let clean = if rules.decode_refs {
        scan::find_any(s.as_bytes(), b"&\r\0").is_none()
    } else {
        scan::find_any(s.as_bytes(), b"\r\0").is_none()
    };
    if clean {
        return Cow::Borrowed(s);
    }
    Cow::Owned(normalize(s, rules, false))
}

/// The same for an attribute value (where `&not=` stays literal).
pub(crate) fn decode_attribute(s: &str) -> Cow<'_, str> {
    if scan::find_any(s.as_bytes(), b"&\r\0").is_none() {
        return Cow::Borrowed(s);
    }
    Cow::Owned(normalize(s, ATTRIBUTE, true))
}

fn normalize(s: &str, rules: TextRules, in_attribute: bool) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut seg = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'&' if rules.decode_refs => {
                out.push_str(&s[seg..i]);
                i += 1;
                i = char_ref(s, i, in_attribute, &mut out);
                seg = i;
            }
            b'\r' => {
                out.push_str(&s[seg..i]);
                out.push('\n');
                i += 1;
                if bytes.get(i) == Some(&b'\n') {
                    i += 1;
                }
                seg = i;
            }
            0 => {
                out.push_str(&s[seg..i]);
                if rules.nul_is_fffd {
                    out.push('\u{FFFD}');
                }
                i += 1;
                seg = i;
            }
            _ => i += 1,
        }
    }
    out.push_str(&s[seg..]);
    out
}

/// `pos` is just past `&`; appends the expansion (or `&`) and returns the
/// position after whatever was consumed.
fn char_ref(s: &str, pos: usize, in_attribute: bool, out: &mut String) -> usize {
    let bytes = s.as_bytes();
    match bytes.get(pos) {
        Some(b'#') => {
            let after_hash = pos + 1;
            let (base, digits_start) = match bytes.get(after_hash) {
                Some(b'x' | b'X') => (16u32, after_hash + 1),
                _ => (10u32, after_hash),
            };
            let mut i = digits_start;
            let mut num: u32 = 0;
            let mut too_big = false;
            while let Some(d) = bytes.get(i).and_then(|&b| (b as char).to_digit(base)) {
                num = num.wrapping_mul(base);
                if num > 0x10FFFF {
                    too_big = true;
                }
                num = num.wrapping_add(d);
                i += 1;
            }
            if i == digits_start {
                out.push('&');
                return pos;
            }
            if bytes.get(i) == Some(&b';') {
                i += 1;
            }
            out.push(numeric_char_ref(num, too_big));
            i
        }
        Some(b) if b.is_ascii_alphanumeric() => {
            let run = bytes[pos..]
                .iter()
                .take(MAX_NAME_LEN)
                .take_while(|b| b.is_ascii_alphanumeric())
                .count();
            let with_semicolon = if bytes.get(pos + run) == Some(&b';') {
                crate::entity::lookup(&bytes[pos - 1..pos + run + 1]).map(|cp| (run + 1, cp))
            } else {
                None
            };
            let matched = with_semicolon.or_else(|| longest_legacy_prefix(&bytes[pos..pos + run]));
            let Some((mlen, [c1, c2])) = matched else {
                out.push('&');
                return pos;
            };
            let last = bytes[pos + mlen - 1];
            let next = bytes.get(pos + mlen).copied();
            if in_attribute
                && last != b';'
                && next.is_some_and(|c| c == b'=' || c.is_ascii_alphanumeric())
            {
                out.push('&');
                return pos;
            }
            out.push(char::from_u32(c1).unwrap_or('\u{FFFD}'));
            if c2 != 0 {
                out.push(char::from_u32(c2).unwrap_or('\u{FFFD}'));
            }
            pos + mlen
        }
        _ => {
            out.push('&');
            pos
        }
    }
}

/// Longest entity name, `;` included (`CounterClockwiseContourIntegral;`).
const MAX_NAME_LEN: usize = 32;

/// The names the HTML standard allows without a trailing semicolon,
/// sorted, NUL-padded to six bytes. Each expands exactly like its
/// `;`-terminated form.
#[rustfmt::skip]
static LEGACY: [[u8; 6]; 106] = [
    *b"AElig\0", *b"AMP\0\0\0", *b"Aacute", *b"Acirc\0", *b"Agrave", *b"Aring\0", *b"Atilde", *b"Auml\0\0",
    *b"COPY\0\0", *b"Ccedil", *b"ETH\0\0\0", *b"Eacute", *b"Ecirc\0", *b"Egrave", *b"Euml\0\0", *b"GT\0\0\0\0",
    *b"Iacute", *b"Icirc\0", *b"Igrave", *b"Iuml\0\0", *b"LT\0\0\0\0", *b"Ntilde", *b"Oacute", *b"Ocirc\0",
    *b"Ograve", *b"Oslash", *b"Otilde", *b"Ouml\0\0", *b"QUOT\0\0", *b"REG\0\0\0", *b"THORN\0", *b"Uacute",
    *b"Ucirc\0", *b"Ugrave", *b"Uuml\0\0", *b"Yacute", *b"aacute", *b"acirc\0", *b"acute\0", *b"aelig\0",
    *b"agrave", *b"amp\0\0\0", *b"aring\0", *b"atilde", *b"auml\0\0", *b"brvbar", *b"ccedil", *b"cedil\0",
    *b"cent\0\0", *b"copy\0\0", *b"curren", *b"deg\0\0\0", *b"divide", *b"eacute", *b"ecirc\0", *b"egrave",
    *b"eth\0\0\0", *b"euml\0\0", *b"frac12", *b"frac14", *b"frac34", *b"gt\0\0\0\0", *b"iacute", *b"icirc\0",
    *b"iexcl\0", *b"igrave", *b"iquest", *b"iuml\0\0", *b"laquo\0", *b"lt\0\0\0\0", *b"macr\0\0", *b"micro\0",
    *b"middot", *b"nbsp\0\0", *b"not\0\0\0", *b"ntilde", *b"oacute", *b"ocirc\0", *b"ograve", *b"ordf\0\0",
    *b"ordm\0\0", *b"oslash", *b"otilde", *b"ouml\0\0", *b"para\0\0", *b"plusmn", *b"pound\0", *b"quot\0\0",
    *b"raquo\0", *b"reg\0\0\0", *b"sect\0\0", *b"shy\0\0\0", *b"sup1\0\0", *b"sup2\0\0", *b"sup3\0\0", *b"szlig\0",
    *b"thorn\0", *b"times\0", *b"uacute", *b"ucirc\0", *b"ugrave", *b"uml\0\0\0", *b"uuml\0\0", *b"yacute",
    *b"yen\0\0\0", *b"yuml\0\0",
];

/// The longest prefix of `run` that is one of the [`LEGACY`] names, with
/// its expansion.
fn longest_legacy_prefix(run: &[u8]) -> Option<(usize, [u32; 2])> {
    for len in (2..=run.len().min(6)).rev() {
        let mut key = [0u8; 6];
        key[..len].copy_from_slice(&run[..len]);
        if LEGACY.binary_search(&key).is_ok() {
            let mut name = [0u8; 8];
            name[0] = b'&';
            name[1..=len].copy_from_slice(&run[..len]);
            name[len + 1] = b';';
            return crate::entity::lookup(&name[..len + 2]).map(|cp| (len, cp));
        }
    }
    None
}

/// The numeric character reference end state's mapping.
fn numeric_char_ref(num: u32, too_big: bool) -> char {
    /// §13.2.5.80: references to C1 controls are read as windows-1252.
    /// Zero marks the code points that map to themselves.
    #[rustfmt::skip]
    static C1: [u16; 32] = [
        0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
        0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0,
        0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
        0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178,
    ];
    let n = match num {
        n if n > 0x10FFFF || too_big => 0xFFFD,
        0x00 | 0xD800..=0xDFFF => 0xFFFD,
        0x80..=0x9F => match C1[(num - 0x80) as usize] {
            0 => num,
            mapped => u32::from(mapped),
        },
        n => n,
    };
    char::from_u32(n).unwrap_or('\u{FFFD}')
}
