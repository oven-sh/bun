//! Tracing the import graph from routes.

use super::*;

impl DevServer {
    /// `extra_client_bits` is specified if it is possible that the client graph may
    /// increase in size while the bits are being used.
    pub(super) fn init_graph_trace_state(
        &self,
        extra_client_bits: usize,
    ) -> crate::Result<GraphTraceState> {
        let server_bits = DynamicBitSet::init_empty(self.server_graph.bundled_files.len())?;
        let client_bits =
            DynamicBitSet::init_empty(self.client_graph.bundled_files.len() + extra_client_bits)?;
        Ok(GraphTraceState {
            server_bits,
            client_bits,
            failures: Vec::new(),
        })
    }
}

impl DevServer {
    pub(super) fn trace_all_route_imports(
        &mut self,
        route_bundle: &RouteBundle,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> crate::Result<()> {
        match &route_bundle.data {
            route_bundle::Data::Framework(fw) => {
                let mut route = self.router.route_ptr(fw.route_index);
                // Note: copy the two `Type` fields up front so the
                // `&self.router` borrow doesn't overlap `&mut self.*_graph`.
                let (rt_server_file, rt_client_file) = {
                    let rt = self.router.type_ptr_const(route.r#type);
                    (rt.server_file, rt.client_file)
                };

                // Both framework entry points are considered
                self.server_graph.trace_imports(
                    from_opaque_file_id::<{ bake::Side::Server }>(rt_server_file),
                    gts,
                    TraceImportGoal::FindCss,
                )?;
                if let Some(id) = rt_client_file {
                    self.client_graph.trace_imports(
                        from_opaque_file_id::<{ bake::Side::Client }>(id),
                        gts,
                        goal,
                    )?;
                }

                // The route file is considered
                if let Some(id) = route.file_page {
                    self.server_graph.trace_imports(
                        from_opaque_file_id::<{ bake::Side::Server }>(id),
                        gts,
                        goal,
                    )?;
                }

                // For all parents, the layout is considered
                loop {
                    if let Some(id) = route.file_layout {
                        self.server_graph.trace_imports(
                            from_opaque_file_id::<{ bake::Side::Server }>(id),
                            gts,
                            goal,
                        )?;
                    }
                    let Some(p) = route.parent else { break };
                    route = self.router.route_ptr(p);
                }

                // A router whose pages also run in the browser: their client graph copies.
                let client_pages = self.client_page_files(fw.route_index);
                for path in client_pages.iter() {
                    if let Some(index) = self.client_graph.get_file_index(path) {
                        self.client_graph.trace_imports(index, gts, goal)?;
                    }
                }
            }
            route_bundle::Data::Html(html) => {
                self.client_graph
                    .trace_imports(html.bundled_file, gts, goal)?;
            }
        }
        Ok(())
    }
}
