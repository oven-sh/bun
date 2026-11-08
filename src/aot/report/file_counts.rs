use bun_core::strings::count_char;
use bun_sema::check::aot::FileOrigin;
use bun_sema::program::{FileId, FileRole};
use bun_sema_driver::RoleDecision;

use crate::diagnostics::ProgramView;
use crate::ir::parallel::{InParallel, for_each_mut};
use crate::statistics::{StatisticId, Statistics};

fn statistic_of(origin: FileOrigin, role: FileRole, is_data: bool) -> StatisticId {
    match (origin, role, is_data) {
        (_, FileRole::TypesOnly, _) => StatisticId::SourceFilesTypesOnly,
        (FileOrigin::Runtime, FileRole::Checked | FileRole::Inferred, _) => {
            StatisticId::SourceFilesRuntime
        }
        (_, FileRole::Checked | FileRole::Inferred, true) => StatisticId::SourceFilesData,
        (_, FileRole::Checked, false) => StatisticId::SourceFilesChecked,
        (_, FileRole::Inferred, false) => StatisticId::SourceFilesInferred,
    }
}

fn count_lines(text: &[u8]) -> u64 {
    let line_breaks = count_char(text, b'\n') as u64;
    match text.last() {
        None | Some(b'\n') => line_breaks,
        Some(_) => line_breaks + 1,
    }
}

fn sizes_of(statistic: StatisticId, origin: FileOrigin) -> &'static [(StatisticId, StatisticId)] {
    const PROGRAM: (StatisticId, StatisticId) =
        (StatisticId::SourceBytes, StatisticId::SourceLines);
    const PACKAGES: (StatisticId, StatisticId) = (
        StatisticId::SourceBytesOfPackages,
        StatisticId::SourceLinesOfPackages,
    );
    match (statistic, origin) {
        (StatisticId::SourceFilesTypesOnly, _) => &[(
            StatisticId::SourceBytesOfDeclarations,
            StatisticId::SourceLinesOfDeclarations,
        )],
        (StatisticId::SourceFilesRuntime, _) => {
            &[(StatisticId::SourceBytesOfBun, StatisticId::SourceLinesOfBun)]
        }
        (_, FileOrigin::DependencySource | FileOrigin::DependencyJavaScript) => {
            &[PROGRAM, PACKAGES]
        }
        _ => &[PROGRAM],
    }
}

pub(crate) fn count_files(
    statistics: &mut Statistics,
    view: ProgramView<'_, '_>,
    roles: &RoleDecision,
    in_parallel: InParallel<'_>,
) {
    let files = view.files();
    let mut counted_texts: Vec<(&[u8], u64, &[(StatisticId, StatisticId)])> = Vec::new();
    for index in 0..roles.roles.len() {
        let file = FileId(index as u32);
        let role = if files.is_compiled(file) {
            roles.role(file)
        } else {
            FileRole::TypesOnly
        };
        let origin = view.origin(file);
        let statistic = statistic_of(origin, role, view.sources.is_data(file));
        statistics.count(statistic, 1);
        let text: &[u8] = &files.module(file).hir.text;
        counted_texts.push((text, 0, sizes_of(statistic, origin)));
    }
    for_each_mut(&mut counted_texts, in_parallel, &|(text, lines, _)| {
        *lines = count_lines(text)
    });
    for &(text, lines, sizes) in &counted_texts {
        for &(bytes_of_kind, lines_of_kind) in sizes {
            statistics.count(bytes_of_kind, text.len() as u64);
            statistics.count(lines_of_kind, lines);
        }
    }

    let demoted_files = roles.demoted.iter().map(|demotion| demotion.file);
    let demoted_count = demoted_files
        .filter(|&file| {
            !matches!(
                view.origin(file),
                FileOrigin::Runtime | FileOrigin::EvaluatedText
            )
        })
        .count();
    statistics.count(StatisticId::SourceFilesDemoted, demoted_count as u64);
}

#[cfg(test)]
mod tests;
