// Port of SortAndDeduplicateDiagnostics and compactAndMergeRelatedInfos of internal/compiler/program.go.
use crate::ast_diagnostic::{DiagnosticStore, Diagnostics, SourceFiles};
use crate::tscore::ids::DiagnosticId;
use crate::tscore::slices::sort_func;

pub fn sort_and_deduplicate_diagnostics<F: SourceFiles + ?Sized>(
    store: &mut DiagnosticStore,
    files: &F,
    diagnostics: &[DiagnosticId],
) -> Vec<DiagnosticId> {
    let mut diagnostics = diagnostics.to_vec();
    let d = Diagnostics { store, files };
    sort_func(&mut diagnostics, |a, b| d.compare_diagnostics(a, b));
    compact_and_merge_related_infos(store, files, diagnostics)
}

// Removes duplicates and merges the related information of diagnostics that differ only by it.
fn compact_and_merge_related_infos<F: SourceFiles + ?Sized>(
    store: &mut DiagnosticStore,
    files: &F,
    mut diagnostics: Vec<DiagnosticId>,
) -> Vec<DiagnosticId> {
    if diagnostics.len() < 2 {
        return diagnostics;
    }
    let mut i = 0;
    let mut j = 0;
    while let Some(&first) = diagnostics.get(i) {
        let mut d = first;
        let mut n = 1;
        while let Some(&next) = diagnostics.get(i + n) {
            if !(Diagnostics { store, files }).equal_diagnostics_no_related_info(d, next) {
                break;
            }
            n += 1;
        }
        if n > 1 {
            let mut related_infos: Vec<DiagnosticId> = Vec::new();
            for k in 0..n {
                if let Some(&member) = diagnostics.get(i + k) {
                    related_infos.extend_from_slice(store[member].related_information());
                }
            }
            if !related_infos.is_empty() {
                let view = Diagnostics { store, files };
                sort_func(&mut related_infos, |a, b| view.compare_diagnostics(a, b));
                related_infos.dedup_by(|b, a| view.equal_diagnostics(*a, *b));
                d = store.clone_diagnostic(d);
                store.set_related_info(d, related_infos);
            }
        }
        if let Some(slot) = diagnostics.get_mut(j) {
            *slot = d;
        }
        i += n;
        j += 1;
    }
    diagnostics.truncate(j);
    diagnostics
}
