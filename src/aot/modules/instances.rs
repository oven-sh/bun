use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::FileId;

use super::graph::{ModuleGraph, StoredSiteAnswer};
use super::interop::ImportPhase;
use super::reexport_paths::{PathStep, ReexportPath, Reexports, Request};
use super::{ExportBinding, ImportBinding, ModuleKind, ModuleRef};
use crate::builtins::RuntimeModule;
use crate::ir::generated::ModuleRequestKind;
use bun_sema::util::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

pub struct InstanceLayout {
    exports: Vec<SymbolId>,
    links: Vec<FileId>,
    mocks: Vec<ModuleRef>,
    reexports: Vec<ReexportPath>,
    places_of_reexports: FxHashMap<ReexportPath, u32>,
}

impl InstanceLayout {
    pub fn exports(&self) -> &[SymbolId] {
        &self.exports
    }

    pub fn links(&self) -> &[FileId] {
        &self.links
    }

    pub fn mocks(&self) -> &[ModuleRef] {
        &self.mocks
    }

    pub fn reexports(&self) -> &[ReexportPath] {
        &self.reexports
    }

    pub fn field_of_export(&self, symbol: SymbolId) -> Option<u32> {
        let place = self.exports.binary_search(&symbol).ok()?;
        Some(place as u32)
    }

    pub fn field_of_link(&self, target: FileId) -> Option<u32> {
        let place = self.links.binary_search(&target).ok()?;
        Some((self.exports.len() + place) as u32)
    }

    pub fn field_of_mock(&self, target: ModuleRef) -> Option<u32> {
        let place = self.mocks.iter().position(|&mock| mock == target)?;
        Some((self.exports.len() + self.links.len() + place) as u32)
    }

    pub fn holds_mock_of(&self, file: FileId) -> bool {
        self.field_of_mock(ModuleRef::File(file)).is_some()
    }

    pub fn field_of_namespace(&self, phase: ImportPhase) -> u32 {
        let first = (self.exports.len() + self.links.len() + self.mocks.len()) as u32;
        match phase {
            ImportPhase::Evaluation => first,
            ImportPhase::Defer => first + 1,
        }
    }

    pub fn field_of_scope(&self) -> u32 {
        self.field_of_namespace(ImportPhase::Defer) + 1
    }

    pub fn field_of_reexport(&self, path: ReexportPath) -> Option<u32> {
        let place = self.places_of_reexports.get(&path)?;
        Some(self.field_of_scope() + 1 + place)
    }
}

fn chain_to(met: &[(Request, usize)], mut place: usize) -> Vec<Request> {
    let mut chain = vec![met[place].0];
    while place != 0 {
        place = met[place].1;
        chain.push(met[place].0);
    }
    chain.reverse();
    chain
}

impl ModuleGraph {
    pub fn has_instances(&self, file: FileId) -> bool {
        self.is_reloadable(file)
            && self.kind(file) == ModuleKind::SourceText
            && !self.is_left_out(ModuleRef::File(file))
    }

    pub fn instance_layout(&self, file: FileId) -> Option<&InstanceLayout> {
        if !self.has_instances(file) {
            return None;
        }
        Some(self.instance_layouts[file.idx()].get_or_init(|| self.compute_instance_layout(file)))
    }

