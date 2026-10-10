#![allow(dead_code)] // until every rule of the plugin is written
//! eslint-plugin-regexp's `lib/utils/{unicode,regex-syntax,mention,char-ranges}.ts`,
//! `regexp-ast/quantifier.ts`, and two functions of `index.ts`. Offsets and lengths are in bytes.

use bun_core::fmt::hex_byte_lower;
use bun_core::strings;
use bun_lint::prelude::{File, Json, Object, Regex};
use bun_lint::regex::ast as re;
use bun_lint::utils::oxlint::format_word_list;
use std::borrow::Cow;
use std::sync::LazyLock;

/// upstream's `isSpace`: `\s`
pub(crate) use bun_core::strings::is_js_whitespace as is_space;

/// `/literal/.test(text)`
macro_rules! regex_test {
    ($literal:literal, $text:expr) => {{
        static REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::literal($literal));
        REGEX.test($text)
    }};
}

/// upstream's `isDigit`: `\d`
pub(crate) fn is_decimal_digit(code_point: u32) -> bool {
    u8::try_from(code_point).is_ok_and(|byte| byte.is_ascii_digit())
}

/// upstream's `isLowercaseLetter`
pub(crate) fn is_lowercase_letter(code_point: u32) -> bool {
    u8::try_from(code_point).is_ok_and(|byte| byte.is_ascii_lowercase())
}

/// upstream's `isUppercaseLetter`
pub(crate) fn is_uppercase_letter(code_point: u32) -> bool {
    u8::try_from(code_point).is_ok_and(|byte| byte.is_ascii_uppercase())
}

/// upstream's `isLetter`
pub(crate) fn is_letter(code_point: u32) -> bool {
    is_lowercase_letter(code_point) || is_uppercase_letter(code_point)
}

/// upstream's `toLowerCodePoint`
pub(crate) fn to_lower_code_point(code_point: u32) -> u32 {
    if is_uppercase_letter(code_point) {
        return code_point + 0x0020;
    }
    code_point
}

/// upstream's `toUpperCodePoint`
pub(crate) fn to_upper_code_point(code_point: u32) -> u32 {
    if is_lowercase_letter(code_point) {
        return code_point - 0x0020;
    }
    code_point
}

/// upstream's `isSymbol`: `!` to `/`, `:` to `@`, `[` to `` ` ``, `{` to `~`
pub(crate) fn is_symbol(code_point: u32) -> bool {
    u8::try_from(code_point).is_ok_and(|byte| byte.is_ascii_punctuation())
}

