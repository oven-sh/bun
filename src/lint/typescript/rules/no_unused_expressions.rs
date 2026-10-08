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
    type State<'a> = Prologue<'a>;

    fn new(options: &Options) -> Self {
        NoUnusedExpressions {
            config: Config::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Prologue<'a> {
        on.stmts([StmtTag::Expr], |rule, statement, cx| {
            let mut prologue = std::mem::take(&mut cx.state);
            check(rule.config, statement, &mut prologue, cx);
            cx.state = prologue;
        });
        Prologue::default()
    }
}
