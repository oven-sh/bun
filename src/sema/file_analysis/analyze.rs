use super::{FileAnalysis, FileInputs, FoldedAgain, has_live_top_level_await};
use crate::atom::Interner;
use crate::bind::{BindOptions, Bound, bind};
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
    let mut bound = bind(hir, options, atoms, arena);
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
            bound = bind(hir, options, atoms, arena);
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

/// `None`: what is known now calls for more than another folding of the same tree.
pub(super) fn run_again<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    inputs: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    previous: &FileAnalysis<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> Option<FoldedAgain<'s>> {
    let folded = fold_file(hir, bound, inputs, file, atoms, arena);
    // Most constants decide no branch and name no file.
    let has_same_import_sites = previous.errors.is_empty()
        && folded.errors.is_empty()
        && previous.pending_macro_calls.is_empty()
        && previous.names_every_file_by_a_constant()
        && (folded.decisions).has_same_code_and_specifiers(&previous.decisions);
    if has_same_import_sites {
        let analysis = FileAnalysis {
            decisions: folded.decisions,
            strings_over_limit: folded.strings_over_limit,
            relies_on_running_before_calls: folded.relies_on_running_before_calls,
            imported_names: folded.imported_names,
            ..*previous
        };
        return Some(FoldedAgain {
            analysis,
            has_same_import_sites,
        });
    }
    let scan = scan_folded_file(hir, bound, inputs, file, &folded, atoms, arena);
    let decision = decide_format(hir, bound, &folded, &scan);
    let is_same_tree = decision.formats.get(file.declared_module_type) == previous.module_format
        && scan.pending_macro_calls.is_empty();
    is_same_tree.then(|| FoldedAgain {
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
    let decisions_of_bun_run = folded.decisions.as_folded_by_bun_run();
    let decision = decide_module_format(hir, bound, &decisions_of_bun_run, scan);
    match decision.error {
        // `bun run` refuses the file. A build that removes what is wrong with it compiles it.
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
        jsx_imports: scan.jsx_imports,
        unused_import_symbols: scan.unused_import_symbols,
        imports_used_only_in_dead_code: scan.imports_used_only_in_dead_code,
        imports_used_without_a_read: scan.imports_used_without_a_read,
        pending_macro_calls: scan.pending_macro_calls,
        has_live_top_level_await: has_live_top_level_await(hir, &folded.decisions),
        errors: join_errors(folded.errors, scan.errors, decision.error, arena),
        strings_over_limit: folded.strings_over_limit,
        relies_on_running_before_calls: folded.relies_on_running_before_calls,
        imported_names: folded.imported_names,
        requires_of_other_files: scan.requires_of_other_files,
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
