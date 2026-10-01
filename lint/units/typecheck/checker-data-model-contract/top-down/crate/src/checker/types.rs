// checker/types.go 169-424 and 658-1425: links records, Type and its data, Signature, TypePredicate, IndexInfo, Ternary. Embedding becomes a named first field.
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    AccessFlags, ElementFlags, IndexFlags, NodeCheckFlags, ObjectFlags, SignatureFlags, TypeFlags,
    TypePredicateKind,
};
use crate::checker::ids::*;
use crate::checker::keys::CacheHashKey;
use crate::tscore::compileroptions::Tristate;
use crate::tscore::golang::{List, Map, Text};
use crate::tscore::gomore::TextList;
use crate::tscore::ids::{NodeId, SymbolId, SymbolTableId, TypeId};

// types.go 1416-1423. `x & y` is the lesser of the two in the order False < Unknown < Maybe < True.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Ternary(pub i8);

impl Ternary {
    pub const FALSE: Self = Self(0);
    pub const UNKNOWN: Self = Self(1);
    pub const MAYBE: Self = Self(3);
    pub const TRUE: Self = Self(-1);
}

impl std::ops::BitAnd for Ternary {
    type Output = Self;
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl std::ops::BitAndAssign for Ternary {
    fn bitand_assign(&mut self, rhs: Self) {
        self.0 &= rhs.0;
    }
}

#[derive(Default, Clone, Copy)]
pub struct TypeAlias<'a> {
    pub symbol: SymbolId,
    pub type_arguments: List<'a, TypeId>,
}

// jsnum.PseudoBigInt: the zero value has empty digits.
#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct PseudoBigInt<'a> {
    pub negative: bool,
    pub base10_value: Text<'a>,
}

// LiteralType.value: string | jsnum.Number | bool | PseudoBigInt | nil (computed enum).
#[derive(Default, Clone, Copy, PartialEq, Debug)]
pub enum LiteralValue<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(f64),
    Boolean(bool),
    BigInt(PseudoBigInt<'a>),
}

#[derive(Default)]
pub struct IntrinsicType<'a> {
    pub intrinsic_name: Text<'a>,
}

#[derive(Default)]
pub struct LiteralType<'a> {
    pub value: LiteralValue<'a>,
    pub fresh_type: TypeId,
    pub regular_type: TypeId,
}

#[derive(Default)]
pub struct UniqueESSymbolType<'a> {
    pub name: Text<'a>,
}

#[derive(Default)]
pub struct ConstrainedType {
    pub resolved_base_constraint: TypeId,
}

#[derive(Default)]
pub struct StructuredType<'a> {
    pub constrained: ConstrainedType,
    pub members: SymbolTableId,
    pub properties: List<'a, SymbolId>,
    pub signatures: List<'a, SignatureId>,
    pub call_signature_count: isize,
    pub index_infos: List<'a, IndexInfoId>,
    pub object_type_without_abstract_construct_signatures: TypeId,
}

#[derive(Default)]
pub struct ObjectType<'a> {
    pub structured: StructuredType<'a>,
    pub target: TypeId,
    pub mapper: TypeMapperId,
    pub instantiations: Map<CacheHashKey, TypeId>,
}

#[derive(Default)]
pub struct TypeReference<'a> {
    pub object: ObjectType<'a>,
    pub node: NodeId,
    pub resolved_type_arguments: List<'a, TypeId>,
}

#[derive(Default)]
pub struct InterfaceType<'a> {
    pub reference: TypeReference<'a>,
    pub all_type_parameters: List<'a, TypeId>,
    pub outer_type_parameter_count: isize,
    pub this_type: TypeId,
    pub base_types_resolved: bool,
    pub declared_members_resolved: bool,
    pub resolved_base_constructor_type: TypeId,
    pub resolved_base_types: List<'a, TypeId>,
    pub declared_members: SymbolTableId,
    pub declared_call_signatures: List<'a, SignatureId>,
    pub declared_construct_signatures: List<'a, SignatureId>,
    pub declared_index_infos: List<'a, IndexInfoId>,
}

