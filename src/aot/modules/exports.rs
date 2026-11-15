mod asked;
mod commonjs;
mod entries;
#[cfg(test)]
mod tests;

pub(super) use entries::collect_export_entries;

use self::asked::{AskedNames, Stars};
use self::commonjs::{CommonJsNames, resolve_commonjs_names};
use super::bindings::{ExportBinding, ModuleExport, RequiredName};
use super::commonjs_exports::{CommonJsImport, CommonJsTexts};
use super::compare_code_units;
use super::failures::{FailureOrder, ModuleFailureKind, PendingFailure};
use super::imports::MockedModules;
use super::interop::ImportPhase;
use super::module_set::ModuleSet;
use super::requests::{ScannedSite, Scans};
use super::synthetic_exports::SyntheticExports;
use super::{BindInput, ModuleRef};
use crate::builtins::{RuntimeModule, table};
use crate::statistics::{Stage, StepClock};
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
    /// The name is required only because a mock whose names are known may bring it.
    pub is_compared_only_with_mocks: bool,
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
            is_compared_only_with_mocks: false,
        }
    }

    pub(super) fn can_be_ambiguous(self) -> bool {
        let existence_check = ResolvedName::new(self.resolution).required_name;
        self.required_name != existence_check
    }
}

type NodeKey = (FileId, Atom);

