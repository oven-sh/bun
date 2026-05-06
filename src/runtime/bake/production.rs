//! Implements building a Bake application to production

#![allow(unused_imports, unused_variables, dead_code, unreachable_code, unused_mut)]

use core::ffi::c_char;
use core::ptr::NonNull;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::Arena;
use crate::bake as bake;
use crate::bake::bake_body;
use crate::bake::framework_router::{self as framework_router, FrameworkRouter, OpaqueFileId};
// Full Phase-A FrameworkRouter draft (has `Part`, `route_ptr`, `init_empty`,
// `scan_all`, `Route.part`). The keystone stub in `mod.rs::framework_router`
// only carries the index newtypes; route construction/walking goes through
// the full body. Phase B unifies these once the stub is dropped.
use crate::bake::framework_router_body as fr;
use super::PatternBuffer;
use bun_bundler::options::{self as bundler_options, OutputFile, SourceMapOption};
use bun_bundler::output_file::Index as OutputFileIndex;
use bun_bundler::BundleV2;

use bun_collections::{ArrayHashMap, AutoBitSet, StringArrayHashMap};
use bun_core::{self as bun, Global, Output};
use bun_dotenv as dotenv;
use bun_http::AsyncHTTP;
use bun_jsc::{self as jsc, AnyPromise, JSGlobalObject, JSModuleLoader, JSPromise, JSValue, JsResult, StringJsc as _};
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_paths::{self as path, PathBuffer};
use bun_paths::resolve_path::{self as resolve_path, platform};
use bun_resolver as resolver;
use bun_string::{strings, String as BunString};
use bun_bundler::Transpiler;

use crate::cli::command::{Context, ContextData, HotReload};
use bun_options_types::Context::MacroOptions;
use bun_options_types::OfflineMode::OfflineMode;

bun_core::declare_scope!(production, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_core::scoped_log!(production, $($arg)*) };
}

/// Local shim: `bun_core::Error` has no `From<bun_jsc::JsError>` (tier-0 cannot
/// depend on tier-6). Map every JS-side failure to the `"JSError"` sentinel the
/// caller already pattern-matches on (production.zig: `error.JSError`).
#[inline(always)]
fn js_err(_: bun_jsc::JsError) -> bun_core::Error {
    bun_core::err!("JSError")
}

/// `bun_bundler::options::Side` (the type carried on `OutputFile.side`) is a
/// distinct nominal copy of `bake_types::Side`; no upstream `From`/`Display`.
/// Local stringifier for the debug log line below.
#[inline(always)]
fn side_name(s: bun_bundler::options::Side) -> &'static str {
    match s {
        bun_bundler::options::Side::Client => "client",
        bun_bundler::options::Side::Server => "server",
    }
}

pub fn build_command(ctx: Context) -> Result<(), bun_core::Error> {
    bake::print_warning();

    if ctx.args.entry_points.len() > 1 {
        bun_core::err_generic!("bun build --app only accepts one entrypoint");
        Global::crash();
    }

    if ctx.debug.hot_reload != HotReload::None {
        bun_core::err_generic!("Instead of using --watch, use 'bun run'");
        Global::crash();
    }

    let mut cwd_buf = bun_core::PathBuffer::uninit();
    let cwd = match bun_core::getcwd(&mut cwd_buf) {
        Ok(cwd) => cwd.as_bytes(),
        Err(err) => {
            Output::err(err, "Could not query current working directory", ());
            Global::crash();
        }
    };
    // PORT NOTE: reshaped for borrowck — clone the cwd slice so the PathBuffer
    // borrow doesn't span the rest of the function (matches `cwd: []const u8`
    // semantics in the Zig spec since the buffer is never reused).
    let cwd: Box<[u8]> = Box::from(cwd);

    // Create a VM + global for loading the config file, plugins, and
    // performing build time prerendering.
    jsc::initialize(false);
    bun_js_parser::Expr::data_store_create();
    bun_js_parser::Stmt::data_store_create();

    // PERF(port): was MimallocArena bulk-free — VM allocator now global mimalloc.
    let mut arena = Arena::new();

    let vm_ptr = VirtualMachine::init_bake(jsc::virtual_machine::Options {
        // allocator: arena — dropped per §Allocators (global mimalloc)
        log: NonNull::new(ctx.log),
        args: ctx.args.clone(),
        smol: ctx.runtime_options.smol,
        ..Default::default()
    })?;
    // SAFETY: `init_bake` returns a freshly-allocated VM owned by this thread;
    // unique access for the rest of this function.
    let vm = unsafe { &mut *vm_ptr };
    // defer vm.deinit() — handled by `vm.destroy()` on the unwind path below.
    let _vm_guard = scopeguard::guard((), |_| {
        // SAFETY: vm_ptr is the unique live VM on this thread.
        unsafe { (*vm_ptr).destroy() };
    });

    // A special global object is used to allow registering virtual modules
    // that bypass Bun's normal module resolver and plugin system.
    vm.regular_event_loop.global = NonNull::new(vm.global);
    // SAFETY: event_loop is a self-ptr into vm; unique access here.
    unsafe { (*vm.event_loop()).ensure_waker() };
    {
        let b = &mut vm.transpiler;
        // TODO(port): preload/argv are `Vec<Box<[u8]>>` on both sides; clone since
        // ctx outlives vm but Zig assigned slices directly (no ownership transfer).
        // Phase B may change VM fields to borrow from ctx.
        vm.preload = ctx.preloads.clone();
        vm.argv = ctx.passthrough.clone();
        vm.arena = NonNull::new(&mut arena as *mut Arena);
        // vm.allocator = arena.allocator() — dropped per §Allocators
        b.options.install = ctx.install.as_deref();
        b.resolver.opts.install = ctx
            .install
            .as_deref()
            .map(|p| p as *const _ as *const ())
            .unwrap_or(core::ptr::null());
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Offline;
        // PORT NOTE: `bun_resolver::options::BundleOptions` has no
        // `prefer_latest_install` field in the Rust port; compute the value once
        // and assign only to `b.options` (which does carry it). The Zig source
        // mirrored it onto resolver.opts but the resolver never reads it.
        let prefer_latest =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Latest;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = prefer_latest;
        // SAFETY: spec production.zig:56 `b.resolver.env_loader = b.env` — raw
        // pointer copy. `b.env` is the Transpiler-owned `*mut Loader`; store it
        // as `NonNull` (not `&Loader`) because `configure_defines()` below
        // reborrows the same allocation as `&mut Loader` via `run_env_loader()`,
        // which would alias a live `&Loader` here. The Loader outlives the
        // resolver (process-lifetime singleton or VM-owned).
        b.resolver.env_loader = NonNull::new(b.env);
        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        // PORT NOTE: `bun_resolver::options::BundleOptions` has no
        // `minify_identifiers`/`minify_whitespace` fields; the Zig mirror onto
        // resolver.opts is dropped (the resolver never reads them).
        b.options.env.behavior = bundler_options::EnvBehavior::LoadAllWithoutInlining;
    }
    // SAFETY: event_loop is a self-ptr into vm; unique access here.
    unsafe { (*vm.event_loop()).ensure_waker() };
    match &ctx.debug.macros {
        MacroOptions::Disable => {
            vm.transpiler.options.no_macros = true;
        }
        MacroOptions::Map(macros) => {
            // TODO(port): `ctx.debug.macros` carries
            // `ArrayHashMap<Box<[u8]>, ArrayHashMap<Box<[u8]>, Box<[u8]>>>` while
            // `Transpiler.options.macro_remap` is
            // `StringArrayHashMap<StringArrayHashMap<&'static [u8]>>`. The two
            // shapes diverge at the value lifetime; defer the conversion.
            let _ = macros;
            todo!("blocked_on: bun_bundler::options::MacroRemap conversion from ctx.debug.macros");
        }
        MacroOptions::Unspecified => {}
    }
    if vm.transpiler.configure_defines().is_err() {
        fail_with_build_error(vm);
    }
    // SAFETY: vm.log was set from ctx.log above (non-null process-lifetime).
    bun_http::async_http::load_env(unsafe { vm.log.unwrap().as_mut() }, unsafe { &*vm.transpiler.env });
    vm.load_extra_env_and_source_code_printer();
    vm.is_main_thread = true;
    jsc::virtual_machine::IS_MAIN_THREAD_VM.with(|c| c.set(true));

    // SAFETY: vm.jsc_vm is the live JSC::VM* set in init.
    // PORT NOTE: Zig's `vm.jsc_vm.getAPILock()` returns an RAII lock guard; the
    // Rust `bun_jsc::VM` only exposes the callback-style `hold_api_lock`, which
    // can't span the rest of this function body. Stub as a unit guard.
    // TODO(port): wire JSC API lock once `bun_jsc::VM::get_api_lock` lands.
    let api_lock: () = {
        let _ = unsafe { &*vm.jsc_vm };
        todo!("blocked_on: bun_jsc::VM::get_api_lock");
    };
    // defer api_lock.release() — handled by Lock's Drop

    let mut pt: PerThread = PerThread {
        input_files: &[],
        bundled_outputs: &[],
        output_indexes: &[],
        module_keys: &[],
        module_map: StringArrayHashMap::default(),
        source_maps: StringArrayHashMap::default(),

        vm: vm_ptr,
        loaded_files: AutoBitSet::init_empty(0).expect("unreachable"),
        // PORT NOTE: Zig set `.null` then `.protect()`/`.unprotect()` manually;
        // PORTING.md mandates `Strong` for heap-stored JSValue. `Strong::empty()`
        // mirrors the pre-init state; `PerThread::init` overwrites it.
        all_server_files: bun_jsc::Strong::empty(),
    };

    // PORT NOTE: reshaped for borrowck — `pt.vm` already borrows `*vm`, so pass
    // the raw VM pointer and re-borrow inside.
    match build_with_vm(ctx, &cwd, vm_ptr, &mut pt) {
        Ok(()) => {}
        Err(e) if e == bun_core::err!("JSError") => {
            bun_crash_handler::handle_error_return_trace(e, None);
            // SAFETY: vm.global is live for VM lifetime.
            let global = unsafe { &*(*vm_ptr).global };
            let err_value = global.take_exception(jsc::JsError::Thrown);
            // SAFETY: see above.
            unsafe {
                (*vm_ptr).print_error_like_object_to_console(
                    err_value.to_error().unwrap_or(err_value),
                )
            };
            // SAFETY: see above.
            let vm = unsafe { &mut *vm_ptr };
            if vm.exit_handler.exit_code == 0 {
                vm.exit_handler.exit_code = 1;
            }
            vm.on_exit();
            vm.global_exit();
        }
        Err(e) => return Err(e),
    }
    drop(api_lock);
    Ok(())
}

