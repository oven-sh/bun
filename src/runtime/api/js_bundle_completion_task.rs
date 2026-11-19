//! `JSBundleCompletionTask` — owns one in-flight `Bun.build()`.

use bun_options_types::TargetExt as _;
use core::cell::Cell;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_alloc::Arena;
use bun_bundler::aot::PluginSetup;
use bun_bundler::bundle_v2::{BuildResult, BundleV2, dispatch};
use bun_bundler::options::{self, OutputFile, OutputKind, Side};
use bun_bundler::output_file::Value as OutputFileValue;
use bun_bundler::transpiler::Transpiler;
use bun_core::env::OperatingSystem;
use bun_event_loop::BoxedTask;
use bun_io::JsKeepAlive;
use bun_jsc::ConcurrentTask::ConcurrentTask;
use bun_jsc::WorkPool;
use bun_jsc::bun_string_jsc;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, JsPtr, LogJsc as _};
use bun_options_types::WindowsOptions;
use bun_options_types::schema::api;
use bun_paths::resolve_path::{join_abs_string, platform};
use bun_paths::{self as paths, SEP};
use bun_ptr::BackRef;
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileErrorReason, CompileResult, Flags as StandaloneFlags, RuntimeOptions,
    target_base_public_path, to_executable,
};
use bun_standalone_graph::executable_request::ExecutableAdditions;
use bun_sys::Dir;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;

use crate::api::js_bundler::js_bundler::{
    CompileOptions, Config as JSBundlerConfig, OwnedPlugin, Plugin, PluginJscExt,
};
use crate::api::output_file_jsc::OutputFileJsc as _;
use crate::cli::compile_command::BundlerInputs;
use crate::node::fs::{self as node_fs, NodeFS, args as fs_args};
use crate::node::types::{FileSystemFlags, PathLike, PathOrFileDescriptor, StringOrBuffer};
use crate::server::html_bundle;

#[path = "bundle_thread.rs"]
mod bundle_thread;
#[path = "compile_ahead_of_time.rs"]
mod compile_ahead_of_time;

/// Goes to the bundle thread and comes back with the result.
pub(crate) struct JSBundleCompletionTask {
    config: JSBundlerConfig,
    /// The context whose script called `Bun.build`. The build cannot be cancelled in a live VM
    /// (see `arm_owner` below), so one for a `Bun.ModuleGraph` that stopped meanwhile runs to
    /// its end and its result is dropped.
    context: jsc::ContextId,
    /// This build's copy of the VM's env.
    env: bun_dotenv::Loader,
    log: bun_ast::Log,
    result: bun_bundler::Result<BuildResult>,
    plugins: Option<JsPtr<Plugin>>,
    declarations: Option<DeclarationOutputs>,
    /// Owned. Not a `Box`: the JS thread uses it while this task is on the bundle thread.
    js: JsPtr<BundleJs>,
}

/// What stays on the JS thread.
struct BundleJs {
    global_this: BackRef<JSGlobalObject>,
    owner: BuildOwner,
    _keep_alive: JsKeepAlive,
    /// Set when the realm stops: `finish` does not deliver.
    cancelled: Cell<bool>,
    /// Armed from `schedule` until `finish`: the realm gives up on the result when it stops.
    abort_handle: jsc::AbortHandle,
    caller: CallerOfTheBuild,
}

pub(crate) enum BuildOwner {
    Promise {
        promise: jsc::JSPromiseStrong,
        plugins: Option<OwnedPlugin>,
    },
    Route {
        route: html_bundle::PendingBuild,
        /// Owned by the route's server.
        plugins: Option<NonNull<Plugin>>,
        started_at_ns: u64,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Delivery {
    Deliver,
    Abandon,
}

struct DeclarationOutputs {
    loaders: bun_ast::LoaderHashTable,
    typed_files_skipped_for: Option<&'static str>,
    writes_typed_files: bool,
    drops_source_maps: bool,
}

/// The build's tie to the script that called `Bun.build`. When that script's context stops (its
/// `Bun.ModuleGraph` is disposed) the build itself goes on — a live VM cannot cancel one — but
/// what its plugins were asked and have not answered is answered now, as cancelled: their
/// callbacks ran in that context, so whatever they were waiting for went with it.
struct CallerOfTheBuild {
    /// Armed in the context that called `Bun.build`, when that is a `Bun.ModuleGraph`'s.
    handle: jsc::AbortHandle,
    plugins: Option<NonNull<Plugin>>,
}

impl CallerOfTheBuild {
    fn tombstone_plugins(&self) {
        if let Some(plugins) = self.plugins {
            Plugin::opaque_ref(plugins.as_ptr()).tombstone();
        }
    }
}

jsc::impl_abort_handle_owner!(CallerOfTheBuild, handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ its completion has not run).
    unsafe { &*this }.tombstone_plugins()
});

jsc::impl_abort_handle_owner!(BundleJs, abort_handle, |this, _cause| {
    // The VM does not wait behind other VMs' builds.
    if let Some(queued) = bundle_thread::take_unstarted(this) {
        return queued.task.release_unrun();
    }
    // SAFETY: trait contract — `this` is live (armed ⇒ its completion has not run).
    unsafe { &*this }.cancel_started()
});

impl BundleJs {
    /// The bundle thread consumes the plugins' answers, fails the build and posts the completion.
    fn cancel_started(&self) {
        self.caller.tombstone_plugins();
        self.cancelled.set(true);
        bundle_thread::cancel_if_started(self);
    }
}

