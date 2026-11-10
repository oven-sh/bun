use core::time::Duration;

use bstr::BStr;
use bun_aot::report;
use bun_aot::report::build_rows::{
    BuildRows, ExecutableSize, format_executable_size, write_build_rows,
};
use bun_core::{Global, Output, strings};
use bun_options_types::compile_target::CompileTarget;
use bun_standalone_graph::StandaloneModuleGraph::ExecutableDetails;

use super::{CompileFailure, CompileOutcome, RequestOrigin};

pub(crate) fn print_log(log: &bun_ast::Log) {
    let _ = log.print(core::ptr::from_mut::<bun_core::io::Writer>(
        Output::error_writer(),
    ));
}

/// A report names a file of the program as the lines around it do: from the working directory.
pub(crate) fn print_report_log(mut log: bun_ast::Log) {
    let mut buffer = bun_paths::path_buffer_pool::get();
    if let Ok(directory) = bun_core::getcwd(&mut buffer) {
        let directory = directory.as_bytes();
        let shorten = |data: &mut bun_ast::Data| {
            if let Some(location) = data.location.as_mut()
                && bun_paths::is_absolute(&location.file)
            {
                let shown = bun_paths::resolve_path::relative(directory, &location.file);
                location.file = Box::from(shown);
            }
        };
        for message in log.msgs.iter_mut() {
            shorten(&mut message.data);
            message.notes.iter_mut().for_each(shorten);
        }
    }
    print_log(&log);
}

pub(crate) fn print_error_and_notes(message: &[u8]) {
    let mut lines = strings::tokenize(message, b"\n");
    if let Some(error) = lines.next() {
        Output::err_generic("{}", (BStr::new(error),));
    }
    for note in lines {
        bun_core::pretty_errorln!("{}", BStr::new(note));
    }
}

#[cold]
#[inline(never)]
pub(crate) fn exit_with_failure(
    log: &bun_ast::Log,
    origin: RequestOrigin,
    target: &CompileTarget,
    failure: &CompileFailure,
) -> ! {
    print_failure(log, origin, target, failure);
    Global::exit(1);
}

pub(crate) fn print_failure(
    log: &bun_ast::Log,
    origin: RequestOrigin,
    target: &CompileTarget,
    failure: &CompileFailure,
) {
    print_log(log);
    let mut message = Vec::new();
    failure.write_message(origin, target, &mut message);
    print_error_and_notes(&message);
    Output::flush();
}

fn size_of(executable: &ExecutableDetails) -> ExecutableSize {
    ExecutableSize {
        bytes: executable.size,
        trimmed_bytes: (executable.trim_summary.as_ref())
            .and_then(|summary| summary.requested_cut_bytes),
    }
}

pub(crate) fn write_trimmed_size(executable: &ExecutableDetails, out: &mut Vec<u8>) {
    if executable.trim_summary.is_some() {
        out.extend_from_slice(b"  ");
        out.extend_from_slice(format_executable_size(size_of(executable)).as_bytes());
    }
}

pub(crate) fn time_since_start(timestamp: i128) -> Duration {
    let nanoseconds = timestamp.saturating_sub(crate::cli::start_time());
    Duration::from_nanos(u64::try_from(nanoseconds).unwrap_or(0))
}

pub(super) fn print_outcome(
    log: &mut bun_ast::Log,
    outcome: CompileOutcome,
    outfile: &[u8],
    finished: i128,
) -> ! {
    print_log(log);

    let whole_build = time_since_start(finished);
    let bundle_time =
        (time_since_start(outcome.compiler_called_at) + outcome.load_time).min(whole_build);
    let check_time = outcome.check_time.min(whole_build - bundle_time);
    let executable = outcome.executable.as_ref();
    let build_id = executable
        .and_then(|executable| executable.build_id.as_ref())
        .map(|id| bun_crash_handler::build_id::write_hexadecimal(id));
    let mut rows = Vec::new();
    write_build_rows(
        &BuildRows {
            bundle_time,
            check_time,
            compile_time: whole_build - bundle_time - check_time,
            module_count: u64::from(outcome.module_count),
            line_count: outcome.line_count,
            untyped_file_count: outcome.untyped_file_count,
            outfile,
            executable: executable.map(size_of),
            build_id: build_id.as_ref().map(|id| &id[..]),
        },
        Output::enable_ansi_colors_stdout(),
        &mut rows,
    );
    let _ = Output::writer().write_all(&rows);
    Output::flush();

    let mut json_reports = Vec::new();
    report::write_lines(&outcome.report_messages, true, &mut json_reports);
    let _ = Output::writer().write_all(&json_reports);
    Output::flush();

    let mut lines = Vec::new();
    report::write_lines(&outcome.report_messages, false, &mut lines);
    let mut reports_log = bun_ast::Log::init();
    report::add_messages_to_log(outcome.report_messages, &mut reports_log);
    print_report_log(reports_log);

    for line in &outcome.trim_log_lines {
        lines.extend_from_slice(line);
        lines.push(b'\n');
    }
    lines.extend_from_slice(&outcome.summary);
    let _ = Output::error_writer().write_all(&lines);
    Output::flush();
    Global::exit(0);
}
