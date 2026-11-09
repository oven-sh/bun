use super::call_sites::{
    expr_kind, find_module_printed_as_require, find_request_of_exports, is_free_common_js,
    is_free_name,
};
use super::touched_exports::is_only_tested;
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CodeUnit, CommonJsVariable,
    Decl, FnOwner, InitialState, Parent, PatParent, StoreKind, SymbolId, SymbolStore,
    has_mapped_arguments,
};
use crate::fold::{Decisions, outermost_cast};
use crate::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, FnKind, IdList,
    ImportedRequire, MemberKey, NodeData, OtherValues, PatKind, StmtKind, UnOp,
};
use crate::util::{FxHashMap, FxHashSet, SharedSort};
use smallvec::SmallVec;
use std::cell::Cell;

fn is_node_module(specifier: Atom) -> bool {
    specifier == known::module || specifier == known::node_module
}

pub(crate) fn settled_symbol(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<SymbolId> {
    let Some(ExprKind::Ident(_)) = expr_kind(hir, e) else {
        return None;
    };
    let Binding::Symbol(symbol) = bound.binding(e) else {
        return None;
    };
    if bound.dynamic_lookup_scope(NodeData::Expr(e)).is_some() {
        return None;
    }
    match bound.binding_stability(symbol) {
        BindingStability::Stable | BindingStability::Linked => Some(symbol),
        _ => None,
    }
}

pub(crate) fn find_imported_export(
    hir: &File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<(Atom, Option<Atom>)> {
    let mut declarations = bound.symbol(symbol).decls.iter();
    let imported = declarations.find_map(|&declaration| match declaration {
        Decl::ImportDefault(import) | Decl::ImportNamespace(import) => {
            (!hir[import].type_only).then_some((hir[import].spec, None))
        }
        Decl::ImportSpec(spec) => {
            let spec = &hir[spec];
            let import = &hir[spec.import];
            let export = (spec.imported != known::default).then_some(spec.imported);
            (!spec.type_only && !import.type_only).then_some((import.spec, export))
        }
        Decl::ImportEquals(import) => {
            let import = &hir[import];
            (!import.flags.contains(Flags::TYPE_ONLY)).then_some((import.target.spec(), None))
        }
        _ => None,
    });
    imported.filter(|(specifier, _)| !specifier.is_none())
}

fn is_import_meta_require(hir: &File<'_>, e: ExprId) -> bool {
    matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if name == known::require
            && matches!(expr_kind(hir, hir.skip_type_assertions(object)), Some(ExprKind::ImportMeta)))
}

#[derive(Copy, Clone)]
pub(super) struct StepsLeft {
    parameters: usize,
    requests: usize,
    bindings: usize,
    pub(super) passes_get_builtin_module: bool,
    passes_choices: bool,
    passes_and: bool,
    passes_late: bool,
}

impl StepsLeft {
    pub(super) const ALL: StepsLeft = StepsLeft {
        parameters: LONGEST_CHAIN_OF_PARAMETERS,
        requests: LONGEST_CHAIN_OF_REQUESTS,
        bindings: LONGEST_CHAIN_OF_BINDINGS,
        passes_get_builtin_module: true,
        passes_choices: true,
        passes_and: true,
        passes_late: true,
    };

    fn proofs_alone(self) -> StepsLeft {
        StepsLeft {
            passes_choices: false,
            passes_and: false,
            ..self
        }
    }

    fn most_other_values(self) -> OtherValues {
        match (self.passes_choices, self.passes_and) {
            (true, _) => OtherValues::Any,
            (false, true) => OtherValues::Falsy,
            (false, false) => OtherValues::None,
        }
    }
    pub(super) fn without_late(self) -> StepsLeft {
        StepsLeft {
            passes_late: false,
            ..self
        }
    }

    pub(super) fn without_choices(self) -> StepsLeft {
        StepsLeft {
            passes_choices: false,
            ..self
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ModuleFace {
    Namespace,
    Exports,
}

#[derive(Copy, Clone)]
pub(super) struct Text<'a, 'h, 'b, 'd> {
    pub(super) hir: &'a File<'h>,
    pub(super) bound: &'a Bound<'b>,
    pub(super) decisions: Option<&'a Decisions<'d>>,
}

impl<'a, 'h, 'b, 'd> Text<'a, 'h, 'b, 'd> {
    #[inline]
    pub(super) fn of(
        hir: &'a File<'h>,
        bound: &'a Bound<'b>,
        decisions: Option<&'a Decisions<'d>>,
    ) -> Self {
        Text {
            hir,
            bound,
            decisions,
        }
    }

    fn find_requested_module(self, e: ExprId, left: StepsLeft) -> Option<(Atom, ModuleFace)> {
        let hir = self.hir;
        let (argument, face) = match expr_kind(hir, e)? {
            ExprKind::Await(promise) => match expr_kind(hir, hir.skip_type_assertions(promise))? {
                ExprKind::ImportCall { args } => (hir.ids(args).next(), ModuleFace::Namespace),
                _ => return None,
            },
            ExprKind::Call(_) => {
                let requests = left.requests.checked_sub(1)?;
                let text = Text::of(hir, self.bound, None);
                let argument = find_request_of_exports(text, e, StepsLeft { requests, ..left });
                (argument, ModuleFace::Exports)
            }
            _ => return None,
        };
        match expr_kind(hir, argument?)? {
            ExprKind::String(specifier) => Some((specifier, face)),
            _ => None,
        }
    }

    fn find_names_read_off_module(
        self,
        e: ExprId,
        left: StepsLeft,
    ) -> Option<(Atom, ModuleFace, SmallVec<[Atom; 4]>)> {
        let Text { hir, bound, .. } = self;
        let mut names = SmallVec::new();
        let mut e = e;
        for _ in 0..=LONGEST_CHAIN_OF_BINDINGS {
            e = hir.skip_type_assertions(e);
            while let Some((object, key)) = hir.member_key(e) {
                let MemberKey::Name(name) = key else {
                    return None;
                };
                names.push(name);
                e = hir.skip_type_assertions(object);
            }
            if let Some(returned) = iife_return_value(hir, e) {
                e = returned;
                continue;
            }
            let Some(symbol) = settled_symbol(hir, bound, e) else {
                let (specifier, face) = self.find_requested_module(e, left)?;
                return Some((specifier, face, names));
            };
            match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Import => {
                    let (specifier, export) = find_imported_export(hir, bound, symbol)?;
                    names.extend(export);
                    let declarations = bound.symbol(symbol).decls;
                    let is_namespace = |it: &Decl| matches!(it, Decl::ImportNamespace(_));
                    let face = match export.is_some() || declarations.iter().any(is_namespace) {
                        true => ModuleFace::Namespace,
                        false => ModuleFace::Exports,
                    };
                    return Some((specifier, face, names));
                }
                BindingInitializer::Expression(source) => e = source,
                BindingInitializer::PatternProperty { source, path } => {
                    names.extend(path.iter().rev().copied());
                    e = source;
                }
                _ => return None,
            }
        }
        None
    }

    fn find_export_read_off_module(
        self,
        e: ExprId,
        left: StepsLeft,
        modules: [Atom; 2],
    ) -> Option<Atom> {
        let (specifier, face, names) = self.find_names_read_off_module(e, left)?;
        let (&export, before) = names.split_first()?;
        let is_export = match *before {
            [] => true,
            [first] => face == ModuleFace::Namespace && first == known::default,
            _ => false,
        };
        (is_export && modules.contains(&specifier)).then_some(export)
    }

    fn is_create_require(self, e: ExprId, left: StepsLeft) -> bool {
        let Some((specifier, face, names)) = self.find_names_read_off_module(e, left) else {
            return false;
        };
        let Some((&last, before)) = names.split_first() else {
            return false;
        };
        let before = match before.split_last() {
            Some((&first, later)) if face == ModuleFace::Namespace && first == known::default => {
                later
            }
            _ => before,
        };
        is_node_module(specifier)
            && last == known::createRequire
            && before.iter().all(|&name| name == known::Module)
    }
}

pub fn may_be_modified(hir: &File<'_>, bound: &Bound<'_>, variable: CommonJsVariable) -> bool {
    let variable = Binding::CommonJs(variable);
    let mut stores = bound.runtime.unbound_name_stores().iter();
    stores.any(|&(target, _)| bound.binding(target) == variable)
        || !bound.runtime.eval_scopes().is_empty()
        || bound.file_uses_arguments() && has_mapped_arguments(hir, CodeUnit::File)
}

fn is_exported(bound: &Bound<'_>, holder: SymbolId) -> bool {
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    exports.iter().any(|&(_, symbol)| {
        let mut declarations = bound.symbol(symbol).decls.iter();
        declarations.any(|&declaration| match declaration {
            Decl::ExportSpec(specifier) => {
                bound.exported_binding(specifier) == Binding::Symbol(holder)
            }
            Decl::Var(_) => bound.declared_symbol(declaration) == holder,
            _ => false,
        })
    })
}

fn is_only_called_or_read(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: ExprId,
    bindings_left: usize,
) -> bool {
    let outermost_cast = |mut e: ExprId| {
        while let Parent::Expr(parent) = bound.parent_of_expr(e)
            && hir.type_assertion_operand(parent).is_some()
        {
            e = parent;
        }
        e
    };
    let function = outermost_cast(function);
    let user = match bound.parent_of_expr(function) {
        Parent::Expr(user) => user,
        Parent::VarInit(declaration) if bindings_left > 0 => {
            let pattern = hir[declaration].pat;
            let holder = bound.declared_symbol(Decl::Var(pattern));
            return matches!(hir[pattern].kind, PatKind::Ident(_))
                && bound.binding_stability(holder) == BindingStability::Stable
                && !is_exported(bound, holder)
                && (0..hir.exprs.len() as u32).map(ExprId).all(|e| {
                    !bound.is_evaluated_ident(e)
                        || bound.binding(e) != Binding::Symbol(holder)
                        || is_only_called_or_read(hir, bound, e, bindings_left - 1)
                });
        }
        _ => return false,
    };
    match expr_kind(hir, user) {
        Some(ExprKind::Call(call)) => hir[call].callee == function,
        Some(ExprKind::Unary {
            op: UnOp::Typeof, ..
        }) => true,
        Some(ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) if obj == function => {
            let member = outermost_cast(user);
            let is_deleted = matches!(bound.parent_of_expr(member), Parent::Expr(above)
                if matches!(expr_kind(hir, above), Some(ExprKind::Unary { op: UnOp::Delete, .. })));
            !is_deleted && bound.get_assignment_target(hir, member).is_none()
        }
        _ => false,
    }
}

pub fn may_require_get_members(hir: &File<'_>, bound: &Bound<'_>) -> bool {
    bound.may_require_get_members(|| compute_may_require_get_members(hir, bound))
}

fn compute_may_require_get_members(hir: &File<'_>, bound: &Bound<'_>) -> bool {
    let own_require = Binding::CommonJs(CommonJsVariable::Require);
    let mut names = bound.ident_bindings().iter();
    bound.import_meta_may_be_modified()
        || !bound.runtime.eval_scopes().is_empty()
        || names.any(|&(name, binding)| {
            binding == own_require
                && !is_only_called_or_read(hir, bound, name, LONGEST_CHAIN_OF_BINDINGS)
        })
        || (0..hir.exprs.len() as u32).map(ExprId).any(|e| {
            is_import_meta_require(hir, e)
                && !is_only_called_or_read(hir, bound, e, LONGEST_CHAIN_OF_BINDINGS)
        })
}

pub(crate) fn names_own_file(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let text = Text::of(hir, bound, None);
    names_own_file_behind(text, e, LONGEST_CHAIN_OF_BINDINGS, StepsLeft::ALL)
}

fn names_own_file_behind(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    conversions_left: usize,
    left: StepsLeft,
) -> bool {
    settled_chain(text.hir, text.bound, e)
        .any(|e| is_written_as_own_file(text, e, conversions_left, left))
}

fn is_written_as_own_file(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    conversions_left: usize,
    left: StepsLeft,
) -> bool {
    let Text { hir, bound, .. } = text;
    if is_free_common_js(hir, bound, e, CommonJsVariable::Filename) {
        return !may_be_modified(hir, bound, CommonJsVariable::Filename);
    }
    let is_import_meta_member = matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if (name == known::url || name == known::meta_filename || name == known::path)
            && matches!(expr_kind(hir, hir.skip_type_assertions(object)), Some(ExprKind::ImportMeta)));
    if is_import_meta_member {
        return !bound.import_meta_may_be_modified();
    }
    let Some(conversions_left) = conversions_left.checked_sub(1) else {
        return false;
    };
    if let Some((url, MemberKey::Name(known::href))) = hir.member_key(e) {
        return settled_chain(hir, bound, url).any(|url| {
            let makes_url = match expr_kind(hir, url) {
                Some(ExprKind::New(_)) => true,
                Some(ExprKind::Call(call)) => {
                    let export =
                        text.find_export_read_off_module(hir[call].callee, left, URL_MODULES);
                    export == Some(known::pathToFileURL)
                }
                _ => false,
            };
            makes_url && is_written_as_own_file(text, url, conversions_left, left)
        });
    }
    if let Some(ExprKind::Binary {
        op: BinOp::Add,
        left: scheme,
        right: path,
    }) = expr_kind(hir, e)
    {
        return matches!(expr_kind(hir, hir.skip_type_assertions(scheme)), Some(ExprKind::String(scheme))
            if scheme == known::file_scheme || scheme == known::file_scheme_and_slashes)
            && settled_chain(hir, bound, path)
                .any(|path| is_path_of_own_file(text, path, conversions_left, left));
    }
    let is_path = |path| is_path_of_own_file(text, path, conversions_left, left);
    let (call, is_conversion) = match expr_kind(hir, e) {
        Some(ExprKind::Call(call)) => {
            let call = hir[call];
            let export = text.find_export_read_off_module(call.callee, left, URL_MODULES);
            if export == Some(known::pathToFileURL) {
                return call.args.len() == 1
                    && settled_chain(hir, bound, hir.id_at(call.args, 0)).any(is_path);
            }
            (call, export == Some(known::fileURLToPath))
        }
        Some(ExprKind::New(call)) => {
            let callee = hir.skip_type_assertions(hir[call].callee);
            (hir[call], is_free_name(hir, bound, callee, &[known::URL]))
        }
        _ => return false,
    };
    is_conversion
        && call.args.len() == 1
        && names_own_file_behind(text, hir.id_at(call.args, 0), conversions_left, left)
}

fn is_path_of_own_file(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    conversions_left: usize,
    left: StepsLeft,
) -> bool {
    let hir = text.hir;
    let is_url = matches!(hir.member_key(e), Some((_, MemberKey::Name(name)))
        if name == known::url || name == known::href);
    let is_path = match expr_kind(hir, e) {
        Some(ExprKind::Call(call)) => {
            let export = text.find_export_read_off_module(hir[call].callee, left, URL_MODULES);
            export == Some(known::fileURLToPath)
        }
        Some(ExprKind::New(_) | ExprKind::Binary { .. }) => false,
        _ => !is_url,
    };
    is_path && is_written_as_own_file(text, e, conversions_left, left)
}

const URL_MODULES: [Atom; 2] = [known::url, known::node_url];
const PATH_MODULES: [Atom; 2] = [known::path, known::node_path];

fn names_own_folder(text: Text<'_, '_, '_, '_>, e: ExprId, left: StepsLeft) -> bool {
    let Text { hir, bound, .. } = text;
    if is_free_common_js(hir, bound, e, CommonJsVariable::Dirname) {
        return !may_be_modified(hir, bound, CommonJsVariable::Dirname);
    }
    if let Some(ExprKind::Call(call)) = expr_kind(hir, e) {
        let call = hir[call];
        let export = text.find_export_read_off_module(call.callee, left, PATH_MODULES);
        let file = hir.ids(call.args).next();
        return call.args.len() == 1
            && export == Some(known::meta_dirname)
            && file.is_some_and(|file| {
                names_own_file_behind(text, file, LONGEST_CHAIN_OF_BINDINGS, left)
            });
    }
    matches!(expr_kind(hir, e), Some(ExprKind::Dot { obj, name, chain: Chain::No, .. })
        if (name == known::meta_dir || name == known::meta_dirname)
            && matches!(expr_kind(hir, hir.skip_type_assertions(obj)), Some(ExprKind::ImportMeta)))
        && !bound.import_meta_may_be_modified()
}

fn starts_at_own_folder(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    parts_left: usize,
    left: StepsLeft,
) -> bool {
    let Text { hir, bound, .. } = text;
    let Some(parts_left) = parts_left.checked_sub(1) else {
        return false;
    };
    settled_chain(hir, bound, e).any(|e| {
        let first = match expr_kind(hir, e) {
            Some(ExprKind::Binary {
                op: BinOp::Add,
                left: first,
                ..
            }) => Some(first),
            Some(ExprKind::Template { exprs }) => hir.ids(exprs).next(),
            Some(ExprKind::Call(call)) => {
                let callee = hir[call].callee;
                let export = text.find_export_read_off_module(callee, left, PATH_MODULES);
                let joins = export == Some(known::join) || export == Some(known::resolve);
                let is_path_of_url = hir[call].args.len() == 1
                    && text.find_export_read_off_module(callee, left, URL_MODULES)
                        == Some(known::fileURLToPath);
                hir.ids(hir[call].args)
                    .next()
                    .filter(|_| joins || is_path_of_url)
            }
            _ => None,
        };
        let is_url_from_own_file = matches!(expr_kind(hir, e), Some(ExprKind::New(call))
            if hir[call].args.len() == 2
                && is_free_name(hir, bound, hir.skip_type_assertions(hir[call].callee), &[known::URL])
                && names_own_file_behind(text, hir.id_at(hir[call].args, 1), parts_left, left));
        names_own_folder(text, e, left)
            || is_url_from_own_file
            || first.is_some_and(|first| starts_at_own_folder(text, first, parts_left, left))
    })
}

fn find_arguments_of_create_require(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    left: StepsLeft,
) -> Option<IdList<ExprId>> {
    let hir = text.hir;
    let Some(ExprKind::Call(call)) = expr_kind(hir, hir.skip_type_assertions(e)) else {
        return None;
    };
    let skip_discarded = |mut e: ExprId| {
        while let Some(ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        }) = expr_kind(hir, hir.skip_type_assertions(e))
        {
            e = right;
        }
        hir.skip_type_assertions(e)
    };
    let Call { callee, args, .. } = hir[call];
    let callee = skip_discarded(callee);
    if text.is_create_require(callee, left) {
        return Some(args);
    }
    let Some((function, MemberKey::Name(known::call))) = hir.member_key(callee) else {
        return None;
    };
    let receiver = hir.ids(args).next()?;
    let is_call = !matches!(expr_kind(hir, receiver), None | Some(ExprKind::Spread(_)))
        && text.is_create_require(skip_discarded(function), left);
    is_call.then(|| IdList::new(args.start + 1, args.len - 1))
}

fn find_made_require(text: Text<'_, '_, '_, '_>, e: ExprId, left: StepsLeft) -> Option<OwnRequire> {
    let arguments = find_arguments_of_create_require(text, e, left)?;
    let base = text.hir.ids(arguments).next()?;
    if names_own_file_behind(text, base, LONGEST_CHAIN_OF_BINDINGS, left) {
        Some(OwnRequire::Made)
    } else if starts_at_own_folder(text, base, LONGEST_CHAIN_OF_BINDINGS, left) {
        Some(OwnRequire::MadeForPath(base))
    } else {
        None
    }
}

fn find_require_made_for_choice(
    text: Text<'_, '_, '_, '_>,
    call: ExprId,
    holder: Option<SymbolId>,
    left: StepsLeft,
) -> Option<OwnRequire> {
    let holder = holder.filter(|_| left.passes_choices)?;
    let arguments = find_arguments_of_create_require(text, call, left)?;
    let base = text.hir.ids(arguments).next()?;
    may_name_own_file(text, base, LONGEST_CHAIN_OF_BINDINGS, left)
        .then_some(OwnRequire::MadeForChoice(holder))
}

fn may_name_own_file(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    steps_left: usize,
    left: StepsLeft,
) -> bool {
    let Text { hir, bound, .. } = text;
    let Some(steps_left) = steps_left.checked_sub(1) else {
        return false;
    };
    settled_chain(hir, bound, e).any(|e| {
        if is_written_as_own_file(text, e, LONGEST_CHAIN_OF_BINDINGS, left) {
            return true;
        }
        let only_argument = |call: Call| (call.args.len() == 1).then(|| hir.id_at(call.args, 0));
        let parts: [Option<ExprId>; 2] = match expr_kind(hir, e) {
            Some(ExprKind::Cond { branches, .. }) => {
                let Branches { yes, no } = hir.branches(branches);
                [Some(yes), Some(no)]
            }
            Some(ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish | BinOp::And | BinOp::Comma | BinOp::Add,
                left: first,
                right: second,
            }) => [Some(first), Some(second)],
            Some(ExprKind::Template { exprs }) => [hir.ids(exprs).next(), None],
            Some(ExprKind::Dot { obj, name, .. }) if name == known::href => [Some(obj), None],
            Some(ExprKind::New(call)) => [only_argument(hir[call]), None],
            Some(ExprKind::Call(call)) => {
                let callee = follow_settled_bindings(hir, bound, hir[call].callee);
                [
                    only_argument(hir[call]),
                    return_value_of(hir, hir[call], callee),
                ]
            }
            _ => [None, None],
        };
        let mut parts = parts.into_iter().flatten();
        parts.any(|part| may_name_own_file(text, part, steps_left, left))
    })
}

