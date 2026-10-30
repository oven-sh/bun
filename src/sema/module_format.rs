mod decide;
mod esm_syntax;
mod main_module;
#[cfg(all(test, not(miri)))]
mod tests;
mod this_of_file;

pub(crate) use decide::{decide_module_format, find_marked_format};
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

/// The format of a text for each type that may be declared for it.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct FormatByDeclaredType {
    unknown: ModuleFormat,
    commonjs: ModuleFormat,
    esm: ModuleFormat,
}

impl FormatByDeclaredType {
    pub(crate) fn decided_by_text(format: ModuleFormat) -> FormatByDeclaredType {
        FormatByDeclaredType {
            unknown: format,
            commonjs: format,
            esm: format,
        }
    }

    pub fn is_decided_by_text(self) -> bool {
        self.unknown == self.commonjs && self.commonjs == self.esm
    }

    pub fn get(self, declared: DeclaredModuleType) -> ModuleFormat {
        match declared {
            DeclaredModuleType::Unknown => self.unknown,
            DeclaredModuleType::CommonJs => self.commonjs,
            DeclaredModuleType::Esm => self.esm,
        }
    }
}

pub(crate) struct FormatDecision {
    pub formats: FormatByDeclaredType,
    pub error: Option<FoldError>,
}
