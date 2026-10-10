use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires using BigInt literals (e.g. `123n`) instead of calling the `BigInt()` constructor with literal arguments
/// such as numbers or numeric strings.
pub struct PreferBigintLiterals;

const PREFER_BIGINT_LITERALS: Message = Message::new("", "Prefer bigint literals over `BigInt(...)`.");

fn trim_leading_zeros(raw: &[u8]) -> &[u8] {
    let zeros = raw.iter().take_while(|it| **it == b'0').count();
    match raw.get(zeros..) {
        Some(rest) if !rest.is_empty() => rest,
        _ => b"0",
    }
}

/// The literal for the string `value`, if that is an integer as JavaScript writes them.
fn bigint_literal_from_string(value: &[u8]) -> Option<Vec<u8>> {
    let trimmed = std::str::from_utf8(value).ok()?.trim().as_bytes();
    let (digits, is_digit): (&[u8], fn(&u8) -> bool) = match trimmed {
        [b'0', b'b' | b'B', digits @ ..] => (digits, |it| matches!(it, b'0' | b'1')),
        [b'0', b'o' | b'O', digits @ ..] => (digits, |it| matches!(it, b'0'..=b'7')),
        [b'0', b'x' | b'X', digits @ ..] => (digits, u8::is_ascii_hexdigit),
        [b'0'..=b'9', ..] => (trimmed, u8::is_ascii_digit),
        _ => return None,
    };
    let is_decimal = digits.len() == trimmed.len();
    digits.iter().all(is_digit).then(|| [if is_decimal { trim_leading_zeros(trimmed) } else { trimmed }, b"n"].concat())
}

/// The literal for the number that is written `raw`.
fn bigint_literal_from_numeric(raw: &[u8]) -> Option<Vec<u8>> {
    // Also in `0xe`.
    if strings::index_of_any(raw, b"eE.").is_some() {
        return None;
    }
    Some(match raw {
        [b'0', b'b' | b'B' | b'x' | b'X' | b'o' | b'O', ..] => [raw, b"n"].concat(),
        // `0777n` is no literal.
        [b'0', digits @ ..] if !digits.is_empty() && digits.iter().all(|it| matches!(it, b'0'..=b'7')) => {
            [&b"0o"[..], trim_leading_zeros(raw), b"n"].concat()
        }
        _ => [trim_leading_zeros(raw), b"n"].concat(),
    })
}

impl Rule for PreferBigintLiterals {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-bigint-literals", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferBigintLiterals
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("BigInt") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
            return;
        };
        if !get_inner_expression(call.callee()).is_ident("BigInt") {
            return;
        }
        let Some(argument) = call.args().first() else {
            return;
        };
        let literal = get_inner_expression(argument);
        let replacement = match literal.kind() {
            ExprKind::String(value) => match bigint_literal_from_string(value.bytes()) {
                Some(replacement) => Some(replacement),
                None => return,
            },
            ExprKind::Number(n) if n.fract() == 0.0 => bigint_literal_from_numeric(literal.text()),
            _ => return,
        };
        cx.report(argument.outer_span(), PREFER_BIGINT_LITERALS)
            .fix(|fixer| replacement.map(|it| fixer.replace(e, it)));
    }
}
