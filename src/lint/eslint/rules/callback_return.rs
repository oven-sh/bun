use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Require `return` statements after callbacks.
pub struct CallbackReturn {
    callbacks: Vec<Box<[u8]>>,
}

const MISSING_RETURN: Message =
    Message::new("missingReturn", "Expected return with your callback function.");

/// ESLint's `containsOnlyIdentifiers`: an identifier, or member accesses that start with one.
fn contains_only_identifiers(mut e: Expr) -> bool {
    loop {
        match e.kind() {
            ExprKind::Ident(_) => return true,
            // `(a?.b).c` has a `ChainExpression` in it.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !e.is_chain_root() => e = obj,
            _ => return false,
        }
    }
}

/// ESLint's `isCallbackExpression`: `statement` is `cb()`, `cb && cb()` or similar.
fn is_callback_expression<'a>(call: Expr<'a>, statement: Option<Stmt<'a>>) -> bool {
    let Some(StmtKind::Expr(expression)) = statement.map(Stmt::kind) else {
        return false;
    };
    // `cb?.()` is in a `ChainExpression`.
    if call.is_chain_root() {
        return false;
    }
    expression == call
        || matches!(expression.kind(), ExprKind::Binary { op, right, .. } if op != BinOp::Comma && right == call)
}

/// What decides about the calls in it.
#[derive(Copy, Clone)]
enum Around<'a> {
    /// A `return`, or an arrow function.
    Returned,
    /// The closest block, with whether it is the body of a function.
    Block(List<'a, Stmt<'a>>, bool),
}

#[derive(Default)]
pub struct State<'a> {
    around: AncestorMemo<'a, Around<'a>>,
    /// ESLint's `getUpperFunction`.
    functions: AncestorMemo<'a, Func<'a>>,
}

impl CallbackReturn {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if !contains_only_identifiers(callee) || !self.callbacks.iter().any(|it| **it == *callee.text()) {
            return;
        }

        let around = cx.state.around.find(Node::Expr(e), |child, ancestor| match ancestor {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Return(_) => Some(Around::Returned),
                StmtKind::Block(body) => Some(Around::Block(body, false)),
                _ => None,
            },
            Node::Func(func) => match (child, func.body_statements()) {
                (Node::Stmt(_), Some(body)) if func.kind() != FnKind::StaticBlock => Some(Around::Block(body, true)),
                _ if func.is_arrow() => Some(Around::Returned),
                _ => None,
            },
            _ => None,
        });
        if matches!(around, Some(Around::Returned)) {
            return;
        }
        if let Some(Around::Block(body, is_function_body)) = around {
            let mut from_last = body.iter().rev();
            let (last, before_last) = (from_last.next(), from_last.next());
            if is_function_body && is_callback_expression(e, last) {
                return;
            }
            if last.is_some_and(|it| it.tag() == StmtTag::Return) && is_callback_expression(e, before_last) {
                return;
            }
        }

        if cx.state.functions.find(Node::Expr(e), |_, it| ast_utils::as_function(it)).is_some() {
            cx.report(e, MISSING_RETURN);
        }
    }
}

impl Rule for CallbackReturn {
    const META: Meta = Meta::eslint("callback-return", Kind::Suggestion).deprecated();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        CallbackReturn {
            callbacks: match options.get(0).and_then(Json::as_array) {
                Some(names) => names.iter().filter_map(Json::as_str).map(Box::from).collect(),
                None => [&b"callback"[..], b"cb", b"next"].into_iter().map(Box::from).collect(),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.exprs([ExprTag::Call], Self::check);
        State::default()
    }
}
