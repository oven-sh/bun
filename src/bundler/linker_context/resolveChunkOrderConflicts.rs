use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_collections::{AutoBitSet, StringHashMap, VecExt};

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::merge_small_chunks::{EntryLoadGraph, stmt_only_declares};
use crate::linker_context_mod::TreeShakeWork;
use crate::options::Loader;
use crate::{Index, IndexInt, LinkerContext, WrapKind};

/// Entry points that can each be the first to load a chunk may evaluate its files in different
/// orders, and a chunk prints one. Those files become `__esm` wrappers, which each importer calls
/// where it imports them. `README.md` has the rules.
pub(crate) fn resolve_chunk_order_conflicts(c: &mut LinkerContext) -> crate::Result<()> {
    let _trace = bun_core::perf::trace("Bundler.resolveChunkOrderConflicts");
    if !c.graph.code_splitting || c.graph.entry_points.len() < 2 {
        return Ok(());
    }
    let mut already_wrapped = AutoBitSet::init_empty(c.graph.files.len())?;
    while let Some(files) = find_files_to_wrap(c, &already_wrapped)? {
        c.wrap_files_as_esm(&files)?;
        // The `import` of a `"sideEffects": false` file loaded nothing, and the call of its wrapper loads it.
        let mut iter = files.iterator::<true, true>();
        let mut loads_changed = false;
        while let Some(id) = iter.next() {
            loads_changed |= c.file_has_no_side_effects(id as IndexInt);
        }
        if !loads_changed {
            break;
        }
        already_wrapped.set_union(&files);
    }
    Ok(())
}

/// The files with one load class, outside of the chunk of an entry point. Or the async files of that chunk.
struct LoadGroup {
    /// The entry points that can be the first to load the files (`EntryLoadGraph::load_class`).
    load_class: AutoBitSet,
    loader_count: usize,
    /// The files are wrappers, or become wrappers.
    is_lazy: bool,
    /// The files cannot become wrappers.
    is_pinned: bool,
    /// A file reaches a top-level await.
    has_async_file: bool,
    /// The files print in the chunk of the one entry point that loads them, where it imports them.
    is_in_entry_chunk: bool,
}

const NO_GROUP: u32 = u32::MAX;

struct LoadGroups {
    groups: Vec<LoadGroup>,
    group_of_file: Vec<u32>,
    /// (file, group), sorted: loading the group runs the file. A wrapped file runs where a file
    /// of the group calls it, so it can be in several groups.
    effects: Vec<(IndexInt, u32)>,
}

