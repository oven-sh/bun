//! `JSBundleCompletionTask` and the JS-facing entrypoints for `Bun.build()`.
//! Moved from inside `BundleV2` so `bundler/` is free of JSC types. Aliased
//! back as `BundleV2.JSBundleCompletionTask` etc.

use core::ptr;
use core::sync::atomic::AtomicU32;
use std::io::Write as _;

use bun_aio::KeepAlive;
use bun_alloc::AllocError;
use bun_bundler::bundle_v2::{self as bv2, BundleThread, BundleV2};
use bun_bundler::options::{self, OutputFile};
use bun_core::Environment;
use bun_jsc::{
    self as jsc, AnyTask, CallFrame, ConcurrentTask, EventLoop, JSGlobalObject, JSPromise, JSValue,
    JsResult, ZigString,
};
use bun_logger as logger;
use bun_paths::{self, PathBuffer, SEP};
use bun_ptr::IntrusiveArc;
use bun_str::{self as strings, String as BunString};
use bun_sys::Fd;
use bun_threading::WorkPool;
// TODO(port): verify crate paths for these cross-area types in Phase B
use bun_dot_env::Loader as DotEnvLoader;
use bun_fs::FileSystem;
use bun_runtime::api::html_bundle::HTMLBundleRoute;
use bun_runtime::api::js_bundler::{Config as JSBundlerConfig, Plugin};
use bun_runtime::api::BuildArtifact;
use bun_runtime::node::fs::NodeFS;
use bun_schema::api;
use bun_standalone::StandaloneModuleGraph;
use bun_transpiler::Transpiler;

pub use bv2::BundleV2::BuildResult;
pub use bv2::BundleV2::Result;

pub type JSBundleThread = BundleThread<JSBundleCompletionTask>;

pub fn create_and_schedule_completion_task<'a>(
    config: JSBundlerConfig,
    plugins: Option<Box<Plugin>>,
    global_this: &'a JSGlobalObject,
    event_loop: &'a EventLoop,
    // PORT NOTE: Zig had `_: std.mem.Allocator` (unused) — dropped per §Allocators.
) -> core::result::Result<IntrusiveArc<JSBundleCompletionTask<'a>>, AllocError> {
    let mut completion = IntrusiveArc::new(JSBundleCompletionTask {
        ref_count: AtomicU32::new(1),
        config,
        jsc_event_loop: event_loop,
        task: AnyTask::default(), // assigned just below (Zig: `= undefined`)
        global_this,
        promise: JSPromise::Strong::default(),
        poll_ref: KeepAlive::init(),
        env: global_this.bun_vm().transpiler.env,
        log: logger::Log::init(),
        cancelled: false,
        html_build_task: None,
        result: Result::Pending,
        next: ptr::null_mut(),
        transpiler: ptr::null_mut(), // Zig: `= undefined`
        plugins,
        started_at_ns: 0,
    });
    completion.task = JSBundleCompletionTask::TaskCompletion::init(&*completion);

    if let Some(plugin) = completion.plugins.as_deref_mut() {
        plugin.set_config(&*completion);
    }

    // Ensure this exists before we spawn the thread to prevent any race
    // conditions from creating two
    let _ = WorkPool::get();

    JSBundleThread::singleton().enqueue(&*completion);

    completion.poll_ref.ref_(global_this.bun_vm());

    Ok(completion)
}

pub fn generate_from_javascript<'a>(
    config: JSBundlerConfig,
    plugins: Option<Box<Plugin>>,
    global_this: &'a JSGlobalObject,
    event_loop: &'a EventLoop,
    // PORT NOTE: allocator param dropped (was forwarded but ultimately unused)
) -> core::result::Result<JSValue, AllocError> {
    let mut completion =
        create_and_schedule_completion_task(config, plugins, global_this, event_loop)?;
    completion.promise = JSPromise::Strong::init(global_this);
    Ok(completion.promise.value())
}

