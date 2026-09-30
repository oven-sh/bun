// internal/stringutil/util.go: common rune utilities for parsing and emitting JavaScript.
use std::borrow::Cow;

pub fn is_white_space_like(ch: u32) -> bool {
    is_white_space_single_line(ch) || is_line_break(ch)
}

// Note: nextLine is in the Zs space, and should be considered to be a whitespace. It is explicitly not a line-break as it isn't in the exact set specified by EcmaScript.
pub fn is_white_space_single_line(ch: u32) -> bool {
    let quad_to_zero_width_space = 0x2000..=0x200B;
    matches!(
        ch,
        0x20 | 0x09 | 0x0B | 0x0C | 0x85 | 0xA0 | 0x1680 | 0x202F | 0x205F | 0x3000 | 0xFEFF
    ) || quad_to_zero_width_space.contains(&ch)
}

// ES5 7.3: only <LF>, <CR>, <LS> and <PS> are line terminators. Other new line or line breaking characters are treated as white space but not as line terminators.
pub fn is_line_break(ch: u32) -> bool {
    matches!(ch, 0x0A | 0x0D | 0x2028 | 0x2029)
}

pub fn is_digit(ch: u32) -> bool {
    ch >= b'0' as u32 && ch <= b'9' as u32
}

pub fn is_octal_digit(ch: u32) -> bool {
    ch >= b'0' as u32 && ch <= b'7' as u32
}

pub fn is_hex_digit(ch: u32) -> bool {
    ch >= b'0' as u32 && ch <= b'9' as u32
        || ch >= b'A' as u32 && ch <= b'F' as u32
        || ch >= b'a' as u32 && ch <= b'f' as u32
}

pub fn is_ascii_letter(ch: u32) -> bool {
    ch >= b'A' as u32 && ch <= b'Z' as u32 || ch >= b'a' as u32 && ch <= b'z' as u32
}

pub fn split_lines(text: &[u8]) -> Vec<&[u8]> {
    let count = usize::try_from(strings::count(text, b"\n")).unwrap_or(0);
    let mut lines: Vec<&[u8]> = Vec::with_capacity(count + 1);
    let mut start: usize = 0;
    let mut pos: usize = 0;
    while let Some(&b) = text.get(pos) {
        if b == b'\r' && text.get(pos + 1) == Some(&b'\n') {
            lines.push(text.get(start..pos).unwrap_or(&[]));
            pos += 2;
            start = pos;
            continue;
        }
        if b == b'\r' || b == b'\n' {
            lines.push(text.get(start..pos).unwrap_or(&[]));
            pos += 1;
            start = pos;
            continue;
        }
        pos += 1;
    }
    if start < text.len() {
        lines.push(text.get(start..).unwrap_or(&[]));
    }
    lines
}

pub fn guess_indentation(lines: &[&[u8]]) -> isize {
    const MAX_SMI_X86: usize = 0x3fff_ffff;
    let mut indentation = MAX_SMI_X86;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let mut i: usize = 0;
        while i < line.len() && i < indentation {
            let (ch, size) = utf8::decode_rune_in_string(line.get(i..).unwrap_or(&[]));
            if !is_white_space_like(ch) {
                break;
            }
            i += size;
        }
        if i < indentation {
            indentation = i;
        }
        if indentation == 0 {
            return 0;
        }
    }
    if indentation == MAX_SMI_X86 {
        return 0;
    }
    indentation as isize
}

// https://tc39.es/ecma262/multipage/global-object.html#sec-encodeuri-uri
pub fn encode_uri(s: &[u8]) -> Vec<u8> {
    let mut builder: Vec<u8> = Vec::new();
    for &b in s {
        if !should_escape_for_encode_uri(b) {
            builder.push(b);
            continue;
        }
        builder.push(b'%');
        builder.push(UPPERHEX.get(usize::from(b >> 4)).copied().unwrap_or(b'0'));
        builder.push(UPPERHEX.get(usize::from(b & 0x0f)).copied().unwrap_or(b'0'));
    }
    builder
}

const UPPERHEX: &[u8; 16] = b"0123456789ABCDEF";

fn should_escape_for_encode_uri(b: u8) -> bool {
    if b.is_ascii_alphanumeric() {
        return false;
    }
    !matches!(
        b,
        b';' | b'/'
            | b'?'
            | b':'
            | b'@'
            | b'&'
            | b'='
            | b'+'
            | b'$'
            | b','
            | b'#'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')'
    )
}

fn get_byte_order_mark_length(text: &[u8]) -> usize {
    match text {
        [0xfe, 0xff, ..] => 2,
        [0xff, 0xfe, ..] => 2,
        [0xef, 0xbb, 0xbf, ..] => 3,
        _ => 0,
    }
}

pub fn remove_byte_order_mark(text: &[u8]) -> &[u8] {
    let length = get_byte_order_mark_length(text);
    if length > 0 {
        return text.get(length..).unwrap_or(&[]);
    }
    text
}

pub fn add_utf8_byte_order_mark(text: &[u8]) -> Cow<'_, [u8]> {
    if get_byte_order_mark_length(text) == 0 {
        let mut with_mark = Vec::with_capacity(text.len() + 3);
        with_mark.extend_from_slice(b"\xEF\xBB\xBF");
        with_mark.extend_from_slice(text);
        return Cow::Owned(with_mark);
    }
    Cow::Borrowed(text)
}

