use crate::unicorn::outermost_wrapper;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers use of `Date.now()` over `new Date().getTime()` or `new Date().valueOf()`.
pub struct PreferDateNow;

const PREFER_DATE_NOW: Message = Message::new("", "Prefer `Date.now()` over `new Date()`");
const PREFER_DATE_NOW_OVER_METHODS: Message =
    Message::new("", "Prefer `Date.now()` over `new Date().{{bad_method}}()`");
const PREFER_DATE_NOW_OVER_NUMBER_DATE_OBJECT: Message =
    Message::new("", "Prefer `Date.now()` over `{{kind}}(new Date())`");

fn is_arithmetic(op: BinOp) -> bool {
    matches!(op, BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow)
}

impl Rule for PreferDateNow {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-date-now", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferDateNow
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("Date") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, new_date: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new) = new_date.kind() else {
            return;
        };
        if !new.args().is_empty() || !new.callee().is_ident("Date") || new.callee().is_parenthesized() {
            return;
        }
        let Some(operand) = outermost_wrapper(new_date) else {
            return;
        };
        let Node::Expr(parent) = operand.parent() else {
            return;
        };
        match parent.kind() {
            ExprKind::Dot { name, .. } if name.name().is_any(&["getTime", "valueOf"]) => {
                if let Some(callee) = outermost_wrapper(parent)
                    && let Node::Expr(call) = callee.parent()
                    && call.as_call().is_some_and(|it| it.callee() == callee && it.args().is_empty())
                {
                    cx.report(call, PREFER_DATE_NOW_OVER_METHODS)
                        .data("bad_method", name)
                        .fix(|fixer| fixer.replace(call, "Date.now()"));
                }
            }
            ExprKind::Call(call) if call.args().len() == 1 && call.callee() != operand => {
                if let Some(kind) = call.callee().as_ident().filter(|it| it.is_any(&["Number", "BigInt"]))
                    && !call.callee().is_parenthesized()
                {
                    let replaced = if kind.is("Number") { parent } else { new_date };
                    cx.report(parent, PREFER_DATE_NOW_OVER_NUMBER_DATE_OBJECT)
                        .data("kind", kind)
                        .fix(|fixer| fixer.replace(replaced, "Date.now()"));
                }
            }
            ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, .. } => {
                cx.report(operand.outer_span(), PREFER_DATE_NOW).fix(|fixer| fixer.replace(parent, "Date.now()"));
            }
            ExprKind::Assign { op: Some(op), value, .. } if is_arithmetic(op) && value == operand => {
                cx.report(operand.outer_span(), PREFER_DATE_NOW);
            }
            ExprKind::Binary { op, .. } if is_arithmetic(op) => {
                cx.report(operand.outer_span(), PREFER_DATE_NOW);
            }
            _ => {}
        }
    }
}
