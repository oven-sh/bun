//! Implements building a Bake application to production

use bun_paths::strings;
use core::cell::UnsafeCell;
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::OnceLock;

use bstr::BStr;

use super::PatternBuffer;
use crate::bake;
use crate::bake::bake_body;
use crate::bake::framework_router::{self, FrameworkRouter, OpaqueFileId};
use bun_alloc::Arena;
use bun_bundler::BundleV2;
use bun_bundler::Transpiler;
use bun_bundler::options::{self as bundler_options, OutputFile, SourceMapOption};
use bun_bundler::output_file::Index as OutputFileIndex;

use bun_collections::{AutoBitSet, StringArrayHashMap};
use bun_core::Output;
use bun_core::{OwnedString, String as BunString};
use bun_dotenv as dotenv;
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSModuleLoader, JSPromise, JSValue, JsResult,
    StringJsc as _,
};
use bun_paths::PathBuffer;
use bun_paths::resolve_path::{self, platform};
use bun_resolver as resolver;

use crate::cli::command::{Context, HotReload};
use bun_options_types::context::MacroOptions;
use bun_options_types::offline_mode::OfflineMode;

use bun_bundler::options::OutputKind;

bun_core::define_scoped_log!(log, production, visible);

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

pub fn build_command(ctx: Context) -> crate::Result<()> {
    bake::print_warning();

    if ctx.args.entry_points.len() > 1 {
        bun_core::err_generic!("bun build --app only accepts one entrypoint");
        return Err(crate::Error::BakeBuildFailed);
    }

    if ctx.debug.hot_reload != HotReload::None {
        bun_core::err_generic!("Instead of using --watch, use 'bun run'");
        return Err(crate::Error::BakeBuildFailed);
    }

    let mut cwd_buf = PathBuffer::uninit();
    let cwd = match bun_core::getcwd(&mut cwd_buf) {
        Ok(cwd) => cwd.as_bytes(),
        Err(err) => {
            Output::err(err, "Could not query current working directory", ());
            return Err(crate::Error::BakeBuildFailed);
        }
    };
    // Note: reshaped for borrowck — clone the cwd slice so the PathBuffer
    // borrow doesn't span the rest of the function (the buffer is never reused).
    let cwd: Box<[u8]> = Box::from(cwd);

    // Create a VM + global for loading the config file, plugins, and
    // performing build time prerendering.
    jsc::initialize(false);
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
    // Only the internal-error `Err(e)` return below reaches this guard; every other path exits inside `global_exit`.
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
    // The errors are in `ctx.log`, which `Cli::start` prints.
    vm.transpiler
        .configure_defines()
        .map_err(|_| crate::Error::BakeBuildFailed)?;
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

    let result = build_with_vm(ctx, &cwd, &mut pt);
    // SAFETY: `build_with_vm` has returned, so its reborrows through `pt.vm` are dead; the VM is live until `global_exit`.
    let vm = unsafe { &mut *vm_ptr };
    match result {
        Ok(()) => {}
        Err(crate::Error::JSError) => {
            let err_value = vm.global().take_exception(jsc::JsError::Thrown);
            vm.print_error_like_object_to_console(err_value.to_error().unwrap_or(err_value));
            if vm.exit_handler.exit_code == 0 {
                vm.exit_handler.exit_code = 1;
            }
        }
        // Already reported by `build_with_vm`.
        Err(crate::Error::BakeBuildFailed) => {
            if vm.exit_handler.exit_code == 0 {
                vm.exit_handler.exit_code = 1;
            }
        }
        Err(e) => return Err(e),
    }
    // Success exits through the VM too: 'exit' handlers, process.exitCode, VM teardown.
    vm.on_exit();
    vm.global_exit()
}

fn print_log(vm: &VirtualMachine) {
    if let Some(log) = vm.log_ref() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
    }
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

    let without_prefix = if strings::has_prefix(&file.dest_path, b"./")
        || (cfg!(windows) && strings::has_prefix(&file.dest_path, b".\\"))
    {
        &file.dest_path[2..]
    } else {
        &file.dest_path[..]
    };

    let mut key = Vec::with_capacity(6 + without_prefix.len());
    write!(&mut key, "bake:/{}", BStr::new(without_prefix)).expect("infallible: in-memory write");
    source_maps.put(&key, OutputFileIndex::init(source_map_index))?;
    Ok(())
}

struct OutputDir {
    dir: bun_sys::Dir,
    failed_writes: usize,
}

