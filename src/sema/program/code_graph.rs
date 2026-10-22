use super::*;
use crate::erasure::ErasureMismatchKind;
use crate::file_analysis::FileAnalysis;
use crate::import_sites::JsxMode;
use crate::module_format::DeclaredModuleType;
use crate::resolve::{
    CodeFailure, ComputedUnknown, DeclaredSideEffects, EnclosingPackage, ExternalKind, HostPayload,
    JsxSettings, TranspileSettings, TypedVersionOrigin,
};
use std::any::Any;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FileRole {
    Checked,
    Inferred,
    TypesOnly,
}

impl FileRole {
    pub(super) fn of_tree(hir: &hir::File<'_>) -> FileRole {
        match hir.kind {
            FileKind::Declaration => FileRole::TypesOnly,
            FileKind::Json => FileRole::Inferred,
            FileKind::Ts | FileKind::Tsx if hir.is_js => FileRole::Inferred,
            FileKind::Ts | FileKind::Tsx => FileRole::Checked,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct HostModuleId(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
pub struct HostLoader(pub u8);

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CodeAnswer<'s> {
    File(FileId),
    HostModule(HostModuleId),
    External {
        specifier: Atom,
        kind: ExternalKind,
    },
    Erased,
    Computed(ComputedTargets<'s>),
    NotFound(CodeFailure),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ComputedTarget {
    File(FileId),
    HostModule(HostModuleId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ComputedTargets<'s> {
    Modules {
        files: &'s [FileId],
        host_modules: &'s [HostModuleId],
        spellings: &'s [(Atom, ComputedTarget)],
    },
    All {
        cause: ComputedUnknown,
        host_modules: &'s [HostModuleId],
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct RejectedTypedVersion<'a> {
    pub path: &'a [u8],
    pub kind: ErasureMismatchKind,
    pub installed_range: (u32, u32),
}

#[derive(Copy, Clone, Debug)]
pub struct InstalledText<'s> {
    pub text: &'s [u8],
    pub functions: &'s [(u32, u32)],
    pub classes: &'s [(u32, u32)],
    pub token_offsets: &'s [(u32, u32)],
}

pub struct CompiledModule<'s> {
    pub analysis: FileAnalysis<'s>,
    pub code_answers: &'s [CodeAnswer<'s>],
    pub implied_answers: &'s [CodeAnswer<'s>],
    pub settings: &'s TranspileSettings,
    pub jsx: &'s JsxSettings,
    pub jsx_mode: JsxMode,
    pub declared_module_type: DeclaredModuleType,
    pub is_package_type_module: bool,
    pub package: Option<EnclosingPackage<'s>>,
    pub side_effects: DeclaredSideEffects<'s>,
    pub host_module: Option<HostModuleId>,
    pub loader: HostLoader,
    pub typed_source_path: Option<&'s [u8]>,
    pub installed_text: Option<InstalledText<'s>>,
    pub rejected_typed_version: Option<RejectedTypedVersion<'s>>,
    pub typed_version_origin: Option<TypedVersionOrigin>,
}

pub(super) struct CodeGraph<'s> {
    pub(super) is_compile_build: bool,
    pub(super) entry_points: &'s [FileId],
    pub(super) compiled_files: &'s [FileId],
    pub(super) is_compiled: &'s [bool],
    pub(super) host_modules: &'s [HostModuleId],
    pub(super) host_payloads: &'s [Option<HostPayload>],
}

impl CodeGraph<'_> {
    pub(super) const EMPTY: CodeGraph<'static> = CodeGraph {
        is_compile_build: false,
        entry_points: &[],
        compiled_files: &[],
        is_compiled: &[],
        host_modules: &[],
        host_payloads: &[],
    };
}

impl<'s> Files<'s> {
    #[inline]
    pub fn is_compile_build(&self) -> bool {
        self.code_graph.is_compile_build
    }

    #[inline]
    pub fn role(&self, file: FileId) -> FileRole {
        self.module(file).role
    }

    #[inline]
    pub fn compiled(&self, file: FileId) -> Option<&'s CompiledModule<'s>> {
        self.module(file).compiled
    }

    #[inline]
    pub fn analysis(&self, file: FileId) -> &'s FileAnalysis<'s> {
        &self
            .compiled(file)
            .expect("a file without an analysis")
            .analysis
    }

    #[inline]
    pub fn code_answers(&self, file: FileId) -> &'s [CodeAnswer<'s>] {
        match self.compiled(file) {
            Some(compiled) => compiled.code_answers,
            None => &[],
        }
    }

    #[inline]
    pub fn is_package_type_module(&self, file: FileId) -> bool {
        self.compiled(file)
            .is_some_and(|compiled| compiled.is_package_type_module)
    }

    #[inline]
    pub fn declared_side_effects(&self, file: FileId) -> DeclaredSideEffects<'s> {
        match self.compiled(file) {
            Some(compiled) => compiled.side_effects,
            None => DeclaredSideEffects::Unspecified,
        }
    }

    #[inline]
    pub fn entry_points(&self) -> &'s [FileId] {
        self.code_graph.entry_points
    }

    #[inline]
    pub fn compiled_files(&self) -> &'s [FileId] {
        self.code_graph.compiled_files
    }

    #[inline]
    pub fn is_compiled(&self, file: FileId) -> bool {
        let is_compiled = self.code_graph.is_compiled;
        is_compiled.get(file.idx()).copied().unwrap_or(false)
    }

    #[inline]
    pub fn host_modules(&self) -> &'s [HostModuleId] {
        self.code_graph.host_modules
    }

    #[inline]
    pub fn host_payload(&self, file: FileId) -> Option<&'s (dyn Any + Send + Sync)> {
        let payloads = self.code_graph.host_payloads;
        payloads.get(file.idx())?.as_deref()
    }

    #[inline]
    pub fn diagnostic_path(&self, file: FileId) -> &'s [u8] {
        let module = self.module(file);
        let typed_source_path = module.compiled.and_then(|it| it.typed_source_path);
        typed_source_path.unwrap_or_else(|| module.file_name())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TREES: [(FileKind, bool, FileRole); 6] = [
        (FileKind::Ts, false, FileRole::Checked),
        (FileKind::Tsx, false, FileRole::Checked),
        (FileKind::Ts, true, FileRole::Inferred),
        (FileKind::Tsx, true, FileRole::Inferred),
        (FileKind::Declaration, false, FileRole::TypesOnly),
        (FileKind::Json, false, FileRole::Inferred),
    ];

    #[test]
    fn role_follows_tree() {
        for (kind, is_js, expected) in TREES {
            let session = Session::new();
            let mut hir = hir::File::empty_in(session.arena(), &session);
            hir.kind = kind;
            hir.is_js = is_js;
            assert_eq!(
                FileRole::of_tree(&hir),
                expected,
                "{kind:?}, is_js: {is_js}"
            );
        }
    }

    #[test]
    fn empty_graph_has_no_files() {
        let graph = CodeGraph::EMPTY;
        assert!(!graph.is_compile_build);
        assert!(graph.entry_points.is_empty());
        assert!(graph.compiled_files.is_empty());
        assert!(graph.is_compiled.is_empty());
        assert!(graph.host_modules.is_empty());
        assert!(graph.host_payloads.is_empty());
    }
}
