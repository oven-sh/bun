use crate::react::{LifecycleWalk, callee_of_this_set_state, function_count_before_lifecycle_component};
use crate::util_make_no_method_set_state_rule::{Mode, Walks, method_around_set_state, should_be_noop};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of setState in componentDidUpdate
pub struct NoDidUpdateSetState {
    mode: Mode,
}

const NO_SET_STATE: Message = Message::new("noSetState", "Do not use setState in {{name}}");
const OXLINT: Message = Message::new("", "Do not use `setState` in `componentDidUpdate`.");

#[derive(Default)]
pub struct State<'a> {
    function_count: LifecycleWalk<'a>,
    walks: Walks<'a>,
}

impl Rule for NoDidUpdateSetState {
    const META: Meta = Meta::plugin(Plugin::React, "no-did-update-set-state", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let disallow_in_func = options.str(0) == Some("disallow-in-func");
        NoDidUpdateSetState { mode: if disallow_in_func { Mode::DisallowInFunc } else { Mode::AllowInFunc } }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_candidate = if file.language().is_oxlint {
            file.mentions("setState") && file.mentions("componentDidUpdate")
        } else {
            // upstream takes a private name for its text, and does nothing from React 16.3 on.
            file.mentions_any(&["setState", "#setState"])
                && file.mentions_any(&["componentDidUpdate", "#componentDidUpdate"])
                && !should_be_noop(file, "componentDidUpdate")
        };
        is_candidate.then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.language().is_oxlint {
            let name_matches = |name: &[u8]| name == b"componentDidUpdate";
            if let Some(name) = method_around_set_state(e, &name_matches, self.mode, &mut cx.state.walks)
                && let Some(callee) = e.callee()
            {
                cx.report(callee, NO_SET_STATE).data("name", name);
            }
            return;
        }
        // oxlint wants a component around the method, and does not count a function that is the parent of the call.
        if let Some(callee) = callee_of_this_set_state(e)
            && let Some(function_count) =
                function_count_before_lifecycle_component(e, &["componentDidUpdate"], &mut cx.state.function_count)
            && (function_count <= 1 || self.mode == Mode::DisallowInFunc)
        {
            cx.report(callee, OXLINT);
        }
    }
}
