use bun_lint::prelude::*;

/// Disallow labels that share a name with a variable.
pub struct NoLabelVar;

const IDENTIFIER_CLASH_WITH_LABEL: Message = Message::new(
    "identifierClashWithLabel",
    "Found identifier with same name as label.",
);

impl Rule for NoLabelVar {
    const META: Meta = Meta::eslint("no-label-var", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLabelVar
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Labeled], |_, stmt, cx| {
            let StmtKind::Labeled { label, .. } = stmt.kind() else {
                return;
            };
            let variable = Node::Stmt(stmt).scope().resolve_name(label);
            if variable.is_some() || cx.file().global(label.bytes()).is_some() {
                // oxlint points at where the variable is declared.
                let declared = (variable.filter(|_| cx.language().is_oxlint))
                    .and_then(|it| it.declarations().next()?.name_span());
                cx.report(declared.unwrap_or_else(|| stmt.span()), IDENTIFIER_CLASH_WITH_LABEL);
            }
        });
    }
}
