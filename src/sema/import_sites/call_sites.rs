use super::alternatives::{WrittenNames, find_alternatives};
use super::made_requires::{
    OwnRequire, StepsLeft, Text, find_imported_export, find_own_require, follow_settled_bindings,
    follow_to_own_require, holds_import_meta_require, may_be_modified, may_require_get_members,
    settled_symbol,
};
use super::{Alternatives, ImportSite, ImportSiteKind, ImportSpecifier, ResolvedForm, ScanInputs};
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
    find_call_site(Text::of(hir, bound, None), call, form, StepsLeft::ALL).map(|site| site.kind)
}

pub(crate) fn call_site_arguments(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> Option<IdList<ExprId>> {
    let form = find_call_form(hir, call)?;
    find_call_site(Text::of(hir, bound, None), call, form, StepsLeft::ALL).map(|site| site.args)
}

pub(super) fn find_request_of_exports(
    text: Text<'_, '_, '_, '_>,
    call: ExprId,
    left: StepsLeft,
) -> Option<ExprId> {
    let form = find_call_form(text.hir, call)?;
    let site = find_call_site(text, call, form, left)?;
    let CallForm::Call { callee, .. } = form else {
        return None;
    };
    match has_fixed_callee(text, callee, site.kind, left) {
        true => text.hir.ids(site.args).next(),
        false => None,
    }
}

fn has_fixed_callee(
    text: Text<'_, '_, '_, '_>,
    callee: ExprId,
    kind: ImportSiteKind,
    left: StepsLeft,
) -> bool {
    let Text { hir, bound, .. } = text;
    let callee = hir.skip_type_assertions(callee);
    let holds_require = || !may_be_modified(hir, bound, CommonJsVariable::Require);
    match kind {
        ImportSiteKind::Require(_) => match follow_to_own_require(text, callee, left) {
            Some(OwnRequire::OfFile) => holds_require(),
            Some(OwnRequire::Made | OwnRequire::OfOtherFile(_)) => true,
            None => match hir.member_key(callee) {
                Some((_, MemberKey::Name(name))) if name == known::require => holds_require(),
                Some((object, _)) => {
                    let object = hir.skip_type_assertions(object);
                    is_free_common_js(hir, bound, object, CommonJsVariable::Require)
                        && holds_require()
                        && !may_require_get_members(hir, bound)
                }
                None => false,
            },
        },
        ImportSiteKind::ImportMetaRequire(_) => !bound.import_meta_may_be_modified(),
        ImportSiteKind::GetBuiltinModule(_) => {
            left.passes_get_builtin_module
                && matches!(hir.member_key(callee), Some((object, _))
                if is_process(hir, bound, hir.skip_type_assertions(object), &[known::globalThis]))
        }
        _ => false,
    }
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
    let text = Text::of(hir, bound, decisions);
    follow_to_require_call(text, callee, args, StepsLeft::ALL)
}

fn follow_to_require_call(
    text: Text<'_, '_, '_, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
    left: StepsLeft,
) -> Option<RequireCall> {
    let hir = text.hir;
    let callee = hir.skip_type_assertions(callee);
    if follow_to_own_require(text, callee, left).is_some() {
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
    follow_to_own_require(text, require, left)?;
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
    text: Text<'_, '_, '_, '_>,
    call: ExprId,
    form: CallForm,
    left: StepsLeft,
) -> Option<CallSite> {
    let Text { hir, bound, .. } = text;
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
    if let Some(found) = follow_to_require_call(text, callee, args, left) {
        return Some(CallSite {
            kind: ImportSiteKind::Require(call),
            args: found.args,
            module_require_object: find_module_printed_as_require(hir, bound, callee),
        });
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
        // `module?.require(..)` reads `module`.
        let is_module = is_free_common_js(hir, bound, object, CommonJsVariable::Module);
        return is_module.then(|| create_site(ImportSiteKind::Require(call), args));
    }
    if name == known::resolve {
        if is_import_meta {
            return Some(create_site(ImportSiteKind::ImportMetaResolve(call), args));
        }
        let is_require = follow_to_own_require(text, object, left).is_some();
        return is_require.then(|| create_site(ImportSiteKind::RequireResolve(call), args));
    }
    if name == known::getBuiltinModule {
        let on_process = is_process(hir, bound, object, &[known::globalThis, known::global]);
        return on_process.then(|| create_site(ImportSiteKind::GetBuiltinModule(call), args));
    }
    None
}

pub(super) fn is_free_name(hir: &File<'_>, bound: &Bound<'_>, e: ExprId, names: &[Atom]) -> bool {
    matches!(expr_kind(hir, e), Some(ExprKind::Ident(name)) if names.contains(&name))
        && bound.binding(e) == Binding::Free
        && bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none()
}

pub(super) fn is_process(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
    global_objects: &[Atom],
) -> bool {
    let e = follow_settled_bindings(hir, bound, e);
    if is_free_name(hir, bound, e, &[known::process]) {
        return true;
    }
    let imported =
        settled_symbol(hir, bound, e).and_then(|symbol| find_imported_export(hir, bound, symbol));
    if let Some((specifier, None)) = imported {
        return specifier == known::process || specifier == known::node_process;
    }
    matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if name == known::process
            && is_free_name(hir, bound, follow_settled_bindings(hir, bound, object), global_objects))
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

/// The `module` of `module.require(..)`. Bun's transpiler prints `require(..)` there: the callee is the `require` of the file, and nothing reads `module`.
pub fn find_module_printed_as_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    access: ExprId,
) -> Option<ExprId> {
    let (object, MemberKey::Name(known::require)) = hir.member_key(access)? else {
        return None;
    };
    let module = hir.skip_type_assertions(object);
    let is_link = hir
        .expr_flags(access)
        .contains(ExprFlags::OPTIONAL_CHAIN_LINK);
    if is_link || !is_free_common_js(hir, bound, module, CommonJsVariable::Module) {
        return None;
    }
    let mut callee = access;
    loop {
        let Parent::Expr(parent) = bound.parent_of_expr(callee) else {
            return None;
        };
        match expr_kind(hir, parent)? {
            ExprKind::Call(call) => return (hir[call].callee == callee).then_some(module),
            _ if hir.type_assertion_operand(parent).is_some() => callee = parent,
            _ => return None,
        }
    }
}

// The path of the file whose `require` a call goes through, if the file imports that `require`.
// A specifier that stands for a whole path starts at the folder of the file that writes it, whichever `require` gets it.
fn find_path_to_resolve_from(
    inputs: &ScanInputs<'_, '_>,
    call: ExprId,
    starts_at_own_directory: bool,
) -> Option<Atom> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    if hir.imported_requires.is_empty() || starts_at_own_directory {
        return None;
    }
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
    pub(super) alternatives: Vec<ImportSpecifier>,
    pub(super) paths_from_own_directory: Vec<ExprId>,
    pub(super) answers_of_resolvers: Vec<(ExprId, ResolvedForm)>,
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
    let mut alternatives = FoundAlternatives::default();
    let mut module_require_objects = Vec::new();
    let mut requires_of_other_files = Vec::new();
    for index in 0..hir.exprs.len() {
        let call = ExprId(index as u32);
        let Some(form) = find_call_form(hir, call) else {
            continue;
        };
        let is_dead = decisions.is_dead_expr(call);
        let is_dead_in_bun_run = is_dead && decisions.as_folded_by_bun_run().is_dead_expr(call);
        if bound.parent_of_expr(call) == Parent::None || is_dead_in_bun_run {
            continue;
        }
        let text = Text::of(hir, bound, Some(decisions));
        let Some(found) = find_call_site(text, call, form, StepsLeft::ALL) else {
            continue;
        };
        if is_dead {
            module_require_objects.extend(found.module_require_object);
            continue;
        }
        let site = create_call_site(inputs, &found, &mut alternatives);
        if !is_ordinary_builtin_call(&site) {
            module_require_objects.extend(found.module_require_object);
            let argument = site.specifier_node;
            let starts_at_own_directory = decisions.is_path_from_own_directory(argument)
                || alternatives.paths_from_own_directory.last() == Some(&argument);
            if let Some(path) = find_path_to_resolve_from(inputs, call, starts_at_own_directory) {
                requires_of_other_files.push((sites.len() as u32, path));
            }
            sites.push(site);
        }
    }
    module_require_objects.shared_sort_unstable();
    alternatives.paths_from_own_directory.shared_sort_unstable();
    alternatives.answers_of_resolvers.shared_sort_unstable();
    ScannedCalls {
        alternatives: alternatives.found,
        paths_from_own_directory: alternatives.paths_from_own_directory,
        answers_of_resolvers: alternatives.answers_of_resolvers,
        module_require_objects,
        requires_of_other_files,
    }
}

