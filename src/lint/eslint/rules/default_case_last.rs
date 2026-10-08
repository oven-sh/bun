use bun_lint::prelude::*;

/// Enforce `default` clauses in `switch` statements to be last.
pub struct DefaultCaseLast;

const NOT_LAST: Message = Message::new("notLast", "Default clause should be the last clause.");

impl Rule for DefaultCaseLast {
    const META: Meta = Meta::eslint("default-case-last", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        DefaultCaseLast
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Switch], |_, stmt, cx| {
            let StmtKind::Switch { cases, .. } = stmt.kind() else {
                return;
            };
            if let Some(default) = cases.iter().find(|case| case.is_default())
                && cases.last() != Some(default)
            {
                cx.report(default, NOT_LAST);
            }
        });
    }
}
