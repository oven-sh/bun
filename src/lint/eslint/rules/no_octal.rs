use bun_lint::prelude::*;

/// Disallow octal literals.
pub struct NoOctal;

const NO_OCTAL: Message = Message::new("noOctal", "Octal literals should not be used.");

impl Rule for NoOctal {
    const META: Meta = Meta::eslint("no-octal", Kind::Suggestion).recommended();
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(_: &Options) -> Self {
        NoOctal
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(literal.text(), [b'0', b'0'..=b'9', ..]) {
            cx.report(literal, NO_OCTAL);
        }
    }
}