pub fn strip_quotes(name: &[u8]) -> &[u8] {
    if name.len() < 2 {
        return name;
    }
    let (first_char, _) = utf8::decode_rune_in_string(name);
    let (last_char, _) = utf8::decode_last_rune_in_string(name);
    if first_char == last_char
        && (first_char == b'\'' as u32 || first_char == b'"' as u32 || first_char == b'`' as u32)
    {
        return name.get(1..name.len() - 1).unwrap_or(&[]);
    }
    name
}

// `matchSlashSomething.ReplaceAllStringFunc(src, repl)` for upstream's pattern `\\.`: a backslash and the rune after it, a line feed excepted.
fn match_slash_something_replace_all_string_func(src: &[u8], repl: fn(&[u8]) -> &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(src.len());
    let mut i: usize = 0;
    while let Some(&b) = src.get(i) {
        if b == b'\\' {
            let (r, size) = utf8::decode_rune_in_string(src.get(i + 1..).unwrap_or(&[]));
            if size > 0 && r != b'\n' as u32 {
                out.extend_from_slice(repl(src.get(i..i + 1 + size).unwrap_or(&[])));
                i += 1 + size;
                continue;
            }
        }
        out.push(b);
        i += 1;
    }
    out
}

fn match_slash_replacer(input: &[u8]) -> &[u8] {
    input.get(1..).unwrap_or(&[])
}

pub fn unquote_string(str: &[u8]) -> Vec<u8> {
    // strconv.Unquote is insufficient as that only handles a single character inside single quotes, as those are character literals in go
    let inner = strip_quotes(str);
    // In strada we do str.replace(/\\./g, s => s.substring(1)) - which is to say, replace all backslash-something with just something. That's replicated here faithfully.
    match_slash_something_replace_all_string_func(inner, match_slash_replacer)
}

pub fn lower_first_char(str: &[u8]) -> Vec<u8> {
    let (char, size) = utf8::decode_rune_in_string(str);
    if size > 0 {
        let mut result = Vec::with_capacity(str.len());
        utf8::append_rune(&mut result, unicode::to_lower(char));
        result.extend_from_slice(str.get(size..).unwrap_or(&[]));
        return result;
    }
    str.to_vec()
}

pub fn truncate_by_runes(str: &[u8], max_length: isize) -> &[u8] {
    if (str.len() as isize) < max_length {
        return str;
    }
    if max_length <= 0 {
        return b"";
    }
    let mut rune_count: isize = 0;
    let mut i: usize = 0;
    while i < str.len() {
        rune_count += 1;
        if rune_count > max_length {
            return str.get(..i).unwrap_or(&[]);
        }
        let (_, size) = utf8::decode_rune_in_string(str.get(i..).unwrap_or(&[]));
        i += size.max(1);
    }
    str
}

// SurrogateLowStart is the boundary between the high and low halves of the UTF-16 surrogate range.
pub const SURROGATE_LOW_START: u32 = 0xDC00;

pub fn is_high_surrogate(ch: u32) -> bool {
    utf16::is_surrogate(ch) && ch < SURROGATE_LOW_START
}

pub fn is_low_surrogate(ch: u32) -> bool {
    utf16::is_surrogate(ch) && ch >= SURROGATE_LOW_START
}

pub fn is_surrogate(ch: u32) -> bool {
    utf16::is_surrogate(ch)
}

pub fn surrogate_pair_to_code_point(high: u32, low: u32) -> u32 {
    utf16::decode_rune(high, low)
}

pub fn code_point_to_surrogate_pair(ch: u32) -> (u32, u32) {
    utf16::encode_rune(ch)
}

// A lone surrogate (U+D800–U+DFFF) cannot be represented in valid UTF-8, so EncodeJSStringRune stores it as the 3-byte CESU-8/WTF-8 sentinel that UTF-8 would use for that code point if surrogates were encodable.
const SURROGATE_UTF8_LEAD: u8 = 0xED;
const SURROGATE_UTF8_LEAD_BITS: u32 = 0xD000;
const UTF8_CONT_MARKER: u8 = 0x80;
const UTF8_CONT_MAX: u8 = 0xBF;
const UTF8_CONT_MASK: u8 = 0x3F;

// byte1 bounds that pin the block down to the surrogate range U+D800–U+DFFF: 0xD800 -> 0xA0, 0xDFFF -> 0xBF.
const SURROGATE_UTF8_BYTE1_MIN: u8 = 0xA0;
const SURROGATE_UTF8_BYTE1_MAX: u8 = 0xBF;

pub fn encode_js_string_rune(ch: u32) -> Vec<u8> {
    if is_surrogate(ch) {
        return vec![
            SURROGATE_UTF8_LEAD,
            UTF8_CONT_MARKER | ((ch >> 6) as u8 & UTF8_CONT_MASK),
            UTF8_CONT_MARKER | (ch as u8 & UTF8_CONT_MASK),
        ];
    }
    let mut encoded = Vec::with_capacity(utf8::UTF_MAX);
    utf8::append_rune(&mut encoded, ch);
    encoded
}

pub fn decode_js_string_rune(s: &[u8]) -> (u32, usize) {
    if let [SURROGATE_UTF8_LEAD, b1, b2, ..] = *s {
        if (SURROGATE_UTF8_BYTE1_MIN..=SURROGATE_UTF8_BYTE1_MAX).contains(&b1)
            && (UTF8_CONT_MARKER..=UTF8_CONT_MAX).contains(&b2)
        {
            let r = SURROGATE_UTF8_LEAD_BITS
                | (u32::from(b1 & UTF8_CONT_MASK) << 6)
                | u32::from(b2 & UTF8_CONT_MASK);
            return (r, 3);
        }
    }
    utf8::decode_rune_in_string(s)
}

