use crate::mal_prelude::*;
use bun_collections::{AutoBitSet, StringHashMap};

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::merge_small_chunks::EntryLoadGraph;
use crate::options::Loader;
use crate::{Index, IndexInt, LinkerContext, WrapKind};

/// A chunk is one module, so its files run in the one order in which they print. The files
/// of a chunk load under the same conditions, but the entry point that loads them first is
/// not always the same one: two user entry points are two programs, and either of two
/// `import()` targets can come first. Each evaluates the files in the order of its own imports.
///
/// Where those orders differ, no printed order is right for every loader. The files become
/// `__esm` wrappers, which run nothing when the chunk loads, and each importer calls the
/// wrappers of what it imports, where it imports it.
///
/// An `import` of a chunk runs ahead of the code that makes those calls. So what a loader
/// evaluates after a file that is wrapped here, and from another chunk than its own, is wrapped too.
pub(crate) fn resolve_chunk_order_conflicts(c: &mut LinkerContext) -> crate::Result<()> {
    let _trace = bun_core::perf::trace("Bundler.resolveChunkOrderConflicts");
    if !c.graph.code_splitting || c.graph.entry_points.len() < 2 {
        return Ok(());
    }
    let mut already_wrapped = AutoBitSet::init_empty(c.graph.files.len())?;
    while let Some(files) = find_files_to_wrap(c, &already_wrapped)? {
        c.wrap_files_as_esm(&files)?;
        c.compute_entry_bits()?;
        // An `import` of a `"sideEffects": false` file loaded nothing, and the call of its wrapper
        // does. That changes who loads what, so look again.
        let mut iter = files.iterator::<true, true>();
        let mut entry_bits_changed = false;
        while let Some(id) = iter.next() {
            entry_bits_changed |= c.file_has_no_side_effects(id as IndexInt);
        }
        if !entry_bits_changed {
            break;
        }
        already_wrapped.set_union(&files);
    }
    Ok(())
}

/// The files with one load class, outside of the chunk of an entry point.
struct LoadGroup {
    /// The entry points that can be the first to load the files (`EntryLoadGraph::load_class`).
    load_class: AutoBitSet,
    /// The lowest id in `load_class`.
    reference_entry_id: u32,
    /// The effects of the group, in the order in which `reference_entry_id` evaluates them.
    reference_order: Vec<IndexInt>,
    /// How much of `reference_order` the order of `cursor_entry_id` has matched.
    cursor: usize,
    cursor_entry_id: u32,
    /// The other entry points of `load_class` whose order is `reference_order`.
    matching_entry_count: usize,
    /// The files are wrappers, or become wrappers.
    is_lazy: bool,
    /// The files cannot become wrappers.
    is_pinned: bool,
}

const NO_GROUP: u32 = u32::MAX;

