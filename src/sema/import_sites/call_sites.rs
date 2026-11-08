use super::alternatives::{
    AskedOfDataFiles, AskedOfOwnExports, Folder, WrittenNames, find_alternatives,
    find_names_as_written, find_path_around_parameter, find_texts_of_key,
};
use super::changed_files::find_operands_that_name_changed_files;
use super::made_requires::{
    OwnRequire, StepsLeft, Text, find_imported_export, find_own_require, follow_settled_bindings,
    follow_to_own_require, holds_import_meta_require, may_be_modified, may_require_get_members,
    settled_symbol,
};
use super::parameters::{find_names_exported_for, find_parameter_named};
use super::{
    Alternatives, ChangedPath, ExportedFileChanger, ImportSite, ImportSiteKind, ImportSpecifier,
    ResolvedForm, ResolvedFrom, ScanInputs,
};
use crate::atom::{Atom, Interner, known};
use crate::bind::{
    Binding, BindingInitializer, Bound, CommonJsVariable, Decl, FnOwner, Parent, PatParent,
    ScopeKind, SymbolId,
};
use crate::fold::{
    Constant, Decisions, FoldedValue, find_export_of_module, find_members_below_module,
};
use crate::hir::{
    BinOp, Branches, CallId, ClassId, ExprFlags, ExprId, ExprKind, File, IdList,
    ImportedFileChanger, MemberKey, NodeData, PropKey, PropKind, UnOp,
};
use crate::util::SharedSort;

pub const WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY: [&[u8]; 3] =
    [b"importOriginal", b"importActual", b"requireActual"];

pub fn names_word_that_mock_looks_for(text: &[u8]) -> bool {
    WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY
        .iter()
        .any(|word| bun_core::strings::contains(text, word))
}

pub fn may_spell_word_that_mock_looks_for(text: &[u8]) -> bool {
    names_word_that_mock_looks_for(text)
        || bun_core::strings::contains_char(text, b'\\')
        || bun_core::strings::contains(text, b"&#")
}

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
    let left = left.without_choices();
    let callee = hir.skip_type_assertions(callee);
    let holds_require = || !may_be_modified(hir, bound, CommonJsVariable::Require);
    match kind {
        ImportSiteKind::Require(_) => match follow_to_own_require(text, callee, left) {
            Some(OwnRequire::OfFile) => holds_require(),
            Some(
                OwnRequire::Made
                | OwnRequire::MadeForPath(_)
                | OwnRequire::OfOtherFile(_)
                | OwnRequire::MadeInOtherFile(_),
            ) => true,
            Some(OwnRequire::MadeForChoice(_)) => false,
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

#[inline]
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
    if !(name == known::call && args.len() > 1 || name == known::apply && args.len() == 2) {
        return None;
    }
    follow_to_own_require(text, require, left.without_choices())?;
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
        let is_module = is_free_common_js(hir, bound, object, CommonJsVariable::Module);
        return is_module.then(|| create_site(ImportSiteKind::Require(call), args));
    }
    if name == known::resolve {
        if is_import_meta {
            return Some(create_site(ImportSiteKind::ImportMetaResolve(call), args));
        }
        let is_require = follow_to_own_require(text, object, left.without_choices()).is_some();
        return is_require.then(|| create_site(ImportSiteKind::RequireResolve(call), args));
    }
    if name == known::getBuiltinModule {
        let on_process = is_process(hir, bound, object, &[known::globalThis, known::global]);
        return on_process.then(|| create_site(ImportSiteKind::GetBuiltinModule(call), args));
    }
    let is_written_out = matches!(
        expr_kind(hir, hir.id_at(args, 0)),
        Some(ExprKind::String(_))
    );
    if is_mock_module(hir, bound, object, name)
        || (is_written_out && is_module_of_plugin(hir, bound, object, name))
    {
        return Some(create_site(ImportSiteKind::MockModule(call), args));
    }
    if (name == known::importActual || name == known::importMock)
        && may_be_export_of_test_runner(hir, bound, object, &[known::vi, known::vitest])
    {
        return Some(create_site(ImportSiteKind::ImportByTestRunner(call), args));
    }
    let requires = [
        known::requireActual,
        known::requireMock,
        known::createMockFromModule,
    ];
    if requires.contains(&name) && may_be_export_of_test_runner(hir, bound, object, &[known::jest])
    {
        return Some(create_site(ImportSiteKind::RequireByTestRunner(call), args));
    }
    None
}

