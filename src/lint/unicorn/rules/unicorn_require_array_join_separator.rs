use bun_lint_oxlint::ast_util::{as_member_expression, get_member_expr, is_method_call};
use bun_lint_oxlint::text::find_next_token_within;
use crate::unicorn::is_prototype_property;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using the separator argument with `Array#join()`.
pub struct RequireArrayJoinSeparator;

const REQUIRE_ARRAY_JOIN_SEPARATOR: Message =
    Message::new("", "Enforce using the separator argument with Array#join()");

impl Rule for RequireArrayJoinSeparator {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "require-array-join-separator", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().method_calls(&["join", "call"]);
    /// `join`, `call`
    type State<'a> = [Name<'a>; 2];

    fn new(_: &Options) -> Self {
        RequireArrayJoinSeparator
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        Some([file.find_name("join")?, file.name_of("call")])
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if call.callee().member_name().is_some_and(|it| !cx.state.contains(&it.name()))
            || call.args().len() > 1
            || call.is_optional()
        {
            return;
        }
        let Some(member) = get_member_expr(call.callee()) else {
            return;
        };
        let (callee_end, call_end) = (member.span().end, e.span().end);
        match call.args().first() {
            // `foo.join()`
            None => {
                if member.tag() == ExprTag::Dot && is_method_call(call, None, Some(&["join"]), Some(0), Some(0)) {
                    cx.report(Span::new(callee_end, call_end), REQUIRE_ARRAY_JOIN_SEPARATOR).fix(|fixer| {
                        let open_paren = find_next_token_within(fixer.file(), Span::new(callee_end, call_end), b"(")?;
                        Some(fixer.insert_after(Span::empty(open_paren + 1), "\",\""))
                    });
                }
            }
            // `[].join.call(foo)`, `Array.prototype.join.call(foo)`
            Some(first_arg) => {
                if first_arg.tag() != ExprTag::Spread
                    && !member.is_optional()
                    && is_method_call(call, None, Some(&["call"]), Some(1), Some(1))
                    && (member.object().and_then(as_member_expression))
                        .is_some_and(|it| is_prototype_property(it, "join", "Array"))
                {
                    cx.report(Span::new(callee_end, call_end), REQUIRE_ARRAY_JOIN_SEPARATOR)
                        .fix(|fixer| fixer.insert_after(first_arg.outer_span(), ", \",\""));
                }
            }
        }
    }
}
