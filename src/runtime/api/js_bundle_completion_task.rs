//! One in-flight `Bun.build()`: [`JSBundleCompletionTask`] is what stays on the
//! JS thread (promise, keep-alive, plugins, the HTMLBundle route waiting on
//! it), [`BundleJob`] is what the bundle thread runs and drops, and
//! [`BuildShared`] is what both (and the running `BundleV2`) reach: the
//! cancellation flags, the ticket that lets the bundle thread post back to
//! this VM, and the slot the outcome comes back through.
//!
//! LAYERING: these live in `bun_runtime` (not `bun_bundler_jsc`) because their
//! fields name `bun_runtime` types (`JSBundler::Config`, `Plugin`,
//! `HTMLBundle::Route`); the bundler sees `BundleJob` through
//! [`CompletionStruct`] and `BuildShared` through [`CompletionDispatch`].

use bun_options_types::TargetExt as _;
use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};
use std::io::Write as _;
use std::sync::Arc;

use bun_alloc::Arena;
use bun_bundler::bundle_v2::dispatch::CompletionDispatch;
use bun_bundler::bundle_v2::{BundleV2, BundleV2Result, CompletionStruct};
use bun_bundler::options::{self, OutputFile, OutputKind, Side};
use bun_bundler::output_file::Value as OutputFileValue;
use bun_bundler::transpiler::Transpiler;
use bun_core::env::OperatingSystem;
use bun_event_loop::TaskHop;
use bun_io::KeepAlive;
use bun_jsc::WorkPool;
use bun_jsc::bun_string_jsc;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, JsCell, LogJsc as _};
use bun_options_types::WindowsOptions;
use bun_options_types::schema::api;
use bun_paths::resolve_path::{join_abs_string, join_abs_string_buf, platform};
use bun_paths::{self as paths, PathBuffer, SEP};
use bun_ptr::{BackRef, RefCount, RefPtr, ThisPtr};
use bun_standalone_graph::StandaloneModuleGraph::{
    CompileErrorReason, CompileResult, Flags as StandaloneFlags, target_base_public_path,
    to_executable,
};
use bun_sys::Dir;
#[cfg(not(windows))]
use bun_sys::OpenDirOptions;
use bun_threading::Guarded;

use crate::api::js_bundler::js_bundler::{Config as JSBundlerConfig, Plugin, PluginJscExt};
use crate::api::output_file_jsc::OutputFileJsc as _;
use crate::jsc_hooks::ActiveHandle;
use crate::node::fs::{self as node_fs, NodeFS, args as fs_args};
use crate::node::types::{FileSystemFlags, PathLike, PathOrFileDescriptor, StringOrBuffer};
use crate::server::html_bundle;

/// The JS-thread side of a `Bun.build`. Reference-counted; `build_ref` is the
/// in-flight build's reference (set in [`schedule`](Self::schedule), released
/// by [`on_complete`](Self::on_complete), or by teardown for a build the bundle
/// thread never started), and is what the completion hop's `ThisPtr` and the
/// [`ActiveHandle`] registration point at.
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "JSBundleCompletionTask")]
pub struct JSBundleCompletionTask {
    ref_count: RefCount<Self>,
    build_ref: Cell<Option<RefPtr<Self>>>,
    pub(crate) shared: Arc<BuildShared>,
    pub global_this: BackRef<JSGlobalObject>,
    pub(crate) promise: JsCell<jsc::JSPromiseStrong>,
    poll_ref: JsCell<KeepAlive>,
    /// The C++ `JSBundlerPlugin` cell, `protect()`ed; destroyed with this task
    /// (or given up to the HTMLBundle route, which owns its server's plugins).
    plugins: Cell<Option<NonNull<Plugin>>>,
    /// The route this build is for, kept alive until `on_complete` hands it
    /// the result.
    pub(crate) html_build_task: Cell<Option<RefPtr<html_bundle::Route>>>,
    pub(crate) started_at_ns: u64,
    /// The bundle thread's half, until `schedule` hands it over.
    job: Option<Box<BundleJob>>,
}

