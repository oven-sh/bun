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
use bun_sema::hir::ExprId;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::node::NodeData;
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;

pub(crate) use self::entry_points::{
    EntryPointFinder, FinderInput, FoundBecause, FoundEntryPoint, StartWithoutFile,
};
pub(crate) use self::load_names::NamedLoads;
use self::load_names::resolve_loads_through_imported_loaders;
pub(crate) use self::scan::{ScanInput, scan_file};
pub(crate) use self::worker_entries::WorkerStart;
#[cfg(test)]
pub(crate) use self::worker_entries::{PlaceOfName, WorkerNameForm};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, Mutability, Platforms, Scope,
};
use crate::builtins::{BuiltinNames, can_lay_key_that_native_code_asks_of_process};
use crate::ir::{InParallel, for_each_mut};
use crate::load::loaders::{HostLoaderKind, host_loader_kind};
use crate::load::sources::parsed_source;
use crate::module_keys::loader_by_name;
use crate::options::Options;
use crate::test_runs::files_of_run::find_whose_files;
use crate::test_runs::{
    RunContents, RunInput, WhoseFile, collect_run_contents, fix_places_on_the_way,
    fix_what_every_run_folds_by, list_names_that_tests_may_add,
};

#[derive(Default)]
pub(crate) struct FileContents {
    pub names: NamedLoads,
    pub worker_starts: Vec<WorkerStart>,
    pub urls_with_code: Vec<Atom>,
    pub texts_behind_object_urls: Vec<(Atom, Option<Atom>)>,
    pub code_by_levels_above_root: Vec<(usize, Atom, Option<Option<Atom>>)>,
    pub names_worker_constructor: bool,
    pub hands_worker_constructor_on: bool,
    pub starts_worker_out_of_sight: bool,
    pub node_workers_out_of_sight: Vec<NodeWorkerOutOfSight>,
    pub urls_of_web_workers_out_of_sight: Vec<UrlThatStartsWorker>,
}

pub(crate) struct NodeWorkerOutOfSight {
    pub at: NodeData,
    pub is_told_to_evaluate: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct UrlThatStartsWorker {
    pub url: ExprId,
    pub start: ExprId,
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
    pub process_reaches_code_on_its_prototypes: bool,
    pub inspects_prototype_chain_of_process: bool,
    pub method_that_hands_out_global_object_may_come_out: bool,
    pub any_module_loads_again: bool,
    pub loads_by_unknown_name: bool,
    pub loads_by_unknown_path: bool,
    pub loads_code_on_disk_by_unknown_path: bool,
    pub embeds_addon_as_file: bool,
    pub names_worker_constructor: bool,
    pub hands_worker_constructor_on: bool,
    pub starts_worker_out_of_sight: bool,
    pub run: RunContents,
    pub any_file_may_become_main_module: bool,
}

impl ProgramContents {
    pub(crate) fn can_replace_builtins(&self) -> bool {
        !self.replaced_builtins.is_empty() || !self.names_added_to_builtins.is_empty()
    }

    pub(crate) fn can_replace_builtin_functions(&self) -> bool {
        !self.replaced_builtins.is_empty()
    }
}

pub(crate) struct ContentsInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub options: &'a Options<'a>,
    pub found_entry_points: Vec<FoundEntryPoint>,
    pub any_file_may_become_main_module: bool,
    pub is_every_text_asked: bool,
    pub builtin_names: &'a BuiltinNames,
    pub platform: Platforms,
    pub in_parallel: InParallel<'a>,
}

const FILES_LOOKED_AT_IN_A_RUN: usize = 64;

struct LookInput<'a, 's> {
    files: &'a Files<'s>,
    is_test_run: bool,
    whose: &'a [WhoseFile],
    rejects_uncompiled_code: &'a [bool],
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

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    struct LoadsByUnknown: u8 {
        const NAME = 1 << 0;
        const PATH = 1 << 1;
        const PATH_OF_CODE_ON_DISK = 1 << 2;
    }
}

impl LoadsByUnknown {
    fn new(by_name: bool, by_path: bool) -> LoadsByUnknown {
        let mut loads = LoadsByUnknown::empty();
        loads.set(LoadsByUnknown::NAME, by_name);
        loads.set(
            LoadsByUnknown::PATH | LoadsByUnknown::PATH_OF_CODE_ON_DISK,
            by_path,
        );
        loads
    }
}