// CombineSurrogatePairs canonicalizes a JS-string value produced by concatenation, merging any adjacent high+low surrogate sentinel pair (as written by EncodeJSStringRune) into the single supplementary code point they represent. Strings without a lone-surrogate sentinel (the common case) are returned unchanged.
pub fn combine_surrogate_pairs(s: &[u8]) -> Cow<'_, [u8]> {
    if strings::index_byte(s, SURROGATE_UTF8_LEAD) < 0 {
        return Cow::Borrowed(s);
    }
    let mut b: Vec<u8> = Vec::with_capacity(s.len());
    let mut i: usize = 0;
    while i < s.len() {
        let (r, size) = decode_js_string_rune(s.get(i..).unwrap_or(&[]));
        if is_high_surrogate(r) {
            let (low, low_size) = decode_js_string_rune(s.get(i + size..).unwrap_or(&[]));
            if is_low_surrogate(low) {
                utf8::append_rune(&mut b, surrogate_pair_to_code_point(r, low));
                i += size + low_size;
                continue;
            }
        }
        b.extend_from_slice(s.get(i..i + size).unwrap_or(&[]));
        i += size.max(1);
    }
    Cow::Owned(b)
}

// Go's unicode/utf8: the functions the ported packages call, with Go's answers for bytes that are not UTF-8.
pub mod utf8 {
    pub const RUNE_ERROR: u32 = 0xFFFD;
    pub const RUNE_SELF: u32 = 0x80;
    pub const MAX_RUNE: u32 = 0x10FFFF;
    pub const UTF_MAX: usize = 4;

    // utf8.DecodeRuneInString: (RuneError, 0) for an empty string, (RuneError, 1) for a byte that starts no valid encoding.
    pub fn decode_rune_in_string(s: &[u8]) -> (u32, usize) {
        let Some(&s0) = s.first() else {
            return (RUNE_ERROR, 0);
        };
        if s0 < 0x80 {
            return (u32::from(s0), 1);
        }
        let (size, lo, hi): (usize, u8, u8) = match s0 {
            0xC2..=0xDF => (2, 0x80, 0xBF),
            0xE0 => (3, 0xA0, 0xBF),
            0xE1..=0xEC | 0xEE..=0xEF => (3, 0x80, 0xBF),
            0xED => (3, 0x80, 0x9F),
            0xF0 => (4, 0x90, 0xBF),
            0xF1..=0xF3 => (4, 0x80, 0xBF),
            0xF4 => (4, 0x80, 0x8F),
            _ => return (RUNE_ERROR, 1),
        };
        if s.len() < size {
            return (RUNE_ERROR, 1);
        }
        let s1 = s.get(1).copied().unwrap_or(0);
        if s1 < lo || hi < s1 {
            return (RUNE_ERROR, 1);
        }
        if size <= 2 {
            return ((u32::from(s0 & 0x1F) << 6) | u32::from(s1 & 0x3F), 2);
        }
        let s2 = s.get(2).copied().unwrap_or(0);
        if !(0x80..=0xBF).contains(&s2) {
            return (RUNE_ERROR, 1);
        }
        if size <= 3 {
            let r =
                (u32::from(s0 & 0x0F) << 12) | (u32::from(s1 & 0x3F) << 6) | u32::from(s2 & 0x3F);
            return (r, 3);
        }
        let s3 = s.get(3).copied().unwrap_or(0);
        if !(0x80..=0xBF).contains(&s3) {
            return (RUNE_ERROR, 1);
        }
        let r = (u32::from(s0 & 0x07) << 18)
            | (u32::from(s1 & 0x3F) << 12)
            | (u32::from(s2 & 0x3F) << 6)
            | u32::from(s3 & 0x3F);
        (r, 4)
    }

    // utf8.DecodeLastRuneInString: (RuneError, 0) for an empty string, (RuneError, 1) when the string does not end in a valid encoding.
    pub fn decode_last_rune_in_string(s: &[u8]) -> (u32, usize) {
        let end = s.len();
        let Some(&last) = s.last() else {
            return (RUNE_ERROR, 0);
        };
        if last < 0x80 {
            return (u32::from(last), 1);
        }
        // guard against O(n^2) behavior when traversing backwards through strings with long sequences of invalid UTF-8.
        let lim = end.saturating_sub(UTF_MAX);
        let mut start = end - 1;
        while start > lim {
            start -= 1;
            if s.get(start).is_some_and(|b| b & 0xC0 != 0x80) {
                break;
            }
        }
        let (r, size) = decode_rune_in_string(s.get(start..end).unwrap_or(&[]));
        if start + size != end {
            return (RUNE_ERROR, 1);
        }
        (r, size)
    }

    // utf8.RuneCountInString: a byte that is not part of a valid encoding counts as one rune.
    pub fn rune_count_in_string(s: &[u8]) -> isize {
        let mut n: isize = 0;
        let mut i: usize = 0;
        while i < s.len() {
            let (_, size) = decode_rune_in_string(s.get(i..).unwrap_or(&[]));
            i += size.max(1);
            n += 1;
        }
        n
    }

