use core::mem::replace;

use bun_sema::hir::{ExprId, ExprKind, File, Flags, FnBody, StmtId, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, is_module_call_of_plugin};
use bun_sema::program::{CodeAnswer, ComputedTargets, FileId, Files};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;

use super::LoadsOfFile;

fn is_object_literal(hir: &File<'_>, value: ExprId) -> bool {
    matches!(
        hir[hir.skip_type_assertions(value)].kind,
        ExprKind::Object(_)
    )
}

fn settles_at_once(hir: &File<'_>, factory: ExprId) -> bool {
    let ExprKind::Fn(function) = hir[hir.skip_type_assertions(factory)].kind else {
        return false;
    };
    let function = &hir[function];
    if function.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
        return false;
    }
    match function.body {
        FnBody::None => false,
        FnBody::Expr(value) => is_object_literal(hir, value),
        FnBody::Block(statements) => {
            let statements: Vec<StmtId> = hir.ids(statements).collect();
            let Some((&last, before)) = statements.split_last() else {
                return false;
            };
            let runs_straight_on = |&statement: &StmtId| {
                matches!(
                    hir[statement].kind,
                    StmtKind::Empty | StmtKind::Expr(_) | StmtKind::Var(_) | StmtKind::Fn(_)
                )
            };
            matches!(hir[last].kind, StmtKind::Return(value) if is_object_literal(hir, value))
                && before.iter().all(runs_straight_on)
        }
    }
}

fn has_factory_that_may_wait(hir: &File<'_>, call: ExprId) -> bool {
    let ExprKind::Call(call) = hir[call].kind else {
        return true;
    };
    let arguments = hir[call].args;
    if arguments.len() < 2 {
        return false;
    }
    let factory = hir.id_at::<ExprId>(arguments, 1);
    let is_no_function = matches!(
        hir[hir.skip_type_assertions(factory)].kind,
        ExprKind::Object(_) | ExprKind::String(_)
    );
    !is_no_function && !settles_at_once(hir, factory)
}

pub(super) fn look_at_factories_that_may_wait(
    request: &FinishedFile<'_, '_>,
    found: &mut LoadsOfFile,
) {
    let &FinishedFile {
        hir,
        bound,
        analysis,
        ..
    } = request;
    for (site, written) in analysis.import_sites.iter().enumerate() {
        let ImportSiteKind::MockModule(call) = written.kind else {
            continue;
        };
        if !analysis.decisions.is_dead_expr(call)
            && !is_module_call_of_plugin(hir, bound, call)
            && has_factory_that_may_wait(hir, call)
        {
            found
                .sites_mocked_by_factories_that_may_wait
                .push(site as u32);
        }
    }
}

#[derive(Default)]
struct LoadsByCalls {
    importers_by_statements: Vec<(FileId, FileId)>,
    required: Vec<FileId>,
    imported: Vec<FileId>,
    requires_what_build_cannot_tell: bool,
}

fn add_files_named(answer: &CodeAnswer<'_>, found: &mut Vec<FileId>) -> bool {
    match *answer {
        CodeAnswer::File(named) => found.push(named),
        CodeAnswer::Computed(ComputedTargets::Modules { files, .. }) => {
            found.extend_from_slice(files);
        }
        CodeAnswer::Computed(ComputedTargets::All { .. }) => return false,
        CodeAnswer::HostModule(_)
        | CodeAnswer::External { .. }
        | CodeAnswer::Erased
        | CodeAnswer::NotFound(_) => {}
    }
    true
}

fn find_loads_by_calls(files: &Files<'_>) -> LoadsByCalls {
    let mut loads = LoadsByCalls::default();
    for &file in files.compiled_files() {
        let analysis = files.analysis(file);
        let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
        for (site, answer) in analysis.import_sites.iter().zip(answers) {
            match site.kind {
                ImportSiteKind::JsxRuntime
                | ImportSiteKind::JsxPackage
                | ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_)
                | ImportSiteKind::ImportEquals(_) => {
                    if let &CodeAnswer::File(named) = answer {
                        loads.importers_by_statements.push((named, file));
                    }
                }
                ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                    if !analysis.decisions.is_dead_expr(call) {
                        loads.requires_what_build_cannot_tell |=
                            !add_files_named(answer, &mut loads.required);
                    }
                }
                ImportSiteKind::ImportCall(call) => {
                    if !analysis.decisions.is_dead_expr(call) {
                        add_files_named(answer, &mut loads.imported);
                    }
                }
                ImportSiteKind::RequireResolve(_)
                | ImportSiteKind::ImportMetaResolve(_)
                | ImportSiteKind::GetBuiltinModule(_)
                | ImportSiteKind::MockModule(_)
                | ImportSiteKind::ImportByTestRunner(_)
                | ImportSiteKind::RequireByTestRunner(_) => {}
            }
        }
    }
    loads.importers_by_statements.shared_sort_unstable();
    loads.importers_by_statements.dedup();
    loads
}

pub(super) fn find_files_taken_out_behind_factories(
    files: &Files<'_>,
    mocked: &[FileId],
) -> Vec<FileId> {
    if mocked.is_empty() {
        return Vec::new();
    }
    let loads = find_loads_by_calls(files);
    if loads.required.is_empty() && !loads.requires_what_build_cannot_tell {
        return Vec::new();
    }
    let importers = &loads.importers_by_statements;
    let mut taken_out = Vec::new();
    for &mocked in mocked {
        let mut comes_to_mock = vec![false; files.modules.len()];
        let mut to_follow = vec![mocked];
        while let Some(file) = to_follow.pop() {
            if replace(&mut comes_to_mock[file.idx()], true) {
                continue;
            }
            let first = importers.partition_point(|import| import.0 < file);
            let importers_of_file = importers[first..].iter().take_while(|it| it.0 == file);
            to_follow.extend(importers_of_file.map(|import| import.1));
        }
        comes_to_mock[mocked.idx()] = false;
        let comes_to_mock = |file: &&FileId| comes_to_mock[file.idx()];
        if loads.requires_what_build_cannot_tell
            || loads.required.iter().any(|it| comes_to_mock(&it))
        {
            taken_out.extend(loads.required.iter().filter(comes_to_mock));
            taken_out.extend(loads.imported.iter().filter(comes_to_mock));
        }
    }
    taken_out.shared_sort_unstable();
    taken_out.dedup();
    taken_out
}
