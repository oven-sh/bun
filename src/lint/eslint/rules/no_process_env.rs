use bun_lint::prelude::*;

/// Disallow the use of `process.env`.
pub struct NoProcessEnv;

const UNEXPECTED_PROCESS_ENV: Message =
    Message::new("unexpectedProcessEnv", "Unexpected use of process.env.");

/// Whether `e` is the operand of a `typeof` type, or the start of it: a `TSQualifiedName`.
// TODO(api): replace by utils::ast_utils::is_member_expression, once it leaves out JSX and types
fn is_in_type_query(e: Expr<'_>) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == at) => {
                at = parent;
            }
            Node::Type(ty) => return matches!(ty.kind(), TypeKind::Typeof { .. }),
            _ => return false,
        }
    }
}

impl Rule for NoProcessEnv {
    const META: Meta = Meta::eslint("no-process-env", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoProcessEnv
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Dot], |_, e, cx| {
            let ExprKind::Dot { obj, name, .. } = e.kind() else {
                return;
            };
            // The `name` of ESLint's `PrivateIdentifier` is without the `#`.
            if name.name().is_any(&["env", "#env"])
                && obj.is_ident("process")
                && !e.is_jsx_tag_name()
                && !is_in_type_query(e)
            {
                cx.report(e, UNEXPECTED_PROCESS_ENV);
            }
        });
    }
}