/// upstream's `isWord`: `\w`
pub(crate) fn is_word(code_point: u32) -> bool {
    u8::try_from(code_point).is_ok_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// upstream's `isInvisible`
pub(crate) fn is_invisible(code_point: u32) -> bool {
    if is_space(code_point) {
        return true;
    }
    matches!(
        code_point,
        0x180E | 0x0085 | 0x200B | 0x200C | 0x200D | 0x200E | 0x200F | 0x2800
    )
}

/// upstream's `RESERVED_DOUBLE_PUNCTUATOR_CHARS.has` and `RESERVED_DOUBLE_PUNCTUATOR_CP.has`
pub(crate) fn is_reserved_double_punctuator(code_point: u32) -> bool {
    u8::try_from(code_point).is_ok_and(|byte| strings::contains_char(b"&!#$%*+,.:;<=>?@^`~-", byte))
}

/// upstream's `RESERVED_DOUBLE_PUNCTUATOR_PATTERN.test`
pub(crate) fn has_reserved_double_punctuator(text: &[u8]) -> bool {
    let mut pairs = text.iter().zip(text.iter().skip(1));
    pairs.any(|(a, b)| a == b && is_reserved_double_punctuator(u32::from(*a)))
}

/// upstream's `isOctalEscape`: `/^\\[0-7]{1,3}$/u`
pub(crate) fn is_octal_escape(raw: &[u8]) -> bool {
    matches!(raw, [b'\\', digits @ ..] if (1..=3).contains(&digits.len())
        && digits.iter().all(|digit| matches!(digit, b'0'..=b'7')))
}

/// upstream's `isControlEscape`: `/^\\c[A-Za-z]$/u`
pub(crate) fn is_control_escape(raw: &[u8]) -> bool {
    matches!(raw, [b'\\', b'c', letter] if letter.is_ascii_alphabetic())
}

/// upstream's `isHexadecimalEscape`: `/^\\x[\dA-Fa-f]{2}$/u`
pub(crate) fn is_hexadecimal_escape(raw: &[u8]) -> bool {
    matches!(raw, [b'\\', b'x', digits @ ..] if digits.len() == 2
        && digits.iter().all(u8::is_ascii_hexdigit))
}

/// upstream's `isUnicodeEscape`: `/^\\u[\dA-Fa-f]{4}$/u`
pub(crate) fn is_unicode_escape(raw: &[u8]) -> bool {
    matches!(raw, [b'\\', b'u', digits @ ..] if digits.len() == 4
        && digits.iter().all(u8::is_ascii_hexdigit))
}

/// upstream's `isUnicodeCodePointEscape`: `/^\\u\{[\dA-Fa-f]{1,8}\}$/u`
pub(crate) fn is_unicode_code_point_escape(raw: &[u8]) -> bool {
    matches!(raw, [b'\\', b'u', b'{', digits @ .., b'}'] if (1..=8).contains(&digits.len())
        && digits.iter().all(u8::is_ascii_hexdigit))
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum EscapeSequenceKind {
    Octal,
    Control,
    Hexadecimal,
    Unicode,
    UnicodeCodePoint,
}

impl EscapeSequenceKind {
    /// The value of upstream's enum, which is in messages.
    pub(crate) fn name(self) -> &'static str {
        match self {
            EscapeSequenceKind::Octal => "octal",
            EscapeSequenceKind::Control => "control",
            EscapeSequenceKind::Hexadecimal => "hexadecimal",
            EscapeSequenceKind::Unicode => "unicode",
            EscapeSequenceKind::UnicodeCodePoint => "unicode code point",
        }
    }
}

/// upstream's `getEscapeSequenceKind`
pub(crate) fn get_escape_sequence_kind(raw: &[u8]) -> Option<EscapeSequenceKind> {
    if raw.first() != Some(&b'\\') {
        return None;
    }
    if is_octal_escape(raw) {
        return Some(EscapeSequenceKind::Octal);
    }
    if is_control_escape(raw) {
        return Some(EscapeSequenceKind::Control);
    }
    if is_hexadecimal_escape(raw) {
        return Some(EscapeSequenceKind::Hexadecimal);
    }
    if is_unicode_escape(raw) {
        return Some(EscapeSequenceKind::Unicode);
    }
    if is_unicode_code_point_escape(raw) {
        return Some(EscapeSequenceKind::UnicodeCodePoint);
    }
    None
}

/// upstream's `isEscapeSequence`
pub(crate) fn is_escape_sequence(raw: &[u8]) -> bool {
    get_escape_sequence_kind(raw).is_some()
}

/// upstream's `isHexLikeEscape`
pub(crate) fn is_hex_like_escape(raw: &[u8]) -> bool {
    matches!(
        get_escape_sequence_kind(raw),
        Some(
            EscapeSequenceKind::Hexadecimal
                | EscapeSequenceKind::Unicode
                | EscapeSequenceKind::UnicodeCodePoint
        )
    )
}

/// upstream's `parseFlags`: a letter that is no flag, or is there twice, is not an error.
pub(crate) fn parse_flags(flags: &[u8]) -> re::Flags {
    let includes = |flag: u8| strings::contains_char(flags, flag);
    re::Flags {
        dot_all: includes(b's'),
        global: includes(b'g'),
        has_indices: includes(b'd'),
        ignore_case: includes(b'i'),
        multiline: includes(b'm'),
        sticky: includes(b'y'),
        unicode: includes(b'u'),
        unicode_sets: includes(b'v'),
    }
}

/// The character outside the BMP that `offset` is in the middle of.
fn character_around(source: &[u8], offset: u32) -> Option<u32> {
    match strings::wtf8_codepoint_at(source, (offset as usize).checked_sub(2)?) {
        (code_point, 4) => Some(code_point),
        _ => None,
    }
}

/// `node.raw` as JavaScript has it. Without the `u` and `v` flags a node can begin or end in the
/// middle of a character outside the BMP: what it has of that character is a surrogate.
pub(crate) fn raw_wtf8(node: re::Node<'_>) -> Cow<'_, [u8]> {
    let (mut raw, source) = (node.raw(), node.ast().source());
    let first = character_around(source, node.start());
    let last = character_around(source, node.end());
    if first.is_none() && last.is_none() {
        return Cow::Borrowed(raw);
    }
    let mut out = Vec::with_capacity(raw.len() + 2);
    if let Some(code_point) = first {
        strings::push_codepoint_wtf8(&mut out, u32::from(strings::u16_trail(code_point)));
        raw = raw.get(2..).unwrap_or_default();
    }
    match last {
        Some(code_point) => {
            out.extend_from_slice(raw.get(..raw.len().saturating_sub(2)).unwrap_or_default());
            strings::push_codepoint_wtf8(&mut out, u32::from(strings::u16_lead(code_point)));
        }
        None => out.extend_from_slice(raw),
    }
    Cow::Owned(out)
}

/// upstream's `formatCodePoint`
fn format_code_point(value: u32) -> String {
    format!("U+{value:04x}")
}

/// upstream's `mentionChar`
pub(crate) fn mention_char(element: re::Node<'_>) -> Vec<u8> {
    let value = match element.kind() {
        re::Kind::Character { value } => format_code_point(value),
        re::Kind::CharacterClassRange { min, max } => {
            let min = format_code_point(min.character().unwrap_or_default());
            let max = format_code_point(max.character().unwrap_or_default());
            format!("{min} - {max}")
        }
        _ => return mention(&raw_wtf8(element)),
    };
    let mut out = mention(&raw_wtf8(element));
    out.extend_from_slice(format!(" ({value})").as_bytes());
    out
}

/// upstream's `mention`, for a text. For a node: `mention(node.raw())`, or
/// `mention(&raw_wtf8(node))` where the pattern can be without the `u` and `v` flags.
pub(crate) fn mention(raw: &[u8]) -> Vec<u8> {
    [&b"'"[..], escape_controls(raw).as_slice(), b"'"].concat()
}

static ESCAPED_CHARACTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::literal(r"/\\(?<char>[\s\S])/gu"));
static CONTROL_CHARACTER: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/[\0-\x1f]/gu"));

/// upstream's `escape`
fn escape_controls(value: &[u8]) -> Vec<u8> {
    let value = ESCAPED_CHARACTER.replace_with(value, |m, out| match m.bytes(1) {
        [control @ 0..0x20] => escape_control(*control, out),
        _ => out.extend_from_slice(m.as_bytes()),
    });
    let value = CONTROL_CHARACTER.replace_with(&value, |m, out| {
        escape_control(m.as_bytes().first().copied().unwrap_or_default(), out);
    });
    value.into_owned()
}

/// upstream's `escapeControl`
fn escape_control(control: u8, out: &mut Vec<u8>) {
    match control {
        b'\t' => out.push(control),
        b'\n' => out.extend_from_slice(b"\\n"),
        b'\r' => out.extend_from_slice(b"\\r"),
        _ => {
            out.extend_from_slice(b"\\x");
            out.extend_from_slice(&hex_byte_lower(control));
        }
    }
}

/// upstream's `joinEnglishList`
pub(crate) fn join_english_list(list: &[Vec<u8>]) -> Vec<u8> {
    if list.is_empty() {
        return b"none".to_vec();
    }
    format_word_list(&list.iter().map(Vec::as_slice).collect::<Vec<_>>())
}

/// upstream's `getQuantifierOffsets`: from `q_node.start()`.
pub(crate) fn get_quantifier_offsets(q_node: re::Node<'_>) -> (u32, u32) {
    let re::Kind::Quantifier {
        greedy, element, ..
    } = q_node.kind()
    else {
        return (0, 0);
    };
    let start_offset = element.end() - q_node.start();
    let end_offset = q_node.raw().len() as u32 - u32::from(!greedy);
    (start_offset, end_offset)
}

/// `max: Infinity` is [`re::INFINITY`].
#[derive(Copy, Clone)]
pub(crate) struct Quant {
    pub(crate) min: u32,
    pub(crate) max: u32,
    pub(crate) greedy: Option<bool>,
}

impl Quant {
    /// A `Quantifier` where upstream takes a `Quant`.
    pub(crate) fn of(q_node: re::Node<'_>) -> Option<Quant> {
        match q_node.kind() {
            re::Kind::Quantifier {
                min, max, greedy, ..
            } => Some(Quant {
                min,
                max,
                greedy: Some(greedy),
            }),
            _ => None,
        }
    }
}

/// upstream's `quantToString`
pub(crate) fn quant_to_string(quant: Quant) -> Vec<u8> {
    let mut value = match (quant.min, quant.max) {
        (0, 1) => "?".to_owned(),
        (0, re::INFINITY) => "*".to_owned(),
        (1, re::INFINITY) => "+".to_owned(),
        (min, max) if min == max => format!("{{{min}}}"),
        (min, re::INFINITY) => format!("{{{min},}}"),
        (min, max) => format!("{{{min},{max}}}"),
    };
    if quant.greedy == Some(false) {
        value.push('?');
    }
    value.into_bytes()
}

/// upstream's `mightCreateNewElement`
pub(crate) fn might_create_new_element(before: &[u8], after: &[u8]) -> bool {
    // \cA
    if before.ends_with(b"\\c") && regex_test!(r"/^[a-z]/iu", after) {
        return true;
    }

    // \xFF ￿
    if regex_test!(
        r"/(?:^|[^\\])(?:\\{2})*\\(?:x[\dA-Fa-f]?|u[\dA-Fa-f]{0,3})$/u",
        before
    ) && after.first().is_some_and(u8::is_ascii_hexdigit)
    {
        return true;
    }

    // \u{FFFF}
    if (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\u$/u", before)
        && regex_test!(r"/^\{[\da-f]*(?:\}[\s\S]*)?$/iu", after))
        || (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\u\{[\da-f]*$/u", before)
            && regex_test!(r"/^(?:[\da-f]+\}?|\})/iu", after))
    {
        return true;
    }

    // \077 \123
    if (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\0[0-7]?$/u", before)
        && matches!(after.first(), Some(b'0'..=b'7')))
        || (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\[1-7]$/u", before)
            && matches!(after.first(), Some(b'0'..=b'7')))
    {
        return true;
    }

    // \12 \k<foo>
    if (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\[1-9]\d*$/u", before)
        && after.first().is_some_and(u8::is_ascii_digit))
        || (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\k$/u", before) && after.first() == Some(&b'<'))
        || regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\k<[^<>]*$/u", before)
    {
        return true;
    }

    // \p{L} \P{L}
    if (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\p$/iu", before)
        && regex_test!(r"/^\{[\w=]*(?:\}[\s\S]*)?$/u", after))
        || (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\\p\{[\w=]*$/iu", before)
            && regex_test!(r"/^[\w=]+(?:\}[\s\S]*)?$|^\}/u", after))
    {
        return true;
    }

    // {1} {2,} {2,3}
    (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\{\d*$/u", before)
        && matches!(after.first(), Some(b'0'..=b'9' | b',' | b'}')))
        || (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\{\d+,$/u", before)
            && regex_test!(r"/^(?:\d+(?:\}|$)|\})/u", after))
        || (regex_test!(r"/(?:^|[^\\])(?:\\{2})*\{\d+,\d*$/u", before)
            && after.first() == Some(&b'}'))
}

/// upstream's `canUnwrapped`
pub(crate) fn can_unwrapped(node: re::Node<'_>, text: &[u8]) -> bool {
    let Some(parent) = node.parent() else {
        return true;
    };
    let alt = match parent.ty() {
        re::NodeType::Alternative => Some(parent),
        re::NodeType::Quantifier => parent.parent(),
        _ => None,
    };
    let Some(alt) = alt else {
        return true;
    };
    let (start, end) = (node.start() - alt.start(), node.end() - alt.start());
    let text_before = alt.raw().get(..start as usize).unwrap_or_default();
    let text_after = alt.raw().get(end as usize..).unwrap_or_default();

    !might_create_new_element(text_before, text) && !might_create_new_element(text, text_after)
}

const ALL_RANGES: [(u32, u32); 1] = [(0, 0x10FFFF)];
/// `0-9`, `A-Z`, `a-z`
const ALPHANUMERIC_RANGES: [(u32, u32); 3] = [(0x30, 0x39), (0x41, 0x5A), (0x61, 0x7A)];

/// The first argument of upstream's `getAllowedCharRanges`, from the option of a rule or from the
/// settings: a string is a list of one. `None` is what is falsy there.
pub(crate) fn allowed_option(value: Option<&Json>) -> Option<Vec<Vec<u8>>> {
    match value? {
        Json::String(range) if !range.is_empty() => Some(vec![range.clone()]),
        Json::Array(ranges) => {
            let ranges = ranges.iter().filter_map(Json::as_str);
            Some(ranges.map(<[u8]>::to_vec).collect())
        }
        _ => None,
    }
}

/// upstream's `getAllowedCharRanges`. What is not `<char>-<char>` is left out: upstream throws.
pub(crate) fn get_allowed_char_ranges(
    option: Option<&[Vec<u8>]>,
    file: &File<'_>,
) -> Vec<(u32, u32)> {
    let of_settings;
    let target = match option {
        Some(option) => option,
        None => {
            let settings = Object::of(Some(file.settings())).object("regexp");
            of_settings = allowed_option(settings.get("allowedCharacterRanges"));
            match &of_settings {
                Some(target) => &target[..],
                None => return ALPHANUMERIC_RANGES.to_vec(),
            }
        }
    };

    let mut allowed = Vec::new();
    for range in target {
        if range == b"all" {
            return ALL_RANGES.to_vec();
        } else if range == b"alphanumeric" {
            allowed.extend_from_slice(&ALPHANUMERIC_RANGES);
        } else {
            let mut chars = strings::wtf8_codepoints(range).map(|it| it.1);
            let chars = [chars.next(), chars.next(), chars.next(), chars.next()];
            if let [Some(min), Some(0x2D), Some(max), None] = chars {
                allowed.push((min, max));
            }
        }
    }
    allowed
}

/// upstream's `inRange`. Its `max` is `min` if it is not given.
pub(crate) fn in_range(ranges: &[(u32, u32)], min: u32, max: u32) -> bool {
    ranges.iter().any(|range| range.0 <= min && max <= range.1)
}
