use super::BindingKind;
use super::bits::has_bit;
use super::declaration_kinds::{DeclarationKind, declaration_kind, variable_declaration};
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
        let kind = declaration_binding_kind(hir, bound, decl);
        if kind != BindingKind::NoBinding && runtime_symbol(bound, decl) == symbol {
            kind
        } else {
            BindingKind::NoBinding
        }
    });
    kinds.max().unwrap_or(BindingKind::NoBinding)
}

fn declaration_binding_kind(hir: &File<'_>, bound: &BoundBuilder, decl: Decl) -> BindingKind {
    match declaration_kind(hir, bound, decl) {
        DeclarationKind::Var => BindingKind::Var,
        DeclarationKind::Parameter => BindingKind::Parameter,
        DeclarationKind::TopLevelFunction | DeclarationKind::BlockFunction => BindingKind::Function,
        DeclarationKind::Lexical => lexical_binding_kind(hir, bound, decl),
        DeclarationKind::Import => BindingKind::Import,
        DeclarationKind::SimpleCatchParameter => BindingKind::SimpleCatchParameter,
        DeclarationKind::TypeScriptValue => typescript_binding_kind(decl),
        DeclarationKind::ImplicitBlockFunction | DeclarationKind::BlockScopedRequire => {
            BindingKind::NoBinding
        }
        DeclarationKind::NoBinding => exported_binding_kind(hir, decl),
    }
}

fn lexical_binding_kind(hir: &File<'_>, bound: &BoundBuilder, decl: Decl) -> BindingKind {
    match decl {
        Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
            variable_binding_kind(hir, bound, pat)
        }
        Decl::Fn(f) => match hir[f].kind {
            FnKind::Expr => BindingKind::FunctionName,
            FnKind::Decl => BindingKind::Function,
            _ => BindingKind::NoBinding,
        },
        Decl::Class(c) => match bound.class_owner[c.idx()] {
            ClassOwner::Stmt(_) => BindingKind::Class,
            ClassOwner::Expr(_) => BindingKind::NoBinding,
        },
        _ => BindingKind::NoBinding,
    }
}

fn typescript_binding_kind(decl: Decl) -> BindingKind {
    match decl {
        Decl::Enum(_) | Decl::Module(_) => BindingKind::TypeScriptContainer,
        Decl::Var(_) | Decl::Param(_) | Decl::Require(_) | Decl::Fn(_) | Decl::Class(_) => {
            BindingKind::NoBinding
        }
        _ => BindingKind::Const,
    }
}

fn is_default_export(hir: &File<'_>, statement: StmtId) -> bool {
    matches!(hir[statement].kind, StmtKind::ExportDefault(_))
}

fn exported_binding_kind(hir: &File<'_>, decl: Decl) -> BindingKind {
    match decl {
        Decl::EnumMember(_) => BindingKind::Const,
        Decl::ExportExpr(statement) if is_default_export(hir, statement) => BindingKind::Let,
        _ => BindingKind::NoBinding,
    }
}

fn runtime_symbol(bound: &BoundBuilder, decl: Decl) -> SymbolId {
    if let Decl::EnumMember(member) = decl {
        return bound.enum_member_symbol[member.idx()];
    }
    let symbol = bound.declared_binding_symbol(decl);
    symbol.unwrap_or(SymbolId::NONE)
}
