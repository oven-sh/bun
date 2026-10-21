//! Rendering responses: framework pages, HTML pages, and their client scripts and CSS.

use super::*;

struct FrameworkRequestArgs {
    router_type_main: JSValue,
    route_modules: JSValue,
    client_id: JSValue,
    styles: JSValue,
    params: JSValue,
}

impl DevServer {
    /// Note: raw-pointer receiver. A previous version of this body bound
    /// long-lived `&mut RouteBundle` / `&mut Type` from
    /// `&mut *self_ptr` and then reborrowed `&mut *self_ptr` again — overlapping
    /// `&mut` UB. Per docs/PORTING.md §Global mutable state we instead stay in
    /// raw-ptr land: hold `*mut Self` / `*mut Type` and deref per-access via
    /// place projection (`(*this).field`), never materializing a whole-struct
    /// `&mut DevServer` while a sub-borrow is live.
    ///
    /// SAFETY: `this` must point to a live `DevServer`; `framework_bundle` must
    /// point into `(*this).route_bundles[route_bundle_index].data`. Neither
    /// `route_bundles` nor `router.types` is reallocated during this call.
    // `&(...)` is deliberate — sidesteps dangerous_implicit_autorefs.
    #[allow(clippy::needless_borrow)]
    unsafe fn compute_arguments_for_framework_request(
        this: *mut Self,
        route_bundle_index: route_bundle::Index,
        framework_bundle: &mut route_bundle::Framework,
        params_js_value: JSValue,
    ) -> JsResult<FrameworkRequestArgs> {
        // SAFETY: `this` is live; `vm` is a `BackRef` (safe Deref); `vm.global`
        // is valid for VM lifetime.
        let global = unsafe { &*(&(*this).vm).global };
        // SAFETY: place projections off `*this` — `router` / `server_graph` /
        // `route_bundles` are disjoint fields; each reborrow is scoped to its
        // expression so no two `&mut` overlap. `framework_bundle` lives in
        // `route_bundles[_].data`, disjoint from every other field touched here.
        let route_type_idx = unsafe {
            (*this)
                .router
                .route_ptr(framework_bundle.route_index)
                .r#type
        };
        // SAFETY: held raw; deref per-access. `router.types` is a `Box<[Type]>` —
        // never reallocated for the lifetime of `DevServer`.
        let router_type: *mut router::Type = unsafe { (*this).router.type_ptr(route_type_idx) };
        // SAFETY: scalar copy — `route_bundles[i]` is otherwise only read (via
        // `generate_css_js_array`, which takes `&RouteBundle`).
        let client_script_generation: u32 = unsafe {
            (&(*this).route_bundles)[route_bundle_index.get() as usize].client_script_generation
        };

        Ok(FrameworkRequestArgs {
            // routerTypeMain
            // SAFETY: `router_type` points into `router.types`, never reallocated for `DevServer`'s lifetime.
            router_type_main: match unsafe { (*router_type).server_file_string.get() } {
                Some(s) => s,
                None => 'str: {
                    // SAFETY: `server_graph` is disjoint from `router` / `route_bundles`.
                    let name = unsafe {
                        &(*this).server_graph.bundled_files.keys()[from_opaque_file_id::<
                            { bake::Side::Server },
                        >(
                            (*router_type).server_file
                        )
                        .get()
                            as usize]
                    };
                    let mut buf = paths::path_buffer_pool::get();
                    let s = bun_string_jsc::create_utf8_for_js(
                        global,
                        // SAFETY: `relative_path(&self)` only reads `self.root`;
                        // no `&mut` derived from `*this` is live across this call.
                        unsafe { (*this).relative_path(&mut *buf, name) },
                    )?;
                    // SAFETY: per-access raw deref; `router.types` not reallocated.
                    unsafe {
                        (*router_type).server_file_string = jsc::StrongOptional::create(s, global)
                    };
                    break 'str s;
                }
            },
            // routeModules
            route_modules: match framework_bundle.cached_module_list.get() {
                Some(a) => a,
                None => 'arr: {
                    // SAFETY: `server_graph` / `router` are disjoint from
                    // `route_bundles`; `route` is a `&Route` reborrowed per step.
                    let keys = unsafe { (*this).server_graph.bundled_files.keys() };
                    let mut n: usize = 1;
                    // SAFETY: `this` is live; `router.routes` is not reallocated during this fn.
                    let mut route =
                        unsafe { (*this).router.route_ptr(framework_bundle.route_index) };
                    loop {
                        if route.file_layout.is_some() {
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        // SAFETY: `this` is live; `router.routes` is not reallocated during this fn.
                        route = unsafe { (*this).router.route_ptr(p) };
                    }
                    let arr = JSValue::create_empty_array(global, n)?;
                    // SAFETY: `this` is live; `router.routes` is not reallocated during this fn.
                    route = unsafe { (*this).router.route_ptr(framework_bundle.route_index) };
                    {
                        let mut buf = paths::path_buffer_pool::get();
                        // SAFETY: `relative_path(&self)` only reads `self.root`; no `&mut *this` is live.
                        let route_name = unsafe {
                            (*this).relative_path(
                                &mut *buf,
                                &keys[from_opaque_file_id::<{ bake::Side::Server }>(
                                    route.file_page.unwrap(),
                                )
                                .get() as usize],
                            )
                        };
                        arr.put_index(
                            global,
                            0,
                            bun_string_jsc::create_utf8_for_js(global, route_name)?,
                        )?;
                    }
                    n = 1;
                    loop {
                        if let Some(layout) = route.file_layout {
                            let mut buf = paths::path_buffer_pool::get();
                            // SAFETY: `relative_path(&self)` only reads `self.root`; no `&mut *this` is live.
                            let layout_name = unsafe {
                                (*this).relative_path(
                                    &mut *buf,
                                    &keys[from_opaque_file_id::<{ bake::Side::Server }>(layout)
                                        .get() as usize],
                                )
                            };
                            arr.put_index(
                                global,
                                u32::try_from(n).expect("int cast"),
                                bun_string_jsc::create_utf8_for_js(global, layout_name)?,
                            )?;
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        // SAFETY: `this` is live; `router.routes` is not reallocated during this fn.
                        route = unsafe { (*this).router.route_ptr(p) };
                    }
                    framework_bundle.cached_module_list = jsc::StrongOptional::create(arr, global);
                    break 'arr arr;
                }
            },
            // clientId: none when the router has no client entry, so there is no bundle to load.
            client_id: match framework_bundle.cached_client_bundle_url.get() {
                // SAFETY: per-access raw deref; `router.types` not reallocated.
                _ if unsafe { (*router_type).client_file }.is_none() => JSValue::NULL,
                Some(s) => s,
                None => 'str: {
                    let bundle_index: u32 = route_bundle_index.get();
                    let generation: u32 = client_script_generation;
                    // Fixed 8-char native-endian byte hex per u32; `on_js_request`
                    // slices exactly 16 chars and decodes via `parse_hex_to_int`.
                    let mut hex = [0u8; 16];
                    bun_core::fmt::bytes_to_hex_lower(&bundle_index.to_ne_bytes(), &mut hex[..8]);
                    bun_core::fmt::bytes_to_hex_lower(&generation.to_ne_bytes(), &mut hex[8..]);
                    // SAFETY: `bytes_to_hex_lower` writes ASCII [0-9a-f] only.
                    let hex_str = unsafe { ::core::str::from_utf8_unchecked(&hex) };
                    let js = BunString::create_format(format_args!(
                        "{CLIENT_PREFIX}/route-{hex_str}.js",
                    ))
                    .into_js(global)?;
                    framework_bundle.cached_client_bundle_url =
                        jsc::StrongOptional::create(js, global);
                    break 'str js;
                }
            },
            // styles
            styles: match framework_bundle.cached_css_file_array.get() {
                Some(a) => a,
                None => 'arr: {
                    // SAFETY: `generate_css_js_array` reads `client_graph` /
                    // `router` and the `&RouteBundle`; it never reallocates
                    // `route_bundles`. The `&mut *this` whole-struct reborrow
                    // here is the *only* one in this fn — no other `&`/`&mut`
                    // derived from `*this` is live across it (`router_type` /
                    // `keys` / `route` were all consumed in earlier arms).
                    let js = unsafe {
                        (*this).generate_css_js_array(
                            &(&(*this).route_bundles)[route_bundle_index.get() as usize],
                        )
                    }?;
                    framework_bundle.cached_css_file_array =
                        jsc::StrongOptional::create(js, global);
                    break 'arr js;
                }
            },
            // params
            params: params_js_value,
        })
    }

    pub(super) fn on_framework_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        req: SavedRequestUnion,
        resp: AnyResponse,
    ) -> JsResult<()> {
        // Note: erase the `&mut RouteBundle` to a raw pointer so subsequent
        // `&self` accesses (vm/router/callback) don't trip borrowck.
        let route_bundle: *mut RouteBundle = self.route_bundle_ptr(route_bundle_index);
        debug_assert!(matches!(
            // SAFETY: `route_bundle` points into `self.route_bundles`, not resized in this fn.
            unsafe { &(*route_bundle).data },
            route_bundle::Data::Framework(_)
        ));

        // SAFETY: `route_bundle` points into `self.route_bundles`, which is not
        // resized or dropped for the duration of this fn.
        let framework_bundle = match unsafe { &mut (*route_bundle).data } {
            route_bundle::Data::Framework(f) => f,
            _ => unreachable!(),
        };

        // Extract route params by re-matching the URL
        // TODO: lazy structure caching since we are making these objects a lot
        let global = self.vm().global();
        let params_js_value = {
            let mut params: router::MatchedParams = Default::default();
            let url_bunstr = match &req {
                // SAFETY: r is a uws Request ptr valid for the duration of the handler callback
                SavedRequestUnion::Stack(r) => bun_core::StringView::borrow_utf8((**r).url()),
                SavedRequestUnion::Saved(data) => {
                    // SAFETY: data.request is a live *mut webcore::Request (held strong by ctx)
                    bun_core::StringView::new(unsafe { (*data.request).url.get() })
                }
            };
            let url = url_bunstr.to_utf8();
            // Extract pathname from URL (remove protocol, host, query, hash)
            let pathname = extract_pathname_from_url(url.slice());
            if self.router.match_slow(pathname, &mut params).is_some() {
                params.to_js(global)?
            } else {
                JSValue::NULL
            }
        };

        let server_request_callback = self
            .server_fetch_function_callback
            .get()
            .expect("did not initialize server code");

        // SAFETY: `self` is live; `framework_bundle` points into
        // `self.route_bundles[route_bundle_index].data`. Raw-ptr receiver — see
        // Note on `compute_arguments_for_framework_request`.
        let args = unsafe {
            Self::compute_arguments_for_framework_request(
                self,
                route_bundle_index,
                framework_bundle,
                params_js_value,
            )
        }?;

        self.server
            .as_ref()
            .expect("infallible: server bound")
            .on_saved_request(
                req,
                resp,
                server_request_callback,
                [
                    args.router_type_main,
                    args.route_modules,
                    args.client_id,
                    args.styles,
                    args.params,
                ],
            );
        Ok(())
    }

    pub(super) fn on_html_request_with_bundle(
        &mut self,
        route_bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        // Note: erase `self` to a raw pointer so the `route_bundle` borrow
        // doesn't conflict with the `&mut self` calls below. Per docs/PORTING.md §Global mutable state: hold
        // `*mut T` and deref per-access; do not bind a long-lived `&mut`.
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // SAFETY: `route_bundles` is not reallocated for the duration of this fn.
        let route_bundle: *mut RouteBundle =
            &raw mut unsafe { &mut *self_ptr }.route_bundles[route_bundle_index.get() as usize];
        debug_assert!(matches!(
            // SAFETY: `route_bundle` points into `self.route_bundles`, not resized in this fn.
            unsafe { &(*route_bundle).data },
            route_bundle::Data::Html(_)
        ));

        // SAFETY: `route_bundle` points into `self.route_bundles`, not resized in
        // this fn; the shared reborrow ends with this statement.
        let cached: Option<bun_ptr::ThisPtr<StaticRoute>> =
            unsafe { (*route_bundle).data.html().cached_response.as_ref() }
                .map(bun_ptr::RefPtr::this_ptr);
        let blob: bun_ptr::ThisPtr<StaticRoute> = match cached {
            Some(blob) => blob,
            None => 'generate: {
                // SAFETY: `generate_html_payload` reads `route_bundle.data` /
                // `client_graph` and never reallocates `route_bundles`. No
                // `&mut` into `*route_bundle` is live across this call; both
                // reborrows end when it returns.
                let payload = unsafe {
                    Self::generate_html_payload(&mut *self_ptr, route_bundle_index, &*route_bundle)
                }
                .expect("oom");

                let response = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::HTML),
                        // SAFETY: `self_ptr` is `&mut self` erased; live for this fn body.
                        server: unsafe { &*self_ptr }.server,
                        ..Default::default()
                    },
                );
                let blob = response.this_ptr();
                // SAFETY: per-access reborrow; no other `&` into `*route_bundle` live.
                unsafe { (*route_bundle).data.html_mut().cached_response = Some(response) };
                break 'generate blob;
            }
        };
        StaticRoute::on_with_method(blob, method, resp);
    }
}

