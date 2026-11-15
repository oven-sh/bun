use super::alternatives::{
    AskedOfDataFiles, AskedOfOwnExports, FindingsOfFile, Folder, Found, UnknownValues,
    WrittenNames, find_alternatives, find_elements_of_list_that_nothing_changes,
    find_names_as_written, find_path_around_parameter, find_texts_of_key, find_worker_names,
    names_own_url, writes_url_path,
};
use super::changed_files::{TextsOfFile, find_file_path_operands, find_list_iterated_by_read};
use super::made_requires::{
    OwnRequire, StepsLeft, Text, UrlsHanded, find_imported_export, find_own_require,
    follow_settled_bindings, follow_to_own_require, holds_import_meta_require, is_nothing,
    may_be_modified, may_require_get_members, settled_symbol,
};
use super::named_paths::{
    add_forwarding_functions, collect_candidates, find_database_read, find_named_paths,
    find_paths_created, is_relative_path,
};
use super::parameters::{find_names_exported_for, find_parameter_named};
use super::{
    Alternatives, CallerRelativeRead, ChangedPath, ExportedFileChanger, ImportSite, ImportSiteKind,
    ImportSpecifier, NamedPath, OwnUrlArgument, ResolvedForm, ResolvedFrom, ScanInputs, WorkerName,
};
use crate::atom::{Atom, Interner, known};
use crate::bind::{
    Binding, BindingInitializer, Bound, CommonJsVariable, Decl, FnOwner, MemberOwner, Parent,
    PatParent, ScopeKind, SymbolId,
};
use crate::fold::{
    Constant, Decisions, FoldedValue, Passes, find_export_of_module, find_members_below_module,
};
use crate::hir::{
    BinOp, Branches, CallId, ClassId, ExprFlags, ExprId, ExprKind, File, IdList,
    ImportedFileChanger, MemberKey, MemberKind, NodeData, PropId, PropKey, PropKind, StmtKind,
    UnOp, VarKind,
};
use crate::util::{FxHashMap, FxHashSet, SharedSort};
use bun_core::strings;

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

/// What the text of a file has that its comments may spell a word of `WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY` with.
#[derive(Copy, Clone)]
pub struct MockWordsInText {
    names_word: bool,
    has_character_reference: bool,
}

impl MockWordsInText {
    pub fn of(text: &[u8]) -> MockWordsInText {
        MockWordsInText {
            names_word: names_word_that_mock_looks_for(text),
            has_character_reference: bun_core::strings::contains(text, b"&#"),
        }
    }

    /// True if `part` of that text may spell such a word.
    pub fn may_be_spelled_in(self, part: &[u8]) -> bool {
        bun_core::strings::contains_char(part, b'\\')
            || self.names_word && names_word_that_mock_looks_for(part)
            || self.has_character_reference && bun_core::strings::contains(part, b"&#")
    }
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
        let passes = Passes::default();
        find_members_below_module(hir, bound, e, &find_constant, &is_test_runner, passes)
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

pub fn is_name_written_out(hir: &File<'_>, mut name: ExprId) -> bool {
    loop {
        name = match hir[hir.skip_type_assertions(name)].kind {
            ExprKind::String(_) => return true,
            ExprKind::Template { exprs } => return hir.ids(exprs).next().is_none(),
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } if is_name_written_out(hir, right) => left,
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                if !is_name_written_out(hir, yes) {
                    return false;
                }
                no
            }
            _ => return false,
        };
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
        None,
    )
    .ok_or(UnreadPath)?;
    let is_url_from_own_file = matches!(
        found.resolved_form,
        Some(ResolvedForm::Url | ResolvedForm::UrlObject)
    );
    let ([ImportSpecifier::Constant(path)], true, false) = (
        &found.alternatives[..],
        found.start_at_own_directory || is_url_from_own_file,
        found.is_from_data_file,
    ) else {
        return Err(UnreadPath);
    };
    let from_own_folder = match inputs.atoms.bytes(*path) {
        above if is_url_from_own_file && above.starts_with(b"../") => {
            inputs.atoms.intern(&[b"./", above].concat())
        }
        _ => *path,
    };
    let path = &from_own_folder;
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

struct UnreadFolders;

fn find_folders_listed_for_resolve(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    arguments: IdList<ExprId>,
) -> Result<Vec<Atom>, UnreadFolders> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    if arguments.len() < 2 {
        return Ok(Vec::new());
    }
    let options = hir.skip_type_assertions(hir.id_at(arguments, 1));
    if is_nothing(hir, bound, options) {
        return Ok(Vec::new());
    }
    let ExprKind::Object(properties) = hir[options].kind else {
        return Err(UnreadFolders);
    };
    let is_plain = |kind: PropKind| matches!(kind, PropKind::Init | PropKind::Shorthand);
    let is_named = |key: PropKey| matches!(key, PropKey::Name(_));
    if !(properties.iter()).all(|id| is_plain(hir[id].kind) && is_named(hir[id].key)) {
        return Err(UnreadFolders);
    }
    let paths = PropKey::Name(atoms.intern(b"paths"));
    let mut listed = properties.iter().filter(|&id| hir[id].key == paths);
    let property = match (listed.next(), listed.next()) {
        (None, _) => return Ok(Vec::new()),
        (Some(property), None) if arguments.len() == 2 => property,
        _ => return Err(UnreadFolders),
    };
    find_folders_listed_under(inputs, written_names, property).ok_or(UnreadFolders)
}

