//! Port of src/bun.js.zig — entry point for `bun run <file>` / standalone executables.

use core::mem::MaybeUninit;
use core::ptr::NonNull;
use core::sync::atomic::Ordering;
use std::io::Write as _;

use bun_alloc::Arena; // MimallocArena
use crate::cli::Command;
use bun_core::{Global, Output};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, VirtualMachineRef as VirtualMachine};
use bun_logger as logger;
use bun_dns::Order as DnsResultOrder;
use bun_standalone_graph::StandaloneModuleGraph::StandaloneModuleGraph;
use bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo;

extern crate bun_standalone_graph as bun_standalone_module_graph;

// Thin re-exports (mirrors `pub const X = @import(...)` at file top).
pub use bun_jsc as jsc_mod; // TODO(port): naming — Zig exposed this as `bun.js.jsc`
// TODO(b2-gated): `bun_jsc::bindgen` is in `_gated` (jsc/lib.rs); re-export once un-gated.
pub use crate::api;
pub use crate::webcore;

pub fn apply_standalone_runtime_flags(
    b: &mut bun_bundler::Transpiler,
    graph: &StandaloneModuleGraph,
) {
    use bun_options_types::schema::api::DotEnvBehavior;
    use bun_standalone_graph::StandaloneModuleGraph::Flags;
    let disable_env = graph.flags.contains(Flags::DISABLE_DEFAULT_ENV_FILES);
    b.options.env.disable_default_env_files = disable_env;
    b.options.env.behavior = if disable_env {
        DotEnvBehavior::disable
    } else {
        DotEnvBehavior::LoadAllWithoutInlining
    };

    b.resolver.opts.load_tsconfig_json =
        !graph.flags.contains(Flags::DISABLE_AUTOLOAD_TSCONFIG);
    b.resolver.opts.load_package_json =
        !graph.flags.contains(Flags::DISABLE_AUTOLOAD_PACKAGE_JSON);
}

/// Shared body of the `boot` / `boot_standalone` "wire ctx → transpiler" block.
/// Factored out so the per-field cross-crate type drift is fixed in one place.
fn apply_ctx_to_transpiler(vm: &mut VirtualMachine, ctx: &mut Command::ContextData) {
    // TODO(b2-field-shape): `vm.preload`/`vm.argv` are `Vec<Box<[u8]>>` but
    // `ctx.preloads`/`ctx.passthrough` shapes differ; clone-convert once shapes
    // settle.
    let _ = &ctx.preloads;
    let _ = &ctx.passthrough;

    let b = &mut vm.transpiler;
    b.options.install = ctx.install.as_deref();
    // TODO(b2-field-shape): `resolver.opts.install` is an erased `*const ()`.
    b.resolver.opts.global_cache = ctx.debug.global_cache;
    b.resolver.opts.prefer_offline_install =
        ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Offline;
    // TODO(b2-field-shape): `resolver.opts.prefer_latest_install` /
    // `minify_identifiers` / `minify_whitespace` not yet on `BundleOptions`.
    let _ = ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Latest;
    b.options.global_cache = b.resolver.opts.global_cache;
    b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
    b.resolver.env_loader = NonNull::new(b.env);

    b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
    b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
    b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;

    // TODO(b2-field-shape): `serve_plugins` `Vec` ↔ `Box<[_]>` and
    // `bunfig_path` shapes differ.
    let _ = &ctx.args.serve_plugins;
    let _ = &ctx.args.bunfig_path;

    match &ctx.debug.macros {
        Macros::Disable => {
            b.options.no_macros = true;
        }
        Macros::Map(_macros) => {
            // TODO(b2-field-shape): `MacroMap` (Box<[u8]> keys) ↔
            // `StringArrayHashMap<&'static [u8]>` mismatch.
        }
        Macros::Unspecified => {}
    }
}

