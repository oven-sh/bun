use super::ModuleRef;
use super::bindings::{ModuleRequest, RequiredName, SyntheticExportId};
use super::graph::ModuleGraph;
use super::interop::{ModuleKind, SyntheticExportRule};
use crate::ir::generated::ModuleRequestKind;
use bun_sema::components::strongly_connected_components;
use bun_sema::program::FileId;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use core::mem::replace;
use std::collections::VecDeque;

type KeepsRequest<'a> = &'a dyn Fn(ModuleRef, &ModuleRequest) -> bool;

const ANSWERS_IN_A_MASK: u32 = u64::BITS;

#[derive(Copy, Clone)]
struct Edge {
    target: FileId,
    is_dropped: bool,
}

#[derive(Copy, Clone)]
struct Lookup {
    importer: FileId,
    answer: u32,
}

struct ImportEdges {
    by_importer: Vec<Vec<Edge>>,
    is_behind_dropped_edge: Vec<bool>,
}

impl ImportEdges {
    fn collect(graph: &ModuleGraph, keeps: KeepsRequest<'_>) -> ImportEdges {
        let file_count = graph.row_by_file.len();
        let mut by_importer: Vec<Vec<Edge>> = vec![Vec::new(); file_count];
        let mut pending: Vec<FileId> = Vec::new();
        for &importer in graph.record_files() {
            for request in graph.requests(importer) {
                let ModuleRef::File(target) = request.target else {
                    continue;
                };
                if request.kind != ModuleRequestKind::Import {
                    continue;
                }
                let is_dropped = !keeps(ModuleRef::File(importer), request);
                by_importer[importer.idx()].push(Edge { target, is_dropped });
                if is_dropped {
                    pending.push(target);
                }
            }
        }
        let mut is_behind_dropped_edge = vec![false; file_count];
        while let Some(file) = pending.pop() {
            if !replace(&mut is_behind_dropped_edge[file.idx()], true) {
                pending.extend(by_importer[file.idx()].iter().map(|edge| edge.target));
            }
        }
        ImportEdges {
            by_importer,
            is_behind_dropped_edge,
        }
    }

    fn kept_targets(&self, importer: FileId) -> impl Iterator<Item = FileId> + '_ {
        let edges = self.by_importer[importer.idx()].iter();
        let kept = edges.filter(|edge| !edge.is_dropped);
        kept.map(|edge| edge.target)
    }

    fn may_become_unreachable(&self, importer: FileId, answer: &[FileId]) -> bool {
        let may_lose_path = |file: &FileId| self.is_behind_dropped_edge[file.idx()];
        answer.iter().any(may_lose_path)
            && !self.kept_targets(importer).any(|it| answer.contains(&it))
    }

    fn find_cut_off(&self, mut lookups: Vec<Lookup>, answers: &[&[FileId]]) -> Vec<Lookup> {
        if lookups.is_empty() {
            return lookups;
        }
        lookups.shared_sort_unstable_by_key(|lookup| lookup.answer);
        let files = (0..self.by_importer.len() as u32).map(FileId);
        let kept: Vec<Vec<u32>> = files
            .map(|file| self.kept_targets(file).map(|target| target.0).collect())
            .collect();
        let (component_of, components) = strongly_connected_components(&kept);
        let mut cut_off = Vec::new();
        let mut reached = vec![0u64; components.len()];
        let mask_of = |lookup: &Lookup| lookup.answer / ANSWERS_IN_A_MASK;
        for batch in lookups.chunk_by(|a, b| mask_of(a) == mask_of(b)) {
            reached.fill(0);
            let first = mask_of(&batch[0]) * ANSWERS_IN_A_MASK;
            let of_batch = answers[first as usize..].iter().zip(0..ANSWERS_IN_A_MASK);
            for (answer, bit) in of_batch {
                for file in *answer {
                    reached[component_of[file.idx()] as usize] |= 1 << bit;
                }
            }
            for (component, members) in components.iter().enumerate() {
                let targets = members.iter().flat_map(|&member| &kept[member]);
                let masks = targets.map(|&target| reached[component_of[target as usize] as usize]);
                reached[component] |= masks.fold(0, |all, mask| all | mask);
            }
            let is_cut_off = |lookup: &&Lookup| {
                let mask = reached[component_of[lookup.importer.idx()] as usize];
                mask >> (lookup.answer - first) & 1 == 0
            };
            cut_off.extend(batch.iter().filter(is_cut_off));
        }
        cut_off
    }

    fn mark_files_linked_from(&self, root: FileId) -> Vec<bool> {
        let mut is_linked = vec![false; self.by_importer.len()];
        let mut pending = vec![root];
        while let Some(file) = pending.pop() {
            if !replace(&mut is_linked[file.idx()], true) {
                pending.extend(self.kept_targets(file));
            }
        }
        is_linked
    }

    fn find_dropped_edges_to(&self, importer: FileId, answer: &[FileId]) -> Vec<(FileId, FileId)> {
        let mut direct = self.by_importer[importer.idx()].iter();
        if let Some(edge) = direct.find(|edge| answer.contains(&edge.target)) {
            return vec![(importer, edge.target)];
        }
        let mut reached_by: FxHashMap<FileId, (FileId, bool)> = FxHashMap::default();
        let mut pending = VecDeque::from([(importer, None)]);
        while let Some((file, step)) = pending.pop_front() {
            if reached_by.contains_key(&file) || (file == importer && step.is_some()) {
                continue;
            }
            reached_by.extend(step.map(|step| (file, step)));
            if answer.contains(&file) {
                let mut dropped = Vec::new();
                let mut target = file;
                while let Some(&(source, is_dropped)) = reached_by.get(&target) {
                    if is_dropped {
                        dropped.push((source, target));
                    }
                    target = source;
                }
                return dropped;
            }
            for &Edge { target, is_dropped } in &self.by_importer[file.idx()] {
                let next = (target, Some((file, is_dropped)));
                match is_dropped {
                    true => pending.push_back(next),
                    false => pending.push_front(next),
                }
            }
        }
        Vec::new()
    }
}

