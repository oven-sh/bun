//! Decides which bake server entry points (routes) transitively import a file
//! with `"use client"`. A route that imports none is prerendered without any
//! client-side JavaScript (`BakeRouteKind::FullyStaticRoute`).
//!
//! `mark_chunks_with_transitive_use_client` has to run before
//! `compute_cross_chunk_dependencies`: that pass rewrites every `import()` of
//! another chunk into an import of the chunk's path and clears the record's
//! `source_index`, which would hide the client components a route only
//! reaches through `import()`.
//!
//! TODO: Could we move this into the ReachableFileVisitor inside `bundle_v2.rs`?

use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, AutoBitSet};
use bun_core::env_var;

use crate::chunk::{self, Chunk};
use crate::import_record;
use crate::options::{OutputKind, Target};
use crate::{Index, LinkerContext, UseDirective};

pub(crate) fn mark_chunks_with_transitive_use_client(
    c: &LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), AllocError> {
    // Only the built-in React framework prerenders routes differently based on
    // this; `generate_chunks_in_parallel` reads the flag under the same condition.
    if !c
        .framework
        .is_some_and(|framework| framework.is_built_in_react)
    {
        return Ok(());
    }

    if cfg!(debug_assertions)
        && env_var::BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR
            .get()
            .unwrap_or(false)
    {
        return Ok(());
    }

    let parse_graph = c.parse_graph();
    let mut visitor = StaticRouteVisitor {
        all_import_records: parse_graph.ast.items_import_records(),
        referenced_source_indices: parse_graph
            .server_component_boundaries
            .list
            .items_reference_source_index(),
        use_directives: parse_graph
            .server_component_boundaries
            .list
            .items_use_directive(),
        cache: ArrayHashMap::default(),
        visited: AutoBitSet::init_empty(c.graph.files.len())?,
    };
    let entry_point_kinds = c.graph.files.items_entry_point_kind();
    let targets = c.graph.ast.items_target();

    for chunk in chunks {
        if !matches!(chunk.content, chunk::Content::Javascript(_))
            || !chunk.entry_point.is_entry_point()
        {
            continue;
        }
        let source_index = chunk.entry_point.source_index();
        // Routes are the user specified entry points of the server graph.
        if entry_point_kinds[source_index as usize].output_kind() != OutputKind::EntryPoint
            || targets[source_index as usize] == Target::Browser
        {
            continue;
        }
        if visitor.has_transitive_use_client(Index::init(source_index)) {
            chunk.flags.insert(chunk::Flags::HAS_TRANSITIVE_USE_CLIENT);
        }
    }

    Ok(())
}

struct StaticRouteVisitor<'a, 'ir> {
    all_import_records: &'a [import_record::List<'ir>],
    /// The generated reference proxies of every server component boundary,
    /// parallel to `use_directives`.
    referenced_source_indices: &'a [u32],
    use_directives: &'a [UseDirective],
    cache: ArrayHashMap</* Index::Int */ u32, bool>,
    visited: AutoBitSet,
}

impl StaticRouteVisitor<'_, '_> {
    /// This the quickest, simplest, dumbest way I can think of doing this.
    /// Investigate performance. It can have false negatives (it doesn't properly
    /// handle cycles), but that's okay as it's just used an optimization
    ///
    /// 1. Get AST for `source_index`
    /// 2. Recursively traverse its imports in import records
    /// 3. If any of the imports match any item in
    ///    `referenced_source_indices` which has `use_directive ==
    ///    .client`, then we know `source_index` is NOT fully
    ///    static.
    fn has_transitive_use_client(&mut self, source_index: Index) -> bool {
        if let Some(result) = self.cache.get(&source_index.get()) {
            return *result;
        }
        if self.visited.is_set(source_index.get() as usize) {
            return false;
        }
        self.visited.set(source_index.get() as usize);

        let import_records = &self.all_import_records[source_index.get() as usize];

        let result = 'result: {
            for import_record in import_records.as_slice() {
                if !import_record.source_index.is_valid() {
                    continue;
                }

                // check if this import is a client boundary
                debug_assert_eq!(
                    self.referenced_source_indices.len(),
                    self.use_directives.len()
                );
                for (referenced_source_index, use_directive) in self
                    .referenced_source_indices
                    .iter()
                    .zip(self.use_directives)
                {
                    if *use_directive != UseDirective::Client {
                        continue;
                    }
                    // it's a client boundary
                    if *referenced_source_index == import_record.source_index.get() {
                        break 'result true;
                    }
                }

                // otherwise check its children
                if self.has_transitive_use_client(import_record.source_index) {
                    break 'result true;
                }
            }
            false
        };

        self.cache.insert(source_index.get(), result);

        result
    }
}
