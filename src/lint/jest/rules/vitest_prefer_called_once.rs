use crate::jest::{self, Ctx, MemberExpressionElement, PossibleJestNode, Runner};
use bun_lint_oxlint::text::find_next_token_within;
use bun_lint::prelude::*;

/// Substitute `toBeCalledTimes(1)` and `toHaveBeenCalledTimes(1)` with `toBeCalledOnce()` and `toHaveBeenCalledOnce()`
/// respectively.
pub struct PreferCalledOnce<const RUNNER: u8 = { jest::VITEST }>;

const PREFER_CALLED_ONCE: Message =
    Message::new("", "The use of `toBeCalledTimes(1)` and `toHaveBeenCalledTimes(1)` is discouraged.");

const MATCHERS: [&str; 2] = ["toBeCalledTimes", "toHaveBeenCalledTimes"];

impl<const RUNNER: u8> Rule for PreferCalledOnce<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-called-once", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledOnce
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(MATCHERS) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &run);
    }
}

fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
    let call_end = possible_jest_node.node.span().end;
    let Some(parsed_expect) = jest::parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
        return;
    };
    if let Some(arguments) = parsed_expect.matcher_arguments
        && arguments.len() == 1
        && let Some(called_times_value) = arguments.first()
        && called_times_value.tag() == ExprTag::Number
        && called_times_value.text() == b"1"
        && !called_times_value.is_parenthesized()
        && let Some(matcher_to_be_fixed) =
            parsed_expect.members.iter().find(|member| MATCHERS.iter().any(|it| member.is_name_equal(it)))
    {
        let matcher_span = matcher_to_be_fixed.span;
        // Without `Times`. Bun has no `toBeCalledOnce`.
        let without_suffix = match ctx.runner {
            Runner::Bun if matches!(matcher_to_be_fixed.element, MemberExpressionElement::IdentName(_)) => b"toHaveBeenCalled".as_slice(),
            _ => ctx.file.slice(Span::new(matcher_span.start, matcher_span.end.saturating_sub(5))),
        };
        let report = ctx.report(Span::new(matcher_span.start, call_end), PREFER_CALLED_ONCE);
        report.data("without_suffix", without_suffix).fix(|fixer| {
            let file = fixer.file();
            let comma = find_next_token_within(file, Span::after(called_times_value.span(), call_end), b",");
            let mut fixes = vec![
                fixer.replace(matcher_span, [without_suffix, b"Once".as_slice()].concat()),
                fixer.remove(called_times_value),
            ];
            fixes.extend(comma.map(|at| fixer.remove(Span::new(at, at + 1))));
            fixes
        });
    }
}
