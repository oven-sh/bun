use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_loop_func::{Dialect, check, has_loops};

/// Disallow function declarations that contain unsafe references inside loop statements.
pub struct NoLoopFunc;

impl Rule for NoLoopFunc {
    const META: Meta = Meta::typescript("no-loop-func", Kind::Suggestion)
        .deprecated()
        .extends_base_rule("no-loop-func");
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLoopFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if has_loops(file) {
            on.funcs(|_, func, cx| check(func, Dialect::TypeScript, cx));
        }
    }
}
