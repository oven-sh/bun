use bun_lint_oxlint::ast_util::{get_member_expr, static_property_info};
use crate::unicorn::{is_array_of_one_spread, is_expression_statement};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer using `Array#toReversed()` over `Array#reverse()`.
pub struct NoArrayReverse {
    allow_expression_statement: bool,
}

const NO_ARRAY_REVERSE: Message = Message::new("", "Use `Array#toReversed()` instead of `Array#reverse()`.");
const USE_TO_REVERSED: Message = Message::new(
    "",
    "`Array#reverse()` mutates the original array. Use `Array#toReversed()` to return a new reversed array without \
     modifying the original.",
);

impl Rule for NoArrayReverse {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-reverse", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoArrayReverse { allow_expression_statement: options.object(0).bool_or("allowExpressionStatement", true) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("reverse") {
            return;
        }
        on.exprs([ExprTag::Call], |rule, e, cx| {
            let Some(call) = e.as_call().filter(|it| it.args().is_empty() && !it.is_optional()) else {
                return;
            };
            let Some(member) = get_member_expr(call.callee()) else {
                return;
            };
            let Some((span, _)) = static_property_info(member).filter(|it| it.1.is("reverse")) else {
                return;
            };
            if rule.allow_expression_statement
                && is_expression_statement(e)
                && !member.object().is_some_and(is_array_of_one_spread)
            {
                return;
            }
            cx.report(span, NO_ARRAY_REVERSE).suggest(USE_TO_REVERSED, |fixer| fixer.replace(span, "toReversed"));
        });
    }
}
