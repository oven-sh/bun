//! `bun build --app`: the static build of an app, which prerenders every route.

//! Implements building a Bake application to production

use bun_paths::strings;
use core::cell::UnsafeCell;
use core::mem::MaybeUninit;
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::OnceLock;

use bstr::BStr;

use crate::bake;
use crate::bake::router::PatternBuffer;
use crate::bake::router::{self, FrameworkRouter, OpaqueFileId};
use bun_alloc::Arena;
use bun_bundler::BundleV2;
use bun_bundler::Transpiler;
use bun_bundler::bake_types::production::{EntryPointHashMap, InputFile};
use bun_bundler::options::{self as bundler_options, OutputFile};
use bun_bundler::output_file::Index as OutputFileIndex;

use bun_collections::{AutoBitSet, StringArrayHashMap};
use bun_core::String as BunString;
use bun_core::{Global, Output};
use bun_dotenv as dotenv;
use bun_jsc::bun_string_jsc;
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSModuleLoader, JSPromise, JSValue, JsResult,
    StringJsc as _,
};
use bun_paths::resolve_path::{self, platform};
use bun_resolver as resolver;

use crate::cli::command::{Context, HotReload};
use bun_options_types::context::MacroOptions;
use bun_options_types::offline_mode::OfflineMode;

use bun_bundler::options::OutputKind;

bun_core::define_scoped_log!(log, production, visible);

mod entry_points;
mod ffi;
mod per_thread;

pub(crate) use entry_points::EntryPointMap;
use ffi::*;
pub(crate) use per_thread::{PerThread, TypeAndFlags};

/// Local shim: `crate::Error` has no `From<bun_jsc::JsError>` (tier-0 cannot
/// depend on tier-6). Map every JS-side failure to the `"JSError"` sentinel the
/// caller already pattern-matches on.
#[inline(always)]
fn js_err(_: bun_jsc::JsError) -> crate::Error {
    crate::Error::JSError
}

/// `bun_bundler::options::Side` (the type carried on `OutputFile.side`) is a
/// re-export of `bake_types::Side`; no upstream `Display` impl.
/// Local stringifier for the debug log line below.
#[inline(always)]
fn side_name(s: bun_bundler::options::Side) -> &'static str {
    match s {
        bun_bundler::options::Side::Client => "client",
        bun_bundler::options::Side::Server => "server",
    }
}

/// Process-lifetime backing storage for the dotenv singleton; `OnceLock` owns
/// the allocation.
struct DotenvSingleton {
    loader: UnsafeCell<dotenv::Loader>,
}
// SAFETY: `build_command` runs single-threaded during CLI init; the singleton
// is set exactly once before any reader exists.
unsafe impl Sync for DotenvSingleton {}
static DOTENV_SINGLETON: OnceLock<DotenvSingleton> = OnceLock::new();

