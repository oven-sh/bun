mod element;
mod props;

use bun_sema::hir::{ExprId, JsxId, PropId};

#[derive(Copy, Clone, Debug)]
struct Element {
    expression: ExprId,
    jsx: JsxId,
    position: u32,
    key: Option<PropId>,
}