/// This payload is used to unref the source map weak reference if the page
/// starts loading but the JavaScript code is not reached. The event handler
/// is replaced by the HMR runtime to one that handles things better.
const SCRIPT_UNREF_PAYLOAD: &str = concat!(
    "<script>",
    "((a)=>{",
    "document.addEventListener('visibilitychange',",
    "globalThis[Symbol.for('bun:loadData')]=()=>",
    "document.visibilityState==='hidden'&&",
    "navigator.sendBeacon('/_bun/unref',a)",
    ");",
    "})(document.querySelector('[data-bun-dev-server-script]').src.slice(-11,-3))",
    "</script>",
);

impl DevServer {
    fn generate_html_payload(
        &mut self,
        route_bundle_index: route_bundle::Index,
        route_bundle: &RouteBundle,
    ) -> crate::Result<Vec<u8>> {
        // Re-derive `html` here from `route_bundle.data` so the
        // caller never holds two `&mut` into the same allocation. `route_bundle`
        // is read-only in this fn — `&RouteBundle` suffices.
        let html = route_bundle.data.html();
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
        debug_assert!(html.html_bundle.dev_server_id.get() == Some(route_bundle_index));
        debug_assert!(html.cached_response.is_none());
        // `report_html_routes_without_html` keeps a route without these out of the loaded state.
        let script_injection_offset = html
            .script_injection_offset
            .expect("loaded html route has no script injection offset")
            .get_usize();
        let bundled_html = html
            .bundled_html_text
            .as_ref()
            .expect("loaded html route has no bundled html");

        // The bundler records an offsets in development mode, splitting the HTML
        // file into two chunks. DevServer is able to insert style/script tags
        // using the information available in IncrementalGraph.
        let before_head_end = &bundled_html[..script_injection_offset];
        let after_head_end = &bundled_html[script_injection_offset..];

        let mut display_name = strings::without_suffix_comptime(
            paths::basename(&html.html_bundle.bundle.path),
            b".html",
        );
        // TODO: function for URL safe chars
        if !strings::is_all_ascii(display_name) || strings::contains_char(display_name, b'"') {
            display_name = b"page";
        }

        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets for tracing
        let mut gts = self.init_graph_trace_state(0)?;
        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindCss)?;

