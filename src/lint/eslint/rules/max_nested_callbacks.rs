use super::max_depth::{Ancestor, AncestorCounter};
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::iter_outer_expressions;

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

#[derive(Default)]
pub struct State<'a> {
    ancestors: AncestorCounter<'a>,
    /// ESLint before 10 counts while it walks.
    depth: usize,
}

/// A `FunctionExpression` or an `ArrowFunctionExpression` of ESLint.
fn as_function_expression(node: Node<'_>) -> Option<Func<'_>> {
    match node {
        Node::Func(func) if func.has_body() && !matches!(func.kind(), FnKind::Decl | FnKind::StaticBlock) => Some(func),
        _ => None,
    }
}

impl MaxNestedCallbacks {
    /// What is called counts too. Every function expression is looked at, and takes one away where it ends, also one
    /// that has not been counted: so what follows it is less deep by one.
    fn enter_before_10<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Some(func)) = (self.max, as_function_expression(node)) else {
            return;
        };
        if matches!(func.owner(), Node::Expr(e) if e.tag() == ExprTag::Fn
            && matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call))
        {
            cx.state.depth += 1;
        }
        let depth = cx.state.depth;
        if depth > max {
            cx.report(func.estree_span(), EXCEED).data("num", depth).data("max", max);
        }
    }

    /// Whether the function expression `e` is an argument of a call.
    fn is_callback(&self, e: Expr) -> bool {
        // For oxlint also what is called, and what is in `as T` and the like.
        if e.file().language().is_oxlint {
            return matches!(iter_outer_expressions(e).next(), Some(Node::Expr(it)) if it.tag() == ExprTag::Call);
        }
        let Node::Expr(parent) = e.parent() else {
            return false;
        };
        match parent.kind() {
            ExprKind::Call(call) => call.callee() != e,
            ExprKind::New(call) => self.check_constructor_call_callbacks && call.callee() != e,
            _ => false,
        }
    }
}

impl Rule for MaxNestedCallbacks {
    const META: Meta = Meta::eslint("max-nested-callbacks", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Fn]).enter(NodeTags::FUNC).exit(NodeTags::FUNC);
    type State<'a> = State<'a>;

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

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().eslint_major < 10 {
            return;
        }
        let (Some(max), Some(func)) = (self.max, e.as_fn()) else {
            return;
        };
        if !self.is_callback(e) {
            return;
        }
        let around = cx.state.ancestors.count(Node::Expr(e), |ancestor| match ancestor {
            Node::Expr(outer) if outer.tag() == ExprTag::Fn && self.is_callback(outer) => Ancestor::Counted,
            _ => Ancestor::Passed,
        });
        let depth = around + 1;
        if depth > max {
            // oxlint points at the whole function.
            let place = match cx.language().is_oxlint {
                true => func.estree_span(),
                false => ast_utils::get_function_head_loc(func),
            };
            cx.report(place, EXCEED).data("num", depth).data("max", max);
        }
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().eslint_major >= 10 {
            return;
        }
        self.enter_before_10(node, cx);
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().eslint_major >= 10 {
            return;
        }
        if as_function_expression(node).is_some() {
            cx.state.depth = cx.state.depth.saturating_sub(1);
        }
    }
}
