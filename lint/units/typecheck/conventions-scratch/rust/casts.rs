// `t.AsXxx()` is `self.as_xxx(t)`, a write is `self.as_xxx_mut(t).field = v`. A failed cast is recorded and reads the nil part.
use crate::checker::Checker;
use crate::ids::TypeId;
use crate::types::*;

impl<'a> Checker<'a> {
    pub fn as_intrinsic_type(&self, t: TypeId) -> &IntrinsicType<'a> {
        match &self.types[t].data {
            TypeData::Intrinsic(d) => d,
            _ => {
                self.bad_cast("AsIntrinsicType");
                &self.nil_sections.intrinsic
            }
        }
    }

    pub fn as_literal_type(&self, t: TypeId) -> &LiteralType<'a> {
        match &self.types[t].data {
            TypeData::Literal(d) => d,
            _ => {
                self.bad_cast("AsLiteralType");
                &self.nil_sections.literal
            }
        }
    }

    pub fn as_literal_type_mut(&mut self, t: TypeId) -> &mut LiteralType<'a> {
        if !matches!(self.types[t].data, TypeData::Literal(_)) {
            self.bad_cast("AsLiteralType");
            self.sink_sections.literal = LiteralType::default();
            return &mut self.sink_sections.literal;
        }
        match &mut self.types[t].data {
            TypeData::Literal(d) => d,
            _ => &mut self.sink_sections.literal,
        }
    }

    // The embedded struct casts return nil in Go when the part is absent, without a panic.
    pub fn as_object_type(&self, t: TypeId) -> &ObjectType<'a> {
        match &self.types[t].data {
            TypeData::Object(d) => d,
            TypeData::TypeReference(d) => &d.object,
            TypeData::Interface(d) => &d.reference.object,
            TypeData::Tuple(d) => &d.interface.reference.object,
            _ => &self.nil_sections.object,
        }
    }

    pub fn as_object_type_mut(&mut self, t: TypeId) -> &mut ObjectType<'a> {
        if !matches!(
            self.types[t].data,
            TypeData::Object(_)
                | TypeData::TypeReference(_)
                | TypeData::Interface(_)
                | TypeData::Tuple(_)
        ) {
            self.bad_cast("AsObjectType");
            self.sink_sections.object = ObjectType::default();
            return &mut self.sink_sections.object;
        }
        match &mut self.types[t].data {
            TypeData::Object(d) => d,
            TypeData::TypeReference(d) => &mut d.object,
            TypeData::Interface(d) => &mut d.reference.object,
            TypeData::Tuple(d) => &mut d.interface.reference.object,
            _ => &mut self.sink_sections.object,
        }
    }

    pub fn as_type_reference(&self, t: TypeId) -> &TypeReference<'a> {
        match &self.types[t].data {
            TypeData::TypeReference(d) => d,
            TypeData::Interface(d) => &d.reference,
            TypeData::Tuple(d) => &d.interface.reference,
            _ => &self.nil_sections.reference,
        }
    }

    pub fn as_interface_type(&self, t: TypeId) -> &InterfaceType<'a> {
        match &self.types[t].data {
            TypeData::Interface(d) => d,
            TypeData::Tuple(d) => &d.interface,
            _ => &self.nil_sections.interface,
        }
    }

    pub fn as_tuple_type(&self, t: TypeId) -> &TupleType<'a> {
        match &self.types[t].data {
            TypeData::Tuple(d) => d,
            _ => {
                self.bad_cast("AsTupleType");
                &self.nil_sections.tuple
            }
        }
    }

    pub fn as_constrained_type(&self, t: TypeId) -> &ConstrainedType {
        match &self.types[t].data {
            TypeData::Object(d) => &d.structured.constrained,
            TypeData::TypeReference(d) => &d.object.structured.constrained,
            TypeData::Interface(d) => &d.reference.object.structured.constrained,
            TypeData::Tuple(d) => &d.interface.reference.object.structured.constrained,
            TypeData::Union(d) => &d.base.structured.constrained,
            TypeData::Intersection(d) => &d.base.structured.constrained,
            TypeData::TypeParameter(d) => &d.constrained,
            TypeData::Index(d) => &d.constrained,
            TypeData::IndexedAccess(d) => &d.constrained,
            TypeData::Conditional(d) => &d.constrained,
            TypeData::Substitution(d) => &d.constrained,
            TypeData::TemplateLiteral(d) => &d.constrained,
            TypeData::StringMapping(d) => &d.constrained,
            _ => &self.nil_sections.constrained,
        }
    }

    pub fn as_union_or_intersection_type(&self, t: TypeId) -> &UnionOrIntersectionType<'a> {
        match &self.types[t].data {
            TypeData::Union(d) => &d.base,
            TypeData::Intersection(d) => &d.base,
            _ => &self.nil_sections.union_or_intersection,
        }
    }

    pub fn as_union_type(&self, t: TypeId) -> &UnionType<'a> {
        match &self.types[t].data {
            TypeData::Union(d) => d,
            _ => {
                self.bad_cast("AsUnionType");
                &self.nil_sections.union
            }
        }
    }

    pub fn as_type_parameter(&self, t: TypeId) -> &TypeParameter {
        match &self.types[t].data {
            TypeData::TypeParameter(d) => d,
            _ => {
                self.bad_cast("AsTypeParameter");
                &self.nil_sections.type_parameter
            }
        }
    }

    pub fn as_index_type(&self, t: TypeId) -> &IndexType {
        match &self.types[t].data {
            TypeData::Index(d) => d,
            _ => {
                self.bad_cast("AsIndexType");
                &self.nil_sections.index
            }
        }
    }

    pub fn as_indexed_access_type(&self, t: TypeId) -> &IndexedAccessType {
        match &self.types[t].data {
            TypeData::IndexedAccess(d) => d,
            _ => {
                self.bad_cast("AsIndexedAccessType");
                &self.nil_sections.indexed_access
            }
        }
    }

    pub fn as_conditional_type(&self, t: TypeId) -> &ConditionalType {
        match &self.types[t].data {
            TypeData::Conditional(d) => d,
            _ => {
                self.bad_cast("AsConditionalType");
                &self.nil_sections.conditional
            }
        }
    }

    pub fn as_substitution_type(&self, t: TypeId) -> &SubstitutionType {
        match &self.types[t].data {
            TypeData::Substitution(d) => d,
            _ => {
                self.bad_cast("AsSubstitutionType");
                &self.nil_sections.substitution
            }
        }
    }

    pub fn as_template_literal_type(&self, t: TypeId) -> &TemplateLiteralType<'a> {
        match &self.types[t].data {
            TypeData::TemplateLiteral(d) => d,
            _ => {
                self.bad_cast("AsTemplateLiteralType");
                &self.nil_sections.template_literal
            }
        }
    }

    pub fn as_string_mapping_type(&self, t: TypeId) -> &StringMappingType {
        match &self.types[t].data {
            TypeData::StringMapping(d) => d,
            _ => {
                self.bad_cast("AsStringMappingType");
                &self.nil_sections.string_mapping
            }
        }
    }
}
