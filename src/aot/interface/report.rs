#[path = "../report/message.rs"]
pub mod message;

use bun_options_types::aot_options::{AotOptions, ExplainSet};
use bun_trim::{Decision, UsedFeatures};

pub use self::message::{
    ReportMessage, add_messages_to_log, is_json_report, is_message_report, write_lines,
};
use crate::Opaque;
use crate::engine::EngineResult;
use crate::link::ProgramNames;
use crate::linked;
use crate::statistics::Statistics;

pub struct SourceTexts(pub Opaque);

pub struct ReportEntry(pub Opaque);

impl ReportEntry {
    pub fn line(kind: ExplainSet, text: Vec<u8>) -> ReportEntry {
        linked::bun_aot_new_report_line(kind, text)
    }
}

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

pub fn write_summary(input: &ReportInput<'_>, out: &mut Vec<u8>) {
    linked::bun_aot_write_summary(input, out);
}

pub fn write_untyped_note(statistics: &Statistics, out: &mut Vec<u8>) {
    linked::bun_aot_write_untyped_note(statistics, out);
}

pub fn collect_entries(input: &ReportInput<'_>, kinds: ExplainSet) -> Vec<ReportEntry> {
    linked::bun_aot_collect_report_entries(input, kinds)
}

pub fn to_messages(texts: &SourceTexts, entries: &[ReportEntry]) -> Vec<ReportMessage> {
    linked::bun_aot_report_entries_to_messages(texts, entries)
}

pub mod obfuscation_map {
    use super::{EngineResult, ProgramNames, SourceTexts, linked};

    pub fn write(
        engine: &EngineResult,
        names: &ProgramNames,
        texts: &SourceTexts,
        file_name: &[u8],
    ) -> Vec<u8> {
        linked::bun_aot_write_obfuscation_map(engine, names, texts, file_name)
    }
}

pub mod build_report {
    use bun_options_types::aot_options::ReportDetail;

    use super::{ReportInput, linked};

    /// `build_id` is the digits that the build prints, where it wrote an executable.
    pub fn write(
        input: &ReportInput<'_>,
        detail: ReportDetail,
        build_id: Option<&[u8]>,
    ) -> Vec<u8> {
        linked::bun_aot_write_build_report(input, detail, build_id)
    }
}

pub mod registry {
    use super::linked;

    pub fn write() -> Vec<u8> {
        linked::bun_aot_write_registry()
    }
}
