//! Creating and destroying the dev server, and loading the framework's server runtime.

use super::*;
use std::sync::Arc;

/// DevServer is stored on the heap, storing its allocator.
#[inline(never)]
pub(crate) fn init(options: Options) -> JsResult<Box<DevServer>> {
    bun_removable_features::removable_definition!(Bundler, init);
    // Note: `Features.dev_server +|= 1` (saturating add). AtomicUsize has
    // no `saturating_inc`; on a 64-bit counter overflow is unreachable, so a
    // relaxed `fetch_add(1)` is equivalent in practice.
    bun_core::analytics::Features::DEV_SERVER.fetch_add(1, ::core::sync::atomic::Ordering::Relaxed);

    let separate_ssr_graph = options
        .framework
        .server_components
        .as_ref()
        .map(|sc| sc.separate_ssr_graph)
        .unwrap_or(false);

    let root = paths::string_paths::without_trailing_slash_windows_path(options.root.as_bytes());
    let global = options.vm.global();

    let generic_action = "while initializing development server";
    // FileSystem is a process-lifetime singleton; `init` interns the path into
    // the `DirnameStore` (process-lifetime arena) so no caller-side leak is
    // needed for the `'static` it stores.
    let _fs = match bun_resolver::fs::FileSystem::init(Some(root)) {
        Ok(fs) => fs,
        Err(err) => return Err(global.throw_error(err, generic_action)),
    };
    let top_level_dir: &'static [u8] = bun_resolver::fs::FileSystem::get().top_level_dir();

    // SAFETY: `options.arena` outlives every `Transpiler` field it backs (see
    // `Options::arena` doc — "must live until DevServer drops").
    let arena: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(options.arena) };
    let unresolved_view = options.framework.as_bundler_view();
    let mut log = Log::init();
    let mut init_transpiler = |renderer, bundler_options| {
        (options.framework)
            .init_transpiler(
                arena,
                &mut log,
                bake::Mode::Development,
                renderer,
                &unresolved_view,
                bundler_options,
            )
            .map_err(|err| global.throw_error(err, generic_action))
    };
    let server_transpiler = init_transpiler(bake::Graph::Server, &options.bundler_options.server)?;
    let client_transpiler = init_transpiler(bake::Graph::Client, &options.bundler_options.client)?;
    let ssr_transpiler = separate_ssr_graph
        .then(|| init_transpiler(bake::Graph::Ssr, &options.bundler_options.ssr))
        .transpose()?;

    let mut slot = Box::<DevServer>::new_uninit();
    // Not dereferenced before `bun_watcher.start()`.
    let p: *mut DevServer = slot.as_mut_ptr();
    let bun_watcher = match Watcher::init::<DevServer>(p, top_level_dir) {
        Ok(w) => w,
        Err(err) => {
            return Err(global.throw_error(
                err,
                "while initializing file watcher for development server",
            ));
        }
    };

    let mut dev = Box::write(
        slot,
        DevServer {
            magic: Magic::Valid,
            inspector_server_id: DebuggerId::init(0), // TODO paper clover:
            configuration_hash_key: [0; 16],
            vm: bun_ptr::BackRef::new(options.vm),
            vm_handle: options.vm.handle(),
            server: None,
            // Placeholder: the router is built once the framework is resolved.
            router: FrameworkRouter {
                root: Box::from(root),
                types: Box::new([]),
                routes: Vec::new(),
                static_routes: Default::default(),
                dynamic_routes: Default::default(),
                pattern_string_arena: Arena::new(),
            },
            route_bundles: Vec::new(),
            graph_safety_lock: ThreadLock::init_unlocked(),
            graphs: Graphs {
                root: Box::from(root),
                client: IncrementalGraph::default(),
                server: IncrementalGraph::default(),
                incremental_result: IncrementalResult::EMPTY,
                route_lookup: Default::default(),
                assets: Assets::default(),
                bundling_failures: Default::default(),
            },
            barrel_files_with_deferrals: Default::default(),
            barrel_needed_exports: Default::default(),
            html_router: HTMLRouter::empty(),
            source_maps: SourceMapStore::empty(),
            frontend_only: options.framework.file_system_router_types.is_empty(),
            has_tailwind_plugin_hack: None,
            server_fetch_function_callback: jsc::StrongOptional::empty(),
            server_register_update_callback: jsc::StrongOptional::empty(),
            bun_watcher: ::core::mem::ManuallyDrop::new(bun_watcher),
            directory_watchers: DirectoryWatchStore::default(),
            watcher_atomics: WatcherAtomics::init(p),
            testing_batch_events: TestingBatchEvents::Disabled,
            generation: 0,
            bundles_since_last_error: 0,
            framework: options.framework,
            plugins: options.bundler_options.plugin.map(Plugins::Owned),
            server_transpiler,
            client_transpiler,
            ssr_transpiler,
            log,
            plugin_state: PluginState::Unknown,
            current_bundle: None,
            next_bundle: NextBundle {
                route_queue: Default::default(),
                reload_event: None,
                requests: deferred_request::List::default(),
            },
            deferred_request_pool: HiveArrayFallback::init(),
            active_websocket_connections: Default::default(),
            emit_incremental_visualizer_events: 0,
            emit_memory_visualizer_events: 0,
            memory_visualizer_timer: OwnedTimer::init_paused(
                EventLoopTimerTag::DevServerMemoryVisualizerTick,
            ),
            assume_perfect_incremental_bundling:
                bun_core::env_var::feature_flag::BUN_ASSUME_PERFECT_INCREMENTAL
                    .get()
                    .unwrap_or(bun_core::env::IS_DEBUG),
            broadcast_console_log_from_browser_to_server: options
                .broadcast_console_log_from_browser_to_server,
        },
    );
    let dev_ptr: *mut DevServer = &raw mut *dev;

    let _unlock = dev.graph_safety_lock.guard();

    if let Err(err) = dev.bun_watcher.start() {
        return Err(global.throw_error(
            err,
            "while initializing file watcher thread for development server",
        ));
    }

    // `bun_resolver::AnyResolveWatcher` is now a re-export of
    // `bun_watcher::AnyResolveWatcher` (LAYERING: same type), so the watcher's
    // vtable flows directly into the resolver without conversion.
    let resolve_watcher = dev.bun_watcher.get_resolve_watcher();
    // The transpilers still point at the local that `log` moved out of.
    let log = &raw mut dev.log;
    for transpiler in dev.transpilers_mut() {
        transpiler.set_log(log);
        transpiler.options.log = log;
        transpiler.options.dev_server = dev_ptr as *const ();
        transpiler.resolver.watcher = Some(resolve_watcher);
    }

    debug_assert!(dev.server_transpiler.resolver.opts.target != bun_ast::Target::Browser);
    debug_assert!(dev.client_transpiler.resolver.opts.target == bun_ast::Target::Browser);

    if dev
        .framework
        .resolve(
            &mut dev.server_transpiler.resolver,
            &mut dev.client_transpiler.resolver,
        )
        .is_err()
    {
        if dev.framework.is_built_in_react {
            bake::Framework::add_react_install_command_note(&mut dev.log);
        }
        return Err(global.throw_value(dev.log.to_js_aggregate_error(
            global,
            format_args!("Framework is missing required files!"),
        )?));
    }

    // `unresolved_view` is a snapshot of the framework, so the
    // transpilers do not see the resolved
    // `server_runtime_import` / `react_fast_refresh.import_source`;
    // re-project after resolve so parser-generated imports (e.g.
    // `serverRuntimeImportSource` in `wrap_exports_for_client_reference`) see
    // absolute paths instead of the user's relative `"./framework/server.ts"`.
    let resolved_view = dev.framework.as_bundler_view();
    for transpiler in dev.transpilers_mut() {
        transpiler.options.framework = Some(Arc::clone(&resolved_view));
    }

    dev.configuration_hash_key = 'hash_key: {
        let mut h = Wyhash::init(128);

        if bun_core::env::IS_DEBUG {
            let stat = match sys::stat(
                bun_core::self_exe_path()
                    .unwrap_or_else(|e| Output::panic(format_args!("unhandled {}", e))),
            ) {
                Ok(s) => s,
                Err(e) => Output::panic(format_args!("unhandled {}", e)),
            };
            // Note: `sys::Stat` is `libc::stat` on POSIX / `uv_stat_t` on
            // Windows (where mtime is `mtim.sec`). Debug-only cache-bust key.
            #[cfg(not(windows))]
            bun_core::write_any_to_hasher(&mut h, stat.st_mtime as i64);
            #[cfg(windows)]
            bun_core::write_any_to_hasher(&mut h, stat.mtim.sec as i64);
            h.update(crate::bake::get_hmr_runtime(bake::Side::Client).code);
            h.update(crate::bake::get_hmr_runtime(bake::Side::Server).code);
        } else {
            h.update(Environment::GIT_SHA_SHORT.as_bytes());
        }

        for fsr in &dev.framework.file_system_router_types {
            bun_core::write_any_to_hasher(&mut h, fsr.allow_layouts as u8);
            bun_core::write_any_to_hasher(&mut h, fsr.ignore_underscores as u8);
            h.update(&fsr.entry_server);
            h.update(&[0]);
            h.update(fsr.entry_client.as_deref().unwrap_or(b""));
            h.update(&[0]);
            h.update(&fsr.prefix);
            h.update(&[0]);
            h.update(&fsr.root);
            h.update(&[0]);
            for ext in &fsr.extensions {
                h.update(ext);
                h.update(&[0]);
            }
            h.update(&[0]);
            for dir in &fsr.ignore_dirs {
                h.update(dir);
                h.update(&[0]);
            }
            h.update(&[0]);
        }

        if let Some(sc) = &dev.framework.server_components {
            bun_core::write_any_to_hasher(&mut h, 1u8);
            bun_core::write_any_to_hasher(&mut h, sc.separate_ssr_graph as u8);
            h.update(&sc.client_register_server_reference);
            h.update(&[0]);
            h.update(&sc.server_register_client_reference);
            h.update(&[0]);
            h.update(&sc.server_register_server_reference);
            h.update(&[0]);
            h.update(&sc.server_runtime_import);
            h.update(&[0]);
        } else {
            bun_core::write_any_to_hasher(&mut h, 0u8);
        }

        if let Some(rfr) = &dev.framework.react_fast_refresh {
            bun_core::write_any_to_hasher(&mut h, 1u8);
            h.update(&rfr.import_source);
        } else {
            bun_core::write_any_to_hasher(&mut h, 0u8);
        }

        for (k, v) in dev
            .framework
            .built_in_modules
            .keys()
            .iter()
            .zip(dev.framework.built_in_modules.values())
        {
            h.update(k);
            h.update(&[0]);
            // Hash the active tag, then the payload.
            // `bun_bundler::bake_types::BuiltInModule` has no `.tag()`/`.data_slice()`;
            // shim locally with a match (upstream type — cannot add inherent methods).
            let (tag, data): (u8, &[u8]) = match v {
                bun_bundler::bake_types::BuiltInModule::Import(d) => (0, &d[..]),
                bun_bundler::bake_types::BuiltInModule::Code(d) => (1, &d[..]),
            };
            bun_core::write_any_to_hasher(&mut h, tag);
            h.update(data);
            h.update(&[0]);
        }
        h.update(&[0]);

        let mut out = [0u8; 16];
        bun_core::fmt::bytes_to_hex_lower(&h.final_().to_ne_bytes(), &mut out);
        break 'hash_key out;
    };

    // Add react fast refresh if needed. This is the first file on the client side,
    // as it will be referred to by index.
    if let Some(rfr) = &dev.framework.react_fast_refresh {
        // `debug_assert!` does not evaluate its argument in release. Hoist
        // the side-effecting `insert_stale`
        // out so the refresh runtime is registered at index 0 in all builds.
        let idx = dev
            .graphs
            .insert_stale::<{ Side::Client }>(&rfr.import_source, bake::Graph::Client)?;
        debug_assert!(idx == incremental_graph::FileIndex::<{ bake::Side::Client }>::init(0));
    }

    if !dev.frontend_only {
        dev.init_server_runtime()?;
    }

    // Initialize FrameworkRouter
    dev.router = 'router: {
        let mut types: Vec<router::Type> =
            Vec::with_capacity(dev.framework.file_system_router_types.len());

        for fsr in dev.framework.file_system_router_types.iter() {
            let mut buf = paths::path_buffer_pool::get();
            let joined_root = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
                &dev.graphs.root,
                &mut buf[..],
                &[&fsr.root],
            );
            let Some(entry) = dev
                .server_transpiler
                .resolver
                .read_dir_info_ignore_error(joined_root)
            else {
                continue;
            };

            let server_file = dev.graphs.insert_stale_extra::<{ Side::Server }>(
                &fsr.entry_server,
                bake::Graph::Server,
                incremental_graph::RouteKind::Route,
            )?;

            // Types with a missing root were skipped above, so this can differ from the index in the config.
            let type_index = router::TypeIndex::init(u8::try_from(types.len()).expect("int cast"));
            types.push(router::Type {
                abs_root: strings::without_trailing_slash(entry.abs_path).into(),
                ignore_underscores: fsr.ignore_underscores,
                ignore_dirs: fsr
                    .ignore_dirs
                    .iter()
                    .map(|d| Box::<[u8]>::from(d.as_ref()))
                    .collect(),
                extensions: fsr
                    .extensions
                    .iter()
                    .map(|e| Box::<[u8]>::from(e.as_ref()))
                    .collect(),
                style: fsr.style,
                allow_layouts: fsr.allow_layouts,
                client_pages: fsr.client_pages,
                server_file: to_opaque_file_id::<{ bake::Side::Server }>(server_file),
                client_file: if let Some(client) = &fsr.entry_client {
                    Some(to_opaque_file_id::<{ bake::Side::Client }>(
                        dev.graphs
                            .insert_stale::<{ Side::Client }>(client, bake::Graph::Client)?,
                    ))
                } else {
                    None
                },
                server_file_string: jsc::StrongOptional::empty(),
            });

            dev.graphs.route_lookup.put(
                server_file,
                RouteIndexAndRecurseFlag::new(router::Type::root_route_index(type_index), true),
            )?;
        }

        break 'router FrameworkRouter::init_empty(&dev.graphs.root, types.into_boxed_slice())?;
    };

    // TODO: move scanning to be one tick after server startup. this way the
    // line saying the server is ready shows quicker, and route errors show up
    // after that line.
    dev.scan_initial_routes()?;

    debug_assert!(dev.magic == Magic::Valid);

    Ok(dev)
}

