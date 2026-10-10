use crate::jest::{self, Ctx};
use crate::jest_tests::prefer_todo;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// When test cases are empty then it is better to mark them as `test.todo` as it will be highlighted in the summary output.
pub struct PreferTodo;

impl Rule for PreferTodo {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-todo", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTodo
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_todo::run);
    }
}
