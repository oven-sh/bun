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
    fn compute_arguments_for_framework_request(
        &mut self,
        global: &JSGlobalObject,
        route_bundle_index: route_bundle::Index,
        params_js_value: JSValue,
    ) -> JsResult<FrameworkRequestArgs> {
        let route_bundle = &mut self.route_bundles[route_bundle_index.get() as usize];
        debug_assert!(route_bundle.server_state == route_bundle::State::Loaded);
        let client_script_generation: u32 = route_bundle.client_script_generation;
        let route_bundle::Data::Framework(framework_bundle) = &mut route_bundle.data else {
            unreachable!()
        };
        let route_index = framework_bundle.route_index;
        let router_type = self
            .router
            .type_ptr(self.router.route_ptr(route_index).r#type);
        let has_client_file = router_type.client_file.is_some();

        Ok(FrameworkRequestArgs {
            // routerTypeMain
            router_type_main: match router_type.server_file_string.get() {
                Some(s) => s,
                None => 'str: {
                    let name = &self.server_graph.bundled_files.keys()[from_opaque_file_id::<
                        { bake::Side::Server },
                    >(
                        router_type.server_file
                    )
                    .get()
                        as usize];
                    let mut buf = paths::path_buffer_pool::get();
                    let s = bun_string_jsc::create_utf8_for_js(
                        global,
                        relative_path(&self.root, &mut *buf, name),
                    )?;
                    router_type.server_file_string = jsc::StrongOptional::create(s, global);
                    break 'str s;
                }
            },
            // routeModules
            route_modules: match framework_bundle.cached_module_list.get() {
                Some(a) => a,
                None => 'arr: {
                    let keys = self.server_graph.bundled_files.keys();
                    let mut n: usize = 1;
                    let mut route = self.router.route_ptr(route_index);
                    loop {
                        if route.file_layout.is_some() {
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = self.router.route_ptr(p);
                    }
                    let arr = JSValue::create_empty_array(global, n)?;
                    route = self.router.route_ptr(route_index);
                    {
                        let mut buf = paths::path_buffer_pool::get();
                        let route_name = relative_path(
                            &self.root,
                            &mut *buf,
                            &keys[from_opaque_file_id::<{ bake::Side::Server }>(
                                route.file_page.unwrap(),
                            )
                            .get() as usize],
                        );
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
                            let layout_name = relative_path(
                                &self.root,
                                &mut *buf,
                                &keys[from_opaque_file_id::<{ bake::Side::Server }>(layout).get()
                                    as usize],
                            );
                            arr.put_index(
                                global,
                                u32::try_from(n).expect("int cast"),
                                bun_string_jsc::create_utf8_for_js(global, layout_name)?,
                            )?;
                            n += 1;
                        }
                        let Some(p) = route.parent else { break };
                        route = self.router.route_ptr(p);
                    }
                    framework_bundle.cached_module_list = jsc::StrongOptional::create(arr, global);
                    break 'arr arr;
                }
            },
            // clientId: none when the router has no client entry, so there is no bundle to load.
            client_id: match framework_bundle.cached_client_bundle_url.get() {
                _ if !has_client_file => JSValue::NULL,
                Some(s) => s,
                None => 'str: {
                    let bundle_index: u32 = route_bundle_index.get();
                    let generation: u32 = client_script_generation;
                    // Fixed 8-char native-endian byte hex per u32; `on_js_request`
                    // slices exactly 16 chars and decodes via `parse_hex_to_u64`.
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
                    let js = self.generate_css_js_array(route_index)?;
                    let route_bundle::Data::Framework(framework_bundle) =
                        &mut self.route_bundles[route_bundle_index.get() as usize].data
                    else {
                        unreachable!()
                    };
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

        let args = self.compute_arguments_for_framework_request(
            global,
            route_bundle_index,
            params_js_value,
        )?;

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
        let route_bundle = &mut self.route_bundles[route_bundle_index.get() as usize];
        debug_assert!(matches!(route_bundle.data, route_bundle::Data::Html(_)));

        let blob: bun_ptr::ThisPtr<StaticRoute> = match &route_bundle.data.html().cached_response {
            Some(blob) => blob.this_ptr(),
            None => {
                let payload = Self::generate_html_payload(
                    &self.graph_safety_lock,
                    &self.server_graph,
                    &mut self.client_graph,
                    route_bundle_index,
                    route_bundle,
                )
                .expect("oom");

                let response = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::HTML),
                        server: self.server,
                        ..Default::default()
                    },
                );
                let blob = response.this_ptr();
                route_bundle.data.html_mut().cached_response = Some(response);
                blob
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
    /// Takes the fields it needs, so that the caller can keep its borrow of `route_bundle`.
    fn generate_html_payload(
        graph_safety_lock: &ThreadLock,
        server_graph: &IncrementalGraph<{ bake::Side::Server }>,
        client_graph: &mut IncrementalGraph<{ bake::Side::Client }>,
        route_bundle_index: route_bundle::Index,
        route_bundle: &RouteBundle,
    ) -> crate::Result<Vec<u8>> {
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

        let _lock = graph_safety_lock.guard();

        // Prepare bitsets for tracing
        let mut gts = GraphTraceState::new(
            server_graph.bundled_files.len(),
            client_graph.bundled_files.len(),
        )?;
        // Run tracing
        client_graph.reset();
        client_graph.trace_imports(html.bundled_file, &mut gts, TraceImportGoal::FindCss)?;

        let css_ids: &[u64] = &client_graph.current_css_files;

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

        // A route of a router with no client entry has no browser bundle.
        if let route_bundle::Data::Framework(fw) = &route_bundle.data
            && self
                .router
                .type_ptr_const(self.router.route_ptr(fw.route_index).r#type)
                .client_file
                .is_none()
        {
            resp.write_status(b"404 Not Found");
            resp.end(b"", false);
            return;
        }
        let source_map_id = route_bundle.source_map_id();
        let client_bundle: bun_ptr::ThisPtr<StaticRoute> = match &route_bundle.client_bundle {
            Some(client_bundle) => client_bundle.this_ptr(),
            None => {
                let root = match &route_bundle.data {
                    route_bundle::Data::Framework(fw) => {
                        route_bundle::TraceRoot::Framework(fw.route_index)
                    }
                    route_bundle::Data::Html(html) => {
                        route_bundle::TraceRoot::Html(html.bundled_file)
                    }
                };
                let payload = self
                    .generate_client_bundle(root, source_map_id)
                    .expect("oom");
                let bundle = StaticRoute::init_from_any_blob(
                    crate::webcore::AnyBlob::from_owned_slice(payload),
                    crate::server::static_route::InitFromBytesOptions {
                        mime_type: Some(&MimeType::JAVASCRIPT),
                        server: self.server,
                        ..Default::default()
                    },
                );
                let client_bundle = bundle.this_ptr();
                self.route_bundles[bundle_index.get() as usize].client_bundle = Some(bundle);
                client_bundle
            }
        };
        self.source_maps.add_weak_ref(source_map_id);
        StaticRoute::on_with_method(client_bundle, method, resp);
    }
}

impl DevServer {
    /// Used to generate the entry point. Unlike incremental patches, this always
    /// contains all needed files for a route.
    fn generate_client_bundle(
        &mut self,
        root: route_bundle::TraceRoot,
        script_id: source_map_store::Key,
    ) -> crate::Result<Vec<u8>> {
        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        // `current_chunk_parts`/`current_chunk_len` are scratch buffers shared with
        // the HMR pipeline. We must leave them cleared on every exit path.
        let mut reset_on_exit = scopeguard::guard(self, |this| this.client_graph.reset());
        let this = &mut **reset_on_exit;
        match root {
            route_bundle::TraceRoot::Framework(route_index) => this.trace_all_route_imports(
                route_index,
                &mut gts,
                TraceImportGoal::FindClientModules,
            )?,
            route_bundle::TraceRoot::Html(bundled_file) => this.client_graph.trace_imports(
                bundled_file,
                &mut gts,
                TraceImportGoal::FindClientModules,
            )?,
        }

        let mut react_fast_refresh_id: &[u8] = b"";
        if let Some(rfr) = &this.framework.react_fast_refresh {
            'brk: {
                let Some(rfr_index) = this.client_graph.get_file_index(&rfr.import_source) else {
                    break 'brk;
                };
                if !this
                    .client_graph
                    .stale_files
                    .is_set(rfr_index.get() as usize)
                {
                    this.client_graph.trace_imports(
                        rfr_index,
                        &mut gts,
                        TraceImportGoal::FindClientModules,
                    )?;
                    react_fast_refresh_id = &rfr.import_source;
                }
            }
        }

        let route_page_files = match root {
            route_bundle::TraceRoot::Framework(route_index) => {
                Some(this.client_page_files(route_index))
            }
            route_bundle::TraceRoot::Html(_) => None,
        }
        .filter(|files| files.page.is_some() || !files.layouts.is_empty());

        let client_file: Option<incremental_graph::ClientFileIndex> = match root {
            route_bundle::TraceRoot::Framework(route_index) => {
                let type_idx = this.router.route_ptr(route_index).r#type;
                this.router
                    .type_ptr(type_idx)
                    .client_file
                    .map(from_opaque_file_id::<{ bake::Side::Client }>)
            }
            route_bundle::TraceRoot::Html(bundled_file) => Some(bundled_file),
        };

        // Insert the source map
        map_log!("inc {:x}, 1 for generateClientBundle", script_id.get());
        match this.source_maps.put_or_increment_ref_count(script_id, 1)? {
            source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => {
                gts.clear_and_free();
                // allocates internally with the global allocator in the port.
                if let Err(err) = this.client_graph.take_source_map(entry) {
                    this.source_maps.unref(script_id);
                    return Err(err);
                }
            }
            source_map_store::PutOrIncrementRefCount::Shared(_) => {}
        }

        let initial_entry: &[u8] = if let Some(idx) = client_file {
            &this.client_graph.bundled_files.keys()[idx.get() as usize]
        } else {
            b""
        };
        let client_bundle =
            this.client_graph
                .take_js_bundle(&incremental_graph::TakeJSBundleOptionsClient {
                    kind: crate::bake::dev_server::ChunkKind::InitialResponse,
                    root: &this.root,
                    configuration_hash_key: &this.configuration_hash_key,
                    initial_response_entry_point: initial_entry,
                    react_refresh_entry_point: react_fast_refresh_id,
                    script_id,
                    console_log: this.should_receive_console_log_from_browser(),
                    route_page_files: route_page_files.as_ref(),
                })?;
        Ok(client_bundle)
    }

    fn generate_css_js_array(&mut self, route_index: router::RouteIndex) -> JsResult<JSValue> {
        let _lock = self.graph_safety_lock.guard();

        // Prepare bitsets
        let mut gts = self.init_graph_trace_state(0)?;

        // Run tracing
        self.client_graph.reset();
        self.trace_all_route_imports(route_index, &mut gts, TraceImportGoal::FindCss)?;

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
