use super::effects::{can_lose_trust, requested_diagnostics};
use super::queue::{ROLE_ROUNDS, run_queue};
use super::{
    BuildDiagnostic, CompileRequest, Demotion, DemotionCause, FileWork, LoadedProgram, RoleDecision,
};
use bun_sema::check::aot::Effect;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::Host;
use bun_sema::util::SharedSort;

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
    for demotion in &demoted {
        roles[demotion.file.idx()] = FileRole::Inferred;
    }
    let mut candidates: Vec<FileId> = files_to_lower
        .iter()
        .copied()
        .filter(|&file| can_lose_trust(loaded.origin(file)))
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
    let report = run_queue(
        loaded,
        host,
        request,
        candidates.clone(),
        &FileWork {
            requested: &|file| requested_diagnostics(loaded.origin(file), false),
            after_file: None,
            after_commit: &|_| {},
            beside_file: None,
            frees_tree: &|_| false,
            is_last_pass: &|| false,
            note_cycles_entered: None,
            cycles_entered_before: &Default::default,
            first_round: ROLE_ROUNDS,
            left_out_bodies: request.left_out_bodies,
        },
    );
    let mut diagnostics = loaded.program_origins().apply_effects(report.diagnostics);
    for demotion in find_files_with_early_errors(&diagnostics) {
        roles[demotion.file.idx()] = FileRole::Inferred;
        demoted.push(demotion);
    }
    diagnostics.retain(|reported| !withdraws_trust(reported));
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
        .filter(|&file| roles[file.idx()] == FileRole::Checked)
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

fn withdraws_trust(reported: &BuildDiagnostic) -> bool {
    match reported.effect {
        Effect::WithdrawsTrust => true,
        Effect::StopsBuild | Effect::Warns | Effect::Dropped | Effect::InternalError => false,
    }
}

fn find_files_with_early_errors(diagnostics: &[BuildDiagnostic]) -> Vec<Demotion> {
    let mut demotions: Vec<Demotion> = diagnostics
        .iter()
        .filter(|reported| withdraws_trust(reported))
        .filter_map(|reported| {
            Some(Demotion {
                file: reported.diagnostic.file?,
                cause: DemotionCause::EarlyError,
            })
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
        .filter(|&file| {
            files.hir(file).check_directive == Some(false) || files.needs_another_program(file)
        })
        .map(|file| Demotion {
            file,
            cause: DemotionCause::UnverifiedTypes,
        })
        .collect()
}
