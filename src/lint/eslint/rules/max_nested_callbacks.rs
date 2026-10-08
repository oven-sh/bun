use super::max_depth::{Ancestor, AncestorCounter};
use bun_lint::prelude::*;

/// Enforce a maximum depth that callbacks can be nested.
pub struct MaxNestedCallbacks {
    /// `None`: `{ "maximum": 0 }` without `max`, with which upstream compares to `undefined`.
    max: Option<usize>,
    check_constructor_call_callbacks: bool,
}

const EXCEED: Message = Message::new(
    "exceed",
    "Too many nested callbacks ({{num}}). Maximum allowed is {{max}}.",
);

impl MaxNestedCallbacks {
    /// Whether the function expression `e` is an argument of a call.
    fn is_callback(&self, e: Expr) -> bool {
        let Node::Expr(parent) = e.parent() else {
            return false;
        };
        match parent.kind() {
            ExprKind::Call(call) => call.callee() != e,
            ExprKind::New(call) => self.check_constructor_call_callbacks && call.callee() != e,
            _ => false,
        }
    }

    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Some(func)) = (self.max, e.as_fn()) else {
            return;
        };
        if !self.is_callback(e) {
            return;
        }
        let around = cx.state.count(Node::Expr(e), |ancestor| match ancestor {
            Node::Expr(outer) if outer.tag() == ExprTag::Fn && self.is_callback(outer) => Ancestor::Counted,
            _ => Ancestor::Passed,
        });
        let depth = around + 1;
        if depth > max {
            cx.report(ast_utils::get_function_head_loc(func), EXCEED).data("num", depth).data("max", max);
        }
    }
}

impl Rule for MaxNestedCallbacks {
    const META: Meta = Meta::eslint("max-nested-callbacks", Kind::Suggestion);
    type State<'a> = AncestorCounter<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxNestedCallbacks {
            max: match object.has("maximum") || object.has("max") {
                true => object.usize("maximum").filter(|max| *max != 0).or_else(|| object.usize("max")),
                false => Some(options.number(0).map_or(10, |max| max as usize)),
            },
            check_constructor_call_callbacks: object.bool_or("checkConstructorCallCallbacks", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> AncestorCounter<'a> {
        on.exprs([ExprTag::Fn], Self::check);
        AncestorCounter::default()
    }
}