pub fn is_call_of_create_require(hir: &File<'_>, bound: &Bound<'_>, call: ExprId) -> bool {
    find_arguments_of_create_require(Text::of(hir, bound, None), call, StepsLeft::ALL).is_some()
}

pub fn is_create_require_called_through_call(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> bool {
    let Some(ExprKind::Call(written)) = expr_kind(hir, hir.skip_type_assertions(call)) else {
        return false;
    };
    find_arguments_of_create_require(Text::of(hir, bound, None), call, StepsLeft::ALL)
        .is_some_and(|given| given.len != hir[written].args.len)
}

pub fn find_base_that_a_call_made_of_own_file(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> Option<usize> {
    let text = Text::of(hir, bound, None);
    let ExprKind::Call(written) = expr_kind(hir, call)? else {
        return None;
    };
    let given = find_arguments_of_create_require(text, call, StepsLeft::ALL)?;
    let base = hir.ids(given).next()?;
    let names_own_file =
        |conversions_left| names_own_file_behind(text, base, conversions_left, StepsLeft::ALL);
    (names_own_file(LONGEST_CHAIN_OF_BINDINGS) && !names_own_file(0))
        .then(|| (given.start - hir[written].args.start) as usize)
}

pub fn may_call_have_made_base_of_require(hir: &File<'_>, bound: &Bound<'_>, made: ExprId) -> bool {
    let chain = settled_chain(hir, bound, made).take(LONGEST_CHAIN_OF_BINDINGS);
    chain.last().is_none_or(|call| {
        !is_call_of_create_require(hir, bound, call)
            || find_base_that_a_call_made_of_own_file(hir, bound, call).is_some()
    })
}

pub fn may_call_have_made_path(hir: &File<'_>, bound: &Bound<'_>, path: ExprId) -> bool {
    !is_written_out_of_texts(Text::of(hir, bound, None), path, LONGEST_CHAIN_OF_BINDINGS)
}

fn is_written_out_of_texts(text: Text<'_, '_, '_, '_>, e: ExprId, parts_left: usize) -> bool {
    let Text { hir, bound, .. } = text;
    let Some(parts_left) = parts_left.checked_sub(1) else {
        return false;
    };
    let is_text = |part: ExprId| is_written_out_of_texts(text, part, parts_left);
    let e = follow_settled_bindings(hir, bound, e);
    match expr_kind(hir, e) {
        Some(ExprKind::String(_)) => true,
        Some(ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        }) => is_text(left) && is_text(right),
        Some(ExprKind::Template { exprs }) => hir.ids(exprs).all(is_text),
        Some(ExprKind::Call(_)) => false,
        _ => names_own_folder(text, e, StepsLeft::ALL),
    }
}

pub fn find_holder_of_require_made_for_choice(
    hir: &File<'_>,
    bound: &Bound<'_>,
    call: ExprId,
) -> Option<(SymbolId, usize)> {
    let mut initializer = call;
    while let Parent::Expr(parent) = bound.parent_of_expr(initializer)
        && hir.type_assertion_operand(parent).is_some()
    {
        initializer = parent;
    }
    let Parent::VarInit(declaration) = bound.parent_of_expr(initializer) else {
        return None;
    };
    let pattern = hir[declaration].pat;
    if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
        return None;
    }
    let holder = bound.declared_symbol(Decl::Var(pattern));
    if bound.binding_stability(holder) != BindingStability::Stable {
        return None;
    }
    let text = Text::of(hir, bound, None);
    let given = find_arguments_of_create_require(text, call, StepsLeft::ALL)?;
    if find_made_require(text, call, StepsLeft::ALL).is_some() {
        return None;
    }
    find_require_made_for_choice(text, call, Some(holder), StepsLeft::ALL)?;
    let ExprKind::Call(written) = expr_kind(hir, call)? else {
        return None;
    };

    Some((holder, (given.start - hir[written].args.start) as usize))
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OwnRequire {
    OfFile,
    Made,
    MadeForPath(ExprId),
    MadeForChoice(SymbolId),
    OfOtherFile(Atom),
    MadeInOtherFile(Atom),
}

const LONGEST_CHAIN_OF_BINDINGS: usize = 8;
const LONGEST_CHAIN_OF_PARAMETERS: usize = 3;
const LONGEST_CHAIN_OF_REQUESTS: usize = 3;

fn iife_return_value(hir: &File<'_>, e: ExprId) -> Option<ExprId> {
    let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
        return None;
    };
    return_value_of(hir, hir[call], hir[call].callee)
}

