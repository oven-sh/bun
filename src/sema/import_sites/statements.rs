use super::import_uses::{ImportUses, compute_import_uses, names_eval};
use super::{ImportSite, ImportSiteKind, ImportSpecifier, ScanInputs};
use crate::atom::{Atom, known};
use crate::bind::{Bound, Decl, Parent, SymbolId};
use crate::fold::{Decisions, FoldError, FoldErrorKind, FoldInputs};
use crate::hir::{
    ExprId, ExprKind, File, Flags, FnBody, Func, ImportEqualsId, ImportEqualsTarget, ImportId,
    NodeData, PatKind, PropKey, StmtId, StmtKind, TypeNodeKind,
};

fn has_macro_type(hir: &File<'_>, attributes: ExprId) -> bool {
    hir.import_attribute(attributes, known::r#type) == Some(known::r#macro)
}

pub(super) fn is_macro_import(hir: &File<'_>, import: ImportId) -> bool {
    hir[import].spec.is_some() && has_macro_type(hir, hir[import].attributes)
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
    let default = (hir[import].default.is_some()).then_some(Decl::ImportDefault(import));
    let namespace = (hir[import].namespace.is_some()).then_some(Decl::ImportNamespace(import));
    default.into_iter().chain(namespace).chain(named)
}

fn symbols_of_value_imports(
    hir: &File<'_>,
    bound: &Bound<'_>,
    import: ImportId,
) -> impl Iterator<Item = SymbolId> {
    import_decls(hir, import)
        .filter(move |decl| !matches!(*decl, Decl::ImportSpec(spec) if hir[spec].type_only))
        .map(move |decl| bound.declared_symbol(decl))
}

pub(super) fn value_import_symbols(
    hir: &File<'_>,
    bound: &Bound<'_>,
    import: ImportId,
) -> impl Iterator<Item = SymbolId> {
    symbols_of_value_imports(hir, bound, import).filter(|symbol| symbol.is_some())
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
    for (index, import) in hir.import_equals.iter().enumerate() {
        if let Parent::Module(namespace) = bound.parent_of_stmt(import.stmt)
            && bound.makes_namespace_object(hir, namespace)
            && !import.flags.contains(Flags::AMBIENT)
            && !decisions.is_dead_stmt(import.stmt)
            && let Some((kind, spec)) = import_equals_site(hir, ImportEqualsId(index as u32))
        {
            result.has_import_equals_require = true;
            result.sites.push(ImportSite {
                kind,
                specifier: ImportSpecifier::Constant(spec),
                specifier_node: ExprId::NONE,
                attributes: ExprId::NONE,
                consults_resolver: true,
                is_host_value: false,
            });
        }
    }
    result
}

pub fn find_statement_sites(
    hir: &File<'_>,
    bound: &Bound<'_>,
    inputs: &FoldInputs<'_>,
) -> Vec<(ImportSiteKind, Atom)> {
    debug_assert!(hir.import_equals.is_empty());
    let drops_unused_imports = hir.has_typescript_semantics() && !inputs.preserves_unused_imports();
    let uses = drops_unused_imports.then(|| compute_import_uses(hir, bound, &Decisions::default()));
    hir.ids(hir.body)
        .filter_map(|stmt| statement_site(hir, bound, stmt, uses.as_ref()))
        .collect()
}

pub struct SitesByName {
    pub sites: Vec<(ImportSiteKind, Atom)>,
    pub has_free_name: bool,
}

pub fn find_sites_by_name(
    hir: &File<'_>,
    inputs: &FoldInputs<'_>,
    names: &[Atom],
) -> Option<SitesByName> {
    const MOST_EXPRS: usize = 20_000;
    let is_ambient = |flags: Flags| flags.contains(Flags::AMBIENT);
    let may_have_default = |func: &Func| {
        func.params.iter().any(|it| {
            hir[it].default.is_some() || !matches!(hir[hir[it].pat].kind, PatKind::Ident(_))
        })
    };
    let is_simple = hir.has_module_syntax
        && hir.with_bodies.is_empty()
        && !hir.is_flow
        && !hir.has_errors
        && !hir.has_parse_diagnostics
        && !hir.ran_out_of_stack
        && hir.exprs.len() <= MOST_EXPRS
        && hir.decorators.is_empty()
        && hir.modules.is_empty()
        && hir.enums.is_empty()
        && hir.import_equals.is_empty()
        && hir.jsx.is_empty()
        && !hir.classes.iter().any(|it| is_ambient(it.flags))
        && !(hir.members.iter()).any(|it| matches!(it.key, PropKey::Computed(_)))
        && !(hir.fns.iter()).any(|it| matches!(it.body, FnBody::None) && may_have_default(it));
    if !is_simple {
        return None;
    }
    let imports = || (0..hir.imports.len() as u32).map(ImportId);
    let locals_of = |import: ImportId| {
        let import = &hir[import];
        let named = import.named.iter();
        let named = named
            .filter(|&it| !hir[it].type_only)
            .map(|it| hir[it].local);
        let locals = [import.default, import.namespace].into_iter().chain(named);
        locals.filter(|local| local.is_some())
    };
    let (mut imported, mut imported_types): (Vec<Atom>, Vec<Atom>) = (Vec::new(), Vec::new());
    for import in imports() {
        match hir[import].type_only {
            true => imported_types.extend(locals_of(import)),
            false => imported.extend(locals_of(import)),
        }
        let types = hir[import].named.iter().filter(|&it| hir[it].type_only);
        imported_types.extend(types.map(|it| hir[it].local));
    }
    let deciding: Vec<Atom> = [names, &imported, &imported_types].concat();
    let is_deciding = |name: Atom| deciding.contains(&name);
    let declared_in_patterns = hir.pats.iter().filter_map(|it| match it.kind {
        PatKind::Ident(name) => Some(name),
        _ => None,
    });
    let mut declared = declared_in_patterns
        .chain(hir.fns.iter().map(|it| it.name))
        .chain(hir.classes.iter().map(|it| it.name))
        .chain(hir.interfaces.iter().map(|it| it.name))
        .chain(hir.aliases.iter().map(|it| it.name))
        .filter(|name| name.is_some());
    let is_imported_twice = (1..imported.len()).any(|at| imported[..at].contains(&imported[at]));
    if is_imported_twice || declared.any(is_deciding) {
        return None;
    }
    let root_of = |mut operand: ExprId| {
        while let ExprKind::Dot { obj, .. } = hir[operand].kind {
            operand = obj;
        }
        operand
    };
    let mut operands_of_types: Vec<ExprId> = Vec::new();
    for base in hir.interfaces.iter().flat_map(|it| hir.ids(it.extends)) {
        if let TypeNodeKind::Heritage { expr, .. } = hir[base].kind {
            operands_of_types.push(root_of(expr));
        }
    }
    for node in hir.types.iter() {
        match node.kind {
            TypeNodeKind::Typeof { expr, .. } => operands_of_types.push(root_of(expr)),
            TypeNodeKind::Heritage { expr, .. } => {
                let root = root_of(expr);
                if matches!(hir[root].kind, ExprKind::Ident(name) if is_deciding(name))
                    && !operands_of_types.contains(&root)
                {
                    return None;
                }
            }
            _ => {}
        }
    }
    operands_of_types.sort_unstable();
    let mut is_used = vec![false; imported.len()];
    let mut has_free_name = false;
    for (e, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
        if names_eval(node) {
            return None;
        }
        let ExprKind::Ident(name) = node.kind else {
            continue;
        };
        if !is_deciding(name) || operands_of_types.binary_search(&e).is_ok() {
            continue;
        }
        match imported.iter().position(|&it| it == name) {
            Some(place) => is_used[place] = true,
            None if imported_types.contains(&name) => return None,
            None => has_free_name = true,
        }
    }
    for export in hir.exports.iter() {
        if export.type_only || export.has_module_specifier {
            continue;
        }
        for spec in export.items.iter().filter(|&it| !hir[it].type_only) {
            match imported.iter().position(|&it| it == hir[spec].local) {
                Some(place) => is_used[place] = true,
                None if is_deciding(hir[spec].local) => return None,
                None => {}
            }
        }
    }
    let drops_unused_imports = hir.has_typescript_semantics() && !inputs.preserves_unused_imports();
    let is_dropped = |import: ImportId| {
        let mut locals = locals_of(import).peekable();
        let is_used = |local: Atom| {
            imported
                .iter()
                .position(|&it| it == local)
                .is_some_and(|place| is_used[place])
        };
        drops_unused_imports && locals.peek().is_some() && !locals.any(is_used)
    };
    let sites = hir.ids(hir.body).filter_map(|stmt| match hir[stmt].kind {
        StmtKind::Import(id) => {
            let import = &hir[id];
            let is_site = !hir.is_type_only_import(id) && import.spec.is_some() && !is_dropped(id);
            is_site.then_some((ImportSiteKind::Import(id), import.spec))
        }
        _ => statement_site_without_names(hir, stmt),
    });
    let sites = sites.collect();
    Some(SitesByName {
        sites,
        has_free_name,
    })
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
        _ => statement_site_without_names(hir, stmt),
    }
}

fn statement_site_without_names(hir: &File<'_>, stmt: StmtId) -> Option<(ImportSiteKind, Atom)> {
    match hir[stmt].kind {
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
    for symbol in symbols_of_value_imports(hir, bound, import) {
        if symbol.is_some() && uses.used_anywhere.contains(symbol.idx()) {
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