/// `None`: there is nothing to wrap.
fn find_files_to_wrap(
    c: &LinkerContext,
    already_wrapped: &AutoBitSet,
) -> crate::Result<Option<AutoBitSet>> {
    let entry_points = c.graph.entry_points.items_source_index();
    let files_len = c.graph.files.len();
    let file_entry_bits = c.graph.files.items_entry_bits();
    let css = c.graph.ast.items_css();
    let flags = c.graph.meta.items_flags();
    let wrapper_refs = c.graph.ast.items_wrapper_ref();
    let loaders = c.parse_graph().input_files.items_loader();

    let mut load_graph = EntryLoadGraph::new(c)?;
    let mut groups: Vec<LoadGroup> = Vec::new();
    let mut group_of_key: StringHashMap<u32> = StringHashMap::default();
    let mut group_of_class: StringHashMap<u32> = StringHashMap::default();
    let mut group_of_file: Vec<u32> = vec![NO_GROUP; files_len];
    // (file, group): loading the group runs the file. A wrapped file runs where a file of the
    // group calls it, so it can be in several groups.
    let mut effects: Vec<(IndexInt, u32)> = Vec::new();
    let mut inits: Vec<u32> = Vec::new();
    for source_index in c.graph.reachable_files.iter() {
        let source_index = source_index.get();
        let id = source_index as usize;
        if source_index == Index::RUNTIME.value()
            || !c.graph.files_live.is_set(id)
            || css[id].is_some()
            || loaders[id] == Loader::Html
            || (flags[id].wrap != WrapKind::None && !already_wrapped.is_set(id))
            || file_entry_bits[id].count() < 2
        {
            continue;
        }
        let key = file_entry_bits[id].bytes(entry_points.len());
        let group = match group_of_key.get(key) {
            Some(&group) => group,
            None => {
                let load_class = load_graph.load_class(&file_entry_bits[id])?;
                let class_key = load_class.bytes(entry_points.len());
                let group = match group_of_class.get(class_key) {
                    Some(&group) => group,
                    None => {
                        let group = groups.len() as u32;
                        group_of_class.put(class_key, group)?;
                        groups.push(LoadGroup {
                            reference_entry_id: load_class.find_first_set().expect("not empty")
                                as u32,
                            load_class,
                            reference_order: Vec::new(),
                            cursor: 0,
                            cursor_entry_id: u32::MAX,
                            matching_entry_count: 0,
                            is_lazy: false,
                            is_pinned: false,
                        });
                        group
                    }
                };
                group_of_key.put(key, group)?;
                group
            }
        };
        group_of_file[id] = group;
        // An AST that the parser did not make (`AstBuilder`) has no symbol for a wrapper.
        if !wrapper_refs[id].is_valid() {
            groups[group as usize].is_pinned = true;
        }
        if already_wrapped.is_set(id) {
            groups[group as usize].is_lazy = true;
            continue;
        }
        // One loader has one order.
        if groups[group as usize].load_class.count() < 2 {
            continue;
        }

        inits.clear();
        if !c.loading_file_side_effects(source_index, Some(&mut inits)) {
            inits.clear();
            c.top_level_inits(source_index, &mut inits);
            effects.push((source_index, group));
        }
        effects.extend(inits.iter().map(|&wrapped| (wrapped, group)));
    }
    // A file comes after what it imports whoever loads it, so an initializer without side effects
    // is in place for its readers. Not in an import cycle, where the file entered first runs last.
    if groups.iter().any(|group| group.load_class.count() >= 2) {
        let is_cyclic = find_cyclic_files(c);
        for (id, &group) in group_of_file.iter().enumerate() {
            if group != NO_GROUP
                && is_cyclic[id]
                && !already_wrapped.is_set(id)
                && groups[group as usize].load_class.count() >= 2
                && has_top_level_initializer(c, id as IndexInt)
            {
                effects.push((id as IndexInt, group));
            }
        }
    }
    effects.sort_unstable();
    effects.dedup();

    // One effect has one order.
    let mut effect_counts: Vec<u32> = vec![0; groups.len()];
    for &(_, group) in &effects {
        effect_counts[group as usize] += 1;
    }
    effects.retain(|&(_, group)| effect_counts[group as usize] >= 2);

    let mut orders = EvaluationOrders::new(c, &group_of_file, &effects);
    let mut entries_to_compare = AutoBitSet::init_empty(entry_points.len())?;
    for &(_, group) in &effects {
        entries_to_compare.set_union(&groups[group as usize].load_class);
    }
    orders.compute(c, &entries_to_compare);
    // By ascending entry point id, so the reference of a group comes first.
    for order in orders.by_entry_id.iter().flatten() {
        for &source_index in &order.files {
            let first = effects.partition_point(|&(other, _)| other < source_index);
            for &(_, group) in effects[first..]
                .iter()
                .take_while(|&&(other, _)| other == source_index)
            {
                let group = &mut groups[group as usize];
                if !group.load_class.is_set(order.entry_id as usize) {
                    continue;
                }
                if group.reference_entry_id == order.entry_id {
                    group.reference_order.push(source_index);
                    continue;
                }
                if group.cursor_entry_id != order.entry_id {
                    group.cursor_entry_id = order.entry_id;
                    group.cursor = 0;
                }
                // A mismatch leaves the cursor short of the end.
                if group.reference_order.get(group.cursor) == Some(&source_index) {
                    group.cursor += 1;
                    group.matching_entry_count +=
                        (group.cursor == group.reference_order.len()) as usize;
                }
            }
        }
    }
    let has_conflict: Vec<bool> = groups
        .iter()
        .map(|group| {
            !group.reference_order.is_empty()
                && group.matching_entry_count + 1 != group.load_class.count()
        })
        .collect();
    if !groups.iter().any(|group| group.is_lazy) && !has_conflict.contains(&true) {
        return Ok(None);
    }

    let mut all_loaders = AutoBitSet::init_empty(entry_points.len())?;
    for group in &groups {
        all_loaders.set_union(&group.load_class);
    }
    orders.compute(c, &all_loaders);
    // Per entry point: the group of each file, in evaluation order. Without the groups that
    // another entry point has always loaded by the time this one loads.
    let group_orders: Vec<Vec<u32>> = orders
        .by_entry_id
        .iter()
        .flatten()
        .map(|order| {
            let mut group_order: Vec<u32> = order
                .files
                .iter()
                .map(|&source_index| group_of_file[source_index as usize])
                .filter(|&group| {
                    group != NO_GROUP
                        && groups[group as usize]
                            .load_class
                            .is_set(order.entry_id as usize)
                })
                .collect();
            group_order.dedup();
            group_order
        })
        .collect();

    // An HTML file prints nothing for a `<script src>`, so it cannot call a wrapper.
    for source_index in c.graph.reachable_files.iter() {
        let id = source_index.get() as usize;
        if loaders[id] != Loader::Html || !c.graph.files_live.is_set(id) {
            continue;
        }
        for record in c.graph.ast.items_import_records()[id].as_slice() {
            if record.source_index.is_valid()
                && group_of_file[record.source_index.get() as usize] != NO_GROUP
            {
                groups[group_of_file[record.source_index.get() as usize] as usize].is_pinned = true;
            }
        }
    }
    // What comes after a wrapper has to be one. So what comes before a pinned file is pinned.
    while groups.iter().any(|group| group.is_pinned) {
        let mut changed = false;
        for group_order in &group_orders {
            let mut seen_pinned = false;
            for &group in group_order.iter().rev() {
                let group = &mut groups[group as usize];
                changed |= seen_pinned && !group.is_pinned;
                group.is_pinned |= seen_pinned;
                seen_pinned = group.is_pinned;
            }
        }
        if !changed {
            break;
        }
    }
    for (group, has_conflict) in groups.iter_mut().zip(has_conflict) {
        group.is_lazy |= has_conflict && !group.is_pinned;
    }
    loop {
        let mut changed = false;
        for group_order in &group_orders {
            let mut seen_lazy = false;
            for &group in group_order {
                let group = &mut groups[group as usize];
                if seen_lazy && !group.is_lazy && !group.is_pinned {
                    group.is_lazy = true;
                    changed = true;
                }
                seen_lazy |= group.is_lazy;
            }
        }
        if !changed {
            break;
        }
    }

    let mut files = AutoBitSet::init_empty(files_len)?;
    let mut found = false;
    for (id, &group) in group_of_file.iter().enumerate() {
        if group == NO_GROUP || already_wrapped.is_set(id) {
            continue;
        }
        let group = &groups[group as usize];
        if group.is_lazy && !group.is_pinned {
            files.set(id);
            found = true;
        }
    }
    Ok(found.then_some(files))
}

