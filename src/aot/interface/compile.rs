#[path = "../compile/paths.rs"]
mod paths;

pub use self::paths::{EntryPointPaths, FolderPaths};
use crate::engine::EngineResult;
use crate::link::ProgramNames;
pub use crate::linked::bun_aot_compile as compile;
/// Of the one entry point of the options. `None`: the file or what it imports could not be loaded, and the log says why.
use crate::module_list::ModuleList;
use crate::report::SourceTexts;
use crate::statistics::{Stage, Statistics};

pub struct ProgramSummary {
    pub entry_points: Vec<EntryPointPaths>,
    pub folders: Vec<FolderPaths>,
    pub names: ProgramNames,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    /// Where `Options::lists_modules` asks for it.
    pub modules: Option<ModuleList>,
}

pub struct Compilation {
    pub engine: EngineResult,
    pub summary: ProgramSummary,
    /// Of a build whose entry points begin programs of their own: the program of each entry point behind the first, in their order.
    /// `summary.entry_points` lists all of them then, and `engine` is the program of the first.
    pub further_programs: Vec<EngineResult>,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
}
