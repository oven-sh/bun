use super::{FileAnalysis, FileInputs, has_live_top_level_await};
use crate::atom::Interner;
use crate::bind::{BindOptions, Bound, bind};
use crate::fold::{FoldError, FoldInputs, FoldResult, fold_file};
use crate::hir::{File, FileKind};
use crate::import_sites::{ImportScan, ScanInputs, collect_import_sites};
use crate::module_format::{EsmSyntax, ModuleFormat, decide_module_format, file_esm_syntax};
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
    let declared = file.declared_module_type;
    let decision = decide_module_format(hir, &bound, &folded.decisions, &scan, declared);
    let is_module = decision.format == ModuleFormat::Esm;
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
    let analysis = FileAnalysis {
        decisions: folded.decisions,
        module_format: decision.format,
        has_esm_syntax: file_esm_syntax(hir) != EsmSyntax::None,
        import_sites: scan.sites,
        jsx_imports: scan.jsx_imports,
        unused_import_symbols: scan.unused_import_symbols,
        imports_used_only_in_dead_code: scan.imports_used_only_in_dead_code,
        pending_macro_calls: scan.pending_macro_calls,
        has_live_top_level_await: has_live_top_level_await(hir, &folded.decisions),
        errors: join_errors(folded.errors, scan.errors, decision.error, arena),
        strings_over_limit: folded.strings_over_limit,
        relies_on_running_before_calls: folded.relies_on_running_before_calls,
        requires_of_other_files: scan.requires_of_other_files,
        sites_by_kind: scan.sites_by_kind,
        first_call_site: scan.first_call_site,
    };
    (bound, analysis)
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
    let scan_inputs = ScanInputs {
        hir,
        bound,
        decisions: &folded.decisions,
        fold: inputs,
        file,
        atoms,
    };
    let scan = collect_import_sites(&scan_inputs, arena);
    (folded, scan)
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
