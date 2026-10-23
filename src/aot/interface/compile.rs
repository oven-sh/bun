#![allow(clippy::result_large_err, reason = "a build fails at most once")]

use bun_ast::Log;

use crate::engine::EngineResult;
use crate::link::ProgramNames;
use crate::linked;
use crate::load::source_provider::SourceProvider;
use crate::module_list::ModuleList;
use crate::options::Options;
use crate::report::SourceTexts;
use crate::statistics::{Stage, Statistics};

pub struct ProgramSummary {
    pub entry_points: Vec<EntryPointPaths>,
    pub folders: Vec<FolderPaths>,
    pub names: ProgramNames,
    pub texts: SourceTexts,
    pub statistics: Statistics,
    pub validates_by_type: bool,
    /// Where `Options::lists_modules` asks for it.
    pub modules: Option<ModuleList>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntryPointPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FolderPaths {
    pub public_path: Vec<u8>,
    pub source_path: Vec<u8>,
}

pub struct Compilation {
    pub engine: EngineResult,
    pub summary: ProgramSummary,
}

pub struct BuildFailed {
    pub stage: Stage,
    pub is_internal_error: bool,
    pub statistics: Statistics,
    pub compilation: Option<Box<Compilation>>,
    pub refused_entry_points: Option<Vec<u32>>,
}

pub fn compile(
    options: &Options<'_>,
    provider: &dyn SourceProvider,
    log: &mut Log,
) -> Result<Compilation, BuildFailed> {
    linked::bun_aot_compile(options, provider, log)
}
