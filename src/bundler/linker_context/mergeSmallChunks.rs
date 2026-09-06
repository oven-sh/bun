use crate::mal_prelude::*;
use bun_alloc::Arena;
use bun_ast::{ImportKind, ImportRecordFlags};
use bun_collections::{ArrayHashMap, AutoBitSet, MapEntry};

use crate::linker_context_mod::debug;
use crate::options::Target;
use crate::{EntryPoint, Index, LinkerContext, WrapKind};

bun_core::define_scoped_log!(debug_merge, MergeChunks, hidden);

/// `Part::can_be_removed_if_unused` (`Parser::stmts_can_be_removed_if_unused`)
/// is the parser's tree-shaking verdict, which also says "keep" for statements
/// that do nothing at the top level but must survive for other reasons:
/// `export * from` / `export {} from` (the re-exports are tracked separately),
/// the linker's empty entry-point part, and a text loader's `export default "…"`.
fn part_has_no_side_effects(part: &bun_ast::Part) -> bool {
    use bun_ast::StmtData;
    part.can_be_removed_if_unused
        || part.stmts.slice().iter().all(|stmt| match &stmt.data {
            StmtData::SImport(_)
            | StmtData::SExportStar(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportClause(_)
            | StmtData::SFunction(_)
            | StmtData::SEmpty(_) => true,
            StmtData::SLazyExport(expr) => bun_ast::expr::Tag::is_primitive_literal(expr.tag()),
            _ => false,
        })
}

impl LinkerContext<'_> {
    /// None of the file's live parts run anything at the top level:
    /// declarations only, `"sideEffects": false`, or a lazily initialized
    /// `__esm` / `__commonJS` wrapper. An entry point never qualifies (its
    /// tail runs it), nor does top-level await. A static import of a wrapped
    /// module is printed as a top-level `init_x()` / `require_x()` call in the
    /// importer, and one of an external module loads it (hoisted out of a
    /// wrapper, too); either counts as running something. An import of an
    /// unwrapped bundled file does not: that file is judged on its own.
    pub(crate) fn loading_file_has_no_side_effects(&self, source_index: u32) -> bool {
        self.inits_already_done
            .as_ref()
            .is_some_and(|files| files.is_set(source_index as usize))
            || self.loading_file_side_effects(source_index, None)
    }

    /// `loading_file_has_no_side_effects`, except that a top-level
    /// `init_x()` / `require_x()` of a bundled wrapped module is collected into
    /// `inits` (by source index) instead of counting as a side effect: the
    /// call does nothing where that module is already initialized. A bare
    /// `import "x"` still counts; it is there for the effect.
    pub(crate) fn loading_file_side_effects(
        &self,
        source_index: u32,
        mut inits: Option<&mut Vec<u32>>,
    ) -> bool {
        let flags = self.graph.meta.items_flags();
        if self.graph.files.items_entry_point_kind()[source_index as usize].is_entry_point()
            || flags[source_index as usize].is_async_or_has_async_dependency
        {
            return false;
        }
        // `"sideEffects": false` vouches for the file's own statements, not
        // for what importing a wrapped or external module from it runs.
        let declared_pure = self.file_has_no_side_effects(source_index);
        let wrapped = flags[source_index as usize].wrap != WrapKind::None;
        let records = &self.graph.ast.items_import_records()[source_index as usize];
        let mut import_has_no_side_effects = |record: &bun_ast::ImportRecord| {
            record.flags.contains(ImportRecordFlags::IS_UNUSED)
                || match record.kind {
                    ImportKind::Stmt => {
                        if record.source_index.is_valid() {
                            wrapped
                                || flags[record.source_index.get() as usize].wrap == WrapKind::None
                                || match inits.as_deref_mut() {
                                    Some(inits)
                                        if !record.flags.contains(
                                            ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT,
                                        ) =>
                                    {
                                        inits.push(record.source_index.get());
                                        true
                                    }
                                    _ => false,
                                }
                        } else {
                            record
                                .flags
                                .contains(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS)
                        }
                    }
                    // A top-level `require()` runs the module unless this
                    // file's own wrapper defers it.
                    ImportKind::Require => wrapped,
                    _ => true,
                }
        };
        let parts_live = &self.graph.parts_live[source_index as usize];
        self.graph.ast.items_parts()[source_index as usize]
            .as_slice()
            .iter()
            .enumerate()
            .all(|(part_index, part)| {
                !parts_live.is_set(part_index)
                    || ((wrapped || declared_pure || part_has_no_side_effects(part))
                        && part
                            .import_record_indices
                            .iter()
                            .all(|&i| import_has_no_side_effects(&records[i as usize])))
            })
    }

    /// The bundled wrapped modules an unwrapped file initializes at its top
    /// level (`init_x()` / `require_x()` printed for a live static import).
    pub(crate) fn top_level_inits(&self, source_index: u32, inits: &mut Vec<u32>) {
        let flags = self.graph.meta.items_flags();
        if flags[source_index as usize].wrap != WrapKind::None {
            return;
        }
        let records = &self.graph.ast.items_import_records()[source_index as usize];
        let parts_live = &self.graph.parts_live[source_index as usize];
        for (part_index, part) in self.graph.ast.items_parts()[source_index as usize]
            .as_slice()
            .iter()
            .enumerate()
        {
            if !parts_live.is_set(part_index) {
                continue;
            }
            for &i in part.import_record_indices.iter() {
                let record = &records[i as usize];
                if record.kind == ImportKind::Stmt
                    && !record.flags.contains(ImportRecordFlags::IS_UNUSED)
                    && record.source_index.is_valid()
                    && record.source_index.get() != source_index
                    && flags[record.source_index.get() as usize].wrap != WrapKind::None
                {
                    inits.push(record.source_index.get());
                }
            }
        }
    }
}

/// The files sharing one chunk key (`File.entry_bits`).
struct Group {
    /// Summed source bytes (plus those folded in).
    size: u64,
    /// `None` once two files disagree. An entry chunk keeps its entry's side
    /// (`IS_BROWSER_CHUNK_FROM_SERVER_BUILD`), so a browser-target group must
    /// not fold into a server one.
    target: Option<Target>,
    bits: AutoBitSet,
    /// Entries whose loading implies this group is loaded. Starts as `bits`
    /// and only grows: folding adds the target's entries to everything the
    /// target newly imports. Every static dependency's `loaded` is a superset
    /// of its importer's.
    loaded: AutoBitSet,
    loaded_count: usize,
    /// Rule 2 last considered folding this group in the pass that started at
    /// this tick; nothing that could give it a target has happened since
    /// unless `recheck` is set, an entry of `loaded` has a newer `entry_tick`,
    /// or (`wants_inits`) something was folded at all.
    checked_at: u32,
    recheck: bool,
    wants_inits: bool,
    /// Neither merged nor merged into.
    pinned: bool,
    /// Every live part of every file is side-effect free.
    pure: bool,
    /// Groups holding files that this group's live parts statically import
    /// or depend on, and (rule 2 only) the groups importing this one.
    deps: Vec<usize>,
    importers: Vec<usize>,
    /// Wrapped modules (source indices) the group's side-effect-free files
    /// `init_x()` / `require_x()` at the top level, and the ones any of its
    /// unwrapped files do. Sorted.
    needs_init: Vec<u32>,
    provides_init: Vec<u32>,
    /// Position in a topological order of the live groups' static imports
    /// (importer before imported).
    topo: u32,
    /// `Some(target)` once folded into another group.
    merged_into: Option<usize>,
    /// ... by rule 2, which checked `needs_init` against the target.
    hoisted: bool,
    /// A file of the group, for logs.
    first_source: u32,
}

