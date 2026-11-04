mod element;
mod props;

use bun_sema::hir::{self, ExprId, JsxId, PropId};
use bun_sema::import_sites::{JsxCallee, JsxImport, find_key_attribute};

#[derive(Copy, Clone, Debug)]
struct Element {
    expression: ExprId,
    jsx: JsxId,
    position: u32,
    key: Option<PropId>,
}

// The attribute that the callee takes as an argument of its own, which is evaluated behind the other attributes and the children.
pub(in crate::lower) fn find_key_argument(
    hir: &hir::File<'_>,
    callee: JsxCallee,
    jsx: JsxId,
) -> Option<PropId> {
    match callee {
        JsxCallee::Factory | JsxCallee::Import(JsxImport::CreateElement) => None,
        JsxCallee::Import(
            JsxImport::Jsx | JsxImport::Jsxs | JsxImport::JsxDev | JsxImport::Fragment,
        ) => find_key_attribute(hir, jsx).key,
    }
}
