use super::import_uses::ImportUses;
use super::{ImportSite, ImportSiteKind, ImportSpecifier, ScanInputs};
use crate::atom::{Atom, known};
use crate::bind::{Bound, Decl, SymbolId};
use crate::fold::{FoldError, FoldErrorKind};
use crate::hir::{
    ExprId, File, Flags, ImportEqualsId, ImportEqualsTarget, ImportId, NodeData, StmtId, StmtKind,
};

fn has_macro_type(hir: &File<'_>, attributes: ExprId) -> bool {
    hir.import_attribute(attributes, known::r#type) == Some(known::r#macro)
}

pub(super) fn is_macro_import(hir: &File<'_>, import: ImportId) -> bool {
    has_macro_type(hir, hir[import].attributes)
}

pub(crate) fn is_runtime_import(hir: &File<'_>, import: ImportId) -> bool {
    let spec = hir[import].spec;
    !hir.is_type_only_import(import)
        && spec.is_some()
        && spec != known::bun_bundle
        && !is_macro_import(hir, import)
}

fn import_decls(hir: &File<'_>, import: ImportId) -> impl Iterator<Item = Decl> {
    let named = hir[import].named.iter().map(Decl::ImportSpec);
    [Decl::ImportDefault(import), Decl::ImportNamespace(import)]
        .into_iter()
        .chain(named)
}

pub(super) fn value_import_symbols(
    hir: &File<'_>,
    bound: &Bound<'_>,
    import: ImportId,
) -> impl Iterator<Item = SymbolId> {
    import_decls(hir, import)
        .filter(move |decl| !matches!(*decl, Decl::ImportSpec(spec) if hir[spec].type_only))
        .map(move |decl| bound.declared_symbol(decl))
        .filter(|symbol| symbol.is_some())
}

pub(super) struct StatementSites {
    pub sites: Vec<ImportSite>,
    pub first_runtime_import: Option<ImportId>,
    pub has_import_equals_require: bool,
    pub errors: Vec<FoldError>,
}

pub(super) fn scan_statements(
    inputs: &ScanInputs<'_, '_>,
    uses: Option<&ImportUses>,
    sites: Vec<ImportSite>,
) -> StatementSites {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let mut result = StatementSites {
        sites,
        first_runtime_import: None,
        has_import_equals_require: false,
        errors: Vec::new(),
    };
    for stmt in hir.ids(hir.body) {
        if decisions.is_dead_stmt(stmt) {
            continue;
        }
        let Some((kind, spec)) = statement_site(hir, bound, stmt, uses) else {
            continue;
        };
        if let ImportSiteKind::Import(import) = kind
            && result.first_runtime_import.is_none()
            && is_runtime_import(hir, import)
        {
            result.first_runtime_import = Some(import);
        }
        result.has_import_equals_require |= matches!(kind, ImportSiteKind::ImportEquals(_));
        let attributes = hir.statement_import_attributes(stmt);
        if has_macro_type(hir, attributes)
            && let Some(error) = macro_export_error(kind)
        {
            result.errors.push(FoldError {
                kind: error,
                node: NodeData::Stmt(stmt),
            });
        }
        result.sites.push(ImportSite {
            kind,
            specifier: ImportSpecifier::Constant(spec),
            specifier_node: ExprId::NONE,
            attributes,
            consults_resolver: true,
            is_host_value: false,
        });
    }
    result
}

fn macro_export_error(kind: ImportSiteKind) -> Option<FoldErrorKind> {
    match kind {
        ImportSiteKind::ExportStar(_) => Some(FoldErrorKind::MacroInExportStar),
        ImportSiteKind::ExportFrom(_) => Some(FoldErrorKind::MacroInExportFrom),
        _ => None,
    }
}

fn statement_site(
    hir: &File<'_>,
    bound: &Bound<'_>,
    stmt: StmtId,
    uses: Option<&ImportUses>,
) -> Option<(ImportSiteKind, Atom)> {
    match hir[stmt].kind {
        StmtKind::Import(id) => {
            let import = &hir[id];
            let is_dropped = uses.is_some_and(|uses| is_unused_import(hir, bound, uses, id));
            let is_site = !hir.is_type_only_import(id) && import.spec.is_some() && !is_dropped;
            is_site.then_some((ImportSiteKind::Import(id), import.spec))
        }
        StmtKind::ExportNamed(id) => {
            let export = &hir[id];
            let is_site = export.has_module_specifier
                && !hir.is_type_only_export(id)
                && export.spec.is_some();
            is_site.then_some((ImportSiteKind::ExportFrom(id), export.spec))
        }
        StmtKind::ExportStar {
            spec, type_only, ..
        } => {
            let is_site = !type_only && spec.is_some();
            is_site.then_some((ImportSiteKind::ExportStar(stmt), spec))
        }
        StmtKind::ImportEquals(id) => import_equals_site(hir, id),
        _ => None,
    }
}

fn is_unused_import(
    hir: &File<'_>,
    bound: &Bound<'_>,
    uses: &ImportUses,
    import: ImportId,
) -> bool {
    let mut has_binding = false;
    for symbol in value_import_symbols(hir, bound, import) {
        if uses.used_anywhere.contains(symbol.idx()) {
            return false;
        }
        has_binding = true;
    }
    has_binding
}

fn import_equals_site(hir: &File<'_>, id: ImportEqualsId) -> Option<(ImportSiteKind, Atom)> {
    let import = &hir[id];
    match import.target {
        ImportEqualsTarget::Require(spec)
            if spec.is_some() && !import.flags.contains(Flags::TYPE_ONLY) =>
        {
            Some((ImportSiteKind::ImportEquals(id), spec))
        }
        ImportEqualsTarget::Require(_) | ImportEqualsTarget::Entity(_) => None,
    }
}
