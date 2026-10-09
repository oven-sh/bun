use crate::oxlint::promise::is_promise_with_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that Promise functions are called with the correct number of arguments.
pub struct ValidParams;

const ZERO_OR_ONE_ARGUMENT_REQUIRED: Message =
    Message::new("", "`Promise.{{prop_name}}()` requires 0 or 1 arguments, but received {{args_len}}.");
const ONE_OR_TWO_ARGUMENT_REQUIRED: Message =
    Message::new("", "`Promise.{{prop_name}}()` requires 1 or 2 arguments, but received {{args_len}}.");
const ONE_ARGUMENT_REQUIRED: Message = Message::new("", "`Promise.{{prop_name}}()` requires 1 argument, but received {{args_len}}.");

impl Rule for ValidParams {
    const META: Meta = Meta::oxlint(Plugin::Promise, "valid-params", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidParams
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["then", "catch", "finally", "Promise"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call() else {
                return;
            };
            // Nearly every call of these has one argument.
            let args_len = call_expr.args().len();
            if args_len == 1 {
                return;
            }
            let Some(prop_name) = is_promise_with_context(call_expr) else {
                return;
            };
            let message = match prop_name.bytes() {
                b"resolve" | b"reject" if args_len > 1 => ZERO_OR_ONE_ARGUMENT_REQUIRED,
                b"then" if args_len != 2 => ONE_OR_TWO_ARGUMENT_REQUIRED,
                b"race" | b"all" | b"allSettled" | b"any" | b"catch" | b"finally" => ONE_ARGUMENT_REQUIRED,
                _ => return,
            };
            cx.report(e, message).data("prop_name", prop_name).data("args_len", args_len);
        });
    }
}
