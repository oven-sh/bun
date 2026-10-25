mod commonjs;
mod entries;
#[cfg(test)]
mod tests;

pub(super) use entries::collect_export_entries;

use self::commonjs::{CommonJsNames, resolve_commonjs_names};
use super::ModuleRef;
use super::bindings::{ExportBinding, ModuleExport, RequiredName};
use super::commonjs_exports::{CommonJsImport, CommonJsTexts};
use super::compare_code_units;
use super::failures::{FailureOrder, ModuleFailureKind, PendingFailure};
use super::interop::{ImportPhase, ModuleKind};
use super::module_set::ModuleSet;
use super::requests::{ScannedSite, Scans, phase_towards};
use super::synthetic_exports::SyntheticExports;
use crate::builtins::{RuntimeModule, table};
use bun_sema::atom::{Atom, known};
use bun_sema::components::strongly_connected_components;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use core::ops::Range;
use entries::{CollectedEntries, ExportEntries, ExportEntry, WrittenImport};
use std::collections::hash_map::Entry;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Resolution {
    Variable(Sym),
    Namespace {
        module: ModuleRef,
        phase: ImportPhase,
    },
    RuntimeMember {
        module: RuntimeModule,
        name: Atom,
    },
    Synthetic {
        module: ModuleRef,
        name: Atom,
    },
    LiveName {
        module: ModuleRef,
        name: Atom,
    },
    DynamicStar {
        module: FileId,
        name: Atom,
    },
    Unloadable {
        importer: FileId,
        site: u32,
    },
    NotFound,
    Ambiguous,
}

