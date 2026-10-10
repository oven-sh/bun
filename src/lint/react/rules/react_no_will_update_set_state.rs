use crate::react::{
    LifecycleWalk, callee_of_this_set_state, function_count_before_lifecycle_component, is_jsx,
    supports_unsafe_lifecycle_prefix,
};
use crate::util_make_no_method_set_state_rule::{Mode, Walks, method_around_set_state};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of setState in componentWillUpdate
pub struct NoWillUpdateSetState {
    mode: Mode,
}

const NO_SET_STATE: Message = Message::new("noSetState", "Do not use setState in {{name}}");
const OXLINT: Message = Message::new("", "Do not use `setState` in `componentWillUpdate`.");

#[derive(Default)]
pub struct State<'a> {
    check_unsafe_prefix: bool,
    function_count: LifecycleWalk<'a>,
    walks: Walks<'a>,
}

impl Rule for NoWillUpdateSetState {
    const META: Meta = Meta::plugin(Plugin::React, "no-will-update-set-state", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let disallow_in_func = options.str(0) == Some("disallow-in-func");
        NoWillUpdateSetState { mode: if disallow_in_func { Mode::DisallowInFunc } else { Mode::AllowInFunc } }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        let is_candidate = if is_oxlint {
            is_jsx(file)
                && file.mentions("setState")
                && file.mentions_any(&["componentWillUpdate", "UNSAFE_componentWillUpdate"])
        } else {
            // upstream takes a private name for its text.
            file.mentions_any(&["setState", "#setState"])
                && file.mentions_any(&[
                    "componentWillUpdate",
                    "UNSAFE_componentWillUpdate",
                    "#componentWillUpdate",
                    "#UNSAFE_componentWillUpdate",
                ])
        };
        if !is_candidate {
            return None;
        }
        // oxlint knows no `"detect"` and no `defaultVersion`.
        let check_unsafe_prefix = match is_oxlint {
            true => supports_unsafe_lifecycle_prefix(file),
            false => get_react_version_from_context(file) >= (16, 3, 0),
        };
        Some(State { check_unsafe_prefix, ..State::default() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let check_unsafe_prefix = cx.state.check_unsafe_prefix;
        if !cx.language().is_oxlint {
            let name_matches = |name: &[u8]| {
                name == b"componentWillUpdate" || (check_unsafe_prefix && name == b"UNSAFE_componentWillUpdate")
            };
            if let Some(name) = method_around_set_state(e, &name_matches, self.mode, &mut cx.state.walks)
                && let Some(callee) = e.callee()
            {
                cx.report(callee, NO_SET_STATE).data("name", name);
            }
            return;
        }
        // oxlint wants a component around the method, and does not count a function that is the parent of the call.
        let Some(callee) = callee_of_this_set_state(e) else {
            return;
        };
        let names: &[&str] = match check_unsafe_prefix {
            true => &["componentWillUpdate", "UNSAFE_componentWillUpdate"],
            false => &["componentWillUpdate"],
        };
        if let Some(function_count) = function_count_before_lifecycle_component(e, names, &mut cx.state.function_count)
            && (function_count <= 1 || self.mode == Mode::DisallowInFunc)
        {
            cx.report(callee, OXLINT);
        }
    }
}
