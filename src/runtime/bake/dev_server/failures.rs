//! Build failures: collecting, indexing and sending them to clients.

use super::*;

impl DevServer {
    pub(super) fn encode_serialized_failures(
        &self,
        failures: &[SerializedFailure],
        buf: &mut Vec<u8>,
        inspector_agent: Option<&BunFrontendDevServerAgent>,
    ) -> Result<(), AllocError> {
        let mut all_failures_len: usize = 0;
        for fail in failures {
            all_failures_len += fail.data.len();
        }
        let mut all_failures: Vec<u8> = Vec::with_capacity(all_failures_len);
        for fail in failures {
            all_failures.extend_from_slice(&fail.data);
        }

        let failures_start_buf_pos = buf.len();

        let len = bun_base64::encode_len(&all_failures);
        // Zero-extend then encode in place; `encode_len` is an upper bound so
        // truncate to the actual encoded length afterward. Avoids the
        // `spare_capacity_mut` + `set_len` unsafe dance for a one-shot path.
        buf.resize(failures_start_buf_pos + len, 0);
        let written = bun_base64::encode(&mut buf[failures_start_buf_pos..], &all_failures);
        buf.truncate(failures_start_buf_pos + written);

        // Re-use the encoded buffer to avoid encoding failures more times than neccecary.
        if let Some(agent) = inspector_agent {
            debug_assert!(agent.is_enabled());
            let failures_encoded = &buf[failures_start_buf_pos..];
            // base64 output is pure ASCII so a UTF-8 borrow is safe.
            agent.notify_bundle_failed(
                self.inspector_server_id,
                BunString::borrow_utf8(failures_encoded),
            );
        }
        Ok(())
    }

    pub(super) fn send_serialized_failures(
        &mut self,
        resp: AnyResponse,
        failures: &[SerializedFailure],
        inspector_agent: Option<&BunFrontendDevServerAgent>,
    ) -> crate::Result<()> {
        let mut buf: Vec<u8> = Vec::with_capacity(2048);

        let page_title = "Build Failed";
        write!(
            buf,
            concat!(
                "<!doctype html>\n",
                "<html lang=\"en\">\n",
                "<head>\n",
                "<meta charset=\"UTF-8\" />\n",
                "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n",
                "<title>Bun - {0}</title>\n",
                "<style>:root{{color-scheme:light dark}}body{{background:light-dark(white,black)}}</style>\n",
                "</head>\n",
                "<body>\n",
                "<noscript><h1 style=\"font:28px sans-serif;\">{0}</h1><p style=\"font:20px sans-serif;\">Bun requires JavaScript enabled in the browser to render this error screen, as well as receive hot reloading events.</p></noscript>\n",
                "<script>let error=Uint8Array.from(atob(\"",
            ),
            page_title
        )
        .unwrap();

        self.encode_serialized_failures(failures, &mut buf, inspector_agent)?;

        let pre = const_format::concatcp!(
            "\"),c=>c.charCodeAt(0));let config={bun:\"",
            bun_core::Global::package_json_version_with_canary,
            "\"};"
        );
        let post = "</script></body></html>";

        buf.extend_from_slice(pre.as_bytes());
        buf.extend_from_slice(bun_zstd::embed_compressed!(codegen "bake.error.js"));
        buf.extend_from_slice(post.as_bytes());

        StaticRoute::send_blob_then_deinit(
            resp,
            crate::webcore::blob::Any::from_array_list(buf),
            crate::server::static_route::InitFromBytesOptions {
                mime_type: Some(&MimeType::HTML),
                server: self.server,
                status_code: 500,
                ..Default::default()
            },
        );
        Ok(())
    }
}

pub(super) fn mark_all_route_children(
    router: &FrameworkRouter,
    bits: &mut [&mut DynamicBitSet],
    route_index: router::RouteIndex,
) {
    let mut next = router.route_ptr(route_index).first_child;
    while let Some(child_index) = next {
        let route = router.route_ptr(child_index);
        if let Some(index) = route.bundle {
            for b in bits.iter_mut() {
                b.set(index.get() as usize);
            }
        }
        mark_all_route_children(router, bits, child_index);
        next = route.next_sibling;
    }
}

