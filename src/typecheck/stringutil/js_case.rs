// internal/stringutil/js_case.go: String.prototype.toLowerCase and toUpperCase.
use crate::stringutil::js_case_generated::{
    SpecialCasingCondition, UNICODE_CASE_IGNORABLE_RANGES, UNICODE_CASED_RANGES,
    special_casing_mappings,
};
use crate::stringutil::util::{
    decode_js_string_rune, encode_js_string_rune, is_surrogate, unicode, utf8,
};
use std::borrow::Cow;

// Writes one mapping of the casing table: up to three runes, a zero ends it.
fn write_mapping(builder: &mut Vec<u8>, mapping: [u32; 3]) {
    for r in mapping {
        if r == 0 {
            break;
        }
        utf8::append_rune(builder, r);
    }
}

pub fn to_lower_js(str: &[u8]) -> Cow<'_, [u8]> {
    if let Some(ascii) = to_lower_ascii(str) {
        return ascii;
    }

    let mut builder: Vec<u8> = Vec::with_capacity(str.len());
    // casedBefore tracks whether the most recent non-Case_Ignorable code point is "cased", which is the backward half of the Final_Sigma context. We accumulate it as we stream so we never have to scan (or decode) backwards.
    let mut cased_before = false;
    let mut i: usize = 0;
    while i < str.len() {
        let (r, size) = decode_js_string_rune(str.get(i..).unwrap_or(&[]));
        i += size.max(1);
        if is_surrogate(r) {
            // A lone surrogate has no case mapping; preserve it verbatim, matching String.prototype.toLowerCase.
            builder.extend_from_slice(&encode_js_string_rune(r));
        } else if let Some(mapping) = special_casing_mappings(r) {
            if mapping.condition == SpecialCasingCondition::FinalSigma
                && is_final_sigma_context(cased_before, str, i)
            {
                write_mapping(&mut builder, mapping.conditional_lower);
            } else {
                write_mapping(&mut builder, mapping.lower);
            }
        } else {
            utf8::append_rune(&mut builder, r);
        }
        if !is_unicode_case_ignorable(r) {
            cased_before = is_sigma_cased(r);
        }
    }
    Cow::Owned(builder)
}

pub fn to_upper_js(str: &[u8]) -> Cow<'_, [u8]> {
    if let Some(ascii) = to_upper_ascii(str) {
        return ascii;
    }

    let mut builder: Vec<u8> = Vec::with_capacity(str.len());
    let mut i: usize = 0;
    while i < str.len() {
        let (r, size) = decode_js_string_rune(str.get(i..).unwrap_or(&[]));
        if is_surrogate(r) {
            // A lone surrogate has no case mapping; preserve it verbatim, matching String.prototype.toUpperCase.
            builder.extend_from_slice(str.get(i..i + size).unwrap_or(&[]));
        } else if let Some(mapping) = special_casing_mappings(r) {
            write_mapping(&mut builder, mapping.upper);
        } else {
            utf8::append_rune(&mut builder, r);
        }
        i += size.max(1);
    }

    Cow::Owned(builder)
}

// None when the string has a byte outside ASCII.
fn to_lower_ascii(str: &[u8]) -> Option<Cow<'_, [u8]>> {
    let mut needs_mapping = false;
    for &ch in str {
        if u32::from(ch) >= utf8::RUNE_SELF {
            return None;
        }
        needs_mapping = needs_mapping || ch.is_ascii_uppercase();
    }
    if !needs_mapping {
        return Some(Cow::Borrowed(str));
    }

    let mut buf = str.to_vec();
    for ch in &mut buf {
        if ch.is_ascii_uppercase() {
            *ch += b'a' - b'A';
        }
    }
    Some(Cow::Owned(buf))
}

