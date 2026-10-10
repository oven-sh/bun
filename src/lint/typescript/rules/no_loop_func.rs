use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_loop_func::{Dialect, Known, check, has_loops};

/// Disallow function declarations that contain unsafe references inside loop statements.
pub struct NoLoopFunc;

impl Rule for NoLoopFunc {
    const META: Meta = Meta::typescript("no-loop-func", Kind::Suggestion)
        .deprecated()
        .extends_base_rule("no-loop-func");
    const ON: On = On::new().funcs();
    type State<'a> = Known<'a>;

    fn new(_: &Options) -> Self {
        NoLoopFunc
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Known<'a>> {
        has_loops(file).then(Known::default)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check(func, Dialect::TypeScript, cx);
    }
}