impl DevServer {
    pub(crate) fn prepare_and_log_resolution_failures(&mut self) -> crate::Result<()> {
        // Since resolution failures can be asynchronous, their logs are not inserted
        // until the very end.
        let resolution_failures = &self
            .current_bundle
            .as_ref()
            .expect("infallible: bundle active")
            .resolution_failure_entries;
        if !resolution_failures.is_empty() {
            for (owner, log) in resolution_failures
                .keys()
                .iter()
                .zip(resolution_failures.values())
            {
                if log.has_errors() {
                    // `resolution_failure_entries` keys are `OwnerPacked` (1-bit side + file).
                    let index = owner.file();
                    match owner.side() {
                        bake::Side::Client => self.client_graph.insert_failure(
                            incremental_graph::InsertFailureKey::Index(index),
                            log,
                        )?,
                        bake::Side::Server => self.server_graph.insert_failure(
                            incremental_graph::InsertFailureKey::Index(index),
                            log,
                        )?,
                    }
                }
            }
        }

        // Theoretically, it shouldn't be possible for errors to leak into dev.log
        if self.log.has_errors() && !self.log.msgs.is_empty() {
            if cfg!(debug_assertions) {
                bun_core::debug_warn!("dev.log should not be written into when using DevServer");
            }
            let _ = self.log.print(std::ptr::from_mut(Output::error_writer()));
        }
        Ok(())
    }

    /// A route that a bundle left without html must not reach the loaded state: fail its file instead.
    pub(super) fn report_html_routes_without_html(&mut self) -> crate::Result<()> {
        for route_bundle in &self.route_bundles {
            let route_bundle::Data::Html(html) = &route_bundle.data else {
                continue;
            };
            if html.bundled_html_text.is_some() {
                continue;
            }
            let file_index = html.bundled_file;
            let failed_in_this_bundle = |failure: &SerializedFailure| {
                matches!(
                    failure.get_owner(),
                    serialized_failure::Owner::Client(owner) if owner == file_index
                )
            };
            let has_failure = match route_bundle.server_state {
                route_bundle::State::Unqueued | route_bundle::State::DeferredToNextBundle => {
                    continue;
                }
                // `finalize_bundle` answers this bundle's requests from the failures it added: re-add an older one.
                route_bundle::State::Bundling => self
                    .incremental_result
                    .failures_added
                    .iter()
                    .any(failed_in_this_bundle),
                // An earlier failure still gates the route, unless this bundle cleared it without delivering html.
                route_bundle::State::PossibleBundlingFailures | route_bundle::State::Loaded => {
                    self.client_graph.bundled_files.values()[file_index.get() as usize].failed
                }
            };
            if has_failure {
                continue;
            }

            let log = html.html_bundle.bundle.no_html_page_log();
            self.client_graph.insert_failure(
                incremental_graph::InsertFailureKey::Index(file_index.get()),
                &log,
            )?;
        }
        Ok(())
    }

    pub(super) fn index_failures(&mut self) -> crate::Result<()> {
        // After inserting failures into the IncrementalGraphs, they are traced to their routes.

        if !self.incremental_result.failures_added.is_empty() {
            let mut total_len: usize =
                ::core::mem::size_of::<MessageId>() + ::core::mem::size_of::<u32>();

            for fail in &self.incremental_result.failures_added {
                total_len += fail.data.len();
            }

            total_len +=
                self.incremental_result.failures_removed.len() * ::core::mem::size_of::<u32>();

            let mut gts = self.init_graph_trace_state(0)?;

            let mut payload: Vec<u8> = Vec::with_capacity(total_len);
            payload.push(MessageId::Errors.char());

            payload.extend_from_slice(
                &u32::try_from(self.incremental_result.failures_removed.len())
                    .unwrap()
                    .to_le_bytes(),
            );

            for removed in &self.incremental_result.failures_removed {
                payload.extend_from_slice(&removed.get_owner().encode().bits().to_le_bytes());
                removed.deinit(self);
            }

            for added in &self.incremental_result.failures_added {
                payload.extend_from_slice(&added.data);

                match added.get_owner() {
                    serialized_failure::Owner::None | serialized_failure::Owner::Route(_) => {
                        unreachable!()
                    }
                    serialized_failure::Owner::Server(index) => {
                        self.server_graph.trace_dependencies(
                            index,
                            &mut gts,
                            incremental_graph::TraceDependencyGoal::NoStop,
                            index,
                        )?
                    }
                    serialized_failure::Owner::Client(index) => {
                        self.client_graph.trace_dependencies(
                            index,
                            &mut gts,
                            incremental_graph::TraceDependencyGoal::NoStop,
                            index,
                        )?
                    }
                }
            }

            // Note: iterate by index — the loop bodies need
            // `&mut self.route_bundles` / `&mut self.router`, which conflicts
            // with the `&self.incremental_result` iterator borrow.
            for i in 0..self.incremental_result.framework_routes_affected.len() {
                let entry = self.incremental_result.framework_routes_affected[i];
                if let Some(index) = self.router.route_ptr(entry.route_index()).bundle {
                    self.route_bundle_ptr(index).server_state =
                        route_bundle::State::PossibleBundlingFailures;
                }
                if entry.should_recurse_when_visiting() {
                    self.mark_all_route_children_failed(entry.route_index());
                }
            }

            for i in 0..self.incremental_result.html_routes_soft_affected.len() {
                let index = self.incremental_result.html_routes_soft_affected[i];
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }

            for i in 0..self.incremental_result.html_routes_hard_affected.len() {
                let index = self.incremental_result.html_routes_hard_affected[i];
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::BINARY);
        } else if !self.incremental_result.failures_removed.is_empty() {
            let mut payload: Vec<u8> = Vec::with_capacity(
                ::core::mem::size_of::<MessageId>()
                    + ::core::mem::size_of::<u32>()
                    + self.incremental_result.failures_removed.len()
                        * ::core::mem::size_of::<u32>(),
            );
            payload.push(MessageId::Errors.char());

            payload.extend_from_slice(
                &u32::try_from(self.incremental_result.failures_removed.len())
                    .unwrap()
                    .to_le_bytes(),
            );

            for removed in &self.incremental_result.failures_removed {
                payload.extend_from_slice(&removed.get_owner().encode().bits().to_le_bytes());
                removed.deinit(self);
            }

            self.publish(HmrTopic::Errors, &payload, Opcode::BINARY);
        }

        self.incremental_result.failures_removed.clear();
        Ok(())
    }

