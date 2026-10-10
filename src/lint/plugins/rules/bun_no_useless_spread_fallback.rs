use crate::bun::{is_listed, list_option};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow an empty object as the other branch of a conditional expression that is spread into an object.
pub struct NoUselessSpreadFallback {
    ignore_conditions_that_call: Box<[Box<[u8]>]>,
}

const USELESS_FALLBACK: Message = Message::new(
    "uselessFallback",
    "This empty object is made only to be spread. To spread `false`, `null` or `undefined` into an object does nothing.",
);
const USE_LOGICAL_AND: Message = Message::new("useLogicalAnd", "Replace the conditional expression with `&&`.");

fn is_empty_object(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Object(properties) if properties.is_empty())
}

/// The text of `e` as an operand of `&&`.
fn operand_text(e: Expr) -> Vec<u8> {
    match ast_utils::get_precedence(e) < ast_utils::get_binary_operator_precedence(BinOp::And) {
        true => [b"(", e.text(), b")"].concat(),
        false => e.text().to_vec(),
    }
}

impl NoUselessSpreadFallback {
    fn ignores(&self, test: Expr) -> bool {
        let is_listed = |call: Expr| {
            let callee = call.callee().and_then(Expr::as_ident);
            callee.is_some_and(|name| is_listed(&self.ignore_conditions_that_call, name.bytes()))
        };
        !self.ignore_conditions_that_call.is_empty()
            && (test.file().exprs_of_kind(ExprTag::Call)).any(|it| test.span().contains(it.span()) && is_listed(it))
    }
}

impl Rule for NoUselessSpreadFallback {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-useless-spread-fallback", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoUselessSpreadFallback { ignore_conditions_that_call: list_option(options, "ignoreConditionsThatCall", &[]) }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // Of an object literal or of the attributes of an element. What is spread into an array has to be iterable.
        if !matches!(e.parent(), Node::Prop(it) if it.kind() == PropKind::Spread) {
            return;
        }
        let ExprKind::Cond { test, yes, no } = e.kind() else {
            return;
        };
        let Some(fallback) = [no, yes].into_iter().find(|it| is_empty_object(*it)) else {
            return;
        };
        if self.ignores(test) {
            return;
        }
        let report = cx.report(fallback, USELESS_FALLBACK);
        if fallback == no {
            report.suggest(USE_LOGICAL_AND, |fixer| {
                fixer.replace(e, [&operand_text(test)[..], b" && ", &operand_text(yes)].concat())
            });
        }
    }
}
