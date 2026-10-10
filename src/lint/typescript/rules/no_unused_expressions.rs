use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_unused_expressions::{Config, Prologue, check};

/// Disallow unused expressions.
pub struct NoUnusedExpressions {
    config: Config,
}

impl Rule for NoUnusedExpressions {
    const META: Meta = Meta::typescript("no-unused-expressions", Kind::Suggestion)
        .recommended()
        .extends_base_rule("no-unused-expressions");
    const ON: On = On::new().stmts(&[StmtTag::Expr]);
    type State<'a> = Prologue<'a>;

    fn new(options: &Options) -> Self {
        NoUnusedExpressions {
            config: Config::new(options),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Prologue<'a>> {
        Some(Prologue::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let mut prologue = std::mem::take(&mut cx.state);
        check(self.config, statement, &mut prologue, cx);
        cx.state = prologue;
    }
}
