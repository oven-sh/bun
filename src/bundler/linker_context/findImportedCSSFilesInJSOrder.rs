use crate::mal_prelude::*;
use bun_ast::ImportRecord;
use bun_collections::{AutoBitSet, VecExt};

use super::find_all_imported_parts_in_js_order::{Edge, edge_of_record};
use crate::{Index, IndexInt, LinkerContext};
use bun_collections::DynamicBitSet as BitSet;

/// What the CSS walks of one link share. It reads `entry_bits` before `merge_small_chunks` changes them.
pub(crate) struct CssWalkPlan {
    /// Per entry point id: its index in `loaders`, or `u32::MAX` if it loads nothing on demand.
    loaders_of_entry: Vec<u32>,
    /// An entry point and every entry point that its load can load on demand, also through another one.
    loaders: Vec<AutoBitSet>,
}

impl CssWalkPlan {
    /// `None`: no input file is CSS, so no walk finds any.
    pub(crate) fn new(c: &LinkerContext) -> Option<CssWalkPlan> {
        if !(c.parse_graph().input_files.items_loader().iter()).any(|loader| loader.is_css()) {
            return None;
        }
        let mut plan = CssWalkPlan {
            loaders_of_entry: Vec::new(),
            loaders: Vec::new(),
        };
        if !c.graph.code_splitting {
            return Some(plan);
        }

        let entry_points = c.graph.entry_points.items_source_index();
        let entries_len = entry_points.len();
        let mut entry_id_of_file = vec![u32::MAX; c.graph.files.len()];
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            let slot = &mut entry_id_of_file[source_index as usize];
            if *slot == u32::MAX {
                *slot = entry_id as u32;
            }
        }

        // Nodes: the entry point ids, then the files with a split `import()` or `require()` that runs (sites).
        let entry_bits = c.graph.files.items_entry_bits();
        let all_import_records = c.graph.ast.items_import_records();
        let all_parts = c.graph.ast.items_parts();
        let mut targets_start: Vec<u32> = Vec::new();
        let mut targets: Vec<u32> = Vec::new();
        // (entry point id, node of a site)
        let mut sites: Vec<(u32, u32)> = Vec::new();
        for source_index in c.graph.reachable_files.iter() {
            let source_index = source_index.get();
            if !c.graph.files_live.is_set(source_index as usize) {
                continue;
            }
            let records: &[ImportRecord] = all_import_records[source_index as usize].as_slice();
            let parts_live = &c.graph.parts_live[source_index as usize];
            let targets_len = targets.len();
            for (part_index, part) in all_parts[source_index as usize]
                .as_slice()
                .iter()
                .enumerate()
            {
                if !parts_live.is_set(part_index) {
                    continue;
                }
                for &record_id in part.import_record_indices.slice() {
                    let record = &records[record_id as usize];
                    if let Some(Edge::LoadNow(other) | Edge::LoadLater(other)) =
                        edge_of_record(c, source_index, part, true, record)
                    {
                        targets.push(entry_id_of_file[other as usize]);
                    }
                }
            }
            if targets.len() == targets_len {
                continue;
            }
            let site = (entries_len + targets_start.len()) as u32;
            targets_start.push(targets_len as u32);
            let mut loaders = entry_bits[source_index as usize].iterator::<true, true>();
            while let Some(loader) = loaders.next() {
                sites.push((loader as u32, site));
            }
        }
        if targets.is_empty() {
            return Some(plan);
        }
        targets_start.push(targets.len() as u32);

        sites.sort_unstable();
        let mut sites_start: Vec<u32> = Vec::with_capacity(entries_len + 1);
        let mut site_of: Vec<u32> = Vec::with_capacity(sites.len());
        let mut sites = sites.into_iter().peekable();
        for entry_id in 0..entries_len as u32 {
            sites_start.push(site_of.len() as u32);
            while let Some((_, site)) = sites.next_if(|&(loader, _)| loader == entry_id) {
                site_of.push(site);
            }
        }
        sites_start.push(site_of.len() as u32);

        let edges_of = |node: usize| -> &[u32] {
            if node < entries_len {
                &site_of[sites_start[node] as usize..sites_start[node + 1] as usize]
            } else {
                let site = node - entries_len;
                &targets[targets_start[site] as usize..targets_start[site + 1] as usize]
            }
        };
        // A component has a higher number than every component it has an edge to.
        let (component_of, components) = bun_sema::components::strongly_connected_components_of(
            entries_len + targets_start.len() - 1,
            edges_of,
            None,
        );
        plan.loaders_of_entry = vec![u32::MAX; entries_len];
        let mut loaders_of_component = vec![u32::MAX; components.len()];
        for (number, nodes) in components.iter().enumerate() {
            if let [node] = nodes.as_slice()
                && edges_of(*node).is_empty()
            {
                continue;
            }
            let mut loaders = bun_core::handle_oom(AutoBitSet::init_empty(entries_len));
            for &node in nodes {
                if node < entries_len {
                    loaders.set(node);
                }
                for &other in edges_of(node) {
                    let other_component = component_of[other as usize] as usize;
                    if other_component == number {
                        continue;
                    }
                    match loaders_of_component[other_component] {
                        u32::MAX => loaders.set(other as usize),
                        index => loaders.set_union(&plan.loaders[index as usize]),
                    }
                }
            }
            loaders_of_component[number] = plan.loaders.len() as u32;
            for &node in nodes {
                if node < entries_len {
                    plan.loaders_of_entry[node] = plan.loaders.len() as u32;
                }
            }
            plan.loaders.push(loaders);
        }
        Some(plan)
    }

    /// `None`: the entry point loads nothing on demand.
    fn loaders_of(&self, entry_id: u32) -> Option<&AutoBitSet> {
        let index = *self.loaders_of_entry.get(entry_id as usize)?;
        self.loaders.get(index as usize)
    }
}

