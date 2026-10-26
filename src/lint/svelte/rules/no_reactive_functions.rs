use crate::conditions::should_run;
use crate::reactive::{WITHOUT_RUNES, reactive_statement_of};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// it's not necessary to define functions in reactive statements
pub struct NoReactiveFunctions;

const NO_REACTIVE_FNS: Message = Message::new(
    "noReactiveFns",
    "Do not create functions inside reactive statements unless absolutely necessary.",
);
const FIX_REACTIVE_FNS: Message =
    Message::new("fixReactiveFns", "Move the function out of the reactive statement");

impl Rule for NoReactiveFunctions {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-reactive-functions", Kind::Suggestion).recommended()
        .has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Fn]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoReactiveFunctions
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.svelte().is_some() && should_run(file, WITHOUT_RUNES)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(assignment) = e.parent() else {
            return;
        };
        if assignment.as_assign().is_none_or(|(_, _, value)| value != e) {
            return;
        }
        let Some(reactive) = reactive_statement_of(assignment) else {
            return;
        };
        // The suggestion calls `sourceCode.isSpaceBetweenTokens`, which ESLint 10 removed, so ESLint throws when it
        // reports.
        if cx.language().eslint_major >= 10 {
            cx.throw(e, "TypeError", "source.isSpaceBetweenTokens is not a function");
            return;
        }
        let file = cx.file();
        cx.report(reactive, NO_REACTIVE_FNS)
            .by_selector("SvelteReactiveStatement > ExpressionStatement > AssignmentExpression > :function")
            .suggest(FIX_REACTIVE_FNS, |fixer| {
                let mut tokens = file.tokens_in(reactive);
                let (Some(label), Some(colon), Some(next)) = (tokens.next(), tokens.next(), tokens.next())
                else {
                    return None;
                };
                let text = match file.is_space_between(colon, next) {
                    true => "const",
                    false => "const ",
                };
                Some(fixer.replace(Span::new(label.start(), colon.end()), text))
            });
    }
}
