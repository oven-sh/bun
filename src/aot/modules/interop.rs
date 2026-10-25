#[cfg(test)]
mod tests;

pub use crate::ir::generated::{ImportPhase, ModuleKind, RequireResult, SyntheticExportRule};

use crate::builtins::table;
use crate::load::{SourceKind, Sources};
use bun_sema::atom::known;
use bun_sema::bind::Bound;
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::ExternalKind;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Interop {
    pub kind: ModuleKind,
    pub export_rule: SyntheticExportRule,
    pub require_result: RequireResult,
}

impl Interop {
    pub(crate) const RUNTIME: Interop = Interop::new(
        ModuleKind::Runtime,
        SyntheticExportRule::RuntimeModule,
        RequireResult::DefaultExport,
    );
    pub(crate) const RUNTIME_SOURCE: Interop = Interop::new(
        ModuleKind::RuntimeSource,
        SyntheticExportRule::RuntimeModule,
        RequireResult::DefaultExport,
    );
    const UNCOMPILED_CODE: Interop = Interop::new(
        ModuleKind::External,
        SyntheticExportRule::None,
        RequireResult::Namespace,
    );
    const HOST_VALUE: Interop = Interop::new(
        ModuleKind::External,
        SyntheticExportRule::RuntimeModule,
        RequireResult::DefaultExport,
    );
    pub(crate) const ES_MODULE: Interop = Interop::new(
        ModuleKind::SourceText,
        SyntheticExportRule::None,
        RequireResult::Namespace,
    );

    /// The callback of `__commonJS(cb)` or `__esm(fn)`: a body and no export table, whichever helper wraps it.
    pub(crate) const INNER_MODULE: Interop = Interop::new(
        ModuleKind::CommonJs,
        SyntheticExportRule::None,
        RequireResult::ModuleExports,
    );

    const fn new(
        kind: ModuleKind,
        export_rule: SyntheticExportRule,
        require_result: RequireResult,
    ) -> Interop {
        Interop {
            kind,
            export_rule,
            require_result,
        }
    }

    pub(crate) fn of_external(kind: ExternalKind) -> Interop {
        match kind {
            ExternalKind::UncompiledCode => Interop::UNCOMPILED_CODE,
            ExternalKind::HostValue => Interop::HOST_VALUE,
        }
    }

    pub fn has_export_table(self) -> bool {
        matches!(self.kind, ModuleKind::SourceText | ModuleKind::Data)
    }
}

pub(crate) fn file_interop(files: &Files<'_>, sources: &Sources, file: FileId) -> Interop {
    match files.role(file) {
        FileRole::TypesOnly => return Interop::ES_MODULE,
        FileRole::Checked | FileRole::Inferred => {}
    }
    match sources.kind(file) {
        SourceKind::RuntimeFunctions | SourceKind::TypesOnly => Interop::ES_MODULE,
        SourceKind::RuntimeModule(module) if table::is_es_module(module) => Interop::ES_MODULE,
        SourceKind::RuntimeModule(_) => Interop::RUNTIME_SOURCE,
        SourceKind::Data => data_module_interop(files.bound(file)),
        SourceKind::Program | SourceKind::EvaluatedText => program_file_interop(files, file),
    }
}

fn data_module_interop(bound: &Bound<'_>) -> Interop {
    let exports = bound.symbol(bound.file_symbol).exports;
    let require_result = match bound.lookup(exports, known::default) {
        Some(_) => RequireResult::DefaultExport,
        None => RequireResult::Namespace,
    };
    Interop::new(ModuleKind::Data, SyntheticExportRule::None, require_result)
}

fn program_file_interop(files: &Files<'_>, file: FileId) -> Interop {
    match files.analysis(file).module_format {
        ModuleFormat::Esm => Interop::ES_MODULE,
        ModuleFormat::CommonJs => {
            let export_rule = match files.is_package_type_module(file) {
                true => SyntheticExportRule::CommonJsIgnoringAnnotation,
                false => SyntheticExportRule::CommonJs,
            };
            Interop::new(
                ModuleKind::CommonJs,
                export_rule,
                RequireResult::ModuleExports,
            )
        }
    }
}
