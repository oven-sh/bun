use bun_aot_interface as interface;
use bun_aot_interface::{Opaque, signatures};
use bun_ast::Log;
use bun_options_types::aot_options::{ExplainSet, ReportDetail};
use bun_sema::atom::Interner;
use bun_sema::check::aot::NamedValues;
use bun_sema::hir_from_data::DataValue;
use bun_sema::program::Files;
use bun_sema::session::Arena;
use bun_trim::UsedFeatures;

use crate::builtins::unlinked_files::UnlinkedFiles;
use crate::compile::{BuildFailed, Compilation, compile};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{InternalError, log_diagnostic, log_internal_error};
use crate::engine::{self, EngineModuleId, EngineResult, RejectedOptionWord};
use crate::load::data_modules::parse_json;
use crate::load::source_provider::SourceProvider;
use crate::options::Options;
use crate::report::{self, ReportEntry, ReportInput, ReportMessage};
use crate::statistics::{StatisticId, Statistics};

macro_rules! linked_functions {
    ($(fn $name:ident $(<$($lifetime:lifetime),*>)? ($($argument:ident: $type:ty),* $(,)?) $(-> $result:ty)? $body:block)*) => {$(
        #[unsafe(no_mangle)]
        #[inline(never)]
        fn $name $(<$($lifetime),*>)? ($($argument: $type),*) $(-> $result)? $body

        const _: signatures::$name = $name;
    )*};
}

fn wrap_statistics(statistics: Statistics) -> interface::statistics::Statistics {
    interface::statistics::Statistics(Opaque::new(statistics))
}

fn wrap_compilation(compilation: Compilation) -> interface::Compilation {
    let Compilation {
        engine,
        summary,
        further_programs,
        ..
    } = compilation;
    let wrap_engine = |engine| interface::engine::EngineResult(Opaque::new(engine));
    let entry_points = summary.entry_points.into_iter();
    let folders = summary.folders.into_iter();
    interface::Compilation {
        engine: wrap_engine(engine),
        further_programs: further_programs.into_iter().map(wrap_engine).collect(),
        summary: interface::compile::ProgramSummary {
            entry_points: entry_points
                .map(|entry| interface::compile::EntryPointPaths {
                    public_path: entry.public_path,
                    source_path: entry.source_path,
                })
                .collect(),
            folders: folders
                .map(|folder| interface::compile::FolderPaths {
                    public_path: folder.public_path,
                    source_path: folder.source_path,
                })
                .collect(),
            names: interface::link::ProgramNames(Opaque::new(summary.names)),
            texts: interface::report::SourceTexts(Opaque::new(summary.texts)),
            statistics: wrap_statistics(summary.statistics),
            validates_by_type: summary.validates_by_type,
            modules: summary.modules,
        },
    }
}

fn wrap_failure(failure: BuildFailed) -> interface::BuildFailed {
    interface::BuildFailed {
        stage: failure.stage,
        is_internal_error: failure.is_internal_error,
        statistics: wrap_statistics(failure.statistics),
        compilation: failure
            .compilation
            .map(|compilation| Box::new(wrap_compilation(*compilation))),
        refused_entry_points: failure.refused_entry_points,
    }
}

fn unwrap_input<'a>(input: &interface::report::ReportInput<'a>) -> ReportInput<'a> {
    ReportInput {
        engine: input.engine.0.get(),
        names: input.names.0.get(),
        texts: input.texts.0.get(),
        statistics: input.statistics.0.get(),
        options: input.options,
        used_features: input.used_features,
        decision: input.decision,
    }
}

fn wrap_entry(entry: ReportEntry) -> interface::report::ReportEntry {
    interface::report::ReportEntry(Opaque::new(entry))
}

