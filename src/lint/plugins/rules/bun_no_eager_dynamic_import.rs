use crate::bun::{RunsLater, runs_while_module_is_evaluated};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `import()` that runs while the module is evaluated.
///
/// Not the `import()` by which Vitest is told which module to mock: see `vi.mock()` in its API reference.
pub struct NoEagerDynamicImport;

const EAGER_IMPORT: Message = Message::new(
    "eagerImport",
    "This `import()` starts to load as soon as the module is evaluated. Call it where the module is first needed, or write an `import` statement.",
);

/// `vi.mock(e)`, `vi.doMock(e, factory)`, `vi.unmock(e)`, `vi.doUnmock(e)`
fn names_a_module_for_vitest(e: Expr) -> bool {
    e.parent().as_expr().and_then(Expr::as_call).is_some_and(|call| {
        call.args().first() == Some(e)
            && matches!(call.callee().kind(), ExprKind::Dot { obj, name, .. }
                if obj.is_ident("vi") && name.name().is_any(&["mock", "doMock", "unmock", "doUnmock"]))
    })
}

impl Rule for NoEagerDynamicImport {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-eager-dynamic-import", Kind::Suggestion);
    type State<'a> = RunsLater<'a>;

    fn new(_: &Options) -> Self {
        NoEagerDynamicImport
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> RunsLater<'a> {
        on.exprs([ExprTag::ImportCall], |_, e, cx| {
            if !names_a_module_for_vitest(e) && runs_while_module_is_evaluated(Node::Expr(e), &mut cx.state) {
                cx.report(e, EAGER_IMPORT);
            }
        });
        RunsLater::default()
    }
}
