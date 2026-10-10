use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces proper case for numeric literals.
pub struct NumberLiteralCase;

const UPPERCASE_PREFIX: Message = Message::new("", "Unexpected number literal prefix in uppercase.");
const UPPERCASE_EXPONENTIAL_NOTATION: Message = Message::new("", "Unexpected exponential notation in uppercase.");
const LOWERCASE_HEXADECIMAL_DIGITS: Message = Message::new("", "Unexpected hexadecimal digits in lowercase.");
const UPPERCASE_PREFIX_AND_LOWERCASE_HEXADECIMAL_DIGITS: Message =
    Message::new("", "Unexpected number literal prefix in uppercase and hexadecimal digits in lowercase.");

impl Rule for NumberLiteralCase {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "number-literal-case", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(_: &Options) -> Self {
        NumberLiteralCase
    }

    fn number_literal<'a>(&self, number: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let (number_literal, raw_span) = (number.text(), number.span());
        let prefix = Span::new(raw_span.start + 1, raw_span.start + 2);
        let (message, span, fixed_literal) = match number_literal {
            [b'0', b'B' | b'O', ..] => (UPPERCASE_PREFIX, prefix, number_literal.to_ascii_lowercase()),
            [b'0', x @ (b'X' | b'x'), digits @ ..] => {
                let has_lowercase_digits = digits.iter().any(|it| matches!(it, b'a'..=b'f'));
                let (message, span) = match (*x == b'X', has_lowercase_digits) {
                    (true, true) => (UPPERCASE_PREFIX_AND_LOWERCASE_HEXADECIMAL_DIGITS, raw_span),
                    (true, false) => (UPPERCASE_PREFIX, prefix),
                    (false, true) => (LOWERCASE_HEXADECIMAL_DIGITS, raw_span.shrink(2, 0)),
                    (false, false) => return,
                };
                // The `n` of a `BigInt` stays.
                let upper = |it: &u8| if *it == b'n' { b'n' } else { it.to_ascii_uppercase() };
                (message, span, b"0x".iter().copied().chain(digits.iter().map(upper)).collect())
            }
            _ => match strings::index_of_char(number_literal, b'E') {
                Some(index) => {
                    let char_position = raw_span.start + index;
                    let span = Span::new(char_position, char_position + 1);
                    (UPPERCASE_EXPONENTIAL_NOTATION, span, number_literal.to_ascii_lowercase())
                }
                None => return,
            },
        };
        let lowercase_prefix = fixed_literal.get(..2).unwrap_or_default().to_vec();
        let report = cx.report(span, message).data("prefix", lowercase_prefix);
        report.fix(|fixer| fixer.replace(raw_span, fixed_literal));
    }
}