/// Ported inline from `bun.bun_js.failWithBuildError` to avoid the
/// `bun_runtime → bun (binary)` dep cycle (PORTING.md §Forbidden: dep-cycle
/// fixes via fn-ptr hooks — move/port the code instead).
#[cold]
#[inline(never)]
fn fail_with_build_error(vm: &mut VirtualMachine) -> ! {
    // SAFETY: vm.log is the process-lifetime ctx.log set in build_command.
    if let Some(log) = vm.log {
        let _ = unsafe { log.as_ref() }.print(Output::error_writer());
    }
    Global::exit(1);
}

pub fn write_sourcemap_to_disk(
    file: &OutputFile,
    bundled_outputs: &[OutputFile],
    source_maps: &mut StringArrayHashMap<OutputFileIndex>,
) -> Result<(), bun_core::Error> {
    // don't call this if the file does not have sourcemaps!
    debug_assert!(file.source_map_index != u32::MAX);

    // TODO: should we just write the sourcemaps to disk?
    let source_map_index = file.source_map_index;
    let source_map_file: &OutputFile = &bundled_outputs[source_map_index as usize];
    debug_assert!(source_map_file.output_kind == OutputKind::Sourcemap);

    let without_prefix = if strings::has_prefix(&file.dest_path, b"./")
        || (cfg!(windows) && strings::has_prefix(&file.dest_path, b".\\"))
    {
        &file.dest_path[2..]
    } else {
        &file.dest_path[..]
    };

    let mut key = Vec::with_capacity(6 + without_prefix.len());
    write!(&mut key, "bake:/{}", BStr::new(without_prefix)).unwrap();
    source_maps.put(
        key.into_boxed_slice(),
        OutputFileIndex(u32::try_from(source_map_index).unwrap()),
    )?;
    Ok(())
}

