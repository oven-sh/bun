#[path = "../compile/paths.rs"]
mod paths;

pub use self::paths::{EntryPointPaths, FolderPaths};
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
    /// Where `Options::lists_modules` asks for it.
    pub modules: Option<ModuleList>,
}

pub struct Compilation {
    pub engine: EngineResult,
    pub summary: ProgramSummary,
    /// `UsedFeatures::starts_workers_from_unseen_code`
    pub starts_workers_from_unseen_code: bool,
    /// The entry points that the load has found and that go by another name than the path of their module: the path that the name would have as a file of the executable, and the file on disk that it leads to.
    pub names_of_worker_files: Vec<EntryPointPaths>,
    /// The last folders of the root directory, where a path that the program writes goes up out of them and comes back. Empty where none does.
    pub root_folders_spelled: Vec<u8>,
    /// The program holds the path of a file on the machine that builds: `__filename`, `__dirname` or what `require.resolve` answers, as `bun build --compile` has them.
    pub holds_source_paths: bool,
    /// In a test run: a call of `import()` is given a path with a query.
    pub imports_file_with_query: bool,
    /// With code from disk: the files of the program, for the names of their packages.
    pub program_files: Vec<EntryPointPaths>,
    /// For a run from source, which has no image to list them: each name that an image would open on a built-in object, as the holder's number in the table of built-ins and the bytes of the name.
    /// Ascending by holder, then by the bytes of the name.
    pub names_added_to_builtins: Vec<(u32, Vec<u8>)>,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
}
