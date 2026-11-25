use bun_aot::report::ReportMessage;
use bun_ast::{Data, Kind, Log, Msg};
use bun_bundler::aot::{MetafileFiles, write_metafile_files};
use bun_bundler::bundle_v2::BuildResult;
use bun_bundler::options;
use bun_options_types::WindowsOptions;
use bun_options_types::aot_options::AotOptions;
use bun_paths as paths;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileError, CompileErrorReason, Flags as StandaloneFlags, RuntimeOptions,
};
use bun_sys::Dir;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;

use super::{CompileOptions, JSBundlerConfig, executable_path, opt_box};
use crate::cli::compile_command::{
    BundlerInputs, CompileFailure, CompileOutcome, CompileProduct, CompileRequest,
    ExecutableSettings, RequestOrigin, compile_to_executable,
};

struct ExecutableDestination {
    full_path: Box<[u8]>,
    root_dir: Dir,
    // Relative to `root_dir`.
    outfile: Box<[u8]>,
    flags: StandaloneFlags,
    windows: WindowsOptions,
}

pub(super) fn add_notes(log: &mut Log, lines: Vec<Vec<u8>>) {
    for line in lines {
        log.add_msg(Msg {
            kind: Kind::Note,
            data: Data {
                text: line.into(),
                location: None,
            },
            ..Default::default()
        });
    }
}

pub(super) fn plan_bundle_trimming(
    compile_options: &CompileOptions,
    output_files: &[options::OutputFile],
    env: &mut bun_dotenv::Loader,
    flags: StandaloneFlags,
) -> Result<Option<bun_trim::TrimPlan>, Vec<u8>> {
    let template_path = compile_options.executable_path.list.as_slice();
    crate::cli::build_command::plan_bundle_trimming(
        &compile_options.compile_target,
        output_files,
        env,
        (!template_path.is_empty()).then_some(template_path),
        &compile_options.exec_argv.list,
        flags,
        &compile_options.trim,
    )
    .map_err(|failure| {
        let mut message = Vec::new();
        failure.write_message(
            RequestOrigin::BuildApi,
            &compile_options.compile_target,
            &mut message,
        );
        message
    })
}

fn add_compile_logs(
    log: &mut Log,
    report_messages: Vec<ReportMessage>,
    trim_log_lines: Vec<Vec<u8>>,
    developer_options: &[u8],
) {
    for ReportMessage { mut message, .. } in report_messages {
        message.kind = Kind::Verbose;
        log.add_msg(message);
    }
    add_notes(log, trim_log_lines);
    let lines = bun_core::strings::tokenize(developer_options, b"\n");
    add_notes(log, lines.map(<[u8]>::to_vec).collect());
}

fn executable_destination(
    config: &JSBundlerConfig,
    compile_options: &CompileOptions,
) -> Result<ExecutableDestination, CompileError> {
    let full_path = executable_path(config, compile_options);

    let dirname: &[u8] = paths::dirname(&full_path).unwrap_or(b".");

    #[cfg(not(windows))]
    let mut root_dir = Dir::cwd();
    #[cfg(windows)]
    let root_dir = Dir::cwd();

    let outfile: Box<[u8]> = Box::from(&*full_path);

    if !(dirname.is_empty() || dirname == b".") {
        #[cfg(not(windows))]
        {
            root_dir = match root_dir.make_open_path(dirname, OpenDirOptions::default()) {
                Ok(d) => d,
                Err(err) => {
                    return Err(CompileError::fmt(format_args!(
                        "Failed to open output directory {}: {}",
                        bstr::BStr::new(dirname),
                        bstr::BStr::new(err.name()),
                    )));
                }
            };
        }
        #[cfg(windows)]
        {
            if let Err(err) = root_dir.make_path(dirname) {
                return Err(CompileError::fmt(format_args!(
                    "Failed to create output directory {}: {}",
                    bstr::BStr::new(dirname),
                    bstr::BStr::new(err.name()),
                )));
            }
        }
    }

    let mut flags = StandaloneFlags::default();
    if !compile_options.autoload_dotenv {
        flags |= StandaloneFlags::DISABLE_DEFAULT_ENV_FILES;
    }
    if !compile_options.autoload_bunfig {
        flags |= StandaloneFlags::DISABLE_AUTOLOAD_BUNFIG;
    }
    if !compile_options.autoload_tsconfig {
        flags |= StandaloneFlags::DISABLE_AUTOLOAD_TSCONFIG;
    }
    if !compile_options.autoload_package_json {
        flags |= StandaloneFlags::DISABLE_AUTOLOAD_PACKAGE_JSON;
    }

    let windows = WindowsOptions {
        hide_console: compile_options.windows_hide_console,
        icon: opt_box(&compile_options.windows_icon_path.list),
        title: opt_box(&compile_options.windows_title.list),
        publisher: opt_box(&compile_options.windows_publisher.list),
        version: opt_box(&compile_options.windows_version.list),
        description: opt_box(&compile_options.windows_description.list),
        copyright: opt_box(&compile_options.windows_copyright.list),
    };

    Ok(ExecutableDestination {
        full_path,
        root_dir,
        outfile,
        flags,
        windows,
    })
}

