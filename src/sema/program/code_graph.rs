use super::*;
use crate::file_analysis::FileAnalysis;
use crate::import_sites::JsxMode;
use crate::module_format::DeclaredModuleType;
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
    pub is_package_type_module: bool,
    pub package: Option<EnclosingPackage<'s>>,
    pub side_effects: DeclaredSideEffects<'s>,
    pub host_module: Option<HostModuleId>,
    pub loader: HostLoader,
    /// TypeScript of a package whose `exports` name the "aot" condition.
    pub is_aot_source: bool,
}

#[derive(Copy, Clone)]
pub(super) struct ProgramFiles<'s> {
    pub(super) entry_points: &'s [FileId],
    pub(super) compiled_files: &'s [FileId],
    pub(super) is_compiled: &'s [bool],
    pub(super) host_modules: &'s [HostModuleId],
}

impl ProgramFiles<'_> {
    const EMPTY: ProgramFiles<'static> = ProgramFiles {
        entry_points: &[],
        compiled_files: &[],
        is_compiled: &[],
        host_modules: &[],
    };
}

pub(super) struct Viewed<'s>(core::cell::UnsafeCell<ProgramFiles<'s>>);

// SAFETY: written by `Files::view_program` alone, whose caller sees to it that no other thread reads meanwhile.
unsafe impl Sync for Viewed<'_> {}

pub(super) struct CodeGraph<'s> {
    pub(super) is_compile_build: bool,
    loaded: ProgramFiles<'s>,
    viewed: Viewed<'s>,
    pub(super) host_payloads: &'s [Option<HostPayload>],
}

impl<'s> CodeGraph<'s> {
    pub(super) const EMPTY: CodeGraph<'s> = CodeGraph {
        is_compile_build: false,
        loaded: ProgramFiles::EMPTY,
        viewed: Viewed(core::cell::UnsafeCell::new(ProgramFiles::EMPTY)),
        host_payloads: &[],
    };

    pub(super) fn new(
        loaded: ProgramFiles<'s>,
        host_payloads: &'s [Option<HostPayload>],
    ) -> CodeGraph<'s> {
        CodeGraph {
            is_compile_build: true,
            loaded,
            viewed: Viewed(core::cell::UnsafeCell::new(loaded)),
            host_payloads,
        }
    }

    #[inline]
    pub(super) fn viewed(&self) -> ProgramFiles<'s> {
        // SAFETY: see `Viewed`.
        unsafe { *self.viewed.0.get() }
    }
}

impl<'s> Files<'s> {
    /// The files were loaded for several programs, each of which begins at one entry point. From here on the entry points, the
    /// compiled files and the modules of the host are those of the program that begins at `first`: what its imports lead to.
    /// `None`: of all programs again.
    ///
    /// # Safety
    /// No other thread reads the files during the call.
    pub unsafe fn view_program(&self, first: Option<FileId>) {
        let loaded = self.code_graph.loaded;
        let viewed = match first {
            None => loaded,
            Some(first) => {
                let mut is_compiled = vec![false; self.modules.len()];
                is_compiled[first.idx()] = true;
                let mut pending = vec![first];
                while let Some(file) = pending.pop() {
                    for &target in self.module(file).code_edges {
                        if !core::mem::replace(&mut is_compiled[target.idx()], true) {
                            pending.push(target);
                        }
                    }
                }
                for (index, is_compiled) in is_compiled.iter_mut().enumerate() {
                    *is_compiled &= loaded.is_compiled.get(index).copied().unwrap_or(false);
                }
                let compiled_files = loaded.compiled_files.iter().copied();
                let compiled_files: Vec<FileId> = compiled_files
                    .filter(|file| is_compiled[file.idx()])
                    .collect();
                let mut host_modules: Vec<HostModuleId> = Vec::new();
                for compiled in compiled_files
                    .iter()
                    .filter_map(|&file| self.compiled(file))
                {
                    let answers = (compiled.code_answers.iter()).chain(compiled.implied_answers);
                    host_modules.extend(answers.filter_map(|answer| match answer {
                        CodeAnswer::HostModule(module) => Some(*module),
                        _ => None,
                    }));
                }
                host_modules.sort_unstable();
                host_modules.dedup();
                let session: &'s Session = self.session;
                ProgramFiles {
                    entry_points: session.keep(vec![first]),
                    compiled_files: session.keep(compiled_files),
                    is_compiled: session.keep(is_compiled),
                    host_modules: session.keep(host_modules),
                }
            }
        };
        // SAFETY: the caller's.
        unsafe { *self.code_graph.viewed.0.get() = viewed };
    }

