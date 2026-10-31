use super::main_module::find_main_module_comparison;
use super::this_of_file::has_live_this_of_file;
use super::{
    CommonJsEvidence, EsmSyntax, FormatByDeclaredType, FormatDecision, ModuleFormat,
    file_esm_syntax, statement_esm_syntax,
};
use crate::bind::{Binding, Bound, CommonJsVariable, Parent};
use crate::file_analysis::has_written_top_level_await;
use crate::fold::{Decisions, FoldError, FoldErrorKind};
use crate::hir::{
    ExprId, File, FnBody, NodeData, StmtId, StmtKind, find_transpiled_mark, is_marked_as_commonjs,
};
use crate::import_sites::{ImportScan, is_runtime_import};

#[derive(Default)]
struct VariableUses {
    evidence: CommonJsEvidence,
    uses_require_or_path: bool,
}

/// `bun run` loads a file that it hands to the engine as written by what the mark says, whatever the file's name, its package and its text say.
pub(crate) fn find_marked_format(text: &[u8]) -> Option<ModuleFormat> {
    let mark = find_transpiled_mark(text)?;
    Some(match is_marked_as_commonjs(&text[mark]) {
        true => ModuleFormat::CommonJs,
        false => ModuleFormat::Esm,
    })
}

pub(crate) fn decide_module_format(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    scan: &ImportScan<'_>,
) -> FormatDecision {
    if let Some(format) = find_marked_format(&hir.text) {
        return FormatDecision {
            formats: FormatByDeclaredType::decided_by_text(format),
            error: None,
        };
    }
    let is_export = |stmt| statement_esm_syntax(hir, stmt) == EsmSyntax::ExportOrTopLevelAwait;
    if has_written_top_level_await(hir) || hir.ids(hir.body).any(is_export) {
        return FormatDecision {
            formats: FormatByDeclaredType::decided_by_text(ModuleFormat::Esm),
            error: None,
        };
    }
    let uses = find_variable_uses(hir, bound, decisions, scan);
    let evidence = uses.evidence
        | find_redeclared_variable_evidence(hir, bound, decisions)
        | find_statement_evidence(hir, bound, decisions);
    if !evidence.is_empty() {
        let error = scan.first_runtime_import.map(|import| FoldError {
            kind: FoldErrorKind::ImportStatementInCommonJs(evidence),
            node: NodeData::Stmt(hir[import].stmt),
        });
        return FormatDecision {
            formats: FormatByDeclaredType::decided_by_text(ModuleFormat::CommonJs),
            error,
        };
    }
    let has_weak_evidence = uses.uses_require_or_path
        || scan.has_import_equals_require
        || hir.has_use_strict_directive(FnBody::Block(hir.body));
    let formats = FormatByDeclaredType {
        esm: ModuleFormat::Esm,
        commonjs: match file_esm_syntax(hir) {
            EsmSyntax::None => ModuleFormat::CommonJs,
            _ => ModuleFormat::Esm,
        },
        unknown: match has_weak_evidence && !has_runtime_import_statement(hir) {
            true => ModuleFormat::CommonJs,
            false => ModuleFormat::Esm,
        },
    };
    FormatDecision {
        formats,
        error: None,
    }
}

fn find_variable_uses(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    scan: &ImportScan<'_>,
) -> VariableUses {
    let mut uses = VariableUses::default();
    for &(ident, binding) in bound.ident_bindings() {
        let Binding::CommonJs(variable) = binding else {
            continue;
        };
        let is_live = !decisions.is_dead_expr(ident);
        match variable {
            CommonJsVariable::Module => {
                if let Some(comparison) = find_main_module_comparison(hir, bound, ident) {
                    uses.uses_require_or_path |= !decisions.is_dead_expr(comparison);
                } else if is_live && scan.module_require_objects.binary_search(&ident).is_err() {
                    uses.evidence |= CommonJsEvidence::MODULE;
                }
            }
            CommonJsVariable::Exports => {
                if is_live {
                    uses.evidence |= CommonJsEvidence::EXPORTS;
                }
            }
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {
                uses.uses_require_or_path |= is_live;
            }
        }
    }
    uses
}

fn find_redeclared_variable_evidence(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> CommonJsEvidence {
    let redeclared = bound.runtime.redeclared_commonjs_variables();
    let mut evidence = CommonJsEvidence::empty();
    if redeclared.is_empty() || file_esm_syntax(hir) != EsmSyntax::None {
        return evidence;
    }
    for index in 0..hir.exprs.len() {
        let ident = ExprId(index as u32);
        if !bound.is_evaluated_ident(ident) || decisions.is_dead_expr(ident) {
            continue;
        }
        let Binding::Symbol(symbol) = bound.binding(ident) else {
            continue;
        };
        let Ok(found) = redeclared.binary_search_by_key(&symbol, |entry| entry.0) else {
            continue;
        };
        match redeclared[found].1 {
            CommonJsVariable::Module => evidence |= CommonJsEvidence::MODULE,
            CommonJsVariable::Exports => evidence |= CommonJsEvidence::EXPORTS,
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {}
        }
    }
    evidence
}

fn find_statement_evidence(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> CommonJsEvidence {
    let mut evidence = CommonJsEvidence::empty();
    if has_live_export_assignment(hir, decisions) {
        evidence |= CommonJsEvidence::MODULE;
    }
    if has_with_statement(hir, bound) {
        evidence |= CommonJsEvidence::WITH_STATEMENT;
    }
    if file_esm_syntax(hir) == EsmSyntax::None && has_live_this_of_file(hir, decisions) {
        evidence |= CommonJsEvidence::EXPORTS;
    }
    evidence
}

fn has_with_statement(hir: &File<'_>, bound: &Bound<'_>) -> bool {
    hir.stmts.iter().enumerate().any(|(index, statement)| {
        matches!(statement.kind, StmtKind::With { .. })
            && bound.parent_of_stmt(StmtId(index as u32)) != Parent::None
    })
}

fn has_live_export_assignment(hir: &File<'_>, decisions: &Decisions<'_>) -> bool {
    hir.ids(hir.body).any(|stmt| {
        matches!(hir[stmt].kind, StmtKind::ExportAssign(_)) && !decisions.is_dead_stmt(stmt)
    })
}

fn has_runtime_import_statement(hir: &File<'_>) -> bool {
    hir.ids(hir.body).any(
        |stmt| matches!(hir[stmt].kind, StmtKind::Import(import) if is_runtime_import(hir, import)),
    )
}
