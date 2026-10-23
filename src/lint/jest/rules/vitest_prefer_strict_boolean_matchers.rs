use crate::jest::{self, Ctx, PossibleJestNode, Runner};
use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce using `toBe(true)` and `toBe(false)` over matchers that coerce types to boolean.
pub struct PreferStrictBooleanMatchers<const RUNNER: u8 = { jest::VITEST }>;

const PREFER_STRICT_BOOLEAN_MATCHERS: Message = Message::new("", "Use `toBe({{value}})` instead of `{{matcher_name}}`.");
const USE: Message = Message::new("", "Use `{{code}}`");

impl<const RUNNER: u8> Rule for PreferStrictBooleanMatchers<RUNNER> {
    const META: Meta = jest::meta_with_risky_fix(RUNNER, "prefer-strict-boolean-matchers", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStrictBooleanMatchers
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_any(file, &const { jest::mention_bits(["expect", "expectTypeOf"]) }) && jest::mentions_any(file, &const { jest::mention_bits(["toBeTruthy", "toBeFalsy"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn run<'a>(possible_vitest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    let Some(vitest_expect_fn_call) = jest::parse_expect_and_typeof_vitest_fn_call(ctx.file, possible_vitest_node) else {
        return;
    };
    let Some(matcher) = vitest_expect_fn_call.matcher() else {
        return;
    };
    let (matcher_name, value) = match matcher.name() {
        Some(b"toBeTruthy") => ("toBeTruthy", "true"),
        Some(b"toBeFalsy") => ("toBeFalsy", "false"),
        _ => return,
    };
    let Some(parent) = matcher.parent else {
        return;
    };
    let span = Span::new(matcher.span.start, possible_vitest_node.node.span().end);
    // `.not.toBe(true)` would pass for everything but `true`.
    if ctx.runner == Runner::Bun
        && let Some(not) = vitest_expect_fn_call.modifiers().find(|it| it.is_name_equal("not"))
    {
        let (matcher_name, value) = if value == "true" { ("not.toBeTruthy", "false") } else { ("not.toBeFalsy", "true") };
        let report = ctx.report(span, PREFER_STRICT_BOOLEAN_MATCHERS).data("value", value).data("matcher_name", matcher_name);
        if strings::trim(ctx.file.slice(not.span.between(matcher.span)), b" \t\r\n") == b"." {
            ctx.risky_fix(report, USE, not.span.to(span), format!("toBe({value})"));
        }
        return;
    }
    let report = ctx.report(span, PREFER_STRICT_BOOLEAN_MATCHERS).data("value", value).data("matcher_name", matcher_name);
    let call_name = if parent.tag() == ExprTag::Index { "\"toBe\"]" } else { "toBe" };
    ctx.risky_fix(report, USE, span, format!("{call_name}({value})"));
}
