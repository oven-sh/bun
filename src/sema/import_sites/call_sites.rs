use super::made_requires::{
    OwnRequire, find_own_require, follow_settled_bindings, holds_import_meta_require,
};
use super::{ImportSite, ImportSiteKind, ImportSpecifier, ScanInputs};
use crate::atom::{Atom, Interner, known};
use crate::bind::{Binding, Bound, CommonJsVariable, Parent, ScopeKind};
use crate::fold::Decisions;
use crate::hir::{
    ExprFlags, ExprId, ExprKind, File, IdList, MemberKey, NodeData, PropKey, PropKind,
};
use crate::util::SharedSort;

pub(crate) fn call_site_kind(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> Option<ImportSiteKind> {
    let form = find_call_form(hir, call)?;
    find_call_site(hir, bound, None, call, form).map(|site| site.kind)
}

pub(crate) fn call_site_arguments(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> Option<IdList<ExprId>> {
    let form = find_call_form(hir, call)?;
    find_call_site(hir, bound, None, call, form).map(|site| site.args)
}

pub(super) fn expr_kind(hir: &File<'_>, e: ExprId) -> Option<ExprKind> {
    hir.exprs.get(e.idx()).map(|expr| expr.kind)
}

#[derive(Copy, Clone)]
pub(super) enum CallForm {
    ImportCall {
        args: IdList<ExprId>,
    },
    Call {
        callee: ExprId,
        args: IdList<ExprId>,
    },
}

pub(super) fn find_call_form(hir: &File<'_>, e: ExprId) -> Option<CallForm> {
    match expr_kind(hir, e)? {
        ExprKind::ImportCall { args } => Some(CallForm::ImportCall { args }),
        ExprKind::Call(call) => Some(CallForm::Call {
            callee: hir[call].callee,
            args: hir[call].args,
        }),
        _ => None,
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RequireCallForm {
    Direct,
    Call,
    Apply,
}

#[derive(Copy, Clone)]
pub struct RequireCall {
    pub require: ExprId,
    pub form: RequireCallForm,
    pub args: IdList<ExprId>,
}

pub fn find_require_call(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> Option<RequireCall> {
    let callee = hir.skip_type_assertions(callee);
    if find_own_require(hir, bound, decisions, callee).is_some() {
        return Some(RequireCall {
            require: callee,
            form: RequireCallForm::Direct,
            args,
        });
    }
    let (require, name) = match hir.member_key(callee)? {
        (object, MemberKey::Name(name)) => (hir.skip_type_assertions(object), name),
        (_, MemberKey::PrivateName(_) | MemberKey::Computed(_)) => return None,
    };
    find_own_require(hir, bound, decisions, require)?;
    if name == known::call && args.len() > 1 {
        return Some(RequireCall {
            require,
            form: RequireCallForm::Call,
            args: IdList::new(args.start + 1, args.len - 1),
        });
    }
    if name == known::apply && args.len() == 2 {
        let list = hir.skip_type_assertions(hir.id_at(args, 1));
        let Some(ExprKind::Array(elements)) = expr_kind(hir, list) else {
            return None;
        };
        let is_hole_or_spread = |element| {
            matches!(
                expr_kind(hir, element),
                None | Some(ExprKind::Missing | ExprKind::Spread(_))
            )
        };
        let is_list_of_values = !elements.is_empty() && !hir.ids(elements).any(is_hole_or_spread);
        return is_list_of_values.then_some(RequireCall {
            require,
            form: RequireCallForm::Apply,
            args: elements,
        });
    }
    None
}

struct CallSite {
    kind: ImportSiteKind,
    args: IdList<ExprId>,
    module_require_object: Option<ExprId>,
}

fn find_call_site(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    call: ExprId,
    form: CallForm,
) -> Option<CallSite> {
    let create_site = |kind, args| CallSite {
        kind,
        args,
        module_require_object: None,
    };
    let (callee, args) = match form {
        CallForm::ImportCall { args } => {
            return Some(create_site(ImportSiteKind::ImportCall(call), args));
        }
        CallForm::Call { callee, args } => (callee, args),
    };
    if args.is_empty() {
        return None;
    }
    let callee = hir.skip_type_assertions(callee);
    if let Some(found) = find_require_call(hir, bound, decisions, callee, args) {
        return Some(create_site(ImportSiteKind::Require(call), found.args));
    }
    if holds_import_meta_require(hir, bound, callee) {
        return Some(create_site(ImportSiteKind::ImportMetaRequire(call), args));
    }
    let (object, name) = match hir.member_key(callee)? {
        (object, MemberKey::Name(name)) => (hir.skip_type_assertions(object), name),
        (_, MemberKey::PrivateName(_) | MemberKey::Computed(_)) => return None,
    };
    let is_import_meta = matches!(expr_kind(hir, object), Some(ExprKind::ImportMeta));
    if name == known::require {
        if is_import_meta {
            return Some(create_site(ImportSiteKind::ImportMetaRequire(call), args));
        }
        let is_module = is_free_common_js(hir, bound, object, CommonJsVariable::Module);
        let is_rewritten = !hir
            .expr_flags(callee)
            .contains(ExprFlags::OPTIONAL_CHAIN_LINK);
        return is_module.then_some(CallSite {
            kind: ImportSiteKind::Require(call),
            args,
            module_require_object: is_rewritten.then_some(object),
        });
    }
    if name == known::resolve {
        if is_import_meta {
            return Some(create_site(ImportSiteKind::ImportMetaResolve(call), args));
        }
        let is_require = find_own_require(hir, bound, decisions, object).is_some();
        return is_require.then(|| create_site(ImportSiteKind::RequireResolve(call), args));
    }
    if name == known::getBuiltinModule {
        let is_process = is_global_process(hir, bound, object);
        return is_process.then(|| create_site(ImportSiteKind::GetBuiltinModule(call), args));
    }
    None
}

fn is_free_name(hir: &File<'_>, bound: &Bound<'_>, e: ExprId, names: &[Atom]) -> bool {
    matches!(expr_kind(hir, e), Some(ExprKind::Ident(name)) if names.contains(&name))
        && bound.binding(e) == Binding::Free
        && bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none()
}

fn is_global_process(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = follow_settled_bindings(hir, bound, e);
    if is_free_name(hir, bound, e, &[known::process]) {
        return true;
    }
    matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if name == known::process
            && is_free_name(hir, bound, follow_settled_bindings(hir, bound, object), &[known::globalThis, known::global]))
}

pub(crate) fn is_in_with_scope(bound: &Bound<'_>, ident: ExprId) -> bool {
    let mut scope = bound.dynamic_lookup_scope(NodeData::Expr(ident));
    while let Some(at) = scope {
        let data = &bound.scopes[at.idx()];
        if matches!(data.kind, ScopeKind::With(_)) {
            return true;
        }
        scope = data.parent.some();
    }
    false
}

pub(crate) fn is_free_common_js(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
    variable: CommonJsVariable,
) -> bool {
    matches!(expr_kind(hir, e), Some(ExprKind::Ident(_)))
        && bound.binding(e) == Binding::CommonJs(variable)
        && !is_in_with_scope(bound, e)
}

// The path of the file whose `require` a call goes through, if the file imports that `require`.
fn find_path_to_resolve_from(inputs: &ScanInputs<'_, '_>, call: ExprId) -> Option<Atom> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let Some(CallForm::Call { callee, .. }) = find_call_form(hir, call) else {
        return None;
    };
    let callee = hir.skip_type_assertions(callee);
    let object = hir.member_key(callee).map(|(object, _)| object);
    let written = [Some(callee), object.map(|it| hir.skip_type_assertions(it))];
    written.into_iter().flatten().find_map(|require| {
        match find_own_require(hir, bound, Some(decisions), require) {
            Some(OwnRequire::OfOtherFile(path)) => Some(path),
            Some(OwnRequire::OfFile | OwnRequire::Made) | None => None,
        }
    })
}

pub(super) struct ScannedCalls {
    pub(super) module_require_objects: Vec<ExprId>,
    pub(super) requires_of_other_files: Vec<(u32, Atom)>,
}

pub(super) fn scan_calls(inputs: &ScanInputs<'_, '_>, sites: &mut Vec<ImportSite>) -> ScannedCalls {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let mut module_require_objects = Vec::new();
    let mut requires_of_other_files = Vec::new();
    for index in 0..hir.exprs.len() {
        let call = ExprId(index as u32);
        let Some(form) = find_call_form(hir, call) else {
            continue;
        };
        if bound.parent_of_expr(call) == Parent::None || decisions.is_dead_expr(call) {
            continue;
        }
        let Some(found) = find_call_site(hir, bound, Some(decisions), call, form) else {
            continue;
        };
        let site = create_call_site(inputs, &found);
        if !is_ordinary_builtin_call(&site) {
            module_require_objects.extend(found.module_require_object);
            if !hir.imported_requires.is_empty()
                && let Some(path) = find_path_to_resolve_from(inputs, call)
            {
                requires_of_other_files.push((sites.len() as u32, path));
            }
            sites.push(site);
        }
    }
    module_require_objects.shared_sort_unstable();
    ScannedCalls {
        module_require_objects,
        requires_of_other_files,
    }
}

fn is_ordinary_builtin_call(site: &ImportSite) -> bool {
    matches!(site.kind, ImportSiteKind::GetBuiltinModule(_))
        && !matches!(site.specifier, ImportSpecifier::Constant(_))
}

fn create_call_site(inputs: &ScanInputs<'_, '_>, found: &CallSite) -> ImportSite {
    let &ScanInputs {
        hir,
        decisions,
        atoms,
        ..
    } = inputs;
    let kind = found.kind;
    let mut arguments = hir.ids(found.args);
    let specifier_node = arguments.next();
    let options = arguments.next();
    let specifier = specifier_node.map_or(ImportSpecifier::Unknown, |argument| {
        call_specifier(hir, decisions, argument)
    });
    let is_resolved_at_runtime = kind.call().is_some_and(|call| {
        let flags = hir.expr_flags(call);
        flags.contains(ExprFlags::RESOLVED_AT_RUNTIME)
    });
    ImportSite {
        kind,
        specifier,
        specifier_node: specifier_node.unwrap_or(ExprId::NONE),
        attributes: options.map_or(ExprId::NONE, |options| call_attributes(hir, kind, options)),
        consults_resolver: consults_resolver(atoms, kind, specifier),
        is_host_value: is_resolved_at_runtime && matches!(specifier, ImportSpecifier::Constant(_)),
    }
}

const UNRESOLVED_SPECIFIER_PREFIXES: [&[u8]; 9] = [
    b"./", b"../", b"/", b"file://", b".\\", b"..\\", b"\\", b"node:", b"bun:",
];

fn consults_resolver(
    atoms: &Interner<'_>,
    kind: ImportSiteKind,
    specifier: ImportSpecifier,
) -> bool {
    match kind {
        ImportSiteKind::ImportMetaResolve(_) => match specifier {
            ImportSpecifier::Constant(text) => {
                let text = atoms.bytes(text);
                let mut prefixes = UNRESOLVED_SPECIFIER_PREFIXES.iter();
                !prefixes.any(|prefix| text.starts_with(prefix))
            }
            ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => false,
        },
        _ => true,
    }
}

fn call_specifier(hir: &File<'_>, decisions: &Decisions<'_>, argument: ExprId) -> ImportSpecifier {
    if let Some(ExprKind::String(text)) = expr_kind(hir, argument) {
        return ImportSpecifier::Constant(text);
    }
    decisions.specifier(argument)
}

fn call_attributes(hir: &File<'_>, kind: ImportSiteKind, options: ExprId) -> ExprId {
    match kind {
        ImportSiteKind::ImportCall(_) => import_call_attributes(hir, options),
        ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_)
            if is_object(hir, options) =>
        {
            options
        }
        _ => ExprId::NONE,
    }
}

fn is_object(hir: &File<'_>, e: ExprId) -> bool {
    matches!(expr_kind(hir, e), Some(ExprKind::Object(_)))
}

fn import_call_attributes(hir: &File<'_>, options: ExprId) -> ExprId {
    let Some(ExprKind::Object(props)) = expr_kind(hir, options) else {
        return ExprId::NONE;
    };
    let mut all = props.iter().map(|prop| &hir[prop]);
    let with =
        all.find(|prop| prop.kind == PropKind::Init && prop.key == PropKey::Name(known::with));
    match with {
        Some(prop) if is_object(hir, prop.value) => prop.value,
        Some(_) | None => ExprId::NONE,
    }
}
