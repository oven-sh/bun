use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_static_string_value;
use bun_lint::utils::estree_type_name;

/// Disallow the use of the `__iterator__` property.
pub struct NoIterator;

const NO_ITERATOR: Message = Message::new("noIterator", "Reserved name '__iterator__'.");

/// Whether ESLint has a `MemberExpression` for the `Dot`: not in the name of a JSX element, and not
/// in the operand of a `typeof` type.
fn is_member_expression(e: Expr<'_>) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Dot { obj, .. } if obj == at => at = parent,
                ExprKind::Jsx(jsx) => return jsx.tag() != Some(at) && jsx.close_tag() != Some(at),
                _ => return true,
            },
            Node::Type(ty) => return !matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return true,
        }
    }
}

impl Rule for NoIterator {
    const META: Meta = Meta::eslint("no-iterator", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoIterator
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions("__iterator__") {
            on.exprs([ExprTag::Dot], |_, e, cx| {
                if let ExprKind::Dot { name, .. } = e.kind()
                    && name.name().is("__iterator__")
                    && is_member_expression(e)
                {
                    cx.report(e, NO_ITERATOR);
                }
            });
            on.exprs([ExprTag::Index], |_, e, cx| {
                if let ExprKind::Index { index, .. } = e.kind()
                    && matches!(index.tag(), ExprTag::String | ExprTag::Template)
                    && get_static_string_value(index).is_some_and(|name| &*name == b"__iterator__")
                {
                    cx.report(e, NO_ITERATOR);
                }
            });
        }
        if file.is_javascript() || !file.mentions("__iterator__") {
            return;
        }
        // `interface I extends a.b`, `class C implements a.b`: typescript-eslint has the name as
        // a `MemberExpression`.
        on.types([TypeTag::Ref], |_, ty, cx| {
            let TypeKind::Ref { name, .. } = ty.kind() else {
                return;
            };
            if name.len() < 2 || !name.parts().skip(1).any(|part| part.name().is("__iterator__")) {
                return;
            }
            if estree_type_name(Node::Type(ty)) == "TSTypeReference" {
                return;
            }
            for part in name.parts().skip(1).filter(|part| part.name().is("__iterator__")) {
                cx.report(Span::new(ty.span().start, part.span().end), NO_ITERATOR);
            }
        });
    }
}
