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

pub use check::{PassCount, Passes, check_and_lower, check_and_lower_noting_commits};
pub use load::{
    FileFinder, FileFinderTables, find_configuration_of_each_entry_point, load_program,
    load_program_of_loaded_files, load_program_with_parsed_files, resolve_names_known_in_part,
};
pub use locator::{Locator, TextLocator};
pub use log_message::log_message;
pub use roles::{decide_roles, keep_verified_roles};
pub use threads::{
    drop_thread_caches, run_on_one_thread_while, run_on_region_thread, run_on_threads_while,
    wake_idle_region_threads,
};

use self::effects::ProgramOrigins;
#[cfg(test)]
use crate::RoundReport;
use crate::{CompilerOption, Diagnostic, Incomplete, Libs, Progress};
use bun_sema::atom::Interner;
use bun_sema::check::aot::{DiagnosticClass, Effect, FileOrigin, LeftOutBodies};
use bun_sema::check::commit::CyclesEntered;
use bun_sema::check::{Checker, Program, Requested};
use bun_sema::fold::FoldInputs;
use bun_sema::program::{
    FileId, FileRole, Files, FindsEntryPoints, IN_CONFIGURATION, MainModule, Sym,
};
use bun_sema::resolve::{CodeFailure, CodeOptions};
use bun_sema::session::SessionSlot;
use bun_sema::util::SharedSort;
use bun_threading::Guarded;
use std::cell::UnsafeCell;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Copy, Clone)]
pub enum EntryPoints<'a> {
    Written(&'a [Vec<u8>]),
    WrittenFor(&'a [Vec<u8>], MainModule),
    /// `WrittenFor`, and the files that a look at the code of the program names while it is loaded: `CompileInputs::finds_entry_points`.
    /// The load takes them in where it then ends as a load that was given them all. `Files::entry_points` says whether it has.
    WrittenAndFound(&'a [Vec<u8>], MainModule, &'a FindsEntryPoints<'a>),
    Resolved(&'a [Vec<u8>]),
    Configured(&'a [Vec<u8>], Option<&'a [u8]>),
    // Under the configuration nearest to the first. The program begins elsewhere.
    Imported(&'a [Vec<u8>]),
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
}

pub struct LoadedProgram<'s> {
    program: &'s UnsafeCell<Program<'s>>,
    files: &'s Files<'s>,
    /// All that the checker makes is allocated here, and nothing of the files. So it can go while the files are still read.
    checker_session: &'s SessionSlot,
    /// For `renew_checker`, when trees have gone.
    node_counts: bun_sema::check::NodeCounts,
    is_checker_freed: AtomicBool,
    cycles_entered: Guarded<Vec<(u32, u32, usize, CyclesEntered)>>,
    has_checked_for_roles: AtomicBool,
    origins: Vec<FileOrigin>,
    project_origin: FileOrigin,
    pub diagnostics: Vec<BuildDiagnostic>,
    pub has_bun_types_installed: bool,
    pub brings_bun_types: bool,
    without_bun_types: Option<WithoutBunTypes>,
    is_read_again: bool,
}

pub(crate) struct WithoutBunTypes {
    pub has_configuration_file: bool,
    pub incomplete_containers: [Option<Sym>; 4],
    /// `CodeHost::errors_with_bun_types`
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
        self.origins[file.idx()]
    }

    pub fn set_is_read_again(&mut self, is_read_again: bool) {
        self.is_read_again = is_read_again;
        // SAFETY: `&mut self`.
        unsafe { &mut *self.program.get() }.keep_what_is_reported(is_read_again);
    }

    /// Frees most of the HIR and of the binder's tables of every file, unless the files are read again.
    ///
    /// # Safety
    /// Every program that reads the files is lowered, and nothing reads a tree from now on.
    pub unsafe fn free_trees(&self, in_parallel: &dyn Fn(usize, &(dyn Fn(usize) + Sync))) {
        if self.is_read_again {
            return;
        }
        let files = self.files();
        in_parallel(files.modules.len(), &|index| {
            // SAFETY: caller contract.
            unsafe { files.free_long_lists(index) };
        });
    }

    /// Frees the types, the tables and everything else that the checker has made, unless the files are read again.
    ///
    /// # Safety
    /// Nothing asks the checker anything from now on, and nothing that it has made is referred to.
    pub unsafe fn free_checker(&self, in_parallel: &dyn Fn(usize, &(dyn Fn(usize) + Sync))) {
        if self.is_read_again || self.is_checker_freed.swap(true, Ordering::Relaxed) {
            return;
        }
        // SAFETY: caller contract.
        unsafe {
            (*self.program.get()).release();
            self.checker_session.empty_in_parallel(in_parallel);
        }
    }

    /// Frees what `free_checker` frees and puts a checker in its place that knows nothing yet, unless the files are read again.
    /// What the checker holds grows with every file that it has looked at, and a file asks about few of the others.
    ///
    /// # Safety
    /// No task runs, and nothing that the checker has made is referred to.
    pub(crate) unsafe fn renew_checker(
        &self,
        in_parallel: &dyn Fn(usize, &(dyn Fn(usize) + Sync)),
    ) {
        if self.is_read_again || self.is_checker_freed.load(Ordering::Relaxed) {
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

    pub(crate) fn note_check_for_roles(&self) {
        self.has_checked_for_roles.store(true, Ordering::Relaxed);
    }

    pub(crate) fn has_checked_for_roles(&self) -> bool {
        self.has_checked_for_roles.load(Ordering::Relaxed)
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

    fn program_origins(&self) -> ProgramOrigins<'_, 's> {
        ProgramOrigins {
            files: Some(self.files),
            origins: &self.origins,
            project_origin: self.project_origin,
            without_bun_types: self.without_bun_types.as_ref(),
            lacks_installed_bun_types: self.brings_bun_types || self.without_bun_types.is_some(),
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
    TypeError,
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

    /// True if `diagnostics` has an early error in `file`. The file keeps its role and is not checked for early errors
    /// again, so lowering has to ask here.
    pub fn reported_early_error(&self, file: FileId) -> bool {
        self.diagnostics.iter().any(|reported| {
            reported.diagnostic.file == Some(file)
                && reported.diagnostic.class == DiagnosticClass::EarlyError
        })
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
    /// What `after_file` needs of a file and no checker is asked for. Another thread calls it while the file is checked.
    pub beside_file: Option<&'a (dyn Fn(FileId) + Sync)>,
    pub frees_tree: &'a (dyn Fn(FileId) -> bool + Sync),
    /// Nobody reads a tree once the files of this pass are final.
    pub is_last_pass: &'a (dyn Fn() -> bool + Sync),
    pub note_cycles_entered: Option<&'a (dyn Fn(FileId, CyclesEntered) + Sync)>,
    pub cycles_entered_before: &'a (dyn Fn() -> CyclesEntered + Sync),
    pub first_round: u32,
    pub left_out_bodies: Option<&'a LeftOutBodies>,
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
