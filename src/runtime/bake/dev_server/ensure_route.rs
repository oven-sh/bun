//! Making sure a route is bundled before it is served, and queueing requests while it builds.

use super::*;

pub(super) struct RequestEnsureRouteBundledCtx<'a> {
    pub(super) req: ReqOrSaved<'a>,
    pub(super) resp: AnyResponse,
    pub(super) kind: deferred_request::HandlerKind,
    pub(super) route_bundle_index: route_bundle::Index,
}

impl RequestEnsureRouteBundledCtx<'_> {
    fn on_defer(
        &mut self,
        dev: &mut DevServer,
        bundle_field: BundleQueueType,
    ) -> JsResult<Deferral> {
        let req = ::core::mem::replace(&mut self.req, ReqOrSaved::Aborted);
        Ok(dev.defer_request(
            bundle_field,
            self.route_bundle_index,
            self.kind,
            req,
            self.resp,
        )?)
    }

    fn on_loaded(&mut self, dev: &mut DevServer) -> JsResult<()> {
        match self.kind {
            deferred_request::HandlerKind::ServerHandler => {
                // The `Strong` field is move-only. Take ownership out of `self.req`
                // (it is consumed by `on_framework_request_with_bundle`).
                let req = match ::core::mem::replace(&mut self.req, ReqOrSaved::Aborted) {
                    ReqOrSaved::Req(r) => SavedRequestUnion::Stack(r),
                    ReqOrSaved::Aborted => unreachable!(),
                };
                dev.on_framework_request_with_bundle(self.route_bundle_index, req, self.resp)
            }
            deferred_request::HandlerKind::BundledHtmlPage => {
                let method = self.req.method();
                dev.on_html_request_with_bundle(self.route_bundle_index, self.resp, method);
                Ok(())
            }
        }
    }

    fn on_plugin_error(&mut self) -> JsResult<()> {
        self.resp.end(b"Plugin Error", false);
        Ok(())
    }

    fn to_dev_response(&mut self) -> AnyResponse {
        self.resp
    }
}