pub fn is_module_call_of_plugin(hir: &File<'_>, bound: &Bound<'_>, call: ExprId) -> bool {
    let Some(ExprKind::Call(call)) = expr_kind(hir, call) else {
        return false;
    };
    matches!(hir.member_key(hir.skip_type_assertions(hir[call].callee)),
        Some((object, MemberKey::Name(name)))
            if is_module_of_plugin(hir, bound, hir.skip_type_assertions(object), name))
}

fn is_module_of_plugin(hir: &File<'_>, bound: &Bound<'_>, object: ExprId, name: Atom) -> bool {
    if name != known::module {
        return false;
    }
    let Some(symbol) = settled_symbol(hir, bound, object) else {
        return false;
    };
    bound.symbol(symbol).decls.iter().any(|&declaration| {
        let Decl::Param(pattern) = declaration else {
            return false;
        };
        let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
            return false;
        };
        let function = bound.param_fn[parameter.idx()];
        let FnOwner::Expr(value) = bound.fns[function.idx()].owner else {
            return false;
        };
        hir[function].params.iter().next() == Some(parameter)
            && matches!(bound.parent_of_expr(value), Parent::Prop(property)
                if hir[property].key == PropKey::Name(known::setup))
    })
}

fn is_mock_module(hir: &File<'_>, bound: &Bound<'_>, object: ExprId, name: Atom) -> bool {
    let holders: &[Atom] = match name {
        _ if name == known::module => &[known::mock],
        _ if name == known::mock || name == known::doMock => {
            &[known::jest, known::vi, known::vitest]
        }
        _ => return false,
    };
    may_be_export_of_test_runner(hir, bound, object, holders)
}

fn is_name_that_transpiler_knows(
    hir: &File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
    holders: &[Atom],
) -> bool {
    match expr_kind(hir, object) {
        Some(ExprKind::Ident(_)) => {
            let imported = settled_symbol(hir, bound, object)
                .and_then(|symbol| find_imported_export(hir, bound, symbol));
            matches!(imported, Some((specifier, Some(export)))
                if [known::bun_test, known::jest_globals, known::vitest].contains(&specifier)
                    && holders.contains(&export))
        }
        Some(ExprKind::Cond { branches, .. }) => {
            is_free_name(hir, bound, hir.branches(branches).yes, holders)
                && may_be_export_of_test_runner(hir, bound, object, holders)
        }
        _ => false,
    }
}

fn reads_frame_of_caller(hir: &File<'_>, bound: &Bound<'_>, call: CallId) -> bool {
    let callee = hir.skip_type_assertions(hir[call].callee);
    let Some((object, MemberKey::Name(name))) = hir.member_key(callee) else {
        return false;
    };
    let holders: &[Atom] = match name {
        _ if [
            known::toMatchInlineSnapshot,
            known::toThrowErrorMatchingInlineSnapshot,
        ]
        .contains(&name) =>
        {
            return true;
        }
        _ if [known::mock, known::doMock, known::unmock].contains(&name) => {
            &[known::vi, known::vitest, known::jest]
        }
        _ if [known::doUnmock, known::importActual, known::importMock].contains(&name) => {
            &[known::vi, known::vitest]
        }
        _ if [
            known::dontMock,
            known::requireActual,
            known::requireMock,
            known::createMockFromModule,
        ]
        .contains(&name) =>
        {
            &[known::jest]
        }
        _ => return false,
    };
    let object = hir.skip_type_assertions(object);
    is_name_that_transpiler_knows(hir, bound, object, holders)
}

pub fn ends_in_call_that_reads_frame_of_caller(
    hir: &File<'_>,
    bound: &Bound<'_>,
    value: ExprId,
) -> bool {
    let ends_so = |value| ends_in_call_that_reads_frame_of_caller(hir, bound, value);
    match expr_kind(hir, hir.skip_type_assertions(value)) {
        Some(ExprKind::Call(call)) => reads_frame_of_caller(hir, bound, call),
        Some(ExprKind::Cond { branches, .. }) => {
            let Branches { yes, no } = hir.branches(branches);
            ends_so(yes) || ends_so(no)
        }
        Some(ExprKind::Binary {
            op: BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish,
            right,
            ..
        }) => ends_so(right),
        _ => false,
    }
}

