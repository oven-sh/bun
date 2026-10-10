use bun_lint_oxlint::ast_util::{as_member_expression, as_object_property, static_property_info};
use crate::react::is_jsx;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// This rule will warn you if you try to use the `ReactDOM.render()` return value.
pub struct NoRenderReturnValue;

const NO_RENDER_RETURN_VALUE: Message = Message::new("", "Do not depend on the return value from `ReactDOM.render`.");

impl Rule for NoRenderReturnValue {
    const META: Meta = Meta::oxlint(Plugin::React, "no-render-return-value", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Whether the innermost function or class around something is an arrow function without braces.
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(_: &Options) -> Self {
        NoRenderReturnValue
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (is_jsx(file) && file.mentions("ReactDOM") && file.mentions("render")).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(self, e, cx);
    }
}

fn check<'a>(_: &NoRenderReturnValue, e: Expr<'a>, cx: &mut Cx<'a, NoRenderReturnValue>) {
    let Some(member) = e.callee().and_then(as_member_expression) else {
        return;
    };
    let Some(ident) = member.object().filter(|it| it.is_ident("ReactDOM") && !it.is_parenthesized()) else {
        return;
    };
    let Some((property_span, _)) = static_property_info(member).filter(|it| it.1.is("render")) else {
        return;
    };
    let span = ident.span().to(property_span);
    let parent = e.parent();
    // Otherwise oxlint has a node between the two.
    let is_child_of_parent = !e.is_parenthesized() && !e.is_chain_root();
    let is_used = match parent {
        Node::VarDecl(_) => true,
        Node::Prop(_) => as_object_property(parent).is_some(),
        Node::Stmt(statement) => statement.tag() == StmtTag::Return,
        Node::Expr(assignment) => assignment.tag() == ExprTag::Assign && !assignment.is_assignment_target(),
        Node::Func(func) => func.is_arrow(),
        _ => false,
    };
    if is_child_of_parent && is_used {
        cx.report(span, NO_RENDER_RETURN_VALUE);
    }
    // A second time, if the scope that the parent is in is that of an arrow function without braces. A function and a
    // class are not in their own scope.
    let from = match parent {
        Node::Func(_) | Node::Class(_) if is_child_of_parent => parent,
        _ => Node::Expr(e),
    };
    let is_expression_arrow = |parent: Node<'a>| match parent {
        Node::Func(func) => Some(func.is_arrow() && matches!(func.body(), FnBody::Expr(_))),
        Node::Class(_) => Some(false),
        _ => None,
    };
    if cx.state.find(from, |_, parent| is_expression_arrow(parent)) == Some(true) {
        cx.report(span, NO_RENDER_RETURN_VALUE);
    }
}
