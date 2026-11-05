pub(crate) mod entry_points;
pub(crate) mod load_names;
mod scan;
#[cfg(test)]
mod tests;
pub(crate) mod worker_entries;

use std::mem::{replace, take};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use bun_ast::Loader;
use bun_sema::atom::Atom;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;

#[cfg(test)]
pub(crate) use self::entry_points::FoundBecause;
pub(crate) use self::entry_points::{EntryPointFinder, FinderInput, FoundEntryPoint};
pub(crate) use self::load_names::NamedLoads;
use self::load_names::resolve_loads_through_imported_loaders;
pub(crate) use self::scan::{ScanInput, scan_file};
#[cfg(test)]
pub(crate) use self::worker_entries::WorkerNameForm;
pub(crate) use self::worker_entries::WorkerStart;
use crate::builtins::table::{self, BuiltinFlags, BuiltinId, BuiltinKind, Mutability, Scope};
use crate::ir::{InParallel, for_each_mut};
use crate::load::loaders::{HostLoaderKind, host_loader_kind};
use crate::load::sources::parsed_source;
use crate::module_keys::loader_by_name;
use crate::options::Options;
use crate::test_runs::files_of_run::find_whose_files;
use crate::test_runs::{
    RunContents, RunInput, WhoseFile, collect_run_contents, fix_places_on_the_way,
};

#[derive(Default)]
pub(crate) struct FileContents {
    pub names: NamedLoads,
    pub worker_starts: Vec<WorkerStart>,
    pub urls_with_code: Vec<Atom>,
    pub texts_behind_object_urls: Vec<(Atom, Option<Atom>)>,
    pub names_worker_constructor: bool,
    pub hands_worker_constructor_on: bool,
    pub starts_worker_out_of_sight: bool,
}

pub struct FixedBuiltins {
    is_fixed: Box<[AtomicBool]>,
}

impl Default for FixedBuiltins {
    fn default() -> FixedBuiltins {
        let members = 0..BuiltinId::COUNT;
        FixedBuiltins {
            is_fixed: members.map(|_| AtomicBool::new(false)).collect(),
        }
    }
}

impl FixedBuiltins {
    pub fn note(&self, member: BuiltinId) {
        self.is_fixed[member.to_wire() as usize].store(true, Ordering::Relaxed);
    }

    pub fn list(&self) -> Vec<BuiltinId> {
        let is_fixed =
            |member: &BuiltinId| self.is_fixed[member.to_wire() as usize].load(Ordering::Relaxed);
        let members = (0..BuiltinId::COUNT).filter_map(BuiltinId::from_wire);
        members.filter(is_fixed).collect()
    }
}

pub(crate) struct ProgramContents {
    pub found_entry_points: Vec<FoundEntryPoint>,
    pub replaced_builtins: Arc<[u32]>,
    pub fixed_builtins: FixedBuiltins,
    pub names_added_to_builtins: Vec<(BuiltinId, Atom)>,
    pub mocks_any_module: bool,
    pub stores_loader_functions: bool,
    pub any_module_loads_again: bool,
    pub loads_by_unknown_name: bool,
    pub loads_by_unknown_path: bool,
    pub embeds_addon_as_file: bool,
    pub names_worker_constructor: bool,
    pub hands_worker_constructor_on: bool,
    pub starts_worker_out_of_sight: bool,
    pub run: RunContents,
    pub any_file_may_become_main_module: bool,
}

pub(crate) struct ContentsInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub options: &'a Options<'a>,
    pub found_entry_points: Vec<FoundEntryPoint>,
    pub any_file_may_become_main_module: bool,
    pub in_parallel: InParallel<'a>,
}

const FILES_LOOKED_AT_IN_A_RUN: usize = 64;

struct LookInput<'a, 's> {
    files: &'a Files<'s>,
    is_test_run: bool,
    whose: &'a [WhoseFile],
}

fn mocks_module_that_it_does_not_spell(files: &Files<'_>, file: FileId) -> bool {
    let analysis = files.analysis(file);
    let is_spelled = |name: &ImportSpecifier| matches!(name, ImportSpecifier::Constant(_));
    analysis.import_sites.iter().any(|site| {
        let ImportSiteKind::MockModule(call) = site.kind else {
            return false;
        };
        !analysis.decisions.is_dead_expr(call)
            && !(analysis.alternatives_of(&site.specifier).iter()).all(is_spelled)
    })
}

#[derive(Default)]
struct FoundInFiles {
    replaced_members: Vec<BuiltinId>,
    opened_holders: Vec<BuiltinId>,
    names_added: Vec<(BuiltinId, Atom)>,
    mocks_any_module: bool,
    stores_loader_functions: bool,
    any_module_loads_again: bool,
    loads_by_unknown_name: bool,
    loads_by_unknown_path: bool,
    names_worker_constructor: bool,
    hands_worker_constructor_on: bool,
    starts_worker_out_of_sight: bool,
}

