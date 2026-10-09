use crate::bun::{is_listed, list_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{callee_name, is_global_reference};

/// Prefer `AbortSignal.timeout()` to an `AbortController` that only a timer aborts, of which only the signal is used.
pub struct PreferTimeoutSignal {
    factories: Box<[Box<[u8]>]>,
}

const ONLY_A_TIMER: Message = Message::new(
    "onlyATimer",
    "Nothing but a timer aborts this controller, and nothing but its signal is used. `AbortSignal.timeout(ms)` makes such a signal.",
);

/// Whether `e`, a call, is all that the function does which the global `setTimeout()` gets first.
fn is_all_of_a_timer(e: Expr) -> bool {
    let func = match e.parent() {
        Node::Func(func) => func,
        Node::Stmt(statement) if statement.tag() == StmtTag::Expr => match statement.parent() {
            Node::Func(func) if func.body_statements().is_some_and(|it| it.len() == 1) => func,
            _ => return false,
        },
        _ => return false,
    };
    let Node::Expr(callback) = func.owner() else {
        return false;
    };
    let timer = callback.parent().as_expr().and_then(Expr::as_call);
    func.params().is_empty()
        && timer.is_some_and(|it| {
            let callee = it.callee();
            it.args().first() == Some(callback) && callee.is_ident("setTimeout") && is_global_reference(callee)
        })
}

/// What is done with a controller where `identifier` names it.
enum Use {
    Signal,
    AbortedByTimer,
    Other,
}

fn use_of(identifier: Expr) -> Use {
    let Node::Expr(member) = identifier.parent() else {
        return Use::Other;
    };
    match member.kind() {
        ExprKind::Dot { name, .. } if name.name().is("signal") => Use::Signal,
        ExprKind::Dot { name, .. } if name.name().is("abort") => match member.parent().as_expr() {
            Some(call)
                if call.as_call().is_some_and(|it| it.callee() == member && it.args().is_empty())
                    && is_all_of_a_timer(call) =>
            {
                Use::AbortedByTimer
            }
            _ => Use::Other,
        },
        _ => Use::Other,
    }
}

impl PreferTimeoutSignal {
    fn makes_controller(&self, e: Expr) -> bool {
        match e.kind() {
            ExprKind::New(it) => it.callee().is_ident("AbortController") && is_global_reference(it.callee()),
            ExprKind::Call(call) => callee_name(call).is_some_and(|name| is_listed(&self.factories, name.bytes())),
            _ => false,
        }
    }
}

impl Rule for PreferTimeoutSignal {
    const META: Meta = Meta::plugin(Plugin::Bun, "prefer-timeout-signal", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferTimeoutSignal { factories: list_option(options, "factories", &[]) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("setTimeout") || !file.mentions("abort") {
            return;
        }
        on.var_decls(|rule, declaration, cx| {
            let Some(init) = declaration.init().filter(|it| rule.makes_controller(*it)) else {
                return;
            };
            let Some(symbol) = declaration.pat().symbol() else {
                return;
            };
            let (mut signals, mut timers) = (0, 0);
            for reference in symbol.references().filter(|it| !it.is_init()) {
                match reference.expr().map_or(Use::Other, use_of) {
                    Use::Signal => signals += 1,
                    Use::AbortedByTimer => timers += 1,
                    Use::Other => return,
                }
            }
            if signals > 0 && timers == 1 {
                cx.report(init, ONLY_A_TIMER);
            }
        });
    }
}