#[derive(Default)]
struct FoundInFiles {
    replaced_members: Vec<BuiltinId>,
    opened_holders: Vec<BuiltinId>,
    names_added: Vec<(BuiltinId, Atom)>,
    mocks_any_module: bool,
    stores_loader_functions: bool,
    process_reaches_code_on_its_prototypes: bool,
    inspects_prototype_chain_of_process: bool,
    method_that_hands_out_global_object_may_come_out: bool,
    can_come_by_hook_of_instanceof: bool,
    hand_builtins_to_hooks_of_instanceof: Vec<FileId>,
    ask_for_names_that_are_not_listed: Vec<FileId>,
    any_module_loads_again: bool,
    loads_by_unknown: LoadsByUnknown,
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
            process_reaches_code_on_its_prototypes: true,
            inspects_prototype_chain_of_process: true,
            method_that_hands_out_global_object_may_come_out: true,
            can_come_by_hook_of_instanceof: true,
            hand_builtins_to_hooks_of_instanceof: take(
                &mut self.hand_builtins_to_hooks_of_instanceof,
            ),
            ask_for_names_that_are_not_listed: take(&mut self.ask_for_names_that_are_not_listed),
            any_module_loads_again: true,
            loads_by_unknown: LoadsByUnknown::all(),
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
        let names = &contents.names;
        let loads_by_unknown = match resolve_loads_through_imported_loaders(files, file) {
            true => LoadsByUnknown::all(),
            false => {
                let loads =
                    LoadsByUnknown::new(names.loads_by_unknown_name, names.loads_by_unknown_path);
                match input.rejects_uncompiled_code.get(file.idx()) {
                    Some(true) => loads - LoadsByUnknown::PATH_OF_CODE_ON_DISK,
                    Some(false) | None => loads,
                }
            }
        };
        self.append(FoundInFiles {
            replaced_members: Vec::new(),
            opened_holders: Vec::new(),
            names_added: Vec::new(),
            mocks_any_module,
            stores_loader_functions,
            process_reaches_code_on_its_prototypes: builtins
                .process_reaches_code_on_its_prototypes(),
            inspects_prototype_chain_of_process: builtins.inspects_prototype_chain_of_process(),
            method_that_hands_out_global_object_may_come_out: builtins
                .method_that_hands_out_global_object_may_come_out(),
            can_come_by_hook_of_instanceof: builtins.can_come_by_hook_of_instanceof(),
            hand_builtins_to_hooks_of_instanceof: match builtins
                .hands_builtins_to_hooks_of_instanceof()
            {
                true => vec![file],
                false => Vec::new(),
            },
            ask_for_names_that_are_not_listed: match builtins
                .names_asked_for_that_are_not_listed()
                .is_empty()
            {
                true => Vec::new(),
                false => vec![file],
            },
            any_module_loads_again,
            loads_by_unknown,
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
        self.process_reaches_code_on_its_prototypes |=
            following.process_reaches_code_on_its_prototypes;
        self.inspects_prototype_chain_of_process |= following.inspects_prototype_chain_of_process;
        self.method_that_hands_out_global_object_may_come_out |=
            following.method_that_hands_out_global_object_may_come_out;
        self.can_come_by_hook_of_instanceof |= following.can_come_by_hook_of_instanceof;
        self.hand_builtins_to_hooks_of_instanceof
            .append(&mut following.hand_builtins_to_hooks_of_instanceof);
        self.ask_for_names_that_are_not_listed
            .append(&mut following.ask_for_names_that_are_not_listed);
        self.any_module_loads_again |= following.any_module_loads_again;
        self.loads_by_unknown |= following.loads_by_unknown;
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

fn leads_from_prototype_to_its_class(place: BuiltinId, object: BuiltinId) -> bool {
    let holder_of = |id: BuiltinId| table::entry(id).holder.map(table::canonical_id);
    holder_of(place).is_some_and(|holder| {
        table::entry(holder).kind == BuiltinKind::Prototype && holder_of(holder) == Some(object)
    })
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

    fn add_what_looks_up(&mut self, place: BuiltinId) {
        let holder_of = |id: BuiltinId| table::entry(id).holder.map(table::canonical_id);
        let class = holder_of(place).and_then(|holder| match table::entry(holder).kind {
            BuiltinKind::Prototype => holder_of(holder),
            _ => Some(holder),
        });
        for &member in class.map_or(&[][..], table::members) {
            if table::has_flag(member, BuiltinFlags::REQUIRES_HOLDER_AS_THIS) {
                self.add(member);
            }
        }
    }

    fn add_members_transitively(&mut self) {
        while let Some(place) = self.pending.pop() {
            self.add_what_looks_up(place);
            let object = object_held_at(place);
            if object != place {
                if !leads_from_prototype_to_its_class(place, object) {
                    self.add(object);
                }
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
        is_every_text_asked,
        builtin_names,
        platform,
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
        rejects_uncompiled_code: whose_files.as_ref().map_or(&[], |(_, alone)| alone),
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
    if !all.process_reaches_code_on_its_prototypes && !options.can_load_code_at_run_time() {
        let runs = files.compiled_files().chunks(FILES_LOOKED_AT_IN_A_RUN);
        let mut runs: Vec<(&[FileId], bool)> = runs.map(|run| (run, false)).collect();
        for_each_mut(&mut runs, in_parallel, &|(run, can_lay)| {
            *can_lay = run.iter().any(|&file| {
                let (hir, folded) = (files.hir(file), &files.analysis(file).decisions);
                can_lay_key_that_native_code_asks_of_process(hir, folded, builtin_names, platform)
            });
        });
        all.process_reaches_code_on_its_prototypes = runs.iter().any(|run| run.1);
    }
    let unseen_code_may_run = options.can_load_code_at_run_time()
        || options.aot.loads_code_from_disk
        || !all.loads_by_unknown.is_empty()
        || files.compiled_files().iter().any(|&file| {
            let asked_for = files.compiled(file).map(|compiled| compiled.loader);
            loader_by_name(files.module(file).file_name()) == Loader::Napi
                || asked_for.and_then(host_loader_kind)
                    == Some(HostLoaderKind::Loader(Loader::Napi))
        });
    if all.can_come_by_hook_of_instanceof || unseen_code_may_run || !is_every_text_asked {
        for &file in &all.hand_builtins_to_hooks_of_instanceof {
            let Some(source) = parsed_source(files, file) else {
                continue;
            };
            source.builtins.note_that_hooks_of_instanceof_may_exist();
            all.loads_by_unknown |= LoadsByUnknown::new(
                source.builtins.loads_unknown_modules(),
                source.builtins.hands_on_loader_of_paths(),
            );
        }
    }
    let asking = take(&mut all.ask_for_names_that_are_not_listed);
    let added_through_helpers = match asking.is_empty() {
        true => Vec::new(),
        false => list_names_that_tests_may_add(files, look_input.whose),
    };
    for &file in &asking {
        let Some(source) = parsed_source(files, file) else {
            continue;
        };
        let is_laid_above = |&(_, name): &(BuiltinId, Atom)| {
            let mut added = all.names_added.iter().chain(&added_through_helpers);
            added.any(|&(_, laid)| laid == name)
        };
        let mut asked_for = source.builtins.names_asked_for_that_are_not_listed().iter();
        if !asked_for.any(is_laid_above) {
            continue;
        }
        let (replaced, opened, stores_loader_functions) =
            source.builtins.note_that_tests_lay_names_above();
        all.replaced_members.extend_from_slice(replaced);
        all.opened_holders.extend_from_slice(opened);
        all.stores_loader_functions |= stores_loader_functions;
        all.loads_by_unknown |= LoadsByUnknown::new(
            source.builtins.loads_unknown_modules(),
            source.builtins.hands_on_loader_of_paths(),
        );
    }
    let replaced_builtins = list_replaced_builtins(
        &options.load.replaced_builtins,
        &all.replaced_members,
        &all.opened_holders,
    );
    let mut run = match whose_files {
        Some(whose_files) => collect_run_contents(
            RunInput {
                replaced_builtins: &replaced_builtins,
                ..run_input
            },
            whose_files,
        ),
        None => RunContents::default(),
    };
    run.loader_functions_answer_requires = is_test_run && all.stores_loader_functions;
    all.names_added.extend_from_slice(&run.names_added);
    sort_names_added(&mut all.names_added, files);
    let fixed_builtins = FixedBuiltins::default();
    if is_test_run {
        fix_what_every_run_folds_by(&replaced_builtins, &fixed_builtins);
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
        mocks_any_module: all.mocks_any_module || run.mocks_any_module,
        stores_loader_functions: all.stores_loader_functions,
        process_reaches_code_on_its_prototypes: all.process_reaches_code_on_its_prototypes,
        inspects_prototype_chain_of_process: all.inspects_prototype_chain_of_process,
        method_that_hands_out_global_object_may_come_out: all
            .method_that_hands_out_global_object_may_come_out,
        any_module_loads_again: match is_test_run {
            true => run.loads.is_every_file,
            false => all.any_module_loads_again,
        },
        loads_by_unknown_name: all.loads_by_unknown.contains(LoadsByUnknown::NAME),
        loads_by_unknown_path: all.loads_by_unknown.contains(LoadsByUnknown::PATH),
        loads_code_on_disk_by_unknown_path: all
            .loads_by_unknown
            .contains(LoadsByUnknown::PATH_OF_CODE_ON_DISK),
        embeds_addon_as_file: embeds_addon_as_file(files),
        names_worker_constructor: all.names_worker_constructor,
        hands_worker_constructor_on: all.hands_worker_constructor_on,
        starts_worker_out_of_sight: all.starts_worker_out_of_sight,
        run,
        any_file_may_become_main_module,
    }
}
