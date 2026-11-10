use super::{AnalyzedAgain, AnalyzedAgainFrom, FileAnalysis, FileInputs, has_live_top_level_await};
use crate::atom::Interner;
use crate::bind::{BindOptions, Bound, bind_below_defines};
use crate::fold::{FoldError, FoldInputs, FoldResult, fold_file};
use crate::hir::{File, FileKind};
use crate::import_sites::{ImportScan, ScanInputs, collect_import_sites};
use crate::module_format::{
    EsmSyntax, FormatDecision, ModuleFormat, decide_module_format, file_esm_syntax,
};
use crate::session::Arena;

pub(super) fn run<'s>(
    hir: &mut File<'s>,
    options: BindOptions,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> (Bound<'s>, FileAnalysis<'s>) {
    debug_assert!(options.runtime.is_some());
    debug_assert!(!matches!(hir.kind, FileKind::Json | FileKind::Declaration));
    hir.reset_strict();
    let names_in_place = inputs.names_in_place();
    let mut bound = bind_below_defines(hir, options, names_in_place, atoms, arena);
    if bound.ran_out_of_stack {
        return (bound, FileAnalysis::default());
    }
    let (mut folded, mut scan) = fold_bound_file(hir, &bound, inputs, file, atoms, arena);
    let decision = decide_format(hir, &bound, &folded, &scan);
    let is_module = decision.formats.get(file.declared_module_type) == ModuleFormat::Esm;
    if is_module && !hir.is_strict_by_syntax {
        hir.set_strict();
        if bound.runtime.depends_on_sloppy_mode() {
            drop(bound);
            bound = bind_below_defines(hir, options, names_in_place, atoms, arena);
            if bound.ran_out_of_stack {
                return (bound, FileAnalysis::default());
            }
            (folded, scan) = fold_bound_file(hir, &bound, inputs, file, atoms, arena);
        }
    }
    bound.runtime.set_module_goal(is_module);
    let analysis = create_analysis(hir, &folded, &scan, &decision, file, arena);
    (bound, analysis)
}

pub(super) fn run_again<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    previous: &FileAnalysis<'s>,
    from: AnalyzedAgainFrom,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Option<AnalyzedAgain<'s>> {
    let folded = match from {
        AnalyzedAgainFrom::Folding => fold_file(hir, bound, inputs, file, atoms, arena),
        AnalyzedAgainFrom::ImportScan => FoldResult {
            decisions: previous.decisions,
            errors: previous
                .errors
                .split_at(previous.fold_error_count as usize)
                .0,
            strings_over_limit: previous.strings_over_limit,
            asks_for_main_module: previous.asks_for_main_module,
            imported_names: previous.imported_names,
        },
    };
    let has_same_import_sites = from == AnalyzedAgainFrom::Folding
        && previous.errors.is_empty()
        && folded.errors.is_empty()
        && previous.pending_macro_calls.is_empty()
        && previous.names_every_file_by_a_constant()
        && (folded.decisions).has_same_code_and_specifiers(&previous.decisions);
    if has_same_import_sites {
        let analysis = FileAnalysis {
            decisions: folded.decisions,
            strings_over_limit: folded.strings_over_limit,
            imported_names: folded.imported_names,
            ..*previous
        };
        return Some(AnalyzedAgain {
            analysis,
            has_same_import_sites,
        });
    }
    let scan = scan_folded_file(hir, bound, inputs, file, &folded, atoms, arena);
    let decision = decide_format(hir, bound, &folded, &scan);
    let is_same_tree = decision.formats.get(file.declared_module_type) == previous.module_format
        && scan.pending_macro_calls.is_empty();
    is_same_tree.then(|| AnalyzedAgain {
        analysis: create_analysis(hir, &folded, &scan, &decision, file, arena),
        has_same_import_sites,
    })
}

