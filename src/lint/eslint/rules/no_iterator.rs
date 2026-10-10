use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{get_static_string_value, is_member_expression};
use bun_lint::utils::estree_type_name;

/// Disallow the use of the `__iterator__` property.
pub struct NoIterator;

const NO_ITERATOR: Message = Message::new("noIterator", "Reserved name '__iterator__'.");

/// `member`: the `__iterator__` of `object`. oxlint suggests `object[Symbol.iterator]`.
fn report<'a>(member: Expr<'a>, object: Expr<'a>, cx: &Cx<'a, NoIterator>) {
    let report = cx.report(member, NO_ITERATOR);
    if cx.language().is_oxlint {
        report.fix(|fixer| fixer.replace(Span::new(object.outer_span().end, member.span().end), "[Symbol.iterator]"));
    }
}

impl Rule for NoIterator {
    const META: Meta = Meta::eslint("no-iterator", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).types(&[TypeTag::Ref]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoIterator
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]);
        if file.is_javascript() {
            return on;
        }
        on.types(&[TypeTag::Ref])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("__iterator__").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Dot => {
                if let ExprKind::Dot { obj, name, .. } = e.kind()
                    && name.name().is("__iterator__")
                    && is_member_expression(e)
                {
                    report(e, obj, cx);
                }
            }
            ExprTag::Index => {
                if let ExprKind::Index { obj, index, .. } = e.kind()
                    && matches!(index.tag(), ExprTag::String | ExprTag::Template)
                    && get_static_string_value(index).is_some_and(|name| &*name == b"__iterator__")
                {
                    report(e, obj, cx);
                }
            }
            _ => {}
        }
    }

    // `interface I extends a.b`, `class C implements a.b`: typescript-eslint has the name as
    // a `MemberExpression`.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
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
    }
}