    fn compute_instance_layout(&self, file: FileId) -> InstanceLayout {
        let own_variables = self.exports(file).iter().filter_map(|export| {
            let ExportBinding::Variable(variable) = export.binding else {
                return None;
            };
            let is_declared_here = variable.file == file
                && self.import_binding(file, variable.id) == ImportBinding::Local;
            is_declared_here.then_some(variable.id)
        });
        let mut exports: Vec<SymbolId> = own_variables.collect();
        exports.sort_unstable();
        exports.dedup();
        let requests = self.requests_of(ModuleRef::File(file)).iter();
        let imported = requests
            .filter(|request| request.kind == ModuleRequestKind::Import && !request.is_hoisted);
        let targets = imported.filter_map(|request| match request.target {
            ModuleRef::File(target) | ModuleRef::Facade(target) => Some(target),
            _ => None,
        });
        let mut targets: Vec<FileId> = targets.collect();
        targets.sort_unstable();
        targets.dedup();
        let may_hold_mock =
            |target: &FileId| *target != file && self.holds_mock_in_variable(*target);
        let mocked_files = targets.iter().copied().filter(may_hold_mock);
        let mut mocks: Vec<ModuleRef> = mocked_files.map(ModuleRef::File).collect();
        for built_in in self.runtime_modules_of_statements(file) {
            let built_in = ModuleRef::Runtime(built_in);
            if self.is_named_by_mock(built_in) && !mocks.contains(&built_in) {
                mocks.push(built_in);
            }
        }
        for request in self.requests_of(ModuleRef::File(file)) {
            if self.is_absent_module(request.target) && !mocks.contains(&request.target) {
                mocks.push(request.target);
            }
        }
        targets.retain(|&target| self.has_instances(target));
        let links = targets;
        let mut reexports = Vec::new();
        let mut places_of_reexports = FxHashMap::default();
        for export in self
            .exports(file)
            .iter()
            .filter(|it| it.is_read_from_object)
        {
            let Some(path) = self.find_reexport_path(file, export.name, export.binding) else {
                continue;
            };
            let PathStep {
                file: next, rest, ..
            } = self.path_step(path);
            let is_direct = rest.is_none() && links.binary_search(&next).is_ok();
            if !is_direct && !places_of_reexports.contains_key(&path) {
                places_of_reexports.insert(path, reexports.len() as u32);
                reexports.push(path);
            }
        }
        InstanceLayout {
            exports,
            links,
            mocks,
            reexports,
            places_of_reexports,
        }
    }

    pub fn field_of_path(&self, holder: FileId, path: ReexportPath) -> Option<u32> {
        let fields = self.instance_layout(holder)?;
        let PathStep { file, rest, .. } = self.path_step(path);
        let direct = match rest {
            None => fields.field_of_link(file),
            Some(_) => None,
        };
        direct.or_else(|| fields.field_of_reexport(path))
    }

    pub fn split_path(&self, path: ReexportPath) -> (Vec<FileId>, Option<u32>) {
        let mut files = Vec::new();
        let mut at = Some(path);
        while let Some(path) = at {
            let PathStep { file, rest, .. } = self.path_step(path);
            files.push(file);
            let fields = rest.and_then(|rest| Some((self.instance_layout(file)?, rest)));
            if let Some(field) = fields.and_then(|(fields, rest)| fields.field_of_reexport(rest)) {
                return (files, Some(field));
            }
            at = rest;
        }
        (files, None)
    }

