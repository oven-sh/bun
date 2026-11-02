use super::answers::{ClassRef, GaveUp, TypeArgument, TypeParameterRef};
use super::queries::Queries;
use crate::hir::{ExprId, ExprKind, TypeParamId};
use crate::program::{FileId, Sym};
use crate::types::{MapperId, SigData, SigId, TypeData, TypeId};
use smallvec::SmallVec;

fn promises_nothing(argument: TypeId) -> bool {
    argument == TypeId::UNKNOWN
}

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    pub fn call_type_arguments(&mut self, call: ExprId) -> Result<&'c [TypeArgument], GaveUp> {
        self.ask(|queries| {
            queries.require_live_expression(call)?;
            queries.compute_call_type_arguments(call)
        })
    }

    pub fn class_type_arguments(
        &mut self,
        class: ClassRef,
        instance_type: TypeId,
    ) -> Result<&'c [TypeArgument], GaveUp> {
        self.ask(|queries| queries.compute_class_type_arguments(class, instance_type))
    }

    pub(super) fn compiled_type_parameter(
        &self,
        file: FileId,
        parameter: TypeParamId,
    ) -> Option<TypeParameterRef> {
        let is_compiled = self.c.is_compiled_file(file);
        is_compiled.then_some(TypeParameterRef { file, parameter })
    }

    fn compute_call_type_arguments(&mut self, call: ExprId) -> Result<&'c [TypeArgument], GaveUp> {
        let (ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_)) =
            self.hir()[call].kind
        else {
            return Ok(&[]);
        };
        let found = self.c.resolved_signature(self.file, call);
        let Some(signature) = found.sig else {
            return match found.ret == TypeId::UNRESOLVED {
                true => Err(GaveUp::Unresolved),
                false => Ok(&[]),
            };
        };
        let mapper = self.signature_mapper(signature);
        if mapper == MapperId::IDENTITY {
            return Ok(&[]);
        }
        let pairs = self.c.mapping_in_declaration_order(mapper);
        self.list_type_arguments(pairs.iter().copied())
    }

    fn signature_mapper(&self, signature: SigId) -> MapperId {
        match *self.c.types().sig(signature) {
            SigData::Decl { mapper, .. }
            | SigData::Construct { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. } => mapper,
            SigData::WithReturn { sig: inner, .. } => self.signature_mapper(inner),
            SigData::Synth { .. } => MapperId::IDENTITY,
        }
    }

    fn compute_class_type_arguments(
        &mut self,
        class: ClassRef,
        instance_type: TypeId,
    ) -> Result<&'c [TypeArgument], GaveUp> {
        let instance_type = self.resolved(instance_type)?;
        let Some((reference, symbol)) = self.find_reference_to_class(instance_type, class) else {
            return Ok(&[]);
        };
        let parameters = self.c.local_type_params_of_symbol(symbol);
        if parameters.is_empty() {
            return Ok(&[]);
        }
        let outer = self.c.outer_type_params_of_symbol(symbol).len();
        let arguments = self.c.type_arguments(reference);
        let own_range = outer..outer + parameters.len();
        let own_arguments = arguments.get(own_range).ok_or(GaveUp::Unresolved)?;
        let pairs = parameters
            .iter()
            .copied()
            .zip(own_arguments.iter().copied());
        self.list_type_arguments(pairs)
    }

    fn find_reference_to_class(&self, ty: TypeId, class: ClassRef) -> Option<(TypeId, Sym)> {
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => {
                (self.compiled_class(*target) == Some(class)).then_some((ty, *target))
            }
            TypeData::Substitution { base, .. } => self.find_reference_to_class(*base, class),
            TypeData::Intersection(parts) => parts
                .iter()
                .find_map(|&part| self.find_reference_to_class(part, class)),
            _ => None,
        }
    }

    fn find_compiled_type_parameter(&self, ty: TypeId) -> Option<TypeParameterRef> {
        let TypeData::TypeParam(file, parameter, _) = *self.c.data(ty) else {
            return None;
        };
        self.compiled_type_parameter(file, parameter)
    }

    fn list_type_arguments(
        &self,
        pairs: impl Iterator<Item = (TypeId, TypeId)>,
    ) -> Result<&'c [TypeArgument], GaveUp> {
        let mut list: SmallVec<[TypeArgument; 4]> = SmallVec::new();
        for (parameter, argument) in pairs {
            let Some(declaration) = self.find_compiled_type_parameter(parameter) else {
                continue;
            };
            let argument_declaration = self.find_compiled_type_parameter(argument);
            if argument_declaration == Some(declaration) || promises_nothing(argument) {
                continue;
            }
            let argument = self.resolved(argument)?;
            list.push(TypeArgument {
                parameter,
                argument,
            });
        }
        Ok(self.list(&list))
    }
}
