use crate::jsx::as_jsx_element;
use crate::react_perf::{NativeAllowList, ON, ReactPerfRule, State, expr, react_perf_from_configuration};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent JSX elements that are local to the current method from being used as values of JSX props.
pub struct JsxNoJsxAsProp(NativeAllowList);

impl Rule for JsxNoJsxAsProp {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, "jsx-no-jsx-as-prop", Kind::Suggestion);
    const ON: On = ON;
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoJsxAsProp(react_perf_from_configuration(options))
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        expr(self, e, cx);
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
