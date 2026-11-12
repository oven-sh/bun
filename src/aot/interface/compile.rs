#[path = "../compile/paths.rs"]
mod paths;

pub use self::paths::{EntryPointPaths, FolderPaths, FollowedName};
use crate::engine::EngineResult;
pub use crate::linked::bun_aot_compile as compile;
use crate::module_list::ModuleList;
use crate::report::SourceTexts;
use crate::statistics::{Stage, Statistics};

pub struct ProgramSummary {
    pub entry_points: Vec<EntryPointPaths>,
    pub folders: Vec<FolderPaths>,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    pub modules: Option<ModuleList>,
}

pub struct Compilation {
    pub engine: EngineResult,
    pub summary: ProgramSummary,
    pub starts_workers_from_unseen_code: bool,
    pub names_of_worker_files: Vec<EntryPointPaths>,
    pub names_followed: Vec<FollowedName>,
    pub names_plugin: bool,
    pub root_folders_spelled: Vec<u8>,
    pub levels_above_root: usize,
    pub holds_source_paths: bool,
    pub program_files: Vec<EntryPointPaths>,
    pub names_added_to_builtins: Vec<(u32, Vec<u8>)>,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
}
