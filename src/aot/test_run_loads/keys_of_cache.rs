use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, BindingInitializer, Bound, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue, find_export_of_path_module};
use bun_sema::hir::{BinOp, ExprId, ExprKind, File, MemberKey, NodeData, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::resolve::{ComputedResolution, FinishedFile, SiteResolution};
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

use super::{FileOfKey, LoadsOfFile, WhyEveryFile};
use crate::builtins::{KeyOfModuleCache, ResolvedBuiltins, RuntimeModule};
use crate::diagnostics::range_of_node;
use crate::load::contents::load_names::find_entry_that_require_looks_for;

fn find_file_of_key(request: &FinishedFile<'_, '_>, key: KeyOfModuleCache) -> Option<FileOfKey> {
    let &FinishedFile {
        hir,
        bound,
        analysis,
        ..
    } = request;
    let key = match key {
        KeyOfModuleCache::Text(path) => return Some(FileOfKey::Path(path)),
        KeyOfModuleCache::Computed(key) => key,
    };
    let mut key = hir.skip_type_assertions(key);
    let mut followed: SmallVec<[SymbolId; 4]> = SmallVec::new();
    loop {
        if let FoldedValue::Constant(Constant::String(path))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(path)) =
            analysis.decisions.constant(hir, key)
        {
            return Some(FileOfKey::Path(path));
        }
        if let Some(site) = analysis.import_site_of_call(key)
            && analysis.import_sites[site].kind == ImportSiteKind::RequireResolve(key)
        {
            return Some(FileOfKey::Site(site as u32));
        }
        let Binding::Symbol(symbol) = bound.binding(key) else {
            return None;
        };
        if !bound.is_evaluated_ident(key)
            || !bound.is_stable_binding(symbol)
            || followed.contains(&symbol)
        {
            return None;
        }
        followed.push(symbol);
        let BindingInitializer::Expression(initializer) = bound.binding_initializer(hir, symbol)
        else {
            return None;
        };
        key = hir.skip_type_assertions(initializer);
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum TextOfRun {
    Text(Atom),
    PathOfSite(u32),
    Dirname(Box<TextOfRun>),
    Concatenation(Box<[TextOfRun; 2]>),
    Separator,
}

fn find_text_of_run(
    request: &FinishedFile<'_, '_>,
    text: ExprId,
    led_here: &[SymbolId],
) -> Option<TextOfRun> {
    let &FinishedFile {
        hir, bound, atoms, ..
    } = request;
    let mut text = hir.skip_type_assertions(text);
    let mut followed: SmallVec<[SymbolId; 4]> = SmallVec::from_slice(led_here);
    loop {
        match find_file_of_key(request, KeyOfModuleCache::Computed(text)) {
            Some(FileOfKey::Path(known)) => return Some(TextOfRun::Text(known)),
            Some(FileOfKey::Site(site)) => return Some(TextOfRun::PathOfSite(site)),
            None => {}
        }
        let export_of_path = |named: ExprId| {
            find_export_of_path_module(hir, bound, named).map(|name| atoms.bytes(name))
        };
        match hir[text].kind {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let parts = [
                    find_text_of_run(request, left, &followed)?,
                    find_text_of_run(request, right, &followed)?,
                ];
                return Some(TextOfRun::Concatenation(Box::new(parts)));
            }
            ExprKind::Call(call)
                if hir[call].args.len() == 1
                    && export_of_path(hir[call].callee) == Some(b"dirname") =>
            {
                let of = find_text_of_run(request, hir.id_at(hir[call].args, 0), &followed)?;
                return Some(TextOfRun::Dirname(Box::new(of)));
            }
            _ if export_of_path(text) == Some(b"sep") => return Some(TextOfRun::Separator),
            _ => {}
        }
        let Binding::Symbol(symbol) = bound.binding(text) else {
            return None;
        };
        if !bound.is_evaluated_ident(text)
            || !bound.is_stable_binding(symbol)
            || followed.contains(&symbol)
        {
            return None;
        }
        followed.push(symbol);
        let BindingInitializer::Expression(initializer) = bound.binding_initializer(hir, symbol)
        else {
            return None;
        };
        text = hir.skip_type_assertions(initializer);
    }
}

fn find_start_of_key(request: &FinishedFile<'_, '_>, key: ExprId) -> Option<TextOfRun> {
    let &FinishedFile {
        hir, bound, atoms, ..
    } = request;
    let Binding::Symbol(name) = bound.binding(hir.skip_type_assertions(key)) else {
        return None;
    };
    if !bound.is_stable_binding(name) {
        return None;
    }
    let find_in_test = |test: ExprId| {
        let mut conjuncts: SmallVec<[ExprId; 4]> = SmallVec::from_slice(&[test]);
        while let Some(conjunct) = conjuncts.pop() {
            let conjunct = hir.skip_type_assertions(conjunct);
            match hir[conjunct].kind {
                ExprKind::Binary {
                    op: BinOp::And,
                    left,
                    right,
                } => conjuncts.extend([right, left]),
                ExprKind::Call(call) if hir[call].args.len() == 1 => {
                    let Some((asked, MemberKey::Name(method))) = hir.member_key(hir[call].callee)
                    else {
                        continue;
                    };
                    if atoms.bytes(method) == b"startsWith"
                        && bound.binding(hir.skip_type_assertions(asked)) == Binding::Symbol(name)
                        && let Some(start) =
                            find_text_of_run(request, hir.id_at(hir[call].args, 0), &[])
                    {
                        return Some(start);
                    }
                }
                _ => {}
            }
        }
        None
    };
    let mut expression = key;
    let mut statement = loop {
        match bound.parent_of_expr(expression) {
            Parent::Expr(parent) if parent.is_some() => expression = parent,
            Parent::Stmt(statement) if statement.is_some() => break statement,
            _ => return None,
        }
    };
    while let Parent::Stmt(parent) = bound.parent_of_stmt(statement)
        && parent.is_some()
    {
        if let StmtKind::If { test, yes, .. } = hir[parent].kind
            && yes == statement
            && let Some(start) = find_in_test(test)
        {
            return Some(start);
        }
        statement = parent;
    }
    None
}

fn note_parts_of_key(request: &FinishedFile<'_, '_>, key: ExprId, found: &mut LoadsOfFile) -> bool {
    let &FinishedFile {
        analysis, atoms, ..
    } = request;
    let Some(texts) = analysis.find_key_stored_in_cache(key) else {
        return false;
    };
    let mut parts: SmallVec<[(Atom, Option<Atom>); 2]> = SmallVec::new();
    for text in analysis.alternatives_of(texts) {
        match *text {
            ImportSpecifier::Constant(text) => parts.push((text, None)),
            ImportSpecifier::Pattern { prefix, suffix }
                if !atoms.bytes(prefix).is_empty() || !atoms.bytes(suffix).is_empty() =>
            {
                parts.push((prefix, Some(suffix)));
            }
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => return false,
        }
    }
    found.parts_of_keys_taken_out.extend(parts);
    true
}

fn is_stored_under(hir: &File<'_>, bound: &Bound<'_>, key: ExprId) -> bool {
    let Parent::Expr(entry) = bound.parent_of_expr(key) else {
        return false;
    };
    if !matches!(hir[entry].kind, ExprKind::Index { index, .. } if index == key) {
        return false;
    }
    let mut target = entry;
    while let Parent::Expr(parent) = bound.parent_of_expr(target)
        && hir.type_assertion_operand(parent) == Some(target)
    {
        target = parent;
    }
    bound.get_assignment_target(hir, target).is_some()
}

pub(super) fn look_at_keys(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    found: &mut LoadsOfFile,
) {
    let &FinishedFile {
        hir,
        bound,
        analysis,
        resolutions,
        ..
    } = request;
    let is_name_unknown = |site: u32| {
        matches!(
            resolutions[site as usize],
            SiteResolution::Computed(ComputedResolution::All { .. })
        )
    };
    for &key in builtins.keys_taken_out_of_module_cache() {
        let file = find_file_of_key(request, key);
        let KeyOfModuleCache::Computed(written) = key else {
            found.files_taken_out.extend(file);
            continue;
        };
        match file {
            Some(FileOfKey::Site(site)) if !is_name_unknown(site) => {
                found.files_taken_out.push(FileOfKey::Site(site));
            }
            Some(FileOfKey::Path(path)) => found.files_taken_out.push(FileOfKey::Path(path)),
            Some(FileOfKey::Site(_)) | None => {
                let at = range_of_node(hir, NodeData::Expr(written)).0;
                if let Some(start) = find_start_of_key(request, written) {
                    found.starts_of_keys_taken_out.push((start, at));
                } else if !note_parts_of_key(request, written, found) {
                    let why = (WhyEveryFile::TakesOutUnderUnknownKey, at);
                    found.takes_any_file_out.get_or_insert(why);
                }
            }
        }
        if !is_stored_under(hir, bound, written) {
            continue;
        }
        let texts = match file {
            Some(FileOfKey::Path(_)) => continue,
            Some(FileOfKey::Site(site)) => &analysis.import_sites[site as usize].specifier,
            None => {
                (analysis.find_key_stored_in_cache(written)).unwrap_or(&ImportSpecifier::Unknown)
            }
        };
        for text in analysis.alternatives_of(texts) {
            match *text {
                ImportSpecifier::Constant(text) => found.starts_of_keys_stored.push((text, None)),
                ImportSpecifier::Pattern { prefix, suffix } => {
                    found.starts_of_keys_stored.push((prefix, Some(suffix)));
                }
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {
                    found.stores_under_key_nobody_reads = true;
                }
            }
        }
    }
}

fn find_module_stored_under(key: &[u8]) -> Option<RuntimeModule> {
    let (looked_under, module) = find_entry_that_require_looks_for(key)?;
    (looked_under == key).then_some(module)
}

pub(super) fn find_library_modules_that_entries_may_answer(
    atoms: &Interner<'_>,
    keys: &[(Atom, Option<Atom>)],
    is_any_key_stored: bool,
) -> Vec<RuntimeModule> {
    if keys.is_empty() && !is_any_key_stored {
        return Vec::new();
    }
    let may_be = |name: &[u8]| {
        is_any_key_stored
            || keys.iter().any(|&(start, end)| {
                let (start, end) = (atoms.bytes(start), end.map(|end| atoms.bytes(end)));
                match end {
                    None => name == start,
                    Some(end) => {
                        name.len() >= start.len() + end.len()
                            && name.starts_with(start)
                            && name.ends_with(end)
                    }
                }
            })
    };
    let names = BUN_ALIASES.iter().copied().flatten().map(|entry| entry.0);
    let mut modules: Vec<RuntimeModule> = names
        .filter(|name| may_be(name))
        .filter_map(find_module_stored_under)
        .collect();
    modules.shared_sort_unstable_by_key(|module| module.registry_id());
    modules.dedup();
    modules
}
