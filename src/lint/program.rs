//! `SortAndDeduplicateDiagnostics` of `internal/compiler/program.go` of typescript-go.

use crate::diagnostic::{
    Diagnostic, SourceFile, compare_diagnostics, equal_diagnostics,
    equal_diagnostics_no_related_info,
};

/// In the order of `compare_diagnostics`, each diagnostic once.
pub fn sort_and_deduplicate_diagnostics(
    files: &[SourceFile],
    mut diagnostics: Vec<Diagnostic>,
) -> Vec<Diagnostic> {
    diagnostics.sort_by(|d1, d2| compare_diagnostics(files, d1, d2));
    compact_and_merge_related_infos(files, diagnostics)
}

/// Removes duplicate diagnostics; those that differ only by related information become one with it sorted and deduplicated.
fn compact_and_merge_related_infos(
    files: &[SourceFile],
    diagnostics: Vec<Diagnostic>,
) -> Vec<Diagnostic> {
    if diagnostics.len() < 2 {
        return diagnostics;
    }
    let mut result = Vec::with_capacity(diagnostics.len());
    let mut diagnostics = diagnostics.into_iter().peekable();
    while let Some(mut d) = diagnostics.next() {
        let mut n: usize = 1;
        while let Some(next) =
            diagnostics.next_if(|next| equal_diagnostics_no_related_info(files, &d, next))
        {
            d.related.extend(next.related);
            n += 1;
        }
        // As in the reference, a diagnostic without a duplicate keeps its related information as it was reported.
        if n > 1 {
            let related_infos = &mut d.related;
            related_infos.sort_by(|r1, r2| compare_diagnostics(files, r1, r2));
            related_infos.dedup_by(|r1, r2| equal_diagnostics(files, r1, r2));
        }
        result.push(d);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::*;
    use crate::diagnostic::{Category, Code};

    fn diagnostic(start: u32, related: Vec<Diagnostic>) -> Diagnostic {
        Diagnostic {
            file: None,
            start,
            length: 1,
            category: Category::Error,
            code: Code::Ts(2322),
            text: Cow::Borrowed(b"t"),
            chain: Vec::new(),
            related,
        }
    }

    fn related(start: u32) -> Diagnostic {
        diagnostic(start, Vec::new())
    }

    fn starts(diagnostics: &[Diagnostic]) -> Vec<u32> {
        diagnostics.iter().map(|d| d.start).collect()
    }

    #[test]
    fn related_information_is_sorted_and_deduplicated_only_where_duplicates_merge() {
        let out = sort_and_deduplicate_diagnostics(
            &[],
            vec![
                diagnostic(2, vec![related(5)]),
                diagnostic(1, vec![related(9), related(3), related(9)]),
                diagnostic(2, vec![related(7), related(5)]),
            ],
        );
        assert_eq!(starts(&out), vec![1, 2]);
        assert_eq!(starts(&out[0].related), vec![9, 3, 9]);
        assert_eq!(starts(&out[1].related), vec![5, 7]);
    }

    #[test]
    fn one_diagnostic_is_returned_as_it_is() {
        let out = sort_and_deduplicate_diagnostics(
            &[],
            vec![diagnostic(1, vec![related(9), related(3), related(9)])],
        );
        assert_eq!(starts(&out), vec![1]);
        assert_eq!(starts(&out[0].related), vec![9, 3, 9]);
        assert!(sort_and_deduplicate_diagnostics(&[], Vec::new()).is_empty());
    }
}
