mod decide;
mod esm_syntax;
mod main_module;
#[cfg(all(test, not(miri)))]
mod tests;
mod this_of_file;

pub(crate) use decide::decide_module_format;
pub(crate) use esm_syntax::{file_esm_syntax, statement_esm_syntax};
pub use main_module::main_module_operand;
pub(crate) use this_of_file::collect_this_of_file;
pub use this_of_file::{ThisPositions, evaluates_own_this};

use crate::fold::FoldError;

#[derive(Copy, Clone, Default, PartialEq, Eq, Hash, Debug)]
pub enum ModuleFormat {
    #[default]
    Esm,
    CommonJs,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum DeclaredModuleType {
    Unknown,
    CommonJs,
    Esm,
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Default)]
    pub struct CommonJsEvidence: u8 {
        const MODULE = 1;
        const EXPORTS = 2;
        const WITH_STATEMENT = 4;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum EsmSyntax {
    None,
    ImportOrImportMeta,
    ExportOrTopLevelAwait,
}

pub(crate) struct FormatDecision {
    pub format: ModuleFormat,
    pub error: Option<FoldError>,
}
