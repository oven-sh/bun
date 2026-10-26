use crate::conditions::should_run;
use crate::reactive::{WITHOUT_RUNES, reactive_statement_of};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// don't assign literal values in reactive statements
pub struct NoReactiveLiterals;

const NO_REACTIVE_LITERALS: Message = Message::new(
    "noReactiveLiterals",
    "Do not assign literal values inside reactive statements unless absolutely necessary.",
);
const FIX_REACTIVE_LITERAL: Message = Message::new(
    "fixReactiveLiteral",
    "Move the literal out of the reactive statement into an assignment",
);

const SELECTOR: &str = r#"SvelteReactiveStatement > ExpressionStatement > AssignmentExpression:matches([right.type="Literal"],[right.type="ArrayExpression"][right.elements.length=0],[right.type="ObjectExpression"][right.properties.length=0])"#;

impl Rule for NoReactiveLiterals {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-reactive-literals", Kind::Suggestion).recommended()
        .has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Assign]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoReactiveLiterals
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.svelte().is_some() && should_run(file, WITHOUT_RUNES)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some((_, _, value)) = e.as_assign() else {
            return;
        };
        let is_literal = ast_utils::is_literal(value)
            || value.as_array().is_some_and(|it| it.is_empty())
            || value.as_object().is_some_and(|it| it.is_empty());
        if !is_literal {
            return;
        }
        let Some(reactive) = reactive_statement_of(e) else {
            return;
        };
        cx.report(reactive, NO_REACTIVE_LITERALS)
            .by_selector(SELECTOR)
            .suggest(FIX_REACTIVE_LITERAL, |fixer| {
                fixer.replace(reactive, [&b"let "[..], e.text()].concat())
            });
    }
}
