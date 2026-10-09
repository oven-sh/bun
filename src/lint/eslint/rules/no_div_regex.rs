use bun_lint::prelude::*;

/// Disallow equal signs explicitly at the beginning of regular expressions.
pub struct NoDivRegex;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "A regular expression literal can be confused with '/='.",
);

/// oxlint says nothing about `/=+$/`: there the pattern starts with what is repeated, not with a character.
fn oxlint_has_quantifier_at(text: &[u8], at: usize) -> bool {
    match text.get(at) {
        Some(b'*' | b'+' | b'?') => true,
        // `{1}`, `{1,}`, `{1,2}`
        Some(b'{') => {
            let rest = text.get(at + 1..).unwrap_or_default();
            let digits = |text: &[u8]| text.iter().take_while(|it| it.is_ascii_digit()).count();
            let min = digits(rest);
            let after = rest.get(min..).unwrap_or_default();
            min > 0
                && match after.strip_prefix(b",") {
                    Some(max) => max.get(digits(max)) == Some(&b'}'),
                    None => after.first() == Some(&b'}'),
                }
        }
        _ => false,
    }
}

impl Rule for NoDivRegex {
    const META: Meta = Meta::eslint("no-div-regex", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDivRegex
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Regex], |_, e, cx| {
            if e.text().get(1) != Some(&b'=') || cx.language().is_oxlint && oxlint_has_quantifier_at(e.text(), 2) {
                return;
            }
            let start = e.span().start;
            cx.report(e, UNEXPECTED)
                .fix(|fixer| fixer.replace(Span::new(start + 1, start + 2), "[=]"));
        });
    }
}
