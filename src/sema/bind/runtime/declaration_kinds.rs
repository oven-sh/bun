use super::declarations::scope_boundary;
use crate::bind::{
    BoundBuilder, Decl, FnOwner, ModuleInstanceState, Parent, PatParent, ScopeId, SymbolId,
};
use crate::hir::*;

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
        match self {
            DeclarationKind::NoBinding
            | DeclarationKind::ImplicitBlockFunction
            | DeclarationKind::BlockScopedRequire => false,
            DeclarationKind::Var
            | DeclarationKind::Parameter
            | DeclarationKind::TopLevelFunction
            | DeclarationKind::BlockFunction
            | DeclarationKind::Lexical
            | DeclarationKind::Import
            | DeclarationKind::SimpleCatchParameter
            | DeclarationKind::TypeScriptValue => true,
        }
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

#[derive(Copy, Clone)]
pub(super) enum SymbolColumn {
    Pattern(PatId),
    Function(FnId),
    Class(ClassId),
    Enum(EnumId),
    Module(ModuleId),
    None,
}

pub(super) fn symbol_column(decl: Decl) -> SymbolColumn {
    match decl {
        Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => SymbolColumn::Pattern(pat),
        Decl::Fn(f) => SymbolColumn::Function(f),
        Decl::Class(c) => SymbolColumn::Class(c),
        Decl::Enum(e) => SymbolColumn::Enum(e),
        Decl::Module(m) => SymbolColumn::Module(m),
        Decl::Interface(_)
        | Decl::Alias(_)
        | Decl::EnumMember(_)
        | Decl::TypeParam(_)
        | Decl::ImportDefault(_)
        | Decl::ImportNamespace(_)
        | Decl::ImportSpec(_)
        | Decl::ImportEquals(_)
        | Decl::ExportSpec(_)
        | Decl::ExportStarAs(_)
        | Decl::ExportExpr(_)
        | Decl::UmdGlobal(_)
        | Decl::File
        | Decl::ModuleExports(_)
        | Decl::ExportsProperty(_)
        | Decl::Expando(_)
        | Decl::ObjectLiteral(_)
        | Decl::CommonJsVariable
        | Decl::Member(_)
        | Decl::ParameterProperty(_)
        | Decl::ThisProperty(_)
        | Decl::Property(_)
        | Decl::TypeLiteral(_) => SymbolColumn::None,
    }
}

pub(super) fn declaration_symbol(bound: &BoundBuilder, decl: Decl) -> SymbolId {
    match symbol_column(decl) {
        SymbolColumn::Pattern(pat) => bound.pat_symbol[pat.idx()],
        SymbolColumn::Function(f) => bound.fn_symbol[f.idx()],
        SymbolColumn::Class(c) => bound.class_symbol[c.idx()],
        SymbolColumn::Enum(e) => bound.enum_symbol[e.idx()],
        SymbolColumn::Module(m) => bound.module_symbol[m.idx()],
        SymbolColumn::None => SymbolId::NONE,
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
    let scope = bound.stmt_scope.get(bound.var_stmt[declaration.idx()].idx());
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
        Decl::ExportStarAs(s) => {
            !matches!(hir[s].kind, StmtKind::ExportStar { type_only: true, .. })
        }
        Decl::ExportExpr(_)
        | Decl::File
        | Decl::ModuleExports(_)
        | Decl::ExportsProperty(_)
        | Decl::Expando(_)
        | Decl::ObjectLiteral(_)
        | Decl::CommonJsVariable
        | Decl::Member(_)
        | Decl::ParameterProperty(_)
        | Decl::ThisProperty(_)
        | Decl::Property(_) => true,
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

pub(super) fn function_position(
    hir: &File<'_>,
    bound: &BoundBuilder,
    f: FnId,
) -> FunctionPosition {
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
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Expr(_)
                | StmtKind::Var(_)
                | StmtKind::Fn(_)
                | StmtKind::Class(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::Return(_)
                | StmtKind::If { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::Try { .. }
                | StmtKind::Throw(_)
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Import(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportDefault(_)
                | StmtKind::ExportAssign(_)
                | StmtKind::ExportAsNamespace(_)
                | StmtKind::With { .. }
                | StmtKind::Directive { .. } => return FunctionPosition::ImplicitBlock,
            },
            Parent::FnBody(_) | Parent::File | Parent::Module(_) => {
                return FunctionPosition::TopLevel;
            }
            Parent::None
            | Parent::Expr(_)
            | Parent::Stmt(_)
            | Parent::VarInit(_)
            | Parent::ParamDefault(_)
            | Parent::PatPropDefault(_)
            | Parent::PatElemDefault(_)
            | Parent::Prop(_)
            | Parent::PropKey(_)
            | Parent::PatKey(_)
            | Parent::MemberKey(_)
            | Parent::MethodKey(_)
            | Parent::MemberInit(_)
            | Parent::EnumInit(_)
            | Parent::Case(_)
            | Parent::ClassExtends(_)
            | Parent::ClassDecorator(_)
            | Parent::MemberDecorator(_)
            | Parent::ParamDecorator(_) => return FunctionPosition::ImplicitBlock,
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
        FnKind::Arrow
        | FnKind::Method
        | FnKind::Getter
        | FnKind::Setter
        | FnKind::Constructor
        | FnKind::StaticBlock
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => DeclarationKind::NoBinding,
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
        Decl::Interface(_)
        | Decl::Alias(_)
        | Decl::EnumMember(_)
        | Decl::TypeParam(_)
        | Decl::ExportSpec(_)
        | Decl::ExportStarAs(_)
        | Decl::ExportExpr(_)
        | Decl::UmdGlobal(_)
        | Decl::File
        | Decl::ModuleExports(_)
        | Decl::ExportsProperty(_)
        | Decl::Expando(_)
        | Decl::ObjectLiteral(_)
        | Decl::CommonJsVariable
        | Decl::Member(_)
        | Decl::ParameterProperty(_)
        | Decl::ThisProperty(_)
        | Decl::Property(_)
        | Decl::TypeLiteral(_) => DeclarationKind::NoBinding,
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

pub(super) fn needs_unique_parameters(hir: &File<'_>, func: &Func) -> bool {
    matches!(
        func.kind,
        FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
    ) || func.params.iter().any(|param| {
        let param = &hir[param];
        param.default.is_some()
            || param.flags.contains(Flags::REST)
            || !matches!(hir[param.pat].kind, PatKind::Ident(_))
    })
}
