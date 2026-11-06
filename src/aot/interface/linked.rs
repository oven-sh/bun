use bun_ast::Log;
use bun_options_types::aot_options::{ExplainSet, ReportDetail};
use bun_sema::atom::Interner;
use bun_sema::check::aot::NamedValues;
use bun_sema::hir_from_data::DataValue;
use bun_sema::program::Files;
use bun_sema::session::Arena;
use bun_trim::UsedFeatures;

use crate::compile::{BuildFailed, Compilation};
use crate::diagnostic_codes::Code;
use crate::engine::{EngineModuleId, EngineResult, RejectedOptionWord};
use crate::link::ProgramNames;
use crate::load::source_provider::SourceProvider;
use crate::options::Options;
use crate::report::{ReportEntry, ReportInput, ReportMessage, SourceTexts};
use crate::statistics::{StatisticId, Statistics};

macro_rules! linked_functions {
    ($($visibility:vis fn $name:ident $(<$($lifetime:lifetime),*>)? ($($argument:ident: $type:ty),* $(,)?) $(-> $result:ty)?;)*) => {
        unsafe extern "Rust" {
            $($visibility safe fn $name $(<$($lifetime),*>)? ($($argument: $type),*) $(-> $result)?;)*
        }

        #[allow(non_camel_case_types)]
        pub mod signatures {
            use super::*;

            $(pub type $name = $(for<$($lifetime),*>)? fn($($type),*) $(-> $result)?;)*
        }
    };
}

#[macro_export]
macro_rules! define_linked_functions {
    ($(fn $name:ident $(<$($lifetime:lifetime),*>)? ($($argument:ident: $type:ty),* $(,)?) $(-> $result:ty)? $body:block)*) => {$(
        #[unsafe(no_mangle)]
        #[inline(never)]
        fn $name $(<$($lifetime),*>)? ($($argument: $type),*) $(-> $result)? $body

        const _: $crate::signatures::$name = $name;
    )*};
}

linked_functions! {
    pub fn bun_aot_compile(options: &Options<'_>, provider: &dyn SourceProvider, log: &mut Log) -> Result<Compilation, BuildFailed>;
    pub fn bun_aot_log_diagnostic(log: &mut Log, code: Code, arguments: &[&[u8]]);
    pub(crate) fn bun_aot_parse_json<'s>(text: &[u8], arena: &'s Arena, atoms: &Interner<'s>) -> Option<&'s DataValue<'s>>;
    pub fn bun_aot_check_option_word(earlier_words: &[Box<[u8]>], word: &[u8]) -> Result<(), RejectedOptionWord>;
    pub fn bun_aot_used_features(result: &EngineResult) -> UsedFeatures;
    pub(crate) fn bun_aot_image(result: &EngineResult) -> Option<&[u8]>;
    pub(crate) fn bun_aot_entry_module_ids(result: &EngineResult) -> &[EngineModuleId];
    pub(crate) fn bun_aot_symbols(result: &EngineResult) -> &[u8];
    pub(crate) fn bun_aot_new_statistics() -> Statistics;
    pub(crate) fn bun_aot_statistic(statistics: &Statistics, id: StatisticId) -> u64;
    pub(crate) fn bun_aot_new_report_line(kind: ExplainSet, text: Vec<u8>) -> ReportEntry;
    pub fn bun_aot_write_summary(input: &ReportInput<'_>, out: &mut Vec<u8>);
    pub fn bun_aot_write_untyped_note(statistics: &Statistics, out: &mut Vec<u8>);
    pub fn bun_aot_collect_report_entries(input: &ReportInput<'_>, kinds: ExplainSet) -> Vec<ReportEntry>;
    pub fn bun_aot_report_entries_to_messages(texts: &SourceTexts, entries: &[ReportEntry]) -> Vec<ReportMessage>;
    pub fn bun_aot_write_obfuscation_map(engine: &EngineResult, names: &ProgramNames, texts: &SourceTexts, file_name: &[u8], debug_id: Option<&[u8]>) -> Vec<u8>;
    pub fn bun_aot_write_build_report(input: &ReportInput<'_>, detail: ReportDetail, build_id: Option<&[u8]>) -> Vec<u8>;
    pub fn bun_aot_write_registry() -> Vec<u8>;
    pub fn bun_aot_unlinked_named_values<'a, 's>(files: &'a Files<'s>, atoms: &Interner<'s>) -> Box<dyn NamedValues + 'a>;
}
