use super::code_load::{CodeEntry, LoadedCode};
use super::*;
use crate::import_sites::ImportSpecifier;
use crate::resolve::{
    CodeResolution, ComputedCandidate, ComputedResolution, ComputedSpelling, ComputedUnknown,
    ExternalKind, HostPayload, JsxSettings, SiteResolution,
};

impl<'s, 'r> CodeFiles<'s, 'r> {
    pub(super) fn finish_module(&self, file: FileId, module: &mut Module<'s>, arena: &'s Arena) {
        module.is_in_types_program = self.is_in_types_program[file.idx()];
        self.remove_code_only_edges(module, arena);
        let Some(index) = self.entry_of(file) else {
            module.runs_other_code = self.typed_files_with_other_code.contains(module.path.text);
            return;
        };
        let entry = &self.entries[index];
        let Some(code) = entry.code.lock().take() else {
            return;
        };
        self.compile(entry, *code, module, arena);
    }

    pub(super) fn into_code_graph(
        code_files: Option<CodeFiles<'s, 'r>>,
        modules: &[ModuleCell<'s>],
        session: &'s Session,
    ) -> CodeGraph<'s> {
        let Some(code_files) = code_files else {
            return CodeGraph::EMPTY;
        };
        let arena = session.arena();
        let entries = code_files.entries;
        let entry_points: Vec<FileId> = (code_files.entry_points.iter())
            .map(|&index| entries[index as usize].file)
            .map(|file| file.expect("entry point has no file"))
            .collect();
        let compiled_files: Vec<FileId> = (entries.iter())
            .filter_map(|entry| entry.file)
            .filter(|file| modules[file.idx()].compiled.is_some())
            .collect();
        let mut host_modules: Vec<HostModuleId> = Vec::new();
        for compiled in (compiled_files.iter()).filter_map(|file| modules[file.idx()].compiled) {
            debug_assert_eq!(
                compiled.code_answers.len(),
                compiled.analysis.import_sites.len()
            );
            let answers = (compiled.code_answers.iter()).chain(compiled.implied_answers);
            host_modules.extend(answers.flat_map(host_modules_of));
        }
        let mut payloads: Vec<Option<HostPayload>> = (0..modules.len()).map(|_| None).collect();
        for entry in entries {
            if let (Some(file), Some(payload)) = (entry.file, entry.payload) {
                payloads[file.idx()] = Some(payload);
            }
        }
        let loaded = ProgramFiles {
            entry_points: slice_in(&entry_points, arena),
            compiled_files: slice_in(&compiled_files, arena),
            is_compiled: file_set_in(modules.len(), &compiled_files, arena),
            host_modules: sorted_set_in(host_modules, arena),
        };
        CodeGraph::new(loaded, session.keep(payloads))
    }

    fn remove_code_only_edges(&self, module: &mut Module<'s>, arena: &'s Arena) {
        let is_in_types_program = |file: FileId| self.is_in_types_program[file.idx()];
        if !module.edges.iter().all(|&edge| is_in_types_program(edge)) {
            let edges = module.edges.iter().copied();
            let type_edges: Vec<FileId> = edges.filter(|&edge| is_in_types_program(edge)).collect();
            module.edges = slice_in(&type_edges, arena);
        }
        (module.imports).retain(|_, target| is_in_types_program(*target));
    }

    fn compile(
        &self,
        entry: &CodeEntry<'s, 'r>,
        code: LoadedCode<'s, 'r>,
        module: &mut Module<'s>,
        arena: &'s Arena,
    ) {
        debug_assert!(module.role != FileRole::TypesOnly);
        let target_files: Vec<Option<FileId>> = (entry.targets.iter())
            .map(|&target| self.entries[target as usize].file)
            .collect();
        assert_eq!(target_files.len(), code.targets.len());
        let (session, atoms) = (self.session, self.atoms);
        let LoadedCode {
            analyzed,
            resolutions,
            implied,
            types_answers,
            ..
        } = code;
        let settings = entry.settings.expect("code file has no transpile settings");
        let jsx: &'s JsxSettings = match analyzed.jsx {
            Some(with_pragmas) => session.keep(with_pragmas),
            None => &settings.jsx,
        };

