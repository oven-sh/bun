use crate::jest::{self, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using `toBe(true)` and `toBe(false)` over matchers that coerce types to boolean.
pub struct PreferStrictBooleanMatchers;

const PREFER_STRICT_BOOLEAN_MATCHERS: Message = Message::new("", "Use `toBe({{value}})` instead of `{{matcher_name}}`.");

impl Rule for PreferStrictBooleanMatchers {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-strict-boolean-matchers", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStrictBooleanMatchers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions_any(&["toBeTruthy", "toBeFalsy"]) {
            on.finish(|_, cx| jest::iter_possible_jest_call_node(cx.file()).for_each(|node| run(node, cx)));
        }
    }
}

fn run<'a>(possible_vitest_node: PossibleJestNode<'a>, cx: &Cx<'a, PreferStrictBooleanMatchers>) {
    let Some(vitest_expect_fn_call) = jest::parse_expect_and_typeof_vitest_fn_call(cx.file(), possible_vitest_node) else {
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
    cx.report(span, PREFER_STRICT_BOOLEAN_MATCHERS).data("value", value).data("matcher_name", matcher_name).fix(|fixer| {
        let call_name = if parent.tag() == ExprTag::Index { "\"toBe\"]" } else { "toBe" };
        fixer.replace(span, format!("{call_name}({value})"))
    });
}
