use bun_lint_oxlint::ast_util::{get_inner_expression, is_global_turned_off, iter_outer_expressions, static_property_name};
use bun_lint_oxlint::import::{AssignmentTargets, is_assignment_target};
use crate::oxlint::node::{assigns_to_global_module_exports, is_global_exports_assignment_target};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce either `module.exports` or `exports`.
pub struct ExportsStyle {
    /// `"exports"`, not `"module.exports"`.
    prefers_exports: bool,
    allow_batch_assign: bool,
}

const UNEXPECTED_EXPORTS: Message = Message::new("", "Unexpected access to `exports`.");
const UNEXPECTED_MODULE_EXPORTS: Message = Message::new("", "Unexpected access to `module.exports`.");
const UNEXPECTED_ASSIGNMENT: Message = Message::new("", "Unexpected assignment to `exports`.");

impl Rule for ExportsStyle {
    const META: Meta = Meta::oxlint(Plugin::Node, "exports-style", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = AssignmentTargets<'a>;

    fn new(options: &Options) -> Self {
        ExportsStyle {
            prefers_exports: options.str(0) == Some("exports"),
            allow_batch_assign: options.object(1).bool_or("allowBatchAssign", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions("exports").then(AssignmentTargets::default)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if self.prefers_exports {
            self.check_module_exports_references(cx);
        } else {
            self.check_exports_references(cx);
        }
    }
}

/// The identifiers `name` that refer to nothing that the file declares.
fn global_references<'a>(name: &str, file: &'a File<'a>) -> impl Iterator<Item = Expr<'a>> {
    let is_on = !is_global_turned_off(file, name);
    let identifiers = is_on.then(|| file.unresolved_references_to(name.as_bytes())).into_iter().flatten().filter_map(Reference::expr);
    // The `a` of `[a = 1] = b` is two references.
    let mut previous = None;
    identifiers.filter(move |it| previous.replace(*it) != Some(*it))
}

/// The assignment that `node` is the left side of.
fn assignment_to<'a>(node: Expr<'a>, memo: &mut AssignmentTargets<'a>) -> Option<Expr<'a>> {
    node.parent().as_expr().filter(|it| it.tag() == ExprTag::Assign && it.left() == Some(node) && !is_assignment_target(*it, memo))
}

/// `a = b = c` is `a = (b = c)`: the `a = ..` that an assignment is in.
fn outermost_assignment(assignment: Expr<'_>) -> Expr<'_> {
    let mut at = assignment;
    while !at.is_parenthesized()
        && let Some(parent) = at.parent().as_expr().filter(|it| it.tag() == ExprTag::Assign)
    {
        at = parent;
    }
    at
}

/// `node`: `exports`, or `module.exports`. If it, or a property of it, is assigned to, the outermost of these assignments.
fn top_assignment<'a>(node: Expr<'a>, memo: &mut AssignmentTargets<'a>) -> Option<Expr<'a>> {
    let mut at = node;
    while !at.is_parenthesized()
        && !at.is_chain_root()
        && let Some(member) = at.parent().as_expr().filter(|it| it.object() == Some(at))
    {
        at = member;
    }
    assignment_to(at, memo).map(outermost_assignment)
}

fn assignment_chain_has(top_assignment: Expr, predicate: fn(Expr) -> bool) -> bool {
    let mut at = top_assignment;
    loop {
        if predicate(at) {
            return true;
        }
        match at.right().filter(|it| it.tag() == ExprTag::Assign && !it.is_parenthesized()) {
            Some(right) => at = right,
            None => return false,
        }
    }
}

fn assignment_chain_has_exports(top_assignment: Expr) -> bool {
    assignment_chain_has(top_assignment, |it| it.left().is_some_and(is_global_exports_assignment_target))
}

fn assignment_chain_has_module_exports(top_assignment: Expr) -> bool {
    assignment_chain_has(top_assignment, assigns_to_global_module_exports)
}

impl ExportsStyle {
    fn check_exports_references<'a>(&self, cx: &mut Cx<'a, Self>) {
        for node in global_references("exports", cx.file()) {
            if !(self.allow_batch_assign && top_assignment(node, &mut cx.state).is_some_and(assignment_chain_has_module_exports)) {
                cx.report(node, UNEXPECTED_EXPORTS);
            }
        }
    }

    fn check_module_exports_references<'a>(&self, cx: &mut Cx<'a, Self>) {
        for node in global_references("module", cx.file()) {
            // `(module as any).exports`
            let Some(Node::Expr(member)) = iter_outer_expressions(node).next() else {
                continue;
            };
            if member.object().map(get_inner_expression) == Some(node)
                && static_property_name(member).is_some_and(|name| name.is("exports"))
                && !(self.allow_batch_assign && top_assignment(member, &mut cx.state).is_some_and(assignment_chain_has_exports))
            {
                cx.report(member, UNEXPECTED_MODULE_EXPORTS);
            }
        }
        for node in global_references("exports", cx.file()) {
            if let Some(assignment) = assignment_to(node, &mut cx.state)
                && !(self.allow_batch_assign && assignment_chain_has_module_exports(outermost_assignment(assignment)))
            {
                cx.report(node, UNEXPECTED_ASSIGNMENT);
            }
        }
    }
}
