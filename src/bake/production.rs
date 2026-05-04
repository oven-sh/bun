//! Implements building a Bake application to production

use core::ffi::c_char;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::Arena;
use bun_bake as bake;
use bun_bake::framework_router::{self as framework_router, FrameworkRouter, OpaqueFileId};
use bun_bake::PatternBuffer;
use bun_bundler::options::{self as bundler_options, OutputFile, SourceMapOption};
use bun_bundler::BundleV2;
use bun_cli::Command;
use bun_collections::{ArrayHashMap, AutoBitSet};
use bun_core::{self as bun, Global, Output};
use bun_dotenv as dotenv;
use bun_http::AsyncHTTP;
use bun_jsc::{self as jsc, JSGlobalObject, JSModuleLoader, JSPromise, JSValue, JsResult, VirtualMachine};
use bun_paths::{self as path, PathBuffer};
use bun_resolver as resolver;
use bun_str::{self as bstr_mod, strings, String as BunString};
use bun_transpiler::Transpiler;

bun_output::declare_scope!(production, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(production, $($arg)*) };
}

pub fn build_command(ctx: Command::Context) -> Result<(), bun_core::Error> {
    bake::print_warning();

    if ctx.args.entry_points.len() > 1 {
        Output::err_generic("bun build --app only accepts one entrypoint");
        Global::crash();
    }

    if ctx.debug.hot_reload != HotReload::None {
        Output::err_generic("Instead of using --watch, use 'bun run'");
        Global::crash();
    }

    let mut cwd_buf = PathBuffer::uninit();
    let cwd = match bun_sys::getcwd(&mut cwd_buf) {
        Ok(c) => c,
        Err(err) => {
            Output::err(err, "Could not query current working directory");
            Global::crash();
        }
    };

    // Create a VM + global for loading the config file, plugins, and
    // performing build time prerendering.
    jsc::initialize(false);
    bun_js_parser::Expr::Data::Store::create();
    bun_js_parser::Stmt::Data::Store::create();

    // PERF(port): was MimallocArena bulk-free for VM allocations — profile in Phase B
    let mut arena = Arena::new();

    // TODO(port): VirtualMachine::initBake takes an allocator/arena in Zig; Rust signature TBD
    let vm = VirtualMachine::init_bake(VirtualMachine::InitBakeOptions {
        allocator: &arena,
        log: ctx.log,
        args: ctx.args,
        smol: ctx.runtime_options.smol,
    })?;
    // `vm.deinit()` handled by Drop on the returned VM guard
    // TODO(port): confirm VirtualMachine ownership/Drop semantics

    // A special global object is used to allow registering virtual modules
    // that bypass Bun's normal module resolver and plugin system.
    vm.regular_event_loop.global = vm.global;
    vm.event_loop.ensure_waker();
    let b = &mut vm.transpiler;
    vm.preload = ctx.preloads;
    vm.argv = ctx.passthrough;
    // TODO(port): vm.arena / vm.allocator wiring — Zig stored &arena and arena.allocator()
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
    b.options.env.behavior = EnvBehavior::LoadAllWithoutInlining;
    vm.event_loop.ensure_waker();
    match ctx.debug.macros {
        Macros::Disable => {
            b.options.no_macros = true;
        }
        Macros::Map(macros) => {
            b.options.macro_remap = macros;
        }
        Macros::Unspecified => {}
    }
    if b.configure_defines().is_err() {
        bun_bun_js::fail_with_build_error(vm);
    }
    AsyncHTTP::load_env(vm.log, b.env);
    vm.load_extra_env_and_source_code_printer();
    vm.is_main_thread = true;
    VirtualMachine::set_is_main_thread_vm(true);

    let api_lock = vm.jsc_vm.get_api_lock();
    // api_lock.release() on Drop

    let mut pt = PerThread {
        input_files: &[],
        bundled_outputs: &[],
        output_indexes: &[],
        module_keys: &[],
        module_map: ArrayHashMap::default(),
        source_maps: ArrayHashMap::default(),

        vm,
        loaded_files: AutoBitSet::init_empty(0).expect("unreachable"),
        all_server_files: bun_jsc::Strong::empty(),
    };

    match build_with_vm(ctx, cwd, vm, &mut pt) {
        Ok(()) => {}
        Err(err) if err == bun_core::err!("JSError") => {
            bun_core::handle_error_return_trace(err);
            let err_value = vm.global.take_exception(err);
            vm.print_error_like_object_to_console(err_value.to_error().unwrap_or(err_value));
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

pub fn write_sourcemap_to_disk(
    file: &OutputFile,
    bundled_outputs: &[OutputFile],
    source_maps: &mut ArrayHashMap<Box<[u8]>, OutputFile::Index>,
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
        OutputFile::Index::init(u32::try_from(source_map_index).unwrap()),
    )?;
    Ok(())
}

pub fn build_with_vm(
    ctx: Command::Context,
    cwd: &[u8],
    vm: &VirtualMachine,
    pt: &mut PerThread,
) -> Result<(), bun_core::Error> {
    // Load and evaluate the configuration module
    let global = vm.global;
    let b = &mut vm.transpiler;

    Output::pretty_errorln("Loading configuration");
    Output::flush();
    let mut unresolved_config_entry_point: Vec<u8> = if ctx.args.entry_points.len() > 0 {
        ctx.args.entry_points[0].to_vec()
    } else {
        b"./bun.app".to_vec()
    };
    if resolver::is_package_path(&unresolved_config_entry_point) {
        let mut buf = Vec::with_capacity(2 + unresolved_config_entry_point.len());
        write!(&mut buf, "./{}", BStr::new(&unresolved_config_entry_point)).unwrap();
        unresolved_config_entry_point = buf;
    }

    let config_entry_point = match b.resolver.resolve(
        cwd,
        &unresolved_config_entry_point,
        ImportKind::EntryPointBuild,
    ) {
        Ok(r) => r,
        Err(err) => {
            if err == bun_core::err!("ModuleNotFound") {
                if ctx.args.entry_points.len() == 0 {
                    // Onboarding message
                    Output::err(
                        err,
                        "'bun build --app' cannot find your application's config file\n\
                         \n\
                         The default location for this is `bun.app.ts`\n\
                         \n\
                         TODO: insert a link to `bun.com/docs`",
                    );
                    Global::crash();
                }
            }

            Output::err_fmt(
                err,
                format_args!(
                    "could not resolve application config file '{}'",
                    BStr::new(&unresolved_config_entry_point)
                ),
            );
            Global::crash();
        }
    };

    let config_entry_point_string =
        BunString::clone_utf8(&config_entry_point.path_const().unwrap().text);
    // .deref() on Drop

    let Some(config_promise) =
        JSModuleLoader::load_and_evaluate_module(global, &config_entry_point_string)
    else {
        debug_assert!(global.has_exception());
        return Err(bun_core::err!("JSError"));
    };

    config_promise.set_handled();
    vm.wait_for_promise(jsc::AnyPromise::Internal(config_promise));
    let mut options = match config_promise.unwrap(vm.jsc_vm, jsc::PromiseUnwrap::MarkHandled) {
        jsc::PromiseResult::Pending => unreachable!(),
        jsc::PromiseResult::Fulfilled(_) => 'config: {
            // SAFETY: FFI call; vm.global is a live &JSGlobalObject and the key JSValue
            // was just produced by .to_js() so it is rooted on the stack for this call.
            let default = unsafe {
                BakeGetDefaultExportFromModule(vm.global, config_entry_point_string.to_js(vm.global)?)
            };

            if !default.is_object() {
                return global.throw_invalid_arguments(
                    "Your config file's default export must be an object.\n\
                     \n\
                     Example:\n\
                     \x20 export default {\n\
                     \x20   app: {\n\
                     \x20     framework: \"react\",\n\
                     \x20   }\n\
                     \x20 }\n\
                     \n\
                     Learn more at https://bun.com/docs/ssg",
                );
            }

            let Some(app) = default.get(vm.global, "app")? else {
                return global.throw_invalid_arguments(
                    "Your config file's default export must contain an \"app\" property.\n\
                     \n\
                     Example:\n\
                     \x20 export default {\n\
                     \x20   app: {\n\
                     \x20     framework: \"react\",\n\
                     \x20   }\n\
                     \x20 }\n\
                     \n\
                     Learn more at https://bun.com/docs/ssg",
                );
            };

            break 'config bake::UserOptions::from_js(app, vm.global)?;
        }
        jsc::PromiseResult::Rejected(err) => {
            return global.throw_value(err.to_error().unwrap_or(err));
        }
    };

    let framework = &mut options.framework;

    let separate_ssr_graph = if let Some(sc) = &framework.server_components {
        sc.separate_ssr_graph
    } else {
        false
    };

    // this is probably wrong
    let map = Box::new(dotenv::Map::init());
    let map = Box::leak(map);
    let loader = Box::new(dotenv::Loader::init(map));
    let loader = Box::leak(loader);
    loader.map.put(b"NODE_ENV", b"production")?;
    dotenv::set_instance(loader);

    // Zig: `var client_transpiler: Transpiler = undefined;` — uninitialized out-param,
    // filled by `initTranspilerWithOptions`. Transpiler is not #[repr(C)] POD, so
    // `zeroed()` is UB; use MaybeUninit per PORTING.md out-param-constructor rule.
    // TODO(port): in-place init — `init_transpiler_with_options` writes through these;
    // downstream `&mut client_transpiler` uses need `.assume_init_mut()` once Phase B
    // confirms the init contract (or refactor to `-> Result<Transpiler, _>`).
    let mut client_transpiler = core::mem::MaybeUninit::<Transpiler>::uninit();
    let mut server_transpiler = core::mem::MaybeUninit::<Transpiler>::uninit();
    let mut ssr_transpiler = core::mem::MaybeUninit::<Transpiler>::uninit();
    framework.init_transpiler_with_options(
        vm.log,
        bake::Mode::ProductionStatic,
        bake::Graph::Server,
        &mut server_transpiler,
        &mut options.bundler_options.server,
        SourceMapOption::from_api(options.bundler_options.server.source_map),
        options.bundler_options.server.minify_whitespace,
        options.bundler_options.server.minify_syntax,
        options.bundler_options.server.minify_identifiers,
    )?;
    framework.init_transpiler_with_options(
        vm.log,
        bake::Mode::ProductionStatic,
        bake::Graph::Client,
        &mut client_transpiler,
        &mut options.bundler_options.client,
        SourceMapOption::from_api(options.bundler_options.client.source_map),
        options.bundler_options.client.minify_whitespace,
        options.bundler_options.client.minify_syntax,
        options.bundler_options.client.minify_identifiers,
    )?;
    if separate_ssr_graph {
        framework.init_transpiler_with_options(
            vm.log,
            bake::Mode::ProductionStatic,
            bake::Graph::Ssr,
            &mut ssr_transpiler,
            &mut options.bundler_options.ssr,
            SourceMapOption::from_api(options.bundler_options.ssr.source_map),
            options.bundler_options.ssr.minify_whitespace,
            options.bundler_options.ssr.minify_syntax,
            options.bundler_options.ssr.minify_identifiers,
        )?;
    }

    if ctx.bundler_options.bake_debug_disable_minify {
        for transpiler in [&mut client_transpiler, &mut server_transpiler, &mut ssr_transpiler] {
            transpiler.options.minify_syntax = false;
            transpiler.options.minify_identifiers = false;
            transpiler.options.minify_whitespace = false;
            transpiler.resolver.opts.entry_naming = b"_bun/[dir]/[name].[hash].[ext]";
            transpiler.resolver.opts.chunk_naming = b"_bun/[dir]/[name].[hash].chunk.[ext]";
            transpiler.resolver.opts.asset_naming = b"_bun/[dir]/[name].[hash].asset.[ext]";
        }
    }

    // these share pointers right now, so setting NODE_ENV == production on one should affect all
    debug_assert!(core::ptr::eq(server_transpiler.env, client_transpiler.env));

    *framework = match framework.resolve(&mut server_transpiler.resolver, &mut client_transpiler.resolver) {
        Ok(f) => f,
        Err(_) => {
            if framework.is_built_in_react {
                bake::Framework::add_react_install_command_note(server_transpiler.log)?;
            }
            Output::err_generic("Failed to resolve all imports required by the framework");
            Output::flush();
            let _ = server_transpiler.log.print(Output::error_writer());
            Global::crash();
        }
    };

    Output::pretty_errorln("Bundling routes");
    Output::flush();

    // trailing slash
    let public_path: &[u8] = b"/";

    let mut root_dir_buf = PathBuffer::uninit();
    let root_dir_path = path::join_abs_string_buf(cwd, &mut root_dir_buf, &[b"dist"], path::Style::Auto);

    let mut router_types: Vec<framework_router::Type> =
        Vec::with_capacity(options.framework.file_system_router_types.len());

    let mut entry_points = EntryPointMap {
        root: cwd.into(),
        files: ArrayHashMap::default(),
    };

    for fsr in &options.framework.file_system_router_types {
        let joined_root = path::join_abs(cwd, path::Style::Auto, &fsr.root);
        let Some(entry) = server_transpiler.resolver.read_dir_info_ignore_error(joined_root) else {
            continue;
        };
        router_types.push(framework_router::Type {
            abs_root: strings::without_trailing_slash_windows_path(&entry.abs_path).into(),
            prefix: fsr.prefix.clone(),
            ignore_underscores: fsr.ignore_underscores,
            ignore_dirs: fsr.ignore_dirs.clone(),
            extensions: fsr.extensions.clone(),
            style: fsr.style,
            allow_layouts: fsr.allow_layouts,
            server_file: entry_points.get_or_put_entry_point(&fsr.entry_server, bake::Side::Server)?,
            client_file: if let Some(client) = &fsr.entry_client {
                entry_points
                    .get_or_put_entry_point(client, bake::Side::Client)?
                    .to_optional()
            } else {
                framework_router::OpaqueFileId::Optional::NONE
            },
            server_file_string: BunString::empty(),
        });
    }

    let mut router = FrameworkRouter::init_empty(cwd, &router_types)?;
    router.scan_all(
        &mut server_transpiler.resolver,
        FrameworkRouter::InsertionContext::wrap::<EntryPointMap>(&mut entry_points),
    )?;

    let bundled_outputs_list = BundleV2::generate_from_bake_production_cli(
        &entry_points,
        &mut server_transpiler,
        BundleV2::BakeOptions {
            framework: framework.clone(),
            client_transpiler: &mut client_transpiler,
            ssr_transpiler: if separate_ssr_graph {
                &mut ssr_transpiler
            } else {
                &mut server_transpiler
            },
            plugins: options.bundler_options.plugin,
        },
        jsc::EventLoopHandle::Js(vm.event_loop),
    )?;
    let bundled_outputs = bundled_outputs_list.as_slice();
    if bundled_outputs.is_empty() {
        Output::prettyln("done");
        Output::flush();
        return Ok(());
    }

    Output::pretty_errorln("Rendering routes");
    Output::flush();

    // TODO(port): std.fs.cwd().makeOpenPath — use bun_sys equivalent
    let root_dir = bun_sys::Dir::make_open_path(b"dist")?;
    // root_dir.close() on Drop

    let mut maybe_runtime_file_index: Option<u32> = None;

    let mut css_chunks_count: usize = 0;
    let mut css_chunks_first: usize = 0;

    // Index all bundled outputs.
    // Client files go to disk.
    // Server files get loaded in memory.
    // Populate indexes in `entry_points` to be looked up during prerendering
    let mut module_keys: Box<[BunString]> =
        vec![BunString::dead(); entry_points.files.count()].into_boxed_slice();
    let output_indexes = entry_points.files.values_mut();
    let mut output_module_map: ArrayHashMap<Box<[u8]>, OutputFile::Index> = ArrayHashMap::default();
    let mut source_maps: ArrayHashMap<Box<[u8]>, OutputFile::Index> = ArrayHashMap::default();
    // module_keys already filled with dead above
    for (i, file) in bundled_outputs.iter().enumerate() {
        log!(
            "src_index={:?} side={} src={} dest={} - {:?}\n",
            file.source_index.unwrap(),
            file.side
                .as_ref()
                .map(|s| <&'static str>::from(*s))
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
                    OutputFile::Index::init(u32::try_from(i).unwrap());
            }
        }

        // The output file which contains the runtime (Index.runtime, contains
        // wrapper functions like `__esm`) is marked as server side, but it is
        // also used by client
        if file.bake_extra.bake_is_runtime {
            #[cfg(debug_assertions)]
            {
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
                // Client-side resources will be written to disk for usage in on the client side
                if let Err(err) = file.write_to_disk(&root_dir, b".") {
                    bun_core::handle_error_return_trace(err);
                    Output::err_fmt(
                        err,
                        format_args!(
                            "Failed to write {} to output directory",
                            bun_core::fmt::quote(&file.dest_path)
                        ),
                    );
                }
            }
            bake::Side::Server => {
                if ctx.bundler_options.bake_debug_dump_server {
                    if let Err(err) = file.write_to_disk(&root_dir, b".") {
                        bun_core::handle_error_return_trace(err);
                        Output::err_fmt(
                            err,
                            format_args!(
                                "Failed to write {} to output directory",
                                bun_core::fmt::quote(&file.dest_path)
                            ),
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
                                ))?;
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
                            OutputFile::Index::init(u32::try_from(i).unwrap()),
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
            Output::panic(
                "Runtime file not found. This is an unexpected bug in Bun. Please file a bug report on GitHub.",
            );
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
            if let Err(err) = runtime_file.write_to_disk(&root_dir, b".") {
                bun_core::handle_error_return_trace(err);
                Output::err_fmt(
                    err,
                    format_args!(
                        "Failed to write {} to output directory",
                        bun_core::fmt::quote(&runtime_file.dest_path)
                    ),
                );
            }
        }
    }

    let per_thread_options = PerThreadOptions {
        input_files: entry_points.files.keys(),
        bundled_outputs,
        output_indexes: entry_points.files.values(),
        module_keys: &module_keys,
        module_map: output_module_map,
        source_maps,
    };

    *pt = PerThread::init(vm, per_thread_options)?;
    pt.attach();

    // Static site generator
    let server_render_funcs = JSValue::create_empty_array(global, router.types.len())?;
    let server_param_funcs = JSValue::create_empty_array(global, router.types.len())?;
    let client_entry_urls = JSValue::create_empty_array(global, router.types.len())?;

    for (i, router_type) in router.types.iter().enumerate() {
        if let Some(client_file) = router_type.client_file.unwrap() {
            let str = BunString::create_format(format_args!(
                "{}{}",
                BStr::new(public_path),
                BStr::new(&pt.output_file(client_file).dest_path)
            ))?
            .to_js(global)?;
            client_entry_urls.put_index(global, u32::try_from(i).unwrap(), str)?;
        } else {
            client_entry_urls.put_index(global, u32::try_from(i).unwrap(), JSValue::NULL)?;
        }

        let server_entry_point = pt.load_bundled_module(router_type.server_file)?;
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
            Output::err_generic("Framework does not support static site generation");
            Output::note(format_args!(
                "The file {} is missing the \"prerender\" export, which defines how to generate static files.",
                bun_core::fmt::quote(path::relative(
                    cwd,
                    entry_points.files.keys()[router_type.server_file.get()].abs_path()
                ))
            ));
            Global::crash();
        };

        let server_param_func = if router.dynamic_routes.count() > 0 {
            let opt = 'brk: {
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
            match opt {
                Some(v) => v,
                None => {
                    Output::err_generic("Framework does not support static site generation");
                    Output::note(format_args!(
                        "The file {} is missing the \"getParams\" export, which defines how to generate static files.",
                        bun_core::fmt::quote(path::relative(
                            cwd,
                            entry_points.files.keys()[router_type.server_file.get()].abs_path()
                        ))
                    ));
                    Global::crash();
                }
            }
        } else {
            JSValue::NULL
        };
        server_render_funcs.put_index(global, u32::try_from(i).unwrap(), server_render_func)?;
        server_param_funcs.put_index(global, u32::try_from(i).unwrap(), server_param_func)?;
    }

    let mut navigatable_routes: Vec<framework_router::Route::Index> = Vec::new();
    for (i, route) in router.routes.iter().enumerate() {
        if route.file_page.unwrap().is_none() {
            continue;
        }
        navigatable_routes.push(framework_router::Route::Index::init(u32::try_from(i).unwrap()));
    }

    // JSValue storage must be GC-scannable; a heap `Box<[JSValue]>` is not.
    // TODO(port): confirm bun_jsc::MarkedArgumentBuffer API (append / at) — Phase B
    let mut css_chunk_js_strings = bun_jsc::MarkedArgumentBuffer::new();
    for output_file in bundled_outputs[css_chunks_first..][..css_chunks_count].iter() {
        debug_assert!(output_file.dest_path[0] != b'.');
        // CSS chunks must be in contiguous order!!
        debug_assert!(output_file.loader.is_css());
        css_chunk_js_strings.append(
            BunString::create_format(format_args!(
                "{}{}",
                BStr::new(public_path),
                BStr::new(&output_file.dest_path)
            ))?
            .to_js(global)?,
        );
    }
    debug_assert_eq!(css_chunk_js_strings.len(), css_chunks_count);

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
    for (nav_index, route_index) in navigatable_routes.iter().enumerate() {
        // PORT NOTE: defer params_buf.clearRetainingCapacity() moved to end of loop body

        let mut pattern = PatternBuffer::empty();

        let route = router.route_ptr(*route_index);
        let main_file_route_index = route.file_page.unwrap().unwrap();
        let main_file = pt.output_file(main_file_route_index);

        // Count how many JS+CSS files associated with this route and prepare `pattern`
        pattern.prepend_part(&route.part);
        match &route.part {
            framework_router::Part::Param(p) => {
                params_buf.push(p);
            }
            framework_router::Part::CatchAll(p) => {
                params_buf.push(p);
            }
            framework_router::Part::CatchAllOptional(_) => {
                return global
                    .throw("catch-all routes are not supported in static site generation");
            }
            _ => {}
        }
        let mut file_count: u32 = 1;
        let mut css_file_count: u32 = u32::try_from(main_file.referenced_css_chunks.len()).unwrap();
        if let Some(file) = route.file_layout.unwrap() {
            css_file_count +=
                u32::try_from(pt.output_file(file).referenced_css_chunks.len()).unwrap();
            file_count += 1;
        }
        let mut next: Option<framework_router::Route::Index> = route.parent.unwrap();
        while let Some(parent_index) = next {
            let parent = router.route_ptr(parent_index);
            pattern.prepend_part(&parent.part);
            match &parent.part {
                framework_router::Part::Param(p) => {
                    params_buf.push(p);
                }
                framework_router::Part::CatchAll(p) => {
                    params_buf.push(p);
                }
                framework_router::Part::CatchAllOptional(_) => {
                    return global
                        .throw("catch-all routes are not supported in static site generation");
                }
                _ => {}
            }
            if let Some(file) = parent.file_layout.unwrap() {
                css_file_count +=
                    u32::try_from(pt.output_file(file).referenced_css_chunks.len()).unwrap();
                file_count += 1;
            }
            next = parent.parent.unwrap();
        }

        // Fill styles and file_list
        let styles = JSValue::create_empty_array(global, css_chunks_count)?;
        let file_list = JSValue::create_empty_array(global, file_count as usize)?;

        next = route.parent.unwrap();
        file_count = 1;
        css_file_count = 0;
        file_list.put_index(global, 0, pt.preload_bundled_module(main_file_route_index)?)?;
        for ref_ in &main_file.referenced_css_chunks {
            styles.put_index(
                global,
                css_file_count,
                css_chunk_js_strings.at(ref_.get() - css_chunks_first),
            )?;
            css_file_count += 1;
        }
        if let Some(file) = route.file_layout.unwrap() {
            file_list.put_index(global, file_count, pt.preload_bundled_module(file)?)?;
            for ref_ in &pt.output_file(file).referenced_css_chunks {
                styles.put_index(
                    global,
                    css_file_count,
                    css_chunk_js_strings.at(ref_.get() - css_chunks_first),
                )?;
                css_file_count += 1;
            }
            file_count += 1;
        }

        while let Some(parent_index) = next {
            let parent = router.route_ptr(parent_index);
            if let Some(file) = parent.file_layout.unwrap() {
                file_list.put_index(global, file_count, pt.preload_bundled_module(file)?)?;
                for ref_ in &pt.output_file(file).referenced_css_chunks {
                    styles.put_index(
                        global,
                        css_file_count,
                        css_chunk_js_strings.at(ref_.get() - css_chunks_first),
                    )?;
                    css_file_count += 1;
                }
                file_count += 1;
            }
            next = parent.parent.unwrap();
        }

        // Init the items
        let pattern_string = BunString::clone_utf8(pattern.slice());
        // .deref() on Drop
        route_patterns.put_index(
            global,
            u32::try_from(nav_index).unwrap(),
            pattern_string.to_js(global)?,
        )?;

        let mut src_path = BunString::clone_utf8(path::relative(
            cwd,
            pt.input_file(main_file_route_index).abs_path(),
        ));
        route_source_files.put_index(
            global,
            u32::try_from(nav_index).unwrap(),
            src_path.transfer_to_js(global)?,
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
                    BunString::create_utf8_for_js(global, param)?,
                )?;
            }
            route_param_info.put_index(global, u32::try_from(nav_index).unwrap(), param_info_array)?;
        } else {
            route_param_info.put_index(global, u32::try_from(nav_index).unwrap(), JSValue::NULL)?;
        }
        route_style_references.put_index(global, u32::try_from(nav_index).unwrap(), styles)?;

        params_buf.clear();
    }

    // SAFETY: FFI call; `global` is a live &JSGlobalObject, all JSValue args are
    // either GC-rooted (Strong / arrays just created and reachable from stack) or
    // passed by value for the duration of the call. Returned promise is immediately
    // wrapped and awaited.
    let render_promise = unsafe {
        BakeRenderRoutesForProdStatic(
            global,
            BunString::init(root_dir_path),
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
    vm.wait_for_promise(jsc::AnyPromise::Normal(render_promise));
    match render_promise.unwrap(vm.jsc_vm, jsc::PromiseUnwrap::MarkHandled) {
        jsc::PromiseResult::Pending => unreachable!(),
        jsc::PromiseResult::Fulfilled(_) => {
            Output::prettyln("done");
            Output::flush();
        }
        jsc::PromiseResult::Rejected(err) => {
            return vm.global.throw_value(err);
        }
    }
    vm.wait_for_tasks();
    Ok(())
}

/// unsafe function, must be run outside of the event loop
/// quits the process on exception
fn load_module(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    key: JSValue,
) -> Result<JSValue, bun_core::Error> {
    // SAFETY: FFI call; `global` is a live &JSGlobalObject and `key` is a JSValue
    // held on the stack for the duration of the call.
    let promise = unsafe { BakeLoadModuleByKey(global, key) }
        .as_any_promise()
        .unwrap()
        .internal();
    promise.set_handled();
    vm.wait_for_promise(jsc::AnyPromise::Internal(promise));
    // TODO: Specially draining microtasks here because `waitForPromise` has a
    //       bug which forgets to do it, but I don't want to fix it right now as it
    //       could affect a lot of the codebase. This should be removed.
    if vm.event_loop().drain_microtasks().is_err() {
        Global::crash();
    }
    match promise.unwrap(vm.jsc_vm, jsc::PromiseUnwrap::MarkHandled) {
        jsc::PromiseResult::Pending => unreachable!(),
        // SAFETY: FFI call; `global` is live and `key` remains valid (stack-held) here.
        jsc::PromiseResult::Fulfilled(_) => Ok(unsafe { BakeGetModuleNamespace(global, key) }),
        jsc::PromiseResult::Rejected(err) => vm.global.throw_value(err),
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
        /// Output directory path (e.g., "./dist")
        out_base: BunString,
        /// Server module paths (e.g., ["bake://page.js", "bake://layout.js"])
        all_server_files: JSValue,
        /// Framework prerender functions by router type
        render_static: JSValue,
        /// Framework getParams functions by router type
        get_params: JSValue,
        /// Client entry URLs by router type (e.g., ["/client.js", null])
        client_entry_urls: JSValue,
        /// Route patterns (e.g., ["/", "/about", "/blog/:slug"])
        patterns: JSValue,
        /// File indices per route (e.g., [[0], [1], [2, 0]])
        files: JSValue,
        /// Packed router type and flags (e.g., [0x00000000, 0x00000001])
        type_and_flags: JSValue,
        /// Source paths (e.g., ["pages/index.tsx", "pages/blog/[slug].tsx"])
        src_route_files: JSValue,
        /// Dynamic route params (e.g., [null, null, ["slug"]])
        param_information: JSValue,
        /// CSS URLs per route (e.g., [["/main.css"], ["/main.css", "/blog.css"]])
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
        panic!("This code should not be called on POSIX systems.");
    }
    #[cfg(not(unix))]
    {
        // PERF(port): was stack-fallback alloc
        let input_utf8 = input.to_utf8();
        let input_slice = input_utf8.slice();
        let output = bun_paths::w_path_buffer_pool().get();
        let output_slice = strings::to_w_path_normalize_auto_extend(&mut output[..], input_slice);
        BunString::clone_utf16(output_slice)
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

    if let Some(alias) =
        jsc::ModuleLoader::HardcodedModule::Alias::get(specifier.slice(), jsc::Target::Bun, Default::default())
    {
        return BunString::static_(alias.path);
    }

    let referrer = a_str.to_utf8();

    if resolver::is_package_path(specifier.slice()) {
        return match global.throw(format_args!(
            "Non-relative import {} from {} are not allowed in production assets. This is a bug in Bun's bundler",
            bun_core::fmt::quote(specifier.slice()),
            bun_core::fmt::quote(referrer.slice()),
        )) {
            Ok(v) => v,
            Err(_) => BunString::dead(),
        };
    }

    if cfg!(debug_assertions) {
        debug_assert!(strings::has_prefix(referrer.slice(), b"bake:"));
    }

    match BunString::create_format(format_args!(
        "bake:{}",
        BStr::new(path::join_abs(
            bun_paths::Dirname::dirname_u8(&referrer.slice()[5..])
                .unwrap_or(&referrer.slice()[5..]),
            path::Style::Posix, // force posix paths in bake
            specifier.slice(),
        ))
    )) {
        Ok(s) => s,
        Err(_) => BunString::dead(),
    }
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
}

pub type EntryPointHashMap = ArrayHashMap<InputFile, OutputFile::Index>;
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

impl EntryPointMap {
    pub fn get_or_put_entry_point(
        &mut self,
        abs_path: &[u8],
        side: bake::Side,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        let k = InputFile::init(abs_path, side);
        let gop = self.files.get_or_put(k)?;
        if !gop.found_existing {
            // errdefer: rolls back map state on failure (not just freeing a local)
            let guard = scopeguard::guard(&mut self.files, |files| {
                files.swap_remove_at(gop.index);
            });
            let owned: Box<[u8]> = Box::<[u8]>::from(abs_path);
            // TODO(port): owned slice is leaked into the map key's raw pointer; lifetime tied to map
            let owned_ptr = Box::leak(owned);
            *gop.key_ptr = InputFile::init(owned_ptr, side);
            scopeguard::ScopeGuard::into_inner(guard);
        }
        Ok(OpaqueFileId::init(u32::try_from(gop.index).unwrap()))
    }

    pub fn get_file_id_for_router(
        &mut self,
        abs_path: &[u8],
        _: framework_router::Route::Index,
        _: framework_router::Route::FileKind,
    ) -> Result<OpaqueFileId, bun_core::Error> {
        self.get_or_put_entry_point(abs_path, bake::Side::Server)
    }

    pub fn on_router_collision_error(
        &mut self,
        rel_path: &[u8],
        other_id: OpaqueFileId,
        ty: framework_router::Route::FileKind,
    ) -> Result<(), bun_alloc::AllocError> {
        Output::err_generic(format_args!(
            "Multiple {} matching the same route pattern is ambiguous",
            match ty {
                framework_router::Route::FileKind::Page => "pages",
                framework_router::Route::FileKind::Layout => "layout",
            }
        ));
        Output::pretty_errorln(format_args!("  - <blue>{}<r>", BStr::new(rel_path)));
        Output::pretty_errorln(format_args!(
            "  - <blue>{}<r>",
            BStr::new(path::relative(
                &self.root,
                self.files.keys()[other_id.get()].abs_path()
            ))
        ));
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
    pub output_indexes: &'a [OutputFile::Index],
    /// Indexed by entry point index (OpaqueFileId)
    pub module_keys: &'a [BunString],
    /// Unordered
    pub module_map: ArrayHashMap<Box<[u8]>, OutputFile::Index>,
    pub source_maps: ArrayHashMap<Box<[u8]>, OutputFile::Index>,

    // Thread-local
    pub vm: &'a VirtualMachine,
    /// Indexed by entry point index (OpaqueFileId)
    pub loaded_files: AutoBitSet,
    /// JSArray of JSString, indexed by entry point index (OpaqueFileId)
    // Zig protects/unprotects this manually; PORTING.md mandates Strong for
    // JSValue struct fields. Strong's Drop releases the GC root.
    // TODO(port): confirm bun_jsc::Strong API surface (create/get) — Phase B
    pub all_server_files: bun_jsc::Strong,
}

/// Sent to other threads for rendering
// PORT NOTE: Zig declares this as `PerThread.Options`; Rust cannot nest a struct
// inside an `impl`, so it's hoisted as a sibling type.
pub struct PerThreadOptions<'a> {
    pub input_files: &'a [InputFile],
    pub bundled_outputs: &'a [OutputFile],
    /// Indexed by entry point index (OpaqueFileId)
    pub output_indexes: &'a [OutputFile::Index],
    /// Indexed by entry point index (OpaqueFileId)
    pub module_keys: &'a [BunString],
    /// Unordered
    pub module_map: ArrayHashMap<Box<[u8]>, OutputFile::Index>,
    pub source_maps: ArrayHashMap<Box<[u8]>, OutputFile::Index>,
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
    pub fn init(vm: &'a VirtualMachine, opts: PerThreadOptions<'a>) -> Result<PerThread<'a>, bun_core::Error> {
        let loaded_files = AutoBitSet::init_empty(opts.output_indexes.len())?;
        // errdefer loaded_files.deinit() — handled by Drop on error path

        let all_server_files = bun_jsc::Strong::create(
            JSValue::create_empty_array(vm.global, opts.output_indexes.len())?,
            vm.global,
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
            // SAFETY: PerThread outlives the attached lifetime; detached in Drop
            BakeGlobalObject__attachPerThreadData(
                self.vm.global,
                self as *mut PerThread<'a> as *mut PerThread<'static>,
            );
        }
    }

    pub fn output_index(&self, id: OpaqueFileId) -> OutputFile::Index {
        self.output_indexes[id.get()]
    }

    pub fn input_file(&self, id: OpaqueFileId) -> InputFile {
        self.input_files[id.get()]
    }

    pub fn output_file(&self, id: OpaqueFileId) -> &OutputFile {
        &self.bundled_outputs[self.output_index(id).get()]
    }

    // Must be run at the top of the event loop
    pub fn load_bundled_module(&self, id: OpaqueFileId) -> Result<JSValue, bun_core::Error> {
        load_module(
            self.vm,
            self.vm.global,
            self.module_keys[id.get()].to_js(self.vm.global)?,
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
        if !self.loaded_files.is_set(id.get()) {
            self.loaded_files.set(id.get());
            self.all_server_files.get().put_index(
                self.vm.global,
                u32::try_from(id.get()).unwrap(),
                self.module_keys[id.get()].to_js(self.vm.global)?,
            )?;
        }

        Ok(JSValue::js_number_from_int32(
            i32::try_from(id.get()).unwrap(),
        ))
    }
}

impl<'a> Drop for PerThread<'a> {
    fn drop(&mut self) {
        // SAFETY: FFI call; `self.vm.global` is still live (VM outlives PerThread),
        // and passing null detaches the previously-attached pointer.
        unsafe {
            BakeGlobalObject__attachPerThreadData(self.vm.global, core::ptr::null_mut());
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
        return pt.bundled_outputs[value.get()].value.to_bun_string();
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
        return pt.bundled_outputs[value.get()].value.to_bun_string();
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

// TODO(port): placeholder type aliases for cross-crate enums referenced above
// (HotReload, OfflineMode, Macros, EnvBehavior, ImportKind, OutputKind).
// Phase B should replace these with the real imports from bun_cli / bun_bundler::options.
use bun_cli::HotReload;
use bun_cli::Macros;
use bun_cli::OfflineMode;
use bun_bundler::options::EnvBehavior;
use bun_bundler::options::OutputKind;
use bun_options_types::ImportKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/production.zig (1074 lines)
//   confidence: medium
//   todos:      13
//   notes:      Transpiler init uses MaybeUninit out-params (downstream uses need .assume_init_mut() wiring in Phase B); PerThread<'a> slice fields borrow from build_with_vm locals (lifetime escape via *pt = init(...) needs reshaping); PerThread.Options hoisted to sibling PerThreadOptions; InputFile keeps raw ptr+len for hash-map key (owned slice leaked into map); css_chunk_js_strings and all_server_files now GC-rooted via MarkedArgumentBuffer/Strong.
// ──────────────────────────────────────────────────────────────────────────