pub fn build_with_vm(
    ctx: Context,
    cwd: &[u8],
    vm_ptr: *mut VirtualMachine,
    pt: &mut PerThread,
) -> Result<(), bun_core::Error> {
    // SAFETY: vm_ptr is the live per-thread VM passed from build_command;
    // exclusive access on this thread for the duration of the call.
    let vm = unsafe { &mut *vm_ptr };
    // Load and evaluate the configuration module
    // SAFETY: vm.global is set in init_bake and live for VM lifetime.
    let global = unsafe { &*vm.global };
    // allocator = bun.default_allocator — dropped per §Allocators

    bun_core::pretty_errorln!("Loading configuration");
    Output::flush();
    let mut unresolved_config_entry_point: Vec<u8> = if !ctx.args.entry_points.is_empty() {
        ctx.args.entry_points[0].as_ref().to_vec()
    } else {
        b"./bun.app".to_vec()
    };
    if resolver::is_package_path(&unresolved_config_entry_point) {
        let mut prefixed = Vec::with_capacity(2 + unresolved_config_entry_point.len());
        prefixed.extend_from_slice(b"./");
        prefixed.extend_from_slice(&unresolved_config_entry_point);
        unresolved_config_entry_point = prefixed;
    }

    let config_entry_point = match vm.transpiler.resolver.resolve(
        cwd,
        &unresolved_config_entry_point,
        bun_options_types::ImportKind::EntryPointBuild,
    ) {
        Ok(r) => r,
        Err(err) => {
            if err == bun_core::err!("ModuleNotFound") {
                if ctx.args.entry_points.is_empty() {
                    // Onboarding message
                    Output::err(
                        err,
                        "'bun build --app' cannot find your application's config file\n\
                         \n\
                         The default location for this is `bun.app.ts`\n\
                         \n\
                         TODO: insert a link to `bun.com/docs`",
                        (),
                    );
                    Global::crash();
                }
            }

            Output::err(
                err,
                "could not resolve application config file '{}'",
                (BStr::new(&unresolved_config_entry_point),),
            );
            Global::crash();
        }
    };

    let config_entry_point_string =
        BunString::clone_utf8(config_entry_point.path_const().unwrap().text);
    // defer config_entry_point_string.deref() — Drop handles deref

    let Some(config_promise) =
        JSModuleLoader::load_and_evaluate_module(global, &config_entry_point_string)
    else {
        debug_assert!(global.has_exception());
        return Err(bun_core::err!("JSError"));
    };

    config_promise.set_handled();
    vm.wait_for_promise(AnyPromise::Internal(config_promise));
    // SAFETY: vm.jsc_vm is live.
    let jsc_vm = unsafe { &mut *vm.jsc_vm };
    let mut options = match config_promise.unwrap(jsc_vm, UnwrapMode::MarkHandled) {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => {
            // SAFETY: FFI; global is live, key is a stack-held JSValue.
            let default = unsafe {
                BakeGetDefaultExportFromModule(
                    vm.global,
                    config_entry_point_string.to_js(global)?,
                )
            };

            if !default.is_object() {
                return Err(global
                    .throw_invalid_arguments(format_args!(
                        "Your config file's default export must be an object.\n\
                         \n\
                         Example:\n\
                         {}export default {{\n\
                         {}{}app: {{\n\
                         {}{}{}framework: \"react\",\n\
                         {}{}}}\n\
                         {}}}\n\
                         \n\
                         Learn more at https://bun.com/docs/ssg",
                        "  ", "  ", "  ", "  ", "  ", "  ", "  ", "  ", "  "
                    ))
                    .into());
            }

            let Some(app) = default.get(global, "app")? else {
                return Err(global
                    .throw_invalid_arguments(format_args!(
                        "Your config file's default export must contain an \"app\" property.\n\
                         \n\
                         Example:\n\
                         {}export default {{\n\
                         {}{}app: {{\n\
                         {}{}{}framework: \"react\",\n\
                         {}{}}}\n\
                         {}}}\n\
                         \n\
                         Learn more at https://bun.com/docs/ssg",
                        "  ", "  ", "  ", "  ", "  ", "  ", "  ", "  ", "  "
                    ))
                    .into());
            };

            bake_body::UserOptions::from_js(app, global)?
        }
        Unwrapped::Rejected(err) => {
            return Err(global.throw_value(err.to_error().unwrap_or(err)).into());
        }
    };

    let framework = &mut options.framework;

    let separate_ssr_graph = framework
        .server_components
        .as_ref()
        .map(|sc| sc.separate_ssr_graph)
        .unwrap_or(false);

    // this is probably wrong
    let map = Box::leak(Box::new(dotenv::Map::init()));
    let loader = Box::leak(Box::new(dotenv::Loader::init(map)));
    loader.map.put(b"NODE_ENV", b"production")?;
    // PORT NOTE: process-lifetime singleton; `Box::leak` is the OnceLock-equivalent
    // here (matches Zig's `bun.DotEnv.instance = loader;` which never frees).
    dotenv::set_instance(loader as *mut dotenv::Loader<'static>);

    // TODO(port): Zig used `var x: Transpiler = undefined;` + out-param init.
    // PORTING.md §Exception — out-param constructors: reshape to a returned
    // value once `init_transpiler_with_options` is reshaped; for now use
    // `MaybeUninit` to mirror the in-place-init contract.
    let mut client_transpiler = core::mem::MaybeUninit::<Transpiler>::uninit();
    let mut server_transpiler = core::mem::MaybeUninit::<Transpiler>::uninit();
    let mut ssr_transpiler = core::mem::MaybeUninit::<Transpiler>::uninit();
    // SAFETY: vm.log is set from ctx.log (non-null process-lifetime).
    let vm_log = unsafe { vm.log.unwrap().as_mut() };
    framework.init_transpiler_with_options(
        &options.arena,
        vm_log,
        bake::Mode::ProductionStatic,
        bake::Graph::Server,
        // SAFETY: out-param; init_transpiler_with_options writes the full struct.
        unsafe { &mut *server_transpiler.as_mut_ptr() },
        &options.bundler_options.server,
        SourceMapOption::from_api(Some(options.bundler_options.server.source_map)),
        options.bundler_options.server.minify_whitespace,
        options.bundler_options.server.minify_syntax,
        options.bundler_options.server.minify_identifiers,
    )?;
    framework.init_transpiler_with_options(
        &options.arena,
        vm_log,
        bake::Mode::ProductionStatic,
        bake::Graph::Client,
        // SAFETY: out-param; init_transpiler_with_options writes the full struct.
        unsafe { &mut *client_transpiler.as_mut_ptr() },
        &options.bundler_options.client,
        SourceMapOption::from_api(Some(options.bundler_options.client.source_map)),
        options.bundler_options.client.minify_whitespace,
        options.bundler_options.client.minify_syntax,
        options.bundler_options.client.minify_identifiers,
    )?;
    if separate_ssr_graph {
        framework.init_transpiler_with_options(
            &options.arena,
            vm_log,
            bake::Mode::ProductionStatic,
            bake::Graph::Ssr,
            // SAFETY: out-param; init_transpiler_with_options writes the full struct.
            unsafe { &mut *ssr_transpiler.as_mut_ptr() },
            &options.bundler_options.ssr,
            SourceMapOption::from_api(Some(options.bundler_options.ssr.source_map)),
            options.bundler_options.ssr.minify_whitespace,
            options.bundler_options.ssr.minify_syntax,
            options.bundler_options.ssr.minify_identifiers,
        )?;
    }
    // SAFETY: written above by init_transpiler_with_options.
    let server_transpiler = unsafe { server_transpiler.assume_init_mut() };
    // SAFETY: written above by init_transpiler_with_options.
    let client_transpiler = unsafe { client_transpiler.assume_init_mut() };
    // SAFETY: only read when separate_ssr_graph (initialized above).
    let ssr_transpiler = unsafe { ssr_transpiler.assume_init_mut() };

    if ctx.bundler_options.bake_debug_disable_minify {
        for transpiler in [&mut *client_transpiler, &mut *server_transpiler, &mut *ssr_transpiler] {
            transpiler.options.minify_syntax = false;
            transpiler.options.minify_identifiers = false;
            transpiler.options.minify_whitespace = false;
            transpiler.resolver.opts.entry_naming =
                Box::from(b"_bun/[dir]/[name].[hash].[ext]".as_slice());
            transpiler.resolver.opts.chunk_naming =
                Box::from(b"_bun/[dir]/[name].[hash].chunk.[ext]".as_slice());
            transpiler.resolver.opts.asset_naming =
                Box::from(b"_bun/[dir]/[name].[hash].asset.[ext]".as_slice());
        }
    }

    // these share pointers right now, so setting NODE_ENV == production on one should affect all
    debug_assert!(core::ptr::eq(server_transpiler.env, client_transpiler.env));

    *framework = match framework.resolve(
        &mut server_transpiler.resolver,
        &mut client_transpiler.resolver,
        &options.arena,
    ) {
        Ok(f) => f,
        Err(_) => {
            if framework.is_built_in_react {
                bake_body::Framework::add_react_install_command_note(server_transpiler.log)?;
            }
            bun_core::err_generic!("Failed to resolve all imports required by the framework");
            Output::flush();
            let _ = server_transpiler.log.print(Output::error_writer());
            Global::crash();
        }
    };

    bun_core::pretty_errorln!("Bundling routes");
    Output::flush();

    // trailing slash
    let public_path: &[u8] = b"/";

    let mut root_dir_buf = PathBuffer::uninit();
    let root_dir_path = resolve_path::join_abs_string_buf::<platform::Auto>(
        cwd,
        root_dir_buf.as_mut_slice(),
        &[b"dist"],
    );
    // PORT NOTE: reshaped for borrowck — copy out so root_dir_buf can drop.
    let root_dir_path: Box<[u8]> = Box::from(root_dir_path);

    let mut router_types: Vec<fr::Type> =
        Vec::with_capacity(options.framework.file_system_router_types.len());

    let mut entry_points: EntryPointMap = EntryPointMap {
        root: Box::from(cwd),
        files: EntryPointHashMap::default(),
        owned_paths: Vec::new(),
    };

    for fsr in &options.framework.file_system_router_types {
        let joined_root = resolve_path::join_abs::<platform::Auto>(cwd, fsr.root);
        let Some(entry) = server_transpiler
            .resolver
            .read_dir_info_ignore_error(joined_root)
        else {
            continue;
        };
        // SAFETY: read_dir_info_ignore_error returns a *const DirInfo into the
        // resolver's cache, which outlives this loop body.
        let entry = unsafe { &*entry };
        // PORT NOTE: `fr::OpaqueFileId` and `framework_router::OpaqueFileId` are
        // structurally identical newtypes split across the stub/draft; convert
        // by `.get()` round-trip until Phase B unifies.
        let server_file = entry_points
            .get_or_put_entry_point(fsr.entry_server, bake::Side::Server)?;
        let client_file = if let Some(client) = fsr.entry_client {
            Some(entry_points.get_or_put_entry_point(client, bake::Side::Client)?)
        } else {
            None
        };
        router_types.push(fr::Type {
            abs_root: Box::from(strings::paths::without_trailing_slash_windows_path(
                entry.abs_path.as_bytes(),
            )),
            prefix: Box::from(fsr.prefix),
            ignore_underscores: fsr.ignore_underscores,
            ignore_dirs: fsr
                .ignore_dirs
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
            extensions: fsr
                .extensions
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
            style: fsr.style,
            allow_layouts: fsr.allow_layouts,
            server_file: fr::OpaqueFileId::init(server_file.get()),
            client_file: client_file.map(|f| fr::OpaqueFileId::init(f.get())),
            server_file_string: bun_jsc::Strong::empty(),
        });
    }

    let mut router = fr::FrameworkRouter::init_empty(cwd, router_types.into_boxed_slice())?;
    router.scan_all(
        &mut server_transpiler.resolver,
        framework_router::InsertionContext::wrap(&mut entry_points),
    )?;

    let bundled_outputs_list = BundleV2::generate_from_bake_production_cli(
        entry_points,
        server_transpiler,
        bun_bundler::bundle_v2::BakeOptions {
            framework: framework.clone(),
            client_transpiler: NonNull::from(&mut *client_transpiler),
            ssr_transpiler: if separate_ssr_graph {
                NonNull::from(&mut *ssr_transpiler)
            } else {
                NonNull::from(&mut *server_transpiler)
            },
            plugins: options.bundler_options.plugin,
        },
        &options.arena,
        // SAFETY: vm.event_loop() returns a self-ptr; unique access here.
        bun_bundler::EventLoop::Js(unsafe { &*vm.event_loop() }),
    )?;
    let bundled_outputs = bundled_outputs_list.as_slice();
    if bundled_outputs.is_empty() {
        bun_core::prettyln!("done");
        Output::flush();
        return Ok(());
    }

    bun_core::pretty_errorln!("Rendering routes");
    Output::flush();

    // Zig: `try std.fs.cwd().makeOpenPath("dist", .{})` — mkdir -p + open.
    let root_dir = bun_sys::Dir::cwd().make_open_path(b"dist", Default::default())?;
    let _root_dir_guard = scopeguard::guard((), |_| {
        let _ = root_dir.close();
    });

    let mut maybe_runtime_file_index: Option<u32> = None;

    let mut css_chunks_count: usize = 0;
    let mut css_chunks_first: usize = 0;

    // Index all bundled outputs.
    // Client files go to disk.
    // Server files get loaded in memory.
    // Populate indexes in `entry_points` to be looked up during prerendering
    let mut module_keys: Vec<BunString> =
        vec![BunString::dead(); entry_points.files.count()];
    let output_indexes = entry_points.files.values_mut();
    let mut output_module_map: StringArrayHashMap<OutputFileIndex> = StringArrayHashMap::default();
    let mut source_maps: StringArrayHashMap<OutputFileIndex> = StringArrayHashMap::default();
    for (i, file) in bundled_outputs.iter().enumerate() {
        log!(
            "src_index={:?} side={} src={} dest={} - {:?}\n",
            file.source_index,
            file.side
                .map(|s| <&'static str>::from(s))
                .unwrap_or("null"),
            BStr::new(&file.src_path.text),
            BStr::new(&file.dest_path),
            file.entry_point_index,
        );
        if file.loader.is_css() {
            if css_chunks_count == 0 {
                css_chunks_first = i;
            } else {
                css_chunks_first = css_chunks_first.min(i);
            }
            css_chunks_count += 1;
        }

        if let Some(entry_point) = file.entry_point_index {
            if (entry_point as usize) < output_indexes.len() {
                output_indexes[entry_point as usize] =
                    OutputFileIndex(u32::try_from(i).unwrap());
            }
        }

        // The output file which contains the runtime (Index.runtime, contains
        // wrapper functions like `__esm`) is marked as server side, but it is
        // also used by client
        if file.bake_extra.bake_is_runtime {
            if cfg!(debug_assertions) {
                debug_assert!(
                    maybe_runtime_file_index.is_none(),
                    "Runtime file should only be in one chunk."
                );
            }
            maybe_runtime_file_index = Some(u32::try_from(i).unwrap());
        }

        // TODO: Maybe not do all the disk-writing in 1 thread?
        let Some(side) = file.side else { continue };
        match side {
            bake::Side::Client => {
                // Client-side resources will be written to disk for usage on the client side
                if let Err(err) = file.write_to_disk(root_dir, b".") {
                    bun_crash_handler::handle_error_return_trace(err, None);
                    Output::err(
                        err,
                        "Failed to write {} to output directory",
                        (bun_core::fmt::quote(&file.dest_path),),
                    );
                }
            }
            bake::Side::Server => {
                if ctx.bundler_options.bake_debug_dump_server {
                    if let Err(err) = file.write_to_disk(root_dir, b".") {
                        bun_crash_handler::handle_error_return_trace(err, None);
                        Output::err(
                            err,
                            "Failed to write {} to output directory",
                            (bun_core::fmt::quote(&file.dest_path),),
                        );
                    }
                }

                // If the file has a sourcemap, store it so we can put it on
                // `PerThread` so we can provide sourcemapped stacktraces for
                // server components.
                if file.source_map_index != u32::MAX {
                    write_sourcemap_to_disk(file, bundled_outputs, &mut source_maps)?;
                }

                match file.output_kind {
                    OutputKind::EntryPoint | OutputKind::Chunk => {
                        let without_prefix = if strings::has_prefix(&file.dest_path, b"./")
                            || (cfg!(windows) && strings::has_prefix(&file.dest_path, b".\\"))
                        {
                            &file.dest_path[2..]
                        } else {
                            &file.dest_path[..]
                        };

                        if let Some(entry_point_index) = file.entry_point_index {
                            if (entry_point_index as usize) < module_keys.len() {
                                let mut str = BunString::create_format(format_args!(
                                    "bake:/{}",
                                    BStr::new(without_prefix)
                                ));
                                str.to_thread_safe();
                                module_keys[entry_point_index as usize] = str;
                            }
                        }

                        log!(
                            "  adding module map entry: output_module_map(bake:/{}) = {}\n",
                            BStr::new(without_prefix),
                            i
                        );

                        let mut key = Vec::with_capacity(6 + without_prefix.len());
                        write!(&mut key, "bake:/{}", BStr::new(without_prefix)).unwrap();
                        output_module_map.put(
                            key.into_boxed_slice(),
                            OutputFileIndex(u32::try_from(i).unwrap()),
                        )?;
                    }
                    OutputKind::Asset => {}
                    OutputKind::Bytecode => {}
                    OutputKind::Sourcemap => {}
                    OutputKind::ModuleInfo => {}
                    OutputKind::MetafileJson | OutputKind::MetafileMarkdown => {}
                }
            }
        }

        // TODO: should we just write the sourcemaps to disk?
        if file.source_map_index != u32::MAX {
            write_sourcemap_to_disk(file, bundled_outputs, &mut source_maps)?;
        }
    }
    // Write the runtime file to disk if there are any client chunks
    {
        let Some(runtime_file_index) = maybe_runtime_file_index else {
            Output::panic(format_args!(
                "Runtime file not found. This is an unexpected bug in Bun. Please file a bug report on GitHub."
            ));
        };
        let any_client_chunks = 'any_client_chunks: {
            for file in bundled_outputs {
                if let Some(s) = file.side {
                    if s == bake::Side::Client
                        && file.src_path.text.as_ref() != b"bun-framework-react/client.tsx"
                    {
                        break 'any_client_chunks true;
                    }
                }
            }
            break 'any_client_chunks false;
        };
        if any_client_chunks {
            let runtime_file: &OutputFile = &bundled_outputs[runtime_file_index as usize];
            if let Err(err) = runtime_file.write_to_disk(root_dir, b".") {
                bun_crash_handler::handle_error_return_trace(err, None);
                Output::err(
                    err,
                    "Failed to write {} to output directory",
                    (bun_core::fmt::quote(&runtime_file.dest_path),),
                );
            }
        }
    }

    let per_thread_options: PerThreadOptions = PerThreadOptions {
        input_files: entry_points.files.keys(),
        bundled_outputs,
        output_indexes,
        module_keys: &module_keys,
        module_map: output_module_map,
        source_maps,
    };

    *pt = PerThread::init(vm_ptr, per_thread_options)?;
    pt.attach();

    // Static site generator
    let server_render_funcs = JSValue::create_empty_array(global, router.types.len())?;
    let server_param_funcs = JSValue::create_empty_array(global, router.types.len())?;
    let client_entry_urls = JSValue::create_empty_array(global, router.types.len())?;

    for (i, router_type) in router.types.iter().enumerate() {
        if let Some(client_file) = router_type.client_file {
            let client_file = OpaqueFileId::init(client_file.get());
            let str = BunString::create_format(format_args!(
                "{}{}",
                BStr::new(public_path),
                BStr::new(&pt.output_file(client_file).dest_path),
            ))
            .to_js(global)?;
            client_entry_urls.put_index(global, u32::try_from(i).unwrap(), str)?;
        } else {
            client_entry_urls.put_index(global, u32::try_from(i).unwrap(), JSValue::NULL)?;
        }

        let server_file = OpaqueFileId::init(router_type.server_file.get());
        let server_entry_point = pt.load_bundled_module(server_file)?;
        let server_render_func = 'brk: {
            let Some(raw) = bake_get_on_module_namespace(global, server_entry_point, b"prerender")
            else {
                break 'brk None;
            };
            if !raw.is_callable() {
                break 'brk None;
            }
            break 'brk Some(raw);
        };
        let Some(server_render_func) = server_render_func else {
            bun_core::err_generic!("Framework does not support static site generation");
            bun_core::note!(
                "The file {} is missing the \"prerender\" export, which defines how to generate static files.",
                bun_core::fmt::quote(resolve_path::relative(
                    cwd,
                    entry_points.files.keys()[server_file.get() as usize].abs_path()
                ))
            );
            Global::crash();
        };

        let server_param_func = if router.dynamic_routes.count() > 0 {
            let f = 'brk: {
                let Some(raw) =
                    bake_get_on_module_namespace(global, server_entry_point, b"getParams")
                else {
                    break 'brk None;
                };
                if !raw.is_callable() {
                    break 'brk None;
                }
                break 'brk Some(raw);
            };
            match f {
                Some(f) => f,
                None => {
                    bun_core::err_generic!("Framework does not support static site generation");
                    bun_core::note!(
                        "The file {} is missing the \"getParams\" export, which defines how to generate static files.",
                        bun_core::fmt::quote(resolve_path::relative(
                            cwd,
                            entry_points.files.keys()[server_file.get() as usize].abs_path()
                        ))
                    );
                    Global::crash();
                }
            }
        } else {
            JSValue::NULL
        };
        server_render_funcs.put_index(global, u32::try_from(i).unwrap(), server_render_func)?;
        server_param_funcs.put_index(global, u32::try_from(i).unwrap(), server_param_func)?;
    }

    let mut navigatable_routes: Vec<fr::RouteIndex> = Vec::new();
    for (i, route) in router.routes.iter().enumerate() {
        if route.file_page.is_none() {
            continue;
        }
        navigatable_routes.push(fr::RouteIndex::init(u32::try_from(i).unwrap()));
    }

    let mut css_chunk_js_strings: Vec<JSValue> = vec![JSValue::ZERO; css_chunks_count];
    debug_assert_eq!(
        bundled_outputs[css_chunks_first..][..css_chunks_count].len(),
        css_chunk_js_strings.len()
    );
    for (output_file, str) in bundled_outputs[css_chunks_first..][..css_chunks_count]
        .iter()
        .zip(css_chunk_js_strings.iter_mut())
    {
        debug_assert!(output_file.dest_path[0] != b'.');
        // CSS chunks must be in contiguous order!!
        debug_assert!(output_file.loader.is_css());
        *str = BunString::create_format(format_args!(
            "{}{}",
            BStr::new(public_path),
            BStr::new(&output_file.dest_path),
        ))
        .to_js(global)?;
    }

    // Route URL patterns with parameter placeholders.
    // Examples: "/", "/about", "/blog/:slug", "/products/:category/:id"
    let route_patterns = JSValue::create_empty_array(global, navigatable_routes.len())?;

    // File indices for each route's components (page, layouts).
    // Example: [2, 5, 0] = page at index 2, layout at 5, root layout at 0
    let route_nested_files = JSValue::create_empty_array(global, navigatable_routes.len())?;

    // Router type index (lower 8 bits) and flags (upper 24 bits).
    // Example: 0x00000001 = router type 1, no flags
    let route_type_and_flags = JSValue::create_empty_array(global, navigatable_routes.len())?;

    // Source file paths relative to project root.
    // Examples: "pages/index.tsx", "pages/blog/[slug].tsx"
    let route_source_files = JSValue::create_empty_array(global, navigatable_routes.len())?;

    // Parameter names for dynamic routes (reversed order), null for static routes.
    // Examples: ["slug"] for /blog/[slug], ["id", "category"] for /products/[category]/[id]
    let route_param_info = JSValue::create_empty_array(global, navigatable_routes.len())?;

    // CSS chunk URLs for each route.
    // Example: ["/assets/main.css", "/assets/blog.css"]
    let route_style_references = JSValue::create_empty_array(global, navigatable_routes.len())?;

    let mut params_buf: Vec<&[u8]> = Vec::new();
    for (nav_index, &route_index) in navigatable_routes.iter().enumerate() {
        // defer params_buf.clearRetainingCapacity()
        let _params_guard = scopeguard::guard(&mut params_buf, |b| b.clear());
        let params_buf = &mut **_params_guard;

        let mut pattern = PatternBuffer::EMPTY;

        let route = router.route_ptr(route_index);
        // PORT NOTE: `fr::OpaqueFileId` ↔ `framework_router::OpaqueFileId`
        // round-trip (see Type construction above).
        let main_file_route_index = OpaqueFileId::init(route.file_page.unwrap().get());
        let main_file = pt.output_file(main_file_route_index);

        // Count how many JS+CSS files associated with this route and prepare `pattern`
        pattern.prepend_part(route.part);
        match route.part {
            fr::Part::Param(name) => {
                params_buf.push(name);
            }
            fr::Part::CatchAll(name) => {
                params_buf.push(name);
            }
            fr::Part::CatchAllOptional(_) => {
                return Err(global
                    .throw(
                        "catch-all routes are not supported in static site generation",
                        format_args!(""),
                    )
                    .into());
            }
            _ => {}
        }
        let mut file_count: u32 = 1;
        let mut css_file_count: u32 =
            u32::try_from(main_file.referenced_css_chunks.len()).unwrap();
        if let Some(file) = route.file_layout {
            let file = OpaqueFileId::init(file.get());
            css_file_count +=
                u32::try_from(pt.output_file(file).referenced_css_chunks.len()).unwrap();
            file_count += 1;
        }
        let mut next: Option<fr::RouteIndex> = route.parent;
        while let Some(parent_index) = next {
            let parent = router.route_ptr(parent_index);
            pattern.prepend_part(parent.part);
            match parent.part {
                fr::Part::Param(name) => {
                    params_buf.push(name);
                }
                fr::Part::CatchAll(name) => {
                    params_buf.push(name);
                }
                fr::Part::CatchAllOptional(_) => {
                    return Err(global
                        .throw(
                            "catch-all routes are not supported in static site generation",
                            format_args!(""),
                        )
                        .into());
                }
                _ => {}
            }
            if let Some(file) = parent.file_layout {
                let file = OpaqueFileId::init(file.get());
                css_file_count +=
                    u32::try_from(pt.output_file(file).referenced_css_chunks.len()).unwrap();
                file_count += 1;
            }
            next = parent.parent;
        }

        // Fill styles and file_list
        let styles = JSValue::create_empty_array(global, css_chunks_count)?;
        let file_list = JSValue::create_empty_array(global, file_count as usize)?;

        next = route.parent;
        file_count = 1;
        css_file_count = 0;
        file_list.put_index(global, 0, pt.preload_bundled_module(main_file_route_index)?)?;
        for r#ref in main_file.referenced_css_chunks.iter() {
            styles.put_index(
                global,
                css_file_count,
                css_chunk_js_strings[r#ref.0 as usize - css_chunks_first],
            )?;
            css_file_count += 1;
        }
        if let Some(file) = route.file_layout {
            let file = OpaqueFileId::init(file.get());
            file_list.put_index(global, file_count, pt.preload_bundled_module(file)?)?;
            for r#ref in pt.output_file(file).referenced_css_chunks.iter() {
                styles.put_index(
                    global,
                    css_file_count,
                    css_chunk_js_strings[r#ref.0 as usize - css_chunks_first],
                )?;
                css_file_count += 1;
            }
            file_count += 1;
        }

        while let Some(parent_index) = next {
            let parent = router.route_ptr(parent_index);
            if let Some(file) = parent.file_layout {
                let file = OpaqueFileId::init(file.get());
                file_list.put_index(global, file_count, pt.preload_bundled_module(file)?)?;
                for r#ref in pt.output_file(file).referenced_css_chunks.iter() {
                    styles.put_index(
                        global,
                        css_file_count,
                        css_chunk_js_strings[r#ref.0 as usize - css_chunks_first],
                    )?;
                    css_file_count += 1;
                }
                file_count += 1;
            }
            next = parent.parent;
        }

        // Init the items
        let pattern_string = BunString::clone_utf8(pattern.slice());
        // defer pattern_string.deref() — Drop handles deref
        route_patterns.put_index(
            global,
            u32::try_from(nav_index).unwrap(),
            pattern_string.to_js(global)?,
        )?;

        let mut src_path = BunString::clone_utf8(resolve_path::relative(
            cwd,
            pt.input_file(main_file_route_index).abs_path(),
        ));
        route_source_files.put_index(
            global,
            u32::try_from(nav_index).unwrap(),
            jsc::bun_string_jsc::transfer_to_js(&mut src_path, global)?,
        )?;

        route_nested_files.put_index(global, u32::try_from(nav_index).unwrap(), file_list)?;
        route_type_and_flags.put_index(
            global,
            u32::try_from(nav_index).unwrap(),
            JSValue::js_number_from_int32(
                TypeAndFlags::new(route.r#type.get(), main_file.bake_extra.fully_static).bits(),
            ),
        )?;

        if !params_buf.is_empty() {
            let param_info_array = JSValue::create_empty_array(global, params_buf.len())?;
            for (i, param) in params_buf.iter().enumerate() {
                param_info_array.put_index(
                    global,
                    u32::try_from(params_buf.len() - i - 1).unwrap(),
                    jsc::bun_string_jsc::create_utf8_for_js(global, param)?,
                )?;
            }
            route_param_info.put_index(
                global,
                u32::try_from(nav_index).unwrap(),
                param_info_array,
            )?;
        } else {
            route_param_info.put_index(global, u32::try_from(nav_index).unwrap(), JSValue::NULL)?;
        }
        route_style_references.put_index(global, u32::try_from(nav_index).unwrap(), styles)?;
    }

    // SAFETY: FFI; all JSValue args are stack-held; global is live.
    let render_promise = unsafe {
        &mut *BakeRenderRoutesForProdStatic(
            global,
            BunString::init(&*root_dir_path),
            pt.all_server_files.get(),
            server_render_funcs,
            server_param_funcs,
            client_entry_urls,
            route_patterns,
            route_nested_files,
            route_type_and_flags,
            route_source_files,
            route_param_info,
            route_style_references,
        )
    };
    render_promise.set_handled();
    vm.wait_for_promise(AnyPromise::Normal(render_promise));
    // SAFETY: vm.jsc_vm is live.
    let jsc_vm = unsafe { &mut *vm.jsc_vm };
    match render_promise.unwrap(jsc_vm, UnwrapMode::MarkHandled) {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => {
            bun_core::prettyln!("done");
            Output::flush();
        }
        Unwrapped::Rejected(err) => {
            return Err(global.throw_value(err).into());
        }
    }
    vm.wait_for_tasks();
    Ok(())
}

