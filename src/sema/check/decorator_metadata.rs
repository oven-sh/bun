//! What a compiler asks the checker to emit the `design:*` values of `emitDecoratorMetadata`.
//!
//! Mirrors `GetTypeReferenceSerializationKind` in TypeScript 7.0.2's emitresolver.go, and the test that
//! `markEntityNameOrEntityExpressionAsReference` in checker.go makes before `markAliasSymbolAsReferenced`.

use super::symbols::AliasTarget;
use super::*;
use crate::bind::{Decl, ModuleInstanceState, ScopeId, ScopeKind};

/// `TypeReferenceSerializationKind`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TypeReferenceSerializationKind {
    Unknown,
    TypeWithConstructSignatureAndValue,
    VoidNullableOrNeverType,
    NumberLikeType,
    BigIntLikeType,
    StringLikeType,
    BooleanType,
    ArrayLikeType,
    ESSymbolType,
    Promise,
    TypeWithCallSignature,
    ObjectType,
}

/// A type reference in the signature of a member of a class that has a decorator.
#[derive(Copy, Clone, Debug)]
pub struct DecoratorMetadataReference {
    /// Position of the first identifier of its name.
    pub pos: u32,
    pub kind: TypeReferenceSerializationKind,
    /// True if `markEntityNameOrEntityExpressionAsReference` keeps the import that declares the first identifier.
    pub marks_alias_as_referenced: bool,
}

