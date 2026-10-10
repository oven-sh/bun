use bun_lint_oxlint::ast_util::{as_object_property, static_property_info};
use crate::react::is_jsx;
use crate::util_is_create_element::is_member_called;
use crate::util_version::{ULTIMATE_LATEST_SEMVER, Version, get_react_version_from_context};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow usage of the return value of ReactDOM.render
pub struct NoRenderReturnValue;

const NO_RETURN_VALUE: Message =
    Message::new("noReturnValue", "Do not depend on the return value from {{node}}.render");
const OXLINT: Message = Message::new("", "Do not depend on the return value from `ReactDOM.render`.");

pub struct State<'a> {
    callee_object_names: &'static [&'static str],
    /// Whether the innermost function or class around something is an arrow function without braces.
    is_in_expression_arrow: AncestorMemo<'a, bool>,
}

impl Rule for NoRenderReturnValue {
    const META: Meta = Meta::plugin(Plugin::React, "no-render-return-value", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoRenderReturnValue
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        // oxlint passes over a file that cannot have JSX. upstream takes a private name for its text.
        let is_candidate = !is_oxlint || is_jsx(file);
        let is_mentioned = file.mentions("render") || (!is_oxlint && file.mentions("#render"));
        if !is_candidate || !is_mentioned || !file.mentions_any(&["ReactDOM", "React"]) {
            return None;
        }
        // oxlint asks for no version.
        let version = if is_oxlint { ULTIMATE_LATEST_SEMVER } else { get_react_version_from_context(file) };
        let callee_object_names = callee_object_names(version);
        file.mentions_any(callee_object_names)
            .then(|| State { callee_object_names, is_in_expression_arrow: AncestorMemo::default() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has a node for parentheses.
        let is_wrapped = |it: Expr<'a>| it.is_chain_root() || (is_oxlint && it.is_parenthesized());
        let Some(callee) = e.callee().filter(|&it| !is_wrapped(it)) else {
            return;
        };
        let Some(object) = callee.object().filter(|&it| !is_wrapped(it)) else {
            return;
        };
        let Some(name) = object.as_ident().filter(|it| it.is_any(cx.state.callee_object_names)) else {
            return;
        };
        // oxlint knows `["render"]` and ends at the name, upstream knows `[render]` and `.#render`.
        let callee_span = if is_oxlint {
            static_property_info(callee).filter(|it| it.1.is("render")).map(|it| object.span().to(it.0))
        } else {
            is_member_called(callee, "render").then(|| callee.span())
        };
        let Some(span) = callee_span else {
            return;
        };
        let parent = e.parent();
        let is_child_of_parent = !is_wrapped(e);
        let is_used = match parent {
            Node::VarDecl(_) => true,
            Node::Prop(_) => as_object_property(parent).is_some(),
            // The key of a `Property` in a pattern, which is another kind of node for oxlint.
            Node::PatProp(property) => !is_oxlint && property.default() != Some(e),
            Node::Stmt(statement) => statement.tag() == StmtTag::Return,
            Node::Expr(assignment) => assignment.tag() == ExprTag::Assign && !assignment.is_assignment_target(),
            Node::Func(func) => func.is_arrow(),
            _ => false,
        };
        if is_child_of_parent && is_used {
            cx.report(span, if is_oxlint { OXLINT } else { NO_RETURN_VALUE }).data("node", name);
        }
        if !is_oxlint {
            return;
        }
        // oxlint: a second time, if the scope that the parent is in is that of an arrow function without braces. A
        // function and a class are not in their own scope.
        let from = match parent {
            Node::Func(_) | Node::Class(_) if is_child_of_parent => parent,
            _ => Node::Expr(e),
        };
        let is_expression_arrow = |parent: Node<'a>| match parent {
            Node::Func(func) => Some(func.is_arrow() && matches!(func.body(), FnBody::Expr(_))),
            Node::Class(_) => Some(false),
            _ => None,
        };
        if cx.state.is_in_expression_arrow.find(from, |_, parent| is_expression_arrow(parent)) == Some(true) {
            cx.report(span, OXLINT);
        }
    }
}

/// upstream's `calleeObjectName`
fn callee_object_names(version: Version) -> &'static [&'static str] {
    if ((0, 14, 0)..(0, 15, 0)).contains(&version) {
        &["React", "ReactDOM"]
    } else if ((0, 13, 0)..(0, 14, 0)).contains(&version) {
        &["React"]
    } else {
        &["ReactDOM"]
    }
}
