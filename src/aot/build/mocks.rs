use bun_sema::atom::Atom;
use bun_sema::bind::{Parent, SymFlags};
use bun_sema::check::locked_builtins::global_object;
use bun_sema::hir::{Chain, ExprId, ExprKind, FileKind, ImportSpecId, StmtKind, UnOp};
use bun_sema::program::{FileId, Files};

const TEST_RUNNERS: [&[u8]; 3] = [b"bun:test", b"@jest/globals", b"vitest"];

#[derive(Default)]
pub(crate) struct Seen {
    pub(crate) overrides: bool,
    pub(crate) may_load_the_test_runner: bool,
    pub(crate) names_spy_on: bool,
    takes_a_namespace: bool,
    pub(crate) modules: Vec<(FileId, Atom)>,
    pub(crate) spies: Vec<(FileId, ExprId, Atom)>,
}

pub(crate) fn spied_members_of_globals(files: &Files<'_>) -> Vec<(Atom, Atom)> {
    let mut members = Vec::new();
    for file in (0..files.modules.len() as u32).map(FileId) {
        if files.module(file).builtin.is_some() || matches!(files.hir(file).kind, FileKind::Declaration | FileKind::Json) {
            continue;
        }
        let (hir, bound) = (files.hir(file), files.bound(file));
        for expr in hir.exprs.iter() {
            let ExprKind::Call(call) = expr.kind else { continue };
            let (ExprKind::Ident(callee) | ExprKind::Dot { name: callee, .. }) = hir[hir[call].callee].kind else { continue };
            if files.atoms.bytes(callee) != b"spyOn" || hir[call].args.len() < 2 {
                continue;
            }
            let (mut holder, member) = (hir.id_at(hir[call].args, 0), hir.id_at(hir[call].args, 1));
            let ExprKind::String(member) = hir[member].kind else { continue };
            let mut path = Vec::new();
            while let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[holder].kind {
                path.push(files.atoms.bytes(name));
                holder = obj;
            }
            let ExprKind::Ident(global) = hir[holder].kind else { continue };
            if bound.expr_symbol[holder.idx()].is_some() {
                continue;
            }
            path.push(files.atoms.bytes(global));
            path.reverse();
            let found = path.iter().try_fold(global_object(), |at, name| at.object_at(name));
            let is_locked = found.is_some_and(|holder| holder.has_replaceable(files.atoms.bytes(member)) && holder.known_value(files.atoms.bytes(member)).is_some_and(|known| known.type_of == "function"));
            let holder = files.atoms.intern(&path.join(&b'.'));
            if is_locked && !members.contains(&(holder, member)) {
                members.push((holder, member));
            }
        }
    }
    members
}

pub(crate) fn overrides_seen_in(files: &Files<'_>) -> Seen {
    let mut seen = Seen::default();
    for file in (0..files.modules.len() as u32).map(FileId) {
        if files.module(file).builtin.is_none() && !matches!(files.hir(file).kind, FileKind::Declaration | FileKind::Json) {
            look_at(files, file, &mut seen);
        }
    }
    seen
}

pub(crate) fn may_override_exports(files: &Files<'_>) -> bool {
    let seen = overrides_seen_in(files);
    seen.overrides || seen.may_load_the_test_runner || !seen.modules.is_empty() || (seen.names_spy_on || !seen.spies.is_empty()) && seen.takes_a_namespace
}

fn look_at(files: &Files<'_>, file: FileId, seen: &mut Seen) {
    let (hir, bound) = (files.hir(file), files.bound(file));
    let text = |atom: Atom| files.atoms.bytes(atom);
    let is_test_runner = |specifier: Atom| TEST_RUNNERS.contains(&text(specifier));
    let is_of_a_test_runner = |name: Atom| matches!(text(name), b"mock" | b"jest" | b"vi" | b"spyOn");
    let is_of_a_package = bun_core::strings::contains(files.module(file).file_name(), b"/node_modules/");
    let names_test_runner = |specifier: Option<ExprId>| matches!(specifier.map(|specifier| hir[specifier].kind), Some(ExprKind::String(specifier)) if is_test_runner(specifier));
    let is_computed = |specifier: Option<ExprId>| !is_of_a_package && !matches!(specifier.map(|specifier| hir[specifier].kind), Some(ExprKind::String(_)));
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
        let is_declared_here = |symbol: bun_sema::bind::SymbolId| symbol.is_some() && !bound.symbols[symbol.idx()].flags.contains(SymFlags::ALIAS);
        let name = match expr.kind {
            ExprKind::Ident(_) if is_declared_here(bound.expr_symbol[index]) => continue,
            ExprKind::Ident(name) => name,
            ExprKind::Dot { name, .. } if text(name) == b"require" => name,
            ExprKind::ImportCall { args } => {
                seen.takes_a_namespace = true;
                seen.overrides |= names_test_runner(hir.ids(args).next());
                seen.may_load_the_test_runner |= is_computed(hir.ids(args).next());
                continue;
            }
            _ => continue,
        };
        let call_of = |callee: usize| match bound.expr_parent[callee] {
            Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                ExprKind::Call(call) if hir[call].callee.idx() == callee => Some(call),
                _ => None,
            },
            _ => None,
        };
        let around = match bound.expr_parent[index] {
            Parent::Expr(parent) if parent.is_some() => Some(parent),
            _ => None,
        };
        let (parent, call) = (around.map(|parent| hir[parent].kind), call_of(index));
        let note_spy = |seen: &mut Seen, call: Option<bun_sema::hir::CallId>| match call.filter(|&call| hir[call].args.len() >= 2) {
            Some(call) => {
                let name = match hir[hir.id_at(hir[call].args, 1)].kind {
                    ExprKind::String(name) => name,
                    _ => Atom::NONE,
                };
                seen.spies.push((file, hir.id_at(hir[call].args, 0), name));
            }
            None => seen.names_spy_on = true,
        };
        match text(name) {
            b"require" => {
                seen.takes_a_namespace = true;
                let only_asks_about_it = match parent {
                    Some(ExprKind::Dot { obj, name: member, .. }) if obj.idx() == index => matches!(text(member), b"resolve" | b"cache" | b"main" | b"extensions"),
                    Some(ExprKind::Unary { op: UnOp::Typeof, .. }) => true,
                    _ => false,
                };
                seen.overrides |= call.is_some_and(|call| names_test_runner(hir.ids(hir[call].args).next()));
                seen.may_load_the_test_runner |= match call {
                    Some(call) => is_computed(hir.ids(hir[call].args).next()),
                    None => !is_of_a_package && !only_asks_about_it,
                };
            }
            b"spyOn" => note_spy(seen, call),
            runner @ (b"mock" | b"jest" | b"vi") => match parent {
                Some(ExprKind::Dot { obj, name: member, .. }) if obj.idx() == index => match text(member) {
                    b"module" | b"mock" | b"doMock" if runner != b"mock" || text(member) == b"module" => {
                        let specifier = around.and_then(|member| call_of(member.idx())).and_then(|call| hir.ids(hir[call].args).next());
                        match specifier.map(|specifier| hir[specifier].kind) {
                            Some(ExprKind::String(specifier)) => seen.modules.push((file, specifier)),
                            _ => seen.overrides = true,
                        }
                    }
                    b"unmock" | b"doUnmock" | b"requireMock" | b"importMock" | b"hoisted" if runner != b"mock" => seen.overrides = true,
                    b"spyOn" => note_spy(seen, around.and_then(|member| call_of(member.idx()))),
                    _ => {}
                },
                _ => seen.overrides |= call.is_none(),
            },
            _ => {}
        }
    }
}