        let css_ids: &[u64] = &self.client_graph.current_css_files;

        let payload_size = bundled_html.len()
            + ("<link rel=\"stylesheet\" href=\"".len()
                + ASSET_PREFIX.len()
                + "/0000000000000000.css\">".len())
                * css_ids.len()
            + "<script type=\"module\" crossorigin src=\"\" data-bun-dev-server-script></script>"
                .len()
            + CLIENT_PREFIX.len()
            + "/".len()
            + display_name.len()
            + "-0000000000000000.js".len()
            + SCRIPT_UNREF_PAYLOAD.len();

        let mut array: Vec<u8> = Vec::with_capacity(payload_size);
        array.extend_from_slice(before_head_end);

        // Insert all link tags before "</head>"
        let mut hex_buf = [0u8; 16];
        for name in css_ids {
            array.extend_from_slice(b"<link rel=\"stylesheet\" href=\"");
            array.extend_from_slice(ASSET_PREFIX.as_bytes());
            array.extend_from_slice(b"/");
            let n = bun_core::fmt::bytes_to_hex_lower(&name.to_ne_bytes(), &mut hex_buf);
            array.extend_from_slice(&hex_buf[..n]);
            array.extend_from_slice(b".css\">");
        }

        array.extend_from_slice(b"<script type=\"module\" crossorigin src=\"");
        array.extend_from_slice(CLIENT_PREFIX.as_bytes());
        array.extend_from_slice(b"/");
        array.extend_from_slice(display_name);
        array.extend_from_slice(b"-");
        let n = bun_core::fmt::bytes_to_hex_lower(
            &(route_bundle_index.get() as u32).to_ne_bytes(),
            &mut hex_buf,
        );
        array.extend_from_slice(&hex_buf[..n]);
        let n = bun_core::fmt::bytes_to_hex_lower(
            &route_bundle.client_script_generation.to_ne_bytes(),
            &mut hex_buf,
        );
        array.extend_from_slice(&hex_buf[..n]);
        array.extend_from_slice(b".js\" data-bun-dev-server-script></script>");
        array.extend_from_slice(SCRIPT_UNREF_PAYLOAD.as_bytes());

