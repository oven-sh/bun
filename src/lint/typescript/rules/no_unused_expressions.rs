use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_unused_expressions::{Config, check};

/// Disallow unused expressions.
pub struct NoUnusedExpressions {
    config: Config,
}

impl Rule for NoUnusedExpressions {
    const META: Meta = Meta::typescript("no-unused-expressions", Kind::Suggestion)
        .recommended()
        .extends_base_rule("no-unused-expressions");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnusedExpressions {
            config: Config::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Expr], |rule, statement, cx| check(rule.config, statement, cx));
    }
}
