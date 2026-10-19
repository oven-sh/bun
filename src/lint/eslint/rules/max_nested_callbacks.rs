use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::iter_outer_expressions;
use smallvec::SmallVec;

/// Enforce a maximum depth that callbacks can be nested.
pub struct MaxNestedCallbacks {
    /// `None` for `{ "maximum": 0 }` without `max`, where upstream compares against `undefined`.
    max: Option<usize>,
    check_constructor_call_callbacks: bool,
}

const EXCEED: Message = Message::new(
    "exceed",
    "Too many nested callbacks ({{num}}). Maximum allowed is {{max}}.",
);

#[derive(Default)]
pub struct State {
    /// By function index: one more than the number of callbacks among the function and its enclosing functions. 0 if
    /// unknown.
    callbacks: Vec<usize>,
    /// ESLint before 10 counts while it walks.
    depth: usize,
}

/// Returns `node` as an ESLint `FunctionExpression` or `ArrowFunctionExpression`.
fn as_function_expression(node: Node<'_>) -> Option<Func<'_>> {
    match node {
        Node::Func(func) if func.has_body() && !matches!(func.kind(), FnKind::Decl | FnKind::StaticBlock) => Some(func),
        _ => None,
    }
}

impl MaxNestedCallbacks {
    /// A callee counts too. Every function expression decrements the depth on exit, even one that wasn't counted on
    /// entry, so everything after such a function is one level less deep.
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

    /// True if the function expression `e` is an argument of a call.
    fn is_callback(&self, e: Expr) -> bool {
        // For oxlint a callee counts too, as does a function wrapped in `as T` and the like.
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
    type State<'a> = State;

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

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        match file.language().eslint_major < 10 {
            true => On::new().enter(NodeTags::FUNC).exit(NodeTags::FUNC),
            false => On::new().exprs(&[ExprTag::Fn]),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(max), Some(func)) = (self.max, e.as_fn()) else {
            return;
        };
        if !self.is_callback(e) {
            return;
        }
        // Walk outwards from function to function until one with a known depth.
        let known = &mut cx.state.callbacks;
        let (mut unknown, mut depth): (SmallVec<[Func<'a>; 8]>, usize) = (SmallVec::new(), 0);
        for outer in std::iter::successors(Some(func), |it| it.enclosing()) {
            if let Some(known) = known.get(outer.id().idx()).and_then(|it| it.checked_sub(1)) {
                depth = known;
                break;
            }
            unknown.push(outer);
        }
        for outer in unknown.into_iter().rev() {
            let is_callback = matches!(outer.owner(), Node::Expr(it) if it.tag() == ExprTag::Fn && self.is_callback(it));
            depth += usize::from(is_callback);
            if known.len() <= outer.id().idx() {
                known.resize(outer.id().idx() + 1, 0);
            }
            if let Some(known) = known.get_mut(outer.id().idx()) {
                *known = depth + 1;
            }
        }
        if depth > max {
            // oxlint reports the whole function.
            let report_span = match cx.language().is_oxlint {
                true => func.estree_span(),
                false => ast_utils::get_function_head_loc(func),
            };
            cx.report(report_span, EXCEED).data("num", depth).data("max", max);
        }
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        self.enter_before_10(node, cx);
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if as_function_expression(node).is_some() {
            cx.state.depth = cx.state.depth.saturating_sub(1);
        }
    }
}
