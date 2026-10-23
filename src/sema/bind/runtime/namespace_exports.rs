use super::declaration_kinds::{DeclarationKind, declaration_kind};
use super::{BindingKind, RuntimeDeclarationsIn, RuntimeScopes};
use crate::bind::{BoundBuilder, Decl, ScopeKind, SymbolId};
use crate::hir::*;
use crate::util::SharedSort;

#[derive(Copy, Clone)]
enum NamespaceDeclaration {
    Variable,
    Function(FnId),
    Class(ClassId),
    Enum(EnumId),
    Module(ModuleId),
    NoBinding,
}

impl NamespaceDeclaration {
    fn binding_kind(self) -> BindingKind {
        match self {
            NamespaceDeclaration::Function(_) => BindingKind::Function,
            NamespaceDeclaration::Class(_) => BindingKind::Class,
            NamespaceDeclaration::Enum(_) | NamespaceDeclaration::Module(_) => {
                BindingKind::TypeScriptContainer
            }
            NamespaceDeclaration::Variable | NamespaceDeclaration::NoBinding => {
                BindingKind::NoBinding
            }
        }
    }
}

fn classify_declaration(decl: Decl) -> NamespaceDeclaration {
    match decl {
        Decl::Var(_) | Decl::Require(_) => NamespaceDeclaration::Variable,
        Decl::Fn(function) => NamespaceDeclaration::Function(function),
        Decl::Class(class) => NamespaceDeclaration::Class(class),
        Decl::Enum(id) => NamespaceDeclaration::Enum(id),
        Decl::Module(module) => NamespaceDeclaration::Module(module),
        _ => NamespaceDeclaration::NoBinding,
    }
}

pub(super) fn is_block_binding(bound: &BoundBuilder, kind: ScopeKind, local: SymbolId) -> bool {
    let mut decls = bound.symbols[local.idx()].decls.iter();
    matches!(kind, ScopeKind::Module(_))
        && decls.all(|&decl| !matches!(classify_declaration(decl), NamespaceDeclaration::Variable))
}

#[derive(Default)]
pub(super) struct ExportedBlockBindings {
    functions: Vec<(FnId, SymbolId)>,
    classes: Vec<(ClassId, SymbolId)>,
    enums: Vec<(EnumId, SymbolId)>,
    modules: Vec<(ModuleId, SymbolId)>,
    kinds: Vec<(SymbolId, BindingKind)>,
}

impl ExportedBlockBindings {
    pub(super) fn collect(
        hir: &File<'_>,
        bound: &BoundBuilder,
        scopes: &RuntimeScopes,
    ) -> ExportedBlockBindings {
        let mut bindings = ExportedBlockBindings::default();
        for scope in bound.scopes.iter() {
            if !matches!(scope.kind, ScopeKind::Module(_)) {
                continue;
            }
            for &(_, local) in bound.table(scope.locals) {
                if bound.export_symbol_of_value_symbol_if_exported(local) != local
                    && scopes.is_scope_binding(bound, local)
                    && is_block_binding(bound, scope.kind, local)
                {
                    bindings.add(hir, bound, local);
                }
            }
        }
        bindings
            .functions
            .shared_sort_unstable_by_key(|entry| entry.0);
        bindings
            .classes
            .shared_sort_unstable_by_key(|entry| entry.0);
        bindings.enums.shared_sort_unstable_by_key(|entry| entry.0);
        bindings
            .modules
            .shared_sort_unstable_by_key(|entry| entry.0);
        bindings
    }

    fn add(&mut self, hir: &File<'_>, bound: &BoundBuilder, local: SymbolId) {
        let mut kind = BindingKind::NoBinding;
        for &decl in bound.symbols[local.idx()].decls.iter() {
            let declaration = classify_declaration(decl);
            match declaration {
                NamespaceDeclaration::Function(function) => self.functions.push((function, local)),
                NamespaceDeclaration::Class(class) => self.classes.push((class, local)),
                NamespaceDeclaration::Enum(id) => self.enums.push((id, local)),
                NamespaceDeclaration::Module(module) => self.modules.push((module, local)),
                NamespaceDeclaration::Variable | NamespaceDeclaration::NoBinding => {}
            }
            if declaration_kind(hir, bound, decl) != DeclarationKind::NoBinding {
                kind = kind.max(declaration.binding_kind());
            }
        }
        self.kinds.push((local, kind));
    }

    pub(super) fn record(self, declarations: &mut RuntimeDeclarationsIn<Growable>) {
        declarations.function_symbols.extend(self.functions);
        declarations
            .function_symbols
            .shared_sort_by_key(|entry| entry.0);
        declarations.class_symbols = self.classes;
        declarations.enum_symbols = self.enums;
        declarations.module_symbols = self.modules;
        for (local, kind) in self.kinds {
            declarations.binding_kinds[local.idx()] = kind;
        }
    }
}
