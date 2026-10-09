use bun_lint_oxlint::ast_util::static_property_name;
use crate::react_perf::{
    NativeAllowList, ReactPerfRule, State, is_constructor_matching_name, react_perf_from_configuration, register,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent functions that are local to the current method from being used as values of JSX props.
pub struct JsxNoNewFunctionAsProp(NativeAllowList);

impl Rule for JsxNoNewFunctionAsProp {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, "jsx-no-new-function-as-prop", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoNewFunctionAsProp(react_perf_from_configuration(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        register(on);
        State::default()
    }
}

impl ReactPerfRule for JsxNoNewFunctionAsProp {
    const MESSAGE: Message = Message::new("", "JSX attribute values should not contain functions created in the same scope.");
    const CHECKS_FUNCTIONS: bool = true;

    fn native_allow_list(&self) -> &NativeAllowList {
        &self.0
    }

    fn state<'c, 'a>(cx: &'c mut Cx<'a, Self>) -> &'c mut State<'a> {
        &mut cx.state
    }

    fn is_violation(expr: Expr) -> bool {
        match expr.kind() {
            ExprKind::Fn(_) => true,
            ExprKind::Call(call) if !expr.is_chain_root() => {
                let callee = call.callee();
                is_constructor_matching_name(callee, "Function")
                    || !callee.is_parenthesized() && !callee.is_chain_root() && static_property_name(callee).is_some_and(|it| it.is("bind"))
            }
            ExprKind::New(new) => is_constructor_matching_name(new.callee(), "Function"),
            _ => false,
        }
    }
}
