//! Starting bundles: choosing entry points, the bundle queue, and plugin loading.

use super::*;

impl DevServer {
    pub(super) fn append_route_entry_points_if_not_stale(
        &mut self,
        entry_points: &mut EntryPointList,
        rbi: route_bundle::Index,
    ) -> crate::Result<()> {
        let server_file_names = self.server_graph.bundled_files.keys();
        let client_file_names = self.client_graph.bundled_files.keys();

        // Build a list of all files that have not yet been bundled.
        // Note: split borrow — `route_bundle_ptr`/`type_ptr` are `&mut self`;
        // index `route_bundles`/`types` immutably so the SoA key slices above stay live.
        match &self.route_bundles[rbi.get() as usize].data {
            route_bundle::Data::Framework(bundle) => {
                let mut route = self.router.route_ptr(bundle.route_index);
                let router_type = self.router.type_ptr_const(route.r#type);
                let (rt_server_file, rt_client_file) =
                    (router_type.server_file, router_type.client_file);
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    OpaqueFileIdOrOptional::Id(rt_server_file),
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Client }>(
                    client_file_names,
                    entry_points,
                    rt_client_file,
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    route.file_page,
                )?;
                self.append_opaque_entry_point::<{ bake::Side::Server }>(
                    server_file_names,
                    entry_points,
                    route.file_layout,
                )?;
                while let Some(parent_index) = route.parent {
                    route = self.router.route_ptr(parent_index);
                    self.append_opaque_entry_point::<{ bake::Side::Server }>(
                        server_file_names,
                        entry_points,
                        route.file_layout,
                    )?;
                }
                // A router whose pages also run in the browser: the same files, in the client graph.
                for path in self.client_page_files(bundle.route_index).iter() {
                    let stale = match self.client_graph.get_file_index(path) {
                        Some(index) => self.client_graph.stale_files.is_set(index.get() as usize),
                        None => true,
                    };
                    if stale {
                        entry_points.append_js(path, bake::Graph::Client)?;
                    }
                }
            }
            route_bundle::Data::Html(html) => {
                entry_points.append_html(&html.html_bundle.bundle.path)?;
            }
        }

        if let Some(map) = &self.has_tailwind_plugin_hack {
            for abs_path in map.keys() {
                let Some(file) = self.client_graph.bundled_files.get(abs_path) else {
                    continue;
                };
                if file.kind == FileKind::Css {
                    entry_points.append_css(abs_path).expect("oom");
                }
            }
        }
        Ok(())
    }
}

#[derive(Copy, Clone)]
pub(crate) struct CacheEntry {
    pub(crate) kind: FileKind,
}

impl DevServer {
    pub(crate) fn is_file_cached(&mut self, path: &[u8], side: bake::Graph) -> Option<CacheEntry> {
        // Barrel files with deferred records must always be re-parsed.
        if self.barrel_files_with_deferrals.contains_key(path) {
            return None;
        }

        let _g = self.graph_safety_lock.guard();

        macro_rules! check {
            ($g:expr, |$file:ident| $bundled_for_side:expr) => {{
                let g = $g;
                let index = g.bundled_files.get_index(path)?;
                if g.stale_files.is_set(index) {
                    return None;
                }
                let $file = g.get_file_by_index(incremental_graph::FileIndex::init(
                    u32::try_from(index).expect("int cast"),
                ));
                if !$bundled_for_side {
                    return None;
                }
                return Some(CacheEntry {
                    kind: $file.file_kind(),
                });
            }};
        }
        match side {
            bake::Graph::Client => check!(&self.client_graph, |_file| true),
            // The server and SSR graphs share one record per file. Only a JS record tracks which graph bundled it.
            bake::Graph::Server | bake::Graph::Ssr => check!(&self.server_graph, |file| {
                file.file_kind() != FileKind::Js
                    || if side == bake::Graph::Ssr {
                        file.is_ssr
                    } else {
                        file.is_rsc
                    }
            }),
        }
    }

    fn append_opaque_entry_point<const SIDE: bake::Side>(
        &self,
        file_names: &[Box<[u8]>],
        entry_points: &mut EntryPointList,
        optional_id: impl Into<OpaqueFileIdOrOptional>,
    ) -> crate::Result<()> {
        let file = match optional_id.into() {
            OpaqueFileIdOrOptional::Optional(o) => match o {
                Some(f) => f,
                None => return Ok(()),
            },
            OpaqueFileIdOrOptional::Id(f) => f,
        };

        let file_index = from_opaque_file_id::<SIDE>(file);
        let stale = match SIDE {
            bake::Side::Server => self
                .server_graph
                .stale_files
                .is_set(file_index.get() as usize),
            bake::Side::Client => self
                .client_graph
                .stale_files
                .is_set(file_index.get() as usize),
        };
        if stale {
            entry_points.append_js(&file_names[file_index.get() as usize], SIDE.graph())?;
        }
        Ok(())
    }

