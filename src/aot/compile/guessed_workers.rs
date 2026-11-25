use std::collections::BTreeMap;

use bun_sema::hir::{ExprId, NodeData};
use bun_sema::messages::Category;
use bun_sema::program::{CodeAnswer, CodeView, ComputedTargets, FileId, Files};
use bun_sema_driver::host::to_native;

use crate::diagnostic_codes::Code;
use crate::diagnostics::{
    Diagnostic, ProgramView, Span, SpanLocator, describe_first_fold_error, module_name,
    new_driver_diagnostic,
};
use crate::load::contents::FoundEntryPoint;
use crate::load::contents::entry_points::{LeftOutBecause, NameLeftOut};
use crate::load::module_paths::compute_display_path;
use crate::load::sources::parsed_source;
use crate::modules::{ModuleFailure, ModuleFailureKind};

pub(super) fn find_guessed_files(
    files: &Files<'_>,
    written_entry_point_count: usize,
    found_entry_points: &[FoundEntryPoint],
) -> Vec<FileId> {
    let is_guess = |place: usize| {
        let found = place.checked_sub(written_entry_point_count);
        found
            .and_then(|found| found_entry_points.get(found))
            .is_some_and(|found| found.is_guess)
    };
    let entry_points = files.entry_points().iter().copied().enumerate();
    let (guessed, sure): (Vec<_>, Vec<_>) = entry_points.partition(|it| is_guess(it.0));
    if guessed.is_empty() {
        return Vec::new();
    }
    let reached_from = |entry_points: Vec<(usize, FileId)>| {
        let mut is_reached = vec![false; files.modules.len()];
        let mut left: Vec<FileId> = entry_points.into_iter().map(|it| it.1).collect();
        while let Some(file) = left.pop() {
            if std::mem::replace(&mut is_reached[file.idx()], true) {
                continue;
            }
            let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
            let implied = files
                .compiled(file)
                .map_or(&[][..], |it| it.implied_answers);
            for answer in answers.iter().chain(implied) {
                match *answer {
                    CodeAnswer::File(target) => left.push(target),
                    CodeAnswer::Computed(ComputedTargets::Modules { files, .. }) => {
                        left.extend_from_slice(files);
                    }
                    _ => {}
                }
            }
        }
        is_reached
    };
    let (of_guesses, of_program) = (reached_from(guessed), reached_from(sure));
    let mut alone: Vec<FileId> = files.compiled_files().to_vec();
    alone.retain(|file| of_guesses[file.idx()] && !of_program[file.idx()]);
    alone.sort_unstable();
    alone
}

fn find_file_named(files: &Files<'_>, name: &[u8]) -> Option<FileId> {
    let mut compiled = files.compiled_files().iter().copied();
    compiled.find(|&file| files.file_name(file) == name)
}

fn describe_place(
    view: ProgramView<'_, '_>,
    project_root: &[u8],
    file: FileId,
    at: ExprId,
) -> Vec<u8> {
    let files = view.files();
    let span = Span::of_node(files.hir(file), file, NodeData::Expr(at));
    let unplaced = new_driver_diagnostic(0, Category::Message, Vec::new(), &[]);
    let placed = SpanLocator::new(view).locate(span, unplaced);
    let path = compute_display_path(project_root, to_native(files.file_name(file)));
    [
        &path[..],
        format!(":{}:{}", placed.line, placed.column).as_bytes(),
    ]
    .concat()
}

pub(super) fn describe_excluded_names(
    view: ProgramView<'_, '_>,
    project_root: &[u8],
    names: &[NameLeftOut],
) -> Vec<u8> {
    let reasons: [(LeftOutBecause, &[u8], &[u8]); 2] = [
        (
            LeftOutBecause::LiesOutsideRoot,
            b". The build doesn't compile files outside the root directory that the program only names: ",
            b". If a Worker starts from one, add it as an entry point",
        ),
        (
            LeftOutBecause::KeptOutByPlugin,
            b". A plugin keeps out files that the program names: ",
            b"",
        ),
    ];
    let mut said = Vec::new();
    for (because, begin, end) in reasons {
        let of_reason = names.iter().filter(|name| {
            name.because == because && find_file_named(view.files(), &name.leads_to).is_none()
        });
        let listed = of_reason.filter_map(|name| {
            let file = find_file_named(view.files(), &name.written_in)?;
            let place = describe_place(view, project_root, file, ExprId(name.written_at));
            let leads_to = compute_display_path(project_root, to_native(&name.leads_to));
            Some(
                [
                    &leads_to[..],
                    b" (named \"",
                    &name.name,
                    b"\" at ",
                    &place,
                    b")",
                ]
                .concat(),
            )
        });
        let listed: Vec<Vec<u8>> = listed.collect();
        if !listed.is_empty() {
            said.extend_from_slice(&[begin, &listed.join(&b", "[..]), end].concat());
        }
    }
    said
}