fn group_files(c: &LinkerContext, already_wrapped: &AutoBitSet) -> crate::Result<LoadGroups> {
    let entry_points_len = c.graph.entry_points.len();
    let file_entry_bits = c.graph.files.items_entry_bits();
    let css = c.graph.ast.items_css();
    let flags = c.graph.meta.items_flags();
    let wrapper_refs = c.graph.ast.items_wrapper_ref();
    let loaders = c.parse_graph().input_files.items_loader();
    let entry_point_kinds = c.graph.files.items_entry_point_kind();

    let mut load_graph = EntryLoadGraph::new(c)?;
    let mut groups: Vec<LoadGroup> = Vec::new();
    let mut group_of_key: StringHashMap<u32> = StringHashMap::default();
    let mut group_of_class: StringHashMap<u32> = StringHashMap::default();
    let mut group_of_file: Vec<u32> = vec![NO_GROUP; c.graph.files.len()];
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
        {
            continue;
        }
        let is_in_entry_chunk = file_entry_bits[id].count() < 2;
        if is_in_entry_chunk
            && (!flags[id].is_async_or_has_async_dependency
                || entry_point_kinds[id].is_entry_point())
        {
            continue;
        }
        let by_key = group_of_key.get_or_put(file_entry_bits[id].bytes(entry_points_len))?;
        if !by_key.found_existing {
            let load_class = load_graph.load_class(&file_entry_bits[id])?;
            let new_group = groups.len() as u32;
            *by_key.value_ptr = if is_in_entry_chunk {
                new_group
            } else {
                *group_of_class.get_or_put_value(load_class.bytes(entry_points_len), new_group)?
            };
            if *by_key.value_ptr == new_group {
                groups.push(LoadGroup {
                    loader_count: load_class.count(),
                    load_class,
                    is_lazy: false,
                    is_pinned: false,
                    has_async_file: false,
                    is_in_entry_chunk,
                });
            }
        }
        let group_index = *by_key.value_ptr;
        group_of_file[id] = group_index;
        let group = &mut groups[group_index as usize];
        group.has_async_file |= flags[id].is_async_or_has_async_dependency;
        // An AST that the parser did not make (`AstBuilder`) has no symbol for a wrapper.
        group.is_pinned |= !wrapper_refs[id].is_valid();
        if already_wrapped.is_set(id) {
            group.is_lazy = true;
            continue;
        }
        // One loader has one order.
        if group.loader_count < 2 {
            continue;
        }

        inits.clear();
        if !c.loading_file_side_effects(source_index, Some(&mut inits)) {
            inits.clear();
            c.top_level_inits(source_index, &mut inits);
            effects.push((source_index, group_index));
        }
        effects.extend(inits.iter().map(|&wrapped| (wrapped, group_index)));
    }
    // A file comes after what it imports whoever loads it, so an initializer without side effects
    // is in place for its readers. Not in an import cycle, where the file entered first runs last.
    if groups.iter().any(|group| group.loader_count >= 2) {
        let (cycle_of_file, _) = find_import_cycles(c);
        for (id, &group) in group_of_file.iter().enumerate() {
            if group != NO_GROUP
                && cycle_of_file[id] != NO_CYCLE
                && !already_wrapped.is_set(id)
                && groups[group as usize].loader_count >= 2
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

    Ok(LoadGroups {
        groups,
        group_of_file,
        effects,
    })
}

/// Per group: whether two of its loaders evaluate its effects in different orders.
fn find_order_conflicts(load_groups: &LoadGroups, orders: &EvaluationOrders) -> Vec<bool> {
    struct Comparison {
        /// The lowest id in `load_class`, and the order in which it evaluates the effects of the group.
        reference_entry_id: Option<usize>,
        reference_order: Vec<IndexInt>,
        /// How much of `reference_order` the order of `cursor_entry_id` has matched.
        cursor: usize,
        cursor_entry_id: u32,
        /// The other loaders whose order is `reference_order`.
        matching_entry_count: usize,
    }
    let LoadGroups {
        groups, effects, ..
    } = load_groups;
    let mut comparisons: Vec<Comparison> = groups
        .iter()
        .map(|group| Comparison {
            reference_entry_id: group.load_class.find_first_set(),
            reference_order: Vec::new(),
            cursor: 0,
            cursor_entry_id: u32::MAX,
            matching_entry_count: 0,
        })
        .collect();
    // By ascending entry point id, so the reference of a group comes first.
    for order in orders.by_entry_id.iter().flatten() {
        for &source_index in &order.files {
            let first = effects.partition_point(|&(other, _)| other < source_index);
            for &(_, group) in effects[first..]
                .iter()
                .take_while(|&&(other, _)| other == source_index)
            {
                if !groups[group as usize]
                    .load_class
                    .is_set(order.entry_id as usize)
                {
                    continue;
                }
                let comparison = &mut comparisons[group as usize];
                if comparison.reference_entry_id == Some(order.entry_id as usize) {
                    comparison.reference_order.push(source_index);
                    continue;
                }
                if comparison.cursor_entry_id != order.entry_id {
                    comparison.cursor_entry_id = order.entry_id;
                    comparison.cursor = 0;
                }
                // A mismatch leaves the cursor short of the end.
                if comparison.reference_order.get(comparison.cursor) == Some(&source_index) {
                    comparison.cursor += 1;
                    if comparison.cursor == comparison.reference_order.len() {
                        comparison.matching_entry_count += 1;
                    }
                }
            }
        }
    }
    groups
        .iter()
        .zip(&comparisons)
        .map(|(group, comparison)| {
            !comparison.reference_order.is_empty()
                && comparison.matching_entry_count + 1 != group.loader_count
        })
        .collect()
}

/// What comes after a wrapper, from another chunk, has to be one: the `import` of a chunk runs ahead
/// of the calls. What is async and comes before a wrapper has to be one: its `await` holds them up.
fn spread_lazy_groups(groups: &mut [LoadGroup], group_orders: &[Vec<u32>]) {
    loop {
        let mut changed = false;
        for group_order in group_orders {
            let mut is_after_lazy = false;
            for &group in group_order {
                let group = &mut groups[group as usize];
                if is_after_lazy && !group.is_lazy && !group.is_pinned && !group.is_in_entry_chunk {
                    group.is_lazy = true;
                    changed = true;
                }
                is_after_lazy |= group.is_lazy;
            }
            let mut is_before_lazy = false;
            for &group in group_order.iter().rev() {
                let group = &mut groups[group as usize];
                if is_before_lazy && !group.is_lazy && !group.is_pinned && group.has_async_file {
                    group.is_lazy = true;
                    changed = true;
                }
                is_before_lazy |= group.is_lazy;
            }
        }
        if !changed {
            break;
        }
    }
}

/// The reverse of `spread_lazy_groups`: what comes before a pinned file is pinned, and what comes
/// after a pinned async file.
fn spread_pinned_groups(groups: &mut [LoadGroup], group_orders: &[Vec<u32>]) {
    loop {
        let mut changed = false;
        for group_order in group_orders {
            let mut is_pinned = false;
            for &group in group_order.iter().rev() {
                let group = &mut groups[group as usize];
                changed |= is_pinned && !group.is_pinned;
                group.is_pinned |= is_pinned;
                is_pinned = group.is_pinned;
            }
            let mut is_pinned = false;
            for &group in group_order {
                let group = &mut groups[group as usize];
                changed |= is_pinned && !group.is_pinned;
                group.is_pinned |= is_pinned;
                is_pinned |= group.is_pinned && group.has_async_file;
            }
        }
        if !changed {
            break;
        }
    }
}

/// The unwrapped files that have to become wrappers, if any.
fn find_files_to_wrap(
    c: &LinkerContext,
    already_wrapped: &AutoBitSet,
) -> crate::Result<Option<AutoBitSet>> {
    let entry_points_len = c.graph.entry_points.len();
    let mut load_groups = group_files(c, already_wrapped)?;

    let mut orders = EvaluationOrders::new(c, &load_groups);
    let mut entries_to_compare = AutoBitSet::init_empty(entry_points_len)?;
    for &(_, group) in &load_groups.effects {
        entries_to_compare.set_union(&load_groups.groups[group as usize].load_class);
    }
    orders.compute(c, &entries_to_compare);
    let has_conflict = find_order_conflicts(&load_groups, &orders);
    let LoadGroups {
        groups,
        group_of_file,
        ..
    } = &mut load_groups;
    if !groups.iter().any(|group| group.is_lazy) && !has_conflict.contains(&true) {
        return Ok(None);
    }

    let mut all_loaders = AutoBitSet::init_empty(entry_points_len)?;
    for group in groups.iter() {
        all_loaders.set_union(&group.load_class);
    }
    orders.compute(c, &all_loaders);
    // Per entry point: the groups that it can be the first to load, in evaluation order.
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
    let loaders = c.parse_graph().input_files.items_loader();
    for source_index in c.graph.reachable_files.iter() {
        let id = source_index.get() as usize;
        if loaders[id] != Loader::Html || !c.graph.files_live.is_set(id) {
            continue;
        }
        for record in c.graph.ast.items_import_records()[id].as_slice() {
            if record.source_index.is_valid()
                && let group = group_of_file[record.source_index.get() as usize]
                && group != NO_GROUP
            {
                groups[group as usize].is_pinned = true;
            }
        }
    }
    spread_pinned_groups(groups, &group_orders);
    for (group, has_conflict) in groups.iter_mut().zip(has_conflict) {
        group.is_lazy |= has_conflict && !group.is_pinned;
    }
    spread_lazy_groups(groups, &group_orders);

    let mut files = AutoBitSet::init_empty(group_of_file.len())?;
    for (id, &group) in group_of_file.iter().enumerate() {
        if group != NO_GROUP
            && !already_wrapped.is_set(id)
            && groups[group as usize].is_lazy
            && !groups[group as usize].is_pinned
        {
            files.set(id);
        }
    }
    Ok(files.find_first_set().is_some().then_some(files))
}

impl LinkerContext<'_> {
    /// Wraps files that tree shaking saw unwrapped: each becomes `var init_x = __esm(() => { ... })`,
    /// and every `import` of it a call. Does for them what `scan_imports_and_exports` does for a
    /// file that is wrapped from the start.
    fn wrap_files_as_esm(&mut self, files: &AutoBitSet) -> Result<(), AllocError> {
        let mut worklist: Vec<TreeShakeWork> = Vec::new();

        let mut iter = files.iterator::<true, true>();
        while let Some(id) = iter.next() {
            let source_index = id as IndexInt;
            self.graph.meta.items_flags_mut()[id].wrap = WrapKind::Esm;

            let wrapper_ref = self.graph.ast.items_wrapper_ref()[id];
            debug_assert!(wrapper_ref.is_valid());
            let mut wrapper_part_index = Index::default();
            self.create_wrapper_for_file(
                WrapKind::Esm,
                wrapper_ref,
                &mut wrapper_part_index,
                source_index,
            );
            self.graph.meta.items_wrapper_part_index_mut()[id] = wrapper_part_index;

            // Use "init_*" for ESM wrappers instead of "require_*"
            let name = {
                use std::io::Write as _;
                let source = self.get_source(id);
                let mut name: Vec<u8> = b"init_".to_vec();
                if !source.identifier_name.is_empty() {
                    name.extend_from_slice(&source.identifier_name);
                } else {
                    write!(&mut name, "{}", source.fmt_identifier())
                        .expect("infallible: in-memory write");
                }
                self.graph.arena().alloc_slice_copy(&name)
            };
            // SAFETY: the caller passes files that have a wrapper ref; no other borrow
            // into `self.graph.symbols` is live across this write.
            unsafe { self.graph.symbol_mut(wrapper_ref) }.original_name =
                bun_ast::StoreStr::new(name);

            let mut parts_live = AutoBitSet::init_empty(self.graph.ast.items_parts()[id].len())?;
            self.graph.parts_live[id].for_each(&mut parts_live, AutoBitSet::set);
            self.graph.parts_live[id] = parts_live;

            worklist.push(TreeShakeWork::Part {
                part_index: wrapper_part_index.get(),
                source_index,
            });
        }

        for i in 0..self.graph.reachable_files.len() {
            let source_index = self.graph.reachable_files.slice()[i].get();
            let id = source_index as usize;
            if self.graph.ast.items_css()[id].is_some() {
                continue;
            }
            for part_index in 0..self.graph.ast.items_parts()[id].len() {
                let (mut to_esm_uses, mut to_common_js_uses) = (0, 0);
                let mut changed = false;
                let records_len = self.graph.ast.items_parts()[id].as_slice()[part_index]
                    .import_record_indices
                    .len();
                for n in 0..records_len {
                    let import_record_index = self.graph.ast.items_parts()[id].as_slice()
                        [part_index]
                        .import_record_indices
                        .slice()[n];
                    let record = &self.graph.ast.items_import_records()[id].as_slice()
                        [import_record_index as usize];
                    if !record.source_index.is_valid()
                        || self.is_external_dynamic_import(record, source_index)
                        || !files.is_set(record.source_index.get() as usize)
                    {
                        continue;
                    }
                    changed = true;
                    self.add_wrapper_dependency(
                        source_index,
                        part_index as u32,
                        import_record_index,
                        &mut to_esm_uses,
                        &mut to_common_js_uses,
                    )?;
                }
                if !changed {
                    continue;
                }
                let part = Index::part(part_index as u32);
                for (name, uses) in [
                    (&b"__toESM"[..], to_esm_uses),
                    (b"__toCommonJS", to_common_js_uses),
                ] {
                    self.graph.generate_runtime_symbol_import_and_use(
                        source_index,
                        part,
                        name,
                        uses,
                    )?;
                }
                if self.graph.parts_live[id].is_set(part_index) {
                    for dependency in self.graph.ast.items_parts()[id].as_slice()[part_index]
                        .dependencies
                        .iter()
                    {
                        worklist.push(TreeShakeWork::Part {
                            part_index: dependency.part_index,
                            source_index: dependency.source_index.get(),
                        });
                    }
                }
            }
        }

        self.mark_live(worklist);
        // The wrappers use `__esm` from the runtime.
        self.compute_entry_bits()
    }
}