    pub(crate) fn route_bundle_ptr(&mut self, idx: route_bundle::Index) -> &mut RouteBundle {
        &mut self.route_bundles[idx.get() as usize]
    }
}

#[repr(transparent)]
#[derive(Copy, Clone)]
pub(crate) struct RouteIndexAndRecurseFlag(pub u32);

impl RouteIndexAndRecurseFlag {
    pub(crate) fn new(route_index: router::RouteIndex, should_recurse_when_visiting: bool) -> Self {
        RouteIndexAndRecurseFlag(
            (route_index.get() & 0x7FFF_FFFF) | ((should_recurse_when_visiting as u32) << 31),
        )
    }
    pub(crate) fn route_index(self) -> router::RouteIndex {
        router::RouteIndex::init(self.0 & 0x7FFF_FFFF)
    }
    pub(crate) fn should_recurse_when_visiting(self) -> bool {
        (self.0 >> 31) != 0
    }
}

/// Bake needs to specify which graph (client/server/ssr) each entry point is.
#[derive(Default)]
pub(crate) struct EntryPointList {
    pub(crate) set: bun_collections::StringArrayHashMap<entry_point_list::Flags>,
}

pub(crate) mod entry_point_list {
    bitflags::bitflags! {
        #[derive(Default, Copy, Clone)]
        #[repr(transparent)]
        pub struct Flags: u8 {
            const CLIENT = 1 << 0;
            const SERVER = 1 << 1;
            const SSR = 1 << 2;
            /// When this is set, also set CLIENT
            const CSS = 1 << 3;
            /// The html file of a route. When this is set, also set CLIENT
            const HTML = 1 << 4;
        }
    }
}

impl EntryPointList {
    pub(crate) fn empty() -> EntryPointList {
        EntryPointList::default()
    }

    pub(crate) fn append_js(&mut self, abs_path: &[u8], side: bake::Graph) -> crate::Result<()> {
        self.append(
            abs_path,
            match side {
                bake::Graph::Server => entry_point_list::Flags::SERVER,
                bake::Graph::Client => entry_point_list::Flags::CLIENT,
                bake::Graph::Ssr => entry_point_list::Flags::SSR,
            },
        )
    }

    pub(crate) fn append_css(&mut self, abs_path: &[u8]) -> crate::Result<()> {
        self.append(
            abs_path,
            entry_point_list::Flags::CLIENT | entry_point_list::Flags::CSS,
        )
    }

    /// The html file of a route: an import attribute or a bunfig `[loader]` entry may have made it html.
    pub(crate) fn append_html(&mut self, abs_path: &[u8]) -> crate::Result<()> {
        self.append(
            abs_path,
            entry_point_list::Flags::CLIENT | entry_point_list::Flags::HTML,
        )
    }

    /// Deduplictes requests to bundle the same file twice.
    pub(crate) fn append(
        &mut self,
        abs_path: &[u8],
        flags: entry_point_list::Flags,
    ) -> crate::Result<()> {
        let gop = self.set.get_or_put(abs_path)?;
        if gop.found_existing {
            *gop.value_ptr |= flags;
        } else {
            *gop.value_ptr = flags;
        }
        Ok(())
    }
}

impl DevServer {
    pub(crate) fn put_or_overwrite_asset(
        &mut self,
        path: &bun_bundler::bun_fs::Path<'_>,
        contents: crate::webcore::blob::Any,
        content_hash: u64,
    ) -> crate::Result<()> {
        let _g = self.graph_safety_lock.guard();
        let _ = self.assets.replace_path(
            path.text,
            contents,
            &MimeType::by_extension(path.name().ext_without_leading_dot()),
            content_hash,
        )?;
        Ok(())
    }

    pub(crate) fn on_plugins_resolved(
        &mut self,
        plugins: Option<*mut crate::api::js_bundler::Plugin>,
    ) -> crate::Result<()> {
        self.bundler_options.plugin = plugins.and_then(::core::ptr::NonNull::new);
        self.plugin_state = PluginState::Loaded;
        self.start_next_bundle_if_present();
        Ok(())
    }