impl JSBundleCompletionTask {
    /// Takes a process-keepalive ref and hands the build to the bundle thread.
    pub(crate) fn schedule(
        config: JSBundlerConfig,
        global_this: &JSGlobalObject,
        context: jsc::ContextId,
        owner: BuildOwner,
    ) {
        let vm = global_this.bun_vm();
        let plugins = match &owner {
            BuildOwner::Promise { plugins, .. } => plugins.as_ref().map(OwnedPlugin::as_non_null),
            BuildOwner::Route { plugins, .. } => *plugins,
        };
        if let Some(plugins) = plugins {
            Plugin::opaque_ref(plugins.as_ptr()).freeze_filters();
        }
        let js = bun_core::heap::alloc_nn(BundleJs {
            global_this: BackRef::new(global_this),
            owner,
            _keep_alive: JsKeepAlive::active(),
            cancelled: Cell::new(false),
            abort_handle: jsc::AbortHandle::for_owner::<BundleJs>(),
            caller: CallerOfTheBuild {
                handle: jsc::AbortHandle::for_owner::<CallerOfTheBuild>(),
                plugins,
            },
        });

        // Cancelled when the realm's context stops. Teardown also waits for the ticket.
        // SAFETY: `js` stays where it is until `finish` takes the task and frees it. Until then it
        // keeps the plugins, or the route in it keeps the server that does.
        let (js, plugins) = unsafe {
            jsc::AbortHandle::arm_owner(js.as_ptr(), vm.root_context());
            if let Some(caller) = vm.as_graph_context(vm.context_of(context)) {
                jsc::AbortHandle::arm_owner(&raw mut (*js.as_ptr()).caller, caller);
            }
            (JsPtr::new(js), plugins.map(|plugins| JsPtr::new(plugins)))
        };

        let task = Box::new(JSBundleCompletionTask {
            config,
            context,
            // Copy on the JS thread because only the JS thread writes to the VM's loader.
            env: bun_core::handle_oom(vm.env_loader().clone_loaded()),
            log: bun_ast::Log::init(),
            result: Err(bun_bundler::Error::BuildFailed),
            plugins,
            declarations: None,
            js,
        });
        bundle_thread::enqueue(task, vm.ticket());
    }

    fn fail_to_start(mut self: Box<Self>, err: &std::io::Error, ticket: &jsc::Ticket) {
        self.log.add_error_fmt(
            None,
            bun_ast::Loc::EMPTY,
            format_args!("Failed to start the bundler thread: {err}"),
        );
        ticket.post(ConcurrentTask::create_boxed(self));
    }
}

/// `if (s.slice().len > 0) s.slice() else null` for the windows-options block.
#[inline]
fn opt_box(s: &[u8]) -> Option<Box<[u8]>> {
    if s.is_empty() {
        None
    } else {
        Some(Box::from(s))
    }
}

/// Absolute, because the PE metadata operations need an absolute path.
fn executable_path(config: &JSBundlerConfig, compile: &CompileOptions) -> Box<[u8]> {
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();
    let outdir_slice = &config.outdir.list;
    let outfile_slice = &compile.outfile.list;
    let joined: &[u8] = if !outdir_slice.is_empty() {
        join_abs_string::<platform::Auto>(top_level_dir, &[outdir_slice, outfile_slice])
    } else if paths::is_absolute(outfile_slice) {
        outfile_slice
    } else {
        // For relative paths, ensure we make them absolute relative to the current working directory
        join_abs_string::<platform::Auto>(top_level_dir, &[outfile_slice])
    };
    if compile.compile_target.os == OperatingSystem::Windows && !joined.ends_with(b".exe") {
        let mut v = Vec::with_capacity(joined.len() + 4);
        v.extend_from_slice(joined);
        v.extend_from_slice(b".exe");
        v.into_boxed_slice()
    } else {
        Box::from(joined)
    }
}

/// Without `.exe`, as in the CLI.
fn executable_entry_point_name(executable_path: &[u8]) -> &[u8] {
    let basename = paths::basename(executable_path);
    basename.strip_suffix(b".exe").unwrap_or(basename)
}

/// `BundleOptions::type_check`. `Config::from_js` has thrown where the type checker is removed.
fn check_types(checked: options::TypeChecked<'_, '_>, log: &mut bun_ast::Log) -> bool {
    bun_removable_features::removable_body!(Check, Abort, {
        crate::cli::check_command::check_for_bun_build(checked, log)
    })
}

fn check_types_and_emit_declarations(
    checked: options::TypeChecked<'_, '_>,
    log: &mut bun_ast::Log,
) -> bool {
    bun_removable_features::removable_body!(Check, Abort, {
        crate::cli::check_command::check_and_emit_declarations(checked, log)
    })
}

fn write_declarations(outdir: &[u8], output_files: &mut [OutputFile]) -> bun_bundler::Result<()> {
    let directory = Dir::cwd().make_open_path(outdir, bun_sys::OpenDirOptions::default())?;
    for file in output_files.iter_mut() {
        if matches!(file.value, OutputFileValue::Buffer { .. }) {
            file.write_to_disk(directory.fd)?;
            file.value = OutputFileValue::Saved(bun_bundler::output_file::SavedFile {});
        }
    }
    Ok(())
}

