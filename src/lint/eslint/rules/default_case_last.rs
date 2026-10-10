use bun_lint::prelude::*;

/// Enforce `default` clauses in `switch` statements to be last.
pub struct DefaultCaseLast;

const NOT_LAST: Message = Message::new("notLast", "Default clause should be the last clause.");

impl Rule for DefaultCaseLast {
    const META: Meta = Meta::eslint("default-case-last", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Switch]);
    no_state!();

    fn new(_: &Options) -> Self {
        DefaultCaseLast
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { cases, .. } = stmt.kind() else {
            return;
        };
        if let Some(default) = cases.iter().find(|case| case.is_default())
            && cases.last() != Some(default)
        {
            let whole = default.span();
            // oxlint points at the keyword.
            let end = if cx.language().is_oxlint { whole.start + "default".len() as u32 } else { whole.end };
            cx.report(Span::new(whole.start, end), NOT_LAST);
        }
    }
}
