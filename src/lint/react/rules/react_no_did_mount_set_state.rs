use crate::react::{
    LifecycleWalk, callee_of_this_set_state, function_count_before_lifecycle_component, is_jsx,
    supports_unsafe_lifecycle_prefix,
};
use crate::util_make_no_method_set_state_rule::{Mode, Walks, method_enclosing_set_state, should_be_noop};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow usage of setState in one of [`METHODS`].
pub struct NoMethodSetState<const METHOD: usize = 0> {
    mode: Mode,
}

/// The arguments upstream passes to `makeNoMethodSetStateRule`, plus what differs between oxlint's three rules.
struct Method {
    rule: &'static str,
    /// The second name only counts from React 16.3 on: `shouldCheckUnsafeCb`.
    names: &'static [&'static str],
    /// upstream treats a private name like the plain name.
    private_names: &'static [&'static str],
    oxlint: Message,
    oxlint_requires_jsx: bool,
}

const METHODS: [Method; 3] = [
    Method {
        rule: "no-did-mount-set-state",
        names: &["componentDidMount"],
        private_names: &["#componentDidMount"],
        oxlint: Message::new("", "Do not use `setState` in `componentDidMount`."),
        oxlint_requires_jsx: true,
    },
    Method {
        rule: "no-did-update-set-state",
        names: &["componentDidUpdate"],
        private_names: &["#componentDidUpdate"],
        oxlint: Message::new("", "Do not use `setState` in `componentDidUpdate`."),
        oxlint_requires_jsx: false,
    },
    Method {
        rule: "no-will-update-set-state",
        names: &["componentWillUpdate", "UNSAFE_componentWillUpdate"],
        private_names: &["#componentWillUpdate", "#UNSAFE_componentWillUpdate"],
        oxlint: Message::new("", "Do not use `setState` in `componentWillUpdate`."),
        oxlint_requires_jsx: true,
    },
];

const NO_SET_STATE: Message = Message::new("noSetState", "Do not use setState in {{name}}");

#[derive(Default)]
pub struct State<'a> {
    /// The method's names that count for this file.
    names: &'static [&'static str],
    function_count: LifecycleWalk<'a>,
    walks: Walks<'a>,
}

impl<const METHOD: usize> Rule for NoMethodSetState<METHOD> {
    const META: Meta = Meta::plugin(Plugin::React, METHODS[METHOD].rule, Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let disallow_in_func = options.str(0) == Some("disallow-in-func");
        NoMethodSetState { mode: if disallow_in_func { Mode::DisallowInFunc } else { Mode::AllowInFunc } }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let method = &METHODS[METHOD];
        let is_oxlint = file.language().is_oxlint;
        let is_candidate = if is_oxlint {
            (!method.oxlint_requires_jsx || is_jsx(file)) && file.mentions("setState") && file.mentions_any(method.names)
        } else {
            file.mentions_any(&["setState", "#setState"])
                && (file.mentions_any(method.names) || file.mentions_any(method.private_names))
                && !should_be_noop(file, method.names[0])
        };
        if !is_candidate {
            return None;
        }
        // oxlint doesn't support `"detect"` or `defaultVersion`.
        let check_unsafe_prefix = method.names.len() > 1
            && match is_oxlint {
                true => supports_unsafe_lifecycle_prefix(file),
                false => get_react_version_from_context(file) >= (16, 3, 0),
            };
        let names = if check_unsafe_prefix { method.names } else { &method.names[..1] };
        Some(State { names, ..State::default() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let names = cx.state.names;
        if !cx.language().is_oxlint {
            let name_matches = |name: &[u8]| names.iter().any(|it| it.as_bytes() == name);
            if let Some(name) = method_enclosing_set_state(e, &name_matches, self.mode, &mut cx.state.walks)
                && let Some(callee) = e.callee()
            {
                cx.report(callee, NO_SET_STATE).data("name", name);
            }
            return;
        }
        // oxlint requires a component around the method, and doesn't count a function that's the call's parent.
        if let Some(callee) = callee_of_this_set_state(e)
            && let Some(function_count) = function_count_before_lifecycle_component(e, names, &mut cx.state.function_count)
            && (function_count <= 1 || self.mode == Mode::DisallowInFunc)
        {
            cx.report(callee, METHODS[METHOD].oxlint);
        }
    }
}
