use std::borrow::Cow;
use std::io::Write as _;

use bstr::BStr;
use bun_aot::report;
use bun_core::{Global, Output, fmt as bun_fmt, strings};
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
                location.file = Cow::Owned(shown.to_vec());
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

fn print_elapsed(elapsed: i64) {
    let padding_buf = [b' '; 16];
    let elapsed_digit_count: usize = 4usize.saturating_sub(bun_fmt::digit_count(elapsed));

    bun_core::pretty!("{}", BStr::new(&padding_buf[0..elapsed_digit_count]));
    Output::print_elapsed_stdout_trim(elapsed as f64);
}

pub(super) fn write_megabytes(out: &mut Vec<u8>, bytes: u64) {
    let tenths = bytes.saturating_add(50_000) / 100_000;
    let _ = write!(out, "{}.{} MB", tenths / 10, tenths % 10);
}

pub(crate) fn write_trimmed_size(executable: &ExecutableDetails, out: &mut Vec<u8>) {
    let Some(summary) = &executable.trim_summary else {
        return;
    };
    out.extend_from_slice(b"  ");
    write_megabytes(out, executable.size);
    out.extend_from_slice(b" (");
    write_megabytes(out, summary.removed_bytes());
    out.extend_from_slice(b" of unused Bun APIs removed)");
}

pub(super) fn write_executable_details(outcome: &CompileOutcome, out: &mut Vec<u8>) {
    if let Some(executable) = &outcome.executable {
        write_trimmed_size(executable, out);
    }
    if !outcome.untyped_note.is_empty() {
        out.extend_from_slice(b"  ");
        out.extend_from_slice(&outcome.untyped_note);
    }
}

pub(super) fn print_outcome(
    log: &mut bun_ast::Log,
    outcome: CompileOutcome,
    outfile: &[u8],
    finished: i128,
) -> ! {
    print_log(log);

    let total_elapsed =
        ((finished - crate::cli::start_time()) as i64) / (bun_core::time::NS_PER_MS as i64);
    let compiled_elapsed = (outcome.engine_time + outcome.executable_time).as_millis() as i64;
    print_elapsed((total_elapsed - compiled_elapsed).max(0));
    bun_core::prettyln!("  <green>bundle<r>  {} modules", outcome.module_count);

    let mut details = Vec::new();
    write_executable_details(&outcome, &mut details);
    print_elapsed(compiled_elapsed);
    bun_core::pretty!(
        " <green>compile<r>  <b><blue>{}<r>{}\n",
        BStr::new(outfile),
        BStr::new(&details),
    );
    if let Some(id) = outcome
        .executable
        .as_ref()
        .and_then(|executable| executable.build_id)
    {
        let id = bun_crash_handler::build_id::write_hexadecimal(&id);
        bun_core::prettyln!("        <green>build id<r>  {}", BStr::new(&id));
    }
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