impl Group {
    fn new(
        target: Target,
        bits: &AutoBitSet,
        pinned: bool,
        first_source: u32,
    ) -> Result<Group, bun_alloc::AllocError> {
        Ok(Group {
            first_source,
            size: 0,
            target: Some(target),
            bits: bits.clone()?,
            loaded: bits.clone()?,
            loaded_count: 0,
            checked_at: 0,
            recheck: false,
            wants_inits: false,
            pinned,
            pure: true,
            deps: Vec::new(),
            importers: Vec::new(),
            needs_init: Vec::new(),
            provides_init: Vec::new(),
            topo: 0,
            merged_into: None,
            hoisted: false,
        })
    }
}

fn merge_sorted<T: Ord + Copy>(into: &mut Vec<T>, from: &[T]) {
    if from.is_empty() {
        return;
    }
    into.extend_from_slice(from);
    into.sort_unstable();
    into.dedup();
}

/// Fold `from` into `into`: `into` inherits the size, dependencies, load
/// conditions and impurity; the files are re-keyed through `resolve` at the
/// end.
fn fold(groups: &mut [Group], from: usize, into: usize) {
    groups[from].merged_into = Some(into);
    let (source, target) = if from < into {
        let (a, b) = groups.split_at_mut(into);
        (&mut a[from], &mut b[0])
    } else {
        let (a, b) = groups.split_at_mut(from);
        (&mut b[0], &mut a[into])
    };
    target.size += source.size;
    target.pure &= source.pure;
    target.loaded.set_union(&source.loaded);
    for (t, s) in [
        (&mut target.deps, &mut source.deps),
        (&mut target.importers, &mut source.importers),
    ] {
        merge_sorted(t, s);
        t.retain(|&g| g != into && g != from);
        s.clear();
    }
    merge_sorted(&mut target.needs_init, &source.needs_init);
    merge_sorted(&mut target.provides_init, &source.provides_init);
}

/// Follow `merged_into` links to the group that now owns the files.
fn resolve(groups: &[Group], mut index: usize) -> usize {
    while let Some(into) = groups[index].merged_into {
        index = into;
    }
    index
}

/// Per-attempt scratch for `collect_newly_loaded`; `visited` is epoch-stamped
/// so each attempt resets it in O(1).
struct Scratch {
    visited: Vec<u64>,
    epoch: u64,
    stack: Vec<usize>,
    /// `candidate` plus the side-effect-free groups the target's extra entries
    /// would start loading.
    newly_loaded: Vec<usize>,
}

impl Scratch {
    fn next_epoch(&mut self) -> u64 {
        self.epoch += 1;
        self.epoch
    }
}

/// `from` statically imports `to`, directly or through other groups. Every
/// edge goes up in `topo`, so nothing past `to` there needs visiting.
fn reaches(groups: &[Group], from: usize, to: usize, scratch: &mut Scratch) -> bool {
    let bound = groups[to].topo;
    if groups[from].topo >= bound {
        return from == to;
    }
    let epoch = scratch.next_epoch();
    scratch.stack.clear();
    scratch.stack.push(from);
    scratch.visited[from] = epoch;
    while let Some(g) = scratch.stack.pop() {
        for &d in &groups[g].deps {
            let d = resolve(groups, d);
            if d == to {
                return true;
            }
            if groups[d].topo < bound && core::mem::replace(&mut scratch.visited[d], epoch) != epoch
            {
                scratch.stack.push(d);
            }
        }
    }
    false
}

/// Every `x` in `needs` (top-level `init_x()` / `require_x()` calls) lives in
/// a chunk other than `merged` whose own top level makes the same call. Code
/// making the call imports `init_x` / `require_x` from that chunk, so the
/// chunk has run to completion first and the call finds `x` initialized.
fn inits_provided(
    groups: &[Group],
    group_of_file: &[usize],
    needs: &[u32],
    merged: [usize; 2],
) -> bool {
    needs.iter().all(|&x| {
        let home = resolve(groups, group_of_file[x as usize]);
        !merged.contains(&home) && groups[home].provides_init.binary_search(&x).is_ok()
    })
}

/// `topo` for every live group: Kahn's algorithm, releasing ties in order of
/// how many entries load the group so a fold target (loaded by a superset)
/// tends to sort after the groups that would start importing it. False if the
/// groups' imports already form a cycle, which `entry_bits` cannot produce (an
/// importer's key is a subset of the imported file's); `reaches` would then
/// prune wrongly, so rule 2 stops.
fn number_topologically(groups: &mut [Group], indegree: &mut Vec<u32>) -> bool {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    indegree.clear();
    indegree.resize(groups.len(), 0);
    for g in 0..groups.len() {
        if groups[g].merged_into.is_some() {
            continue;
        }
        for i in 0..groups[g].deps.len() {
            let d = resolve(groups, groups[g].deps[i]);
            if d != g {
                indegree[d] += 1;
            }
        }
    }
    let mut ready: BinaryHeap<Reverse<(usize, usize)>> = BinaryHeap::new();
    for g in 0..groups.len() {
        if groups[g].merged_into.is_none() && indegree[g] == 0 {
            ready.push(Reverse((groups[g].loaded_count, g)));
        }
    }
    let mut next = 0u32;
    while let Some(Reverse((_, g))) = ready.pop() {
        groups[g].topo = next;
        next += 1;
        for i in 0..groups[g].deps.len() {
            let d = resolve(groups, groups[g].deps[i]);
            if d == g {
                continue;
            }
            indegree[d] -= 1;
            if indegree[d] == 0 {
                ready.push(Reverse((groups[d].loaded_count, d)));
            }
        }
    }
    let acyclic = (0..groups.len()).all(|g| groups[g].merged_into.is_some() || indegree[g] == 0);
    debug_assert!(acyclic, "static import cycle between chunks");
    acyclic
}

