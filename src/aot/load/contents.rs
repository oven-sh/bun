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
use crate::test_runs::{RunContents, RunInput, WhoseFile, collect_run_contents};

#[derive(Default)]
pub(crate) struct FileContents {
    pub names: NamedLoads,
    /// In the order of the text.
    pub worker_starts: Vec<WorkerStart>,
    /// Each `data:` URL that a `new Worker(..)` is given, and each that the file writes as a value and that names a type of code: it may come to a constructor through
    /// a variable, a parameter, a list, a property. Nothing is followed. With repeats.
    pub urls_with_code: Vec<Atom>,
    /// What the Blob holds of each `URL.createObjectURL(new Blob([..], { type }))` that a `new Worker(..)` is given, with the type that is written, and the text of each
    /// `new Worker(text, { eval: true })`. With repeats.
    pub texts_behind_object_urls: Vec<(Atom, Option<Atom>)>,
    /// By binding: the global `Worker`, or `Worker` of node:worker_threads, is named in code that is not dead.
    pub names_worker_constructor: bool,
    /// The constructor goes somewhere as a value, so nobody sees what it is called with.
    pub hands_worker_constructor_on: bool,
    /// A `new Worker(..)` whose first argument the load has not read as the name of a file: it holds the code itself (`data:`, `blob:`), or nobody knows its value.
    pub starts_worker_out_of_sight: bool,
}

/// The members of built-in objects that this build has folded by: it has left a lookup out, because no file of the run spells a store to the member.
/// Written by whoever folds, read once, where the program is linked. The engine keeps each locked, so a store that no file spells throws and names the member.
pub struct FixedBuiltins {
    /// By `BuiltinId::to_wire()`.
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

    /// Ascending.
    pub fn list(&self) -> Vec<BuiltinId> {
        let is_fixed =
            |member: &BuiltinId| self.is_fixed[member.to_wire() as usize].load(Ordering::Relaxed);
        let members = (0..BuiltinId::COUNT).filter_map(BuiltinId::from_wire);
        members.filter(is_fixed).collect()
    }
}

pub(crate) struct ProgramContents {
    pub found_entry_points: Vec<FoundEntryPoint>,
    /// `LoadOptions::replaced_builtins` and, in a test run, `ResolvedBuiltins::replaced_members` of every compiled file. With each come the object that it holds
    /// and all that the table lists below it. Of `ResolvedBuiltins::opened_holders` come the members, each in the same way. Ascending, each once.
    pub replaced_builtins: Arc<[u32]>,
    pub fixed_builtins: FixedBuiltins,
    /// `ResolvedBuiltins::names_added` of every compiled file. Ascending by holder, then by the bytes of the name.
    pub names_added_to_builtins: Vec<(BuiltinId, Atom)>,
    /// In some file: a live `ImportSiteKind::MockModule` site one of whose values is no `Constant`, or `ResolvedBuiltins::hands_mock_on()`.
    pub mocks_any_module: bool,
    /// By binding, in some file: `!keys_taken_out_of_module_cache().is_empty()` (a delete or a store), `loses_sight_of_module_cache()`, or `resets_modules()`.
    /// In a test run: `LoadsOfRun::is_every_file`, the word for "nobody can say which". `RunContents::loads` lists the files where somebody can.
    pub any_module_loads_again: bool,
    pub loads_by_unknown_name: bool,
    pub loads_by_unknown_path: bool,
    /// `import path from "./addon.node" with { type: "file" }`: the executable holds the file, the program has its path there, and whoever loads that path gets a native addon.
    pub embeds_addon_as_file: bool,
    pub names_worker_constructor: bool,
    pub hands_worker_constructor_on: bool,
    /// `FileContents::starts_worker_out_of_sight` of some compiled file. True, like every other bit, where a file has no payload.
    pub starts_worker_out_of_sight: bool,
    /// In an executable: `RunContents::default()`.
    pub run: RunContents,
    /// `ContentsInput::any_file_may_become_main_module`
    pub any_file_may_become_main_module: bool,
}

