//! Finishing a bundle: applying results to the graphs and sending hot updates.

use super::*;

pub(crate) struct HotUpdateContext<'a> {
    /// bundle_v2.Graph.input_files.items(.source)
    pub sources: &'a [bun_ast::Source],
    /// bundle_v2.Graph.ast.items(.import_records)
    pub import_records: &'a [bun_ast::import_record::List<'a>],
    /// bundle_v2.Graph.input_files.items(.loader)
    pub loaders: &'a [Loader],
    /// Which files have a server-component boundary.
    pub server_to_client_bitset: DynamicBitSet,
    /// Used to reduce calls to the IncrementalGraph hash table.
    /// First half is for client graph, second half for server.
    pub resolved_index_cache: &'a mut [CachedFileIndex],
    /// Used to tell if the server should replace or append import records.
    pub server_seen_bit_set: DynamicBitSet,
    pub gts: &'a mut GraphTraceState,
}

/// Sentinel-encoded `Option<FileIndex>` packed into a `u32` (`u32::MAX` == none).
/// Side-erased so the `resolved_index_cache` backing slice stores it directly;
/// callers re-tag with the correct `FileIndex<SIDE>` on `unwrap`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) struct CachedFileIndex(pub u32);

impl CachedFileIndex {
    pub(crate) const NONE: Self = Self(u32::MAX);
    #[inline]
    pub(crate) fn unwrap<const SIDE: bake::Side>(
        self,
    ) -> Option<incremental_graph::FileIndex<SIDE>> {
        if self.0 == u32::MAX {
            None
        } else {
            Some(incremental_graph::FileIndex::<SIDE>::init(self.0))
        }
    }
}

impl<const SIDE: bake::Side> From<Option<incremental_graph::FileIndex<SIDE>>> for CachedFileIndex {
    fn from(v: Option<incremental_graph::FileIndex<SIDE>>) -> Self {
        match v {
            Some(i) => Self(i.get()),
            None => Self::NONE,
        }
    }
}

impl<'a> HotUpdateContext<'a> {
    pub(crate) fn get_cached_index(
        &mut self,
        side: bake::Side,
        i: impl Into<bun_ast::Index>,
    ) -> &mut CachedFileIndex {
        let i: bun_ast::Index = i.into();
        let len = self.sources.len();
        let start = match side {
            bake::Side::Client => 0,
            bake::Side::Server => len,
        };

        &mut self.resolved_index_cache[start..][..len][i.get() as usize]
    }
}

fn finalize_bundle_cleanup(dev: &mut DevServer, bv2: &mut BundleV2, had_sent_hmr_event: bool) {
    bv2.deinit_without_freeing_arena();
    let script_requests = match &mut dev.current_bundle {
        Some(current_bundle) => ::core::mem::take(&mut current_bundle.script_requests),
        None => Vec::new(),
    };
    // Drops `CurrentBundle.heap` (the arena `bv2.graph.heap` borrows).
    dev.current_bundle = None;
    dev.log.clear_and_free();

    let _ = dev.assets.reindex_if_needed(); // not fatal

    // Answer these before `start_next_bundle_if_present` below, or they'd wait for that bundle too.
    for deferred in script_requests {
        if let Some(ResponseAndMethod { response, method }) = deferred.response.take() {
            dev.serve_client_script(
                deferred.route_bundle_index,
                deferred.generation,
                response,
                method,
            );
        }
    }

    // Signal for testing framework where it is in synchronization
    if matches!(
        dev.testing_batch_events,
        TestingBatchEvents::EnableAfterBundle
    ) {
        dev.testing_batch_events = TestingBatchEvents::Enabled(TestingBatch::empty());
        dev.publish(
            HmrTopic::TestingWatchSynchronization,
            &[MessageId::TestingWatchSynchronization.char(), 0],
            Opcode::BINARY,
        );
    } else {
        dev.publish(
            HmrTopic::TestingWatchSynchronization,
            &[
                MessageId::TestingWatchSynchronization.char(),
                if had_sent_hmr_event { 4 } else { 3 },
            ],
            Opcode::BINARY,
        );
    }

    dev.start_next_bundle_if_present();

    // If the call above started another bundle, its cleanup releases the batch.
    if matches!(
        dev.testing_batch_events,
        TestingBatchEvents::ReleaseAfterBundle(_)
    ) && dev.current_bundle.is_none()
    {
        let TestingBatchEvents::ReleaseAfterBundle(batch) =
            core::mem::replace(&mut dev.testing_batch_events, TestingBatchEvents::Disabled)
        else {
            unreachable!()
        };
        dev.release_testing_batch(batch);
    }

    // Unref the ref added in `start_async_bundle`
    if let Some(server) = dev.server.as_mut() {
        server.on_static_request_complete();
    }
}

pub(super) fn drain_current_bundle_requests(current_bundle: &mut CurrentBundle) {
    if !current_bundle.requests.first.is_null() {
        // cannot be an assertion because in the case of OOM, the request list was not drained.
        bun_core::debug!(
            "current_bundle.requests.first != null. this leaves pending requests without an error page!",
        );
    }
    while let Some(node) = current_bundle.requests.pop_first() {
        // SAFETY: pop_first returns a live `*mut Node<T>`; `data` was
        // initialized by `defer_request`.
        let req = unsafe { (*node).data.assume_init_mut() };
        req.abort_and_deref();
    }
}