fn captured_resolution(modules: &ModuleSet, module: ModuleRef, name: Atom) -> Resolution {
    match module {
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
        ModuleRef::Facade(file) => Resolution::Synthetic {
            module: ModuleRef::File(file),
            name,
        },
        ModuleRef::Check(_) => Resolution::NotFound,
    }
}

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
    use ModuleRef::{Check, External, Facade, File, Inner, Runtime};
    match (a, b) {
        _ if a == b => Identity::Same,
        (External { specifier: a, .. }, External { specifier: b, .. }) if a == b => {
            Identity::Unknown
        }
        (File(_) | Inner { .. } | Facade(_) | Check(_) | Runtime(_) | External { .. }, _) => {
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
    ends_in_file_that_may_be_mocked: bool,
    may_be_settled_by_mock: bool,
    has_unmocked_provider: bool,
}

impl Summary {
    const EMPTY: Summary = Summary {
        binding: Resolution::NotFound,
        provider: Resolution::NotFound,
        has_unresolved_identity: false,
        ends_in_file_that_may_be_mocked: false,
        may_be_settled_by_mock: false,
        has_unmocked_provider: false,
    };

    fn join(self, other: Summary, (module, name): NodeKey) -> Summary {
        let not_found = Resolution::NotFound;
        let identity = match self.binding == not_found || other.binding == not_found {
            true => Identity::Same,
            false => compare_bindings(self.binding, other.binding),
        };
        let ends_in_file_that_may_be_mocked =
            self.ends_in_file_that_may_be_mocked || other.ends_in_file_that_may_be_mocked;
        let may_be_settled_by_mock = self.may_be_settled_by_mock || other.may_be_settled_by_mock;
        let identity = match identity {
            Identity::Different
                if (ends_in_file_that_may_be_mocked || may_be_settled_by_mock)
                    && self.binding.is_binding()
                    && other.binding.is_binding() =>
            {
                Identity::Unknown
            }
            _ => identity,
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
            ends_in_file_that_may_be_mocked,
            may_be_settled_by_mock,
            has_unmocked_provider: self.has_unmocked_provider || other.has_unmocked_provider,
        };
        let has_same_ends = |part: Summary| {
            joined
                == Summary {
                    may_be_settled_by_mock,
                    ..part
                }
        };
        let adds_no_end =
            identity != Identity::Unknown && (has_same_ends(self) || has_same_ends(other));
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
            is_compared_only_with_mocks: compared_name.is_some()
                && !self.has_unmocked_provider
                && !self.has_unresolved_identity
                && !self.ends_in_file_that_may_be_mocked,
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

    fn for_name_exported_again(
        self,
        modules: &ModuleSet,
        module: FileId,
        name: Atom,
    ) -> Resolution {
        match self.for_name(modules, module, name) {
            Resolution::DynamicStar { module, name } => Resolution::LiveName {
                module: ModuleRef::File(module),
                name,
            },
            found => found,
        }
    }
}

fn find_table(table_files: &[FileId], module: ModuleRef) -> Option<usize> {
    match module {
        ModuleRef::File(file) => table_files.binary_search(&file).ok(),
        _ => None,
    }
}

const NO_TABLE: u32 = u32::MAX;

fn number_tables_by_file(table_files: &[FileId]) -> Vec<u32> {
    let file_count = table_files.last().map_or(0, |file| file.idx() + 1);
    let mut table_by_file = vec![NO_TABLE; file_count];
    for (table, file) in (0u32..).zip(table_files) {
        table_by_file[file.idx()] = table;
    }
    table_by_file
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
    has_unmocked_dynamic_names: bool,
    lead_to_mocked_file: bool,
}

fn compute_star_exports(
    scans: &Scans,
    entries: &[ExportEntries],
    files: &[FileId],
    mocked: &MockedModules,
    askers: Option<(&BindInput<'_, '_>, &ModuleSet)>,
) -> (Vec<u32>, Vec<StarExports>, Vec<Vec<u32>>, AskedNames) {
    let targets_of_mock =
        |module: &ExportEntries| match mocked.contains(ModuleRef::File(module.file)) {
            true => DynamicStarTargets::Many,
            false => DynamicStarTargets::Empty,
        };
    let edges_of = |module: &ExportEntries| -> Vec<u32> {
        let tables = star_targets(scans, module).filter_map(|target| find_table(files, target));
        tables.map(|table| table as u32).collect()
    };
    let edges: Vec<Vec<u32>> = entries.iter().map(edges_of).collect();
    let mut is_taken_by_star = vec![false; entries.len()];
    for &target in edges.iter().flatten() {
        is_taken_by_star[target as usize] = true;
    }
    let (component_of, components) = strongly_connected_components(&edges);
    let mut dynamic_targets: Vec<DynamicStarTargets> = Vec::with_capacity(components.len());
    let mut dynamic_without_mocks: Vec<bool> = Vec::with_capacity(components.len());
    let mut leads_to_mocked_file: Vec<bool> = Vec::with_capacity(components.len());
    for (component, members) in components.iter().enumerate() {
        let members = members.iter().map(|&member| &entries[member]);
        let mut targets = DynamicStarTargets::Empty;
        let mut is_dynamic_without_mocks = false;
        let mut leads_to_mock = false;
        for module in members.clone() {
            targets = targets.join(targets_of_mock(module));
            leads_to_mock |= mocked.contains(ModuleRef::File(module.file));
            is_dynamic_without_mocks |= mocked.contains(ModuleRef::File(module.file))
                && !mocked.names().contains_key(&module.file);
        }
        for target in members.flat_map(|module| star_targets(scans, module)) {
            let (targets_behind, is_dynamic_through) = match find_table(files, target) {
                None => (DynamicStarTargets::One(target), true),
                Some(table) if component_of[table] as usize == component => continue,
                Some(table) => {
                    let component = component_of[table] as usize;
                    leads_to_mock |= leads_to_mocked_file[component];
                    (dynamic_targets[component], dynamic_without_mocks[component])
                }
            };
            targets = targets.join(targets_behind);
            is_dynamic_without_mocks |= is_dynamic_through;
        }
        dynamic_targets.push(targets);
        dynamic_without_mocks.push(is_dynamic_without_mocks);
        leads_to_mocked_file.push(leads_to_mock);
    }
    let asked = match askers {
        None => AskedNames::everything(components.len()),
        Some((input, modules)) => {
            let stars = Stars {
                edges: &edges,
                is_taken_by_star: &is_taken_by_star,
                component_of: &component_of,
                components: &components,
                dynamic_targets: &dynamic_targets,
            };
            AskedNames::find(input, scans, modules, entries, files, mocked, &stars)
        }
    };
    let mut star_exports: Vec<StarExports> = Vec::with_capacity(components.len());
    for (component, members) in components.iter().enumerate() {
        if let [member] = members[..]
            && entries[member].stars.is_empty()
            && !is_taken_by_star[member]
        {
            star_exports.push(StarExports {
                names: Vec::new(),
                dynamic_targets: dynamic_targets[component],
                has_unmocked_dynamic_names: dynamic_without_mocks[component],
                lead_to_mocked_file: leads_to_mocked_file[component],
            });
            continue;
        }
        let members = members.iter().map(|&member| &entries[member]);
        let (mut names, mut seen) = (Vec::new(), FxHashSet::default());
        let own_names = members.clone().flat_map(|module| &module.own);
        let own_names = own_names.map(|&(name, _)| name);
        let mut is_listed = |&name: &Atom| asked.contains(component, name) && seen.insert(name);
        names.extend(own_names.filter(|&name| name != known::default && is_listed(&name)));
        for target in members.flat_map(|module| star_targets(scans, module)) {
            let Some(table) = find_table(files, target) else {
                continue;
            };
            let target_component = component_of[table] as usize;
            if target_component != component {
                let passed_names = star_exports[target_component].names.iter().copied();
                names.extend(passed_names.filter(&mut is_listed));
            }
        }
        star_exports.push(StarExports {
            names,
            dynamic_targets: dynamic_targets[component],
            has_unmocked_dynamic_names: dynamic_without_mocks[component],
            lead_to_mocked_file: leads_to_mocked_file[component],
        });
    }
    (component_of, star_exports, edges, asked)
}

struct FileTable {
    nodes: Range<u32>,
    own_count: u32,
    dynamic_targets: DynamicStarTargets,
    has_unmocked_dynamic_names: bool,
    follows_every_star: bool,
    may_be_mocked: bool,
    stars_lead_to_mocked_file: bool,
    leaves_out_names: bool,
}

impl FileTable {
    fn star_nodes(&self) -> Range<u32> {
        self.nodes.start + self.own_count..self.nodes.end
    }

    fn may_be_settled_by_mock(&self, node: u32) -> bool {
        self.stars_lead_to_mocked_file && self.star_nodes().contains(&node)
    }
}

#[derive(Default)]
struct NameNodes {
    keys: Vec<NodeKey>,
    index: FxHashMap<NodeKey, u32>,
    tables: Vec<FileTable>,
}

impl NameNodes {
    fn add_file(
        &mut self,
        module: &ExportEntries,
        star_exports: &StarExports,
        may_be_mocked: bool,
        leaves_out_names: bool,
    ) {
        let start = self.keys.len() as u32;
        let own_names = module.own.iter().map(|&(name, _)| name);
        let star_names: &[Atom] = match module.stars.is_empty() {
            true => &[],
            false => &star_exports.names,
        };
        for name in own_names.chain(star_names.iter().copied()) {
            if let Entry::Vacant(entry) = self.index.entry((module.file, name)) {
                entry.insert(self.keys.len() as u32);
                self.keys.push((module.file, name));
            }
        }
        self.tables.push(FileTable {
            nodes: start..self.keys.len() as u32,
            own_count: module.own.len() as u32,
            dynamic_targets: star_exports.dynamic_targets,
            has_unmocked_dynamic_names: star_exports.has_unmocked_dynamic_names,
            follows_every_star: false,
            may_be_mocked,
            stars_lead_to_mocked_file: star_exports.lead_to_mocked_file,
            leaves_out_names,
        });
    }

    fn find_star_table(&self, node: u32) -> Option<usize> {
        let table = self.tables.partition_point(|table| table.nodes.end <= node);
        let is_star_name = self.tables[table].star_nodes().contains(&node);
        is_star_name.then_some(table)
    }

    fn is_in_file_without_dynamic_stars(&self, node: u32) -> bool {
        let table = self.tables.partition_point(|table| table.nodes.end <= node);
        matches!(
            self.tables[table].dynamic_targets,
            DynamicStarTargets::Empty
        )
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
    commonjs: &'a CommonJsTexts,
    files: &'a [FileId],
    nodes: &'a NameNodes,
    /// Names that fail in a file that may be mocked: only a mock has them.
    resolved_by_mocks: &'a FxHashSet<u32>,
    starts: Vec<Summary>,
    edges: Vec<Vec<u32>>,
    statements_ahead_of_stars: Vec<(NodeKey, Resolution)>,
}

impl ResolutionGraph<'_> {
    fn add_file(&mut self, table: &FileTable, module: &ExportEntries) {
        for (node, &(_, entry)) in (table.nodes.start..).zip(&module.own) {
            self.add_own_name(node, entry, !module.stars.is_empty());
        }
        let nodes = self.nodes;
        let star_nodes = table.star_nodes();
        for target in star_targets(self.scans, module) {
            let target_table = find_table(self.files, target).map(|table| &nodes.tables[table]);
            match target_table {
                Some(target_table)
                    if matches!(target_table.dynamic_targets, DynamicStarTargets::Empty) =>
                {
                    for target_node in target_table.nodes.clone() {
                        let (_, name) = nodes.keys[target_node as usize];
                        let node = nodes.index.get(&(module.file, name));
                        if let Some(&node) = node.filter(|node| star_nodes.contains(node)) {
                            self.edges[node as usize].push(target_node);
                        }
                    }
                }
                Some(_) | None => {
                    for node in star_nodes.clone() {
                        let (_, name) = nodes.keys[node as usize];
                        self.follow(node, NodeKind::Star, target, name);
                    }
                }
            }
        }
    }

    fn add_own_name(&mut self, node: u32, entry: ExportEntry, has_stars: bool) {
        let (importer, export_name) = self.nodes.keys[node as usize];
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
            (
                &ScannedSite::Module(target),
                ExportEntry::Indirect {
                    name,
                    written: Some(_),
                    ..
                },
            ) if has_stars
                && export_name != known::default
                && name != known::default
                && self.commonjs.may_end_without(target, name) =>
            {
                let named = captured_resolution(self.modules, target, name);
                let key = (importer, export_name);
                self.statements_ahead_of_stars.push((key, named));
                Resolution::LiveName {
                    module: ModuleRef::File(importer),
                    name: export_name,
                }
            }
            (&ScannedSite::Module(target), ExportEntry::Indirect { name, written, .. }) => {
                let is_explicit_among_stars = has_stars && written.is_some();
                if is_explicit_among_stars && self.is_resolved_by_mocks(target, name) {
                    return;
                }
                return self.follow(node, NodeKind::Indirect, target, name);
            }
            (&ScannedSite::Module(module), ExportEntry::Namespace { .. }) => {
                Resolution::Namespace {
                    module,
                    phase: ImportPhase::Evaluation,
                }
            }
            (&ScannedSite::Module(module), ExportEntry::ImportedNamespace { phase, .. }) => {
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

    fn is_resolved_by_mocks(&self, target: ModuleRef, name: Atom) -> bool {
        let ModuleRef::File(file) = target else {
            return false;
        };
        let node = self.nodes.index.get(&(file, name));
        node.is_some_and(|node| self.resolved_by_mocks.contains(node))
    }

    fn follow(&mut self, node: u32, kind: NodeKind, target: ModuleRef, name: Atom) {
        let (nodes, modules) = (self.nodes, self.modules);
        let mut end = Summary::EMPTY;
        match (find_table(self.files, target), kind) {
            (None, NodeKind::Indirect) => end.binding = captured_resolution(modules, target, name),
            (None, NodeKind::Star) => {
                end.provider = captured_resolution(modules, target, name);
                end.has_unmocked_provider = true;
            }
            (Some(table), _) => {
                let file = self.files[table];
                let target_node = nodes.index.get(&(file, name));
                if let Some(&target_node) = target_node
                    && !self.resolved_by_mocks.contains(&target_node)
                {
                    self.edges[node as usize].push(target_node);
                    end.ends_in_file_that_may_be_mocked =
                        matches!(kind, NodeKind::Indirect) && nodes.tables[table].may_be_mocked;
                    end.may_be_settled_by_mock = matches!(kind, NodeKind::Indirect)
                        && nodes.tables[table].may_be_settled_by_mock(target_node);
                } else if name != known::default {
                    let targets = nodes.tables[table].dynamic_targets;
                    match kind {
                        NodeKind::Indirect => {
                            end.binding = targets.for_name_exported_again(modules, file, name);
                        }
                        NodeKind::Star => {
                            end.provider = targets.for_name(modules, file, name);
                            end.has_unmocked_provider = target_node.is_some()
                                || nodes.tables[table].has_unmocked_dynamic_names;
                        }
                    }
                }
            }
        }
        let start = &mut self.starts[node as usize];
        *start = start.join(end, nodes.keys[node as usize]);
    }

    fn solve(self) -> (Vec<(Atom, ResolvedName)>, Vec<usize>) {
        const LEADS_NOWHERE: u32 = u32::MAX;
        let leads_on = |&node: &usize| !self.edges[node].is_empty();
        let nodes_that_lead_on: Vec<usize> = (0..self.edges.len()).filter(leads_on).collect();
        let mut place_of = vec![LEADS_NOWHERE; self.edges.len()];
        for (place, &node) in (0..).zip(&nodes_that_lead_on) {
            place_of[node] = place;
        }
        let edges_between = |&node: &usize| -> Vec<u32> {
            let places = self.edges[node]
                .iter()
                .map(|&target| place_of[target as usize]);
            places.filter(|&place| place != LEADS_NOWHERE).collect()
        };
        let edges: Vec<Vec<u32>> = nodes_that_lead_on.iter().map(edges_between).collect();
        let (component_of, components) = strongly_connected_components(&edges);
        let end_at = |node: usize| self.starts[node];
        let mut summaries: Vec<Summary> = Vec::with_capacity(components.len());
        for (component, places) in components.iter().enumerate() {
            let members = places.iter().map(|&place| nodes_that_lead_on[place]);
            let is_star_name = |&node: &usize| self.nodes.find_star_table(node as u32).is_some();
            let has_dynamic_stars = |&node: &usize| {
                is_star_name(&node) && !self.nodes.is_in_file_without_dynamic_stars(node as u32)
            };
            let first = nodes_that_lead_on[places[0]];
            let representative = match places.len() {
                1 => first,
                _ => (members.clone().find(has_dynamic_stars))
                    .or_else(|| members.clone().find(is_star_name))
                    .unwrap_or(first),
            };
            let key = self.nodes.keys[representative];
            let mut summary = Summary::EMPTY;
            for member in members {
                summary = summary.join(self.starts[member], key);
                for &target in &self.edges[member] {
                    let place = place_of[target as usize];
                    if place == LEADS_NOWHERE {
                        summary = summary.join(end_at(target as usize), key);
                        continue;
                    }
                    let target_component = component_of[place as usize] as usize;
                    if target_component != component {
                        summary = summary.join(summaries[target_component], key);
                    }
                }
            }
            summaries.push(summary);
        }
        let summary_of = |node: usize| match place_of[node] {
            LEADS_NOWHERE => end_at(node),
            place => summaries[component_of[place as usize] as usize],
        };
        let keys = self.nodes.keys.iter().enumerate();
        let results = keys.map(|(node, &(_, name))| (name, summary_of(node).resolve()));
        let is_lost_unless_followed = |node: u32, summary: Summary| {
            let mut targets = self.edges[node as usize].iter();
            let is_compared = summary.is_compared_at_run_time();
            let is_left_to_run = summary.binding == Resolution::NotFound
                && matches!(summary.provider, Resolution::DynamicStar { .. });
            (is_left_to_run || is_compared)
                && targets.any(|&target| {
                    self.nodes.is_in_file_without_dynamic_stars(target)
                        && (!is_compared || {
                            let behind = summary_of(target as usize);
                            let may_be_found_at_run = behind.binding == Resolution::NotFound
                                && behind.provider != Resolution::NotFound;
                            may_be_found_at_run || behind.is_compared_at_run_time()
                        })
                })
        };
        let is_followed = |&node: &u32| {
            let summary = summary_of(node as usize);
            summary.should_follow_every_star() || is_lost_unless_followed(node, summary)
        };
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

fn find_failing_mocked_names(
    nodes: &NameNodes,
    entries: &[ExportEntries],
    results: &[(Atom, ResolvedName)],
) -> Vec<u32> {
    let tables = nodes.tables.iter().zip(entries);
    let failing = tables
        .filter(|(table, _)| table.may_be_mocked)
        .flat_map(|(table, module)| {
            let own = (table.nodes.start..).zip(&module.own);
            own.filter(|&(node, &(name, entry))| {
                let fails = match results[node as usize].1.resolution {
                    Resolution::NotFound => !module.drops_absent_exports,
                    Resolution::Ambiguous => true,
                    _ => false,
                };
                fails && name != known::default && matches!(entry, ExportEntry::Indirect { .. })
            })
        });
    failing.map(|(node, _)| node).collect()
}

/// Adds the names that a file has only by stars from files whose names are left to mocks.
fn extend_to_stars_above(
    scans: &Scans,
    nodes: &NameNodes,
    entries: &[ExportEntries],
    resolved_by_mocks: &mut FxHashSet<u32>,
) {
    let names: FxHashSet<Atom> = (resolved_by_mocks.iter())
        .map(|&node| nodes.keys[node as usize].1)
        .collect();
    let mut users: FxHashMap<u32, Vec<u32>> = FxHashMap::default();
    let mut waits: FxHashMap<u32, usize> = FxHashMap::default();
    for (table, module) in nodes.tables.iter().zip(entries) {
        for node in table.star_nodes() {
            let (_, name) = nodes.keys[node as usize];
            if !names.contains(&name) {
                continue;
            }
            for target in star_targets(scans, module) {
                if let ModuleRef::File(file) = target
                    && let Some(&target_node) = nodes.index.get(&(file, name))
                {
                    users.entry(target_node).or_default().push(node);
                    *waits.entry(node).or_default() += 1;
                }
            }
        }
    }
    let mut pending: Vec<u32> = resolved_by_mocks.iter().copied().collect();
    while let Some(target) = pending.pop() {
        for user in users.remove(&target).unwrap_or_default() {
            let waiting = waits.get_mut(&user).expect("a user waits for its targets");
            *waiting -= 1;
            if *waiting == 0 && resolved_by_mocks.insert(user) {
                pending.push(user);
            }
        }
    }
}

fn find_link_failure(
    scans: &Scans,
    importer: FileId,
    drops_absent_exports: bool,
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
        Resolution::NotFound if drops_absent_exports && name != known::default => return None,
        Resolution::NotFound => ModuleFailureKind::ExportNotFound { exporter, name },
        Resolution::Ambiguous => ModuleFailureKind::ExportAmbiguous { exporter, name },
        _ => return None,
    };
    Some(written.fail(importer, kind))
}

fn find_absent_name(
    tables: &ExportTables,
    modules: &ModuleSet,
    written: &WrittenImport,
) -> Option<(PendingFailure, CommonJsImport)> {
    let CommonJsImport {
        importer,
        exporter,
        name,
    } = written.imported;
    let exporter = ModuleRef::File(exporter);
    let mut resolved = tables.resolve_in(modules, exporter, name);
    if let Resolution::Synthetic { module, name } = resolved.resolution
        && tables.commonjs.is_hidden(module, name)
    {
        resolved = tables.follow_getter(resolved);
    }
    let Resolution::Synthetic {
        module: owner,
        name: owned_name,
    } = resolved.resolution
    else {
        return None;
    };
    if owned_name == known::default || !tables.commonjs.may_lack(owner, owned_name) {
        return None;
    }
    let imported = match modules.find_commonjs_file(exporter) {
        Some(_) => written.imported,
        None => CommonJsImport {
            importer,
            exporter: modules.find_commonjs_file(owner)?,
            name: owned_name,
        },
    };
    let kind = ModuleFailureKind::ExportMayBeAbsent {
        exporter,
        name,
        asked_by: written.asked_by,
    };
    Some((written.written.fail(importer, kind), imported))
}

pub(super) struct BegunExports {
    #[cfg(debug_assertions)]
    with_every_name: Option<Box<BegunExports>>,
    entries: Vec<ExportEntries>,
    commonjs_imports: Vec<WrittenImport>,
    commonjs_namespace_loads: Vec<FileId>,
    table_files: Vec<FileId>,
    star_tables: Vec<Vec<u32>>,
    names_left_out: FxHashSet<Atom>,
    nodes: NameNodes,
}

pub(super) struct ImportsFromCommonJs {
    #[cfg(debug_assertions)]
    failure_count_with_every_name: Option<usize>,
    written: Vec<WrittenImport>,
    namespace_loads: Vec<FileId>,
}

pub(super) struct ImportsFoundInCommonJs {
    #[cfg(debug_assertions)]
    failure_count_with_every_name: Option<usize>,
    failures: Vec<PendingFailure>,
    dropped_names: Vec<CommonJsImport>,
    absent_names: Vec<(CommonJsImport, FailureOrder)>,
    imports: Vec<CommonJsImport>,
    namespace_loads: Vec<FileId>,
}

#[cfg(test)]
pub(super) fn resolve_exports(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    entries: CollectedEntries,
    commonjs: &CommonJsTexts,
    mocked: &MockedModules,
) -> ExportTables {
    let begun = begin_exports(input, scans, modules, entries, mocked);
    finish_begun_exports(input.files, scans, modules, begun, commonjs)
}

#[cfg(test)]
pub(super) fn resolve_every_export(
    files: &Files<'_>,
    scans: &Scans,
    modules: &ModuleSet,
    entries: CollectedEntries,
    commonjs: &CommonJsTexts,
    mocked: &MockedModules,
) -> ExportTables {
    let begun = begin_exports_for(scans, modules, entries, mocked, None);
    finish_begun_exports(files, scans, modules, begun, commonjs)
}

#[cfg(any(test, debug_assertions))]
fn finish_begun_exports(
    files: &Files<'_>,
    scans: &Scans,
    modules: &ModuleSet,
    begun: BegunExports,
    commonjs: &CommonJsTexts,
) -> ExportTables {
    let (mut tables, imports) = resolve_begun_exports(files, scans, modules, begun, commonjs);
    let found = tables.find_imports_from_commonjs_modules(modules, imports);
    tables.keep_imports_from_commonjs_modules(found);
    tables
}

#[cfg(not(debug_assertions))]
pub(super) fn begin_exports(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    entries: CollectedEntries,
    mocked: &MockedModules,
) -> BegunExports {
    begin_exports_for(scans, modules, entries, mocked, Some((input, modules)))
}

#[cfg(debug_assertions)]
pub(super) fn begin_exports(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    entries: CollectedEntries,
    mocked: &MockedModules,
) -> BegunExports {
    let with_every_name = begin_exports_for(scans, modules, entries.clone(), mocked, None);
    BegunExports {
        with_every_name: Some(Box::new(with_every_name)),
        ..begin_exports_for(scans, modules, entries, mocked, Some((input, modules)))
    }
}

fn begin_exports_for(
    scans: &Scans,
    modules: &ModuleSet,
    entries: CollectedEntries,
    mocked: &MockedModules,
    askers: Option<(&BindInput<'_, '_>, &ModuleSet)>,
) -> BegunExports {
    let CollectedEntries {
        tables: entries,
        commonjs_imports,
        commonjs_namespace_loads,
    } = entries;
    let table_files: Vec<FileId> = entries.iter().map(|module| module.file).collect();
    let has_table = |file: &&FileId| modules.table_file(ModuleRef::File(**file)).is_some();
    let files_with_table = modules.record_files.iter().filter(has_table);
    debug_assert!(table_files.iter().eq(files_with_table));
    let mut steps = StepClock::new(Stage::BindModules);
    let (component_of, star_exports, star_tables, asked) =
        compute_star_exports(scans, &entries, &table_files, mocked, askers);
    steps.end("exports: stars");
    let mut nodes = NameNodes::default();
    let own_names: usize = entries.iter().map(|module| module.own.len()).sum();
    nodes.keys.reserve(own_names);
    nodes.index.reserve(own_names);
    for (module, &component) in entries.iter().zip(&component_of) {
        let may_be_mocked = mocked.contains(ModuleRef::File(module.file));
        let leaves_out_names = !module.stars.is_empty() && !asked.is_whole(component as usize);
        let star_exports = &star_exports[component as usize];
        nodes.add_file(module, star_exports, may_be_mocked, leaves_out_names);
    }
    steps.end("exports: a node for each name");
    BegunExports {
        #[cfg(debug_assertions)]
        with_every_name: None,
        entries,
        commonjs_imports,
        commonjs_namespace_loads,
        table_files,
        star_tables,
        names_left_out: asked.left_out,
        nodes,
    }
}

pub(super) fn resolve_begun_exports(
    files: &Files<'_>,
    scans: &Scans,
    modules: &ModuleSet,
    begun: BegunExports,
    commonjs: &CommonJsTexts,
) -> (ExportTables, ImportsFromCommonJs) {
    #[cfg(debug_assertions)]
    let with_every_name = begun
        .with_every_name
        .map(|begun| finish_begun_exports(files, scans, modules, *begun, commonjs));
    let BegunExports {
        entries,
        commonjs_imports,
        mut commonjs_namespace_loads,
        table_files,
        star_tables,
        names_left_out,
        mut nodes,
        ..
    } = begun;
    let mut steps = StepClock::new(Stage::BindModules);
    let mut solve = |resolved_by_mocks: &FxHashSet<u32>| {
        let mut graph = ResolutionGraph {
            scans,
            modules,
            commonjs,
            files: &table_files,
            nodes: &nodes,
            resolved_by_mocks,
            starts: vec![Summary::EMPTY; nodes.keys.len()],
            edges: vec![Vec::new(); nodes.keys.len()],
            statements_ahead_of_stars: Vec::new(),
        };
        for (table, module) in nodes.tables.iter().zip(&entries) {
            graph.add_file(table, module);
        }
        steps.end("exports: what each name leads to");
        let statements_ahead_of_stars = core::mem::take(&mut graph.statements_ahead_of_stars);
        let (results, followed_tables) = graph.solve();
        steps.end("exports: solve");
        (results, followed_tables, statements_ahead_of_stars)
    };
    let mut solved = solve(&FxHashSet::default());
    let failing = find_failing_mocked_names(&nodes, &entries, &solved.0);
    if !failing.is_empty() {
        let mut resolved_by_mocks: FxHashSet<u32> = failing.iter().copied().collect();
        extend_to_stars_above(scans, &nodes, &entries, &mut resolved_by_mocks);
        let failed = core::mem::replace(&mut solved, solve(&resolved_by_mocks)).0;
        for node in failing {
            solved.0[node as usize] = failed[node as usize];
        }
    }
    let (results, followed_tables, mut statements_ahead_of_stars) = solved;
    statements_ahead_of_stars.shared_sort_by_key(|&((file, name), _)| (file, name.0));
    let with_statements = statements_ahead_of_stars.iter();
    let with_statements = with_statements
        .filter_map(|&((file, _), _)| find_table(&table_files, ModuleRef::File(file)));
    for table in followed_tables.into_iter().chain(with_statements) {
        nodes.tables[table].follows_every_star = true;
    }
    let mut failures = Vec::new();
    let mut indirect_sites = Vec::new();
    for (table, module) in nodes.tables.iter().zip(entries) {
        let own_results = &results[table.nodes.start as usize..];
        let own_nodes = table.nodes.start..;
        for ((&(_, entry), &(_, resolved)), node) in
            module.own.iter().zip(own_results).zip(own_nodes)
        {
            failures.extend(find_link_failure(
                scans,
                module.file,
                module.drops_absent_exports,
                entry,
                resolved.resolution,
            ));
            if let ExportEntry::Indirect { site, name, .. } = entry {
                indirect_sites.push((node, site, name));
            }
        }
    }
    steps.end("exports: failures, indirect sites");
    let mut tables = ExportTables {
        table_by_file: number_tables_by_file(&table_files),
        files: table_files,
        some_file_may_be_mocked: nodes.tables.iter().any(|table| table.may_be_mocked),
        tables: nodes.tables,
        star_tables,
        results,
        indirect_sites,
        index: nodes.index,
        names_left_out,
        failures,
        statements_ahead_of_stars,
        ..ExportTables::default()
    };
    tables.commonjs = resolve_commonjs_names(files, modules, &tables, commonjs.entries());
    steps.end("exports: names of CommonJS modules");
    for position in 0..tables.statements_ahead_of_stars.len() {
        let named = ResolvedName::new(tables.statements_ahead_of_stars[position].1);
        tables.statements_ahead_of_stars[position].1 = tables.follow(named).resolution;
    }
    for position in 0..tables.results.len() {
        let resolved = tables.follow(tables.results[position].1);
        tables.results[position].1 = resolved;
        if let Resolution::Namespace { module, .. } = resolved.resolution {
            commonjs_namespace_loads.extend(modules.find_commonjs_file(module));
        }
    }
    steps.end("exports: follow the results");
    tables.keep_names_that_mocks_may_settle(scans);
    #[cfg(debug_assertions)]
    if let Some(with_every_name) = &with_every_name {
        tables.assert_lacks_only_what_nobody_asks_for(with_every_name);
    }
    let imports = ImportsFromCommonJs {
        #[cfg(debug_assertions)]
        failure_count_with_every_name: with_every_name.map(|tables| tables.failures.len()),
        written: commonjs_imports,
        namespace_loads: commonjs_namespace_loads,
    };
    (tables, imports)
}

#[derive(Default)]
pub(super) struct ExportTables {
    files: Vec<FileId>,
    table_by_file: Vec<u32>,
    tables: Vec<FileTable>,
    star_tables: Vec<Vec<u32>>,
    results: Vec<(Atom, ResolvedName)>,
    indirect_sites: Vec<(u32, u32, Atom)>,
    index: FxHashMap<NodeKey, u32>,
    names_left_out: FxHashSet<Atom>,
    statements_ahead_of_stars: Vec<(NodeKey, Resolution)>,
    names_that_mocks_may_settle: Vec<(NodeKey, (ModuleRef, Atom))>,
    some_file_may_be_mocked: bool,
    failures: Vec<PendingFailure>,
    pub(super) commonjs: CommonJsNames,
    pub(super) commonjs_imports: Vec<CommonJsImport>,
    pub(super) absent_commonjs_names: Vec<(CommonJsImport, FailureOrder)>,
    pub(super) dropped_commonjs_names: Vec<CommonJsImport>,
    pub(super) commonjs_namespace_loads: Vec<FileId>,
}

impl ExportTables {
    pub(super) fn find_imports_from_commonjs_modules(
        &self,
        modules: &ModuleSet,
        asked: ImportsFromCommonJs,
    ) -> ImportsFoundInCommonJs {
        let mut steps = StepClock::new(Stage::BindModules);
        let (mut failures, mut dropped_names) = (Vec::new(), Vec::new());
        let mut absent_names = Vec::new();
        for written in &asked.written {
            if let Some((pending, imported)) = find_absent_name(self, modules, written) {
                if written.is_dropped_if_absent {
                    dropped_names.push(imported);
                    continue;
                }
                failures.push(pending);
                let order = (written.asked_by.is_none(), written.written.order);
                absent_names.push((imported, order));
            }
        }
        absent_names.shared_sort_by_key(|&(imported, order)| (imported.importer, order));
        let absent_names = absent_names.into_iter();
        let imported = asked.written.iter().map(|written| written.imported);
        let imported = imported.filter_map(|imported| {
            let named = ModuleRef::File(imported.exporter);
            let exporter = self.find_commonjs_exporter(modules, named, imported.name)?;
            Some(CommonJsImport {
                exporter,
                ..imported
            })
        });
        let imports = imported.collect();
        let mut namespace_loads = asked.namespace_loads;
        namespace_loads.sort_unstable();
        namespace_loads.dedup();
        steps.end("exports: imports from CommonJS modules");
        ImportsFoundInCommonJs {
            #[cfg(debug_assertions)]
            failure_count_with_every_name: asked.failure_count_with_every_name,
            failures,
            dropped_names,
            absent_names: absent_names
                .map(|(imported, (_, order))| (imported, order))
                .collect(),
            imports,
            namespace_loads,
        }
    }

    pub(super) fn keep_imports_from_commonjs_modules(&mut self, found: ImportsFoundInCommonJs) {
        self.failures.extend(found.failures);
        let failures = &mut self.failures;
        failures.shared_sort_by_key(|pending| (pending.failure.importer, pending.order));
        #[cfg(debug_assertions)]
        if let Some(expected) = found.failure_count_with_every_name {
            assert!(self.failures.len() == expected);
        }
        self.dropped_commonjs_names = found.dropped_names;
        self.absent_commonjs_names = found.absent_names;
        self.commonjs_imports = found.imports;
        self.commonjs_namespace_loads = found.namespace_loads;
    }

    #[inline]
    fn find_table(&self, module: ModuleRef) -> Option<usize> {
        let ModuleRef::File(file) = module else {
            return None;
        };
        let table = *self.table_by_file.get(file.idx())?;
        (table != NO_TABLE).then_some(table as usize)
    }

    fn follow_getter(&self, resolved: ResolvedName) -> ResolvedName {
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

    fn follow(&self, resolved: ResolvedName) -> ResolvedName {
        match resolved.resolution {
            Resolution::Synthetic { module, name } if self.commonjs.is_copied(module, name) => {
                resolved
            }
            _ => self.follow_getter(resolved),
        }
    }

    pub(super) fn resolve(&self, modules: &ModuleSet, module: FileId, name: Atom) -> ResolvedName {
        if let Some(&node) = self.index.get(&(module, name)) {
            return self.results[node as usize].1;
        }
        self.assert_has_place_for(module, name);
        let resolved = ResolvedName::new(match self.table_of(module) {
            None => captured_resolution(modules, ModuleRef::File(module), name),
            Some(table) if name == known::default && !table.may_be_mocked => Resolution::NotFound,
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

    pub(super) fn resolve_required(
        &self,
        modules: &ModuleSet,
        target: ModuleRef,
        name: Atom,
    ) -> ResolvedName {
        let resolved = self.resolve_in(modules, target, name);
        match modules.table_file(target) {
            Some(_) => resolved,
            None => self.follow_getter(resolved),
        }
    }

    pub(super) fn find_commonjs_exporter(
        &self,
        modules: &ModuleSet,
        named: ModuleRef,
        name: Atom,
    ) -> Option<FileId> {
        let Some(file) = modules.table_file(named) else {
            return modules.find_commonjs_file(named);
        };
        if name == known::default {
            return None;
        }
        let table = self.table_of(file)?;
        let DynamicStarTargets::One(target) = table.dynamic_targets else {
            return None;
        };
        match self.index.get(&(file, name)) {
            None => self.assert_has_place_for(file, name),
            Some(node) => {
                let is_left_to_target = table.star_nodes().contains(node)
                    && matches!(self.resolve(modules, file, name).resolution,
                        Resolution::Synthetic { module, .. } if module == target);
                if !is_left_to_target {
                    return None;
                }
            }
        }
        modules.find_commonjs_file(target)
    }

    pub(super) fn is_hidden_from_namespace(
        &self,
        modules: &ModuleSet,
        named: ModuleRef,
        name: Atom,
    ) -> bool {
        let exporter = self.find_commonjs_exporter(modules, named, name);
        exporter.is_some_and(|exporter| self.commonjs.is_hidden(ModuleRef::File(exporter), name))
    }

    fn assert_has_place_for(&self, file: FileId, name: Atom) {
        assert!(
            !self.names_left_out.contains(&name) || !self.leaves_out_names(file),
            "{file:?} is asked for {name:?}, which `export *` may bring it, and nobody was seen to ask for that name"
        );
    }

    pub(super) fn leaves_out_names(&self, file: FileId) -> bool {
        self.table_of(file)
            .is_some_and(|table| table.leaves_out_names)
    }

    pub(super) fn names_left_out(&self) -> &FxHashSet<Atom> {
        &self.names_left_out
    }

    #[cfg(debug_assertions)]
    fn assert_lacks_only_what_nobody_asks_for(&self, with_every_name: &ExportTables) {
        assert!(self.files == with_every_name.files);
        for (&(file, name), &node) in &with_every_name.index {
            let expected = with_every_name.results[node as usize].1;
            match self.index.get(&(file, name)) {
                Some(&node) => {
                    assert_eq!(self.results[node as usize].1, expected, "{file:?} {name:?}")
                }
                None => assert!(
                    self.leaves_out_names(file)
                        && self.names_left_out.contains(&name)
                        && matches!(expected.resolution, Resolution::Variable(_))
                        && expected.required_name.is_none(),
                    "{file:?} has no place for {name:?}, which is {expected:?}"
                ),
            }
        }
        assert!(
            self.index
                .keys()
                .all(|key| with_every_name.index.contains_key(key))
        );
        for (table, expected) in self.tables.iter().zip(&with_every_name.tables) {
            assert!(table.follows_every_star == expected.follows_every_star);
        }
    }

    pub(super) fn names(&self, module: FileId) -> &[(Atom, ResolvedName)] {
        let table = self.table_of(module);
        let nodes = table.map_or(0..0, |table| table.nodes.clone());
        &self.results[nodes.start as usize..nodes.end as usize]
    }

    pub(super) fn own_names(&self, module: FileId) -> &[(Atom, ResolvedName)] {
        let Some(table) = self.table_of(module) else {
            return &[];
        };
        let names = &self.results[table.nodes.start as usize..table.nodes.end as usize];
        &names[..table.own_count as usize]
    }

    pub(super) fn find_indirect_site(&self, module: FileId, position: usize) -> Option<u32> {
        Some(self.find_indirect_name(module, position)?.0)
    }

    pub(super) fn find_indirect_name(
        &self,
        module: FileId,
        position: usize,
    ) -> Option<(u32, Atom)> {
        let node = self.table_of(module)?.nodes.start + position as u32;
        let found = self
            .indirect_sites
            .binary_search_by_key(&node, |&(node, ..)| node);
        found.ok().map(|index| {
            let (_, site, name) = self.indirect_sites[index];
            (site, name)
        })
    }

    pub(super) fn exports_imported_name(&self, module: FileId, site: u32, name: Atom) -> bool {
        let mut positions = 0..self.own_names(module).len();
        positions.any(|position| self.find_indirect_name(module, position) == Some((site, name)))
    }

    pub(super) fn files_searched_for(&self, module: FileId, name: Atom) -> Vec<FileId> {
        let start = self.find_table(ModuleRef::File(module));
        let mut searched: Vec<u32> = start.map(|table| table as u32).into_iter().collect();
        let mut next = 0;
        while let Some(&table) = searched.get(next) {
            next += 1;
            let file = self.files[table as usize];
            let node = self.index.get(&(file, name));
            if !node.is_some_and(|node| self.tables[table as usize].star_nodes().contains(node))
                && self.find_statement_ahead_of_stars(file, name).is_none()
            {
                continue;
            }
            for &target in &self.star_tables[table as usize] {
                let has_name = (self.index).contains_key(&(self.files[target as usize], name));
                if has_name && !searched.contains(&target) {
                    searched.push(target);
                }
            }
        }
        let searched = searched.into_iter();
        searched.map(|table| self.files[table as usize]).collect()
    }

    /// The names that stars and statements lead to, up to the declarations.
    pub(super) fn names_behind(&self, scans: &Scans, file: FileId, name: Atom) -> Vec<NodeKey> {
        let mut found: Vec<NodeKey> = vec![(file, name)];
        let mut seen: FxHashSet<NodeKey> = found.iter().copied().collect();
        let mut next = 0;
        while let Some(&(file, name)) = found.get(next) {
            next += 1;
            let Some(table) = self.find_table(ModuleRef::File(file)) else {
                continue;
            };
            let Some(&node) = self.index.get(&(file, name)) else {
                continue;
            };
            let own_position = (!self.tables[table].star_nodes().contains(&node))
                .then(|| (node - self.tables[table].nodes.start) as usize);
            let named = own_position.and_then(|position| self.find_indirect_name(file, position));
            if let Some((site, listed)) = named
                && let ScannedSite::Module(ModuleRef::File(target)) =
                    scans.of(file).sites[site as usize]
                && seen.insert((target, listed))
            {
                found.push((target, listed));
            }
            if own_position.is_some() && self.find_statement_ahead_of_stars(file, name).is_none() {
                continue;
            }
            for &target in &self.star_tables[table] {
                let key = (self.files[target as usize], name);
                if self.index.contains_key(&key) && seen.insert(key) {
                    found.push(key);
                }
            }
        }
        found
    }

    pub(super) fn has_dynamic_names(&self, module: ModuleRef) -> bool {
        let Some(table) = self.find_table(module) else {
            return true;
        };
        match self.tables[table].dynamic_targets {
            DynamicStarTargets::Empty => false,
            DynamicStarTargets::One(_) | DynamicStarTargets::Many => true,
        }
    }

    pub(super) fn statements_ahead_of_stars(&self) -> impl Iterator<Item = Resolution> + '_ {
        self.statements_ahead_of_stars.iter().map(|it| it.1)
    }

    pub(super) fn find_statement_ahead_of_stars(
        &self,
        module: FileId,
        name: Atom,
    ) -> Option<Resolution> {
        let statements = &self.statements_ahead_of_stars;
        let key_of = |&((file, name), _): &(NodeKey, Resolution)| (file, name.0);
        let at = statements.binary_search_by_key(&(module, name.0), key_of);
        Some(statements[at.ok()?].1)
    }

    pub(super) fn find_statement_or_result(
        &self,
        module: FileId,
        name: Atom,
    ) -> Option<Resolution> {
        let statement = self.find_statement_ahead_of_stars(module, name);
        statement.or_else(|| {
            let node = *self.index.get(&(module, name))?;
            Some(self.results[node as usize].1.resolution)
        })
    }

    fn keep_names_that_mocks_may_settle(&mut self, scans: &Scans) {
        if !self.tables.iter().any(|table| table.may_be_mocked) {
            return;
        }
        let (mut statements, mut waiting) = (Vec::new(), Vec::new());
        for &file in &self.files {
            let own_count = self.own_names(file).len();
            for (position, &(name, resolved)) in self.names(file).iter().enumerate() {
                if resolved.resolution != Resolution::Ambiguous {
                    continue;
                }
                if position >= own_count {
                    let mut sources = self.files_that_stars_bring_name_from(file, name);
                    if let (Some(source), None) = (sources.next(), sources.next()) {
                        waiting.push(((file, name), (ModuleRef::File(source), name)));
                    }
                    continue;
                }
                let Some((site, listed)) = self.find_indirect_name(file, position) else {
                    continue;
                };
                if let ScannedSite::Module(exporter) = scans.of(file).sites[site as usize] {
                    statements.push(((file, name), (exporter, listed)));
                }
            }
        }
        let may_be_mocked = |file: &FileId| self.table_of(*file).is_some_and(|it| it.may_be_mocked);
        let is_searched_for_in_mock = |it: &(NodeKey, (ModuleRef, Atom))| match it.1 {
            (ModuleRef::File(file), name) => self
                .files_searched_for(file, name)
                .iter()
                .any(may_be_mocked),
            _ => false,
        };
        let (mut found, rest): (Vec<_>, Vec<_>) = statements
            .iter()
            .copied()
            .partition(is_searched_for_in_mock);
        waiting.extend(rest);
        while !found.is_empty() {
            self.names_that_mocks_may_settle.append(&mut found);
            (self.names_that_mocks_may_settle)
                .shared_sort_by_key(|&((file, name), _)| (file, name.0));
            let comes_from_name_kept = |it: &(NodeKey, (ModuleRef, Atom))| match it.1 {
                (ModuleRef::File(file), name) => {
                    self.find_name_that_mock_may_settle(file, name).is_some()
                }
                _ => false,
            };
            (found, waiting) = waiting.into_iter().partition(comes_from_name_kept);
        }
        let kept = &self.names_that_mocks_may_settle;
        self.failures.retain(|pending| {
            let ModuleFailureKind::ExportAmbiguous { exporter, name } = pending.failure.kind else {
                return true;
            };
            let importer = pending.failure.importer;
            !kept
                .iter()
                .any(|it| it.0.0 == importer && it.1 == (exporter, name))
        });
    }

    pub(super) fn find_name_that_mock_may_settle(
        &self,
        file: FileId,
        name: Atom,
    ) -> Option<(ModuleRef, Atom)> {
        let statements = &self.names_that_mocks_may_settle;
        let key_of = |&((file, name), _): &(NodeKey, (ModuleRef, Atom))| (file, name.0);
        let at = statements.binary_search_by_key(&(file, name.0), key_of);
        Some(statements[at.ok()?].1)
    }

    pub(super) fn find_where_names_lead(
        &self,
        mut module: ModuleRef,
        mut name: Atom,
    ) -> (ModuleRef, Atom) {
        for _ in 0..=self.names_that_mocks_may_settle.len() {
            let ModuleRef::File(file) = module else {
                break;
            };
            let Some(next) = self.find_name_that_mock_may_settle(file, name) else {
                break;
            };
            (module, name) = next;
        }
        (module, name)
    }

    pub(super) fn is_barrel_where_nothing_is_mocked(&self, exporter: ModuleRef) -> bool {
        !self.some_file_may_be_mocked && self.has_dynamic_names(exporter)
    }

    fn is_barrel_where_a_file_may_be_mocked(&self, exporter: ModuleRef) -> bool {
        let table = self.find_table(exporter).map(|table| &self.tables[table]);
        self.some_file_may_be_mocked
            && table.is_some_and(|table| {
                !table.may_be_mocked && !matches!(table.dynamic_targets, DynamicStarTargets::Empty)
            })
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

    pub(super) fn files_named_by_stars(&self, file: FileId) -> impl Iterator<Item = FileId> + '_ {
        let table = self.find_table(ModuleRef::File(file));
        let targets = table.map_or(&[][..], |table| &self.star_tables[table][..]);
        targets.iter().map(|&target| self.files[target as usize])
    }

    pub(super) fn files_that_stars_bring_name_from(
        &self,
        file: FileId,
        name: Atom,
    ) -> impl Iterator<Item = FileId> + '_ {
        let named = self.files_named_by_stars(file);
        named.filter(move |&named| self.index.contains_key(&(named, name)))
    }

    fn table_of(&self, file: FileId) -> Option<&FileTable> {
        let table = self.find_table(ModuleRef::File(file))?;
        Some(&self.tables[table])
    }
}

pub(super) fn find_ambiguous_names(
    files: &Files<'_>,
    tables: &ExportTables,
    file: FileId,
) -> Vec<Atom> {
    let names = tables.names(file).iter();
    let ambiguous = names.filter(|it| {
        it.1.resolution == Resolution::Ambiguous
            && (tables.find_name_that_mock_may_settle(file, it.0)).is_none()
    });
    let mut ambiguous: Vec<Atom> = ambiguous.map(|it| it.0).collect();
    let atoms = &files.atoms;
    ambiguous.shared_sort_unstable_by(|&a, &b| compare_code_units(atoms.bytes(a), atoms.bytes(b)));
    ambiguous
}

pub(super) fn finish_exports(
    files: &Files<'_>,
    tables: &ExportTables,
    scans: &Scans,
    synthetic: &SyntheticExports,
    file: FileId,
) -> Vec<ModuleExport> {
    let own_count = tables.own_names(file).len();
    let written_barrel = |position: usize| {
        let (site, name) = tables.find_indirect_name(file, position)?;
        match scans.of(file).sites[site as usize] {
            ScannedSite::Module(exporter) if tables.is_barrel_where_nothing_is_mocked(exporter) => {
                Some((exporter, name))
            }
            _ => None,
        }
    };
    let barrel_under_mocks = |position: usize| {
        if position >= own_count {
            return None;
        }
        let (site, name) = tables.find_indirect_name(file, position)?;
        match scans.of(file).sites[site as usize] {
            ScannedSite::Module(exporter)
                if tables.is_barrel_where_a_file_may_be_mocked(exporter) =>
            {
                Some((exporter, name))
            }
            _ => None,
        }
    };
    let barrel_compared_at_run_time = |position: usize| {
        let (site, name) = tables.find_indirect_name(file, position)?;
        match scans.of(file).sites[site as usize] {
            ScannedSite::Module(exporter @ ModuleRef::File(barrel))
                if tables.follows_every_star(barrel) =>
            {
                Some((exporter, name))
            }
            _ => None,
        }
    };
    let barrel_that_is_searched_here = |position: usize| match barrel_under_mocks(position)? {
        (ModuleRef::File(barrel), name)
            if tables.files_searched_for(barrel, name).contains(&file) =>
        {
            Some((ModuleRef::File(barrel), name))
        }
        _ => None,
    };
    let finish = |(position, &(exported_name, resolved)): (usize, &(Atom, ResolvedName))| {
        let own_statement = match position < own_count {
            true => tables.find_statement_ahead_of_stars(file, exported_name),
            false => None,
        };
        let binding = match own_statement.unwrap_or(resolved.resolution) {
            Resolution::Variable(symbol) => match barrel_that_is_searched_here(position) {
                Some((module, name)) => ExportBinding::Indirect { module, name },
                None => ExportBinding::Variable(symbol),
            },
            Resolution::Namespace { module, phase } => ExportBinding::Namespace { module, phase },
            Resolution::Synthetic { module, name } => {
                ExportBinding::Synthetic(synthetic.id_of(module, name))
            }
            Resolution::RuntimeMember { module, name } => {
                ExportBinding::Synthetic(synthetic.id_of(ModuleRef::Runtime(module), name))
            }
            Resolution::LiveName { module, name } => {
                let compared = match position < own_count && resolved.can_be_ambiguous() {
                    true => barrel_compared_at_run_time(position),
                    false => None,
                };
                let (module, name) = compared.unwrap_or((module, name));
                ExportBinding::Indirect { module, name }
            }
            Resolution::DynamicStar { module, name } if position < own_count => {
                let representative = (ModuleRef::File(module), name);
                let written = written_barrel(position).or_else(|| barrel_under_mocks(position));
                let (module, name) = written.unwrap_or(representative);
                ExportBinding::Indirect { module, name }
            }
            Resolution::Ambiguous => {
                let (module, name) = tables.find_name_that_mock_may_settle(file, exported_name)?;
                ExportBinding::Indirect { module, name }
            }
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