pub(crate) fn build_command(ctx: Context) -> crate::Result<()> {
    bake::print_warning();

    if ctx.args.entry_points.len() > 1 {
        bun_core::err_generic!("bun build --app only accepts one entrypoint");
        Global::crash();
    }

    if ctx.debug.hot_reload != HotReload::None {
        bun_core::err_generic!("Instead of using --watch, use 'bun run'");
        Global::crash();
    }

    let mut cwd_buf = bun_paths::path_buffer_pool::get();
    let cwd = match bun_core::getcwd(&mut cwd_buf) {
        Ok(cwd) => cwd.as_bytes(),
        Err(err) => {
            Output::err(err, "Could not query current working directory", ());
            Global::crash();
        }
    };
    // Note: reshaped for borrowck — clone the cwd slice so the PathBuffer
    // borrow doesn't span the rest of the function (the buffer is never reused).
    let cwd: Box<[u8]> = Box::from(cwd);

    // Create a VM + global for loading the config file, plugins, and
    // performing build time prerendering.
    jsc::initialize(jsc::InitializeOptions::default());
    bun_ast::initialize_store();

    let mut arena = Arena::new();

    let vm_ptr = VirtualMachine::init_bake(jsc::virtual_machine::Options {
        // arena: arena — dropped per §Allocators (global mimalloc)
        log: NonNull::new(ctx.log),
        args: ctx.args.clone(),
        smol: ctx.runtime_options.smol,
        ..Default::default()
    })?;
    // SAFETY: `init_bake` returns a freshly-allocated VM owned by this thread;
    // unique access for the rest of this function.
    let vm = unsafe { &mut *vm_ptr };
    // Note: pass `vm_ptr` by value into the guard so the drop closure does
    // not borrow the local (`defer!` would capture `&vm_ptr`, which under
    // edition-2024 disjoint-capture rules collides with the `&mut *vm_ptr`
    // re-borrows on the JSError path).
    let _vm_guard = scopeguard::guard(vm_ptr, |p| {
        // SAFETY: p is the unique live VM on this thread; its loop is alive, so
        // queued work is released here rather than by a thread teardown.
        unsafe {
            (*p).release_queued_work();
            (*p).destroy()
        };
    });

    // A special global object is used to allow registering virtual modules
    // that bypass Bun's normal module resolver and plugin system.
    vm.regular_event_loop.global = NonNull::new(vm.global);
    vm.event_loop_ref().ensure_waker();
    {
        let b = &mut vm.transpiler;
        // preload/argv are `Vec<Box<[u8]>>`; clone because the VM owns its
        // fields. Startup-only, so the copies are not hot.
        vm.preload.clone_from(&ctx.preloads);
        vm.argv.clone_from(&ctx.passthrough);
        vm.arena = NonNull::new(&raw mut arena);
        // vm.allocator = arena.arena() — dropped per §Allocators
        // `BundleOptions.install` is `Option<NonNull<_>>`, so no
        // lifetime-extension cast is needed.
        let install_ptr = ctx.install.as_deref().map(NonNull::from);
        b.options.install = install_ptr;
        b.resolver.opts.install = install_ptr;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        let offline = ctx
            .debug
            .offline_mode_setting
            .unwrap_or(OfflineMode::Online);
        b.resolver.opts.install_preference = offline;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.install_preference = offline;
        // SAFETY: `b.env` is the Transpiler-owned `*mut Loader`; store it
        // as `NonNull` (not `&Loader`) because `configure_defines()` below
        // reborrows the same allocation as `&mut Loader` via `run_env_loader()`,
        // which would alias a live `&Loader` here. The Loader outlives the
        // resolver (process-lifetime singleton or VM-owned).
        b.resolver.env_loader = NonNull::new(b.env);
        b.options.minify_identifiers = ctx.bundler_options.minify_identifiers;
        b.options.minify_whitespace = ctx.bundler_options.minify_whitespace;
        b.options.ignore_dce_annotations = ctx.bundler_options.ignore_dce_annotations;
        // Note: `bun_resolver::options::BundleOptions` has no
        // `minify_identifiers`/`minify_whitespace` fields; resolver.opts does
        // not carry them (the resolver never reads them).
        b.options.env.behavior = bundler_options::EnvBehavior::LoadAllWithoutInlining;
    }
    vm.event_loop_ref().ensure_waker();
    match &ctx.debug.macros {
        MacroOptions::Disable => {
            vm.transpiler.options.no_macros = true;
        }
        MacroOptions::Map(macros) => {
            // Note: the two map types are nominally
            // distinct (`ArrayHashMap<Box<[u8]>, ArrayHashMap<Box<[u8]>, Box<[u8]>>>`
            // vs `StringArrayHashMap<StringArrayHashMap<Box<[u8]>>>`), so
            // rebuild the resolver-shaped map by cloning value bytes.
            let mut remap = bun_resolver::package_json::MacroMap::default();
            for (pkg, inner) in macros.iter() {
                let mut entry = bun_resolver::package_json::MacroImportReplacementMap::default();
                for (import_name, path) in inner.iter() {
                    entry.insert(import_name.as_ref(), Box::<[u8]>::from(path.as_ref()));
                }
                remap.insert(pkg.as_ref(), entry);
            }
            vm.transpiler.options.macro_remap = remap;
        }
        MacroOptions::Unspecified => {}
    }
    if vm.transpiler.configure_defines().is_err() {
        fail_with_build_error(vm);
    }
    // `vm.log` was set from `ctx.log` above (non-null, process-lifetime);
    // `log_mut()` is the safe accessor encapsulating the NonNull deref.
    bun_http::async_http::load_env(vm.log_mut().unwrap(), vm.env_loader());
    vm.load_extra_env_and_source_code_printer();
    vm.is_main_thread = true;
    jsc::virtual_machine::IS_MAIN_THREAD_VM.set(true);

    // SAFETY: vm.jsc_vm is the live JSC::VM* set in `VirtualMachine::init_bake`;
    // raw-ptr deref yields an unbounded `&VM` so the `ApiLock<'_>` does not
    // borrow `vm` (the VirtualMachine) and the body below can keep using it.
    //
    // Declaration order matters: `_api_lock` is bound before `pt` so LIFO drop
    // detaches `pt` (a JSC FFI call) *while the API lock is still held*, then
    // releases the lock.
    let _api_lock = unsafe { (*vm.jsc_vm).get_api_lock() };

    // Note: `PerThread` owns its data. Start with an empty placeholder so Drop
    // (which detaches the C++-side per-thread pointer) runs in this frame's
    // LIFO order — under the API lock, before the VM is destroyed.
    let mut pt = PerThread::placeholder(vm_ptr);

    match build_with_vm(ctx, &cwd, &mut pt) {
        Ok(()) => {}
        Err(crate::Error::JSError) => {
            // SAFETY: vm.global is live for VM lifetime.
            let global = unsafe { &*(*vm_ptr).global };
            let err_value = global.take_exception(jsc::JsError::Thrown);
            // SAFETY: see above.
            unsafe {
                (*vm_ptr)
                    .print_error_like_object_to_console(err_value.to_error().unwrap_or(err_value))
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
    Ok(())
}

/// Ported inline from `bun.bun_js.failWithBuildError` to avoid the
/// `bun_runtime → bun (binary)` dep cycle (PORTING.md §Forbidden: dep-cycle
/// fixes via fn-ptr hooks — move/port the code instead).
#[cold]
#[inline(never)]
fn fail_with_build_error(vm: &mut VirtualMachine) -> ! {
    // `vm.log` is the process-lifetime ctx.log set in build_command;
    // `log_ref()` is the safe accessor encapsulating the NonNull deref.
    if let Some(log) = vm.log_ref() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    }
    Global::exit(1);
}

fn write_sourcemap_to_disk(
    file: &OutputFile,
    bundled_outputs: &[OutputFile],
    source_maps: &mut StringArrayHashMap<OutputFileIndex>,
) -> crate::Result<()> {
    // don't call this if the file does not have sourcemaps!
    debug_assert!(file.source_map_index != u32::MAX);

    // TODO: should we just write the sourcemaps to disk?
    let source_map_index = file.source_map_index;
    debug_assert!(bundled_outputs[source_map_index as usize].output_kind == OutputKind::Sourcemap);

    source_maps.put(
        &module_map_key(file),
        OutputFileIndex::init(source_map_index),
    )?;
    Ok(())
}

/// The key of a server output file in the module map: `bake:/` and its path in the build.
fn module_map_key(file: &OutputFile) -> Vec<u8> {
    let without_prefix = if strings::has_prefix(&file.dest_path, b"./")
        || (cfg!(windows) && strings::has_prefix(&file.dest_path, b".\\"))
    {
        &file.dest_path[2..]
    } else {
        &file.dest_path[..]
    };

    let mut key = Vec::with_capacity(6 + without_prefix.len());
    write!(&mut key, "bake:/{}", BStr::new(without_prefix)).expect("infallible: in-memory write");
    key
}

fn build_with_vm(ctx: Context, cwd: &[u8], pt: &mut PerThread) -> crate::Result<()> {
    // `pt.vm` is the live per-thread VM's BackRef set in `build_command`;
    // `as_ptr()` is `Copy` and does not borrow `pt`.
    let vm_ptr: *mut VirtualMachine = pt.vm.as_ptr();
    // SAFETY: exclusive access on this thread for the duration of the call.
    let vm = unsafe { &mut *vm_ptr };
    // Load and evaluate the configuration module. `global()` returns
    // `&'static`, decoupled from `vm` so later `&mut vm` reborrows are allowed.
    let global = vm.global();
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
        bun_ast::ImportKind::EntryPointBuild,
    ) {
        Ok(r) => r,
        Err(err) => {
            if err == bun_resolver::Error::ModuleNotFound {
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

    let Some(config_promise) =
        JSModuleLoader::load_and_evaluate_module_ptr(vm.global, &config_entry_point_string)
    else {
        debug_assert!(global.has_exception());
        return Err(crate::Error::JSError);
    };
    let config_promise_ptr = config_promise.as_ptr();
    // `JSInternalPromise` (= `JSPromise`) is an `opaque_ffi!` ZST handle —
    // `opaque_mut` is the const-asserted safe `*mut → &mut` accessor
    // (`load_and_evaluate_module_ptr` returned a live JSC-heap cell).
    jsc::JSInternalPromise::opaque_mut(config_promise_ptr).set_handled();
    vm.wait_for_promise(AnyPromise::Internal(config_promise_ptr))
        .map_err(|stopped| js_err(stopped.throw(vm.global())))?;
    let jsc_vm = vm.jsc_vm_mut();
    // Promise cell is still live (rooted via the module loader).
    let mut options = match jsc::JSInternalPromise::opaque_mut(config_promise_ptr)
        .unwrap(jsc_vm, UnwrapMode::MarkHandled)
    {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => {
            let default = bake_get_default_export_from_module(
                global,
                config_entry_point_string.to_js(global).map_err(js_err)?,
            )
            .map_err(js_err)?;

            if !default.is_object() {
                return Err(js_err(global.throw_invalid_arguments(format_args!(
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
                ))));
            }

            let Some(app) = default.get(global, "app").map_err(js_err)? else {
                return Err(js_err(global.throw_invalid_arguments(format_args!(
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
                ))));
            };

            crate::bake::UserOptions::from_js(app, global).map_err(js_err)?
        }
        Unwrapped::Rejected(err) => {
            return Err(js_err(global.throw_value(err.to_error().unwrap_or(err))));
        }
    };

    let framework = &mut options.framework;

    let separate_ssr_graph = framework
        .server_components
        .as_ref()
        .map(|sc| sc.separate_ssr_graph)
        .unwrap_or(false);

    // this is probably wrong
    // Note: process-lifetime dotenv singleton owned via `OnceLock`
    // (PORTING.md §Forbidden: no leaking).
    let backing = DOTENV_SINGLETON.get_or_init(|| DotenvSingleton {
        loader: UnsafeCell::new(dotenv::Loader::init()),
    });
    // SAFETY: single-threaded CLI init; `get_or_init` guarantees one-time
    // setup and `backing` is never moved (static storage).
    let loader = unsafe { &mut *backing.loader.get() };
    loader.map.put(b"NODE_ENV", b"production")?;
    dotenv::set_instance(std::ptr::from_mut::<dotenv::Loader>(loader));

    // In-place init via `MaybeUninit` (`init_transpiler`
    // keeps the out-param shape shared with the dev-server path).
    let mut client_transpiler = MaybeUninit::<Transpiler>::uninit();
    let mut server_transpiler = MaybeUninit::<Transpiler>::uninit();
    let mut ssr_transpiler = MaybeUninit::<Transpiler>::uninit();
    // `vm.log` is set from `ctx.log` (non-null, process-lifetime);
    // `log_mut()` is the safe accessor encapsulating the NonNull deref.
    let vm_log = vm.log_mut().unwrap();
    framework.init_transpiler(
        &options.arena,
        vm_log,
        crate::bake::Mode::ProductionStatic,
        crate::bake::Graph::Server,
        &mut server_transpiler,
        &options.bundler_options.server,
    )?;
    framework.init_transpiler(
        &options.arena,
        vm_log,
        crate::bake::Mode::ProductionStatic,
        crate::bake::Graph::Client,
        &mut client_transpiler,
        &options.bundler_options.client,
    )?;
    if separate_ssr_graph {
        framework.init_transpiler(
            &options.arena,
            vm_log,
            crate::bake::Mode::ProductionStatic,
            crate::bake::Graph::Ssr,
            &mut ssr_transpiler,
            &options.bundler_options.ssr,
        )?;
    }
    // SAFETY: written above by init_transpiler.
    let server_transpiler = unsafe { server_transpiler.assume_init_mut() };
    // SAFETY: written above by init_transpiler.
    let client_transpiler = unsafe { client_transpiler.assume_init_mut() };
    // `ssr_transpiler` stays `MaybeUninit` and is only `assume_init_mut()`'d
    // inside `if separate_ssr_graph` blocks below — Rust forbids forming
    // `&mut T` to uninitialized memory regardless of later use.

    if ctx.bundler_options.bake_debug_disable_minify {
        let mut targets: Vec<&mut Transpiler> =
            vec![&mut *client_transpiler, &mut *server_transpiler];
        if separate_ssr_graph {
            // SAFETY: written above by init_transpiler when separate_ssr_graph.
            targets.push(unsafe { ssr_transpiler.assume_init_mut() });
        }
        for transpiler in targets {
            transpiler.options.minify_syntax = false;
            transpiler.options.minify_identifiers = false;
            transpiler.options.minify_whitespace = false;
            // Note: `bun_resolver::options::BundleOptions` carries no naming
            // templates; the canonical fields live on `transpiler.options`
            // (bun_bundler::options::BundleOptions).
            transpiler.options.entry_naming =
                Box::from(b"_bun/[dir]/[name].[hash].[ext]".as_slice());
            transpiler.options.chunk_naming =
                Box::from(b"_bun/[dir]/[name].[hash].chunk.[ext]".as_slice());
            transpiler.options.asset_naming =
                Box::from(b"_bun/[dir]/[name].[hash].asset.[ext]".as_slice());
        }
    }

    // these share pointers right now, so setting NODE_ENV == production on one should affect all
    debug_assert!(core::ptr::eq(server_transpiler.env, client_transpiler.env));

    if framework
        .resolve(
            &mut server_transpiler.resolver,
            &mut client_transpiler.resolver,
        )
        .is_err()
    {
        if framework.is_built_in_react {
            // SAFETY: `server_transpiler.log` is the process-lifetime ctx.log.
            bake::Framework::add_react_install_command_note(unsafe { &mut *server_transpiler.log });
        }
        bun_core::err_generic!("Failed to resolve all imports required by the framework");
        Output::flush();
        let _ = server_transpiler
            .log()
            .print(std::ptr::from_mut(Output::error_writer()));
        Global::crash();
    }

    // Only the dev server puts the pages in the browser build and gives the client entry `route`.
    if framework
        .file_system_router_types
        .iter()
        .any(|fsr| fsr.client_pages)
    {
        bun_core::err_generic!(
            "'fileSystemRouterTypes[n].clientPages' is not supported in a production build yet"
        );
        Output::flush();
        Global::crash();
    }

    bun_core::pretty_errorln!("Bundling routes");
    Output::flush();

    // trailing slash
    let public_path: &[u8] = b"/";

    let mut root_dir_buf = bun_paths::path_buffer_pool::get();
    let root_dir_path =
        resolve_path::join_abs_string_buf::<platform::Auto>(cwd, &mut root_dir_buf.0, &[b"dist"]);
    // Note: reshaped for borrowck — copy out so root_dir_buf can drop.
    let root_dir_path: Box<[u8]> = Box::from(root_dir_path);

    // Note: borrowck — `framework` is `&mut options.framework`; reborrow
    // through it instead of `options.framework` to avoid stacking borrows.
    let mut router_types: Vec<router::Type> =
        Vec::with_capacity(framework.file_system_router_types.len());

    let mut entry_points = EntryPointMap {
        root: Box::from(cwd),
        files: EntryPointHashMap::default(),
        owned_paths: Vec::new(),
    };

    for fsr in &framework.file_system_router_types {
        let mut buf = bun_paths::path_buffer_pool::get();
        let joined_root =
            resolve_path::join_abs_string_buf::<platform::Auto>(cwd, &mut buf[..], &[&fsr.root]);
        let Some(entry) = server_transpiler
            .resolver
            .read_dir_info_ignore_error(joined_root)
        else {
            continue;
        };
        let server_file =
            entry_points.get_or_put_entry_point(&fsr.entry_server, bake::Side::Server)?;
        let client_file = if let Some(client) = &fsr.entry_client {
            Some(entry_points.get_or_put_entry_point(client, bake::Side::Client)?)
        } else {
            None
        };
        router_types.push(router::Type {
            abs_root: Box::from(strings::paths::without_trailing_slash_windows_path(
                entry.abs_path,
            )),
            ignore_underscores: fsr.ignore_underscores,
            ignore_dirs: fsr
                .ignore_dirs
                .iter()
                .map(|s| Box::<[u8]>::from(&**s))
                .collect(),
            extensions: fsr
                .extensions
                .iter()
                .map(|s| Box::<[u8]>::from(&**s))
                .collect(),
            style: fsr.style,
            allow_layouts: fsr.allow_layouts,
            client_pages: fsr.client_pages,
            server_file: OpaqueFileId::init(server_file.get()),
            client_file: client_file.map(|f| OpaqueFileId::init(f.get())),
            server_file_string: bun_jsc::StrongOptional::empty(),
        });
    }

    let mut router = FrameworkRouter::init_empty(cwd, router_types.into_boxed_slice())?;
    let mut route_scan = entry_points::RouteScan {
        entry_points: &mut entry_points,
        invalid_routes: 0,
    };
    router.scan_all(
        &mut server_transpiler.resolver,
        router::InsertionContext::wrap(&mut route_scan),
    )?;
    if route_scan.invalid_routes > 0 {
        Global::crash();
    }

    // `bake::Framework` is the runtime-side superset; the bundler reads only
    // `built_in_modules` / `server_components` / `react_fast_refresh`
    // via its lower-tier `bake_types::Framework` view.
    // (The two Framework types could only merge if `FileSystemRouterType` /
    // `router::Style` moved down to bun_bundler.)
    let bundler_framework = framework.as_bundler_view();

    let bundled_outputs_list: Vec<OutputFile> = {
        // Transpiler pointers — reborrow via raw to sidestep the
        // `&'a mut Transpiler<'a>` invariant lifetime on the bundler API.
        // SAFETY: the three transpilers live in this stack frame and outlive
        // the bundle call; `BundleV2` does not retain them past return.
        let server_ptr: *mut Transpiler = &raw mut *server_transpiler;
        let client_ptr: *mut Transpiler = &raw mut *client_transpiler;
        let ssr_ptr: *mut Transpiler = if separate_ssr_graph {
            // SAFETY: written above by init_transpiler when separate_ssr_graph.
            core::ptr::from_mut(unsafe { ssr_transpiler.assume_init_mut() })
        } else {
            server_ptr
        };

        // Construct the `AnyEventLoop` enum
        // value (NOT a pointer-cast: the bundler matches on its discriminant).
        // Lives in this block's stack frame, outliving the bundle call.
        let mut any_loop = bun_event_loop::AnyEventLoop::js(vm.event_loop().cast());

        // Propagate via `?`. Do NOT
        // catch-and-exit here: the bake path expects this call to succeed for
        // valid inputs, and any `BuildFailed` indicates a bug upstream
        // (in the bundler), not a user-facing diagnostic to swallow.
        BundleV2::generate_from_bake_production_cli(
            &mut entry_points,
            // SAFETY: see `server_ptr` comment above.
            unsafe { &mut *server_ptr },
            bun_bundler::bundle_v2::BakeOptions {
                framework: bundler_framework,
                client_transpiler: NonNull::new(client_ptr).expect("stack-owned transpiler"),
                ssr_transpiler: NonNull::new(ssr_ptr).expect("stack-owned transpiler"),
                plugins: options.bundler_options.plugin,
            },
            &options.arena,
            Some(NonNull::from(&mut any_loop)),
        )?
    };
    if bundled_outputs_list.is_empty() {
        bun_core::prettyln!("done");
        Output::flush();
        return Ok(());
    }

    bun_core::pretty_errorln!("Rendering routes");
    Output::flush();

    // mkdir -p + open.
    let root_dir = bun_sys::Dir::cwd().make_open_path(b"dist", Default::default())?;

    let mut maybe_runtime_file_index: Option<u32> = None;

    let mut css_chunks_count: usize = 0;
    let mut css_chunks_first: usize = 0;

    // Index all bundled outputs.
    // Client files go to disk.
    // Server files get loaded in memory.
    let mut output_module_map: StringArrayHashMap<OutputFileIndex> = StringArrayHashMap::default();
    let mut source_maps: StringArrayHashMap<OutputFileIndex> = StringArrayHashMap::default();
    {
        for (input, output) in entry_points.files.iter() {
            log!(
                "entry point side={} src={} output={:?}\n",
                side_name(input.side),
                BStr::new(input.abs_path()),
                output.unwrap(),
            );
        }
        for (i, file) in bundled_outputs_list.iter().enumerate() {
            log!(
                "src_index={:?} side={} src={} dest={}\n",
                file.source_index,
                file.side.map(side_name).unwrap_or("null"),
                BStr::new(&file.src_path.text),
                BStr::new(&file.dest_path),
            );
            if file.loader.is_css() {
                if css_chunks_count == 0 {
                    css_chunks_first = i;
                } else {
                    css_chunks_first = css_chunks_first.min(i);
                }
                css_chunks_count += 1;
            }

            // The output file which contains the runtime (Index.runtime, contains
            // wrapper functions like `__esm`) is marked as server side, but it is
            // also used by client
            if file.bake_extra.bake_is_runtime {
                debug_assert!(
                    maybe_runtime_file_index.is_none(),
                    "Runtime file should only be in one chunk."
                );
                maybe_runtime_file_index = Some(u32::try_from(i).expect("int cast"));
            }

            // TODO: Maybe not do all the disk-writing in 1 thread?
            let Some(side) = file.side else { continue };
            match side {
                bun_bundler::options::Side::Client => {
                    // Client-side resources will be written to disk for usage on the client side
                    if let Err(err) = file.write_to_disk(root_dir.fd()) {
                        bun_core::handle_error_return_trace(err);
                        Output::err(
                            err,
                            "Failed to write {} to output directory",
                            (bun_core::fmt::quote(&file.dest_path),),
                        );
                    }
                }
                bun_bundler::options::Side::Server => {
                    if ctx.bundler_options.bake_debug_dump_server {
                        if let Err(err) = file.write_to_disk(root_dir.fd()) {
                            bun_core::handle_error_return_trace(err);
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
                        write_sourcemap_to_disk(file, &bundled_outputs_list, &mut source_maps)?;
                    }

                    match file.output_kind {
                        OutputKind::EntryPoint | OutputKind::Chunk => {
                            let key = module_map_key(file);

                            log!(
                                "  adding module map entry: output_module_map({}) = {}\n",
                                BStr::new(&key),
                                i
                            );

                            output_module_map.put(
                                &key,
                                OutputFileIndex::init(u32::try_from(i).expect("int cast")),
                            )?;
                        }
                        OutputKind::Asset => {}
                        OutputKind::Bytecode => {}
                        OutputKind::Sourcemap => {}
                        OutputKind::ModuleInfo
                        | OutputKind::BuiltinBytecode
                        | OutputKind::BytecodeStringTable
                        | OutputKind::BytecodePayload
                        | OutputKind::ModuleInfoStringTable
                        | OutputKind::PrelinkedModuleGraph => {}
                        OutputKind::MetafileJson | OutputKind::MetafileMarkdown => {}
                    }
                }
            }

            // TODO: should we just write the sourcemaps to disk?
            if file.source_map_index != u32::MAX {
                write_sourcemap_to_disk(file, &bundled_outputs_list, &mut source_maps)?;
            }
        }
    }
    // Write the runtime file to disk if there are any client chunks. The runtime
    // file doesn't exist if no bundled module uses its helpers.
    if let Some(runtime_file_index) = maybe_runtime_file_index {
        let any_client_chunks = bundled_outputs_list.iter().any(|file| {
            file.side == Some(bun_bundler::options::Side::Client)
                && file.src_path.text != b"bun-framework-react/client.tsx"
        });
        if any_client_chunks {
            let runtime_file: &OutputFile = &bundled_outputs_list[runtime_file_index as usize];
            if let Err(err) = runtime_file.write_to_disk(root_dir.fd()) {
                bun_core::handle_error_return_trace(err);
                Output::err(
                    err,
                    "Failed to write {} to output directory",
                    (bun_core::fmt::quote(&runtime_file.dest_path),),
                );
            }
        }
    }

    *pt = PerThread::init(
        vm_ptr,
        entry_points,
        bundled_outputs_list,
        output_module_map,
        source_maps,
    )?;
    pt.attach();

    // Static site generator
    let server_render_funcs =
        JSValue::create_empty_array(global, router.types.len()).map_err(js_err)?;
    let server_param_funcs =
        JSValue::create_empty_array(global, router.types.len()).map_err(js_err)?;
    let client_entry_urls =
        JSValue::create_empty_array(global, router.types.len()).map_err(js_err)?;

    for (i, router_type) in router.types.iter().enumerate() {
        if let Some(client_file) = router_type.client_file {
            let str = BunString::create_format(format_args!(
                "{}{}",
                BStr::new(public_path),
                BStr::new(&pt.output_file(client_file).map_err(js_err)?.dest_path),
            ))
            .into_js(global)
            .map_err(js_err)?;
            client_entry_urls
                .put_index(global, u32::try_from(i).expect("int cast"), str)
                .map_err(js_err)?;
        } else {
            client_entry_urls
                .put_index(global, u32::try_from(i).expect("int cast"), JSValue::NULL)
                .map_err(js_err)?;
        }

        let server_file = router_type.server_file;
        let server_entry_point = pt.load_bundled_module(server_file)?;
        let server_render_func =
            bake_get_on_module_namespace(global, server_entry_point, b"prerender")
                .map_err(js_err)?;
        if !server_render_func.is_callable() {
            bun_core::err_generic!("Framework does not support static site generation");
            bun_core::note!(
                "The file {} is missing the \"prerender\" export, which defines how to generate static files.",
                bun_core::fmt::quote(resolve_path::relative(
                    cwd,
                    pt.input_file(server_file).abs_path()
                ))
            );
            Global::crash();
        }

        let server_param_func = if router.dynamic_routes.count() > 0 {
            let f = bake_get_on_module_namespace(global, server_entry_point, b"getParams")
                .map_err(js_err)?;
            if !f.is_callable() {
                bun_core::err_generic!("Framework does not support static site generation");
                bun_core::note!(
                    "The file {} is missing the \"getParams\" export, which defines how to generate static files.",
                    bun_core::fmt::quote(resolve_path::relative(
                        cwd,
                        pt.input_file(server_file).abs_path()
                    ))
                );
                Global::crash();
            }
            f
        } else {
            JSValue::NULL
        };
        server_render_funcs
            .put_index(
                global,
                u32::try_from(i).expect("int cast"),
                server_render_func,
            )
            .map_err(js_err)?;
        server_param_funcs
            .put_index(
                global,
                u32::try_from(i).expect("int cast"),
                server_param_func,
            )
            .map_err(js_err)?;
    }

    let mut navigatable_routes: Vec<router::RouteIndex> = Vec::new();
    for (i, route) in router.routes.iter().enumerate() {
        if route.file_page.is_none() {
            continue;
        }
        navigatable_routes.push(router::RouteIndex::init(
            u32::try_from(i).expect("int cast"),
        ));
    }

    // These strings live only in this heap Vec until the route arrays below
    // store them; the conservative GC stack scan cannot see a heap buffer, so
    // keep each one protected (module evaluation below can trigger GC).
    let mut css_chunk_js_strings: Vec<jsc::ProtectedJSValue> = Vec::with_capacity(css_chunks_count);
    for output_file in pt.bundled_outputs[css_chunks_first..][..css_chunks_count].iter() {
        debug_assert!(output_file.dest_path[0] != b'.');
        // CSS chunks must be in contiguous order!!
        debug_assert!(output_file.loader.is_css());
        css_chunk_js_strings.push(
            BunString::create_format(format_args!(
                "{}{}",
                BStr::new(public_path),
                BStr::new(&output_file.dest_path),
            ))
            .into_js(global)
            .map_err(js_err)?
            .protected(),
        );
    }

    // Route URL patterns with parameter placeholders.
    // Examples: "/", "/about", "/blog/:slug", "/products/:category/:id"
    let route_patterns =
        JSValue::create_empty_array(global, navigatable_routes.len()).map_err(js_err)?;

    // File indices for each route's components (page, layouts).
    // Example: [2, 5, 0] = page at index 2, layout at 5, root layout at 0
    let route_nested_files =
        JSValue::create_empty_array(global, navigatable_routes.len()).map_err(js_err)?;

    // Router type index (lower 8 bits) and flags (upper 24 bits).
    // Example: 0x00000001 = router type 1, no flags
    let route_type_and_flags =
        JSValue::create_empty_array(global, navigatable_routes.len()).map_err(js_err)?;

    // Source file paths relative to project root.
    // Examples: "pages/index.tsx", "pages/blog/[slug].tsx"
    let route_source_files =
        JSValue::create_empty_array(global, navigatable_routes.len()).map_err(js_err)?;

    // Parameter names for dynamic routes (reversed order), null for static routes.
    // Examples: ["slug"] for /blog/[slug], ["id", "category"] for /products/[category]/[id]
    let route_param_info =
        JSValue::create_empty_array(global, navigatable_routes.len()).map_err(js_err)?;

    // CSS chunk URLs for each route.
    // Example: ["/assets/main.css", "/assets/blog.css"]
    let route_style_references =
        JSValue::create_empty_array(global, navigatable_routes.len()).map_err(js_err)?;

    let mut params_buf: Vec<&[u8]> = Vec::new();
    for (nav_index, &route_index) in navigatable_routes.iter().enumerate() {
        let mut params_guard = scopeguard::guard(&mut params_buf, |b| b.clear());
        let params_buf = &mut **params_guard;

        let mut pattern = PatternBuffer::EMPTY;

        let route = router.route_ptr(route_index);
        let main_file_route_index = route.file_page.unwrap();
        // Note: reshaped for borrowck — `pt.output_file()` borrows `pt`
        // immutably, but `pt.preload_bundled_module()` below needs `&mut pt`.
        // Fetch the output file fresh at each use site instead of binding it.

        // Count how many JS+CSS files associated with this route and prepare `pattern`
        let mut file_count: u32 = 1;
        let mut next: Option<router::RouteIndex> = Some(route_index);
        while let Some(current_index) = next {
            let current = router.route_ptr(current_index);
            pattern.prepend_part(current.part);
            match current.part {
                router::Part::Param(name) | router::Part::CatchAll(name) => {
                    params_buf.push(name);
                }
                router::Part::CatchAllOptional(_) => {
                    return Err(js_err(global.throw(format_args!(
                        "catch-all routes are not supported in static site generation",
                    ))));
                }
                router::Part::Text(_) | router::Part::Group(_) => {}
            }
            if current.file_layout.is_some() {
                file_count += 1;
            }
            next = current.parent;
        }

        // Fill styles and file_list
        let styles = JSValue::create_empty_array(global, css_chunks_count).map_err(js_err)?;
        let file_list = JSValue::create_empty_array(global, file_count as usize).map_err(js_err)?;

        next = route.parent;
        file_count = 1;
        let mut css_file_count: u32 = 0;
        file_list
            .put_index(
                global,
                0,
                pt.preload_bundled_module(main_file_route_index)
                    .map_err(js_err)?,
            )
            .map_err(js_err)?;
        for r#ref in pt
            .output_file(main_file_route_index)
            .map_err(js_err)?
            .referenced_css_chunks
            .iter()
        {
            styles
                .put_index(
                    global,
                    css_file_count,
                    css_chunk_js_strings[r#ref.get() as usize - css_chunks_first].value(),
                )
                .map_err(js_err)?;
            css_file_count += 1;
        }
        if let Some(file) = route.file_layout {
            file_list
                .put_index(
                    global,
                    file_count,
                    pt.preload_bundled_module(file).map_err(js_err)?,
                )
                .map_err(js_err)?;
            for r#ref in pt
                .output_file(file)
                .map_err(js_err)?
                .referenced_css_chunks
                .iter()
            {
                styles
                    .put_index(
                        global,
                        css_file_count,
                        css_chunk_js_strings[r#ref.get() as usize - css_chunks_first].value(),
                    )
                    .map_err(js_err)?;
                css_file_count += 1;
            }
            file_count += 1;
        }

        while let Some(parent_index) = next {
            let parent = router.route_ptr(parent_index);
            if let Some(file) = parent.file_layout {
                file_list
                    .put_index(
                        global,
                        file_count,
                        pt.preload_bundled_module(file).map_err(js_err)?,
                    )
                    .map_err(js_err)?;
                for r#ref in pt
                    .output_file(file)
                    .map_err(js_err)?
                    .referenced_css_chunks
                    .iter()
                {
                    styles
                        .put_index(
                            global,
                            css_file_count,
                            css_chunk_js_strings[r#ref.get() as usize - css_chunks_first].value(),
                        )
                        .map_err(js_err)?;
                    css_file_count += 1;
                }
                file_count += 1;
            }
            next = parent.parent;
        }

        // Init the items
        let pattern_string = BunString::clone_utf8(pattern.slice());
        route_patterns
            .put_index(
                global,
                u32::try_from(nav_index).expect("int cast"),
                pattern_string.into_js(global).map_err(js_err)?,
            )
            .map_err(js_err)?;

        let src_path = BunString::clone_utf8(resolve_path::relative(
            cwd,
            pt.input_file(main_file_route_index).abs_path(),
        ));
        route_source_files
            .put_index(
                global,
                u32::try_from(nav_index).expect("int cast"),
                src_path.into_js(global).map_err(js_err)?,
            )
            .map_err(js_err)?;

        route_nested_files
            .put_index(
                global,
                u32::try_from(nav_index).expect("int cast"),
                file_list,
            )
            .map_err(js_err)?;
        route_type_and_flags
            .put_index(
                global,
                u32::try_from(nav_index).expect("int cast"),
                JSValue::js_number_from_int32(
                    TypeAndFlags::new(
                        route.r#type.get(),
                        pt.output_file(main_file_route_index)
                            .map_err(js_err)?
                            .bake_extra
                            .route
                            .is_fully_static(),
                    )
                    .bits(),
                ),
            )
            .map_err(js_err)?;

        if !params_buf.is_empty() {
            // reverse-index fill ≡ forward fill over `.iter().rev()`
            // (slice iterators are ExactSize + DoubleEnded).
            let param_info_array =
                JSValue::create_array_from_iter(global, params_buf.iter().rev(), |param| {
                    bun_string_jsc::create_utf8_for_js(global, param)
                })
                .map_err(js_err)?;
            route_param_info
                .put_index(
                    global,
                    u32::try_from(nav_index).expect("int cast"),
                    param_info_array,
                )
                .map_err(js_err)?;
        } else {
            route_param_info
                .put_index(
                    global,
                    u32::try_from(nav_index).expect("int cast"),
                    JSValue::NULL,
                )
                .map_err(js_err)?;
        }
        route_style_references
            .put_index(global, u32::try_from(nav_index).expect("int cast"), styles)
            .map_err(js_err)?;
    }

    // SAFETY: C++ never returns null (allocates a `JSPromise` on the GC heap);
    // `JSPromise` is an opaque `UnsafeCell`-backed handle so `&mut *` is sound.
    let render_promise = unsafe {
        &mut *BakeRenderRoutesForProdStatic(
            global,
            &BunString::from_bytes(&root_dir_path),
            pt.all_server_files.as_ref().unwrap().get(),
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
    // Rebind from the raw pointer: `PerThread::init`/`attach`/`load_bundled_module`
    // above accessed the same allocation through `vm_ptr`, invalidating the
    // earlier `&mut` under Stacked Borrows.
    let vm = VirtualMachine::get().as_mut();
    vm.wait_for_promise(AnyPromise::Normal(render_promise))
        .map_err(|stopped| js_err(stopped.throw(vm.global())))?;
    let jsc_vm = vm.jsc_vm_mut();
    match render_promise.unwrap(jsc_vm, UnwrapMode::MarkHandled) {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => {
            bun_core::prettyln!("done");
            Output::flush();
        }
        Unwrapped::Rejected(err) => {
            return Err(js_err(global.throw_value(err)));
        }
    }
    vm.wait_for_tasks();
    Ok(())
}
