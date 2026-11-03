use super::{AnythingReason, ShapeKind, TypeShape};
use crate::atom::known;
use crate::check::aot::answers::GaveUp;
use crate::check::aot::builtin_types::Denotation;
use crate::check::aot::queries::Queries;
use crate::program::Sym;
use crate::types::{Origin, TypeData, TypeId};

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(super) fn shape_of_reference(
        &mut self,
        ty: TypeId,
        target: Sym,
    ) -> Result<TypeShape<'c>, GaveUp> {
        if self.c.is_array(ty) {
            let arguments = self.c.type_arguments(ty);
            let element = *arguments.first().ok_or(GaveUp::Unresolved)?;
            let is_readonly = self.c.is_reference_to_global(ty, known::ReadonlyArray, 1);
            return Ok(TypeShape::undeclared(ShapeKind::Array {
                element,
                is_readonly,
            }));
        }
        if self.c.is_reference_to_global(ty, known::Object, 0) {
            return Ok(TypeShape::undeclared(ShapeKind::Anything(
                AnythingReason::EmptyObjectType,
            )));
        }
        if self.c.is_reference_to_global(ty, known::Function, 0) {
            return Ok(TypeShape::undeclared(ShapeKind::Function(&[])));
        }
        if let Some(class) = self.inputs.builtin_types.class_of(target) {
            let arguments = self.own_type_arguments(ty, target)?;
            return Ok(TypeShape::undeclared(ShapeKind::Builtin {
                class,
                arguments,
            }));
        }
        if let Some(class) = self.compiled_class(target) {
            let trust = self.file_trust(class.file);
            return Ok(TypeShape::declared(ShapeKind::Class(class), trust));
        }
        let own = self.shape_of_object_type(ty);
        if !matches!(own.kind, ShapeKind::Object) {
            return Ok(own);
        }
        // An interface that extends an array type or `Map` describes arrays or maps that have some more properties: `interface NodeArray<T> extends ReadonlyArray<T>, TextRange`.
        match self.builtin_base(ty)? {
            Some(base) if base.builtin_denotation() == Some(Denotation::Exact) => Ok(base),
            Some(_) | None => Ok(own),
        }
    }

    fn own_type_arguments(&mut self, ty: TypeId, target: Sym) -> Result<&'c [TypeId], GaveUp> {
        let outer = self.c.outer_type_params_of_symbol(target).len();
        let own = self.c.local_type_params_of_symbol(target).len();
        let arguments = self.c.type_arguments(ty);
        let own_range = outer..outer + own;
        let own_arguments = arguments.get(own_range).ok_or(GaveUp::Unresolved)?;
        Ok(self.list(own_arguments))
    }

    pub(super) fn shape_of_anonymous_type(&mut self, ty: TypeId, origin: Origin) -> TypeShape<'c> {
        match origin {
            Origin::TypeLiteral(..) | Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..) => {
                self.shape_of_object_type(ty)
            }
            Origin::Mapped(..) => {
                if self.c.is_generic_mapped_type(ty) {
                    return TypeShape::undeclared(ShapeKind::TypeVariable {
                        constraint: None,
                        parameter: None,
                    });
                }
                self.shape_of_object_type(ty)
            }
            Origin::ClassStatic(symbol) => {
                if let Some(class) = self.compiled_class(symbol) {
                    let trust = self.file_trust(class.file);
                    return TypeShape::declared(ShapeKind::ClassConstructor(class), trust);
                }
                let constructs = self.c.signatures(ty, true);
                let trust = self.symbol_trust(symbol);
                TypeShape::declared(ShapeKind::Function(self.list(&constructs)), trust)
            }
            Origin::Function(symbol) => {
                let calls = self.c.signatures(ty, false);
                let trust = self.symbol_trust(symbol);
                TypeShape::declared(ShapeKind::Function(self.list(&calls)), trust)
            }
            Origin::EnumObject(symbol)
            | Origin::Module(symbol)
            | Origin::Namespace { module: symbol, .. } => {
                TypeShape::declared(ShapeKind::AnyObject, self.symbol_trust(symbol))
            }
            Origin::GlobalThis => TypeShape::undeclared(ShapeKind::AnyObject),
        }
    }

    // The members that instantiations share say whether there is a signature, so none is instantiated to find that there is none.
    fn has_no_signature(&mut self, ty: TypeId) -> bool {
        let is_own_apparent_type = match self.c.data(ty) {
            TypeData::Ref { .. } | TypeData::Synth(_) => true,
            TypeData::Anon { origin, .. } => matches!(
                origin,
                Origin::TypeLiteral(..) | Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..)
            ),
            _ => false,
        };
        is_own_apparent_type
            && self
                .c
                .members(ty)
                .is_some_and(|members| !members.has_signatures())
    }

    pub(super) fn shape_of_object_type(&mut self, ty: TypeId) -> TypeShape<'c> {
        if matches!(
            ty,
            TypeId::EMPTY_OBJECT | TypeId::UNKNOWN_EMPTY_OBJECT | TypeId::EMPTY_TYPE_LITERAL
        ) || self.c.is_empty_object_type(ty)
        {
            return TypeShape::undeclared(ShapeKind::Anything(AnythingReason::EmptyObjectType));
        }
        let trust = self.object_type_trust(ty);
        if self.has_no_signature(ty) {
            return TypeShape::declared(ShapeKind::Object, trust);
        }
        let calls = self.c.signatures(ty, false);
        if !calls.is_empty() {
            return TypeShape::declared(ShapeKind::Function(self.list(&calls)), trust);
        }
        let constructs = self.c.signatures(ty, true);
        if !constructs.is_empty() {
            return TypeShape::declared(ShapeKind::Function(self.list(&constructs)), trust);
        }
        TypeShape::declared(ShapeKind::Object, trust)
    }
}
