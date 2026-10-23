use core::num::NonZeroU32;

use bstr::BStr;
use bun_aot::report;
use bun_core::{Global, Output};
use bun_options_types::aot_options::AotOptions;
use bun_options_types::context::ContextData;
use bun_options_types::schema::api;
use bun_sema_driver::format::{self, Layout};
use bun_sema_driver::{CommandLine, CompilerOption};

use super::{Destination, Options, style_for, usage_error, working_directory};
use crate::cli::compile_command::{
    self, CompileFailure, CompileOutcome, CompileProduct, RequestOrigin,
};
use crate::cli::{arguments, compile_options, run_compiled};

pub(super) fn reject_flags_requiring_aot(options: &Options) {
    let flags = [
        (!options.explain.is_empty(), "--explain"),
        (
            options.code_generation_flag.is_some(),
            "--disallow-code-generation-from-strings",
        ),
        (!options.defines.is_empty(), "--define"),
        (options.report_path.is_some(), "--aot-report"),
        (options.report_detail.is_some(), "--aot-report-detail"),
        (options.trim, "--trim"),
    ];
    if let Some((_, flag)) = flags.iter().find(|(is_given, _)| *is_given) {
        usage_error(format_args!("{flag} requires --aot"));
    }
}

pub(super) fn check_arguments(command_line: &CommandLine) {
    if command_line.build {
        usage_error(format_args!("--aot does not support --build"));
    }
    let mut names = command_line
        .compiler_options
        .iter()
        .map(CompilerOption::name);
    if let Some(name) = names.find(|name| *name != b"pretty") {
        usage_error(format_args!(
            "--aot does not take compiler options (--{}). It checks with the tsconfig.json that bun compile would use",
            BStr::new(name)
        ));
    }
    if command_line.paths.is_empty() {
        usage_error(format_args!(
            "--aot needs an entry point: bun check --aot src/index.ts"
        ));
    }
}

pub(super) fn exec(options: &Options) -> ! {
    let ctx = crate::cli::command::get();
    let cwd = working_directory();
    set_compile_context(ctx, options, &cwd);
    match compile_command::compile_from_context(ctx, CompileProduct::ReportsOnly) {
        Err(error) => {
            compile_command::print_log(ctx.log_ref());
            Output::err_generic("{}", (error.name(),));
            Global::exit(1);
        }
        Ok(Ok(outcome)) => report_compile_check(ctx, options, &cwd, Ok(outcome)),
        Ok(Err(CompileFailure::Build { files_checked, .. })) => {
            report_compile_check(ctx, options, &cwd, Err(files_checked))
        }
        Ok(Err(failure)) => run_compiled::print_failure_and_exit(ctx, &failure),
    }
}

fn option_usage_error(error: &compile_options::OptionError<'_>) -> ! {
    let mut message = Vec::new();
    error.write_message(RequestOrigin::CompileCommand, &mut message);
    usage_error(format_args!("{}", BStr::new(&message)));
}

fn set_compile_context(ctx: &mut ContextData, options: &Options, cwd: &[u8]) {
    let explain = match compile_options::explain_set(&options.explain) {
        Ok(explain) => explain,
        Err(error) => option_usage_error(&error),
    };
    let exec_argv =
        options.code_generation_flag.map(
            |level| match compile_options::prepend_code_generation_flag(level, b"") {
                Ok(exec_argv) => exec_argv.into_boxed_slice(),
                Err(error) => option_usage_error(&error),
            },
        );
    let define = match arguments::resolve_defines(&options.defines) {
        Ok(define) => define,
        Err(error) => usage_error(format_args!("{}", error.name())),
    };
    let command_line = &options.command_line;
    let paths = command_line.paths.iter();
    ctx.args.absolute_working_dir = Some(Box::from(cwd));
    ctx.args.entry_points = paths.map(|path| Box::from(&path[..])).collect();
    ctx.args.tsconfig_override = command_line.project.as_deref().map(Box::from);
    ctx.args.target = Some(api::Target::Bun);
    ctx.args.define = define;
    let bundler_options = &mut ctx.bundler_options;
    bundler_options.compile = true;
    bundler_options.inline_entrypoint_import_meta_main = true;
    bundler_options.outfile = Box::from(&b"program"[..]);
    if options.trim {
        bundler_options.compile_autoload_bunfig = false;
    }
    let mut aot = AotOptions {
        explain,
        thread_count: NonZeroU32::new(u32::try_from(options.threads).unwrap_or(u32::MAX)),
        ..Default::default()
    };
    aot.forbids_text_evaluation = compile_options::disallows_code_generation_from_strings(
        exec_argv.as_deref().unwrap_or_default(),
    );
    aot.trim.removes_unused = options.trim;
    set_build_report(&mut aot, options);
    bundler_options.compile_exec_argv = exec_argv;
    bundler_options.aot = Some(Box::new(aot));
}

