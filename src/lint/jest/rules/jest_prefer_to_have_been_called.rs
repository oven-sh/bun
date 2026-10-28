use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::jest::{self, Ctx, PossibleJestNode, Runner};
use bun_lint::prelude::*;

/// Suggests using `toHaveBeenCalled()` or `not.toHaveBeenCalled()` over `toHaveBeenCalledTimes(0)` or `toBeCalledTimes(0)`.
pub struct PreferToHaveBeenCalled<const RUNNER: u8 = { jest::JEST }>;

const PREFER_TO_HAVE_BEEN_CALLED: Message = Message::new("", "Prefer `toHaveBeenCalled()` over `toHaveBeenCalledTimes(0)`");

impl<const RUNNER: u8> Rule for PreferToHaveBeenCalled<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-to-have-been-called", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToHaveBeenCalled
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toHaveBeenCalledTimes", "toBeCalledTimes"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn is_zero_arg(expr: Expr) -> bool {
    match get_inner_expression(expr).kind() {
        ExprKind::Number(value) => value == 0.0,
        ExprKind::BigInt(value) => value.is("0"),
        _ => false,
    }
}

fn run<'a>(jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    let Some(parsed_expect_call) = jest::parse_expect_jest_fn_call(ctx.file, jest_node) else {
        return;
    };
    if let Some(matcher) = parsed_expect_call.matcher()
        && (matcher.is_name_equal("toHaveBeenCalledTimes") || matcher.is_name_equal("toBeCalledTimes"))
        && parsed_expect_call.args.first().is_some_and(is_zero_arg)
    {
        ctx.report(jest_node.node, PREFER_TO_HAVE_BEEN_CALLED).fix(|fixer| {
            let call_end = jest_node.node.span().end;
            match parsed_expect_call.modifiers().find(|modifier| modifier.is_name_equal("not")) {
                Some(not_modifier) => fixer.replace(Span::new(not_modifier.span.start, call_end), "toHaveBeenCalled()"),
                None => fixer.replace(Span::new(matcher.span.start, call_end), "not.toHaveBeenCalled()"),
            }
        });
    }
}
