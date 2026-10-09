use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, static_property_name};
use crate::unicorn::is_decorator;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule makes sure you always use `new` when throwing an error.
pub struct ThrowNewError;

const THROW_NEW_ERROR: Message = Message::new("", "Require `new` when throwing an error.");

impl Rule for ThrowNewError {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "throw-new-error", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ThrowNewError
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(callee) = e.callee() else {
                return;
            };
            let name = match callee.kind() {
                ExprKind::Ident(name) => name,
                ExprKind::Dot { name, .. } if !callee.is_private_member() && !callee.is_chain_root() => name.name(),
                _ => return,
            };
            if !matches!(name.bytes(), [b'A'..=b'Z', .., b'E', b'r', b'r', b'o', b'r'] | b"Error")
                || is_data_tagged_error(callee)
                || is_decorator(e)
            {
                return;
            }
            let report = cx.report(e, THROW_NEW_ERROR);
            // `class A extends B.CError() {}`
            if e.is_parenthesized() || !matches!(e.parent(), Node::Class(_)) {
                report.fix(|fixer| fixer.insert_before(e, "new "));
            }
        });
    }
}

/// `Data.TaggedError`
fn is_data_tagged_error(callee: Expr) -> bool {
    get_member_expr(callee).is_some_and(|member| {
        static_property_name(member).is_some_and(|it| it.is("TaggedError"))
            && member.object().is_some_and(|it| get_inner_expression(it).is_ident("Data"))
    })
}