fn is_export_of_test_runner(
    hir: &File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
    holders: &[Atom],
) -> bool {
    let Some(mut object) = find_receiver_of_first_method(hir, object) else {
        return false;
    };
    let imported = settled_symbol(hir, bound, object).and_then(|symbol| {
        find_imported_export(hir, bound, symbol)
            .or_else(|| find_required_export(hir, bound, symbol))
    });
    let is_test_runner = |specifier: Atom| {
        [known::bun_test, known::jest_globals, known::vitest].contains(&specifier)
    };
    if matches!(imported, Some((specifier, Some(export)))
        if is_test_runner(specifier) && holders.contains(&export))
    {
        return true;
    }
    let find_constant = |e| match expr_kind(hir, e) {
        Some(ExprKind::String(text)) => Some(Constant::String(text)),
        _ => None,
    };
    let find_members = |e: ExprId| {
        find_members_below_module(hir, bound, e, &find_constant, &is_test_runner, false)
    };
    let is_holder = |members: &[Atom]| matches!(members, [export] if holders.contains(export));
    if find_members(object).is_some_and(|members| is_holder(&members)) {
        return true;
    }
    let mut members: Vec<Atom> = Vec::new();
    while let Some((below, MemberKey::Name(name))) = hir.member_key(object) {
        members.push(name);
        object = hir.skip_type_assertions(below);
    }
    let Some(symbol) = settled_symbol(hir, bound, object) else {
        return false;
    };
    let source = match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Expression(source) => source,
        BindingInitializer::PatternProperty { source, path } => {
            members.extend(path.iter().rev());
            source
        }
        _ => return false,
    };
    find_members(source).is_some_and(|below| {
        members.extend(below);
        is_holder(&members)
    })
}

fn find_receiver_of_first_method(hir: &File<'_>, mut object: ExprId) -> Option<ExprId> {
    while let Some(ExprKind::Call(call)) = expr_kind(hir, object) {
        let callee = hir.skip_type_assertions(hir[call].callee);
        let Some((receiver, MemberKey::Name(_))) = hir.member_key(callee) else {
            return None;
        };
        object = hir.skip_type_assertions(receiver);
    }
    Some(object)
}