pub struct JSBundleCompletionTask<'a> {
    pub ref_count: AtomicU32, // intrusive count for IntrusiveArc<Self>
    pub config: JSBundlerConfig,
    pub jsc_event_loop: &'a EventLoop,
    pub task: AnyTask,
    pub global_this: &'a JSGlobalObject,
    pub promise: jsc::PromiseStrong, // jsc.JSPromise.Strong
    pub poll_ref: KeepAlive,
    pub env: &'static DotEnvLoader,
    pub log: logger::Log,
    pub cancelled: bool,

    pub html_build_task: Option<*mut HTMLBundleRoute>,

    pub result: Result,

    pub next: *mut JSBundleCompletionTask<'a>, // intrusive queue link (UnboundedQueue)
    pub transpiler: *mut BundleV2,             // arena-owned by BundleThread heap
    pub plugins: Option<Box<Plugin>>,
    pub started_at_ns: u64,
}

impl<'a> JSBundleCompletionTask<'a> {
    // Zig: `pub const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", @This().deinit, .{});`
    // → IntrusiveArc<Self>; ref/deref are methods on IntrusiveArc.
    // TODO(port): wire IntrusiveArc trait impl pointing at `ref_count` field + `deinit` as destructor.
    pub fn ref_(this: &IntrusiveArc<Self>) -> IntrusiveArc<Self> {
        this.clone()
    }
    pub fn deref(this: IntrusiveArc<Self>) {
        drop(this);
    }

    pub fn configure_bundler(
        completion: &mut Self,
        transpiler: &mut Transpiler,
        // PORT NOTE: `bundler_jsc` is non-AST so `&dyn Allocator` is disallowed; this param is
        // only threaded into AST-crate (`bun_bundler`/`bun_transpiler`) calls which take `&Bump`.
        bump: &bun_alloc::Arena,
    ) -> core::result::Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let config = &mut completion.config;

        // JSX config is already in API format
        let jsx_api = config.jsx.clone();

        *transpiler = Transpiler::init(
            bump,
            &mut completion.log,
            api::TransformOptions {
                define: if config.define.count() > 0 {
                    Some(config.define.to_api())
                } else {
                    None
                },
                entry_points: config.entry_points.keys(),
                target: config.target.to_api(),
                absolute_working_dir: if !config.dir.list.is_empty() {
                    Some(config.dir.slice_with_sentinel())
                } else {
                    None
                },
                inject: &[],
                external: config.external.keys(),
                main_fields: &[],
                extension_order: &[],
                env_files: &[],
                conditions: config.conditions.map.keys(),
                ignore_dce_annotations: transpiler.options.ignore_dce_annotations,
                drop: config.drop.map.keys(),
                bunfig_path: transpiler.options.bunfig_path,
                jsx: jsx_api,
            },
            completion.env,
        )?;
        transpiler.options.env.behavior = config.env_behavior;
        transpiler.options.env.prefix = config.env_prefix.slice();
        // Use the StringSet directly instead of the slice passed through TransformOptions
        transpiler.options.bundler_feature_flags = &config.features;
        if config.force_node_env != options::ForceNodeEnv::Unspecified {
            transpiler.options.force_node_env = config.force_node_env;
        }

        transpiler.options.entry_points = config.entry_points.keys();
        // Convert API JSX config back to options.JSX.Pragma
        transpiler.options.jsx = options::jsx::Pragma {
            factory: if !config.jsx.factory.is_empty() {
                options::jsx::Pragma::member_list_to_components_if_different(
                    bump,
                    &[],
                    config.jsx.factory,
                )?
            } else {
                options::jsx::pragma::Defaults::FACTORY
            },
            fragment: if !config.jsx.fragment.is_empty() {
                options::jsx::Pragma::member_list_to_components_if_different(
                    bump,
                    &[],
                    config.jsx.fragment,
                )?
            } else {
                options::jsx::pragma::Defaults::FRAGMENT
            },
            runtime: config.jsx.runtime,
            development: config.jsx.development,
            package_name: if !config.jsx.import_source.is_empty() {
                config.jsx.import_source
            } else {
                b"react"
            },
            classic_import_source: if !config.jsx.import_source.is_empty() {
                config.jsx.import_source
            } else {
                b"react"
            },
            side_effects: config.jsx.side_effects,
            parse: true,
            import_source: options::jsx::ImportSource {
                development: if !config.jsx.import_source.is_empty() {
                    let mut v = Vec::new();
                    write!(&mut v, "{}/jsx-dev-runtime", bstr::BStr::new(config.jsx.import_source))
                        .unwrap();
                    // TODO(port): allocator — Zig used arena `alloc`; here Vec uses global mimalloc
                    v.into_boxed_slice()
                } else {
                    Box::from(&b"react/jsx-dev-runtime"[..])
                },
                production: if !config.jsx.import_source.is_empty() {
                    let mut v = Vec::new();
                    write!(&mut v, "{}/jsx-runtime", bstr::BStr::new(config.jsx.import_source))
                        .unwrap();
                    v.into_boxed_slice()
                } else {
                    Box::from(&b"react/jsx-runtime"[..])
                },
            },
        };
        transpiler.options.no_macros = config.no_macros;
        transpiler.options.loaders =
            options::loaders_from_transform_options(bump, config.loaders, config.target)?;
        transpiler.options.entry_naming = config.names.entry_point.data;
        transpiler.options.chunk_naming = config.names.chunk.data;
        transpiler.options.asset_naming = config.names.asset.data;