impl ProgramContents {
    /// What no file takes for what the table says, Bun's own code no more than the application's. In a test run: all that a test may replace, spelled or not.
    pub(crate) fn builtins_written_as_reads(&self) -> &[u32] {
        match self.run.members_written_as_reads.is_empty() {
            true => &self.replaced_builtins,
            false => &self.run.members_written_as_reads,
        }
    }
}

pub(crate) struct ContentsInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub options: &'a Options<'a>,
    pub found_entry_points: Vec<FoundEntryPoint>,
    /// `CodeHost::may_any_file_become_main_module` of the host that has loaded the files: none of them is folded with whether it is the main module.
    pub any_file_may_become_main_module: bool,
    pub in_parallel: InParallel<'a>,
}

const FILES_LOOKED_AT_IN_A_RUN: usize = 64;

struct LookInput<'a, 's> {
    files: &'a Files<'s>,
    is_test_run: bool,
    /// By `FileId::idx()`. Empty: no test run.
    whose: &'a [WhoseFile],
}

/// `mock.module(name, factory)` in code that runs, where the build does not know every text that `name` may be.
fn mocks_module_that_it_does_not_spell(files: &Files<'_>, file: FileId) -> bool {
    let analysis = files.analysis(file);
    let is_spelled = |name: &ImportSpecifier| matches!(name, ImportSpecifier::Constant(_));
    analysis.import_sites.iter().any(|site| {
        let ImportSiteKind::MockModule(call) = site.kind else {
            return false;
        };
        // A file that is folded again may keep the sites of the folding before.
        !analysis.decisions.is_dead_expr(call)
            && !(analysis.alternatives_of(&site.specifier).iter()).all(is_spelled)
    })
}

// Of consecutive files.
#[derive(Default)]
struct FoundInFiles {
    replaced_members: Vec<BuiltinId>,
    opened_holders: Vec<BuiltinId>,
    names_added: Vec<(BuiltinId, Atom)>,
    mocks_any_module: bool,
    any_module_loads_again: bool,
    loads_by_unknown_name: bool,
    loads_by_unknown_path: bool,
    names_worker_constructor: bool,
    hands_worker_constructor_on: bool,
    starts_worker_out_of_sight: bool,
}

impl FoundInFiles {
    // Nobody has read the file, so it may do anything. `freeze_sources` stops the build at it.
    fn note_file_without_payload(&mut self) {
        *self = FoundInFiles {
            replaced_members: take(&mut self.replaced_members),
            opened_holders: take(&mut self.opened_holders),
            names_added: take(&mut self.names_added),
            mocks_any_module: true,
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
        // An executable refuses a write that replaces a member of a built-in object, so there nothing may be opened for one. It reads none of its files from disk.
        // A file of a test run that the executable holds too meets what it meets there.
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
        self.mocks_any_module |=
            builtins.hands_mock_on() || mocks_module_that_it_does_not_spell(files, file);
        // `test_run_loads` says which files of a test run load again.
        self.any_module_loads_again |= !input.is_test_run
            && (!builtins.keys_taken_out_of_module_cache().is_empty()
                || builtins.loses_sight_of_module_cache()
                || builtins.resets_modules());
        let gives_unknown_name_to_imported_loader =
            resolve_loads_through_imported_loaders(files, file);
        self.loads_by_unknown_name |=
            contents.names.loads_by_unknown_name || gives_unknown_name_to_imported_loader;
        self.loads_by_unknown_path |=
            contents.names.loads_by_unknown_path || gives_unknown_name_to_imported_loader;
        self.names_worker_constructor |= contents.names_worker_constructor;
        self.hands_worker_constructor_on |= contents.hands_worker_constructor_on;
        self.starts_worker_out_of_sight |= contents.starts_worker_out_of_sight;
    }

    fn append(&mut self, mut following: FoundInFiles) {
        self.replaced_members
            .append(&mut following.replaced_members);
        self.opened_holders.append(&mut following.opened_holders);
        self.names_added.append(&mut following.names_added);
        self.mocks_any_module |= following.mocks_any_module;
        self.any_module_loads_again |= following.any_module_loads_again;
        self.loads_by_unknown_name |= following.loads_by_unknown_name;
        self.loads_by_unknown_path |= following.loads_by_unknown_path;
        self.names_worker_constructor |= following.names_worker_constructor;
        self.hands_worker_constructor_on |= following.hands_worker_constructor_on;
        self.starts_worker_out_of_sight |= following.starts_worker_out_of_sight;
    }
}

// The entry that lists the members of what the place holds. Every name of the global object stands for the one entry.
fn object_held_at(place: BuiltinId) -> BuiltinId {
    match table::has_flag(place, BuiltinFlags::IS_GLOBAL_OBJECT) {
        true => BuiltinId::GlobalThis,
        false => table::canonical_id(place),
    }
}

/// Of the global object only what is tested where it is used anyway, fetch and the timers: Map and Array are too much to give up for one computed store.
fn comes_with_holder(holder: BuiltinId, member: BuiltinId) -> bool {
    let entry = table::entry(member);
    let is_cheap = entry.mutability == Mutability::ConstantUnlessWritten;
    entry.mutability != Mutability::ChangesOnItsOwn
        && entry.scope == Scope::Realm
        && (is_cheap || holder != BuiltinId::GlobalThis)
}

/// `Map.prototype`: the engine unlocks it in no run, so a write on `Map` leaves what lies below it as it is.
fn is_locked_prototype(member: BuiltinId) -> bool {
    let entry = table::entry(member);
    entry.kind == BuiltinKind::Prototype && entry.mutability == Mutability::AlwaysLocked
}

/// What changes on its own below an object that is not locked is a constant for nobody, listed or not.
/// A member that is constant unless written stays, whatever holds it: native code of the test runner writes it where no store is seen,
/// and the engine takes a member for a constant, and locks it when the program starts, unless the list has it.
fn may_be_taken_for_constant(place: BuiltinId) -> bool {
    let is_locked = |id: BuiltinId| table::entry(id).mutability == Mutability::AlwaysLocked;
    let entry = table::entry(place);
    entry.mutability != Mutability::ChangesOnItsOwn || entry.holder.is_some_and(is_locked)
}

/// Indexed by table id, so the result does not depend on insertion order.
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