/// The evaluation order of each entry point, computed on demand.
struct EvaluationOrders {
    by_entry_id: Vec<Option<EvaluationOrder>>,
    /// The files that an order lists.
    is_tracked: Vec<bool>,
}

impl EvaluationOrders {
    fn new(
        c: &LinkerContext,
        group_of_file: &[u32],
        effects: &[(IndexInt, u32)],
    ) -> EvaluationOrders {
        let mut is_tracked: Vec<bool> = group_of_file
            .iter()
            .map(|&group| group != NO_GROUP)
            .collect();
        for &(source_index, _) in effects {
            is_tracked[source_index as usize] = true;
        }
        let mut by_entry_id = Vec::new();
        by_entry_id.resize_with(c.graph.entry_points.len(), || None);
        EvaluationOrders {
            by_entry_id,
            is_tracked,
        }
    }

    /// Computes the orders of `entry_ids` that are missing, in parallel.
    fn compute(&mut self, c: &LinkerContext, entry_ids: &AutoBitSet) {
        let mut pending: Vec<EvaluationOrder> = Vec::new();
        let mut iter = entry_ids.iterator::<true, true>();
        while let Some(entry_id) = iter.next() {
            if self.by_entry_id[entry_id].is_none() {
                pending.push(EvaluationOrder {
                    entry_id: entry_id as u32,
                    files: Vec::new(),
                });
            }
        }
        c.worker_pool().each_ptr(
            (c, self.is_tracked.as_slice()),
            |&(c, is_tracked): &(&LinkerContext, &[bool]),
             order: *mut EvaluationOrder,
             _: usize| {
                // SAFETY: `each_ptr` hands each task a distinct `*mut EvaluationOrder`.
                unsafe { &mut *order }.compute(c, is_tracked);
            },
            &mut pending,
        );
        for order in pending {
            let entry_id = order.entry_id as usize;
            self.by_entry_id[entry_id] = Some(order);
        }
    }
}

/// A live part holds more than `import`s, `export`s and function declarations, which are in place before any file runs.
fn has_top_level_initializer(c: &LinkerContext, source_index: IndexInt) -> bool {
    use bun_ast::StmtData;
    let parts_live = &c.graph.parts_live[source_index as usize];
    c.graph.ast.items_parts()[source_index as usize]
        .as_slice()
        .iter()
        .enumerate()
        .any(|(part_index, part)| {
            parts_live.is_set(part_index)
                && part.stmts.slice().iter().any(|stmt| {
                    !matches!(
                        stmt.data,
                        StmtData::SImport(_)
                            | StmtData::SExportStar(_)
                            | StmtData::SExportFrom(_)
                            | StmtData::SExportClause(_)
                            | StmtData::SFunction(_)
                            | StmtData::SEmpty(_)
                    )
                })
        })
}

