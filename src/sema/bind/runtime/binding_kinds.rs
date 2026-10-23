use super::BindingKind;
use super::bits::has_bit;
use super::declaration_kinds::{
    Declaration, DeclarationKind, SymbolColumn, symbol_column, variable_declaration,
};
use crate::bind::{BoundBuilder, ClassOwner, Decl, SymbolId};
use crate::hir::*;

pub(super) fn record_binding_kind(bound: &mut BoundBuilder, symbol: SymbolId, kind: BindingKind) {
    let recorded = &mut bound.runtime.declarations.binding_kinds[symbol.idx()];
    *recorded = (*recorded).max(kind);
}

pub(super) fn record_declared_binding_kinds(hir: &File<'_>, bound: &mut BoundBuilder) {
    for index in 0..bound.runtime.first_appended_symbol {
        let symbol = SymbolId(index);
        let kind = declared_binding_kind(hir, bound, symbol);
        record_binding_kind(bound, symbol, kind);
    }
}

pub(super) fn variable_binding_kind(
    hir: &File<'_>,
    bound: &BoundBuilder,
    pat: PatId,
) -> BindingKind {
    match variable_declaration(bound, pat).map(|declaration| bound.variable_kind(hir, declaration))
    {
        None => BindingKind::NoBinding,
        Some(VarKind::Var) => BindingKind::Var,
        Some(VarKind::Let) => BindingKind::Let,
        Some(VarKind::Const | VarKind::Using | VarKind::AwaitUsing) => BindingKind::Const,
    }
}

fn declared_binding_kind(hir: &File<'_>, bound: &BoundBuilder, symbol: SymbolId) -> BindingKind {
    if has_bit(&bound.runtime.declarations.valueless_symbols, symbol.idx()) {
        return BindingKind::NoBinding;
    }
    let decls = bound.symbols[symbol.idx()].decls.iter();
    let kinds = decls.map(|&decl| {
        let kind = declaration_binding_kind(hir, bound, Declaration::new(hir, bound, decl));
        if kind != BindingKind::NoBinding && runtime_symbol(bound, decl) == symbol {
            kind
        } else {
            BindingKind::NoBinding
        }
    });
    kinds.max().unwrap_or(BindingKind::NoBinding)
}

fn declaration_binding_kind(
    hir: &File<'_>,
    bound: &BoundBuilder,
    declaration: Declaration,
) -> BindingKind {
    match declaration.kind {
        DeclarationKind::Var => BindingKind::Var,
        DeclarationKind::Parameter => BindingKind::Parameter,
        DeclarationKind::TopLevelFunction | DeclarationKind::BlockFunction => BindingKind::Function,
        DeclarationKind::Lexical => lexical_binding_kind(hir, bound, declaration.decl),
        DeclarationKind::Import => BindingKind::Import,
        DeclarationKind::SimpleCatchParameter => BindingKind::SimpleCatchParameter,
        DeclarationKind::TypeScriptValue => typescript_binding_kind(declaration.decl),
        DeclarationKind::ImplicitBlockFunction | DeclarationKind::BlockScopedRequire => {
            BindingKind::NoBinding
        }
        DeclarationKind::NoBinding => exported_binding_kind(hir, declaration.decl),
    }
}

fn lexical_binding_kind(hir: &File<'_>, bound: &BoundBuilder, decl: Decl) -> BindingKind {
    match symbol_column(decl) {
        SymbolColumn::Pattern(pat) => variable_binding_kind(hir, bound, pat),
        SymbolColumn::Function(f) => match hir[f].kind {
            FnKind::Expr => BindingKind::FunctionName,
            FnKind::Decl => BindingKind::Function,
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
            | FnKind::IndexSignature => BindingKind::NoBinding,
        },
        SymbolColumn::Class(c) => match bound.class_owner[c.idx()] {
            ClassOwner::Stmt(_) => BindingKind::Class,
            ClassOwner::Expr(_) => BindingKind::NoBinding,
        },
        SymbolColumn::Enum(_) | SymbolColumn::Module(_) | SymbolColumn::None => {
            BindingKind::NoBinding
        }
    }
}

fn typescript_binding_kind(decl: Decl) -> BindingKind {
    match symbol_column(decl) {
        SymbolColumn::Enum(_) | SymbolColumn::Module(_) => BindingKind::TypeScriptContainer,
        SymbolColumn::None => BindingKind::Const,
        SymbolColumn::Pattern(_) | SymbolColumn::Function(_) | SymbolColumn::Class(_) => {
            BindingKind::NoBinding
        }
    }
}

fn is_default_export(hir: &File<'_>, statement: StmtId) -> bool {
    matches!(hir[statement].kind, StmtKind::ExportDefault(_))
}

fn exported_binding_kind(hir: &File<'_>, decl: Decl) -> BindingKind {
    match decl {
        Decl::EnumMember(_) => BindingKind::Const,
        Decl::ExportExpr(statement) if is_default_export(hir, statement) => BindingKind::Let,
        Decl::ExportExpr(_)
        | Decl::Var(_)
        | Decl::Param(_)
        | Decl::Fn(_)
        | Decl::Class(_)
        | Decl::Interface(_)
        | Decl::Alias(_)
        | Decl::Enum(_)
        | Decl::Module(_)
        | Decl::TypeParam(_)
        | Decl::ImportDefault(_)
        | Decl::ImportNamespace(_)
        | Decl::ImportSpec(_)
        | Decl::ImportEquals(_)
        | Decl::ExportSpec(_)
        | Decl::ExportStarAs(_)
        | Decl::UmdGlobal(_)
        | Decl::File
        | Decl::Require(_)
        | Decl::ModuleExports(_)
        | Decl::ExportsProperty(_)
        | Decl::Expando(_)
        | Decl::ObjectLiteral(_)
        | Decl::CommonJsVariable
        | Decl::Member(_)
        | Decl::ParameterProperty(_)
        | Decl::ThisProperty(_)
        | Decl::Property(_)
        | Decl::TypeLiteral(_) => BindingKind::NoBinding,
    }
}

fn runtime_symbol(bound: &BoundBuilder, decl: Decl) -> SymbolId {
    if let Decl::EnumMember(member) = decl {
        return bound.enum_member_symbol[member.idx()];
    }
    let symbol = bound.declared_binding_symbol(decl);
    symbol.unwrap_or(SymbolId::NONE)
}
