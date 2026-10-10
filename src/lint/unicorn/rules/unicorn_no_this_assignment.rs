use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow assigning `this` to a variable.
pub struct NoThisAssignment;

const NO_THIS_ASSIGNMENT: Message = Message::new("", "Do not assign `this` to `{{ident_name}}`");

impl Rule for NoThisAssignment {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-this-assignment", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::This]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoThisAssignment
    }

    fn expr<'a>(&self, this: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match this.parent() {
            Node::VarDecl(declarator) => {
                if let Some(ident_name) = declarator.pat().as_ident() {
                    cx.report(declarator, NO_THIS_ASSIGNMENT).data("ident_name", ident_name);
                }
            }
            Node::Expr(assignment) => {
                if let ExprKind::Assign { target, .. } = assignment.kind()
                    && let Some(ident_name) = target.as_ident()
                    // Not the default value in a pattern.
                    && !assignment.is_assignment_target()
                {
                    cx.report(assignment, NO_THIS_ASSIGNMENT).data("ident_name", ident_name);
                }
            }
            _ => {}
        }
    }
}