/// JavaScript modules are traversed in depth-first postorder. This is the
/// order that JavaScript modules were evaluated in before the top-level await
/// feature was introduced.
///
/// ```text
///   A
///  / \
/// B   C
///  \ /
///   D
/// ```
///
/// If A imports B and then C, B imports D, and C imports D, then the JavaScript
/// traversal order is D B C A.
///
/// This function may deviate from ESM import order for dynamic imports (both
/// "require()" and "import()"). This is because the import order is impossible
/// to determine since the imports happen at run-time instead of compile-time.
/// In this case we just pick an arbitrary but consistent order.
/// A CSS file stays in the result only if a JS file that runs for the entry point imports it (see README.md).
pub(crate) fn find_imported_css_files_in_js_order(
    this: &LinkerContext,
    plan: &CssWalkPlan,
    entry_point: Index,
    entry_id: u32,
) -> Vec<Index> {
    let files_live = &this.graph.files_live;
    let entry_bits = this.graph.files.items_entry_bits();
    let all_import_records = this.graph.ast.items_import_records();
    let all_loaders = this.parse_graph().input_files.items_loader();
    let all_parts = this.graph.ast.items_parts();
    let all_parts_live = &this.graph.parts_live;

    let loaders = plan.loaders_of(entry_id);
    let runs = |source_index: IndexInt| {
        files_live.is_set(source_index as usize)
            && match loaders {
                Some(loaders) => entry_bits[source_index as usize].has_intersection(loaders),
                None => entry_bits[source_index as usize].is_set(entry_id as usize),
            }
    };

    // A JS file that the walk entered, or a CSS file that has its place in `order`.
    let mut visited = bun_core::handle_oom(BitSet::init_empty(this.graph.files.len()));
    // A CSS file that a file that runs imports.
    let mut kept = bun_core::handle_oom(BitSet::init_empty(this.graph.files.len()));
    let mut order: Vec<Index> = Vec::new();

    // Explicit-stack DFS. The tail is reversed, so a CSS file gets the place of its first import, depth first.
    #[derive(Copy, Clone)]
    enum Frame {
        Enter(IndexInt),
        Place(IndexInt),
    }
    let mut stack: Vec<Frame> = vec![Frame::Enter(entry_point.get())];

    while let Some(frame) = stack.pop() {
        let source_index = match frame {
            Frame::Place(source_index) => {
                if !visited.is_set(source_index as usize) {
                    visited.set(source_index as usize);
                    order.push(Index::init(source_index));
                }
                continue;
            }
            Frame::Enter(source_index) => source_index,
        };

        if visited.is_set(source_index as usize) {
            continue;
        }
        visited.set(source_index as usize);

        let mut file_runs: Option<bool> = None;
        let records: &[ImportRecord] = all_import_records[source_index as usize].as_slice();
        let parts_live = &all_parts_live[source_index as usize];

        let mark = stack.len();
        for (part_index, part) in all_parts[source_index as usize]
            .as_slice()
            .iter()
            .enumerate()
        {
            // Traverse any files imported by this part. Note that CommonJS calls
            // to "require()" count as imports too, sort of as if the part has an
            // ESM "import" statement in it. This may seem weird because ESM imports
            // are a compile-time concept while CommonJS imports are a run-time
            // concept. But we don't want to manipulate <style> tags at run-time so
            // this is the only way to do it.
            for &import_record_index in part.import_record_indices.slice() {
                let record = &records[import_record_index as usize];
                if !record.source_index.is_valid() {
                    continue;
                }
                let other = record.source_index.get();
                if !all_loaders[other as usize].is_css() {
                    if !visited.is_set(other as usize) {
                        stack.push(Frame::Enter(other));
                    }
                    continue;
                }
                if !kept.is_set(other as usize)
                    && *file_runs.get_or_insert_with(|| runs(source_index))
                    && edge_of_record(
                        this,
                        source_index,
                        part,
                        parts_live.is_set(part_index),
                        record,
                    )
                    .is_some()
                {
                    kept.set(other as usize);
                }
                if !visited.is_set(other as usize) {
                    stack.push(Frame::Place(other));
                }
            }
        }
        stack[mark..].reverse();
    }

    order.retain(|source_index| kept.is_set(source_index.get() as usize));
    order
}
