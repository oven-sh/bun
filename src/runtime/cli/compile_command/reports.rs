use core::ops::RangeInclusive;
use core::time::Duration;

use bun_aot::diagnostic_codes::Code;
use bun_aot::diagnostics::log_diagnostic;
use bun_aot::report::{self, ReportEntry, ReportInput};
use bun_aot::statistics::{Stage, StatisticId, Statistics};
use bun_ast::{Kind, Log};
use bun_bundler::aot::{AotBuild, AotBuildFailure, MetafileOutput, write_metafile};
use bun_bundler::linker_context::metafile_builder::generate_markdown;
use bun_core::ZBox;
use bun_options_types::aot_options::{AotOptions, ExplainSet};
use bun_sys::Fd;
use bun_trim::UsedFeatures;

use super::trimming::Trimming;
use super::{CompileFailure, CompileOutcome};

const ENGINE_STAGES: RangeInclusive<Stage> = Stage::ReadAndVerify..=Stage::BuildImage;
const MODULE_STATISTICS: [StatisticId; 3] = [
    StatisticId::SourceFilesChecked,
    StatisticId::SourceFilesInferred,
    StatisticId::SourceFilesData,
];
const UNREAD_EDGES_LINE: &[u8] =
    b"trim: couldn't read the feature dependency table, so dependencies between features are ignored";

fn report_input<'a>(
    build: &'a AotBuild,
    options: &'a AotOptions,
    used: &'a UsedFeatures,
    trimming: &'a Trimming,
) -> ReportInput<'a> {
    ReportInput {
        engine: &build.engine,
        names: &build.names,
        texts: &build.texts,
        statistics: &build.statistics,
        options,
        used_features: used,
        decision: trimming.decision(),
    }
}

pub(super) fn collect_reports(
    build: &AotBuild,
    options: &AotOptions,
    used: &UsedFeatures,
    trimming: &Trimming,
) -> CompileOutcome {
    let input = report_input(build, options, used, trimming);
    let mut summary = Vec::new();
    report::write_summary(&input, &mut summary);
    let mut untyped_note = Vec::new();
    report::write_untyped_note(&build.statistics, &mut untyped_note);

    let mut entries = report::collect_entries(&input, options.explain);
    if !trimming.has_edges() && options.explain.contains(ExplainSet::RUNTIME_USE) {
        entries.push(ReportEntry::line(
            ExplainSet::RUNTIME_USE,
            UNREAD_EDGES_LINE.to_vec(),
        ));
    }
    let report_messages = report::to_messages(&build.texts, &entries);

    CompileOutcome {
        output_files: Vec::new(),
        graph_bytes: None,
        metafile: None,
        summary,
        report_messages,
        trim_log_lines: Vec::new(),
        executable: None,
        untyped_note,
        module_count: count_modules(&build.statistics),
        engine_time: compute_engine_time(&build.statistics),
        executable_time: Duration::ZERO,
    }
}

pub(super) fn write_build_report(
    build: &AotBuild,
    options: &AotOptions,
    used: &UsedFeatures,
    trimming: &Trimming,
    outcome: &CompileOutcome,
) -> Result<(), CompileFailure> {
    let id = outcome.executable.as_ref().and_then(|it| it.build_id);
    let digits = id.map(|id| bun_crash_handler::build_id::write_hexadecimal(&id));
    write_report_file(
        &report_input(build, options, used, trimming),
        digits.as_ref().map(|it| it.as_slice()),
    )
}

pub(super) fn write_failed_build_report(
    options: &AotOptions,
    failure: &AotBuildFailure,
    log: &mut Log,
) {
    let Some(compilation) = &failure.compilation else {
        return;
    };
    let used = UsedFeatures::default();
    let input = ReportInput {
        engine: &compilation.engine,
        names: &compilation.summary.names,
        texts: &compilation.summary.texts,
        statistics: &compilation.summary.statistics,
        options,
        used_features: &used,
        decision: None,
    };
    if let Err(CompileFailure::FileNotWritten { path, error }) = write_report_file(&input, None) {
        add_write_warning(log, &path, &error);
    }
}

