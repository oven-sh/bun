pub mod build_report;
pub mod obfuscation_map;
pub mod registry;

mod allocations;
mod causes;
mod declines;
mod entry;
mod file_counts;
mod format;
mod json;
mod levels;
#[cfg(test)]
mod message;
mod model;
mod positions;
mod remaining_checks;
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
pub use self::source_texts::{ModuleLocator, ModuleSource, SourceTexts};
pub use self::summary::{write_summary, write_untyped_note};
use crate::engine::EngineResult;
use crate::link::ProgramNames;
use crate::statistics::Statistics;

#[derive(Copy, Clone)]
pub struct ReportInput<'a> {
    pub engine: &'a EngineResult,
    pub names: &'a ProgramNames,
    pub texts: &'a SourceTexts,
    pub statistics: &'a Statistics,
    pub options: &'a AotOptions,
    pub used_features: &'a UsedFeatures,
    pub decision: Option<&'a Decision>,
}

pub const CAUSE_FAMILIES: ExplainSet = ExplainSet::ONLY_UNKNOWN_CODE
    .union(ExplainSet::ONLY_UNPROVEN_TYPE)
    .union(ExplainSet::ONLY_MUTATION)
    .union(ExplainSet::ONLY_LIMIT);

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
        (ExplainSet::CHECKS, remaining_checks::collect_text),
        (ExplainSet::CHECKS_JSON, remaining_checks::collect_json),
        (ExplainSet::RUNTIME_USE, runtime_use::collect),
        (ExplainSet::DECLINES, declines::collect),
        (ExplainSet::ALLOCATIONS, allocations::collect),
        (ExplainSet::STATISTICS, statistics::collect),
    ];
    for (kind, collect) in collectors {
        if kinds.contains(kind) {
            collect(input, &mut entries);
        }
    }
    entries
}