    // utf8.AppendRune, which strings.Builder.WriteRune and string(rune) share: a surrogate or a value above MaxRune is written as U+FFFD.
    pub fn append_rune(p: &mut Vec<u8>, r: u32) {
        if r <= 0x7F {
            p.push(r as u8);
        } else if r <= 0x7FF {
            p.push(0xC0 | (r >> 6) as u8);
            p.push(0x80 | (r as u8 & 0x3F));
        } else if r > MAX_RUNE || (0xD800..=0xDFFF).contains(&r) {
            p.extend_from_slice(b"\xEF\xBF\xBD");
        } else if r <= 0xFFFF {
            p.push(0xE0 | (r >> 12) as u8);
            p.push(0x80 | ((r >> 6) as u8 & 0x3F));
            p.push(0x80 | (r as u8 & 0x3F));
        } else {
            p.push(0xF0 | (r >> 18) as u8);
            p.push(0x80 | ((r >> 12) as u8 & 0x3F));
            p.push(0x80 | ((r >> 6) as u8 & 0x3F));
            p.push(0x80 | (r as u8 & 0x3F));
        }
    }

    // `for i, r := range s`: each rune with the offset of its first byte, U+FFFD for each byte that is not part of a valid encoding.
    pub fn range(s: &[u8]) -> impl Iterator<Item = (usize, u32)> + '_ {
        let mut i: usize = 0;
        std::iter::from_fn(move || {
            if i >= s.len() {
                return None;
            }
            let start = i;
            let (r, size) = decode_rune_in_string(s.get(i..).unwrap_or(&[]));
            i += size.max(1);
            Some((start, r))
        })
    }

    // `[]rune(s)`
    pub fn runes(s: &[u8]) -> Vec<u32> {
        range(s).map(|(_, r)| r).collect()
    }
}

// Go's unicode/utf16.
pub mod utf16 {
    const SURR1: u32 = 0xD800;
    const SURR2: u32 = 0xDC00;
    const SURR3: u32 = 0xE000;
    const SURR_SELF: u32 = 0x10000;
    const MAX_RUNE: u32 = 0x10FFFF;
    const REPLACEMENT_CHAR: u32 = 0xFFFD;

    pub fn is_surrogate(r: u32) -> bool {
        (SURR1..SURR3).contains(&r)
    }

    // utf16.DecodeRune: U+FFFD when the pair is not a valid surrogate pair.
    pub fn decode_rune(r1: u32, r2: u32) -> u32 {
        if (SURR1..SURR2).contains(&r1) && (SURR2..SURR3).contains(&r2) {
            return (((r1 - SURR1) << 10) | (r2 - SURR2)) + SURR_SELF;
        }
        REPLACEMENT_CHAR
    }

    // utf16.EncodeRune: (U+FFFD, U+FFFD) when the rune is not a supplementary code point.
    pub fn encode_rune(r: u32) -> (u32, u32) {
        if !(SURR_SELF..=MAX_RUNE).contains(&r) {
            return (REPLACEMENT_CHAR, REPLACEMENT_CHAR);
        }
        let r = r - SURR_SELF;
        (SURR1 + ((r >> 10) & 0x3ff), SURR2 + (r & 0x3ff))
    }

    // utf16.RuneLen: -1 for a surrogate or a value above MaxRune.
    pub fn rune_len(r: u32) -> isize {
        if r < SURR1 || (SURR3..SURR_SELF).contains(&r) {
            1
        } else if (SURR_SELF..=MAX_RUNE).contains(&r) {
            2
        } else {
            -1
        }
    }
}

// Go's unicode: range tables and the simple case mappings of Go 1.26 (Unicode 15.0.0).
pub mod unicode {
    use crate::stringutil::js_case_generated::special_casing_mappings;

    pub struct Range16 {
        pub lo: u16,
        pub hi: u16,
        pub stride: u16,
    }

    impl Range16 {
        pub const fn new(lo: u16, hi: u16, stride: u16) -> Self {
            Self { lo, hi, stride }
        }
    }

    pub struct Range32 {
        pub lo: u32,
        pub hi: u32,
        pub stride: u32,
    }

    impl Range32 {
        pub const fn new(lo: u32, hi: u32, stride: u32) -> Self {
            Self { lo, hi, stride }
        }
    }

    pub struct RangeTable {
        pub r16: &'static [Range16],
        pub r32: &'static [Range32],
        pub latin_offset: usize,
    }

    // The category Zs of Go's tables.
    pub static ZS: RangeTable = RangeTable {
        r16: &[
            Range16::new(0x0020, 0x00a0, 128),
            Range16::new(0x1680, 0x2000, 2432),
            Range16::new(0x2001, 0x200a, 1),
            Range16::new(0x202f, 0x205f, 48),
            Range16::new(0x3000, 0x3000, 1),
        ],
        r32: &[],
        latin_offset: 1,
    };

    // unicode.Is: reports whether the rune is in the specified table of ranges.
    pub fn is(range_tab: &RangeTable, r: u32) -> bool {
        let r16 = range_tab.r16;
        if let Some(last) = r16.last() {
            if r <= u32::from(last.hi) {
                return is16(r16, r as u16);
            }
        }
        let r32 = range_tab.r32;
        if let Some(first) = r32.first() {
            if r >= first.lo {
                return is32(r32, r);
            }
        }
        false
    }

