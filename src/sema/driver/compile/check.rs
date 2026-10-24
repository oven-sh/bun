use super::effects::requested_diagnostics;
use super::queue::{LOWERING_ROUNDS, run_queue};
use super::{CheckedProgram, CompileRequest, FileWork, LoadedProgram, RoleDecision};
use crate::{Diagnostic, equal_diagnostics};
use bun_sema::check::aot::BuiltinTypeSymbols;
use bun_sema::check::{Checker, Requested};
use bun_sema::hir::FileKind;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::Host;
use bun_sema::util::SharedSort;
use bun_threading::Guarded;

pub fn check_and_lower<'s, T: Send>(
    loaded: &LoadedProgram<'s>,
    host: &dyn Host,
    request: &CompileRequest<'_, 's>,
    roles: &RoleDecision,
    files_to_lower: &[FileId],
    lower: &(dyn Fn(&mut Checker<'_, 's>, FileId) -> Option<T> + Sync),
) -> CheckedProgram<T> {
    let note_commit = &|_: FileId, _: &T| {};
    check_and_lower_noting_commits(
        loaded,
        host,
        request,
        roles,
        files_to_lower,
        lower,
        note_commit,
    )
}

pub fn check_and_lower_noting_commits<'s, T: Send>(
    loaded: &LoadedProgram<'s>,
    host: &dyn Host,
    request: &CompileRequest<'_, 's>,
    roles: &RoleDecision,
    files_to_lower: &[FileId],
    lower: &(dyn Fn(&mut Checker<'_, 's>, FileId) -> Option<T> + Sync),
    note_commit: &(dyn Fn(FileId, &T) + Sync),
) -> CheckedProgram<T> {
    let files = loaded.files();
    let requested = |file: FileId| match roles.is_checked(file) {
        true => Requested::Types,
        false => requested_diagnostics(loaded.origin(file), roles.role(file)),
    };
    let slots = slots_by_file(files, roles, files_to_lower);
    let products: Vec<Guarded<Option<T>>> =
        files_to_lower.iter().map(|_| Guarded::new(None)).collect();
    let to_check = files_to_check(loaded, request, &slots, &requested);
    let is_read_by_every_task = |&file: &FileId| {
        files.module(file).is_leaf && BuiltinTypeSymbols::can_list_declarations_of(files, file)
    };
    let mut read_by_every_task: Vec<FileId> = to_check
        .iter()
        .copied()
        .filter(is_read_by_every_task)
        .collect();
    read_by_every_task.shared_sort_unstable();
    let report = run_queue(
        loaded,
        host,
        request,
        to_check,
        &FileWork {
            requested: &requested,
            after_file: Some(&|checker, file| {
                if let Some(slot) = slots[file.idx()]
                    && let Some(product) = lower(checker, file)
                {
                    *products[slot as usize].lock() = Some(product);
                }
            }),
            after_commit: &|file| {
                if let Some(slot) = slots[file.idx()]
                    && let Some(product) = &*products[slot as usize].lock()
                {
                    note_commit(file, product);
                }
            },
            frees_tree: &|file| {
                !loaded.is_read_again && read_by_every_task.binary_search(&file).is_err()
            },
            first_round: LOWERING_ROUNDS,
            left_out_bodies: request.left_out_bodies,
        },
    );
    if !loaded.is_read_again {
        for &file in &read_by_every_task {
            // SAFETY: every task has ended, and nothing reads a tree after them.
            unsafe { files.free_tree(file) };
        }
    }
    let mut lowered: Vec<(FileId, T)> = files_to_lower
        .iter()
        .zip(products)
        .map(|(&file, mut product)| {
            let product = product.get_mut().take();
            (file, product.expect("a lowered file is checked for good"))
        })
        .collect();
    lowered.shared_sort_by_key(|entry| entry.0);
    let (mut diagnostics, mut incomplete) = (report.diagnostics, report.incomplete);
    diagnostics.retain(|diagnostic| !is_reported_with_roles(roles, diagnostic));
    incomplete.retain(|file| !roles.incomplete.contains(file));
    CheckedProgram {
        lowered,
        diagnostics: loaded.program_origins().apply_effects(diagnostics),
        incomplete,
        #[cfg(test)]
        rounds: report.rounds,
    }
}

fn is_reported_with_roles(roles: &RoleDecision, diagnostic: &Diagnostic) -> bool {
    match diagnostic.file {
        Some(file) => roles.is_checked(file),
        None => {
            (roles.diagnostics.iter()).any(|known| equal_diagnostics(&known.diagnostic, diagnostic))
        }
    }
}

fn slots_by_file(
    files: &Files<'_>,
    roles: &RoleDecision,
    files_to_lower: &[FileId],
) -> Vec<Option<u32>> {
    let mut slots = vec![None; files.modules.len()];
    for (slot, &file) in (0u32..).zip(files_to_lower) {
        debug_assert!(files.is_compiled(file));
        debug_assert!(roles.role(file) != FileRole::TypesOnly);
        let previous = slots[file.idx()].replace(slot);
        debug_assert!(previous.is_none());
    }
    slots
}

fn files_to_check(
    loaded: &LoadedProgram<'_>,
    request: &CompileRequest<'_, '_>,
    slots: &[Option<u32>],
    requested: &dyn Fn(FileId) -> Requested,
) -> Vec<FileId> {
    let files = loaded.files();
    let is_reached = files.reached_from(files.entry_points().to_vec());
    let reports = |file: FileId| {
        is_reached[file.idx()]
            && !loaded.origin(file).can_lose_trust()
            && requested(file) != Requested::Types
            && is_checked_by_kind(files, file)
            && !request
                .left_out_bodies
                .is_some_and(|left_out| left_out.contains_file(file))
    };
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    let mut to_check: Vec<FileId> = file_ids
        .filter(|&file| slots[file.idx()].is_some() || reports(file))
        .collect();
    to_check.shared_sort_by_key(|&file| files.rank_of_file(file));
    to_check
}

fn is_checked_by_kind(files: &Files<'_>, file: FileId) -> bool {
    let (module, options) = (files.module(file), files.options);
    match module.hir.kind {
        FileKind::Json => module.hir.has_parse_diagnostics,
        FileKind::Declaration => {
            !options.skip_lib_check && !(options.skip_default_lib_check && module.is_lib)
        }
        FileKind::Ts | FileKind::Tsx => files.is_compiled(file),
    }
}
