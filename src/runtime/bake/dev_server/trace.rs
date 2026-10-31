//! Tracing the import graph from routes.

use super::*;

impl DevServer {
    /// `extra_client_bits` is specified if it is possible that the client graph may
    /// increase in size while the bits are being used.
    pub(super) fn init_graph_trace_state(
        &self,
        extra_client_bits: usize,
    ) -> crate::Result<GraphTraceState> {
        GraphTraceState::new(
            self.server_graph.bundled_files.len(),
            self.client_graph.bundled_files.len() + extra_client_bits,
        )
    }
}

impl DevServer {
    /// Leaves the recorded failures that the route reaches in `gts.failures`. The caller holds `graph_safety_lock`.
    pub(super) fn trace_route_failures(
        &mut self,
        route_bundle_index: route_bundle::Index,
        gts: &mut GraphTraceState,
    ) -> crate::Result<()> {
        gts.clear();
        match &self.route_bundles[route_bundle_index.get() as usize].data {
            route_bundle::Data::Framework(fw) => {
                self.trace_all_route_imports(fw.route_index, gts, TraceImportGoal::FindErrors)
            }
            route_bundle::Data::Html(html) => {
                self.client_graph
                    .trace_imports(html.bundled_file, gts, TraceImportGoal::FindErrors)
            }
        }
    }

    /// For a framework route. An HTML route is traced from its `bundled_file` in the client graph.
    pub(super) fn trace_all_route_imports(
        &mut self,
        route_index: router::RouteIndex,
        gts: &mut GraphTraceState,
        goal: TraceImportGoal,
    ) -> crate::Result<()> {
        let mut route = self.router.route_ptr(route_index);
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
            // A failure below the server entry point fails every route of the router type.
            if goal == TraceImportGoal::FindErrors {
                goal
            } else {
                TraceImportGoal::FindCss
            },
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
        let client_pages = self.client_page_files(route_index);
        for path in client_pages.iter() {
            if let Some(index) = self.client_graph.get_file_index(path) {
                self.client_graph.trace_imports(index, gts, goal)?;
            }
        }
        Ok(())
    }
}
