use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{could_be_asi_hazard, is_global_reference_name};

/// Disallow `Array` constructors.
pub struct NoArrayConstructor;

const PREFER_LITERAL: Message = Message::new(
    "preferLiteral",
    "The array literal notation [] is preferable.",
);
const USE_LITERAL: Message = Message::new("useLiteral", "Replace with an array literal.");
const USE_LITERAL_AFTER_SEMICOLON: Message = Message::new(
    "useLiteralAfterSemicolon",
    "Replace with an array literal, add preceding semicolon.",
);

/// The call, if `e` calls or constructs something that is named `Array`, without type arguments.
pub fn as_array_call(e: Expr<'_>) -> Option<Call<'_>> {
    let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
        return None;
    };
    (call.callee().is_ident("Array") && call.type_args().is_empty()).then_some(call)
}

/// Whether oxlint reports `call`, which [calls `Array`](as_array_call): the name is not in parentheses and nothing
/// declares it, the call is not optional, and it has not one argument, or ends with `...a`.
pub fn is_reported_by_oxlint(call: Call) -> bool {
    let ends_with_spread = call.args().last().is_some_and(|it| it.tag() == ExprTag::Spread);
    is_global_reference_name(call.callee(), "Array")
        && !call.is_optional()
        && (call.args().len() != 1 || ends_with_spread)
}

/// ESLint's `getArgumentsText`: the text between the calling parentheses of `e`, which is `call`.
/// Empty if there are none.
pub fn get_arguments_text<'a>(e: Expr<'a>, call: Call<'a>) -> &'a [u8] {
    let file = e.file();
    let Some(last_token) = file.last_token(e).filter(ast_utils::is_closing_paren_token) else {
        return b"";
    };
    let mut after_callee = file.tokens_after(call.callee()).take_while(|token| *token != last_token);
    match after_callee.find(ast_utils::is_opening_paren_token) {
        Some(first_token) => file.slice(first_token.span().between(last_token.span())),
        None => b"",
    }
}

/// ESLint's `hasCommentsInArrayConstructor`: before the arguments.
fn has_comments_in_array_constructor<'a>(e: Expr<'a>, call: Call<'a>) -> bool {
    let file = e.file();
    let (Some(first_token), Some(last_token), Some(mut last_relevant_token)) =
        (file.first_token(e), file.last_token(e), file.last_token(call.callee()))
    else {
        return false;
    };
    while last_relevant_token != last_token && !ast_utils::is_opening_paren_token(&last_relevant_token) {
        let Some(next) = file.token_after(last_relevant_token) else {
            break;
        };
        last_relevant_token = next;
    }
    file.comments_exist_between(first_token, last_relevant_token)
}

#[derive(Copy, Clone)]
enum Change {
    Fix,
    Suggestion { is_after_semicolon: bool },
}

/// The replacement of `e` by an array literal, if it is to be made as a `change`.
fn replace_with_literal<'a>(fixer: Fixer<'a>, e: Expr<'a>, call: Call<'a>, change: Change) -> Option<Fix> {
    let args = call.args();
    let non_spread_count = args.iter().filter(|arg| arg.tag() != ExprTag::Spread).count();
    let should_suggest = call.is_optional()
        || (!args.is_empty() && non_spread_count < 2)
        || has_comments_in_array_constructor(e, call);
    if should_suggest != matches!(change, Change::Suggestion { .. }) {
        return None;
    }
    // A line break ends the statement before `Array()`, but not before `[]`.
    let needs_semicolon =
        ast_utils::is_start_of_expression_statement(e) && ast_utils::needs_preceding_semicolon(e);
    if matches!(change, Change::Suggestion { is_after_semicolon } if is_after_semicolon != needs_semicolon) {
        return None;
    }
    let open: &[u8] = if needs_semicolon { b";[" } else { b"[" };
    Some(fixer.replace(e, [open, get_arguments_text(e, call), b"]"].concat()))
}

/// oxlint's fix: all from the first argument on. None for `Array(...a)` and `Array(a, ...b)`.
fn replace_as_oxlint<'a>(fixer: Fixer<'a>, e: Expr<'a>, call: Call<'a>) -> Option<Fix> {
    let args = call.args();
    if args.len() <= 2 && args.last().is_some_and(|it| it.tag() == ExprTag::Spread) {
        return None;
    }
    let open: &[u8] = if could_be_asi_hazard(e) { b";[" } else { b"[" };
    let written = args.first().map(|first| Span::new(first.outer_span().start, e.span().end - 1));
    Some(fixer.replace(e, [open, fixer.file().slice(written.unwrap_or_default()), b"]"].concat()))
}

impl NoArrayConstructor {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = as_array_call(e) else {
            return;
        };
        if cx.language().is_oxlint {
            if is_reported_by_oxlint(call) {
                cx.report(e, PREFER_LITERAL).fix(|fixer| replace_as_oxlint(fixer, e, call));
            }
            return;
        }
        let args = call.args();
        if args.len() == 1 && args.first().is_some_and(|arg| arg.tag() != ExprTag::Spread) {
            return;
        }
        if cx.file().global(b"Array").is_none() || Node::Expr(e).scope().resolve("Array").is_some() {
            return;
        }
        cx.report(e, PREFER_LITERAL)
            .fix(|fixer| replace_with_literal(fixer, e, call, Change::Fix))
            .suggest(USE_LITERAL, |fixer| {
                replace_with_literal(fixer, e, call, Change::Suggestion { is_after_semicolon: false })
            })
            .suggest(USE_LITERAL_AFTER_SEMICOLON, |fixer| {
                replace_with_literal(fixer, e, call, Change::Suggestion { is_after_semicolon: true })
            });
    }
}

impl Rule for NoArrayConstructor {
    const META: Meta = Meta::eslint("no-array-constructor", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayConstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Array") {
            return;
        }
        on.exprs([ExprTag::Call, ExprTag::New], Self::check);
    }
}