fn return_value_of(hir: &File<'_>, call: Call, callee: ExprId) -> Option<ExprId> {
    let Some(ExprKind::Fn(function)) = expr_kind(hir, hir.skip_type_assertions(callee)) else {
        return None;
    };
    return_value_of_function(hir, call, function)
}

fn return_value_of_settled_function(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
) -> Option<ExprId> {
    let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
        return None;
    };
    let callee = follow_settled_bindings(hir, bound, hir[call].callee);
    let declared =
        settled_symbol(hir, bound, callee).map(|function| bound.binding_initializer(hir, function));
    match declared {
        Some(BindingInitializer::Function(function)) => {
            return_value_of_function(hir, hir[call], function)
        }
        _ => return_value_of(hir, hir[call], callee),
    }
}

fn is_answer_of_callee_only_called(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
        return false;
    };
    !settled_chain(hir, bound, hir[call].callee).any(|name| {
        settled_symbol(hir, bound, name)
            .is_some_and(|name| is_answer_used_otherwise_than_called(hir, bound, name))
    })
}

pub(super) fn is_nothing(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    matches!(
        expr_kind(hir, e),
        Some(ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. })
    ) || is_free_name(hir, bound, e, &[known::undefined])
}

fn find_require_among_all_that_is_stored(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    left: StepsLeft,
) -> Option<OwnRequire> {
    let Text { hir, bound, .. } = text;
    if !left.passes_late || !left.passes_and || !left.passes_get_builtin_module {
        return None;
    }
    let (Some(ExprKind::Ident(_)), Binding::Symbol(holder)) = (expr_kind(hir, e), bound.binding(e))
    else {
        return None;
    };
    if bound.dynamic_lookup_scope(NodeData::Expr(e)).is_some() {
        return None;
    }
    if IS_ASKING_WHOLE_FILE.replace(true) {
        return None;
    }
    let holders = &hir.lazy.cells.names_that_hold_own_requires;
    let holders = holders.get_or_init(|| list_names_that_hold_own_requires(text));
    IS_ASKING_WHOLE_FILE.set(false);
    let found = holders.binary_search_by_key(&holder, |it| it.0).ok()?;
    if lets_made_requires_out_of_sight(text) {
        return None;
    }
    Some(match holders[found].1 {
        true => OwnRequire::Made,
        false => OwnRequire::OfFile,
    })
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum OtherUse {
    HandedOn,
    KeptInSight,
    OfAnswer,
}

fn list_names_used_otherwise_than_called(
    hir: &File<'_>,
    bound: &Bound<'_>,
) -> Box<[(SymbolId, OtherUse)]> {
    let mut names: Vec<(SymbolId, OtherUse)> = Vec::new();
    for mention in (0..hir.exprs.len() as u32).map(ExprId) {
        if !bound.is_evaluated_ident(mention) || bound.is_store_target(mention) {
            continue;
        }
        let Binding::Symbol(name) = bound.binding(mention) else {
            continue;
        };
        let written = outermost_cast(hir, bound, mention);
        let is_callee = matches!(bound.parent_of_expr(written), Parent::Expr(user)
            if matches!(expr_kind(hir, user), Some(ExprKind::Call(call)) if hir[call].callee == written));
        if !is_called_or_asked_to_resolve(hir, bound, mention)
            && !is_only_tested(hir, bound, written)
        {
            let is_kept_in_sight = match bound.parent_of_expr(written) {
                Parent::Expr(member) => {
                    (hir.member_key(member)).is_some_and(|(object, _)| object == written)
                }
                Parent::VarInit(declaration) => {
                    matches!(bound.initialized_binding(hir[declaration].pat),
                        Binding::Symbol(taker) if bound.is_stable_binding(taker))
                }
                _ => false,
            };
            names.push(match is_kept_in_sight {
                true => (name, OtherUse::KeptInSight),
                false => (name, OtherUse::HandedOn),
            });
        } else if let (true, Parent::Expr(answer)) = (is_callee, bound.parent_of_expr(written))
            && !is_called_or_asked_to_resolve(hir, bound, answer)
            && !is_only_tested(hir, bound, outermost_cast(hir, bound, answer))
        {
            names.push((name, OtherUse::OfAnswer));
        }
    }
    names.shared_sort_unstable();
    names.dedup();
    names.into_boxed_slice()
}

fn is_used_otherwise_than_called(hir: &File<'_>, bound: &Bound<'_>, name: SymbolId) -> bool {
    let names = &hir.lazy.cells.names_used_otherwise_than_called;
    let names = names.get_or_init(|| list_names_used_otherwise_than_called(hir, bound));
    let start = names.partition_point(|it| it.0 < name);
    (names[start..].first()).is_some_and(|it| it.0 == name && it.1 != OtherUse::OfAnswer)
}

fn is_handed_on(hir: &File<'_>, bound: &Bound<'_>, name: SymbolId) -> bool {
    let names = &hir.lazy.cells.names_used_otherwise_than_called;
    let names = names.get_or_init(|| list_names_used_otherwise_than_called(hir, bound));
    names.binary_search(&(name, OtherUse::HandedOn)).is_ok()
}

fn is_answer_used_otherwise_than_called(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: SymbolId,
) -> bool {
    let names = &hir.lazy.cells.names_used_otherwise_than_called;
    let names = names.get_or_init(|| list_names_used_otherwise_than_called(hir, bound));
    names.binary_search_by_key(&function, |it| it.0).is_ok()
}

thread_local! {
    static IS_ASKING_WHOLE_FILE: Cell<bool> = const { Cell::new(false) };
}

fn is_called_or_asked_to_resolve(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = outermost_cast(hir, bound, e);
    let is_callee = |e: ExprId| {
        matches!(bound.parent_of_expr(e), Parent::Expr(user)
            if matches!(expr_kind(hir, user), Some(ExprKind::Call(call)) if hir[call].callee == e))
    };
    is_callee(e)
        || matches!(bound.parent_of_expr(e), Parent::Expr(member)
            if matches!(hir.member_key(member), Some((object, MemberKey::Name(known::resolve))) if object == e)
                && is_callee(outermost_cast(hir, bound, member)))
}

fn find_choice_that_hands_on(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<ExprId> {
    let Parent::Expr(above) = bound.parent_of_expr(e) else {
        return None;
    };
    let hands_on = match expr_kind(hir, above) {
        Some(ExprKind::Cond { test, .. }) => test != e,
        Some(ExprKind::Binary { op, .. }) => {
            matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
        }
        _ => false,
    };
    hands_on.then(|| outermost_cast(hir, bound, above))
}

fn goes_out_of_sight(hir: &File<'_>, bound: &Bound<'_>, made: ExprId) -> bool {
    let mut e = outermost_cast(hir, bound, made);
    loop {
        if is_called_or_asked_to_resolve(hir, bound, e) || is_only_tested(hir, bound, e) {
            return false;
        }
        let name_of = |function: FnId| match bound.fns[function.idx()].owner {
            FnOwner::Stmt(_) => Some(bound.declared_symbol(Decl::Fn(function))),
            FnOwner::Expr(written) => {
                match bound.parent_of_expr(outermost_cast(hir, bound, written)) {
                    Parent::VarInit(declaration) => {
                        match bound.initialized_binding(hir[declaration].pat) {
                            Binding::Symbol(name) => Some(name),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        };
        let is_answer_in_sight = |function: FnId| {
            name_of(function).is_some_and(|name| {
                bound.is_stable_binding(name)
                    && !is_exported(bound, name)
                    && !is_answer_used_otherwise_than_called(hir, bound, name)
            })
        };
        let call_where_written = |function: FnId| match bound.fns[function.idx()].owner {
            FnOwner::Expr(written) => {
                let written = outermost_cast(hir, bound, written);
                match bound.parent_of_expr(written) {
                    Parent::Expr(call) => (matches!(expr_kind(hir, call), Some(ExprKind::Call(id))
                        if hir[id].callee == written))
                    .then_some(call),
                    _ => None,
                }
            }
            _ => None,
        };
        let above = match bound.parent_of_expr(e) {
            Parent::Expr(above) => above,
            Parent::VarInit(declaration) => {
                return match (
                    hir[hir[declaration].pat].kind,
                    bound.initialized_binding(hir[declaration].pat),
                ) {
                    (PatKind::Ident(_), Binding::Symbol(name)) => {
                        !bound.is_stable_binding(name)
                            && is_used_otherwise_than_called(hir, bound, name)
                    }
                    _ => true,
                };
            }
            Parent::FnBody(function) => match call_where_written(function) {
                Some(call) => {
                    e = outermost_cast(hir, bound, call);
                    continue;
                }
                None => return !is_answer_in_sight(function),
            },
            Parent::Stmt(statement) => {
                return match hir[statement].kind {
                    StmtKind::Expr(_) => false,
                    StmtKind::Return(_) => {
                        let mut around = statement;
                        let function = loop {
                            around = match bound.parent_of_stmt(around) {
                                Parent::Stmt(above) => above,
                                Parent::Case(case) => bound.case_stmt[case.idx()],
                                Parent::FnBody(function) => break Some(function),
                                _ => break None,
                            };
                        };
                        !function.is_some_and(is_answer_in_sight)
                    }
                    _ => true,
                };
            }
            _ => return true,
        };
        if let Some(around) = find_choice_that_hands_on(hir, bound, e) {
            e = around;
            continue;
        }
        let Some(ExprKind::Assign {
            op: None | Some(BinOp::Or | BinOp::Nullish),
            target,
            value,
        }) = expr_kind(hir, above)
        else {
            return true;
        };
        let stays_in_sight = value == e
            && matches!((expr_kind(hir, target), bound.binding(target)),
                (Some(ExprKind::Ident(_)), Binding::Symbol(name))
                    if !is_used_otherwise_than_called(hir, bound, name)
                        && !is_exported(bound, name));
        if !stays_in_sight {
            return true;
        }
        e = outermost_cast(hir, bound, above);
    }
}

fn find_name_that_takes(hir: &File<'_>, bound: &Bound<'_>, made: ExprId) -> Option<SymbolId> {
    let mut e = outermost_cast(hir, bound, made);
    while let Some(around) = find_choice_that_hands_on(hir, bound, e) {
        e = around;
    }
    let taker = match bound.parent_of_expr(e) {
        Parent::VarInit(declaration) => bound.initialized_binding(hir[declaration].pat),
        Parent::Expr(above) => match expr_kind(hir, above) {
            Some(ExprKind::Assign { target, value, .. }) if value == e => bound.binding(target),
            _ => return None,
        },
        _ => return None,
    };
    match taker {
        Binding::Symbol(name) => Some(name),
        _ => None,
    }
}

fn is_followed_to_every_call(text: Text<'_, '_, '_, '_>, made: ExprId) -> bool {
    let Text { hir, bound, .. } = text;
    if goes_out_of_sight(hir, bound, made) {
        return false;
    }
    let is_base_read = find_made_require(text, made, StepsLeft::ALL).is_some();
    let Some(holder) = find_name_that_takes(hir, bound, made) else {
        let written = outermost_cast(hir, bound, made);
        return is_base_read
            || is_only_tested(hir, bound, written)
            || matches!(bound.parent_of_expr(written), Parent::Stmt(statement)
                if matches!(hir[statement].kind, StmtKind::Expr(_)));
    };
    if bound.is_stable_binding(holder) {
        let is_made_for_choice =
            || find_require_made_for_choice(text, made, Some(holder), StepsLeft::ALL).is_some();
        return (is_base_read || is_made_for_choice())
            && (is_exported(bound, holder) || !is_handed_on(hir, bound, holder));
    }
    if IS_ASKING_WHOLE_FILE.replace(true) {
        return true;
    }
    let holders = &hir.lazy.cells.names_that_hold_own_requires;
    let holders = holders.get_or_init(|| list_names_that_hold_own_requires(text));
    IS_ASKING_WHOLE_FILE.set(false);
    holders.binary_search_by_key(&holder, |it| it.0).is_ok()
}

pub fn find_made_requires_that_go_out_of_sight(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> Vec<ExprId> {
    let text = Text::of(hir, bound, None);
    let early = StepsLeft::ALL.without_late();
    let calls = (0..hir.exprs.len() as u32).map(ExprId);
    let made = calls.filter(|&e| {
        matches!(expr_kind(hir, e), Some(ExprKind::Call(_)))
            && !decisions.is_dead_expr(e)
            && find_arguments_of_create_require(text, e, early).is_some()
    });
    made.filter(|&made| !is_followed_to_every_call(text, made))
        .collect()
}

fn lets_made_requires_out_of_sight(text: Text<'_, '_, '_, '_>) -> bool {
    let Text { hir, bound, .. } = text;
    if IS_ASKING_WHOLE_FILE.replace(true) {
        return true;
    }
    let answer = bound.lets_made_requires_out_of_sight(|| {
        let text = Text::of(hir, bound, None);
        let early = StepsLeft::ALL.without_late();
        (0..hir.exprs.len() as u32).map(ExprId).any(|e| {
            matches!(expr_kind(hir, e), Some(ExprKind::Call(_)))
                && find_arguments_of_create_require(text, e, early).is_some()
                && goes_out_of_sight(hir, bound, e)
        })
    });
    IS_ASKING_WHOLE_FILE.set(false);
    answer
}

fn list_names_that_hold_own_requires(text: Text<'_, '_, '_, '_>) -> Box<[(SymbolId, bool)]> {
    let text = Text::of(text.hir, text.bound, None);
    let mut holders = Vec::new();
    let mut stores = text.bound.stores();
    while let Some(first) = stores.first() {
        let count = stores.partition_point(|store| store.symbol == first.symbol);
        let (of_holder, rest) = stores.split_at(count);
        match find_require_in_all_stores(text, first.symbol, of_holder) {
            Some(OwnRequire::Made) => holders.push((first.symbol, true)),
            Some(OwnRequire::OfFile) => holders.push((first.symbol, false)),
            _ => {}
        }
        stores = rest;
    }
    holders.into_boxed_slice()
}

fn find_require_in_all_stores(
    text: Text<'_, '_, '_, '_>,
    holder: SymbolId,
    stores: &[SymbolStore],
) -> Option<OwnRequire> {
    let Text { hir, bound, .. } = text;
    let [Decl::Var(pattern)] = *bound.symbol(holder).decls else {
        return None;
    };
    let is_stored_as_written = matches!(
        bound.binding_stability(holder),
        BindingStability::Stored | BindingStability::NotInitializedOnce
    ) && matches!(
        bound.binding_kind(holder),
        BindingKind::Let | BindingKind::Var
    ) && matches!(hir[pattern].kind, PatKind::Ident(_))
        && !bound.is_visible_to_eval(holder)
        && !bound.is_appended_symbol(holder)
        && !bound.runtime.is_stored_by_function_of_block(holder)
        && !(bound.runtime.redeclared_commonjs_variables().iter()).any(|it| it.0 == holder)
        && !is_exported(bound, holder);
    if !is_stored_as_written {
        return None;
    }
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let statement = bound.var_stmt[declaration.idx()];
    if let Parent::Stmt(above) = bound.parent_of_stmt(statement)
        && matches!(hir[above].kind,
            StmtKind::ForOf { left, .. } | StmtKind::ForIn { left, .. } if left == statement)
    {
        return None;
    }
    let within = StepsLeft {
        passes_and: false,
        passes_choices: false,
        ..StepsLeft::ALL
    };
    let mut held = None;
    let mut holds_no_other = |value: ExprId| {
        let found = follow_to_own_require(text, value, within);
        match found {
            Some(OwnRequire::Made | OwnRequire::OfFile) => *held.get_or_insert(found) == found,
            _ => is_nothing(hir, bound, value),
        }
    };
    if !hir[declaration].init.some().is_none_or(&mut holds_no_other) {
        return None;
    }
    for store in stores {
        let is_plain = matches!(
            store.kind,
            StoreKind::Assign | StoreKind::CompoundAssign(BinOp::Or | BinOp::Nullish)
        );
        let Parent::Expr(assignment) = bound.parent_of_expr(store.target) else {
            return None;
        };
        match expr_kind(hir, assignment) {
            Some(ExprKind::Assign { target, value, .. })
                if is_plain && target == store.target && holds_no_other(value) => {}
            _ => return None,
        }
    }
    held.flatten()
        .filter(|_| !is_used_otherwise_than_called(hir, bound, holder))
}

fn return_value_of_function(hir: &File<'_>, call: Call, function: FnId) -> Option<ExprId> {
    let function = &hir[function];
    let is_plain_function = matches!(function.kind, FnKind::Arrow | FnKind::Expr | FnKind::Decl)
        && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
    if call.chain != Chain::No || !is_plain_function {
        return None;
    }
    match function.body {
        FnBody::Expr(value) => Some(value),
        FnBody::Block(statements) if statements.len() == 1 => {
            match hir[hir.id_at(statements, 0)].kind {
                StmtKind::Return(value) => value.some(),
                _ => None,
            }
        }
        FnBody::Block(_) | FnBody::None => None,
    }
}

fn live_branch(hir: &File<'_>, decisions: &Decisions<'_>, e: ExprId) -> Option<ExprId> {
    let Some(ExprKind::Cond { branches, .. }) = expr_kind(hir, e) else {
        return None;
    };
    let Branches { yes, no } = hir.branches(branches);
    match (decisions.is_dead_expr(yes), decisions.is_dead_expr(no)) {
        (false, true) => Some(yes),
        (true, false) => Some(no),
        (false, false) | (true, true) => None,
    }
}

pub fn find_result_expression(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    e: ExprId,
) -> Option<ExprId> {
    live_branch(hir, decisions, e).or_else(|| iife_return_value(hir, e))
}

fn find_settled_parameter(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<(FnId, usize)> {
    let Some(ExprKind::Ident(_)) = expr_kind(hir, e) else {
        return None;
    };
    let Binding::Symbol(symbol) = bound.binding(e) else {
        return None;
    };
    let &[Decl::Param(pattern)] = bound.symbol(symbol).decls else {
        return None;
    };
    let PatParent::Param(id) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let is_settled = bound.stores_to(symbol).is_empty()
        && !bound.is_visible_to_eval(symbol)
        && bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none()
        && !hir[id].flags.contains(Flags::REST)
        && hir[id].default.is_none();
    let function = bound.param_fn[id.idx()];
    let index = hir[function].params.iter().position(|it| it == id)?;
    is_settled.then_some((function, index))
}

fn argument_at(hir: &File<'_>, arguments: IdList<ExprId>, index: usize) -> Option<ExprId> {
    let mut passed = hir.ids(arguments).take(index + 1);
    let is_spread = |it| matches!(expr_kind(hir, it), Some(ExprKind::Spread(_)));
    match passed.clone().any(is_spread) {
        true => None,
        false => passed.nth(index),
    }
}

fn find_call_around(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<(ExprId, Call)> {
    let FnOwner::Expr(expression) = bound.fns[function.idx()].owner else {
        return None;
    };
    let Parent::Expr(above) = bound.parent_of_expr(expression) else {
        return None;
    };
    match expr_kind(hir, above) {
        Some(ExprKind::Call(call)) => Some((expression, hir[call])),
        _ => None,
    }
}

fn is_given_require_of_file(
    text: Text<'_, '_, '_, '_>,
    (function, index): (FnId, usize),
    left: StepsLeft,
) -> bool {
    let Text {
        hir,
        bound,
        decisions,
    } = text;
    let Some((expression, call)) = find_call_around(hir, bound, function) else {
        return false;
    };
    let is_require_of_file = |arguments: IdList<ExprId>| {
        argument_at(hir, arguments, index).is_some_and(|argument| {
            follow_to_own_require(text, argument, left) == Some(OwnRequire::OfFile)
        })
    };
    if call.callee == expression {
        return is_require_of_file(call.args);
    }
    let Some(ExprKind::Fn(caller)) = expr_kind(hir, hir.skip_type_assertions(call.callee)) else {
        return false;
    };
    let place = hir.ids(call.args).position(|it| it == expression);
    let Some(place) = place.filter(|&place| argument_at(hir, call.args, place).is_some()) else {
        return false;
    };
    let Some(held_by) = hir[caller].params.iter().nth(place).map(|id| hir[id]) else {
        return false;
    };
    let PatKind::Ident(name) = hir[held_by.pat].kind else {
        return false;
    };
    if held_by.flags.contains(Flags::REST) {
        return false;
    }
    let held_by = Binding::Symbol(bound.declared_symbol(Decl::Param(held_by.pat)));
    (0..hir.exprs.len() as u32).map(ExprId).any(|e| {
        let ExprKind::Call(inner) = hir[e].kind else {
            return false;
        };
        let inner = hir[inner];
        matches!(expr_kind(hir, inner.callee), Some(ExprKind::Ident(it)) if it == name)
            && bound.binding(inner.callee) == held_by
            && !decisions.is_some_and(|decisions| decisions.is_dead_expr(e))
            && is_require_of_file(inner.args)
    })
}

pub fn gives_first_argument_to_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    call: Call,
) -> bool {
    let text = Text::of(hir, bound, Some(decisions));
    let made = follow_settled_bindings(hir, bound, call.callee);
    let Some(ExprKind::Call(making)) = expr_kind(hir, made) else {
        return false;
    };
    let making = hir[making];
    let maker = follow_settled_bindings(hir, bound, making.callee);
    let Some(ExprKind::Fn(maker_function)) = expr_kind(hir, maker) else {
        return false;
    };
    let Some(loader) = return_value_of(hir, making, maker) else {
        return false;
    };
    let loader = hir.skip_type_assertions(loader);
    let Some(ExprKind::Fn(loading_function)) = expr_kind(hir, loader) else {
        return false;
    };
    let Some(answer) = return_value_of(hir, call, loader) else {
        return false;
    };
    let Some(ExprKind::Call(loading)) = expr_kind(hir, hir.skip_type_assertions(answer)) else {
        return false;
    };
    let loading = hir[loading];
    let given = find_settled_parameter(hir, bound, hir.skip_type_assertions(loading.callee));
    let Some((owner, place)) = given else {
        return false;
    };
    let names_own_parameter = argument_at(hir, loading.args, 0).is_some_and(|name| {
        let name = hir.skip_type_assertions(name);
        find_settled_parameter(hir, bound, name) == Some((loading_function, 0))
    });
    let is_given_own_require = argument_at(hir, making.args, place).is_some_and(|argument| {
        let left = StepsLeft::ALL.proofs_alone();
        follow_to_own_require(text, argument, left) == Some(OwnRequire::OfFile)
    });
    loading.chain == Chain::No
        && owner == maker_function
        && names_own_parameter
        && is_given_own_require
}

pub fn find_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    e: ExprId,
) -> Option<OwnRequire> {
    follow_to_own_require(Text::of(hir, bound, decisions), e, StepsLeft::ALL)
}

pub fn find_other_values_of_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    e: ExprId,
) -> OtherValues {
    let text = Text::of(hir, bound, decisions);
    let finds = |left: StepsLeft| follow_to_own_require(text, e, left).is_some();
    if finds(StepsLeft::ALL.proofs_alone()) {
        OtherValues::None
    } else if finds(StepsLeft::ALL.without_choices()) {
        OtherValues::Falsy
    } else {
        OtherValues::Any
    }
}
pub(super) fn follow_to_own_require(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    left: StepsLeft,
) -> Option<OwnRequire> {
    follow_each_side_once(text, e, left, &mut FxHashMap::default())
}

type SidesAsked = FxHashMap<(ExprId, [bool; 2], usize, usize), (usize, Option<OwnRequire>)>;

fn follow_each_side_once(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    left: StepsLeft,
    asked: &mut SidesAsked,
) -> Option<OwnRequire> {
    let Text {
        hir,
        bound,
        decisions,
    } = text;
    if !bound.may_name_own_require() && hir.imported_requires.is_empty() {
        return None;
    }
    let is_parameter_with_require_of_file = |e: ExprId| {
        left.parameters.checked_sub(1).is_some_and(|parameters| {
            find_settled_parameter(hir, bound, e).is_some_and(|parameter| {
                is_given_require_of_file(text, parameter, StepsLeft { parameters, ..left })
            })
        })
    };
    let mut e = hir.skip_type_assertions(e);
    let mut holder = None;
    let mut holders = [None; LONGEST_CHAIN_OF_BINDINGS];
    let are_only_called = |holders: &[Option<SymbolId>]| {
        let mut holders = holders.iter().flatten();
        holders.all(|&holder| !is_used_otherwise_than_called(hir, bound, holder))
    };
    for bindings in (0..left.bindings).rev() {
        if is_free_common_js(hir, bound, e, CommonJsVariable::Require)
            || find_module_printed_as_require(hir, bound, e).is_some()
        {
            return Some(OwnRequire::OfFile);
        }
        if left.passes_late
            && matches!(expr_kind(hir, e), Some(ExprKind::Ident(_)))
            && bound.binding(e) == Binding::CommonJs(CommonJsVariable::Require)
        {
            return Some(OwnRequire::OfFile);
        }
        if let Some(result) =
            decisions.and_then(|decisions| find_result_expression(hir, decisions, e))
        {
            e = hir.skip_type_assertions(result);
            continue;
        }
        if left.passes_late
            && let Some(result) = return_value_of_settled_function(hir, bound, e)
            && let Some(found) =
                follow_each_side_once(text, result, StepsLeft { bindings, ..left }, asked)
            && is_answer_of_callee_only_called(hir, bound, e)
            && are_only_called(&holders)
            && !lets_made_requires_out_of_sight(text)
        {
            return Some(found);
        }
        if left.passes_late
            && let Some(ExprKind::Assign { target, .. }) = expr_kind(hir, e)
            && matches!(expr_kind(hir, target), Some(ExprKind::Ident(_)))
        {
            e = target;
            continue;
        }
        if let Some(ExprKind::Binary {
            op: op @ (BinOp::And | BinOp::Comma),
            right,
            ..
        }) = expr_kind(hir, e)
            && (op == BinOp::Comma || left.passes_and)
        {
            e = hir.skip_type_assertions(right);
            continue;
        }
        if left.passes_choices {
            let sides = match expr_kind(hir, e) {
                Some(ExprKind::Cond { branches, .. }) => {
                    let Branches { yes, no } = hir.branches(branches);
                    Some([yes, no])
                }
                Some(ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    left: first,
                    right: second,
                }) => Some([first, second]),
                _ => None,
            };
            if let Some(sides) = sides {
                let left = StepsLeft {
                    bindings: bindings + 1,
                    ..left
                };
                let mut follow_sides = |left: StepsLeft| {
                    sides.map(|side| {
                        let passes = [left.passes_and, left.passes_late];
                        let key = (side, passes, left.parameters, left.requests);
                        match asked.get(&key) {
                            Some(&(steps, found)) if steps >= left.bindings => found,
                            _ => {
                                let found = follow_each_side_once(text, side, left, asked);
                                asked.insert(key, (left.bindings, found));
                                found
                            }
                        }
                    })
                };
                let mut found = follow_sides(left);
                let mut left = left;
                if left.passes_late && found != [None; 2] && !are_only_called(&holders) {
                    left = left.without_late();
                    found = follow_sides(left);
                }
                if found.contains(&Some(OwnRequire::OfFile)) {
                    return Some(OwnRequire::OfFile);
                }
                let is_made_or_nothing = sides.into_iter().zip(found).all(|(side, found)| {
                    found == Some(OwnRequire::Made) || is_nothing(hir, bound, side)
                });
                let is_made = left.passes_late
                    && is_made_or_nothing
                    && found.contains(&Some(OwnRequire::Made))
                    && !lets_made_requires_out_of_sight(text);
                return is_made.then_some(OwnRequire::Made);
            }
        }
        if let Some((object, MemberKey::Name(known::require))) = hir.member_key(e)
            && is_free_common_js(
                hir,
                bound,
                hir.skip_type_assertions(object),
                CommonJsVariable::Module,
            )
            && !may_be_modified(hir, bound, CommonJsVariable::Module)
        {
            return Some(OwnRequire::OfFile);
        }
        let Some(source) = settled_initializer(hir, bound, e) else {
            if let Some(made) = find_made_require(text, e, left) {
                return Some(made);
            }
            if let Some(made) = find_require_made_for_choice(text, e, holder, left) {
                return Some(made);
            }
            let fewer = StepsLeft { bindings, ..left };
            if let Some(made) = find_require_among_all_that_is_stored(text, e, fewer)
                && are_only_called(&holders)
            {
                return Some(made);
            }
            if let Some(imported) = find_imported_require(hir, bound, e, left) {
                return Some(match imported.is_made {
                    true => OwnRequire::MadeInOtherFile(imported.path),
                    false => OwnRequire::OfOtherFile(imported.path),
                });
            }
            return is_parameter_with_require_of_file(e).then_some(OwnRequire::OfFile);
        };
        holder = settled_symbol(hir, bound, e);
        holders[bindings.min(LONGEST_CHAIN_OF_BINDINGS - 1)] = holder;
        e = source;
    }
    None
}

fn find_imported_require_named(
    hir: &File<'_>,
    specifier: Atom,
    export: Atom,
    left: StepsLeft,
) -> Option<ImportedRequire> {
    let (imported, places) = (&hir.imported_requires, &hir.places_of_imported_requires);
    let found = ImportedRequire::find_by_names(imported, places, specifier, export)?;
    (found.other_values <= left.most_other_values()).then_some(*found)
}

fn find_require_imported_as(
    hir: &File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
    left: StepsLeft,
) -> Option<ImportedRequire> {
    let mut declarations = bound.symbol(symbol).decls.iter();
    let (import, export) = declarations.find_map(|&declaration| match declaration {
        Decl::ImportSpec(spec) => {
            (!hir[spec].type_only).then_some((hir[spec].import, hir[spec].imported))
        }
        Decl::ImportDefault(import) => Some((import, known::default)),
        _ => None,
    })?;
    match hir[import].type_only {
        true => None,
        false => find_imported_require_named(hir, hir[import].spec, export, left),
    }
}

fn find_imported_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    e: ExprId,
    left: StepsLeft,
) -> Option<ImportedRequire> {
    if hir.imported_requires.is_empty() {
        return None;
    }
    let Some((object, MemberKey::Name(export))) = hir.member_key(e) else {
        return find_require_imported_as(hir, bound, settled_symbol(hir, bound, e)?, left);
    };
    let namespace = settled_symbol(hir, bound, hir.skip_type_assertions(object))?;
    let mut declarations = bound.symbol(namespace).decls.iter();
    let import = declarations.find_map(|&declaration| match declaration {
        Decl::ImportNamespace(import) => (!hir[import].type_only).then_some(import),
        _ => None,
    })?;
    find_imported_require_named(hir, hir[import].spec, export, left)
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportedRequire {
    pub export: Atom,
    pub path: Option<Atom>,
    pub is_made: bool,
    pub other_values: OtherValues,
}

type WrittenRequire = (Option<Atom>, bool);

fn find_require_written_as(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    e: ExprId,
    left: StepsLeft,
) -> Option<WrittenRequire> {
    match follow_to_own_require(Text::of(hir, bound, Some(decisions)), e, left)? {
        OwnRequire::OfFile => {
            (!may_be_modified(hir, bound, CommonJsVariable::Require)).then_some((None, false))
        }
        OwnRequire::Made => Some((None, true)),
        OwnRequire::MadeForPath(_) | OwnRequire::MadeForChoice(_) => None,
        OwnRequire::OfOtherFile(path) => Some((Some(path), false)),
        OwnRequire::MadeInOtherFile(path) => Some((Some(path), true)),
    }
}

fn find_require_held_by(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    symbol: SymbolId,
    left: StepsLeft,
) -> Option<WrittenRequire> {
    let stability = bound.binding_stability(symbol);
    match (stability, bound.binding_initializer(hir, symbol)) {
        (BindingStability::Stable, BindingInitializer::Expression(source)) => {
            find_require_written_as(hir, bound, decisions, source, left)
        }
        (BindingStability::Linked, BindingInitializer::Import) => {
            let imported = find_require_imported_as(hir, bound, symbol, left)?;
            Some((Some(imported.path), imported.is_made))
        }
        _ => None,
    }
}

pub fn find_exported_requires(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> Vec<ExportedRequire> {
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let find_written = |declaration: Decl, left: StepsLeft| match declaration {
        Decl::ExportSpec(specifier) => {
            let item = hir[specifier];
            let statement = hir[item.export];
            if item.type_only || statement.type_only {
                return None;
            }
            if statement.has_module_specifier {
                let imported = find_imported_require_named(hir, statement.spec, item.local, left)?;
                return Some((Some(imported.path), imported.is_made));
            }
            match bound.exported_binding(specifier) {
                Binding::Symbol(local) => find_require_held_by(hir, bound, decisions, local, left),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
            }
        }
        Decl::Var(_) => find_require_held_by(
            hir,
            bound,
            decisions,
            bound.declared_symbol(declaration),
            left,
        ),
        Decl::ExportExpr(statement) => match hir[statement].kind {
            StmtKind::ExportDefault(value) => {
                find_require_written_as(hir, bound, decisions, value, left)
            }
            _ => None,
        },
        _ => None,
    };
    let exported = exports.iter().filter_map(|&(export, symbol)| {
        let find = |left: StepsLeft| {
            let mut declarations = bound.symbol(symbol).decls.iter();
            declarations.find_map(|&declaration| find_written(declaration, left))
        };
        let (path, is_made) = find(StepsLeft::ALL)?;
        let other_values = if find(StepsLeft::ALL.proofs_alone()).is_some() {
            OtherValues::None
        } else if find(StepsLeft::ALL.without_choices()).is_some() {
            OtherValues::Falsy
        } else {
            OtherValues::Any
        };
        Some(ExportedRequire {
            export,
            path,
            is_made,
            other_values,
        })
    });
    let mut found: Vec<ExportedRequire> = exported.collect();
    let mut taken: Option<FxHashSet<Atom>> = None;
    for statement in hir.ids(hir.body) {
        let StmtKind::ExportStar {
            spec,
            alias,
            type_only: false,
            ..
        } = hir[statement].kind
        else {
            continue;
        };
        if alias.is_some() {
            continue;
        }
        for imported in hir
            .imported_requires
            .iter()
            .filter(|it| it.specifier == spec)
        {
            let taken = taken.get_or_insert_with(|| {
                let own = exports.iter().map(|&(export, _)| export);
                own.chain(found.iter().map(|it| it.export)).collect()
            });
            if taken.insert(imported.export) {
                found.push(ExportedRequire {
                    export: imported.export,
                    path: Some(imported.path),
                    is_made: imported.is_made,
                    other_values: imported.other_values,
                });
            }
        }
    }
    found
}

fn settled_initializer(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<ExprId> {
    match bound.binding_initializer(hir, settled_symbol(hir, bound, e)?) {
        BindingInitializer::Expression(source) => Some(hir.skip_type_assertions(source)),
        _ => None,
    }
}

fn settled_chain(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> impl Iterator<Item = ExprId> {
    let first = hir.skip_type_assertions(e);
    let chain = std::iter::successors(Some(first), move |&e| settled_initializer(hir, bound, e));
    chain.take(LONGEST_CHAIN_OF_BINDINGS + 1)
}

pub(super) fn follow_settled_bindings(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> ExprId {
    settled_chain(hir, bound, e).last().unwrap_or(e)
}

pub fn holds_import_meta_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    if !bound.may_name_own_require()
        || !matches!(
            expr_kind(hir, hir.skip_type_assertions(e)),
            Some(ExprKind::Ident(_))
        )
    {
        return false;
    }
    let mut held = settled_chain(hir, bound, e).skip(1);
    held.any(|e| is_import_meta_require(hir, e))
}

pub fn is_made_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let text = Text::of(hir, bound, None);
    let chain = settled_chain(hir, bound, e).take(LONGEST_CHAIN_OF_BINDINGS);
    chain
        .last()
        .is_some_and(|e| find_arguments_of_create_require(text, e, StepsLeft::ALL).is_some())
}

pub fn is_create_require_behind_get_builtin_module(
    hir: &File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
) -> bool {
    let text = Text::of(hir, bound, None);
    let without = StepsLeft {
        passes_get_builtin_module: false,
        ..StepsLeft::ALL
    };
    text.is_create_require(callee, StepsLeft::ALL) && !text.is_create_require(callee, without)
}

pub fn may_still_be_undefined(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let mut end = None;
    for e in settled_chain(hir, bound, e).take(LONGEST_CHAIN_OF_BINDINGS) {
        let symbol = settled_symbol(hir, bound, e);
        if symbol.is_some_and(|symbol| bound.initial_state(symbol) == InitialState::Undefined) {
            return true;
        }
        end = expr_kind(hir, e);
    }
    !matches!(end, Some(ExprKind::Call(_)))
}

pub fn is_require_made_for_own_file(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> bool {
    find_own_require(hir, bound, None, callee) == Some(OwnRequire::Made)
}
