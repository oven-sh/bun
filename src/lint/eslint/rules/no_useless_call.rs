use bun_lint::prelude::*;

/// Disallow unnecessary calls to `.call()` and `.apply()`.
pub struct NoUselessCall;

const UNNECESSARY_CALL: Message = Message::new("unnecessaryCall", "Unnecessary '.{{name}}()'.");

impl NoUselessCall {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let ExprKind::Dot { obj: applied, name, .. } = call.callee().kind() else {
            return;
        };
        let args = call.args();
        let is_call_or_non_variadic_apply = match name.bytes() {
            b"call" => !args.is_empty(),
            b"apply" => args.len() == 2 && args.get(1).is_some_and(|it| it.tag() == ExprTag::Array),
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
            _ => ast_utils::is_null_or_undefined(this_arg),
        };
        if is_valid_this_arg {
            cx.report(e, UNNECESSARY_CALL).data("name", name);
        }
    }
}

impl Rule for NoUselessCall {
    const META: Meta = Meta::eslint("no-useless-call", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessCall
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
