// Complete records of checker/types.go 658-1406 and ast/symbol.go. Replaces conventions-scratch/rust/types.rs, same names.
use crate::flags::{ElementFlags, ObjectFlags, SymbolFlags, TypeFlags};
use crate::golang::{List, Map, Text};
use crate::ids::*;
use crate::keys::CacheHashKey;

#[derive(Default)]
pub struct Symbol<'a> {
    pub flags: SymbolFlags,
    pub check_flags: u32,
    pub name: Text<'a>,
    pub declarations: List<'a, NodeId>,
    pub value_declaration: NodeId,
    pub members: SymbolTableId,
    pub exports: SymbolTableId,
    // The id that the binder asked for while binding, else 0. The checker keeps its own ids in a side vector.
    pub id: u32,
    pub parent: SymbolId,
    pub export_symbol: SymbolId,
}

#[derive(Default)]
pub struct Node {
    pub kind: u16,
    pub pos: i32,
    pub end: i32,
    pub parent: NodeId,
    pub source_file: NodeId,
    pub name: NodeId,
    pub type_node: NodeId,
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
#[derive(Default, Clone, Copy, PartialEq)]
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

#[derive(Default, Clone, Copy)]
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
    pub index_flags: u32,
}

#[derive(Default)]
pub struct IndexedAccessType {
    pub constrained: ConstrainedType,
    pub object_type: TypeId,
    pub index_type: TypeId,
    pub access_flags: u32,
}

#[derive(Default)]
pub struct TemplateLiteralType<'a> {
    pub constrained: ConstrainedType,
    pub texts: List<'a, Text<'a>>,
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

// `checker *Checker` has no field: one checker owns every type, free functions take the checker first.
#[derive(Default)]
pub struct Type<'a> {
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub id: TypeId,
    pub symbol: SymbolId,
    pub alias: TypeAliasId,
    pub data: TypeData<'a>,
}
