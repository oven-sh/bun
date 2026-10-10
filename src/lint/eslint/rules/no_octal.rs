use bun_lint::prelude::*;

/// Disallow octal literals.
pub struct NoOctal;

const NO_OCTAL: Message = Message::new("noOctal", "Octal literals should not be used.");

fn check(literal: Span, cx: &Cx<'_, NoOctal>) {
    if matches!(cx.slice(literal), [b'0', b'0'..=b'9', ..]) {
        cx.report(literal, NO_OCTAL);
    }
}

fn check_key<'a>(key: Option<Key<'a>>, cx: &Cx<'a, NoOctal>) {
    if let Some(key) = key
        && matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
    {
        check(key.inner_span(cx.file()), cx);
    }
}

impl Rule for NoOctal {
    const META: Meta = Meta::eslint("no-octal", Kind::Suggestion).recommended();
    /// ESTree has a `Literal` for a number in an expression, in a type and in the name of a property.
    const ON: On = On::new()
        .exprs(&[ExprTag::Number])
        .types(&[TypeTag::NumberLit])
        .members()
        .props()
        .pats(&[PatTag::Object]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoOctal
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
