use bun_sema_driver::{Demotion, DemotionCause};

use super::*;
use crate::compile::testing::{default_settings, with_loaded_build, with_project_view};
use crate::load::ProjectId;

const MAIN: &str = "import \"./b.js\";\nexport const a = 1;\n";
const IMPORTED: &str = "export {};";
const FILES: [(&str, &str); 2] = [("a.ts", MAIN), ("b.js", IMPORTED)];
const COMPILED_ROLES: [FileRole; 2] = [FileRole::Checked, FileRole::Inferred];

fn origins_outside_runtime() -> impl Iterator<Item = FileOrigin> {
    let origins = FileOrigin::ALL.into_iter();
    origins.filter(|&origin| origin != FileOrigin::Runtime)
}

fn role_decision(view: ProgramView<'_, '_>, demoted: &[FileId]) -> RoleDecision {
    let files = view.files();
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    let cause = DemotionCause::TypeError;
    RoleDecision {
        roles: file_ids.map(|file| files.role(file)).collect(),
        demoted: demoted
            .iter()
            .map(|&file| Demotion { file, cause })
            .collect(),
        checked: Vec::new(),
        diagnostics: Vec::new(),
        incomplete: Vec::new(),
    }
}

fn count(view: ProgramView<'_, '_>, roles: &RoleDecision) -> Statistics {
    let mut statistics = Statistics::default();
    count_files(
        &mut statistics,
        view,
        roles,
        &crate::ir::parallel::run_serially,
    );
    statistics
}

fn file_at(view: ProgramView<'_, '_>, suffix: &str) -> FileId {
    let files = view.files();
    let mut compiled_files = files.compiled_files().iter().copied();
    compiled_files
        .find(|&file| files.module(file).file_name().ends_with(suffix.as_bytes()))
        .unwrap_or_else(|| panic!("{suffix} is not compiled"))
}

#[test]
fn types_only_role_decides_before_origin() {
    for origin in FileOrigin::ALL {
        for is_data in [false, true] {
            assert_eq!(
                statistic_of(origin, FileRole::TypesOnly, is_data),
                StatisticId::SourceFilesTypesOnly,
                "{origin:?}"
            );
        }
    }
}

#[test]
fn runtime_origin_decides_before_data() {
    for role in COMPILED_ROLES {
        for is_data in [false, true] {
            assert_eq!(
                statistic_of(FileOrigin::Runtime, role, is_data),
                StatisticId::SourceFilesRuntime,
                "{role:?}"
            );
        }
    }
}

#[test]
fn data_files_count_apart_from_roles() {
    for origin in origins_outside_runtime() {
        for role in COMPILED_ROLES {
            assert_eq!(
                statistic_of(origin, role, true),
                StatisticId::SourceFilesData,
                "{origin:?} {role:?}"
            );
        }
    }
}

#[test]
fn source_files_count_by_role() {
    for origin in origins_outside_runtime() {
        assert_eq!(
            statistic_of(origin, FileRole::Checked, false),
            StatisticId::SourceFilesChecked,
            "{origin:?}"
        );
        assert_eq!(
            statistic_of(origin, FileRole::Inferred, false),
            StatisticId::SourceFilesInferred,
            "{origin:?}"
        );
    }
}

#[test]
fn last_line_needs_no_line_break() {
    assert_eq!(count_lines(b""), 0);
    assert_eq!(count_lines(b"a"), 1);
    assert_eq!(count_lines(b"a\n"), 1);
    assert_eq!(count_lines(b"a\nb"), 2);
    assert_eq!(count_lines(b"\n"), 1);
    assert_eq!(count_lines(b"a\n\n"), 2);
    assert_eq!(count_lines(b"a\r\nb\r\n"), 2);
}

#[test]
fn text_of_compiled_sources_is_counted() {
    with_project_view(&FILES, |view| {
        let statistics = count(view, &role_decision(view, &[]));
        assert_eq!(statistics.get(StatisticId::SourceFilesChecked), 1);
        assert_eq!(statistics.get(StatisticId::SourceFilesInferred), 1);
        assert_eq!(
            statistics.get(StatisticId::SourceBytes),
            (MAIN.len() + IMPORTED.len()) as u64
        );
        assert_eq!(statistics.get(StatisticId::SourceLines), 3);
        assert_eq!(statistics.get(StatisticId::SourceFilesDemoted), 0);
    });
}

#[test]
fn file_that_is_not_compiled_counts_as_types_only() {
    with_project_view(&FILES, |view| {
        let mut roles = role_decision(view, &[]);
        roles.roles.fill(FileRole::Checked);
        let statistics = count(view, &roles);
        let file_count = view.files().modules.len() as u64;
        assert!(file_count > 2);
        assert_eq!(statistics.get(StatisticId::SourceFilesChecked), 2);
        assert_eq!(
            statistics.get(StatisticId::SourceFilesTypesOnly),
            file_count - 2
        );
    });
}

#[test]
fn demoted_files_are_counted() {
    with_project_view(&FILES, |view| {
        let demoted = [file_at(view, "a.ts"), file_at(view, "b.js")];
        let count_demoted = |demoted: &[FileId]| {
            let statistics = count(view, &role_decision(view, demoted));
            statistics.get(StatisticId::SourceFilesDemoted)
        };
        assert_eq!(count_demoted(&demoted[..1]), 1);
        assert_eq!(count_demoted(&demoted), 2);
    });
}

#[test]
fn evaluated_text_with_early_error_is_not_a_demoted_file() {
    let files = [(
        "a.js",
        "export const create = () => new Function(\"break;\");\n",
    )];
    with_project_view(&files, |view| {
        let mut compiled_files = view.files().compiled_files().iter().copied();
        let text = compiled_files.find(|&file| view.origin(file) == FileOrigin::EvaluatedText);
        let text = text.expect("the text given to Function is a file");
        let mut roles = role_decision(view, &[]);
        roles.demoted.push(Demotion {
            file: text,
            cause: DemotionCause::EarlyError,
        });
        let statistics = count(view, &roles);
        assert_eq!(statistics.get(StatisticId::SourceFilesDemoted), 0);
    });
}

#[test]
fn runtime_project_adds_neither_text_nor_demotions() {
    with_loaded_build(&FILES, &default_settings(), |_, loaded| {
        let view = loaded.project(ProjectId::Runtime).view();
        let compiled_files = view.files().compiled_files();
        assert!(!compiled_files.is_empty());
        let statistics = count(view, &role_decision(view, compiled_files));
        assert_eq!(
            statistics.get(StatisticId::SourceFilesRuntime),
            compiled_files.len() as u64
        );
        for absent in [
            StatisticId::SourceFilesChecked,
            StatisticId::SourceFilesInferred,
            StatisticId::SourceFilesData,
            StatisticId::SourceBytes,
            StatisticId::SourceLines,
            StatisticId::SourceFilesDemoted,
        ] {
            assert_eq!(statistics.get(absent), 0, "{absent:?}");
        }
    });
}
