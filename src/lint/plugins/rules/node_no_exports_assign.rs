use bun_lint_oxlint::import::{AssignmentTargets, is_assignment_target};
use crate::oxlint::node::{assigns_to_global_module_exports, is_global_exports_assignment_target};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows assignment to `exports`.
pub struct NoExportsAssign;

const NO_EXPORTS_ASSIGN: Message = Message::new("", "Unexpected assignment to 'exports'.");

impl Rule for NoExportsAssign {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-exports-assign", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Assign]);
    type State<'a> = AssignmentTargets<'a>;

    fn new(_: &Options) -> Self {
        NoExportsAssign
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions("exports").then(AssignmentTargets::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Assign { target, value, .. } = e.kind() else {
            return;
        };
        if !is_global_exports_assignment_target(target) || is_assignment_target(e, &mut cx.state) {
            return;
        }
        // `exports = module.exports = {}`, `module.exports = exports = {}`
        if !value.is_parenthesized() && assigns_to_global_module_exports(value)
            || !e.is_parenthesized() && e.parent().as_expr().is_some_and(assigns_to_global_module_exports)
        {
            return;
        }
        cx.report(target, NO_EXPORTS_ASSIGN).fix(|fixer| fixer.replace(target, "module.exports"));
    }
}