/// unsafe function, must be run outside of the event loop
/// quits the process on exception
fn load_module(
    vm: *mut VirtualMachine,
    global: &JSGlobalObject,
    key: JSValue,
) -> Result<JSValue, bun_core::Error> {
    // SAFETY: FFI call; `global` is a live &JSGlobalObject and `key` is a JSValue
    // held on the stack for the duration of the call.
    let promise_value = unsafe { BakeLoadModuleByKey(global, key) };
    let promise = match promise_value.as_any_promise().unwrap() {
        AnyPromise::Internal(p) => p,
        AnyPromise::Normal(_) => unreachable!(),
    };
    promise.set_handled();
    // PORT NOTE: Zig's `*VirtualMachine` is a freely-aliasing mutable pointer.
    // We take `*mut VirtualMachine` (not `&VirtualMachine`) so the provenance
    // permits mutation — casting a `&T` to `*mut T` and writing through it is
    // UB. The raw pointer flows from `VirtualMachine::init_bake` unchanged.
    //
    // SAFETY: `vm` is the unique live VM on this thread; no overlapping &mut.
    unsafe { (*vm).wait_for_promise(AnyPromise::Internal(promise)) };
    // TODO: Specially draining microtasks here because `waitForPromise` has a
    //       bug which forgets to do it, but I don't want to fix it right now as it
    //       could affect a lot of the codebase. This should be removed.
    // SAFETY: see above; event_loop() returns a self-ptr.
    if unsafe { (*(*vm).event_loop()).drain_microtasks() }.is_err() {
        Global::crash();
    }
    // SAFETY: vm is the live per-thread VM; jsc_vm is live for VM lifetime.
    let jsc_vm = unsafe { &mut *(*vm).jsc_vm };
    match promise.unwrap(jsc_vm, UnwrapMode::MarkHandled) {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => {
            // SAFETY: FFI; global live, key stack-held.
            Ok(unsafe { BakeGetModuleNamespace(global, key) })
        }
        Unwrapped::Rejected(err) => {
            // SAFETY: vm is the live per-thread VM; vm.global is live for VM lifetime.
            Err(unsafe { &*(*vm).global }.throw_value(err).into())
        }
    }
}

