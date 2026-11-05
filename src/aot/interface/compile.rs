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
use bun_options_types::aot_options::ReplacedByTests;

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
    /// `UsedFeatures::starts_workers_from_unseen_code`
    pub starts_workers_from_unseen_code: bool,
    /// The names that the programs start Workers with and that are not the paths of modules: the path that each would have as a file of the executable, and the file on disk that it leads to.
    pub names_of_worker_files: Vec<EntryPointPaths>,
    /// The last folders of the root directory, where a path that the program writes goes up out of them and comes back. Empty where none does.
    pub root_folders_spelled: Vec<u8>,
    /// The programs hold the path of a file on the machine that builds: `__filename`, `__dirname` or what `require.resolve` answers, as `bun build --compile` has them.
    pub holds_source_paths: bool,
    /// In a test run: a call of `import()` is given a path with a query.
    pub imports_file_with_query: bool,
    /// With code from disk: the files of the program, for the names of their packages.
    pub program_files: Vec<EntryPointPaths>,
    /// Of a test run: `builtins` and `names_added_to_builtins` as the programs were compiled with them, whether an option brought them or a file spells them.
    /// A member is open in a realm only if every image of the realm lists it, so an image that is built above this one takes them as its `AotOptions::replaced_by_tests`.
    pub replaced_builtins: ReplacedByTests,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
}
