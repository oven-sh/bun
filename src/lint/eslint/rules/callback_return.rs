use bun_lint::prelude::*;

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

impl CallbackReturn {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if !contains_only_identifiers(callee) || !self.callbacks.iter().any(|it| **it == *callee.text()) {
            return;
        }

        // The closest block, with whether it is the body of a function.
        let mut closest_block = None;
        let mut child = Node::Expr(e);
        for ancestor in child.ancestors() {
            match ancestor {
                Node::Stmt(statement) => match statement.kind() {
                    StmtKind::Return(_) => return,
                    StmtKind::Block(body) => {
                        closest_block = Some((body, false));
                        break;
                    }
                    _ => {}
                },
                Node::Func(func) => match (child, func.body_statements()) {
                    (Node::Stmt(_), Some(body)) if func.kind() != FnKind::StaticBlock => {
                        closest_block = Some((body, true));
                        break;
                    }
                    _ if func.is_arrow() => return,
                    _ => {}
                },
                _ => {}
            }
            child = ancestor;
        }

        if let Some((body, is_function_body)) = closest_block {
            let mut from_last = body.iter().rev();
            let (last, before_last) = (from_last.next(), from_last.next());
            if is_function_body && is_callback_expression(e, last) {
                return;
            }
            if last.is_some_and(|it| it.tag() == StmtTag::Return) && is_callback_expression(e, before_last) {
                return;
            }
        }

        if ast_utils::get_upper_function(e).is_some() {
            cx.report(e, MISSING_RETURN);
        }
    }
}

impl Rule for CallbackReturn {
    const META: Meta = Meta::eslint("callback-return", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        CallbackReturn {
            callbacks: match options.get(0).and_then(Json::as_array) {
                Some(names) => names.iter().filter_map(Json::as_str).map(Box::from).collect(),
                None => [&b"callback"[..], b"cb", b"next"].into_iter().map(Box::from).collect(),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