fn find_required_export(
    hir: &File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<(Atom, Option<Atom>)> {
    bound.symbol(symbol).decls.iter().find_map(|&declaration| {
        let (Decl::Var(name) | Decl::Require(name)) = declaration else {
            return None;
        };
        let PatParent::Prop(names, property) = bound.pat_parent[name.idx()] else {
            return None;
        };
        let PatParent::Var(declarator) = bound.pat_parent[names.idx()] else {
            return None;
        };
        let property = hir[property];
        let PropKey::Name(export) = property.key else {
            return None;
        };
        if property.is_rest || property.default.is_some() {
            return None;
        }
        let loaded = hir.skip_type_assertions(hir[declarator].init);
        let Some(CallForm::Call { callee, args }) = find_call_form(hir, loaded) else {
            return None;
        };
        let callee = hir.skip_type_assertions(callee);
        let text = Text::of(hir, bound, None);
        let args = match follow_to_require_call(text, callee, args, StepsLeft::ALL) {
            Some(found) => found.args,
            None if holds_import_meta_require(hir, bound, callee) => args,
            None => return None,
        };
        if args.is_empty() {
            return None;
        }
        match expr_kind(hir, hir.skip_type_assertions(hir.id_at(args, 0))) {
            Some(ExprKind::String(specifier)) => Some((specifier, Some(export))),
            _ => None,
        }
    })
}

fn may_be_export_of_test_runner(
    hir: &File<'_>,
    bound: &Bound<'_>,
    object: ExprId,
    holders: &[Atom],
) -> bool {
    if is_export_of_test_runner(hir, bound, object, holders) {
        return true;
    }
    let Some(object) = find_receiver_of_first_method(hir, object) else {
        return false;
    };
    if let Some(ExprKind::Cond { branches, .. }) = expr_kind(hir, object) {
        let branches = hir.branches(branches);
        return [branches.yes, branches.no].into_iter().any(|branch| {
            may_be_export_of_test_runner(hir, bound, hir.skip_type_assertions(branch), holders)
        });
    }
    let Some(symbol) = settled_symbol(hir, bound, object) else {
        return false;
    };
    bound.symbol(symbol).decls.iter().any(|&declaration| {
        let Decl::Var(pattern) = declaration else {
            return false;
        };
        let PatParent::Prop(_, property) = bound.pat_parent[pattern.idx()] else {
            return false;
        };
        let default = hir[property].default;
        default.is_some()
            && is_export_of_test_runner(hir, bound, hir.skip_type_assertions(default), holders)
    })
}

pub(super) fn is_free_name(hir: &File<'_>, bound: &Bound<'_>, e: ExprId, names: &[Atom]) -> bool {
    matches!(expr_kind(hir, e), Some(ExprKind::Ident(name)) if names.contains(&name))
        && bound.binding(e) == Binding::Free
        && bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none()
}

pub(crate) fn is_process(
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

pub fn is_linked_by_bundler(hir: &File<'_>, bound: &Bound<'_>, site: ImportSiteKind) -> bool {
    let call = match site {
        ImportSiteKind::ImportMetaRequire(_) => return false,
        ImportSiteKind::Require(call) => call,
        _ => return true,
    };
    let Some(ExprKind::Call(call)) = expr_kind(hir, call) else {
        return false;
    };
    let callee = hir.skip_type_assertions(hir[call].callee);
    hir[call].args.len() == 1
        && (is_free_common_js(hir, bound, callee, CommonJsVariable::Require)
            || find_module_printed_as_require(hir, bound, callee).is_some())
}

pub fn is_name_read_by_transpiler(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    site: ImportSiteKind,
) -> bool {
    let call = match site {
        ImportSiteKind::ImportMetaRequire(_) | ImportSiteKind::GetBuiltinModule(_) => return false,
        ImportSiteKind::Require(call) => call,
        _ => return true,
    };
    let Some(CallForm::Call { callee, args }) = find_call_form(hir, call) else {
        return false;
    };
    let text = Text::of(hir, bound, Some(decisions));
    args.len() == 1
        && follow_to_own_require(text, callee, StepsLeft::ALL.without_choices())
            == Some(OwnRequire::OfFile)
}

pub fn is_name_written_out(hir: &File<'_>, name: ExprId) -> bool {
    match hir[hir.skip_type_assertions(name)].kind {
        ExprKind::String(_) => true,
        ExprKind::Template { exprs } => hir.ids(exprs).next().is_none(),
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } => is_name_written_out(hir, left) && is_name_written_out(hir, right),
        ExprKind::Cond { branches, .. } => {
            let Branches { yes, no } = hir.branches(branches);
            is_name_written_out(hir, yes) && is_name_written_out(hir, no)
        }
        _ => false,
    }
}

struct UnreadPath;

fn read_path_given_to_create_require(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    given: ExprId,
    paths_read: &mut Vec<(ExprId, Atom)>,
) -> Result<Option<ResolvedFrom>, UnreadPath> {
    let asked = AskedOfDataFiles::default();
    let found = find_alternatives(
        inputs,
        written_names,
        &asked,
        given,
        Folder::OfFile,
        None,
        None,
    )
    .ok_or(UnreadPath)?;
    let ([ImportSpecifier::Constant(path)], true, false) = (
        &found.alternatives[..],
        found.start_at_own_directory,
        found.is_out_of_data_file,
    ) else {
        return Err(UnreadPath);
    };
    let text = inputs.atoms.bytes(*path);
    let Some(below) = text.strip_prefix(b"./") else {
        paths_read.push((given, *path));
        return Ok(Some(ResolvedFrom::PathFromOwnFolder(*path)));
    };
    let last = below.rsplit(|&byte| byte == b'/').next();
    if matches!(last, Some(b"." | b"..")) {
        return Err(UnreadPath);
    }
    paths_read.push((given, *path));
    match last {
        Some(name) if name.len() == below.len() => Ok(None),
        _ => Ok(Some(ResolvedFrom::PathFromOwnFolder(*path))),
    }
}

fn find_path_to_resolve_from(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    call: ExprId,
    starts_at_own_directory: bool,
    paths_read: &mut Vec<(ExprId, Atom)>,
) -> Result<Option<ResolvedFrom>, UnreadPath> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let Some(CallForm::Call { callee, .. }) = find_call_form(hir, call) else {
        return Ok(None);
    };
    let callee = hir.skip_type_assertions(callee);
    let object = hir.member_key(callee).map(|(object, _)| object);
    let written = [Some(callee), object.map(|it| hir.skip_type_assertions(it))];
    for require in written.into_iter().flatten() {
        match find_own_require(hir, bound, Some(decisions), require) {
            Some(OwnRequire::OfOtherFile(path) | OwnRequire::MadeInOtherFile(path))
                if !starts_at_own_directory =>
            {
                return Ok(Some(ResolvedFrom::File(path)));
            }
            Some(OwnRequire::MadeForPath(path)) if !starts_at_own_directory => {
                return read_path_given_to_create_require(inputs, written_names, path, paths_read);
            }
            _ => {}
        }
    }
    Ok(None)
}

