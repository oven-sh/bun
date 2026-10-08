use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::is_assignee;

/// Disallow non-null assertions using the `!` postfix operator.
pub struct NoNonNullAssertion;

const NO_NON_NULL: Message = Message::new("noNonNull", "Forbidden non-null assertion.");
const SUGGEST_OPTIONAL_CHAIN: Message = Message::new(
    "suggestOptionalChain",
    "Consider using the optional chain operator `?.` instead. This operator includes runtime checks, so it is safer than the compile-only non-null assertion operator.",
);

enum Suggestion {
    /// `x![y]`, `x!()`
    ReplaceWithOptional,
    /// `x!.y`
    MoveBeforeDot,
    /// `x!?.y`, `x!?.[y]`, `x!?.()`
    Remove,
}

fn suggestion(e: Expr) -> Option<Suggestion> {
    let parent = e.parent().as_expr()?;
    let is_computed = match parent.kind() {
        ExprKind::Dot { obj, .. } if obj == e && !is_assignee(parent) => false,
        ExprKind::Index { obj, .. } if obj == e && !is_assignee(parent) => true,
        ExprKind::Call(call) if call.callee() == e => true,
        _ => return None,
    };
    Some(match (parent.is_optional(), is_computed) {
        (true, _) => Suggestion::Remove,
        (false, true) => Suggestion::ReplaceWithOptional,
        (false, false) => Suggestion::MoveBeforeDot,
    })
}

impl Rule for NoNonNullAssertion {
    const META: Meta = Meta::typescript("no-non-null-assertion", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNonNullAssertion
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::NonNull], |_, e, cx| {
            // All but the last `!` of `x!!!`. What is around each is an assertion: nothing to suggest.
            for inner in e.inner_non_null_spans() {
                cx.report(inner, NO_NON_NULL);
            }
            let report = cx.report(e, NO_NON_NULL);
            let Some(suggestion) = suggestion(e) else {
                return;
            };
            let end = e.span().end;
            let operator = Span::new(end.saturating_sub(1), end);
            report.suggest(SUGGEST_OPTIONAL_CHAIN, |fixer| match suggestion {
                Suggestion::ReplaceWithOptional => vec![fixer.replace(operator, "?.")],
                Suggestion::Remove => vec![fixer.remove(operator)],
                Suggestion::MoveBeforeDot => {
                    let punctuator = skip_trivia(fixer.file().text(), end);
                    vec![
                        fixer.remove(operator),
                        fixer.insert_before(Span::empty(punctuator), "?"),
                    ]
                }
            });
        });
    }
}
