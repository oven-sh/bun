use super::ModuleRef;
use super::exports::ExportTables;
use super::imports::MockedModules;
use super::module_set::ModuleSet;
use super::requests::{ScannedSite, Scans};
use bun_sema::atom::Atom;
use bun_sema::program::FileId;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};

pub(super) struct NamesHandedOn<'a> {
    scans: &'a Scans,
    tables: &'a ExportTables,
    leads_to_mock: FxHashSet<FileId>,
    is_any_module_mocked: bool,
    mocks_any_module: bool,
}

impl<'a> NamesHandedOn<'a> {
    pub(super) fn find(
        scans: &'a Scans,
        tables: &'a ExportTables,
        modules: &ModuleSet,
        mocked: &MockedModules,
        named_by_mocks: &FxHashSet<ModuleRef>,
        mocks_any_module: bool,
    ) -> NamesHandedOn<'a> {
        NamesHandedOn {
            scans,
            tables,
            leads_to_mock: find_files_that_lead_to_mocks(scans, tables, modules, named_by_mocks),
            is_any_module_mocked: mocked.is_every_module()
                || mocked.iter().next().is_some()
                || !named_by_mocks.is_empty(),
            mocks_any_module,
        }
    }

    pub(super) fn names_of(
        &self,
        file: FileId,
        is_compiled: bool,
    ) -> Vec<(Atom, (ModuleRef, Atom))> {
        if !is_compiled || !self.is_any_module_mocked {
            return Vec::new();
        }
        let names = self.tables.own_names(file).iter().enumerate();
        let handed_on = names.filter_map(|(position, &(name, _))| {
            let named = find_what_statement_names(self.scans, self.tables, file, position)?;
            Some((name, named))
        });
        let mut handed_on: Vec<(Atom, (ModuleRef, Atom))> = handed_on.collect();
        handed_on.shared_sort_unstable_by_key(|&(name, _)| name.0);
        handed_on
    }

    pub(super) fn files_named_by_stars(&self, file: FileId, is_compiled: bool) -> Vec<FileId> {
        if !is_compiled || !self.is_any_module_mocked {
            return Vec::new();
        }
        let named = self.tables.files_named_by_stars(file);
        named
            .filter(|next| self.mocks_any_module || self.leads_to_mock.contains(next))
            .collect()
    }

    pub(super) fn names_of_unlisted_stars(
        &self,
        file: FileId,
        is_compiled: bool,
    ) -> Vec<(Atom, FileId)> {
        let leads_to_mock = |file: &FileId| self.leads_to_mock.contains(file);
        if !is_compiled || self.mocks_any_module || !leads_to_mock(&file) {
            return Vec::new();
        }
        let stars = self.tables.files_named_by_stars(file);
        let unlisted: Vec<FileId> = stars.filter(|next| !leads_to_mock(next)).collect();
        if unlisted.is_empty() {
            return Vec::new();
        }
        let own_count = self.tables.own_names(file).len();
        let from_stars = self.tables.names(file)[own_count..].iter();
        let from_stars: FxHashSet<Atom> = from_stars.map(|&(name, _)| name).collect();
        let requested = self.scans.of(file).sites.iter();
        let listed = requested.filter_map(|site| match site {
            ScannedSite::Module(ModuleRef::File(target)) if leads_to_mock(target) => Some(*target),
            _ => None,
        });
        let names = listed.flat_map(|target| self.tables.names(target));
        let names = names.map(|&(name, _)| name);
        let listed_too: FxHashSet<Atom> = names.filter(|name| from_stars.contains(name)).collect();
        let mut found: Vec<(Atom, FileId)> = Vec::new();
        for &star in &unlisted {
            let names = self.tables.names(star).iter().map(|&(name, _)| name);
            let names = names.filter(|name| listed_too.contains(name));
            found.extend(names.map(|name| (name, star)));
        }
        found.shared_sort_unstable_by_key(|&(name, star)| (name.0, star));
        found
    }

    pub(super) fn names_from_stars(&self, file: FileId, is_compiled: bool) -> Vec<Atom> {
        if self.files_named_by_stars(file, is_compiled).is_empty() {
            return Vec::new();
        }
        let own_count = self.tables.own_names(file).len();
        let names = self.tables.names(file)[own_count..].iter();
        let mut names: Vec<Atom> = names.map(|&(name, _)| name).collect();
        names.shared_sort_unstable_by_key(|name| name.0);
        names
    }
}

fn find_what_statement_names(
    scans: &Scans,
    tables: &ExportTables,
    file: FileId,
    position: usize,
) -> Option<(ModuleRef, Atom)> {
    let (site, asked) = tables.find_indirect_name(file, position)?;
    match scans.of(file).sites[site as usize] {
        ScannedSite::Module(target) => Some((target, asked)),
        _ => None,
    }
}

fn find_files_that_lead_to_mocks(
    scans: &Scans,
    tables: &ExportTables,
    modules: &ModuleSet,
    named_by_mocks: &FxHashSet<ModuleRef>,
) -> FxHashSet<FileId> {
    let files_of_mocks = named_by_mocks.iter().filter_map(|&module| match module {
        ModuleRef::File(file) => Some(file),
        _ => None,
    });
    let mut leading: FxHashSet<FileId> = files_of_mocks.collect();
    if leading.is_empty() {
        return leading;
    }
    let mut named_from: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    for &file in &modules.compiled_files {
        let positions = 0..tables.own_names(file).len();
        let by_name = positions.filter_map(|position| {
            match find_what_statement_names(scans, tables, file, position)? {
                (ModuleRef::File(target), _) => Some(target),
                _ => None,
            }
        });
        for target in tables.files_named_by_stars(file).chain(by_name) {
            let from = named_from.entry(target).or_default();
            if from.last() != Some(&file) {
                from.push(file);
            }
        }
    }
    let mut pending: Vec<FileId> = leading.iter().copied().collect();
    while let Some(file) = pending.pop() {
        for &from in named_from.get(&file).into_iter().flatten() {
            if leading.insert(from) {
                pending.push(from);
            }
        }
    }
    leading
}
