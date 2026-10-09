//! Helpers of the rules of oxlint 1.87, under the names that they have there: for what a rule does
//! with a configuration of oxlint.

use super::ancestor_memo::AncestorMemo;
use super::ast_utils::is_global_reference;
use crate::ast::{Expr, Flags, Func, ModuleName, Node, StmtKind};
use crate::span::Span;

/// [`is_global_reference`] for the rules whose port in oxlint goes by the name and does not ask what it refers to:
/// `Boolean`, `Promise`, `NaN`. With a configuration of oxlint it is enough that `e`, which the caller knows
/// to have the name, is written.
pub fn is_global_by_name(e: Expr) -> bool {
    e.file().language().is_oxlint || is_global_reference(e)
}

/// `GetFunctionHeadLoc` of tsgolint 7.0. Of an arrow function it is the `=>` and what is between it and the token before.
/// Of another function it is from the first modifier that is no decorator, or else from the first token, to the `(`: the
/// key of a property that the function is the value of is not part of it.
pub fn tsgolint_function_head_loc(func: Func) -> Span {
    if let Some(arrow) = func.arrow_span() {
        let start = func.file().end_of_token_before(arrow.start);
        return Span::new(start, arrow.end);
    }
    let whole = func.span();
    let modifier = match func.owner() {
        Node::Member(member) => member
            .modifiers()
            .iter()
            .find(|it| it.decorator().is_none()),
        _ => None,
    };
    let start = modifier.map_or(whole.start, |it| it.span().start);
    match func.open_paren() {
        Some(end) if start <= end => Span::new(start, end),
        _ => whole,
    }
}

/// `has_ambient_typescript_ancestor`, asked of many nodes of a file.
#[derive(Default)]
pub struct AmbientAncestors<'a>(AncestorMemo<'a, ()>);

impl<'a> AmbientAncestors<'a> {
    /// Whether `node` is in a `declare namespace`, a `declare module` or a `global`.
    pub fn has_ambient_typescript_ancestor(&mut self, node: Node<'a>) -> bool {
        let is_ambient = |_, parent: Node<'a>| match parent {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Module(module) => {
                    let is_ambient = matches!(module.name(), ModuleName::Global)
                        || statement.flags().contains(Flags::AMBIENT);
                    is_ambient.then_some(())
                }
                _ => None,
            },
            _ => None,
        };
        self.0.find(node, is_ambient).is_some()
    }
}