#[derive(Default, Clone, Copy, Debug)]
pub struct TupleElementInfo {
    pub flags: ElementFlags,
    pub labeled_declaration: NodeId,
}

#[derive(Default)]
pub struct TupleType<'a> {
    pub interface: InterfaceType<'a>,
    pub element_infos: List<'a, TupleElementInfo>,
    pub min_length: isize,
    pub fixed_length: isize,
    pub combined_flags: ElementFlags,
    pub readonly: bool,
}

#[derive(Default)]
pub struct InstantiationExpressionType<'a> {
    pub object: ObjectType<'a>,
    pub node: NodeId,
}

#[derive(Default)]
pub struct MappedType<'a> {
    pub object: ObjectType<'a>,
    pub declaration: NodeId,
    pub type_parameter: TypeId,
    pub constraint_type: TypeId,
    pub name_type: TypeId,
    pub template_type: TypeId,
    pub modifiers_type: TypeId,
    pub resolved_apparent_type: TypeId,
    pub contains_error: bool,
}

#[derive(Default)]
pub struct ReverseMappedType<'a> {
    pub object: ObjectType<'a>,
    pub source: TypeId,
    pub mapped_type: TypeId,
    pub constraint_type: TypeId,
}

#[derive(Default)]
pub struct EvolvingArrayType<'a> {
    pub object: ObjectType<'a>,
    pub element_type: TypeId,
    pub final_array_type: TypeId,
}

#[derive(Default)]
pub struct UnionOrIntersectionType<'a> {
    pub structured: StructuredType<'a>,
    pub types: List<'a, TypeId>,
    pub property_cache: SymbolTableId,
    pub property_cache_without_function_property_augment: SymbolTableId,
    pub resolved_properties: List<'a, SymbolId>,
}

#[derive(Default)]
pub struct UnionType<'a> {
    pub base: UnionOrIntersectionType<'a>,
    pub resolved_reduced_type: TypeId,
    pub regular_type: TypeId,
    pub origin: TypeId,
    pub key_property_name: Text<'a>,
    pub constituent_map: Map<TypeId, TypeId>,
}

#[derive(Default)]
pub struct IntersectionType<'a> {
    pub base: UnionOrIntersectionType<'a>,
    pub resolved_apparent_type: TypeId,
    pub unique_literal_filled_instantiation: TypeId,
}

#[derive(Default)]
pub struct TypeParameter {
    pub constrained: ConstrainedType,
    pub constraint: TypeId,
    pub target: TypeId,
    pub mapper: TypeMapperId,
    pub is_this_type: bool,
    pub resolved_default_type: TypeId,
}

#[derive(Default)]
pub struct IndexType {
    pub constrained: ConstrainedType,
    pub target: TypeId,
    pub index_flags: IndexFlags,
}

#[derive(Default)]
pub struct IndexedAccessType {
    pub constrained: ConstrainedType,
    pub object_type: TypeId,
    pub index_type: TypeId,
    pub access_flags: AccessFlags,
}

#[derive(Default)]
pub struct TemplateLiteralType<'a> {
    pub constrained: ConstrainedType,
    pub texts: TextList<'a>,
    pub types: List<'a, TypeId>,
}

#[derive(Default)]
pub struct StringMappingType {
    pub constrained: ConstrainedType,
    pub target: TypeId,
}

#[derive(Default)]
pub struct SubstitutionType {
    pub constrained: ConstrainedType,
    pub base_type: TypeId,
    pub constraint: TypeId,
}

#[derive(Default)]
pub struct ConditionalRoot<'a> {
    pub node: NodeId,
    pub check_type: TypeId,
    pub extends_type: TypeId,
    pub is_distributive: bool,
    pub infer_type_parameters: List<'a, TypeId>,
    pub outer_type_parameters: List<'a, TypeId>,
    pub instantiations: Map<CacheHashKey, TypeId>,
    pub alias: TypeAliasId,
}