    fn is16(ranges: &[Range16], r: u16) -> bool {
        let index = ranges.partition_point(|range| range.hi < r);
        match ranges.get(index) {
            Some(range) => {
                range.lo <= r && (range.stride == 1 || (r - range.lo).is_multiple_of(range.stride))
            }
            None => false,
        }
    }

    fn is32(ranges: &[Range32], r: u32) -> bool {
        let index = ranges.partition_point(|range| range.hi < r);
        match ranges.get(index) {
            Some(range) => {
                range.lo <= r && (range.stride == 1 || (r - range.lo).is_multiple_of(range.stride))
            }
            None => false,
        }
    }

    // The rune whose Go lower case is not the one-rune lower mapping of the generated casing table.
    const TO_LOWER_EXCEPTIONS: [(u32, u32); 1] = [(0x130, 0x69)];

    // The runes whose Go upper case is not the one-rune upper mapping of the generated casing table.
    const TO_UPPER_EXCEPTIONS: [(u32, u32); 27] = [
        (0x1F80, 0x1F88),
        (0x1F81, 0x1F89),
        (0x1F82, 0x1F8A),
        (0x1F83, 0x1F8B),
        (0x1F84, 0x1F8C),
        (0x1F85, 0x1F8D),
        (0x1F86, 0x1F8E),
        (0x1F87, 0x1F8F),
        (0x1F90, 0x1F98),
        (0x1F91, 0x1F99),
        (0x1F92, 0x1F9A),
        (0x1F93, 0x1F9B),
        (0x1F94, 0x1F9C),
        (0x1F95, 0x1F9D),
        (0x1F96, 0x1F9E),
        (0x1F97, 0x1F9F),
        (0x1FA0, 0x1FA8),
        (0x1FA1, 0x1FA9),
        (0x1FA2, 0x1FAA),
        (0x1FA3, 0x1FAB),
        (0x1FA4, 0x1FAC),
        (0x1FA5, 0x1FAD),
        (0x1FA6, 0x1FAE),
        (0x1FA7, 0x1FAF),
        (0x1FB3, 0x1FBC),
        (0x1FC3, 0x1FCC),
        (0x1FF3, 0x1FFC),
    ];

    // The runes above ASCII whose unicode.SimpleFold is neither their lower case nor, without one, their upper case.
    const SIMPLE_FOLD_EXCEPTIONS: [(u32, u32); 36] = [
        (0xDF, 0x1E9E),
        (0xE5, 0x212B),
        (0x130, 0x130),
        (0x131, 0x131),
        (0x1C4, 0x1C5),
        (0x1C7, 0x1C8),
        (0x1CA, 0x1CB),
        (0x1F1, 0x1F2),
        (0x3A3, 0x3C2),
        (0x3B2, 0x3D0),
        (0x3B5, 0x3F5),
        (0x3B8, 0x3D1),
        (0x3B9, 0x1FBE),
        (0x3BA, 0x3F0),
        (0x3BC, 0xB5),
        (0x3C0, 0x3D6),
        (0x3C1, 0x3F1),
        (0x3C2, 0x3C3),
        (0x3C6, 0x3D5),
        (0x3C9, 0x2126),
        (0x3D1, 0x3F4),
        (0x3F4, 0x398),
        (0x432, 0x1C80),
        (0x434, 0x1C81),
        (0x43E, 0x1C82),
        (0x441, 0x1C83),
        (0x442, 0x1C84),
        (0x44A, 0x1C86),
        (0x463, 0x1C87),
        (0x1C84, 0x1C85),
        (0x1E61, 0x1E9B),
        (0x1FBE, 0x345),
        (0x2126, 0x3A9),
        (0x212A, 0x4B),
        (0x212B, 0xC5),
        (0xA64B, 0x1C88),
    ];

    fn exception(table: &[(u32, u32)], r: u32) -> Option<u32> {
        let index = table.binary_search_by(|entry| entry.0.cmp(&r)).ok()?;
        table.get(index).map(|entry| entry.1)
    }

    // unicode.ToLower
    pub fn to_lower(r: u32) -> u32 {
        if r < 0x80 {
            return if (b'A' as u32..=b'Z' as u32).contains(&r) {
                r + 32
            } else {
                r
            };
        }
        if let Some(lower) = exception(&TO_LOWER_EXCEPTIONS, r) {
            return lower;
        }
        match special_casing_mappings(r) {
            Some(mapping) if mapping.lower[1] == 0 => mapping.lower[0],
            _ => r,
        }
    }

    // unicode.ToUpper
    pub fn to_upper(r: u32) -> u32 {
        if r < 0x80 {
            return if (b'a' as u32..=b'z' as u32).contains(&r) {
                r - 32
            } else {
                r
            };
        }
        if let Some(upper) = exception(&TO_UPPER_EXCEPTIONS, r) {
            return upper;
        }
        match special_casing_mappings(r) {
            Some(mapping) if mapping.upper[1] == 0 => mapping.upper[0],
            _ => r,
        }
    }

    // unicode.SimpleFold: the smallest rune above r that is equivalent to it under simple case folding, or the smallest such rune when there is none above.
    pub fn simple_fold(r: u32) -> u32 {
        if r > super::utf8::MAX_RUNE {
            return r;
        }
        if r < 0x80 {
            return match r as u8 {
                b'k' => 0x212A,
                b's' => 0x17F,
                b'A'..=b'Z' => r + 32,
                b'a'..=b'z' => r - 32,
                _ => r,
            };
        }
        if let Some(folded) = exception(&SIMPLE_FOLD_EXCEPTIONS, r) {
            return folded;
        }
        let l = to_lower(r);
        if l != r {
            return l;
        }
        to_upper(r)
    }
}