pub struct Run {
    pub ctx: Command::Context<'static>,
    pub vm: *mut VirtualMachine,
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
        ctx: Command::Context<'static>,
        entry_path: &'static [u8],
        graph_ptr: &'static mut StandaloneModuleGraph,
    ) -> Result<(), bun_core::Error> {
        jsc::mark_binding();
        jsc::initialize(false);
        bun_analytics::features::standalone_executable.fetch_add(1, Ordering::Relaxed);

        bun_js_parser::Expr::data_store_create();
        bun_js_parser::Stmt::data_store_create();
        let arena = Arena::new();

        // Load bunfig.toml unless disabled by compile flags
        // Note: config loading with execArgv is handled earlier in cli.zig via loadConfig
        if !ctx.debug.loaded_bunfig
            && !graph_ptr
                .flags
                .contains(bun_standalone_graph::StandaloneModuleGraph::Flags::DISABLE_AUTOLOAD_BUNFIG)
        {
            crate::cli::Arguments::load_config_path(
                Command::Tag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        // SAFETY: single-threaded init; first and only write to RUN.
        unsafe {
            RUN.write(Run {
                vm: VirtualMachine::init_with_module_graph(jsc::virtual_machine::Options {
                    // PERF(port): was arena.allocator() — global mimalloc in Rust
                    log: NonNull::new(ctx.log),
                    args: ctx.args.clone(),
                    graph: Some(NonNull::from(&mut *graph_ptr).cast()),
                    is_main_thread: true,
                    smol: ctx.runtime_options.smol,
                    // TODO(b2-cycle): `Options.debugger` is `()` until the real type lands.
                    debugger: (),
                    dns_result_order: DnsResultOrder::from_string_or_die(
                        &ctx.runtime_options.dns_result_order,
                    ) as u8,
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
        // SAFETY: `vm` was just produced by `VirtualMachine::init_*`; uniquely
        // owned by the static `RUN` for process lifetime.
        let vm = unsafe { &mut *run.vm };
        let ctx = &mut *run.ctx;
        // TODO(port): vm.arena / vm.allocator backref — raw ptr into static RUN
        vm.arena = NonNull::new(&mut run.arena as *mut Arena);

        apply_ctx_to_transpiler(vm, ctx);
        let b = &mut vm.transpiler;
        apply_standalone_runtime_flags(b, graph_ptr);

        if b.configure_defines().is_err() {
            fail_with_build_error(vm);
        }

        // SAFETY: vm.log / b.env are non-null after `init_*`.
        bun_http::async_http::load_env(
            unsafe { vm.log.unwrap().as_mut() },
            unsafe { &*vm.transpiler.env },
        );

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        // TODO(b2-blocked): `VirtualMachine::set_is_main_thread_vm(true)` — not yet ported.

        // TODO(b2-blocked): `bun_http::set_experimental_http{2,3}_client_from_cli` — Zig-only
        // globals (`http.zig`); plumb once the Rust http crate exposes them.
        let _ = ctx.runtime_options.experimental_http2_fetch;
        let _ = ctx.runtime_options.experimental_http3_fetch;
        Self::do_preconnect(&ctx.runtime_options.preconnect);

        vm.global().vm().hold_api_lock(
            (run as *mut Run).cast(),
            start_trampoline,
        );
        Ok(())
    }

    fn do_preconnect(preconnect: &[Box<[u8]>]) {
        if preconnect.is_empty() {
            return;
        }
        bun_http::http_thread::init(&Default::default());

        for url_str in preconnect {
            // TODO(port): lifetime — `preconnect()` takes `URL<'static>` but
            // `url_str` borrows `ctx.runtime_options`. Leak to extend; the
            // process exits before this matters.
            let url_str: &'static [u8] = Box::leak(url_str.clone());
            let url = bun_url::URL::parse(url_str);

            if !url.is_http() && !url.is_https() {
                Output::err_generic(
                    "preconnect URL must be HTTP or HTTPS: {}",
                    (bun_core::fmt::quote(url_str),),
                );
                Global::exit(1);
            }

            if url.hostname.is_empty() {
                Output::err_generic(
                    "preconnect URL must have a hostname: {}",
                    (bun_core::fmt::quote(url_str),),
                );
                Global::exit(1);
            }

            if !url.has_valid_port() {
                Output::err_generic(
                    "preconnect URL must have a valid port: {}",
                    (bun_core::fmt::quote(url_str),),
                );
                Global::exit(1);
            }

            bun_http::async_http::preconnect(url, false);
        }
    }

    #[cold]
    fn boot_bun_shell(
        ctx: Command::Context<'_>,
        entry_path: &[u8],
    ) -> Result<crate::shell::ExitCode, bun_core::Error> {
        // this is a hack: make dummy bundler so we can use its `.runEnvLoader()`
        // function to populate environment variables probably should split out
        // the functionality
        // TODO(b2-gated): `bun_jsc::config::configure_transform_options_for_bun_vm`
        // is in `_gated`; inline the 3 field writes here (mirrors jsc_hooks.rs).
        let opts = ctx.args.clone();
        let arena = Arena::new();
        let mut bundle = bun_bundler::Transpiler::init(&arena, ctx.log, opts, None)?;
        bundle.run_env_loader(bundle.options.env.disable_default_env_files)?;
        // SAFETY: `bundle.env` is non-null after a successful `init`.
        let mini = jsc::MiniEventLoop::init_global(Some(unsafe { &mut *bundle.env }), None);
        // SAFETY: `init_global` returns the live process-lifetime mini event loop.
        unsafe { (*mini).top_level_dir = ctx.args.absolute_working_dir.clone().unwrap_or_default() };
        crate::shell::Interpreter::init_and_run_from_file(ctx, mini, entry_path)
    }

    pub fn boot(
        ctx: Command::Context<'static>,
        entry_path: &'static [u8],
        loader: Option<bun_bundler::options::Loader>,
    ) -> Result<(), bun_core::Error> {
        jsc::mark_binding();

        if !ctx.debug.loaded_bunfig {
            crate::cli::Arguments::load_config_path(
                Command::Tag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        // The shell does not need to initialize JSC.
        // JSC initialization costs 1-3ms. We skip this if we know it's a shell script.
        if entry_path.ends_with(b".sh") {
            let exit_code = Self::boot_bun_shell(ctx, entry_path)?;
            Global::exit(exit_code);
        }

        jsc::initialize(ctx.runtime_options.eval.eval_and_print);

        bun_js_parser::Expr::data_store_create();
        bun_js_parser::Stmt::data_store_create();
        let arena = Arena::new();

        // SAFETY: single-threaded init; first and only write to RUN.
        unsafe {
            RUN.write(Run {
                vm: VirtualMachine::init(jsc::VirtualMachineInitOptions {
                    // TODO(b2-cycle): `InitOptions` is the minimal stub surface; the
                    // full `Options` struct (log/store_fd/eval/debugger/dns) is wired
                    // via `init_with_module_graph`-style patching once it un-gates.
                    smol: ctx.runtime_options.smol,
                    eval_mode: ctx.runtime_options.eval.eval_and_print,
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
        let _ = DnsResultOrder::from_string_or_die(&ctx.runtime_options.dns_result_order);
        let _ = ctx.debug.hot_reload != HotReload::None; // store_fd

        let run = Run::global();
        // SAFETY: `vm` was just produced by `VirtualMachine::init`; uniquely owned
        // by the static `RUN` for process lifetime.
        let vm = unsafe { &mut *run.vm };
        let ctx = &mut *run.ctx;
        // TODO(port): vm.arena / vm.allocator backref — raw ptr into static RUN
        vm.arena = NonNull::new(&mut run.arena as *mut Arena);

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
            // TODO(port): Zig used `bun.OSPathLiteral("/[eval]")`; on Windows this
            // would be a wide string. Phase B: route through a path-literal helper.
            let trigger: &[u8] = b"/[eval]";
            let mut cwd_buf = bun_paths::PathBuffer::uninit();
            let cwd_len = match bun_sys::getcwd(&mut cwd_buf.0[..]) {
                bun_sys::Maybe::Ok(len) => len,
                bun_sys::Maybe::Err(_) => return Err(bun_core::err!("SystemResources")),
            };
            let mut eval_path_buf = [0u8; bun_paths::MAX_PATH_BYTES + b"/[eval]".len()];
            eval_path_buf[..cwd_len].copy_from_slice(&cwd_buf.0[..cwd_len]);
            eval_path_buf[cwd_len..cwd_len + trigger.len()].copy_from_slice(trigger);
            let eval_entry_path = &eval_path_buf[..cwd_len + trigger.len()];
            // Heap-allocate the path so it outlives this stack frame
            let heap_entry_path: &'static [u8] = Box::leak(Box::<[u8]>::from(eval_entry_path));
            // TODO(port): Source ownership — pass owned Vec<u8> once logger::Source has an owning ctor
            let script_source = Box::new(logger::Source::init_path_string(
                heap_entry_path,
                &*Box::leak(cron_script.into_boxed_slice()),
            ));
            vm.module_loader.eval_source = Some(script_source);
            run.entry_path = heap_entry_path;
        }

        apply_ctx_to_transpiler(vm, ctx);
        let b = &mut vm.transpiler;
        b.options.env.behavior =
            bun_options_types::schema::api::DotEnvBehavior::LoadAllWithoutInlining;

        if b.configure_defines().is_err() {
            fail_with_build_error(vm);
        }

        // SAFETY: vm.log / b.env are non-null after `init`.
        bun_http::async_http::load_env(
            unsafe { vm.log.unwrap().as_mut() },
            unsafe { &*vm.transpiler.env },
        );

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        // TODO(b2-blocked): `VirtualMachine::set_is_main_thread_vm(true)` — not yet ported.

        // Allow setting a custom timezone
        // TODO(b2-gated): `JSGlobalObject::set_time_zone` lives in the gated
        // JSGlobalObject.rs module; wire `vm.transpiler.env.get(b"TZ")` →
        // `set_time_zone` once it un-gates.

        // SAFETY: `transpiler.env` is non-null after `init`.
        unsafe { &mut *vm.transpiler.env }.load_tracy();

        // TODO(b2-blocked): `bun_http::set_experimental_http{2,3}_client_from_cli` — Zig-only
        // globals (`http.zig`); plumb once the Rust http crate exposes them.
        let _ = ctx.runtime_options.experimental_http2_fetch;
        let _ = ctx.runtime_options.experimental_http3_fetch;
        Self::do_preconnect(&ctx.runtime_options.preconnect);

        vm.main_is_html_entrypoint = loader
            .unwrap_or_else(|| {
                vm.transpiler
                    .options
                    .loader(bun_paths::extension(entry_path))
            })
            == bun_bundler::options::Loader::Html;

        vm.global().vm().hold_api_lock(
            (run as *mut Run).cast(),
            start_trampoline,
        );
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
        // SAFETY: `self.vm` is the live VM pointer set in `boot*()`.
        let vm = unsafe { &mut *self.vm };
        vm.hot_reload = self.ctx.debug.hot_reload;
        vm.on_unhandled_rejection = Self::on_unhandled_rejection_before_close;

        // Start CPU profiler if enabled
        if self.ctx.runtime_options.cpu_prof.enabled {
            // TODO(b2-gated): `bun_jsc::bun_cpu_profiler` is in `_gated`; wire
            // `vm.cpu_profiler_config` + `set_sampling_interval` /
            // `start_cpu_profiler` once that module compiles.
            bun_analytics::features::cpu_profile.fetch_add(1, Ordering::Relaxed);
        }

        // Set up heap profiler config if enabled (actual profiling happens on exit)
        if self.ctx.runtime_options.heap_prof.enabled {
            // TODO(b2-gated): `bun_jsc::bun_heap_profiler` is in `_gated`; wire
            // `vm.heap_profiler_config` once that module compiles.
            bun_analytics::features::heap_snapshot.fetch_add(1, Ordering::Relaxed);
        }

        self.add_conditional_globals();
        'do_redis_preconnect: {
            // This must happen within the API lock, which is why it's not in the "doPreconnect" function
            if self.ctx.runtime_options.redis_preconnect {
                // Go through the global object's getter because Bun.redis is a
                // PropertyCallback which means we don't have a WriteBarrier we can access
                let global = vm.global();
                let bun_object: JSValue = match global.to_js_value().get(global, b"Bun") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_redis_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_redis_preconnect;
                    }
                };
                let redis: JSValue = match bun_object.get(global, b"redis") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_redis_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_redis_preconnect;
                    }
                };
                let Some(client) = redis.as_::<crate::valkey_jsc::JSValkeyClient>() else {
                    break 'do_redis_preconnect;
                };
                // If connection fails, this will become an unhandled promise rejection, which is fine.
                if let Err(err) = client.do_connect(global, redis) {
                    global.report_active_exception_as_unhandled(err);
                    break 'do_redis_preconnect;
                }
            }
        }

        'do_postgres_preconnect: {
            if self.ctx.runtime_options.sql_preconnect {
                let global = vm.global();
                let bun_object: JSValue = match global.to_js_value().get(global, b"Bun") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_postgres_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_postgres_preconnect;
                    }
                };
                let sql_object: JSValue = match bun_object.get(global, b"sql") {
                    Ok(Some(v)) => v,
                    Ok(None) => break 'do_postgres_preconnect,
                    Err(err) => {
                        global.report_active_exception_as_unhandled(err);
                        break 'do_postgres_preconnect;
                    }
                };
                let connect_fn: JSValue = match sql_object.get(global, b"connect") {
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
            HotReload::Hot | HotReload::Watch => {
                // TODO(b2-blocked): `jsc::hot_reloader::{Hot,Watch}Reloader::
                // enable_hot_module_reloading` — `VirtualMachineRef: HotReloaderCtx`
                // bound is not yet implemented.
            }
            _ => {}
        }

        if self.entry_path == b"." && !vm.transpiler.fs.top_level_dir.is_empty() {
            self.entry_path = vm.transpiler.fs.top_level_dir;
        }

        let mut printed_sourcemap_warning_and_version = false;

        match vm.load_entry_point(self.entry_path) {
            Ok(promise) => {
                if promise.status() == jsc::js_promise::Status::Rejected {
                    let handled =
                        vm.uncaught_exception(vm.global, promise.result(vm.global().vm()), true);
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
                            MissingSourceMapNoteInfo::print();

                            Output::pretty_errorln(
                                format_args!(
                                    "<r>\n<d>{}<r>",
                                    Global::unhandled_error_bun_version_string
                                ),
                            );
                        }
                        vm.global_exit();
                    }
                }

                let _ = promise.result(vm.global().vm());

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
                    MissingSourceMapNoteInfo::print();

                    Output::pretty_errorln(format_args!(
                        "<r>\n<d>{}<r>",
                        Global::unhandled_error_bun_version_string
                    ));
                }
                vm.global_exit();
            }
        }

        // don't run the GC if we don't actually need to
        if vm.is_event_loop_alive() || vm.event_loop().tick_concurrent_with_count() > 0 {
            vm.global().vm().release_weak_refs();
            let _ = vm.arena_gc(); // TODO(port): vm.arena.gc()
            let _ = vm.global().vm().run_gc(false);
            vm.tick();
        }

        // Initial synchronous evaluation of the entrypoint is done (TLA may
        // still be pending and will resolve in the loop below); the embedded
        // source pages are off the hot path now. No-op unless this is a
        // compiled standalone binary, and skip under --watch/--hot since those
        // re-read source on every reload.
        if !vm.is_watcher_enabled() {
            StandaloneModuleGraph::hint_source_pages_dont_need();
        }

        {
            if vm.is_watcher_enabled() {
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
                    // TODO(b2-blocked): `bun -p` result printing —
                    // `JSValue::then2`/`JSValue::print` (Zig: `JSValue.print`, takes
                    // `ConsoleObject.MessageType`/`MessageLevel`) +
                    // `Bun__on{Resolve,Reject}EntryPointResult` are not yet at this
                    // tier. Mirrors run_command.rs.
                }

                vm.on_before_exit();
            }

            if !vm.log.msgs.is_empty() {
                dump_build_error(vm);
                Output::flush();
            }
        }

        vm.on_unhandled_rejection = Self::on_unhandled_rejection_before_close;
        vm.global().handle_rejected_promises();
        vm.on_exit();

        if self.any_unhandled && !printed_sourcemap_warning_and_version {
            vm.exit_handler.exit_code = 1;

            MissingSourceMapNoteInfo::print();

            Output::pretty_errorln(format_args!(
                "<r>\n<d>{}<r>",
                Global::unhandled_error_bun_version_string
            ));
        }

        // PORT NOTE: `fixDeadCodeElimination()` calls dropped — Rust does not DCE
        // `#[no_mangle] extern "C"` symbols the way Zig does, so the anti-DCE
        // shims (`napi`, `BakeResponse`, `crash_handler`, `js_secrets`) are
        // unnecessary here. Mirrors run_command.rs.
        vm.global_exit();
    }

    fn add_conditional_globals(&mut self) {
        // SAFETY: `self.vm` is the live VM pointer set in `boot*()`.
        let vm = unsafe { &mut *self.vm };
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

/// `OpaqueCallback` trampoline for `hold_api_lock` → `Run::start`.
/// PORT NOTE: `jsc::opaque_wrap` is now zero-arg + `FnTyped` trait; a local
/// trampoline is simpler than implementing the trait for a method.
extern "C" fn start_trampoline(ctx: *mut core::ffi::c_void) {
    // SAFETY: caller passes `(run as *mut Run).cast()`; `run` is the static
    // `RUN` singleton initialised in `boot*()`.
    unsafe { (*ctx.cast::<Run>()).start() }
}

// TODO(port): these use callconv(jsc.conv) + noreturn; `#[bun_jsc::host_fn]`
// expects `IntoHostFnResult` which `!` does not implement. Return `JSValue`
// nominally — `Global::exit` diverges before reaching the return.
#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bun__onResolveEntryPointResult(global: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
    let arguments = callframe.arguments_old::<1>();
    let _result = arguments.slice()[0];
    // TODO(b2-blocked): `JSValue::print(global, .Log, .Log)` — not yet ported.
    // SAFETY: `bun_vm()` returns the live per-thread VM.
    Global::exit(unsafe { (*global.bun_vm()).exit_handler.exit_code });
}

#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bun__onRejectEntryPointResult(global: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
    let arguments = callframe.arguments_old::<1>();
    let _result = arguments.slice()[0];
    // TODO(b2-blocked): `JSValue::print(global, .Log, .Log)` — not yet ported.
    // SAFETY: `bun_vm()` returns the live per-thread VM.
    Global::exit(unsafe { (*global.bun_vm()).exit_handler.exit_code });
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

// Cross-crate enum types referenced only by variant.
use bun_options_types::Context::HotReload;
use bun_options_types::Context::MacroOptions as Macros;
use bun_options_types::OfflineMode::OfflineMode;
// TODO(b2-gated): `bun_cpu_profiler` / `bun_heap_profiler` modules live in
// jsc/lib.rs `_gated`; the profiler-config blocks below are stubbed until
// those un-gate.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun.js.zig (656 lines)
//   confidence: medium
//   todos:      12
//   notes:      static mut RUN singleton + arena-as-VM-allocator need Phase-B review; host_fn macro must support `-> !`
// ──────────────────────────────────────────────────────────────────────────
