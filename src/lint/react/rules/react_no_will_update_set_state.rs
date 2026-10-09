use crate::react::{
    LifecycleWalk, callee_of_this_set_state, function_count_before_lifecycle_component, is_jsx,
    supports_unsafe_lifecycle_prefix,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows using `setState` in the `componentWillUpdate` lifecycle method.
pub struct NoWillUpdateSetState {
    disallow_in_func: bool,
}

const NO_WILL_UPDATE_SET_STATE: Message = Message::new("", "Do not use `setState` in `componentWillUpdate`.");

#[derive(Default)]
pub struct State<'a> {
    check_unsafe_prefix: bool,
    function_count: LifecycleWalk<'a>,
}

impl Rule for NoWillUpdateSetState {
    const META: Meta = Meta::oxlint(Plugin::React, "no-will-update-set-state", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoWillUpdateSetState { disallow_in_func: options.str(0) == Some("disallow-in-func") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_jsx(file)
            || !file.mentions("setState")
            || !file.mentions_any(&["componentWillUpdate", "UNSAFE_componentWillUpdate"])
        {
            return State::default();
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(callee) = callee_of_this_set_state(e) else {
                return;
            };
            let names: &[&str] = match cx.state.check_unsafe_prefix {
                true => &["componentWillUpdate", "UNSAFE_componentWillUpdate"],
                false => &["componentWillUpdate"],
            };
            if let Some(function_count) =
                function_count_before_lifecycle_component(e, names, &mut cx.state.function_count)
                && (function_count <= 1 || rule.disallow_in_func)
            {
                cx.report(callee, NO_WILL_UPDATE_SET_STATE);
            }
        });
        State { check_unsafe_prefix: supports_unsafe_lifecycle_prefix(file), ..State::default() }
    }
}
