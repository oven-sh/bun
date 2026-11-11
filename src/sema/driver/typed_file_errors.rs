//! Which error of a type check of a build's typed files (`.aot.ts`) leaves the files out.

use crate::{Diagnostic, Report};
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};

/// Whether the build of a program that installs the package reports it: an error of syntax, or a type error.
fn counts(reported: &Diagnostic) -> bool {
    let effect = effect_of(
        FileOrigin::DependencySource,
        reported.class,
        reported.category,
    );
    effect != Effect::Dropped
}

pub fn first_error(report: &Report) -> Option<&Diagnostic> {
    report.diagnostics.iter().find(|reported| counts(reported))
}

/// The error that decides: the first of `with_bun_types`, or of `report` where `with_bun_types` did not judge every file.
pub fn first_error_with_bun_types<'a>(
    report: &'a Report,
    with_bun_types: &'a Report,
    files: usize,
) -> Option<&'a Diagnostic> {
    let has_judged = with_bun_types.files_checked >= files && with_bun_types.incomplete.is_empty();
    match first_error(with_bun_types) {
        None if !has_judged => first_error(report),
        error => error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Incomplete;
    use bun_sema::check::aot::DiagnosticClass;

    const FILE: &[u8] = b"/out/index.aot.ts";

    fn at(start: u32, code: u32, class: DiagnosticClass) -> Diagnostic {
        Diagnostic {
            path: FILE.to_vec(),
            start,
            class,
            ..crate::global(code, &[b"x", b"y"])
        }
    }

    fn judged(diagnostics: Vec<Diagnostic>) -> Report {
        Report {
            diagnostics,
            files_checked: 1,
            ..Default::default()
        }
    }

    fn named(report: &Report, with_bun_types: &Report) -> Option<(u32, u32)> {
        first_error_with_bun_types(report, with_bun_types, 1).map(|it| (it.start, it.code))
    }

    #[test]
    fn the_program_with_the_types_of_bun_decides() {
        let report = judged(vec![at(5, 2339, DiagnosticClass::Semantic)]);
        assert_eq!(first_error(&report).map(|it| it.start), Some(5));
        // The types of Bun clear it.
        assert_eq!(named(&report, &judged(Vec::new())), None);
        // They have an error of their own, at another place: that one is named.
        let other = at(9, 2741, DiagnosticClass::Semantic);
        assert_eq!(named(&report, &judged(vec![other])), Some((9, 2741)));
        // What no build counts is no error: a name that is not declared.
        let not_declared = at(5, 2304, DiagnosticClass::MissingDeclaration);
        assert_eq!(named(&report, &judged(vec![not_declared.clone()])), None);
        assert!(first_error(&judged(vec![not_declared])).is_none());
    }

    #[test]
    fn a_check_that_has_not_judged_every_file_clears_nothing() {
        let report = judged(vec![at(5, 2339, DiagnosticClass::Semantic)]);
        assert_eq!(named(&report, &Report::default()), Some((5, 2339)));
        let incomplete = Report {
            incomplete: vec![Incomplete {
                path: FILE.to_vec(),
                is_nested_too_deeply: false,
                deepest_nesting: 0,
                nested_too_deeply_at: None,
            }],
            ..judged(Vec::new())
        };
        assert_eq!(named(&report, &incomplete), Some((5, 2339)));
        // Two files, and the check with the types of Bun got to one.
        let clean = judged(Vec::new());
        let one_of_two = first_error_with_bun_types(&report, &clean, 2);
        assert_eq!(one_of_two.map(|it| it.start), Some(5));
        // It stopped at an error of syntax: that error is named.
        let stopped = Report {
            diagnostics: vec![at(7, 1109, DiagnosticClass::EarlyError)],
            ..Default::default()
        };
        assert_eq!(named(&report, &stopped), Some((7, 1109)));
    }
}
