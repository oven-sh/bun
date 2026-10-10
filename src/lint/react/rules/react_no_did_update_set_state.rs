use crate::react::{LifecycleWalk, callee_of_this_set_state, function_count_before_lifecycle_component};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of `setState` in `componentDidUpdate`.
pub struct NoDidUpdateSetState {
    disallow_in_func: bool,
}

const NO_DID_UPDATE_SET_STATE: Message = Message::new("", "Do not use `setState` in `componentDidUpdate`.");

#[derive(Default)]
pub struct State<'a> {
    function_count: LifecycleWalk<'a>,
}

impl Rule for NoDidUpdateSetState {
    const META: Meta = Meta::oxlint(Plugin::React, "no-did-update-set-state", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoDidUpdateSetState { disallow_in_func: options.str(0) == Some("disallow-in-func") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("setState") && file.mentions("componentDidUpdate")).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(callee) = callee_of_this_set_state(e)
            && let Some(function_count) =
                function_count_before_lifecycle_component(e, &["componentDidUpdate"], &mut cx.state.function_count)
            && (function_count <= 1 || self.disallow_in_func)
        {
            cx.report(callee, NO_DID_UPDATE_SET_STATE);
        }
    }
}
