use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_redeclare::{Config, can_redeclare_globals, check_globals_in_comments, check_symbol};

/// Disallow variable redeclaration.
pub struct NoRedeclare {
    config: Config,
}

impl Rule for NoRedeclare {
    const META: Meta = Meta::typescript("no-redeclare", Kind::Suggestion).extends_base_rule("no-redeclare").hints();
    const ON: On = On::new().symbols().finish();
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoRedeclare {
            config: Config {
                builtin_globals: options.bool_or("builtinGlobals", true),
                ignore_declaration_merge: Some(options.bool_or("ignoreDeclarationMerge", true)),
            },
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        Some(can_redeclare_globals(self.config, file))
    }

    fn symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        check_symbol(self.config, symbol, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        check_globals_in_comments(self.config, cx);
    }
}
