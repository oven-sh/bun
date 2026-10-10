use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule applies when an Array function has a callback argument used for an array with empty slots.
pub struct UninvokedArrayCallback;

const UNINVOKED_ARRAY_CALLBACK: Message = Message::new("", "Uninvoked array callback");

impl Rule for UninvokedArrayCallback {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "uninvoked-array-callback", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        UninvokedArrayCallback
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Array").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new_expr) = e.kind() else {
            return;
        };
        let is_plain = |it: Expr, tag: ExprTag| it.tag() == tag && !it.is_parenthesized();
        if !get_inner_expression(new_expr.callee()).is_ident("Array")
            || new_expr.args().len() != 1
            || !new_expr.args().first().is_some_and(|it| is_plain(it, ExprTag::Number))
            || e.is_parenthesized()
        {
            return;
        }
        let Node::Expr(member) = e.parent() else {
            return;
        };
        let property_span = match member.kind() {
            ExprKind::Dot { name, .. } => name.span(),
            ExprKind::Index { index, .. } => index.outer_span(),
            _ => return,
        };
        if let Node::Expr(parent) = member.parent()
            && let Some(call) = parent.as_call()
            && !member.is_parenthesized()
            && !member.is_chain_root()
            && call.args().first().is_some_and(|it| is_plain(it, ExprTag::Fn))
        {
            cx.report(property_span, UNINVOKED_ARRAY_CALLBACK)
                .first_label("this callback will not be invoked")
                .label(e, "because this is an array with only empty slots");
        }
    }
}
