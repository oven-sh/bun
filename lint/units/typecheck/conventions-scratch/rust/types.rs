// The part of checker/types.go and ast/symbol.go that the validated functions read. Embedding becomes a named first field.
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
    // The lazily assigned id of ast.GetSymbolId when the binder asked for it, else 0.
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

#[derive(Default, Clone, Copy, PartialEq)]
pub enum LiteralValue<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(f64),
    Boolean(bool),
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
    pub resolved_base_constructor_type: TypeId,
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
    pub readonly: bool,
}

#[derive(Default)]
pub struct UnionOrIntersectionType<'a> {
    pub structured: StructuredType<'a>,
    pub types: List<'a, TypeId>,
}

#[derive(Default)]
pub struct UnionType<'a> {
    pub base: UnionOrIntersectionType<'a>,
    pub origin: TypeId,
}

#[derive(Default)]
pub struct IntersectionType<'a> {
    pub base: UnionOrIntersectionType<'a>,
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
pub struct TypeParameter {
    pub constrained: ConstrainedType,
    pub constraint: TypeId,
    pub target: TypeId,
    pub mapper: TypeMapperId,
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
}

#[derive(Default)]
pub struct ConditionalRoot {
    pub node: NodeId,
}

#[derive(Default)]
pub struct ConditionalType {
    pub constrained: ConstrainedType,
    pub root: ConditionalRootId,
    pub mapper: TypeMapperId,
}

#[derive(Default)]
pub struct SubstitutionType {
    pub constrained: ConstrainedType,
    pub base_type: TypeId,
    pub constraint: TypeId,
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
pub enum TypeData<'a> {
    #[default]
    Nil,
    Intrinsic(IntrinsicType<'a>),
    Literal(LiteralType<'a>),
    Object(Box<ObjectType<'a>>),
    TypeReference(Box<TypeReference<'a>>),
    Interface(Box<InterfaceType<'a>>),
    Tuple(Box<TupleType<'a>>),
    Union(Box<UnionType<'a>>),
    Intersection(Box<IntersectionType<'a>>),
    TypeParameter(Box<TypeParameter>),
    Index(IndexType),
    IndexedAccess(IndexedAccessType),
    Conditional(Box<ConditionalType>),
    Substitution(SubstitutionType),
    TemplateLiteral(Box<TemplateLiteralType<'a>>),
    StringMapping(StringMappingType),
}

#[derive(Default)]
pub struct Type<'a> {
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub id: TypeId,
    pub symbol: SymbolId,
    pub alias: TypeAliasId,
    pub data: TypeData<'a>,
}

#[derive(Default)]
pub struct Signature<'a> {
    pub id: SignatureId,
    pub flags: u32,
    pub declaration: NodeId,
    pub type_parameters: List<'a, TypeId>,
    pub parameters: List<'a, SymbolId>,
    pub resolved_return_type: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeMapperKind {
    #[default]
    Unknown,
    Simple,
    Array,
    Merged,
}

#[derive(Default)]
pub enum TypeMapper<'a> {
    #[default]
    Nil,
    Simple {
        source: TypeId,
        target: TypeId,
    },
    Array {
        sources: List<'a, TypeId>,
        targets: List<'a, TypeId>,
    },
    Merged {
        m1: TypeMapperId,
        m2: TypeMapperId,
    },
    Function(FunctionMapper),
}

// The five method values that NewChecker wraps with newFunctionTypeMapper.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FunctionMapper {
    UniqueLiteral,
    ReportUnreliable,
    ReportUnmeasurable,
    Restrictive,
    Permissive,
}

#[derive(Default)]
pub struct ValueSymbolLinks {
    pub resolved_type: TypeId,
    pub write_type: TypeId,
}

#[derive(Default)]
pub struct TypeAliasLinks<'a> {
    pub declared_type: TypeId,
    pub type_parameters: List<'a, TypeId>,
    pub instantiations: Map<CacheHashKey, TypeId>,
}

#[derive(Default)]
pub struct AliasSymbolLinks {
    pub alias_target: SymbolId,
}

#[derive(Default)]
pub struct NodeLinks {
    pub flags: u32,
}