// extern apis:

// TODO: Dedupe
// TODO(port): move to bake_sys
unsafe extern "C" {
    fn BakeGetDefaultExportFromModule(global: *const JSGlobalObject, key: JSValue) -> JSValue;
    fn BakeGetModuleNamespace(global: *const JSGlobalObject, key: JSValue) -> JSValue;
    fn BakeLoadModuleByKey(global: *const JSGlobalObject, key: JSValue) -> JSValue;
}

fn bake_get_on_module_namespace(
    global: &JSGlobalObject,
    module: JSValue,
    property: &[u8],
) -> Option<JSValue> {
    unsafe extern "C" {
        #[link_name = "BakeGetOnModuleNamespace"]
        fn f(global: *const JSGlobalObject, module: JSValue, ptr: *const u8, len: usize) -> JSValue;
    }
    // SAFETY: FFI call; `global` is a live &JSGlobalObject, `module` is a stack-held
    // JSValue, and `property` ptr+len are valid for the call duration.
    let result: JSValue = unsafe { f(global, module, property.as_ptr(), property.len()) };
    debug_assert!(!result.is_empty());
    Some(result)
}

/// Renders all routes for static site generation by calling the JavaScript implementation.
// TODO(port): move to bake_sys
unsafe extern "C" {
    fn BakeRenderRoutesForProdStatic(
        global: *const JSGlobalObject,
        // Output directory path (e.g., "./dist")
        out_base: BunString,
        // Server module paths (e.g., ["bake://page.js", "bake://layout.js"])
        all_server_files: JSValue,
        // Framework prerender functions by router type
        render_static: JSValue,
        // Framework getParams functions by router type
        get_params: JSValue,
        // Client entry URLs by router type (e.g., ["/client.js", null])
        client_entry_urls: JSValue,
        // Route patterns (e.g., ["/", "/about", "/blog/:slug"])
        patterns: JSValue,
        // File indices per route (e.g., [[0], [1], [2, 0]])
        files: JSValue,
        // Packed router type and flags (e.g., [0x00000000, 0x00000001])
        type_and_flags: JSValue,
        // Source paths (e.g., ["pages/index.tsx", "pages/blog/[slug].tsx"])
        src_route_files: JSValue,
        // Dynamic route params (e.g., [null, null, ["slug"]])
        param_information: JSValue,
        // CSS URLs per route (e.g., [["/main.css"], ["/main.css", "/blog.css"]])
        styles: JSValue,
    ) -> *mut JSPromise;
}