impl JSBundleCompletionTask {
    fn add_declarations(&mut self, declarations: &DeclarationOutputs) {
        bun_removable_features::removable_body!(Check, Abort, {
            use crate::cli::{check_command, compile_command};
            let emitted = check_command::take_declaration_files();
            let Ok(build) = &mut self.result else {
                drop(check_command::take_module_types());
                return;
            };
            let output_files = &mut build.output_files;
            let config = &self.config;
            if let Err(error) = compile_command::add_declaration_files(
                emitted,
                &config.rootdir.list,
                true,
                output_files,
            ) {
                drop(check_command::take_module_types());
                let mut message = Vec::new();
                error.write_message(&mut message);
                self.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("{}", bstr::BStr::new(&message)),
                );
                self.result = Err(bun_bundler::Error::BuildFailed);
                return;
            }
            if let Some(option) = declarations.typed_files_skipped_for {
                check_command::warn_about_skipped_typed_files(option, &mut self.log);
            }
            let working_directory = bun_resolver::fs::FileSystem::get().top_level_dir();
            let outdir = join_abs_string::<platform::Auto>(
                working_directory,
                &[&config.dir.list, &config.outdir.list],
            )
            .to_vec();
            if declarations.writes_typed_files {
                let tsconfig = &config.tsconfig_override.list;
                let request = compile_command::TypedOutputs {
                    working_directory,
                    outdir: &outdir,
                    tsconfig: (!tsconfig.is_empty()).then_some(&tsconfig[..]),
                    conditions: config.conditions.keys(),
                    loaders: &declarations.loaders,
                    drops_source_maps: declarations.drops_source_maps,
                    writes_package_json: false,
                };
                compile_command::add_typed_files(&request, &mut self.log, output_files);
            } else {
                drop(check_command::take_module_types());
            }
            if config.outdir.is_empty() {
                return;
            }
            if let Err(error) = write_declarations(&outdir, output_files) {
                self.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "{} writing declaration files to {}",
                        bstr::BStr::new(error.name()),
                        bstr::BStr::new(&outdir)
                    ),
                );
                self.result = Err(bun_bundler::Error::BuildFailed);
            }
        })
    }

    /// Returns true if the promises were handled and resolved from
    /// BundlePlugin.ts; false means the caller should resolve immediately.
    fn run_on_end_callbacks(
        global_this: &JSGlobalObject,
        plugin: &mut Plugin,
        promise: &JSPromise,
        build_result: JSValue,
        rejection: jsc::JsResult<JSValue>,
    ) -> jsc::JsResult<bool> {
        let value = plugin.run_on_end_callbacks(global_this, promise, build_result, rejection)?;
        Ok(value != JSValue::UNDEFINED)
    }

    fn plugins_mut(&mut self) -> Option<&mut Plugin> {
        self.plugins.map(|p| Plugin::opaque_mut(p.as_ptr()))
    }

    fn to_js_error(
        &mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        let throw_on_error = self.config.throw_on_error;

        let build_result = JSValue::create_empty_object(global_this, 3);
        match JSValue::create_empty_array(global_this, 0) {
            Ok(v) => build_result.put(global_this, b"outputs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };
        build_result.put(global_this, b"success", JSValue::FALSE);
        match self.log.to_js_array(global_this) {
            Ok(v) => build_result.put(global_this, b"logs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };

        let did_handle_callbacks = if self.plugins.is_some() {
            // Compute `rejection` before borrowing the plugin so `&self.log`
            // does not overlap the `&mut self` taken by `plugins_mut()`.
            let rejection = if throw_on_error {
                self.log
                    .to_js_aggregate_error(global_this, format_args!("Bundle failed"))
            } else {
                Ok(JSValue::UNDEFINED)
            };
            // Checked `is_some` above; accessor encapsulates the deref.
            let plugin = self.plugins_mut().unwrap();
            match Self::run_on_end_callbacks(global_this, plugin, promise, build_result, rejection)
            {
                Ok(b) => b,
                Err(e) => return promise.reject(global_this, Err(e)),
            }
        } else {
            false
        };

        if !did_handle_callbacks {
            if throw_on_error {
                let aggregate_error = self
                    .log
                    .to_js_aggregate_error(global_this, format_args!("Bundle failed"));
                return promise.reject(global_this, aggregate_error);
            } else {
                return promise.resolve(global_this, build_result);
            }
        }
        Ok(())
    }

    /// Port of `JSBundleCompletionTask.doCompilation`.
    fn do_compilation(
        config: &JSBundlerConfig,
        env: &mut bun_dotenv::Loader,
        log: &mut bun_ast::Log,
        output_files: &mut Vec<OutputFile>,
    ) -> CompileResult {
        let compile_options = config
            .compile
            .as_ref()
            .expect("Unexpected: No compile options provided");

        if compile_options.aot.is_some() {
            // `compile_ahead_of_time` wrote the executable on the bundle thread.
            return CompileResult::Success;
        }

        let entry_point_index: usize = 'brk: {
            for (i, output_file) in output_files.iter().enumerate() {
                if output_file.output_kind == OutputKind::EntryPoint
                    && output_file.side.unwrap_or(Side::Server) == Side::Server
                {
                    break 'brk i;
                }
            }
            return CompileResult::fail(CompileErrorReason::NoEntryPoint);
        };

        let full_outfile_path = executable_path(config, compile_options);

        let dirname: &[u8] = paths::dirname(&full_outfile_path).unwrap_or(b".");
        let basename: &[u8] = paths::basename(&full_outfile_path);
        let entry_key = executable_entry_point_name(&full_outfile_path);

        if !compile_options.assets.is_empty() {
            if let Err(msg) = crate::cli::build_command::collect_compile_assets(
                &compile_options.assets,
                entry_key,
                output_files,
            ) {
                return CompileResult::fail_fmt(format_args!("{}", msg));
            }
        }

        #[cfg(not(windows))]
        let mut root_dir = Dir::cwd();
        #[cfg(windows)]
        let root_dir = Dir::cwd();

        // On Windows, don't change root_dir, just pass the full relative path
        // On POSIX, change root_dir to the target directory and pass basename
        let outfile_for_executable: &[u8] = if cfg!(windows) {
            &full_outfile_path
        } else {
            basename
        };

        if !(dirname.is_empty() || dirname == b".") {
            #[cfg(not(windows))]
            {
                // On POSIX, makeOpenPath and change root_dir
                root_dir = match root_dir.make_open_path(dirname, OpenDirOptions::default()) {
                    Ok(d) => d,
                    Err(err) => {
                        return CompileResult::fail_fmt(format_args!(
                            "Failed to open output directory {}: {}",
                            bstr::BStr::new(dirname),
                            bstr::BStr::new(err.name()),
                        ));
                    }
                };
            }
            #[cfg(windows)]
            {
                // On Windows, ensure directories exist but don't change root_dir
                if let Err(err) = root_dir.make_path(dirname) {
                    return CompileResult::fail_fmt(format_args!(
                        "Failed to create output directory {}: {}",
                        bstr::BStr::new(dirname),
                        bstr::BStr::new(err.name()),
                    ));
                }
            }
        }

        // Use the target-specific base path for compile mode, not the user-configured public_path
        let module_prefix = target_base_public_path(compile_options.compile_target.os, b"root/");

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

        let trim_plan = match compile_ahead_of_time::plan_bundle_trimming(
            compile_options,
            output_files,
            env,
            flags,
        ) {
            Ok(plan) => plan,
            Err(message) => {
                return CompileResult::fail_fmt(format_args!("{}", bstr::BStr::new(&message)));
            }
        };
        let mut additions = ExecutableAdditions {
            trim: trim_plan.as_ref(),
            ..Default::default()
        };

        let result = match to_executable(
            &compile_options.compile_target,
            output_files,
            root_dir.fd,
            module_prefix,
            outfile_for_executable,
            env,
            config.format,
            &WindowsOptions {
                hide_console: compile_options.windows_hide_console,
                icon: opt_box(&compile_options.windows_icon_path.list),
                title: opt_box(&compile_options.windows_title.list),
                publisher: opt_box(&compile_options.windows_publisher.list),
                version: opt_box(&compile_options.windows_version.list),
                description: opt_box(&compile_options.windows_description.list),
                copyright: opt_box(&compile_options.windows_copyright.list),
            },
            &compile_options.exec_argv.list,
            if compile_options.executable_path.list.is_empty() {
                None
            } else {
                Some(&compile_options.executable_path.list)
            },
            flags,
            RuntimeOptions {
                jit_policy: compile_options.jit_policy,
            },
            &mut additions,
        ) {
            Ok(r) => r,
            Err(err) => {
                return CompileResult::fail_fmt(format_args!("{}", bstr::BStr::new(err.name())));
            }
        };
        compile_ahead_of_time::add_notes(
            log,
            crate::cli::build_command::collect_trim_log_lines(
                &additions.details,
                &compile_options.trim,
            ),
        );

        if matches!(result, CompileResult::Success) {
            let entry = &mut output_files[entry_point_index];
            entry.dest_path.clone_from(&full_outfile_path);
            entry.is_executable = true;
        }

        // Write external sourcemap files next to the compiled executable and
        // keep them in the output array. Destroy all other non-entry-point files.
        // With --splitting, there can be multiple sourcemap files (one per chunk).
        let mut kept: usize = 0;
        // Swap-compact in place via index iteration so each loop body holds
        // at most one `&mut` into `output_files`.
        for i in 0..output_files.len() {
            let keep_this = if i == entry_point_index {
                true
            } else if matches!(result, CompileResult::Success)
                && output_files[i].output_kind == OutputKind::Sourcemap
                && let OutputFileValue::Buffer { bytes } = &output_files[i].value
            {
                if !bytes.is_empty() {
                    // Derive the .map filename from the sourcemap's own dest_path,
                    // placed in the same directory as the compiled executable.
                    let derived_map_basename: Box<[u8]>;
                    let map_basename: &[u8] = if !output_files[i].dest_path.is_empty() {
                        paths::basename(&output_files[i].dest_path)
                    } else {
                        let mut v = Vec::with_capacity(full_outfile_path.len() + 4);
                        v.extend_from_slice(&full_outfile_path);
                        v.extend_from_slice(b".map");
                        derived_map_basename = v.into_boxed_slice();
                        paths::basename(&derived_map_basename)
                    };

                    let sourcemap_full_path: Box<[u8]> = if dirname.is_empty() || dirname == b"." {
                        Box::from(map_basename)
                    } else {
                        let mut v = Vec::with_capacity(dirname.len() + 1 + map_basename.len());
                        v.extend_from_slice(dirname);
                        v.push(SEP);
                        v.extend_from_slice(map_basename);
                        v.into_boxed_slice()
                    };

                    // Write the sourcemap file to disk next to the executable
                    let mut pathbuf = bun_paths::path_buffer_pool::get();
                    let write_path: &[u8] = if cfg!(windows) {
                        &sourcemap_full_path
                    } else {
                        map_basename
                    };
                    let write_result = NodeFS::write_file_with_path_buffer(
                        &mut pathbuf,
                        &fs_args::WriteFile {
                            flag: FileSystemFlags::W,
                            mode: node_fs::DEFAULT_PERMISSION,
                            file: PathOrFileDescriptor::Path(PathLike::borrowed(write_path)),
                            flush: false,
                            data: StringOrBuffer::borrowed(bytes),
                            dirfd: root_dir.fd,
                            signal: None,
                        },
                    );
                    match write_result {
                        Err(err) => {
                            bun_core::Output::err(
                                err,
                                "failed to write sourcemap file '{s}'",
                                (bstr::BStr::new(write_path),),
                            );
                            // current.deinit() — `OutputFile` drops below.
                            false
                        }
                        Ok(()) => {
                            output_files[i].dest_path = sourcemap_full_path;
                            true
                        }
                    }
                } else {
                    false
                }
            } else {
                false
            };

            if keep_this {
                output_files.swap(kept, i);
                kept += 1;
            }
            // Trailing (dropped) entries are freed by `truncate` below.
        }
        output_files.truncate(kept);

        result
    }

    pub(crate) fn on_complete(self: Box<Self>) -> bun_event_loop::JsResult<()> {
        self.finish(Delivery::Deliver)
    }

    #[expect(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    fn finish(mut self: Box<Self>, delivery: Delivery) -> bun_event_loop::JsResult<()> {
        // SAFETY: the box that `schedule` leaked for this task. A task gets here from the JS
        // thread's queue or from `abort_handle`, so on that thread.
        let mut js = unsafe { bun_core::heap::take(self.js.as_ptr()) };
        js.abort_handle.leave();
        js.caller.handle.leave();
        let global_this = js.global_this;

        let deliver = delivery == Delivery::Deliver && !js.cancelled.get();
        match &mut js.owner {
            BuildOwner::Route {
                route,
                started_at_ns,
                ..
            } => {
                if deliver {
                    route.on_complete(self.result, self.log, *started_at_ns);
                } else {
                    route.on_build_abandoned();
                }
                Ok(())
            }
            BuildOwner::Promise { promise, .. } if deliver => {
                self.settle(promise.swap(), &global_this)
            }
            BuildOwner::Promise { .. } => Ok(()),
        }
    }

    fn settle(
        &mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> bun_event_loop::JsResult<()> {
        if let Ok(build) = &mut self.result
            && self.config.compile.is_some()
        {
            let compile_result = Self::do_compilation(
                &self.config,
                &mut self.env,
                &mut self.log,
                &mut build.output_files,
            );
            // `defer compile_result.deinit()` — `CompileResult` is a Rust enum
            // with owned `Vec<u8>` payloads; drops at end of scope.

            if let CompileResult::Err(err) = &compile_result {
                // `bun.handleOom(log.addError(..., bun.handleOom(dupe(..))))`
                self.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("{}", bstr::BStr::new(err.slice())),
                );
                // `this.result.value.deinit()` — owned fields drop with the overwrite.
                self.result = Err(bun_bundler::Error::CompilationFailed);
            }
        }

        match &mut self.result {
            Err(_) => return self.to_js_error(promise, global_this),
            Ok(build) => {
                let output_files = &mut build.output_files;
                let output_files_js =
                    match JSValue::create_empty_array(global_this, output_files.len()) {
                        Ok(v) => v,
                        Err(e) => return promise.reject(global_this, Err(e)),
                    };
                if output_files_js == JSValue::ZERO {
                    panic!(
                        "Unexpected pending JavaScript exception in JSBundleCompletionTask.onComplete. This is a bug in Bun."
                    );
                }

                // `output_file.to_js()` needs `&mut OutputFile` while the path
                // computation reads `self.config`. Snapshot the config slices
                // once outside the loop so the per-file `&mut` doesn't overlap
                // `&self.config`.
                let outdir_is_abs = !self.config.outdir.is_empty()
                    && bun_paths::is_absolute(&self.config.outdir.list);
                let outdir = self.config.outdir.list.clone();
                let dir = self.config.dir.list.clone();
                let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();

                let mut to_assign_on_sourcemap = JSValue::ZERO;
                for (i, output_file) in output_files.iter_mut().enumerate() {
                    let path: Box<[u8]> = if !outdir.is_empty() {
                        if outdir_is_abs {
                            Box::from(join_abs_string::<platform::Auto>(
                                &outdir,
                                &[&output_file.dest_path],
                            ))
                        } else {
                            Box::from(join_abs_string::<platform::Auto>(
                                top_level_dir,
                                &[&dir, &outdir, &output_file.dest_path],
                            ))
                        }
                    } else {
                        output_file.dest_path.clone()
                    };
                    let result = output_file.to_js(Some(&path), global_this);
                    if to_assign_on_sourcemap != JSValue::ZERO {
                        crate::generated_bindgen::js_bundler::js_BuildArtifact::sourcemap_set_cached(
                            to_assign_on_sourcemap,
                            global_this,
                            result,
                        );
                        to_assign_on_sourcemap = JSValue::ZERO;
                    }

                    if output_file.source_map_index != u32::MAX {
                        to_assign_on_sourcemap = result;
                    }

                    if let Err(e) = output_files_js.put_index(global_this, i as u32, result) {
                        return promise.reject(global_this, Err(e));
                    }
                }

                let build_output = JSValue::create_empty_object(global_this, 4);
                build_output.put(global_this, b"outputs", output_files_js);
                build_output.put(global_this, b"success", JSValue::TRUE);
                match self.log.to_js_array(global_this) {
                    Ok(v) => build_output.put(global_this, b"logs", v),
                    Err(e) => return promise.reject(global_this, Err(e)),
                };

                // metafile: { json: <lazy parsed>, markdown?: string }
                if let Some(metafile) = &build.metafile {
                    let metafile_js_str =
                        match bun_string_jsc::create_utf8_for_js(global_this, metafile) {
                            Ok(v) => v,
                            Err(e) => return promise.reject(global_this, Err(e)),
                        };
                    let metafile_md_str = match &build.metafile_markdown {
                        Some(md) => match bun_string_jsc::create_utf8_for_js(global_this, md) {
                            Ok(v) => v,
                            Err(e) => return promise.reject(global_this, Err(e)),
                        },
                        None => JSValue::UNDEFINED,
                    };
                    Bun__setupLazyMetafile(
                        global_this,
                        build_output,
                        metafile_js_str,
                        metafile_md_str,
                    );
                }

                let did_handle_callbacks = if let Some(plugin) = self.plugins_mut() {
                    match Self::run_on_end_callbacks(
                        global_this,
                        plugin,
                        promise,
                        build_output,
                        Ok(JSValue::UNDEFINED),
                    ) {
                        Ok(b) => b,
                        Err(e) => return promise.reject(global_this, Err(e)),
                    }
                } else {
                    false
                };

                if !did_handle_callbacks {
                    return promise.resolve(global_this, build_output);
                }
            }
        }
        Ok(())
    }
}

// ─── C++ FFI ─────────────────────────────────────────────────────────────────
// `jsc.conv` — sysv64 on Windows-x64, C elsewhere. `Bun__setupLazyMetafile` is
// a hand-written C++ symbol from `BundlerMetafile.cpp` (not codegen-emitted),
// so a local extern block is the correct binding.
bun_jsc::jsc_abi_extern! {
    safe fn Bun__setupLazyMetafile(
        global_this: &JSGlobalObject,
        build_output: JSValue,
        metafile_json_string: JSValue,
        metafile_markdown_string: JSValue,
    );
}

// ─── On the bundle thread ────────────────────────────────────────────────────

impl JSBundleCompletionTask {
    /// The set-up after `Transpiler::init`. Returns `config`, which `transpiler` borrows from then on.
    fn configure_bundler<'a>(
        config: &'a mut JSBundlerConfig,
        declarations: &mut Option<DeclarationOutputs>,
        transpiler: &mut Transpiler<'a>,
    ) -> bun_bundler::Result<&'a JSBundlerConfig> {
        transpiler.options.env.behavior = config.env_behavior;
        transpiler.options.env.prefix = Box::from(config.env_prefix.list.as_slice());
        // `BundleOptions.bundler_feature_flags: Option<Box<StringSet>>` owns
        // its set, so clone rather than alias `config.features`.
        transpiler.options.bundler_feature_flags = Some(Box::new(config.features.clone()?));
        if config.force_node_env != options::ForceNodeEnv::Unspecified {
            transpiler.options.force_node_env = config.force_node_env;
        }

        transpiler.options.entry_points = config.entry_points.keys().to_vec().into_boxed_slice();
        // Convert API JSX config back to options.JSX.Pragma
        let jsx_import = &config.jsx.import_source;
        let default_factory = options::jsx::MemberList::Static(options::jsx::defaults::FACTORY);
        let default_fragment = options::jsx::MemberList::Static(options::jsx::defaults::FRAGMENT);
        transpiler.options.jsx = options::jsx::Pragma {
            factory: options::jsx::Pragma::member_list_to_components_if_different(
                &default_factory,
                &config.jsx.factory,
            )
            .unwrap_or(default_factory),
            fragment: options::jsx::Pragma::member_list_to_components_if_different(
                &default_fragment,
                &config.jsx.fragment,
            )
            .unwrap_or(default_fragment),
            runtime: options::jsx::Runtime::from(config.jsx.runtime),
            development: config.jsx.development,
            package_name: if !jsx_import.is_empty() {
                std::borrow::Cow::Owned(jsx_import.to_vec())
            } else {
                std::borrow::Cow::Borrowed(b"react".as_slice())
            },
            classic_import_source: if !jsx_import.is_empty() {
                std::borrow::Cow::Owned(jsx_import.to_vec())
            } else {
                std::borrow::Cow::Borrowed(b"react".as_slice())
            },
            side_effects: config.jsx.side_effects,
            parse: true,
            import_source: options::jsx::ImportSource {
                development: if !jsx_import.is_empty() {
                    let mut v = Vec::with_capacity(jsx_import.len() + 16);
                    let _ = write!(&mut v, "{}/jsx-dev-runtime", bstr::BStr::new(jsx_import));
                    std::borrow::Cow::Owned(v)
                } else {
                    std::borrow::Cow::Borrowed(options::jsx::defaults::IMPORT_SOURCE_DEV)
                },
                production: if !jsx_import.is_empty() {
                    let mut v = Vec::with_capacity(jsx_import.len() + 12);
                    let _ = write!(&mut v, "{}/jsx-runtime", bstr::BStr::new(jsx_import));
                    std::borrow::Cow::Owned(v)
                } else {
                    std::borrow::Cow::Borrowed(options::jsx::defaults::IMPORT_SOURCE)
                },
            },
        };
        transpiler.options.no_macros = config.no_macros;
        transpiler.options.loaders =
            options::loaders_from_transform_options(config.loaders.as_ref(), config.target)?;
        transpiler
            .options
            .entry_naming
            .clone_from(&config.names.entry_point.data);
        transpiler
            .options
            .chunk_naming
            .clone_from(&config.names.chunk.data);
        transpiler
            .options
            .asset_naming
            .clone_from(&config.names.asset.data);

        transpiler.options.output_format = config.format;
        transpiler.options.bytecode = config.bytecode;
        transpiler.options.bytecode_depth = config.bytecode_depth;
        transpiler.options.optimize_bytecode = config.optimize_bytecode;
        if let Some(compile) = &config.compile {
            transpiler
                .options
                .bytecode_order
                .clone_from(&compile.bytecode_order);
        }
        transpiler.options.compile_mode = if config.compile.is_some() {
            options::CompileMode::Executable
        } else {
            options::CompileMode::None
        };
        transpiler.options.inline_entrypoint_import_meta_main = config.compile.is_some();

        // For compile mode, set the public_path to the target-specific base path
        // This ensures embedded resources like yoga.wasm are correctly found
        if let Some(compile_opts) = &config.compile {
            let base_public_path =
                target_base_public_path(compile_opts.compile_target.os, b"root/");
            transpiler.options.public_path = Box::from(base_public_path);
        } else {
            transpiler.options.public_path = Box::from(config.public_path.list.as_slice());
        }

        transpiler.options.output_dir = Box::from(config.outdir.list.as_slice());
        transpiler.options.root_dir = Box::from(config.rootdir.list.as_slice());
        transpiler.options.minify_syntax = config.minify.syntax;
        transpiler.options.is_library = config.dts;
        transpiler.options.minify_whitespace = config.minify.whitespace;
        transpiler.options.minify_identifiers = config.minify.identifiers;
        transpiler.options.keep_names = config.minify.keep_names;
        transpiler.options.inlining = config.minify.syntax;
        transpiler.options.source_map = config.source_map;
        transpiler.options.packages = config.packages;
        transpiler.options.allow_unresolved = match &config.allow_unresolved {
            Some(a) => options::AllowUnresolved::from_strings(
                a.keys().to_vec().into_boxed_slice(),
                |p, s| bun_glob::r#match(p, s).matches(),
            ),
            None => options::AllowUnresolved::All,
        };
        transpiler.options.code_splitting = config.code_splitting;
        transpiler.options.split_require = config.split_require;
        transpiler.options.emit_dce_annotations = config
            .emit_dce_annotations
            .unwrap_or(!config.minify.whitespace);
        transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
        transpiler.options.deprecated_namespace_object_setters =
            config.deprecated_namespace_object_setters;
        transpiler.options.tree_shaking_override = config.tree_shaking;
        transpiler.options.css_chunking = config.css_chunking;
        transpiler.options.min_chunk_size = config.min_chunk_size;
        transpiler.options.fold_chunks = config.fold_chunks;
        transpiler.options.module_preload = config.module_preload;
        transpiler.options.type_check = match config.dts {
            true => Some(check_types_and_emit_declarations as options::TypeCheck),
            false => config.check.then_some(check_types as options::TypeCheck),
        };
        if config.dts {
            let unsupported = [
                (config.minify.identifiers, "minify.identifiers"),
                (
                    config.format != options::Format::Esm,
                    "a format other than esm",
                ),
                (
                    config.source_map == options::SourceMapOption::Inline,
                    "an inline source map",
                ),
            ];
            let has_typescript_entry_point = (config.entry_points.keys().iter()).any(|path| {
                !matches!(paths::extension(path), b".js" | b".mjs" | b".cjs" | b".jsx")
            });
            let typed_files_skipped_for = (unsupported.iter())
                .find(|it| it.0 && has_typescript_entry_point)
                .map(|it| it.1);
            let writes_typed_files =
                has_typescript_entry_point && typed_files_skipped_for.is_none();
            let drops_source_maps =
                writes_typed_files && config.source_map == options::SourceMapOption::None;
            if drops_source_maps {
                transpiler.options.source_map = options::SourceMapOption::External;
            }
            *declarations = Some(DeclarationOutputs {
                loaders: bun_core::UnwrapOrOom::unwrap_or_oom(transpiler.options.loaders.clone()),
                typed_files_skipped_for,
                writes_typed_files,
                drops_source_maps,
            });
        }
        let compile_to_standalone_html = 'brk: {
            if config.compile.is_none() || config.target != bun_ast::Target::Browser {
                break 'brk false;
            }
            // Only activate standalone HTML when all entrypoints are HTML files
            for ep in config.entry_points.keys() {
                if !ep.ends_with(b".html") {
                    break 'brk false;
                }
            }
            config.entry_points.count() > 0
        };
        // When compiling to standalone HTML, don't use the bun executable compile path
        if compile_to_standalone_html {
            transpiler.options.compile_mode = options::CompileMode::StandaloneHtml;
            config.compile = None;
        }
        let config: &'a JSBundlerConfig = config;
        if let Some(compile) = &config.compile {
            let executable = executable_path(config, compile);
            transpiler.options.compile_entry_point_name =
                Box::from(executable_entry_point_name(&executable));
        }
        // `BundleOptions.{banner,footer}` are `Cow<'static, [u8]>`; clone into
        // Owned so the static bound holds without tying `&mut self` to `'a`.
        transpiler.options.banner = std::borrow::Cow::Owned(config.banner.list.clone());
        transpiler.options.footer = std::borrow::Cow::Owned(config.footer.list.clone());
        transpiler.options.react_fast_refresh = config.react_fast_refresh;
        transpiler.options.react_compiler = if config.react_compiler.is_enabled() {
            config.react_compiler_output_mode.unwrap_or_else(|| {
                if config.target.is_server_side() {
                    bun_ast::runtime::ReactCompilerMode::Ssr
                } else {
                    bun_ast::runtime::ReactCompilerMode::Client
                }
            })
        } else {
            bun_ast::runtime::ReactCompilerMode::Disabled
        };
        transpiler.options.react_compiler_parse_test_pragmas =
            config.react_compiler_parse_test_pragmas;
        transpiler.options.metafile = config.metafile;
        transpiler.options.metafile_json_path =
            Box::from(config.metafile_json_path.list.as_slice());
        transpiler.options.metafile_markdown_path =
            Box::from(config.metafile_markdown_path.list.as_slice());
        if config.optimize_imports.count() > 0 {
            transpiler.options.optimize_imports = Some(&config.optimize_imports);
        }

        if transpiler.options.compile_mode.is_executable() {
            // Emitting DCE annotations is nonsensical in --compile.
            transpiler.options.emit_dce_annotations = false;
        }

        transpiler.configure_linker();
        transpiler.configure_defines()?;

        // After configure_defines(): downloading the target reads proxy/TLS settings from the loaded env.
        transpiler.options.compile_target_builtins = match &config.compile {
            Some(compile)
                if config.bytecode
                    && (!compile.compile_target.is_default()
                        || !compile.executable_path.list.is_empty()) =>
            {
                match bun_standalone_graph::StandaloneModuleGraph::target_builtins(
                    &compile.compile_target,
                    transpiler.env_mut(),
                    Some(&compile.executable_path.list[..]).filter(|p| !p.is_empty()),
                ) {
                    Ok(Some(section)) => options::CompileTargetBuiltins::Target(section),
                    Ok(None) => options::CompileTargetBuiltins::None,
                    Err(err) => {
                        transpiler.log_mut().add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!("{}", bstr::BStr::new(err.slice())),
                        );
                        return Err(bun_bundler::Error::BuildFailed);
                    }
                }
            }
            _ => options::CompileTargetBuiltins::Host,
        };

        if !transpiler.options.production {
            transpiler
                .options
                .conditions
                .append_slice(&[b"development"])?;
        }
        // `transpiler.env` is the dotenv loader installed by
        // `Transpiler::init`; non-null and valid for `'a`.
        transpiler.resolver.env_loader = NonNull::new(transpiler.env);
        // `Resolver.opts` is the resolver-crate subset
        // — re-project from the now-mutated `transpiler.options`.
        transpiler.sync_resolver_opts();
        Ok(config)
    }

    fn run(mut self: Box<Self>, ticket: jsc::Ticket, generation: bun_core::Generation) {
        let heap = Arena::new();
        let mut ast_memory_store = bun_ast::ASTMemoryAllocator::default();
        // Declared here so that it drops after `ticket.post`.
        let mut transpiler = None;
        let _ast_scope = ast_memory_store.enter();

        self.result = self.build(&mut transpiler, &heap, &ticket, generation);

        // It knows a source by its address, and the log outlives the sources.
        self.log.line_column_tracker = None;
        if let Some(declarations) = self.declarations.take() {
            self.add_declarations(&declarations);
        }
        ticket.post(ConcurrentTask::create_boxed(self));
        // Before the locals drop: the VM does not wait for them.
        drop(ticket);
    }

    fn transform_options(config: &JSBundlerConfig) -> api::TransformOptions {
        api::TransformOptions {
            define: if config.define.count() > 0 {
                Some(api::StringMap {
                    keys: config.define.keys().to_vec(),
                    values: config.define.values().to_vec(),
                })
            } else {
                None
            },
            entry_points: config.entry_points.keys().to_vec(),
            target: Some(config.target.to_api()),
            absolute_working_dir: if !config.dir.list.is_empty() {
                Some(Box::from(config.dir.list.as_slice()))
            } else {
                None
            },
            inject: Vec::new(),
            external: config.external.keys().to_vec(),
            // The macro VM is also created from these.
            loaders: config.loaders.clone(),
            main_fields: Vec::new(),
            extension_order: Vec::new(),
            env_files: Vec::new(),
            conditions: config.conditions.keys().to_vec(),
            // Use the config value, which `configure_bundler` reapplies anyway.
            ignore_dce_annotations: config.ignore_dce_annotations,
            drop: config.drop.keys().to_vec(),
            bunfig_path: Box::default(),
            jsx: Some(config.jsx.clone()),
            // Relative to where the entry points are relative to, as for `--tsconfig-override`.
            tsconfig_override: (!config.tsconfig_override.list.is_empty()).then(|| {
                let cwd = match config.dir.list.is_empty() {
                    true => bun_resolver::fs::FileSystem::get().top_level_dir(),
                    false => config.dir.list.as_slice(),
                };
                let path = config.tsconfig_override.list.as_slice();
                let mut spill = Vec::new();
                Box::from(bun_paths::resolve_path::join_abs_string_spill::<
                    bun_paths::platform::Auto,
                >(cwd, &mut spill, &[path]))
            }),
            ..Default::default()
        }
    }

    fn build<'a>(
        &'a mut self,
        transpiler: &'a mut Option<Transpiler<'a>>,
        heap: &'a Arena,
        ticket: &'a jsc::Ticket,
        generation: bun_core::Generation,
    ) -> bun_bundler::Result<BuildResult> {
        let log = &mut self.log;
        let opts = Self::transform_options(&self.config);
        let env = Some(&raw mut self.env);
        let transpiler = transpiler.insert(Transpiler::init(heap, &raw mut *log, opts, env)?);
        let config = Self::configure_bundler(&mut self.config, &mut self.declarations, transpiler)?;
        transpiler.resolver.generation = generation;

        // Declared before `bv2` so it outlives the BACKREF in `BundleV2.loop`.
        let any_loop = bun_event_loop::AnyEventLoop::default();
        let event_loop: bun_bundler::linker_context_mod::EventLoop = Some(NonNull::from(&any_loop));

        let worker_pool = Some(NonNull::from(WorkPool::get()));
        let plugins = self.plugins.map(JsPtr::as_non_null);
        let completion = dispatch::CompletionHandle {
            cancelled: &bundle_thread::CANCELLED,
            poster: ticket,
        };
        let file_map = (!config.files.map.is_empty()).then_some(&config.files);
        let entry_points: Vec<&[u8]> = config.entry_points.keys().iter().map(|b| &**b).collect();

        if let Some(compile) = &config.compile
            && let Some(aot) = compile.aot.as_deref()
        {
            let bundler = BundlerInputs {
                transpiler,
                arena: heap,
                event_loop,
                worker_pool,
                plugins: plugins.map(|plugins| PluginSetup {
                    plugins,
                    context: self.context,
                    completion,
                }),
                file_map,
            };
            let compiled =
                compile_ahead_of_time::compile(config, compile, aot, &entry_points, bundler);
            return compile_ahead_of_time::finish_compilation(config, compiled, log);
        }

        let mut bv2 = BundleV2::init(transpiler, None, heap, event_loop, worker_pool, heap);
        bv2.plugins = plugins;
        bv2.plugin_context = self.context;
        bv2.completion = Some(completion);
        bv2.file_map = file_map;

        bv2.run_from_js_in_new_thread(&entry_points)
    }
}

impl BoxedTask for JSBundleCompletionTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::JSBundleCompletionTask;
    fn release_unrun(self: Box<Self>) {
        let _ = self.finish(Delivery::Abandon);
    }
    /// The context whose script called `Bun.build`.
    fn context(&self) -> bun_event_loop::ContextId {
        self.context
    }
}