    fn runtime_modules_of_statements(&self, file: FileId) -> Vec<RuntimeModule> {
        if self.is_library(file) {
            return Vec::new();
        }
        let sites = self.row(file).sites.iter();
        let built_ins = sites.filter_map(|(site, answer)| match (site, answer) {
            (
                ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_),
                StoredSiteAnswer::Module(ModuleRef::Runtime(built_in)),
            ) => Some(*built_in),
            _ => None,
        });
        built_ins.collect()
    }

    pub(super) fn reexports_of_name(&self, file: FileId, name: Atom) -> Reexports {
        match self.find_what_hands_on_names(file, name) {
            Some((ModuleRef::File(next), listed)) => smallvec![(next, listed)],
            Some(_) => SmallVec::new(),
            None => {
                let stars = &self.row(file).name_stars;
                let first = stars.partition_point(|it| it.0.0 < name.0);
                let stars = stars[first..].iter().take_while(|it| it.0 == name);
                stars.map(|it| (it.1, name)).collect()
            }
        }
    }

    fn find_reexport_chain(
        &self,
        file: FileId,
        name: Atom,
        is_end: impl Fn(Request, &[Request]) -> bool,
    ) -> Option<Vec<Request>> {
        let mut met = vec![((file, name), 0)];
        let mut waiting = vec![0];
        let mut visited = FxHashSet::default();
        while let Some(place) = waiting.pop() {
            let request = met[place].0;
            if !visited.insert(request) {
                continue;
            }
            let reexports = self.reexports_of_name(request.0, request.1);
            if is_end(request, &reexports) {
                return Some(chain_to(&met, place));
            }
            for &next in reexports.iter().rev() {
                met.push((next, place));
                waiting.push(met.len() - 1);
            }
        }
        None
    }

    fn files_with_instances(&self, chain: &[Request]) -> Vec<FileId> {
        let files = chain.iter().map(|it| it.0);
        files.filter(|&file| self.has_instances(file)).collect()
    }

    fn ends_of_binding(&self, binding: ExportBinding) -> SmallVec<[Option<FileId>; 2]> {
        let declaring_file = match binding {
            ExportBinding::Variable(variable) => Some(variable.file),
            ExportBinding::Synthetic(export) => match self.synthetic_export(export).module {
                ModuleRef::File(declaring_file) => Some(declaring_file),
                _ => None,
            },
            _ => None,
        };
        match declaring_file {
            Some(_) => smallvec![declaring_file, None],
            None => smallvec![None],
        }
    }

    pub fn find_reexport_of_binding(
        &self,
        file: FileId,
        name: Atom,
        binding: ExportBinding,
        is_found: impl FnMut(Request) -> bool,
    ) -> Option<Request> {
        self.find_reexport_passed((file, name), &self.ends_of_binding(binding), is_found)
    }

    #[cfg(test)]
    pub(super) fn find_path_to_declaration(
        &self,
        file: FileId,
        name: Atom,
        declaring_file: FileId,
    ) -> Option<Vec<FileId>> {
        let chain = self.find_reexport_chain(file, name, |(file, _), _| file == declaring_file)?;
        let path = self.files_with_instances(&chain);
        (path.last() == Some(&declaring_file)).then_some(path)
    }

    pub fn find_path_to_module(
        &self,
        file: FileId,
        name: Atom,
        target: FileId,
    ) -> Option<Vec<FileId>> {
        let requests_target = |file: FileId| {
            let fields = self.instance_layout(file);
            fields.is_some_and(|fields| fields.field_of_link(target).is_some())
        };
        let mut chain = self.find_reexport_chain(file, name, |(file, _), reexports| {
            file == target || (reexports.is_empty() && requests_target(file))
        })?;
        if chain[chain.len() - 1].0 != target {
            chain.push((target, name));
        }
        let path = self.files_with_instances(&chain);
        (path.last() == Some(&target)).then_some(path)
    }

    pub fn find_module_holders(
        &self,
        file: FileId,
        name: Atom,
        target: ModuleRef,
    ) -> Option<Vec<FileId>> {
        let requests_target = |file: FileId| {
            let fields = self.instance_layout(file)?;
            let link = match target {
                ModuleRef::File(target) => fields.field_of_link(target),
                _ => None,
            };
            link.or_else(|| fields.field_of_mock(target))
        };
        let is_target = |file: FileId| ModuleRef::File(file) == target;
        let chain = self.find_reexport_chain(file, name, |(file, _), reexports| {
            (reexports.is_empty() || reexports.iter().any(|it| is_target(it.0)))
                && requests_target(file).is_some()
        })?;
        Some(self.files_with_instances(&chain))
    }

    pub fn find_path_to_holder(
        &self,
        file: FileId,
        name: Atom,
        holder: FileId,
    ) -> Option<Vec<FileId>> {
        if let Some(path) = self.find_path_to_module(file, name, holder) {
            return Some(path);
        }
        let mut met = vec![(file, name, 0)];
        let mut place = 0;
        while let Some(&(passed, name, _)) = met.get(place) {
            if passed == holder {
                let mut path = Vec::new();
                loop {
                    path.push(met[place].0);
                    if place == 0 {
                        break;
                    }
                    place = met[place].2;
                }
                path.retain(|&file| self.has_instances(file));
                path.reverse();
                return Some(path);
            }
            let stars = self.requests(passed).iter();
            let stars = stars.filter(|it| it.is_star_export || it.is_dynamic_star_export);
            let stars = stars.filter_map(|star| match star.target {
                ModuleRef::File(next) => Some((next, name)),
                _ => None,
            });
            for (next, name) in self
                .reexports_of_name(passed, name)
                .into_iter()
                .chain(stars)
            {
                if !met.iter().any(|it| it.0 == next) {
                    met.push((next, name, place));
                }
            }
            place += 1;
        }
        None
    }

    pub fn find_reexport_path(
        &self,
        file: FileId,
        name: Atom,
        binding: ExportBinding,
    ) -> Option<ReexportPath> {
        let ends = self.ends_of_binding(binding);
        match binding {
            ExportBinding::Variable(variable)
                if variable.file != file && self.has_instances(variable.file) =>
            {
                let path = self.find_path_behind((file, name), &ends, None);
                let leads_to_file =
                    |path: &ReexportPath| self.path_step(*path).target == variable.file;
                let path = path.filter(leads_to_file);
                path.or_else(|| self.intern_path(&[variable.file]))
            }
            ExportBinding::Namespace {
                module: ModuleRef::File(target),
                ..
            } if self.has_instances(target) => {
                self.find_path_behind((file, name), &ends, Some(target))
            }
            _ => None,
        }
    }
}
