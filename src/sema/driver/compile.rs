mod check;
mod disk;
mod effects;
mod load;
mod locator;
mod log_message;
mod queue;
mod roles;
mod runtime_json;
#[cfg(test)]
mod tests;
mod threads;

pub use check::{
    PassCount, Passes, check_and_lower, check_and_lower_noting_commits, check_whole_files,
};
pub(crate) use load::take_bun_types_below;
pub use load::{FileFinder, FileFinderTables, load_program, resolve_names_known_in_part};
pub use locator::{Locator, TextLocator};
pub use log_message::log_message;
pub use roles::{decide_roles, keep_verified_roles};
pub use threads::{
    drop_thread_caches, run_on_one_thread_while, run_on_region_thread, run_on_threads_while,
    wake_idle_region_threads,
};

use self::effects::ProgramOrigins;
pub use self::effects::says_that_name_is_not_found;
#[cfg(test)]
use crate::RoundReport;
use crate::{CompilerOption, Diagnostic, Incomplete, Libs, Progress};
use bun_sema::atom::Interner;
use bun_sema::check::aot::{Effect, FileOrigin, LeftOutBodies};
use bun_sema::check::commit::CyclesEntered;
use bun_sema::check::{Checker, Program, Requested};
use bun_sema::fold::FoldInputs;
use bun_sema::program::{FileId, FileRole, Files, FindsEntryPoints, IN_CONFIGURATION, Sym};
use bun_sema::resolve::{CodeFailure, CodeOptions};
use bun_sema::session::SessionSlot;
use bun_sema::util::SharedSort;
use bun_threading::Guarded;
use std::cell::UnsafeCell;
use std::num::NonZeroUsize;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Copy, Clone)]
pub enum EntryPoints<'a> {
    Written(&'a [Vec<u8>]),
    WrittenAndFound(&'a [Vec<u8>], &'a FindsEntryPoints<'a>),
    Resolved(&'a [Vec<u8>]),
}

pub struct CompileRequest<'a, 's> {
    pub entry_points: EntryPoints<'a>,
    pub code: &'a CodeOptions,
    pub fold: &'a FoldInputs<'s>,
    pub atoms: Interner<'s>,
    pub libs: Libs<'a>,
    pub project_origin: FileOrigin,
    pub threads: NonZeroUsize,
    pub progress: Option<&'a Progress>,
    pub left_out_bodies: Option<&'a LeftOutBodies>,
    pub discards_first_visits: bool,
}

pub struct LoadedProgram<'s> {
    program: &'s UnsafeCell<Program<'s>>,
    files: &'s Files<'s>,
    checker_session: &'s SessionSlot,
    node_counts: bun_sema::check::NodeCounts,
    is_checker_freed: AtomicBool,
    cycles_entered: Guarded<Vec<(u32, u32, usize, CyclesEntered)>>,
    origins: Vec<FileOrigin>,
    origins_behind_reach: OnceLock<Vec<FileOrigin>>,
    project_origin: FileOrigin,
    pub diagnostics: Vec<BuildDiagnostic>,
    bun_types: BunTypes,
    has_configuration_file: bool,
    files_that_project_excludes: Vec<FileId>,
    files_left_to_loader: OnceLock<Box<[FileId]>>,
}

pub(crate) enum BunTypes {
    Installed,
    InstalledAndNotNamed,
    Brought,
    Missing(WithoutBunTypes),
}

pub(crate) struct WithoutBunTypes {
    pub incomplete_containers: [Option<Sym>; 4],
    pub errors_with_bun_types: Option<Vec<(Vec<u8>, u32)>>,
}

// SAFETY: the program is mutated through `&mut self`, or by `free_checker` when nothing uses it any more.
unsafe impl Send for LoadedProgram<'_> {}
// SAFETY: as above.
unsafe impl Sync for LoadedProgram<'_> {}

impl<'s> LoadedProgram<'s> {
    pub fn program(&self) -> &Program<'s> {
        debug_assert!(!self.is_checker_freed.load(Ordering::Relaxed));
        // SAFETY: see `Sync`.
        unsafe { &*self.program.get() }
    }

    pub fn files(&self) -> &'s Files<'s> {
        self.files
    }

    pub fn origin(&self, file: FileId) -> FileOrigin {
        self.origins()[file.idx()]
    }

    fn origins(&self) -> &[FileOrigin] {
        self.origins_behind_reach.get().unwrap_or(&self.origins)
    }

    pub fn hold_as_evaluated_text(&self, files: &[FileId]) {
        if files.is_empty() {
            return;
        }
        let mut origins = self.origins.clone();
        for file in files {
            origins[file.idx()] = FileOrigin::EvaluatedText;
        }
        let _ = self.origins_behind_reach.set(origins);
    }

    pub fn leave_files_to_loader(&self, mut files: Vec<FileId>) {
        files.sort_unstable();
        let _ = self.files_left_to_loader.set(files.into_boxed_slice());
    }

    pub(crate) fn files_left_to_loader(&self) -> &[FileId] {
        self.files_left_to_loader.get().map_or(&[], |files| files)
    }

    pub unsafe fn free_trees(&self, in_parallel: &dyn Fn(usize, &(dyn Fn(usize) + Sync))) {
        let files = self.files();
        in_parallel(files.modules.len(), &|index| {
            // SAFETY: caller contract.
            unsafe { files.free_long_lists(index) };
        });
    }

    pub unsafe fn free_checker(&self, in_parallel: &dyn Fn(usize, &(dyn Fn(usize) + Sync))) {
        if self.is_checker_freed.swap(true, Ordering::Relaxed) {
            return;
        }
        // SAFETY: caller contract.
        unsafe {
            (*self.program.get()).release();
            self.checker_session.empty_in_parallel(in_parallel);
        }
    }

    pub(crate) unsafe fn renew_checker(
        &self,
        in_parallel: &dyn Fn(usize, &(dyn Fn(usize) + Sync)),
    ) {
        if self.is_checker_freed.load(Ordering::Relaxed) {
            return;
        }
        // SAFETY: caller contract. The old program lies in an arena and is never dropped.
        unsafe {
            (*self.program.get()).release();
            self.checker_session.empty_in_parallel(in_parallel);
            let session = self.checker_session.session();
            let program = Program::with_node_counts(session, self.files, &self.node_counts);
            self.program.get().write(program);
        }
    }

    pub(crate) fn note_cycles_entered(
        &self,
        first_round: u32,
        file: FileId,
        cycles: CyclesEntered,
    ) {
        if !cycles.is_empty() {
            let mut noted = self.cycles_entered.lock();
            let noted_before = noted.len();
            noted.push((
                first_round,
                self.files.rank_of_file(file),
                noted_before,
                cycles,
            ));
        }
    }

    pub(crate) fn cycles_entered(&self) -> CyclesEntered {
        let mut noted = self.cycles_entered.lock();
        noted.shared_sort_by_key(|&(stage, rank, noted_before, _)| (stage, rank, noted_before));
        let mut all = CyclesEntered::default();
        for (_, _, _, cycles) in noted.iter() {
            all.append(cycles.clone());
        }
        all
    }

    fn is_excluded_by_project(&self, file: FileId) -> bool {
        self.files_that_project_excludes
            .binary_search(&file)
            .is_ok()
    }

    fn program_origins(&self) -> ProgramOrigins<'_, 's> {
        ProgramOrigins {
            files: Some(self.files),
            origins: self.origins(),
            project_origin: self.project_origin,
            bun_types: &self.bun_types,
            has_configuration_file: self.has_configuration_file,
        }
    }
}