#[derive(Copy, Clone)]
enum BundleQueueType {
    NextBundle,
    CurrentBundle,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Deferral {
    Queued,
    /// The response is already written (413, 400), so nothing waits for a bundle.
    Answered,
}

pub(super) fn ensure_route_is_bundled(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    ctx: &mut RequestEnsureRouteBundledCtx<'_>,
) -> JsResult<()> {
    debug_assert!(dev.magic == Magic::Valid);
    debug_assert!(dev.server.is_some());
    let mut state = dev.route_bundle_ptr(route_bundle_index).server_state;
    'sw: loop {
        match state {
            route_bundle::State::Unqueued => {
                // We already are bundling something, defer the request
                if dev.current_bundle.is_some() {
                    if ctx.on_defer(dev, BundleQueueType::NextBundle)? == Deferral::Answered {
                        return Ok(());
                    }
                    dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                    dev.route_bundle_ptr(route_bundle_index).server_state =
                        route_bundle::State::DeferredToNextBundle;
                    return Ok(());
                }

                // No current bundle, we'll create a bundle with just this route, but first:
                // If plugins are not yet loaded, prepare them.
                let mut plugin = dev.plugin_state;
                'plugin: loop {
                    match plugin {
                        PluginState::Unknown => {
                            if dev.bundler_options.plugin.is_some() {
                                // Framework-provided plugin is likely going to be phased out later
                                dev.plugin_state = PluginState::Loaded;
                            } else {
                                // TODO: implement a proper solution here
                                // `vm()` is the centralized JSC_BORROW accessor (one
                                // `unsafe` site for the field); the borrow is dropped
                                // before the assignment so no overlap with `&mut dev`.
                                let vm = dev.vm();
                                let has_tailwind = vm
                                    .transpiler
                                    .options
                                    .serve_plugins
                                    .iter()
                                    .flatten()
                                    .chain(vm.bake_config_plugin_names.iter())
                                    .find(|p| strings::includes(p, b"tailwind"))
                                    .map(|_| Default::default());
                                dev.has_tailwind_plugin_hack = has_tailwind;

                                let load_result: crate::server::GetOrStartLoadResult = dev
                                    .server
                                    .as_ref()
                                    .expect("infallible: server bound")
                                    .get_or_load_plugins(
                                        crate::server::ServePluginsCallback::DevServer,
                                    );
                                match load_result {
                                    crate::server::GetOrStartLoadResult::Pending => {
                                        dev.plugin_state = PluginState::Pending;
                                        plugin = PluginState::Pending;
                                        continue 'plugin;
                                    }
                                    crate::server::GetOrStartLoadResult::Err => {
                                        dev.plugin_state = PluginState::Err;
                                        plugin = PluginState::Err;
                                        continue 'plugin;
                                    }
                                    crate::server::GetOrStartLoadResult::Ready(ready) => {
                                        dev.plugin_state = PluginState::Loaded;
                                        dev.bundler_options.plugin =
                                            ready.map(::core::ptr::NonNull::from);
                                    }
                                }
                            }
                            break 'plugin;
                        }
                        PluginState::Pending => {
                            if ctx.on_defer(dev, BundleQueueType::NextBundle)? == Deferral::Answered
                            {
                                return Ok(());
                            }
                            dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                            dev.route_bundle_ptr(route_bundle_index).server_state =
                                route_bundle::State::DeferredToNextBundle;
                            return Ok(());
                        }
                        PluginState::Err => {
                            // TODO: render plugin error page
                            ctx.on_plugin_error()?;
                            return Ok(());
                        }
                        PluginState::Loaded => break 'plugin,
                    }
                }

                // Prepare a bundle with just this route.
                let mut entry_points = EntryPointList::empty();
                dev.append_route_entry_points_if_not_stale(&mut entry_points, route_bundle_index)?;

                // If all files were already bundled (possible with layouts),
                // then no entry points will be queued up here. That does
                // not mean the route is ready for presentation.
                if entry_points.set.is_empty() {
                    if !dev.bundling_failures.is_empty() {
                        dev.route_bundle_ptr(route_bundle_index).server_state =
                            route_bundle::State::PossibleBundlingFailures;
                        state = route_bundle::State::PossibleBundlingFailures;
                        continue 'sw;
                    } else {
                        dev.route_bundle_ptr(route_bundle_index).server_state =
                            route_bundle::State::Loaded;
                        state = route_bundle::State::Loaded;
                        continue 'sw;
                    }
                }

                // A bundle moves a route out of `Bundling` only through the requests that wait for it.
                if ctx.on_defer(dev, BundleQueueType::NextBundle)? == Deferral::Answered {
                    return Ok(());
                }
                dev.next_bundle.route_queue.put(route_bundle_index, ())?;
                dev.route_bundle_ptr(route_bundle_index).server_state =
                    route_bundle::State::Bundling;

                dev.start_async_bundle(entry_points, false, Instant::now())
                    .expect("oom");
                return Ok(());
            }
            route_bundle::State::DeferredToNextBundle => {
                debug_assert!(
                    dev.next_bundle
                        .route_queue
                        .get(&route_bundle_index)
                        .is_some()
                );
                ctx.on_defer(dev, BundleQueueType::NextBundle)?;
                return Ok(());
            }
            route_bundle::State::Bundling => {
                debug_assert!(dev.current_bundle.is_some());
                ctx.on_defer(dev, BundleQueueType::CurrentBundle)?;
                return Ok(());
            }
            route_bundle::State::PossibleBundlingFailures => {
                if !dev.bundling_failures.is_empty() {
                    // Trace the graph to see if there are any failures that are
                    // reachable by this route.
                    match check_route_failures(dev, route_bundle_index, ctx.to_dev_response())? {
                        CheckResult::Stop => return Ok(()),
                        CheckResult::Ok => {} // Errors were cleared or not in the way.
                        CheckResult::Rebuild => {
                            state = route_bundle::State::Unqueued;
                            continue 'sw;
                        }
                    }
                }

                dev.route_bundle_ptr(route_bundle_index).server_state = route_bundle::State::Loaded;
                state = route_bundle::State::Loaded;
                continue 'sw;
            }
            route_bundle::State::Loaded => {
                ctx.on_loaded(dev)?;
                return Ok(());
            }
        }
    }
}

pub(super) enum ReqOrSaved<'a> {
    Req(&'a mut Request),
    Aborted,
}