pub(super) struct ScannedCalls {
    pub(super) alternatives: Vec<ImportSpecifier>,
    pub(super) paths_from_own_directory: Vec<ExprId>,
    pub(super) answers_of_resolvers: Vec<(ExprId, ResolvedForm)>,
    pub(super) names_of_workers: Vec<(ExprId, ImportSpecifier)>,
    pub(super) paths_of_changed_files: Vec<ChangedPath>,
    pub(super) exported_file_changers: Vec<ExportedFileChanger>,
    pub(super) asked_of_other_files: Vec<(Atom, Atom)>,
    pub(super) asked_of_data_files: Vec<(Atom, Atom)>,
    pub(super) asked_of_own_exports: Vec<Atom>,
    pub(super) names_out_of_data_files: Vec<(Atom, ExprId, bool)>,
    pub(super) keys_stored_in_caches: Vec<(ExprId, ImportSpecifier)>,
    pub(super) module_require_objects: Vec<ExprId>,
    pub(super) requires_of_other_files: Vec<(u32, ResolvedFrom)>,
    pub(super) paths_given_to_create_require: Vec<(ExprId, Atom)>,
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
    let mut paths_given_to_create_require = Vec::new();
    let mut names_of_workers = Vec::new();
    let mut paths_of_changed_files = Vec::new();
    let mut exported_file_changers: Vec<ExportedFileChanger> = Vec::new();
    let mut keys_stored_in_caches = Vec::new();
    for index in 0..hir.exprs.len() {
        let call = ExprId(index as u32);
        let Some(form) = find_call_form(hir, call) else {
            match hir.exprs[index].kind {
                ExprKind::New(_) => {
                    if let Some(name) = find_name_of_worker(inputs, call, &mut alternatives) {
                        names_of_workers.push(name);
                    }
                }
                ExprKind::Index { .. } => {
                    if let Some(key) = find_key_stored_in_cache(inputs, call, &mut alternatives) {
                        keys_stored_in_caches.push(key);
                    }
                }
                _ => {}
            }
            continue;
        };
        let is_dead = decisions.is_dead_expr(call);
        let is_dead_in_bun_run = is_dead && decisions.as_folded_by_bun_run().is_dead_expr(call);
        if bound.parent_of_expr(call) == Parent::None || is_dead_in_bun_run {
            continue;
        }
        if let (false, CallForm::Call { callee, args }) = (is_dead, form) {
            for (mut changed, around) in find_operands_that_name_changed_files(inputs, callee, args)
            {
                let names = alternatives.names_out_of_data_files.len();
                changed.path = path_specifier(inputs, changed.operand, &mut alternatives);
                alternatives.names_out_of_data_files.truncate(names);
                if !matches!(
                    changed.path,
                    ImportSpecifier::Constant(_) | ImportSpecifier::OneOf(_)
                ) && let Some(path) =
                    find_path_below_working_directory(inputs, changed.operand, &mut alternatives)
                {
                    changed.path = path;
                }
                if let Some(around) = around {
                    changed.path = write_around(inputs, &changed, around, &mut alternatives);
                }
                if changed.path != ImportSpecifier::Unknown {
                    paths_of_changed_files.push(changed);
                }
                if matches!(
                    changed.path,
                    ImportSpecifier::Constant(_) | ImportSpecifier::OneOf(_)
                ) {
                    continue;
                }
                let written_names = &alternatives.written_names;
                exported_file_changers.extend(find_exports_that_take(
                    inputs,
                    written_names,
                    &changed,
                ));
            }
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
            let written_names = &alternatives.written_names;
            let paths_read = &mut paths_given_to_create_require;
            let is_from_own = starts_at_own_directory;
            match find_path_to_resolve_from(inputs, written_names, call, is_from_own, paths_read) {
                Ok(Some(path)) => requires_of_other_files.push((sites.len() as u32, path)),
                Ok(None) => {}
                Err(UnreadPath) => continue,
            }
            sites.push(site);
        }
    }
    module_require_objects.shared_sort_unstable();
    paths_given_to_create_require.shared_sort_unstable_by_key(|it: &(ExprId, Atom)| it.0);
    paths_given_to_create_require.dedup();
    alternatives.paths_from_own_directory.shared_sort_unstable();
    alternatives.answers_of_resolvers.shared_sort_unstable();
    names_of_workers.shared_sort_unstable_by_key(|it: &(ExprId, ImportSpecifier)| it.0);
    keys_stored_in_caches.shared_sort_unstable_by_key(|it: &(ExprId, ImportSpecifier)| it.0);
    exported_file_changers
        .shared_sort_unstable_by_key(|it| (it.export.0, it.place, it.reaches_below));
    exported_file_changers.dedup();
    ScannedCalls {
        alternatives: alternatives.found,
        paths_from_own_directory: alternatives.paths_from_own_directory,
        answers_of_resolvers: alternatives.answers_of_resolvers,
        names_of_workers,
        paths_of_changed_files,
        exported_file_changers,
        asked_of_other_files: alternatives.asked_of_other_files.take(),
        asked_of_data_files: alternatives.asked_of_data_files.take(),
        asked_of_own_exports: alternatives.asked_of_own_exports.take(),
        names_out_of_data_files: alternatives.names_out_of_data_files,
        keys_stored_in_caches,
        module_require_objects,
        requires_of_other_files,
        paths_given_to_create_require,
    }
}

