use super::KnownHelpers;
use super::find::exports_function_declaration;
use super::held_early::{find_files_held_early, loads_nothing_ahead_of_its_body};
use crate::builtins::RuntimeModule;
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, SymbolId};
use bun_sema::hir::StmtKind;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{CodeAnswer, FileId, Files, Sym};
use std::cell::OnceCell;

/// What a file imports by name from files that have passed their heads when its body begins.
#[derive(Default)]
pub(super) struct ImportedHelpers {
    pub(super) bindings: Box<[(SymbolId, Sym)]>,
    pub(super) may_start_early: bool,
}

fn may_replace_exports(files: &Files<'_>) -> bool {
    let compiled = files.compiled_files().iter();
    let mut compiled = compiled.filter_map(|&file| files.compiled(file));
    compiled.any(|compiled| {
        let mut sites = compiled.analysis.import_sites.iter();
        let mut answers = compiled.code_answers.iter();
        sites.any(|site| matches!(site.kind, ImportSiteKind::MockModule(_)))
            || answers.any(|answer| match answer {
                CodeAnswer::HostModule(id) => is_test_runner(RuntimeModule::from_registry_id(id.0)),
                _ => false,
            })
    })
}

fn is_test_runner(module: Option<RuntimeModule>) -> bool {
    matches!(
        module,
        Some(RuntimeModule::BunTest | RuntimeModule::BunTestVitest)
    )
}

fn find_local_exported_as(files: &Files<'_>, file: FileId, name: Atom) -> Option<SymbolId> {
    let (hir, bound) = (files.hir(file), files.bound(file));
    hir.ids(hir.body).find_map(|statement| {
        let StmtKind::ExportNamed(export) = hir[statement].kind else {
            return None;
        };
        if hir[export].has_module_specifier || hir[export].type_only {
            return None;
        }
        let mut items = hir[export].items.iter();
        let item = items.find(|&item| hir[item].exported == name && !hir[item].type_only)?;
        match bound.exported_binding(item) {
            Binding::Symbol(symbol) => Some(symbol),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        }
    })
}

fn find_bindings(helpers: &KnownHelpers, files: &Files<'_>, file: FileId) -> Vec<(SymbolId, Sym)> {
    let mut bindings = Vec::new();
    let Some(compiled) = files.compiled(file) else {
        return bindings;
    };
    let (hir, bound) = (files.hir(file), files.bound(file));
    let sites = compiled.analysis.import_sites.iter();
    for (site, &answer) in sites.zip(compiled.code_answers) {
        let (ImportSiteKind::Import(import), CodeAnswer::File(home)) = (site.kind, answer) else {
            continue;
        };
        let import = hir[import];
        if !helpers.has_functions(home)
            || import.is_deferred
            || import.attributes.is_some()
            || import.loaded_as.is_some()
            || files.analysis(home).module_format != ModuleFormat::Esm
            || !loads_nothing_ahead_of_its_body(files, home)
        {
            continue;
        }
        for item in import.named.iter() {
            let local = bound.declared_symbol(Decl::ImportSpec(item));
            if let Some(id) = find_local_exported_as(files, home, hir[item].imported)
                && helpers.binding(home, id).is_some()
                && local.is_some()
                && !hir[item].type_only
            {
                bindings.push((local, Sym { file: home, id }));
            }
        }
    }
    bindings.sort_unstable();
    bindings
}

pub(super) fn find_imported_helpers(
    helpers: &KnownHelpers,
    files: &Files<'_>,
) -> Vec<ImportedHelpers> {
    let mut found = Vec::new();
    if !helpers.has_bindings() || may_replace_exports(files) {
        return found;
    }
    found.resize_with(files.modules.len(), ImportedHelpers::default);
    let held_early = OnceCell::new();
    for &file in files.compiled_files() {
        let bindings = find_bindings(helpers, files, file);
        if bindings.is_empty() {
            continue;
        }
        found[file.idx()] = ImportedHelpers {
            bindings: bindings.into_boxed_slice(),
            may_start_early: exports_function_declaration(files.hir(file), files.bound(file))
                && held_early.get_or_init(|| find_files_held_early(files))[file.idx()],
        };
    }
    found
}
