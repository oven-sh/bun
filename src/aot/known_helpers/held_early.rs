use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{CodeAnswer, ComputedTargets, FileId, Files};

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

struct Loads {
    targets: Vec<Vec<(FileId, Load)>>,
    is_held_early: Vec<bool>,
}

/// `None`: a call loads a file that nobody can name.
fn collect_loads(files: &Files<'_>) -> Option<Loads> {
    let file_count = files.modules.len();
    let mut loads = Loads {
        targets: vec![Vec::new(); file_count],
        is_held_early: vec![false; file_count],
    };
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
                CodeAnswer::Computed(ComputedTargets::All { .. }) => return None,
                _ => &[][..],
            };
            for &loaded in loaded {
                loads.targets[file.idx()].push((loaded, load));
                loads.is_held_early[loaded.idx()] |= load == Load::AtACall;
            }
        }
    }
    Some(loads)
}

fn mark_cycles(loads: &mut Loads) {
    const UNSEEN: u32 = u32::MAX;
    let file_count = loads.targets.len();
    let mut order = vec![UNSEEN; file_count];
    let mut lowest = vec![0; file_count];
    let mut is_open = vec![false; file_count];
    let mut open: Vec<usize> = Vec::new();
    let mut walk: Vec<(usize, usize)> = Vec::new();
    let mut seen_count = 0;
    for root in 0..file_count {
        if order[root] != UNSEEN {
            continue;
        }
        walk.push((root, 0));
        while let Some(&(file, next)) = walk.last() {
            if next == 0 {
                (order[file], lowest[file]) = (seen_count, seen_count);
                seen_count += 1;
                open.push(file);
                is_open[file] = true;
            }
            if let Some(target) = loads.targets[file].get(next) {
                let target = target.0.idx();
                walk.last_mut().expect("it was read above").1 += 1;
                if order[target] == UNSEEN {
                    walk.push((target, 0));
                } else if is_open[target] {
                    lowest[file] = lowest[file].min(order[target]);
                }
                continue;
            }
            walk.pop();
            if let Some(&(loader, _)) = walk.last() {
                lowest[loader] = lowest[loader].min(lowest[file]);
            }
            if lowest[file] != order[file] {
                continue;
            }
            let start = open
                .iter()
                .rposition(|&it| it == file)
                .expect("the file is open");
            let loads_itself = loads.targets[file]
                .iter()
                .any(|target| target.0.idx() == file);
            let is_cycle = open.len() - start > 1 || loads_itself;
            for member in open.drain(start..) {
                is_open[member] = false;
                loads.is_held_early[member] |= is_cycle;
            }
        }
    }
}

// A function declaration of a file that has not run yet calls those of the files that it imports.
fn mark_imports_of_marked_files(loads: &mut Loads) {
    let is_marked = loads.is_held_early.iter();
    let mut pending: Vec<usize> = is_marked
        .enumerate()
        .filter(|(_, is_marked)| **is_marked)
        .map(|(file, _)| file)
        .collect();
    while let Some(file) = pending.pop() {
        for &(target, load) in &loads.targets[file] {
            if load == Load::AheadOfTheBody && !loads.is_held_early[target.idx()] {
                loads.is_held_early[target.idx()] = true;
                pending.push(target.idx());
            }
        }
    }
}

/// For each file, whether code of another file can call what the file exports before the file has run to its end: the file lies on a cycle of imports and requires, a `require` names it, or such a file imports it.
pub(super) fn find_files_held_early(files: &Files<'_>) -> Vec<bool> {
    match collect_loads(files) {
        Some(mut loads) => {
            mark_cycles(&mut loads);
            mark_imports_of_marked_files(&mut loads);
            loads.is_held_early
        }
        None => vec![true; files.modules.len()],
    }
}
