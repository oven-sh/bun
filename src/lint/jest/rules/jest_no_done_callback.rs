use crate::jest::{self, Arguments, Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Runner};
use bun_lint::prelude::*;

/// This rule checks the function parameter of hooks & tests for use of the done argument, suggesting you return a promise
/// instead.
pub struct NoDoneCallback<const RUNNER: u8 = { jest::JEST }>;

const NO_DONE_CALLBACK: Message = Message::new("", "Function parameter(s) use the `done` argument");

impl<const RUNNER: u8> Rule for NoDoneCallback<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-done-callback", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDoneCallback
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    let Some(call_expr) = possible_jest_node.node.as_call() else {
        return;
    };
    let Some(jest_fn_call) = jest::parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
        return;
    };
    if !matches!(jest_fn_call.kind, JestFnKind::General(JestGeneralFnKind::Test | JestGeneralFnKind::Hook)) {
        return;
    }
    // With Bun other modifiers can follow: `test.each(a).if(b)(..)`.
    let is_jest_each = match ctx.runner {
        Runner::Bun => jest_fn_call.members.iter().any(|it| it.is_name_equal("each")),
        Runner::Jest | Runner::Vitest => jest::get_node_name_vec(call_expr.callee()).last().is_some_and(|it| it.ends_with(b"each")),
    };
    let arguments = call_expr.args();
    let callback = match jest_fn_call.kind {
        // Of `.each` only the one with a template is looked at: its callback gets one object before `done`.
        JestFnKind::General(JestGeneralFnKind::Test | JestGeneralFnKind::Hook) if is_jest_each => {
            if call_expr.callee().tag() != ExprTag::TaggedTemplate {
                return;
            }
            Arguments::of(arguments, ctx.runner).callback
        }
        JestFnKind::General(JestGeneralFnKind::Hook) if ctx.runner != Runner::Bun => arguments.first(),
        JestFnKind::General(JestGeneralFnKind::Hook | JestGeneralFnKind::Test) => Arguments::of(arguments, ctx.runner).callback,
        _ => return,
    };
    if let Some(arg) = callback.filter(|it| !it.is_parenthesized())
        && let Some(func) = arg.as_fn()
        && func.params().len() == 1 + usize::from(is_jest_each)
        && let Some(first_parameter) = func.params().first()
    {
        ctx.report(first_parameter, NO_DONE_CALLBACK).help(match func.is_async() {
            true => "Use await instead of callback in async functions",
            false => "Return a Promise instead of relying on callback parameter",
        });
    }
}
