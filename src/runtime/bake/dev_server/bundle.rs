//! Starting bundles: choosing entry points, the bundle queue, and plugin loading.

use super::*;
use bun_ptr::AliasableBox;

impl DevServerState {
    pub(super) fn append_route_entry_points_if_not_stale(
        &mut self,
        entry_points: &mut EntryPointList,
        rbi: route_bundle::Index,
    ) -> crate::Result<()> {
        let server_file_names = self.graphs.server.bundled_files.keys();
        let client_file_names = self.graphs.client.bundled_files.keys();

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
                    let stale = match self.graphs.client.get_file_index(path) {
                        Some(index) => self.graphs.client.stale_files.is_set(index.get() as usize),
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
                let Some(file) = self.graphs.client.bundled_files.get(abs_path) else {
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

impl DevServerState {
    pub(crate) fn is_file_cached(&self, path: &[u8], side: bake::Graph) -> Option<CacheEntry> {
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
            bake::Graph::Client => check!(&self.graphs.client, |_file| true),
            // The server and SSR graphs share one record per file. Only a JS record tracks which graph bundled it.
            bake::Graph::Server | bake::Graph::Ssr => check!(&self.graphs.server, |file| {
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
                .graphs
                .server
                .stale_files
                .is_set(file_index.get() as usize),
            bake::Side::Client => self
                .graphs
                .client
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

impl DevServerState {
    pub(crate) fn put_or_overwrite_asset(
        &mut self,
        path: &bun_bundler::bun_fs::Path<'_>,
        contents: crate::webcore::blob::Any,
        content_hash: u64,
    ) -> crate::Result<()> {
        let _ = self.replace_asset_path(
            path.text,
            contents,
            &MimeType::by_extension(path.name().ext_without_leading_dot()),
            content_hash,
        )?;
        Ok(())
    }

    /// Returns the requests that waited for the plugins. Failing them runs JS, so that is left to the caller.
    pub(crate) fn on_plugins_rejected(&mut self) -> deferred_request::FailOnDrop {
        self.plugin_state = PluginState::Err;
        // Reset these routes so their next request gets the plugin error.
        for &route_bundle_index in self.next_bundle.route_queue.keys() {
            self.route_bundles[route_bundle_index.get() as usize].server_state =
                route_bundle::State::Unqueued;
        }
        self.next_bundle.route_queue.clear_retaining_capacity();
        // TODO: allow recovery from this state
        deferred_request::FailOnDrop {
            requests: ::core::mem::take(&mut self.next_bundle.requests),
            _pending: PendingRequest::new(self.server),
        }
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

/// A bundle and what it borrows. `'static` stands for the borrow of the other fields.
pub(super) struct BundlePass {
    bv2: AliasableBox<BundleV2<'static>>,
    _ast_arena: AliasableBox<bun_ast::AstArena>,
    transpilers: AliasableBox<Transpilers>,
}

impl BundlePass {
    fn new(
        transpilers_box: AliasableBox<Transpilers>,
        plugins: Option<::core::ptr::NonNull<crate::api::js_bundler::Plugin>>,
        vm: &VirtualMachine,
    ) -> Self {
        let ast_arena_box = AliasableBox::new(bun_ast::AstArena::new());
        // SAFETY: `Self` owns what these point to, and neither uses nor drops it before `bv2` drops.
        let (ast_arena, transpilers) =
            unsafe { (&*ast_arena_box.as_ptr(), &mut *transpilers_box.as_ptr()) };
        let event_loop = ast_arena.alloc(bun_event_loop::AnyEventLoop::js(vm.event_loop_ptr()));
        let framework = transpilers.server.options.framework.clone();
        let bv2 = BundleV2::init(
            &mut transpilers.server,
            Some(bundler::bundle_v2::BakeOptions {
                framework: framework.expect("set by DevServer::init"),
                client_transpiler: &mut transpilers.client,
                ssr_transpiler: transpilers.ssr.as_mut(),
                plugins,
            }),
            ast_arena,
            Some(::core::ptr::NonNull::from(event_loop)),
            Some(::core::ptr::NonNull::from(
                bun_threading::work_pool::WorkPool::get(),
            )),
            ast_arena,
        );
        Self {
            bv2: bv2.into(),
            _ast_arena: ast_arena_box,
            transpilers: transpilers_box,
        }
    }

    pub(super) fn with_bundle<R>(&mut self, f: impl FnOnce(&mut BundleV2<'_>) -> R) -> R {
        f(&mut self.bv2)
    }

    /// Drops the bundle and gives `dev` back what it lent.
    pub(super) fn end(mut self, dev: &mut DevServerState) {
        dev.barrels = ::core::mem::take(&mut self.bv2.dev_server_barrels);
        drop(self.bv2);
        dev.transpilers = Some(self.transpilers);
    }
}

impl DevServer {
    pub(crate) fn on_plugins_resolved(
        &self,
        plugins: ::core::ptr::NonNull<crate::api::js_bundler::Plugin>,
    ) {
        let mut dev = self.state_mut();
        dev.plugins = Some(Plugins::Borrowed(plugins));
        dev.plugin_state = PluginState::Loaded;
        drop(dev);
        self.start_next_bundle_if_present();
    }

    #[inline(never)]
    pub(crate) fn start_async_bundle(
        &self,
        entry_points: EntryPointList,
        had_reload_event: bool,
        timer: Instant,
    ) {
        bun_removable_features::removable_definition!(Bundler, Self::start_async_bundle);
        let mut dev = self.state_mut();
        debug_assert!(dev.current_bundle.is_none());
        debug_assert!(!entry_points.set.is_empty());
        dev.log.clear_and_free();

        // Notify inspector about bundle start
        if let Some(agent) = dev.inspector() {
            let mut trigger_files: Vec<BunString> = Vec::with_capacity(entry_points.set.len());
            for key in entry_points.set.keys() {
                trigger_files.push(BunString::clone_utf8(key));
            }
            agent.notify_bundle_start(dev.inspector_server_id, &mut trigger_files);
        }

        dev.graphs.incremental_result.reset();

        let pending_request = PendingRequest::new(self.server);

        let transpilers = dev.transpilers.take().expect("no bundle is running");
        let plugins = dev.plugins.as_ref().map(Plugins::as_non_null);
        let mut pass = Box::new(BundlePass::new(transpilers, plugins, dev.vm()));
        pass.bv2.asynchronous = true;
        let handle = self.bundler_handle();
        pass.bv2.dev_server_barrels = ::core::mem::take(&mut dev.barrels);

        dev.graphs.client.reset();
        dev.graphs.server.reset();
        drop(dev);

        // LAYERING: `bun_bundler::bake_types::EntryPointList` is the TYPE_ONLY
        // mirror of this file's `EntryPointList` (moved down so `bun_bundler`
        // can name it without depending on `bun_runtime`). Convert by value —
        // both `Flags` are `#[repr(transparent)] u8` with identical bit layout.
        bun_core::handle_oom(pass.bv2.start_from_bake_dev_server(handle, &{
            let mut bt = bundler::bake_types::EntryPointList::empty();
            for (k, v) in entry_points.set.iter() {
                bun_core::handle_oom(
                    bt.set
                        .put(k, bundler::bake_types::EntryPointFlags(v.bits())),
                );
            }
            bt
        }));
        drop(entry_points);

        let dev = &mut *self.state_mut();
        dev.current_bundle = Some(CurrentBundle {
            pass: Some(pass),
            timer,
            had_reload_event,
            requests: ::core::mem::take(&mut dev.next_bundle.requests),
            script_requests: Vec::new(),
            pending_request,
        });

        dev.next_bundle.route_queue.clear_retaining_capacity();
    }

    /// Bundle the files a testing batch collected, or report an empty batch.
    pub(crate) fn release_testing_batch(&self, batch: TestingBatch) {
        if batch.entry_points.set.count() == 0 {
            self.state_mut().publish(
                HmrTopic::TestingWatchSynchronization,
                &[MessageId::TestingWatchSynchronization.char(), 2],
                Opcode::BINARY,
            );
            return;
        }

        self.start_async_bundle(batch.entry_points, true, Instant::now());
    }

    pub(super) fn start_next_bundle_if_present(&self) {
        let next = self.state_mut().take_next_bundle();
        if let Some((entry_points, is_reload, timer)) = next {
            self.start_async_bundle(entry_points, is_reload, timer);
        }
    }
}

impl DevServerState {
    /// The arguments of `start_async_bundle`, if there is something to bundle.
    fn take_next_bundle(&mut self) -> Option<(EntryPointList, bool, Instant)> {
        debug_assert!(self.magic == Magic::Valid);
        // Clear the current bundle
        debug_assert!(self.current_bundle.is_none());

        // If there were pending requests, begin another bundle.
        if self.next_bundle.has_reload_event || self.next_bundle.requests.first().is_some() {
            let mut entry_points = EntryPointList::empty();

            let is_reload = core::mem::take(&mut self.next_bundle.has_reload_event);
            let timer = if is_reload {
                self.process_reload_events(&mut entry_points)
            } else {
                Instant::now()
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
                        self.graphs
                            .server
                            .stale_files
                            .set(file_index.get() as usize);
                    }
                    self.append_route_entry_points_if_not_stale(
                        &mut entry_points,
                        route_bundle_index,
                    )
                    .expect("oom");
                }
            }

            self.next_bundle.route_queue.clear_retaining_capacity();

            if !entry_points.set.is_empty() {
                return Some((entry_points, is_reload, timer));
            }
        }
        None
    }
}
