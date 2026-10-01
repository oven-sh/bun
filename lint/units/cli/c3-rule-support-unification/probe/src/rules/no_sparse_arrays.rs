//! ESLint: lib/rules/no-sparse-arrays.js
use crate::context::Context;
use bun_ast::E;
use bun_ast::expr::Data as ExprData;

const NAME: &str = "no-sparse-arrays";

pub(crate) fn e_array(cx: &mut Context<'_, '_>, node: &E::Array, is_target: bool) {
    // A hole in a pattern skips an element.
    if is_target {
        return;
    }
    for item in node.items.iter() {
        // The hole is where its comma is.
        if matches!(item.data, ExprData::EMissing(_)) {
            cx.report(NAME, item.loc, format_args!("Unexpected comma in middle of array."));
        }
    }
}