/// What the bundle thread runs: the build's configuration going out, its log
/// and result coming back (moved into [`BuildShared::outcome`] when done).
pub struct BundleJob {
    shared: Arc<BuildShared>,
    outcome: Option<Box<BuildOutcome>>,
    /// The owning VM's env loader (`vm.transpiler.env`), which the build's
    /// transpiler reads; alive while the ticket is held.
    env: AtomicPtr<bun_dotenv::Loader>,
    /// The plugin cell the JS side owns; the running `BundleV2` matches paths
    /// against it from the bundle thread.
    plugins: AtomicPtr<Plugin>,
    /// Intrusive link for the bundle thread's queue.
    next: bun_threading::Link<BundleJob>,
}
bun_threading::intrusive_link!(BundleJob, next);

/// Shared by the JS side, the bundle job and the running `BundleV2`.
pub struct BuildShared {
    /// Set by the owner giving up on the result (its VM's stop phase); read by
    /// `on_complete` (skip delivery) and by the bundle thread
    /// ([`CompletionDispatch::is_cancelled`]: stop waiting on plugins, fail
    /// the build).
    cancelled: AtomicBool,
    /// [`Stage`].
    stage: AtomicU8,
    /// Held from creation until the bundle thread posts the completion (or the
    /// JS thread releases a build that never started): how the bundle thread
    /// and its plugin hops reach the VM that called `Bun.build`, and what
    /// makes that VM wait for them.
    ticket: Guarded<Option<jsc::Ticket>>,
    /// The JS side's address, for the completion hop; it keeps itself alive
    /// for that hop through `build_ref`.
    js: AtomicPtr<JSBundleCompletionTask>,
    /// The bundle thread's hand-back: taken by `on_complete`.
    outcome: Guarded<Option<Box<BuildOutcome>>>,
}

/// What comes back from the bundle thread.
pub struct BuildOutcome {
    pub(crate) config: JSBundlerConfig,
    pub(crate) log: bun_ast::Log,
    pub(crate) result: BundleV2Result,
}

#[repr(u8)]
enum Stage {
    /// On the bundle thread's queue; nothing there has touched it.
    Queued = 0,
    /// The bundle thread is (or was) running it.
    Started = 1,
    /// Its VM tore down first and released the JS side; the bundle thread
    /// drops the job unrun when it dequeues it.
    Released = 2,
}

impl Drop for JSBundleCompletionTask {
    fn drop(&mut self) {
        self.poll_ref.with_mut(|p| {
            if p.is_active() {
                p.disable();
            }
        });
        if let Some(plugin) = self.plugins.take() {
            Plugin::destroy(plugin.as_ptr());
        }
    }
}

/// `task_tag::JSBundleCompletionTask`: the bundle thread posted the outcome.
pub struct CompletionHop;
// SAFETY: the only hop for `JSBundleCompletionTask`; `build_ref` keeps the task
// alive from `schedule` until `on_complete` releases it.
unsafe impl TaskHop for CompletionHop {
    type Target = JSBundleCompletionTask;
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::JSBundleCompletionTask;
    fn run(this: ThisPtr<JSBundleCompletionTask>) -> bun_event_loop::JsResult<()> {
        JSBundleCompletionTask::on_complete(this)
    }
    /// A build handed back unrun during teardown (cancelled in the stop phase)
    /// releases the keep-alive, plugin cell and promise against the live heap
    /// without delivering.
    fn release_unrun(this: ThisPtr<JSBundleCompletionTask>) {
        let _ = JSBundleCompletionTask::on_complete(this);
    }
}