impl Drop for DevServer {
    fn drop(&mut self) {
        debug_log!("deinit");
        // For a usize test counter, wrapping at usize::MAX is unreachable in
        // practice, so a plain fetch_add is fine.
        DEV_SERVER_DEINIT_COUNT_FOR_TESTING.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        // Exhaustiveness check: destructuring without `..` fails to compile when a field is added,
        // removed, or renamed, forcing this Drop to be reviewed. All bindings
        // are `_` so nothing is moved; cleanup not done explicitly below
        // happens via the implicit field drops after this body returns.
        {
            let DevServer {
                magic: _,
                inspector_server_id: _,
                configuration_hash_key: _,
                vm: _,
                vm_handle: _,
                server: _,
                router: _,
                route_bundles: _,
                graph_safety_lock: _,
                graphs:
                    Graphs {
                        root: _,
                        client: _,
                        server: _,
                        incremental_result: _,
                        route_lookup: _,
                        assets: _,
                        bundling_failures: _,
                    },
                barrel_files_with_deferrals: _,
                barrel_needed_exports: _,
                html_router: _,
                source_maps: _,
                frontend_only: _,
                has_tailwind_plugin_hack: _,
                server_fetch_function_callback: _,
                server_register_update_callback: _,
                bun_watcher: _,
                directory_watchers: _,
                watcher_atomics: _,
                testing_batch_events: _,
                generation: _,
                bundles_since_last_error: _,
                framework: _,
                server_transpiler: _,
                client_transpiler: _,
                ssr_transpiler: _,
                log: _,
                plugin_state: _,
                plugins: _,
                current_bundle: _,
                next_bundle: _,
                deferred_request_pool: _,
                active_websocket_connections: _,
                emit_incremental_visualizer_events: _,
                emit_memory_visualizer_events: _,
                memory_visualizer_timer: _,
                assume_perfect_incremental_bundling: _,
                broadcast_console_log_from_browser_to_server: _,
            } = &*self;
        }

        // WebSockets should be deinitialized before other parts.
        for &s in ::core::mem::take(&mut self.active_websocket_connections).keys() {
            // SAFETY: a socket is live until it is closed. The borrow ends before that.
            let socket = unsafe { &mut *s };
            socket.release(self);
            socket.dev = ::core::ptr::null_mut();
            if let Some(websocket) = socket.underlying {
                websocket.close();
            }
        }

        self.graph_safety_lock.lock();
        // Hand ownership of the heap allocation to the watcher thread (which frees it in
        // `thread_main` once `running` flips false). Auto-dropping the `Box`
        // here would free the allocation out from under the still-running
        // thread; on Windows the kernel additionally retains a pending
        // `ReadDirectoryChangesW` against the inline 64 KiB `DirWatcher.buf` +
        // `overlapped`, so the freed block being recycled by mimalloc for a
        // later allocation is a kernel write into live unrelated heap data.
        // SAFETY: `bun_watcher` was written exactly once in `init()` and is
        // never taken elsewhere; this is `Drop`, so the field is not read again.
        let watcher = unsafe { ::core::mem::ManuallyDrop::take(&mut self.bun_watcher) };
        // SAFETY: `Box::into_raw` yields the unique heap pointer; ownership
        // transfers to `shutdown`, which reclaims or hands off to the thread.
        unsafe { Watcher::shutdown(Box::into_raw(watcher)) };

        // The map's `Drop` runs `SerializedFailure::drop` for each value.

        if let Some(current_bundle) = &mut self.current_bundle {
            debug_assert!(false); // impossible to de-initialize this state correctly.
            super::finalize::drain_current_bundle_requests(current_bundle);
        }

        {
            while let Some(r) = self.next_bundle.requests.pop_first() {
                let handler = r.take_handler();
                debug_assert!(!matches!(handler, Handler::ServerHandler(_)));
                handler.fail();
            }
        }

        for value in self.source_maps.entries.values() {
            debug_assert!(value.ref_count > 0);
        }

        // `Watcher::shutdown` serialises with `dispatch_file_updates` on
        // `Watcher.mutex`, so `next_event` is stable from the watcher side.
        let atomics = self.watcher_atomics.as_ptr();
        // SAFETY: `atomics` is the `heap::alloc_nn` pointer from `init()`.
        let next = unsafe {
            (*atomics)
                .next_event
                .load(::core::sync::atomic::Ordering::Acquire)
        };
        if next == crate::bake::dev_server::NextEvent::DONE.0 {
            // SAFETY: `atomics` is the unique owner; no event is queued.
            unsafe {
                for event in &mut (*atomics).events {
                    event.dirs.clear_and_free();
                    event.files.clear_and_free();
                    event.extra_files.clear();
                }
                bun_core::heap::destroy(atomics);
            }
        } else {
            // A `HotReloadEvent.concurrent_task` is still linked in the
            // concurrent queue; `HotReloadEvent::run` will see the nulled
            // `owner` and reclaim this allocation.
            // SAFETY: `atomics` is live; the main thread is the sole writer
            // of `owner` here (watcher thread is serialised out).
            unsafe {
                for event in &mut (*atomics).events {
                    event.owner = ::core::ptr::null_mut();
                }
            }
        }

        if let TestingBatchEvents::Enabled(batch) | TestingBatchEvents::ReleaseAfterBundle(batch) =
            &mut self.testing_batch_events
        {
            drop(std::mem::replace(
                &mut batch.entry_points,
                EntryPointList::empty(),
            ));
        }

        debug_assert!(self.magic == Magic::Valid);
        // self.magic = undefined — no Rust equivalent; freed memory.
    }
}

