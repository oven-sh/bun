use bun_lint::prelude::*;

/// Require or disallow newlines around variable declarations.
pub struct OneVarDeclarationPerLine {
    is_always: bool,
}

const EXPECT_VAR_ON_NEWLINE: Message = Message::new(
    "expectVarOnNewline",
    "Expected variable declaration to be on a new line.",
);

impl Rule for OneVarDeclarationPerLine {
    const META: Meta = Meta::eslint("one-var-declaration-per-line", Kind::Suggestion)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().stmts(&[StmtTag::Var]);
    no_state!();

    fn new(options: &Options) -> Self {
        OneVarDeclarationPerLine {
            is_always: options.str(0) == Some("always"),
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = stmt.kind() else {
            return;
        };
        let mut declarations = declarations.iter();
        let Some(mut prev) = declarations.next() else {
            return;
        };
        for current in declarations {
            if (self.is_always || prev.init().is_some() || current.init().is_some())
                && ast_utils::is_token_on_same_line(cx.file(), prev, current)
            {
                if matches!(
                    stmt.parent(),
                    Node::Stmt(parent) if matches!(parent.tag(), StmtTag::For | StmtTag::ForIn | StmtTag::ForOf)
                ) {
                    return;
                }
                cx.report(current, EXPECT_VAR_ON_NEWLINE)
                    .fix(|fixer| fixer.insert_before(current, "\n"));
            }
            prev = current;
        }
    }
}
