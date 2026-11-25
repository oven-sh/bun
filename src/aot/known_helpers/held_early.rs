use crate::builtins::RuntimeModule;
use crate::modules::find_files_that_unknown_names_may_require;
use bun_sema::components::strongly_connected_components;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, ComputedTargets, Files};

#[derive(Copy, Clone, PartialEq, Eq)]
enum Load {
    AheadOfTheBody,
    AtACall,
    NotInTime,
}

fn classify(kind: ImportSiteKind, bodies_may_drain_jobs: bool) -> Load {
    match kind {
        ImportSiteKind::ImportCall(_) if bodies_may_drain_jobs => Load::AtACall,
        ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_)
        | ImportSiteKind::RequireByTestRunner(_) => Load::AtACall,
        ImportSiteKind::ImportCall(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::GetBuiltinModule(_)
        | ImportSiteKind::MockModule(_)
        | ImportSiteKind::ImportByTestRunner(_) => Load::NotInTime,
        _ => Load::AheadOfTheBody,
    }
}

fn imports_drain_microtasks(files: &Files<'_>) -> bool {
    let compiled = files.compiled_files().iter();
    let mut answers = compiled
        .filter_map(|&file| files.compiled(file))
        .flat_map(|it| it.code_answers);
    answers.any(|answer| match answer {
        CodeAnswer::HostModule(id) => {
            RuntimeModule::from_registry_id(id.0) == Some(RuntimeModule::BunJsc)
        }
        _ => false,
    })
}

pub(super) fn find_files_held_early(files: &Files<'_>) -> Vec<bool> {
    let file_count = files.modules.len();
    let bodies_may_drain_jobs = imports_drain_microtasks(files);
    let mut all: Vec<Vec<u32>> = vec![Vec::new(); file_count];
    let mut ahead_of_the_body: Vec<Vec<u32>> = vec![Vec::new(); file_count];
    let mut is_held_early = vec![false; file_count];
    for &file in files.compiled_files() {
        let compiled = files
            .compiled(file)
            .expect("the loader analyzes every compiled file");
        for (site, &answer) in compiled
            .analysis
            .import_sites
            .iter()
            .zip(compiled.code_answers)
        {
            let load = classify(site.kind, bodies_may_drain_jobs);
            let loaded = match answer {
                _ if load == Load::NotInTime => &[][..],
                CodeAnswer::File(ref loaded) => core::slice::from_ref(loaded),
                CodeAnswer::Computed(ComputedTargets::Modules { files, .. }) => files,
                CodeAnswer::Computed(ComputedTargets::All { .. }) => return vec![true; file_count],
                _ => &[][..],
            };
            for &loaded in loaded {
                all[file.idx()].push(loaded.0);
                if load == Load::AheadOfTheBody {
                    ahead_of_the_body[file.idx()].push(loaded.0);
                }
                is_held_early[loaded.idx()] |= load == Load::AtACall;
            }
        }
    }
    let (component_of, components) = strongly_connected_components(&all);
    for (file, targets) in all.iter().enumerate() {
        is_held_early[file] |=
            components[component_of[file] as usize].len() > 1 || targets.contains(&(file as u32));
    }
    for loaded in find_files_that_unknown_names_may_require(files) {
        is_held_early[loaded.idx()] = true;
    }
    let is_marked = is_held_early.iter();
    let mut pending: Vec<u32> = (0..)
        .zip(is_marked)
        .filter(|it| *it.1)
        .map(|it| it.0)
        .collect();
    while let Some(file) = pending.pop() {
        for &target in &ahead_of_the_body[file as usize] {
            if !core::mem::replace(&mut is_held_early[target as usize], true) {
                pending.push(target);
            }
        }
    }
    is_held_early
}