impl FoundInFiles {
    fn note_file_without_payload(&mut self) {
        *self = FoundInFiles {
            replaced_members: take(&mut self.replaced_members),
            opened_holders: take(&mut self.opened_holders),
            names_added: take(&mut self.names_added),
            mocks_any_module: true,
            stores_loader_functions: true,
            any_module_loads_again: true,
            loads_by_unknown_name: true,
            loads_by_unknown_path: true,
            names_worker_constructor: true,
            hands_worker_constructor_on: true,
            starts_worker_out_of_sight: true,
        };
    }

    fn look_at(&mut self, input: &LookInput<'_, '_>, file: FileId) {
        let files = input.files;
        let Some(source) = parsed_source(files, file) else {
            return self.note_file_without_payload();
        };
        let (builtins, contents) = (&source.builtins, &source.contents);
        self.names_added.extend_from_slice(builtins.names_added());
        if input.is_test_run && input.whose[file.idx()] != WhoseFile::OfProduct {
            (self.replaced_members).extend_from_slice(builtins.replaced_members());
            (self.opened_holders).extend_from_slice(builtins.opened_holders());
            let of_run = &source.of_run;
            for texts in [&of_run.in_texts_written, &of_run.in_texts_handed_on] {
                (self.replaced_members).extend_from_slice(&texts.replaced_members);
                self.opened_holders.extend_from_slice(&texts.opened_holders);
                self.names_added.extend_from_slice(&texts.names_added);
            }
        }
        let stores_loader_functions = builtins.stores_loader_functions();
        let mocks_any_module =
            builtins.hands_mock_on() || mocks_module_that_it_does_not_spell(files, file);
        let any_module_loads_again = !input.is_test_run
            && (!builtins.keys_taken_out_of_module_cache().is_empty()
                || builtins.loses_sight_of_module_cache()
                || builtins.resets_modules());
        let gives_unknown_name_to_imported_loader =
            resolve_loads_through_imported_loaders(files, file);
        let loads_by_unknown_name =
            contents.names.loads_by_unknown_name || gives_unknown_name_to_imported_loader;
        let loads_by_unknown_path =
            contents.names.loads_by_unknown_path || gives_unknown_name_to_imported_loader;
        self.append(FoundInFiles {
            replaced_members: Vec::new(),
            opened_holders: Vec::new(),
            names_added: Vec::new(),
            mocks_any_module,
            stores_loader_functions,
            any_module_loads_again,
            loads_by_unknown_name,
            loads_by_unknown_path,
            names_worker_constructor: contents.names_worker_constructor,
            hands_worker_constructor_on: contents.hands_worker_constructor_on,
            starts_worker_out_of_sight: contents.starts_worker_out_of_sight,
        });
    }

    fn append(&mut self, mut following: FoundInFiles) {
        self.replaced_members
            .append(&mut following.replaced_members);
        self.opened_holders.append(&mut following.opened_holders);
        self.names_added.append(&mut following.names_added);
        self.mocks_any_module |= following.mocks_any_module;
        self.stores_loader_functions |= following.stores_loader_functions;
        self.any_module_loads_again |= following.any_module_loads_again;
        self.loads_by_unknown_name |= following.loads_by_unknown_name;
        self.loads_by_unknown_path |= following.loads_by_unknown_path;
        self.names_worker_constructor |= following.names_worker_constructor;
        self.hands_worker_constructor_on |= following.hands_worker_constructor_on;
        self.starts_worker_out_of_sight |= following.starts_worker_out_of_sight;
    }
}

fn object_held_at(place: BuiltinId) -> BuiltinId {
    match table::has_flag(place, BuiltinFlags::IS_GLOBAL_OBJECT) {
        true => BuiltinId::GlobalThis,
        false => table::canonical_id(place),
    }
}

fn comes_with_holder(holder: BuiltinId, member: BuiltinId) -> bool {
    let entry = table::entry(member);
    let is_cheap = entry.mutability == Mutability::ConstantUnlessWritten;
    entry.mutability != Mutability::ChangesOnItsOwn
        && entry.scope == Scope::Realm
        && (is_cheap || holder != BuiltinId::GlobalThis)
}

fn is_locked_prototype(member: BuiltinId) -> bool {
    let entry = table::entry(member);
    entry.kind == BuiltinKind::Prototype && entry.mutability == Mutability::AlwaysLocked
}

fn may_be_taken_for_constant(place: BuiltinId) -> bool {
    let is_locked = |id: BuiltinId| table::entry(id).mutability == Mutability::AlwaysLocked;
    let entry = table::entry(place);
    entry.mutability != Mutability::ChangesOnItsOwn || entry.holder.is_some_and(is_locked)
}

struct ReplacedPlaces {
    is_listed: Vec<bool>,
    pending: Vec<BuiltinId>,
}

impl ReplacedPlaces {
    fn new() -> ReplacedPlaces {
        ReplacedPlaces {
            is_listed: vec![false; BuiltinId::COUNT as usize],
            pending: Vec::new(),
        }
    }

    fn add(&mut self, place: BuiltinId) {
        if !replace(&mut self.is_listed[place.to_wire() as usize], true) {
            self.pending.push(place);
        }
    }

    fn add_members_of(&mut self, holder: BuiltinId) {
        let object = object_held_at(holder);
        for &member in table::members(object) {
            if comes_with_holder(object, member) && !is_locked_prototype(member) {
                self.add(member);
            }
        }
    }

