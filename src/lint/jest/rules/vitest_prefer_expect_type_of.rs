use crate::jest::{self, Ctx, MemberExpressionElement, PossibleJestNode, Runner};
use bun_lint::prelude::*;

/// Enforce using `toBeTypeOf` instead of `expect(typeof ...).toBe(...)`.
pub struct PreferExpectTypeOf<const RUNNER: u8 = { jest::VITEST }>;

const PREFER_EXPECT_TYPE_OF: Message = Message::new("", "Type assertions should be done using `toBeTypeOf`.");
/// Without the page of Vitest about it.
const PREFER_EXPECT_TYPE_OF_IN_BUN: Message = Message::new("", "Type assertions should be done using `toBeTypeOf()`.");

impl<const RUNNER: u8> Rule for PreferExpectTypeOf<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-expect-type-of", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExpectTypeOf
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file, RUNNER) && file.has_exprs([ExprTag::Unary])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    let Some(expect_call) = jest::parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
        return;
    };
    if let Some(typeof_expression) = expect_call.expect_arguments.and_then(List::first)
        && let ExprKind::Unary { op: UnOp::Typeof, operand } = typeof_expression.kind()
        && !typeof_expression.is_parenthesized()
        && expect_call.matcher().is_some_and(|it| it.is_name_equal("toBe") || it.is_name_equal("toEqual"))
        && let Some(type_expected) = expect_call.matcher_arguments.and_then(List::first)
        && type_expected.tag() != ExprTag::Spread
    {
        let file = ctx.file;
        let (expect, rest) = expect_call.around_first_argument(ctx.runner);
        let mut code = [expect, b"(".as_slice(), file.slice(operand.outer_span()), rest].concat();
        for modifier in expect_call.modifiers() {
            let (open, close) = match modifier.element {
                MemberExpressionElement::IdentName(_) => (".", ""),
                MemberExpressionElement::Expression(_) => ("[", "]"),
            };
            code.extend_from_slice(open.as_bytes());
            code.extend_from_slice(file.slice(modifier.span));
            code.extend_from_slice(close.as_bytes());
        }
        code.extend_from_slice(b".toBeTypeOf(");
        code.extend_from_slice(file.slice(type_expected.outer_span()));
        code.push(b')');
        let report = match ctx.runner {
            Runner::Bun => (ctx.report(possible_jest_node.node, PREFER_EXPECT_TYPE_OF_IN_BUN))
                .help_with(|| format!("Substitute the assertion with `{}`.", std::str::from_utf8(&code).unwrap_or_default())),
            Runner::Jest | Runner::Vitest => ctx.report(possible_jest_node.node, PREFER_EXPECT_TYPE_OF).data("code", code.clone()),
        };
        report.fix(|fixer| fixer.replace(possible_jest_node.node, code));
    }
}
