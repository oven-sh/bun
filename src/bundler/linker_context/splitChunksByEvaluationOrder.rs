use crate::mal_prelude::*;
use bun_collections::{AutoBitSet, StringHashMap};

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::merge_small_chunks::EntryLoadGraph;
use crate::options::Loader;
use crate::{Index, IndexInt, LinkerContext};

const NONE: u32 = u32::MAX;

/// The files with one `File.entry_bits` that several entry points load.
struct Group {
    /// The entry points that can be the first to load the files (`EntryLoadGraph::load_class`).
    load_class: AutoBitSet,
    /// The lowest id in `load_class`. The other orders are compared with its order.
    reference_entry_id: u32,
    /// The last file of the group in the order that is being read, and the entry point of that order.
    last_file: IndexInt,
    last_file_entry_id: u32,
    /// How many runs of files every order has back to back, in the same order.
    runs_len: u32,
    has_import_cycle: bool,
}

/// Files share a chunk when the same entry points load them, and run them back to back in the same order:
/// a chunk prints its files in one order. Per file: what the key of its chunk has next to `File.entry_bits`.
/// Empty: 0 for every file.
pub(crate) fn split_chunks_by_evaluation_order(c: &LinkerContext) -> crate::Result<Vec<u32>> {
    let _trace = bun_core::perf::trace("Bundler.splitChunksByEvaluationOrder");
    let entry_points_len = c.graph.entry_points.len();
    if entry_points_len < 2 {
        return Ok(Vec::new());
    }
    let files_len = c.graph.files.len();
    let file_entry_bits = c.graph.files.items_entry_bits();
    let css = c.graph.ast.items_css();
    let loaders = c.parse_graph().input_files.items_loader();

    // Only the order of files that run something when they load can be observed.
    let mut key_of_file: Vec<u32> = vec![NONE; files_len];
    let mut id_of_key: StringHashMap<u32> = StringHashMap::default();
    // Per key: one of its files, and how many of them run something.
    let mut keys: Vec<(IndexInt, u32)> = Vec::new();
    let mut is_tracked: Vec<bool> = vec![false; files_len];
    for source_index in c.graph.reachable_files.iter() {
        let source_index = source_index.get();
        let id = source_index as usize;
        if source_index == Index::RUNTIME.value()
            || !c.graph.files_live.is_set(id)
            || css[id].is_some()
            || loaders[id] == Loader::Html
            || file_entry_bits[id].count() < 2
        {
            continue;
        }
        let key = *id_of_key.get_or_put_value(
            file_entry_bits[id].bytes(entry_points_len),
            keys.len() as u32,
        )?;
        if key as usize == keys.len() {
            keys.push((source_index, 0));
        }
        key_of_file[id] = key;
        if !c.loading_file_has_no_side_effects(source_index) {
            is_tracked[id] = true;
            keys[key as usize].1 += 1;
        }
    }

    // One such file has one order, and so has one loader.
    let mut load_graph: Option<EntryLoadGraph> = None;
    let mut groups: Vec<Group> = Vec::new();
    let mut group_of_key: Vec<u32> = vec![NONE; keys.len()];
    for (key, &(source_index, effects_len)) in keys.iter().enumerate() {
        if effects_len < 2 {
            continue;
        }
        let load_graph = match &mut load_graph {
            Some(load_graph) => load_graph,
            None => load_graph.insert(EntryLoadGraph::new(c)?),
        };
        let load_class = load_graph.load_class(&file_entry_bits[source_index as usize])?;
        let Some(reference_entry_id) = load_class.find_first_set() else {
            continue;
        };
        if load_class.count() < 2 {
            continue;
        }
        group_of_key[key] = groups.len() as u32;
        groups.push(Group {
            load_class,
            reference_entry_id: reference_entry_id as u32,
            last_file: NONE,
            last_file_entry_id: NONE,
            runs_len: 0,
            has_import_cycle: false,
        });
    }
    if groups.is_empty() {
        return Ok(Vec::new());
    }
    let group_of_file: Vec<u32> = key_of_file
        .iter()
        .map(|&key| {
            if key == NONE {
                NONE
            } else {
                group_of_key[key as usize]
            }
        })
        .collect();

    // A file that imports one of those files runs it, so it has a place in the order too.
    let mut importers_of_file: Vec<Vec<IndexInt>> = vec![Vec::new(); files_len];
    let mut worklist: Vec<IndexInt> = Vec::new();
    for (id, &group) in group_of_file.iter().enumerate() {
        if group == NONE {
            is_tracked[id] = false;
            continue;
        }
        if is_tracked[id] {
            worklist.push(id as IndexInt);
        }
        for_each_edge(c, id as IndexInt, true, |_, edge| {
            if let Edge::Import(other) = edge
                && group_of_file[other as usize] == group
            {
                importers_of_file[other as usize].push(id as IndexInt);
            }
        });
    }
    while let Some(source_index) = worklist.pop() {
        for &importer in &importers_of_file[source_index as usize] {
            if !core::mem::replace(&mut is_tracked[importer as usize], true) {
                worklist.push(importer);
            }
        }
    }

    // A chunk imports another for the bindings that it uses. In an import cycle that is not the order in
    // which the files run, so the files of such a group stay together.
    let is_cyclic = find_cyclic_files(c);
    let mut entries_to_compare = AutoBitSet::init_empty(entry_points_len)?;
    for (id, &group) in group_of_file.iter().enumerate() {
        if is_tracked[id] && is_cyclic[id] {
            groups[group as usize].has_import_cycle = true;
        }
    }
    for group in groups.iter().filter(|group| !group.has_import_cycle) {
        entries_to_compare.set_union(&group.load_class);
    }

    let mut entry_id_of_file: Vec<u32> = vec![NONE; files_len];
    for (entry_id, &source_index) in c.graph.entry_points.items_source_index().iter().enumerate() {
        let slot = &mut entry_id_of_file[source_index as usize];
        if *slot == NONE {
            *slot = entry_id as u32;
        }
    }
    let mut orders: Vec<EvaluationOrder> = Vec::new();
    let mut entry_ids = entries_to_compare.iterator::<true, true>();
    while let Some(entry_id) = entry_ids.next() {
        orders.push(EvaluationOrder {
            entry_id: entry_id as u32,
            files: Vec::new(),
        });
    }
    c.worker_pool().each_ptr(
        (c, is_tracked.as_slice(), entry_id_of_file.as_slice()),
        |&(c, is_tracked, entry_id_of_file): &(&LinkerContext, &[bool], &[u32]),
         order: *mut EvaluationOrder,
         _: usize| {
            // SAFETY: `each_ptr` hands each task a distinct `*mut EvaluationOrder`.
            unsafe { &mut *order }.compute(c, is_tracked, entry_id_of_file);
        },
        &mut orders,
    );

    // Per file: the file of its group that the reference order has right before it.
    let mut reference_previous: Vec<IndexInt> = vec![NONE; files_len];
    // Whether every order has that file right before it.
    let mut follows_previous: Vec<bool> = vec![false; files_len];
    // By ascending entry point id, so the reference of a group comes first.
    for order in &orders {
        for &source_index in &order.files {
            let id = source_index as usize;
            let group = &mut groups[group_of_file[id] as usize];
            if group.has_import_cycle || !group.load_class.is_set(order.entry_id as usize) {
                continue;
            }
            if group.last_file_entry_id != order.entry_id {
                group.last_file_entry_id = order.entry_id;
                group.last_file = NONE;
            }
            let previous = core::mem::replace(&mut group.last_file, source_index);
            if group.reference_entry_id == order.entry_id {
                reference_previous[id] = previous;
                follows_previous[id] = previous != NONE;
            } else if reference_previous[id] != previous {
                follows_previous[id] = false;
            }
        }
    }

    for order in &orders {
        for &source_index in &order.files {
            let group = &mut groups[group_of_file[source_index as usize] as usize];
            if group.reference_entry_id == order.entry_id && !group.has_import_cycle {
                group.runs_len += !follows_previous[source_index as usize] as u32;
            }
        }
    }
    if groups.iter().all(|group| group.runs_len < 2) {
        return Ok(Vec::new());
    }
    let mut run_of_file: Vec<u32> = vec![0; files_len];
    let mut runs_len: u32 = 0;
    for order in &orders {
        for &source_index in &order.files {
            let group = &groups[group_of_file[source_index as usize] as usize];
            if group.reference_entry_id == order.entry_id && group.runs_len >= 2 {
                runs_len += !follows_previous[source_index as usize] as u32;
                run_of_file[source_index as usize] = runs_len;
            }
        }
    }
    Ok(run_of_file)
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
    fn compute(&mut self, c: &LinkerContext, is_tracked: &[bool], entry_id_of_file: &[u32]) {
        #[derive(Clone, Copy)]
        enum Frame {
            /// `loader`: the entry point whose load runs the file. A split `require()` that runs at load changes it.
            Enter {
                source_index: IndexInt,
                loader: u32,
            },
            Leave(IndexInt),
        }
        let entry_bits = c.graph.files.items_entry_bits();
        let mut seen = bun_core::handle_oom(AutoBitSet::init_empty(c.graph.files.len()));
        let mut stack: Vec<Frame> = vec![Frame::Enter {
            source_index: c.graph.entry_points.items_source_index()[self.entry_id as usize],
            loader: self.entry_id,
        }];
        while let Some(frame) = stack.pop() {
            let (source_index, loader) = match frame {
                Frame::Leave(source_index) => {
                    self.files.push(source_index);
                    continue;
                }
                Frame::Enter {
                    source_index,
                    loader,
                } => (source_index, loader),
            };
            let id = source_index as usize;
            if seen.is_set(id) {
                continue;
            }
            seen.set(id);
            let runs = c.graph.files_live.is_set(id) && entry_bits[id].is_set(loader as usize);
            let mark = stack.len();
            for_each_edge(c, source_index, runs, |_, edge| match edge {
                Edge::Import(other) => stack.push(Frame::Enter {
                    source_index: other,
                    loader,
                }),
                Edge::LoadNow(other) => stack.push(Frame::Enter {
                    source_index: other,
                    loader: entry_id_of_file[other as usize],
                }),
                Edge::LoadLater(_) => {}
            });
            if runs && is_tracked[id] {
                stack.push(Frame::Leave(source_index));
            }
            stack[mark..].reverse();
        }
    }
}