// Go's strings, on byte strings.
pub mod strings {
    use super::{unicode, utf8};
    use std::borrow::Cow;

    // `s[lo:hi]`: an index outside the string is moved to the nearest end of it, where Go panics.
    pub fn slice(s: &[u8], lo: isize, hi: isize) -> &[u8] {
        let hi = usize::try_from(hi).unwrap_or(0).min(s.len());
        let lo = usize::try_from(lo).unwrap_or(0).min(hi);
        s.get(lo..hi).unwrap_or(&[])
    }

    // `s[lo:]`
    pub fn slice_from(s: &[u8], lo: isize) -> &[u8] {
        slice(s, lo, s.len() as isize)
    }

    // `s[:hi]`
    pub fn slice_to(s: &[u8], hi: isize) -> &[u8] {
        slice(s, 0, hi)
    }

    // `s[i]`: 0 for an index outside the string, where Go panics.
    pub fn byte_at(s: &[u8], i: isize) -> u8 {
        usize::try_from(i)
            .ok()
            .and_then(|i| s.get(i))
            .copied()
            .unwrap_or(0)
    }

    pub fn index_byte(s: &[u8], c: u8) -> isize {
        let mut i: usize = 0;
        while let Some(&b) = s.get(i) {
            if b == c {
                return i as isize;
            }
            i += 1;
        }
        -1
    }

    pub fn last_index_byte(s: &[u8], c: u8) -> isize {
        let mut i = s.len();
        while i > 0 {
            i -= 1;
            if s.get(i) == Some(&c) {
                return i as isize;
            }
        }
        -1
    }

    pub fn index(s: &[u8], substr: &[u8]) -> isize {
        let n = substr.len();
        if n > s.len() {
            return -1;
        }
        let mut i: usize = 0;
        while i + n <= s.len() {
            if s.get(i..i + n) == Some(substr) {
                return i as isize;
            }
            i += 1;
        }
        -1
    }

    pub fn last_index(s: &[u8], substr: &[u8]) -> isize {
        let n = substr.len();
        if n > s.len() {
            return -1;
        }
        let mut i = s.len() - n + 1;
        while i > 0 {
            i -= 1;
            if s.get(i..i + n) == Some(substr) {
                return i as isize;
            }
        }
        -1
    }

    // strings.IndexAny for a set of ASCII characters.
    pub fn index_any(s: &[u8], chars: &[u8]) -> isize {
        let mut i: usize = 0;
        while let Some(&b) = s.get(i) {
            if index_byte(chars, b) >= 0 {
                return i as isize;
            }
            i += 1;
        }
        -1
    }

    pub fn contains(s: &[u8], substr: &[u8]) -> bool {
        index(s, substr) >= 0
    }

    // strings.Count: the non-overlapping instances of substr, or the number of runes plus one for an empty substr.
    pub fn count(s: &[u8], substr: &[u8]) -> isize {
        if substr.is_empty() {
            return utf8::rune_count_in_string(s) + 1;
        }
        let mut n: isize = 0;
        let mut rest = s;
        loop {
            let i = index(rest, substr);
            if i < 0 {
                return n;
            }
            n += 1;
            rest = slice_from(rest, i + substr.len() as isize);
        }
    }

