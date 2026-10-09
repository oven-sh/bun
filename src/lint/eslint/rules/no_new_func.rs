use bun_lint::prelude::*;

/// Disallow `new` operators with the `Function` object.
pub struct NoNewFunc;

const NO_FUNCTION_CONSTRUCTOR: Message =
    Message::new("noFunctionConstructor", "The Function constructor is eval.");

impl NoNewFunc {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (call, is_new) = match e.kind() {
            ExprKind::Call(call) => (call, false),
            ExprKind::New(call) => (call, true),
            _ => return,
        };
        let callee = call.callee();
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
            // oxlint points at the `Function`.
            let place = if cx.language().is_oxlint { function } else { e };
            cx.report(place, NO_FUNCTION_CONSTRUCTOR).labels_with(|labels| {
                if let (Some(first), Some(last)) = (call.args().first(), call.args().last()) {
                    let arguments = first.outer_span().to(last.outer_span());
                    labels.push(arguments, "`Function` evaluates source text at runtime, similar to `eval`.");
                }
            });
        }
    }
}

impl Rule for NoNewFunc {
    const META: Meta = Meta::eslint("no-new-func", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Function") {
            return;
        }
        on.exprs([ExprTag::Call, ExprTag::New], Self::check);
    }
}