/// The result of this function is a JSValue that wont be garbage collected, as
/// it will always have at least one reference by the module loader.
fn bake_register_production_chunk(
    global: &JSGlobalObject,
    key: BunString,
    source_code: BunString,
) -> JsResult<JSValue> {
    unsafe extern "C" {
        #[link_name = "BakeRegisterProductionChunk"]
        fn f(global: *const JSGlobalObject, key: BunString, source_code: BunString) -> JSValue;
    }
    // SAFETY: FFI call; `global` is a live &JSGlobalObject; `key` and `source_code`
    // are passed by value and remain valid for the call.
    let result: JSValue = unsafe { f(global, key, source_code) };
    if result.is_empty() {
        return Err(jsc::JsError::Thrown);
    }
    debug_assert!(result.is_string());
    Ok(result)
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeToWindowsPath(input: BunString) -> BunString {
    #[cfg(unix)]
    {
        let _ = input;
        panic!("This code should not be called on POSIX systems.");
    }
    #[cfg(not(unix))]
    {
        // PERF(port): was stack-fallback alloc
        let input_utf8 = input.to_utf8();
        let input_slice = input_utf8.slice();
        let mut output = bun_paths::w_path_buffer_pool::get();
        // defer bun.w_path_buffer_pool.put(output) — RAII guard puts back on Drop
        let output_slice = strings::to_w_path_normalize_auto_extend(&mut output[..], input_slice);
        BunString::clone_utf16(output_slice.as_slice())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdResolve(
    global: *const JSGlobalObject,
    a_str: BunString,
    specifier_str: BunString,
) -> BunString {
    // PERF(port): was stack-fallback alloc (2x PathBuffer)
    // SAFETY: `global` is a non-null *const JSGlobalObject passed from C++ FFI;
    // the JSGlobalObject outlives this call.
    let global = unsafe { &*global };

    let specifier = specifier_str.to_utf8();

    if let Some(alias) = bun_resolve_builtins::Alias::get(
        specifier.slice(),
        bun_resolve_builtins::Target::Bun,
        bun_resolve_builtins::Cfg::default(),
    ) {
        return BunString::static_(alias.path.as_bytes());
    }

    let referrer = a_str.to_utf8();

    if resolver::is_package_path(specifier.slice()) {
        let _ = global.throw(
            "Non-relative import {} from {} are not allowed in production assets. This is a bug in Bun's bundler",
            format_args!(
                "{} {}",
                bun_core::fmt::quote(specifier.slice()),
                bun_core::fmt::quote(referrer.slice()),
            ),
        );
        return BunString::dead();
    }

    if cfg!(debug_assertions) {
        debug_assert!(strings::has_prefix(referrer.slice(), b"bake:"));
    }

    // `bun.Dirname.dirname(u8, ...)` — std.fs.path.dirname semantics (returns
    // None for the root). Port: bun_paths Path::dirname over the posix-style
    // referrer (always "bake:/..." with forward slashes).
    let after_scheme = &referrer.slice()[5..];
    let dir = match after_scheme.iter().rposition(|&b| b == b'/') {
        // Strip trailing slash like std.fs.path.dirnamePosix does, but keep
        // "/" for the root.
        Some(0) => &after_scheme[..1],
        Some(i) => &after_scheme[..i],
        None => after_scheme,
    };

    BunString::create_format(format_args!(
        "bake:{}",
        BStr::new(resolve_path::join_abs::<platform::Posix>(
            dir,
            // force posix paths in bake
            specifier.slice(),
        ))
    ))
}

/// After a production bundle is generated, prerendering needs to be able to
/// look up the generated chunks associated with each route's `OpaqueFileId`
/// This data structure contains that mapping, and is also used by bundle_v2
/// to enqueue the entry points.
pub struct EntryPointMap {
    pub root: Box<[u8]>,

    /// OpaqueFileId refers to the index in this map.
    /// Values are left uninitialized until after the bundle is done and indexed.
    pub files: EntryPointHashMap,

    /// Owned backing storage for the duped path bytes that `InputFile` keys
    /// point into (raw ptr+len). Mirrors Zig's `map.allocator.dupe(u8, abs_path)`
    /// against `bun.default_allocator` (.zig:889) — kept here so the allocations
    /// drop with the map instead of being `Box::leak`ed (PORTING.md §Forbidden).
    pub owned_paths: Vec<Box<[u8]>>,
}

pub type EntryPointHashMap = ArrayHashMap<InputFile, OutputFileIndex>;
// TODO(port): Zig uses a custom ArrayHashContext (hash/eql) — ensure ArrayHashMap supports custom hasher matching InputFile::ArrayHashContext

/// This approach is used instead of what DevServer does so that each
/// distinct file gets its own index.
#[derive(Clone, Copy)]
pub struct InputFile {
    pub abs_path_ptr: *const u8,
    pub abs_path_len: u32,
    pub side: bake::Side,
}

impl InputFile {
    pub fn init(abs_path: &[u8], side: bake::Side) -> InputFile {
        InputFile {
            abs_path_ptr: abs_path.as_ptr(),
            abs_path_len: u32::try_from(abs_path.len()).unwrap(),
            side,
        }
    }

    pub fn abs_path(&self) -> &[u8] {
        // SAFETY: ptr+len were constructed from a valid slice in `init`
        unsafe { core::slice::from_raw_parts(self.abs_path_ptr, self.abs_path_len as usize) }
    }
}

/// Custom hash context matching Zig's `InputFile.ArrayHashContext`.
pub struct InputFileArrayHashContext;

impl InputFileArrayHashContext {
    pub fn hash(key: &InputFile) -> u32 {
        bun_wyhash::hash32(key.abs_path()).wrapping_add(key.side as u32)
    }

    pub fn eql(a: &InputFile, b: &InputFile, _: usize) -> bool {
        a.side == b.side && a.abs_path() == b.abs_path()
    }
}

impl framework_router::InsertionHandler for EntryPointMap {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: fr::RouteIndex,
        _: fr::FileKind,
    ) -> Result<fr::OpaqueFileId, bun_alloc::AllocError> {
        // PORT NOTE: `fr::OpaqueFileId` and `framework_router::OpaqueFileId` are
        // structurally identical newtypes split across the stub/draft; convert
        // by `.get()` round-trip until Phase B unifies.
        self.get_or_put_entry_point(abs_path, bake::Side::Server)
            .map(|id| fr::OpaqueFileId::init(id.get()))
            .map_err(|_| bun_alloc::AllocError)
    }

    fn on_router_syntax_error(
        &mut self,
        _rel_path: &[u8],
        _fail: fr::TinyLog,
    ) -> Result<(), bun_alloc::AllocError> {
        // PORT NOTE: Zig's `wrap()` only fills vtable slots for decls that exist
        // on the wrapped type; `EntryPointMap` doesn't define
        // `on_router_syntax_error`, so the slot was null and never invoked.
        Ok(())
    }

    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: fr::OpaqueFileId,
        ty: fr::FileKind,
    ) -> Result<(), bun_alloc::AllocError> {
        EntryPointMap::on_router_collision_error(self, rel_path, other_id, ty)
    }
}

impl EntryPointMap {
    pub fn get_or_put_entry_point(
        &mut self,
        abs_path: &[u8],
        side: bake::Side,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        let k = InputFile::init(abs_path, side);
        let gop = self.files.get_or_put(k)?;
        let index = gop.index;
        if !gop.found_existing {
            // Zig: `gop.key_ptr.* = InputFile.init(try map.allocator.dupe(u8, abs_path), side);`
            // The Zig `errdefer map.files.swapRemoveAt(gop.index)` only guards the
            // `allocator.dupe`, which is infallible in Rust, so no rollback guard
            // is needed. Own the duped bytes in `owned_paths` (Box heap address is
            // stable across the move) instead of `Box::leak` so they drop with the
            // map — PORTING.md §Forbidden bans `Box::leak` for `'static` borrows.
            let owned: Box<[u8]> = Box::<[u8]>::from(abs_path);
            *gop.key_ptr = InputFile::init(&owned, side);
            self.owned_paths.push(owned);
        }
        Ok(OpaqueFileId::init(u32::try_from(index).unwrap()))
    }

    pub fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: framework_router::RouteIndex,
        _: framework_router::FileKind,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        self.get_or_put_entry_point(abs_path, bake::Side::Server)
    }

    pub fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: fr::OpaqueFileId,
        ty: fr::FileKind,
    ) -> Result<(), bun_alloc::AllocError> {
        bun_core::err_generic!(
            "Multiple {} matching the same route pattern is ambiguous",
            match ty {
                fr::FileKind::Page => "pages",
                fr::FileKind::Layout => "layout",
            }
        );
        bun_core::pretty_errorln!("  - <blue>{}<r>", BStr::new(rel_path));
        bun_core::pretty_errorln!(
            "  - <blue>{}<r>",
            BStr::new(resolve_path::relative(
                &self.root,
                self.files.keys()[other_id.get() as usize].abs_path()
            ))
        );
        Output::flush();
        Ok(())
    }
}