impl JSBundleCompletionTask {
    /// An unscheduled build of `config`; see [`schedule`](Self::schedule).
    pub(crate) fn new(
        config: JSBundlerConfig,
        plugins: Option<NonNull<Plugin>>,
        global_this: &JSGlobalObject,
    ) -> JSBundleCompletionTask {
        let vm = global_this.bun_vm();
        let shared = Arc::new(BuildShared {
            cancelled: AtomicBool::new(false),
            stage: AtomicU8::new(Stage::Queued as u8),
            ticket: Guarded::new(Some(vm.ticket())),
            js: AtomicPtr::new(core::ptr::null_mut()),
            outcome: Guarded::new(None),
        });
        let job = Box::new(BundleJob {
            shared: Arc::clone(&shared),
            outcome: Some(Box::new(BuildOutcome {
                config,
                log: bun_ast::Log::init(),
                result: BundleV2Result::Pending,
            })),
            env: AtomicPtr::new(vm.transpiler.env),
            plugins: AtomicPtr::new(plugins.map_or(core::ptr::null_mut(), |p| p.as_ptr())),
            next: bun_threading::Link::new(),
        });
        JSBundleCompletionTask {
            ref_count: RefCount::init(),
            build_ref: Cell::new(None),
            shared,
            global_this: BackRef::new(global_this),
            promise: JsCell::new(jsc::JSPromiseStrong::default()),
            poll_ref: JsCell::new(KeepAlive::init()),
            plugins: Cell::new(plugins),
            html_build_task: Cell::new(None),
            started_at_ns: 0,
            job: Some(job),
        }
    }

    /// `BundleV2.createAndScheduleCompletionTask` — take a process-keepalive
    /// ref and hand the job to the bundle-thread singleton.
    pub(crate) fn schedule(mut self) {
        let job = self.job.take().expect("scheduled once");
        let this = RefPtr::new(self);
        let task = this.this_ptr();
        task.poll_ref
            .with_mut(|p| p.ref_(task.global_this.bun_vm().loop_ctx()));
        task.shared.js.store(this.as_ptr(), Ordering::Release);
        task.build_ref.set(Some(this));

        // Ensure this exists before we spawn the thread to prevent any race
        // conditions from creating two
        let _ = WorkPool::get();

        // Out on the bundle thread from here until it posts the completion: it
        // reads this VM's env loader and the plugin cell, so the VM cancels it at
        // teardown (registry) and waits for it (the ticket).
        Self::active_handle(task).register();
        bun_bundler::bundle_v2::singleton::enqueue(job);
    }

    fn active_handle(this: ThisPtr<Self>) -> ActiveHandle {
        ActiveHandle::Bundle(NonNull::new(this.as_ptr()).expect("ThisPtr is non-null"))
    }

    /// Release the in-flight build's reference; the last touch of `this`.
    fn release(this: ThisPtr<Self>) {
        drop(this.build_ref.take());
    }

