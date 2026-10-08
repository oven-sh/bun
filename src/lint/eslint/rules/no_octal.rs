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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoOctal
    }

    /// ESTree has a `Literal` for a number in an expression, in a type and in the name of a property.
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