fn is_ordinary_builtin_call(site: &ImportSite) -> bool {
    matches!(site.kind, ImportSiteKind::GetBuiltinModule(_))
        && !matches!(site.specifier, ImportSpecifier::Constant(_))
}

fn create_call_site(
    inputs: &ScanInputs<'_, '_>,
    found: &CallSite,
    alternatives: &mut FoundAlternatives,
) -> ImportSite {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let kind = found.kind;
    let mut arguments = hir.ids(found.args);
    let specifier_node = arguments.next();
    let options = arguments.next();
    let specifier = specifier_node.map_or(ImportSpecifier::Unknown, |argument| {
        call_specifier(inputs, argument, alternatives)
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
            ImportSpecifier::Pattern { .. }
            | ImportSpecifier::OneOf(_)
            | ImportSpecifier::Unknown => false,
        },
        _ => true,
    }
}

#[derive(Default)]
struct FoundAlternatives {
    found: Vec<ImportSpecifier>,
    paths_from_own_directory: Vec<ExprId>,
    answers_of_resolvers: Vec<(ExprId, ResolvedForm)>,
    written_names: WrittenNames,
}

fn call_specifier(
    inputs: &ScanInputs<'_, '_>,
    argument: ExprId,
    alternatives: &mut FoundAlternatives,
) -> ImportSpecifier {
    if let Some(ExprKind::String(text)) = expr_kind(inputs.hir, argument) {
        return ImportSpecifier::Constant(text);
    }
    let folded = inputs.decisions.specifier(argument);
    if let ImportSpecifier::Constant(_) = folded {
        return folded;
    }
    let Some(found) = find_alternatives(inputs, &alternatives.written_names, argument) else {
        return folded;
    };
    let only_pattern = match found.alternatives[..] {
        [pattern @ ImportSpecifier::Pattern { .. }] => Some(pattern),
        _ => None,
    };
    if only_pattern.is_some() && folded != ImportSpecifier::Unknown {
        return folded;
    }
    if found.start_at_own_directory {
        alternatives.paths_from_own_directory.push(argument);
    }
    if let Some(form) = found.resolved_form {
        alternatives.answers_of_resolvers.push((argument, form));
    }
    only_pattern.unwrap_or_else(|| {
        let first = alternatives.found.len() as u32;
        alternatives.found.extend_from_slice(&found.alternatives);
        ImportSpecifier::OneOf(Alternatives {
            first,
            count: found.alternatives.len() as u32,
        })
    })
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