    // strings.Cut
    pub fn cut<'a>(s: &'a [u8], sep: &[u8]) -> (&'a [u8], &'a [u8], bool) {
        let i = index(s, sep);
        if i >= 0 {
            return (slice_to(s, i), slice_from(s, i + sep.len() as isize), true);
        }
        (s, b"", false)
    }

    // strings.CutPrefix
    pub fn cut_prefix<'a>(s: &'a [u8], prefix: &[u8]) -> (&'a [u8], bool) {
        match s.strip_prefix(prefix) {
            Some(rest) => (rest, true),
            None => (s, false),
        }
    }

    // strings.TrimPrefix
    pub fn trim_prefix<'a>(s: &'a [u8], prefix: &[u8]) -> &'a [u8] {
        s.strip_prefix(prefix).unwrap_or(s)
    }

    // strings.TrimSuffix
    pub fn trim_suffix<'a>(s: &'a [u8], suffix: &[u8]) -> &'a [u8] {
        s.strip_suffix(suffix).unwrap_or(s)
    }

    // strings.TrimLeft for a set of ASCII characters.
    pub fn trim_left<'a>(s: &'a [u8], cutset: &[u8]) -> &'a [u8] {
        let mut i: usize = 0;
        while s.get(i).is_some_and(|&b| index_byte(cutset, b) >= 0) {
            i += 1;
        }
        s.get(i..).unwrap_or(&[])
    }

    // strings.TrimRight for a set of ASCII characters.
    pub fn trim_right<'a>(s: &'a [u8], cutset: &[u8]) -> &'a [u8] {
        let mut end = s.len();
        while end > 0 && s.get(end - 1).is_some_and(|&b| index_byte(cutset, b) >= 0) {
            end -= 1;
        }
        s.get(..end).unwrap_or(&[])
    }

    // strings.TrimFunc
    pub fn trim_func(s: &[u8], f: impl Fn(u32) -> bool) -> &[u8] {
        let mut start: usize = 0;
        while start < s.len() {
            let (r, size) = utf8::decode_rune_in_string(s.get(start..).unwrap_or(&[]));
            if !f(r) {
                break;
            }
            start += size.max(1);
        }
        let mut end = s.len();
        while end > start {
            let (r, size) = utf8::decode_last_rune_in_string(s.get(start..end).unwrap_or(&[]));
            if !f(r) {
                break;
            }
            end -= size.max(1);
        }
        s.get(start..end).unwrap_or(&[])
    }

    // strings.ReplaceAll for a non-empty `old`: the string itself when `old` does not occur.
    pub fn replace_all<'a>(s: &'a [u8], old: &[u8], new: &[u8]) -> Cow<'a, [u8]> {
        let mut i = index(s, old);
        if i < 0 || old.is_empty() {
            return Cow::Borrowed(s);
        }
        let mut out: Vec<u8> = Vec::with_capacity(s.len());
        let mut rest = s;
        while i >= 0 {
            out.extend_from_slice(slice_to(rest, i));
            out.extend_from_slice(new);
            rest = slice_from(rest, i + old.len() as isize);
            i = index(rest, old);
        }
        out.extend_from_slice(rest);
        Cow::Owned(out)
    }

    // strings.Split for a non-empty separator: one more element than there are separators.
    pub fn split<'a>(s: &'a [u8], sep: &[u8]) -> Vec<&'a [u8]> {
        let mut parts: Vec<&'a [u8]> = Vec::new();
        let mut rest = s;
        if !sep.is_empty() {
            loop {
                let i = index(rest, sep);
                if i < 0 {
                    break;
                }
                parts.push(slice_to(rest, i));
                rest = slice_from(rest, i + sep.len() as isize);
            }
        }
        parts.push(rest);
        parts
    }

    // strings.Join
    pub fn join<S: AsRef<[u8]>>(elems: &[S], sep: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();
        for (i, elem) in elems.iter().enumerate() {
            if i > 0 {
                out.extend_from_slice(sep);
            }
            out.extend_from_slice(elem.as_ref());
        }
        out
    }

    // strings.Compare
    pub fn compare(a: &[u8], b: &[u8]) -> isize {
        match a.cmp(b) {
            std::cmp::Ordering::Less => -1,
            std::cmp::Ordering::Equal => 0,
            std::cmp::Ordering::Greater => 1,
        }
    }

    // strings.Map for a mapping that drops no rune: the string itself when no rune changes and every byte is valid UTF-8, else a new string in which each invalid byte is U+FFFD.
    pub fn map(mut mapping: impl FnMut(u32) -> u32, s: &[u8]) -> Cow<'_, [u8]> {
        let mut i: usize = 0;
        while i < s.len() {
            let (c, width) = utf8::decode_rune_in_string(s.get(i..).unwrap_or(&[]));
            let r = mapping(c);
            if r == c && (c != utf8::RUNE_ERROR || width != 1) {
                i += width.max(1);
                continue;
            }
            let mut b: Vec<u8> = Vec::with_capacity(s.len() + utf8::UTF_MAX);
            b.extend_from_slice(s.get(..i).unwrap_or(&[]));
            utf8::append_rune(&mut b, r);
            i += width.max(1);
            while i < s.len() {
                let (c, width) = utf8::decode_rune_in_string(s.get(i..).unwrap_or(&[]));
                utf8::append_rune(&mut b, mapping(c));
                i += width.max(1);
            }
            return Cow::Owned(b);
        }
        Cow::Borrowed(s)
    }

    // strings.ToLower
    pub fn to_lower(s: &[u8]) -> Cow<'_, [u8]> {
        if s.is_ascii() {
            if !s.iter().any(u8::is_ascii_uppercase) {
                return Cow::Borrowed(s);
            }
            return Cow::Owned(s.to_ascii_lowercase());
        }
        map(unicode::to_lower, s)
    }

    // strings.EqualFold: equality under simple Unicode case-folding.
    pub fn equal_fold(s: &[u8], t: &[u8]) -> bool {
        let mut i: usize = 0;
        let mut j: usize = 0;
        while i < s.len() {
            if j >= t.len() {
                return false;
            }
            let (mut sr, s_size) = utf8::decode_rune_in_string(s.get(i..).unwrap_or(&[]));
            let (mut tr, t_size) = utf8::decode_rune_in_string(t.get(j..).unwrap_or(&[]));
            i += s_size.max(1);
            j += t_size.max(1);
            if tr == sr {
                continue;
            }
            if tr < sr {
                std::mem::swap(&mut tr, &mut sr);
            }
            if tr < utf8::RUNE_SELF {
                if (b'A' as u32..=b'Z' as u32).contains(&sr) && tr == sr + 32 {
                    continue;
                }
                return false;
            }
            // General case. SimpleFold(x) returns the next equivalent rune > x or wraps around to smaller values.
            let mut r = unicode::simple_fold(sr);
            while r != sr && r < tr {
                r = unicode::simple_fold(r);
            }
            if r == tr {
                continue;
            }
            return false;
        }
        j >= t.len()
    }
}

#[cfg(test)]
mod tests {
    use super::strings::split;
    use super::*;

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

    fn number<T: std::str::FromStr>(field: &[u8]) -> T {
        std::str::from_utf8(field)
            .ok()
            .and_then(|text| text.parse().ok())
            .unwrap()
    }

    fn rune(field: &[u8]) -> u32 {
        u32::from_str_radix(std::str::from_utf8(field).unwrap(), 16).unwrap()
    }