/// Data used on each rendering thread. Contains all information in the bundle needed to render.
/// This is referred to as `pt` in variable/field naming, and Bake::ProductionPerThread in C++
pub struct PerThread<'a> {
    // Shared Data
    pub input_files: &'a [InputFile],
    pub bundled_outputs: &'a [OutputFile],
    /// Indexed by entry point index (OpaqueFileId)
    pub output_indexes: &'a [OutputFileIndex],
    /// Indexed by entry point index (OpaqueFileId)
    pub module_keys: &'a [BunString],
    /// Unordered
    pub module_map: StringArrayHashMap<OutputFileIndex>,
    pub source_maps: StringArrayHashMap<OutputFileIndex>,

    // Thread-local
    // PORT NOTE: Zig's `vm: *jsc.VirtualMachine` is a freely-aliasing mutable
    // pointer. Stored as `*mut` (not `&'a VirtualMachine`) so callers like
    // `load_module` can mutate through it without a `&T as *mut T` cast (UB).
    pub vm: *mut VirtualMachine,
    /// Indexed by entry point index (OpaqueFileId)
    pub loaded_files: AutoBitSet,
    /// JSArray of JSString, indexed by entry point index (OpaqueFileId)
    // Zig protects/unprotects this manually; PORTING.md mandates Strong for
    // JSValue struct fields. Strong's Drop releases the GC root.
    pub all_server_files: bun_jsc::Strong,
}