    pub fn is_program_in_order_of_its_own_load(&self, first: FileId) -> bool {
        let loaded = self.code_graph.loaded;
        let mut is_seen = vec![false; self.modules.len()];
        is_seen[first.idx()] = true;
        let mut order: Vec<FileId> = Vec::new();
        let mut stack: Vec<(FileId, usize)> = vec![(first, 0)];
        while let Some(top) = stack.last_mut() {
            let (file, next) = *top;
            match self.module(file).code_edges.get(next) {
                Some(&target) => {
                    top.1 += 1;
                    if !core::mem::replace(&mut is_seen[target.idx()], true) {
                        stack.push((target, 0));
                    }
                }
                None => {
                    order.push(file);
                    stack.pop();
                }
            }
        }
        let is_compiled = |file: &FileId| loaded.is_compiled.get(file.idx()) == Some(&true);
        let is_other_entry_point =
            |file: &FileId| *file != first && loaded.entry_points.contains(file);
        let in_this_load = loaded
            .compiled_files
            .iter()
            .filter(|file| is_seen[file.idx()]);
        !order.iter().any(is_other_entry_point)
            && order
                .iter()
                .filter(|file| is_compiled(file))
                .eq(in_this_load)
    }

    pub fn declaring_files_of_each_program(&self) -> Vec<Vec<FileId>> {
        let entry_points = self.code_graph.loaded.entry_points;
        let targets_of = |file: FileId| {
            let module = self.module(file);
            module.edges.iter().chain(module.code_edges).copied()
        };
        let all_files = || (0..self.modules.len() as u32).map(FileId);
        let declaring: Vec<FileId> = all_files()
            .filter(|&file| self.declares_for_files_that_do_not_import_it(file))
            .collect();
        if declaring.is_empty() {
            return vec![Vec::new(); entry_points.len()];
        }
        let mut is_referred_to = vec![false; self.modules.len()];
        for target in all_files().flat_map(targets_of) {
            is_referred_to[target.idx()] = true;
        }
        let is_there_for_all = self.reached_from(
            all_files()
                .filter(|file| !is_referred_to[file.idx()] && !entry_points.contains(file))
                .collect(),
        );
        let of_program = |&first: &FileId| {
            let is_reached = self.reached_from(vec![first]);
            let own = declaring.iter().copied();
            own.filter(|file| is_reached[file.idx()] && !is_there_for_all[file.idx()])
                .collect()
        };
        entry_points.iter().map(of_program).collect()
    }

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

    fn declares_for_files_that_do_not_import_it(&self, file: FileId) -> bool {
        let module = self.module(file);
        let bound = &module.bound;
        module.is_in_types_program
            && module.hir.kind != FileKind::Json
            && (!module.is_module()
                || !bound.global_augmentations.is_empty()
                || !bound.module_augmentations.is_empty()
                || !bound.umd_globals.is_empty()
                || !bound.pattern_ambient_modules.is_empty()
                || !bound.ambient_modules.is_empty())
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
        self.code_graph.viewed().entry_points
    }

    #[inline]
    pub fn compiled_files(&self) -> &'s [FileId] {
        self.code_graph.viewed().compiled_files
    }

    #[inline]
    pub fn is_compiled(&self, file: FileId) -> bool {
        let is_compiled = self.code_graph.viewed().is_compiled;
        is_compiled.get(file.idx()).copied().unwrap_or(false)
    }

    #[inline]
    pub fn host_modules(&self) -> &'s [HostModuleId] {
        self.code_graph.viewed().host_modules
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
        let files = graph.viewed();
        assert!(files.entry_points.is_empty());
        assert!(files.compiled_files.is_empty());
        assert!(files.is_compiled.is_empty());
        assert!(files.host_modules.is_empty());
        assert!(graph.host_payloads.is_empty());
    }
}
