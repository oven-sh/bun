use bun_lint_oxlint::ast_util::{call_expr_method_callee_info, get_member_expr, is_computed, is_method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers the use of `child.remove()` over `parentNode.removeChild(child)`.
pub struct PreferDomNodeRemove;

const PREFER_DOM_NODE_REMOVE: Message =
    Message::new("", "Prefer `childNode.remove()` over `parentNode.removeChild(childNode)`.");

/// What can never be a DOM node.
fn is_non_dom_node(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Array(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Object(_)
        | ExprKind::Template(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::String(_)
        | ExprKind::Unary { op: UnOp::Void, .. } => true,
        ExprKind::Ident(name) => name.is("undefined"),
        _ => false,
    }
}

impl Rule for PreferDomNodeRemove {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-dom-node-remove", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDomNodeRemove
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("removeChild") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|it| !it.is_optional()) else {
            return;
        };
        if is_method_call(call, None, Some(&["removeChild"]), Some(1), Some(1))
            && let Some(member) = get_member_expr(call.callee()).filter(|it| !is_computed(*it))
            && !member.object().is_some_and(is_non_dom_node)
            && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread && !is_non_dom_node(it))
            && let Some((span, _)) = call_expr_method_callee_info(call)
        {
            cx.report(span, PREFER_DOM_NODE_REMOVE);
        }
    }
}