#[derive(Default)]
pub struct ConditionalType {
    pub constrained: ConstrainedType,
    pub root: ConditionalRootId,
    pub check_type: TypeId,
    pub extends_type: TypeId,
    pub resolved_true_type: TypeId,
    pub resolved_false_type: TypeId,
    pub resolved_inferred_true_type: TypeId,
    pub resolved_default_constraint: TypeId,
    pub resolved_constraint_of_distributive: TypeId,
    pub mapper: TypeMapperId,
    pub combined_mapper: TypeMapperId,
}

// newObjectType picks the variant in this order: Interface, Tuple, TypeReference, Mapped, ReverseMapped, EvolvingArray, InstantiationExpression, Object.
#[derive(Default)]
pub enum TypeData<'a> {
    #[default]
    Nil,
    Intrinsic(IntrinsicType<'a>),
    Literal(LiteralType<'a>),
    UniqueESSymbol(UniqueESSymbolType<'a>),
    Object(Box<ObjectType<'a>>),
    TypeReference(Box<TypeReference<'a>>),
    Interface(Box<InterfaceType<'a>>),
    Tuple(Box<TupleType<'a>>),
    InstantiationExpression(Box<InstantiationExpressionType<'a>>),
    Mapped(Box<MappedType<'a>>),
    ReverseMapped(Box<ReverseMappedType<'a>>),
    EvolvingArray(Box<EvolvingArrayType<'a>>),
    Union(Box<UnionType<'a>>),
    Intersection(Box<IntersectionType<'a>>),
    TypeParameter(Box<TypeParameter>),
    Index(IndexType),
    IndexedAccess(IndexedAccessType),
    TemplateLiteral(Box<TemplateLiteralType<'a>>),
    StringMapping(StringMappingType),
    Substitution(SubstitutionType),
    Conditional(Box<ConditionalType>),
}

// `checker *Checker` has no field: one checker owns every type.
#[derive(Default)]
pub struct Type<'a> {
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub id: TypeId,
    pub symbol: SymbolId,
    pub alias: TypeAliasId,
    pub data: TypeData<'a>,
}

// Every signature comes from newSignature, so the arena index is `id`. resolved_min_argument_count starts at -1.
#[derive(Default)]
pub struct Signature<'a> {
    pub id: SignatureId,
    pub flags: SignatureFlags,
    pub min_argument_count: i32,
    pub resolved_min_argument_count: i32,
    pub declaration: NodeId,
    pub type_parameters: List<'a, TypeId>,
    pub parameters: List<'a, SymbolId>,
    pub this_parameter: SymbolId,
    pub resolved_return_type: TypeId,
    pub resolved_type_predicate: TypePredicateId,
    pub target: SignatureId,
    pub mapper: TypeMapperId,
    pub isolated_signature_type: TypeId,
    pub composite: CompositeSignatureId,
}

#[derive(Default)]
pub struct CompositeSignature<'a> {
    pub is_union: bool,
    pub signatures: List<'a, SignatureId>,
}

// noTypePredicate is the first record of the arena: upstream compares it by pointer.
#[derive(Default)]
pub struct TypePredicate<'a> {
    pub kind: TypePredicateKind,
    pub parameter_index: i32,
    pub parameter_name: Text<'a>,
    pub t: TypeId,
}

// enumNumberIndexInfo and anyBaseTypeIndexInfo live in the same arena: upstream compares them by pointer.
#[derive(Default)]
pub struct IndexInfo<'a> {
    pub key_type: TypeId,
    pub value_type: TypeId,
    pub is_readonly: bool,
    pub declaration: NodeId,
    pub index_symbol: SymbolId,
    pub components: List<'a, NodeId>,
}

// types.go 169-424: the links records. Those of later layers keep upstream's fields one to one.
#[derive(Default)]
pub struct ValueSymbolLinks {
    pub resolved_type: TypeId,
    pub write_type: TypeId,
    pub target: SymbolId,
    pub mapper: TypeMapperId,
    pub name_type: TypeId,
    pub containing_type: TypeId,
    pub function_or_constructor_checked: bool,
}

#[derive(Default)]
pub struct AliasSymbolLinks {
    pub immediate_target: SymbolId,
    pub alias_target: SymbolId,
    pub referenced: bool,
    pub type_only_declaration: NodeId,
}

#[derive(Default)]
pub struct ExportTypeLinks {
    pub target: SymbolId,
    pub originating_import: NodeId,
}

#[derive(Default)]
pub struct TypeAliasLinks<'a> {
    pub declared_type: TypeId,
    pub type_parameters: List<'a, TypeId>,
    pub instantiations: Map<CacheHashKey, TypeId>,
    pub is_constructor_declared_property: bool,
}

#[derive(Default)]
pub struct DeclaredTypeLinks {
    pub declared_type: TypeId,
    pub interface_checked: bool,
    pub index_signatures_checked: bool,
    pub type_parameters_checked: bool,
    pub enum_checked: bool,
}

#[derive(Default)]
pub struct NodeLinks {
    pub flags: NodeCheckFlags,
    pub declaration_requires_scope_change: Tristate,
    pub has_reported_statement_in_ambient_context: bool,
}

#[derive(Default)]
pub struct SymbolNodeLinks {
    pub resolved_symbol: SymbolId,
}

#[derive(Default)]
pub struct TypeNodeLinks<'a> {
    pub resolved_type: TypeId,
    pub outer_type_parameters: List<'a, TypeId>,
}

// What a cast returns when the type has no such part. Go returns nil there and panics on the next field read.
#[derive(Default)]
pub struct NilSections<'a> {
    pub intrinsic: IntrinsicType<'a>,
    pub literal: LiteralType<'a>,
    pub constrained: ConstrainedType,
    pub structured: StructuredType<'a>,
    pub object: ObjectType<'a>,
    pub reference: TypeReference<'a>,
    pub interface: InterfaceType<'a>,
    pub tuple: TupleType<'a>,
    pub union_or_intersection: UnionOrIntersectionType<'a>,
    pub union: UnionType<'a>,
    pub type_parameter: TypeParameter,
    pub index: IndexType,
    pub indexed_access: IndexedAccessType,
    pub conditional: ConditionalType,
    pub substitution: SubstitutionType,
    pub template_literal: TemplateLiteralType<'a>,
    pub string_mapping: StringMappingType,
}

// `t.AsXxx()` is `self.as_xxx(t)`, a write is `self.as_xxx_mut(t).field = v`. A failed cast is recorded and reads the nil part.
impl<'a> Checker<'a> {
    pub fn as_intrinsic_type(&self, t: TypeId) -> &IntrinsicType<'a> {
        match &self.types[t].data {
            TypeData::Intrinsic(d) => d,
            _ => {
                self.bad_cast("AsIntrinsicType", t.0);
                &self.nil_sections.intrinsic
            }
        }
    }

    pub fn as_literal_type(&self, t: TypeId) -> &LiteralType<'a> {
        match &self.types[t].data {
            TypeData::Literal(d) => d,
            _ => {
                self.bad_cast("AsLiteralType", t.0);
                &self.nil_sections.literal
            }
        }
    }

    pub fn as_literal_type_mut(&mut self, t: TypeId) -> &mut LiteralType<'a> {
        if !matches!(self.types[t].data, TypeData::Literal(_)) {
            self.bad_cast("AsLiteralType", t.0);
            self.sink_sections.literal = LiteralType::default();
            return &mut self.sink_sections.literal;
        }
        match &mut self.types[t].data {
            TypeData::Literal(d) => d,
            _ => &mut self.sink_sections.literal,
        }
    }

    // The casts to an embedded struct return nil in Go when the part is absent; no caller tests for nil, the next field read panics.
    pub fn as_structured_type(&self, t: TypeId) -> &StructuredType<'a> {
        match &self.types[t].data {
            TypeData::Object(d) => &d.structured,
            TypeData::TypeReference(d) => &d.object.structured,
            TypeData::Interface(d) => &d.reference.object.structured,
            TypeData::Tuple(d) => &d.interface.reference.object.structured,
            TypeData::InstantiationExpression(d) => &d.object.structured,
            TypeData::Mapped(d) => &d.object.structured,
            TypeData::ReverseMapped(d) => &d.object.structured,
            TypeData::EvolvingArray(d) => &d.object.structured,
            TypeData::Union(d) => &d.base.structured,
            TypeData::Intersection(d) => &d.base.structured,
            _ => {
                self.bad_cast("AsStructuredType", t.0);
                &self.nil_sections.structured
            }
        }
    }

    pub fn as_object_type(&self, t: TypeId) -> &ObjectType<'a> {
        match &self.types[t].data {
            TypeData::Object(d) => d,
            TypeData::TypeReference(d) => &d.object,
            TypeData::Interface(d) => &d.reference.object,
            TypeData::Tuple(d) => &d.interface.reference.object,
            TypeData::InstantiationExpression(d) => &d.object,
            TypeData::Mapped(d) => &d.object,
            TypeData::ReverseMapped(d) => &d.object,
            TypeData::EvolvingArray(d) => &d.object,
            _ => {
                self.bad_cast("AsObjectType", t.0);
                &self.nil_sections.object
            }
        }
    }

    pub fn as_object_type_mut(&mut self, t: TypeId) -> &mut ObjectType<'a> {
        let present = matches!(
            self.types[t].data,
            TypeData::Object(_)
                | TypeData::TypeReference(_)
                | TypeData::Interface(_)
                | TypeData::Tuple(_)
                | TypeData::InstantiationExpression(_)
                | TypeData::Mapped(_)
                | TypeData::ReverseMapped(_)
                | TypeData::EvolvingArray(_)
        );
        if !present {
            self.bad_cast("AsObjectType", t.0);
            self.sink_sections.object = ObjectType::default();
            return &mut self.sink_sections.object;
        }
        match &mut self.types[t].data {
            TypeData::Object(d) => d,
            TypeData::TypeReference(d) => &mut d.object,
            TypeData::Interface(d) => &mut d.reference.object,
            TypeData::Tuple(d) => &mut d.interface.reference.object,
            TypeData::InstantiationExpression(d) => &mut d.object,
            TypeData::Mapped(d) => &mut d.object,
            TypeData::ReverseMapped(d) => &mut d.object,
            TypeData::EvolvingArray(d) => &mut d.object,
            _ => &mut self.sink_sections.object,
        }
    }

    pub fn as_type_reference(&self, t: TypeId) -> &TypeReference<'a> {
        match &self.types[t].data {
            TypeData::TypeReference(d) => d,
            TypeData::Interface(d) => &d.reference,
            TypeData::Tuple(d) => &d.interface.reference,
            _ => {
                self.bad_cast("AsTypeReference", t.0);
                &self.nil_sections.reference
            }
        }
    }

    pub fn as_interface_type(&self, t: TypeId) -> &InterfaceType<'a> {
        match &self.types[t].data {
            TypeData::Interface(d) => d,
            TypeData::Tuple(d) => &d.interface,
            _ => {
                self.bad_cast("AsInterfaceType", t.0);
                &self.nil_sections.interface
            }
        }
    }

    pub fn as_tuple_type(&self, t: TypeId) -> &TupleType<'a> {
        match &self.types[t].data {
            TypeData::Tuple(d) => d,
            _ => {
                self.bad_cast("AsTupleType", t.0);
                &self.nil_sections.tuple
            }
        }
    }

    pub fn as_constrained_type(&self, t: TypeId) -> &ConstrainedType {
        match &self.types[t].data {
            TypeData::TypeParameter(d) => &d.constrained,
            TypeData::Index(d) => &d.constrained,
            TypeData::IndexedAccess(d) => &d.constrained,
            TypeData::Conditional(d) => &d.constrained,
            TypeData::Substitution(d) => &d.constrained,
            TypeData::TemplateLiteral(d) => &d.constrained,
            TypeData::StringMapping(d) => &d.constrained,
            TypeData::Nil
            | TypeData::Intrinsic(_)
            | TypeData::Literal(_)
            | TypeData::UniqueESSymbol(_) => {
                self.bad_cast("AsConstrainedType", t.0);
                &self.nil_sections.constrained
            }
            _ => &self.as_structured_type(t).constrained,
        }
    }

    pub fn as_union_or_intersection_type(&self, t: TypeId) -> &UnionOrIntersectionType<'a> {
        match &self.types[t].data {
            TypeData::Union(d) => &d.base,
            TypeData::Intersection(d) => &d.base,
            _ => {
                self.bad_cast("AsUnionOrIntersectionType", t.0);
                &self.nil_sections.union_or_intersection
            }
        }
    }

    pub fn as_union_type(&self, t: TypeId) -> &UnionType<'a> {
        match &self.types[t].data {
            TypeData::Union(d) => d,
            _ => {
                self.bad_cast("AsUnionType", t.0);
                &self.nil_sections.union
            }
        }
    }

    pub fn as_type_parameter(&self, t: TypeId) -> &TypeParameter {
        match &self.types[t].data {
            TypeData::TypeParameter(d) => d,
            _ => {
                self.bad_cast("AsTypeParameter", t.0);
                &self.nil_sections.type_parameter
            }
        }
    }

    pub fn as_index_type(&self, t: TypeId) -> &IndexType {
        match &self.types[t].data {
            TypeData::Index(d) => d,
            _ => {
                self.bad_cast("AsIndexType", t.0);
                &self.nil_sections.index
            }
        }
    }

    pub fn as_indexed_access_type(&self, t: TypeId) -> &IndexedAccessType {
        match &self.types[t].data {
            TypeData::IndexedAccess(d) => d,
            _ => {
                self.bad_cast("AsIndexedAccessType", t.0);
                &self.nil_sections.indexed_access
            }
        }
    }

    pub fn as_conditional_type(&self, t: TypeId) -> &ConditionalType {
        match &self.types[t].data {
            TypeData::Conditional(d) => d,
            _ => {
                self.bad_cast("AsConditionalType", t.0);
                &self.nil_sections.conditional
            }
        }
    }

    pub fn as_substitution_type(&self, t: TypeId) -> &SubstitutionType {
        match &self.types[t].data {
            TypeData::Substitution(d) => d,
            _ => {
                self.bad_cast("AsSubstitutionType", t.0);
                &self.nil_sections.substitution
            }
        }
    }

    pub fn as_template_literal_type(&self, t: TypeId) -> &TemplateLiteralType<'a> {
        match &self.types[t].data {
            TypeData::TemplateLiteral(d) => d,
            _ => {
                self.bad_cast("AsTemplateLiteralType", t.0);
                &self.nil_sections.template_literal
            }
        }
    }

    pub fn as_string_mapping_type(&self, t: TypeId) -> &StringMappingType {
        match &self.types[t].data {
            TypeData::StringMapping(d) => d,
            _ => {
                self.bad_cast("AsStringMappingType", t.0);
                &self.nil_sections.string_mapping
            }
        }
    }

    // t.Types()
    pub fn type_types(&self, t: TypeId) -> List<'a, TypeId> {
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            return self.as_union_or_intersection_type(t).types;
        }
        if self.types[t].flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            return self.as_template_literal_type(t).types;
        }
        self.fail("Unhandled case in Type.Types")
    }

    // t.Target()
    pub fn type_target(&self, t: TypeId) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::OBJECT) {
            return self.as_object_type(t).target;
        }
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.as_type_parameter(t).target;
        }
        if flags.intersects(TypeFlags::INDEX) {
            return self.as_index_type(t).target;
        }
        if flags.intersects(TypeFlags::STRING_MAPPING) {
            return self.as_string_mapping_type(t).target;
        }
        self.fail("Unhandled case in Type.Target")
    }
}
