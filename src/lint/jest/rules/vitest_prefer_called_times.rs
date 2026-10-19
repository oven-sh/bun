use crate::jest::{self, Ctx, PossibleJestNode, Runner};
use bun_lint::prelude::*;

/// This rule aims to enforce the use of `toBeCalledTimes(1)` or `toHaveBeenCalledTimes(1)` over `toBeCalledOnce()` or
/// `toHaveBeenCalledOnce()`.
pub struct PreferCalledTimes<const RUNNER: u8 = { jest::VITEST }>;

const PREFER_CALLED_TIMES: Message = Message::new(
    "",
    "Use `toBeCalledTimes(1)` or `toHaveBeenCalledTimes(1)` instead of `toBeCalledOnce()` or `toHaveBeenCalledOnce()`",
);

impl<const RUNNER: u8> Rule for PreferCalledTimes<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-called-times", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledTimes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toBeCalledOnce", "toHaveBeenCalledOnce"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn run<'a>(jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    let Some(parsed_expect_call) = jest::parse_expect_jest_fn_call(ctx.file, jest_node) else {
        return;
    };
    let method_text = match parsed_expect_call.matcher().and_then(|it| it.name()) {
        Some(b"toBeCalledOnce") => "toBeCalledTimes",
        Some(b"toHaveBeenCalledOnce") => "toHaveBeenCalledTimes",
        _ => return,
    };
    ctx.report(jest_node.node, PREFER_CALLED_TIMES).fix(|fixer| {
        let file = fixer.file();
        let expect_argument = parsed_expect_call.expect_arguments.and_then(List::first);
        let (expect, rest) = parsed_expect_call.around_first_argument(ctx.runner);
        let mut code = [expect, b"(".as_slice(), expect_argument.map_or(b"".as_slice(), |it| file.slice(it.outer_span())), rest].concat();
        for modifier in parsed_expect_call.modifiers() {
            code.push(b'.');
            code.extend_from_slice(file.slice(modifier.span));
        }
        code.push(b'.');
        code.extend_from_slice(method_text.as_bytes());
        code.extend_from_slice(b"(1)");
        fixer.replace(jest_node.node, code)
    });
}
