use super::{BuiltinShape, ShapeKind, TypeShape};
use crate::atom::Atom;
use crate::check::aot::answers::{ClassRef, GaveUp, MemberName};
use crate::check::aot::builtin_types::{BuiltinClassIndex, Denotation};
use crate::check::aot::queries::Queries;
use crate::check::relate::Relation;
use crate::program::Sym;
use crate::types::{MapperId, PropFlags, TypeData, TypeId};
use smallvec::SmallVec;

#[derive(Default)]
struct FoundBases<'c> {
    exact: Option<TypeShape<'c>>,
    view: Option<TypeShape<'c>>,
}

impl<'c> FoundBases<'c> {
    fn add(&mut self, base: Option<TypeShape<'c>>) {
        let Some(base) = base else {
            return;
        };
        match base.builtin_denotation() {
            Some(Denotation::Exact) => self.exact.get_or_insert(base),
            Some(Denotation::View) | None => self.view.get_or_insert(base),
        };
    }

    fn best(self) -> Option<TypeShape<'c>> {
        self.exact.or(self.view)
    }
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub(in crate::check::aot) fn compute_builtin_base(
        &mut self,
        ty: TypeId,
    ) -> Result<Option<TypeShape<'c>>, GaveUp> {
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => self.builtin_base_of_reference(ty, *target),
            TypeData::Intersection(parts) => {
                let mut found = FoundBases::default();
                for &part in parts.iter() {
                    found.add(self.builtin_type_or_base(part)?);
                }
                Ok(found.best())
            }
            _ => Ok(None),
        }
    }

    fn builtin_type_or_base(&mut self, ty: TypeId) -> Result<Option<TypeShape<'c>>, GaveUp> {
        let shape = self.type_shape(ty)?;
        match shape.builtin_shape() {
            Some(_) => Ok(Some(shape)),
            None => self.builtin_base(ty),
        }
    }

    fn builtin_base_of_reference(
        &mut self,
        ty: TypeId,
        target: Sym,
    ) -> Result<Option<TypeShape<'c>>, GaveUp> {
        let bases = self.c.base_types(target);
        if bases.is_empty() {
            return Ok(None);
        }
        let parameters = self.c.all_type_params_of_symbol(target);
        let mapper = match self.c.type_arguments(ty).get(..parameters.len()) {
            Some(arguments) if !arguments.is_empty() => self.c.mapper_from(&parameters, arguments),
            Some(_) | None => MapperId::IDENTITY,
        };
        let trust = self.symbol_trust(target);
        let mut found = FoundBases::default();
        for &base in bases.iter() {
            let base = self.c.instantiate(base, mapper);
            let base = self.builtin_type_or_base(base)?;
            found.add(base.map(|base| TypeShape::declared(base.kind, trust.weakest(base.trust))));
        }
        Ok(found.best())
    }

    pub(in crate::check::aot) fn compute_accepted_builtins(
        &mut self,
        ty: TypeId,
    ) -> Result<&'c [BuiltinShape], GaveUp> {
        let ty = self.declared_type_of_this(ty);
        if !matches!(self.type_shape(ty)?.kind, ShapeKind::Object) {
            return Ok(&[]);
        }
        let mut accepted: SmallVec<[BuiltinShape; 2]> = SmallVec::new();
        let own_base = self.builtin_base(ty)?;
        accepted.extend(own_base.and_then(TypeShape::builtin_shape));
        let subtypes = self.inputs.builtin_types.program_subtypes();
        let Some(members) = self.c.members(ty).filter(|_| !subtypes.is_empty()) else {
            return Ok(self.list(&accepted));
        };
        let target = self.c.permissive_instantiation(ty);
        for &subtype in subtypes {
            let declared = self.c.declared_type(subtype);
            if !self.has_required_properties(declared, members.shape()) {
                continue;
            }
            let base = self.builtin_type_or_base(declared)?;
            let Some(builtin) = base.and_then(TypeShape::builtin_shape) else {
                continue;
            };
            if accepted.contains(&builtin) || !self.has_exact_type(builtin) {
                continue;
            }
            let source = self.c.permissive_instantiation(declared);
            if self.is_related(source, target, Relation::Assignable)? {
                accepted.push(builtin);
            }
        }
        Ok(self.list(&accepted))
    }

    /// Whether `ty` is written for instances of the built-in class: the class, a class that extends it, or an object type that they fit. A type that every object fits says nothing.
    pub fn is_type_of_builtin(
        &mut self,
        ty: TypeId,
        class: BuiltinClassIndex,
    ) -> Result<bool, GaveUp> {
        match self.type_shape(ty)?.kind {
            ShapeKind::TypeVariable { constraint, .. } => match constraint {
                Some(constraint) => self.is_type_of_builtin(constraint, class),
                None => Ok(false),
            },
            ShapeKind::Union(members) => {
                for &member in members {
                    if self.is_type_of_builtin(member, class)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            ShapeKind::Builtin { class: found, .. } => Ok(found.class == class),
            ShapeKind::Class(_) | ShapeKind::Object => {
                let Some(members) = self.c.members(ty) else {
                    return Ok(false);
                };
                let mut props = members.shape().props.iter();
                if !props.any(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) {
                    return Ok(false);
                }
                let types: SmallVec<[Sym; 1]> = self.inputs.builtin_types.types_of(class).collect();
                for symbol in types {
                    let instance = self.c.declared_type(symbol);
                    let Some(instance_members) = self.c.members(instance) else {
                        continue;
                    };
                    // Nearly every type names a member that the other lacks, and is told apart without a type being made.
                    let fits = self.has_required_properties(instance, members.shape());
                    let extends = self.has_required_properties(ty, instance_members.shape());
                    if !fits && !extends {
                        continue;
                    }
                    let declared = self.c.permissive_instantiation(ty);
                    let instance = self.c.permissive_instantiation(instance);
                    if (fits && self.is_related(instance, declared, Relation::Assignable)?)
                        || (extends && self.is_related(declared, instance, Relation::Assignable)?)
                    {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            _ => Ok(false),
        }
    }

    /// Whether the types of the built-in class declare the member themselves.
    pub(in crate::check::aot) fn is_member_of_builtin(
        &mut self,
        name: Atom,
        class: BuiltinClassIndex,
    ) -> bool {
        let types: SmallVec<[Sym; 1]> = self.inputs.builtin_types.types_of(class).collect();
        types.into_iter().any(|symbol| {
            let instance = self.c.declared_type(symbol);
            let Some(members) = self.c.members(instance) else {
                return false;
            };
            members.shape().props.iter().any(|prop| prop.name == name)
        })
    }

    pub(in crate::check::aot) fn compute_accepted_class_constructors(
        &mut self,
        ty: TypeId,
    ) -> Result<&'c [ClassRef], GaveUp> {
        let ty = self.declared_type_of_this(ty);
        if !matches!(self.type_shape(ty)?.kind, ShapeKind::Object) {
            return Ok(&[]);
        }
        let Some(members) = self.c.members(ty) else {
            return Ok(&[]);
        };
        let mut props = members.shape().props.iter();
        let Some(required) = props.find(|prop| !prop.flags.contains(PropFlags::OPTIONAL)) else {
            return Ok(&[]);
        };
        let MemberName::String(name) = self.member_name(required.name) else {
            return Ok(&[]);
        };
        let mut accepted: SmallVec<[ClassRef; 2]> = SmallVec::new();
        for &symbol in self.inputs.builtin_types.classes_with_static_member(name) {
            let Some(class) = self.compiled_class(symbol) else {
                continue;
            };
            let constructor = self.c.type_of_symbol(symbol);
            let constructor = self.resolved(constructor)?;
            if self.has_required_properties(constructor, members.shape())
                && self.is_related(constructor, ty, Relation::Assignable)?
            {
                accepted.push(class);
            }
        }
        Ok(self.list(&accepted))
    }

    fn has_exact_type(&self, builtin: BuiltinShape) -> bool {
        match builtin {
            BuiltinShape::Array => true,
            BuiltinShape::Class(class) => self.inputs.builtin_types.has_exact_type(class.class),
        }
    }
}