/// Per file: whether it is in a strongly connected component of several files (Tarjan's algorithm).
fn find_cyclic_files(c: &LinkerContext) -> Vec<bool> {
    const UNVISITED: u32 = u32::MAX;
    struct Frame {
        source_index: IndexInt,
        /// `edges[first_edge..]` are the imports of the file, `edges[next_edge..]` the ones still to follow.
        first_edge: usize,
        next_edge: usize,
    }

    let files_len = c.graph.files.len();
    let mut is_cyclic: Vec<bool> = vec![false; files_len];
    // The position in `scc_stack` when the file was pushed.
    let mut index: Vec<u32> = vec![UNVISITED; files_len];
    let mut lowlink: Vec<u32> = vec![0; files_len];
    let mut on_scc_stack: Vec<bool> = vec![false; files_len];
    let mut scc_stack: Vec<IndexInt> = Vec::new();
    let mut edges: Vec<IndexInt> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();

    for &root in c.graph.entry_points.items_source_index() {
        if index[root as usize] != UNVISITED {
            continue;
        }
        let mut next_file = Some(root);
        loop {
            if let Some(source_index) = next_file.take() {
                index[source_index as usize] = scc_stack.len() as u32;
                lowlink[source_index as usize] = scc_stack.len() as u32;
                scc_stack.push(source_index);
                on_scc_stack[source_index as usize] = true;
                let first_edge = edges.len();
                let is_live = c.graph.files_live.is_set(source_index as usize);
                for_each_edge(c, source_index, is_live, |_, edge| match edge {
                    Edge::Import(other) | Edge::LoadNow(other) => edges.push(other),
                    Edge::LoadLater(_) => {}
                });
                stack.push(Frame {
                    source_index,
                    first_edge,
                    next_edge: first_edge,
                });
            }
            let Some(frame) = stack.last_mut() else {
                break;
            };
            let id = frame.source_index as usize;
            if let Some(&other) = edges.get(frame.next_edge) {
                frame.next_edge += 1;
                if index[other as usize] == UNVISITED {
                    next_file = Some(other);
                } else if on_scc_stack[other as usize] {
                    lowlink[id] = lowlink[id].min(index[other as usize]);
                }
                continue;
            }
            edges.truncate(frame.first_edge);
            stack.pop();
            if let Some(parent) = stack.last() {
                let parent = parent.source_index as usize;
                lowlink[parent] = lowlink[parent].min(lowlink[id]);
            }
            if lowlink[id] == index[id] {
                let component = scc_stack.drain(index[id] as usize..);
                let is_cycle = component.len() > 1;
                for member in component {
                    on_scc_stack[member as usize] = false;
                    is_cyclic[member as usize] = is_cycle;
                }
            }
        }
    }
    is_cyclic
}

/// The tracked files that loading an entry point evaluates, in evaluation order.
struct EvaluationOrder {
    entry_id: u32,
    files: Vec<IndexInt>,
}

impl EvaluationOrder {
    fn compute(&mut self, c: &LinkerContext, is_tracked: &[bool]) {
        #[derive(Clone, Copy)]
        enum Frame {
            /// `importer`: the file whose `import` leads here, through files that do not run with it.
            Enter {
                source_index: IndexInt,
                importer: IndexInt,
            },
            Leave(IndexInt),
        }

        let files_len = c.graph.files.len();
        let mut visited = bun_core::handle_oom(AutoBitSet::init_empty(files_len));
        // Per file: 1 + the last importer that went through it.
        let mut passed: Vec<u32> = vec![0; files_len];
        let entry_point = c.graph.entry_points.items_source_index()[self.entry_id as usize];
        let mut stack: Vec<Frame> = vec![Frame::Enter {
            source_index: entry_point,
            importer: entry_point,
        }];
        while let Some(frame) = stack.pop() {
            let (source_index, importer) = match frame {
                Frame::Leave(source_index) => {
                    self.files.push(source_index);
                    continue;
                }
                Frame::Enter {
                    source_index,
                    importer,
                } => (source_index, importer),
            };
            if source_index == Index::RUNTIME.value() || visited.is_set(source_index as usize) {
                continue;
            }
            let runs = c.runs_with(importer, source_index);
            if runs {
                visited.set(source_index as usize);
            } else if core::mem::replace(&mut passed[source_index as usize], importer + 1)
                == importer + 1
            {
                continue;
            }
            let importer = if runs { source_index } else { importer };

            let mark = stack.len();
            for_each_edge(c, source_index, runs, |_, edge| match edge {
                Edge::Import(source_index) => stack.push(Frame::Enter {
                    source_index,
                    importer,
                }),
                Edge::LoadNow(source_index) => stack.push(Frame::Enter {
                    source_index,
                    importer: source_index,
                }),
                Edge::LoadLater(_) => {}
            });
            if runs && is_tracked[source_index as usize] {
                stack.push(Frame::Leave(source_index));
            }
            stack[mark..].reverse();
        }
    }
}
