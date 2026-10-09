use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow awaiting non-promise values.
pub struct NoUnnecessaryAwait;

const UNNECESSARY_AWAIT: Message = Message::new("", "Unexpected `await` on a non-Promise value");

fn not_promise(argument: Expr) -> bool {
    let mut at = argument;
    while let ExprKind::Binary { op: BinOp::Comma, right, .. } = at.kind() {
        at = right;
    }
    match at.kind() {
        ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => false,
        ExprKind::Binary { left, .. } => left.tag() != ExprTag::PrivateIdentifier,
        ExprKind::Array(_)
        | ExprKind::Fn(_)
        | ExprKind::Await(_)
        | ExprKind::Class(_)
        | ExprKind::Jsx(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::String(_)
        | ExprKind::Template(_)
        | ExprKind::Unary { .. } => true,
        _ => false,
    }
}

fn is_fixable(e: Expr, argument: Expr) -> bool {
    if argument.is_parenthesized() {
        return true;
    }
    // Without the `await` these can become declarations.
    let is_function = argument.as_fn().is_some_and(|it| !it.is_arrow());
    if is_function || argument.tag() == ExprTag::Class {
        return false;
    }
    // `+await +1` would become `++1`.
    let (Node::Expr(parent), false) = (e.parent(), e.is_parenthesized()) else {
        return true;
    };
    match (parent.unary_op(), argument.unary_op()) {
        (Some(outer), Some(UnOp::PreInc)) => outer != UnOp::Plus,
        (Some(outer), Some(UnOp::PreDec)) => outer != UnOp::Minus,
        (Some(_), Some(UnOp::PostInc | UnOp::PostDec)) => true,
        (Some(outer), Some(inner)) => outer != inner,
        _ => true,
    }
}

impl Rule for NoUnnecessaryAwait {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-unnecessary-await", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Await], |_, e, cx| {
            let ExprKind::Await(argument) = e.kind() else {
                return;
            };
            if !not_promise(argument) {
                return;
            }
            let start = e.span().start;
            cx.report(Span::new(start, start + 5), UNNECESSARY_AWAIT).fix(|fixer| {
                is_fixable(e, argument).then(|| fixer.replace(e, fixer.file().slice(argument.outer_span())))
            });
        });
    }
}