impl ReqOrSaved<'_> {
    fn method(&self) -> Method {
        match self {
            ReqOrSaved::Req(req) => Method::which(req.method()).unwrap_or(Method::POST),
            ReqOrSaved::Aborted => unreachable!(),
        }
    }
}

impl DevServer {
    fn defer_request(
        &mut self,
        bundle_field: BundleQueueType,
        route_bundle_index: route_bundle::Index,
        kind: deferred_request::HandlerKind,
        req: ReqOrSaved<'_>,
        resp: AnyResponse,
    ) -> crate::Result<Deferral> {
        let deferred_slot = self.deferred_request_pool.claim();
        let deferred_node_ptr: *mut deferred_request::Node = deferred_slot.addr().as_ptr();
        // Precompute the data slot pointer (used inside the initializer for
        // abort-callback registration) without forming a reference to the
        // still-uninitialized slot.
        // SAFETY: `deferred_node_ptr` is a valid (allocated, aligned) hive-pool
        // slot; `addr_of_mut!` projects to the field without a reference, so
        // the uninit `data` is never read.
        let deferred_data_ptr: *mut c_void =
            unsafe { ::core::ptr::addr_of_mut!((*deferred_node_ptr).data) }.cast::<c_void>();
        debug_log!("DeferredRequest(0x{:x}).init", deferred_data_ptr as usize);

        let method = match &req {
            ReqOrSaved::Req(r) => Method::which(r.method()).unwrap_or(Method::GET),
            _ => unreachable!(),
        };

        let mut deferred_data = DeferredRequest {
            route_bundle_index,
            dev: std::ptr::from_ref(self),
            referenced_by_devserver: true,
            weakly_referenced_by_requestcontext: false,
            handler: match kind {
                deferred_request::HandlerKind::BundledHtmlPage => 'brk: {
                    // Note: `on_aborted<U: 'static>` rejects `DeferredRequest`;
                    // erase to `c_void` and cast back inside the trampoline.
                    resp.on_aborted(
                        |p: *mut c_void, r: AnyResponse| {
                            // SAFETY: p is the &mut deferred.data registered below; lifetime erased
                            unsafe { &mut *p.cast::<DeferredRequest>() }.on_abort(r)
                        },
                        deferred_data_ptr,
                    );
                    break 'brk Handler::BundledHtmlPage(ResponseAndMethod {
                        response: resp,
                        method,
                    });
                }
                deferred_request::HandlerKind::ServerHandler => 'brk: {
                    let server_handler: SavedRequest = match req {
                        ReqOrSaved::Req(r) => {
                            let global = self.vm().global();
                            match self
                                .server
                                .as_ref()
                                .unwrap()
                                .prepare_and_save_js_request_context(
                                    r,
                                    resp,
                                    global,
                                    Some(method),
                                )? {
                                Some(saved) => saved,
                                // `deferred_slot` drops here, releasing the
                                // still-uninitialized slot without `drop_in_place`.
                                None => return Ok(Deferral::Answered),
                            }
                        }
                        _ => unreachable!(),
                    };
                    server_handler.ctx.ref_();
                    server_handler.ctx.set_additional_on_abort_callback(Some(
                        crate::server::any_request_context::AdditionalOnAbortCallback {
                            cb: {
                                fn cb(ptr: *mut c_void) {
                                    DeferredRequest::on_abort_wrapper(ptr)
                                }
                                cb
                            },
                            // SAFETY: deferred.data is a live field of a HiveArray-owned node
                            data: unsafe { ::core::ptr::NonNull::new_unchecked(deferred_data_ptr) },
                            deref_fn: {
                                fn deref_fn(ptr: *mut c_void) {
                                    // SAFETY: ptr is &mut DeferredRequest from above
                                    let self_: &mut DeferredRequest =
                                        unsafe { &mut *ptr.cast::<DeferredRequest>() };
                                    self_.weak_deref();
                                }
                                deref_fn
                            },
                        },
                    ));
                    break 'brk Handler::ServerHandler(server_handler);
                }
            },
        };

        if matches!(deferred_data.handler, Handler::ServerHandler(_)) {
            deferred_data.weak_ref();
        }

        // `next` is a placeholder: `prepend` overwrites it before any read.
        let deferred_ptr = deferred_slot
            .write(deferred_request::Node {
                next: ::core::ptr::null_mut(),
                data: ::core::mem::MaybeUninit::new(deferred_data),
            })
            .as_ptr();

        let requests_array = match bundle_field {
            BundleQueueType::CurrentBundle => {
                &mut self
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active")
                    .requests
            }
            BundleQueueType::NextBundle => &mut self.next_bundle.requests,
        };
        // SAFETY: `deferred_ptr` was just initialized via `deferred_slot.write()`.
        unsafe { requests_array.prepend(&mut *deferred_ptr) };
        Ok(Deferral::Queued)
    }
}

