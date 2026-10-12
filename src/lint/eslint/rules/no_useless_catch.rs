use bun_lint::prelude::*;

/// Disallow unnecessary `catch` clauses.
pub struct NoUselessCatch;

const UNNECESSARY_CATCH_CLAUSE: Message =
    Message::new("unnecessaryCatchClause", "Unnecessary catch clause.");
const UNNECESSARY_CATCH: Message =
    Message::new("unnecessaryCatch", "Unnecessary try/catch wrapper.");

impl Rule for NoUselessCatch {
    const META: Meta = Meta::eslint("no-useless-catch", Kind::Suggestion).recommended();
    const ON: On = On::new().stmts(&[StmtTag::Try]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoUselessCatch
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Try {
            param: Some(param),
            handler: Some(handler),
            finalizer,
            ..
        } = stmt.kind()
        else {
            return;
        };
        let Some(name) = param.pat().as_ident() else {
            return;
        };
        let Some(first) = handler.as_block().and_then(|body| body.first()) else {
            return;
        };
        let StmtKind::Throw(argument) = first.kind() else {
            return;
        };
        if argument.as_ident() != Some(name) {
            return;
        }
        // oxlint points at the parameter, and does not see through parentheses.
        if cx.language().is_oxlint {
            if !argument.is_parenthesized() {
                let message = if finalizer.is_some() { UNNECESSARY_CATCH_CLAUSE } else { UNNECESSARY_CATCH };
                cx.report(param.pat(), message).first_label("is caught here").label(first, "and re-thrown here");
            }
            return;
        }
        match stmt.catch_clause_span() {
            Some(clause) if finalizer.is_some() => {
                cx.report(clause, UNNECESSARY_CATCH_CLAUSE);
            }
            _ => {
                cx.report(stmt, UNNECESSARY_CATCH);
            }
        }
    }
}
