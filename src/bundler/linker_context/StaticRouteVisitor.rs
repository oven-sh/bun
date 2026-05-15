//! The `is_fully_static(source_index)` function returns whether or not
//! `source_index` imports a file with `"use client"`.
//!
//! TODO: Could we move this into the ReachableFileVisitor inside `bundle_v2.zig`?

use crate::mal_prelude::*;
use bun_collections::VecExt;
use bun_collections::{ArrayHashMap, AutoBitSet};
use bun_core::env_var;

use crate::import_record;
use crate::{Index, LinkerContext, UseDirective};

pub struct StaticRouteVisitor<'a> {
    pub c: &'a LinkerContext<'a>,
    pub cache: ArrayHashMap</* Index::Int */ u32, bool>,
    pub visited: AutoBitSet,
}

// PORT NOTE: Zig `deinit` only freed `cache` and `visited` with the default
// arena. Both are now owned types with `Drop`, so no explicit `impl Drop`
// is needed.

impl<'a> StaticRouteVisitor<'a> {
    /// This the quickest, simplest, dumbest way I can think of doing this.
    /// Investigate performance. It can have false negatives (it doesn't properly
    /// handle cycles), but that's okay as it's just used an optimization
    pub fn has_transitive_use_client(&mut self, entry_point_source_index: u32) -> bool {
        if cfg!(debug_assertions)
            && env_var::BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR
                .get()
                .unwrap_or(false)
        {
            return false;
        }

        // PORT NOTE: `self.c` is `&'a LinkerContext` (Copy), so these slice
        // borrows are tied to `'a`, not to `&self`, and do not conflict with
        // the `&mut self` call below. `parse_graph()` is the safe backref
        // accessor (one centralized `unsafe`, see `LinkerContext::parse_graph`).
        let parse_graph = self.c.parse_graph();
        let all_import_records: &[import_record::List] = parse_graph.ast.items_import_records();
        let referenced_source_indices: &[u32] = parse_graph
            .server_component_boundaries
            .list
            .items_reference_source_index();
        let use_directives: &[UseDirective] = parse_graph
            .server_component_boundaries
            .list
            .items_use_directive();

        self.has_transitive_use_client_impl(
            all_import_records,
            referenced_source_indices,
            use_directives,
            Index::init(entry_point_source_index),
        )
    }

    /// 1. Get AST for `source_index`
    /// 2. Recursively traverse its imports in import records
    /// 3. If any of the imports match any item in
    ///    `referenced_source_indices` which has `use_directive ==
    ///    .client`, then we know `source_index` is NOT fully
    ///    static.
    fn has_transitive_use_client_impl(
        &mut self,
        all_import_records: &[import_record::List],
        referenced_source_indices: &[u32],
        use_directives: &[UseDirective],
        source_index: Index,
    ) -> bool {
        if let Some(result) = self.cache.get(&source_index.get()) {
            return *result;
        }
        if self.visited.is_set(source_index.get() as usize) {
            return false;
        }
        self.visited.set(source_index.get() as usize);

        let import_records = &all_import_records[source_index.get() as usize];

        let result = 'result: {
            for import_record in import_records.slice() {
                if !import_record.source_index.is_valid() {
                    continue;
                }

                // check if this import is a client boundary
                debug_assert_eq!(referenced_source_indices.len(), use_directives.len());
                for (referenced_source_index, use_directive) in
                    referenced_source_indices.iter().zip(use_directives)
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
                if self.has_transitive_use_client_impl(
                    all_import_records,
                    referenced_source_indices,
                    use_directives,
                    import_record.source_index,
                ) {
                    break 'result true;
                }
            }
            false
        };

        self.cache.insert(source_index.get(), result);

        result
    }
}

// ported from: src/bundler/linker_context/StaticRouteVisitor.zig