enum CheckResult {
    Stop,
    Ok,
    Rebuild,
}

fn check_route_failures(
    dev: &mut DevServer,
    route_bundle_index: route_bundle::Index,
    resp: AnyResponse,
) -> crate::Result<CheckResult> {
    let mut gts = dev.init_graph_trace_state(0)?;
    let _lock_guard = dev.graph_safety_lock.guard();
    match &dev.route_bundles[route_bundle_index.get() as usize].data {
        route_bundle::Data::Framework(fw) => {
            dev.trace_all_route_imports(fw.route_index, &mut gts, TraceImportGoal::FindErrors)?
        }
        route_bundle::Data::Html(html) => dev.client_graph.trace_imports(
            html.bundled_file,
            &mut gts,
            TraceImportGoal::FindErrors,
        )?,
    }
    if !gts.failures.is_empty() {
        // See comment on this field for information
        if !dev.assume_perfect_incremental_bundling {
            // Cache bust EVERYTHING reachable
            {
                let mut it = gts.client_bits.iterator::<true, true>();
                while let Some(file_index) = it.next() {
                    dev.client_graph.stale_files.set(file_index);
                }
            }
            {
                let mut it = gts.server_bits.iterator::<true, true>();
                while let Some(file_index) = it.next() {
                    dev.server_graph.stale_files.set(file_index);
                }
            }
            return Ok(CheckResult::Rebuild);
        }

        dev.send_serialized_failures(resp, &gts.failures, None)?;
        Ok(CheckResult::Stop)
    } else {
        // Failures are unreachable by this route, so it is OK to load.
        Ok(CheckResult::Ok)
    }
}

