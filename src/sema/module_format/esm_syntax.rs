use super::EsmSyntax;
use crate::file_analysis::has_live_top_level_await;
use crate::fold::Decisions;
use crate::hir::{Expr, ExprKind, File, StmtId, StmtKind};

pub(crate) fn statement_esm_syntax(hir: &File<'_>, stmt: StmtId) -> EsmSyntax {
    if hir.is_export_declaration(stmt) {
        return EsmSyntax::ExportOrTopLevelAwait;
    }
    let is_import = matches!(hir[stmt].kind, StmtKind::Import(_));
    if !is_import || hir.is_in_jsdoc(hir[stmt].start) {
        return EsmSyntax::None;
    }
    EsmSyntax::ImportOrImportMeta
}

pub(crate) fn file_esm_syntax(hir: &File<'_>) -> EsmSyntax {
    if has_live_top_level_await(hir, &Decisions::default()) {
        return EsmSyntax::ExportOrTopLevelAwait;
    }
    let statements = hir
        .ids(hir.body)
        .map(|stmt| statement_esm_syntax(hir, stmt));
    let strongest = statements.max().unwrap_or(EsmSyntax::None);
    let is_import_meta = |expr: &Expr| matches!(expr.kind, ExprKind::ImportMeta);
    if strongest == EsmSyntax::None && hir.exprs.iter().any(is_import_meta) {
        return EsmSyntax::ImportOrImportMeta;
    }
    strongest
}
