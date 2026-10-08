use crate::mal_prelude::*;
use bun_collections::{AutoBitSet, StringHashMap};

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::merge_small_chunks::LoadConditions;
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
pub(crate) fn wrap_order_conflicts(c: &mut LinkerContext) -> crate::Result<()> {
    let _trace = bun_core::perf::trace("Bundler.wrapOrderConflicts");
    if !c.graph.code_splitting || c.graph.entry_points.len() < 2 {
        return Ok(());
    }
    let mut wrapped = AutoBitSet::init_empty(c.graph.files.len())?;
    // Again after each round: the importer of a wrapper runs it, so a file that ran nothing now
    // does, and an `import` of a `"sideEffects": false` file now loads it.
    while let Some(files) = files_to_wrap(c, &wrapped)? {
        c.wrap_live_files_as_esm(&files)?;
        c.assign_entry_bits()?;
        wrapped.set_union(&files);
    }
    Ok(())
}

/// The files that load under one condition, outside of the chunk of an entry point.
struct Group {
    /// The entry points that can be the first to load the files.
    first_loaders: AutoBitSet,
    /// The lowest id in `first_loaders`.
    reference: u32,
    /// What runs when the files load, in the order in which `reference` evaluates it.
    order: Vec<IndexInt>,
    /// How far into `order` the walk of `walking` has come.
    cursor: usize,
    walking: u32,
    /// The other entry points of `first_loaders` that evaluate it in that order.
    agree: usize,
    /// The files are wrappers, or become wrappers.
    lazy: bool,
    /// The files cannot become wrappers.
    eager: bool,
}

const NO_GROUP: u32 = u32::MAX;