/// Walks `candidate`'s dependencies: each must already be loaded wherever
/// `target` is, or be side-effect free itself (the target's extra entries then
/// load it too, which only costs bytes) with dependencies that pass the same
/// test. Fills `scratch.newly_loaded`; false when a dependency with side
/// effects would be loaded earlier.
fn collect_newly_loaded(
    groups: &[Group],
    candidate: usize,
    target: usize,
    scratch: &mut Scratch,
) -> bool {
    let epoch = scratch.next_epoch();
    scratch.visited[candidate] = epoch;
    scratch.visited[target] = epoch;
    scratch.stack.clear();
    scratch
        .stack
        .extend(groups[candidate].deps.iter().map(|&d| resolve(groups, d)));
    scratch.newly_loaded.clear();
    scratch.newly_loaded.push(candidate);
    let target_loaded = &groups[target].loaded;
    while let Some(d) = scratch.stack.pop() {
        if core::mem::replace(&mut scratch.visited[d], epoch) == epoch {
            continue;
        }
        let dep = &groups[d];
        if target_loaded.subset_of(&dep.loaded) {
            continue;
        }
        if !dep.pure {
            return false;
        }
        scratch.newly_loaded.push(d);
        scratch
            .stack
            .extend(dep.deps.iter().map(|&e| resolve(groups, e)));
    }
    true
}

/// Calls `each` with the index of every set bit.
fn for_each_bit(words: &[usize], mut each: impl FnMut(usize)) {
    for (w, &word) in words.iter().enumerate() {
        let mut word = word;
        while word != 0 {
            each(w * usize::BITS as usize + word.trailing_zeros() as usize);
            word &= word - 1;
        }
    }
}

/// What `entry_id` starts loading out of `newly_loaded` (rule 2).
fn bytes_started(groups: &[Group], newly_loaded: &[usize], entry_id: usize) -> u64 {
    newly_loaded
        .iter()
        .map(|&g| &groups[g])
        .filter(|g| !g.loaded.is_set(entry_id))
        .map(|g| g.size)
        .sum()
}

/// Rule 2's byte budgets. `headroom[e]` is what entry `e` may still gain;
/// `levels[k]` holds the entries with at least `2^k` of it left, so "can
/// every entry in this mask afford `n` bytes" is a mask test per word except
/// for the entries whose headroom is within a factor of two of `n`.
struct Budget {
    headroom: Vec<u64>,
    levels: Vec<AutoBitSet>,
}

impl Budget {
    const LEVELS: usize = 48;

    fn new(
        entries: usize,
        initial: impl Fn(usize) -> u64,
    ) -> Result<Budget, bun_alloc::AllocError> {
        let mut levels = Vec::with_capacity(Self::LEVELS);
        for _ in 0..Self::LEVELS {
            levels.push(AutoBitSet::init_empty(entries)?);
        }
        let mut budget = Budget {
            headroom: vec![0; entries],
            levels,
        };
        for entry_id in 0..entries {
            budget.set(entry_id, initial(entry_id));
        }
        Ok(budget)
    }

    fn set(&mut self, entry_id: usize, headroom: u64) {
        self.headroom[entry_id] = headroom;
        for (k, level) in self.levels.iter_mut().enumerate() {
            if headroom >> k != 0 {
                level.set(entry_id);
            } else {
                level.unset(entry_id);
            }
        }
    }

    fn charge(&mut self, entry_id: usize, bytes: u64) {
        self.set(entry_id, self.headroom[entry_id].saturating_sub(bytes));
    }

    /// A superset of the entries with at least `bytes` left (exactly those
    /// with at least `2^floor(log2(bytes))`).
    fn can_afford(&self, bytes: u64) -> &AutoBitSet {
        &self.levels[(bytes.max(1).ilog2() as usize).min(Self::LEVELS - 1)]
    }

    /// Every entry in `mask` has at least `bytes` left.
    fn all_afford(&self, mask: &[usize], bytes: u64) -> bool {
        if bytes == 0 {
            return true;
        }
        // 2^k <= bytes < 2^(k+1): outside level k nobody can pay, inside
        // level k + 1 everybody can; ask the ones in between.
        let k = bytes.ilog2() as usize;
        let (Some(maybe), Some(surely)) = (self.levels.get(k), self.levels.get(k + 1)) else {
            return self.all_afford_each(mask, bytes, |_| bytes);
        };
        let mut between = false;
        for ((&m, &lo), &hi) in mask.iter().zip(maybe.words()).zip(surely.words()) {
            if m & !lo != 0 {
                return false;
            }
            between |= m & !hi != 0;
        }
        !between || self.all_afford_each(mask, bytes, |_| bytes)
    }

    /// Every entry `e` in `mask` has at least `price(e) <= most` left.
    fn all_afford_each(&self, mask: &[usize], most: u64, price: impl Fn(usize) -> u64) -> bool {
        // Everybody inside level floor(log2(most)) + 1 can pay; ask the rest.
        let surely = self
            .levels
            .get(most.max(1).ilog2() as usize + 1)
            .map(|level| level.words());
        mask.iter().enumerate().all(|(w, &m)| {
            let mut word = m & !surely.map_or(0, |s| s[w]);
            while word != 0 {
                let entry_id = w * usize::BITS as usize + word.trailing_zeros() as usize;
                if self.headroom[entry_id] < price(entry_id) {
                    return false;
                }
                word &= word - 1;
            }
            true
        })
    }
}

const UNREACHED: u32 = u32::MAX;

/// Immediate dominator of each node reachable from `root` (Cooper, Harvey &
/// Kennedy, "A Simple, Fast Dominance Algorithm"); `UNREACHED` elsewhere.
fn immediate_dominators<'a>(
    len: usize,
    successors: impl Fn(usize) -> &'a [u32],
    root: usize,
    mut predecessors: impl FnMut(usize, &mut dyn FnMut(usize)),
) -> Vec<u32> {
    let mut postorder: Vec<u32> = vec![UNREACHED; len];
    let mut order: Vec<u32> = Vec::with_capacity(len);
    let mut stack: Vec<(usize, usize)> = vec![(root, 0)];
    postorder[root] = 0;
    while let Some((node, next)) = stack.last_mut() {
        if let Some(&succ) = successors(*node).get(*next) {
            *next += 1;
            if postorder[succ as usize] == UNREACHED {
                postorder[succ as usize] = 0;
                stack.push((succ as usize, 0));
            }
        } else {
            postorder[*node] = order.len() as u32;
            order.push(*node as u32);
            stack.pop();
        }
    }
    let mut idom: Vec<u32> = vec![UNREACHED; len];
    idom[root] = root as u32;
    let mut changed = true;
    while changed {
        changed = false;
        for &node in order.iter().rev().skip(1) {
            let mut new_idom = UNREACHED;
            predecessors(node as usize, &mut |pred| {
                if idom[pred] == UNREACHED {
                    return;
                }
                if new_idom == UNREACHED {
                    new_idom = pred as u32;
                    return;
                }
                let (mut a, mut b) = (pred as u32, new_idom);
                while a != b {
                    while postorder[a as usize] < postorder[b as usize] {
                        a = idom[a as usize];
                    }
                    while postorder[b as usize] < postorder[a as usize] {
                        b = idom[b as usize];
                    }
                }
                new_idom = a;
            });
            if idom[node as usize] != new_idom {
                idom[node as usize] = new_idom;
                changed = true;
            }
        }
    }
    idom
}