fn names_module_cache(inputs: &ScanInputs<'_, '_>, table: ExprId) -> bool {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        atoms,
        ..
    } = inputs;
    let table = follow_settled_bindings(hir, bound, table);
    if let Some((object, MemberKey::Name(name))) = hir.member_key(table)
        && atoms.bytes(name) == b"cache"
    {
        let object = hir.skip_type_assertions(object);
        return is_free_common_js(hir, bound, object, CommonJsVariable::Require);
    }
    let find_constant = |e| match decisions.constant(hir, e) {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
            Some(constant)
        }
        FoldedValue::Unknown => None,
    };
    let is_module = |specifier: Atom| matches!(atoms.bytes(specifier), b"module" | b"node:module");
    find_export_of_module(hir, bound, table, &find_constant, &is_module)
        .is_some_and(|name| atoms.bytes(name) == b"_cache")
}

fn find_key_stored_in_cache(
    inputs: &ScanInputs<'_, '_>,
    entry: ExprId,
    alternatives: &mut FoundAlternatives,
) -> Option<(ExprId, ImportSpecifier)> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let ExprKind::Index { .. } = expr_kind(hir, entry)? else {
        return None;
    };
    let (table, MemberKey::Computed(key)) = hir.member_key(entry)? else {
        return None;
    };
    let mut target = entry;
    while let Parent::Expr(parent) = bound.parent_of_expr(target)
        && hir.type_assertion_operand(parent) == Some(target)
    {
        target = parent;
    }
    let is_deleted = matches!(
        bound.parent_of_expr(target),
        Parent::Expr(parent) if matches!(expr_kind(hir, parent), Some(ExprKind::Unary { op: UnOp::Delete, .. }))
    );
    if !is_deleted {
        bound.get_assignment_target(hir, target)?;
    }
    if decisions.is_dead_expr(entry) || !names_module_cache(inputs, table) {
        return None;
    }
    let FoundAlternatives {
        written_names,
        asked_of_data_files,
        ..
    } = alternatives;
    let texts = find_texts_of_key(inputs, written_names, asked_of_data_files, key)?;
    let text = match texts[..] {
        [only] => only,
        _ => {
            let first = alternatives.found.len() as u32;
            alternatives.found.extend_from_slice(&texts);
            ImportSpecifier::OneOf(Alternatives {
                first,
                count: texts.len() as u32,
            })
        }
    };
    Some((key, text))
}

fn is_worker_threads(specifier: Atom) -> bool {
    specifier == known::worker_threads || specifier == known::node_worker_threads
}

