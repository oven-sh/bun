use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call, is_new_expression};
use crate::unicorn::could_be_asi_hazard;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the use of `Response.json()` over `new Response(JSON.stringify())`.
pub struct PreferResponseStaticJson;

const PREFER_RESPONSE_STATIC_JSON: Message =
    Message::new("", "Prefer using `Response.json(…)` over `JSON.stringify()`.");
const SUGGESTION: Message = Message::new("", "Replace `new Response(JSON.stringify(...))` with `Response.json(...)`");

impl Rule for PreferResponseStaticJson {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-response-static-json", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferResponseStaticJson
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Response") || !file.mentions("stringify") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(new_expr) = e.kind() else {
                return;
            };
            if !is_new_expression(new_expr, &["Response"], Some(1), None) {
                return;
            }
            let Some(argument_expr) = new_expr.args().first() else {
                return;
            };
            let Some(call_expr) =
                Some(get_inner_expression(argument_expr)).filter(|it| !it.is_chain_root()).and_then(Expr::as_call)
            else {
                return;
            };
            let Some(data_expr) = call_expr.args().first().filter(|it| it.tag() != ExprTag::Spread) else {
                return;
            };
            if !is_method_call(call_expr, Some(&["JSON"]), Some(&["stringify"]), Some(1), Some(1)) {
                return;
            }
            cx.report(call_expr.callee().outer_span(), PREFER_RESPONSE_STATIC_JSON).suggest(SUGGESTION, |fixer| {
                let (span, callee) = (e.span(), new_expr.callee());
                let mut fix = Vec::with_capacity(7);
                fix.push(fixer.insert_after(get_inner_expression(callee), ".json"));
                let (new_keyword_end, callee_start) = (span.start + 3, callee.outer_span().start);
                if fixer.file().comments_in(Span::new(new_keyword_end, callee_start)).len() > 0 {
                    fix.push(fixer.insert_before(span, "( "));
                    fix.push(fixer.remove(Span::new(span.start, new_keyword_end + 1)));
                    fix.push(fixer.insert_after(span, ")"));
                } else {
                    fix.push(fixer.remove(Span::new(span.start, callee_start)));
                }
                let (data_span, stringify_call_span) = (data_expr.outer_span(), argument_expr.outer_span());
                fix.push(fixer.remove(Span::new(stringify_call_span.start, data_span.start)));
                fix.push(fixer.remove(Span::new(data_span.end, stringify_call_span.end)));
                // `(Response)` could continue the line before.
                if !e.is_parenthesized()
                    && (callee.is_parenthesized() || callee.tag() != ExprTag::Ident)
                    && could_be_asi_hazard(e)
                {
                    fix.push(fixer.insert_before(span, ";"));
                }
                fix
            });
        });
    }
}
