use crate::jest::{self, Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Runner};
use bun_lint::prelude::*;

/// This rule warns about usage of `.todo` in `describe`, `it`, or `test` functions.
pub struct WarnTodo<const RUNNER: u8 = { jest::VITEST }>;

const WARN_TODO: Message = Message::new("", "The use of `.todo` is not recommended.");

impl<const RUNNER: u8> Rule for WarnTodo<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "warn-todo", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        WarnTodo
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("todo") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    if let Some(parsed_vi_fn_call) = jest::parse_general_jest_fn_call(ctx.file, possible_jest_node)
        && matches!(parsed_vi_fn_call.kind, JestFnKind::General(JestGeneralFnKind::Describe | JestGeneralFnKind::Test))
        && let Some(modifier) = parsed_vi_fn_call.members.iter().find(|member| member.is_name_equal("todo"))
    {
        ctx.report(modifier.span, WARN_TODO);
    }
}