// None when the string has a byte outside ASCII.
fn to_upper_ascii(str: &[u8]) -> Option<Cow<'_, [u8]>> {
    let mut needs_mapping = false;
    for &ch in str {
        if u32::from(ch) >= utf8::RUNE_SELF {
            return None;
        }
        needs_mapping = needs_mapping || ch.is_ascii_lowercase();
    }
    if !needs_mapping {
        return Some(Cow::Borrowed(str));
    }

    let mut buf = str.to_vec();
    for ch in &mut buf {
        if ch.is_ascii_lowercase() {
            *ch -= b'a' - b'A';
        }
    }
    Some(Cow::Owned(buf))
}

// isFinalSigmaContext reports whether a sigma at the current position is in Final_Sigma context: it is preceded by a cased code point and not followed by one. We model the exposed V8/ICU behavior directly here: skip Case_Ignorable code points and then look for a Cased code point, exactly as Unicode Table 3-17 defines the Final_Sigma condition.
fn is_final_sigma_context(cased_before: bool, str: &[u8], after_offset: usize) -> bool {
    cased_before && !has_sigma_cased_after(str, after_offset)
}

fn has_sigma_cased_after(str: &[u8], start: usize) -> bool {
    let mut i = start;
    while i < str.len() {
        let (r, size) = decode_js_string_rune(str.get(i..).unwrap_or(&[]));
        i += size.max(1);
        if is_unicode_case_ignorable(r) {
            continue;
        }
        return is_sigma_cased(r);
    }
    false
}

fn is_sigma_cased(r: u32) -> bool {
    unicode::is(&UNICODE_CASED_RANGES, r)
}

fn is_unicode_case_ignorable(r: u32) -> bool {
    unicode::is(&UNICODE_CASE_IGNORABLE_RANGES, r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stringutil::identifier::{is_unicode_identifier_part, is_unicode_identifier_start};
    use crate::stringutil::util::strings::split;

    fn unhex(s: &[u8]) -> Vec<u8> {
        let digit = |b: u8| (b as char).to_digit(16).unwrap() as u8;
        s.as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (digit(pair[0]) << 4) | digit(pair[1]))
            .collect()
    }

    fn hex(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            out.push_str(&format!("{b:02x}"));
        }
        out
    }

    // FNV-1a over the line that upstream's Go code printed for each code point with a case mapping or an identifier property: the rune, ToLowerJS, ToUpperJS and the two identifier flags.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn every_code_point_matches_upstream_digest() {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        let mut lines = 0;
        for cp in 0..=0x10FFFFu32 {
            if (0xD800..=0xDFFF).contains(&cp) {
                continue;
            }
            let mut s = Vec::new();
            utf8::append_rune(&mut s, cp);
            let (lo, up) = (to_lower_js(&s), to_upper_js(&s));
            let idb = u32::from(is_unicode_identifier_start(cp))
                | u32::from(is_unicode_identifier_part(cp)) << 1;
            if *lo != *s || *up != *s || idb != 0 {
                let line = format!("C\t{:x}\t{}\t{}\t{}\n", cp, hex(&lo), hex(&up), idb);
                for b in line.bytes() {
                    hash = (hash ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
                }
                lines += 1;
            }
        }
        assert_eq!(lines, 140_160);
        assert_eq!(hash, 0xd410_554f_a6bd_6dbb);
    }

    // Replays what ToLowerJS and ToUpperJS of upstream printed for whole strings: final sigma, lone surrogates, bytes that are not UTF-8.
    #[test]
    fn strings_match_upstream_vectors() {
        let text = include_bytes!("testdata/js_case.tsv");
        let mut checked = 0;
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let input = unhex(f[0]);
            assert_eq!(
                hex(&to_lower_js(&input)).as_bytes(),
                f[1],
                "lower of {:?}",
                input
            );
            assert_eq!(
                hex(&to_upper_js(&input)).as_bytes(),
                f[2],
                "upper of {:?}",
                input
            );
            checked += 1;
        }
        assert_eq!(checked, 133);
    }
}