impl OutputDir {
    fn write(&mut self, file: &OutputFile) {
        if let Err(err) = file.write_to_disk(self.dir.fd(), b".") {
            bun_core::handle_error_return_trace(err);
            Output::err(
                err,
                "Failed to write {} to output directory",
                (bun_core::fmt::quote(&file.dest_path),),
            );
            self.failed_writes += 1;
        }
    }
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
                    return Err(crate::Error::BakeBuildFailed);
                }
            }

            Output::err(
                err,
                "could not resolve application config file '{}'",
                (BStr::new(&unresolved_config_entry_point),),
            );
            return Err(crate::Error::BakeBuildFailed);
        }
    };

    let config_entry_point_string = OwnedString::new(BunString::clone_utf8(
        config_entry_point.path_const().unwrap().text,
    ));

    let Some(config_promise) =
        JSModuleLoader::load_and_evaluate_module_ptr(vm.global, Some(&config_entry_point_string))
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
            let default = c::bake_get_default_export_from_module(
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

            bake_body::UserOptions::from_js(app, global).map_err(js_err)?
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

    // Borrowed by the transpilers until their slots drop, so it is declared first.
    let framework_view = framework.as_bundler_view();
    let mut server_slot = bake::TranspilerSlot::uninit();
    let mut client_slot = bake::TranspilerSlot::uninit();
    let mut ssr_slot = bake::TranspilerSlot::uninit();
    // `vm.log` is set from `ctx.log` (non-null, process-lifetime);
    // `log_mut()` is the safe accessor encapsulating the NonNull deref.
    let vm_log = vm.log_mut().unwrap();
    let server_transpiler = framework.init_transpiler_with_options(
        &options.arena,
        vm_log,
        bake_body::Mode::ProductionStatic,
        bake_body::Graph::Server,
        &mut server_slot,
        &framework_view,
        &options.bundler_options.server,
        SourceMapOption::from_api(Some(options.bundler_options.server.source_map)),
        options.bundler_options.server.minify_whitespace,
        options.bundler_options.server.minify_syntax,
        options.bundler_options.server.minify_identifiers,
    )?;
    let client_transpiler = framework.init_transpiler_with_options(
        &options.arena,
        vm_log,
        bake_body::Mode::ProductionStatic,
        bake_body::Graph::Client,
        &mut client_slot,
        &framework_view,
        &options.bundler_options.client,
        SourceMapOption::from_api(Some(options.bundler_options.client.source_map)),
        options.bundler_options.client.minify_whitespace,
        options.bundler_options.client.minify_syntax,
        options.bundler_options.client.minify_identifiers,
    )?;
    let mut ssr_transpiler = if separate_ssr_graph {
        Some(framework.init_transpiler_with_options(
            &options.arena,
            vm_log,
            bake_body::Mode::ProductionStatic,
            bake_body::Graph::Ssr,
            &mut ssr_slot,
            &framework_view,
            &options.bundler_options.ssr,
            SourceMapOption::from_api(Some(options.bundler_options.ssr.source_map)),
            options.bundler_options.ssr.minify_whitespace,
            options.bundler_options.ssr.minify_syntax,
            options.bundler_options.ssr.minify_identifiers,
        )?)
    } else {
        None
    };

    if ctx.bundler_options.bake_debug_disable_minify {
        let mut targets: Vec<&mut Transpiler> =
            vec![&mut *client_transpiler, &mut *server_transpiler];
        if let Some(ssr_transpiler) = ssr_transpiler.as_deref_mut() {
            targets.push(ssr_transpiler);
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

    *framework = match framework.resolve(
        &mut server_transpiler.resolver,
        &mut client_transpiler.resolver,
        &options.arena,
    ) {
        Ok(f) => f,
        Err(_) => {
            if framework.is_built_in_react {
                // SAFETY: `server_transpiler.log` is the process-lifetime ctx.log.
                bake_body::Framework::add_react_install_command_note(unsafe {
                    &mut *server_transpiler.log
                })?;
            }
            bun_core::err_generic!("Failed to resolve all imports required by the framework");
            Output::flush();
            print_log(vm);
            return Err(crate::Error::BakeBuildFailed);
        }
    };

    bun_core::pretty_errorln!("Bundling routes");
    Output::flush();

    // trailing slash
    let public_path: &[u8] = b"/";

    let mut root_dir_buf = PathBuffer::uninit();
    let root_dir_path =
        resolve_path::join_abs_string_buf::<platform::Auto>(cwd, &mut root_dir_buf.0, &[b"dist"]);
    // Note: reshaped for borrowck — copy out so root_dir_buf can drop.
    let root_dir_path: Box<[u8]> = Box::from(root_dir_path);

    // Note: borrowck — `framework` is `&mut options.framework`; reborrow
    // through it instead of `options.framework` to avoid stacking borrows.
    let mut router_types: Vec<framework_router::Type> =
        Vec::with_capacity(framework.file_system_router_types.len());

    let mut entry_points = EntryPointMap {
        root: Box::from(cwd),
        files: EntryPointHashMap::default(),
        owned_paths: Vec::new(),
    };

    for fsr in &framework.file_system_router_types {
        // `fsr.root` is absolute and fits in a `PathBuffer`: see `resolve_router_root`.
        let mut buf = bun_paths::path_buffer_pool::get();
        let joined_root =
            resolve_path::join_abs_string_buf::<platform::Auto>(cwd, &mut buf[..], &[fsr.root]);
        let Some(entry) = server_transpiler
            .resolver
            .read_dir_info_ignore_error(joined_root)
        else {
            continue;
        };
        let server_file =
            entry_points.get_or_put_entry_point(fsr.entry_server, bake::Side::Server)?;
        let client_file = if let Some(client) = fsr.entry_client {
            Some(entry_points.get_or_put_entry_point(client, bake::Side::Client)?)
        } else {
            None
        };
        router_types.push(framework_router::Type {
            abs_root: Box::from(strings::paths::without_trailing_slash_windows_path(
                entry.abs_path,
            )),
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
            server_file: OpaqueFileId::init(server_file.get()),
            client_file: client_file.map(|f| OpaqueFileId::init(f.get())),
            server_file_string: bun_jsc::StrongOptional::empty(),
        });
    }

    let mut router = FrameworkRouter::init_empty(cwd, router_types.into_boxed_slice())?;
    let mut route_scan = RouteScan {
        entry_points: &mut entry_points,
        error_count: 0,
    };
    router.scan_all(
        &mut server_transpiler.resolver,
        framework_router::InsertionContext::wrap(&mut route_scan),
    )?;
    if route_scan.error_count > 0 {
        return Err(crate::Error::BakeBuildFailed);
    }

    // Projected again so the bundle sees the paths `resolve()` filled in.
    let bundler_framework = framework.as_bundler_view();

    let bundled_outputs_list: Vec<OutputFile> = {
        // Transpiler pointers — reborrow via raw to sidestep the
        // `&'a mut Transpiler<'a>` invariant lifetime on the bundler API.
        // SAFETY: the transpilers live in this frame's slots, which outlive
        // the bundle call; `BundleV2` does not retain them past return.
        let server_ptr: *mut Transpiler = &raw mut *server_transpiler;
        let client_ptr: *mut Transpiler = &raw mut *client_transpiler;
        let ssr_ptr: *mut Transpiler = match ssr_transpiler {
            Some(ssr_transpiler) => &raw mut *ssr_transpiler,
            None => server_ptr,
        };

        // Construct the `AnyEventLoop` enum
        // value (NOT a pointer-cast: the bundler matches on its discriminant).
        // Lives in this block's stack frame, outliving the bundle call.
        let mut any_loop = bun_event_loop::AnyEventLoop::js(vm.event_loop().cast());

        match BundleV2::generate_from_bake_production_cli(
            &entry_points,
            // SAFETY: see `server_ptr` comment above.
            unsafe { &mut *server_ptr },
            bun_bundler::bundle_v2::BakeOptions {
                framework: bundler_framework,
                client_transpiler: NonNull::new(client_ptr).expect("stack-owned transpiler"),
                ssr_transpiler: NonNull::new(ssr_ptr).expect("stack-owned transpiler"),
                plugins: options
                    .bundler_options
                    .plugin
                    .as_ref()
                    .map(|plugin| plugin.as_non_null()),
            },
            &options.arena,
            Some(NonNull::from(&mut any_loop)),
        ) {
            Ok(outputs) => outputs,
            // The bundler's diagnostics are in the log; `BuildFailed` with an empty log stays an internal error.
            Err(bun_bundler::Error::BuildFailed)
                if vm.log_ref().is_some_and(bun_ast::Log::has_errors) =>
            {
                print_log(vm);
                return Err(crate::Error::BakeBuildFailed);
            }
            Err(e) => return Err(e.into()),
        }
    };
    if bundled_outputs_list.is_empty() {
        bun_core::prettyln!("done");
        Output::flush();
        return Ok(());
    }

    bun_core::pretty_errorln!("Rendering routes");
    Output::flush();

    // mkdir -p + open.
    let root_dir = match bun_sys::Dir::cwd().make_open_path(b"dist", Default::default()) {
        Ok(dir) => dir,
        Err(err) => {
            Output::err(
                err,
                "could not open output directory {}",
                (bun_core::fmt::quote(&root_dir_path),),
            );
            return Err(crate::Error::BakeBuildFailed);
        }
    };
    let mut output_dir = OutputDir {
        dir: root_dir,
        failed_writes: 0,
    };

    let mut maybe_runtime_file_index: Option<u32> = None;

    let mut css_chunks_count: usize = 0;
    let mut css_chunks_first: usize = 0;

    // Index all bundled outputs.
    // Client files go to disk.
    // Server files get loaded in memory.
    // Populate indexes in `entry_points` to be looked up during prerendering
    let mut module_keys: Vec<OwnedString> = (0..entry_points.files.count())
        .map(|_| OwnedString::new(BunString::dead()))
        .collect();
    let mut output_module_map: StringArrayHashMap<OutputFileIndex> = StringArrayHashMap::default();
    let mut source_maps: StringArrayHashMap<OutputFileIndex> = StringArrayHashMap::default();
    {
        let output_indexes = entry_points.files.values_mut();
        for (i, file) in bundled_outputs_list.iter().enumerate() {
            log!(
                "src_index={:?} side={} src={} dest={} - {:?}\n",
                file.source_index,
                file.side.map(side_name).unwrap_or("null"),
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
                        OutputFileIndex::init(u32::try_from(i).expect("int cast"));
                }
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
                    output_dir.write(file);
                }
                bun_bundler::options::Side::Server => {
                    if ctx.bundler_options.bake_debug_dump_server {
                        output_dir.write(file);
                    }

                    // If the file has a sourcemap, store it so we can put it on
                    // `PerThread` so we can provide sourcemapped stacktraces for
                    // server components.
                    if file.source_map_index != u32::MAX {
                        write_sourcemap_to_disk(file, &bundled_outputs_list, &mut source_maps)?;
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
                                    module_keys[entry_point_index as usize] = OwnedString::new(str);
                                }
                            }

                            log!(
                                "  adding module map entry: output_module_map(bake:/{}) = {}\n",
                                BStr::new(without_prefix),
                                i
                            );

                            let mut key = Vec::with_capacity(6 + without_prefix.len());
                            write!(&mut key, "bake:/{}", BStr::new(without_prefix))
                                .expect("infallible: in-memory write");
                            output_module_map.put(
                                &key,
                                OutputFileIndex::init(u32::try_from(i).expect("int cast")),
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
                write_sourcemap_to_disk(file, &bundled_outputs_list, &mut source_maps)?;
            }
        }
    }
    // Write the runtime file to disk if there are any client chunks
    {
        let Some(runtime_file_index) = maybe_runtime_file_index else {
            Output::panic(format_args!(
                "Runtime file not found. This is an unexpected bug in Bun. Please file a bug report on GitHub."
            ));
        };
        let any_client_chunks = bundled_outputs_list.iter().any(|file| {
            file.side == Some(bun_bundler::options::Side::Client)
                && file.src_path.text != b"bun-framework-react/client.tsx"
        });
        if any_client_chunks {
            output_dir.write(&bundled_outputs_list[runtime_file_index as usize]);
        }
    }
    if output_dir.failed_writes > 0 {
        // Every failed write has been reported; the pages would only reference the missing files.
        return Err(crate::Error::BakeBuildFailed);
    }

    *pt = PerThread::init(
        vm_ptr,
        entry_points,
        bundled_outputs_list,
        module_keys,
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
            let mut url = BunString::create_format(format_args!(
                "{}{}",
                BStr::new(public_path),
                BStr::new(&pt.output_file(client_file).dest_path),
            ));
            let url = jsc::bun_string_jsc::transfer_to_js(&mut url, global).map_err(js_err)?;
            client_entry_urls
                .put_index(global, u32::try_from(i).expect("int cast"), url)
                .map_err(js_err)?;
        } else {
            client_entry_urls
                .put_index(global, u32::try_from(i).expect("int cast"), JSValue::NULL)
                .map_err(js_err)?;
        }

        let server_file = router_type.server_file;
        let server_entry_point = pt.load_bundled_module(server_file)?;
        let server_render_func =
            c::bake_get_on_module_namespace(global, server_entry_point, b"prerender")
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
            return Err(crate::Error::BakeBuildFailed);
        }

        let server_param_func = if router.dynamic_routes.count() > 0 {
            let f = c::bake_get_on_module_namespace(global, server_entry_point, b"getParams")
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
                return Err(crate::Error::BakeBuildFailed);
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

    let mut navigatable_routes: Vec<framework_router::RouteIndex> = Vec::new();
    for (i, route) in router.routes.iter().enumerate() {
        if route.file_page.is_none() {
            continue;
        }
        navigatable_routes.push(framework_router::RouteIndex::init(
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
        let mut url = BunString::create_format(format_args!(
            "{}{}",
            BStr::new(public_path),
            BStr::new(&output_file.dest_path),
        ));
        css_chunk_js_strings.push(
            jsc::bun_string_jsc::transfer_to_js(&mut url, global)
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
        // defer params_buf.clearRetainingCapacity()
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
        let mut next: Option<framework_router::RouteIndex> = Some(route_index);
        while let Some(current_index) = next {
            let current = router.route_ptr(current_index);
            pattern.prepend_part(current.part);
            match current.part {
                framework_router::Part::Param(name) | framework_router::Part::CatchAll(name) => {
                    params_buf.push(name);
                }
                framework_router::Part::CatchAllOptional(_) => {
                    return Err(js_err(global.throw(format_args!(
                        "catch-all routes are not supported in static site generation",
                    ))));
                }
                framework_router::Part::Text(_) | framework_router::Part::Group(_) => {}
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
        // The page and every layout are separate entry points; all must be static.
        let mut fully_static = pt
            .output_file(main_file_route_index)
            .bake_extra
            .route
            .is_fully_static();
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
            fully_static &= pt.output_file(file).bake_extra.route.is_fully_static();
            file_list
                .put_index(
                    global,
                    file_count,
                    pt.preload_bundled_module(file).map_err(js_err)?,
                )
                .map_err(js_err)?;
            for r#ref in pt.output_file(file).referenced_css_chunks.iter() {
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
                fully_static &= pt.output_file(file).bake_extra.route.is_fully_static();
                file_list
                    .put_index(
                        global,
                        file_count,
                        pt.preload_bundled_module(file).map_err(js_err)?,
                    )
                    .map_err(js_err)?;
                for r#ref in pt.output_file(file).referenced_css_chunks.iter() {
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
        let mut pattern_string = BunString::clone_utf8(pattern.slice());
        route_patterns
            .put_index(
                global,
                u32::try_from(nav_index).expect("int cast"),
                jsc::bun_string_jsc::transfer_to_js(&mut pattern_string, global).map_err(js_err)?,
            )
            .map_err(js_err)?;

        let mut src_path = BunString::clone_utf8(resolve_path::relative(
            cwd,
            pt.input_file(main_file_route_index).abs_path(),
        ));
        route_source_files
            .put_index(
                global,
                u32::try_from(nav_index).expect("int cast"),
                jsc::bun_string_jsc::transfer_to_js(&mut src_path, global).map_err(js_err)?,
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
                    TypeAndFlags::new(route.r#type.get(), fully_static).bits(),
                ),
            )
            .map_err(js_err)?;

        if !params_buf.is_empty() {
            // reverse-index fill ≡ forward fill over `.iter().rev()`
            // (slice iterators are ExactSize + DoubleEnded).
            let param_info_array =
                JSValue::create_array_from_iter(global, params_buf.iter().rev(), |param| {
                    jsc::bun_string_jsc::create_utf8_for_js(global, param)
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
            BunString::init(&*root_dir_path),
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

/// Must be run outside of the event loop; failures are returned as `JSError`.
fn load_module(
    vm: *mut VirtualMachine,
    global: &JSGlobalObject,
    key: JSValue,
) -> crate::Result<JSValue> {
    let promise_value = c::bake_load_module_by_key(global, key).map_err(js_err)?;
    let promise: *mut jsc::JSInternalPromise = match promise_value.as_any_promise().unwrap() {
        AnyPromise::Internal(p) => p,
        AnyPromise::Normal(_) => unreachable!(),
    };
    // S012: `JSInternalPromise` (= `JSPromise`) is an `opaque_ffi!` ZST —
    // safe `*mut → &mut` deref via the const-asserted accessor.
    jsc::JSInternalPromise::opaque_mut(promise).set_handled();
    // Note: we take `*mut VirtualMachine` (not `&VirtualMachine`) so the provenance
    // permits mutation — casting a `&T` to `*mut T` and writing through it is
    // UB. The raw pointer flows from `VirtualMachine::init_bake` unchanged.
    //
    let _ = vm;
    let vm_ref = VirtualMachine::get();
    vm_ref
        .as_mut()
        .wait_for_promise(AnyPromise::Internal(promise))
        .map_err(|stopped| js_err(stopped.throw(vm_ref.global())))?;
    // TODO: Specially draining microtasks here because `waitForPromise` has a
    //       bug which forgets to do it, but I don't want to fix it right now as it
    //       could affect a lot of the codebase. This should be removed.
    vm_ref
        .event_loop_mut()
        .drain_microtasks()
        .map_err(|stopped| js_err(stopped.throw(vm_ref.global())))?;
    let jsc_vm = vm_ref.as_mut().jsc_vm_mut();
    match jsc::JSInternalPromise::opaque_mut(promise).unwrap(jsc_vm, UnwrapMode::MarkHandled) {
        Unwrapped::Pending => unreachable!(),
        Unwrapped::Fulfilled(_) => c::bake_get_module_namespace(global, key).map_err(js_err),
        Unwrapped::Rejected(err) => Err(js_err(vm_ref.global().throw_value(err))),
    }
}

/// BakeSourceProvider.cpp entry points; each returns empty iff it threw (`from_js_host_call`).
mod c {
    use super::*;

    unsafe extern "C" {
        safe fn BakeLoadModuleByKey(global: &JSGlobalObject, key: JSValue) -> JSValue;
        safe fn BakeGetModuleNamespace(global: &JSGlobalObject, key: JSValue) -> JSValue;
        safe fn BakeGetDefaultExportFromModule(global: &JSGlobalObject, key: JSValue) -> JSValue;
        /// Not `safe`: `ptr` must be readable for `len` bytes.
        fn BakeGetOnModuleNamespace(
            global: &JSGlobalObject,
            module_namespace: JSValue,
            ptr: *const u8,
            len: usize,
        ) -> JSValue;
    }

    /// Returns the promise for evaluating the module that `key` (a JSString) names.
    pub(super) fn bake_load_module_by_key(
        global: &JSGlobalObject,
        key: JSValue,
    ) -> JsResult<JSValue> {
        jsc::from_js_host_call(global, || BakeLoadModuleByKey(global, key))
    }

    /// The promise from [`bake_load_module_by_key`] for `key` must already be fulfilled.
    pub(super) fn bake_get_module_namespace(
        global: &JSGlobalObject,
        key: JSValue,
    ) -> JsResult<JSValue> {
        jsc::from_js_host_call(global, || BakeGetModuleNamespace(global, key))
    }

    /// The module `key` names must already be evaluated (here: the config module).
    pub(super) fn bake_get_default_export_from_module(
        global: &JSGlobalObject,
        key: JSValue,
    ) -> JsResult<JSValue> {
        jsc::from_js_host_call(global, || BakeGetDefaultExportFromModule(global, key))
    }

    pub(super) fn bake_get_on_module_namespace(
        global: &JSGlobalObject,
        module_namespace: JSValue,
        property: &[u8],
    ) -> JsResult<JSValue> {
        // SAFETY: `property` is borrowed for the whole call, so `ptr` is readable for `len` bytes.
        jsc::from_js_host_call(global, || unsafe {
            BakeGetOnModuleNamespace(global, module_namespace, property.as_ptr(), property.len())
        })
    }
}

// Renders all routes for static site generation by calling the JavaScript implementation.
// All args are by-value `JSValue`/`BunString` plus a live `&JSGlobalObject`
// (UnsafeCell-backed); C++ allocates and returns a non-null `JSPromise*`.
// No caller-side precondition for the call itself — declare `safe fn`.
unsafe extern "C" {
    safe fn BakeRenderRoutesForProdStatic(
        global: &JSGlobalObject,
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

/// Inverse of `resolve_disk_key`; never a `\\?\` path, since the module loader cuts specifiers at the first `?`.
#[unsafe(no_mangle)]
extern "C" fn BakeToWindowsPath(input: BunString) -> BunString {
    #[cfg(not(windows))]
    {
        let _ = input;
        panic!("This code should not be called on POSIX systems.");
    }
    #[cfg(windows)]
    {
        let input_utf8 = input.to_utf8();
        let mut path = key_path_to_disk_path(input_utf8.slice()).to_vec();
        resolve_path::slashes_to_windows_in_place(&mut path);
        BunString::clone_utf8(&path)
    }
}

/// `/C:/a/b.mjs` -> `C:/a/b.mjs`; anything else is returned as is.
#[cfg(windows)]
fn key_path_to_disk_path(key_path: &[u8]) -> &[u8] {
    match key_path.strip_prefix(b"/") {
        Some(rest) if strings::starts_with_windows_drive_letter(rest) => rest,
        _ => key_path,
    }
}

/// Drive or UNC path, as opposed to a bundle output path like `/_bun/abc123.js`.
#[cfg(windows)]
fn is_disk_path(path: &[u8]) -> bool {
    resolve_path::windows_volume_name_len(path).0 > 0 && bun_paths::is_absolute(path)
}

/// Keys a file outside the bundle by disk path (`bake:/C:/a/b.mjs`, `bake://server/share/b.mjs`), a fixed point under re-resolution; `None` when neither side is a disk path.
#[cfg(windows)]
fn resolve_disk_key(
    global: &JSGlobalObject,
    referrer_key_path: &[u8],
    specifier: &[u8],
) -> Option<BunString> {
    let referrer = key_path_to_disk_path(referrer_key_path);
    let specifier = key_path_to_disk_path(specifier);
    if !is_disk_path(referrer) && !is_disk_path(specifier) {
        return None;
    }

    let dir = bun_paths::Dirname::dirname(referrer).unwrap_or(referrer);
    let mut buf = bun_paths::path_buffer_pool::get();
    let Some(resolved) = resolve_path::join_abs_string_buf_checked::<platform::Windows>(
        dir,
        &mut buf[..],
        &[specifier],
    ) else {
        let _ = global.throw(format_args!(
            "Cannot import {}: the resolved path is too long",
            bun_core::fmt::quote(specifier),
        ));
        return Some(BunString::dead());
    };
    let resolved_len = resolved.len();
    let resolved = &mut buf[..resolved_len];
    resolve_path::slashes_to_posix_in_place(resolved);

    let slash = if strings::starts_with_windows_drive_letter(resolved) {
        "/"
    } else {
        ""
    };
    Some(BunString::create_format(format_args!(
        "bake:{slash}{}",
        BStr::new(resolved)
    )))
}

#[unsafe(no_mangle)]
extern "C" fn BakeProdResolve(
    global: &JSGlobalObject,
    a_str: BunString,
    specifier_str: BunString,
) -> BunString {
    let specifier = specifier_str.to_utf8();

    if let Some(alias) = bun_resolve_builtins::Alias::get(
        specifier.slice(),
        bun_ast::Target::Bun,
        bun_resolve_builtins::Cfg::default(),
    ) {
        return BunString::static_(alias.path.as_bytes());
    }

    let referrer = a_str.to_utf8();

    if resolver::is_package_path(specifier.slice()) {
        let _ = global.throw(format_args!(
            "Non-relative import {} from {} are not allowed in production assets. This is a bug in Bun's bundler",
            bun_core::fmt::quote(specifier.slice()),
            bun_core::fmt::quote(referrer.slice()),
        ));
        return BunString::dead();
    }

    debug_assert!(strings::has_prefix(referrer.slice(), b"bake:"));
    let referrer_key_path = &referrer.slice()[5..];

    #[cfg(windows)]
    if let Some(key) = resolve_disk_key(global, referrer_key_path, specifier.slice()) {
        return key;
    }

    // dirname semantics: returns None for the root / no-parent.
    let dir = bun_paths::Dirname::dirname(referrer_key_path).unwrap_or(referrer_key_path);

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
///
/// Canonical definition lives in `bun_bundler::bake_types::production` (lower
/// tier) so the bundler and runtime share ONE nominal type. Re-exported here
/// for `bake::production::EntryPointMap` callers.
pub use bun_bundler::bake_types::production::EntryPointMap;
use bun_bundler::bake_types::production::{EntryPointHashMap, InputFile};

/// Route scan callbacks for `bun build --app`; counts the reported errors so the build can fail.
struct RouteScan<'a> {
    entry_points: &'a mut EntryPointMap,
    error_count: usize,
}

impl framework_router::InsertionHandler for RouteScan<'_> {
    fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: framework_router::RouteIndex,
        _: framework_router::FileKind,
    ) -> Result<OpaqueFileId, bun_alloc::AllocError> {
        self.entry_points
            .get_or_put_entry_point(abs_path, bake::Side::Server)
            .map(|id| OpaqueFileId::init(id.get()))
            .map_err(|_| bun_alloc::AllocError)
    }

    fn on_router_syntax_error(
        &mut self,
        rel_path: &[u8],
        fail: framework_router::TinyLog,
    ) -> Result<(), bun_alloc::AllocError> {
        fail.print(rel_path);
        self.error_count += 1;
        Ok(())
    }

    fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: framework_router::FileKind,
    ) -> Result<(), bun_alloc::AllocError> {
        bun_core::err_generic!(
            "Multiple {} matching the same route pattern is ambiguous",
            ty.collision_noun()
        );
        bun_core::pretty_errorln!("  - <blue>{}<r>", BStr::new(rel_path));
        bun_core::pretty_errorln!(
            "  - <blue>{}<r>",
            BStr::new(resolve_path::relative(
                &self.entry_points.root,
                self.entry_points.files.keys()[other_id.get() as usize].abs_path()
            ))
        );
        Output::flush();
        self.error_count += 1;
        Ok(())
    }
}

/// Data used on each rendering thread. Contains all information in the bundle needed to render.
/// This is referred to as `pt` in variable/field naming, and Bake::ProductionPerThread in C++
///
/// Owns the backing storage so the value can outlive `build_with_vm` in the
/// caller's frame without dangling references.
pub struct PerThread {
    // Shared Data (owned)
    /// Owns `input_files` (keys) and `output_indexes` (values).
    pub(crate) entry_points: EntryPointMap,
    pub(crate) bundled_outputs: Vec<OutputFile>,
    /// Indexed by entry point index (OpaqueFileId)
    pub(crate) module_keys: Vec<OwnedString>,
    /// Unordered
    pub(crate) module_map: StringArrayHashMap<OutputFileIndex>,
    pub(crate) source_maps: StringArrayHashMap<OutputFileIndex>,

    // Thread-local
    pub(crate) vm: bun_ptr::BackRef<VirtualMachine, bun_ptr::Mut>,
    /// Indexed by entry point index (OpaqueFileId)
    pub(crate) loaded_files: AutoBitSet,
    /// JSArray of JSString, indexed by entry point index (OpaqueFileId)
    // Strong is required for JSValue struct fields. `None` is the pre-init
    // state; `PerThread::init` fills it. Strong's Drop releases the GC root.
    pub(crate) all_server_files: Option<bun_jsc::Strong>,
    /// `attach()` was called and Drop should detach. The placeholder created in
    /// `build_command` before `init` must not call into C++ on drop.
    attached: bool,
}

// C++ treats `PerThread` as an opaque pointer (Bake::ProductionPerThread*); the Rust
// layout is irrelevant across the FFI boundary, so silence the improper_ctypes lint.
// C++ stores `pt` opaquely on the global (never dereferenced C++-side; null
// detaches), so the call has no precondition beyond a live `&JSGlobalObject`
// — declare `safe fn`.
#[allow(improper_ctypes)]
unsafe extern "C" {
    safe fn BakeGlobalObject__attachPerThreadData(global: &JSGlobalObject, pt: *mut PerThread);
}

impl PerThread {
    /// Safe `&VirtualMachine` accessor for the JSC_BORROW `vm` back-pointer.
    #[inline]
    pub(crate) fn vm(&self) -> &VirtualMachine {
        // BackRef invariant: VM outlives `PerThread` (set in `init`/`placeholder`
        // from `init_bake`).
        self.vm.get()
    }

    /// Safe `&'static JSGlobalObject` accessor — `self.vm().global()`.
    #[inline]
    pub fn global(&self) -> &'static JSGlobalObject {
        self.vm().global()
    }

    /// Empty placeholder used in `build_command` before `build_with_vm` fills it.
    fn placeholder(vm: *mut VirtualMachine) -> PerThread {
        PerThread {
            entry_points: EntryPointMap::default(),
            bundled_outputs: Vec::new(),
            module_keys: Vec::new(),
            module_map: StringArrayHashMap::default(),
            source_maps: StringArrayHashMap::default(),
            // SAFETY: `vm` is the live per-thread VM from `init_bake` (non-null,
            // write provenance); outlives `PerThread`.
            vm: unsafe { bun_ptr::BackRef::from_raw_mut(vm) },
            loaded_files: AutoBitSet::init_empty(0).expect("unreachable"),
            all_server_files: None,
            attached: false,
        }
    }

    /// After initializing, call `attach`
    pub(crate) fn init(
        vm: *mut VirtualMachine,
        entry_points: EntryPointMap,
        bundled_outputs: Vec<OutputFile>,
        module_keys: Vec<OwnedString>,
        module_map: StringArrayHashMap<OutputFileIndex>,
        source_maps: StringArrayHashMap<OutputFileIndex>,
    ) -> crate::Result<PerThread> {
        let n = entry_points.files.count();
        let loaded_files = AutoBitSet::init_empty(n)?;
        // errdefer loaded_files.deinit() — handled by Drop on error path

        // SAFETY: BackRef invariant — vm is the live per-thread VM from `init_bake`
        // (non-null, write provenance); outlives PerThread.
        let vm = unsafe { bun_ptr::BackRef::from_raw_mut(vm) };
        let global = vm.global();
        let all_server_files = Some(bun_jsc::Strong::create(
            JSValue::create_empty_array(global, n).map_err(js_err)?,
            global,
        ));

        Ok(PerThread {
            entry_points,
            bundled_outputs,
            module_keys,
            module_map,
            source_maps,
            vm,
            loaded_files,
            all_server_files,
            attached: false,
        })
    }

    pub(crate) fn attach(&mut self) {
        // `self.global()` derefs the JSC_BORROW `vm` back-pointer (live for the
        // VM lifetime); C++ stores `pt` opaquely and hands it back via
        // `BakeProdResolve`, so passing `from_mut(self)` is just identity —
        // detached in Drop.
        let global = self.global();
        BakeGlobalObject__attachPerThreadData(global, std::ptr::from_mut::<PerThread>(self));
        self.attached = true;
    }

    pub(crate) fn output_index(&self, id: OpaqueFileId) -> OutputFileIndex {
        self.entry_points.files.values()[id.get() as usize]
    }

    pub(crate) fn input_file(&self, id: OpaqueFileId) -> InputFile {
        self.entry_points.files.keys()[id.get() as usize]
    }

    pub(crate) fn output_file(&self, id: OpaqueFileId) -> &OutputFile {
        &self.bundled_outputs[self.output_index(id).get() as usize]
    }

    // Must be run at the top of the event loop
    pub(crate) fn load_bundled_module(&self, id: OpaqueFileId) -> crate::Result<JSValue> {
        let global = self.global();
        load_module(
            self.vm.as_ptr(),
            global,
            self.module_keys[id.get() as usize]
                .to_js(global)
                .map_err(js_err)?,
        )
    }

    /// The JSString entries in `all_server_files` is generated lazily. When
    /// multiple rendering threads are used, unreferenced files will contain
    /// holes in the array used. Returns a JSValue of the "FileIndex" type
    //
    // What could be done here is generating a new index type, which is
    // specifically for referenced files. This would remove the holes, but make
    // it harder to pre-allocate. It's probably worth it.
    pub(crate) fn preload_bundled_module(&mut self, id: OpaqueFileId) -> JsResult<JSValue> {
        let global = self.global();
        if !self.loaded_files.is_set(id.get() as usize) {
            self.loaded_files.set(id.get() as usize);
            self.all_server_files.as_ref().unwrap().get().put_index(
                global,
                id.get(),
                self.module_keys[id.get() as usize].to_js(global)?,
            )?;
        }

        Ok(JSValue::js_number_from_int32(
            i32::try_from(id.get()).expect("int cast"),
        ))
    }
}

impl Drop for PerThread {
    fn drop(&mut self) {
        if self.attached {
            // Passing null detaches the previously-attached pointer; `global()`
            // goes through the safe `vm()` accessor (VM outlives PerThread).
            BakeGlobalObject__attachPerThreadData(self.global(), core::ptr::null_mut());
        }
        // `all_server_files: Strong` is dropped automatically, releasing the GC root.
    }
}

/// Given a key, returns the source code to load.
#[unsafe(no_mangle)]
extern "C" fn BakeProdLoad(pt: *mut PerThread, key: BunString) -> BunString {
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    log!("BakeProdLoad: {}\n", BStr::new(utf8.slice()));
    if let Some(value) = pt.module_map.get(utf8.slice()) {
        log!("  found in module_map: {}\n", BStr::new(utf8.slice()));
        // Zero-copy: alias the chunk bytes; `pt.bundled_outputs` owns them for
        // the lifetime of the attached `PerThread` (see `Value::to_bun_string_ref`).
        return pt.bundled_outputs[value.get() as usize]
            .value
            .to_bun_string_ref();
    }
    BunString::dead()
}

#[unsafe(no_mangle)]
extern "C" fn BakeProdSourceMap(pt: *mut PerThread, key: BunString) -> BunString {
    // SAFETY: `pt` is the non-null pointer previously attached via
    // BakeGlobalObject__attachPerThreadData; C++ only calls this while attached.
    let pt = unsafe { &*pt };
    let utf8 = key.to_utf8();
    if let Some(value) = pt.source_maps.get(utf8.slice()) {
        return pt.bundled_outputs[value.get() as usize]
            .value
            .to_bun_string_ref();
    }
    BunString::dead()
}

/// Packed: type (u8) | no_client (bool, 1 bit) | unused (u23)
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct TypeAndFlags(i32);

impl TypeAndFlags {
    pub(crate) const fn new(ty: u8, no_client: bool) -> Self {
        // type: bits 0..8, no_client: bit 8, unused: bits 9..32
        TypeAndFlags((ty as i32) | ((no_client as i32) << 8))
    }

    pub(crate) const fn bits(self) -> i32 {
        self.0
    }
}

// `fn @"export"()` force-reference block dropped — Rust links what's `pub`.
