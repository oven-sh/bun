#[cfg(test)]
pub mod build_rows;
pub mod obfuscation_map;

mod allocations;
mod causes;
mod code_forms;
mod entry;
mod file_counts;
mod format;
mod guards;
mod json;
mod levels;
#[cfg(test)]
mod message;
mod model;
mod names;
mod positions;
mod runtime_use;
mod source_texts;
mod statistics;
mod summary;
#[cfg(test)]
pub(super) mod testing;
mod wording;

#[cfg(not(test))]
use bun_aot_interface::report::{build_rows, message};
use bun_options_types::aot_options::{AotOptions, ExplainSet};
use bun_trim::{Decision, UsedFeatures};

pub use self::entry::{ReportEntry, to_messages};
pub(crate) use self::file_counts::count_files;
pub use self::levels::{
    AccessColumn, CostCounts, LevelCounts, ProgramTotals, SiteTotals, compute_totals,
};
pub use self::message::{
    ReportMessage, add_messages_to_log, is_json_report, is_message_report, write_lines,
};
pub use self::source_texts::{
    FunctionSources, ModuleLocator, ModuleOrigin, ModuleSource, SourceTexts,
};
pub use self::summary::{write_developer_options, write_summary};
use crate::engine::EngineResult;
use crate::ir::generated::ReportSet;
use crate::statistics::Statistics;

#[derive(Copy, Clone)]
pub struct ReportInput<'a> {
    pub engine: &'a EngineResult,
    pub texts: &'a SourceTexts,
    pub statistics: &'a Statistics,
    pub options: &'a AotOptions,
    pub used_features: &'a UsedFeatures,
    pub decision: Option<&'a Decision>,
}

#[optimize(size)]
pub fn collect_entries(input: &ReportInput<'_>, kinds: ExplainSet) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    let collectors: [(ExplainSet, fn(&ReportInput<'_>, &mut Vec<ReportEntry>)); 9] = [
        (ExplainSet::TEXT, causes::collect_text),
        (ExplainSet::TEXT, summary::collect_details),
        (ExplainSet::JSON, causes::collect_json),
        (ExplainSet::CHECKS, guards::collect_text),
        (ExplainSet::CHECKS_JSON, guards::collect_json),
        (ExplainSet::RUNTIME_USE, runtime_use::collect),
        (ExplainSet::ALLOCATIONS, allocations::collect),
        (ExplainSet::FORMS, code_forms::collect),
        (ExplainSet::STATISTICS, statistics::collect),
    ];
    for (kind, collect) in collectors {
        if kinds.contains(kind) {
            collect(input, &mut entries);
        }
    }
    entries
}

pub(crate) fn engine_reports_for(explain: ExplainSet) -> ReportSet {
    let mut reports = ReportSet::default();
    if explain.intersects(ExplainSet::TEXT | ExplainSet::JSON) {
        reports |= ReportSet::FLOW | ReportSet::ACCESS_COUNTS;
    }
    if explain.intersects(ExplainSet::CHECKS | ExplainSet::CHECKS_JSON | ExplainSet::FORMS) {
        reports |= ReportSet::FLOW;
    }
    if explain.contains(ExplainSet::STATISTICS) {
        reports |= ReportSet::ACCESS_COUNTS;
    }
    if explain.contains(ExplainSet::RUNTIME_USE) {
        reports |= ReportSet::USES;
    }
    if explain.contains(ExplainSet::ALLOCATIONS) {
        reports |= ReportSet::ALLOCATIONS;
    }
    reports
}

#[cfg(test)]
mod tests {
    use super::testing::{LINE_1_COLUMN_5, PROGRAM, ReportFixture};
    use super::*;
    use crate::engine::testing::ResultRecords;
    use crate::engine::{AccessRecord, SourceLocation, TypeTestRecord};
    use crate::ir::generated::{
        AccessCost, AccessKind, KnowledgeLevel, TypeTestFailure, UnprovenCause,
    };
    use crate::ir::ids::ABSENT_WORD;

    const PLACE: SourceLocation = SourceLocation {
        module: PROGRAM,
        position: LINE_1_COLUMN_5,
    };
    const OPERATOR_ON_UNKNOWN_VALUE: &[AccessRecord] = &[AccessRecord {
        location: PLACE,
        kind: AccessKind::Arithmetic,
        level: KnowledgeLevel::Unknown,
        cause: UnprovenCause::Untracked,
        layout: ABSENT_WORD,
        copies: 1,
        function: ABSENT_WORD,
        cost: AccessCost::ByName,
        loop_depth: 0,
        origin: ABSENT_WORD,
        has_other_origins: 0,
    }];
    const GUARD: &[TypeTestRecord] = &[TypeTestRecord {
        location: PLACE,
        function: ABSENT_WORD,
        failure: TypeTestFailure::ExitsToSlowVersion,
        copies: 1,
        layout: ABSENT_WORD,
    }];

    fn collected_kinds(kinds: ExplainSet) -> Vec<ExplainSet> {
        let fixture = ReportFixture::new(ResultRecords {
            accesses: OPERATOR_ON_UNKNOWN_VALUE,
            type_tests: GUARD,
            ..ResultRecords::default()
        });
        let entries = fixture.with_input(|input| collect_entries(input, kinds));
        let mut collected: Vec<ExplainSet> = entries.iter().map(|entry| entry.kind).collect();
        collected.dedup();
        collected
    }

    #[test]
    fn reports_come_in_a_fixed_order() {
        assert_eq!(
            collected_kinds(ExplainSet::all()),
            [
                ExplainSet::TEXT,
                ExplainSet::JSON,
                ExplainSet::CHECKS,
                ExplainSet::CHECKS_JSON,
                ExplainSet::RUNTIME_USE,
                ExplainSet::ALLOCATIONS,
                ExplainSet::FORMS,
                ExplainSet::STATISTICS,
            ]
        );
    }

    #[test]
    fn empty_set_collects_nothing() {
        assert!(collected_kinds(ExplainSet::empty()).is_empty());
    }
}
