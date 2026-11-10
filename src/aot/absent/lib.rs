use bun_aot_interface::compile::{BuildFailed, Compilation};
use bun_aot_interface::diagnostic_codes::Code;
use bun_aot_interface::engine::{EngineModuleId, EngineResult, RejectedOptionWord};
use bun_aot_interface::options::Options;
use bun_aot_interface::report::{
    ReportEntry, ReportInput, ReportMessage, SourceChanged, SourceTexts,
};
use bun_aot_interface::statistics::{StatisticId, Statistics};
use bun_aot_interface::{Opaque, SourceProvider};
use bun_ast::Log;
use bun_options_types::aot_options::ExplainSet;
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
    fn bun_aot_image_mut_and_symbols(_result: &mut EngineResult) -> (Option<&mut [u8]>, &[u8]) { absent() }
    fn bun_aot_entry_module_ids(_result: &EngineResult) -> &[EngineModuleId] { absent() }
    fn bun_aot_new_statistics() -> Statistics { Statistics(Opaque::new(())) }
    fn bun_aot_statistic(_statistics: &Statistics, _id: StatisticId) -> u64 { 0 }
    fn bun_aot_log_time_outside_stages(_name: &str) { absent() }
    fn bun_aot_log_part_outside_stages(_name: &str) { absent() }
    fn bun_aot_new_report_line(_kind: ExplainSet, _text: Vec<u8>) -> ReportEntry { absent() }
    fn bun_aot_write_summary(_input: &ReportInput<'_>, _out: &mut Vec<u8>) { absent() }
    fn bun_aot_write_developer_options(_option_words: &[Box<[u8]>], _out: &mut Vec<u8>) { absent() }
    fn bun_aot_write_untyped_note(_statistics: &Statistics, _out: &mut Vec<u8>) { absent() }
    fn bun_aot_collect_report_entries(_input: &ReportInput<'_>, _kinds: ExplainSet) -> Vec<ReportEntry> { absent() }
    fn bun_aot_report_entries_to_messages(_texts: &SourceTexts, _entries: &[ReportEntry]) -> Vec<ReportMessage> { absent() }
    fn bun_aot_write_obfuscation_map(_engine: &EngineResult, _texts: &SourceTexts, _file_name: &[u8], _debug_id: Option<&[u8]>) -> Result<Vec<u8>, SourceChanged> { absent() }
    fn bun_aot_globals_that_a_window_replaces() -> Vec<u32> { Vec::new() }
    fn bun_aot_lists_laid_anew_between_test_files() -> Vec<u32> { Vec::new() }
    fn bun_aot_imports_vitest(_path: &[u8], _text: &[u8]) -> bool { absent() }
    fn bun_aot_find_importers_outside_run(_root: &[u8], _files: &[Vec<u8>], _is_compiled: &(dyn Fn(&[u8]) -> bool + Sync)) -> Vec<Option<Vec<u8>>> { absent() }
    fn bun_aot_name_values_of_unlinked_files<'a>(_files: &'a Files<'_>) -> Box<dyn NamedValues + 'a> { absent() }
}
