use super::*;
use crate::file_analysis::FileAnalysis;
use crate::import_sites::JsxMode;
use crate::module_format::{DeclaredModuleType, ModuleFormat};
use crate::resolve::{
    CodeFailure, ComputedUnknown, DeclaredSideEffects, EnclosingPackage, ExternalKind, HostPayload,
    JsxSettings, TranspileSettings,
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
    External { specifier: Atom, kind: ExternalKind },
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

pub struct CompiledModule<'s> {
    pub analysis: FileAnalysis<'s>,
    pub code_answers: &'s [CodeAnswer<'s>],
    pub implied_answers: &'s [CodeAnswer<'s>],
    pub settings: &'s TranspileSettings,
    pub jsx: &'s JsxSettings,
    pub jsx_mode: JsxMode,
    pub declared_module_type: DeclaredModuleType,
    pub type_where_imported: DeclaredModuleType,
    pub runs_inside_require: bool,
    pub is_package_type_module: bool,
    pub package: Option<EnclosingPackage<'s>>,
    pub side_effects: DeclaredSideEffects<'s>,
    pub host_module: Option<HostModuleId>,
    pub loader: HostLoader,
    pub is_aot_source: bool,
}

pub trait CodeView<'s>: Sync {
    fn atoms(&self) -> &Interner<'s>;
    fn hir(&self, file: FileId) -> &hir::File<'s>;
    fn bound(&self, file: FileId) -> &Bound<'s>;
    fn analysis(&self, file: FileId) -> &FileAnalysis<'s>;
    fn answers(&self, file: FileId) -> Option<(&[CodeAnswer<'s>], &[CodeAnswer<'s>])>;
    fn file_name(&self, file: FileId) -> &[u8];
    fn entry_points(&self) -> &[FileId];
    fn compiled_files(&self) -> &[FileId];
    fn host_payload(&self, file: FileId) -> Option<&(dyn Any + Send + Sync)>;
}

impl<'s> CodeView<'s> for Files<'s> {
    fn atoms(&self) -> &Interner<'s> {
        &self.atoms
    }

    fn hir(&self, file: FileId) -> &hir::File<'s> {
        Files::hir(self, file)
    }

    fn bound(&self, file: FileId) -> &Bound<'s> {
        Files::bound(self, file)
    }

    fn analysis(&self, file: FileId) -> &FileAnalysis<'s> {
        Files::analysis(self, file)
    }

    fn answers(&self, file: FileId) -> Option<(&[CodeAnswer<'s>], &[CodeAnswer<'s>])> {
        let compiled = self.compiled(file)?;
        Some((compiled.code_answers, compiled.implied_answers))
    }

    fn file_name(&self, file: FileId) -> &[u8] {
        self.module(file).file_name()
    }

    fn entry_points(&self) -> &[FileId] {
        Files::entry_points(self)
    }

    fn compiled_files(&self) -> &[FileId] {
        Files::compiled_files(self)
    }

    fn host_payload(&self, file: FileId) -> Option<&(dyn Any + Send + Sync)> {
        Files::host_payload(self, file)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct NamingLoad {
    pub file: FileId,
    pub requires: bool,
}

#[derive(Default)]
pub struct EntryPointsFound {
    pub paths: Vec<Vec<u8>>,
    pub dropped: Vec<Vec<u8>>,
    pub named_by: Vec<(Vec<u8>, Option<NamingLoad>)>,
}

pub type FindsEntryPoints<'a> = dyn Fn(&dyn CodeView<'_>) -> EntryPointsFound + Sync + 'a;

pub(super) struct CodeGraph<'s> {
    pub(super) is_compile_build: bool,
    pub(super) entry_points: &'s [FileId],
    pub(super) compiled_files: &'s [FileId],
    pub(super) is_compiled: &'s [bool],
    pub(super) host_modules: &'s [HostModuleId],
    pub(super) host_payloads: &'s [Option<HostPayload>],
}

impl<'s> CodeGraph<'s> {
    pub(super) const EMPTY: CodeGraph<'s> = CodeGraph {
        is_compile_build: false,
        entry_points: &[],
        compiled_files: &[],
        is_compiled: &[],
        host_modules: &[],
        host_payloads: &[],
    };
}

impl<'s> Files<'s> {
    pub fn reached_from(&self, roots: Vec<FileId>) -> Vec<bool> {
        let mut is_reached = vec![false; self.modules.len()];
        let mut pending = roots;
        for &root in &pending {
            is_reached[root.idx()] = true;
        }
        while let Some(file) = pending.pop() {
            let module = self.module(file);
            for &target in module.edges.iter().chain(module.code_edges) {
                if !core::mem::replace(&mut is_reached[target.idx()], true) {
                    pending.push(target);
                }
            }
        }
        is_reached
    }
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

    #[cfg(any(test, feature = "test_support"))]
    #[inline]
    pub fn code_answers(&self, file: FileId) -> &'s [CodeAnswer<'s>] {
        match self.compiled(file) {
            Some(compiled) => compiled.code_answers,
            None => &[],
        }
    }

    pub fn is_es_module_to_imports(&self, file: FileId) -> bool {
        self.compiled(file).is_some_and(|compiled| {
            let analysis = &compiled.analysis;
            analysis.module_format == ModuleFormat::CommonJs
                && compiled.host_module.is_none()
                && !compiled.runs_inside_require
                && analysis.module_formats.get(compiled.type_where_imported) == ModuleFormat::Esm
        })
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
