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

fn check_key<'a>(key: Option<Key<'a>>, cx: &Cx<'a, NoFloatingDecimal>) {
    if let Some(key) = key
        && matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
    {
        check(key.inner_span(cx.file()), cx);
    }
}

impl Rule for NoFloatingDecimal {
    const META: Meta = Meta::eslint("no-floating-decimal", Kind::Suggestion)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoFloatingDecimal
    }

    /// ESTree has a `Literal` for a number in an expression, in a type and in the name of a
    /// property.
    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Number], |_, e, cx| check(e.span(), cx));
        on.types([TypeTag::NumberLit], |_, ty, cx| {
            let literal = ty.span();
            match ty.text().starts_with(b"-") {
                true => check(Span::new(skip_trivia(cx.text(), literal.start + 1), literal.end), cx),
                false => check(literal, cx),
            }
        });
        on.members(|_, member, cx| {
            if member.flags().intersects(Flags::LITERAL_NAME | Flags::COMPUTED_NAME) {
                check_key(member.key(), cx);
            }
        });
        on.props(|_, property, cx| check_key(property.key(), cx));
        on.pats([PatTag::Object], |_, pattern, cx| {
            if let PatKind::Object(properties) = pattern.kind() {
                for property in properties {
                    check_key(property.key(), cx);
                }
            }
        });
    }
}
