use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the use of, for example, `document.body.append(div);` over `document.body.appendChild(div);` for DOM nodes.
pub struct PreferDomNodeAppend;

const PREFER_DOM_NODE_APPEND: Message =
    Message::new("", "Prefer `Node#append()` over `Node#appendChild()` for DOM nodes.");

impl Rule for PreferDomNodeAppend {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-dom-node-append", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().method_calls(&["appendChild"]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferDomNodeAppend
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions("appendChild") { Self::ON } else { On::new() }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call_expr) = e.as_call()
            && call_expr.args().len() == 1
            && !call_expr.is_optional()
            && let Some(ExprKind::Dot { name, .. }) = get_member_expr(call_expr.callee()).map(Expr::kind)
            && name.name().is("appendChild")
            && call_expr.args().first().is_some_and(|it| it.tag() != ExprTag::Spread)
        {
            cx.report(name, PREFER_DOM_NODE_APPEND).fix(|fixer| fixer.replace(name, "append"));
        }
    }
}
