use super::call_sites::scan_calls;
use super::import_uses::compute_import_uses;
use super::jsx::collect_jsx_imports;
use super::macro_calls::find_pending_macro_calls;
use super::statements::scan_statements;
use super::{
    ImportScan, ImportSite, ImportSiteKind, ImportSpecifier, JsxImportSet, JsxMode, ScanInputs,
};
use crate::fold::slice_in;
use crate::hir::ExprId;
use crate::session::Arena;
use crate::util::SharedSort;

pub(crate) fn collect_import_sites<'s>(
    inputs: &ScanInputs<'_, 's>,
    arena: &'s Arena,
) -> ImportScan<'s> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        fold,
        file,
        ..
    } = inputs;
    let trims_unused_imports = hir.has_typescript_semantics();
    let uses = trims_unused_imports.then(|| compute_import_uses(hir, bound, decisions));
    let drops_unused_imports = trims_unused_imports && !fold.preserves_unused_imports();
    let statement_uses = uses.as_ref().filter(|_| drops_unused_imports);
    let jsx_imports = collect_jsx_imports(hir, bound, decisions, file.jsx);
    let jsx_sites = create_jsx_sites(file.jsx, jsx_imports);
    let mut statements = scan_statements(inputs, statement_uses, jsx_sites);
    let first_call_site = statements.sites.len() as u32;
    let calls = scan_calls(inputs, &mut statements.sites);
    let pending_macro_calls = find_pending_macro_calls(hir, bound, decisions, file.host_values);
    let sites = statements.sites;
    let mut sites_by_kind: Vec<u32> = (0..sites.len() as u32).collect();
    sites_by_kind.shared_sort_unstable_by_key(|&index| sites[index as usize].kind);
    let imports_used_only_in_dead_code =
        (uses.as_ref()).map_or_else(Vec::new, |uses| uses.symbols_used_only_in_dead_code());
    let unused_import_symbols = uses.map_or_else(Vec::new, |uses| uses.unused_symbols());
    ImportScan {
        sites: slice_in(&sites, arena),
        first_call_site,
        sites_by_kind: slice_in(&sites_by_kind, arena),
        jsx_imports,
        unused_import_symbols: slice_in(&unused_import_symbols, arena),
        imports_used_only_in_dead_code: slice_in(&imports_used_only_in_dead_code, arena),
        module_require_objects: slice_in(&calls.module_require_objects, arena),
        requires_of_other_files: slice_in(&calls.requires_of_other_files, arena),
        pending_macro_calls: slice_in(&pending_macro_calls, arena),
        first_runtime_import: statements.first_runtime_import,
        has_import_equals_require: statements.has_import_equals_require,
        errors: slice_in(&statements.errors, arena),
    }
}

fn create_jsx_sites(mode: JsxMode, imports: JsxImportSet) -> Vec<ImportSite> {
    let automatic = match mode {
        JsxMode::Classic => return Vec::new(),
        JsxMode::Automatic(automatic) => automatic,
    };
    let modules = [
        (ImportSiteKind::JsxRuntime, automatic.runtime_specifier),
        (ImportSiteKind::JsxPackage, automatic.package_specifier),
    ];
    let imported = modules
        .into_iter()
        .filter(|&(kind, _)| imports.iter().any(|import| import.site_kind() == kind));
    imported
        .map(|(kind, specifier)| ImportSite {
            kind,
            specifier: ImportSpecifier::Constant(specifier),
            specifier_node: ExprId::NONE,
            attributes: ExprId::NONE,
            consults_resolver: true,
            is_host_value: false,
        })
        .collect()
}
