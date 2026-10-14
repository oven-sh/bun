use bun_sema::atom::Atom;
use bun_sema::bind::Parent;
use bun_sema::hir::{ExprId, ExprKind, FileKind, ImportSpecId, StmtKind};
use bun_sema::program::{FileId, Files};

const TEST_RUNNERS: [&[u8]; 3] = [b"bun:test", b"@jest/globals", b"vitest"];

#[derive(Default)]
struct Seen {
    overrides: bool,
    names_spy_on: bool,
    takes_a_namespace: bool,
}

pub(crate) fn may_override_exports(files: &Files<'_>) -> bool {
    let mut seen = Seen::default();
    for file in (0..files.modules.len() as u32).map(FileId) {
        if files.module(file).builtin.is_none() && !matches!(files.hir(file).kind, FileKind::Declaration | FileKind::Json) {
            look_at(files, file, &mut seen);
        }
        if seen.overrides || seen.names_spy_on && seen.takes_a_namespace {
            return true;
        }
    }
    false
}

fn look_at(files: &Files<'_>, file: FileId, seen: &mut Seen) {
    let (hir, bound) = (files.hir(file), files.bound(file));
    let text = |atom: Atom| files.atoms.bytes(atom);
    let is_test_runner = |specifier: Atom| TEST_RUNNERS.contains(&text(specifier));
    let is_of_a_test_runner = |name: Atom| matches!(text(name), b"mock" | b"jest" | b"vi" | b"spyOn");
    let is_of_a_package = bun_core::strings::contains(files.module(file).file_name(), b"/node_modules/");
    let names_no_test_runner = |specifier: Option<ExprId>| match specifier.map(|specifier| hir[specifier].kind) {
        Some(ExprKind::String(specifier)) => !is_test_runner(specifier),
        _ => is_of_a_package,
    };
    for stmt in hir.ids(hir.body) {
        match hir[stmt].kind {
            StmtKind::Import(import) => {
                let import = &hir[import];
                let is_renamed = |spec: ImportSpecId| is_of_a_test_runner(hir[spec].imported) && hir[spec].local != hir[spec].imported;
                seen.overrides |= import.named.iter().any(is_renamed);
                if is_test_runner(import.spec) {
                    seen.overrides |= import.namespace.is_some() || import.default.is_some();
                } else {
                    seen.takes_a_namespace |= import.namespace.is_some();
                }
            }
            StmtKind::ImportEquals(_) => seen.takes_a_namespace = true,
            StmtKind::ExportNamed(export) => {
                let export = &hir[export];
                seen.overrides |= export.has_module_specifier && is_test_runner(export.spec) || export.items.iter().any(|item| is_of_a_test_runner(hir[item].local));
            }
            StmtKind::ExportStar { spec, alias, .. } => {
                seen.overrides |= is_test_runner(spec);
                seen.takes_a_namespace |= alias.is_some();
            }
            _ => {}
        }
    }
    for (index, expr) in hir.exprs.iter().enumerate() {
        let name = match expr.kind {
            ExprKind::Ident(name) => name,
            ExprKind::Dot { name, .. } if text(name) == b"require" => name,
            ExprKind::ImportCall { args } => {
                seen.takes_a_namespace = true;
                seen.overrides |= !names_no_test_runner(hir.ids(args).next());
                continue;
            }
            _ => continue,
        };
        let parent = match bound.expr_parent[index] {
            Parent::Expr(parent) => Some(hir[parent].kind),
            _ => None,
        };
        let call = match parent {
            Some(ExprKind::Call(call)) if hir[call].callee.idx() == index => Some(call),
            _ => None,
        };
        match text(name) {
            b"require" => {
                seen.takes_a_namespace = true;
                seen.overrides |= match call {
                    Some(call) => !names_no_test_runner(hir.ids(hir[call].args).next()),
                    None => !is_of_a_package,
                };
            }
            b"spyOn" => seen.names_spy_on = true,
            runner @ (b"mock" | b"jest" | b"vi") => match parent {
                Some(ExprKind::Dot { obj, name: member, .. }) if obj.idx() == index => match text(member) {
                    b"module" => seen.overrides = true,
                    b"mock" | b"doMock" | b"unmock" | b"doUnmock" | b"requireMock" | b"importMock" | b"hoisted" if runner != b"mock" => seen.overrides = true,
                    b"spyOn" => seen.names_spy_on = true,
                    _ => {}
                },
                _ => seen.overrides |= call.is_none(),
            },
            _ => {}
        }
    }
}
