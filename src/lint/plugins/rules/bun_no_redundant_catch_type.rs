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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoRedundantCatchType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Try], |_, statement, cx| {
            if let StmtKind::Try { param: Some(param), .. } = statement.kind()
                && let Some(ty) = param.ty()
                && matches!(ty.kind(), TypeKind::Keyword(Keyword::Unknown))
            {
                let annotation = Span::new(param.pat().span().end, ty.outer_span().end);
                cx.report(ty, REDUNDANT_TYPE).fix(|fixer| fixer.remove(annotation));
            }
        });
    }
}
