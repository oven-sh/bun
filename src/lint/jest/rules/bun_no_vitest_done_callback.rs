use crate::bun::{imports_from, only_call_at_the_end, takes_rows, test_or_hook_of};
use bun_lint::fix::Removal;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_global_reference;

/// Disallow a `done` callback in tests and hooks that are imported from `vitest`.
pub struct NoVitestDoneCallback;

const NOT_A_CALLBACK: &Message = &Message::new(
    "notACallback",
    "`{{name}}` isn't a callback in a file that imports from `vitest`, so nothing waits for it. Return a promise.",
);

/// The call that `e` is the callee of.
fn call_of(e: Expr<'_>) -> Option<Expr<'_>> {
    e.parent().as_expr().filter(|it| it.as_call().is_some_and(|it| it.callee() == e))
}

/// `done()`, `setTimeout(done, 10)`
fn gets_no_error(done: Expr) -> bool {
    let Some(call) = done.parent().as_expr().and_then(Expr::as_call) else {
        return false;
    };
    let (callee, arguments) = (call.callee(), call.args());
    let is_timer = |name: &str, most: usize| callee.is_ident(name) && arguments.len() <= most;
    if callee == done {
        return arguments.is_empty();
    }
    arguments.first() == Some(done)
        && (is_timer("setTimeout", 2) || is_timer("setImmediate", 1) || is_timer("queueMicrotask", 1))
        && is_global_reference(callee)
}

fn fix<'a>(fixer: Fixer<'a>, func: Func<'a>, done: Symbol<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let parameters = func.params_span()?;
    if func.params_with_this().count() != 1 || func.return_type().is_some() || file.comments_in(parameters).next().is_some() {
        return None;
    }
    let without_parameter = fixer.replace(parameters, "()");
    if let Some(call) = only_call_at_the_end(func, done) {
        let removed = Removal::of(file.text(), call.span()).without_leftovers();
        return Some(vec![without_parameter, fixer.remove(removed)]);
    }
    // An executor drops what it returns, and with it a rejection.
    let returns_a_value = |it: Stmt<'a>| match it.as_return().flatten() {
        Some(value) => !value.callee().is_some_and(|it| it.symbol() == Some(done)),
        None => false,
    };
    let scope = func.scope()?;
    if func.is_async() || func.returns().any(returns_a_value) || scope.resolve("Promise").is_some() {
        return None;
    }
    let name = done.name().bytes();
    let promise: &[u8] = if file.is_javascript() { b"new Promise(" } else { b"new Promise<void>(" };
    let (start, setup) = if done.references().all(|it| it.expr().is_some_and(gets_no_error)) {
        ([promise, name, b" => "].concat(), Vec::new())
    } else {
        if file.mentions_any(&["resolve", "reject"]) || done.has_modifying_references() {
            return None;
        }
        let error: &[u8] = if file.is_javascript() { b"error" } else { b"(error?: unknown)" };
        let setup = [b"const ", name, b" = ", error, b" => (error ? reject(error) : resolve());"].concat();
        ([promise, b"(resolve, reject) => "].concat(), setup)
    };
    let mut fixes = vec![without_parameter];
    match func.body() {
        FnBody::Expr(body) if setup.is_empty() => {
            fixes.push(fixer.insert_before(body.outer_span(), start));
            fixes.push(fixer.insert_after(body.outer_span(), ")"));
        }
        FnBody::Expr(body) => {
            fixes.push(fixer.insert_before(body.outer_span(), [&start[..], b"{ ", &setup, b" "].concat()));
            fixes.push(fixer.insert_after(body.outer_span(), "; })"));
        }
        _ => {
            let (body, first) = (func.body_span()?, func.body_statements()?.first()?);
            let (before, after): (&[u8], &str) = if func.is_arrow() { (b"", ")") } else { (b"{ return ", "); }") };
            // The new first statement is laid out like the old one.
            let brace = Span::new(body.start, body.start + 1);
            let text = file.slice(brace.between(first.span()));
            let space = text.get(..text.len() - text.trim_ascii_start().len()).unwrap_or_default();
            let space: &[u8] = if setup.is_empty() { b"" } else { space };
            fixes.push(fixer.replace(brace, [before, &start, b"{", space, &setup].concat()));
            fixes.push(fixer.insert_after(body, after));
        }
    }
    Some(fixes)
}

impl Rule for NoVitestDoneCallback {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-vitest-done-callback", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Fn]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoVitestDoneCallback
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        imports_from(file, "vitest").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(func) = e.as_fn()
            && let Some(first) = func.params().first()
            && let Some(name) = first.pat().as_ident()
            && !first.is_rest()
            && test_or_hook_of(e).is_some_and(|it| !takes_rows(&it))
            && let Some(done) = first.pat().symbol()
            // The context is passed around too, so only the name tells what `helper(a)` gets.
            && done.references().any(|it| {
                it.expr().is_some_and(|it| {
                    call_of(it).is_some() || name.is_any(&["done", "cb", "callback", "next"]) && it.parent().as_expr().and_then(Expr::object) != Some(it)
                })
            })
        {
            cx.report(first.pat(), NOT_A_CALLBACK).data("name", name.bytes()).fix(|fixer| fix(fixer, func, done));
        }
    }
}
