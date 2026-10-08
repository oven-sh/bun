use bun_lint::prelude::*;

/// Disallow the use of undeclared variables unless mentioned in `/*global */` comments.
pub struct NoUndef {
    considers_typeof: bool,
}

const UNDEF: Message = Message::new("undef", "'{{name}}' is not defined.");

/// ESLint's `hasTypeOfOperator`.
fn has_typeof_operator(reference: Reference) -> bool {
    matches!(
        reference.expr().map(Expr::parent),
        Some(Node::Expr(parent)) if matches!(parent.kind(), ExprKind::Unary { op: UnOp::Typeof, .. })
    )
}

impl Rule for NoUndef {
    const META: Meta = Meta::eslint("no-undef", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUndef {
            considers_typeof: options.object(0).bool_or("typeof", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for reference in cx.file().unresolved_references() {
                if reference.global().is_some()
                    || !rule.considers_typeof && has_typeof_operator(reference)
                {
                    continue;
                }
                cx.report(reference, UNDEF).data("name", reference.name());
            }
        });
    }
}
