use crate::{Document, Node, NodeKind};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow JSON values that are unsafe for interchange
pub struct NoUnsafeValues;

const UNSAFE_NUMBER: &Message = &Message::new(
    "unsafeNumber",
    "The number '{{ value }}' will evaluate to Infinity.",
);
const UNSAFE_INTEGER: &Message = &Message::new(
    "unsafeInteger",
    "The integer '{{ value }}' is outside the safe integer range.",
);
const UNSAFE_ZERO: &Message = &Message::new(
    "unsafeZero",
    "The number '{{ value }}' will evaluate to zero.",
);
const SUBNORMAL: &Message = &Message::new(
    "subnormal",
    "Unexpected subnormal number '{{ value }}' found, which may cause interoperability issues.",
);
const LONE_SURROGATE: &Message =
    &Message::new("loneSurrogate", "Lone surrogate '{{ surrogate }}' found.");

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// The problem with the number whose source text is `text`, if any.
fn problem_of(text: &[u8]) -> Option<&'static Message> {
    let has_exponent = strings::index_of_any(text, b"eE").is_some();
    // A number this short can't be too large or too small.
    if text.len() <= 15 && !has_exponent {
        return None;
    }
    let unsigned = match text {
        [b'+' | b'-', rest @ ..] => rest,
        _ => text,
    };
    let is_hex = matches!(unsigned, [b'0', b'x' | b'X', ..]);
    let value = bun_core::fmt::js_string_to_number(unsigned);
    if !value.is_finite() {
        return Some(UNSAFE_NUMBER);
    }
    if value == 0.0 {
        let exponent = strings::index_of_any(unsigned, b"eE").unwrap_or(unsigned.len());
        let has_digit = unsigned[..exponent].iter().any(|it| matches!(it, b'1'..=b'9'));
        return (!is_hex && has_digit).then_some(UNSAFE_ZERO);
    }
    if is_hex || !has_exponent && !strings::contains_char(text, b'.') {
        return (value > MAX_SAFE_INTEGER).then_some(UNSAFE_INTEGER);
    }
    (value.to_bits() & 0x7FF0_0000_0000_0000 == 0).then_some(SUBNORMAL)
}

impl NoUnsafeValues {
    fn check_string<'a>(node: Node<'a>, cx: &Cx<'a, Self>) {
        let units = strings::wtf8_to_utf16(node.value());
        let mut at = 0;
        while let Some(&unit) = units.get(at) {
            at += 1;
            if matches!(unit, 0xD800..=0xDBFF) && matches!(units.get(at), Some(0xDC00..=0xDFFF)) {
                at += 1;
            } else if matches!(unit, 0xD800..=0xDFFF) {
                cx.report(node, LONE_SURROGATE)
                    .data("surrogate", format!("\\u{unit:04x}"));
            }
        }
    }
}

impl Rule for NoUnsafeValues {
    const META: Meta = Meta::plugin(Plugin::Json, "no-unsafe-values", Kind::Problem)
        .recommended()
        .languages(crate::LANGUAGES);
    const ON: On = On::new().finish();
    type State<'a> = Document<'a>;

    fn new(_: &Options) -> Self {
        NoUnsafeValues
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
        Document::of(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let numbers = cx.state.nodes();
        for number in numbers.filter(|it| it.kind() == NodeKind::Number) {
            if let Some(problem) = problem_of(number.text()) {
                cx.report(number, problem).data("value", number.text());
            }
        }
        let strings = cx.state.unescaped();
        for string in strings.filter(|it| it.kind() == NodeKind::String) {
            Self::check_string(string, cx);
        }
    }
}
