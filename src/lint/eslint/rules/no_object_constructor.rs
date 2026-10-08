use bun_lint::prelude::*;

/// Disallow calls to the `Object` constructor without an argument.
pub struct NoObjectConstructor;

const PREFER_LITERAL: Message =
    Message::new("preferLiteral", "The object literal notation {} is preferable.");
const USE_LITERAL: Message = Message::new("useLiteral", "Replace with '{{replacement}}'.");
const USE_LITERAL_AFTER_SEMICOLON: Message = Message::new(
    "useLiteralAfterSemicolon",
    "Replace with '{{replacement}}', add preceding semicolon.",
);

/// The message of each suggestion, its `replacement`, and the text that replaces the call.
const SUGGESTIONS: [(Message, &str, &str); 3] = [
    (USE_LITERAL, "{}", "{}"),
    (USE_LITERAL, "({})", "({})"),
    (USE_LITERAL_AFTER_SEMICOLON, "({})", ";({})"),
];

/// ESLint's `needsParentheses`: whether an object literal in the place of `e` would be taken for a
/// block.
fn needs_parentheses(e: Expr) -> bool {
    ast_utils::is_start_of_expression_statement(e)
        || e.file().token_before(e).is_some_and(|it| ast_utils::is_arrow_token(&it))
}

/// The text that replaces `e`.
fn fix_text(e: Expr) -> &'static str {
    if !needs_parentheses(e) {
        "{}"
    } else if ast_utils::needs_preceding_semicolon(e) {
        ";({})"
    } else {
        "({})"
    }
}

impl NoObjectConstructor {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = e.kind() else {
            return;
        };
        if !call.callee().is_ident("Object") || !call.args().is_empty() {
            return;
        }
        if cx.file().global(b"Object").is_none() || Node::Expr(e).scope().resolve("Object").is_some() {
            return;
        }
        let mut report = cx.report(e, PREFER_LITERAL);
        for (message, replacement, text) in SUGGESTIONS {
            report = report.suggest_with(message, &[("replacement", replacement.as_bytes())], |fixer| {
                (fix_text(e) == text).then(|| fixer.replace(e, text))
            });
        }
    }
}

impl Rule for NoObjectConstructor {
    const META: Meta = Meta::eslint("no-object-constructor", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoObjectConstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Object") {
            return;
        }
        on.exprs([ExprTag::Call, ExprTag::New], Self::check);
    }
}
