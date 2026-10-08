use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_redeclare::{Config, check_globals_in_comments, check_symbol};

/// Disallow variable redeclaration.
pub struct NoRedeclare {
    config: Config,
}

impl Rule for NoRedeclare {
    const META: Meta = Meta::typescript("no-redeclare", Kind::Suggestion).extends_base_rule("no-redeclare");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoRedeclare {
            config: Config {
                builtin_globals: options.bool_or("builtinGlobals", true),
                ignore_declaration_merge: Some(options.bool_or("ignoreDeclarationMerge", true)),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.symbols(|rule, symbol, cx| check_symbol(rule.config, symbol, cx));
        on.finish(|rule, cx| check_globals_in_comments(rule.config, cx));
    }
}
