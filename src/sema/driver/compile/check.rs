use super::effects::requested_diagnostics_of_file;
use super::queue::{LOWERING_ROUNDS, run_queue};
use super::{CheckedProgram, CompileRequest, FileWork, LoadedProgram, RoleDecision};
use crate::{Diagnostic, equal_diagnostics};
use bun_sema::check::commit::CyclesEntered;
use bun_sema::check::{Checker, Requested};
use bun_sema::hir::FileKind;
use bun_sema::program::{FileId, FileRole, Files};
use bun_sema::resolve::Host;
use bun_sema::util::SharedSort;
use bun_threading::Guarded;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

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
        None,
        &Passes {
            count: PassCount::Exactly(1),
            before_next: &|| {},
        },
    )
}

/// The files are lowered in so many passes, in program order, each with a checker that knows nothing yet.
pub struct Passes<'a> {
    pub count: PassCount,
    /// Called between two passes, when the types and signatures of the pass before mean nothing any more.
    pub before_next: &'a (dyn Fn() + Sync),
}

#[derive(Copy, Clone)]
pub enum PassCount {
    /// Whatever the files are like.
    Exactly(usize),
    /// A second pass takes time and saves memory. So there is one where the files hold no more text than this, and two above it,
    /// unless a pass would wait for its largest file: see `passes_that_wait_for_no_file`.
    TwoAboveBytesOfText(u64),
}

pub fn check_and_lower_noting_commits<'s, T: Send>(
    loaded: &LoadedProgram<'s>,
    host: &dyn Host,
    request: &CompileRequest<'_, 's>,
    roles: &RoleDecision,
    files_to_lower: &[FileId],
    lower: &(dyn Fn(&mut Checker<'_, 's>, FileId) -> Option<T> + Sync),
    note_commit: &(dyn Fn(FileId, &T) + Sync),
    prepare: Option<&(dyn Fn(FileId) + Sync)>,
    passes: &Passes<'_>,
) -> CheckedProgram<T> {
    let files = loaded.files();
    let is_left_out = |file: FileId| is_left_out(request, file);
    let is_checker_renewed = AtomicBool::new(false);
    let is_checked_again = loaded.has_checked_for_roles();
    let requested = |file: FileId| match roles.is_checked(file) || is_left_out(file) {
        true if is_checked_again && !is_left_out(file) => {
            requested_diagnostics_of_file(files, file, loaded.origin(file), files.role(file))
        }
        true => Requested::Types,
        false => requested_diagnostics_of_file(files, file, loaded.origin(file), roles.role(file)),
    };
    let slots = slots_by_file(files, roles, files_to_lower);
    let products: Vec<Guarded<Option<T>>> =
        files_to_lower.iter().map(|_| Guarded::new(None)).collect();
    let to_check = files_to_check(loaded, request, &slots, &requested);
    let read_by_every_task: Vec<FileId> = to_check
        .iter()
        .copied()
        .filter(|&file| files.module(file).is_read_by_every_task)
        .collect();
    if !loaded.is_read_again {
        files.let_trees_go_behind(&to_check);
    }
    let passes_left = AtomicUsize::new(usize::MAX);
    let prepare_lowered_file = |file: FileId| {
        if let Some(prepare) = prepare
            && slots[file.idx()].is_some()
        {
            prepare(file);
        }
    };
    let work = FileWork {
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
        beside_file: prepare.map(|_| &prepare_lowered_file as &(dyn Fn(FileId) + Sync)),
        frees_tree: &|_| !loaded.is_read_again,
        is_last_pass: &|| passes_left.load(Ordering::Relaxed) == 0,
        note_cycles_entered: Some(&|file, cycles| {
            loaded.note_cycles_entered(LOWERING_ROUNDS, file, cycles);
        }),
        cycles_entered_before: &|| match is_checker_renewed.load(Ordering::Relaxed) {
            true => loaded.cycles_entered(),
            false => CyclesEntered::default(),
        },
        first_round: LOWERING_ROUNDS,
        left_out_bodies: request.left_out_bodies,
    };
    let pass_count = match passes.count {
        PassCount::Exactly(count) => count,
        PassCount::TwoAboveBytesOfText(fits) => {
            let text = |&file: &FileId| files.module(file).hir.text.len() as u64;
            match to_check.iter().map(text).sum::<u64>() > fits {
                true => passes_that_wait_for_no_file(files, &to_check, 2),
                false => 1,
            }
        }
    };
    let parts = cut_into_passes(files, to_check, pass_count);
    let logs = parts.len() > 1 && bun_core::env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true);
    let mut report: Option<crate::Report> = None;
    passes_left.store(parts.len(), Ordering::Relaxed);
    if is_checked_again {
        // SAFETY: the tasks that decided the roles have ended, and the decision holds nothing of the checker's.
        unsafe { loaded.renew_checker(&|count, each| host.parallel(count, each)) };
    }
    for part in parts {
        let began = std::time::Instant::now();
        passes_left.fetch_sub(1, Ordering::Relaxed);
        if report.is_some() {
            // SAFETY: the tasks of the pass before have ended, and what they lowered holds nothing of the checker's.
            unsafe { loaded.renew_checker(&|count, each| host.parallel(count, each)) };
            is_checker_renewed.store(true, Ordering::Relaxed);
            (passes.before_next)();
        }
        let renewed = began.elapsed();
        let file_count = part.len();
        let next = run_queue(loaded, host, request, part, &work);
        if logs {
            bun_core::print_errorln!(
                "AOT pass of the checker | {} files | a new checker {} ms | the pass {} ms",
                file_count,
                renewed.as_millis(),
                (began.elapsed() - renewed).as_millis(),
            );
        }
        report = Some(match report {
            None => next,
            Some(mut report) => {
                for diagnostic in next.diagnostics {
                    let is_known = diagnostic.file.is_none()
                        && (report.diagnostics.iter()).any(|it| equal_diagnostics(it, &diagnostic));
                    if !is_known {
                        report.diagnostics.push(diagnostic);
                    }
                }
                report.incomplete.extend(next.incomplete);
                #[cfg(test)]
                report.rounds.extend(next.rounds);
                report
            }
        });
    }
    let report = report.expect("there is a first pass");
    files.watch_no_more();
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
    diagnostics.retain(|diagnostic| !diagnostic.file.is_some_and(is_left_out));
    incomplete.retain(|file| !roles.incomplete.contains(file));
    CheckedProgram {
        lowered,
        diagnostics: loaded.program_origins().apply_effects(diagnostics),
        incomplete,
        #[cfg(test)]
        rounds: report.rounds,
    }
}

