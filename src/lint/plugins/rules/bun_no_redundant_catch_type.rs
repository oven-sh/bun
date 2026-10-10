use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `: unknown` on the variable of a `catch` clause, its type anyway with `useUnknownInCatchVariables`.
pub struct NoRedundantCatchType;

const REDUNDANT_TYPE: Message = Message::new(
    "redundantType",
    "With `strict` or `useUnknownInCatchVariables` the variable of a `catch` clause is `unknown` without an annotation.",
);

impl Rule for NoRedundantCatchType {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-redundant-catch-type", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Try]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoRedundantCatchType
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Try { param: Some(param), .. } = statement.kind()
            && let Some(ty) = param.ty()
            && matches!(ty.kind(), TypeKind::Keyword(Keyword::Unknown))
        {
            let annotation = Span::new(param.pat().span().end, ty.outer_span().end);
            cx.report(ty, REDUNDANT_TYPE).fix(|fixer| fixer.remove(annotation));
        }
    }
}
