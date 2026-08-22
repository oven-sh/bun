//! The `is_fully_static(source_index)` function returns whether or not
//! `source_index` imports a file with `"use client"`.
//!
//! TODO: Could we move this into the ReachableFileVisitor inside `bundle_v2.rs`?

use crate::mal_prelude::*;
use bun_collections::{ArrayHashMap, AutoBitSet};
use bun_core::env_var;

use crate::import_record;
use crate::{Index, LinkerContext, UseDirective};

pub(crate) struct StaticRouteVisitor<'a> {
    pub(crate) c: &'a LinkerContext<'a>,
    pub(crate) cache: ArrayHashMap</* Index::Int */ u32, bool>,
    pub(crate) visited: AutoBitSet,
    pub(crate) stack: Vec<Frame>,
}

/// A file whose imports are being checked, and how many of its import
/// records have been looked at so far.
pub(crate) struct Frame {
    source_index: Index,
    next_record: usize,
}

impl<'a> StaticRouteVisitor<'a> {
    /// This the quickest, simplest, dumbest way I can think of doing this.
    /// Investigate performance. It can have false negatives (it doesn't properly
    /// handle cycles), but that's okay as it's just used an optimization
    pub(crate) fn has_transitive_use_client(&mut self, entry_point_source_index: u32) -> bool {
        if cfg!(debug_assertions)
            && env_var::BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR
                .get()
                .unwrap_or(false)
        {
            return false;
        }

        // `self.c` is `&'a LinkerContext` (Copy), so these slice
        // borrows are tied to `'a`, not to `&self`, and do not conflict with
        // the `&mut self` call below. `parse_graph()` is the safe backref
        // accessor (one centralized `unsafe`, see `LinkerContext::parse_graph`).
        let parse_graph = self.c.parse_graph();
        let all_import_records: &[import_record::List<'_>] = parse_graph.ast.items_import_records();
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
    /// 2. Traverse its imports in import records, depth-first
    /// 3. If any of the imports match any item in
    ///    `referenced_source_indices` which has `use_directive ==
    ///    .client`, then we know `source_index` is NOT fully
    ///    static.
    ///
    /// Explicit-stack DFS (was recursive, one call per import). `result` is
    /// the answer the most recently finished file (or cache hit) gave to the
    /// file below it on the stack: `true` finishes that file as well, so it
    /// propagates down through every file on the stack, caching `true` for
    /// each, the way the recursive form's early returns did; `false` lets the
    /// file go on to its next import.
    fn has_transitive_use_client_impl(
        &mut self,
        all_import_records: &[import_record::List<'_>],
        referenced_source_indices: &[u32],
        use_directives: &[UseDirective],
        source_index: Index,
    ) -> bool {
        debug_assert!(self.stack.is_empty());
        if let Some(known) = self.enter(source_index) {
            return known;
        }

        let mut result = false;
        while let Some(frame) = self.stack.last_mut() {
            if result {
                let finished = self.stack.pop().expect("stack is non-empty");
                self.cache.insert(finished.source_index.get(), true);
                continue;
            }

            let import_records = &all_import_records[frame.source_index.get() as usize];
            let Some(import_record) = import_records.as_slice().get(frame.next_record) else {
                let finished = self.stack.pop().expect("stack is non-empty");
                self.cache.insert(finished.source_index.get(), false);
                continue;
            };
            frame.next_record += 1;

            if !import_record.source_index.is_valid() {
                continue;
            }

            // check if this import is a client boundary
            debug_assert_eq!(referenced_source_indices.len(), use_directives.len());
            if referenced_source_indices.iter().zip(use_directives).any(
                |(referenced_source_index, use_directive)| {
                    *use_directive == UseDirective::Client
                        && *referenced_source_index == import_record.source_index.get()
                },
            ) {
                result = true;
                continue;
            }

            // otherwise check its children
            if let Some(known) = self.enter(import_record.source_index) {
                result = known;
            }
        }

        result
    }

    /// Starts checking `source_index`'s imports unless the answer is already
    /// known: cached by an earlier walk, or `false` for a file that is already
    /// being checked further down the stack (a cycle).
    fn enter(&mut self, source_index: Index) -> Option<bool> {
        if let Some(result) = self.cache.get(&source_index.get()) {
            return Some(*result);
        }
        if self.visited.is_set(source_index.get() as usize) {
            return Some(false);
        }
        self.visited.set(source_index.get() as usize);
        self.stack.push(Frame {
            source_index,
            next_record: 0,
        });
        None
    }
}