impl ModuleGraph {
    pub fn find_imports_of_lookups(
        &self,
        left_out_files: &[FileId],
        keeps: KeepsRequest<'_>,
    ) -> FxHashSet<(FileId, FileId)> {
        let is_alive = |file: FileId| left_out_files.binary_search(&file).is_err();
        let edges = ImportEdges::collect(self, keeps);
        let mut needed = FxHashSet::default();
        self.add_imports_of_required_names(&edges, &is_alive, &mut needed);
        self.add_imports_of_checked_names(&edges, &is_alive, &mut needed);
        needed
    }

    fn add_imports_of_required_names(
        &self,
        edges: &ImportEdges,
        is_alive: &dyn Fn(FileId) -> bool,
        needed: &mut FxHashSet<(FileId, FileId)>,
    ) {
        let is_always_looked_up = |required: &RequiredName| {
            let rule = self.interop(required.module).export_rule;
            !required.is_found_unless_mocked || rule == SyntheticExportRule::RuntimeModule
        };
        let mut index_by_exporter: FxHashMap<FileId, u32> = FxHashMap::default();
        let mut exporters: Vec<[FileId; 1]> = Vec::new();
        let mut lookups = Vec::new();
        for &importer in self.record_files().iter().filter(|&&file| is_alive(file)) {
            for required in self.required_names(importer) {
                if let ModuleRef::File(exporter) = required.module
                    && exporter != importer
                    && self.has_record(exporter)
                    && is_alive(exporter)
                    && is_always_looked_up(required)
                    && edges.may_become_unreachable(importer, &[exporter])
                {
                    let answer = *index_by_exporter.entry(exporter).or_insert_with(|| {
                        exporters.push([exporter]);
                        exporters.len() as u32 - 1
                    });
                    lookups.push(Lookup { importer, answer });
                }
            }
        }
        let answers: Vec<&[FileId]> = exporters.iter().map(|it| &it[..]).collect();
        for Lookup { importer, answer } in edges.find_cut_off(lookups, &answers) {
            needed.extend(edges.find_dropped_edges_to(importer, answers[answer as usize]));
        }
    }

    fn add_imports_of_checked_names(
        &self,
        edges: &ImportEdges,
        is_alive: &dyn Fn(FileId) -> bool,
        needed: &mut FxHashSet<(FileId, FileId)>,
    ) {
        let roots = self.list_roots_left_to_loader();
        let roots: Vec<FileId> = roots
            .filter(|&root| is_alive(root) && !self.commonjs().checked_copies(root).is_empty())
            .collect();
        if roots.is_empty() {
            return;
        }
        let mut facades: FxHashMap<SyntheticExportId, Vec<FileId>> = FxHashMap::default();
        for &file in self.record_files() {
            if is_alive(file) && self.kind(file) == ModuleKind::CommonJs {
                for &copy in self.commonjs().copies(file) {
                    facades.entry(copy).or_default().push(file);
                }
            }
        }
        let mut index_by_facades: FxHashMap<&[FileId], u32> = FxHashMap::default();
        let mut answers: Vec<&[FileId]> = Vec::new();
        let mut lookups = Vec::new();
        let mut is_listed = vec![false; self.failures().len()];
        for &root in &roots {
            for &(copy, failure) in self.commonjs().checked_copies(root) {
                if replace(&mut is_listed[failure.0 as usize], true) {
                    continue;
                }
                let importer = self.failure(failure).importer;
                if let Some(facades) = facades.get(&copy)
                    && is_alive(importer)
                    && edges.may_become_unreachable(importer, facades)
                {
                    let answer = *index_by_facades.entry(facades).or_insert_with(|| {
                        answers.push(facades);
                        answers.len() as u32 - 1
                    });
                    lookups.push(Lookup { importer, answer });
                }
            }
        }
        let cut_off = edges.find_cut_off(lookups, &answers).into_iter();
        let cut_off: FxHashSet<(FileId, &[FileId])> = cut_off
            .map(|lookup| (lookup.importer, answers[lookup.answer as usize]))
            .collect();
        if cut_off.is_empty() {
            return;
        }
        for root in roots {
            let checks = self.commonjs().checked_copies(root).iter();
            let checks = checks.filter_map(|&(copy, failure)| {
                let check = (self.failure(failure).importer, &facades.get(&copy)?[..]);
                cut_off.contains(&check).then_some(check)
            });
            let checks: FxHashSet<(FileId, &[FileId])> = checks.collect();
            if checks.is_empty() {
                continue;
            }
            let is_linked = edges.mark_files_linked_from(root);
            for (importer, facades) in checks {
                if is_linked[importer.idx()] && !facades.iter().any(|it| is_linked[it.idx()]) {
                    needed.extend(edges.find_dropped_edges_to(importer, facades));
                }
            }
        }
    }
}