linked_functions! {
    fn bun_aot_compile(options: &Options<'_>, provider: &dyn SourceProvider, log: &mut Log) -> Result<interface::Compilation, interface::BuildFailed> {
        compile(options, provider, log).map(wrap_compilation).map_err(wrap_failure)
    }

    fn bun_aot_log_diagnostic(log: &mut Log, code: Code, arguments: &[&[u8]]) {
        log_diagnostic(log, code, arguments);
    }

    fn bun_aot_log_internal_error(log: &mut Log, error: InternalError) {
        log_internal_error(log, error);
    }

    fn bun_aot_parse_json<'s>(text: &[u8], arena: &'s Arena, atoms: &Interner<'s>) -> Option<&'s DataValue<'s>> {
        parse_json(text, arena, atoms)
    }

    fn bun_aot_check_option_word(earlier_words: &[Box<[u8]>], word: &[u8]) -> Result<(), RejectedOptionWord> {
        engine::check_option_word(earlier_words, word)
    }

    fn bun_aot_used_features(result: &interface::engine::EngineResult) -> UsedFeatures {
        engine::used_features(result.0.get())
    }

    fn bun_aot_image(result: &interface::engine::EngineResult) -> Option<&[u8]> {
        result.0.get::<EngineResult>().image()
    }

    fn bun_aot_entry_module_ids(result: &interface::engine::EngineResult) -> &[EngineModuleId] {
        result.0.get::<EngineResult>().entry_module_ids()
    }

    fn bun_aot_symbols(result: &interface::engine::EngineResult) -> &[u8] {
        result.0.get::<EngineResult>().symbols()
    }

    fn bun_aot_new_statistics() -> interface::statistics::Statistics {
        wrap_statistics(Statistics::default())
    }

    fn bun_aot_statistic(statistics: &interface::statistics::Statistics, id: StatisticId) -> u64 {
        statistics.0.get::<Statistics>().get(id)
    }

    fn bun_aot_new_report_line(kind: ExplainSet, text: Vec<u8>) -> interface::report::ReportEntry {
        wrap_entry(ReportEntry::line(kind, text))
    }

    fn bun_aot_write_summary(input: &interface::report::ReportInput<'_>, out: &mut Vec<u8>) {
        report::write_summary(&unwrap_input(input), out);
    }

    fn bun_aot_write_untyped_note(statistics: &interface::statistics::Statistics, out: &mut Vec<u8>) {
        report::write_untyped_note(statistics.0.get(), out);
    }

    fn bun_aot_collect_report_entries(input: &interface::report::ReportInput<'_>, kinds: ExplainSet) -> Vec<interface::report::ReportEntry> {
        let entries = report::collect_entries(&unwrap_input(input), kinds);
        entries.into_iter().map(wrap_entry).collect()
    }

    fn bun_aot_report_entries_to_messages(texts: &interface::report::SourceTexts, entries: &[interface::report::ReportEntry]) -> Vec<ReportMessage> {
        let entries: Vec<ReportEntry> = entries.iter().map(|entry| entry.0.get::<ReportEntry>().clone()).collect();
        report::to_messages(texts.0.get(), &entries)
    }

    fn bun_aot_write_obfuscation_map(engine: &interface::engine::EngineResult, names: &interface::link::ProgramNames, texts: &interface::report::SourceTexts, file_name: &[u8]) -> Vec<u8> {
        report::obfuscation_map::write(engine.0.get(), names.0.get(), texts.0.get(), file_name)
    }

    fn bun_aot_write_build_report(input: &interface::report::ReportInput<'_>, detail: ReportDetail, build_id: Option<&[u8]>) -> Vec<u8> {
        report::build_report::write(&unwrap_input(input), detail, build_id)
    }

    fn bun_aot_write_registry() -> Vec<u8> {
        report::registry::write()
    }

    fn bun_aot_unlinked_named_values<'a, 's>(files: &'a Files<'s>, atoms: &Interner<'s>) -> Box<dyn NamedValues + 'a> {
        Box::new(UnlinkedFiles::new(files, atoms))
    }
}