    /// Note: The log is not consumed here
    pub(crate) fn handle_parse_task_failure(
        &mut self,
        err: &crate::Error,
        graph: bake::Graph,
        abs_path: &[u8],
        log: &Log,
        bv2: &mut BundleV2,
    ) -> Result<(), AllocError> {
        let graph_lock = self.graph_safety_lock.guard();

        debug_log!(
            "handleParseTaskFailure({}, .{}, {}, {} messages)",
            err.name(),
            <&'static str>::from(graph),
            bun_core::fmt::quote(abs_path),
            log.msgs.len(),
        );

        let mut watch_for_route_file = false;
        if matches!(err.name(), "ENOENT" | "FileNotFound" | "ModuleNotFound") {
            // Special-case files being deleted: the importers report them.
            match graph {
                bake::Graph::Server | bake::Graph::Ssr => {
                    self.server_graph.on_file_deleted(abs_path, bv2)?
                }
                bake::Graph::Client => {
                    self.client_graph.on_file_deleted(abs_path, bv2)?;
                    // The html file of a route has no importer.
                    if let Some(file) = self
                        .client_graph
                        .bundled_files
                        .get(abs_path)
                        .filter(|file| file.html_route_bundle_index.is_some())
                    {
                        // `failed` is cleared by the next successful bundle.
                        watch_for_route_file = !file.failed;
                        self.client_graph.insert_failure(
                            incremental_graph::InsertFailureKey::AbsPath(abs_path, graph),
                            log,
                        )?;
                    }
                }
            }
        } else {
            let key = incremental_graph::InsertFailureKey::AbsPath(abs_path, graph);
            match graph {
                bake::Graph::Server | bake::Graph::Ssr => {
                    self.server_graph.insert_failure(key, log)?
                }
                bake::Graph::Client => self.client_graph.insert_failure(key, log)?,
            }
        }
        // `track_resolution_failure` takes the graph lock itself.
        drop(graph_lock);

        if watch_for_route_file {
            // Bundles the route again once its html file exists, like a failed import.
            self.directory_watchers.track_resolution_failure(
                abs_path,
                paths::basename(abs_path),
                bake::Graph::Client,
                Loader::Html,
            )?;
        }
        Ok(())
    }

    /// Return a log to write resolution failures into.
    pub(crate) fn get_log_for_resolution_failures(
        &mut self,
        abs_path: &[u8],
        graph: bake::Graph,
    ) -> crate::Result<&mut Log> {
        debug_assert!(self.current_bundle.is_some());

        let _g = self.graph_safety_lock.guard();

        let owner: serialized_failure::OwnerPacked = if graph == bake::Graph::Client {
            let idx = self.client_graph.insert_stale(abs_path, graph)?;
            serialized_failure::OwnerPacked::new(bake::Side::Client, idx.get())
        } else {
            let idx = self.server_graph.insert_stale(abs_path, graph)?;
            serialized_failure::OwnerPacked::new(bake::Side::Server, idx.get())
        };
        let current_bundle = self
            .current_bundle
            .as_mut()
            .expect("infallible: bundle active");
        let gop = current_bundle
            .resolution_failure_entries
            .get_or_put(owner)?;
        if !gop.found_existing {
            *gop.value_ptr = Log::init();
        }
        Ok(gop.value_ptr)
    }

    fn mark_all_route_children_failed(&mut self, route_index: router::RouteIndex) {
        let mut next = self.router.route_ptr(route_index).first_child;
        while let Some(child_index) = next {
            let route = self.router.route_ptr(child_index);
            let bundle = route.bundle;
            let next_sibling = route.next_sibling;
            if let Some(index) = bundle {
                self.route_bundle_ptr(index).server_state =
                    route_bundle::State::PossibleBundlingFailures;
            }
            self.mark_all_route_children_failed(child_index);
            next = next_sibling;
        }
    }
}