    /// Any member of `holder` may be written, and `holder` stays the object that it is.
    fn add_members_of(&mut self, holder: BuiltinId) {
        let object = object_held_at(holder);
        for &member in table::members(object) {
            if comes_with_holder(object, member) && !is_locked_prototype(member) {
                self.add(member);
            }
        }
    }

    /// `ResolvedBuiltins::unlock` asks for the id of a path alone, which is that of the object. `Resolver::path_of_member` would have taken the least
    /// of all the places on the way: behind `globalThis.Date = Fake`, `Date.prototype.getTime` is no function of the table either.
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

    /// `given`: strictly ascending. What the runner says that it replaces stays as it is said.
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

/// The loader of the host goes by the name of the file, whatever the import has asked for.
fn embeds_addon_as_file(files: &Files<'_>) -> bool {
    files.compiled_files().iter().any(|&file| {
        let asked_for = files
            .compiled(file)
            .and_then(|compiled| host_loader_kind(compiled.loader));
        asked_for == Some(HostLoaderKind::Loader(Loader::File))
            && loader_by_name(files.module(file).file_name()) == Loader::Napi
    })
}

// The number of an atom follows the order in which threads met its text, so names are ordered by their bytes.
fn sort_names_added(names: &mut Vec<(BuiltinId, Atom)>, files: &Files<'_>) {
    let atoms = &files.atoms;
    names.shared_sort_unstable_by(|left, right| {
        let by_name = || atoms.bytes(left.1).cmp(atoms.bytes(right.1));
        left.0.cmp(&right.0).then_with(by_name)
    });
    names.dedup();
}

/// Once, when the application is loaded and before Bun's own modules are. In a test run it ends with `ResolvedBuiltins::unlock` on every file,
/// with an empty list too. In an executable no file is unlocked.
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
    if is_test_run {
        for &file in files.compiled_files() {
            if let Some(source) = parsed_source(files, file) {
                source
                    .builtins
                    .unlock(Arc::clone(&run.members_written_as_reads));
            }
        }
    }
    ProgramContents {
        found_entry_points,
        replaced_builtins,
        fixed_builtins: FixedBuiltins::default(),
        names_added_to_builtins: all.names_added,
        mocks_any_module: all.mocks_any_module || run.mocks_any_module,
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