fn find_folders_listed_under(
    inputs: &ScanInputs<'_, '_>,
    written_names: &WrittenNames,
    property: PropId,
) -> Option<Vec<Atom>> {
    let hir = inputs.hir;
    let list = hir[property].value;
    let folders = find_elements_of_list_that_nothing_changes(inputs, written_names, list)?;
    let folders = hir.ids(folders).map(|folder| {
        let asked = AskedOfDataFiles::default();
        let from = Folder::OfFile;
        let found = find_alternatives(
            inputs,
            written_names,
            &asked,
            folder,
            from,
            None,
            None,
            None,
        )?;
        match (
            &found.alternatives[..],
            found.start_at_own_directory,
            found.is_from_data_file,
        ) {
            ([ImportSpecifier::Constant(path)], true, false) => Some(*path),
            _ => None,
        }
    });
    folders.collect()
}

pub(super) struct ScannedCalls {
    pub(super) alternatives: Vec<ImportSpecifier>,
    pub(super) paths_from_own_directory: Vec<ExprId>,
    pub(super) answers_of_resolvers: Vec<(ExprId, ResolvedForm)>,
    pub(super) names_of_workers: Vec<WorkerName>,
    pub(super) paths_of_changed_files: Vec<ChangedPath>,
    pub(super) module_relative_reads: Vec<(ExprId, Atom)>,
    pub(super) module_relative_patterns: Vec<(ExprId, Atom, Atom)>,
    pub(super) reads_ruled_out: Vec<(ExprId, Atom)>,
    pub(super) patterns_ruled_out: Vec<(ExprId, Atom, Atom)>,
    pub(super) caller_relative_reads: Vec<CallerRelativeRead>,
    pub(super) unknown_path_reads: Vec<ExprId>,
    pub(super) path_listings: Vec<ExprId>,
    pub(super) folders_entered: Vec<(ExprId, Atom)>,
    pub(super) reads_below_working_folder: Vec<(ExprId, Atom)>,
    pub(super) named_paths: Vec<NamedPath>,
    pub(super) paths_created: Vec<Atom>,
    pub(super) web_assembly_names: Vec<(ExprId, Atom)>,
    pub(super) reading_functions: Vec<SymbolId>,
    pub(super) own_folder_arguments: Vec<(ExprId, Option<ExprId>)>,
    pub(super) path_queries: Vec<ExprId>,
    pub(super) known_load_names: Vec<(ExprId, Atom)>,
    pub(super) own_url_arguments: Vec<OwnUrlArgument>,
    pub(super) exported_file_changers: Vec<ExportedFileChanger>,
    pub(super) other_file_queries: Vec<(Atom, Atom)>,
    pub(super) data_file_queries: Vec<(Atom, Atom)>,
    pub(super) own_path_queries: Vec<(Atom, Atom)>,
    pub(super) own_export_queries: Vec<Atom>,
    pub(super) names_from_data_files: Vec<(Atom, ExprId, bool)>,
    pub(super) names_resolved_from_listed_folders: Vec<(Atom, Atom, ExprId)>,
    pub(super) options_of_resolves_with_unread_folders: Vec<ExprId>,
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
    let urls_handed = UrlsHanded::default();
    let mut module_require_objects = Vec::new();
    let mut requires_of_other_files = Vec::new();
    let mut paths_given_to_create_require = Vec::new();
    let mut names_of_workers = Vec::new();
    let mut paths_of_changed_files = Vec::new();
    let mut module_relative_reads = Vec::new();
    let mut module_relative_patterns = Vec::new();
    let mut reads_ruled_out = Vec::new();
    let mut patterns_ruled_out = Vec::new();
    let mut caller_relative_reads: Vec<CallerRelativeRead> = Vec::new();
    let mut unknown_path_reads = Vec::new();
    let mut path_listings = Vec::new();
    let mut entered_operands: Vec<ExprId> = Vec::new();
    let mut folders_entered = Vec::new();
    let mut reads_below_working_folder = Vec::new();
    let mut path_queries: Vec<ExprId> = Vec::new();
    let mut reads: Vec<(ExprId, bool)> = Vec::new();
    let mut file_object_paths = Vec::new();
    let mut changed_operands = Vec::new();
    let mut operands_that_may_change = Vec::new();
    let mut walked_lists = Vec::new();
    let mut known_load_names = Vec::new();
    let mut followed_loads = Vec::new();
    let mut has_unknown_load = false;
    let names_of_file = alternatives.written_names.of_same_file();
    let create_texts = || {
        let &ScanInputs {
            fold, file, atoms, ..
        } = inputs;
        let texts = TextsOfFile::new(hir, bound, decisions, fold, file, atoms);
        texts.sharing_names(&names_of_file)
    };
    let mut own_url_arguments = Vec::new();
    let mut texts_of_file = None;
    let mut exported_file_changers: Vec<ExportedFileChanger> = Vec::new();
    let mut keys_stored_in_caches = Vec::new();
    let mut names_resolved_from_listed_folders = Vec::new();
    let mut options_of_resolves_with_unread_folders = Vec::new();
    let mut candidates = Vec::new();
    let mut known_operands: FxHashSet<ExprId> = FxHashSet::default();
    let mut named_paths = Vec::new();
    let mut created_operands = Vec::new();
    let mut paths_created = Vec::new();
    let mut web_assembly_names = Vec::new();
    let mut reading_functions = Vec::new();
    let mut own_folder_arguments = Vec::new();
    for index in 0..hir.exprs.len() {
        let call = ExprId(index as u32);
        if bound.may_name_own_path()
            && !decisions.is_dead_expr(call)
            && bound.parent_of_expr(call) != Parent::None
        {
            collect_candidates(inputs, call, &mut candidates, &mut created_operands);
        }
        let Some(form) = find_call_form(hir, call) else {
            match hir.exprs[index].kind {
                ExprKind::New(_) => {
                    if let Some(name) = find_name_of_worker(inputs, call, &mut alternatives) {
                        names_of_workers.push(name);
                    }
                    if !decisions.is_dead_expr(call) {
                        let read = find_database_read(inputs, call);
                        reads.extend(read.map(|path| (path, false)));
                    }
                }
                ExprKind::Index { .. } => {
                    if let Some(key) = find_key_stored_in_cache(inputs, call, &mut alternatives) {
                        keys_stored_in_caches.push(key);
                    }
                }
                ExprKind::String(name)
                    if inputs.atoms.bytes(name).ends_with(b".wasm")
                        && is_relative_path(inputs.atoms.bytes(name))
                        && !decisions.is_dead_expr(call) =>
                {
                    web_assembly_names.push((call, name));
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
        if let (false, CallForm::Call { callee, .. }) = (is_dead, form)
            && matches!(expr_kind(hir, callee), Some(ExprKind::Super))
        {
            names_of_workers.extend(find_name_of_worker(inputs, call, &mut alternatives));
            continue;
        }
        if let (false, CallForm::Call { callee, args }) = (is_dead, form) {
            let named = find_file_path_operands(inputs, callee, args);
            if let Some(named) = &named {
                reads.extend(named.read.map(|operand| (operand, named.is_query)));
            }
            if let Some((list, is_query)) = find_list_iterated_by_read(inputs, callee, args) {
                let names = &alternatives.written_names;
                let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
                let written = find_elements_of_list_that_nothing_changes(inputs, names, list);
                match written.filter(|&paths| !hir.ids(paths).any(is_spread)) {
                    Some(paths) => reads.extend(hir.ids(paths).map(|path| (path, is_query))),
                    None => walked_lists.push((list, is_query)),
                }
            }
            if bound.may_name_own_path() {
                own_url_arguments.extend(find_own_url_arguments(hir, bound, callee, args));
            }
            if let Some(named) = named {
                known_operands.extend(named.made);
                let is_discarded = matches!(bound.parent_of_expr(call), Parent::Stmt(statement)
                    if matches!(hir[statement].kind, StmtKind::Expr(_)));
                let made = named.made.filter(|_| !is_discarded);
                file_object_paths.extend(made.map(|path| (path, call)));
                let changed = named.changed.iter().map(|it| it.0.operand);
                match named.may_call_another_function {
                    true => operands_that_may_change.extend(changed),
                    false => changed_operands.extend(changed),
                }
                created_operands.extend(named.created);
                known_operands.extend(named.created);
                if let Some(operand) = named.listed {
                    reads.push((operand, false));
                    path_listings.push(operand);
                }
                entered_operands.extend(named.entered);
                for (mut changed, around) in named.changed {
                    let names = alternatives.names_from_data_files.len();
                    changed.path = path_specifier(inputs, changed.operand, &mut alternatives);
                    alternatives.names_from_data_files.truncate(names);
                    if !matches!(
                        changed.path,
                        ImportSpecifier::Constant(_) | ImportSpecifier::OneOf(_)
                    ) && let Some(path) = find_path_below_working_directory(
                        inputs,
                        changed.operand,
                        &mut alternatives,
                    ) {
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
        }
        let text = Text::of(hir, bound, Some(decisions));
        let with_urls_handed = text.with_urls_handed(&urls_handed);
        let found = find_call_site(with_urls_handed, call, form, StepsLeft::ALL);
        let is_url_handed = urls_handed.found_own_file.take()
            && find_call_site(text, call, form, StepsLeft::ALL).is_none();
        let Some(found) = found else {
            continue;
        };
        if is_dead {
            module_require_objects.extend(found.module_require_object);
            continue;
        }
        let in_front = alternatives.lengths();
        let mut site = create_call_site(inputs, &found, &mut alternatives);
        if is_url_handed && !names_json_alone(inputs, &site, &alternatives) {
            alternatives.cut_back_to(in_front);
            continue;
        }
        if !is_ordinary_builtin_call(&site) {
            module_require_objects.extend(found.module_require_object);
            let has_query = matches!(site.specifier, ImportSpecifier::Constant(name)
                if strings::contains_char(inputs.atoms.bytes(name), b'?'));
            let is_found_late = is_load_found_late(hir, bound, decisions, call);
            if has_query && is_found_late {
                site.specifier = ImportSpecifier::Unknown;
                site.is_host_value = false;
            }
            let argument = site.specifier_node;
            if let (true, false, ImportSpecifier::Constant(name)) =
                (is_found_late, is_url_handed, site.specifier)
            {
                alternatives
                    .names_from_data_files
                    .push((name, argument, true));
            }
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
            if let ImportSiteKind::RequireResolve(_) = site.kind {
                match find_folders_listed_for_resolve(inputs, written_names, found.args) {
                    Ok(folders) => {
                        if let ImportSpecifier::Constant(name) = site.specifier {
                            let folders = folders.into_iter();
                            let asked = folders.map(|folder| (name, folder, site.specifier_node));
                            names_resolved_from_listed_folders.extend(asked);
                        }
                    }
                    Err(UnreadFolders) => {
                        options_of_resolves_with_unread_folders.push(hir.id_at(found.args, 1));
                    }
                }
            }
            let loads = matches!(
                site.kind,
                ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
                    | ImportSiteKind::ImportCall(_)
            );
            let is_partly_unknown = matches!(
                site.specifier,
                ImportSpecifier::Unknown | ImportSpecifier::Pattern { .. }
            );
            if loads && is_partly_unknown && !argument.is_none() {
                has_unknown_load = true;
                let texts = texts_of_file.get_or_insert_with(create_texts);
                let names = texts.find_known_load_names(argument);
                known_load_names.extend(names.into_iter().map(|name| (argument, name)));
            } else if loads && alternatives.paths_from_own_directory.last() == Some(&argument) {
                followed_loads.push(argument);
            }
            sites.push(site);
        }
    }
    // Another load may be given the same path.
    for &argument in followed_loads.iter().filter(|_| has_unknown_load) {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        let names = texts.find_known_load_names(argument);
        known_load_names.extend(names.into_iter().map(|name| (argument, name)));
    }
    // A file object that nothing writes is read: its size, a slice of it or a `Response` made of it need the file.
    let is_used = |path: &ExprId| {
        changed_operands.contains(path) || reads.iter().any(|&(operand, _)| operand == *path)
    };
    let mut is_written_alone = |made: ExprId| {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        texts.is_written_alone(made)
    };
    file_object_paths.retain(|it| !is_used(&it.0) && !is_written_alone(it.1));
    reads.extend(file_object_paths.into_iter().map(|it| (it.0, false)));
    let written = changed_operands.iter().chain(&operands_that_may_change);
    for &operand in written.chain(&created_operands) {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        find_paths_created(inputs, texts, operand, &mut paths_created);
    }
    known_operands.extend(reads.iter().map(|it| it.0).chain(changed_operands));
    let mut found_reads = Vec::with_capacity(reads.len());
    let mut unsure: FxHashMap<ExprId, bool> = FxHashMap::default();
    for (operand, is_query) in reads {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        let found = texts.find_module_relative_reads(operand);
        let found_count = found.paths.len() + found.patterns.len();
        let is_known = texts.is_path_fully_known(operand);
        if !is_known {
            unknown_path_reads.push(operand);
        }
        if found_count > 0 || !is_known {
            *unsure.entry(operand).or_default() |= found_count > 0;
        }
        found_reads.push((operand, is_query, found));
    }
    let executed = match unsure.is_empty() {
        true => FxHashMap::default(),
        false => {
            let texts = texts_of_file.get_or_insert_with(create_texts);
            texts.find_executed_reads(unsure)
        }
    };
    for (operand, is_query, mut found) in found_reads {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        if let Some((paths, false)) = executed.get(&operand) {
            let text = |atom: Atom| inputs.atoms.bytes(atom);
            found.paths.extend(paths.iter().copied());
            (found.paths).shared_sort_unstable_by_key(|it| text(*it));
            found.paths.dedup();
        }
        if let Some((paths, true)) = executed.get(&operand) {
            if entered_operands.contains(&operand) {
                folders_entered.extend(found.paths.iter().map(|&path| (operand, path)));
            }
            found.paths.retain(|it| !paths.contains(it));
            let ruled_out = std::mem::replace(&mut found.paths, paths.clone()).into_iter();
            reads_ruled_out.extend(ruled_out.map(|path| (operand, path)));
            let ruled_out = std::mem::take(&mut found.patterns).into_iter();
            patterns_ruled_out.extend(ruled_out.map(|(prefix, suffix)| (operand, prefix, suffix)));
        }
        if entered_operands.contains(&operand) {
            folders_entered.extend(found.paths.iter().map(|&path| (operand, path)));
        }
        module_relative_reads.extend(found.paths.into_iter().map(|path| (operand, path)));
        let below_working_folder = found.below_working_folder.into_iter();
        reads_below_working_folder.extend(below_working_folder.map(|path| (operand, path)));
        let patterns = found.patterns.into_iter();
        module_relative_patterns.extend(patterns.map(|(prefix, suffix)| (operand, prefix, suffix)));
        if is_query {
            path_queries.push(operand);
        }
        let open = found.open_parameters.iter();
        reading_functions.extend(open.filter_map(|&it| texts.find_function_of(it)));
        if let Some(&parameter) = found.open_parameters.first() {
            caller_relative_reads
                .extend(texts.find_caller_relative_reads(operand, parameter, is_query));
        }
    }
    known_operands.extend(sites.iter().map(|it| it.specifier_node));
    known_operands.extend(names_of_workers.iter().map(|it| it.argument));
    for candidate in candidates {
        if !known_operands.contains(&candidate.operand) {
            // What a read at a known path gives is the text of the file, not a path.
            let is_text_read = |&(argument, _): &(ExprId, _)| match expr_kind(hir, argument) {
                Some(ExprKind::Call(call)) => (hir.ids(hir[call].args).next())
                    .is_some_and(|path| known_operands.contains(&path)),
                _ => false,
            };
            own_folder_arguments.extend(candidate.find_argument().filter(|it| !is_text_read(it)));
            let texts = texts_of_file.get_or_insert_with(create_texts);
            find_named_paths(inputs, texts, candidate, &mut named_paths);
        }
    }
    reading_functions.shared_sort_unstable();
    reading_functions.dedup();
    if !reading_functions.is_empty() {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        add_forwarding_functions(inputs, texts, &mut reading_functions);
    }
    for (list, is_query) in walked_lists {
        let texts = texts_of_file.get_or_insert_with(create_texts);
        let paths = texts.find_module_relative_elements(list);
        module_relative_reads.extend(paths.into_iter().map(|path| (list, path)));
        unknown_path_reads.push(list);
        if is_query {
            path_queries.push(list);
        }
    }
    unknown_path_reads.shared_sort_unstable();
    module_require_objects.shared_sort_unstable();
    paths_given_to_create_require.shared_sort_unstable_by_key(|it: &(ExprId, Atom)| it.0);
    paths_given_to_create_require.dedup();
    alternatives.paths_from_own_directory.shared_sort_unstable();
    alternatives.answers_of_resolvers.shared_sort_unstable();
    names_of_workers.shared_sort_unstable_by_key(|it: &WorkerName| it.argument);
    keys_stored_in_caches.shared_sort_unstable_by_key(|it: &(ExprId, ImportSpecifier)| it.0);
    exported_file_changers
        .shared_sort_unstable_by_key(|it| (it.export.0, it.place, it.reaches_below));
    exported_file_changers.dedup();
    let text = |atom: Atom| inputs.atoms.bytes(atom);
    caller_relative_reads.shared_sort_unstable_by_key(|it| {
        let texts = (it.property.map(text), text(it.path));
        (it.function.0, it.place, texts)
    });
    caller_relative_reads.dedup();
    path_queries.shared_sort_unstable();
    path_queries.dedup();
    path_listings.shared_sort_unstable();
    path_listings.dedup();
    known_load_names.sort_by_key(|it| it.0);
    ScannedCalls {
        alternatives: alternatives.found,
        paths_from_own_directory: alternatives.paths_from_own_directory,
        answers_of_resolvers: alternatives.answers_of_resolvers,
        names_of_workers,
        paths_of_changed_files,
        module_relative_reads,
        module_relative_patterns,
        reads_ruled_out,
        patterns_ruled_out,
        caller_relative_reads,
        unknown_path_reads,
        path_queries,
        path_listings,
        folders_entered,
        reads_below_working_folder,
        named_paths,
        paths_created,
        web_assembly_names,
        reading_functions,
        own_folder_arguments,
        known_load_names,
        own_url_arguments,
        exported_file_changers,
        other_file_queries: alternatives.other_file_queries.take(),
        data_file_queries: alternatives.data_file_queries.take(),
        own_path_queries: texts_of_file.map_or_else(Vec::new, |it| it.take_own_path_queries()),
        own_export_queries: alternatives.own_export_queries.take(),
        names_from_data_files: alternatives.names_from_data_files,
        names_resolved_from_listed_folders,
        options_of_resolves_with_unread_folders,
        keys_stored_in_caches,
        module_require_objects,
        requires_of_other_files,
        paths_given_to_create_require,
    }
}

pub fn is_site_of_handed_url(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    call: ExprId,
) -> bool {
    let text = Text::of(hir, bound, Some(decisions));
    find_call_form(hir, call)
        .is_some_and(|form| find_call_site(text, call, form, StepsLeft::ALL).is_none())
}

pub fn is_load_found_late(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    call: ExprId,
) -> bool {
    let Some(form) = find_call_form(hir, call) else {
        return false;
    };
    let text = Text::of(hir, bound, Some(decisions));
    find_call_site(text, call, form, StepsLeft::ALL.without_late()).is_none()
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
        data_file_queries,
        ..
    } = alternatives;
    let texts = find_texts_of_key(inputs, written_names, data_file_queries, key)?;
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

enum Constructor {
    Worker,
    Class(ClassId),
    Other,
}

impl Constructor {
    fn worker_if(is_worker: bool) -> Constructor {
        match is_worker {
            true => Constructor::Worker,
            false => Constructor::Other,
        }
    }
}

fn find_whether_constructor_is_worker(
    hir: &File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
) -> Option<bool> {
    let mut callee = callee;
    let mut met: FxHashSet<ClassId> = FxHashSet::default();
    let is_worker = loop {
        match find_constructor(hir, bound, callee)? {
            Constructor::Worker => break true,
            Constructor::Class(class) if hir[class].extends.is_some() => {
                // A ring of classes constructs nothing.
                if !met.insert(class) {
                    return None;
                }
                callee = find_heritage_constructed(hir, bound, class)?;
            }
            Constructor::Class(_) | Constructor::Other => break false,
        }
    };
    (is_worker || met.is_empty()).then_some(is_worker)
}

fn find_constructor(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> Option<Constructor> {
    let find_constant = |e| match expr_kind(hir, e) {
        Some(ExprKind::String(text)) => Some(Constant::String(text)),
        _ => None,
    };
    let export = find_export_of_module(hir, bound, callee, &find_constant, &is_worker_threads);
    if let Some(export) = export {
        return Some(Constructor::worker_if(export == known::Worker));
    }
    let constructor = follow_settled_bindings(hir, bound, callee);
    if let Some((object, MemberKey::Name(name))) = hir.member_key(constructor) {
        let object = follow_settled_bindings(hir, bound, object);
        let global_objects = [known::globalThis, known::global, known::self_];
        return is_free_name(hir, bound, object, &global_objects)
            .then(|| Constructor::worker_if(name == known::Worker));
    }
    match expr_kind(hir, constructor)? {
        ExprKind::Class(class) => Some(Constructor::Class(class)),
        ExprKind::Fn(_) => Some(Constructor::Other),
        ExprKind::Ident(_) if is_free_name(hir, bound, constructor, &[known::Worker]) => {
            Some(Constructor::Worker)
        }
        ExprKind::Ident(_) if bound.binding(constructor) == Binding::Free => bound
            .dynamic_lookup_scope(NodeData::Expr(constructor))
            .is_none()
            .then_some(Constructor::Other),
        ExprKind::Ident(_) => {
            let symbol = settled_symbol(hir, bound, constructor)?;
            match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Class(class) => Some(Constructor::Class(class)),
                BindingInitializer::Function(_) => Some(Constructor::Other),
                _ => None,
            }
        }
        _ => None,
    }
}

/// `class A extends Worker {}`: what `new A(..)` hands its arguments to. Only a class declared before `class` counts.
pub fn find_heritage_constructed(
    hir: &File<'_>,
    bound: &Bound<'_>,
    class: ClassId,
) -> Option<ExprId> {
    let heritage = hir[class].extends.some()?;
    let mut members = hir[class].members.iter();
    let declares_constructor = members.any(|id| hir[id].kind == MemberKind::Constructor);
    let named = settled_symbol(hir, bound, hir.skip_type_assertions(heritage));
    let is_later = named.is_some_and(|symbol| match bound.binding_initializer(hir, symbol) {
        BindingInitializer::Class(extended) => hir[extended].text_start >= hir[class].text_start,
        _ => false,
    });
    (!declares_constructor && !is_later).then_some(heritage)
}

/// `super(..)`: the heritage of the class whose constructor holds the call.
pub fn find_heritage_of_super_call(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> Option<ExprId> {
    let ExprKind::Call(written) = expr_kind(hir, call)? else {
        return None;
    };
    if !matches!(expr_kind(hir, hir[written].callee), Some(ExprKind::Super)) {
        return None;
    }
    let mut statement = bound.statement_of_expr(call)?;
    let function = loop {
        match bound.parent_of_stmt(statement) {
            Parent::Stmt(above) => statement = above,
            Parent::FnBody(function) => break function,
            _ => return None,
        }
    };
    let FnOwner::Member(member) = bound.fns[function.idx()].owner else {
        return None;
    };
    match bound.member_owner[member.idx()] {
        MemberOwner::Class(class) => hir[class].extends.some(),
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
) -> Option<WorkerName> {
    let &ScanInputs {
        hir,
        bound,
        decisions,
        ..
    } = inputs;
    let (call, constructor) = match expr_kind(hir, construction)? {
        ExprKind::New(call) => (call, hir[call].callee),
        ExprKind::Call(call) => (call, find_heritage_of_super_call(hir, bound, construction)?),
        _ => return None,
    };
    let is_evaluated =
        bound.parent_of_expr(construction) != Parent::None && !decisions.is_dead_expr(construction);
    if !is_evaluated || !may_construct_worker(hir, bound, constructor) {
        return None;
    }
    let argument = hir.ids(hir[call].args).next()?;
    let mut specifier = call_specifier(inputs, argument, alternatives);
    let is_on_trust = specifier == ImportSpecifier::Unknown;
    if is_on_trust {
        specifier = find_known_worker_names(inputs, argument, alternatives);
    }
    if let ImportSpecifier::OneOf(Alternatives { first, count }) = specifier
        && find_url_name(hir, argument)
            .is_some_and(|name| writes_url_path(inputs, &alternatives.written_names, name))
    {
        let known = &alternatives.found[first as usize..][..count as usize];
        let found = [known, &[ImportSpecifier::Unknown]].concat();
        let first = alternatives.found.len() as u32;
        let count = found.len() as u32;
        alternatives.found.extend(found);
        specifier = ImportSpecifier::OneOf(Alternatives { first, count });
    }
    let is_known_in_part = matches!(
        specifier,
        ImportSpecifier::Pattern { .. } | ImportSpecifier::OneOf(_)
    );
    is_known_in_part.then_some(WorkerName {
        argument,
        name: specifier,
        is_on_trust,
    })
}

/// `url`, `url.href`, `fileURLToPath(url)`: the name of the URL.
fn find_url_name(hir: &File<'_>, argument: ExprId) -> Option<ExprId> {
    let mut e = argument;
    loop {
        e = hir.skip_type_assertions(e);
        e = match expr_kind(hir, e)? {
            ExprKind::Ident(_) => return Some(e),
            ExprKind::Dot { obj, .. } => obj,
            ExprKind::Call(call) if hir[call].args.len() == 1 => hir.id_at(hir[call].args, 0),
            _ => return None,
        };
    }
}

fn find_known_worker_names(
    inputs: &ScanInputs<'_, '_>,
    argument: ExprId,
    alternatives: &mut FoundAlternatives,
) -> ImportSpecifier {
    let find = |unknown_values| {
        find_worker_names(
            inputs,
            &alternatives.written_names,
            &alternatives.data_file_queries,
            argument,
            unknown_values,
            &alternatives.findings,
        )
    };
    let unknown = ImportSpecifier::Unknown;
    let whole = find(UnknownValues::Reject);
    let is_whole = whole.is_some() && !inputs.bound.writes_import_meta_path();
    let Some(mut found) = whole.or_else(|| find(UnknownValues::Skip)) else {
        return unknown;
    };
    if !is_whole {
        found.alternatives.push(unknown);
    }
    found.is_from_data_file = false;
    record_alternatives(inputs, argument, unknown, &found, alternatives)
}

fn is_ordinary_builtin_call(site: &ImportSite) -> bool {
    matches!(site.kind, ImportSiteKind::GetBuiltinModule(_))
        && !matches!(site.specifier, ImportSpecifier::Constant(_))
}

fn names_json_alone(
    inputs: &ScanInputs<'_, '_>,
    site: &ImportSite,
    alternatives: &FoundAlternatives,
) -> bool {
    let is_json = |name: Atom| {
        let name = inputs.atoms.bytes(name);
        (name.starts_with(b"./") || name.starts_with(b"../")) && name.ends_with(b".json")
    };
    match site.specifier {
        ImportSpecifier::Constant(name) => is_json(name),
        ImportSpecifier::OneOf(Alternatives { first, count }) => {
            let mut found = alternatives.found[first as usize..][..count as usize].iter();
            found.all(|it| matches!(*it, ImportSpecifier::Constant(name) if is_json(name)))
        }
        ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => false,
    }
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
    findings: FindingsOfFile,
    data_file_queries: AskedOfDataFiles,
    other_file_queries: AskedOfDataFiles,
    own_export_queries: AskedOfOwnExports,
    names_from_data_files: Vec<(Atom, ExprId, bool)>,
}

impl FoundAlternatives {
    fn lengths(&self) -> [usize; 4] {
        [
            self.found.len(),
            self.paths_from_own_directory.len(),
            self.answers_of_resolvers.len(),
            self.names_from_data_files.len(),
        ]
    }

    fn cut_back_to(&mut self, lengths: [usize; 4]) {
        self.found.truncate(lengths[0]);
        self.paths_from_own_directory.truncate(lengths[1]);
        self.answers_of_resolvers.truncate(lengths[2]);
        self.names_from_data_files.truncate(lengths[3]);
    }
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
        &alternatives.data_file_queries,
        argument,
        Folder::OfFile,
        reads_other_files.then_some(&alternatives.other_file_queries),
        Some(&alternatives.own_export_queries),
        Some(&alternatives.findings),
    );
    let is_followed = found.as_ref().is_some_and(|found| {
        let mut names = found.alternatives.iter();
        found.is_from_data_file || names.all(|it| matches!(it, ImportSpecifier::Constant(_)))
    });
    if !is_followed {
        let written = find_names_as_written(inputs, &alternatives.written_names, argument);
        let written = written.into_iter().map(|name| (name, argument, true));
        alternatives.names_from_data_files.extend(written);
    }
    let Some(found) = found else {
        return folded;
    };
    record_alternatives(inputs, argument, folded, &found, alternatives)
}

fn record_alternatives(
    inputs: &ScanInputs<'_, '_>,
    argument: ExprId,
    folded: ImportSpecifier,
    found: &Found,
    alternatives: &mut FoundAlternatives,
) -> ImportSpecifier {
    if found.is_from_data_file {
        let names = found.alternatives.iter().filter_map(|it| match *it {
            ImportSpecifier::Constant(name) => Some((name, argument, false)),
            _ => None,
        });
        alternatives.names_from_data_files.extend(names);
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

/// Returns true if the declaration of `symbol` always runs before `e` is evaluated.
/// The declaration must be an earlier statement of a file, function body or block that also contains `e`, with no function boundary between them.
/// A `switch` and the branches of an `if` don't qualify: control can reach a later statement without running the earlier one.
fn is_declared_before(hir: &File<'_>, bound: &Bound<'_>, e: ExprId, symbol: SymbolId) -> bool {
    let &[Decl::Var(pattern)] = bound.symbol(symbol).decls else {
        return false;
    };
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return false;
    };
    if !matches!(
        hir[declaration].kind,
        VarKind::Var | VarKind::Let | VarKind::Const
    ) {
        return false;
    }
    let declaration = bound.var_stmt[declaration.idx()];
    let statement_list = bound.parent_of_stmt(declaration);
    let is_sequential = match statement_list {
        Parent::File | Parent::FnBody(_) => true,
        Parent::Stmt(owner) => matches!(hir[owner].kind, StmtKind::Block(_)),
        _ => false,
    };
    if !is_sequential {
        return false;
    }
    let Some(mut statement) = bound.statement_of_expr(e) else {
        return false;
    };
    loop {
        let above = bound.parent_of_stmt(statement);
        if above == statement_list {
            return hir[declaration].start < hir[statement].start;
        }
        let Parent::Stmt(above) = above else {
            return false;
        };
        statement = above;
    }
}

/// Follows `e` through variables that are never reassigned and are initialized before their use, and returns the last initializer.
/// `use_site` is `e`, or the object literal that contains it.
pub(super) fn follow_initialized_bindings(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
    mut use_site: ExprId,
) -> ExprId {
    let mut e = hir.skip_type_assertions(e);
    while let Some(symbol) = settled_symbol(hir, bound, e)
        && is_declared_before(hir, bound, use_site, symbol)
        && let BindingInitializer::Expression(source) = bound.binding_initializer(hir, symbol)
    {
        e = hir.skip_type_assertions(source);
        use_site = source;
    }
    e
}

fn find_own_url_arguments(
    hir: &File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> Vec<OwnUrlArgument> {
    let callee = hir.skip_type_assertions(callee);
    let is_own_url = |e: ExprId, use_site: ExprId| {
        let initializer = follow_initialized_bindings(hir, bound, e, use_site);
        names_own_url(hir, bound, initializer)
    };
    let is_spread = |e: &ExprId| matches!(expr_kind(hir, *e), Some(ExprKind::Spread(_)) | None);
    let mut spelled: Vec<(u32, Option<Atom>, ExprId)> = Vec::new();
    for (place, argument) in (0..).zip(hir.ids(args).take_while(|it| !is_spread(it))) {
        if is_own_url(argument, argument) {
            spelled.push((place, None, argument));
            continue;
        }
        let properties = match expr_kind(hir, hir.skip_type_assertions(argument)) {
            Some(ExprKind::Object(properties)) => properties,
            _ => continue,
        };
        let mut values = properties.iter().map(|id| hir[id].value);
        if !values.any(|value| is_own_url(value, argument)) {
            continue;
        }
        let has_accessor_or_method = properties.iter().map(|id| &hir[id]).any(|property| {
            matches!(
                property.kind,
                PropKind::Method | PropKind::Getter | PropKind::Setter
            ) || property.key == PropKey::Name(known::__proto__)
        });
        if has_accessor_or_method {
            continue;
        }
        let mut later_keys: FxHashSet<Atom> = FxHashSet::default();
        for property in properties.iter().rev().map(|id| &hir[id]) {
            let (PropKey::Name(name), false) = (property.key, property.kind == PropKind::Spread)
            else {
                break;
            };
            let is_last_writer = later_keys.insert(name);
            let is_data_property = matches!(property.kind, PropKind::Init | PropKind::Shorthand);
            if is_last_writer && is_data_property && is_own_url(property.value, argument) {
                spelled.push((place, Some(name), property.value));
            }
        }
    }
    let function = match (expr_kind(hir, callee), bound.binding(callee)) {
        (Some(ExprKind::Ident(_)), Binding::Symbol(function)) => function,
        _ => return Vec::new(),
    };
    let handed = spelled.into_iter();
    let handed = handed.map(|(place, property, argument)| OwnUrlArgument {
        argument,
        function,
        place,
        property,
    });
    handed.collect()
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
    let exported = written_names.exported_names(hir, bound);
    let exports = find_names_exported_for(hir, bound, exported, function, &find_written);
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
    let of_other_files = Some(&alternatives.other_file_queries);
    let folder = Folder::WorkingDirectory;
    let found = find_alternatives(
        inputs,
        written_names,
        &asked,
        path,
        folder,
        of_other_files,
        None,
        None,
    )?;
    if !found.start_at_own_directory || found.is_from_data_file {
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