/// The unwrapped files to wrap (`None`: there are none). `wrapped`: the files wrapped so far.
fn files_to_wrap(c: &LinkerContext, wrapped: &AutoBitSet) -> crate::Result<Option<AutoBitSet>> {
    let entry_points = c.graph.entry_points.items_source_index();
    let files_len = c.graph.files.len();
    let file_entry_bits = c.graph.files.items_entry_bits();
    let css = c.graph.ast.items_css();
    let flags = c.graph.meta.items_flags();
    let loaders = c.parse_graph().input_files.items_loader();

    let mut conditions = LoadConditions::new(c)?;
    let mut groups: Vec<Group> = Vec::new();
    let mut group_of_key: StringHashMap<u32> = StringHashMap::default();
    let mut group_of_class: StringHashMap<u32> = StringHashMap::default();
    let mut group_of_file: Vec<u32> = vec![NO_GROUP; files_len];
    // (what runs, the group whose load runs it). A wrapped file runs where a file of the
    // group calls it, so it can be in several groups.
    let mut runs: Vec<(IndexInt, u32)> = Vec::new();
    let mut inits: Vec<u32> = Vec::new();
    for source_index in c.graph.reachable_files.iter() {
        let source_index = source_index.get();
        let id = source_index as usize;
        if source_index == Index::RUNTIME.value()
            || !c.graph.files_live.is_set(id)
            || css[id].is_some()
            || loaders[id] == Loader::Html
            || (flags[id].wrap != WrapKind::None && !wrapped.is_set(id))
            || file_entry_bits[id].count() < 2
        {
            continue;
        }
        let key = file_entry_bits[id].bytes(entry_points.len());
        let group = match group_of_key.get(key) {
            Some(&group) => group,
            None => {
                let first_loaders = conditions.load_class(&file_entry_bits[id])?;
                let class = first_loaders.bytes(entry_points.len());
                let group = match group_of_class.get(class) {
                    Some(&group) => group,
                    None => {
                        let group = groups.len() as u32;
                        group_of_class.put(class, group)?;
                        groups.push(Group {
                            reference: first_loaders.find_first_set().expect("not empty") as u32,
                            first_loaders,
                            order: Vec::new(),
                            cursor: 0,
                            walking: u32::MAX,
                            agree: 0,
                            lazy: false,
                            eager: false,
                        });
                        group
                    }
                };
                group_of_key.put(key, group)?;
                group
            }
        };
        group_of_file[id] = group;
        if wrapped.is_set(id) {
            groups[group as usize].lazy = true;
            continue;
        }

        inits.clear();
        if !c.loading_file_side_effects(source_index, Some(&mut inits)) {
            inits.clear();
            c.top_level_inits(source_index, &mut inits);
            runs.push((source_index, group));
        }
        runs.extend(inits.iter().map(|&wrapped| (wrapped, group)));
    }
    // A file comes after what it imports whoever loads it, so an initializer without side effects
    // is in place for its readers. Not in an import cycle, where the file entered first runs last.
    if groups.iter().any(|group| group.first_loaders.count() >= 2) {
        let in_cycle = files_in_import_cycles(c);
        for (id, &group) in group_of_file.iter().enumerate() {
            if group != NO_GROUP
                && in_cycle[id]
                && !wrapped.is_set(id)
                && initializes_at_load(c, id as IndexInt)
            {
                runs.push((id as IndexInt, group));
            }
        }
    }
    runs.sort_unstable();
    runs.dedup();

    // One loader has one order, and so does one thing that runs.
    let mut count: Vec<u32> = vec![0; groups.len()];
    for &(_, group) in &runs {
        count[group as usize] += 1;
    }
    runs.retain(|&(_, group)| {
        count[group as usize] >= 2 && groups[group as usize].first_loaders.count() >= 2
    });

    let mut walks = Walks::new(c, &group_of_file, &runs);
    let mut compared = AutoBitSet::init_empty(entry_points.len())?;
    for &(_, group) in &runs {
        compared.set_union(&groups[group as usize].first_loaders);
    }
    walks.run(c, &compared);
    // In the order of the entry point ids, so the reference of a group comes first.
    for walk in walks.done.iter().flatten() {
        for &source_index in &walk.order {
            let first = runs.partition_point(|&(other, _)| other < source_index);
            for &(_, group) in runs[first..]
                .iter()
                .take_while(|&&(other, _)| other == source_index)
            {
                let group = &mut groups[group as usize];
                if !group.first_loaders.is_set(walk.entry_id as usize) {
                    continue;
                }
                if group.reference == walk.entry_id {
                    group.order.push(source_index);
                    continue;
                }
                if group.walking != walk.entry_id {
                    group.walking = walk.entry_id;
                    group.cursor = 0;
                }
                // A mismatch leaves the cursor short of the end.
                if group.order.get(group.cursor) == Some(&source_index) {
                    group.cursor += 1;
                    group.agree += (group.cursor == group.order.len()) as usize;
                }
            }
        }
    }
    let conflicts: Vec<bool> = groups
        .iter()
        .map(|group| !group.order.is_empty() && group.agree + 1 != group.first_loaders.count())
        .collect();
    if !groups.iter().any(|group| group.lazy) && !conflicts.contains(&true) {
        return Ok(None);
    }

    let mut first_loaders = AutoBitSet::init_empty(entry_points.len())?;
    for group in &groups {
        first_loaders.set_union(&group.first_loaders);
    }
    walks.run(c, &first_loaders);
    // Per walk: the group of each file, in evaluation order. Without the groups that another
    // entry point has always loaded by the time this one loads.
    let orders: Vec<Vec<u32>> = walks
        .done
        .iter()
        .flatten()
        .map(|walk| {
            let mut order: Vec<u32> = walk
                .order
                .iter()
                .map(|&source_index| group_of_file[source_index as usize])
                .filter(|&group| {
                    group != NO_GROUP
                        && groups[group as usize]
                            .first_loaders
                            .is_set(walk.entry_id as usize)
                })
                .collect();
            order.dedup();
            order
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
                groups[group_of_file[record.source_index.get() as usize] as usize].eager = true;
            }
        }
    }
    // What comes after a wrapper has to be one. So what comes before a file that cannot be one cannot be one either.
    while groups.iter().any(|group| group.eager) {
        let mut changed = false;
        for order in &orders {
            let mut before_eager = false;
            for &group in order.iter().rev() {
                let group = &mut groups[group as usize];
                changed |= before_eager && !group.eager;
                group.eager |= before_eager;
                before_eager = group.eager;
            }
        }
        if !changed {
            break;
        }
    }
    for (group, conflict) in groups.iter_mut().zip(conflicts) {
        group.lazy |= conflict && !group.eager;
    }
    loop {
        let mut changed = false;
        for order in &orders {
            let mut after_lazy = false;
            for &group in order {
                let group = &mut groups[group as usize];
                if after_lazy && !group.lazy && !group.eager {
                    group.lazy = true;
                    changed = true;
                }
                after_lazy |= group.lazy;
            }
        }
        if !changed {
            break;
        }
    }

    let mut files = AutoBitSet::init_empty(files_len)?;
    let mut any = false;
    for (id, &group) in group_of_file.iter().enumerate() {
        if group == NO_GROUP || wrapped.is_set(id) {
            continue;
        }
        let group = &groups[group as usize];
        if group.lazy && !group.eager {
            files.set(id);
            any = true;
        }
    }
    Ok(any.then_some(files))
}

/// One walk per entry point, made when it is first asked for.
struct Walks {
    done: Vec<Option<Walk>>,
    entry_id_of_file: Vec<u32>,
    /// The files that a walk records.
    wanted: Vec<bool>,
}

impl Walks {
    fn new(c: &LinkerContext, group_of_file: &[u32], runs: &[(IndexInt, u32)]) -> Walks {
        let entry_points = c.graph.entry_points.items_source_index();
        let mut entry_id_of_file: Vec<u32> = vec![u32::MAX; group_of_file.len()];
        for (entry_id, &source_index) in entry_points.iter().enumerate() {
            let slot = &mut entry_id_of_file[source_index as usize];
            if *slot == u32::MAX {
                *slot = entry_id as u32;
            }
        }
        let mut wanted: Vec<bool> = group_of_file
            .iter()
            .map(|&group| group != NO_GROUP)
            .collect();
        for &(source_index, _) in runs {
            wanted[source_index as usize] = true;
        }
        let mut done = Vec::new();
        done.resize_with(entry_points.len(), || None);
        Walks {
            done,
            entry_id_of_file,
            wanted,
        }
    }

