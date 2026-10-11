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
    const ON: On = On::new().exprs(&[ExprTag::New]).function_calls(&BUILT_IN_ERRORS);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ErrorMessage
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        BUILT_IN_ERRORS.iter().any(|it| file.find_name(it).is_some()).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().or_else(|| e.as_new()) else {
            return;
        };
        let callee = call.callee();
        let is_error = |it: &Name| it.bytes().ends_with(b"Error") && it.is_any(&BUILT_IN_ERRORS);
        let Some(constructor_name) = callee.as_ident().filter(is_error) else {
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
    }
}
