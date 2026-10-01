//! Where nodes end. The tree only says where they start, so the end of a node is worked out from its parts and the source text, and
//! only for a node an error is reported on.

use super::Checker;
use crate::hir::{ExprId, PatId, StmtId, TypeNodeId};
use crate::program::FileId;

impl Checker<'_> {
    /// `node.End()` of the expression `e`.
    pub fn end_of_expr(&self, file: FileId, e: ExprId) -> u32 {
        super::explain::end_of_token(&self.hir(file).text, self.hir(file)[e].pos)
    }

    /// `node.End()` of the type node `node`.
    pub fn end_of_type_node(&self, file: FileId, node: TypeNodeId) -> u32 {
        super::explain::end_of_token(&self.hir(file).text, self.hir(file)[node].pos)
    }

    /// `node.End()` of the binding name or pattern `pat`.
    pub fn end_of_pat(&self, file: FileId, pat: PatId) -> u32 {
        super::explain::end_of_token(&self.hir(file).text, self.hir(file)[pat].pos)
    }

    /// `node.End()` of the statement `s`.
    pub fn end_of_stmt(&self, file: FileId, s: StmtId) -> u32 {
        super::explain::end_of_token(&self.hir(file).text, self.hir(file)[s].pos)
    }
}