/// Sent to other threads for rendering
// PORT NOTE: Zig declares this as `PerThread.Options`; Rust cannot nest a struct
// inside an `impl`, so it's hoisted as a sibling type.
pub struct PerThreadOptions<'a> {
    pub input_files: &'a [InputFile],
    pub bundled_outputs: &'a [OutputFile],
    /// Indexed by entry point index (OpaqueFileId)
    pub output_indexes: &'a [OutputFileIndex],
    /// Indexed by entry point index (OpaqueFileId)
    pub module_keys: &'a [BunString],
    /// Unordered
    pub module_map: StringArrayHashMap<OutputFileIndex>,
    pub source_maps: StringArrayHashMap<OutputFileIndex>,
}

// TODO(port): move to bake_sys
unsafe extern "C" {
    fn BakeGlobalObject__attachPerThreadData(
        global: *const JSGlobalObject,
        pt: *mut PerThread<'static>,
    );
}

impl<'a> PerThread<'a> {
    /// After initializing, call `attach`
    pub fn init(vm: *mut VirtualMachine, opts: PerThreadOptions<'a>) -> Result<PerThread<'a>, bun_core::Error> {
        let loaded_files = AutoBitSet::init_empty(opts.output_indexes.len())?;
        // errdefer loaded_files.deinit() — handled by Drop on error path

        // SAFETY: vm is the live per-thread VM; vm.global is live for VM lifetime.
        let global = unsafe { &*(*vm).global };
        let all_server_files = bun_jsc::Strong::create(
            JSValue::create_empty_array(global, opts.output_indexes.len())?,
            global,
        );

        Ok(PerThread {
            input_files: opts.input_files,
            bundled_outputs: opts.bundled_outputs,
            output_indexes: opts.output_indexes,
            module_keys: opts.module_keys,
            module_map: opts.module_map,
            vm,
            loaded_files,
            all_server_files,
            source_maps: opts.source_maps,
        })
    }

    pub fn attach(&mut self) {
        unsafe {
            // SAFETY: self.vm is the live per-thread VM (raw ptr from init_bake);
            // PerThread outlives the attached lifetime; detached in Drop.
            BakeGlobalObject__attachPerThreadData(
                (*self.vm).global,
                self as *mut PerThread<'a> as *mut PerThread<'static>,
            );
        }
    }

    pub fn output_index(&self, id: OpaqueFileId) -> OutputFileIndex {
        self.output_indexes[id.get() as usize]
    }

    pub fn input_file(&self, id: OpaqueFileId) -> InputFile {
        self.input_files[id.get() as usize]
    }

    pub fn output_file(&self, id: OpaqueFileId) -> &OutputFile {
        &self.bundled_outputs[self.output_index(id).0 as usize]
    }

    // Must be run at the top of the event loop
    pub fn load_bundled_module(&self, id: OpaqueFileId) -> Result<JSValue, bun_core::Error> {
        // SAFETY: self.vm is the live per-thread VM; vm.global is live for VM lifetime.
        let global = unsafe { &*(*self.vm).global };
        load_module(
            self.vm,
            global,
            self.module_keys[id.get() as usize].to_js(global)?,
        )
    }

    /// The JSString entries in `all_server_files` is generated lazily. When
    /// multiple rendering threads are used, unreferenced files will contain
    /// holes in the array used. Returns a JSValue of the "FileIndex" type
    //
    // What could be done here is generating a new index type, which is
    // specifically for referenced files. This would remove the holes, but make
    // it harder to pre-allocate. It's probably worth it.
    pub fn preload_bundled_module(&mut self, id: OpaqueFileId) -> JsResult<JSValue> {
        // SAFETY: self.vm is the live per-thread VM; vm.global is live for VM lifetime.
        let global = unsafe { &*(*self.vm).global };
        if !self.loaded_files.is_set(id.get() as usize) {
            self.loaded_files.set(id.get() as usize);
            self.all_server_files.get().put_index(
                global,
                u32::try_from(id.get()).unwrap(),
                self.module_keys[id.get() as usize].to_js(global)?,
            )?;
        }

        Ok(JSValue::js_number_from_int32(
            i32::try_from(id.get()).unwrap(),
        ))
    }
}

impl<'a> Drop for PerThread<'a> {
    fn drop(&mut self) {
        // SAFETY: FFI call; `self.vm` is the live per-thread VM (VM outlives
        // PerThread), and passing null detaches the previously-attached pointer.
        unsafe {
            BakeGlobalObject__attachPerThreadData((*self.vm).global, core::ptr::null_mut());
        }
        // `all_server_files: Strong` is dropped automatically, releasing the GC root.
    }
}

/// Given a key, returns the source code to load.
#[unsafe(no_mangle)]
pub extern "C" fn BakeProdLoad(pt: *mut PerThread, key: BunString) -> BunString {
    // PERF(port): was stack-fallback alloc
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    log!("BakeProdLoad: {}\n", BStr::new(utf8.slice()));
    if let Some(value) = pt.module_map.get(utf8.slice()) {
        log!("  found in module_map: {}\n", BStr::new(utf8.slice()));
        return pt.bundled_outputs[value.0 as usize].value.to_bun_string();
    }
    BunString::dead()
}

#[unsafe(no_mangle)]
pub extern "C" fn BakeProdSourceMap(pt: *mut PerThread, key: BunString) -> BunString {
    // PERF(port): was stack-fallback alloc
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    if let Some(value) = pt.source_maps.get(utf8.slice()) {
        return pt.bundled_outputs[value.0 as usize].value.to_bun_string();
    }
    BunString::dead()
}

/// Packed: type (u8) | no_client (bool, 1 bit) | unused (u23)
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct TypeAndFlags(i32);

impl TypeAndFlags {
    pub const fn new(ty: u8, no_client: bool) -> Self {
        // type: bits 0..8, no_client: bit 8, unused: bits 9..32
        TypeAndFlags((ty as i32) | ((no_client as i32) << 8))
    }

    pub const fn bits(self) -> i32 {
        self.0
    }

    pub const fn r#type(self) -> u8 {
        (self.0 & 0xFF) as u8
    }

    /// Don't inclue the runtime client code (e.g.
    /// bun-framework-react/client.tsx). This is used if we know a server
    /// component does not include any downstream usages of "use client" and so
    /// we can omit the client code entirely.
    pub const fn no_client(self) -> bool {
        ((self.0 >> 8) & 1) != 0
    }
}

// `fn @"export"()` force-reference block dropped — Rust links what's `pub`.

use bun_bundler::options::EnvBehavior;
use bun_bundler::options::OutputKind;
use bun_options_types::ImportKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/production.zig (1074 lines)
//   confidence: low (phase-d: real bodies ported; many sibling-crate API
//               surfaces guessed against current drafts)
//   todos:      11
//   notes:      build_command/build_with_vm/load_module/BakeProdResolve/
//               BakeToWindowsPath bodies ported from spec. build_with_vm uses
//               the full `framework_router_body` types (Part/route_ptr/
//               init_empty/scan_all) re-exported via mod.rs; the keystone
//               stub `framework_router::Route` lacks `.part`, so route walking
//               currently goes through the full draft. EntryPointMap now
//               implements `InsertionHandler`. Transpiler/BundleV2/Options
//               field names matched to current crate surfaces; Phase B should
//               re-verify against compiled bundler API.
// ──────────────────────────────────────────────────────────────────────────
