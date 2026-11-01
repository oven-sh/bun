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
pub use crate::linked::{
    bun_aot_collect_report_entries as collect_entries,
    bun_aot_report_entries_to_messages as to_messages, bun_aot_write_summary as write_summary,
    bun_aot_write_untyped_note as write_untyped_note,
};
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

pub mod obfuscation_map {
    pub use crate::linked::bun_aot_write_obfuscation_map as write;
}

pub mod build_report {
    // `build_id` is the digits that the build prints, where it wrote an executable.
    pub use crate::linked::bun_aot_write_build_report as write;
}

pub mod registry {
    pub use crate::linked::bun_aot_write_registry as write;
}