// re-exports from memory_cost module already declared at top

impl DevServer {
    fn transpilers_mut(&mut self) -> impl Iterator<Item = &mut Transpiler<'static>> {
        [&mut self.server_transpiler, &mut self.client_transpiler]
            .into_iter()
            .chain(&mut self.ssr_transpiler)
    }

    fn init_server_runtime(&mut self) -> JsResult<()> {
        let runtime = BunString::create_static_external(
            crate::bake::get_hmr_runtime(crate::bake::Side::Server)
                .code
                .as_bytes(),
        );

        // `self.global()` returns `&'static`, decoupled from `&self` — it's
        // held across the `&mut self` field assignments below.
        let global = self.global();
        let interface = match server_hmr_ffi::bake_load_initial_server_code(
            global,
            runtime,
            self.framework
                .server_components
                .as_ref()
                .map(|sc| sc.separate_ssr_graph)
                .unwrap_or(false),
        ) {
            Ok(v) => v,
            // Nothing says that what the dev server bundles is static code.
            Err(err)
                if bun_core::code_generation_from_strings()
                    == bun_core::CodeGenerationFromStrings::Strict =>
            {
                return Err(err);
            }
            Err(err) => {
                self.vm()
                    .print_error_like_object_to_console(global.take_exception(err));
                panic!("Server runtime failed to start. The above error is always a bug in Bun");
            }
        };

        if !interface.is_object() {
            panic!(
                "Internal assertion failure: expected interface from HMR runtime to be an object"
            );
        }
        let fetch_function = interface
            .get(global, "handleRequest")
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                panic!("Internal assertion failure: expected interface from HMR runtime to contain handleRequest")
            });
        debug_assert!(fetch_function.is_callable());
        self.server_fetch_function_callback = jsc::StrongOptional::create(fetch_function, global);
        let register_update = interface
            .get(global, "registerUpdate")
            .ok()
            .flatten()
            .unwrap_or_else(|| {
                panic!("Internal assertion failure: expected interface from HMR runtime to contain registerUpdate")
            });
        self.server_register_update_callback = jsc::StrongOptional::create(register_update, global);

        fetch_function.ensure_still_alive();
        register_update.ensure_still_alive();
        Ok(())
    }

    /// Deferred one tick so that the server can be up faster
    fn scan_initial_routes(&mut self) -> crate::Result<()> {
        self.router.scan_all(
            &mut self.server_transpiler.resolver,
            router::InsertionContext::wrap(&mut self.graphs),
        )?;

        self.graphs.server.ensure_stale_bit_capacity(true)?;
        self.graphs.client.ensure_stale_bit_capacity(true)?;
        Ok(())
    }

    /// Returns true if a catch-all handler was attached.
    pub(crate) fn set_routes<const SSL: bool, const DEBUG: bool>(
        &mut self,
        server: &crate::server::NewServer<SSL, DEBUG>,
    ) -> crate::Result<bool> {
        // TODO: all paths here must be prefixed with publicPath if set.
        self.server = Some(AnyServer::from(server));
        // The server has its routes now; the scan of the pages ran before it had them.
        self.report_pages_hidden_by_server_routes();
        let app = server.app().unwrap();
        let dev = std::ptr::from_mut::<Self>(self).cast::<c_void>();

        // Each `dev_route_tramp::<SSL, ID>` is a distinct C function with its handler baked in.
        macro_rules! route {
            ($method:ident, $pattern:expr, $id:expr) => {{
                // SAFETY: `app` is set before `set_routes` (server init path)
                // and outlives it; the borrow is statement-scoped.
                unsafe { &mut *app }.$method($pattern, Some(dev_route_tramp::<SSL, { $id }>), dev);
            }};
        }

        route!(
            get,
            const_format::concatcp!(CLIENT_PREFIX, "/:route").as_bytes(),
            DevHandlerId::JsRequest
        );
        route!(
            get,
            const_format::concatcp!(ASSET_PREFIX, "/:asset").as_bytes(),
            DevHandlerId::AssetRequest
        );
        route!(
            get,
            const_format::concatcp!(INTERNAL_PREFIX, "/src/*").as_bytes(),
            DevHandlerId::SrcRequest
        );
        route!(
            post,
            const_format::concatcp!(INTERNAL_PREFIX, "/report_error").as_bytes(),
            DevHandlerId::ReportError
        );
        route!(
            post,
            const_format::concatcp!(INTERNAL_PREFIX, "/unref").as_bytes(),
            DevHandlerId::UnrefSourceMap
        );
        route!(any, INTERNAL_PREFIX.as_bytes(), DevHandlerId::NotFound);

        // SAFETY: see `route!` — statement-scoped reborrow of the live app.
        unsafe { &mut *app }.ws(
            const_format::concatcp!(INTERNAL_PREFIX, "/hmr").as_bytes(),
            dev,
            0,
            hmr_socket_behavior::<SSL>(),
            dev,
        );

        // Only attach a catch-all handler if the framework has filesystem
        // router types. Otherwise, this can just be Bun.serve's default handler.
        if !self.framework.file_system_router_types.is_empty() {
            route!(any, b"/*", DevHandlerId::Request);
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
