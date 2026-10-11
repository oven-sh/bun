use bun_lint::prelude::*;

/// Disallow unnecessary calls to `.call()` and `.apply()`.
pub struct NoUselessCall;

const UNNECESSARY_CALL: Message = Message::new("unnecessaryCall", "Unnecessary '.{{name}}()'.");

impl Rule for NoUselessCall {
    const META: Meta = Meta::eslint("no-useless-call", Kind::Suggestion);
    const ON: On = On::new().method_calls(&["call", "apply"]);
    /// `call` and `apply`, as far as the file mentions them.
    type State<'a> = [Option<Name<'a>>; 2];

    fn new(_: &Options) -> Self {
        NoUselessCall
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if file.mentions_any(&["call", "apply"]) { Self::ON } else { On::new() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let mentioned = ["call", "apply"].map(|it| file.find_name(it));
        mentioned.iter().any(Option::is_some).then_some(mentioned)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let (Some(applied), Some(name)) = (call.callee().object(), call.callee().member_name()) else {
            return;
        };
        let args = call.args();
        let [call_name, apply_name] = cx.state;
        let is_call_or_non_variadic_apply = match Some(name.name()) {
            it if it == call_name => !args.is_empty(),
            it if it == apply_name => args.len() == 2 && args.get(1).is_some_and(|it| it.tag() == ExprTag::Array),
            _ => false,
        };
        if !is_call_or_non_variadic_apply {
            return;
        }
        let Some(this_arg) = args.first() else {
            return;
        };
        let is_valid_this_arg = match applied.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                ast_utils::equal_tokens(cx.file(), obj, this_arg)
            }
            // oxlint knows what `this` is only in the call of a name.
            _ if cx.language().is_oxlint && applied.tag() != ExprTag::Ident => false,
            _ => ast_utils::is_null_or_undefined(this_arg),
        };
        if is_valid_this_arg {
            cx.report(e, UNNECESSARY_CALL).data("name", name);
        }
    }
}