impl<'p, 's> Checker<'p, 's> {
    /// Returns the type references that `serializeTypeNode` can reach in `file`, sorted by position.
    pub fn decorator_metadata_references(
        &mut self,
        file: FileId,
    ) -> Vec<DecoratorMetadataReference> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decorated = hir.decorators.iter();
        let mut classes: Vec<ClassId> = decorated
            .filter_map(|&(owner, _)| Some(self.class_of_decorated(file, owner)?.0))
            .collect();
        classes.sort_unstable();
        classes.dedup();
        let mut references: Vec<TypeNodeId> = Vec::new();
        for m in classes.into_iter().flat_map(|c| hir[c].members.iter()) {
            reachable_type_references(hir, hir[m].ty, &mut references);
            let f = hir[m].func;
            if f.is_some() {
                for p in hir[f].params.iter() {
                    reachable_type_references(hir, hir[p].ty, &mut references);
                }
                reachable_type_references(hir, hir[f].ret, &mut references);
            }
        }
        let mut found: Vec<DecoratorMetadataReference> = Vec::with_capacity(references.len());
        for reference in references {
            let TypeNodeKind::Ref { name, .. } = hir[reference].kind else {
                continue;
            };
            let scope = bound.type_scope[reference.idx()];
            if name.is_empty() || scope.is_none() {
                continue;
            }
            // `currentNameScope`: the class.
            let mut location = scope;
            while !matches!(bound.scopes[location.idx()].kind, ScopeKind::Class(_)) {
                location = bound.scopes[location.idx()].parent;
            }
            found.push(DecoratorMetadataReference {
                pos: hir[name.at(0)].pos(),
                kind: self.type_reference_serialization_kind(file, name, location),
                marks_alias_as_referenced: self.marks_alias_as_referenced(file, name, scope),
            });
        }
        found.sort_unstable_by_key(|it| it.pos);
        found
    }

    /// `GetTypeReferenceSerializationKind`
    fn type_reference_serialization_kind(
        &mut self,
        file: FileId,
        type_name: Span<NameId>,
        location: ScopeId,
    ) -> TypeReferenceSerializationKind {
        use TypeReferenceSerializationKind as Kind;
        let files = self.files();
        let mut is_type_only = false;
        if type_name.len() > 1 {
            let first_identifier = Span::new(type_name.start, 1);
            let root_value_symbol =
                self.resolve_entity_name(file, location, first_identifier, SymFlags::VALUE, true);
            is_type_only = root_value_symbol.is_some_and(|root| {
                let declarations = &files.symbol(root).decls;
                !declarations.is_empty()
                    && (declarations.iter())
                        .all(|&d| files.is_type_only_import_or_export_declaration(root.file, d))
            });
        }
        let value_symbol =
            self.resolve_entity_name(file, location, type_name, SymFlags::VALUE, true);
        let resolved_value_symbol = value_symbol.map(|it| self.resolve_alias_if_alias(it));
        is_type_only |= value_symbol
            .is_some_and(|it| self.get_type_only_alias_declaration_ex(it, SymFlags::VALUE));

        let type_symbol = self.resolve_entity_name(file, location, type_name, SymFlags::TYPE, true);
        let resolved_type_symbol = type_symbol.map(|it| self.resolve_alias_if_alias(it));
        is_type_only |= type_symbol
            .is_some_and(|it| self.get_type_only_alias_declaration_ex(it, SymFlags::TYPE));

        if let (Some(AliasTarget::Symbol(value)), Some(AliasTarget::Symbol(ty))) =
            (resolved_value_symbol, resolved_type_symbol)
            && value == ty
        {
            if self.get_global_symbol(known::Promise, SymFlags::VALUE, None) == Some(value) {
                return Kind::Promise;
            }
            let constructor_type = self.type_of_symbol(value);
            if self.is_constructor_type(constructor_type) {
                return if is_type_only {
                    Kind::TypeWithCallSignature
                } else {
                    Kind::TypeWithConstructSignatureAndValue
                };
            }
        }

        let unresolved = if is_type_only {
            Kind::ObjectType
        } else {
            Kind::Unknown
        };
        // The declared type of `unknownSymbol`, and of a property, is the error type.
        let Some(AliasTarget::Symbol(resolved_type_symbol)) = resolved_type_symbol else {
            return unresolved;
        };
        let ty = self.declared_type(resolved_type_symbol);
        if self.is_error_type(ty) {
            return unresolved;
        }
        if self.flags(ty) & (tf::ANY | tf::UNKNOWN) != 0 {
            Kind::ObjectType
        } else if self.is_type_assignable_to_kind(ty, tf::VOID | tf::NULLABLE | tf::NEVER) {
            Kind::VoidNullableOrNeverType
        } else if self.is_type_assignable_to_kind(ty, tf::BOOLEAN_LIKE) {
            Kind::BooleanType
        } else if self.is_type_assignable_to_kind(ty, tf::NUMBER_LIKE) {
            Kind::NumberLikeType
        } else if self.is_type_assignable_to_kind(ty, tf::BIGINT_LIKE) {
            Kind::BigIntLikeType
        } else if self.is_type_assignable_to_kind(ty, tf::STRING_LIKE) {
            Kind::StringLikeType
        } else if self.is_tuple(ty) {
            Kind::ArrayLikeType
        } else if self.is_type_assignable_to_kind(ty, tf::ES_SYMBOL_LIKE) {
            Kind::ESSymbolType
        } else if self.is_object_type(ty) && !self.signatures(ty, false).is_empty() {
            // `isFunctionType`
            Kind::TypeWithCallSignature
        } else if self.is_array(ty) {
            Kind::ArrayLikeType
        } else {
            Kind::ObjectType
        }
    }

    fn resolve_alias_if_alias(&mut self, symbol: Sym) -> AliasTarget {
        if self.files().flags(symbol).contains(SymFlags::ALIAS) {
            self.resolve_alias(symbol)
        } else {
            AliasTarget::Symbol(symbol)
        }
    }

    /// `getTypeOnlyAliasDeclarationEx(symbol, include) != nil`
    fn get_type_only_alias_declaration_ex(&mut self, symbol: Sym, include: SymFlags) -> bool {
        let files = self.files();
        if !files.flags(symbol).contains(SymFlags::ALIAS)
            || files.alias_links(symbol).type_only_declaration.is_none()
        {
            return false;
        }
        match self.resolve_alias(symbol) {
            AliasTarget::Symbol(resolved) => self.get_symbol_flags(resolved).intersects(include),
            // `unknownSymbol` is a property too.
            AliasTarget::Property(..) | AliasTarget::Unknown => {
                include.intersects(SymFlags::PROPERTY)
            }
        }
    }

    /// `isTypeAssignableToKind`, for the kinds above.
    fn is_type_assignable_to_kind(&mut self, source: TypeId, kind: u32) -> bool {
        if self.flags(source) & kind != 0 {
            return true;
        }
        [
            (tf::NUMBER_LIKE, TypeId::NUMBER),
            (tf::BIGINT_LIKE, TypeId::BIGINT),
            (tf::STRING_LIKE, TypeId::STRING),
            (tf::BOOLEAN_LIKE, TypeId::BOOLEAN),
            (tf::VOID, TypeId::VOID),
            (tf::NEVER, TypeId::NEVER),
            (tf::NULL, TypeId::NULL),
            (tf::UNDEFINED, TypeId::UNDEFINED),
            (tf::ES_SYMBOL, TypeId::SYMBOL),
        ]
        .into_iter()
        .any(|(flag, target)| kind & flag != 0 && self.is_assignable(source, target))
    }

    /// `markEntityNameOrEntityExpressionAsReference`: true if it calls `markAliasSymbolAsReferenced`.
    fn marks_alias_as_referenced(
        &mut self,
        file: FileId,
        type_name: Span<NameId>,
        scope: ScopeId,
    ) -> bool {
        let files = self.files();
        let meaning = SymFlags::ALIAS
            | if type_name.len() == 1 {
                SymFlags::TYPE
            } else {
                SymFlags::NAMESPACE
            };
        let root_name = self.hir(file)[type_name.at(0)].text;
        let Some(root_symbol) = files.resolve_name(file, scope, root_name, meaning) else {
            return false;
        };
        files.flags(root_symbol).contains(SymFlags::ALIAS)
            && self.symbol_is_value(root_symbol)
            && !matches!(self.resolve_alias(root_symbol), AliasTarget::Symbol(target)
                if self.is_const_enum_or_const_enum_only_module(target))
            && files
                .alias_links(root_symbol)
                .type_only_declaration
                .is_none()
    }

    /// `isConstEnumOrConstEnumOnlyModule`
    fn is_const_enum_or_const_enum_only_module(&self, symbol: Sym) -> bool {
        let flags = self.files().flags(symbol);
        if flags.contains(SymFlags::CONST_ENUM) {
            return true;
        }
        if flags.intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::REGULAR_ENUM) {
            return false;
        }
        let states = &self.bound(symbol.file).module_instance_state;
        let declarations = self.files().symbol(symbol).decls.iter();
        let mut instantiated = declarations
            .filter_map(|&d| match d {
                Decl::Module(m) => Some(states[m.idx()]),
                _ => None,
            })
            .filter(|&state| state != ModuleInstanceState::NonInstantiated)
            .peekable();
        instantiated.peek().is_some()
            && instantiated.all(|state| state == ModuleInstanceState::ConstEnumOnly)
    }
}

/// Adds the type references in `ty` that `serializeTypeNode` or `GetRestParameterElementType` can reach.
fn reachable_type_references(hir: &File, ty: TypeNodeId, references: &mut Vec<TypeNodeId>) {
    if ty.is_none() {
        return;
    }
    match hir[ty].kind {
        TypeNodeKind::Ref { args, .. } => {
            references.push(ty);
            if !args.is_empty() {
                reachable_type_references(hir, hir.id_at(args, 0), references);
            }
        }
        TypeNodeKind::Array(inner)
        | TypeNodeKind::Readonly(inner)
        | TypeNodeKind::JSDoc { ty: inner, .. } => {
            reachable_type_references(hir, inner, references);
        }
        TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
            for part in hir.ids(types) {
                reachable_type_references(hir, part, references);
            }
        }
        TypeNodeKind::Cond { yes, no, .. } => {
            reachable_type_references(hir, yes, references);
            reachable_type_references(hir, no, references);
        }
        _ => {}
    }
}