/// Called at the end of BundleV2 to index bundle contents into the `IncrementalGraph`s
/// This function does not recover DevServer state if it fails (allocation failure)
pub(super) fn finalize_bundle(
    dev: &mut DevServer,
    bv2: &mut BundleV2,
    result: &mut bundler::bundle_v2::DevServerOutput,
) -> JsResult<()> {
    debug_assert!(dev.magic == Magic::Valid);
    // Note: `had_sent_hmr_event` is read inside the outer-defer scopeguard
    // and mutated later in the body. Use a `Cell` so the closure capture is `&Cell`
    // (shared), letting the body keep writing through `.set()`.
    let had_sent_hmr_event = ::core::cell::Cell::new(false);

    // Both `defer!`s below (outer cleanup, then current_bundle request
    // drain) are registered before the first fallible operation — the only
    // statements in between are infallible (raw-pointer copies and the
    // `expect` on an invariant). Guards run LIFO (drain → outer), and the
    // `graph_safety_lock` guard declared after them drops first.
    // Note: erase `dev`/`bv2` to raw pointers inside the guard so the
    // long-lived closure capture doesn't lock borrowck for the entire fn body.
    let dev_ptr = std::ptr::from_mut::<DevServer>(dev);
    let bv2_ptr = std::ptr::from_mut::<BundleV2>(bv2);
    // Note: copy the raw ptrs into closure-only locals so `defer!`'s by-ref
    // capture does not hold `*dev_ptr`/`*bv2_ptr` borrowed for the entire fn body.
    let dev_ptr_outer: *mut DevServer = dev_ptr;
    let bv2_ptr_outer: *mut BundleV2 = bv2_ptr;
    scopeguard::defer! {
        // SAFETY: `dev`/`bv2` are `&mut` params erased above; both outlive
        // this fn-scoped guard, and no borrow of either is live when it runs.
        unsafe {
            finalize_bundle_cleanup(
                &mut *dev_ptr_outer,
                &mut *bv2_ptr_outer,
                had_sent_hmr_event.get(),
            )
        };
    };

    // Note: holding `&mut CurrentBundle` for the rest of the fn locks `*dev`
    // mutably. Erase to a raw pointer and reborrow at each use site via the
    // `current_bundle!()` macro.
    let current_bundle_ptr: *mut CurrentBundle = dev
        .current_bundle
        .as_mut()
        .expect("infallible: bundle active");
    macro_rules! current_bundle {
        () => {
            // SAFETY: `dev.current_bundle` is `Some` for the entire fn body —
            // it is only set to `None` inside the outer `finalize_bundle_cleanup` defer, which runs after
            // every use of this macro. `dev.current_bundle` is never reassigned
            // (so the inner `CurrentBundle` is not moved) between here and the
            // outer-defer.
            unsafe { &mut *current_bundle_ptr }
        };
    }
    // Note: see `dev_ptr_outer` rationale above — separate copy for the
    // `defer!` capture so `current_bundle!()` keeps reborrowing freely.
    let current_bundle_ptr_defer: *mut CurrentBundle = current_bundle_ptr;
    scopeguard::defer! {
        // SAFETY: see `current_bundle!` SAFETY above; this `defer!` runs
        // before the outer cleanup guard (LIFO), so `current_bundle_ptr` is
        // still live and no borrow of `*current_bundle_ptr` remains.
        unsafe { drain_current_bundle_requests(&mut *current_bundle_ptr_defer) };
    };

    let _lock = dev.graph_safety_lock.guard();

    // Note: `js_pseudo_chunk()`/`css_chunks()`/`html_chunks()` each take
    // `&mut DevServerOutput`, so calling more than one wedges borrowck. Split
    // `result.chunks` once up front (the three regions are disjoint:
    // `[0] | [1..1+n_css] | [1+n_css..1+n_css+n_html]`).
    let n_css = result.css_file_list.count();
    let n_html = result.html_files.count();
    // Note: snapshot `result.chunks` ptr/len before `split_at_mut` so the
    // CSS-chunk loop can re-form the full slice for `intermediate_output.code()`
    // without re-borrowing `result.chunks` (already split).
    let chunks_ptr: *mut bundler::chunk::Chunk = result.chunks.as_mut_ptr();
    let chunks_len = result.chunks.len();
    scopeguard::defer! {
        // SAFETY: `chunks_ptr/len` snapshot the arena slice before any `split_at_mut`.
        unsafe {
            ::core::ptr::drop_in_place(::core::ptr::slice_from_raw_parts_mut(
                chunks_ptr, chunks_len,
            ));
        }
    };
    let (js_chunk_slice, rest_chunks) = result.chunks.split_at_mut(1);
    let js_chunk = &mut js_chunk_slice[0];
    let (css_chunks_mut, html_rest) = rest_chunks.split_at_mut(n_css);
    let html_chunks_mut = &mut html_rest[..n_html];
    let input_file_sources = bv2.graph.input_files.items_source();
    let input_file_loaders = bv2.graph.input_files.items_loader();
    let import_records = bv2.graph.ast.items_import_records();
    let targets = bv2.graph.ast.items_target();
    let scbs = bv2.graph.server_component_boundaries.slice();

    let mut scb_bitset = DynamicBitSet::init_empty(input_file_sources.len())?;
    for ((source_index, ssr_index), ref_index) in scbs
        .list
        .items_source_index()
        .iter()
        .zip(scbs.list.items_ssr_source_index())
        .zip(scbs.list.items_reference_source_index())
    {
        scb_bitset.set(*source_index as usize);
        scb_bitset.set(*ref_index as usize);
        if (*ssr_index as usize) < scb_bitset.capacity() {
            scb_bitset.set(*ssr_index as usize);
        }
    }

    let mut resolved_index_cache = vec![CachedFileIndex::NONE; input_file_sources.len() * 2];

    // Note: ctx fields `server_seen_bit_set`/`gts` are seeded with
    // placeholders and assigned AFTER Pass 1 (receive_chunk grows `bundled_files`, so the trace bitsets
    // must be sized post-Pass-1). Seed with empty placeholders; real init below.
    let mut gts_storage = GraphTraceState {
        server_bits: DynamicBitSet::default(),
        client_bits: DynamicBitSet::default(),
        failures: Vec::new(),
    };
    let mut ctx = HotUpdateContext {
        import_records,
        sources: input_file_sources,
        loaders: input_file_loaders,
        server_to_client_bitset: scb_bitset,
        resolved_index_cache: &mut resolved_index_cache,
        server_seen_bit_set: DynamicBitSet::default(), // assigned below
        gts: &mut gts_storage,
    };

    let quoted_source_contents = bv2.linker.graph.files.items_quoted_source_contents();
    // Pass 1, update the graph's nodes, resolving every bundler source
    // index into its `IncrementalGraph(...).FileIndex`
    debug_assert_eq!(
        js_chunk.content.javascript().parts_in_chunk_in_order.len(),
        js_chunk.compile_results_for_chunk.len()
    );
    for (part_range, compile_result) in js_chunk
        .content
        .javascript()
        .parts_in_chunk_in_order
        .iter()
        .zip(js_chunk.compile_results_for_chunk.iter())
    {
        let index = part_range.source_index;
        // Report a part that failed to print as its file's failure, like a parse error.
        if let bundler::CompileResult::Javascript {
            result: bun_js_printer::PrintResult::Err(err),
            ..
        } = compile_result
        {
            let source = &ctx.sources[index.get() as usize];
            let mut log = Log::init();
            match err {
                bun_js_printer::Error::StackOverflow => log.add_error(
                    Some(source),
                    bun_ast::Loc::EMPTY,
                    "Maximum call stack size exceeded while generating code for this file",
                ),
                err => log.add_error_fmt(
                    Some(source),
                    bun_ast::Loc::EMPTY,
                    format_args!("Failed to generate code for this file ({})", err.name()),
                ),
            }
            let graph = targets[index.get() as usize].bake_graph();
            let key = incremental_graph::InsertFailureKey::AbsPath(
                source.path.key_for_incremental_graph(),
                graph,
            );
            match graph {
                bake::Graph::Client => dev.client_graph.insert_failure(key, &log)?,
                bake::Graph::Server | bake::Graph::Ssr => {
                    dev.server_graph.insert_failure(key, &log)?
                }
            }
            continue;
        }
        let source_map: bun_sourcemap::Chunk = match compile_result.source_map_chunk() {
            Some(c) => c.clone(),
            None => 'brk: {
                // The source map is `null` if empty
                debug_assert!(matches!(
                    compile_result,
                    bundler::CompileResult::Javascript {
                        result: bun_js_printer::PrintResult::Result(_),
                        ..
                    }
                ));
                debug_assert!(
                    dev.server_transpiler().options.source_map
                        != bundler::options::SourceMapOption::None
                );
                debug_assert!(!part_range.source_index.is_runtime());
                break 'brk bun_sourcemap::Chunk::init_empty();
            }
        };
        let quoted_contents = &quoted_source_contents[part_range.source_index.get() as usize];
        match targets[part_range.source_index.get() as usize].bake_graph() {
            bake::Graph::Client => dev.client_graph.receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ReceiveChunkContent::Js {
                    code: compile_result.code().to_vec().into_boxed_slice(),
                    source_map: Some(incremental_graph::ReceiveChunkSourceMap {
                        chunk: source_map,
                        // `quoted_contents` lives in the per-bundle AST heap,
                        // which is destroyed at bundle end; copy onto the
                        // global heap so the dev-server can hold it across
                        // rebuilds for stack-trace remapping.
                        escaped_source: quoted_contents
                            .as_ref()
                            .map(|v| v.as_slice().to_vec().into_boxed_slice()),
                    }),
                },
                false,
            )?,
            graph @ (bake::Graph::Server | bake::Graph::Ssr) => dev.server_graph.receive_chunk(
                &mut ctx,
                index,
                incremental_graph::ReceiveChunkContent::Js {
                    code: compile_result.code().to_vec().into_boxed_slice(),
                    source_map: Some(incremental_graph::ReceiveChunkSourceMap {
                        chunk: source_map,
                        // `quoted_contents` lives in the per-bundle AST heap,
                        // which is destroyed at bundle end; copy onto the
                        // global heap so the dev-server can hold it across
                        // rebuilds for stack-trace remapping.
                        escaped_source: quoted_contents
                            .as_ref()
                            .map(|v| v.as_slice().to_vec().into_boxed_slice()),
                    }),
                },
                graph == bake::Graph::Ssr,
            )?,
        }
    }

    for (chunk, metadata) in css_chunks_mut.iter_mut().zip(result.css_file_list.values()) {
        debug_assert!(matches!(chunk.content, bundler::chunk::Content::Css(_)));

        let index = bun_ast::Index::init(chunk.entry_point.source_index());

        // Report a chunk that failed to print as its entry point's failure. The next
        // good build's `receive_chunk` clears it.
        let entry_source = &ctx.sources[index.get() as usize];
        let mut log = Log::init();
        for compile_result in chunk.compile_results_for_chunk.iter() {
            let (err, err_source_index) = match compile_result {
                bundler::CompileResult::Css {
                    result: Err(err),
                    source_index,
                    ..
                } => (err, *source_index),
                _ => continue,
            };
            let err_source = if err_source_index != bun_ast::Index::INVALID.get() {
                &ctx.sources[err_source_index as usize]
            } else {
                entry_source
            };
            log.add_error_fmt(
                Some(err_source),
                bun_ast::Loc::EMPTY,
                format_args!("Failed to generate CSS for this file ({})", err.name()),
            );
        }
        if log.errors > 0 {
            let entry_key = entry_source.path.key_for_incremental_graph();
            dev.client_graph.insert_failure(
                incremental_graph::InsertFailureKey::AbsPath(entry_key, bake::Graph::Client),
                &log,
            )?;
            let file_index = dev
                .client_graph
                .get_file_index(entry_key)
                .expect("insert_failure registered the entry");
            // Pass 2 needs the index to diff the `@import` edges. Editing an imported
            // file follows those edges to rebundle this chunk.
            *ctx.get_cached_index(bake::Side::Client, index) =
                CachedFileIndex::from(Some(file_index));
            dev.client_graph
                .restore_failed_css_root(file_index, hash(entry_key));
            // This lets a server route's trace reach the failed client file.
            if metadata.imported_on_server {
                dev.server_graph
                    .insert_css_file_on_server(&mut ctx, index, entry_key)?;
            }
            continue;
        }

        // Note: `IntermediateOutput::code` takes `&mut self` (a field of
        // `*chunk`) plus `chunk: &Chunk` and `chunks: &[Chunk]`; borrowck still
        // rejects the overlap (`&mut chunk.intermediate_output` aliases the
        // shared `&chunk` / `&chunks[..]`). Split via raw
        // pointers — the callee never reborrows `chunk.intermediate_output`
        // through the `chunk`/`chunks` params (it reads metadata only).
        let code = {
            let chunk_ptr: *mut bundler::chunk::Chunk = chunk;
            // SAFETY: `intermediate_output` is a disjoint field of `*chunk`;
            // `code()` does not access it via the `chunk`/`chunks` arguments.
            let io = unsafe { &mut (*chunk_ptr).intermediate_output };
            io.code(
                None,
                &bv2.graph,
                &bv2.linker.graph,
                b"THIS_SHOULD_NEVER_BE_EMITTED_IN_DEV_MODE",
                // SAFETY: see above; shared reborrow of the same allocation,
                // disjoint from the `&mut intermediate_output` receiver.
                unsafe { &*chunk_ptr },
                // SAFETY: `result.chunks` outlives this loop body;
                // `chunks_ptr/len` were snapshotted before `split_at_mut`,
                // and `code()` only reads.
                unsafe { ::core::slice::from_raw_parts(chunks_ptr, chunks_len) },
                None,
                bundler::chunk::ReferencePathStyle::ImporterRelative,
                bundler::chunk::SourceMapShiftTracking::Disabled,
            )?
        };

        // Create an entry for this file.
        let key = ctx.sources[index.get() as usize]
            .path
            .key_for_incremental_graph();
        // TODO: use a hash mix with the first half being a path hash and the second half content hash
        let h = hash(key);
        // Track css files that look like tailwind files.
        // Note: hoisted before `replace_path` because that consumes
        // `code.buffer`.
        let looks_like_tailwind = dev.has_tailwind_plugin_hack.is_some() && {
            let first_1024 = &code.buffer[..code.buffer.len().min(1024)];
            strings::index_of(first_1024, b"tailwind").is_some()
        };
        dev.assets.replace_path(
            key,
            crate::webcore::blob::Any::from_owned_slice(code.buffer.into()),
            &MimeType::CSS,
            h,
        )?;

        if let Some(map) = &mut dev.has_tailwind_plugin_hack {
            if looks_like_tailwind {
                // Note: `get_or_put` consumes the key by value; on miss the key
                // already lives in the map so the explicit `*key_ptr =` is redundant.
                let _ = map.get_or_put(Box::from(key))?;
            } else {
                let _ = map.swap_remove(&Box::<[u8]>::from(key));
            }
        }

        dev.client_graph.receive_chunk(
            &mut ctx,
            index,
            incremental_graph::ReceiveChunkContent::Css(h),
            false,
        )?;

        // If imported on server, there needs to be a server-side file entry
        // so that edges can be attached.
        if metadata.imported_on_server {
            dev.server_graph
                .insert_css_file_on_server(&mut ctx, index, key)?;
        }
    }

    for chunk in html_chunks_mut.iter_mut() {
        let index = bun_ast::Index::init(chunk.entry_point.source_index());
        let bundler::CompileResult::Html {
            code: compile_result_code,
            script_injection_offset: compile_result_offset,
            ..
        } = chunk.compile_results_for_chunk.get_mut(0)
        else {
            unreachable!()
        };
        let compile_result_offset = *compile_result_offset;
        let generated_js = dev.generate_javascript_code_for_html_file(
            index,
            import_records,
            input_file_sources,
            bv2.graph.input_files.items_loader(),
        )?;
        dev.client_graph.receive_chunk(
            &mut ctx,
            index,
            incremental_graph::ReceiveChunkContent::Js {
                code: generated_js,
                source_map: None,
            },
            false,
        )?;
        let client_index = ctx
            .get_cached_index(bake::Side::Client, index)
            .unwrap::<{ bake::Side::Client }>()
            .expect("unresolved index");
        // Not the file of a route: a plugin resolved a route's file to it, or loaded it as html.
        let Some(route_bundle_index) = dev.client_graph.html_route_bundle_index(client_index)
        else {
            continue;
        };
        let route_bundle = dev.route_bundle_ptr(route_bundle_index);
        debug_assert!(route_bundle.data.html().bundled_file == client_index);
        // Note: split borrow — `invalidate_client_bundle` needs `&mut RouteBundle`
        // so the `cached_response` take is done before the long-lived `html` borrow.
        if route_bundle
            .data
            .html_mut()
            .cached_response
            .take()
            .is_some()
        {
            // SAFETY: `route_bundle` borrows `dev.route_bundles[_]`; `source_maps`
            // is a disjoint field reborrowed through the raw `dev_ptr`.
            route_bundle.invalidate_client_bundle(unsafe { &mut (*dev_ptr).source_maps });
        }
        let html = match &mut route_bundle.data {
            route_bundle::Data::Html(h) => h,
            _ => unreachable!(),
        };
        // Drops the previous text and transfers ownership of the chunk's
        // compile-result code, leaving an empty
        // boxed slice behind in the chunk — nothing reads it after this.
        html.bundled_html_text = Some(std::mem::take(compile_result_code));
        html.script_injection_offset = Some(route_bundle::ByteOffset::init(compile_result_offset));

        chunk
            .entry_point
            .set_entry_point_id(route_bundle_index.get());
    }

    // Sized AFTER
    // Pass 1 so server/client bitsets cover files just inserted by `receive_chunk`.
    *ctx.gts = dev.init_graph_trace_state(if n_css > 0 {
        input_file_sources.len()
    } else {
        0
    })?;
    ctx.server_seen_bit_set = DynamicBitSet::init_empty(dev.server_graph.bundled_files.len())?;

    dev.incremental_result.had_adjusted_edges = false;

    dev.prepare_and_log_resolution_failures()?;
    dev.report_html_routes_without_html()?;

    // Pass 2, update the graph's edges by performing import diffing on each
    // changed file, removing dependencies. This pass also flags what routes
    // have been modified.
    for (part_range, compile_result) in js_chunk
        .content
        .javascript()
        .parts_in_chunk_in_order
        .iter()
        .zip(js_chunk.compile_results_for_chunk.iter())
    {
        // Pass 1 didn't resolve a file index for a part that failed to print.
        if matches!(
            compile_result,
            bundler::CompileResult::Javascript {
                result: bun_js_printer::PrintResult::Err(_),
                ..
            }
        ) {
            continue;
        }
        match targets[part_range.source_index.get() as usize].bake_graph() {
            bake::Graph::Server | bake::Graph::Ssr => dev.server_graph.process_chunk_dependencies(
                &mut ctx,
                incremental_graph::ProcessMode::Normal,
                part_range.source_index,
            )?,
            bake::Graph::Client => dev.client_graph.process_chunk_dependencies(
                &mut ctx,
                incremental_graph::ProcessMode::Normal,
                part_range.source_index,
            )?,
        }
    }
    for chunk in html_chunks_mut.iter() {
        let index = bun_ast::Index::init(chunk.entry_point.source_index());
        dev.client_graph.process_chunk_dependencies(
            &mut ctx,
            incremental_graph::ProcessMode::Normal,
            index,
        )?;
    }
    for chunk in css_chunks_mut.iter() {
        let entry_index = bun_ast::Index::init(chunk.entry_point.source_index());
        dev.client_graph.process_chunk_dependencies(
            &mut ctx,
            incremental_graph::ProcessMode::Css,
            entry_index,
        )?;
    }

    // Index all failed files now that the incremental graph has been updated.
    if !dev.incremental_result.failures_removed.is_empty()
        || !dev.incremental_result.failures_added.is_empty()
    {
        had_sent_hmr_event.set(true);
    }
    dev.index_failures()?;

    dev.client_graph.ensure_stale_bit_capacity(false)?;
    dev.server_graph.ensure_stale_bit_capacity(false)?;

    dev.generation = dev.generation.wrapping_add(1);
    if Environment::ENABLE_LOGS {
        debug_log!(
            "Bundle Round {}: {} server, {} client, {} ms",
            dev.generation,
            dev.server_graph.current_chunk_parts.len(),
            dev.client_graph.current_chunk_parts.len(),
            current_bundle!().timer.elapsed().as_millis(),
        );
    }

    // Load all new chunks into the server runtime.
    if !dev.frontend_only && dev.server_graph.current_chunk_len > 0 {
        // Generate a script_id for server bundles

        // Get the source map if available and render to JSON
        let source_map_json = if !dev.server_graph.current_chunk_source_maps.is_empty() {
            'json: {
                // Create a temporary source map entry to render
                let mut source_map_entry = source_map_store::Entry {
                    ref_count: 1,
                    ..Default::default()
                };

                // Fill the source map entry
                dev.server_graph.take_source_map(&mut source_map_entry)?;
                // Note: erase to raw ptr so `render_json` can borrow the entry
                // while the cleanup guard is armed.
                let entry_ptr: *mut source_map_store::Entry = &raw mut source_map_entry;
                scopeguard::defer! {
                    // SAFETY: `source_map_entry` is a stack local that outlives this guard.
                    unsafe {
                        (*entry_ptr).ref_count = 0;
                        (*entry_ptr).deinit();
                    }
                };

                let json_data =
                    source_map_entry.render_json(dev, ChunkKind::HmrChunk, bake::Side::Server)?;
                break 'json Some(json_data);
            }
        } else {
            None
        };

        let server_bundle = dev.server_graph.take_js_bundle_server(
            &incremental_graph::TakeJSBundleOptionsServer {
                kind: ChunkKind::HmrChunk,
            },
        )?;

        let global = dev.global();
        let server_modules = if let Some(json) = source_map_json {
            // This memory will be owned by the `DevServerSourceProvider` in C++
            let json: ::core::mem::ManuallyDrop<Vec<u8>> = ::core::mem::ManuallyDrop::new(json);

            match server_hmr_ffi::bake_load_server_hmr_patch_with_source_map(
                global,
                BunString::clone_utf8(&server_bundle),
                json.as_ptr(),
                json.len(),
            ) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime;
                    // `print_error_like_object_to_console` needs `&mut`.
                    dev.vm_mut()
                        .print_error_like_object_to_console(global.take_exception(err));
                    // Note: `panic!()` would unwind through the
                    // `extern "C"` boundary above (`nounwind` UB), so abort.
                    bun_core::Output::panic(format_args!(
                        "Error thrown while evaluating server code. This is always a bug in the bundler."
                    ));
                }
            }
        } else {
            match server_hmr_ffi::bake_load_server_hmr_patch(
                global,
                BunString::clone_latin1(&server_bundle),
            ) {
                Ok(v) => v,
                Err(err) => {
                    // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime;
                    // `print_error_like_object_to_console` needs `&mut`.
                    dev.vm_mut()
                        .print_error_like_object_to_console(global.take_exception(err));
                    // Note: `panic!()` would unwind through the
                    // `extern "C"` boundary above (`nounwind` UB), so abort.
                    bun_core::Output::panic(format_args!(
                        "Error thrown while evaluating server code. This is always a bug in the bundler."
                    ));
                }
            }
        };
        // Note: `make_array_for_server_components_patch` needs `&mut self`
        // while reading `self.incremental_result.client_components_{added,removed}`.
        // It only touches `server_graph.bundled_files.keys()`, so reborrow the
        // index slices via `dev_ptr` (disjoint fields).
        // SAFETY: `dev_ptr == dev`; `incremental_result` is not mutated by
        // `make_array_for_server_components_patch`.
        let (added, removed) = unsafe {
            let ir = &(*dev_ptr).incremental_result;
            (
                ir.client_components_added.as_slice(),
                ir.client_components_removed.as_slice(),
            )
        };
        let errors = match dev.server_register_update_callback.get().unwrap().call(
            global,
            global.to_js_value(),
            &[
                server_modules,
                dev.make_array_for_server_components_patch(global, added)?,
                dev.make_array_for_server_components_patch(global, removed)?,
            ],
        ) {
            Ok(v) => v,
            Err(err) => {
                // SAFETY: vm is JSC_BORROW — valid for DevServer lifetime
                dev.vm_mut()
                    .print_error_like_object_to_console(global.take_exception(err));
                panic!(
                    "Error thrown in Hot-module-replacement code. This is always a bug in the HMR runtime."
                );
            }
        };
        let _ = errors; // TODO:
    }

    let mut route_bits = DynamicBitSet::init_empty(dev.route_bundles.len())?;
    let mut route_bits_client = DynamicBitSet::init_empty(dev.route_bundles.len())?;

    let mut has_route_bits_set = false;

    let mut hot_update_payload: Vec<u8> = Vec::with_capacity(65536);
    hot_update_payload.push(MessageId::HotUpdate.char());

    // The writer used for the hot_update payload
    macro_rules! w_int {
        ($t:ty, $v:expr) => {
            hot_update_payload.extend_from_slice(&<$t>::to_le_bytes($v))
        };
    }
    macro_rules! w_all {
        ($s:expr) => {
            hot_update_payload.extend_from_slice($s)
        };
    }

    // It was discovered that if a tree falls with nobody around it, it does not
    // make any sound. Let's avoid writing into `w` if no sockets are open.
    let hot_update_subscribers = dev.num_subscribers(HmrTopic::HotUpdate);
    let will_hear_hot_update = hot_update_subscribers > 0;

    // This list of routes affected excludes client code.
    if will_hear_hot_update
        && current_bundle!().had_reload_event
        && (dev.incremental_result.framework_routes_affected.len()
            + dev.incremental_result.html_routes_hard_affected.len())
            > 0
        && dev.bundling_failures.is_empty()
    {
        has_route_bits_set = true;

        for request in &dev.incremental_result.framework_routes_affected {
            let route = dev.router.route_ptr(request.route_index());
            if let Some(id) = route.bundle {
                route_bits.set(id.get() as usize);
            }
            if request.should_recurse_when_visiting() {
                mark_all_route_children(&dev.router, &mut [&mut route_bits], request.route_index());
            }
        }
        for route_bundle_index in &dev.incremental_result.html_routes_hard_affected {
            route_bits.set(route_bundle_index.get() as usize);
            route_bits_client.set(route_bundle_index.get() as usize);
        }

        // List 1
        let mut it = route_bits.iterator::<true, true>();
        while let Some(bundled_route_index) = it.next() {
            let bundle = &dev.route_bundles[bundled_route_index];
            if bundle.active_viewers == 0 {
                continue;
            }
            w_int!(i32, i32::try_from(bundled_route_index).expect("int cast"));
        }
    }
    w_int!(i32, -1);

    // When client component roots get updated, the `client_components_affected`
    // list contains the server side versions of these roots.
    if !dev.incremental_result.client_components_affected.is_empty() {
        has_route_bits_set = true;

        dev.incremental_result.framework_routes_affected.clear();
        dev.incremental_result.html_routes_hard_affected.clear();
        dev.incremental_result.html_routes_soft_affected.clear();
        ctx.gts.clear();

        // `trace_dependencies` appends to this list.
        for index in ::core::mem::take(&mut dev.incremental_result.client_components_affected) {
            dev.server_graph.trace_dependencies(
                index,
                ctx.gts,
                incremental_graph::TraceDependencyGoal::NoStop,
                index,
            )?;
        }

        for request in &dev.incremental_result.framework_routes_affected {
            let route = dev.router.route_ptr(request.route_index());
            if let Some(id) = route.bundle {
                route_bits.set(id.get() as usize);
                route_bits_client.set(id.get() as usize);
            }
            if request.should_recurse_when_visiting() {
                mark_all_route_children(
                    &dev.router,
                    &mut [&mut route_bits, &mut route_bits_client],
                    request.route_index(),
                );
            }
        }

        // Free old bundles
        let mut it = route_bits_client.iterator::<true, true>();
        while let Some(bundled_route_index) = it.next() {
            dev.route_bundles[bundled_route_index].invalidate_client_bundle(&mut dev.source_maps);
        }
    } else if !dev.incremental_result.html_routes_hard_affected.is_empty() {
        // Free old bundles
        let mut it = route_bits_client.iterator::<true, true>();
        while let Some(bundled_route_index) = it.next() {
            dev.route_bundles[bundled_route_index].invalidate_client_bundle(&mut dev.source_maps);
        }
    }

    // The browser bundle of a route of a `clientPages` router holds its page and layouts, so an
    // edit to them makes the cached bundle stale: the next page load must not hydrate with it.
    {
        let mut stale = DynamicBitSet::init_empty(dev.route_bundles.len())?;
        for request in &dev.incremental_result.framework_routes_affected {
            let route = dev.router.route_ptr(request.route_index());
            if !dev.router.type_ptr_const(route.r#type).client_pages {
                continue;
            }
            if let Some(id) = route.bundle {
                stale.set(id.get() as usize);
            }
            if request.should_recurse_when_visiting() {
                mark_all_route_children(&dev.router, &mut [&mut stale], request.route_index());
            }
        }
        let mut it = stale.iterator::<true, true>();
        while let Some(i) = it.next() {
            dev.route_bundles[i].invalidate_client_bundle(&mut dev.source_maps);
        }
    }

    // Softly affected HTML routes only need the bundle invalidated.
    if !dev.incremental_result.html_routes_soft_affected.is_empty() {
        for index in &dev.incremental_result.html_routes_soft_affected {
            dev.route_bundles[index.get() as usize].invalidate_client_bundle(&mut dev.source_maps);
            route_bits.set(index.get() as usize);
        }
        has_route_bits_set = true;
    }

    // `route_bits` will have all of the routes that were modified.
    if has_route_bits_set && (will_hear_hot_update || dev.incremental_result.had_adjusted_edges) {
        // Note: copy out before the loop so the `&mut RouteBundle` borrow
        // below doesn't overlap a `&dev.incremental_result` read.
        let had_adjusted_edges = dev.incremental_result.had_adjusted_edges;
        let mut it = route_bits.iterator::<true, true>();
        // List 2
        while let Some(i) = it.next() {
            // Note: erase to raw ptr — `trace_all_route_imports` below needs
            // `&mut *dev` while `route_bundle` (a sub-borrow of `dev.route_bundles`)
            // is still live; the two do not actually alias.
            let route_bundle: *mut RouteBundle = dev.route_bundle_ptr(route_bundle::Index::init(
                u32::try_from(i).expect("int cast"),
            ));
            if had_adjusted_edges {
                // SAFETY: `route_bundle` points into `dev.route_bundles` (not
                // resized in this loop); the exclusive borrow is scoped to this match.
                match unsafe { &mut (*route_bundle).data } {
                    route_bundle::Data::Framework(fw_bundle) => {
                        fw_bundle.cached_css_file_array.clear_without_deallocation()
                    }
                    route_bundle::Data::Html(html) => html.cached_response = None,
                }
            }
            // SAFETY: statement-scoped read; no `&mut` into `*route_bundle` is live.
            if unsafe { (*route_bundle).active_viewers } == 0 || !will_hear_hot_update {
                continue;
            }
            w_int!(i32, i32::try_from(i).expect("int cast"));

            // If no edges were changed, then it is impossible to
            // change the list of CSS files.
            if had_adjusted_edges {
                ctx.gts.clear();
                dev.client_graph.current_css_files.clear();
                // SAFETY: `trace_all_route_imports` does not mutate `route_bundles`;
                // shared, call-scoped reborrow.
                let route_bundle_ref = unsafe { &*route_bundle };
                dev.trace_all_route_imports(route_bundle_ref, ctx.gts, TraceImportGoal::FindCss)?;
                let css_ids = &dev.client_graph.current_css_files;

                w_int!(i32, i32::try_from(css_ids.len()).expect("int cast"));
                for css_id in css_ids {
                    let mut hex = [0u8; 16];
                    let n = bun_core::fmt::bytes_to_hex_lower(&css_id.to_ne_bytes(), &mut hex);
                    w_all!(&hex[..n]);
                }
            } else {
                w_int!(i32, -1);
            }
        }
    }
    w_int!(i32, -1);

    let css_chunks = &*css_chunks_mut;
    // If a chunk failed to print, the page keeps its last good stylesheet.
    let css_chunk_printed = |chunk: &bundler::chunk::Chunk| {
        !chunk
            .compile_results_for_chunk
            .iter()
            .any(|compile_result| {
                matches!(
                    compile_result,
                    bundler::CompileResult::Css { result: Err(_), .. }
                )
            })
    };
    let printed_css_count = css_chunks.iter().filter(|c| css_chunk_printed(c)).count();
    if will_hear_hot_update {
        if dev.client_graph.current_chunk_len > 0 || printed_css_count > 0 {
            // Send CSS mutations
            dev.assets.reindex_if_needed()?;
            w_int!(u32, u32::try_from(printed_css_count).expect("int cast"));
            use bun_bundler::Graph::InputFileColumns as _;
            let sources = bv2.graph.input_files.items_source();
            for chunk in css_chunks.iter().filter(|c| css_chunk_printed(c)) {
                let key = sources[chunk.entry_point.source_index() as usize]
                    .path
                    .key_for_incremental_graph();
                let content_hash = hash(key);
                let mut hex = [0u8; 16];
                let n = bun_core::fmt::bytes_to_hex_lower(&content_hash.to_ne_bytes(), &mut hex);
                w_all!(&hex[..n]);
                let css_data: &[u8] = match dev.assets.get(content_hash) {
                    Some(route) => &route.blob.internal_blob().bytes,
                    None => b"",
                };
                w_int!(u32, u32::try_from(css_data.len()).expect("int cast"));
                w_all!(css_data);
            }

            // Send the JS chunk
            if dev.client_graph.current_chunk_len > 0 {
                let script_id = 'h: {
                    // Matches the bundler's `ContentHasher` hash (XxHash64).
                    let mut source_map_hash = bun_hash::XxHash64Streaming::new(0x4b12);
                    let keys = dev.client_graph.bundled_files.keys();
                    let values = dev.client_graph.bundled_files.values();
                    for part in &dev.client_graph.current_chunk_parts {
                        source_map_hash.update(&keys[part.get() as usize]);
                        if let Some(map) = values[part.get() as usize].source_map.get() {
                            source_map_hash.update(map.vlq());
                        }
                    }
                    // Set the bottom bit.
                    break 'h source_map_store::Key::init(source_map_hash.digest() | 1);
                };
                let mut sockets: u32 = 0;
                for socket_ptr in dev.active_websocket_connections.keys() {
                    // SAFETY: `*socket_ptr` is a live HmrSocket owned by the
                    // connection map; shared, statement-scoped.
                    if unsafe { &**socket_ptr }.is_subscribed(HmrTopic::HotUpdate) {
                        // SAFETY: as above; the exclusive borrow of the socket's
                        // map ends when `entry` dies at the end of this block.
                        let entry = unsafe { &mut (**socket_ptr).referenced_source_maps }
                            .get_or_put(script_id)
                            .expect("oom");
                        if !entry.found_existing {
                            sockets += 1;
                        }
                        *entry.value_ptr = ();
                    }
                }
                map_log!("inc {:x}, for {} sockets", script_id.get(), sockets);
                let entry = match dev
                    .source_maps
                    .put_or_increment_ref_count(script_id, sockets)?
                {
                    source_map_store::PutOrIncrementRefCount::Uninitialized(entry) => 'brk: {
                        // Note: reborrow `client_graph` via `dev_ptr` so the
                        // `&mut Entry` borrow inside `source_maps` does not alias.
                        // SAFETY: `dev_ptr` is live for this fn; disjoint fields.
                        unsafe { &mut (*dev_ptr).client_graph }.take_source_map(entry)?;
                        break 'brk entry;
                    }
                    source_map_store::PutOrIncrementRefCount::Shared(entry) => entry,
                };
                w_int!(u32, entry.overlapping_memory_cost);

                // Build and send the source chunk
                dev.client_graph.take_js_bundle_to_list(
                    &mut hot_update_payload,
                    &incremental_graph::TakeJSBundleOptionsClient {
                        kind: crate::bake::dev_server::ChunkKind::HmrChunk,
                        script_id,
                        console_log: dev.should_receive_console_log_from_browser(),
                        ..Default::default()
                    },
                )?;
            }
        } else {
            w_int!(i32, 0);
        }

        dev.publish(HmrTopic::HotUpdate, &hot_update_payload, Opcode::BINARY);
        had_sent_hmr_event.set(true);
    }

    if !dev.incremental_result.failures_added.is_empty() {
        dev.bundles_since_last_error = 0;

        // Note: erase the agent borrow to a raw pointer so it can be passed
        // through `send_serialized_failures` (which takes `&mut *dev` while
        // the borrow derives from `&*dev`) and then re-used below. The agent
        // lives in the VM's `Debugger`, which outlives this scope.
        let mut inspector_agent_ptr: Option<*const BunFrontendDevServerAgent> =
            dev.inspector().map(std::ptr::from_ref);

        while let Some(node) = current_bundle!().requests.pop_first() {
            // SAFETY: `pop_first` hands back ownership of the intrusive node;
            // `data` was initialized by `defer_request`.
            let req = unsafe { (*node).data.assume_init_mut() };
            let req_ptr = std::ptr::from_mut::<DeferredRequest>(req);
            // SAFETY: the node stays alive until `deref_()` releases it below.
            scopeguard::defer! { unsafe { (*req_ptr).deref_() } };

            let rb = dev.route_bundle_ptr(req.route_bundle_index);
            rb.server_state = route_bundle::State::PossibleBundlingFailures;

            let resp: AnyResponse = match &mut req.handler {
                Handler::Aborted => continue,
                Handler::ServerHandler(saved) => 'brk: {
                    let resp = saved.response;
                    saved.deinit();
                    break 'brk resp;
                }
                Handler::BundledHtmlPage(ram) => ram.response,
            };

            // SAFETY: see Note on `failures` above; `dev_ptr` is live and
            // `send_serialized_failures` does not mutate `bundling_failures`.
            let failures = unsafe { (*dev_ptr).bundling_failures.values() };
            dev.send_serialized_failures(
                resp,
                failures,
                // SAFETY: agent ptr is from `dev.inspector()` above; live for this scope.
                inspector_agent_ptr.take().map(|p| unsafe { &*p }),
            )?;
        }
        if let Some(agent_ptr) = inspector_agent_ptr {
            let mut buf: Vec<u8> = Vec::new();
            dev.encode_serialized_failures(
                dev.bundling_failures.values(),
                &mut buf,
                // SAFETY: `agent_ptr` is from `dev.inspector()` above; live for this scope.
                Some(unsafe { &*agent_ptr }),
            )?;
        }

        return Ok(());
    }

    if dev.bundling_failures.is_empty() {
        if current_bundle!().had_reload_event {
            let clear_terminal = !bun_output::scope_is_visible!(DevServer)
                && !dev
                    .vm()
                    .env_loader()
                    .has_set_no_clear_terminal_on_reload(false);
            if clear_terminal {
                Output::disable_buffering();
                Output::reset_terminal_all();
                Output::enable_buffering();
            }

            dev.print_memory_line();

            dev.bundles_since_last_error += 1;
            if dev.bundles_since_last_error > 1 {
                bun_core::pretty_error!("<cyan>[x{}]<r> ", dev.bundles_since_last_error);
            }
        } else {
            dev.bundles_since_last_error = 0;
            dev.print_memory_line();
        }

        let ms_elapsed = u64::try_from(current_bundle!().timer.elapsed().as_millis()).unwrap();

        bun_core::pretty_error!(
            "<green>{} in {}ms<r>",
            if current_bundle!().had_reload_event {
                "Reloaded"
            } else {
                "Bundled page"
            },
            ms_elapsed,
        );

        // Intentionally creating a new scope here so we can limit the lifetime
        // of the `relative_path_buf`
        {
            let mut buf = paths::path_buffer_pool::get();

            // Compute a file name to display
            let file_name: Option<&[u8]> = if current_bundle!().had_reload_event {
                if !bv2.graph.entry_points.is_empty() {
                    Some(dev.relative_path(&mut *buf, {
                        use bun_bundler::Graph::InputFileColumns as _;
                        bv2.graph.input_files.items_source()
                            [bv2.graph.entry_points[0].get() as usize]
                            .path
                            .text
                    }))
                } else {
                    None // TODO: How does this happen
                }
            } else {
                'brk: {
                    let route_bundle_index = 'rbi: {
                        let first = current_bundle!().requests.first;
                        if !first.is_null() {
                            // SAFETY: `first` is a live intrusive node held by current_bundle.requests; `data` was initialized by `defer_request`.
                            break 'rbi unsafe { (*first).data.assume_init_ref() }
                                .route_bundle_index;
                        }
                        break 'brk None;
                    };

                    // Note: index `route_bundles` immutably so `dev.relative_path`
                    // / `dev.router` / `dev.server_graph` reads below stay disjoint.
                    break 'brk match &dev.route_bundles[route_bundle_index.get() as usize].data {
                        route_bundle::Data::Html(html) => {
                            Some(dev.relative_path(&mut *buf, &html.html_bundle.bundle.path))
                        }
                        route_bundle::Data::Framework(fw) => 'file_name: {
                            let route = dev.router.route_ptr(fw.route_index);
                            let opaque_id = match route.file_page.or(route.file_layout) {
                                Some(id) => id,
                                None => break 'file_name None,
                            };
                            let server_index =
                                from_opaque_file_id::<{ bake::Side::Server }>(opaque_id);
                            let abs_path =
                                &dev.server_graph.bundled_files.keys()[server_index.get() as usize];
                            break 'file_name Some(dev.relative_path(&mut *buf, abs_path));
                        }
                    };
                }
            };

            let total_count = bv2.graph.entry_points.len();
            if let Some(name) = file_name {
                bun_core::pretty_error!("<d>:<r> {}", bstr::BStr::new(name));
                if total_count > 1 {
                    bun_core::pretty_error!(" <d>+ {} more<r>", total_count - 1);
                }
            }
        }
        bun_core::pretty_error!("\n");
        Output::flush();

        if let Some(agent) = dev.inspector() {
            agent.notify_bundle_complete(dev.inspector_server_id, ms_elapsed as f64);
        }
    }

    // Release the lock because the underlying handler may acquire one.
    dev.graph_safety_lock.unlock();
    // SAFETY: `dev_ptr` is live for the entire fn body; runs before `_lock` (LIFO),
    // so the outer unlock guard sees a locked state again.
    scopeguard::defer! { unsafe { (*dev_ptr).graph_safety_lock.lock() } };

    // Set all the deferred routes to the .loaded state up front
    {
        let mut node = current_bundle!().requests.first;
        while !node.is_null() {
            // SAFETY: node is an intrusive list node valid while current_bundle.requests holds it;
            // `data` was initialized by `defer_request`.
            let n = unsafe { &*node };
            // SAFETY: `data` was initialized by `defer_request` before being linked.
            let rb = dev.route_bundle_ptr(unsafe { n.data.assume_init_ref() }.route_bundle_index);
            rb.server_state = route_bundle::State::Loaded;
            node = n.next;
        }
    }

    while let Some(node) = current_bundle!().requests.pop_first() {
        // SAFETY: `pop_first` hands back ownership of the intrusive node;
        // `data` was initialized by `defer_request`.
        let req = unsafe { (*node).data.assume_init_mut() };
        let req_ptr = std::ptr::from_mut::<DeferredRequest>(req);
        // SAFETY: the node stays alive until `deref_()` releases it below.
        scopeguard::defer! { unsafe { (*req_ptr).deref_() } };

        let rb = dev.route_bundle_ptr(req.route_bundle_index);
        rb.server_state = route_bundle::State::Loaded;

        // Note: `SavedRequest` is move-only (`Strong` field). Take the
        // handler by value so the `Saved` payload moves into the union; the
        // node is being torn down via `_deref` regardless.
        match ::core::mem::replace(&mut req.handler, Handler::Aborted) {
            Handler::Aborted => continue,
            Handler::ServerHandler(saved) => {
                let response = saved.response;
                let ctx = saved.ctx;
                // Note: `saved` is moved out (so `__deinit` sees `Aborted`);
                // `js_request: StrongOptional` releases on Drop, but
                // `ctx: AnyRequestContext` is `Copy` — explicitly balance the
                // `ctx.ref_()` from `defer_request` here so the request
                // context's `on_request_complete` (and thus the server's
                // `pending_requests--`) eventually fires. Without this the
                // bake-harness graceful-exit deinit check ("Failed to trigger
                // deinit") never sees DevServer Drop.
                scopeguard::defer! { ctx.deref() };
                dev.on_framework_request_with_bundle(
                    req.route_bundle_index,
                    SavedRequestUnion::Saved(saved),
                    response,
                )?
            }
            Handler::BundledHtmlPage(ram) => {
                dev.on_html_request_with_bundle(req.route_bundle_index, ram.response, ram.method)
            }
        }
    }
    Ok(())
}

impl DevServer {
    fn make_array_for_server_components_patch(
        &mut self,
        global: &JSGlobalObject,
        items: &[incremental_graph::ServerFileIndex],
    ) -> JsResult<JSValue> {
        if items.is_empty() {
            return Ok(JSValue::NULL);
        }
        let arr = jsc::JSArray::create_empty(global, items.len())?;
        let names = self.server_graph.bundled_files.keys();
        for (i, item) in items.iter().enumerate() {
            let mut buf = paths::path_buffer_pool::get();
            let s = self.relative_path(&mut *buf, &names[item.get() as usize]);
            arr.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                bun_string_jsc::create_utf8_for_js(global, s)?,
            )?;
        }
        Ok(arr)
    }
}
