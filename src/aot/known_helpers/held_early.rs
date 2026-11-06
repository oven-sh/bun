use bun_sema::components::strongly_connected_components;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, ComputedTargets, Files};

#[derive(Copy, Clone, PartialEq, Eq)]
enum Load {
    AheadOfTheBody,
    AtACall,
    /// The site loads nothing, or it answers a promise that is settled when the file has run to its end.
    NotInTime,
}

fn classify(kind: ImportSiteKind) -> Load {
    match kind {
        ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_) => Load::AtACall,
        ImportSiteKind::ImportCall(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::GetBuiltinModule(_) => Load::NotInTime,
        _ => Load::AheadOfTheBody,
    }
}

/// For each file, whether code of another file can call what the file exports before the file has run to its end: the file lies on a cycle of imports and requires, a `require` names it, or such a file imports it.
pub(super) fn find_files_held_early(files: &Files<'_>) -> Vec<bool> {
    let file_count = files.modules.len();
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
            let load = classify(site.kind);
            let loaded = match answer {
                _ if load == Load::NotInTime => &[][..],
                CodeAnswer::File(ref loaded) => core::slice::from_ref(loaded),
                CodeAnswer::Computed(ComputedTargets::Modules { files, .. }) => files,
                // A call loads a file that nobody can name.
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
    // A function declaration of a file that has not run yet calls those of the files that it imports.
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
