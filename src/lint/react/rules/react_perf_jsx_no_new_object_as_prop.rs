use bun_lint_oxlint::ast_util::is_method_call;
use crate::react_perf::{
    NativeAllowList, ReactPerfRule, State, is_constructor_matching_name, react_perf_from_configuration, register,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent objects that are local to the current method from being used as values of JSX props.
pub struct JsxNoNewObjectAsProp(NativeAllowList);

impl Rule for JsxNoNewObjectAsProp {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, "jsx-no-new-object-as-prop", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoNewObjectAsProp(react_perf_from_configuration(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        register(on);
        State::default()
    }
}

impl ReactPerfRule for JsxNoNewObjectAsProp {
    const MESSAGE: Message = Message::new("", "JSX attribute values should not contain objects created in the same scope.");
    const LOOKS_THROUGH_TYPES: bool = true;
    const CHECKS_PARAMETERS: bool = true;

    fn native_allow_list(&self) -> &NativeAllowList {
        &self.0
    }

    fn state<'c, 'a>(cx: &'c mut Cx<'a, Self>) -> &'c mut State<'a> {
        &mut cx.state
    }

    fn is_violation(expr: Expr) -> bool {
        match expr.kind() {
            ExprKind::Object(_) => true,
            ExprKind::Call(call) if !expr.is_chain_root() => {
                is_constructor_matching_name(call.callee(), "Object")
                    || is_method_call(call, Some(&["Object"]), Some(&["assign", "create"]), None, None)
            }
            ExprKind::New(new) => is_constructor_matching_name(new.callee(), "Object"),
            _ => false,
        }
    }
}