        let sites = analyzed.analysis.import_sites;
        debug_assert_eq!(sites.len(), resolutions.len());
        let mut targets = TargetFiles(target_files.iter());
        let code_answers: Vec<CodeAnswer<'s>> = (sites.iter().zip(&resolutions))
            .map(|(site, resolution)| {
                answer_of(&atoms, arena, site.specifier, resolution, &mut targets)
            })
            .collect();
        let implied_answers: Vec<CodeAnswer<'s>> = (implied.iter())
            .map(|resolution| constant_answer(&atoms, None, resolution, &mut targets))
            .collect();
        debug_assert!(targets.is_exhausted());

        module.code_edges = slice_in(&unique_files(&target_files), arena);
        let compiled: &'s CompiledModule<'s> = arena.alloc(CompiledModule {
            analysis: analyzed.analysis,
            code_answers: slice_in(&code_answers, arena),
            implied_answers: slice_in(&implied_answers, arena),
            settings,
            jsx,
            jsx_mode: analyzed.jsx_mode,
            declared_module_type: analyzed.declared_module_type,
            is_package_type_module: analyzed.is_package_type_module,
            package: entry.package,
            side_effects: entry.side_effects,
            host_module: entry.host_module,
            loader: entry.key.loader,
            is_aot_source: analyzed.is_aot_source,
        });
        module.compiled = Some(compiled);

        if types_answers.is_empty() {
            return;
        }
        let capacity = types_answers.len() + module.imports.len();
        let mut imports = ArenaHashMap::with_capacity_and_hasher_in(capacity, FxBuild, arena);
        imports.extend(module.imports.iter().map(|(&key, &file)| (key, file)));
        for (specifier, mode, target) in types_answers {
            if let Some(file) = target_files[target as usize] {
                imports.insert((specifier, mode), file);
            }
        }
        module.imports = imports;
    }
}

impl<'s> Files<'s> {
    pub(super) fn order_code_files(
        &self,
        seen: &mut [bool],
        libs: &mut Vec<FileId>,
        others: &mut Vec<FileId>,
    ) {
        if !self.code_graph.is_compile_build {
            return;
        }
        let entry_points = self.code_graph.viewed().entry_points.iter().copied();
        let all_files = (0..self.modules.len() as u32).map(FileId);
        let mut stack: Vec<(FileId, usize)> = Vec::new();
        for root in entry_points.chain(all_files) {
            if !std::mem::replace(&mut seen[root.idx()], true) {
                stack.push((root, 0));
            }
            while let Some(top) = stack.last_mut() {
                let (file, next) = *top;
                let module = &self.modules[file.idx()];
                match edge_at(module, next) {
                    Some(edge) => {
                        top.1 += 1;
                        if !std::mem::replace(&mut seen[edge.idx()], true) {
                            stack.push((edge, 0));
                        }
                    }
                    None => {
                        match module.is_lib {
                            true => libs.push(file),
                            false => others.push(file),
                        }
                        stack.pop();
                    }
                }
            }
        }
    }
}

fn edge_at(module: &Module<'_>, index: usize) -> Option<FileId> {
    match module.edges.get(index) {
        Some(&edge) => Some(edge),
        None => module.code_edges.get(index - module.edges.len()).copied(),
    }
}

struct TargetFiles<'t>(std::slice::Iter<'t, Option<FileId>>);

impl TargetFiles<'_> {
    fn next_file(&mut self) -> Option<FileId> {
        let target = self.0.next();
        debug_assert!(target.is_some(), "file resolution has no target");
        target.copied().flatten()
    }

    fn is_exhausted(&self) -> bool {
        self.0.as_slice().is_empty()
    }
}

fn answer_of<'s>(
    atoms: &Interner<'s>,
    arena: &'s Arena,
    written: ImportSpecifier,
    resolution: &SiteResolution<'_>,
    targets: &mut TargetFiles<'_>,
) -> CodeAnswer<'s> {
    let (cause, candidates, spellings) = match resolution {
        SiteResolution::Constant(resolution) => {
            let written = match written {
                ImportSpecifier::Constant(specifier) => Some(specifier),
                ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => None,
            };
            return constant_answer(atoms, written, resolution, targets);
        }
        SiteResolution::Computed(ComputedResolution::Candidates {
            candidates,
            spellings,
        }) => (None, *candidates, *spellings),
        SiteResolution::Computed(ComputedResolution::All {
            cause,
            host_modules,
        }) => (Some(*cause), *host_modules, &[][..]),
    };
    let targets = candidate_targets(candidates, targets);
    CodeAnswer::Computed(computed_targets(atoms, arena, cause, &targets, spellings))
}

