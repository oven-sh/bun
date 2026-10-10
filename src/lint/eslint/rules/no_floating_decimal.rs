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
    /// ESTree has a `Literal` for a number in an expression, in a type and in the name of a
    /// property.
    const ON: On = On::new()
        .exprs(&[ExprTag::Number])
        .types(&[TypeTag::NumberLit])
        .members()
        .props()
        .pats(&[PatTag::Object]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoFloatingDecimal
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(e.span(), cx);
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let literal = ty.span();
        match ty.text().starts_with(b"-") {
            true => check(Span::new(skip_trivia(cx.text(), literal.start + 1), literal.end), cx),
            false => check(literal, cx),
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.flags().intersects(Flags::LITERAL_NAME | Flags::COMPUTED_NAME) {
            check_key(member.key(), cx);
        }
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        check_key(property.key(), cx);
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let PatKind::Object(properties) = pattern.kind() {
            for property in properties {
                check_key(property.key(), cx);
            }
        }
    }
}
