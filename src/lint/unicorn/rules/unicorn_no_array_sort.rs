use bun_lint_oxlint::ast_util::{get_member_expr, is_import_symbol, static_property_info};
use crate::unicorn::{is_array_of_one_spread, is_expression_statement};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer using `Array#toSorted()` over `Array#sort()`.
pub struct NoArraySort {
    allow_expression_statement: bool,
    allow_after_spread: bool,
}

const NO_ARRAY_SORT: Message = Message::new("", "Use `Array#toSorted()` instead of `Array#sort()`.");
const USE_TO_SORTED: Message = Message::new(
    "",
    "`Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying \
     the original.",
);

/// What `Array#sort()` cannot compare with: the method is that of something else then, such as a query.
fn is_non_compare_fn_argument(argument: Expr) -> bool {
    match argument.kind() {
        ExprKind::Object(_)
        | ExprKind::String(_)
        | ExprKind::Template(_)
        | ExprKind::Number(_)
        | ExprKind::Array(_) => true,
        ExprKind::Unary { op: UnOp::Plus | UnOp::Minus, operand } => {
            matches!(operand.tag(), ExprTag::Number | ExprTag::BigInt)
        }
        _ => false,
    }
}

/// The `a` of `a.b[c].d`.
fn leftmost_identifier_reference(e: Expr<'_>) -> Option<Expr<'_>> {
    let mut at = e;
    while !at.is_parenthesized() {
        match at.object() {
            Some(object) => at = object,
            None => return Some(at).filter(|it| it.tag() == ExprTag::Ident),
        }
    }
    None
}

impl Rule for NoArraySort {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-sort", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoArraySort {
            allow_expression_statement: options.bool_or("allowExpressionStatement", true),
            allow_after_spread: options.bool_or("allowAfterSpread", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("sort") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(call) = e.as_call().filter(|it| it.args().len() <= 1 && !it.is_optional()) else {
                return;
            };
            let Some(member) = get_member_expr(call.callee()) else {
                return;
            };
            let (Some((span, name)), Some(object)) = (static_property_info(member), member.object()) else {
                return;
            };
            if !name.is("sort")
                || call.args().first().is_some_and(|it| it.tag() == ExprTag::Spread || is_non_compare_fn_argument(it))
            {
                return;
            }
            let is_allowed = match is_array_of_one_spread(object) {
                true => rule.allow_after_spread,
                false => rule.allow_expression_statement && is_expression_statement(e),
            };
            if is_allowed {
                return;
            }
            if cx.file().mentions("effect")
                && leftmost_identifier_reference(object).is_some_and(|it| is_import_symbol(it, "effect", "Chunk"))
            {
                return;
            }
            cx.report(span, NO_ARRAY_SORT).suggest(USE_TO_SORTED, |fixer| fixer.replace(span, "toSorted"));
        });
    }
}
