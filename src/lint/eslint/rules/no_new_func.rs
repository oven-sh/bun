use bun_lint::prelude::*;

/// Disallow `new` operators with the `Function` object.
pub struct NoNewFunc;

const NO_FUNCTION_CONSTRUCTOR: Message =
    Message::new("noFunctionConstructor", "The Function constructor is eval.");

impl NoNewFunc {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (callee, is_new) = match e.kind() {
            ExprKind::Call(call) => (call.callee(), false),
            ExprKind::New(call) => (call.callee(), true),
            _ => return,
        };
        let function = match callee.kind() {
            ExprKind::Ident(_) => callee,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                if !is_new
                    && obj.is_ident("Function")
                    && ast_utils::is_member_access_of_any(callee, &["apply", "bind", "call"]) =>
            {
                obj
            }
            _ => return,
        };
        if function.is_ident("Function") && ast_utils::is_global_reference(function) {
            cx.report(e, NO_FUNCTION_CONSTRUCTOR);
        }
    }
}

impl Rule for NoNewFunc {
    const META: Meta = Meta::eslint("no-new-func", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call, ExprTag::New], Self::check);
    }
}
