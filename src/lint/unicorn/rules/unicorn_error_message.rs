use bun_lint_oxlint::ast_util::is_global_reference;
use crate::unicorn::BUILT_IN_ERRORS;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces providing a `message` when creating built-in `Error` objects to improve readability and debugging.
pub struct ErrorMessage;

const MISSING_MESSAGE: Message = Message::new("", "Pass a message to the {{ctor_name}} constructor.");
const EMPTY_MESSAGE: Message = Message::new("", "Error message should not be an empty string.");
const NOT_STRING: Message = Message::new("", "Error message should be a string.");

impl Rule for ErrorMessage {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "error-message", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ErrorMessage
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&BUILT_IN_ERRORS) {
            return;
        }
        on.exprs([ExprTag::New, ExprTag::Call], |_, e, cx| {
            let (ExprKind::New(call) | ExprKind::Call(call)) = e.kind() else {
                return;
            };
            let callee = call.callee();
            let Some(constructor_name) = callee.as_ident().filter(|it| it.is_any(&BUILT_IN_ERRORS)) else {
                return;
            };
            if callee.is_parenthesized() || !is_global_reference(callee) {
                return;
            }
            let message_argument_idx = match constructor_name.bytes() {
                b"AggregateError" => 1,
                b"SuppressedError" => 2,
                _ => 0,
            };
            // A spread at or before the message makes the order of the arguments unknown.
            if call.args().iter().take(message_argument_idx + 1).any(|it| it.tag() == ExprTag::Spread) {
                return;
            }
            let Some(arg) = call.args().get(message_argument_idx) else {
                cx.report(e, MISSING_MESSAGE).data("ctor_name", constructor_name);
                return;
            };
            let message = match arg.kind() {
                _ if arg.is_parenthesized() => return,
                ExprKind::Array(_) | ExprKind::Object(_) => NOT_STRING,
                ExprKind::String(value) if value.bytes().is_empty() => EMPTY_MESSAGE,
                ExprKind::Template(_) if arg.span().len() == 2 => EMPTY_MESSAGE,
                _ => return,
            };
            cx.report(arg, message);
        });
    }
}
