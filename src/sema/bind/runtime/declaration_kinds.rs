use super::declarations::scope_boundary;
use super::has_simple_parameter_list;
use crate::atom::Atom;
use crate::bind::{
    BoundBuilder, BoundIn, Decl, FnOwner, ModuleInstanceState, Parent, PatParent, ScopeId, SymbolId,
};
use crate::hir::*;
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum DeclarationKind {
    NoBinding,
    Var,
    Parameter,
    TopLevelFunction,
    BlockFunction,
    ImplicitBlockFunction,
    Lexical,
    BlockScopedRequire,
    Import,
    SimpleCatchParameter,
    TypeScriptValue,
}

impl DeclarationKind {
    pub(super) fn binds_in_table_scope(self) -> bool {
        !matches!(
            self,
            DeclarationKind::NoBinding
                | DeclarationKind::ImplicitBlockFunction
                | DeclarationKind::BlockScopedRequire
        )
    }
}

#[derive(Copy, Clone)]
pub(super) struct Declaration {
    pub decl: Decl,
    pub kind: DeclarationKind,
}

impl Declaration {
    pub(super) fn new(hir: &File<'_>, bound: &BoundBuilder, decl: Decl) -> Declaration {
        Declaration {
            decl,
            kind: declaration_kind(hir, bound, decl),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum FunctionPosition {
    TopLevel,
    Block,
    ImplicitBlock,
}

pub(super) fn declaration_symbol<S: Storage>(bound: &BoundIn<S>, decl: Decl) -> SymbolId {
    match decl {
        Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => bound.pat_symbol[pat.idx()],
        Decl::Fn(f) => bound.fn_symbol[f.idx()],
        Decl::Class(c) => bound.class_symbol[c.idx()],
        Decl::Enum(e) => bound.enum_symbol[e.idx()],
        Decl::Module(m) => bound.module_symbol[m.idx()],
        _ => SymbolId::NONE,
    }
}

fn function_creates_binding(hir: &File<'_>, f: FnId) -> bool {
    !hir[f].flags.contains(Flags::AMBIENT) && !matches!(hir[f].body, FnBody::None)
}

pub(super) fn pattern_root(bound: &BoundBuilder, mut pat: PatId) -> PatParent {
    loop {
        match bound.pat_parent[pat.idx()] {
            PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
            root @ (PatParent::None | PatParent::Var(_) | PatParent::Param(_)) => return root,
        }
    }
}

fn parameter_function(bound: &BoundBuilder, pat: PatId) -> Option<FnId> {
    match pattern_root(bound, pat) {
        PatParent::Param(param) => bound.param_fn[param.idx()].some(),
        PatParent::None | PatParent::Var(_) | PatParent::Prop(..) | PatParent::Elem(..) => None,
    }
}

pub(super) fn variable_declaration(bound: &BoundBuilder, pat: PatId) -> Option<VarDeclId> {
    match pattern_root(bound, pat) {
        PatParent::Var(declaration) => Some(declaration),
        PatParent::None | PatParent::Param(_) | PatParent::Prop(..) | PatParent::Elem(..) => None,
    }
}

pub(super) fn pattern_scope(bound: &BoundBuilder, pat: PatId) -> ScopeId {
    let Some(declaration) = variable_declaration(bound, pat) else {
        return ScopeId::NONE;
    };
    let scope = bound
        .stmt_scope
        .get(bound.var_stmt[declaration.idx()].idx());
    scope.map_or(ScopeId::NONE, |&scope| scope)
}

pub(super) fn is_block_level(bound: &BoundBuilder, scope: ScopeId) -> bool {
    scope.is_some() && bound.container_scope(scope) != scope
}

pub(super) fn creates_binding(hir: &File<'_>, bound: &BoundBuilder, decl: Decl) -> bool {
    let is_ambient = || bound.modifier_flags(hir, decl).contains(Flags::AMBIENT);
    match decl {
        Decl::Interface(_)
        | Decl::Alias(_)
        | Decl::TypeParam(_)
        | Decl::TypeLiteral(_)
        | Decl::UmdGlobal(_) => false,
        Decl::Var(_) | Decl::Require(_) | Decl::Class(_) | Decl::Enum(_) => !is_ambient(),
        Decl::Fn(f) => function_creates_binding(hir, f),
        Decl::Param(pat) => {
            parameter_function(bound, pat).is_none_or(|f| function_creates_binding(hir, f))
        }
        Decl::Module(m) => {
            !is_ambient()
                && bound.module_instance_state[m.idx()] != ModuleInstanceState::NonInstantiated
        }
        Decl::EnumMember(m) => {
            let owner = bound.enum_member_owner[m.idx()];
            !hir[owner].flags.contains(Flags::AMBIENT)
        }
        Decl::ImportDefault(i) | Decl::ImportNamespace(i) => !hir[i].type_only,
        Decl::ImportSpec(s) => !hir[s].type_only && !hir[hir[s].import].type_only,
        Decl::ImportEquals(i) => !is_ambient() && !hir[i].flags.contains(Flags::TYPE_ONLY),
        Decl::ExportSpec(s) => !hir[s].type_only && !hir[hir[s].export].type_only,
        Decl::ExportStarAs(s) => !matches!(
            hir[s].kind,
            StmtKind::ExportStar {
                type_only: true,
                ..
            }
        ),
        _ => true,
    }
}

fn is_strict_scope(hir: &File<'_>, bound: &BoundBuilder, mut scope: ScopeId) -> bool {
    while scope.is_some() {
        if let (_, Some(is_strict)) = scope_boundary(hir, bound.scopes[scope.idx()].kind) {
            return is_strict;
        }
        scope = bound.runtime_parent_scope(hir, scope);
    }
    false
}

pub(super) fn function_position(hir: &File<'_>, bound: &BoundBuilder, f: FnId) -> FunctionPosition {
    match bound.fns[f.idx()].owner {
        FnOwner::Stmt(statement) => statement_position(hir, bound, statement),
        FnOwner::None | FnOwner::Expr(_) | FnOwner::Member(_) | FnOwner::Type(_) => {
            FunctionPosition::TopLevel
        }
    }
}

pub(super) fn statement_position(
    hir: &File<'_>,
    bound: &BoundBuilder,
    mut statement: StmtId,
) -> FunctionPosition {
    loop {
        match bound.parent_of_stmt(statement) {
            Parent::Stmt(parent) if parent.is_some() => match hir[parent].kind {
                StmtKind::Labeled { .. }
                    if is_strict_scope(hir, bound, bound.stmt_scope[parent.idx()]) =>
                {
                    return FunctionPosition::ImplicitBlock;
                }
                StmtKind::Labeled { .. } => statement = parent,
                StmtKind::Block(_) | StmtKind::Switch { .. } => return FunctionPosition::Block,
                _ => return FunctionPosition::ImplicitBlock,
            },
            Parent::FnBody(_) | Parent::File | Parent::Module(_) => {
                return FunctionPosition::TopLevel;
            }
            _ => return FunctionPosition::ImplicitBlock,
        }
    }
}

fn variable_kind(hir: &File<'_>, bound: &BoundBuilder, pat: PatId) -> DeclarationKind {
    let Some(declaration) = variable_declaration(bound, pat) else {
        return DeclarationKind::NoBinding;
    };
    let statement = hir.stmts.get(bound.var_stmt[declaration.idx()].idx());
    if statement.is_some_and(|statement| matches!(statement.kind, StmtKind::Try { .. })) {
        return if hir[declaration].pat == pat {
            DeclarationKind::SimpleCatchParameter
        } else {
            DeclarationKind::Lexical
        };
    }
    match bound.variable_kind(hir, declaration) {
        VarKind::Var => DeclarationKind::Var,
        VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {
            DeclarationKind::Lexical
        }
    }
}

fn require_kind(hir: &File<'_>, bound: &BoundBuilder, pat: PatId) -> DeclarationKind {
    let kind = variable_kind(hir, bound, pat);
    if kind == DeclarationKind::Lexical && is_block_level(bound, pattern_scope(bound, pat)) {
        DeclarationKind::BlockScopedRequire
    } else {
        kind
    }
}

fn function_kind(hir: &File<'_>, bound: &BoundBuilder, f: FnId) -> DeclarationKind {
    match hir[f].kind {
        FnKind::Expr => DeclarationKind::Lexical,
        FnKind::Decl => match function_position(hir, bound, f) {
            FunctionPosition::TopLevel => DeclarationKind::TopLevelFunction,
            FunctionPosition::ImplicitBlock => DeclarationKind::ImplicitBlockFunction,
            FunctionPosition::Block if hir[f].flags.intersects(Flags::ASYNC | Flags::GENERATOR) => {
                DeclarationKind::Lexical
            }
            FunctionPosition::Block => DeclarationKind::BlockFunction,
        },
        _ => DeclarationKind::NoBinding,
    }
}

pub(super) fn declaration_kind(
    hir: &File<'_>,
    bound: &BoundBuilder,
    decl: Decl,
) -> DeclarationKind {
    if !creates_binding(hir, bound, decl) {
        return DeclarationKind::NoBinding;
    }
    match decl {
        Decl::Var(pat) => variable_kind(hir, bound, pat),
        Decl::Require(pat) => require_kind(hir, bound, pat),
        Decl::Param(_) => DeclarationKind::Parameter,
        Decl::Fn(f) => function_kind(hir, bound, f),
        Decl::Class(_) => DeclarationKind::Lexical,
        Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) => {
            DeclarationKind::Import
        }
        Decl::Enum(_) | Decl::Module(_) | Decl::ImportEquals(_) => DeclarationKind::TypeScriptValue,
        _ => DeclarationKind::NoBinding,
    }
}

pub(super) fn has_parameter_expressions(
    hir: &File<'_>,
    func: &Func,
    pending: &mut Vec<PatId>,
) -> bool {
    pending.clear();
    for param in func.params.iter() {
        if hir[param].default.is_some() {
            return true;
        }
        pending.push(hir[param].pat);
    }
    while let Some(pat) = pending.pop() {
        match hir[pat].kind {
            PatKind::Missing | PatKind::Ident(_) => {}
            PatKind::Object(props) => {
                for prop in props.iter() {
                    let prop = &hir[prop];
                    if prop.default.is_some() || matches!(prop.key, PropKey::Computed(_)) {
                        return true;
                    }
                    pending.push(prop.value);
                }
            }
            PatKind::Array(elements) => {
                for element in elements.iter() {
                    if hir[element].default.is_some() {
                        return true;
                    }
                    pending.push(hir[element].pat);
                }
            }
        }
    }
    false
}

pub(super) fn for_each_name(hir: &File<'_>, pattern: PatId, mut visit: impl FnMut(PatId, Atom)) {
    let mut pending: SmallVec<[PatId; 8]> = SmallVec::new();
    pending.push(pattern);
    while let Some(pat) = pending.pop() {
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(name) => visit(pat, name),
            PatKind::Object(props) => {
                pending.extend(props.iter().rev().map(|prop| hir[prop].value));
            }
            PatKind::Array(elements) => {
                pending.extend(elements.iter().rev().map(|element| hir[element].pat));
            }
        }
    }
}

pub(super) fn needs_unique_parameters(hir: &File<'_>, function: FnId) -> bool {
    matches!(
        hir[function].kind,
        FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
    ) || !has_simple_parameter_list(hir, function)
}
