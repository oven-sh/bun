use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow leading or trailing decimal points in numeric literals.
pub struct NoFloatingDecimal;

const LEADING: Message = Message::new(
    "leading",
    "A leading decimal point can be confused with a dot.",
);
const TRAILING: Message = Message::new(
    "trailing",
    "A trailing decimal point can be confused with a dot.",
);

fn check(literal: Span, cx: &Cx<'_, NoFloatingDecimal>) {
    let raw = cx.slice(literal);
    let Some(point) = strings::index_of_char_usize(raw, b'.') else {
        return;
    };
    if point == 0 {
        cx.report(literal, LEADING).fix(|fixer| {
            let needs_space_before = fixer.file().token_before(literal).is_some_and(|before| {
                before.end() == literal.start
                    && !ast_utils::can_tokens_be_adjacent(before, &[&b"0"[..], raw].concat())
            });
            fixer.insert_before(literal, if needs_space_before { " 0" } else { "0" })
        });
    }
    if point + 1 == raw.len() {
        cx.report(literal, TRAILING).fix(|fixer| fixer.insert_after(literal, "0"));
    }
}

impl Rule for NoFloatingDecimal {
    const META: Meta = Meta::eslint("no-floating-decimal", Kind::Suggestion)
        .fixable(Fixable::Code)
        .deprecated();
    const ON: On = On::new().number_literals();
    no_state!();

    fn new(_: &Options) -> Self {
        NoFloatingDecimal
    }

    fn number_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        check(literal.span(), cx);
    }
}