fn find_whether_constructor_is_worker(
    hir: &File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
) -> Option<bool> {
    let find_constant = |e| match expr_kind(hir, e) {
        Some(ExprKind::String(text)) => Some(Constant::String(text)),
        _ => None,
    };
    let export = find_export_of_module(hir, bound, callee, &find_constant, &is_worker_threads);
    if let Some(export) = export {
        return Some(export == known::Worker);
    }
    let constructor = follow_settled_bindings(hir, bound, callee);
    if let Some((object, MemberKey::Name(name))) = hir.member_key(constructor) {
        let object = follow_settled_bindings(hir, bound, object);
        let global_objects = [known::globalThis, known::global, known::self_];
        return is_free_name(hir, bound, object, &global_objects).then_some(name == known::Worker);
    }
    let is_own = |class: ClassId| hir[class].extends.is_none().then_some(false);
    match expr_kind(hir, constructor)? {
        ExprKind::Class(class) => is_own(class),
        ExprKind::Fn(_) => Some(false),
        ExprKind::Ident(_) if is_free_name(hir, bound, constructor, &[known::Worker]) => Some(true),
        ExprKind::Ident(_) if bound.binding(constructor) == Binding::Free => bound
            .dynamic_lookup_scope(NodeData::Expr(constructor))
            .is_none()
            .then_some(false),
        ExprKind::Ident(_) => {
            let symbol = settled_symbol(hir, bound, constructor)?;
            match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Class(class) => is_own(class),
                BindingInitializer::Function(_) => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

pub(crate) fn may_construct_worker(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> bool {
    let callee = hir.skip_type_assertions(callee);
    let is_called_worker = matches!(
        expr_kind(hir, callee),
        Some(ExprKind::Ident(name) | ExprKind::Dot { name, .. }) if name == known::Worker
    );
    find_whether_constructor_is_worker(hir, bound, callee).unwrap_or(is_called_worker)
}

fn find_name_of_worker(
    inputs: &ScanInputs<'_, '_>,
    construction: ExprId,
    alternatives: &mut FoundAlternatives,
) -> Option<(ExprId, ImportSpecifier)> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let ExprKind::New(call) = expr_kind(hir, construction)? else {
        return None;
    };
    let is_evaluated =
        bound.parent_of_expr(construction) != Parent::None && !decisions.is_dead_expr(construction);
    if !is_evaluated || !may_construct_worker(hir, bound, hir[call].callee) {
        return None;
    }
    let argument = hir.ids(hir[call].args).next()?;
    let specifier = call_specifier(inputs, argument, alternatives);
    let is_known_in_part = matches!(
        specifier,
        ImportSpecifier::Pattern { .. } | ImportSpecifier::OneOf(_)
    );
    is_known_in_part.then_some((argument, specifier))
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

pub fn does_import_meta_resolve_ask_resolver(specifier: &[u8]) -> bool {
    let mut prefixes = UNRESOLVED_SPECIFIER_PREFIXES.iter();
    !prefixes.any(|prefix| specifier.starts_with(prefix))
}

fn consults_resolver(
    atoms: &Interner<'_>,
    kind: ImportSiteKind,
    specifier: ImportSpecifier,
) -> bool {
    match kind {
        ImportSiteKind::ImportMetaResolve(_) => match specifier {
            ImportSpecifier::Constant(text) => {
                does_import_meta_resolve_ask_resolver(atoms.bytes(text))
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
    asked_of_data_files: AskedOfDataFiles,
    asked_of_other_files: AskedOfDataFiles,
    asked_of_own_exports: AskedOfOwnExports,
    names_out_of_data_files: Vec<(Atom, ExprId, bool)>,
}

fn call_specifier(
    inputs: &ScanInputs<'_, '_>,
    argument: ExprId,
    alternatives: &mut FoundAlternatives,
) -> ImportSpecifier {
    find_specifier(inputs, argument, alternatives, false)
}

fn path_specifier(
    inputs: &ScanInputs<'_, '_>,
    argument: ExprId,
    alternatives: &mut FoundAlternatives,
) -> ImportSpecifier {
    find_specifier(inputs, argument, alternatives, true)
}

fn find_specifier(
    inputs: &ScanInputs<'_, '_>,
    argument: ExprId,
    alternatives: &mut FoundAlternatives,
    reads_other_files: bool,
) -> ImportSpecifier {
    if let Some(ExprKind::String(text)) = expr_kind(inputs.hir, argument) {
        return ImportSpecifier::Constant(text);
    }
    let folded = inputs.decisions.specifier(argument);
    if let ImportSpecifier::Constant(_) = folded {
        return folded;
    }
    let found = find_alternatives(
        inputs,
        &alternatives.written_names,
        &alternatives.asked_of_data_files,
        argument,
        Folder::OfFile,
        reads_other_files.then_some(&alternatives.asked_of_other_files),
        Some(&alternatives.asked_of_own_exports),
    );
    let is_followed = found.as_ref().is_some_and(|found| {
        let mut names = found.alternatives.iter();
        found.is_out_of_data_file || names.all(|it| matches!(it, ImportSpecifier::Constant(_)))
    });
    if !is_followed {
        let written = find_names_as_written(inputs, &alternatives.written_names, argument);
        let written = written.into_iter().map(|name| (name, argument, true));
        alternatives.names_out_of_data_files.extend(written);
    }
    let Some(found) = found else {
        return folded;
    };
    if found.is_out_of_data_file {
        let names = found.alternatives.iter().filter_map(|it| match *it {
            ImportSpecifier::Constant(name) => {
                Some((name, argument, found.may_be_changed_by_others))
            }
            _ => None,
        });
        alternatives.names_out_of_data_files.extend(names);
        return folded;
    }
    let only_pattern = match found.alternatives[..] {
        [pattern @ ImportSpecifier::Pattern { .. }] => Some(pattern),
        _ => None,
    };
    let length_of_start = |specifier| match specifier {
        ImportSpecifier::Pattern { prefix, .. } => inputs.atoms.bytes(prefix).len(),
        _ => 0,
    };
    if let Some(pattern) = only_pattern
        && folded != ImportSpecifier::Unknown
        && found.resolved_form.is_none()
        && length_of_start(pattern) <= length_of_start(folded)
    {
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

fn find_exports_that_take(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    changed: &ChangedPath,
) -> Vec<ExportedFileChanger> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let Some(path) = find_path_around_parameter(inputs, written_names, changed.operand) else {
        return Vec::new();
    };
    let Some((function, place)) = find_parameter_named(hir, bound, path.mention) else {
        return Vec::new();
    };
    let find_written = |name: Atom| written_names.find_expressions(hir, name);
    let exports = find_names_exported_for(hir, bound, function, &find_written);
    let changers = exports.into_iter().map(|export| ExportedFileChanger {
        export,
        place: place as u32,
        reaches_below: changed.reaches_below,
        start: atoms.intern(&path.start),
        end: atoms.intern(&path.end),
        starts_at_own_directory: path.starts_at_own_directory,
    });
    changers.collect()
}

fn write_around(
    inputs: &ScanInputs<'_, '_>,
    changed: &ChangedPath,
    around: &ImportedFileChanger,
    alternatives: &mut FoundAlternatives,
) -> ImportSpecifier {
    let atoms = inputs.atoms;
    let (start, end) = (atoms.bytes(around.start), atoms.bytes(around.end));
    if start.is_empty() && end.is_empty() {
        return changed.path;
    }
    let is_written_from_somewhere = alternatives.paths_from_own_directory.last()
        == Some(&changed.operand)
        || (alternatives.answers_of_resolvers.last()).is_some_and(|it| it.0 == changed.operand)
        || inputs.decisions.is_path_from_own_directory(changed.operand);
    let given: Vec<ImportSpecifier> = match changed.path {
        ImportSpecifier::OneOf(range) => {
            alternatives.found[range.first as usize..][..range.count as usize].to_vec()
        }
        path => vec![path],
    };
    let mut whole = Vec::with_capacity(given.len());
    for part in given {
        let ImportSpecifier::Constant(part) = part else {
            return ImportSpecifier::Unknown;
        };
        whole.push(ImportSpecifier::Constant(
            atoms.intern(&[start, atoms.bytes(part), end].concat()),
        ));
    }
    if is_written_from_somewhere {
        return ImportSpecifier::Unknown;
    }
    if around.starts_at_own_directory {
        alternatives.paths_from_own_directory.push(changed.operand);
    }
    let first = alternatives.found.len() as u32;
    alternatives.found.extend_from_slice(&whole);
    ImportSpecifier::OneOf(Alternatives {
        first,
        count: whole.len() as u32,
    })
}

fn find_path_below_working_directory(
    inputs: &ScanInputs<'_, '_>,
    path: ExprId,
    alternatives: &mut FoundAlternatives,
) -> Option<ImportSpecifier> {
    let asked = AskedOfDataFiles::default();
    let written_names = &alternatives.written_names;
    let of_other_files = Some(&alternatives.asked_of_other_files);
    let folder = Folder::WorkingDirectory;
    let found = find_alternatives(
        inputs,
        written_names,
        &asked,
        path,
        folder,
        of_other_files,
        None,
    )?;
    if !found.start_at_own_directory || found.is_out_of_data_file {
        return None;
    }
    let first = alternatives.found.len() as u32;
    alternatives.found.extend_from_slice(&found.alternatives);
    Some(ImportSpecifier::OneOf(Alternatives {
        first,
        count: found.alternatives.len() as u32,
    }))
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
