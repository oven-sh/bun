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
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoUndef {
            considers_typeof: options.object(0).bool_or("typeof", false),
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // oxlint says nothing about a name that can be that of a type.
        let is_oxlint = cx.language().is_oxlint;
        for reference in cx.file().unresolved_references() {
            if reference.global().is_some()
                || is_oxlint && reference.is_type()
                || !self.considers_typeof && has_typeof_operator(reference)
            {
                continue;
            }
            cx.report(reference, UNDEF).data("name", reference.name());
        }
    }
}