pub(super) fn find_guessed_names(
    files: &Files<'_>,
    written_entry_point_count: usize,
    found_entry_points: &[FoundEntryPoint],
    files_of_guesses: &[FileId],
) -> BTreeMap<FileId, Vec<(FileId, ExprId)>> {
    let entry_points = files.entry_points().iter().copied();
    let found = entry_points
        .skip(written_entry_point_count)
        .zip(found_entry_points);
    let mut names: BTreeMap<FileId, Vec<(FileId, ExprId)>> = BTreeMap::new();
    for (file, found) in found {
        if !found.is_guess || files_of_guesses.binary_search(&file).is_err() {
            continue;
        }
        let first = found.started_at.as_ref();
        let first = first.and_then(|(name, at)| Some((find_file_named(files, name)?, *at)));
        let mut places: Vec<(FileId, ExprId)> = (found.starts.iter().copied().chain(first))
            .map(|(file, at)| (file, ExprId(at)))
            .collect();
        places.sort_unstable_by_key(|&(file, at)| (file, at.0));
        places.dedup();
        if !places.is_empty() {
            names.insert(file, places);
        }
    }
    names
}

pub(super) fn describe_silent_failure(
    view: ProgramView<'_, '_>,
    failure: &ModuleFailure,
) -> Option<Vec<u8>> {
    let files = view.files();
    match failure.kind {
        ModuleFailureKind::ExportMayBeAbsent { exporter, name, .. } => {
            let arguments = [module_name(view, exporter), files.atoms.bytes(name)];
            Some(Code::ExportNotFound.message(&arguments))
        }
        ModuleFailureKind::NotAProgram {
            is_silent: true, ..
        } => {
            let source = parsed_source(files, failure.importer);
            let reason = source.and_then(|source| source.parse_failure.as_deref());
            let reason = reason.map(<[u8]>::to_vec);
            reason.or_else(|| describe_first_fold_error(view, failure.importer))
        }
        _ => None,
    }
}

pub(super) fn refuse_guessed_file(
    view: ProgramView<'_, '_>,
    project_root: &[u8],
    file: FileId,
    reason: &[u8],
) -> Diagnostic {
    let path = compute_display_path(project_root, to_native(view.files().file_name(file)));
    Diagnostic::new(Code::WorkerFileIsRefused, None, &[&path, reason])
}

pub(super) fn describe_guessed_files(
    view: ProgramView<'_, '_>,
    project_root: &[u8],
    names: &BTreeMap<FileId, Vec<(FileId, ExprId)>>,
    lists_places: bool,
) -> Vec<Diagnostic> {
    let files = view.files();
    let display_path =
        |file: FileId| compute_display_path(project_root, to_native(files.file_name(file)));
    if lists_places {
        let places = names.iter().flat_map(|(&file, places)| {
            let name = display_path(file);
            places.iter().map(move |&(written_in, at)| {
                let span = Span::of_node(files.hir(written_in), written_in, NodeData::Expr(at));
                Diagnostic::new(Code::WorkerFileFoundByName, Some(span), &[&name])
            })
        });
        return places.collect();
    }
    let mut listed: Vec<Vec<u8>> = names
        .iter()
        .map(|(&file, places)| {
            let (written_in, at) = places[0];
            let place = describe_place(view, project_root, written_in, at);
            [&display_path(file)[..], b" (named at ", &place, b")"].concat()
        })
        .collect();
    listed.sort_unstable();
    match listed.is_empty() {
        true => Vec::new(),
        false => {
            let listed = listed.join(&b", "[..]);
            vec![Diagnostic::new(
                Code::WorkerFilesFoundByName,
                None,
                &[&listed],
            )]
        }
    }
}