        transpiler.options.output_format = config.format;
        transpiler.options.bytecode = config.bytecode;
        transpiler.options.compile = config.compile.is_some();

        // For compile mode, set the public_path to the target-specific base path
        // This ensures embedded resources like yoga.wasm are correctly found
        if let Some(compile_opts) = &config.compile {
            let base_public_path = StandaloneModuleGraph::target_base_public_path(
                compile_opts.compile_target.os,
                b"root/",
            );
            transpiler.options.public_path = base_public_path;
        } else {
            transpiler.options.public_path = config.public_path.list.as_slice();
        }

        transpiler.options.output_dir = config.outdir.slice();
        transpiler.options.root_dir = config.rootdir.slice();
        transpiler.options.minify_syntax = config.minify.syntax;
        transpiler.options.minify_whitespace = config.minify.whitespace;
        transpiler.options.minify_identifiers = config.minify.identifiers;
        transpiler.options.keep_names = config.minify.keep_names;
        transpiler.options.inlining = config.minify.syntax;
        transpiler.options.source_map = config.source_map;
        transpiler.options.packages = config.packages;
        transpiler.options.allow_unresolved = if let Some(a) = &config.allow_unresolved {
            options::AllowUnresolved::from_strings(a.keys())
        } else {
            options::AllowUnresolved::All
        };
        transpiler.options.code_splitting = config.code_splitting;
        transpiler.options.emit_dce_annotations =
            config.emit_dce_annotations.unwrap_or(!config.minify.whitespace);
        transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
        transpiler.options.css_chunking = config.css_chunking;
        transpiler.options.compile_to_standalone_html = 'brk: {
            if config.compile.is_none() || config.target != options::Target::Browser {
                break 'brk false;
            }
            // Only activate standalone HTML when all entrypoints are HTML files
            for ep in config.entry_points.keys() {
                if !strings::strings::has_suffix(ep, b".html") {
                    break 'brk false;
                }
            }
            break 'brk config.entry_points.count() > 0;
        };
        // When compiling to standalone HTML, don't use the bun executable compile path
        if transpiler.options.compile_to_standalone_html {
            transpiler.options.compile = false;
            config.compile = None;
        }
        transpiler.options.banner = config.banner.slice();
        transpiler.options.footer = config.footer.slice();
        transpiler.options.react_fast_refresh = config.react_fast_refresh;
        transpiler.options.metafile = config.metafile;
        transpiler.options.metafile_json_path = config.metafile_json_path.slice();
        transpiler.options.metafile_markdown_path = config.metafile_markdown_path.slice();
        if config.optimize_imports.count() > 0 {
            transpiler.options.optimize_imports = Some(&config.optimize_imports);
        }

        if transpiler.options.compile {
            // Emitting DCE annotations is nonsensical in --compile.
            transpiler.options.emit_dce_annotations = false;
        }

        transpiler.configure_linker();
        transpiler.configure_defines()?;

        if !transpiler.options.production {
            transpiler.options.conditions.append_slice(&[b"development"])?;
        }
        transpiler.resolver.env_loader = transpiler.env;
        transpiler.resolver.opts = transpiler.options;
        Ok(())
    }

    pub fn complete_on_bundle_thread(completion: &mut Self) {
        completion
            .jsc_event_loop
            .enqueue_task_concurrent(ConcurrentTask::create(completion.task.task()));
    }

    // Zig: `pub const TaskCompletion = bun.jsc.AnyTask.New(JSBundleCompletionTask, onComplete);`
    // TODO(port): AnyTask::New is a comptime type-generator binding `on_complete` as the callback.
    pub type TaskCompletion = jsc::AnyTaskFor<Self>;

    fn deinit(this: &mut Self) {
        // PORT NOTE: called by IntrusiveArc when ref_count hits 0; equivalent to Drop body.
        // `result`, `log`, `config`, `promise` are owned fields — their Drop impls handle cleanup.
        // Explicit side-effects retained:
        this.poll_ref.disable();
        // `plugins: Option<Box<Plugin>>` drops automatically.
        // Zig: `bun.destroy(this)` — handled by IntrusiveArc deallocation.
    }

    fn do_compilation(
        this: &mut Self,
        output_files: &mut Vec<OutputFile>,
    ) -> StandaloneModuleGraph::CompileResult {
        let compile_options = this
            .config
            .compile
            .as_mut()
            .unwrap_or_else(|| panic!("Unexpected: No compile options provided"));

        let entry_point_index: usize = 'brk: {
            for (i, output_file) in output_files.iter().enumerate() {
                if output_file.output_kind == options::OutputKind::EntryPoint
                    && output_file.side.unwrap_or(options::Side::Server) == options::Side::Server
                {
                    break 'brk i;
                }
            }
            return StandaloneModuleGraph::CompileResult::fail(
                StandaloneModuleGraph::CompileError::NoEntryPoint,
            );
        };

        let output_file = &mut output_files[entry_point_index];
        let outbuf = bun_paths::path_buffer_pool().get();
        // PORT NOTE: `defer bun.path_buffer_pool.put(outbuf)` — guard's Drop puts back.

        // Always get an absolute path for the outfile to ensure it works correctly with PE metadata operations
        let mut full_outfile_path: Box<[u8]> = if !this.config.outdir.slice().is_empty() {
            let outdir_slice = this.config.outdir.slice();
            let top_level_dir = FileSystem::instance().top_level_dir;
            let joined = bun_paths::join_abs_string_buf(
                top_level_dir,
                &mut *outbuf,
                &[outdir_slice, compile_options.outfile.slice()],
                bun_paths::Style::Auto,
            );
            // owned below
            Box::from(joined)
        } else if bun_paths::is_absolute(compile_options.outfile.slice()) {
            Box::from(compile_options.outfile.slice())
        } else {
            // For relative paths, ensure we make them absolute relative to the current working directory
            let top_level_dir = FileSystem::instance().top_level_dir;
            let joined = bun_paths::join_abs_string_buf(
                top_level_dir,
                &mut *outbuf,
                &[compile_options.outfile.slice()],
                bun_paths::Style::Auto,
            );
            Box::from(joined)
        };
        // PORT NOTE: reshaped — Zig kept `full_outfile_path` as a borrowed slice into `outbuf`
        // until the .exe/dupe step below; we Box early to avoid the conditional borrow.

        // Add .exe extension for Windows targets if not already present
        if compile_options.compile_target.os == bun_core::Os::Windows
            && !strings::strings::has_suffix(&full_outfile_path, b".exe")
        {
            let mut v = Vec::with_capacity(full_outfile_path.len() + 4);
            write!(&mut v, "{}.exe", bstr::BStr::new(&full_outfile_path)).unwrap();
            full_outfile_path = v.into_boxed_slice();
        }
        // else: already owned (Zig: `bun.default_allocator.dupe(u8, ...)`)

        let dirname: &[u8] = bun_paths::dirname(&full_outfile_path).unwrap_or(b".");
        let basename: &[u8] = bun_paths::basename(&full_outfile_path);

        // Zig: `defer { if (FD.fromStdDir(root_dir) != FD.cwd()) root_dir.close(); }`
        // The guard owns the dir so the close fires on every early return below.
        let mut root_dir = scopeguard::guard(Fd::cwd().std_dir(), |d| {
            if Fd::from_std_dir(&d) != Fd::cwd() {
                d.close();
            }
        });

        // On Windows, don't change root_dir, just pass the full relative path
        // On POSIX, change root_dir to the target directory and pass basename
        let outfile_for_executable: &[u8] = if cfg!(windows) {
            &full_outfile_path
        } else {
            basename
        };

        #[cfg(unix)]
        if !(dirname.is_empty() || dirname == b".") {
            // On POSIX, makeOpenPath and change root_dir
            *root_dir = match root_dir.make_open_path(dirname, Default::default()) {
                Ok(d) => d,
                Err(err) => {
                    return StandaloneModuleGraph::CompileResult::fail_fmt(format_args!(
                        "Failed to open output directory {}: {}",
                        bstr::BStr::new(dirname),
                        err.name()
                    ));
                }
            };
        }
        #[cfg(windows)]
        if !(dirname.is_empty() || dirname == b".") {
            // On Windows, ensure directories exist but don't change root_dir
            if let Err(err) = bun_sys::make_path(&*root_dir, dirname) {
                return StandaloneModuleGraph::CompileResult::fail_fmt(format_args!(
                    "Failed to create output directory {}: {}",
                    bstr::BStr::new(dirname),
                    err.name()
                ));
            }
        }

        // Use the target-specific base path for compile mode, not the user-configured public_path
        let module_prefix = StandaloneModuleGraph::target_base_public_path(
            compile_options.compile_target.os,
            b"root/",
        );

        let result = match StandaloneModuleGraph::to_executable(
            &compile_options.compile_target,
            output_files.as_slice(),
            &*root_dir,
            module_prefix,
            outfile_for_executable,
            this.env,
            this.config.format,
            StandaloneModuleGraph::WindowsOptions {
                hide_console: compile_options.windows_hide_console,
                icon: if !compile_options.windows_icon_path.slice().is_empty() {
                    Some(compile_options.windows_icon_path.slice())
                } else {
                    None
                },
                title: if !compile_options.windows_title.slice().is_empty() {
                    Some(compile_options.windows_title.slice())
                } else {
                    None
                },
                publisher: if !compile_options.windows_publisher.slice().is_empty() {
                    Some(compile_options.windows_publisher.slice())
                } else {
                    None
                },
                version: if !compile_options.windows_version.slice().is_empty() {
                    Some(compile_options.windows_version.slice())
                } else {
                    None
                },
                description: if !compile_options.windows_description.slice().is_empty() {
                    Some(compile_options.windows_description.slice())
                } else {
                    None
                },
                copyright: if !compile_options.windows_copyright.slice().is_empty() {
                    Some(compile_options.windows_copyright.slice())
                } else {
                    None
                },
            },
            compile_options.exec_argv.slice(),
            if !compile_options.executable_path.slice().is_empty() {
                Some(compile_options.executable_path.slice())
            } else {
                None
            },
            StandaloneModuleGraph::AutoloadOptions {
                disable_default_env_files: !compile_options.autoload_dotenv,
                disable_autoload_bunfig: !compile_options.autoload_bunfig,
                disable_autoload_tsconfig: !compile_options.autoload_tsconfig,
                disable_autoload_package_json: !compile_options.autoload_package_json,
            },
        ) {
            Ok(r) => r,
            Err(err) => {
                return StandaloneModuleGraph::CompileResult::fail_fmt(format_args!(
                    "{}",
                    err.name()
                ));
            }
        };

        if matches!(result, StandaloneModuleGraph::CompileResult::Success { .. }) {
            output_file.dest_path = full_outfile_path.clone();
            output_file.is_executable = true;
        }

        // Write external sourcemap files next to the compiled executable and
        // keep them in the output array. Destroy all other non-entry-point files.
        // With --splitting, there can be multiple sourcemap files (one per chunk).
        // TODO(port): in-place compaction — Zig copies structs by value then truncates `.len`.
        // In Rust, OutputFile owns its data so naive index-copy aliases ownership. Phase B should
        // rewrite as `retain_mut` or drain-filter; here we mirror the structure with swap/take.
        let mut kept: usize = 0;
        let len = output_files.len();
        for i in 0..len {
            // PORT NOTE: reshaped for borrowck — index instead of iterator since we mutate the Vec.
            if i == entry_point_index {
                output_files.swap(kept, i);
                kept += 1;
            } else if matches!(result, StandaloneModuleGraph::CompileResult::Success { .. })
                && output_files[i].output_kind == options::OutputKind::Sourcemap
                && matches!(output_files[i].value, options::OutputFileValue::Buffer { .. })
            {
                let sourcemap_bytes = output_files[i].value.buffer().bytes;
                if !sourcemap_bytes.is_empty() {
                    // Derive the .map filename from the sourcemap's own dest_path,
                    // placed in the same directory as the compiled executable.
                    let map_basename: Box<[u8]> = if !output_files[i].dest_path.is_empty() {
                        Box::from(bun_paths::basename(&output_files[i].dest_path))
                    } else {
                        let mut v = Vec::new();
                        write!(&mut v, "{}.map", bstr::BStr::new(&full_outfile_path)).unwrap();
                        Box::from(bun_paths::basename(&v))
                    };

                    let sourcemap_full_path: Box<[u8]> =
                        if dirname.is_empty() || dirname == b"." {
                            map_basename.clone()
                        } else {
                            let mut v = Vec::new();
                            write!(
                                &mut v,
                                "{}{}{}",
                                bstr::BStr::new(dirname),
                                SEP as char,
                                bstr::BStr::new(&map_basename)
                            )
                            .unwrap();
                            v.into_boxed_slice()
                        };

                    // Write the sourcemap file to disk next to the executable
                    let mut pathbuf = PathBuffer::uninit();
                    let write_path: &[u8] = if cfg!(windows) {
                        &sourcemap_full_path
                    } else {
                        &map_basename
                    };
                    match NodeFS::write_file_with_path_buffer(
                        &mut pathbuf,
                        // TODO(port): construct node fs WriteFileArgs struct; field shapes guessed
                        bun_runtime::node::fs::WriteFileArgs {
                            data: bun_runtime::node::fs::WriteFileData::Buffer {
                                buffer: bun_runtime::node::ArrayBuffer {
                                    ptr: sourcemap_bytes.as_ptr() as *mut u8,
                                    len: sourcemap_bytes.len() as u32,
                                    byte_len: sourcemap_bytes.len() as u32,
                                },
                            },
                            encoding: bun_runtime::node::Encoding::Buffer,
                            dirfd: Fd::from_std_dir(&*root_dir),
                            file: bun_runtime::node::fs::PathOrFd::Path {
                                string: bun_str::PathString::init(write_path),
                            },
                        },
                    ) {
                        bun_sys::Result::Err(err) => {
                            bun_core::Output::err(
                                err,
                                format_args!(
                                    "failed to write sourcemap file '{}'",
                                    bstr::BStr::new(write_path)
                                ),
                            );
                            // current.deinit() — Drop on truncate below handles it
                        }
                        bun_sys::Result::Ok(_) => {
                            output_files[i].dest_path = sourcemap_full_path;
                            output_files.swap(kept, i);
                            kept += 1;
                        }
                    }
                } else {
                    // current.deinit() — Drop on truncate below handles it
                }
            } else {
                // current.deinit() — Drop on truncate below handles it
            }
        }
        output_files.truncate(kept);
        // TODO(port): verify Drop ordering matches Zig's per-iteration `current.deinit()` semantics.

        result
    }

    /// Returns true if the promises were handled and resolved from BundlePlugin.ts, returns false if the caller should imediately resolve
    fn run_on_end_callbacks(
        global_this: &JSGlobalObject,
        plugin: &mut Plugin,
        promise: &JSPromise,
        build_result: JSValue,
        rejection: JsResult<JSValue>,
    ) -> JsResult<bool> {
        let value = plugin.run_on_end_callbacks(global_this, promise, build_result, rejection)?;
        Ok(value != JSValue::UNDEFINED)
    }

    fn to_js_error(
        this: &mut Self,
        promise: &JSPromise,
        global_this: &JSGlobalObject,
    ) -> core::result::Result<(), jsc::JsTerminated> {
        // TODO(port): bun.JSTerminated!void — confirm error type in Phase B
        let throw_on_error = this.config.throw_on_error;

        let build_result = JSValue::create_empty_object(global_this, 3);
        let outputs = match JSValue::create_empty_array(global_this, 0) {
            Ok(v) => v,
            Err(_) => return Ok(promise.reject(global_this, jsc::JsError::Thrown)),
        };
        build_result.put(global_this, ZigString::static_(b"outputs"), outputs);
        build_result.put(global_this, ZigString::static_(b"success"), JSValue::FALSE);
        let logs = match this.log.to_js_array(global_this) {
            Ok(v) => v,
            Err(err) => return Ok(promise.reject(global_this, err)),
        };
        build_result.put(global_this, ZigString::static_(b"logs"), logs);

        let did_handle_callbacks = if let Some(plugin) = this.plugins.as_deref_mut() {
            if throw_on_error {
                let aggregate_error = this
                    .log
                    .to_js_aggregate_error(global_this, BunString::static_(b"Bundle failed"));
                match Self::run_on_end_callbacks(
                    global_this,
                    plugin,
                    promise,
                    build_result,
                    Ok(aggregate_error),
                ) {
                    Ok(b) => b,
                    Err(err) => return Ok(promise.reject(global_this, err)),
                }
            } else {
                match Self::run_on_end_callbacks(
                    global_this,
                    plugin,
                    promise,
                    build_result,
                    Ok(JSValue::UNDEFINED),
                ) {
                    Ok(b) => b,
                    Err(err) => return Ok(promise.reject(global_this, err)),
                }
            }
        } else {
            false
        };

        if !did_handle_callbacks {
            if throw_on_error {
                let aggregate_error = this
                    .log
                    .to_js_aggregate_error(global_this, BunString::static_(b"Bundle failed"));
                return Ok(promise.reject(global_this, aggregate_error));
            } else {
                return Ok(promise.resolve(global_this, build_result));
            }
        }
        Ok(())
    }

    pub fn on_complete(this: &mut Self) -> core::result::Result<(), jsc::JsTerminated> {
        let global_this = this.global_this;
        // Zig: `defer this.deref();` — decrement intrusive refcount on scope exit.
        let _deref_guard = scopeguard::guard((), |_| {
            // TODO(port): IntrusiveArc::deref(this) — needs the Arc handle, not &mut Self.
            // The AnyTask callback owns one ref; dropping it here matches Zig.
        });

        this.poll_ref.unref(global_this.bun_vm());
        if this.cancelled {
            return Ok(());
        }

        if let Some(html_build_task) = this.html_build_task {
            this.plugins = None;
            // SAFETY: html_build_task is a backref set by HTMLBundleRoute which outlives this call
            unsafe { (*html_build_task).on_complete(this) };
            return Ok(());
        }

        let promise = this.promise.swap();

        if let Result::Value(value) = &mut this.result {
            if this.config.compile.is_some() {
                let compile_result = this.do_compilation(&mut value.output_files);
                // PORT NOTE: reshaped for borrowck — `this` is reborrowed inside do_compilation;
                // Phase B may need to restructure to avoid overlapping &mut.
                // `defer compile_result.deinit()` — Drop handles it.

                if !matches!(compile_result, StandaloneModuleGraph::CompileResult::Success { .. }) {
                    let msg = Box::<[u8]>::from(compile_result.err().slice());
                    this.log
                        .add_error(None, logger::Loc::EMPTY, msg)
                        .expect("OOM");
                    // value.deinit() — handled by reassignment Drop below
                    this.result = Result::Err(bun_core::err!("CompilationFailed"));
                }
            }
        }

        match &mut this.result {
            Result::Pending => unreachable!(),
            Result::Err(_) => this.to_js_error(&promise, global_this)?,
            Result::Value(build) => {
                let output_files = &mut build.output_files;
                let output_files_js =
                    match JSValue::create_empty_array(global_this, output_files.len()) {
                        Ok(v) => v,
                        Err(_) => return Ok(promise.reject(global_this, jsc::JsError::Thrown)),
                    };
                if output_files_js.is_empty() {
                    panic!("Unexpected pending JavaScript exception in JSBundleCompletionTask.onComplete. This is a bug in Bun.");
                }

                let mut to_assign_on_sourcemap: JSValue = JSValue::ZERO;
                // Zig: `for (output_files, 0..) |*output_file, i|` — `to_js` may consume the buffer.
                for (i, output_file) in output_files.iter_mut().enumerate() {
                    let path: Box<[u8]> = if !this.config.outdir.is_empty() {
                        if bun_paths::is_absolute(this.config.outdir.list.as_slice()) {
                            Box::from(bun_paths::join_abs_string(
                                this.config.outdir.slice(),
                                &[&output_file.dest_path],
                                bun_paths::Style::Auto,
                            ))
                        } else {
                            Box::from(bun_paths::join_abs_string(
                                FileSystem::instance().top_level_dir,
                                &[
                                    this.config.dir.slice(),
                                    this.config.outdir.slice(),
                                    &output_file.dest_path,
                                ],
                                bun_paths::Style::Auto,
                            ))
                        }
                    } else {
                        Box::from(&output_file.dest_path[..])
                    };
                    // Zig: `catch unreachable` on the dupe — Box::from is infallible.
                    let result = output_file.to_js(path, global_this);
                    if !to_assign_on_sourcemap.is_empty() {
                        jsc::codegen::JSBuildArtifact::sourcemap_set_cached(
                            to_assign_on_sourcemap,
                            global_this,
                            result,
                        );
                        if let Some(artifact) =
                            to_assign_on_sourcemap.as_::<BuildArtifact>()
                        {
                            artifact.sourcemap.set(global_this, result);
                        }
                        to_assign_on_sourcemap = JSValue::ZERO;
                    }

                    if output_file.source_map_index != u32::MAX {
                        to_assign_on_sourcemap = result;
                    }

                    if let Err(err) = output_files_js.put_index(
                        global_this,
                        u32::try_from(i).unwrap(),
                        result,
                    ) {
                        return Ok(promise.reject(global_this, err));
                    }
                }
                let build_output = JSValue::create_empty_object(global_this, 4);
                build_output.put(global_this, ZigString::static_(b"outputs"), output_files_js);
                build_output.put(global_this, ZigString::static_(b"success"), JSValue::TRUE);
                let logs = match this.log.to_js_array(global_this) {
                    Ok(v) => v,
                    Err(err) => return Ok(promise.reject(global_this, err)),
                };
                build_output.put(global_this, ZigString::static_(b"logs"), logs);

                // Add metafile if it was generated
                // metafile: { json: <lazy parsed>, markdown?: string }
                if let Some(metafile) = &build.metafile {
                    let metafile_js_str = match BunString::create_utf8_for_js(global_this, metafile)
                    {
                        Ok(v) => v,
                        Err(err) => return Ok(promise.reject(global_this, err)),
                    };
                    let metafile_md_str: JSValue = if let Some(md) = &build.metafile_markdown {
                        match BunString::create_utf8_for_js(global_this, md) {
                            Ok(v) => v,
                            Err(err) => return Ok(promise.reject(global_this, err)),
                        }
                    } else {
                        JSValue::UNDEFINED
                    };
                    // Set up metafile object with json (lazy) and markdown (if present)
                    // SAFETY: FFI call into C++; all args are valid JSValues / global ptr
                    unsafe {
                        Bun__setupLazyMetafile(
                            global_this,
                            build_output,
                            metafile_js_str,
                            metafile_md_str,
                        );
                    }
                }

                let did_handle_callbacks = if let Some(plugin) = this.plugins.as_deref_mut() {
                    match Self::run_on_end_callbacks(
                        global_this,
                        plugin,
                        &promise,
                        build_output,
                        Ok(JSValue::UNDEFINED),
                    ) {
                        Ok(b) => b,
                        Err(err) => return Ok(promise.reject(global_this, err)),
                    }
                } else {
                    false
                };

                if !did_handle_callbacks {
                    return Ok(promise.resolve(global_this, build_output));
                }
            }
        }
        Ok(())
    }
}

impl<'a> Drop for JSBundleCompletionTask<'a> {
    fn drop(&mut self) {
        Self::deinit(self);
    }
}

// TODO(port): move to <area>_sys
// TODO(port): callconv(jsc.conv) — "sysv64" on Windows-x64, "C" elsewhere; Rust cannot
// express a macro in ABI position. Phase B: cfg-gate two extern blocks or wrap via bun_jsc.
unsafe extern "C" {
    fn Bun__setupLazyMetafile(
        global_this: *const JSGlobalObject,
        build_output: JSValue,
        metafile_json_string: JSValue,
        metafile_markdown_string: JSValue,
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/JSBundleCompletionTask.zig (621 lines)
//   confidence: medium
//   todos:      12
//   notes:      IntrusiveArc wiring + on_complete borrowck (do_compilation reborrows &mut self) need Phase-B attention; output_files compaction reshaped from struct-copy to swap+truncate.
// ──────────────────────────────────────────────────────────────────────────
