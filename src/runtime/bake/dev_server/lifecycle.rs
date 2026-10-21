//! Creating and destroying the dev server, and loading the framework's server runtime.

use super::*;

/// DevServer is stored on the heap, storing its allocator.
pub(crate) fn init(options: Options) -> JsResult<Box<DevServer>> {
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

    // Note: `server_transpiler` / `client_transpiler` / `ssr_transpiler` /
    // `bun_watcher` / `router` / `watcher_atomics` must be assigned after the
    // heap address is stable. Rust forbids partial struct literals and
    // `mem::zeroed()` here is UB (`Box<Watcher>` is `NonNull`-backed;
    // `Transpiler<'a>` carries `&'a Arena`), so use
    // `Box::new_uninit()` + per-field `addr_of_mut!().write()`, leaving those
    // fields uninitialized until their real values are computed against
    // the stable `*mut DevServer`, then `assume_init()` once every field is written.
    use ::core::mem::MaybeUninit;
    use ::core::ptr::addr_of_mut;

    let mut dev_uninit: Box<MaybeUninit<DevServer>> = Box::new(MaybeUninit::uninit());
    let p: *mut DevServer = dev_uninit.as_mut_ptr();

    let root = paths::string_paths::without_trailing_slash_windows_path(options.root.as_bytes());

    /// `addr_of_mut!((*p).$field).write($value)` — writes a single field of the
    /// partially-initialized `DevServer` without materializing `&mut DevServer`.
    macro_rules! w {
        ($field:ident, $value:expr) => {
            addr_of_mut!((*p).$field).write($value)
        };
    }

    // SAFETY: `p` is a freshly-allocated, properly-aligned `*mut DevServer`; each
    // `addr_of_mut!((*p).field)` computes an in-bounds field address without
    // creating a reference to the (partially-uninit) whole. Every field is written
    // exactly once before `assume_init()` below.
    unsafe {
        w!(magic, Magic::Valid);
        w!(root, Box::from(root));
        w!(vm, bun_ptr::BackRef::new(options.vm));
        w!(vm_handle, options.vm.handle());
        w!(server, None);
        w!(directory_watchers, DirectoryWatchStore::default());
        w!(server_fetch_function_callback, jsc::StrongOptional::empty());
        w!(
            server_register_update_callback,
            jsc::StrongOptional::empty()
        );
        w!(generation, 0);
        w!(graph_safety_lock, ThreadLock::init_unlocked());
        w!(emit_incremental_visualizer_events, 0);
        w!(emit_memory_visualizer_events, 0);
        w!(
            memory_visualizer_timer,
            EventLoopTimer::init_paused(EventLoopTimerTag::DevServerMemoryVisualizerTick)
        );
        // `dev.frontend_only = dev.framework.file_system_router_types.len == 0`
        w!(
            frontend_only,
            options.framework.file_system_router_types.is_empty()
        );
        w!(client_graph, IncrementalGraph::default());
        w!(server_graph, IncrementalGraph::default());
        w!(barrel_files_with_deferrals, Default::default());
        w!(barrel_needed_exports, Default::default());
        w!(incremental_result, IncrementalResult::EMPTY);
        w!(route_lookup, Default::default());
        w!(route_bundles, Vec::new());
        w!(html_router, HTMLRouter::empty());
        w!(active_websocket_connections, Default::default());
        w!(current_bundle, None);
        w!(
            next_bundle,
            NextBundle {
                route_queue: Default::default(),
                reload_event: None,
                requests: deferred_request::List::default(),
            }
        );
        w!(inspector_server_id, DebuggerId::init(0)); // TODO paper clover:
        w!(
            assets,
            Assets {
                path_map: Default::default(),
                files: Default::default(),
                refs: Default::default(),
                needs_reindex: false,
            }
        );
        w!(source_maps, SourceMapStore::empty());
        w!(plugin_state, PluginState::Unknown);
        w!(bundling_failures, Default::default());
        w!(
            assume_perfect_incremental_bundling,
            bun_core::env_var::feature_flag::BUN_ASSUME_PERFECT_INCREMENTAL
                .get()
                .unwrap_or(bun_core::env::IS_DEBUG)
        );
        w!(testing_batch_events, TestingBatchEvents::Disabled);
        w!(
            broadcast_console_log_from_browser_to_server,
            options.broadcast_console_log_from_browser_to_server
        );
        w!(bundles_since_last_error, 0);
        w!(has_tailwind_plugin_hack, None);
        w!(configuration_hash_key, [0; 16]);
        w!(log, Log::init());
        w!(deferred_request_pool, HiveArrayFallback::init());

        // `.router = undefined` — placeholder until the real router is built below
        // (after transpilers + framework.resolve). Constructed empty so the field
        // is valid for `assume_init()`; overwritten by `dev.router = 'router: {..}`.
        w!(
            router,
            FrameworkRouter {
                root: Box::from(root),
                types: Box::new([]),
                routes: Vec::new(),
                static_routes: Default::default(),
                dynamic_routes: Default::default(),
                pattern_string_arena: Arena::new(),
            }
        );
    }

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

    // `.bun_watcher = undefined` → `Watcher.init(DevServer, dev, fs, ...)`
    // SAFETY: `Watcher::init` only stores `p` as an opaque `*mut ()` ctx; it does
    // not dereference it until `start()` spawns the watcher thread, by which point
    // every `DevServer` field is initialized (`assume_init` below precedes
    // `bun_watcher.start()`).
    let bun_watcher = match Watcher::init::<DevServer>(p, top_level_dir) {
        Ok(w) => w,
        Err(err) => {
            return Err(global.throw_error(
                err,
                "while initializing file watcher for development server",
            ));
        }
    };
    // SAFETY: per-field write into uninit struct; see `w!` SAFETY above.
    unsafe { w!(bun_watcher, ::core::mem::ManuallyDrop::new(bun_watcher)) };

    // `.watcher_atomics = undefined` → `WatcherAtomics.init(dev)`
    // SAFETY: `WatcherAtomics::init` / `HotReloadEvent::init_empty` only store `p`
    // as a BACKREF for later `concurrent_task.from(dev)` / `run`; not dereferenced
    // during construction.
    unsafe { w!(watcher_atomics, WatcherAtomics::init(p)) };

    // This causes a memory leak, but the allocator is otherwise used on multiple threads.
    // (allocator param dropped — global mimalloc)

    // `.server_transpiler/.client_transpiler/.ssr_transpiler = undefined` →
    // `Framework.initTranspiler(..., &dev.X_transpiler, ...)`.
    //
    // SAFETY: `init_transpiler` writes the slot via `MaybeUninit::write` (see
    // `config/transpiler.rs`), so the previous (uninitialized) bytes are never dropped.
    // `log` was written above; reborrowing it is sound because no `&mut DevServer` exists.
    // Note: `Transpiler<'static>` erases the arena lifetime — `options.arena`
    // is the `UserOptions.arena` which is moved into / outlives the `DevServer`
    // box. Widen `'a → 'static` here once.
    // SAFETY: `options.arena` outlives every `Transpiler` field it backs (see
    // `Options::arena` doc — "must live until DevServer drops").
    let arena: &'static Arena = unsafe { bun_ptr::detach_lifetime_ref(options.arena) };
    let mut bundler_framework_views: Vec<*mut bun_bundler::bake_types::Framework> =
        Vec::with_capacity(4);
    // SAFETY: `p` points into the boxed `MaybeUninit<DevServer>`; the fields
    // accessed below were each written above and are reborrowed disjointly via
    // `addr_of_mut!`, so no overlapping `&mut` exists.
    unsafe {
        // Still in `options`, so that an early return drops them.
        let framework = &options.framework;
        let log = &mut *addr_of_mut!((*p).log);
        let bundler_options = &options.bundler_options;

        match framework.init_transpiler(
            arena,
            log,
            bake::Mode::Development,
            bake::Graph::Server,
            &mut *addr_of_mut!((*p).server_transpiler),
            &bundler_options.server,
        ) {
            Ok(view) => bundler_framework_views.push(view),
            Err(err) => return Err(global.throw_error(err, generic_action)),
        }
        match framework.init_transpiler(
            arena,
            log,
            bake::Mode::Development,
            bake::Graph::Client,
            &mut *addr_of_mut!((*p).client_transpiler),
            &bundler_options.client,
        ) {
            Ok(view) => bundler_framework_views.push(view),
            Err(err) => return Err(global.throw_error(err, generic_action)),
        }
        if separate_ssr_graph {
            match framework.init_transpiler(
                arena,
                log,
                bake::Mode::Development,
                bake::Graph::Ssr,
                &mut *addr_of_mut!((*p).ssr_transpiler),
                &bundler_options.ssr,
            ) {
                Ok(view) => bundler_framework_views.push(view),
                Err(err) => return Err(global.throw_error(err, generic_action)),
            }
        } else {
            // Note: when `!separate_ssr_graph`, `ssr_transpiler` is never
            // read, but a valid value must still be written before
            // `assume_init()`. Bitwise-alias the server
            // transpiler. This is sound only because `Drop for DevServer` gates
            // `ssr_transpiler.assume_init_drop()` behind the same
            // `separate_ssr_graph` check (see Drop impl): in the `!separate`
            // branch the alias is never independently dropped, so there is no
            // double-free. Do not remove that gate.
            ::core::ptr::copy_nonoverlapping(
                addr_of_mut!((*p).server_transpiler).cast_const(),
                addr_of_mut!((*p).ssr_transpiler),
                1,
            );
        }

        w!(bundler_framework_views, bundler_framework_views);
        w!(framework, options.framework);
        w!(bundler_options, options.bundler_options);
    }

    // ── every field is now written ───────────────────────────────────────────
    // SAFETY: all fields of `*p` were written exactly once above via
    // `addr_of_mut!().write()` / `copy_nonoverlapping`; no field remains uninit.
    let mut dev: Box<DevServer> = unsafe { dev_uninit.assume_init() };
    let dev_ptr: *mut DevServer = &raw mut *dev;

    // Note: the graphs are stored by value; `owner()` is provided on
    // `IncrementalGraph` via `offset_of!` so the parent-pointer invariant is
    // structural. Retain the field touches so the addresses are stable for
    // `container_of` consumers below.
    let _ = (
        &dev.server_graph,
        &dev.client_graph,
        &dev.directory_watchers,
    );

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
    dev.server_transpiler_mut().options.dev_server = dev_ptr as *const ();
    dev.server_transpiler_mut().resolver.watcher = Some(resolve_watcher);
    dev.client_transpiler_mut().options.dev_server = dev_ptr as *const ();
    dev.client_transpiler_mut().resolver.watcher = Some(resolve_watcher);

    if separate_ssr_graph {
        dev.ssr_transpiler_mut().options.dev_server = dev_ptr as *const ();
        dev.ssr_transpiler_mut().resolver.watcher = Some(resolve_watcher);
    }

    debug_assert!(dev.server_transpiler().resolver.opts.target != bun_ast::Target::Browser);
    debug_assert!(dev.client_transpiler().resolver.opts.target == bun_ast::Target::Browser);

    // Note: reborrow `framework` and the two resolvers via `dev_ptr` so
    // borrowck doesn't see three overlapping `&mut dev`.
    // SAFETY: `dev_ptr` is the live `Box<DevServer>` heap address; the three
    // fields are disjoint.
    if unsafe { &mut (*dev_ptr).framework }
        .resolve(
            // SAFETY: see above; `server_transpiler` was initialized and is disjoint from `framework`.
            unsafe { &mut (*(*dev_ptr).server_transpiler.as_mut_ptr()).resolver },
            // SAFETY: see above; `client_transpiler` was initialized and is disjoint from `framework`.
            unsafe { &mut (*(*dev_ptr).client_transpiler.as_mut_ptr()).resolver },
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

    // `init_transpiler` arena-snapshots the framework projection, so the
    // transpilers do not see the resolved
    // `server_runtime_import` / `react_fast_refresh.import_source`;
    // re-project after resolve so parser-generated imports (e.g.
    // `serverRuntimeImportSource` in `wrap_exports_for_client_reference`) see
    // absolute paths instead of the user's relative `"./framework/server.ts"`.
    {
        let resolved_ptr: *mut bun_bundler::bake_types::Framework =
            arena.alloc(dev.framework.as_bundler_view());
        dev.bundler_framework_views.push(resolved_ptr);
        // SAFETY: `resolved_ptr` is a fresh arena slot, no aliasing borrows.
        let resolved_view: &'static bun_bundler::bake_types::Framework = unsafe { &*resolved_ptr };
        dev.server_transpiler_mut().options.framework = Some(resolved_view);
        dev.client_transpiler_mut().options.framework = Some(resolved_view);
        if separate_ssr_graph {
            dev.ssr_transpiler_mut().options.framework = Some(resolved_view);
        }
    }

    // errdefer dev.route_lookup.clearAndFree() / client_graph.deinit() / server_graph.deinit()

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
            bun_core::write_any_to_hasher(&mut h, &(stat.mtim.sec as i64));
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
            .client_graph
            .insert_stale(&rfr.import_source, bake::Graph::Client)?;
        debug_assert!(idx == incremental_graph::FileIndex::<{ bake::Side::Client }>::init(0));
    }

    if !dev.frontend_only {
        dev.init_server_runtime()?;
    }

    // Initialize FrameworkRouter
    dev.router = 'router: {
        let mut types: Vec<router::Type> =
            Vec::with_capacity(dev.framework.file_system_router_types.len());

        // Note: the loop body mutates `server_transpiler.resolver`,
        // `server_graph`, `client_graph`, and `route_lookup` while iterating
        // `framework.file_system_router_types` by shared ref. All five fields
        // are disjoint; reborrow them through `dev_ptr` so the shared
        // `framework` iter does not lock `*dev`.
        // SAFETY: `dev_ptr` is the live `Box<DevServer>` heap address; `framework`
        // is read-only here and disjoint from the fields mutated in the loop body.
        for fsr in unsafe { &(*dev_ptr).framework }
            .file_system_router_types
            .iter()
        {
            let mut buf = paths::path_buffer_pool::get();
            let joined_root = paths::resolve_path::join_abs_string_buf::<paths::platform::Auto>(
                &dev.root,
                &mut buf[..],
                &[&fsr.root],
            );
            // SAFETY: `server_transpiler` was fully initialized by `init_transpiler`
            // above; `.resolver` is disjoint from `framework`.
            let Some(entry) = unsafe { (*dev_ptr).server_transpiler.assume_init_mut() }
                .resolver
                .read_dir_info_ignore_error(joined_root)
            else {
                continue;
            };

            // SAFETY: `server_graph` is disjoint from `framework`.
            let server_file = unsafe { &mut (*dev_ptr).server_graph }.insert_stale_extra(
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
                        // SAFETY: `client_graph` is disjoint from `framework`.
                        unsafe { &mut (*dev_ptr).client_graph }
                            .insert_stale(client, bake::Graph::Client)?,
                    ))
                } else {
                    None
                },
                server_file_string: jsc::StrongOptional::empty(),
            });

            // SAFETY: `route_lookup` is disjoint from `framework`.
            unsafe { &mut (*dev_ptr).route_lookup }.put(
                server_file,
                RouteIndexAndRecurseFlag::new(router::Type::root_route_index(type_index), true),
            )?;
        }

        break 'router FrameworkRouter::init_empty(&dev.root, types.into_boxed_slice())?;
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
                root: _,
                inspector_server_id: _,
                configuration_hash_key: _,
                vm: _,
                vm_handle: _,
                server: _,
                router: _,
                route_bundles: _,
                graph_safety_lock: _,
                client_graph: _,
                server_graph: _,
                barrel_files_with_deferrals: _,
                barrel_needed_exports: _,
                incremental_result: _,
                route_lookup: _,
                html_router: _,
                assets: _,
                source_maps: _,
                bundling_failures: _,
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
                bundler_framework_views: _,
                bundler_options: _,
                server_transpiler: _,
                client_transpiler: _,
                ssr_transpiler: _,
                log: _,
                plugin_state: _,
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
        // `websocket.close()` synchronously dispatches `HmrSocket.onClose`,
        // which calls `dev.active_websocket_connections.remove(s)` and
        // destroys the `HmrSocket`. Snapshot the keys first.
        {
            let count = self.active_websocket_connections.len();
            if count > 0 {
                let sockets: Vec<*mut HmrSocket> =
                    self.active_websocket_connections.keys().copied().collect();
                for s in sockets {
                    // SAFETY: s is a valid HmrSocket ptr owned by the connection map
                    if let Some(websocket) = unsafe { (*s).underlying } {
                        websocket.close();
                    }
                }
            }
            debug_assert!(self.active_websocket_connections.is_empty());
        }

        if self.memory_visualizer_timer.state == EventLoopTimerState::ACTIVE {
            let timer_ptr: *mut EventLoopTimer = &raw mut self.memory_visualizer_timer;
            self.timer_heap().remove(timer_ptr);
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
        unsafe { Watcher::shutdown(Box::into_raw(watcher), true) };

        // The map's `Drop` runs `SerializedFailure::drop` for each value.

        if let Some(current_bundle) = &mut self.current_bundle {
            debug_assert!(false); // impossible to de-initialize this state correctly.
            super::finalize::drain_current_bundle_requests(current_bundle);
        }

        {
            while let Some(r) = self.next_bundle.requests.pop_first() {
                // SAFETY: `pop_first` returns a live node linked by `defer_request`,
                // which initialized `data`. This exclusive borrow ends at `deref_`.
                let data = unsafe { (*r).data.assume_init_mut() };
                debug_assert!(!matches!(data.handler, Handler::ServerHandler(_)));
                data.abort_and_deref();
            }
        }

        for value in self.source_maps.entries.values_mut() {
            debug_assert!(value.ref_count > 0);
            value.ref_count = 0;
        }
        if self.source_maps.weak_ref_sweep_timer.state == EventLoopTimerState::ACTIVE {
            let timer_ptr: *mut EventLoopTimer = &raw mut self.source_maps.weak_ref_sweep_timer;
            self.timer_heap().remove(timer_ptr);
        }

        // `Watcher::shutdown` serialises with `dispatch_file_updates` on
        // `Watcher.mutex`, so `next_event` is stable from the watcher side.
        let atomics = self.watcher_atomics.as_ptr();
        // SAFETY: `atomics` is the `heap::into_raw` pointer from `init()`.
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

        let separate_ssr_graph = self
            .framework
            .server_components
            .as_ref()
            .is_some_and(|sc| sc.separate_ssr_graph);
        // SAFETY: each transpiler is initialized exactly once in `init()`.
        unsafe {
            self.server_transpiler.assume_init_drop();
            self.client_transpiler.assume_init_drop();
            if separate_ssr_graph {
                self.ssr_transpiler.assume_init_drop();
            }
        }

        for &ptr in &self.bundler_framework_views {
            // SAFETY: each ptr is a unique arena slot written once in `init()`.
            unsafe { ::core::ptr::drop_in_place(ptr) };
        }
        self.bundler_framework_views.clear();

        debug_assert!(self.magic == Magic::Valid);
        // self.magic = undefined — no Rust equivalent; freed memory.
    }
}

