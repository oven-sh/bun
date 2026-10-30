use super::call_sites::{
    expr_kind, find_module_printed_as_require, find_request_of_exports, is_free_common_js,
};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CodeUnit, CommonJsVariable, Decl,
    FnOwner, InitialState, Parent, PatParent, SymbolId, has_mapped_arguments,
};
use crate::fold::Decisions;
use crate::hir::{
    Branches, Call, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, FnKind, IdList, MemberKey,
    NodeData, PatKind, StmtKind, UnOp,
};
use smallvec::SmallVec;

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
    declarations.find_map(|&declaration| match declaration {
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
    })
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
    pub(super) passes_get_builtin_module: bool,
}

impl StepsLeft {
    pub(super) const ALL: StepsLeft = StepsLeft {
        parameters: LONGEST_CHAIN_OF_PARAMETERS,
        requests: LONGEST_CHAIN_OF_REQUESTS,
        passes_get_builtin_module: true,
    };
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

    // `const { b } = require("k").a; b.c` reads `c`, `b` and `a` off the exports of "k".
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

pub(super) fn may_be_modified(
    hir: &File<'_>,
    bound: &Bound<'_>,
    variable: CommonJsVariable,
) -> bool {
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

fn names_own_file(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let e = hir.skip_type_assertions(e);
    if is_free_common_js(hir, bound, e, CommonJsVariable::Filename) {
        return !may_be_modified(hir, bound, CommonJsVariable::Filename);
    }
    let is_import_meta_member = matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if (name == known::url || name == known::meta_filename || name == known::path)
            && matches!(expr_kind(hir, hir.skip_type_assertions(object)), Some(ExprKind::ImportMeta)));
    is_import_meta_member && !bound.import_meta_may_be_modified()
}

fn is_made_for_own_file(text: Text<'_, '_, '_, '_>, e: ExprId, left: StepsLeft) -> bool {
    let Text { hir, bound, .. } = text;
    let Some(ExprKind::Call(call)) = expr_kind(hir, hir.skip_type_assertions(e)) else {
        return false;
    };
    let mut arguments = hir.ids(hir[call].args);
    arguments
        .next()
        .is_some_and(|base| names_own_file(hir, bound, base))
        && text.is_create_require(hir[call].callee, left)
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OwnRequire {
    OfFile,
    Made,
    // Imported from the file at this path, which exports its own `require`.
    OfOtherFile(Atom),
}

const LONGEST_CHAIN_OF_BINDINGS: usize = 8;
const LONGEST_CHAIN_OF_PARAMETERS: usize = 3;
const LONGEST_CHAIN_OF_REQUESTS: usize = 3;

fn iife_return_value(hir: &File<'_>, e: ExprId) -> Option<ExprId> {
    let Some(ExprKind::Call(call)) = expr_kind(hir, e) else {
        return None;
    };
    let call = hir[call];
    let Some(ExprKind::Fn(function)) = expr_kind(hir, hir.skip_type_assertions(call.callee)) else {
        return None;
    };
    let function = &hir[function];
    let is_plain_function = matches!(function.kind, FnKind::Arrow | FnKind::Expr)
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

pub fn find_own_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: Option<&Decisions<'_>>,
    e: ExprId,
) -> Option<OwnRequire> {
    follow_to_own_require(Text::of(hir, bound, decisions), e, StepsLeft::ALL)
}

pub(super) fn follow_to_own_require(
    text: Text<'_, '_, '_, '_>,
    e: ExprId,
    left: StepsLeft,
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
    for _ in 0..LONGEST_CHAIN_OF_BINDINGS {
        if is_free_common_js(hir, bound, e, CommonJsVariable::Require)
            || find_module_printed_as_require(hir, bound, e).is_some()
        {
            return Some(OwnRequire::OfFile);
        }
        if let Some(result) =
            decisions.and_then(|decisions| find_result_expression(hir, decisions, e))
        {
            e = hir.skip_type_assertions(result);
            continue;
        }
        let Some(source) = settled_initializer(hir, bound, e) else {
            if is_made_for_own_file(text, e, left) {
                return Some(OwnRequire::Made);
            }
            if let Some(path) = find_imported_require(hir, bound, e) {
                return Some(OwnRequire::OfOtherFile(path));
            }
            return is_parameter_with_require_of_file(e).then_some(OwnRequire::OfFile);
        };
        e = source;
    }
    None
}

fn path_of_imported_require(hir: &File<'_>, specifier: Atom, export: Atom) -> Option<Atom> {
    let mut imported = hir.imported_requires.iter();
    let found = imported.find(|it| it.specifier == specifier && it.export == export)?;
    Some(found.path)
}

fn find_require_imported_as(hir: &File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> Option<Atom> {
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
        false => path_of_imported_require(hir, hir[import].spec, export),
    }
}

fn find_imported_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<Atom> {
    if hir.imported_requires.is_empty() {
        return None;
    }
    let Some((object, MemberKey::Name(export))) = hir.member_key(e) else {
        return find_require_imported_as(hir, bound, settled_symbol(hir, bound, e)?);
    };
    let namespace = settled_symbol(hir, bound, hir.skip_type_assertions(object))?;
    let mut declarations = bound.symbol(namespace).decls.iter();
    let import = declarations.find_map(|&declaration| match declaration {
        Decl::ImportNamespace(import) => (!hir[import].type_only).then_some(import),
        _ => None,
    })?;
    path_of_imported_require(hir, hir[import].spec, export)
}

// A `require` that a file exports, and the path of the file that it resolves from. `None` is the exporting file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportedRequire {
    pub export: Atom,
    pub path: Option<Atom>,
}

fn find_require_written_as(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    e: ExprId,
) -> Option<Option<Atom>> {
    match find_own_require(hir, bound, Some(decisions), e)? {
        OwnRequire::OfFile => {
            (!may_be_modified(hir, bound, CommonJsVariable::Require)).then_some(None)
        }
        OwnRequire::Made => Some(None),
        OwnRequire::OfOtherFile(path) => Some(Some(path)),
    }
}

fn find_require_held_by(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    symbol: SymbolId,
) -> Option<Option<Atom>> {
    let stability = bound.binding_stability(symbol);
    match (stability, bound.binding_initializer(hir, symbol)) {
        (BindingStability::Stable, BindingInitializer::Expression(source)) => {
            find_require_written_as(hir, bound, decisions, source)
        }
        (BindingStability::Linked, BindingInitializer::Import) => {
            find_require_imported_as(hir, bound, symbol).map(Some)
        }
        _ => None,
    }
}

// esbuild writes `export { __require }` into the chunk that its other chunks share.
pub fn find_exported_requires(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> Vec<ExportedRequire> {
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let path_of = |declaration: Decl| match declaration {
        Decl::ExportSpec(specifier) => {
            let item = hir[specifier];
            let statement = hir[item.export];
            if item.type_only || statement.type_only {
                return None;
            }
            if statement.has_module_specifier {
                return path_of_imported_require(hir, statement.spec, item.local).map(Some);
            }
            match bound.exported_binding(specifier) {
                Binding::Symbol(local) => find_require_held_by(hir, bound, decisions, local),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
            }
        }
        Decl::Var(_) => {
            find_require_held_by(hir, bound, decisions, bound.declared_symbol(declaration))
        }
        Decl::ExportExpr(statement) => match hir[statement].kind {
            StmtKind::ExportDefault(value) => find_require_written_as(hir, bound, decisions, value),
            _ => None,
        },
        _ => None,
    };
    let exported = exports.iter().filter_map(|&(export, symbol)| {
        let mut declarations = bound.symbol(symbol).decls.iter();
        let path = declarations.find_map(|&declaration| path_of(declaration))?;
        Some(ExportedRequire { export, path })
    });
    let mut found: Vec<ExportedRequire> = exported.collect();
    // `export * from` passes on what the file does not export itself.
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
            let is_own = exports.iter().any(|&(export, _)| export == imported.export);
            if !is_own && !found.iter().any(|it| it.export == imported.export) {
                found.push(ExportedRequire {
                    export: imported.export,
                    path: Some(imported.path),
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
    if !bound.may_name_own_require() {
        return false;
    }
    let mut held = settled_chain(hir, bound, e).skip(1);
    held.any(|e| is_import_meta_require(hir, e))
}

pub fn is_made_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    let text = Text::of(hir, bound, None);
    let chain = settled_chain(hir, bound, e).take(LONGEST_CHAIN_OF_BINDINGS);
    let written = chain.last().and_then(|e| expr_kind(hir, e));
    matches!(written, Some(ExprKind::Call(call))
        if text.is_create_require(hir[call].callee, StepsLeft::ALL))
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
    let mut chain = settled_chain(hir, bound, e).take(LONGEST_CHAIN_OF_BINDINGS);
    chain.any(|e| {
        let symbol = settled_symbol(hir, bound, e);
        symbol.is_some_and(|symbol| bound.initial_state(symbol) == InitialState::Undefined)
    })
}

pub fn is_require_made_for_own_file(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> bool {
    find_own_require(hir, bound, None, callee) == Some(OwnRequire::Made)
}
