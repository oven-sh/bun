use super::effects::{can_lose_trust, requested_diagnostics};
use super::queue::{QueuePass, ROLE_ROUNDS, run_queue};
use super::{
    BuildDiagnostic, CompileRequest, Demotion, DemotionCause, FileWork, LoadedProgram, RoleDecision,
};
use bun_sema::check::aot::{DiagnosticClass, Effect};
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::Host;
use bun_sema::util::{FxHashSet, SharedSort};

pub fn decide_roles<'s>(
    loaded: &LoadedProgram<'s>,
    host: &dyn Host,
    request: &CompileRequest<'_, 's>,
    files_to_lower: &[FileId],
) -> RoleDecision {
    let files = loaded.files();
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    let mut roles: Vec<FileRole> = file_ids.map(|file| files.role(file)).collect();
    let mut demoted = find_unverified_files(files);
    demoted.extend(find_rejected_neighbors(files, files_to_lower));
    for demotion in &demoted {
        roles[demotion.file.idx()] = FileRole::Inferred;
    }
    let mut candidates: Vec<FileId> = files_to_lower
        .iter()
        .copied()
        .filter(|&file| can_lose_trust(loaded.origin(file), roles[file.idx()]))
        .filter(|&file| {
            !request
                .left_out_bodies
                .is_some_and(|left_out| left_out.contains_file(file))
        })
        .collect();
    if candidates.is_empty() {
        demoted.shared_sort_by_key(|demotion| demotion.file);
        return RoleDecision {
            roles,
            demoted,
            checked: Vec::new(),
            diagnostics: Vec::new(),
            incomplete: Vec::new(),
            #[cfg(test)]
            rounds: Vec::new(),
        };
    }
    candidates.shared_sort_by_key(|&file| files.rank_of_file(file));
    let report = run_queue(QueuePass {
        loaded,
        host,
        request,
        to_check: candidates.clone(),
        work: FileWork {
            requested: &|file| requested_diagnostics(loaded.origin(file), files.role(file)),
            after_file: None,
            after_commit: &|_| {},
            frees_tree: &|_| false,
            first_round: ROLE_ROUNDS,
            left_out_bodies: request.left_out_bodies,
        },
    });
    let mut diagnostics = loaded.program_origins().apply_effects(report.diagnostics);
    for demotion in find_files_without_trust(&diagnostics) {
        roles[demotion.file.idx()] = FileRole::Inferred;
        demoted.push(demotion);
    }
    // The call that evaluates the text throws the error when it runs.
    diagnostics.retain(|reported| demotion_cause_of(reported) != Some(DemotionCause::EarlyError));
    demoted.shared_sort_by_key(|demotion| demotion.file);
    candidates.shared_sort_unstable();
    RoleDecision {
        roles,
        demoted,
        checked: candidates,
        diagnostics,
        incomplete: report.incomplete,
        #[cfg(test)]
        rounds: report.rounds,
    }
}

/// The roles of a project whose files were checked before this build.
pub fn keep_verified_roles(loaded: &LoadedProgram<'_>, files_to_lower: &[FileId]) -> RoleDecision {
    let files = loaded.files();
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    let mut roles: Vec<FileRole> = file_ids.map(|file| files.role(file)).collect();
    let mut demoted = find_unverified_files(files);
    for demotion in &demoted {
        roles[demotion.file.idx()] = FileRole::Inferred;
    }
    demoted.shared_sort_by_key(|demotion| demotion.file);
    let mut checked: Vec<FileId> = files_to_lower
        .iter()
        .copied()
        .filter(|&file| can_lose_trust(loaded.origin(file), roles[file.idx()]))
        .collect();
    checked.shared_sort_unstable();
    RoleDecision {
        roles,
        demoted,
        checked,
        diagnostics: Vec::new(),
        incomplete: Vec::new(),
        #[cfg(test)]
        rounds: Vec::new(),
    }
}

fn demotion_cause_of(reported: &BuildDiagnostic) -> Option<DemotionCause> {
    match reported.effect {
        Effect::WithdrawsTrust => {}
        Effect::StopsBuild | Effect::Warns | Effect::Dropped | Effect::InternalError => {
            return None;
        }
    }
    Some(match reported.diagnostic.class {
        DiagnosticClass::EarlyError => DemotionCause::EarlyError,
        _ => DemotionCause::TypeError,
    })
}

fn find_files_without_trust(diagnostics: &[BuildDiagnostic]) -> Vec<Demotion> {
    let mut demotions: Vec<Demotion> = diagnostics
        .iter()
        .filter_map(|reported| {
            let cause = demotion_cause_of(reported)?;
            let file = reported.diagnostic.file?;
            Some(Demotion { file, cause })
        })
        .collect();
    demotions.shared_sort_by_key(|demotion| demotion.file);
    demotions.dedup_by_key(|demotion| demotion.file);
    demotions
}

fn find_unverified_files(files: &Files<'_>) -> Vec<Demotion> {
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    file_ids
        .filter(|&file| files.role(file) == FileRole::Checked)
        .filter(|&file| files.hir(file).check_directive == Some(false))
        .map(|file| Demotion {
            file,
            cause: DemotionCause::UnverifiedTypes,
        })
        .collect()
}

fn find_rejected_neighbors(files: &Files<'_>, files_to_lower: &[FileId]) -> Vec<Demotion> {
    let in_package = |file: FileId| {
        let compiled = files.compiled(file)?;
        Some((compiled, compiled.package?.directory))
    };
    let rejected_directories: FxHashSet<&[u8]> = files_to_lower
        .iter()
        .filter_map(|&file| in_package(file))
        .filter(|(compiled, _)| {
            let rejected = compiled.rejected_typed_version;
            rejected.is_some_and(|it| !it.kind.is_fault_of_manifest())
        })
        .map(|(_, directory)| directory)
        .collect();
    if rejected_directories.is_empty() {
        return Vec::new();
    }
    let is_neighbor = |file: FileId| {
        files.role(file) == FileRole::Checked
            && in_package(file).is_some_and(|(compiled, directory)| {
                compiled.typed_source_path.is_some() && rejected_directories.contains(directory)
            })
    };
    let neighbors = files_to_lower
        .iter()
        .copied()
        .filter(|&file| is_neighbor(file));
    neighbors
        .map(|file| Demotion {
            file,
            cause: DemotionCause::RejectedNeighbor,
        })
        .collect()
}
