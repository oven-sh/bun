use super::{CompileRequest, FileWork, LoadedProgram};
use crate::{LoadedFiles, PlanOptions, Report, Request, check_loaded_files};
use bun_sema::program::FileId;
use bun_sema::resolve::Host;
use std::time::Instant;

pub(super) const ROLE_ROUNDS: u32 = 0;
pub(super) const LOWERING_ROUNDS: u32 = 1 << 31;

pub(super) fn run_queue<'s>(
    loaded: &LoadedProgram<'s>,
    host: &dyn Host,
    request: &CompileRequest<'_, 's>,
    to_check: Vec<FileId>,
    work: &FileWork<'_, 's>,
) -> Report {
    let files = loaded.files();
    debug_assert!(to_check.is_sorted_by_key(|&file| files.rank_of_file(file)));
    check_loaded_files(LoadedFiles {
        host,
        request: &queue_request(request),
        program: loaded.program(),
        report: Report::default(),
        config_path: files.options.config_path.clone(),
        to_check,
        threads: request.threads.get(),
        in_room: None,
        is_reached: None,
        explains_files: false,
        explain_files: &|_| Vec::new(),
        lists_files_only: false,
        about_options: Vec::new(),
        always_reported: 0,
        checking: Instant::now(),
        file_work: Some(work),
    })
}

fn queue_request<'a>(request: &CompileRequest<'a, '_>) -> Request<'a> {
    Request {
        cwd: b"",
        project: None,
        listed_projects: None,
        build: false,
        errors: &[],
        paths: &[],
        are_entry_points: true,
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        compiler_options: &[],
        threads: request.threads.get(),
        libs: request.libs,
        progress: request.progress,
        order: 1,
        plan_options: PlanOptions {
            after_file_only_for_checked_files: true,
            ..PlanOptions::default()
        },
        stops_like_tsc: false,
        uses_typescript_wording: false,
        after_file: None,
        #[cfg(test)]
        loaded: None,
    }
}