    pub(crate) fn on_plugins_rejected(&mut self) -> crate::Result<()> {
        self.plugin_state = PluginState::Err;
        // Completing the last request on a stopped server frees `self`, so count as a pending request until the end.
        let mut server = self.server;
        if let Some(server) = server.as_mut() {
            server.on_pending_request();
        }
        while let Some(item) = self.next_bundle.requests.pop_first() {
            // SAFETY: `pop_first` returns a valid `*mut Node<DeferredRequest>`;
            // `data` was initialized by `defer_request`.
            unsafe {
                let d = (*item).data.assume_init_mut();
                d.abort_and_deref();
            }
        }
        // Reset these routes so their next request gets the plugin error.
        for &route_bundle_index in self.next_bundle.route_queue.keys() {
            self.route_bundles[route_bundle_index.get() as usize].server_state =
                route_bundle::State::Unqueued;
        }
        self.next_bundle.route_queue.clear_retaining_capacity();
        if let Some(server) = server.as_mut() {
            server.on_static_request_complete();
        }
        // TODO: allow recovery from this state
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct TestingBatch {
    /// Keys are borrowed.
    pub(crate) entry_points: EntryPointList,
}

impl TestingBatch {
    pub(crate) fn empty() -> TestingBatch {
        TestingBatch {
            entry_points: EntryPointList::empty(),
        }
    }

    pub(crate) fn append(&mut self, entry_points: &EntryPointList) -> crate::Result<()> {
        debug_assert!(!entry_points.set.is_empty());
        for (k, v) in entry_points
            .set
            .keys()
            .iter()
            .zip(entry_points.set.values())
        {
            self.entry_points.append(k, *v)?;
        }
        Ok(())
    }
}

impl DevServer {
    #[inline(never)]
    pub(crate) fn start_async_bundle(
        &mut self,
        entry_points: EntryPointList,
        had_reload_event: bool,
        timer: Instant,
    ) -> crate::Result<()> {
        bun_removable_features::removable_definition!(Bundler, Self::start_async_bundle);
        debug_assert!(self.current_bundle.is_none());
        debug_assert!(!entry_points.set.is_empty());
        self.log.clear_and_free();

        // Notify inspector about bundle start
        if let Some(agent) = self.inspector() {
            let mut trigger_files: Vec<BunString> = Vec::with_capacity(entry_points.set.len());
            for key in entry_points.set.keys() {
                trigger_files.push(BunString::clone_utf8(key));
            }
            agent.notify_bundle_start(self.inspector_server_id, &mut trigger_files);
        }

        self.incremental_result.reset();

        // Ref server to keep it from closing.
        if let Some(server) = self.server.as_mut() {
            server.on_pending_request();
        }

        // Boxed so its address is stable: `bv2.graph.heap: &'static Arena`
        // borrows it (self-ref via `CurrentBundle`, see Note on
        // `CurrentBundle.bv2`).
        let heap: Box<bun_alloc::MimallocArena> = Box::new(bun_alloc::MimallocArena::new());
        // Borrows `heap`, so AST nodes built during bundle setup
        // live exactly as long as the bundle. The arena-allocated allocator
        // never runs `Drop`; the `AstAllocState` is taken into `CurrentBundle`
        // on success and recycled by the guard below on error paths.
        let ast_memory_store: *mut bun_ast::ASTMemoryAllocator =
            heap.alloc(bun_ast::ASTMemoryAllocator::borrowing(&heap));
        struct ReleaseAstState(*mut bun_ast::ASTMemoryAllocator);
        impl Drop for ReleaseAstState {
            fn drop(&mut self) {
                // SAFETY: points at the arena-allocated allocator in `heap`,
                // which outlives this guard; the `Scope` has already exited.
                unsafe { (*self.0).release_ast_state() };
            }
        }
        let _release_ast_state = ReleaseAstState(ast_memory_store);
        // SAFETY: the `ASTMemoryAllocator` lives in a bumpalo chunk owned by
        // `heap` → `bv2.graph.heap`; address is stable for the bv2 lifetime.
        // The exclusive reborrow is owned by the `ast_scope` guard, which is
        // dropped before `bv2` is moved into `current_bundle` below.
        let ast_scope = unsafe { bun_ast::ASTMemoryAllocator::enter(&mut *ast_memory_store) };

        // The bundler stores
        // `Option<NonNull<AnyEventLoop>>`. Park the value in `heap`
        // — bumpalo chunks are heap-allocated, so the address is stable across
        // the move of `heap` into `bv2.graph.heap` and lives exactly as long
        // as `bv2`.
        let event_loop: bun_bundler::linker_context_mod::EventLoop =
            // SAFETY: `self.vm().event_loop()` is the live per-thread `jsc::EventLoop`.
            Some(::core::ptr::NonNull::from(heap.alloc(
                bun_event_loop::AnyEventLoop::js(self.vm().event_loop().cast()),
            )));

        // SAFETY: `heap` is `Box`-allocated above and moved into
        // `CurrentBundle` (which also owns `bv2`); the boxed arena's address
        // is stable for the lifetime of `bv2.graph.heap`'s borrow.
        let heap_ptr: *const bun_alloc::Arena = &raw const *heap;
        // Note: split `&mut self` into disjoint field reborrows so
        // `server_transpiler` (`&'a mut`) and `client/ssr_transpiler`
        // (NonNull) don't trip the single-`&mut self` rule.
        let self_ptr = std::ptr::from_mut::<Self>(self);
        let mut bv2: Box<BundleV2<'static>> = BundleV2::init(
            // SAFETY: `server_transpiler` outlives `bv2` (held by `self`).
            unsafe { (*self_ptr).server_transpiler.assume_init_mut() },
            Some(bundler::bundle_v2::BakeOptions {
                framework: self.framework.as_bundler_view(),
                // SAFETY: sibling fields of `*self`; `BundleV2` stores them as
                // raw pointers and never moves them.
                client_transpiler: unsafe {
                    ::core::ptr::NonNull::from((*self_ptr).client_transpiler.assume_init_mut())
                },
                // SAFETY: sibling field of `*self`; `BundleV2` stores it as a raw
                // pointer and never moves it.
                ssr_transpiler: unsafe {
                    ::core::ptr::NonNull::from((*self_ptr).ssr_transpiler.assume_init_mut())
                },
                plugins: self.bundler_options.plugin,
            }),
            // SAFETY: see `heap_ptr` note above.
            unsafe { &*heap_ptr },
            event_loop,
            false, // watching is handled separately
            Some(::core::ptr::NonNull::from(
                bun_threading::work_pool::WorkPool::get(),
            )),
            // SAFETY: see `heap_ptr` note above.
            unsafe { &*heap_ptr },
        )?;
        bv2.bun_watcher = Some(::core::ptr::NonNull::from(&mut **self.bun_watcher));
        bv2.asynchronous = true;
        let dev_handle = self.bundler_handle();
        bv2.dev_server = Some(dev_handle);
        bv2.linker.dev_server = Some(dev_handle);

        {
            self.graph_safety_lock.lock();
            self.client_graph.reset();
            self.server_graph.reset();
            self.graph_safety_lock.unlock();
        }

        // LAYERING: `bun_bundler::bake_types::EntryPointList` is the TYPE_ONLY
        // mirror of this file's `EntryPointList` (moved down so `bun_bundler`
        // can name it without depending on `bun_runtime`). Convert by value —
        // both `Flags` are `#[repr(transparent)] u8` with identical bit layout.
        let start_data = bv2.start_from_bake_dev_server(&{
            let mut bt = bundler::bake_types::EntryPointList::empty();
            for (k, v) in entry_points.set.iter() {
                bun_core::handle_oom(
                    bt.set
                        .put(k, bundler::bake_types::EntryPointFlags(v.bits())),
                );
            }
            bt
        })?;
        drop(entry_points);
        // End the AST scope and move its state into the bundle so the small
        // `AstVec`s built during setup stay alive until the bundle completes.
        drop(ast_scope);
        // SAFETY: `ast_memory_store` lives in `heap`; the scope above has
        // exited, so no `&mut` to the allocator is live.
        let ast_alloc_state = unsafe { (*ast_memory_store).take_ast_state() };
        self.current_bundle = Some(CurrentBundle {
            _bv2: bv2,
            _heap: heap,
            _ast_alloc_state: ast_alloc_state,
            timer,
            start_data,
            had_reload_event,
            requests: ::core::mem::take(&mut self.next_bundle.requests),
            script_requests: Vec::new(),
            resolution_failure_entries: Default::default(),
        });

        self.next_bundle.requests = deferred_request::List::default();
        self.next_bundle.route_queue.clear_retaining_capacity();
        Ok(())
    }

    /// Bundle the files a testing batch collected, or report an empty batch.
    pub(crate) fn release_testing_batch(&mut self, batch: TestingBatch) {
        debug_assert!(self.current_bundle.is_none());
        if batch.entry_points.set.count() == 0 {
            self.publish(
                HmrTopic::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 2],
                Opcode::BINARY,
            );
            return;
        }

        self.start_async_bundle(batch.entry_points, true, Instant::now())
            // bun.handleOom(err) — Rust aborts on OOM by default
            .expect("OOM");
    }

