use super::array_callback_return::{is_expression_void, void_prepend_fixer};
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

/// ESLint's `curlyWrapFixer`. `arrow` is the `=>` of `function`.
fn curly_wrap_fixer<'a>(fixer: Fixer<'a>, function: Expr<'a>, arrow: Span) -> [Fix; 2] {
    let first_token = skip_trivia(fixer.file().text(), arrow.end);
    [fixer.insert_before(Span::empty(first_token), "{"), fixer.insert_after(function, "}")]
}

impl Rule for NoPromiseExecutorReturn {
    const META: Meta = Meta::eslint("no-promise-executor-return", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoPromiseExecutorReturn {
            allow_void: options.object(0).bool_or("allowVoid", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Promise").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_new() else {
            return;
        };
        let callee = call.callee();
        if !callee.is_ident("Promise") {
            return;
        }
        let Some(executor) = call.args().first() else {
            return;
        };
        let Some(func) = executor.as_fn() else {
            return;
        };
        if !ast_utils::is_global_reference(callee) {
            return;
        }
        let allow_void = self.allow_void;

        if let (FnBody::Expr(body), Some(arrow)) = (func.body(), func.arrow_span()) {
            if allow_void && is_expression_void(body) {
                return;
            }
            // In braces, a function or a class without a name would be invalid syntax.
            let can_wrap = match body.kind() {
                ExprKind::Fn(inner) => inner.is_arrow() || inner.name().is_some(),
                ExprKind::Class(class) => class.name().is_some(),
                _ => true,
            };
            // For oxlint the parentheses are part of the body.
            cx.report(if cx.language().is_oxlint { body.outer_span() } else { body.span() }, RETURNS_VALUE)
                .suggest(PREPEND_VOID, |fixer| allow_void.then(|| void_prepend_fixer(fixer, body, arrow, false)))
                .suggest(WRAP_BRACES, |fixer| can_wrap.then(|| curly_wrap_fixer(fixer, executor, arrow)));
            return;
        }

        for statement in func.returns() {
            let Some(Some(argument)) = statement.as_return() else {
                continue;
            };
            if allow_void && is_expression_void(argument) {
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
