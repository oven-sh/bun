use core::ptr::NonNull;

use bun_alloc::Arena;
use bun_aot::report::ReportMessage;
use bun_ast::{Data, Kind, Log, Msg};
use bun_bundler::aot::{MetafileFiles, PluginSetup, write_metafile_files};
use bun_bundler::bundle_v2::{BuildResult, BundleV2Result, CompletionStruct};
use bun_bundler::options;
use bun_bundler::transpiler::Transpiler;
use bun_options_types::WindowsOptions;
use bun_paths as paths;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileErrorReason, CompileResult, Flags as StandaloneFlags, RuntimeOptions,
};
use bun_sys::Dir;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;

use super::{CompileOptions, JSBundleCompletionTask, executable_path, opt_box};
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
) {
    for ReportMessage { mut message, .. } in report_messages {
        message.kind = Kind::Verbose;
        log.add_msg(message);
    }
    add_notes(log, trim_log_lines);
}

impl JSBundleCompletionTask {
    pub(super) fn compiles_ahead_of_time(&self) -> bool {
        let compile = self.config.compile.as_ref();
        compile.is_some_and(|compile| compile.aot.is_some())
    }

    fn executable_destination(&self) -> Result<ExecutableDestination, CompileResult> {
        let compile_options = self
            .config
            .compile
            .as_ref()
            .expect("Unexpected: No compile options provided");

        let full_path = executable_path(&self.config, compile_options);

        let dirname: &[u8] = paths::dirname(&full_path).unwrap_or(b".");
        let basename: &[u8] = paths::basename(&full_path);

        #[cfg(not(windows))]
        let mut root_dir = Dir::cwd();
        #[cfg(windows)]
        let root_dir = Dir::cwd();

        // Windows keeps the working directory and takes the full path.
        let outfile: Box<[u8]> = Box::from(if cfg!(windows) { &*full_path } else { basename });

        if !(dirname.is_empty() || dirname == b".") {
            #[cfg(not(windows))]
            {
                root_dir = match root_dir.make_open_path(dirname, OpenDirOptions::default()) {
                    Ok(d) => d,
                    Err(err) => {
                        return Err(CompileResult::fail_fmt(format_args!(
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
                    return Err(CompileResult::fail_fmt(format_args!(
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

    fn fail_compilation(&mut self, failure: &CompileResult) -> bun_bundler::Result<()> {
        if let CompileResult::Err(error) = failure {
            self.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!("{}", bstr::BStr::new(error.slice())),
            );
        }
        Err(bun_bundler::Error::BuildFailed)
    }

    // Runs on the bundle thread and writes the executable there, not in `on_complete`.
    pub(super) fn compile_ahead_of_time<'a>(
        &mut self,
        transpiler: &'a mut Transpiler<'a>,
        bump: &'a Arena,
        event_loop: bun_bundler::linker_context_mod::EventLoop,
        worker_pool: Option<NonNull<bun_threading::ThreadPool>>,
    ) -> bun_bundler::Result<()> {
        let destination = match self.executable_destination() {
            Ok(destination) => destination,
            Err(failure) => return self.fail_compilation(&failure),
        };

        let plugins = self.plugins().map(|plugins| PluginSetup {
            plugins,
            context: self.context,
            completion: self.as_js_bundle_completion_task(),
        });
        // SAFETY: `file_map` returns a `NonNull` into `self.config.files`, which outlives the
        // build: `generate_in_new_thread` returns after this call.
        let file_map = self.file_map().map(|p| unsafe { &*p.as_ptr() });

        let compile = self
            .config
            .compile
            .as_ref()
            .expect("Unexpected: No compile options provided");
        let aot = compile
            .aot
            .as_deref()
            .expect("the caller compiles ahead of time");
        let entry_points: Vec<&[u8]> = self
            .config
            .entry_points
            .keys()
            .iter()
            .map(|b| &**b)
            .collect();

        let mut request = CompileRequest {
            origin: RequestOrigin::BuildApi,
            product: CompileProduct::Executable {
                outfile: &destination.outfile,
            },
            options: aot,
            entry_points: &entry_points,
            bundler: Some(BundlerInputs {
                transpiler,
                arena: bump,
                event_loop,
                worker_pool,
                plugins,
                file_map,
            }),
            executable: ExecutableSettings {
                target: &compile.compile_target,
                executable_path: if compile.executable_path.list.is_empty() {
                    None
                } else {
                    Some(compile.executable_path.list.as_slice())
                },
                root_dir: destination.root_dir.fd,
                env: &mut self.env,
                windows: &destination.windows,
                exec_argv: &compile.exec_argv.list,
                flags: destination.flags,
                runtime_options: RuntimeOptions {
                    jit_policy: compile.jit_policy,
                },
                assets: &compile.assets,
                embeds_source_maps: self.config.source_map != options::SourceMapOption::None,
            },
            log: &mut self.log,
        };

        let compiled = bun_removable_features::call_removable_or!(
            AotCompiler,
            Throw,
            { Err(CompileFailure::NoCompiler) },
            compile_to_executable,
            &mut request
        );
        match compiled {
            Ok(outcome) => self.finish_compilation(outcome, destination.full_path),
            Err(failure) => self.fail_build(&failure),
        }
    }

    fn fail_build(&mut self, failure: &CompileFailure) -> bun_bundler::Result<()> {
        let compile = self
            .config
            .compile
            .as_ref()
            .expect("Unexpected: No compile options provided");
        let mut message = Vec::new();
        failure.write_message(
            RequestOrigin::BuildApi,
            &compile.compile_target,
            &mut message,
        );
        if !message.is_empty() {
            self.log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!("{}", bstr::BStr::new(&message)),
            );
        }
        Err(bun_bundler::Error::BuildFailed)
    }

    fn finish_compilation(
        &mut self,
        outcome: CompileOutcome,
        full_path: Box<[u8]>,
    ) -> bun_bundler::Result<()> {
        let CompileOutcome {
            output_files,
            metafile,
            report_messages,
            trim_log_lines,
            ..
        } = outcome;
        add_compile_logs(&mut self.log, report_messages, trim_log_lines);

        let Some(mut entry) = output_files.into_iter().next() else {
            return self.fail_compilation(&CompileResult::fail(CompileErrorReason::NoEntryPoint));
        };
        entry.dest_path = full_path;
        entry.is_executable = true;

        let metafile_markdown = metafile.as_deref().and_then(|json| {
            let files = MetafileFiles {
                output_directory: &self.config.outdir.list,
                json_path: &self.config.metafile_json_path.list,
                markdown_path: &self.config.metafile_markdown_path.list,
            };
            write_metafile_files(json, &files)
        });
        self.set_result(BundleV2Result::Value(BuildResult {
            output_files: vec![entry],
            metafile: metafile.map(Vec::into_boxed_slice),
            metafile_markdown,
        }));
        Ok(())
    }
}
