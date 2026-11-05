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
use bun_aot_interface::report::message;
use bun_options_types::aot_options::{AotOptions, ExplainSet};
use bun_trim::{Decision, UsedFeatures};

pub use self::entry::{EntryNote, ReportEntry, to_messages};
pub(crate) use self::file_counts::count_files;
pub use self::levels::{
    AccessColumn, CostCounts, LevelCounts, ProgramTotals, SiteTotals, compute_totals,
};
pub use self::message::{
    ReportMessage, add_messages_to_log, is_json_report, is_message_report, write_lines,
};
pub use self::source_texts::{ModuleLocator, ModuleOrigin, ModuleSource, SourceTexts};
pub use self::summary::{write_summary, write_untyped_note};
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

pub const CAUSE_FAMILIES: ExplainSet = ExplainSet::ONLY_UNKNOWN_CODE
    .union(ExplainSet::ONLY_UNPROVEN_TYPE)
    .union(ExplainSet::ONLY_MUTATION);

#[optimize(size)]
pub fn collect_entries(input: &ReportInput<'_>, kinds: ExplainSet) -> Vec<ReportEntry> {
    let families = kinds & CAUSE_FAMILIES;
    let mut entries = Vec::new();

    if !families.is_empty() && !kinds.intersects(ExplainSet::TEXT | ExplainSet::JSON) {
        causes::collect_list(input, families, &mut entries);
    }
    if kinds.contains(ExplainSet::TEXT) {
        causes::collect_text(input, families, &mut entries);
        summary::collect_details(input, &mut entries);
    }
    if kinds.contains(ExplainSet::JSON) {
        causes::collect_json(input, families, &mut entries);
    }
    let collectors: [(ExplainSet, fn(&ReportInput<'_>, &mut Vec<ReportEntry>)); 6] = [
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
    if explain.intersects(ExplainSet::TEXT | ExplainSet::JSON | CAUSE_FAMILIES) {
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
    use crate::engine::{AccessRecord, SourceLocation, TypeTestRecord, Witness};
    use crate::ir::generated::{
        AccessCost, AccessKind, IllTypedCause, KnowledgeLevel, TypeTestFailure, UnprovenCause,
    };
    use crate::ir::ids::ABSENT_WORD;

    const PLACE: SourceLocation = SourceLocation {
        module: PROGRAM,
        position: LINE_1_COLUMN_5,
    };
    const WITNESS: Witness = Witness {
        function: ABSENT_WORD,
        value: ABSENT_WORD,
        location: PLACE,
    };
    const READ_OF_DELETED_FIELD: &[AccessRecord] = &[AccessRecord {
        location: PLACE,
        kind: AccessKind::Read,
        level: KnowledgeLevel::Unknown,
        cause: UnprovenCause::FieldDeleted,
        layout: ABSENT_WORD,
        copies: 1,
        witness: WITNESS,
        function: ABSENT_WORD,
        ill_typed_cause: IllTypedCause::None,
        cost: AccessCost::ByName,
        loop_depth: 0,
    }];
    const GUARD: &[TypeTestRecord] = &[TypeTestRecord {
        location: PLACE,
        function: ABSENT_WORD,
        failure: TypeTestFailure::Leaves,
        copies: 1,
        cause: UnprovenCause::FieldDeleted,
        ill_typed_cause: IllTypedCause::None,
        layout: ABSENT_WORD,
        witness: WITNESS,
    }];

    fn collected_kinds(kinds: ExplainSet) -> Vec<ExplainSet> {
        let fixture = ReportFixture::new(ResultRecords {
            accesses: READ_OF_DELETED_FIELD,
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
    fn families_alone_list_their_causes() {
        assert_eq!(
            collected_kinds(ExplainSet::ONLY_MUTATION),
            [ExplainSet::ONLY_MUTATION]
        );
        assert_eq!(collected_kinds(CAUSE_FAMILIES), [ExplainSet::ONLY_MUTATION]);
        assert!(collected_kinds(ExplainSet::ONLY_UNKNOWN_CODE).is_empty());
        assert_eq!(
            collected_kinds(ExplainSet::ONLY_MUTATION | ExplainSet::FORMS),
            [ExplainSet::ONLY_MUTATION, ExplainSet::FORMS]
        );
    }

    #[test]
    fn families_beside_text_or_json_only_filter_it() {
        for report in [ExplainSet::TEXT, ExplainSet::JSON] {
            assert_eq!(
                collected_kinds(report | ExplainSet::ONLY_MUTATION),
                [report]
            );
        }
    }

    #[test]
    fn empty_set_collects_nothing() {
        assert!(collected_kinds(ExplainSet::empty()).is_empty());
    }
}
