use bun_lint_oxlint::ast_util::as_method_definition;
use crate::react::{
    AncestorWalk, get_outer_member_expression, is_es5_component, is_es6_component, is_jsx, is_state_member_expression,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::ops::ControlFlow;

/// Disallow direct mutation of `this.state`.
pub struct NoDirectMutationState;

const NO_DIRECT_MUTATION_STATE: Message = Message::new("", "Never mutate `this.state` directly.");

const IN_CONSTRUCTOR: u8 = 1 << 0;
const IN_CALL_EXPRESSION: u8 = 1 << 1;
const IN_COMPONENT: u8 = 1 << 2;

#[derive(Default)]
pub struct State<'a> {
    /// What something is in, up to the innermost class.
    around: AncestorWalk<'a, u8, u8>,
}

impl Rule for NoDirectMutationState {
    const META: Meta = Meta::oxlint(Plugin::React, "no-direct-mutation-state", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDirectMutationState
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_jsx(file) && file.mentions("state") && file.has_exprs([ExprTag::This]) {
            on.exprs([ExprTag::Assign], |_, e, cx| {
                if let Some(left) = e.left()
                    && is_mutation_of_state(left)
                    && !e.is_assignment_target()
                    && !should_ignore_component(e, cx)
                {
                    cx.report(left, NO_DIRECT_MUTATION_STATE);
                }
            });
            on.unaries([UnOp::PreInc, UnOp::PreDec, UnOp::PostInc, UnOp::PostDec], |_, e, cx| {
                if e.operand().is_some_and(is_mutation_of_state) && !should_ignore_component(e, cx) {
                    cx.report(e, NO_DIRECT_MUTATION_STATE);
                }
            });
        }
        State::default()
    }
}

/// `target`: what is assigned to.
fn is_mutation_of_state(target: Expr) -> bool {
    get_outer_member_expression(target).is_some_and(is_state_member_expression)
}

fn should_ignore_component<'a>(e: Expr<'a>, cx: &mut Cx<'a, NoDirectMutationState>) -> bool {
    let found = cx.state.around.run(Node::Expr(e), 0, |_, parent, found| match parent {
        Node::Member(_) if as_method_definition(parent).is_some_and(Member::is_constructor) => {
            ControlFlow::Continue(found | IN_CONSTRUCTOR)
        }
        Node::Expr(e) if e.tag() == ExprTag::Call && is_es5_component(parent) => {
            ControlFlow::Continue(found | IN_CALL_EXPRESSION | IN_COMPONENT)
        }
        Node::Expr(e) if e.tag() == ExprTag::Call => ControlFlow::Continue(found | IN_CALL_EXPRESSION),
        Node::Class(_) if is_es6_component(parent) => ControlFlow::Break(found | IN_COMPONENT),
        Node::Class(_) | Node::File(_) => ControlFlow::Break(found),
        _ => ControlFlow::Continue(found),
    });
    found & (IN_CONSTRUCTOR | IN_CALL_EXPRESSION) == IN_CONSTRUCTOR || found & IN_COMPONENT == 0
}