pub(super) fn write_obfuscation_map(
    build: &AotBuild,
    root_dir: Fd,
    outfile: &[u8],
    build_id: Option<&[u8; 16]>,
) -> Result<(), CompileFailure> {
    let debug_id = build_id.map(bun_crash_handler::build_id::write_uuid);
    let debug_id = debug_id.as_ref().map(|id| &id[..]);
    let bytes = report::obfuscation_map::write(
        &build.engine,
        &build.names,
        &build.texts,
        bun_paths::basename(outfile),
        debug_id,
    );
    let map_path = [outfile, b".map".as_slice()].concat();
    write_file(root_dir, &map_path, &bytes)?;
    let stub = source_map_stub(bun_paths::basename(&map_path), debug_id);
    write_file(root_dir, &[&map_path[..], b".js"].concat(), &stub)
}

/// Tools that upload source maps expect a JavaScript file beside each map. The executable has no JavaScript text, so this one only names the map.
fn source_map_stub(map_file_name: &[u8], debug_id: Option<&[u8]>) -> Vec<u8> {
    let mut stub = [b"//# sourceMappingURL=", map_file_name, b"\n"].concat();
    if let Some(debug_id) = debug_id {
        stub.extend_from_slice(&[b"//# debugId=", debug_id, b"\n"].concat());
    }
    stub
}

/// `None`: the build asks for no metafile.
pub(super) fn collect_metafile(build: &AotBuild, outfile: &[u8]) -> Option<Vec<u8>> {
    let output = MetafileOutput {
        file_name: bun_paths::basename(outfile),
        byte_count: build.engine.image().map_or(0, |image| image.len() as u64),
    };
    Some(write_metafile(build.modules.as_ref()?, &output))
}

/// An empty path: the command line asks for no such file.
pub(super) fn write_metafiles(
    outcome: &CompileOutcome,
    json_path: &[u8],
    markdown_path: &[u8],
) -> Result<(), CompileFailure> {
    let Some(json) = outcome.metafile.as_deref() else {
        return Ok(());
    };
    if !json_path.is_empty() {
        write_file_in_new_folders(json_path, json)?;
    }
    if markdown_path.is_empty() {
        return Ok(());
    }
    match generate_markdown(json) {
        Ok(markdown) => write_file_in_new_folders(markdown_path, &markdown),
        Err(error) => {
            bun_core::warn!("Failed to generate markdown metafile: {}", error.name());
            Ok(())
        }
    }
}

fn write_file_in_new_folders(path: &[u8], bytes: &[u8]) -> Result<(), CompileFailure> {
    let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;
    bun_sys::File::make_open(path, flags, 0o664)
        .and_then(|file| file.write_all(bytes))
        .map_err(|error| CompileFailure::FileNotWritten {
            path: path.to_vec(),
            error,
        })
}

fn write_report_file(
    input: &ReportInput<'_>,
    build_id: Option<&[u8]>,
) -> Result<(), CompileFailure> {
    let Some(request) = &input.options.build_report else {
        return Ok(());
    };
    let bytes = report::build_report::write(input, request.detail, build_id);
    write_file(Fd::cwd(), &request.path, &bytes)
}

pub(super) fn write_file(directory: Fd, path: &[u8], bytes: &[u8]) -> Result<(), CompileFailure> {
    bun_sys::File::write_file(directory, &ZBox::from_bytes(path), bytes).map_err(|error| {
        CompileFailure::FileNotWritten {
            path: path.to_vec(),
            error,
        }
    })
}

fn add_write_warning(log: &mut Log, path: &[u8], error: &bun_sys::Error) {
    let reason = error.to_string();
    let mut reported = Log::init();
    log_diagnostic(
        &mut reported,
        Code::OutputNotWritten,
        &[path, reason.as_bytes()],
    );
    log.owned_strings.append(&mut reported.owned_strings);
    for mut message in reported.msgs {
        message.kind = Kind::Warn;
        log.warnings += 1;
        log.add_msg(message);
    }
}

pub(super) fn count_modules(statistics: &Statistics) -> u32 {
    let count = MODULE_STATISTICS
        .into_iter()
        .map(|id| statistics.get(id))
        .fold(0, u64::saturating_add);
    u32::try_from(count).unwrap_or(u32::MAX)
}

fn compute_engine_time(statistics: &Statistics) -> Duration {
    let nanoseconds = Stage::ALL
        .into_iter()
        .filter(|stage| ENGINE_STAGES.contains(stage))
        .map(|stage| statistics.get(stage.time()))
        .fold(0, u64::saturating_add);
    Duration::from_nanos(nanoseconds)
}