    // Replays what upstream's Go functions printed for the same inputs.
    #[test]
    fn matches_upstream_vectors() {
        let text = include_bytes!("testdata/util.tsv");
        let mut checked = 0;
        for line in split(text, b"\n") {
            if line.is_empty() {
                continue;
            }
            let f = split(line, b"\t");
            let input = unhex(f[1]);
            let got: String = match f[0] {
                b"SplitLines" => {
                    let lines: Vec<String> = split_lines(&input).iter().map(|l| hex(l)).collect();
                    lines.join(",")
                }
                b"GuessIndentation" => guess_indentation(&split_lines(&input)).to_string(),
                b"EncodeURI" => hex(&encode_uri(&input)),
                b"RemoveByteOrderMark" => hex(remove_byte_order_mark(&input)),
                b"AddUTF8ByteOrderMark" => hex(&add_utf8_byte_order_mark(&input)),
                b"StripQuotes" => hex(strip_quotes(&input)),
                b"UnquoteString" => hex(&unquote_string(&input)),
                b"LowerFirstChar" => hex(&lower_first_char(&input)),
                b"TruncateByRunes" => hex(truncate_by_runes(&input, number(f[2]))),
                b"CombineSurrogatePairs" => hex(&combine_surrogate_pairs(&input)),
                b"DecodeJSStringRune" => {
                    let (r, size) = decode_js_string_rune(&input);
                    format!("{r:x},{size}")
                }
                b"EncodeJSStringRune" => hex(&encode_js_string_rune(rune(f[1]))),
                b"Surrogate" => {
                    let r = rune(f[1]);
                    let (high, low) = code_point_to_surrogate_pair(r);
                    format!(
                        "{}{}{},{:x},{:x},{:x}",
                        u8::from(is_surrogate(r)),
                        u8::from(is_high_surrogate(r)),
                        u8::from(is_low_surrogate(r)),
                        high,
                        low,
                        surrogate_pair_to_code_point(high, low)
                    )
                }
                b"DecodeLastRune" => {
                    let (r, size) = utf8::decode_last_rune_in_string(&input);
                    format!("{r:x},{size}")
                }
                b"RuneCount" => utf8::rune_count_in_string(&input).to_string(),
                b"ToLower" => hex(&strings::to_lower(&input)),
                other => panic!("unknown vector {other:?}"),
            };
            let line = std::str::from_utf8(line).unwrap();
            assert_eq!(got.as_bytes(), f[f.len() - 1], "{line}");
            checked += 1;
        }
        assert_eq!(checked, 1796);
    }

    // FNV-1a over one line per rune, as Go printed it: the rune predicates of upstream, membership in Zs, and unicode.ToLower, ToUpper and SimpleFold.
    #[test]
    #[cfg_attr(miri, ignore)]
    fn rune_functions_match_upstream_digest() {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for r in 0..=0x10FFFFu32 {
            if (0xD800..=0xDFFF).contains(&r) {
                continue;
            }
            let bits = u32::from(is_white_space_like(r))
                | u32::from(is_white_space_single_line(r)) << 1
                | u32::from(is_line_break(r)) << 2
                | u32::from(is_digit(r)) << 3
                | u32::from(is_octal_digit(r)) << 4
                | u32::from(is_hex_digit(r)) << 5
                | u32::from(is_ascii_letter(r)) << 6
                | u32::from(unicode::is(&unicode::ZS, r)) << 7;
            let (l, u, f) = (
                unicode::to_lower(r),
                unicode::to_upper(r),
                unicode::simple_fold(r),
            );
            if bits == 0 && l == r && u == r && f == r {
                continue;
            }
            for b in format!("{r:x} {bits:x} {l:x} {u:x} {f:x}\n").bytes() {
                hash = (hash ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        assert_eq!(hash, 0x6f8c_87c8_6084_e510);
    }

    #[test]
    fn go_slices_never_panic() {
        assert_eq!(strings::slice(b"abc", -1, 9), b"abc");
        assert_eq!(strings::slice(b"abc", 2, 1), b"");
        assert_eq!(strings::slice_from(b"abc", 5), b"");
        assert_eq!(strings::byte_at(b"abc", 3), 0);
        assert_eq!(strings::last_index(b"a/b/c", b"/"), 3);
        assert_eq!(strings::last_index(b"", b""), 0);
        assert_eq!(strings::index(b"abc", b""), 0);
        assert_eq!(strings::count(b"a/b/c", b"/"), 2);
        assert_eq!(strings::split(b"a/b/", b"/"), vec![&b"a"[..], b"b", b""]);
        assert_eq!(strings::split(b"", b"/"), vec![&b""[..]]);
        assert_eq!(&*strings::replace_all(b"a\\b\\c", b"\\", b"/"), b"a/b/c");
        assert_eq!(strings::cut(b"a.b.c", b"."), (&b"a"[..], &b"b.c"[..], true));
        assert_eq!(strings::trim_left(b"0012", b"0"), b"12");
        assert_eq!(strings::trim_right(b"1200", b"0"), b"12");
        assert_eq!(strings::join(&[&b"a"[..], b"b"], b"/"), b"a/b");
        assert_eq!(utf8::runes(b"a\xff\xc3\xa9"), vec![0x61, 0xFFFD, 0xE9]);
        assert_eq!(utf16::rune_len(0x10000), 2);
    }
}
