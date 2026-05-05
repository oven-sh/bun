//! Port of src/bun.js.zig — entry point for `bun run <file>` / standalone executables.

use core::mem::MaybeUninit;
use std::io::Write as _;

use bun_alloc::Arena; // MimallocArena
use bun_runtime::cli::cli::Command;
use bun_core::{Global, Output};
use bun_http::AsyncHTTP;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, VirtualMachine};
use bun_logger as logger;
use bun_runtime::api::dns::Resolver as DNSResolver;
use bun_str::strings;

// Thin re-exports (mirrors `pub const X = @import(...)` at file top).
pub use bun_jsc as jsc_mod; // TODO(port): naming — Zig exposed this as `bun.js.jsc`
pub use bun_jsc::bindgen;
pub use bun_runtime::api;
pub use bun_runtime::webcore;

pub fn apply_standalone_runtime_flags(
    b: &mut bun_bundler::Transpiler,
    graph: &bun_standalone_module_graph::StandaloneModuleGraph,
) {
    b.options.env.disable_default_env_files = graph.flags.disable_default_env_files;
    b.options.env.behavior = if graph.flags.disable_default_env_files {
        bun_bundler::options::EnvBehavior::Disable
    } else {
        bun_bundler::options::EnvBehavior::LoadAllWithoutInlining
    };

    b.resolver.opts.load_tsconfig_json = !graph.flags.disable_autoload_tsconfig;
    b.resolver.opts.load_package_json = !graph.flags.disable_autoload_package_json;
}

pub struct Run {
    pub ctx: Command::Context,
    pub vm: Box<VirtualMachine>,
    // TODO(port): lifetime — process-lifetime borrow (never freed; globalExit ends process)
    pub entry_path: &'static [u8],
    // PERF(port): was MimallocArena used as the VM allocator; non-AST crate but
    // load-bearing for VM allocations — keep as Arena, profile in Phase B
    pub arena: Arena,
    pub any_unhandled: bool,
    pub is_html_entrypoint: bool,
}

// `var run: Run = undefined;` — single global instance, written once in boot*().
static mut RUN: MaybeUninit<Run> = MaybeUninit::uninit();