/// The evaluation order of each entry point, computed on demand.
struct EvaluationOrders {
    by_entry_id: Vec<Option<EvaluationOrder>>,
    /// The files that an order lists.
    is_tracked: Vec<bool>,
}

impl EvaluationOrders {
    fn new(c: &LinkerContext, load_groups: &LoadGroups) -> EvaluationOrders {
        let mut is_tracked: Vec<bool> = load_groups
            .group_of_file
            .iter()
            .map(|&group| group != NO_GROUP)
            .collect();
        for &(source_index, _) in &load_groups.effects {
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

/// Whether a live part holds more than declarations.
fn has_top_level_initializer(c: &LinkerContext, source_index: IndexInt) -> bool {
    let parts_live = &c.graph.parts_live[source_index as usize];
    c.graph.ast.items_parts()[source_index as usize]
        .as_slice()
        .iter()
        .enumerate()
        .any(|(part_index, part)| {
            parts_live.is_set(part_index) && !part.stmts.slice().iter().all(stmt_only_declares)
        })
}

pub(crate) const NO_CYCLE: u32 = u32::MAX;

/// Per file: the strongly connected component of several files that it is in, or `NO_CYCLE`. And how
/// many there are (Tarjan's algorithm).
pub(crate) fn find_import_cycles(c: &LinkerContext) -> (Vec<u32>, usize) {
    const UNVISITED: u32 = u32::MAX;
    struct Frame {
        source_index: IndexInt,
        /// `edges[first_edge..]` are the imports of the file, `edges[next_edge..]` the ones still to follow.
        first_edge: usize,
        next_edge: usize,
    }

    let files_len = c.graph.files.len();
    let mut cycle_of_file: Vec<u32> = vec![NO_CYCLE; files_len];
    let mut cycles_len: usize = 0;
    // The position in `scc_stack` when the file was pushed.
    let mut index: Vec<u32> = vec![UNVISITED; files_len];
    let mut lowlink: Vec<u32> = vec![0; files_len];
    let mut on_scc_stack: Vec<bool> = vec![false; files_len];
    let mut scc_stack: Vec<IndexInt> = Vec::new();
    let mut edges: Vec<IndexInt> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();

    for root in c.graph.reachable_files.iter() {
        let root = root.get();
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
                    if is_cycle {
                        cycle_of_file[member as usize] = cycles_len as u32;
                    }
                }
                cycles_len += is_cycle as usize;
            }
        }
    }
    (cycle_of_file, cycles_len)
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
            let mut is_listed = !runs || !is_tracked[source_index as usize];
            for_each_edge(c, source_index, runs, |_, edge| match edge {
                Edge::Import(source_index) => stack.push(Frame::Enter {
                    source_index,
                    importer,
                }),
                Edge::LoadNow(other) => {
                    // The file has started by the time it calls `require()`.
                    if !core::mem::replace(&mut is_listed, true) {
                        stack.push(Frame::Leave(source_index));
                    }
                    stack.push(Frame::Enter {
                        source_index: other,
                        importer: other,
                    });
                }
                Edge::LoadLater(_) => {}
            });
            if !is_listed {
                stack.push(Frame::Leave(source_index));
            }
            stack[mark..].reverse();
        }
    }
}
