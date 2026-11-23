use crate::mal_prelude::*;
use bun_ast::ImportRecord;
use bun_collections::{AutoBitSet, VecExt};

use super::find_all_imported_parts_in_js_order::{Edge, edge_of_record};
use crate::{Index, IndexInt, LinkerContext};
use bun_collections::DynamicBitSet as BitSet;

/// What the CSS walks of one link share.
///
/// With code splitting, a load site is a file with a split `import()` or `require()` in a part
/// that runs. An entry point loads on demand the targets of the load sites that it loads. The
/// plan and the walks read `entry_bits` before `merge_small_chunks` changes them: they ask
/// which files a load evaluates, not which chunk holds a file.
pub(crate) struct CssWalkPlan {
    /// Per entry point id: where its load sites start in `sites_of_entry`. One more at the end.
    /// Empty without code splitting.
    sites_of_entry_start: Vec<u32>,
    /// Indices into `targets_start`.
    sites_of_entry: Vec<u32>,
    /// Per load site: where its targets start in `targets`. One more at the end.
    targets_start: Vec<u32>,
    /// Entry point ids.
    targets: Vec<u32>,
}

impl CssWalkPlan {
    /// `None`: no input file is CSS, so no walk finds any.
    pub(crate) fn new(c: &LinkerContext) -> Option<CssWalkPlan> {
        if !(c.parse_graph().input_files.items_loader().iter()).any(|loader| loader.is_css()) {
            return None;
        }
        let mut plan = CssWalkPlan {
            sites_of_entry_start: Vec::new(),
            sites_of_entry: Vec::new(),
            targets_start: Vec::new(),
            targets: Vec::new(),
        };
        if !c.graph.code_splitting {
            return Some(plan);
        }

        let entry_points = c.graph.entry_points.items_source_index();
        let mut entry_id_of_file = vec![u32::MAX; c.graph.files.len()];
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            let slot = &mut entry_id_of_file[source_index as usize];
            if *slot == u32::MAX {
                *slot = entry_id as u32;
            }
        }

        let entry_bits = c.graph.files.items_entry_bits();
        let all_import_records = c.graph.ast.items_import_records();
        let all_parts = c.graph.ast.items_parts();
        // (entry point id, load site)
        let mut sites: Vec<(u32, u32)> = Vec::new();
        for source_index in c.graph.reachable_files.iter() {
            let source_index = source_index.get();
            if !c.graph.files_live.is_set(source_index as usize) {
                continue;
            }
            let records: &[ImportRecord] = all_import_records[source_index as usize].as_slice();
            let parts_live = &c.graph.parts_live[source_index as usize];
            let targets_len = plan.targets.len();
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
                        plan.targets.push(entry_id_of_file[other as usize]);
                    }
                }
            }
            if plan.targets.len() == targets_len {
                continue;
            }
            let site = plan.targets_start.len() as u32;
            plan.targets_start.push(targets_len as u32);
            let mut loaders = entry_bits[source_index as usize].iterator::<true, true>();
            while let Some(loader) = loaders.next() {
                sites.push((loader as u32, site));
            }
        }
        plan.targets_start.push(plan.targets.len() as u32);

        sites.sort_unstable();
        plan.sites_of_entry_start = Vec::with_capacity(entry_points.len() + 1);
        plan.sites_of_entry = Vec::with_capacity(sites.len());
        let mut sites = sites.into_iter().peekable();
        for entry_id in 0..entry_points.len() as u32 {
            plan.sites_of_entry_start
                .push(plan.sites_of_entry.len() as u32);
            while let Some((_, site)) = sites.next_if(|&(loader, _)| loader == entry_id) {
                plan.sites_of_entry.push(site);
            }
        }
        plan.sites_of_entry_start
            .push(plan.sites_of_entry.len() as u32);
        Some(plan)
    }

    fn sites_of(&self, entry_id: u32) -> &[u32] {
        let start = self.sites_of_entry_start[entry_id as usize];
        let end = self.sites_of_entry_start[entry_id as usize + 1];
        &self.sites_of_entry[start as usize..end as usize]
    }

    /// With code splitting: the entry point and every entry point that its load can load on
    /// demand, also through another one. `None`: the entry point alone.
    fn loaders_of(&self, c: &LinkerContext, entry_id: u32) -> Option<AutoBitSet> {
        if !c.graph.code_splitting || self.sites_of(entry_id).is_empty() {
            return None;
        }
        let mut loaders = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.entry_points.len()));
        loaders.set(entry_id as usize);
        let mut seen_sites =
            bun_core::handle_oom(AutoBitSet::init_empty(self.targets_start.len() - 1));
        let mut queue = vec![entry_id];
        while let Some(entry_id) = queue.pop() {
            for &site in self.sites_of(entry_id) {
                if seen_sites.is_set(site as usize) {
                    continue;
                }
                seen_sites.set(site as usize);
                let start = self.targets_start[site as usize];
                let end = self.targets_start[site as usize + 1];
                for &loaded in &self.targets[start as usize..end as usize] {
                    if !loaders.is_set(loaded as usize) {
                        loaders.set(loaded as usize);
                        queue.push(loaded);
                    }
                }
            }
        }
        Some(loaders)
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
///
/// The walk is the one that gives the order without tree shaking: every
/// import record of every file, also of a file that does not run. A CSS file
/// has the place of its first import there. It stays in the result only if a
/// JS file that runs imports it, with an `import` statement, or with a
/// `require()` or an `import()` in a part that runs (`edge_of_record`, the rule
/// of the walk that orders the JS). A file runs if it is live and the entry
/// point loads it. With code splitting, the entry points that this one loads
/// on demand count too: nothing else puts the CSS of their chunks on the page.
/// The CSS file's own `sideEffects` flag and liveness are not read.
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

    let loaders = plan.loaders_of(this, entry_id);
    let runs = |source_index: IndexInt| {
        files_live.is_set(source_index as usize)
            && match &loaders {
                Some(loaders) => entry_bits[source_index as usize].has_intersection(loaders),
                None => entry_bits[source_index as usize].is_set(entry_id as usize),
            }
    };

    // A JS file that the walk entered, or a CSS file that has its place in `order`.
    let mut visited = BitSet::init_empty(this.graph.files.len()).expect("oom");
    // A CSS file that a file that runs imports.
    let mut kept = BitSet::init_empty(this.graph.files.len()).expect("oom");
    let mut order: Vec<Index> = Vec::new();

    // Explicit-stack DFS. `Enter` pushes successors in discovery order then
    // reverses the tail, so a CSS file gets the place of its first import, in
    // depth-first order.
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
