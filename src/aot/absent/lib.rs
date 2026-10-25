//! The functions that `bun_aot_interface` declares, in a Bun that is built without the ahead-of-time compiler.
//! `engine::has_compiler()` is false in such a Bun, and every road to the compiler asks it first.

use bun_aot_interface::compile::{BuildFailed, Compilation};
use bun_aot_interface::diagnostic_codes::Code;
use bun_aot_interface::engine::{EngineModuleId, EngineResult, RejectedOptionWord};
use bun_aot_interface::link::ProgramNames;
use bun_aot_interface::options::Options;
use bun_aot_interface::report::{ReportEntry, ReportInput, ReportMessage, SourceTexts};
use bun_aot_interface::statistics::{StatisticId, Statistics};
use bun_aot_interface::{Opaque, SourceProvider};
use bun_ast::Log;
use bun_options_types::aot_options::{ExplainSet, ReportDetail};
use bun_sema::atom::Interner;
use bun_sema::check::aot::NamedValues;
use bun_sema::hir_from_data::DataValue;
use bun_sema::program::Files;
use bun_sema::session::Arena;
use bun_trim::UsedFeatures;

#[cold]
#[inline(never)]
fn absent() -> ! {
    panic!("this build of Bun has no ahead-of-time compiler")
}

bun_aot_interface::define_linked_functions! {
    fn bun_aot_compile(_options: &Options<'_>, _provider: &dyn SourceProvider, _log: &mut Log) -> Result<Compilation, BuildFailed> { absent() }
    fn bun_aot_log_diagnostic(_log: &mut Log, _code: Code, _arguments: &[&[u8]]) { absent() }
    fn bun_aot_parse_json<'s>(_text: &[u8], _arena: &'s Arena, _atoms: &Interner<'s>) -> Option<&'s DataValue<'s>> { absent() }
    fn bun_aot_check_option_word(_earlier_words: &[Box<[u8]>], _word: &[u8]) -> Result<(), RejectedOptionWord> { Ok(()) }
    fn bun_aot_used_features(_result: &EngineResult) -> UsedFeatures { absent() }
    fn bun_aot_image(_result: &EngineResult) -> Option<&[u8]> { absent() }
    fn bun_aot_entry_module_ids(_result: &EngineResult) -> &[EngineModuleId] { absent() }
    fn bun_aot_symbols(_result: &EngineResult) -> &[u8] { absent() }
    fn bun_aot_new_statistics() -> Statistics { Statistics(Opaque::new(())) }
    fn bun_aot_statistic(_statistics: &Statistics, _id: StatisticId) -> u64 { 0 }
    fn bun_aot_new_report_line(_kind: ExplainSet, _text: Vec<u8>) -> ReportEntry { absent() }
    fn bun_aot_write_summary(_input: &ReportInput<'_>, _out: &mut Vec<u8>) { absent() }
    fn bun_aot_write_untyped_note(_statistics: &Statistics, _out: &mut Vec<u8>) { absent() }
    fn bun_aot_collect_report_entries(_input: &ReportInput<'_>, _kinds: ExplainSet) -> Vec<ReportEntry> { absent() }
    fn bun_aot_report_entries_to_messages(_texts: &SourceTexts, _entries: &[ReportEntry]) -> Vec<ReportMessage> { absent() }
    fn bun_aot_write_obfuscation_map(_engine: &EngineResult, _names: &ProgramNames, _texts: &SourceTexts, _file_name: &[u8], _debug_id: Option<&[u8]>) -> Vec<u8> { absent() }
    fn bun_aot_write_build_report(_input: &ReportInput<'_>, _detail: ReportDetail, _build_id: Option<&[u8]>) -> Vec<u8> { absent() }
    fn bun_aot_write_registry() -> Vec<u8> { absent() }
    fn bun_aot_unlinked_named_values<'a, 's>(_files: &'a Files<'s>, _atoms: &Interner<'s>) -> Box<dyn NamedValues + 'a> { absent() }
}
