use bun_lint_oxlint::ast_util::{get_inner_expression, is_reference_to_global_variable};
use crate::unicorn::GLOBAL_OBJECT_NAMES;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce or disallow explicit `delay` argument for `setTimeout()` and `setInterval()`.
pub struct ExplicitTimerDelay {
    is_never: bool,
}

const MISSING_DELAY: Message = Message::new("", "`{{name}}` should have an explicit delay argument.");
const REDUNDANT_DELAY: Message = Message::new("", "`{{name}}` should not have an explicit delay of `0`.");

const TIMER_FUNCTION_NAMES: [&str; 2] = ["setTimeout", "setInterval"];

impl Rule for ExplicitTimerDelay {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "explicit-timer-delay", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ExplicitTimerDelay { is_never: options.str(0) == Some("never") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(&TIMER_FUNCTION_NAMES) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        let arguments = call_expr.args();
        if arguments.len() != 1 + usize::from(self.is_never) || call_expr.is_optional() {
            return;
        }
        let (Some(first_argument), Some(last_argument)) = (arguments.first(), arguments.last()) else {
            return;
        };
        if if self.is_never { !is_zero_delay(last_argument) } else { first_argument.tag() == ExprTag::Spread } {
            return;
        }
        let Some(name) = timer_name(call_expr).map(Name::bytes) else {
            return;
        };
        let end_of_first = first_argument.outer_span().end;
        if self.is_never {
            let delay = last_argument.outer_span();
            cx.report(delay, REDUNDANT_DELAY)
                .data("name", name)
                .fix(|fixer| fixer.remove(Span::new(end_of_first, delay.end)));
        } else {
            cx.report(e, MISSING_DELAY)
                .data("name", name)
                .fix(|fixer| fixer.insert_after(Span::empty(end_of_first), ", 0"));
        }
    }
}

/// `setTimeout`, `window.setTimeout`, where the first name is that of a global variable.
fn timer_name(call_expr: Call<'_>) -> Option<Name<'_>> {
    let callee = get_inner_expression(call_expr.callee());
    let (name, global) = match callee.kind() {
        ExprKind::Ident(name) => (name, callee),
        ExprKind::Dot { obj, name, .. } if !callee.is_private_member() && !callee.is_chain_root() => {
            let object = get_inner_expression(obj);
            (name.name(), Some(object).filter(|it| it.as_ident().is_some_and(|it| it.is_any(&GLOBAL_OBJECT_NAMES)))?)
        }
        _ => return None,
    };
    (name.is_any(&TIMER_FUNCTION_NAMES) && is_reference_to_global_variable(global)).then_some(name)
}

/// `0`, `-0`, `+(0)`
fn is_zero_delay(argument: Expr) -> bool {
    let mut expression = argument;
    while let ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, operand } = expression.kind() {
        expression = operand;
    }
    matches!(expression.kind(), ExprKind::Number(value) if value == 0.0)
}