    fn plugins_ref(&self) -> Option<&Plugin> {
        self.plugins.get().map(|p| Plugin::opaque_ref(p.as_ptr()))
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

impl JSBundleCompletionTask {
    /// Returns true if the promises were handled and resolved from
    /// BundlePlugin.ts; false means the caller should resolve immediately.
    fn run_on_end_callbacks(
        global_this: &JSGlobalObject,
        plugin: &Plugin,
        promise: &JSPromise,
        build_result: JSValue,
        rejection: jsc::JsResult<JSValue>,
    ) -> jsc::JsResult<bool> {
        let value = plugin.run_on_end_callbacks(global_this, promise, build_result, rejection)?;
        Ok(value != JSValue::UNDEFINED)
    }

    fn to_js_error(
        &self,
        outcome: &BuildOutcome,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        let throw_on_error = outcome.config.throw_on_error;
        let log = &outcome.log;

        let build_result = JSValue::create_empty_object(global_this, 3);
        match JSValue::create_empty_array(global_this, 0) {
            Ok(v) => build_result.put(global_this, b"outputs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };
        build_result.put(global_this, b"success", JSValue::FALSE);
        match log.to_js_array(global_this) {
            Ok(v) => build_result.put(global_this, b"logs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };

        let did_handle_callbacks = if let Some(plugin) = self.plugins_ref() {
            let rejection = if throw_on_error {
                log.to_js_aggregate_error(global_this, format_args!("Bundle failed"))
            } else {
                Ok(JSValue::UNDEFINED)
            };
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
                let aggregate_error =
                    log.to_js_aggregate_error(global_this, format_args!("Bundle failed"));
                return promise.reject(global_this, aggregate_error);
            } else {
                return promise.resolve(global_this, build_result);
            }
        }
        Ok(())
    }

    /// Port of `JSBundleCompletionTask.doCompilation`.
    fn do_compilation(
        &self,
        config: &JSBundlerConfig,
        output_files: &mut Vec<OutputFile>,
    ) -> CompileResult {
        let compile_options = config
            .compile
            .as_ref()
            .expect("Unexpected: No compile options provided");

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

        let mut outbuf = paths::path_buffer_pool::get();
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

        // Always get an absolute path for the outfile to ensure it works
        // correctly with PE metadata operations.
        // Add .exe extension for Windows targets if not already present.
        let full_outfile_path: Box<[u8]> = {
            let outdir_slice = &config.outdir.list;
            let outfile_slice = &compile_options.outfile.list;
            let joined: &[u8] = if !outdir_slice.is_empty() {
                join_abs_string_buf::<platform::Auto>(
                    top_level_dir,
                    &mut outbuf[..],
                    &[outdir_slice, outfile_slice],
                )
            } else if paths::is_absolute(outfile_slice) {
                outfile_slice
            } else {
                // For relative paths, ensure we make them absolute relative to the current working directory
                join_abs_string_buf::<platform::Auto>(
                    top_level_dir,
                    &mut outbuf[..],
                    &[outfile_slice],
                )
            };
            if compile_options.compile_target.os == OperatingSystem::Windows
                && !joined.ends_with(b".exe")
            {
                let mut v = Vec::with_capacity(joined.len() + 4);
                v.extend_from_slice(joined);
                v.extend_from_slice(b".exe");
                v.into_boxed_slice()
            } else {
                Box::from(joined)
            }
        };

        let dirname: &[u8] = paths::dirname(&full_outfile_path).unwrap_or(b".");
        let basename: &[u8] = paths::basename(&full_outfile_path);

        // Key the entry point at /$bunfs/root/<basename> like the CLI (which renames before appending .exe).
        let entry_key = basename.strip_suffix(b".exe").unwrap_or(basename);
        output_files[entry_point_index].dest_path = Box::from(entry_key);

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

        let result = match to_executable(
            &compile_options.compile_target,
            output_files,
            root_dir.fd,
            module_prefix,
            outfile_for_executable,
            self.global_this.bun_vm().transpiler.env_mut(),
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
        ) {
            Ok(r) => r,
            Err(err) => {
                return CompileResult::fail_fmt(format_args!("{}", bstr::BStr::new(err.name())));
            }
        };

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
                && matches!(output_files[i].value, OutputFileValue::Buffer { .. })
            {
                let bytes_len = match &output_files[i].value {
                    OutputFileValue::Buffer { bytes } => bytes.len(),
                    _ => 0,
                };
                if bytes_len > 0 {
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
                    let mut pathbuf = PathBuffer::uninit();
                    let write_path: &[u8] = if cfg!(windows) {
                        &sourcemap_full_path
                    } else {
                        map_basename
                    };
                    let OutputFileValue::Buffer { bytes } = &output_files[i].value else {
                        unreachable!()
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

    /// VM teardown's stop phase (JS thread): give up on the result.
    ///
    /// * Still queued behind other builds: release the JS side here (plugin
    ///   cell, promise, keep-alive), return the ticket, and leave the job for
    ///   the bundle thread to drop when it dequeues it — the VM does not wait
    ///   behind other VMs' builds.
    /// * Already on the bundle thread: tombstone the plugin — which answers what
    ///   the plugins still hold as cancelled — then cancel and wake the bundle
    ///   thread; it consumes those answers, fails the build and posts the
    ///   completion, which teardown waits for and releases.
    pub(crate) fn stop_for_vm_teardown(this: ThisPtr<Self>) {
        let shared = &this.shared;
        if shared
            .stage
            .compare_exchange(
                Stage::Queued as u8,
                Stage::Released as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
        {
            this.poll_ref.with_mut(|p| p.disable());
            if let Some(plugin) = this.plugins.take() {
                Plugin::destroy(plugin.as_ptr());
            }
            this.promise.set(jsc::JSPromiseStrong::default());
            *shared.ticket.lock() = None;
            Self::release(this);
            return;
        }
        if let Some(plugins) = this.plugins.get() {
            PluginJscExt::tombstone(Plugin::opaque_ref(plugins.as_ptr()));
        }
        shared.cancelled.store(true, Ordering::Release);
        bun_bundler::bundle_v2::singleton::wake();
    }

    fn on_complete(this: ThisPtr<Self>) -> bun_event_loop::JsResult<()> {
        Self::active_handle(this).unregister();
        this.poll_ref
            .with_mut(|p| p.unref(this.global_this.bun_vm().loop_ctx()));
        let outcome = this.shared.outcome.lock().take();
        let result = if this.shared.cancelled.load(Ordering::Acquire) {
            Ok(())
        } else {
            this.deliver(
                outcome.expect("the bundle thread posts the outcome before the completion"),
            )
        };
        Self::release(this);
        result
    }

    fn deliver(&self, mut outcome: Box<BuildOutcome>) -> bun_event_loop::JsResult<()> {
        if let Some(html_build_task) = self.html_build_task.take() {
            self.plugins.set(None);
            html_build_task.on_complete(&mut outcome, self.started_at_ns);
            return Ok(());
        }

        let global_this = self.global_this.get();
        let mut promise_strong = self.promise.take();
        let promise = promise_strong.swap();

        if matches!(outcome.result, BundleV2Result::Value(_)) && outcome.config.compile.is_some() {
            let BundleV2Result::Value(build) = &mut outcome.result else {
                unreachable!()
            };
            let mut output_files = core::mem::take(&mut build.output_files);
            let compile_result = self.do_compilation(&outcome.config, &mut output_files);

            if let CompileResult::Err(err) = &compile_result {
                outcome.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("{}", bstr::BStr::new(err.slice())),
                );
                drop(output_files);
                outcome.result = BundleV2Result::Err(bun_bundler::Error::CompilationFailed);
            } else {
                let BundleV2Result::Value(build) = &mut outcome.result else {
                    unreachable!()
                };
                build.output_files = output_files;
            }
        }

        match outcome.result {
            BundleV2Result::Pending => unreachable!(),
            BundleV2Result::Err(_) => return self.to_js_error(&outcome, promise, global_this),
            BundleV2Result::Value(_) => {}
        }
        let BundleV2Result::Value(build) = &mut outcome.result else {
            unreachable!()
        };
        let config = &outcome.config;
        let output_files = &mut build.output_files;
        let output_files_js = match JSValue::create_empty_array(global_this, output_files.len()) {
            Ok(v) => v,
            Err(e) => return promise.reject(global_this, Err(e)),
        };
        if output_files_js == JSValue::ZERO {
            panic!(
                "Unexpected pending JavaScript exception in JSBundleCompletionTask.onComplete. This is a bug in Bun."
            );
        }

        let outdir_is_abs =
            !config.outdir.is_empty() && bun_paths::is_absolute(&config.outdir.list);
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

        let mut to_assign_on_sourcemap = JSValue::ZERO;
        for (i, output_file) in output_files.iter_mut().enumerate() {
            let path: Box<[u8]> = if !config.outdir.is_empty() {
                if outdir_is_abs {
                    Box::from(join_abs_string::<platform::Auto>(
                        &config.outdir.list,
                        &[&output_file.dest_path],
                    ))
                } else {
                    Box::from(join_abs_string::<platform::Auto>(
                        top_level_dir,
                        &[
                            &config.dir.list,
                            &config.outdir.list,
                            &output_file.dest_path,
                        ],
                    ))
                }
            } else {
                output_file.dest_path.clone()
            };
            let result = output_file.to_js(Some(&path), global_this);
            if to_assign_on_sourcemap != JSValue::ZERO {
                crate::generated_classes::js_BuildArtifact::sourcemap_set_cached(
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
        match outcome.log.to_js_array(global_this) {
            Ok(v) => build_output.put(global_this, b"logs", v),
            Err(e) => return promise.reject(global_this, Err(e)),
        };

        // metafile: { json: <lazy parsed>, markdown?: string }
        if let Some(metafile) = &build.metafile {
            let metafile_js_str = match bun_string_jsc::create_utf8_for_js(global_this, metafile) {
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
            Bun__setupLazyMetafile(global_this, build_output, metafile_js_str, metafile_md_str);
        }

        let did_handle_callbacks = if let Some(plugin) = self.plugins_ref() {
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
        Ok(())
    }
}

// ─── C++ FFI ─────────────────────────────────────────────────────────────────
// `jsc.conv` — sysv64 on Windows-x64, C elsewhere. `Bun__setupLazyMetafile` is
// a hand-written C++ symbol from `BundlerMetafile.cpp` (not codegen-emitted),
// so a local extern block is the correct binding.
//
// NOTE: `BuildArtifactPrototype__sourcemapSetCachedValue` is *not* redeclared
// here — codegen already provides it (and a safe `sourcemap_set_cached`
// wrapper) in `crate::generated_classes::js_BuildArtifact`; redeclaring would
// trip `clashing_extern_declarations` once the param types drift.
bun_jsc::jsc_abi_extern! {
    safe fn Bun__setupLazyMetafile(
        global_this: &JSGlobalObject,
        build_output: JSValue,
        metafile_json_string: JSValue,
        metafile_markdown_string: JSValue,
    );
}

// ─── What the running BundleV2 sees ──────────────────────────────────────────

impl CompletionDispatch for BuildShared {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    fn enqueue_task_concurrent(
        &self,
        task: NonNull<bun_event_loop::ConcurrentTask::ConcurrentTask>,
    ) {
        self.ticket
            .lock()
            .as_ref()
            .expect("a running Bun.build holds a ticket")
            .post(task);
    }
}

// ─── What the bundle thread runs ─────────────────────────────────────────────

impl BundleJob {
    fn outcome(&mut self) -> &mut BuildOutcome {
        self.outcome
            .as_deref_mut()
            .expect("the outcome leaves with complete_on_bundle_thread")
    }
}

impl CompletionStruct for BundleJob {
    fn try_start(&mut self) -> bool {
        self.shared
            .stage
            .compare_exchange(
                Stage::Queued as u8,
                Stage::Started as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }

    /// Port of `JSBundleCompletionTask.configureBundler` — the post-init half
    /// (everything after `transpiler.* = try Transpiler.init(...)`).
    /// `Transpiler::init` itself is called by `create_and_configure_transpiler`
    /// (Rust cannot zero-init `Transpiler<'a>` and write it in place).
    fn configure_bundler<'a>(
        &mut self,
        transpiler: &mut Transpiler<'a>,
        _bump: &'a Arena,
    ) -> bun_bundler::Result<()> {
        let config = &mut self.outcome().config;

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
        transpiler.options.compile_mode = if config.compile.is_some() {
            options::CompileMode::Executable
        } else {
            options::CompileMode::None
        };

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
        transpiler.options.tree_shaking_override = config.tree_shaking;
        transpiler.options.css_chunking = config.css_chunking;
        transpiler.options.min_chunk_size = config.min_chunk_size;
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
            transpiler.options.optimize_imports =
                Some(Arc::new(core::mem::take(&mut config.optimize_imports)));
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
        Ok(())
    }

    /// The bundle thread's last touch of this VM's memory: hand the outcome
    /// over, post the completion hop through the ticket, drop the ticket.
    fn complete_on_bundle_thread(&mut self) {
        let outcome = self.outcome.take();
        let shared = &self.shared;
        *shared.outcome.lock() = outcome;
        let ticket = shared
            .ticket
            .lock()
            .take()
            .expect("a running Bun.build holds a ticket");
        let js = shared.js.load(Ordering::Acquire);
        ticket.post(jsc::ConcurrentTask::create(bun_event_loop::Task::new(
            CompletionHop::TAG,
            js.cast(),
        )));
    }
    fn set_result(&mut self, result: BundleV2Result) {
        self.outcome().result = result;
    }
    fn set_log(&mut self, log: bun_ast::Log) {
        self.outcome().log = log;
    }

    fn create_and_configure_transpiler<'a>(
        &mut self,
        bump: &'a Arena,
    ) -> bun_bundler::Result<&'a mut Transpiler<'a>> {
        let outcome = self.outcome();
        let config = &outcome.config;
        let opts = api::TransformOptions {
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
            // Also read by `Macro::init`, which creates the macro VM from these.
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
            ..Default::default()
        };

        let env = self.env.load(Ordering::Relaxed);
        let t = Transpiler::init(bump, &raw mut self.outcome().log, opts, Some(env))?;
        let transpiler: &'a mut Transpiler<'a> = bump.alloc(t);
        self.configure_bundler(transpiler, bump)?;
        Ok(transpiler)
    }

    fn init_and_run<'a>(
        &mut self,
        transpiler: &'a mut Transpiler<'a>,
        bump: &'a Arena,
        thread_pool: *mut bun_threading::ThreadPool,
    ) -> bun_bundler::Result<()> {
        // `jsc.AnyEventLoop.init(allocator)` — Mini loop. Stack-owned (not
        // bump-allocated) so its `MiniEventLoop::tasks` queue is dropped at
        // scope exit; the bump bulk-free skips Drop. Declared before `bv2` so
        // it outlives the BACKREF in `linker.loop`.
        let mut any_loop = bun_event_loop::AnyEventLoop::default();
        let event_loop: bun_bundler::linker_context_mod::EventLoop =
            Some(NonNull::from(&mut any_loop).cast::<bun_event_loop::AnyEventLoop>());

        // `thread_pool` is the `WorkPool` singleton (`OnceLock`-backed,
        // process-lifetime, concurrently read by worker threads). Do NOT
        // materialize `&mut` from it — its provenance is `&'static`, so even a
        // never-written-through `&mut` is UB under Stacked Borrows. Keep it raw
        // (`NonNull`) end-to-end; `ThreadPool::init` stores it as `*mut`.
        let worker_pool = NonNull::new(thread_pool);

        // `Graph.heap` is a borrow, so reuse the caller-owned `bump`.
        let mut bv2 = BundleV2::init(transpiler, None, bump, event_loop, false, worker_pool, bump)?;

        bv2.plugins = NonNull::new(self.plugins.load(Ordering::Relaxed));
        bv2.completion = Some(Arc::clone(&self.shared) as Arc<dyn CompletionDispatch>);
        let config = &mut self.outcome().config;
        if !config.files.map.is_empty() {
            bv2.file_map = Some(Arc::new(core::mem::take(&mut config.files)));
        }

        // Snapshot entry points as `&[&[u8]]`.
        let entry_points: Vec<&[u8]> = config.entry_points.keys().iter().map(|b| &**b).collect();

        let run = bv2.run_from_js_in_new_thread(&entry_points);

        // The AST-allocator pop lives in `generate_in_new_thread`; the
        // source-map wait-group waits run only on the error path.
        match run {
            Ok(build) => {
                self.set_result(BundleV2Result::Value(build));
                bv2.deinit_without_freeing_arena();
                Ok(())
            }
            Err(err) => {
                bv2.linker.source_maps.line_offset_wait_group.wait();
                bv2.linker.source_maps.quoted_contents_wait_group.wait();
                bv2.deinit_without_freeing_arena();
                Err(err)
            }
        }
    }
}