        // DevServer used to put the script tag before the body end, but to match the regular bundler it does not do this.
        array.extend_from_slice(after_head_end);
        debug_assert!(array.len() == array.capacity()); // incorrect memory allocation size
        Ok(array)
    }

    pub(super) fn generate_javascript_code_for_html_file(
        &mut self,
        index: bun_ast::Index,
        import_records: &[bun_ast::import_record::List<'_>],
        input_file_sources: &[bun_ast::Source],
        loaders: &[Loader],
    ) -> crate::Result<Box<[u8]>> {
        let mut array: Vec<u8> = Vec::with_capacity(65536);
        let w = &mut array;

        w.extend_from_slice(b"  ");
        bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
            input_file_sources[index.get() as usize].path.pretty,
            w,
        )?;
        w.extend_from_slice(b": [ [");
        let mut any = false;
        for import in import_records[index.get() as usize].as_slice() {
            if import.source_index.is_valid() {
                if !loaders[import.source_index.get() as usize].is_javascript_like() {
                    continue; // ignore non-JavaScript imports
                }
            } else {
                // Find the in-graph import.
                let Some(file) = self.client_graph.bundled_files.get(import.path.text) else {
                    continue;
                };
                if !matches!(file.content, incremental_graph::Content::Js(_)) {
                    continue;
                }
            }
            if !any {
                any = true;
                w.extend_from_slice(b"\n");
            }
            w.extend_from_slice(b"    ");
            bun_js_printer::write_json_string::<_, { bun_js_printer::Encoding::Utf8 }>(
                import.path.pretty,
                w,
            )?;
            w.extend_from_slice(b", 0,\n");
        }
        if any {
            w.extend_from_slice(b"  ");
        }
        w.extend_from_slice(b"], [], [], () => {}, false],\n");

        // Avoid-recloning if it is was moved to the heap
        Ok(array.into_boxed_slice())
    }

    /// Serves `/_bun/client/<route>-<generation>.js`.
    pub(super) fn serve_client_script(
        &mut self,
        bundle_index: route_bundle::Index,
        generation: u32,
        resp: AnyResponse,
        method: Method,
    ) {
        let route_bundle = &self.route_bundles[bundle_index.get() as usize];
        if route_bundle.client_script_generation != generation
            || route_bundle.server_state != route_bundle::State::Loaded
        {
            return resp.corked(move || on_outdated_js_corked(resp));
        }

        // The in-flight bundle already freed the code of every file that failed in it, so wait for it to finish.
        if route_bundle.client_bundle.is_none()
            && let Some(current_bundle) = &mut self.current_bundle
        {
            let deferred = bun_ptr::RefPtr::new(DeferredScriptRequest {
                ref_count: ::core::cell::Cell::new(1),
                route_bundle_index: bundle_index,
                generation,
                response: ::core::cell::Cell::new(Some(ResponseAndMethod {
                    response: resp,
                    method,
                })),
            });
            // `script_requests` keeps `deferred` alive until the response removes this handler.
            resp.on_aborted_this(
                |deferred: bun_ptr::ThisPtr<DeferredScriptRequest>, _: AnyResponse| {
                    deferred.response.set(None)
                },
                deferred.this_ptr(),
            );
            current_bundle.script_requests.push(deferred);
            return;
        }

        self.on_js_request_with_bundle(bundle_index, resp, method);
    }

    fn on_js_request_with_bundle(
        &mut self,
        bundle_index: route_bundle::Index,
        resp: AnyResponse,
        method: Method,
    ) {
        let self_ptr = std::ptr::from_mut::<Self>(self);
        // SAFETY: statement-scoped reborrow; the returned `&mut RouteBundle`
        // immediately decays to a raw pointer.
        let route_bundle: *mut RouteBundle =
            unsafe { &mut *self_ptr }.route_bundle_ptr(bundle_index);
        // A route of a router with no client entry has no browser bundle.
        // SAFETY: shared, statement-scoped reads; nothing mutates `route_bundles` or `router` here.
        if let route_bundle::Data::Framework(fw) = unsafe { &(*route_bundle).data } {
            // SAFETY: as above, a shared read of a field that nothing mutates here.
            let router = unsafe { &(*self_ptr).router };
            if router
                .type_ptr_const(router.route_ptr(fw.route_index).r#type)
                .client_file
                .is_none()
            {
                resp.write_status(b"404 Not Found");
                resp.end(b"", false);
                return;
            }
        }
        // SAFETY: `route_bundle` points into `self.route_bundles`, not resized in
        // this fn; the shared reborrow ends with this statement.
        let cached: Option<bun_ptr::ThisPtr<StaticRoute>> =
            unsafe { (*route_bundle).client_bundle.as_ref() }.map(bun_ptr::RefPtr::this_ptr);
        let client_bundle: bun_ptr::ThisPtr<StaticRoute> = match cached {
            Some(client_bundle) => client_bundle,
            None => 'generate: {
                // SAFETY: `generate_client_bundle` reads `*route_bundle` and
                // never reallocates `route_bundles`; no `&mut` into
                // `*route_bundle` is live across this call.
                let payload =
                    unsafe { Self::generate_client_bundle(&mut *self_ptr, &*route_bundle) }
                        .expect("oom");
                let bundle = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::JAVASCRIPT),
                        // SAFETY: `self_ptr` is `&mut self` erased; live for this fn body.
                        server: unsafe { &*self_ptr }.server,
                        ..Default::default()
                    },
                );
                let client_bundle = bundle.this_ptr();
                // SAFETY: per-access reborrow; no other `&` into `*route_bundle` live.
                unsafe { (*route_bundle).client_bundle = Some(bundle) };
                break 'generate client_bundle;
            }
        };
        // SAFETY: shared, statement-scoped read of `*route_bundle`.
        let source_map_id = unsafe { &*route_bundle }.source_map_id();
        // SAFETY: `source_maps` is disjoint from `route_bundles`.
        unsafe { &mut (*self_ptr).source_maps }.add_weak_ref(source_map_id);
        StaticRoute::on_with_method(client_bundle, method, resp);
    }
}

