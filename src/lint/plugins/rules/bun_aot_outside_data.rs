use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Report `as` on a value of type `any` or `unknown` that comes from outside the typed code of the program.
pub struct AotOutsideData;

const ENTERS: Message = Message::new(
    "enters",
    "Data from {{origin}} is cast to `{{type}}` without a check. Under `--aot`, reading a property that does not match throws a `TypeError`, often far from here.",
);

impl Rule for AotOutsideData {
    const META: Meta = Meta::plugin(Plugin::Bun, "aot-outside-data", Kind::Suggestion)
        .requires_types()
        .hints();
    const ON: On = On::new().exprs(&[ExprTag::As]);
    no_state!();

    fn new(_: &Options) -> Self {
        AotOutsideData
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(found) = node.ts_node().aot_check_external_data_inflow() else {
            return;
        };
        cx.report(node, ENTERS)
            .data("type", found.type_text)
            .data("origin", found.origin)
            .hint("Validate it here, once, and build a typed value from it.");
    }
}
