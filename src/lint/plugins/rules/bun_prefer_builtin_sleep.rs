use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_global_reference;

/// Prefer `Bun.sleep()` to a promise that is made by hand and only waits for a timer.
pub struct PreferBuiltinSleep;

const HANDMADE_SLEEP: Message = Message::new(
    "handmadeSleep",
    "This promise does nothing but wait. `Bun.sleep(ms)` does that, and so does `setTimeout(ms)` of `node:timers/promises`.",
);
const USE_BUN_SLEEP: Message = Message::new("useBunSleep", "Replace it with `Bun.sleep()`.");

/// The one expression that is all that `func` does: its body, or the only statement of its body.
fn only_expression(func: Func<'_>) -> Option<Expr<'_>> {
    match func.body() {
        FnBody::Expr(e) => Some(e),
        FnBody::Block(statements) if statements.len() == 1 => match statements.first()?.kind() {
            StmtKind::Expr(e) | StmtKind::Return(Some(e)) => Some(e),
            _ => None,
        },
        _ => None,
    }
}

fn is_plain_function(func: Func) -> bool {
    !func.is_async() && !func.is_generator()
}

/// `resolve`, `() => resolve()`, `function () { resolve(); }`
fn only_resolves<'a>(callback: Expr<'a>, resolve: Symbol<'a>) -> bool {
    let is_resolve = |e: Expr<'a>| e.tag() == ExprTag::Ident && e.symbol() == Some(resolve);
    match callback.as_fn() {
        None => is_resolve(callback),
        Some(func) => {
            let call = only_expression(func).and_then(Expr::as_call);
            is_plain_function(func)
                && func.params().is_empty()
                && call.is_some_and(|it| it.args().is_empty() && !it.is_optional() && is_resolve(it.callee()))
        }
    }
}

/// The `ms` of `new Promise(done => setTimeout(done, ms))`. `Some(None)`: there is none.
fn delay_of(e: Expr<'_>) -> Option<Option<Expr<'_>>> {
    let ExprKind::New(construction) = e.kind() else {
        return None;
    };
    let executor = construction.args().first().filter(|_| construction.args().len() == 1)?.as_fn()?;
    let resolve = executor.params().first().filter(|it| it.default().is_none() && !it.is_rest())?.pat().symbol()?;
    let timer = only_expression(executor)?.as_call()?;
    let (callback, delay) = (timer.args().first()?, timer.args().get(1));
    let is_sleep = is_plain_function(executor)
        && timer.args().len() <= 2
        && [(construction.callee(), "Promise"), (timer.callee(), "setTimeout")]
            .iter()
            .all(|(callee, name)| callee.is_ident(name) && is_global_reference(*callee))
        && delay.is_none_or(|it| it.tag() != ExprTag::Spread)
        && only_resolves(callback, resolve);
    is_sleep.then_some(delay)
}

impl Rule for PreferBuiltinSleep {
    const META: Meta = Meta::plugin(Plugin::Bun, "prefer-builtin-sleep", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferBuiltinSleep
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("setTimeout") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(delay) = delay_of(e) {
            cx.report(e, HANDMADE_SLEEP).suggest(USE_BUN_SLEEP, |fixer| {
                let delay = delay.map_or(&b"0"[..], |it| e.file().slice(it.outer_span()));
                fixer.replace(e, [b"Bun.sleep(", delay, b")"].concat())
            });
        }
    }
}
