use bun_lint_oxlint::ast_util::parent_node;
use crate::oxlint::vue::{is_vue_file, next_tick_imports, next_tick_property};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce Promise or callback style in `nextTick`.
pub struct NextTickStyle {
    is_callback: bool,
}

const USE_PROMISE: Message = Message::new("", "Use the Promise returned by `nextTick` instead of passing a callback function.");
const USE_CALLBACK: Message = Message::new("", "Pass a callback function to `nextTick` instead of using the returned Promise.");

impl Rule for NextTickStyle {
    const META: Meta = Meta::oxlint(Plugin::Vue, "next-tick-style", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot]).finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NextTickStyle { is_callback: options.str(0) == Some("callback") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || !file.mentions_any(&["nextTick", "$nextTick"]) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(report_span) = next_tick_property(member) {
            self.check(member, report_span, cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        next_tick_imports(cx.file()).for_each(|it| self.check(it, it.span(), cx));
    }
}

impl NextTickStyle {
    fn check<'a>(&self, node: Expr<'a>, report_span: Span, cx: &Cx<'a, Self>) {
        let Some(parent) = parent_node(node).and_then(Node::as_expr) else {
            return;
        };
        let Some(call) = parent.as_call().filter(|it| it.callee() == node) else {
            return;
        };
        let is_awaited_promise = match parent_node(parent).and_then(Node::as_expr).map(Expr::kind) {
            Some(ExprKind::Await(_)) => true,
            Some(ExprKind::Dot { name, .. }) => name.name().is("then"),
            _ => false,
        };
        if self.is_callback {
            if call.args().len() != 1 || is_awaited_promise {
                cx.report(report_span, USE_CALLBACK);
            }
        } else if !call.args().is_empty() || !is_awaited_promise {
            cx.report(report_span, USE_PROMISE).fix(|fixer| fixer.insert_after(report_span, "().then"));
        }
    }
}
