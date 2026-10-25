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

pub use check::{check_and_lower, check_and_lower_noting_commits};
pub use load::{find_configuration_of_each_entry_point, load_program};
pub use locator::{Locator, TextLocator};
pub use log_message::log_message;
pub use roles::{decide_roles, keep_verified_roles};
pub use threads::{
    drop_thread_caches, run_on_one_thread_while, run_on_region_thread, wake_idle_region_threads,
};

use self::effects::ProgramOrigins;
#[cfg(test)]
use crate::RoundReport;
use crate::{CompilerOption, Diagnostic, Incomplete, Libs, Progress};
use bun_sema::atom::Interner;
use bun_sema::check::aot::{Effect, FileOrigin, LeftOutBodies};
use bun_sema::check::{Checker, Program, Requested};
use bun_sema::fold::FoldInputs;
use bun_sema::program::{FileId, FileRole, Files, IN_CONFIGURATION, MainModule, Sym};
use bun_sema::resolve::{CodeFailure, CodeOptions};
use std::num::NonZeroUsize;

#[derive(Copy, Clone)]
pub enum EntryPoints<'a> {
    Written(&'a [Vec<u8>]),
    WrittenFor(&'a [Vec<u8>], MainModule),
    Resolved(&'a [Vec<u8>]),
    Configured(&'a [Vec<u8>], Option<&'a [u8]>),
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
    program: &'s mut Program<'s>,
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
    pub incomplete_containers: [Option<Sym>; 3],
}

impl<'s> LoadedProgram<'s> {
    pub fn program(&self) -> &Program<'s> {
        self.program
    }

    pub fn files(&self) -> &'s Files<'s> {
        self.program.files
    }

    pub fn origin(&self, file: FileId) -> FileOrigin {
        self.origins[file.idx()]
    }

    pub fn set_is_read_again(&mut self, is_read_again: bool) {
        self.is_read_again = is_read_again;
        self.program.keep_what_is_reported(is_read_again);
    }

    fn program_origins(&self) -> ProgramOrigins<'_, 's> {
        ProgramOrigins {
            files: Some(self.program.files),
            origins: &self.origins,
            project_origin: self.project_origin,
            without_bun_types: self.without_bun_types.as_ref(),
            lacks_installed_bun_types: self.brings_bun_types || self.without_bun_types.is_some(),
        }
    }
}

impl Drop for LoadedProgram<'_> {
    fn drop(&mut self) {
        self.program.release();
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