fn decide_format<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    folded: &FoldResult<'s>,
    scan: &ImportScan<'s>,
) -> FormatDecision {
    let decisions_of_bun_run = folded.decisions.as_folded_under_minify_syntax();
    let decision = decide_module_format(hir, bound, &decisions_of_bun_run, scan);
    match decision.error {
        Some(_) => decide_module_format(hir, bound, &folded.decisions, scan),
        None => decision,
    }
}

fn create_analysis<'s>(
    hir: &File<'s>,
    folded: &FoldResult<'s>,
    scan: &ImportScan<'s>,
    decision: &FormatDecision,
    file: &FileInputs<'s>,
    arena: &'s Arena,
) -> FileAnalysis<'s> {
    FileAnalysis {
        decisions: folded.decisions,
        module_format: decision.formats.get(file.declared_module_type),
        module_formats: decision.formats,
        has_esm_syntax: file_esm_syntax(hir) != EsmSyntax::None,
        import_sites: scan.sites,
        alternatives: scan.alternatives,
        paths_from_own_directory: scan.paths_from_own_directory,
        answers_of_resolvers: scan.answers_of_resolvers,
        names_of_workers: scan.names_of_workers,
        paths_of_changed_files: scan.paths_of_changed_files,
        module_relative_reads: scan.module_relative_reads,
        caller_relative_reads: scan.caller_relative_reads,
        known_load_names: scan.known_load_names,
        own_url_arguments: scan.own_url_arguments,
        exported_file_changers: scan.exported_file_changers,
        asked_of_other_files: scan.asked_of_other_files,
        asked_of_data_files: scan.asked_of_data_files,
        asked_of_own_exports: scan.asked_of_own_exports,
        names_out_of_data_files: scan.names_out_of_data_files,
        names_resolved_from_listed_folders: scan.names_resolved_from_listed_folders,
        options_of_resolves_with_unread_folders: scan.options_of_resolves_with_unread_folders,
        keys_stored_in_caches: scan.keys_stored_in_caches,
        jsx_imports: scan.jsx_imports,
        unused_import_symbols: scan.unused_import_symbols,
        imports_used_only_in_dead_code: scan.imports_used_only_in_dead_code,
        imports_used_without_a_read: scan.imports_used_without_a_read,
        pending_macro_calls: scan.pending_macro_calls,
        has_live_top_level_await: has_live_top_level_await(
            hir,
            &folded.decisions.as_folded_under_minify_syntax(),
        ),
        errors: join_errors(folded.errors, scan.errors, decision.error, arena),
        fold_error_count: folded.errors.len() as u32,
        strings_over_limit: folded.strings_over_limit,
        asks_for_main_module: folded.asks_for_main_module,
        imported_names: folded.imported_names,
        requires_of_other_files: scan.requires_of_other_files,
        paths_given_to_create_require: scan.paths_given_to_create_require,
        sites_by_kind: scan.sites_by_kind,
        first_call_site: scan.first_call_site,
    }
}

fn fold_bound_file<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> (FoldResult<'s>, ImportScan<'s>) {
    let folded = fold_file(hir, bound, inputs, file, atoms, arena);
    let scan = scan_folded_file(hir, bound, inputs, file, &folded, atoms, arena);
    (folded, scan)
}

#[inline(never)]
fn scan_folded_file<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    folded: &FoldResult<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> ImportScan<'s> {
    let scan_inputs = ScanInputs {
        hir,
        bound,
        decisions: &folded.decisions,
        fold: inputs,
        file,
        atoms,
    };
    collect_import_sites(&scan_inputs, arena)
}

fn join_errors<'s>(
    fold_errors: &'s [FoldError],
    scan_errors: &[FoldError],
    format_error: Option<FoldError>,
    arena: &'s Arena,
) -> &'s [FoldError] {
    if scan_errors.is_empty() && format_error.is_none() {
        return fold_errors;
    }
    let errors: Vec<FoldError> = fold_errors
        .iter()
        .chain(scan_errors)
        .copied()
        .chain(format_error)
        .collect();
    arena.alloc_slice_copy(&errors)
}
