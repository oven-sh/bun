use bun_lint_oxlint::ast_util::is_method_call;
use crate::react_perf::{
    NativeAllowList, ON, ReactPerfRule, State, expr, is_constructor_matching_name, react_perf_from_configuration,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent arrays that are local to the current method from being used as values of JSX props.
pub struct JsxNoNewArrayAsProp(NativeAllowList);

impl Rule for JsxNoNewArrayAsProp {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, "jsx-no-new-array-as-prop", Kind::Suggestion);
    const ON: On = ON;
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoNewArrayAsProp(react_perf_from_configuration(options))
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        expr(self, e, cx);
    }
}

impl ReactPerfRule for JsxNoNewArrayAsProp {
    const MESSAGE: Message = Message::new("", "JSX attribute values should not contain Arrays created in the same scope.");
    const CHECKS_PARAMETERS: bool = true;

    fn native_allow_list(&self) -> &NativeAllowList {
        &self.0
    }

    fn state<'c, 'a>(cx: &'c mut Cx<'a, Self>) -> &'c mut State<'a> {
        &mut cx.state
    }

    fn is_violation(expr: Expr) -> bool {
        match expr.kind() {
            ExprKind::Array(_) => true,
            ExprKind::Call(call) if !expr.is_chain_root() => {
                is_constructor_matching_name(call.callee(), "Array")
                    || is_method_call(call, None, Some(&["concat", "map", "filter"]), Some(1), Some(1))
            }
            ExprKind::New(new) => is_constructor_matching_name(new.callee(), "Array"),
            _ => false,
        }
    }
}