impl Drop for LoadedProgram<'_> {
    fn drop(&mut self) {
        if !*self.is_checker_freed.get_mut() {
            // SAFETY: `&mut self`.
            unsafe { &mut *self.program.get() }.release();
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EntryPointFailure {
    NotFound(CodeFailure),
    BuiltinModule,
    External,
}

#[derive(Debug)]
pub struct LoadFailure {
    pub unresolved_entry_points: Vec<(usize, EntryPointFailure)>,
    pub diagnostics: Vec<BuildDiagnostic>,
}

#[derive(Clone, Debug)]
pub struct BuildDiagnostic {
    pub diagnostic: Diagnostic,
    pub effect: Effect,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DemotionCause {
    UnverifiedTypes,
    EarlyError,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Demotion {
    pub file: FileId,
    pub cause: DemotionCause,
}

pub struct RoleDecision {
    pub roles: Vec<FileRole>,
    pub demoted: Vec<Demotion>,
    pub checked: Vec<FileId>,
    pub diagnostics: Vec<BuildDiagnostic>,
    pub incomplete: Vec<Incomplete>,
    #[cfg(test)]
    pub rounds: Vec<RoundReport>,
}

impl RoleDecision {
    pub fn role(&self, file: FileId) -> FileRole {
        self.roles[file.idx()]
    }

    pub fn is_checked(&self, file: FileId) -> bool {
        self.checked.binary_search(&file).is_ok()
    }

    pub fn has_early_error(&self, file: FileId) -> bool {
        let first = self
            .demoted
            .partition_point(|demotion| demotion.file < file);
        let demotions = self.demoted[first..].iter();
        demotions
            .take_while(|demotion| demotion.file == file)
            .any(|demotion| demotion.cause == DemotionCause::EarlyError)
    }
}

pub struct CheckedProgram<T> {
    pub lowered: Vec<(FileId, T)>,
    pub diagnostics: Vec<BuildDiagnostic>,
    pub incomplete: Vec<Incomplete>,
    #[cfg(test)]
    pub rounds: Vec<RoundReport>,
}

pub(crate) struct FileWork<'a, 's> {
    pub requested: &'a (dyn Fn(FileId) -> Requested + Sync),
    pub after_file: Option<&'a (dyn Fn(&mut Checker<'_, 's>, FileId) + Sync)>,
    pub after_commit: &'a (dyn Fn(FileId) + Sync),
    pub frees_tree: &'a (dyn Fn(FileId) -> bool + Sync),
    pub is_last_pass: &'a (dyn Fn() -> bool + Sync),
    pub note_cycles_entered: Option<&'a (dyn Fn(FileId, CyclesEntered) + Sync)>,
    pub cycles_entered_before: &'a (dyn Fn() -> CyclesEntered + Sync),
    pub first_round: u32,
    pub left_out_bodies: Option<&'a LeftOutBodies>,
}

impl FileWork<'_, '_> {
    pub(crate) fn requested_while_asked(&self, files: &Files<'_>, file: FileId) -> Requested {
        match files.bound(file).has_types_that_depend_on_order() {
            true => (self.requested)(file),
            false => Requested::Types,
        }
    }
}

pub(crate) fn file_of_related(at: Option<(FileId, u32, u32)>) -> Option<FileId> {
    let (file, _, _) = at?;
    (file != IN_CONFIGURATION).then_some(file)
}

impl CompilerOption {
    pub fn name(&self) -> &[u8] {
        &self.0
    }
}
