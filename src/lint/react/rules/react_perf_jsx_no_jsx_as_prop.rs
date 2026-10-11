use bun_lint_oxlint::ast_util::{is_method_call, static_property_name};
use crate::jsx::as_jsx_element;
use crate::react_perf::{
    NativeAllowList, ON, ReactPerfRule, State, expr, is_constructor_matching_name, react_perf_from_configuration,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent JSX elements, arrays, functions or objects that are local to the current method from being used as values of JSX
/// props.
pub struct JsxNoNewAsProp<const WHAT: usize = JSX>(NativeAllowList);

const JSX: usize = 0;
const ARRAY: usize = 1;
const FUNCTION: usize = 2;
const OBJECT: usize = 3;

/// The rule, the message, the constructor.
const TEXTS: [[&str; 3]; 4] = [
    ["jsx-no-jsx-as-prop", "JSX attribute values should not contain other JSX.", ""],
    ["jsx-no-new-array-as-prop", "JSX attribute values should not contain Arrays created in the same scope.", "Array"],
    ["jsx-no-new-function-as-prop", "JSX attribute values should not contain functions created in the same scope.", "Function"],
    ["jsx-no-new-object-as-prop", "JSX attribute values should not contain objects created in the same scope.", "Object"],
];

impl<const WHAT: usize> Rule for JsxNoNewAsProp<WHAT> {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, TEXTS[WHAT][0], Kind::Suggestion);
    const ON: On = ON;
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoNewAsProp(react_perf_from_configuration(options))
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        expr(self, e, cx);
    }
}

impl<const WHAT: usize> ReactPerfRule for JsxNoNewAsProp<WHAT> {
    const MESSAGE: Message = Message::new("", TEXTS[WHAT][1]);
    const LOOKS_THROUGH_TYPES: bool = WHAT == OBJECT;
    const CHECKS_PARAMETERS: bool = WHAT == ARRAY || WHAT == OBJECT;
    const CHECKS_FUNCTIONS: bool = WHAT == FUNCTION;

    fn native_allow_list(&self) -> &NativeAllowList {
        &self.0
    }

    fn state<'c, 'a>(cx: &'c mut Cx<'a, Self>) -> &'c mut State<'a> {
        &mut cx.state
    }

    fn is_violation(expr: Expr) -> bool {
        let constructor = TEXTS[WHAT][2];
        match expr.kind() {
            _ if WHAT == JSX => as_jsx_element(expr).is_some(),
            ExprKind::Array(_) => WHAT == ARRAY,
            ExprKind::Fn(_) => WHAT == FUNCTION,
            ExprKind::Object(_) => WHAT == OBJECT,
            ExprKind::Call(call) if !expr.is_chain_root() => {
                let callee = call.callee();
                is_constructor_matching_name(callee, constructor)
                    || match WHAT {
                        ARRAY => is_method_call(call, None, Some(&["concat", "map", "filter"]), Some(1), Some(1)),
                        FUNCTION => {
                            !callee.is_parenthesized()
                                && !callee.is_chain_root()
                                && static_property_name(callee).is_some_and(|it| it.is("bind"))
                        }
                        _ => is_method_call(call, Some(&["Object"]), Some(&["assign", "create"]), None, None),
                    }
            }
            ExprKind::New(new) => is_constructor_matching_name(new.callee(), constructor),
            _ => false,
        }
    }
}