fn candidate_targets(
    candidates: &[ComputedCandidate<'_>],
    targets: &mut TargetFiles<'_>,
) -> Vec<Option<ComputedTarget>> {
    let target_of = |candidate: &ComputedCandidate<'_>| match *candidate {
        ComputedCandidate::File(_) => {
            let file = targets.next_file();
            debug_assert!(file.is_some(), "computed candidate has no file");
            file.map(ComputedTarget::File)
        }
        ComputedCandidate::HostModule(module) => Some(ComputedTarget::HostModule(module)),
    };
    candidates.iter().map(target_of).collect()
}

fn computed_targets<'s>(
    atoms: &Interner<'s>,
    arena: &'s Arena,
    cause: Option<ComputedUnknown>,
    targets: &[Option<ComputedTarget>],
    spellings: &[ComputedSpelling<'_>],
) -> ComputedTargets<'s> {
    let (mut files, mut host_modules) = (Vec::new(), Vec::new());
    for target in targets.iter().flatten() {
        match *target {
            ComputedTarget::File(file) => files.push(file),
            ComputedTarget::HostModule(module) => host_modules.push(module),
        }
    }
    let host_modules = sorted_set_in(host_modules, arena);
    let has_every_target = targets.iter().all(Option::is_some);
    let missing_target = (!has_every_target).then_some(ComputedUnknown::ExternalCandidate);
    if let Some(cause) = cause.or(missing_target) {
        return ComputedTargets::All {
            cause,
            host_modules,
        };
    }
    let spellings: Vec<(Atom, ComputedTarget)> = spellings
        .iter()
        .filter_map(|it| Some((atoms.intern(it.text), targets[it.candidate as usize]?)))
        .collect();
    ComputedTargets::Modules {
        files: sorted_set_in(files, arena),
        host_modules,
        spellings: slice_in(&spellings, arena),
    }
}

fn constant_answer<'s>(
    atoms: &Interner<'s>,
    written: Option<Atom>,
    resolution: &CodeResolution<'_>,
    targets: &mut TargetFiles<'_>,
) -> CodeAnswer<'s> {
    match *resolution {
        CodeResolution::File(file) => match targets.next_file() {
            Some(target) => CodeAnswer::File(target),
            None => CodeAnswer::External {
                specifier: written.unwrap_or_else(|| atoms.intern(file.path)),
                kind: ExternalKind::UncompiledCode,
            },
        },
        CodeResolution::HostModule(module) => CodeAnswer::HostModule(module),
        CodeResolution::External { specifier, kind } => CodeAnswer::External {
            specifier: atoms.intern(specifier),
            kind,
        },
        CodeResolution::Erased => CodeAnswer::Erased,
        CodeResolution::NotFound(failure) => CodeAnswer::NotFound(failure),
    }
}

fn host_modules_of<'a>(answer: &'a CodeAnswer<'_>) -> &'a [HostModuleId] {
    match answer {
        CodeAnswer::HostModule(module) => std::slice::from_ref(module),
        _ => &[],
    }
}

fn unique_files(targets: &[Option<FileId>]) -> Vec<FileId> {
    let mut seen = FxHashSet::default();
    let files = targets.iter().flatten();
    files.filter(|&&file| seen.insert(file)).copied().collect()
}

fn file_set_in<'s>(file_count: usize, members: &[FileId], arena: &'s Arena) -> &'s [bool] {
    if members.is_empty() {
        return &[];
    }
    let is_member = arena.alloc_slice_fill_copy(file_count, false);
    for file in members {
        is_member[file.idx()] = true;
    }
    is_member
}

fn sorted_set_in<'s, T: Copy + Ord>(mut members: Vec<T>, arena: &'s Arena) -> &'s [T] {
    members.shared_sort_unstable();
    members.dedup();
    slice_in(&members, arena)
}

#[cfg(test)]
mod tests;
