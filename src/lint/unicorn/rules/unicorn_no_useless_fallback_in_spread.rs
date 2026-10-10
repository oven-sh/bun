use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow useless fallback when spreading in object literals.
pub struct NoUselessFallbackInSpread;

const NO_USELESS_FALLBACK: Message = Message::new("", "Empty fallbacks in spreads are unnecessary");

fn can_fix(left: Expr) -> bool {
    let mut at = left;
    while let ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, .. } = at.kind() {
        at = left;
    }
    match at.kind() {
        ExprKind::Ident(name) => !name.is_any(&["undefined", "NaN", "Infinity"]),
        ExprKind::Object(_) | ExprKind::Call(_) | ExprKind::Index { .. } => true,
        ExprKind::Dot { .. } => at.is_chain_root() || !at.is_private_member(),
        _ => at.is_chain_root(),
    }
}

impl Rule for NoUselessFallbackInSpread {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-useless-fallback-in-spread", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().binaries(&[BinOp::Or, BinOp::Nullish]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessFallbackInSpread
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { left, right, .. } = e.kind() else {
            return;
        };
        if !matches!(right.kind(), ExprKind::Object(properties) if properties.is_empty()) {
            return;
        }
        let Node::Prop(spread) = e.parent() else {
            return;
        };
        if spread.kind() != PropKind::Spread || spread.is_jsx_attribute() {
            return;
        }
        cx.report(spread, NO_USELESS_FALLBACK).fix(|fixer| {
            let left_text = fixer.file().slice(left.outer_span());
            can_fix(left).then(|| fixer.replace(spread, [&b"..."[..], left_text].concat()))
        });
    }
}