impl Run {
    #[inline(always)]
    fn global() -> &'static mut Run {
        // SAFETY: RUN is initialized exactly once in boot()/boot_standalone()
        // before any access, and is only ever touched from the main JS thread.
        unsafe { RUN.assume_init_mut() }
    }

    pub fn boot_standalone(
        ctx: Command::Context,
        entry_path: &'static [u8],
        graph_ptr: &'static mut bun_standalone_module_graph::StandaloneModuleGraph,
    ) -> Result<(), bun_core::Error> {
        jsc::mark_binding(core::panic::Location::caller());
        jsc::initialize(false);
        // TODO(port): verify analytics counter API
        bun_analytics::Features::standalone_executable_inc();

        bun_js_parser::expr::Store::create();
        bun_js_parser::stmt::Store::create();
        let arena = Arena::init();

        // Load bunfig.toml unless disabled by compile flags
        // Note: config loading with execArgv is handled earlier in cli.zig via loadConfig
        if !ctx.debug.loaded_bunfig && !graph_ptr.flags.disable_autoload_bunfig {
            bun_runtime::cli::Arguments::load_config_path(
                true,
                b"bunfig.toml",
                &ctx,
                bun_runtime::cli::Command::Tag::RunCommand,
            )?;
        }

        // SAFETY: single-threaded init; first and only write to RUN.
        unsafe {
            RUN.write(Run {
                vm: VirtualMachine::init_with_module_graph(jsc::VirtualMachineInitOpts {
                    // PERF(port): was arena.allocator() — global mimalloc in Rust
                    log: ctx.log,
                    args: ctx.args,
                    graph: Some(graph_ptr),
                    is_main_thread: true,
                    smol: ctx.runtime_options.smol,
                    debugger: ctx.runtime_options.debugger,
                    dns_result_order: DNSResolver::Order::from_string_or_die(
                        ctx.runtime_options.dns_result_order,
                    ),
                    ..Default::default()
                })?,
                arena,
                ctx,
                entry_path,
                any_unhandled: false,
                is_html_entrypoint: false,
            });
        }

        let run = Run::global();
        let vm = &mut *run.vm;
        let ctx = &run.ctx;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        // TODO(port): vm.arena / vm.allocator backref — raw ptr into static RUN
        vm.arena = &mut run.arena as *mut Arena;

        let b = &mut vm.transpiler;
        b.options.install = ctx.install;
        b.resolver.opts.install = ctx.install;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Offline;
        b.resolver.opts.prefer_latest_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Latest;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
        b.resolver.env_loader = b.env;

        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        b.resolver.opts.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.resolver.opts.minify_whitespace = ctx.bundler_options.minify_whitespace;

        b.options.serve_plugins = ctx.args.serve_plugins;
        b.options.bunfig_path = ctx.args.bunfig_path;

        // b.options.minify_syntax = ctx.bundler_options.minify_syntax;

        match &ctx.debug.macros {
            Macros::Disable => {
                b.options.no_macros = true;
            }
            Macros::Map(macros) => {
                b.options.macro_remap = macros.clone();
            }
            Macros::Unspecified => {}
        }

        apply_standalone_runtime_flags(b, graph_ptr);

        if b.configure_defines().is_err() {
            fail_with_build_error(vm);
        }

        AsyncHTTP::load_env(vm.log, b.env);

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        VirtualMachine::set_is_main_thread_vm(true);

        bun_http::set_experimental_http2_client_from_cli(
            ctx.runtime_options.experimental_http2_fetch,
        );
        bun_http::set_experimental_http3_client_from_cli(
            ctx.runtime_options.experimental_http3_fetch,
        );
        Self::do_preconnect(&ctx.runtime_options.preconnect);

        let callback = jsc::opaque_wrap::<Run>(Run::start);
        vm.global.vm().hold_api_lock(run as *mut Run, callback);
        Ok(())
    }

    fn do_preconnect(preconnect: &[&[u8]]) {
        if preconnect.is_empty() {
            return;
        }
        bun_http::HTTPThread::init(&Default::default());

        for url_str in preconnect {
            let url = bun_url::URL::parse(url_str);

            if !url.is_http() && !url.is_https() {
                Output::err_generic(format_args!(
                    "preconnect URL must be HTTP or HTTPS: {}",
                    bun_core::fmt::quote(url_str)
                ));
                Global::exit(1);
            }

            if url.hostname.is_empty() {
                Output::err_generic(format_args!(
                    "preconnect URL must have a hostname: {}",
                    bun_core::fmt::quote(url_str)
                ));
                Global::exit(1);
            }

            if !url.has_valid_port() {
                Output::err_generic(format_args!(
                    "preconnect URL must have a valid port: {}",
                    bun_core::fmt::quote(url_str)
                ));
                Global::exit(1);
            }

            AsyncHTTP::preconnect(url, false);
        }
    }

    #[cold]
    fn boot_bun_shell(
        ctx: &Command::Context,
        entry_path: &[u8],
    ) -> Result<bun_runtime::shell::ExitCode, bun_core::Error> {
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()`
        // function to populate environment variables probably should split out
        // the functionality
        let mut bundle = bun_bundler::Transpiler::init(
            ctx.log,
            bun_jsc::config::configure_transform_options_for_bun_vm(ctx.args)?,
            None,
        )?;
        bundle.run_env_loader(bundle.options.env.disable_default_env_files)?;
        let mini = jsc::MiniEventLoop::init_global(bundle.env, None);
        mini.top_level_dir = ctx.args.absolute_working_dir.unwrap_or(b"");
        bun_runtime::shell::Interpreter::init_and_run_from_file(ctx, mini, entry_path)
    }

    pub fn boot(
        ctx: Command::Context,
        entry_path: &'static [u8],
        loader: Option<bun_bundler::options::Loader>,
    ) -> Result<(), bun_core::Error> {
        jsc::mark_binding(core::panic::Location::caller());

        if !ctx.debug.loaded_bunfig {
            bun_runtime::cli::Arguments::load_config_path(
                true,
                b"bunfig.toml",
                &ctx,
                bun_runtime::cli::Command::Tag::RunCommand,
            )?;
        }

        // The shell does not need to initialize JSC.
        // JSC initialization costs 1-3ms. We skip this if we know it's a shell script.
        if entry_path.ends_with(b".sh") {
            let exit_code = Self::boot_bun_shell(&ctx, entry_path)?;
            Global::exit(exit_code);
        }

        jsc::initialize(ctx.runtime_options.eval.eval_and_print);

        bun_js_parser::expr::Store::create();
        bun_js_parser::stmt::Store::create();
        let arena = Arena::init();

        // SAFETY: single-threaded init; first and only write to RUN.
        unsafe {
            RUN.write(Run {
                vm: VirtualMachine::init(jsc::VirtualMachineInitOpts {
                    log: ctx.log,
                    args: ctx.args,
                    store_fd: ctx.debug.hot_reload != HotReload::None,
                    smol: ctx.runtime_options.smol,
                    eval: ctx.runtime_options.eval.eval_and_print,
                    debugger: ctx.runtime_options.debugger,
                    dns_result_order: DNSResolver::Order::from_string_or_die(
                        ctx.runtime_options.dns_result_order,
                    ),
                    is_main_thread: true,
                    ..Default::default()
                })?,
                arena,
                ctx,
                entry_path,
                any_unhandled: false,
                is_html_entrypoint: false,
            });
        }

        let run = Run::global();
        let vm = &mut *run.vm;
        let ctx = &run.ctx;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        // TODO(port): vm.arena / vm.allocator backref — raw ptr into static RUN
        vm.arena = &mut run.arena as *mut Arena;

        if !ctx.runtime_options.eval.script.is_empty() {
            let script_source = Box::new(logger::Source::init_path_string(
                entry_path,
                ctx.runtime_options.eval.script,
            ));
            vm.module_loader.eval_source = Some(script_source);

            if ctx.runtime_options.eval.eval_and_print {
                vm.transpiler.options.dead_code_elimination = false;
            }
        } else if !ctx.runtime_options.cron_title.is_empty()
            && !ctx.runtime_options.cron_period.is_empty()
        {
            // Cron execution mode: wrap the entry point in a script that imports the
            // module and calls default.scheduled(controller)
            // Escape path for embedding in JS string literal (handle backslashes on Windows)
            let escaped_path = escape_for_js_string(entry_path);
            let escaped_period = escape_for_js_string(ctx.runtime_options.cron_period);
            let mut cron_script: Vec<u8> = Vec::new();
            write!(
                &mut cron_script,
                "const mod = await import(\"{path}\");\n\
                 const scheduled = (mod.default || mod).scheduled;\n\
                 if (typeof scheduled !== \"function\") throw new Error(\"Module does not export default.scheduled()\");\n\
                 const controller = {{ cron: \"{period}\", type: \"scheduled\", scheduledTime: Date.now() }};\n\
                 await scheduled(controller);",
                path = bstr::BStr::new(&escaped_path),
                period = bstr::BStr::new(&escaped_period),
            )
            .expect("unreachable");
            // entry_path must end with /[eval] for the transpiler to use eval_source
            let trigger = bun_paths::path_literal(b"/[eval]");
            let mut cwd_buf = bun_paths::PathBuffer::uninit();
            let cwd_slice = match bun_sys::getcwd(&mut cwd_buf) {
                bun_sys::Result::Ok(cwd) => cwd,
                bun_sys::Result::Err(_) => return Err(bun_core::err!("SystemResources")),
            };
            let mut eval_path_buf = [0u8; bun_paths::MAX_PATH_BYTES + b"/[eval]".len()];
            eval_path_buf[..cwd_slice.len()].copy_from_slice(cwd_slice);
            eval_path_buf[cwd_slice.len()..cwd_slice.len() + trigger.len()]
                .copy_from_slice(trigger);
            let eval_entry_path = &eval_path_buf[..cwd_slice.len() + trigger.len()];
            // Heap-allocate the path so it outlives this stack frame
            let heap_entry_path: &'static [u8] = Box::leak(Box::<[u8]>::from(eval_entry_path));
            // TODO(port): Source ownership — pass owned Vec<u8> once logger::Source has an owning ctor
            let script_source = Box::new(logger::Source::init_path_string(
                heap_entry_path,
                Box::leak(cron_script.into_boxed_slice()),
            ));
            vm.module_loader.eval_source = Some(script_source);
            run.entry_path = heap_entry_path;
        }

        let b = &mut vm.transpiler;
        b.options.install = ctx.install;
        b.resolver.opts.install = ctx.install;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Offline;
        b.resolver.opts.prefer_latest_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Latest;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
        b.resolver.env_loader = b.env;

        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        b.resolver.opts.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.resolver.opts.minify_whitespace = ctx.bundler_options.minify_whitespace;

        b.options.env.behavior = bun_bundler::options::EnvBehavior::LoadAllWithoutInlining;
        // b.options.minify_syntax = ctx.bundler_options.minify_syntax;

        match &ctx.debug.macros {
            Macros::Disable => {
                b.options.no_macros = true;
            }
            Macros::Map(macros) => {
                b.options.macro_remap = macros.clone();
            }
            Macros::Unspecified => {}
        }

        if b.configure_defines().is_err() {
            fail_with_build_error(vm);
        }

        AsyncHTTP::load_env(vm.log, b.env);

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        VirtualMachine::set_is_main_thread_vm(true);

        // Allow setting a custom timezone
        if let Some(tz) = vm.transpiler.env.get(b"TZ") {
            if !tz.is_empty() {
                let _ = vm.global.set_time_zone(&bun_str::ZigString::init(tz));
            }
        }

        vm.transpiler.env.load_tracy();

        bun_http::set_experimental_http2_client_from_cli(
            ctx.runtime_options.experimental_http2_fetch,
        );
        bun_http::set_experimental_http3_client_from_cli(
            ctx.runtime_options.experimental_http3_fetch,
        );
        Self::do_preconnect(&ctx.runtime_options.preconnect);

        vm.main_is_html_entrypoint = loader
            .unwrap_or_else(|| {
                vm.transpiler
                    .options
                    .loader(bun_paths::extension(entry_path))
            })
            == bun_bundler::options::Loader::Html;

        let callback = jsc::opaque_wrap::<Run>(Run::start);
        vm.global.vm().hold_api_lock(run as *mut Run, callback);
        Ok(())
    }

    fn on_unhandled_rejection_before_close(
        this: &mut VirtualMachine,
        _global: &JSGlobalObject,
        value: JSValue,
    ) {
        this.run_error_handler(value, this.on_unhandled_rejection_exception_list);
        Run::global().any_unhandled = true;
    }

    pub fn start(&mut self) {
        let vm = &mut *self.vm;
        vm.hot_reload = self.ctx.debug.hot_reload;
        vm.on_unhandled_rejection = Self::on_unhandled_rejection_before_close;

        // Start CPU profiler if enabled
        if self.ctx.runtime_options.cpu_prof.enabled {
            let cpu_prof_opts = &self.ctx.runtime_options.cpu_prof;

            vm.cpu_profiler_config = Some(CPUProfiler::CPUProfilerConfig {
                name: cpu_prof_opts.name,
                dir: cpu_prof_opts.dir,
                md_format: cpu_prof_opts.md_format,
                json_format: cpu_prof_opts.json_format,
                interval: cpu_prof_opts.interval,
            });
            CPUProfiler::set_sampling_interval(cpu_prof_opts.interval);
            CPUProfiler::start_cpu_profiler(vm.jsc_vm);
            bun_analytics::Features::cpu_profile_inc();
        }

        // Set up heap profiler config if enabled (actual profiling happens on exit)
        if self.ctx.runtime_options.heap_prof.enabled {
            let heap_prof_opts = &self.ctx.runtime_options.heap_prof;

            vm.heap_profiler_config = Some(HeapProfiler::HeapProfilerConfig {
                name: heap_prof_opts.name,
                dir: heap_prof_opts.dir,
                text_format: heap_prof_opts.text_format,
            });
            bun_analytics::Features::heap_snapshot_inc();
        }

        self.add_conditional_globals();
        'do_redis_preconnect: {
            // This must happen within the API lock, which is why it's not in the "doPreconnect" function
            if self.ctx.runtime_options.redis_preconnect {
                // Go through the global object's getter because Bun.redis is a
                // PropertyCallback which means we don't have a WriteBarrier we can access
                let global = vm.global;
                let bun_object = match vm.global.to_js_value().get(global, b"Bun") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_redis_preconnect,
                    Err(err) => {
                        vm.global.report_active_exception_as_unhandled(err);
                        break 'do_redis_preconnect;
                    }
                };
                let redis = match bun_object.get(global, b"redis") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_redis_preconnect,
                    Err(err) => {
                        vm.global.report_active_exception_as_unhandled(err);
                        break 'do_redis_preconnect;
                    }
                };
                let Some(client) = redis.as_::<bun_valkey::JSValkeyClient>() else {
                    break 'do_redis_preconnect;
                };
                // If connection fails, this will become an unhandled promise rejection, which is fine.
                if let Err(err) = client.do_connect(vm.global, redis) {
                    vm.global.report_active_exception_as_unhandled(err);
                    break 'do_redis_preconnect;
                }
            }
        }

        'do_postgres_preconnect: {
            if self.ctx.runtime_options.sql_preconnect {
                let global = vm.global;
                let bun_object = match vm.global.to_js_value().get(global, b"Bun") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_postgres_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_postgres_preconnect;
                    }
                };
                let sql_object = match bun_object.get(global, b"sql") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_postgres_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_postgres_preconnect;
                    }
                };
                let connect_fn = match sql_object.get(global, b"connect") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_postgres_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_postgres_preconnect;
                    }
                };
                if let Err(err) = connect_fn.call(global, sql_object, &[]) {
                    global.report_active_exception_as_unhandled(err);
                    break 'do_postgres_preconnect;
                }
            }
        }

        match self.ctx.debug.hot_reload {
            HotReload::Hot => {
                jsc::hot_reloader::HotReloader::enable_hot_module_reloading(vm, self.entry_path)
            }
            HotReload::Watch => {
                jsc::hot_reloader::WatchReloader::enable_hot_module_reloading(vm, self.entry_path)
            }
            _ => {}
        }

        if self.entry_path == b"." && !vm.transpiler.fs.top_level_dir.is_empty() {
            self.entry_path = vm.transpiler.fs.top_level_dir;
        }

        let mut printed_sourcemap_warning_and_version = false;

        match vm.load_entry_point(self.entry_path) {
            Ok(promise) => {
                if promise.status() == jsc::PromiseStatus::Rejected {
                    let handled =
                        vm.uncaught_exception(vm.global, promise.result(vm.global.vm()), true);
                    promise.set_handled();
                    vm.pending_internal_promise_reported_at = vm.hot_reload_counter;

                    if vm.hot_reload != HotReload::None || handled {
                        vm.add_main_to_watcher_if_needed();
                        vm.event_loop().tick();
                        vm.event_loop().tick_possibly_forever();
                    } else {
                        vm.exit_handler.exit_code = 1;
                        vm.on_exit();

                        if Run::global().any_unhandled {
                            printed_sourcemap_warning_and_version = true;
                            jsc::SavedSourceMap::MissingSourceMapNoteInfo::print();

                            Output::pretty_errorln(
                                format_args!(
                                    "<r>\n<d>{}<r>",
                                    Global::unhandled_error_bun_version_string()
                                ),
                            );
                        }
                        vm.global_exit();
                    }
                }

                let _ = promise.result(vm.global.vm());

                if !vm.log.msgs.is_empty() {
                    dump_build_error(vm);
                    vm.log.msgs.clear();
                }
            }
            Err(err) => {
                if !vm.log.msgs.is_empty() {
                    dump_build_error(vm);
                    vm.log.msgs.clear();
                } else {
                    Output::pretty_errorln(format_args!(
                        "Error occurred loading entry point: {}",
                        err.name()
                    ));
                    Output::flush();
                }
                // TODO: Do a event loop tick when we figure out how to watch the file that wasn't found
                //   under hot reload mode
                vm.exit_handler.exit_code = 1;
                vm.on_exit();
                if Run::global().any_unhandled {
                    printed_sourcemap_warning_and_version = true;
                    jsc::SavedSourceMap::MissingSourceMapNoteInfo::print();

                    Output::pretty_errorln(format_args!(
                        "<r>\n<d>{}<r>",
                        Global::unhandled_error_bun_version_string()
                    ));
                }
                vm.global_exit();
            }
        }

        // don't run the GC if we don't actually need to
        if vm.is_event_loop_alive() || vm.event_loop().tick_concurrent_with_count() > 0 {
            vm.global.vm().release_weak_refs();
            let _ = vm.arena_gc(); // TODO(port): vm.arena.gc()
            let _ = vm.global.vm().run_gc(false);
            vm.tick();
        }

        // Initial synchronous evaluation of the entrypoint is done (TLA may
        // still be pending and will resolve in the loop below); the embedded
        // source pages are off the hot path now. No-op unless this is a
        // compiled standalone binary, and skip under --watch/--hot since those
        // re-read source on every reload.
        if !self.vm.is_watcher_enabled() {
            bun_standalone_module_graph::StandaloneModuleGraph::hint_source_pages_dont_need();
        }

        {
            if self.vm.is_watcher_enabled() {
                vm.report_exception_in_hot_reloaded_module_if_needed();

                loop {
                    while vm.is_event_loop_alive() {
                        vm.tick();

                        // Report exceptions in hot-reloaded modules
                        vm.report_exception_in_hot_reloaded_module_if_needed();

                        vm.event_loop().auto_tick_active();
                    }

                    vm.on_before_exit();

                    vm.report_exception_in_hot_reloaded_module_if_needed();

                    vm.event_loop().tick_possibly_forever();
                }
            } else {
                while vm.is_event_loop_alive() {
                    vm.tick();
                    vm.event_loop().auto_tick_active();
                }

                if self.ctx.runtime_options.eval.eval_and_print {
                    let to_print = 'brk: {
                        let result: JSValue =
                            vm.entry_point_result.value.get().unwrap_or(JSValue::UNDEFINED);
                        if let Some(promise) = result.as_any_promise() {
                            match promise.status() {
                                jsc::PromiseStatus::Pending => {
                                    // TODO: properly propagate exception upwards
                                    let _ = result.then2(
                                        vm.global,
                                        JSValue::UNDEFINED,
                                        Bun__onResolveEntryPointResult,
                                        Bun__onRejectEntryPointResult,
                                    );

                                    vm.tick();
                                    vm.event_loop().auto_tick_active();

                                    while vm.is_event_loop_alive() {
                                        vm.tick();
                                        vm.event_loop().auto_tick_active();
                                    }

                                    break 'brk result;
                                }
                                _ => break 'brk promise.result(vm.jsc_vm),
                            }
                        }

                        result
                    };

                    to_print.print(vm.global, jsc::PrintKind::Log, jsc::PrintLevel::Log);
                }

                vm.on_before_exit();
            }

            if !vm.log.msgs.is_empty() {
                dump_build_error(vm);
                Output::flush();
            }
        }

        vm.on_unhandled_rejection = Self::on_unhandled_rejection_before_close;
        vm.global.handle_rejected_promises();
        vm.on_exit();

        if self.any_unhandled && !printed_sourcemap_warning_and_version {
            self.vm.exit_handler.exit_code = 1;

            jsc::SavedSourceMap::MissingSourceMapNoteInfo::print();

            Output::pretty_errorln(format_args!(
                "<r>\n<d>{}<r>",
                Global::unhandled_error_bun_version_string()
            ));
        }

        bun_runtime::api::napi::fix_dead_code_elimination();
        bun_runtime::webcore::BakeResponse::fix_dead_code_elimination();
        bun_crash_handler::fix_dead_code_elimination();
        bun_jsc::js_secrets::fix_dead_code_elimination();
        vm.global_exit();
    }

    fn add_conditional_globals(&mut self) {
        let vm = &mut *self.vm;
        let runtime_options: &Command::RuntimeOptions = &self.ctx.runtime_options;

        if !runtime_options.eval.script.is_empty() {
            // TODO(port): move to bun_jsc_sys
            // SAFETY: FFI call with valid &JSGlobalObject; no preconditions beyond non-null.
            unsafe { Bun__ExposeNodeModuleGlobals(vm.global) };
        }
        if runtime_options.expose_gc {
            // TODO(port): move to bun_jsc_sys
            // SAFETY: FFI call with valid &JSGlobalObject; no preconditions beyond non-null.
            unsafe { JSC__JSGlobalObject__addGc(vm.global) };
        }
    }
}

// TODO(port): these use callconv(jsc.conv) + noreturn; #[bun_jsc::host_fn] emits the
// correct ABI but expects JsResult<JSValue>. Phase B: confirm macro supports `-> !`.
#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bun__onResolveEntryPointResult(global: &JSGlobalObject, callframe: &CallFrame) -> ! {
    let arguments = callframe.arguments_old(1);
    let result = arguments.slice()[0];
    result.print(global, jsc::PrintKind::Log, jsc::PrintLevel::Log);
    Global::exit(global.bun_vm().exit_handler.exit_code);
}

#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bun__onRejectEntryPointResult(global: &JSGlobalObject, callframe: &CallFrame) -> ! {
    let arguments = callframe.arguments_old(1);
    let result = arguments.slice()[0];
    result.print(global, jsc::PrintKind::Log, jsc::PrintLevel::Log);
    Global::exit(global.bun_vm().exit_handler.exit_code);
}

#[cold]
#[inline(never)]
fn dump_build_error(vm: &mut VirtualMachine) {
    Output::flush();

    let writer = Output::error_writer_buffered();
    // `defer Output.flush()` — RAII via scopeguard since this is a side effect
    let _flush = scopeguard::guard((), |_| Output::flush());

    let _ = vm.log.print(writer);
}

#[cold]
#[inline(never)]
pub fn fail_with_build_error(vm: &mut VirtualMachine) -> ! {
    dump_build_error(vm);
    Global::exit(1);
}

/// Escape a string for safe embedding in a JS double-quoted string literal.
/// Escapes backslashes, double quotes, newlines, etc.
fn escape_for_js_string(input: &[u8]) -> Box<[u8]> {
    let mut needs_escape = false;
    for &c in input {
        if c == b'\\' || c == b'"' || c == b'\n' || c == b'\r' || c == b'\t' {
            needs_escape = true;
            break;
        }
    }
    if !needs_escape {
        return Box::<[u8]>::from(input);
    }

    let mut result: Vec<u8> = Vec::with_capacity(input.len() + 16);
    for &c in input {
        match c {
            b'\\' => result.extend_from_slice(b"\\\\"),
            b'"' => result.extend_from_slice(b"\\\""),
            b'\n' => result.extend_from_slice(b"\\n"),
            b'\r' => result.extend_from_slice(b"\\r"),
            b'\t' => result.extend_from_slice(b"\\t"),
            _ => result.push(c),
        }
    }
    result.into_boxed_slice()
}

// TODO(port): move to bun_jsc_sys
unsafe extern "C" {
    fn Bun__ExposeNodeModuleGlobals(global: *const JSGlobalObject);
    fn JSC__JSGlobalObject__addGc(global: *const JSGlobalObject);
}

// TODO(port): these enum paths are placeholders for cross-crate types referenced
// only by variant; Phase B fixes imports.
use bun_runtime::cli::debug::HotReload;
use bun_runtime::cli::debug::Macros;
use bun_runtime::cli::debug::OfflineMode;
use bun_jsc::bun_cpu_profiler as CPUProfiler;
use bun_jsc::bun_heap_profiler as HeapProfiler;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun.js.zig (656 lines)
//   confidence: medium
//   todos:      12
//   notes:      static mut RUN singleton + arena-as-VM-allocator need Phase-B review; host_fn macro must support `-> !`
// ──────────────────────────────────────────────────────────────────────────