fn set_build_report(aot: &mut AotOptions, options: &Options) {
    let words = [
        ("report", options.report_path),
        ("report-detail", options.report_detail),
    ];
    for (key, value) in words {
        if value.is_none() {
            continue;
        }
        if let Err(error) = compile_options::apply_developer_word(key, value, aot) {
            option_usage_error(&error);
        }
    }
}

fn report_compile_check(
    ctx: &ContextData,
    options: &Options,
    cwd: &[u8],
    outcome: Result<CompileOutcome, u32>,
) -> ! {
    let files_checked = match &outcome {
        Ok(outcome) => outcome.module_count,
        Err(files_checked) => *files_checked,
    };
    let outcome = outcome.ok();
    let log = ctx.log_ref();
    let mut out = Vec::new();
    match style_for(cwd, options.pretty, Destination::stdout(), false).layout {
        Layout::Plain => {
            for message in &log.msgs {
                write_plain_message(&mut out, message.kind, &message.data, cwd, b"");
                for note in message.notes.iter() {
                    write_plain_message(&mut out, bun_ast::Kind::Note, note, cwd, b"  ");
                }
            }
        }
        Layout::Pretty | Layout::Agent => {
            let stdout = std::ptr::from_mut::<bun_core::io::Writer>(Output::writer());
            let _ = log.print(stdout);
        }
    }
    if let Some(outcome) = &outcome {
        report::write_lines(&outcome.report_messages, true, &mut out);
    }
    let _ = Output::writer().write_all(&out);
    if log.errors > 0 {
        bun_core::pretty_errorln!("{}", BStr::new(&errors_line(log, files_checked)));
    } else if let Some(outcome) = &outcome {
        let files = format::plural(outcome.module_count as usize, b"file", b"files");
        let note = &outcome.untyped_note;
        let separator = if note.is_empty() { "" } else { ", " };
        bun_core::pretty_errorln!(
            "<green>✓<r> No type errors in {}{}{}",
            files,
            separator,
            BStr::new(note)
        );
    } else {
        Output::err_generic("the build failed", ());
    }
    let has_failed = outcome.is_none();
    if let Some(outcome) = outcome {
        let mut lines = Vec::new();
        report::write_lines(&outcome.report_messages, false, &mut lines);
        let mut report_log = bun_ast::Log::init();
        report::add_messages_to_log(outcome.report_messages, &mut report_log);
        compile_command::print_report_log(report_log);
        lines.extend_from_slice(&outcome.summary);
        let _ = Output::error_writer().write_all(&lines);
    }
    Output::flush();
    Global::exit(u32::from(has_failed));
}

/// The last line of plain `bun check`: sema/driver/format.rs.
fn errors_line(log: &bun_ast::Log, files_checked: u32) -> Vec<u8> {
    let errors = log
        .msgs
        .iter()
        .filter(|message| message.kind == bun_ast::Kind::Err);
    let mut files: Vec<&[u8]> = errors
        .filter_map(|message| message.data.location.as_ref())
        .map(|location| &location.file[..])
        .collect();
    files.sort_unstable();
    files.dedup();

    let mut line = b"Found ".to_vec();
    line.extend_from_slice(&format::plural(log.errors as usize, b"error", b"errors"));
    if !files.is_empty() {
        line.extend_from_slice(b" in ");
        line.extend_from_slice(&format::plural(files.len(), b"file", b"files"));
    }
    if files_checked > 0 {
        line.extend_from_slice(b", checked ");
        line.extend_from_slice(&format::plural(files_checked as usize, b"file", b"files"));
    }
    line
}

fn write_plain_message(
    out: &mut Vec<u8>,
    kind: bun_ast::Kind,
    data: &bun_ast::Data,
    cwd: &[u8],
    indent: &[u8],
) {
    use bun_ast::Kind;
    use std::io::Write;
    let label: &[u8] = match kind {
        Kind::Err => b"error ",
        Kind::Warn => b"warning ",
        Kind::Note => b"",
        Kind::Debug | Kind::Verbose => return,
    };
    out.extend_from_slice(indent);
    if let Some(location) = data.location.as_ref().filter(|it| it.line > 0) {
        let file: &[u8] = &location.file;
        out.extend_from_slice(match bun_paths::is_absolute(file) {
            true => bun_paths::resolve_path::relative(cwd, file),
            false => file,
        });
        let _ = write!(out, "({},{}): ", location.line, location.column);
    }
    out.extend_from_slice(label);
    out.extend_from_slice(&data.text);
    out.push(b'\n');
}