impl DevServer {
    pub(crate) fn respond_for_html_bundle(
        &mut self,
        html: bun_ptr::ThisPtr<HTMLBundleRoute>,
        req: &mut Request,
        resp: AnyResponse,
    ) -> Result<(), AllocError> {
        if !is_allowed_dev_host(self, req) {
            host_forbidden(resp);
            return Ok(());
        }
        let route_bundle_index = self
            .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))
            .map_err(|_| AllocError)?;
        let mut ctx = RequestEnsureRouteBundledCtx {
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::BundledHtmlPage,
            route_bundle_index,
        };
        let rbi = ctx.route_bundle_index;
        match ensure_route_is_bundled(self, rbi, &mut ctx) {
            Ok(()) => {}
            // This is the dev server's entry from Bun.serve's static-route
            // trampoline (`StaticRouteLike`, which otherwise never enters
            // JS): what bundling left pending is folded at this boundary.
            Err(err @ (jsc::JsError::Thrown | jsc::JsError::Terminated)) => {
                crate::dispatch::fold(Err(err))
            }
            Err(jsc::JsError::OutOfMemory) => return Err(AllocError),
        }
        Ok(())
    }

    pub(super) fn get_or_put_route_bundle(
        &mut self,
        route: route_bundle::UnresolvedIndex,
    ) -> crate::Result<route_bundle::Index> {
        let index_location: &::core::cell::Cell<route_bundle::IndexOptional> = match &route {
            route_bundle::UnresolvedIndex::Framework(route_index) => {
                ::core::cell::Cell::from_mut(&mut self.router.route_ptr_mut(*route_index).bundle)
            }
            route_bundle::UnresolvedIndex::Html(html) => &html.dev_server_id,
        };
        if let Some(bundle_index) = index_location.get() {
            return Ok(bundle_index);
        }

        let _g = self.graph_safety_lock.guard();

        // A file delivers its html to one route bundle only: a route `server.reload()` re-registers reuses it.
        if let route_bundle::UnresolvedIndex::Html(html) = route {
            let html_ref = &*html;
            if let Some(existing) = self
                .client_graph
                .bundled_files
                .get(&html_ref.bundle.path)
                .and_then(|file| file.html_route_bundle_index)
            {
                html_ref.dev_server_id.set(Some(existing));
                return Ok(existing);
            }
        }

        let bundle_index =
            route_bundle::Index::init(u32::try_from(self.route_bundles.len()).expect("int cast"));

        self.route_bundles.reserve(1);
        self.route_bundles.push(RouteBundle {
            data: match route {
                route_bundle::UnresolvedIndex::Framework(route_index) => {
                    route_bundle::Data::Framework(route_bundle::Framework {
                        route_index,
                        cached_module_list: jsc::StrongOptional::empty(),
                        cached_client_bundle_url: jsc::StrongOptional::empty(),
                        cached_css_file_array: jsc::StrongOptional::empty(),
                    })
                }
                route_bundle::UnresolvedIndex::Html(html) => 'brk: {
                    let html_ref = &*html;
                    let incremental_graph_index = self.client_graph.insert_stale_extra(
                        &html_ref.bundle.path,
                        bake::Graph::Client,
                        incremental_graph::RouteKind::Route,
                    )?;
                    let file = &mut self.client_graph.bundled_files.values_mut()
                        [incremental_graph_index.get() as usize];
                    file.html_route_bundle_index = Some(bundle_index);
                    break 'brk route_bundle::Data::Html(route_bundle::Html {
                        html_bundle: bun_ptr::RefPtr::from_this(html),
                        bundled_file: incremental_graph_index,
                        script_injection_offset: None,
                        cached_response: None,
                        bundled_html_text: None,
                    });
                }
            },
            client_script_generation: {
                let mut buf = [0u8; 4];
                bun_boringssl_sys::rand_bytes(&mut buf);
                u32::from_ne_bytes(buf)
            },
            server_state: route_bundle::State::Unqueued,
            client_bundle: None,
            active_viewers: 0,
        });
        index_location.set(Some(bundle_index));
        Ok(bundle_index)
    }
}

impl DevServer {
    pub(crate) fn route_to_bundle_index_slow(
        &mut self,
        pattern: &[u8],
    ) -> Option<route_bundle::Index> {
        let mut params: router::MatchedParams = Default::default();
        if let Some(route_index) = self.router.match_slow(pattern, &mut params) {
            return Some(
                self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
                    .expect("oom"),
            );
        }
        if let Some(html) = self.html_router.get(pattern) {
            return Some(
                self.get_or_put_route_bundle(route_bundle::UnresolvedIndex::Html(html))
                    .expect("oom"),
            );
        }
        None
    }
}

/// This structure does not increment the reference count of its contents, as
/// the lifetime of them are all tied to the underling Bun.serve instance.
/// `<'a>` retained only for the owning `DevServer<'a>`'s `Transpiler` borrows.
#[derive(Default)]
pub(crate) struct HTMLRouter {
    pub(crate) map: StringHashMap<bun_ptr::BackRef<HTMLBundleRoute, bun_ptr::Root>>,
    /// If a catch-all route exists, it is not stored in map, but here.
    pub(crate) fallback: Option<bun_ptr::BackRef<HTMLBundleRoute, bun_ptr::Root>>,
}

impl HTMLRouter {
    pub(crate) fn empty() -> HTMLRouter {
        HTMLRouter {
            map: StringHashMap::new(),
            fallback: None,
        }
    }

    pub(crate) fn get(&self, path: &[u8]) -> Option<bun_ptr::ThisPtr<HTMLBundleRoute>> {
        self.map
            .get(path)
            .copied()
            .or(self.fallback)
            .map(|r| r.this_ptr())
    }

    pub(crate) fn put(
        &mut self,
        path: &[u8],
        route: bun_ptr::BackRef<HTMLBundleRoute, bun_ptr::Root>,
    ) -> crate::Result<()> {
        if path == b"/*" {
            self.fallback = Some(route);
        } else {
            self.map.put(path, route)?;
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.map.clear();
        self.fallback = None;
    }
}

// HTMLRouter::deinit → Drop on map
