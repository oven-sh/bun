use super::main_module::find_main_module_comparison;
use super::this_of_file::has_live_this_of_file;
use super::{
    CommonJsEvidence, EsmSyntax, FormatByDeclaredType, FormatDecision, ModuleFormat,
    file_esm_syntax, statement_esm_syntax,
};
use crate::bind::{Binding, Bound, CommonJsVariable, Decl, Parent, SymbolId};
use crate::file_analysis::has_written_top_level_await;
use crate::fold::{Decisions, FoldError, FoldErrorKind};
use crate::hir::{
    ExprId, File, Flags, FnBody, NodeData, PatId, PatKind, StmtId, StmtKind, VarKind,
    find_transpiled_mark, is_marked_as_commonjs,
};
use crate::import_sites::{ImportScan, is_runtime_import};

#[derive(Default)]
struct VariableUses {
    evidence: CommonJsEvidence,
    uses_require_or_path: bool,
}

pub(crate) fn find_marked_format(text: &[u8]) -> Option<ModuleFormat> {
    let mark = find_transpiled_mark(text)?;
    Some(match is_marked_as_commonjs(&text[mark]) {
        true => ModuleFormat::CommonJs,
        false => ModuleFormat::Esm,
    })
}

pub(crate) fn find_format_by_syntax(hir: &File<'_>) -> Option<ModuleFormat> {
    if let Some(format) = find_marked_format(&hir.text) {
        return Some(format);
    }
    let is_export = |stmt| statement_esm_syntax(hir, stmt) == EsmSyntax::ExportOrTopLevelAwait;
    (has_written_top_level_await(hir) || hir.ids(hir.body).any(is_export))
        .then_some(ModuleFormat::Esm)
}

pub(crate) fn decide_module_format(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    scan: &ImportScan<'_>,
) -> FormatDecision {
    if let Some(format) = find_format_by_syntax(hir) {
        return FormatDecision {
            formats: FormatByDeclaredType::decided_by_text(format),
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
    if file_esm_syntax(hir) == EsmSyntax::None && has_live_this_of_file(hir, decisions) {
        return FormatDecision {
            formats: FormatByDeclaredType::decided_by_text(ModuleFormat::CommonJs),
            error: None,
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
    let declaring = find_scopes_that_declare(hir, bound, decisions, redeclared);
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
        if bound.is_appended_symbol(symbol) {
            continue;
        }
        let around = (declaring.iter().rev())
            .find(|it| it.symbol == symbol && (it.start..it.end).contains(&hir[ident].pos));
        if around.is_none_or(|it| it.is_taken_for_variable_of_file) {
            evidence |= evidence_of(redeclared[found].1);
        }
    }
    for scope in declaring {
        if scope.is_taken_for_variable_of_file && scope.has_live_declaration {
            evidence |= evidence_of(scope.variable);
        }
    }
    evidence
}

fn evidence_of(variable: CommonJsVariable) -> CommonJsEvidence {
    match variable {
        CommonJsVariable::Module => CommonJsEvidence::MODULE,
        CommonJsVariable::Exports => CommonJsEvidence::EXPORTS,
        CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {
            CommonJsEvidence::empty()
        }
    }
}

struct DeclaringScope {
    symbol: SymbolId,
    variable: CommonJsVariable,
    start: u32,
    end: u32,
    has_live_declaration: bool,
    is_taken_for_variable_of_file: bool,
}

fn find_scopes_that_declare(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    redeclared: &[(SymbolId, CommonJsVariable)],
) -> Vec<DeclaringScope> {
    let mut scopes: Vec<DeclaringScope> = Vec::new();
    let mut declared_at_top: Vec<SymbolId> = (redeclared.iter().map(|it| it.0))
        .filter(|&symbol| {
            let mut declarations = bound.symbol(symbol).decls.iter();
            declarations.any(|it| !matches!(it, Decl::Var(_)))
        })
        .collect();
    for (index, declaration) in hir.var_decls.iter().enumerate() {
        let statement = bound.var_stmt[index];
        let is_variable = declaration.kind == VarKind::Var
            && !declaration.flags.contains(Flags::AMBIENT)
            && statement.is_some();
        if !is_variable {
            continue;
        }
        for &(symbol, variable) in redeclared {
            if !declares(hir, bound, declaration.pat, symbol) {
                continue;
            }
            let Some(scope) = find_scope_below_file(hir, bound, statement) else {
                declared_at_top.push(symbol);
                continue;
            };
            let (start, is_live) = (hir[scope].start, !decisions.is_dead_stmt(statement));
            match scopes
                .iter_mut()
                .find(|it| it.symbol == symbol && it.start == start)
            {
                Some(known) => known.has_live_declaration |= is_live,
                None => scopes.push(DeclaringScope {
                    symbol,
                    variable,
                    start,
                    end: hir[scope].loc.end,
                    has_live_declaration: is_live,
                    is_taken_for_variable_of_file: false,
                }),
            }
        }
    }
    scopes.sort_by_key(|it| it.start);
    for &(symbol, _) in redeclared {
        if !declared_at_top.contains(&symbol)
            && let Some(first) = scopes.iter_mut().find(|it| it.symbol == symbol)
        {
            first.is_taken_for_variable_of_file = true;
        }
    }
    scopes
}

fn find_scope_below_file(
    hir: &File<'_>,
    bound: &Bound<'_>,
    mut statement: StmtId,
) -> Option<StmtId> {
    loop {
        let parent = match bound.parent_of_stmt(statement) {
            Parent::Stmt(parent) => parent,
            Parent::Case(case) => return Some(bound.case_stmt[case.idx()]),
            _ => return None,
        };
        match hir[parent].kind {
            StmtKind::If { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } => {
                statement = parent;
            }
            _ => return Some(parent),
        }
    }
}

fn declares(hir: &File<'_>, bound: &Bound<'_>, pattern: PatId, symbol: SymbolId) -> bool {
    match hir[pattern].kind {
        PatKind::Missing => false,
        PatKind::Ident(_) => bound.declared_symbol(Decl::Var(pattern)) == symbol,
        PatKind::Object(props) => {
            (props.iter()).any(|prop| declares(hir, bound, hir[prop].value, symbol))
        }
        PatKind::Array(elements) => {
            (elements.iter()).any(|element| declares(hir, bound, hir[element].pat, symbol))
        }
    }
}

fn find_statement_evidence(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> CommonJsEvidence {
    let mut evidence = CommonJsEvidence::empty();
    if has_live_export_assignment(hir, bound, decisions) {
        evidence |= CommonJsEvidence::MODULE;
    }
    if has_with_statement(hir, bound) {
        evidence |= CommonJsEvidence::WITH_STATEMENT;
    }
    evidence
}

fn has_with_statement(hir: &File<'_>, bound: &Bound<'_>) -> bool {
    hir.stmts.iter().enumerate().any(|(index, statement)| {
        matches!(statement.kind, StmtKind::With { .. })
            && bound.parent_of_stmt(StmtId(index as u32)) != Parent::None
    })
}

fn has_live_export_assignment(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> bool {
    let own = hir.ids(hir.body);
    let own = own.filter(|&stmt: &StmtId| matches!(hir[stmt].kind, StmtKind::ExportAssign(_)));
    own.chain(bound.export_assignments_in_namespaces(hir))
        .any(|stmt| !decisions.is_dead_stmt(stmt))
}

fn has_runtime_import_statement(hir: &File<'_>) -> bool {
    hir.ids(hir.body).any(
        |stmt| matches!(hir[stmt].kind, StmtKind::Import(import) if is_runtime_import(hir, import)),
    )
}
