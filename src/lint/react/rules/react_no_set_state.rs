use crate::react::{callee_of_this_set_state, get_parent_component, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow the usage of `this.setState` in React components.
pub struct NoSetState;

const NO_SET_STATE: Message = Message::new("", "Do not use `setState`.");

impl Rule for NoSetState {
    const META: Meta = Meta::oxlint(Plugin::React, "no-set-state", Kind::Suggestion);
    /// The component that something is in.
    type State<'a> = AncestorMemo<'a, Node<'a>>;

    fn new(_: &Options) -> Self {
        NoSetState
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_jsx(file) && file.mentions("setState") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if let Some(callee) = callee_of_this_set_state(e)
                    && get_parent_component(Node::Expr(e), &mut cx.state).is_some()
                {
                    cx.report(callee, NO_SET_STATE);
                }
            });
        }
        AncestorMemo::default()
    }
}