    fn run(&mut self, c: &LinkerContext, entry_ids: &AutoBitSet) {
        let mut walks: Vec<Walk> = Vec::new();
        let mut iter = entry_ids.iterator::<true, true>();
        while let Some(entry_id) = iter.next() {
            if self.done[entry_id].is_none() {
                walks.push(Walk {
                    entry_id: entry_id as u32,
                    order: Vec::new(),
                });
            }
        }
        struct Ctx<'a, 'c> {
            c: &'a LinkerContext<'c>,
            entry_id_of_file: &'a [u32],
            wanted: &'a [bool],
        }
        c.worker_pool().each_ptr(
            Ctx {
                c,
                entry_id_of_file: &self.entry_id_of_file,
                wanted: &self.wanted,
            },
            |ctx: &Ctx, walk: *mut Walk, _: usize| {
                // SAFETY: `each_ptr` hands each task a distinct `*mut Walk`.
                unsafe { &mut *walk }.run(ctx.c, ctx.entry_id_of_file, ctx.wanted);
            },
            &mut walks,
        );
        for walk in walks {
            let slot = walk.entry_id as usize;
            self.done[slot] = Some(walk);
        }
    }
}

/// A live part holds more than `import`s, `export`s and function declarations, which are in place before any file runs.
fn initializes_at_load(c: &LinkerContext, source_index: IndexInt) -> bool {
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

/// Per file: it imports its way to another file that imports its way back (Tarjan's algorithm).
fn files_in_import_cycles(c: &LinkerContext) -> Vec<bool> {
    const UNVISITED: u32 = u32::MAX;
    struct Frame {
        source_index: IndexInt,
        /// `edges[first..]` are the imports of the file, `edges[next..]` the ones still to follow.
        first: usize,
        next: usize,
    }

    let files_len = c.graph.files.len();
    let mut in_cycle: Vec<bool> = vec![false; files_len];
    let mut index: Vec<u32> = vec![UNVISITED; files_len];
    let mut low: Vec<u32> = vec![0; files_len];
    let mut in_open_component: Vec<bool> = vec![false; files_len];
    let mut open_components: Vec<IndexInt> = Vec::new();
    let mut edges: Vec<IndexInt> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();

    for &root in c.graph.entry_points.items_source_index() {
        if index[root as usize] != UNVISITED {
            continue;
        }
        let mut entering = Some(root);
        loop {
            if let Some(source_index) = entering.take() {
                index[source_index as usize] = open_components.len() as u32;
                low[source_index as usize] = open_components.len() as u32;
                open_components.push(source_index);
                in_open_component[source_index as usize] = true;
                let first = edges.len();
                let runs = c.graph.files_live.is_set(source_index as usize);
                for_each_edge(c, source_index, runs, |_, edge| match edge {
                    Edge::Import(other) | Edge::LoadNow(other) => edges.push(other),
                    Edge::LoadLater(_) => {}
                });
                stack.push(Frame {
                    source_index,
                    first,
                    next: first,
                });
            }
            let Some(frame) = stack.last_mut() else {
                break;
            };
            let id = frame.source_index as usize;
            if let Some(&other) = edges.get(frame.next) {
                frame.next += 1;
                if index[other as usize] == UNVISITED {
                    entering = Some(other);
                } else if in_open_component[other as usize] {
                    low[id] = low[id].min(index[other as usize]);
                }
                continue;
            }
            edges.truncate(frame.first);
            stack.pop();
            if let Some(parent) = stack.last() {
                let parent = parent.source_index as usize;
                low[parent] = low[parent].min(low[id]);
            }
            if low[id] == index[id] {
                let members = open_components.drain(index[id] as usize..);
                let several = members.len() > 1;
                for member in members {
                    in_open_component[member as usize] = false;
                    in_cycle[member as usize] = several;
                }
            }
        }
    }
    in_cycle
}

/// What loading an entry point evaluates, out of the files asked for, in evaluation order.
struct Walk {
    entry_id: u32,
    order: Vec<IndexInt>,
}

impl Walk {
    fn run(&mut self, c: &LinkerContext, entry_id_of_file: &[u32], wanted: &[bool]) {
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
                    self.order.push(source_index);
                    continue;
                }
                Frame::Enter {
                    source_index,
                    loader,
                } => (source_index, loader),
            };
            if source_index == Index::RUNTIME.value() || seen.is_set(source_index as usize) {
                continue;
            }
            seen.set(source_index as usize);

            let runs = c.graph.files_live.is_set(source_index as usize)
                && entry_bits[source_index as usize].is_set(loader as usize);
            let mark = stack.len();
            for_each_edge(c, source_index, runs, |_, edge| match edge {
                Edge::Import(source_index) => stack.push(Frame::Enter {
                    source_index,
                    loader,
                }),
                Edge::LoadNow(source_index) => stack.push(Frame::Enter {
                    source_index,
                    loader: entry_id_of_file[source_index as usize],
                }),
                Edge::LoadLater(_) => {}
            });
            if runs && wanted[source_index as usize] {
                stack.push(Frame::Leave(source_index));
            }
            stack[mark..].reverse();
        }
    }
}