/// Folds code-splitting chunks into other chunks where that is unobservable,
/// so fewer modules are loaded at runtime.
///
/// A chunk is keyed by the set of entry points that statically reach its files
/// (`File.entry_bits`). Two rules; the first always runs (it never makes an
/// entry load more code), the second only for chunks smaller than
/// `min_chunk_size` (summed source bytes):
///
/// 1. An `import()` entry point `D` is redundant in a key when, whichever way
///    `D` gets loaded, some other entry in that key has already been loaded
///    (`load_class` below: no importer of `D` can be reached from a process
///    root without passing through the key). Keys that are equal
///    after dropping their redundant entries describe chunks that are always
///    loaded together: with one user entry `main` and a lazy `import("./x")`
///    only reachable from `main`, the `{main, x}` chunk is loaded iff `main`
///    runs, the same as `main`'s own chunk, so its files can live there and
///    `x`'s chunk imports what it needs from the `main` chunk. Different
///    entries may cover different importers: with `import("./cmd")` in both
///    `main` and a lazy `repl`, the `{main, repl, cmd}` chunk loads iff `main`
///    or `repl` does.
/// 2. A chunk whose live parts have no top-level side effects may join a chunk
///    loaded by a superset of its entries, as long as everything it imports is
///    already loaded wherever that target is (or is side-effect free too); the
///    extra entries then carry some unused definitions, but no side effect
///    runs earlier than before. What an entry gains this way is capped
///    relative to what it already loaded. A top-level `require_x()` /
///    `init_x()` (a static import of a wrapped module, e.g. `react`) does not
///    count as a side effect when a chunk the target statically imports makes
///    the same call first, and no fold may close a static import cycle
///    between chunks.
///
/// Runs before `compute_chunks` groups files by `entry_bits`; it rewrites
/// `File.entry_bits` in place so everything downstream (chunk membership,
/// cross-chunk imports) sees the merged layout.
pub(crate) fn merge_small_chunks(
    this: &mut LinkerContext,
    temp: &Arena,
    min_chunk_size: u64,
) -> crate::Result<()> {
    let _trace = bun_core::perf::trace("Bundler.mergeSmallChunks");
    debug_assert!(this.graph.code_splitting);

    let entry_points_len = this.graph.entry_points.len();
    let sources = this.parse_graph().input_files.items_source();
    let entry_source_indices = this.graph.entry_points.items_source_index();
    let kinds = this.graph.files.items_entry_point_kind();
    let fold_pure = min_chunk_size > 0;
    if !fold_pure
        && !entry_source_indices
            .iter()
            .any(|&source_index| kinds[source_index as usize] == EntryPoint::Kind::DynamicImport)
    {
        return Ok(());
    }
    let css_asts = this.graph.ast.items_css();
    let ast_targets = this.graph.ast.items_target();
    let import_records = this.graph.ast.items_import_records();
    let parts = this.graph.ast.items_parts();
    let flags = this.graph.meta.items_flags();
    let file_entry_bits = this.graph.files.items_entry_bits();
    let files_len = this.graph.files.len();

    let entry_id_by_source: &mut [u32] = temp.alloc_slice_fill_copy(files_len, u32::MAX);
    for (entry_id, &source_index) in entry_source_indices.iter().enumerate() {
        let slot = &mut entry_id_by_source[source_index as usize];
        if *slot == u32::MAX {
            *slot = entry_id as u32;
        }
    }
    let is_dynamic_entry = |entry_id: usize| {
        kinds[entry_source_indices[entry_id] as usize] == EntryPoint::Kind::DynamicImport
    };
    let is_live_js = |source_index: u32| {
        this.graph.files_live.is_set(source_index as usize)
            && css_asts[source_index as usize].is_none()
    };

    // Which entries statically contain a live `import()` of each dynamic entry.
    let mut importer_bits: Vec<AutoBitSet> = Vec::with_capacity(entry_points_len);
    for _ in 0..entry_points_len {
        importer_bits.push(AutoBitSet::init_empty(entry_points_len)?);
    }
    // Dynamic entries some live split `require()` loads. The call
    // runs while its importer is still evaluating, so no importer is
    // guaranteed to precede the target; folding shared code into the
    // importer's chunk could place it after the call site.
    let mut required_sync = AutoBitSet::init_empty(entry_points_len)?;
    for source_index in this.graph.reachable_files.iter() {
        let source_index = source_index.get();
        if !is_live_js(source_index) {
            continue;
        }
        let records = &import_records[source_index as usize];
        let parts_live = &this.graph.parts_live[source_index as usize];
        for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }
            for &record_index in part.import_record_indices.iter() {
                let record = &records[record_index as usize];
                if !record.source_index.is_valid()
                    || !this.is_external_dynamic_import(record, source_index)
                {
                    continue;
                }
                let target_entry = entry_id_by_source[record.source_index.get() as usize];
                if target_entry == u32::MAX {
                    continue;
                }
                if record
                    .flags
                    .contains(ImportRecordFlags::CROSS_CHUNK_REQUIRE)
                {
                    required_sync.set(target_entry as usize);
                } else {
                    importer_bits[target_entry as usize]
                        .set_union(&file_entry_bits[source_index as usize]);
                }
            }
        }
    }
    // A self-`import()` cannot be the load that comes first.
    for (entry_id, importers) in importer_bits.iter_mut().enumerate() {
        importers.unset(entry_id);
    }

    // An entry whose chunk (or a chunk it imports) uses top-level await can
    // still be mid-evaluation when an `import()` it started links, so it
    // guarantees nothing: a chunk that `import()` target then imported from
    // it would wait on it forever.
    let mut awaits = AutoBitSet::init_empty(entry_points_len)?;
    for source_index in this.graph.reachable_files.iter() {
        let source_index = source_index.get();
        if is_live_js(source_index) && flags[source_index as usize].is_async_or_has_async_dependency
        {
            awaits.set_union(&file_entry_bits[source_index as usize]);
        }
    }

    // A dynamic entry can stand in for its importers when some live code
    // `import()`s it, nothing `require()`s it, and no importer is mid-evaluation
    // at a top-level await while it loads. Every other entry is a root: it may
    // be the first thing loaded (a user entry), or nothing says what precedes it.
    let mut guaranteed = AutoBitSet::init_empty(entry_points_len)?;
    for entry_id in 0..entry_points_len {
        if is_dynamic_entry(entry_id)
            && !required_sync.is_set(entry_id)
            && importer_bits[entry_id].find_first_set().is_some()
            && !importer_bits[entry_id].has_intersection(&awaits)
        {
            guaranteed.set(entry_id);
        }
    }
    // The `import()` graph over entries as CSR (`successors_of(n)` =
    // `edges[offsets[n]..offsets[n + 1]]`): a virtual root precedes every
    // root, and each importer precedes the guaranteed entries it `import()`s.
    let vroot = entry_points_len;
    let offsets: &mut [u32] = temp.alloc_slice_fill_copy(entry_points_len + 3, 0u32);
    for entry_id in 0..entry_points_len {
        if !guaranteed.is_set(entry_id) {
            offsets[vroot + 2] += 1;
            continue;
        }
        let mut iter = importer_bits[entry_id].iterator::<true, true>();
        while let Some(importer) = iter.next() {
            offsets[importer + 2] += 1;
        }
    }
    for i in 2..offsets.len() {
        offsets[i] += offsets[i - 1];
    }
    let edges: &mut [u32] = temp.alloc_slice_fill_copy(offsets[offsets.len() - 1] as usize, 0u32);
    for entry_id in 0..entry_points_len {
        if !guaranteed.is_set(entry_id) {
            edges[offsets[vroot + 1] as usize] = entry_id as u32;
            offsets[vroot + 1] += 1;
            continue;
        }
        let mut iter = importer_bits[entry_id].iterator::<true, true>();
        while let Some(importer) = iter.next() {
            edges[offsets[importer + 1] as usize] = entry_id as u32;
            offsets[importer + 1] += 1;
        }
    }
    let successors = |node: usize| &edges[offsets[node] as usize..offsets[node + 1] as usize];
    let idom = immediate_dominators(
        entry_points_len + 1,
        successors,
        vroot,
        |entry_id, each: &mut dyn FnMut(usize)| {
            if guaranteed.is_set(entry_id) {
                let mut iter = importer_bits[entry_id].iterator::<true, true>();
                while let Some(importer) = iter.next() {
                    each(importer);
                }
            } else {
                each(vroot);
            }
        },
    );

    // `load_class(key)`: `key` minus each guaranteed entry none of whose
    // importers a root reaches through `import()`s without passing through the
    // key; such an importer ran after some entry of the key, so that entry's
    // chunk was loaded first. (An importer cycle no root reaches never loads,
    // so it does not count either.) A key whose every entry is redundant is
    // never loaded and left alone.
    let mut seen: Vec<u32> = vec![0; entry_points_len];
    let mut epoch: u32 = 0;
    let mut worklist: Vec<usize> = Vec::new();
    let mut load_class = |key: &AutoBitSet| -> crate::Result<AutoBitSet> {
        let mut class = key.clone()?;
        let mut dropped = false;
        let mut candidates = key.iterator::<true, true>();
        while let Some(entry_id) = candidates.next() {
            if !guaranteed.is_set(entry_id) {
                continue;
            }
            // Fast path: a key entry dominates `entry_id`, or nothing loads it.
            let mut up = idom[entry_id];
            let mut preceded = up == UNREACHED;
            while !preceded && up as usize != vroot {
                if key.is_set(up as usize) {
                    preceded = true;
                } else {
                    up = idom[up as usize];
                }
            }
            if !preceded {
                // Walk importers backward, stopping at the key; a root reached
                // this way loads `entry_id` before anything in the key.
                preceded = true;
                epoch += 1;
                worklist.clear();
                worklist.push(entry_id);
                'walk: while let Some(below) = worklist.pop() {
                    let mut iter = importer_bits[below].iterator::<true, true>();
                    while let Some(importer) = iter.next() {
                        if key.is_set(importer)
                            || seen[importer] == epoch
                            || idom[importer] == UNREACHED
                        {
                            continue;
                        }
                        if !guaranteed.is_set(importer) {
                            preceded = false;
                            break 'walk;
                        }
                        seen[importer] = epoch;
                        worklist.push(importer);
                    }
                }
            }
            if preceded {
                class.unset(entry_id);
                dropped = true;
            }
        }
        if dropped && class.find_first_set().is_none() {
            return Ok(key.clone()?);
        }
        Ok(class)
    };

    // Group the live JS files by their chunk key, and the groups by their
    // load-condition class (the key with redundant dynamic entries removed).
    //
    // An entry point's own chunk neither folds nor absorbs a fold when the
    // entry point has exports: absorbing one adds the bindings other chunks
    // need to its module namespace (Rollup's `preserveEntrySignatures:
    // "exports-only"`). Chunks loaded together with it still fold into each
    // other. `--compile` leaves the chunks of user entry points alone too.
    let export_aliases = this.graph.meta.items_sorted_and_filtered_export_aliases();
    let pin_entry_chunk = |entry_id: usize| {
        let source_index = entry_source_indices[entry_id] as usize;
        (this.options.compile_mode.is_executable() && !is_dynamic_entry(entry_id))
            || flags[source_index].wrap == WrapKind::Cjs
            || flags[source_index].needs_synthetic_default_export
            || !export_aliases[source_index].is_empty()
    };
    let group_of_file: &mut [usize] = temp.alloc_slice_fill_copy(files_len, usize::MAX);
    let mut inits: Vec<u32> = Vec::new();
    let mut files_with_inits = AutoBitSet::init_empty(files_len)?;
    let mut groups: ArrayHashMap<&[u8], Group> = ArrayHashMap::new();
    let mut classes: ArrayHashMap<&[u8], (AutoBitSet, Vec<usize>)> = ArrayHashMap::new();
    for source_index in this.graph.reachable_files.iter() {
        let source_index = source_index.get();
        if !is_live_js(source_index) {
            continue;
        }
        let bits = &file_entry_bits[source_index as usize];
        let target = ast_targets[source_index as usize];
        // Only the runtime helpers a chunk uses are emitted, so its source
        // size says nothing about the chunk's; count it as free.
        let size = if source_index == Index::RUNTIME.value() {
            0
        } else {
            sources[source_index as usize].contents().len() as u64
        };
        // Loading a file earlier than before is only unobservable when none
        // of its live parts run anything at the top level.
        let wrapped = flags[source_index as usize].wrap != WrapKind::None;
        inits.clear();
        let pure = fold_pure && this.loading_file_side_effects(source_index, Some(&mut inits));
        if fold_pure && !pure {
            inits.clear();
            this.top_level_inits(source_index, &mut inits);
            debug_merge!(
                "not side-effect free: {}{}",
                bstr::BStr::new(sources[source_index as usize].path.text),
                if wrapped {
                    " (wrapped entry point)"
                } else {
                    ""
                },
            );
        }
        inits.sort_unstable();
        inits.dedup();
        let entry = groups.entry(temp.alloc_slice_copy(bits.bytes(entry_points_len)));
        let group_index = match &entry {
            MapEntry::Occupied(entry) => entry.index(),
            MapEntry::Vacant(entry) => entry.index(),
        };
        group_of_file[source_index as usize] = group_index;
        let group = match entry {
            MapEntry::Occupied(entry) => entry.into_mut(),
            MapEntry::Vacant(entry) => {
                let class = load_class(bits)?;
                match classes.entry(temp.alloc_slice_copy(class.bytes(entry_points_len))) {
                    MapEntry::Occupied(e) => e.into_mut().1.push(group_index),
                    MapEntry::Vacant(e) => {
                        e.insert((class, vec![group_index]));
                    }
                }
                let pinned = bits.count() == 1
                    && pin_entry_chunk(bits.find_first_set().expect("one bit set"));
                entry.insert(Group::new(target, bits, pinned, source_index)?)
            }
        };
        group.size += size;
        group.pure &= pure;
        if group.target != Some(target) {
            group.target = None;
        }
        if pure && !inits.is_empty() {
            merge_sorted(&mut group.needs_init, &inits);
            files_with_inits.set(source_index as usize);
        }
        if !wrapped {
            merge_sorted(&mut group.provides_init, &inits);
        }
    }

    // An entry point's JS chunk exists even when no file is keyed by exactly
    // its bit (its own file is also reached from an `import()` target that
    // imports back from it); give its class that chunk to fold into.
    for class_index in 0..classes.count() {
        let key = classes.keys()[class_index];
        let class = &classes.values()[class_index].0;
        if class.count() != 1 || groups.contains(&key) {
            continue;
        }
        let entry_id = class.find_first_set().expect("one bit set");
        let source_index = entry_source_indices[entry_id];
        if !is_live_js(source_index) {
            continue;
        }
        let mut group = Group::new(
            ast_targets[source_index as usize],
            class,
            pin_entry_chunk(entry_id),
            source_index,
        )?;
        group.pure = false;
        classes.values_mut()[class_index].1.push(groups.count());
        groups.put(key, group)?;
    }

    // Static dependencies between groups, along the edges that assigned
    // `File.entry_bits` (so a dependency's key is a superset of its
    // importer's) and symbol dependencies. Only rule 2 consults them.
    for (source_index, &group_index) in group_of_file.iter().enumerate() {
        if !fold_pure {
            break;
        }
        if group_index == usize::MAX {
            continue;
        }
        let parts_live = &this.graph.parts_live[source_index];
        let deps = &mut groups.values_mut()[group_index].deps;
        for (part_index, part) in parts[source_index].as_slice().iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }
            for &record_index in part.import_record_indices.iter() {
                let record = &import_records[source_index][record_index as usize];
                if let Some(other) = this.file_loaded_by_import(record, source_index as u32) {
                    deps.push(group_of_file[other as usize]);
                }
            }
            for dependency in part.dependencies.iter() {
                deps.push(group_of_file[dependency.source_index.get() as usize]);
            }
        }
    }
    // An entry point's chunk also imports every binding the entry re-exports
    // (`compute_cross_chunk_dependencies`).
    if fold_pure {
        let resolved_exports = this.graph.meta.items_resolved_exports();
        for &source_index in entry_source_indices.iter() {
            let group_index = group_of_file[source_index as usize];
            if group_index == usize::MAX || flags[source_index as usize].wrap == WrapKind::Cjs {
                continue;
            }
            let deps = &mut groups.values_mut()[group_index].deps;
            for alias in export_aliases[source_index as usize].iter() {
                if let Some(export) = resolved_exports[source_index as usize].get(alias)
                    && export.data.source_index.is_valid()
                {
                    deps.push(group_of_file[export.data.source_index.get() as usize]);
                }
            }
        }
    }
    for (group_index, group) in groups.values_mut().iter_mut().enumerate() {
        group.deps.sort_unstable();
        group.deps.dedup();
        group.deps.retain(|&d| d != usize::MAX && d != group_index);
    }

    // Rule 1: groups loaded under identical conditions fold into the class's
    // parent — the group keyed by exactly the reduced key (e.g. an entry
    // point's own chunk) if there is one, else the largest member. Ties break
    // on the key for determinism. A member folded into the largest-member
    // parent loses bits its files had; it still runs before they do because
    // an entry that remains in the key precedes them and imports every chunk
    // with side effects carrying its bit (`compute_cross_chunk_dependencies`).
    let mut folded_same = 0usize;
    for (class_key, (_, members)) in classes.keys().iter().zip(classes.values()) {
        let unpinned = || {
            members
                .iter()
                .copied()
                .filter(|&i| !groups.values()[i].pinned)
        };
        let Some(target_index) = unpinned().max_by(|&a, &b| {
            (groups.keys()[a] == *class_key)
                .cmp(&(groups.keys()[b] == *class_key))
                .then_with(|| groups.values()[a].size.cmp(&groups.values()[b].size))
                .then_with(|| groups.keys()[b].cmp(groups.keys()[a]))
        }) else {
            continue;
        };
        let Some(target_platform) = groups.values()[target_index].target else {
            continue;
        };
        for &member in members {
            let group = &groups.values()[member];
            if member == target_index || group.pinned || group.target != Some(target_platform) {
                continue;
            }
            fold(groups.values_mut(), member, target_index);
            folded_same += 1;
        }
    }
    if !fold_pure {
        rekey_files(this, group_of_file, groups.values())?;
        debug!(
            "mergeSmallChunks: {} chunks folded into chunks with the same load conditions",
            folded_same
        );
        return Ok(());
    }

    // An `import()` entry every load path of which passes through entry `e`
    // (its dominators) is loaded only once `e`'s chunks are.
    let group_count = groups.count();
    {
        let mut dominated: Vec<AutoBitSet> = Vec::with_capacity(entry_points_len);
        for _ in 0..entry_points_len {
            dominated.push(AutoBitSet::init_empty(entry_points_len)?);
        }
        for entry_id in 0..entry_points_len {
            let mut up = idom[entry_id];
            while up != UNREACHED && up as usize != vroot {
                dominated[up as usize].set(entry_id);
                up = idom[up as usize];
            }
        }
        for group in groups.values_mut() {
            if group.merged_into.is_some() {
                continue;
            }
            let mut iter = group.bits.iterator::<true, true>();
            while let Some(entry_id) = iter.next() {
                group.loaded.set_union(&dominated[entry_id]);
            }
        }
    }

    // A parent's extra entries now reach everything the folded members
    // imported; propagate so every dependency's `loaded` covers its
    // importer's.
    loop {
        let mut changed = false;
        for group_index in 0..group_count {
            if groups.values()[group_index].merged_into.is_some() {
                continue;
            }
            for dep_index in 0..groups.values()[group_index].deps.len() {
                let dep = resolve(
                    groups.values(),
                    groups.values()[group_index].deps[dep_index],
                );
                if dep == group_index
                    || groups.values()[group_index]
                        .loaded
                        .subset_of(&groups.values()[dep].loaded)
                {
                    continue;
                }
                let loaded = groups.values()[group_index].loaded.clone()?;
                groups.values_mut()[dep].loaded.set_union(&loaded);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    // Rule 2 (see the doc comment). Targets with the fewest extra entries are
    // preferred, then the largest. The bytes an entry gains are capped at a
    // small fraction of what it loaded to begin with, so a lean entry point
    // (a CLI's `--version` fast path) cannot end up carrying a lazily loaded
    // subsystem, and a big one does not trade the module records it saves
    // for noticeably more code to parse.
    const EXTRA_LOAD_DIVISOR: u64 = 64;
    let mut folded_pure = 0usize;
    let groups = groups.values_mut();
    for g in 0..group_count {
        if groups[g].merged_into.is_some() {
            continue;
        }
        for i in 0..groups[g].deps.len() {
            let d = resolve(groups, groups[g].deps[i]);
            if d != g {
                groups[d].importers.push(g);
            }
        }
    }
    for group in groups.iter_mut() {
        group.importers.sort_unstable();
        group.importers.dedup();
    }
    let mut load_size: Vec<u64> = vec![0; entry_points_len];
    for group in groups.iter() {
        if group.merged_into.is_some() {
            continue;
        }
        let mut iter = group.loaded.iterator::<true, true>();
        while let Some(entry_id) = iter.next() {
            load_size[entry_id] += group.size;
        }
    }
    // What each entry may still gain, and, per power of two, the entries with
    // at least that much left: a fold charges every entry in
    // `target.loaded & !candidate.loaded`, so most verdicts are word-wide
    // mask tests, with exact arithmetic only for entries within a factor of
    // two of the price.
    let mut budget = Budget::new(entry_points_len, |entry_id| {
        load_size[entry_id] / EXTRA_LOAD_DIVISOR
    })?;
    let words = budget.levels[0].words().len();
    let mut payers: Vec<usize> = vec![0; words];
    // Groups loaded by each entry: a target must be loaded by every entry of
    // the candidate, so scanning the candidate's rarest entry's list suffices.
    let mut groups_by_entry: Vec<Vec<usize>> = vec![Vec::new(); entry_points_len];
    let mut scratch = Scratch {
        visited: vec![0; group_count],
        epoch: 0,
        stack: Vec::new(),
        newly_loaded: Vec::new(),
    };
    let mut indegree: Vec<u32> = Vec::new();
    let mut by_preference: Vec<(u32, core::cmp::Reverse<u64>, usize)> =
        Vec::with_capacity(group_count);
    // See `Group::checked_at`.
    let mut tick = 1u32;
    let mut entry_tick: Vec<u32> = vec![0; entry_points_len];
    let mut fold_tick = 0u32;
    let mut passes = 0usize;
    loop {
        passes += 1;
        let pass_tick = tick;
        // Sizes and load conditions change as groups absorb others; rebuild
        // the lists in preference order once per pass so the first target
        // that passes every check wins.
        for list in groups_by_entry.iter_mut() {
            list.clear();
        }
        by_preference.clear();
        for (group_index, group) in groups.iter_mut().enumerate() {
            if group.merged_into.is_none() {
                group.loaded_count = group.loaded.count();
                by_preference.push((
                    group.loaded_count as u32,
                    core::cmp::Reverse(group.size),
                    group_index,
                ));
            }
        }
        by_preference.sort_unstable();
        for &(_, _, group_index) in &by_preference {
            for_each_bit(groups[group_index].loaded.words(), |entry_id| {
                groups_by_entry[entry_id].push(group_index)
            });
        }
        if !number_topologically(groups, &mut indegree) {
            break;
        }
        let max_headroom = budget.headroom.iter().copied().max().unwrap_or(0);
        let mut progressed = false;
        for candidate in 0..group_count {
            let c = &groups[candidate];
            if c.merged_into.is_some()
                || c.pinned
                || !c.pure
                || c.size >= min_chunk_size
                || c.size > max_headroom
                || c.target.is_none()
            {
                continue;
            }
            // A target appears only when a superset of `loaded` starts being
            // loaded by an entry of it, an importer's dependency moved, or new
            // initializers landed somewhere; budgets and cycles only get worse.
            if c.checked_at != 0 && !c.recheck && !(c.wants_inits && fold_tick >= c.checked_at) {
                let mut newest = 0;
                for_each_bit(c.loaded.words(), |entry_id| {
                    newest = newest.max(entry_tick[entry_id])
                });
                if newest < c.checked_at {
                    continue;
                }
            }
            let c = &mut groups[candidate];
            c.checked_at = pass_tick;
            c.recheck = false;
            c.wants_inits = false;
            let c = &groups[candidate];
            let mut rarest: Option<usize> = None;
            let mut iter = c.loaded.iterator::<true, true>();
            while let Some(entry_id) = iter.next() {
                if rarest.is_none_or(|r| groups_by_entry[entry_id].len() < groups_by_entry[r].len())
                {
                    rarest = Some(entry_id);
                }
            }
            let Some(rarest) = rarest else {
                continue;
            };
            // A target's `loaded` holds all of the candidate's entries and
            // otherwise only ones that can afford the candidate, which bounds
            // its size on both sides; the list is sorted by that size.
            let list = &groups_by_entry[rarest];
            let first = list.partition_point(|&g| groups[g].loaded_count < c.loaded_count);
            let mut most = if c.size == 0 { entry_points_len } else { 0 };
            for (&can, &l) in budget
                .can_afford(c.size)
                .words()
                .iter()
                .zip(c.loaded.words())
            {
                most += (can | l).count_ones() as usize;
            }
            let last = first + list[first..].partition_point(|&g| groups[g].loaded_count <= most);
            let mut chosen = None;
            for ti in first..last {
                let target = groups_by_entry[rarest][ti];
                let (c, t) = (&groups[candidate], &groups[target]);
                if target == candidate
                    || t.merged_into.is_some()
                    || t.pinned
                    || t.target != c.target
                    || !c.loaded.subset_of(&t.loaded)
                {
                    continue;
                }
                for ((p, &t), &c) in payers
                    .iter_mut()
                    .zip(t.loaded.words())
                    .zip(c.loaded.words())
                {
                    *p = t & !c;
                }
                if !budget.all_afford(&payers, c.size) {
                    continue;
                }
                // The candidate's importers will import the target and the
                // target will import what the candidate did; neither may close
                // a static import cycle (cross-chunk bindings are plain `var`s,
                // read before assignment in a cycle).
                if reaches(groups, target, candidate, &mut scratch)
                    || (0..groups[candidate].deps.len()).any(|i| {
                        let d = resolve(groups, groups[candidate].deps[i]);
                        d != target && d != candidate && reaches(groups, d, target, &mut scratch)
                    })
                {
                    debug_merge!(
                        "would cycle: {} -> {}",
                        bstr::BStr::new(
                            sources[groups[candidate].first_source as usize].path.pretty
                        ),
                        bstr::BStr::new(sources[groups[target].first_source as usize].path.pretty),
                    );
                    continue;
                }
                if !collect_newly_loaded(groups, candidate, target, &mut scratch) {
                    continue;
                }
                if scratch.newly_loaded.len() > 1 {
                    let most: u64 = scratch.newly_loaded.iter().map(|&g| groups[g].size).sum();
                    if !budget.all_afford_each(&payers, most, |entry_id| {
                        bytes_started(groups, &scratch.newly_loaded, entry_id)
                    }) {
                        continue;
                    }
                }
                // A wrapped module the moved code initializes at the top level
                // must already be initialized by then (`inits_provided`); the
                // order of files inside one chunk guarantees nothing, so that
                // module may not end up in the merged chunk, whichever side
                // brings it. The same goes for a side-effect-free dependency more
                // entries start loading.
                let inits_covered = inits_provided(
                    groups,
                    group_of_file,
                    &groups[candidate].needs_init,
                    [target, candidate],
                ) && inits_provided(
                    groups,
                    group_of_file,
                    &groups[target].needs_init,
                    [candidate; 2],
                ) && scratch.newly_loaded[1..]
                    .iter()
                    .all(|&g| inits_provided(groups, group_of_file, &groups[g].needs_init, [g; 2]));
                if !inits_covered {
                    groups[candidate].wants_inits = true;
                    debug_merge!(
                        "would initialize a wrapped module early: {} -> {}",
                        bstr::BStr::new(
                            sources[groups[candidate].first_source as usize].path.pretty
                        ),
                        bstr::BStr::new(sources[groups[target].first_source as usize].path.pretty),
                    );
                    continue;
                }
                for_each_bit(&payers, |entry_id| {
                    budget.charge(
                        entry_id,
                        bytes_started(groups, &scratch.newly_loaded, entry_id),
                    )
                });
                chosen = Some(target);
                break;
            }
            let Some(target) = chosen else {
                continue;
            };
            tick += 1;
            fold_tick = tick;
            let target_loaded = groups[target].loaded.clone()?;
            // Whatever imports a group that changed here, directly or not, may
            // price differently now.
            let epoch = scratch.next_epoch();
            scratch.stack.clear();
            scratch.stack.push(candidate);
            scratch.visited[candidate] = epoch;
            for &g in &scratch.newly_loaded[1..] {
                for ((&t, &had), ticks) in target_loaded
                    .words()
                    .iter()
                    .zip(groups[g].loaded.words())
                    .zip(entry_tick.chunks_mut(usize::BITS as usize))
                {
                    let mut gained = t & !had;
                    while gained != 0 {
                        ticks[gained.trailing_zeros() as usize] = tick;
                        gained &= gained - 1;
                    }
                }
                groups[g].loaded.set_union(&target_loaded);
                scratch.stack.push(g);
                scratch.visited[g] = epoch;
            }
            while let Some(g) = scratch.stack.pop() {
                for i in 0..groups[g].importers.len() {
                    let importer = resolve(groups, groups[g].importers[i]);
                    if core::mem::replace(&mut scratch.visited[importer], epoch) != epoch {
                        groups[importer].recheck = true;
                        scratch.stack.push(importer);
                    }
                }
            }
            // Keep a shared chunk's `bits` covering every entry that
            // statically reaches its files (route manifests read
            // `File.entry_bits` directly). A single bit is an entry
            // point's own chunk, which must stay keyed by that bit; only
            // `import()` entries it precedes can be missing there.
            if groups[target].bits.count() > 1 {
                let candidate_bits = groups[candidate].bits.clone()?;
                groups[target].bits.set_union(&candidate_bits);
            }
            // Keep `topo` an order of the import graph: the target takes over
            // the candidate's edges, which is only certainly fine where it
            // sat between the candidate's importers and dependencies already.
            let topo = groups[target].topo;
            let out_of_order = |list: &[usize], before: bool| {
                list.iter()
                    .map(|&g| resolve(groups, g))
                    .any(|g| g != target && g != candidate && (groups[g].topo < topo) != before)
            };
            let renumber = out_of_order(&groups[candidate].importers, true)
                || out_of_order(&groups[candidate].deps, false);
            fold(groups, candidate, target);
            groups[candidate].hoisted = true;
            folded_pure += 1;
            progressed = true;
            if renumber && !number_topologically(groups, &mut indegree) {
                progressed = false;
                break;
            }
        }
        if !progressed {
            break;
        }
    }
    // The `init_x()` / `require_x()` calls of a file rule 2 moved were shown
    // to repeat ones the destination chunk's imports make first, so they no
    // longer say anything about where that chunk must be imported
    // (`find_imported_parts_in_js_order`, `inert_chunks`).
    if folded_pure > 0 {
        let mut done = AutoBitSet::init_empty(files_len)?;
        let mut iter = files_with_inits.iterator::<true, true>();
        while let Some(source_index) = iter.next() {
            let mut group = group_of_file[source_index];
            while let Some(into) = groups[group].merged_into {
                if groups[group].hoisted {
                    done.set(source_index);
                    break;
                }
                group = into;
            }
        }
        this.inits_already_done = Some(done);
    }

    rekey_files(this, group_of_file, groups)?;
    debug!(
        "mergeSmallChunks: {} chunks folded into chunks with the same load conditions, {} side-effect-free chunks folded into a superset in {} passes (min size {} bytes)",
        folded_same, folded_pure, passes, min_chunk_size
    );
    Ok(())
}

fn rekey_files(
    this: &mut LinkerContext,
    group_of_file: &[usize],
    groups: &[Group],
) -> crate::Result<()> {
    let file_entry_bits = this.graph.files.items_entry_bits_mut();
    for (source_index, &group_index) in group_of_file.iter().enumerate() {
        if group_index == usize::MAX {
            continue;
        }
        let bits = &groups[resolve(groups, group_index)].bits;
        if !file_entry_bits[source_index].eql(bits) {
            file_entry_bits[source_index] = bits.clone()?;
        }
    }
    Ok(())
}
