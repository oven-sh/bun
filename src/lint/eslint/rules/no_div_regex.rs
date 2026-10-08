use bun_lint::prelude::*;

/// Disallow equal signs explicitly at the beginning of regular expressions.
pub struct NoDivRegex;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "A regular expression literal can be confused with '/='.",
);

impl Rule for NoDivRegex {
    const META: Meta = Meta::eslint("no-div-regex", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDivRegex
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Regex], |_, e, cx| {
            if e.text().get(1) != Some(&b'=') {
                return;
            }
            let start = e.span().start;
            cx.report(e, UNEXPECTED)
                .fix(|fixer| fixer.replace(Span::new(start + 1, start + 2), "[=]"));
        });
    }
}
