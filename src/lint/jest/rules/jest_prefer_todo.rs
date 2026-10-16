use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::prefer_todo;
use bun_lint::prelude::*;

/// When test cases are empty then it is better to mark them as `test.todo` as it will be highlighted in the summary output.
pub struct PreferTodo<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferTodo<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-todo", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTodo
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_todo::run);
    }
}