// A file is lowered by one thread, and a pass ends when its last file is lowered. Where the largest file is more than a thread's share
// of a pass, the threads wait for it at the end of its pass with nothing to do, while the files of the next pass lie there. So there
// are at most as many passes as leave each thread a share of the size of the largest file. The number of threads is fixed, not the
// machine's: where the checker's limit is met, the passes decide what a program's types are, and those may not depend on the core count.
const THREADS_OF_A_PASS: usize = 16;

fn passes_that_wait_for_no_file(files: &Files<'_>, to_check: &[FileId], most: usize) -> usize {
    let sizes = || {
        to_check
            .iter()
            .map(|&file| files.module(file).hir.text.len())
    };
    let largest = sizes().max().unwrap_or(0).max(1);
    (sizes().sum::<usize>() / (largest * THREADS_OF_A_PASS)).clamp(1, most.max(1))
}

// The files in program order, cut into `count` parts of about as many bytes of text. What a file of one part refers to in another part
// the checker of its pass works out again, so each cut falls, within a sixth of a part's share to either side, where the fewest
// references go across it.
fn cut_into_passes(files: &Files<'_>, to_check: Vec<FileId>, count: usize) -> Vec<Vec<FileId>> {
    if count < 2 || to_check.len() < 2 {
        return vec![to_check];
    }
    let mut position_of = vec![u32::MAX; files.modules.len()];
    for (position, &file) in (0u32..).zip(&to_check) {
        position_of[file.idx()] = position;
    }
    // At `n`: how many more references go across a cut in front of the file at `n` than across one in front of the file before it.
    let mut changes = vec![0i64; to_check.len() + 1];
    let mut sizes_so_far = Vec::with_capacity(to_check.len() + 1);
    let mut so_far = 0usize;
    for (position, &file) in (0u32..).zip(&to_check) {
        sizes_so_far.push(so_far);
        let module = files.module(file);
        so_far += module.hir.text.len();
        for &other in module.edges.iter().chain(module.code_edges) {
            let other = position_of[other.idx()];
            if other != u32::MAX && other != position {
                changes[position.min(other) as usize + 1] += 1;
                changes[position.max(other) as usize + 1] -= 1;
            }
        }
    }
    sizes_so_far.push(so_far);
    let mut across = changes;
    for at in 1..across.len() {
        across[at] += across[at - 1];
    }
    let share = (so_far / count).max(1);
    let mut cuts: Vec<usize> = Vec::new();
    for cut in 1..count {
        let (least, most) = (share * cut - share / 6, share * cut + share / 6);
        let first = sizes_so_far.partition_point(|&size| size < least);
        let last = sizes_so_far.partition_point(|&size| size <= most);
        let first = first.max(cuts.last().map_or(1, |&before| before + 1));
        let best = (first..last.min(to_check.len())).min_by_key(|&at| across[at]);
        cuts.extend(best);
    }
    if bun_core::env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
        for &cut in &cuts {
            bun_core::print_errorln!(
                "AOT passes of the checker | a cut in front of file {} of {}, behind {} of {} KB | {} references go across it",
                cut,
                to_check.len(),
                sizes_so_far[cut] / 1024,
                so_far / 1024,
                across[cut],
            );
        }
    }
    let mut parts = Vec::with_capacity(cuts.len() + 1);
    let mut rest = to_check;
    for &cut in cuts.iter().rev() {
        parts.push(rest.split_off(cut));
    }
    parts.push(rest);
    parts.reverse();
    parts
}

// None of its statements is compiled, also where it is lowered for its place among the modules.
fn is_left_out(request: &CompileRequest<'_, '_>, file: FileId) -> bool {
    let left_out = request.left_out_bodies;
    left_out.is_some_and(|left_out| left_out.contains_file(file))
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
            && !is_left_out(request, file)
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