impl Resolution {
    fn is_binding(self) -> bool {
        !matches!(
            self,
            Resolution::DynamicStar { .. }
                | Resolution::Unloadable { .. }
                | Resolution::NotFound
                | Resolution::Ambiguous
        )
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct ResolvedName {
    pub resolution: Resolution,
    pub required_name: Option<RequiredName>,
}

impl ResolvedName {
    fn new(resolution: Resolution) -> ResolvedName {
        let required_name = match resolution {
            Resolution::DynamicStar { module, name } => {
                Some(RequiredName::new(ModuleRef::File(module), name))
            }
            Resolution::LiveName { module, name } => Some(RequiredName::new(module, name)),
            _ => None,
        };
        ResolvedName {
            resolution,
            required_name,
        }
    }

    fn can_be_ambiguous(self) -> bool {
        let existence_check = ResolvedName::new(self.resolution).required_name;
        self.required_name != existence_check
    }
}

type NodeKey = (FileId, Atom);

fn captured_resolution(modules: &ModuleSet, module: ModuleRef, name: Atom) -> Resolution {
    match module {
        // Its export table belongs to the project of Bun's own modules, so the name is looked up when the modules are linked.
        ModuleRef::Runtime(runtime_module) if table::is_es_module(runtime_module) => {
            Resolution::LiveName { module, name }
        }
        ModuleRef::Runtime(module) => Resolution::RuntimeMember { module, name },
        ModuleRef::File(_) | ModuleRef::External { .. } if modules.is_uncompiled_code(module) => {
            Resolution::LiveName { module, name }
        }
        ModuleRef::File(_) | ModuleRef::Inner { .. } | ModuleRef::External { .. } => {
            Resolution::Synthetic { module, name }
        }
        // It shows the names of the file.
        ModuleRef::Face(file) => Resolution::Synthetic {
            module: ModuleRef::File(file),
            name,
        },
        ModuleRef::Check(_) => Resolution::NotFound,
    }
}

// `bun run` turns `import * as ns from "bun"` into a variable that holds `Bun`, which is the default export of the module.
fn imported_namespace_resolution(module: ModuleRef, phase: ImportPhase) -> Resolution {
    match module {
        ModuleRef::Runtime(module) if table::object_replacing_namespace(module).is_some() => {
            Resolution::RuntimeMember {
                module,
                name: known::default,
            }
        }
        _ => Resolution::Namespace { module, phase },
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Identity {
    Same,
    Different,
    Unknown,
}

fn compare_module_identity(a: ModuleRef, b: ModuleRef) -> Identity {
    use ModuleRef::{Check, External, Face, File, Inner, Runtime};
    match (a, b) {
        _ if a == b => Identity::Same,
        (External { specifier: a, .. }, External { specifier: b, .. }) if a == b => {
            Identity::Unknown
        }
        (File(_) | Inner { .. } | Face(_) | Check(_) | Runtime(_) | External { .. }, _) => {
            Identity::Different
        }
    }
}

fn compare_bindings(a: Resolution, b: Resolution) -> Identity {
    use Resolution::{LiveName, Namespace, Synthetic};
    match (a, b) {
        (LiveName { .. }, other) | (other, LiveName { .. }) if a != b && other.is_binding() => {
            Identity::Unknown
        }
        (
            Synthetic {
                module: a_module,
                name: a_name,
            },
            Synthetic {
                module: b_module,
                name: b_name,
            },
        ) if a_name == b_name => compare_module_identity(a_module, b_module),
        // `import * as ns from "m"; export { ns }` is `export * as ns from "m"`, whichever module writes it.
        (
            Namespace {
                module: a_module,
                phase: a_phase,
            },
            Namespace {
                module: b_module,
                phase: b_phase,
            },
        ) if a_phase == b_phase => compare_module_identity(a_module, b_module),
        (
            Resolution::Variable(_)
            | Namespace { .. }
            | Resolution::RuntimeMember { .. }
            | Synthetic { .. }
            | LiveName { .. }
            | Resolution::DynamicStar { .. }
            | Resolution::Unloadable { .. }
            | Resolution::NotFound
            | Resolution::Ambiguous,
            _,
        ) => match a == b {
            true => Identity::Same,
            false => Identity::Different,
        },
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
struct Summary {
    binding: Resolution,
    provider: Resolution,
    has_unresolved_identity: bool,
}

impl Summary {
    const EMPTY: Summary = Summary {
        binding: Resolution::NotFound,
        provider: Resolution::NotFound,
        has_unresolved_identity: false,
    };

    fn join(self, other: Summary, (module, name): NodeKey) -> Summary {
        let not_found = Resolution::NotFound;
        let identity = match self.binding == not_found || other.binding == not_found {
            true => Identity::Same,
            false => compare_bindings(self.binding, other.binding),
        };
        let binding = match identity {
            Identity::Different => Resolution::Ambiguous,
            Identity::Same | Identity::Unknown if self.binding == not_found => other.binding,
            Identity::Same | Identity::Unknown => self.binding,
        };
        let dynamic_star = Resolution::DynamicStar { module, name };
        let provider = if other.provider == not_found || self.provider == other.provider {
            self.provider
        } else if self.provider == not_found {
            other.provider
        } else {
            dynamic_star
        };
        let joined = Summary {
            binding,
            provider,
            has_unresolved_identity: self.has_unresolved_identity
                || other.has_unresolved_identity
                || identity == Identity::Unknown,
        };
        let adds_no_end = identity != Identity::Unknown && (joined == self || joined == other);
        if adds_no_end || !joined.is_compared_at_run_time() {
            return joined;
        }
        Summary {
            provider: dynamic_star,
            ..joined
        }
    }

    fn is_compared_at_run_time(self) -> bool {
        let has_other_provider =
            self.provider != Resolution::NotFound && self.provider != self.binding;
        self.binding.is_binding() && (has_other_provider || self.has_unresolved_identity)
    }

    fn should_follow_every_star(self) -> bool {
        let hides_provider =
            self.binding == Resolution::Ambiguous && self.provider != Resolution::NotFound;
        self.has_unresolved_identity || hides_provider
    }

    fn resolve(self) -> ResolvedName {
        if self.binding == Resolution::NotFound {
            return ResolvedName::new(self.provider);
        }
        let resolved = ResolvedName::new(self.binding);
        if !self.binding.is_binding() {
            return resolved;
        }
        let compared_name = ResolvedName::new(self.provider).required_name;
        ResolvedName {
            required_name: compared_name.or(resolved.required_name),
            ..resolved
        }
    }
}

#[derive(Copy, Clone)]
enum DynamicStarTargets {
    Empty,
    One(ModuleRef),
    Many,
}

impl DynamicStarTargets {
    fn join(self, other: DynamicStarTargets) -> DynamicStarTargets {
        use DynamicStarTargets::{Empty, Many, One};
        match (self, other) {
            (Empty, targets) | (targets, Empty) => targets,
            (One(a), One(b)) if a == b => self,
            (One(_) | Many, One(_) | Many) => Many,
        }
    }

    fn for_name(self, modules: &ModuleSet, module: FileId, name: Atom) -> Resolution {
        match self {
            DynamicStarTargets::Empty => Resolution::NotFound,
            DynamicStarTargets::One(target) => captured_resolution(modules, target, name),
            DynamicStarTargets::Many => Resolution::DynamicStar { module, name },
        }
    }
}

fn find_table(table_files: &[FileId], module: ModuleRef) -> Option<usize> {
    match module {
        ModuleRef::File(file) => table_files.binary_search(&file).ok(),
        _ => None,
    }
}

fn star_targets(scans: &Scans, module: &ExportEntries) -> impl Iterator<Item = ModuleRef> {
    let target_of = move |&site: &u32| match scans.of(module.file).sites[site as usize] {
        ScannedSite::Module(target) => Some(target),
        _ => None,
    };
    module.stars.iter().filter_map(target_of)
}

struct StarExports {
    names: Vec<Atom>,
    dynamic_targets: DynamicStarTargets,
}

fn compute_star_exports(
    scans: &Scans,
    entries: &[ExportEntries],
    files: &[FileId],
) -> (Vec<u32>, Vec<StarExports>) {
    let edges_of = |module: &ExportEntries| -> Vec<u32> {
        let tables = star_targets(scans, module).filter_map(|target| find_table(files, target));
        tables.map(|table| table as u32).collect()
    };
    let edges: Vec<Vec<u32>> = entries.iter().map(edges_of).collect();
    let (component_of, components) = strongly_connected_components(&edges);
    let mut star_exports: Vec<StarExports> = Vec::with_capacity(components.len());
    for (component, members) in components.iter().enumerate() {
        let members = members.iter().map(|&member| &entries[member]);
        let (mut names, mut seen) = (Vec::new(), FxHashSet::default());
        let own_names = members.clone().flat_map(|module| &module.own);
        let own_names = own_names.map(|&(name, _)| name);
        names.extend(own_names.filter(|&name| name != known::default && seen.insert(name)));
        let mut dynamic_targets = DynamicStarTargets::Empty;
        for target in members.flat_map(|module| star_targets(scans, module)) {
            let Some(table) = find_table(files, target) else {
                dynamic_targets = dynamic_targets.join(DynamicStarTargets::One(target));
                continue;
            };
            let target_component = component_of[table] as usize;
            if target_component != component {
                let passed = &star_exports[target_component];
                let passed_names = passed.names.iter().copied();
                names.extend(passed_names.filter(|&name| seen.insert(name)));
                dynamic_targets = dynamic_targets.join(passed.dynamic_targets);
            }
        }
        star_exports.push(StarExports {
            names,
            dynamic_targets,
        });
    }
    (component_of, star_exports)
}

struct FileTable {
    nodes: Range<u32>,
    own_count: u32,
    dynamic_targets: DynamicStarTargets,
    follows_every_star: bool,
}

impl FileTable {
    fn star_nodes(&self) -> Range<u32> {
        self.nodes.start + self.own_count..self.nodes.end
    }
}

#[derive(Default)]
struct NameNodes {
    keys: Vec<NodeKey>,
    index: FxHashMap<NodeKey, u32>,
    tables: Vec<FileTable>,
}

impl NameNodes {
    fn add_file(&mut self, module: &ExportEntries, star_exports: &StarExports) {
        let start = self.keys.len() as u32;
        let own_names = module.own.iter().map(|&(name, _)| name);
        for name in own_names.chain(star_exports.names.iter().copied()) {
            if let Entry::Vacant(entry) = self.index.entry((module.file, name)) {
                entry.insert(self.keys.len() as u32);
                self.keys.push((module.file, name));
            }
        }
        self.tables.push(FileTable {
            nodes: start..self.keys.len() as u32,
            own_count: module.own.len() as u32,
            dynamic_targets: star_exports.dynamic_targets,
            follows_every_star: false,
        });
    }

    fn find_star_table(&self, node: u32) -> Option<usize> {
        let table = self.tables.partition_point(|table| table.nodes.end <= node);
        let is_star_name = self.tables[table].star_nodes().contains(&node);
        is_star_name.then_some(table)
    }
}

#[derive(Copy, Clone)]
enum NodeKind {
    Indirect,
    Star,
}

struct ResolutionGraph<'a> {
    scans: &'a Scans,
    modules: &'a ModuleSet,
    files: &'a [FileId],
    nodes: &'a NameNodes,
    starts: Vec<Summary>,
    edges: Vec<Vec<u32>>,
}

impl ResolutionGraph<'_> {
    fn add_file(&mut self, table: &FileTable, module: &ExportEntries) {
        for (node, &(_, entry)) in (table.nodes.start..).zip(&module.own) {
            self.add_own_name(node, entry);
        }
        for node in table.star_nodes() {
            let (_, name) = self.nodes.keys[node as usize];
            for target in star_targets(self.scans, module) {
                self.follow(node, NodeKind::Star, target, name);
            }
        }
    }

    fn add_own_name(&mut self, node: u32, entry: ExportEntry) {
        let (importer, _) = self.nodes.keys[node as usize];
        let site = match entry {
            ExportEntry::Local(id) => {
                let local = Sym { file: importer, id };
                self.starts[node as usize].binding = Resolution::Variable(local);
                return;
            }
            ExportEntry::Namespace { site }
            | ExportEntry::ImportedNamespace { site, .. }
            | ExportEntry::Indirect { site, .. } => site,
        };
        let binding = match (&self.scans.of(importer).sites[site as usize], entry) {
            (&ScannedSite::Module(target), ExportEntry::Indirect { name, .. }) => {
                return self.follow(node, NodeKind::Indirect, target, name);
            }
            (&ScannedSite::Module(module), ExportEntry::Namespace { .. }) => {
                Resolution::Namespace {
                    module,
                    phase: ImportPhase::Evaluation,
                }
            }
            (&ScannedSite::Module(module), ExportEntry::ImportedNamespace { phase, .. }) => {
                let phase = phase_towards(self.modules.interop(module).kind, phase);
                imported_namespace_resolution(module, phase)
            }
            (&ScannedSite::Module(_), ExportEntry::Local(_)) => {
                unreachable!("a local export has no import site")
            }
            (ScannedSite::Unresolved, _) => Resolution::Unloadable { importer, site },
            (ScannedSite::AllModules | ScannedSite::Candidates(_) | ScannedSite::Erased, _) => {
                debug_assert!(false, "an export entry has a module or a load failure");
                Resolution::NotFound
            }
        };
        self.starts[node as usize].binding = binding;
    }

    fn follow(&mut self, node: u32, kind: NodeKind, target: ModuleRef, name: Atom) {
        let (nodes, modules) = (self.nodes, self.modules);
        let mut end = Summary::EMPTY;
        match (find_table(self.files, target), kind) {
            (None, NodeKind::Indirect) => end.binding = captured_resolution(modules, target, name),
            (None, NodeKind::Star) => end.provider = captured_resolution(modules, target, name),
            (Some(table), _) => {
                let file = self.files[table];
                if let Some(&target_node) = nodes.index.get(&(file, name)) {
                    self.edges[node as usize].push(target_node);
                } else if name != known::default {
                    let dynamic_targets = nodes.tables[table].dynamic_targets;
                    end.provider = dynamic_targets.for_name(modules, file, name);
                }
            }
        }
        let start = &mut self.starts[node as usize];
        *start = start.join(end, nodes.keys[node as usize]);
    }

    /// What each name comes to, and the tables that follow every star.
    fn solve(self) -> (Vec<(Atom, ResolvedName)>, Vec<usize>) {
        let (component_of, components) = strongly_connected_components(&self.edges);
        let mut summaries: Vec<Summary> = Vec::with_capacity(components.len());
        for (component, members) in components.iter().enumerate() {
            let is_star_name = |&&node: &&usize| self.nodes.find_star_table(node as u32).is_some();
            let representative = match members[..] {
                [node] => node,
                _ => *members.iter().find(is_star_name).unwrap_or(&members[0]),
            };
            let key = self.nodes.keys[representative];
            let mut summary = Summary::EMPTY;
            for &member in members {
                summary = summary.join(self.starts[member], key);
                for &target in &self.edges[member] {
                    let target_component = component_of[target as usize] as usize;
                    if target_component != component {
                        summary = summary.join(summaries[target_component], key);
                    }
                }
            }
            summaries.push(summary);
        }
        let summary_of = |node: usize| summaries[component_of[node] as usize];
        let keys = self.nodes.keys.iter().enumerate();
        let results = keys.map(|(node, &(_, name))| (name, summary_of(node).resolve()));
        let is_followed = |&node: &u32| summary_of(node as usize).should_follow_every_star();
        let followed_nodes = (0..self.edges.len() as u32).filter(is_followed);
        let results = results.collect();
        (results, self.find_star_tables(followed_nodes.collect()))
    }

    fn find_star_tables(&self, mut pending_nodes: Vec<u32>) -> Vec<usize> {
        let mut is_visited = vec![false; self.edges.len()];
        for &node in &pending_nodes {
            is_visited[node as usize] = true;
        }
        let mut tables = Vec::new();
        while let Some(node) = pending_nodes.pop() {
            let Some(table) = self.nodes.find_star_table(node) else {
                continue;
            };
            tables.push(table);
            for &target in &self.edges[node as usize] {
                if !core::mem::replace(&mut is_visited[target as usize], true) {
                    pending_nodes.push(target);
                }
            }
        }
        tables
    }
}

fn find_link_failure(
    scans: &Scans,
    importer: FileId,
    entry: ExportEntry,
    resolution: Resolution,
) -> Option<PendingFailure> {
    let ExportEntry::Indirect {
        site,
        name,
        written: Some(written),
    } = entry
    else {
        return None;
    };
    let ScannedSite::Module(exporter) = scans.of(importer).sites[site as usize] else {
        return None;
    };
    let kind = match resolution {
        Resolution::NotFound => ModuleFailureKind::ExportNotFound { exporter, name },
        Resolution::Ambiguous => ModuleFailureKind::ExportAmbiguous { exporter, name },
        _ => return None,
    };
    Some(written.fail(importer, kind))
}

// A name that an ES module imports and that some run of the body of the CommonJS module may end without.
fn find_absent_name(
    tables: &ExportTables,
    modules: &ModuleSet,
    written: &WrittenImport,
) -> Option<PendingFailure> {
    let CommonJsImport {
        importer,
        exporter,
        name,
    } = written.imported;
    let exporter = ModuleRef::File(exporter);
    let may_be_absent = written.must_be_there
        && match tables.resolve_in(modules, exporter, name).resolution {
            // Without a `default` of its own a module exports its value under the name.
            Resolution::Synthetic { module, name } => {
                name != known::default && tables.commonjs.may_lack(module, name)
            }
            _ => false,
        };
    let kind = ModuleFailureKind::ExportMayBeAbsent { exporter, name };
    may_be_absent.then(|| written.written.fail(importer, kind))
}

pub(super) fn resolve_exports(
    scans: &Scans,
    modules: &ModuleSet,
    entries: CollectedEntries,
    commonjs: &CommonJsTexts,
) -> ExportTables {
    let CollectedEntries {
        tables: entries,
        commonjs_imports,
        mut commonjs_namespace_loads,
    } = entries;
    let files: Vec<FileId> = entries.iter().map(|module| module.file).collect();
    let has_table = |file: &&FileId| modules.table_file(ModuleRef::File(**file)).is_some();
    let table_files = modules.record_files.iter().filter(has_table);
    debug_assert!(files.iter().eq(table_files));
    let (component_of, star_exports) = compute_star_exports(scans, &entries, &files);
    let mut nodes = NameNodes::default();
    for (module, &component) in entries.iter().zip(&component_of) {
        nodes.add_file(module, &star_exports[component as usize]);
    }
    let mut graph = ResolutionGraph {
        scans,
        modules,
        files: &files,
        nodes: &nodes,
        starts: vec![Summary::EMPTY; nodes.keys.len()],
        edges: vec![Vec::new(); nodes.keys.len()],
    };
    for (table, module) in nodes.tables.iter().zip(&entries) {
        graph.add_file(table, module);
    }
    let (results, followed_tables) = graph.solve();
    for table in followed_tables {
        nodes.tables[table].follows_every_star = true;
    }
    let mut failures = Vec::new();
    for (table, module) in nodes.tables.iter().zip(entries) {
        let own_results = &results[table.nodes.start as usize..];
        for (&(_, entry), &(_, resolved)) in module.own.iter().zip(own_results) {
            failures.extend(find_link_failure(
                scans,
                module.file,
                entry,
                resolved.resolution,
            ));
        }
    }
    let mut tables = ExportTables {
        files,
        tables: nodes.tables,
        results,
        index: nodes.index,
        failures,
        ..ExportTables::default()
    };
    tables.commonjs = resolve_commonjs_names(modules, &tables, commonjs.entries());
    for position in 0..tables.results.len() {
        let resolved = tables.follow(tables.results[position].1);
        tables.results[position].1 = resolved;
        if let Resolution::Namespace {
            module: ModuleRef::File(file),
            ..
        } = resolved.resolution
            && modules.interop(ModuleRef::File(file)).kind == ModuleKind::CommonJs
        {
            commonjs_namespace_loads.push(file);
        }
    }
    let mut absent_names = Vec::new();
    for written in &commonjs_imports {
        if let Some(pending) = find_absent_name(&tables, modules, written) {
            tables.failures.push(pending);
            absent_names.push((written.imported, written.written.order));
        }
    }
    let failures = &mut tables.failures;
    failures.shared_sort_by_key(|pending| (pending.failure.importer, pending.order));
    absent_names.shared_sort_by_key(|&(imported, order)| (imported.importer, order));
    tables.absent_commonjs_names = absent_names;
    let imported = commonjs_imports.iter().map(|written| written.imported);
    tables.commonjs_imports = imported.collect();
    commonjs_namespace_loads.sort_unstable();
    commonjs_namespace_loads.dedup();
    tables.commonjs_namespace_loads = commonjs_namespace_loads;
    tables
}

#[derive(Default)]
pub(super) struct ExportTables {
    files: Vec<FileId>,
    tables: Vec<FileTable>,
    results: Vec<(Atom, ResolvedName)>,
    index: FxHashMap<NodeKey, u32>,
    failures: Vec<PendingFailure>,
    pub(super) commonjs: CommonJsNames,
    /// The names that import statements and `export { .. } from` of ES modules read of CommonJS files.
    pub(super) commonjs_imports: Vec<CommonJsImport>,
    /// Those that the body of the CommonJS module may end without, by importer and by where they are written.
    pub(super) absent_commonjs_names: Vec<(CommonJsImport, FailureOrder)>,
    /// The CommonJS files that `import()`, `export *` or an exported namespace name.
    pub(super) commonjs_namespace_loads: Vec<FileId>,
}

impl ExportTables {
    // A name of a CommonJS module may stand for a name of another module, or for a binding.
    fn follow(&self, resolved: ResolvedName) -> ResolvedName {
        let Resolution::Synthetic { module, name } = resolved.resolution else {
            return resolved;
        };
        match self.commonjs.find(module, name) {
            Some(resolution) => ResolvedName {
                resolution,
                ..resolved
            },
            None => resolved,
        }
    }

    pub(super) fn resolve(&self, modules: &ModuleSet, module: FileId, name: Atom) -> ResolvedName {
        if let Some(&node) = self.index.get(&(module, name)) {
            return self.results[node as usize].1;
        }
        let resolved = ResolvedName::new(match self.table_of(module) {
            None => captured_resolution(modules, ModuleRef::File(module), name),
            Some(_) if name == known::default => Resolution::NotFound,
            Some(table) => table.dynamic_targets.for_name(modules, module, name),
        });
        self.follow(resolved)
    }

    pub(super) fn resolve_in(
        &self,
        modules: &ModuleSet,
        target: ModuleRef,
        name: Atom,
    ) -> ResolvedName {
        match modules.table_file(target) {
            Some(file) => self.resolve(modules, file, name),
            None => self.follow(ResolvedName::new(captured_resolution(
                modules, target, name,
            ))),
        }
    }

    /// The modules whose captured `default` an ES module exports, under whatever name and through however many files.
    pub(super) fn modules_whose_default_is_exported(&self) -> impl Iterator<Item = ModuleRef> + '_ {
        let results = self.results.iter();
        results.filter_map(|&(_, resolved)| match resolved.resolution {
            Resolution::Synthetic { module, name } if name == known::default => Some(module),
            _ => None,
        })
    }

    pub(super) fn names(&self, module: FileId) -> &[(Atom, ResolvedName)] {
        let table = self.table_of(module);
        let nodes = table.map_or(0..0, |table| table.nodes.clone());
        &self.results[nodes.start as usize..nodes.end as usize]
    }

    pub(super) fn own_names(&self, module: FileId) -> &[(Atom, ResolvedName)] {
        let own_count = self.table_of(module).map_or(0, |table| table.own_count);
        &self.names(module)[..own_count as usize]
    }

    pub(super) fn has_dynamic_names(&self, module: ModuleRef) -> bool {
        let Some(table) = find_table(&self.files, module) else {
            return true;
        };
        match self.tables[table].dynamic_targets {
            DynamicStarTargets::Empty => false,
            DynamicStarTargets::One(_) | DynamicStarTargets::Many => true,
        }
    }

    pub(super) fn follows_every_star(&self, module: FileId) -> bool {
        let table = self.table_of(module);
        table.is_some_and(|table| table.follows_every_star)
    }

    pub(super) fn failures_of(&self, file: FileId) -> &[PendingFailure] {
        let failures = &self.failures[..];
        let start = failures.partition_point(|pending| pending.failure.importer < file);
        let end = failures.partition_point(|pending| pending.failure.importer <= file);
        &failures[start..end]
    }

    fn table_of(&self, file: FileId) -> Option<&FileTable> {
        let table = find_table(&self.files, ModuleRef::File(file))?;
        Some(&self.tables[table])
    }
}

pub(super) fn finish_exports(
    files: &Files<'_>,
    tables: &ExportTables,
    synthetic: &SyntheticExports,
    file: FileId,
) -> Vec<ModuleExport> {
    let own_count = tables.own_names(file).len();
    let finish = |(position, &(exported_name, resolved)): (usize, &(Atom, ResolvedName))| {
        let binding = match resolved.resolution {
            Resolution::Variable(symbol) => ExportBinding::Variable(symbol),
            Resolution::Namespace { module, phase } => ExportBinding::Namespace { module, phase },
            Resolution::Synthetic { module, name } => {
                ExportBinding::Synthetic(synthetic.id_of(module, name))
            }
            Resolution::RuntimeMember { module, name } => {
                ExportBinding::Synthetic(synthetic.id_of(ModuleRef::Runtime(module), name))
            }
            Resolution::LiveName { module, name } => ExportBinding::Indirect { module, name },
            _ => return None,
        };
        let is_from_star_export = position >= own_count;
        Some(ModuleExport {
            name: exported_name,
            binding,
            is_from_star_export,
            can_be_ambiguous: is_from_star_export && resolved.can_be_ambiguous(),
            is_read_from_object: true,
        })
    };
    let names = tables.names(file).iter().enumerate();
    let mut exports: Vec<ModuleExport> = names.filter_map(finish).collect();
    let atoms = &files.atoms;
    exports.shared_sort_unstable_by(|a, b| {
        compare_code_units(atoms.bytes(a.name), atoms.bytes(b.name))
    });
    exports
}
