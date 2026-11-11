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

fn errors(report: &Report) -> impl Iterator<Item = &Diagnostic> {
    report
        .diagnostics
        .iter()
        .filter(|reported| counts(reported))
}

pub fn first_error(report: &Report) -> Option<&Diagnostic> {
    errors(report).next()
}

/// The error that leaves the typed files out, by the program that reports it.
#[derive(Clone, Copy)]
pub enum LeavesOut<'a> {
    /// The check of the files alone reports it, and the program that loads them does not clear it.
    InOwnProgram(&'a Diagnostic),
    /// Only the program that loads them reports it: that program has the types of Bun.
    OnlyWithBunTypes(&'a Diagnostic),
}

/// A text that passes its own check is written. Else `with_bun_types` decides, if it has judged each of the `files`.
pub fn error_that_leaves_out<'a>(
    report: &'a Report,
    with_bun_types: Option<&'a Report>,
    files: usize,
) -> Option<LeavesOut<'a>> {
    let own = first_error(report)?;
    let Some(with_bun_types) = with_bun_types else {
        return Some(LeavesOut::InOwnProgram(own));
    };
    let Some(first) = first_error(with_bun_types) else {
        let has_judged =
            with_bun_types.files_checked >= files && with_bun_types.incomplete.is_empty();
        return (!has_judged).then_some(LeavesOut::InOwnProgram(own));
    };
    // The two programs can word one error differently, so an error of both is found by its place.
    let is_error_of_both = |own: &&Diagnostic| {
        errors(with_bun_types).any(|other| other.path == own.path && other.start == own.start)
    };
    let of_both = errors(report).find(is_error_of_both);
    Some(of_both.map_or(LeavesOut::OnlyWithBunTypes(first), LeavesOut::InOwnProgram))
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

    fn error_at(start: u32, code: u32) -> Diagnostic {
        at(start, code, DiagnosticClass::Semantic)
    }

    fn judged(diagnostics: Vec<Diagnostic>) -> Report {
        Report {
            diagnostics,
            files_checked: 1,
            ..Default::default()
        }
    }

    #[derive(Debug, PartialEq)]
    enum Program {
        Own,
        WithBunTypes,
    }

    fn named_of(
        report: &Report,
        with_bun_types: Option<&Report>,
        files: usize,
    ) -> Option<(Program, u32, u32)> {
        Some(
            match error_that_leaves_out(report, with_bun_types, files)? {
                LeavesOut::InOwnProgram(it) => (Program::Own, it.start, it.code),
                LeavesOut::OnlyWithBunTypes(it) => (Program::WithBunTypes, it.start, it.code),
            },
        )
    }

    fn named(report: &Report, with_bun_types: &Report) -> Option<(Program, u32, u32)> {
        named_of(report, Some(with_bun_types), 1)
    }

    #[test]
    fn the_program_with_the_types_of_bun_decides() {
        let report = judged(vec![error_at(5, 2339)]);
        assert_eq!(first_error(&report).map(|it| it.start), Some(5));
        // The types of Bun clear it.
        assert_eq!(named(&report, &judged(Vec::new())), None);
        // They have an error of their own, at another place: that one is named, as theirs.
        let other = judged(vec![error_at(9, 2741)]);
        let theirs = Some((Program::WithBunTypes, 9, 2741));
        assert_eq!(named(&report, &other), theirs);
        // What no build counts is no error: a name that is not declared.
        let not_declared = at(5, 2304, DiagnosticClass::MissingDeclaration);
        assert_eq!(named(&report, &judged(vec![not_declared.clone()])), None);
        assert!(first_error(&judged(vec![not_declared])).is_none());
        // That program was not asked, or is not to be had.
        assert_eq!(named_of(&report, None, 1), Some((Program::Own, 5, 2339)));
        // A text that passes its own check is written, whatever the other program says.
        assert_eq!(named(&judged(Vec::new()), &other), None);
    }

    #[test]
    fn an_error_of_both_programs_is_the_one_named() {
        // The types of Bun report an error of their own before the one that both have.
        let report = judged(vec![error_at(9, 2345)]);
        let with_bun_types = judged(vec![error_at(5, 2322), error_at(9, 2345)]);
        let of_both = Some((Program::Own, 9, 2345));
        assert_eq!(named(&report, &with_bun_types), of_both);
        // The types of Bun clear the first error, and word the second one in another way.
        let report = judged(vec![error_at(3, 2339), error_at(9, 2339)]);
        let with_bun_types = judged(vec![error_at(9, 2551)]);
        let worded_as_own = Some((Program::Own, 9, 2339));
        assert_eq!(named(&report, &with_bun_types), worded_as_own);
    }

    #[test]
    fn a_check_that_has_not_judged_every_file_clears_nothing() {
        let report = judged(vec![error_at(5, 2339)]);
        let own = Some((Program::Own, 5, 2339));
        assert_eq!(named(&report, &Report::default()), own);
        let incomplete = Report {
            incomplete: vec![Incomplete {
                path: FILE.to_vec(),
                is_nested_too_deeply: false,
                deepest_nesting: 0,
                nested_too_deeply_at: None,
            }],
            ..judged(Vec::new())
        };
        assert_eq!(named(&report, &incomplete), own);
        // Two files, and the check with the types of Bun got to one.
        assert_eq!(named_of(&report, Some(&judged(Vec::new())), 2), own);
        // It stopped at an error of syntax: that error is named.
        let stopped = Report {
            diagnostics: vec![at(7, 1109, DiagnosticClass::EarlyError)],
            ..Default::default()
        };
        let of_syntax = Some((Program::WithBunTypes, 7, 1109));
        assert_eq!(named(&report, &stopped), of_syntax);
    }
}
