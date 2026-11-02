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

pub(crate) fn count_files(
    statistics: &mut Statistics,
    view: ProgramView<'_, '_>,
    roles: &RoleDecision,
    in_parallel: InParallel<'_>,
) {
    let files = view.files();
    let mut counted_texts: Vec<(&[u8], u64)> = Vec::new();
    for index in 0..roles.roles.len() {
        let file = FileId(index as u32);
        let role = if files.is_compiled(file) {
            roles.role(file)
        } else {
            FileRole::TypesOnly
        };
        let statistic = statistic_of(view.origin(file), role, view.sources.is_data(file));
        statistics.count(statistic, 1);

        let has_counted_text = matches!(
            statistic,
            StatisticId::SourceFilesChecked
                | StatisticId::SourceFilesInferred
                | StatisticId::SourceFilesData
        );
        if has_counted_text {
            let text: &[u8] = &files.module(file).hir.text;
            statistics.count(StatisticId::SourceBytes, text.len() as u64);
            counted_texts.push((text, 0));
        }
    }
    for_each_mut(&mut counted_texts, in_parallel, &|(text, lines)| {
        *lines = count_lines(text)
    });
    let lines = counted_texts.iter().map(|&(_, lines)| lines).sum();
    statistics.count(StatisticId::SourceLines, lines);

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