pub(super) struct CompiledExecutable {
    outcome: CompileOutcome,
    full_path: Box<[u8]>,
}

// Runs on the bundle thread and writes the executable there, not in `on_complete`.
pub(super) fn compile(
    config: &JSBundlerConfig,
    compile_options: &CompileOptions,
    aot: &AotOptions,
    entry_points: &[&[u8]],
    bundler: BundlerInputs<'_>,
) -> Result<CompiledExecutable, CompileError> {
    let destination = executable_destination(config, compile_options)?;
    let (log, env) = (bundler.transpiler.log, bundler.transpiler.env);

    // Without an output directory a metafile is handed to the caller and not written.
    let outdir = &config.outdir.list[..];
    let in_output_directory = |path: &[u8]| match path.is_empty() || outdir.is_empty() {
        true => Vec::new(),
        false => [outdir, b"/", path].concat(),
    };
    let metafiles = [
        in_output_directory(&config.metafile_json_path.list),
        in_output_directory(&config.metafile_markdown_path.list),
    ];
    let mut request = CompileRequest {
        origin: RequestOrigin::BuildApi,
        product: CompileProduct::Executable {
            outfile: &destination.outfile,
        },
        options: aot,
        entry_points,
        bundler: Some(bundler),
        executable: ExecutableSettings {
            target: &compile_options.compile_target,
            executable_path: if compile_options.executable_path.list.is_empty() {
                None
            } else {
                Some(compile_options.executable_path.list.as_slice())
            },
            root_dir: destination.root_dir.fd,
            env,
            windows: &destination.windows,
            exec_argv: &compile_options.exec_argv.list,
            flags: destination.flags,
            runtime_options: RuntimeOptions {
                jit_policy: compile_options.jit_policy,
            },
            assets: &compile_options.assets,
            metafiles: [&metafiles[0], &metafiles[1]],
            embeds_source_maps: config.source_map != options::SourceMapOption::None,
        },
        log,
    };

    let compiled = bun_removable_features::call_removable_or!(
        AotCompiler,
        Throw,
        { Err(CompileFailure::NoCompiler) },
        compile_to_executable,
        &mut request
    );
    match compiled {
        Ok(outcome) => Ok(CompiledExecutable {
            outcome,
            full_path: destination.full_path,
        }),
        Err(failure) => {
            let mut message = Vec::new();
            let target = &compile_options.compile_target;
            failure.write_message(RequestOrigin::BuildApi, target, &mut message);
            Err(CompileError::Message(message))
        }
    }
}

fn fail_compilation(log: &mut Log, message: &[u8]) -> bun_bundler::Error {
    if !message.is_empty() {
        log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("{}", bstr::BStr::new(message)),
        );
    }
    bun_bundler::Error::BuildFailed
}

/// Separate from `compile`, in which the transpiler writes to `log` through its own pointer.
pub(super) fn finish_compilation(
    config: &JSBundlerConfig,
    compiled: Result<CompiledExecutable, CompileError>,
    log: &mut Log,
) -> bun_bundler::Result<BuildResult> {
    let CompiledExecutable { outcome, full_path } =
        compiled.map_err(|error| fail_compilation(log, error.slice()))?;
    let CompileOutcome {
        output_files,
        metafile,
        developer_options,
        report_messages,
        trim_log_lines,
        ..
    } = outcome;
    add_compile_logs(log, report_messages, trim_log_lines, &developer_options);

    let Some(mut entry) = output_files.into_iter().next() else {
        return Err(fail_compilation(
            log,
            CompileErrorReason::NoEntryPoint.message(),
        ));
    };
    entry.dest_path = full_path;
    entry.is_executable = true;

    let metafile_markdown = metafile.as_deref().and_then(|json| {
        let files = MetafileFiles {
            output_directory: &config.outdir.list,
            json_path: &config.metafile_json_path.list,
            markdown_path: &config.metafile_markdown_path.list,
        };
        write_metafile_files(json, &files)
    });
    Ok(BuildResult {
        output_files: vec![entry],
        metafile: metafile.map(Vec::into_boxed_slice),
        metafile_markdown,
    })
}
