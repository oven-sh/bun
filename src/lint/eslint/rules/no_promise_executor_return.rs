use bun_lint::prelude::*;

/// Disallow returning values from Promise executor functions.
pub struct NoPromiseExecutorReturn {
    allow_void: bool,
}

const RETURNS_VALUE: Message = Message::new(
    "returnsValue",
    "Return values from promise executor functions cannot be read.",
);
const PREPEND_VOID: Message = Message::new("prependVoid", "Prepend `void` to the expression.");
const WRAP_BRACES: Message = Message::new("wrapBraces", "Wrap the expression in `{}`.");

/// `astUtils.getPrecedence({ type: "UnaryExpression", operator: "void" })`
const PRECEDENCE_OF_VOID: i32 = 16;

/// ESLint's `expressionIsVoid`.
fn expression_is_void(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Unary { op: UnOp::Void, .. })
}

/// ESLint's `voidPrependFixer`. `return_or_arrow` is the `return` or the `=>` before `node`.
fn void_prepend_fixer<'a>(fixer: Fixer<'a>, node: Expr<'a>, return_or_arrow: Span, is_return: bool) -> [Fix; 2] {
    let requires_parens =
        ast_utils::get_precedence(node) < PRECEDENCE_OF_VOID && !ast_utils::is_parenthesised(node);
    let first_token = skip_trivia(fixer.file().text(), return_or_arrow.end);
    // `=>` allows `void` to be adjacent.
    let prepend_space = is_return && return_or_arrow.end == first_token;
    let text = format!(
        "{}void {}",
        if prepend_space { " " } else { "" },
        if requires_parens { "(" } else { "" },
    );
    [
        fixer.insert_before(Span::empty(first_token), text),
        fixer.insert_after(node, if requires_parens { ")" } else { "" }),
    ]
}

/// ESLint's `curlyWrapFixer`. `arrow` is the `=>` of `function`.
fn curly_wrap_fixer<'a>(fixer: Fixer<'a>, function: Expr<'a>, arrow: Span) -> [Fix; 2] {
    let first_token = skip_trivia(fixer.file().text(), arrow.end);
    [fixer.insert_before(Span::empty(first_token), "{"), fixer.insert_after(function, "}")]
}

impl NoPromiseExecutorReturn {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        if !callee.is_ident("Promise") {
            return;
        }
        let Some(executor) = call.args().first() else {
            return;
        };
        let ExprKind::Fn(func) = executor.kind() else {
            return;
        };
        if !ast_utils::is_global_reference(callee) {
            return;
        }
        let allow_void = self.allow_void;

        if let (FnBody::Expr(body), Some(arrow)) = (func.body(), func.arrow_span()) {
            if allow_void && expression_is_void(body) {
                return;
            }
            // In braces, a function or a class without a name would be invalid syntax.
            let can_wrap = match body.kind() {
                ExprKind::Fn(inner) => inner.is_arrow() || inner.name().is_some(),
                ExprKind::Class(class) => class.name().is_some(),
                _ => true,
            };
            cx.report(body, RETURNS_VALUE)
                .suggest(PREPEND_VOID, |fixer| allow_void.then(|| void_prepend_fixer(fixer, body, arrow, false)))
                .suggest(WRAP_BRACES, |fixer| can_wrap.then(|| curly_wrap_fixer(fixer, executor, arrow)));
            return;
        }

        for statement in func.returns() {
            let StmtKind::Return(Some(argument)) = statement.kind() else {
                continue;
            };
            if allow_void && expression_is_void(argument) {
                continue;
            }
            let start = statement.span().start;
            let keyword = Span::new(start, start + "return".len() as u32);
            cx.report(statement, RETURNS_VALUE).suggest(PREPEND_VOID, |fixer| {
                allow_void.then(|| void_prepend_fixer(fixer, argument, keyword, true))
            });
        }
    }
}

impl Rule for NoPromiseExecutorReturn {
    const META: Meta = Meta::eslint("no-promise-executor-return", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoPromiseExecutorReturn {
            allow_void: options.object(0).bool_or("allowVoid", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Promise") {
            return;
        }
        on.exprs([ExprTag::New], Self::check);
    }
}