    fn add_members_transitively(&mut self) {
        while let Some(place) = self.pending.pop() {
            let object = object_held_at(place);
            if object != place {
                self.add(object);
                continue;
            }
            for &member in table::members(object) {
                if comes_with_holder(object, member) {
                    self.add(member);
                }
            }
        }
    }

    fn finish(self, given: &[u32]) -> Arc<[u32]> {
        let places = (0..BuiltinId::COUNT).filter_map(BuiltinId::from_wire);
        places
            .filter(|&place| self.is_listed[place.to_wire() as usize])
            .filter(|&place| {
                may_be_taken_for_constant(place) || given.binary_search(&place.to_wire()).is_ok()
            })
            .map(BuiltinId::to_wire)
            .collect()
    }
}

fn list_replaced_builtins(
    given: &[u32],
    replaced: &[BuiltinId],
    opened: &[BuiltinId],
) -> Arc<[u32]> {
    debug_assert!(given.is_sorted_by(|left, right| left < right));
    let mut places = ReplacedPlaces::new();
    for &number in given {
        if let Some(place) = BuiltinId::from_wire(number) {
            places.add(place);
        }
    }
    for &place in replaced {
        places.add(place);
    }
    for &holder in opened {
        places.add_members_of(holder);
    }
    places.add_members_transitively();
    places.finish(given)
}

fn embeds_addon_as_file(files: &Files<'_>) -> bool {
    files.compiled_files().iter().any(|&file| {
        let asked_for = files
            .compiled(file)
            .and_then(|compiled| host_loader_kind(compiled.loader));
        asked_for == Some(HostLoaderKind::Loader(Loader::File))
            && loader_by_name(files.module(file).file_name()) == Loader::Napi
    })
}

fn sort_names_added(names: &mut Vec<(BuiltinId, Atom)>, files: &Files<'_>) {
    let atoms = &files.atoms;
    names.shared_sort_unstable_by(|left, right| {
        let by_name = || atoms.bytes(left.1).cmp(atoms.bytes(right.1));
        left.0.cmp(&right.0).then_with(by_name)
    });
    names.dedup();
}

pub(crate) fn collect_program_contents(input: ContentsInput<'_, '_>) -> ProgramContents {
    let ContentsInput {
        files,
        options,
        found_entry_points,
        any_file_may_become_main_module,
        in_parallel,
    } = input;
    let is_test_run = options.load.runs_tests && !options.aot.checks_only;
    let run_input = RunInput {
        files,
        options,
        replaced_builtins: &[],
        in_parallel,
    };
    let whose_files = is_test_run.then(|| find_whose_files(&run_input));
    let look_input = LookInput {
        files,
        is_test_run,
        whose: whose_files.as_ref().map_or(&[], |(whose, _)| whose),
    };
    let runs = files.compiled_files().chunks(FILES_LOOKED_AT_IN_A_RUN);
    let mut runs: Vec<(&[FileId], FoundInFiles)> =
        runs.map(|run| (run, FoundInFiles::default())).collect();
    for_each_mut(&mut runs, in_parallel, &|(run, found)| {
        for &file in run.iter() {
            found.look_at(&look_input, file);
        }
    });
    let mut all = FoundInFiles::default();
    for (_, found) in runs {
        all.append(found);
    }
    let replaced_builtins = list_replaced_builtins(
        &options.load.replaced_builtins,
        &all.replaced_members,
        &all.opened_holders,
    );
    let run = match whose_files {
        Some(whose_files) => collect_run_contents(
            RunInput {
                replaced_builtins: &replaced_builtins,
                ..run_input
            },
            whose_files,
        ),
        None => RunContents::default(),
    };
    all.names_added.extend_from_slice(&run.names_added);
    sort_names_added(&mut all.names_added, files);
    let fixed_builtins = FixedBuiltins::default();
    if is_test_run {
        for &file in files.compiled_files() {
            if let Some(source) = parsed_source(files, file) {
                source
                    .builtins
                    .unlock(Arc::clone(&run.members_written_as_reads));
                fix_places_on_the_way(&source.builtins, &fixed_builtins);
            }
        }
    }
    ProgramContents {
        found_entry_points,
        replaced_builtins,
        fixed_builtins,
        names_added_to_builtins: all.names_added,
        mocks_any_module: all.mocks_any_module
            || run.mocks_any_module
            || all.stores_loader_functions,
        stores_loader_functions: all.stores_loader_functions,
        any_module_loads_again: match is_test_run {
            true => run.loads.is_every_file,
            false => all.any_module_loads_again,
        },
        loads_by_unknown_name: all.loads_by_unknown_name,
        loads_by_unknown_path: all.loads_by_unknown_path,
        embeds_addon_as_file: embeds_addon_as_file(files),
        names_worker_constructor: all.names_worker_constructor,
        hands_worker_constructor_on: all.hands_worker_constructor_on,
        starts_worker_out_of_sight: all.starts_worker_out_of_sight,
        run,
        any_file_may_become_main_module,
    }
}