// re-exports from memory_cost module already declared at top

impl DevServer {
    fn init_server_runtime(&mut self) -> JsResult<()> {
        let runtime = BunString::create_static_external(
            crate::bake::get_hmr_runtime(crate::bake::Side::Server)
                .code
                .as_bytes(),
            true,
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
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime;
                // `print_error_like_object_to_console` needs `&mut VM`, so cast
                // the shared borrow through a raw pointer (single-threaded JS).
                self.vm_mut()
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
        // Reborrow `self`, `self.router`, and `self.server_transpiler.resolver`
        // via the raw self-ptr (the three are disjoint fields of the heap-stable `*self`).
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // SAFETY: `router`, `server_transpiler.resolver`, and the
        // `InsertionHandler` callbacks (touch `server_graph`/`route_lookup`)
        // are disjoint fields of `*self_ptr`.
        unsafe {
            (*self_ptr).router.scan_all(
                &mut (*(*self_ptr).server_transpiler.as_mut_ptr()).resolver,
                router::InsertionContext::wrap(&mut *self_ptr),
            )?;
        }

        self.server_graph.ensure_stale_bit_capacity(true)?;
        self.client_graph.ensure_stale_bit_capacity(true)?;
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
        let app = server.app.get().unwrap();
        let dev = std::ptr::from_mut::<Self>(self).cast::<c_void>();

        // The ZST-fn-item trampoline pattern used by
        // `server::server_body::AppRouteExt`: a generic `extern "C"`
        // shim parameterized on the handler type `H` (which is zero-sized for
        // a fn-item), so each `tramp::<H, SSL>` lowers to a distinct C
        // function pointer with the handler baked in.
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
