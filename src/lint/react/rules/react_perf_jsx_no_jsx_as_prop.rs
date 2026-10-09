use crate::jsx::as_jsx_element;
use crate::react_perf::{NativeAllowList, ReactPerfRule, State, react_perf_from_configuration, register};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent JSX elements that are local to the current method from being used as values of JSX props.
pub struct JsxNoJsxAsProp(NativeAllowList);

impl Rule for JsxNoJsxAsProp {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, "jsx-no-jsx-as-prop", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoJsxAsProp(react_perf_from_configuration(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        register(on);
        State::default()
    }
}

impl ReactPerfRule for JsxNoJsxAsProp {
    const MESSAGE: Message = Message::new("", "JSX attribute values should not contain other JSX.");

    fn native_allow_list(&self) -> &NativeAllowList {
        &self.0
    }

    fn state<'c, 'a>(cx: &'c mut Cx<'a, Self>) -> &'c mut State<'a> {
        &mut cx.state
    }

    fn is_violation(expr: Expr) -> bool {
        as_jsx_element(expr).is_some()
    }
}
