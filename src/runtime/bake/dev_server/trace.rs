//! Tracing the import graph from routes.

use super::*;

impl Graphs {
    /// `extra_client_bits` is specified if it is possible that the client graph may
    /// increase in size while the bits are being used.
    pub(super) fn init_graph_trace_state(
        &self,
        extra_client_bits: usize,
    ) -> crate::Result<GraphTraceState> {
        let client_files = self.client.bundled_files.len() + extra_client_bits;
        Ok(GraphTraceState {
            server_bits: DynamicBitSet::init_empty(self.server.bundled_files.len())?,
            client_bits: DynamicBitSet::init_empty(client_files)?,
            failures: Vec::new(),
        })
    }
}

impl DevServer {
    /// For a framework route. An HTML route is traced from its `bundled_file` in the client graph.
    pub(super) fn trace_all_route_imports(
        &mut self,
        route_index: router::RouteIndex,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> crate::Result<()> {
        let mut route = self.router.route_ptr(route_index);
        let router_type = self.router.type_ptr_const(route.r#type);

        // Both framework entry points are considered
        self.graphs.trace_imports(
            from_opaque_file_id::<{ bake::Side::Server }>(router_type.server_file),
            gts,
            TraceImportGoal::FindCss,
        )?;
        if let Some(id) = router_type.client_file {
            self.graphs.trace_imports(
                from_opaque_file_id::<{ bake::Side::Client }>(id),
                gts,
                goal,
            )?;
        }

        // The route file is considered
        if let Some(id) = route.file_page {
            self.graphs.trace_imports(
                from_opaque_file_id::<{ bake::Side::Server }>(id),
                gts,
                goal,
            )?;
        }

        // For all parents, the layout is considered
        loop {
            if let Some(id) = route.file_layout {
                self.graphs.trace_imports(
                    from_opaque_file_id::<{ bake::Side::Server }>(id),
                    gts,
                    goal,
                )?;
            }
            let Some(p) = route.parent else { break };
            route = self.router.route_ptr(p);
        }

        // A router whose pages also run in the browser: their client graph copies.
        let client_pages = self.client_page_files(route_index);
        for path in client_pages.iter() {
            if let Some(index) = self.graphs.client.get_file_index(path) {
                self.graphs.trace_imports(index, gts, goal)?;
            }
        }
        Ok(())
    }
}
