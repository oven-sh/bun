use bun_lint::prelude::*;

/// Require rest parameters instead of `arguments`.
pub struct PreferRestParams;

const PREFER_REST_PARAMS: Message = Message::new(
    "preferRestParams",
    "Use the rest parameters instead of 'arguments'.",
);

/// `arguments.length`, as opposed to `arguments` and `arguments[0]`.
fn is_normal_member_access(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent)
        if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == e))
}

impl Rule for PreferRestParams {
    const META: Meta = Meta::eslint("prefer-rest-params", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferRestParams
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Ident], |_, e, cx| {
            if !e.is_ident("arguments") || is_normal_member_access(e) {
                return;
            }
            let Some(symbol) = e.reference().and_then(Reference::symbol) else {
                return;
            };
            // The top level of a CommonJS file has an `arguments` too, which ESLint does not look at.
            if !symbol.is_implicit_arguments() || !matches!(symbol.scope().node(), Node::Func(_)) {
                return;
            }
            // It is several references where it is given several values at once.
            for _ in symbol.references().filter(|it| it.expr() == Some(e)) {
                cx.report(e, PREFER_REST_PARAMS);
            }
        });
    }
}