impl DevServer {
    /// Used to generate the entry point. Unlike incremental patches, this always
    /// contains all needed files for a route.
    fn generate_client_bundle(&mut self, route_bundle: &RouteBundle) -> crate::Result<Vec<u8>> {
        debug_assert!(route_bundle.client_bundle.is_none());
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);

        let _lock = self.graph_safety_lock.guard();
        // Note: scopeguard closures capture `self` by ref, wedging borrowck for
        // the rest of the fn. Erase to a raw pointer.
        let self_ptr: *mut Self = self;

        // Prepare bitsets
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        // `current_chunk_parts`/`current_chunk_len` are scratch buffers shared with
        // the HMR pipeline. We must leave them cleared on every exit path.
        // SAFETY: see `self_ptr` SAFETY above.
        // Note: copy `self_ptr` so the `defer!` closure captures a distinct
        // local — otherwise borrowck treats `*self_ptr` as held for the guard's
        // lifetime and rejects later `&mut (*self_ptr).…` reborrows.
        let self_ptr_defer: *mut Self = self_ptr;
        scopeguard::defer! {
            // SAFETY: `self_ptr_defer` is `&mut self` erased; live for this fn body.
            unsafe { (*self_ptr_defer).client_graph.reset() }
        };
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindClientModules)?;

        let mut react_fast_refresh_id: &[u8] = b"";
        if let Some(rfr) = &self.framework.react_fast_refresh {
            'brk: {
                let Some(rfr_index) = self.client_graph.get_file_index(&rfr.import_source) else {
                    break 'brk;
                };
                if !self
                    .client_graph
                    .stale_files
                    .is_set(rfr_index.get() as usize)
                {
                    self.client_graph.trace_imports(
                        rfr_index,
                        &mut gts,
                        TraceImportGoal::FindClientModules,
                    )?;
                    react_fast_refresh_id = &rfr.import_source;
                }
            }
        }

        let route_page_files = match &route_bundle.data {
            route_bundle::Data::Framework(fw) => Some(self.client_page_files(fw.route_index)),
            route_bundle::Data::Html(_) => None,
        }
        .filter(|files| files.page.is_some() || !files.layouts.is_empty());

        let client_file: Option<incremental_graph::ClientFileIndex> = match &route_bundle.data {
            route_bundle::Data::Framework(fw) => {
                let type_idx = self.router.route_ptr(fw.route_index).r#type;
                self.router
                    .type_ptr(type_idx)
                    .client_file
                    .map(from_opaque_file_id::<{ bake::Side::Client }>)
            }
            route_bundle::Data::Html(html) => Some(html.bundled_file),
        };

        // Insert the source map
        let script_id = route_bundle.source_map_id();
        map_log!("inc {:x}, 1 for generateClientBundle", script_id.get());
        match self.source_maps.put_or_increment_ref_count(script_id, 1)? {
            source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => {
                // SAFETY: `self_ptr` is live for the entire fn body; guard runs at scope exit.
                // errdefer: unref on early-`?`; disarmed via `into_inner` on success.
                let guard = scopeguard::guard(script_id, move |id| unsafe {
                    (*self_ptr).source_maps.unref(id)
                });
                gts.clear_and_free();
                // allocates internally with the global allocator in the port.
                // SAFETY: see `self_ptr` SAFETY above; `client_graph` is a
                // disjoint field from `source_maps`.
                unsafe { &mut (*self_ptr).client_graph }.take_source_map(entry)?;
                scopeguard::ScopeGuard::into_inner(guard);
            }
            source_map_store::PutOrIncrementRefCount::Shared(_) => {}
        }

        // Note: `take_js_bundle` mutably borrows `client_graph` while
        // `initial_entry` would alias `client_graph.bundled_files.keys()[idx]`.
        // Clone the key (a short path string) so the borrow ends before the
        // `&mut client_graph` call; cold path (per-route bundle finalize).
        let initial_entry: Vec<u8> = if let Some(idx) = client_file {
            self.client_graph.bundled_files.keys()[idx.get() as usize].to_vec()
        } else {
            Vec::new()
        };
        let client_bundle =
            self.client_graph
                .take_js_bundle(&incremental_graph::TakeJSBundleOptionsClient {
                    kind: crate::bake::dev_server::ChunkKind::InitialResponse,
                    initial_response_entry_point: &initial_entry,
                    react_refresh_entry_point: react_fast_refresh_id,
                    script_id,
                    console_log: self.should_receive_console_log_from_browser(),
                    route_page_files: route_page_files.as_ref(),
                })?;
        Ok(client_bundle)
    }

    fn generate_css_js_array(&mut self, route_bundle: &RouteBundle) -> JsResult<JSValue> {
        debug_assert!(matches!(
            route_bundle.data,
            route_bundle::Data::Framework(_)
        ));
        debug_assert!(!route_bundle.data.framework().cached_css_file_array.has());
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);

        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_bundle, &mut gts, TraceImportGoal::FindCss)?;

        let names: &[u64] = &self.client_graph.current_css_files;
        let global = self.vm().global();
        let arr = jsc::JSArray::create_empty(global, names.len())?;
        for (i, item) in names.iter().enumerate() {
            let mut buf =
                [0u8; ASSET_PREFIX.len() + ::core::mem::size_of::<u64>() * 2 + "/.css".len()];
            let buf_len = buf.len();
            let path = {
                let mut cursor = &mut buf[..];
                write!(
                    cursor,
                    "{}/{}.css",
                    ASSET_PREFIX,
                    bstr::BStr::new(
                        bun_core::fmt::bytes_to_hex_lower_string(&item.to_ne_bytes()).as_bytes()
                    ),
                )
                .expect("unreachable");
                let written = buf_len - cursor.len();
                &buf[..written]
            };
            arr.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                bun_string_jsc::create_utf8_for_js(global, path)?,
            )?;
        }
        Ok(arr)
    }
}
