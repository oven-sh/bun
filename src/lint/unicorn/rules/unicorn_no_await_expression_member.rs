use crate::unicorn::concat;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows member access from `await` expressions.
pub struct NoAwaitExpressionMember;

const NO_AWAIT_EXPRESSION_MEMBER: Message = Message::new("", "Do not access a member directly from an await expression.");

impl Rule for NoAwaitExpressionMember {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-await-expression-member", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Await]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoAwaitExpressionMember
    }

    fn expr<'a>(&self, awaited: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // `(await a).b`, not `((await a)).b`
        let Node::Expr(member_expr) = awaited.parent() else {
            return;
        };
        if member_expr.object() != Some(awaited) || awaited.parens().len() != 1 {
            return;
        }
        cx.report(member_expr, NO_AWAIT_EXPRESSION_MEMBER).fix_dangerously(|fixer| {
            let Node::VarDecl(parent) = member_expr.parent() else {
                return None;
            };
            if member_expr.is_in_optional_chain() || member_expr.is_parenthesized() || parent.ty().is_some() {
                return None;
            }
            let name = parent.pat().as_ident()?.bytes();
            let replacement = match member_expr.kind() {
                // `const a = (await b())[0]` is `const [a] = await b()`
                ExprKind::Index { index, .. } if index.tag() == ExprTag::Number && !index.is_parenthesized() => match index.text() {
                    b"0" => concat(&[b"[", name, b"]"]),
                    b"1" => concat(&[b"[, ", name, b"]"]),
                    _ => return None,
                },
                // `const a = (await b()).a` is `const {a} = await b()`
                ExprKind::Dot { name: property, .. } if property.bytes() == name => concat(&[b"{", name, b"}"]),
                _ => return None,
            };
            let inner_text = fixer.file().slice(awaited.outer_span().shrink(1, 1));
            Some([fixer.replace(parent.pat(), replacement), fixer.replace(member_expr, inner_text)])
        });
    }
}