    pub(super) fn start_next_bundle_if_present(&mut self) {
        debug_assert!(self.magic == Magic::Valid);
        // Clear the current bundle
        debug_assert!(self.current_bundle.is_none());
        self.emit_visualizer_message_if_needed();

        // If there were pending requests, begin another bundle.
        if self.next_bundle.reload_event.is_some() || !self.next_bundle.requests.first.is_null() {
            let mut entry_points = EntryPointList::empty();

            let (is_reload, timer) = if let Some(event) = self.next_bundle.reload_event.take() {
                'brk: {
                    // SAFETY: `event` points into `*self.watcher_atomics` (its
                    // own heap allocation); the slot is exclusively owned by
                    // this thread until recycled below.
                    let reload_event_timer = unsafe { (*event).timer };

                    let self_ptr: *mut DevServer = self;
                    let mut current: *mut HotReloadEvent = event;
                    loop {
                        // SAFETY: `self_ptr` is `self`; `*current` lives in
                        // `*self.watcher_atomics` (a separate heap allocation),
                        // disjoint from the graph/watcher fields
                        // `process_file_list` mutates. Both exclusive borrows
                        // end with this call.
                        unsafe {
                            HotReloadEvent::process_file_list(
                                &mut *current,
                                &mut *self_ptr,
                                &mut entry_points,
                            )
                        };
                        // SAFETY: `current` points into `*self.watcher_atomics`;
                        // `recycle_event_from_dev_server` only reads/swaps that
                        // slot and returns the next exclusively-owned one (a
                        // slot in `self.watcher_atomics.events[..]`).
                        let Some(next) = (unsafe {
                            WatcherAtomics::recycle_event_from_dev_server(
                                self.watcher_atomics.as_ptr(),
                                current,
                            )
                        }) else {
                            break;
                        };
                        current = next;
                        // SAFETY: `current` is the freshly acquired exclusive slot.
                        #[cfg(debug_assertions)]
                        debug_assert!(unsafe { (*current).debug_mutex.try_lock() });
                    }

                    break 'brk (true, reload_event_timer);
                }
            } else {
                (false, Instant::now())
            };

            // Note: iterate by index — `route_bundle_ptr` /
            // `append_route_entry_points_if_not_stale` need `&mut self`,
            // conflicting with the `keys()` iterator borrow.
            for i in 0..self.next_bundle.route_queue.len() {
                let route_bundle_index = self.next_bundle.route_queue.keys()[i];
                let rb = self.route_bundle_ptr(route_bundle_index);
                rb.server_state = route_bundle::State::Bundling;
                self.append_route_entry_points_if_not_stale(&mut entry_points, route_bundle_index)
                    .expect("oom");
            }

            // The bundle that just finished may have already bundled every file in the queued framework
            // routes. Waiting requests are only answered when a bundle finishes, so bundle their pages again.
            if entry_points.set.is_empty() {
                for i in 0..self.next_bundle.route_queue.len() {
                    let route_bundle_index = self.next_bundle.route_queue.keys()[i];
                    if let route_bundle::Data::Framework(bundle) =
                        &self.route_bundles[route_bundle_index.get() as usize].data
                    {
                        let route = self.router.route_ptr(bundle.route_index);
                        let file = route.file_page.unwrap_or_else(|| {
                            self.router.type_ptr_const(route.r#type).server_file
                        });
                        let file_index = from_opaque_file_id::<{ bake::Side::Server }>(file);
                        self.server_graph.stale_files.set(file_index.get() as usize);
                    }
                    self.append_route_entry_points_if_not_stale(
                        &mut entry_points,
                        route_bundle_index,
                    )
                    .expect("oom");
                }
            }

            if !entry_points.set.is_empty() {
                self.start_async_bundle(entry_points, is_reload, timer)
                    .expect("oom");
            }

            self.next_bundle.route_queue.clear_retaining_capacity();
        }
    }
}
