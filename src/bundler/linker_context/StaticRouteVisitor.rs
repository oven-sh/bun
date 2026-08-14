//! Decides whether a bake route (a server entry point) transitively imports a
//! file with `"use client"`. A route that imports none is prerendered without
//! the client entry script (`BakeRouteKind::FullyStaticRoute`), so a false
//! negative here ships a page that never hydrates.
//!
//! `LinkerGraph::load` points every server side import of a `"use client"`
//! file at the boundary's generated reference proxy
//! (`ServerComponentBoundary::reference_source_index`), so a route needs the
//! client script iff it has an import path to one of those proxies. That is
//! computed for every file at once by walking the import records backwards from
//! the proxies. Each file is marked the first time it is reached, so import
//! cycles need no special handling; a forward walk per route has to deal with
//! a file whose only path to a proxy leads through a file the walk is still
//! inside of (see the import cycle test in `test/bake/dev/production.test.ts`).

use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_collections::AutoBitSet;
use bun_core::env_var;

use crate::{LinkerContext, UseDirective};

#[derive(Default)]
pub(crate) struct StaticRouteVisitor {
    /// The client reference proxies and every file that transitively imports
    /// one, indexed by source index. Computed by the first query; only bake
    /// production builds ever make one.
    files_reaching_client: Option<AutoBitSet>,
}

impl StaticRouteVisitor {
    pub(crate) fn has_transitive_use_client(
        &mut self,
        c: &LinkerContext,
        entry_point_source_index: u32,
    ) -> Result<bool, AllocError> {
        if cfg!(debug_assertions)
            && env_var::BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR
                .get()
                .unwrap_or(false)
        {
            return Ok(false);
        }

        let files_reaching_client = match &mut self.files_reaching_client {
            Some(files) => files,
            None => self.files_reaching_client.insert(files_reaching_client(c)?),
        };
        Ok(files_reaching_client.is_set(entry_point_source_index as usize))
    }
}

fn files_reaching_client(c: &LinkerContext) -> Result<AutoBitSet, AllocError> {
    let import_records = c.graph.ast.items_import_records();
    let file_count = import_records.len();
    let mut reaching = AutoBitSet::init_empty(file_count)?;

    let boundaries = &c.parse_graph().server_component_boundaries.list;
    let mut worklist: Vec<u32> = Vec::new();
    for (&proxy, use_directive) in boundaries
        .items_reference_source_index()
        .iter()
        .zip(boundaries.items_use_directive())
    {
        if *use_directive == UseDirective::Client && !reaching.is_set(proxy as usize) {
            reaching.set(proxy as usize);
            worklist.push(proxy);
        }
    }
    if worklist.is_empty() {
        return Ok(reaching);
    }

    // Every import record is an edge `importer -> imported`. Group the edges by
    // imported file: the importers of `file` are
    // `importers[importer_offsets[file]..importer_offsets[file + 1]]`.
    let edges = import_records
        .iter()
        .enumerate()
        .flat_map(|(importer, records)| {
            records
                .iter()
                .filter(|record| record.source_index.is_valid())
                .map(move |record| (importer as u32, record.source_index.get() as usize))
        });

    let mut importer_offsets = vec![0usize; file_count + 1];
    for (_, imported) in edges.clone() {
        importer_offsets[imported + 1] += 1;
    }
    for file in 0..file_count {
        importer_offsets[file + 1] += importer_offsets[file];
    }
    let mut importers = vec![0u32; importer_offsets[file_count]];
    let mut next_slot = importer_offsets[..file_count].to_vec();
    for (importer, imported) in edges {
        importers[next_slot[imported]] = importer;
        next_slot[imported] += 1;
    }

    while let Some(file) = worklist.pop() {
        let file = file as usize;
        for &importer in &importers[importer_offsets[file]..importer_offsets[file + 1]] {
            if !reaching.is_set(importer as usize) {
                reaching.set(importer as usize);
                worklist.push(importer);
            }
        }
    }

    Ok(reaching)
}
