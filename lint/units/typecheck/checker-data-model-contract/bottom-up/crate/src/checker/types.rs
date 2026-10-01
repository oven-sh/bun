// checker/types.go 160-1474: ids, links, Type and its data, Signature, TypePredicate, IndexInfo, Ternary. Embedding is a named first field.
use crate::ast::flags_generated::SymbolFlags;
use crate::checker::c30_type_keys::CacheHashKey;
use crate::checker::checker::Checker;
use crate::checker::flags_generated::{
    AccessFlags, ElementFlags, ExhaustiveState, ExternalEmitHelpers, IndexFlags, NodeCheckFlags,
    ObjectFlags, SignatureFlags, TypeFlags, TypePredicateKind, VarianceFlags,
};
use crate::tscore::golang::{List, Map, OrderedSet, Text, Tristate};
use crate::tscore::ids::{
    CompositeSignatureId, ConditionalRootId, IndexInfoId, NodeId, SignatureId, SymbolId,
    SymbolTableId, TypeAliasId, TypeId, TypeMapperId, TypePredicateId,
};

// Links for referenced symbols

#[derive(Default)]
pub struct SymbolReferenceLinks {
    pub reference_kinds: SymbolFlags,
}

// Links for value symbols

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

// Additional links for mapped symbols

#[derive(Default)]
pub struct MappedSymbolLinks {
    pub key_type: TypeId,
    pub synthetic_origin: SymbolId,
}

// Additional links for deferred type symbols

#[derive(Default)]
pub struct DeferredSymbolLinks<'a> {
    pub parent: TypeId,
    pub constituents: List<'a, TypeId>,
    pub write_constituents: List<'a, TypeId>,
}

// Links for alias symbols

#[derive(Default)]
pub struct AliasSymbolLinks {
    pub immediate_target: SymbolId,
    pub alias_target: SymbolId,
    pub referenced: bool,
    pub type_only_declaration: NodeId,
}

// Links for module symbols. A nil resolved_exports is "not computed": getExportsOfModuleWorker never returns a nil table.

#[derive(Default)]
pub struct ModuleSymbolLinks<'a> {
    pub resolved_exports: SymbolTableId,
    pub type_only_export_star_map: Map<Text<'a>, NodeId>,
    pub exports_checked: bool,
}

#[derive(Default)]
pub struct ReverseMappedSymbolLinks {
    pub property_type: TypeId,
    pub mapped_type: TypeId,
    pub constraint_type: TypeId,
}

// Links for late-bound symbols

#[derive(Default)]
pub struct LateBoundLinks {
    pub late_symbol: SymbolId,
}

// Links for export type symbols

#[derive(Default)]
pub struct ExportTypeLinks {
    pub target: SymbolId,
    pub originating_import: NodeId,
}

// Links for type aliases

#[derive(Default)]
pub struct TypeAliasLinks<'a> {
    pub declared_type: TypeId,
    pub type_parameters: List<'a, TypeId>,
    pub instantiations: Map<CacheHashKey, TypeId>,
    pub is_constructor_declared_property: bool,
}

// Links for declared types (type parameters, class types, interface types, enums)

#[derive(Default)]
pub struct DeclaredTypeLinks {
    pub declared_type: TypeId,
    pub interface_checked: bool,
    pub index_signatures_checked: bool,
    pub type_parameters_checked: bool,
    pub enum_checked: bool,
}

// Links for switch clauses

#[derive(Default)]
pub struct SwitchStatementLinks<'a> {
    pub exhaustive_state: ExhaustiveState,
    pub switch_types_computed: bool,
    pub witnesses_computed: bool,
    pub switch_types: List<'a, TypeId>,
    pub witnesses: List<'a, Text<'a>>,
}

#[derive(Default)]
pub struct ArrayLiteralLinks {
    pub indices_computed: bool,
    pub first_spread_index: isize,
    pub last_spread_index: isize,
}

// Links for late-binding containers: indexed by MembersOrExportsResolutionKind.

#[derive(Default)]
pub struct MembersAndExportsLinks(pub [SymbolTableId; 2]);

// Links for synthetic spread properties

#[derive(Default)]
pub struct SpreadLinks {
    pub left_spread: SymbolId,
    pub right_spread: SymbolId,
}

// Links for variances of type aliases and interface types

#[derive(Default)]
pub struct VarianceLinks<'a> {
    pub variances: List<'a, VarianceFlags>,
}

#[derive(Default)]
pub struct MarkedAssignmentSymbolLinks {
    pub last_assignment_pos: i32,
    pub has_definite_assignment: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct AccessibleChainCacheKey {
    pub use_only_external_aliasing: bool,
    pub location: NodeId,
    pub meaning: u32,
}

// extended_containers is `*[]*ast.Symbol`: None is "not computed", a nil list is a computed result.
#[derive(Default)]
pub struct ContainingSymbolLinks<'a> {
    pub extended_containers_by_file: Map<NodeId, List<'a, SymbolId>>,
    pub extended_containers: Option<List<'a, SymbolId>>,
    pub accessible_chain_cache: Map<AccessibleChainCacheKey, List<'a, SymbolId>>,
}

// Common links

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

// has_name is `*bool`: None is "not computed".
#[derive(Default)]
pub struct ComputedNameNodeLinks<'a> {
    pub has_name: Option<bool>,
    pub name: Text<'a>,
}

// evaluator.Result. The value is a string, a number or nil.
#[derive(Default, Clone, Copy)]
pub struct EvaluatorResult<'a> {
    pub value: LiteralValue<'a>,
    pub is_syntactically_string: bool,
    pub resolved_other_files: bool,
    pub has_external_references: bool,
}

// Links for enum members

#[derive(Default)]
pub struct EnumMemberLinks<'a> {
    pub value: EvaluatorResult<'a>,
}

// Links for assertion expressions

#[derive(Default)]
pub struct AssertionLinks {
    pub expr_type: TypeId,
}

// SourceFile links

#[derive(Default)]
pub struct SourceFileLinks<'a> {
    pub type_checked: bool,
    pub unused_checked: bool,
    pub external_helpers_module: SymbolId,
    pub requested_external_emit_helpers: ExternalEmitHelpers,
    pub deferred_nodes: OrderedSet<NodeId>,
    pub identifier_check_nodes: Vec<NodeId>,
    pub local_jsx_namespace: Text<'a>,
    pub local_jsx_fragment_namespace: Text<'a>,
    pub local_jsx_factory: NodeId,
    pub local_jsx_fragment_factory: NodeId,
    pub jsx_fragment_type: TypeId,
}

// Signature specific links

#[derive(Default)]
pub struct SignatureLinks {
    pub resolved_signature: SignatureId,
    pub effects_signature: SignatureId,
    pub decorator_signature: SignatureId,
}

// TypeAlias. Upstream never compares two aliases by pointer: only the nil test, the symbol and the arguments.

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

// LiteralType.value: string | jsnum.Number | bool | PseudoBigInt | nil (computed enum). `==` is Go's interface equality.
#[derive(Default, Clone, Copy, PartialEq, Debug)]
pub enum LiteralValue<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(f64),
    Boolean(bool),
    BigInt(PseudoBigInt<'a>),
}

// IntrinsicTypeData

#[derive(Default)]
pub struct IntrinsicType<'a> {
    pub intrinsic_name: Text<'a>,
}

// LiteralTypeData

#[derive(Default)]
pub struct LiteralType<'a> {
    pub value: LiteralValue<'a>,
    pub fresh_type: TypeId,
    pub regular_type: TypeId,
}

// UniqueESSymbolTypeData

#[derive(Default)]
pub struct UniqueESSymbolType<'a> {
    pub name: Text<'a>,
}

// ConstrainedType (type with computed base constraint)

#[derive(Default)]
pub struct ConstrainedType {
    pub resolved_base_constraint: TypeId,
}

// StructuredType (base of all types with members)

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

impl<'a> StructuredType<'a> {
    // slices.Clip(t.signatures[:t.callSignatureCount]): the same first element as `signatures`.
    pub fn call_signatures(&self) -> List<'a, SignatureId> {
        self.signatures.sub(0isize, self.call_signature_count)
    }
    // slices.Clip(t.signatures[t.callSignatureCount:])
    pub fn construct_signatures(&self) -> List<'a, SignatureId> {
        self.signatures
            .sub(self.call_signature_count, self.signatures.len())
    }
    pub fn properties(&self) -> List<'a, SymbolId> {
        self.properties
    }
}

#[derive(Default)]
pub struct ObjectType<'a> {
    pub structured: StructuredType<'a>,
    pub target: TypeId,
    pub mapper: TypeMapperId,
    pub instantiations: Map<CacheHashKey, TypeId>,
}

// TypeReference (instantiation of an InterfaceType)

#[derive(Default)]
pub struct TypeReference<'a> {
    pub object: ObjectType<'a>,
    pub node: NodeId,
    pub resolved_type_arguments: List<'a, TypeId>,
}

// InterfaceType (when generic, serves as reference to instantiation of itself)

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

impl<'a> InterfaceType<'a> {
    pub fn outer_type_parameters(&self) -> List<'a, TypeId> {
        if self.all_type_parameters.len() == 0 {
            return List::NIL;
        }
        self.all_type_parameters
            .sub(0isize, self.outer_type_parameter_count)
    }
    pub fn local_type_parameters(&self) -> List<'a, TypeId> {
        if self.all_type_parameters.len() == 0 {
            return List::NIL;
        }
        self.all_type_parameters.sub(
            self.outer_type_parameter_count,
            self.all_type_parameters.len() - 1,
        )
    }
    pub fn type_parameters(&self) -> List<'a, TypeId> {
        if self.all_type_parameters.len() == 0 {
            return List::NIL;
        }
        self.all_type_parameters
            .sub(0isize, self.all_type_parameters.len() - 1)
    }
}

#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
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

// `id` is the TypeId itself: newType is the only maker. `checker` has no field: one checker owns every type.
#[derive(Default)]
pub struct Type<'a> {
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub symbol: SymbolId,
    pub alias: TypeAliasId,
    pub data: TypeData<'a>,
}

// Signature. `id` is the SignatureId itself: newSignature is the only maker. resolved_min_argument_count starts at -1.

#[derive(Default)]
pub struct Signature<'a> {
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

impl Signature<'_> {
    pub fn has_rest_parameter(&self) -> bool {
        self.flags.intersects(SignatureFlags::HAS_REST_PARAMETER)
    }
}

#[derive(Default)]
pub struct CompositeSignature<'a> {
    pub is_union: bool,
    pub signatures: List<'a, SignatureId>,
}

// noTypePredicate is the first record of its store.
#[derive(Default)]
pub struct TypePredicate<'a> {
    pub kind: TypePredicateKind,
    pub parameter_index: i32,
    pub parameter_name: Text<'a>,
    pub t: TypeId,
}

// enumNumberIndexInfo and anyBaseTypeIndexInfo live in the same store: upstream compares them by pointer.
#[derive(Default)]
pub struct IndexInfo<'a> {
    pub key_type: TypeId,
    pub value_type: TypeId,
    pub is_readonly: bool,
    pub declaration: NodeId,
    pub index_symbol: SymbolId,
    pub components: List<'a, NodeId>,
}

// `x & y` picks the lesser and `x | y` the greater in the order False < Unknown < Maybe < True.
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
impl std::ops::BitOr for Ternary {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}
impl std::ops::BitOrAssign for Ternary {
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

// What a cast reads when the type has no such part. Go returns nil there and panics on the field read.
#[derive(Default)]
pub struct NilSections<'a> {
    pub intrinsic: IntrinsicType<'a>,
    pub literal: LiteralType<'a>,
    pub unique_es_symbol: UniqueESSymbolType<'a>,
    pub constrained: ConstrainedType,
    pub structured: StructuredType<'a>,
    pub object: ObjectType<'a>,
    pub reference: TypeReference<'a>,
    pub interface: InterfaceType<'a>,
    pub tuple: TupleType<'a>,
    pub instantiation_expression: InstantiationExpressionType<'a>,
    pub mapped: MappedType<'a>,
    pub reverse_mapped: ReverseMappedType<'a>,
    pub evolving_array: EvolvingArrayType<'a>,
    pub union_or_intersection: UnionOrIntersectionType<'a>,
    pub union: UnionType<'a>,
    pub intersection: IntersectionType<'a>,
    pub type_parameter: TypeParameter,
    pub index: IndexType,
    pub indexed_access: IndexedAccessType,
    pub template_literal: TemplateLiteralType<'a>,
    pub string_mapping: StringMappingType,
    pub substitution: SubstitutionType,
    pub conditional: ConditionalType,
}

// `t.AsX()` of a concrete data type: `c.as_x(t)` reads, `c.as_x_mut(t)` writes. A failed cast is recorded.
macro_rules! concrete_casts {
    ($($read:ident, $write:ident, $variant:ident, $ty:ty, $nil:ident, $name:literal;)*) => {
        impl<'a> Checker<'a> {$(
            pub fn $read(&self, t: TypeId) -> &$ty {
                match &self.types[t].data {
                    TypeData::$variant(d) => d,
                    _ => {
                        self.bad_cast($name);
                        &self.nil_sections.$nil
                    }
                }
            }
            pub fn $write(&mut self, t: TypeId) -> &mut $ty {
                if !matches!(self.types[t].data, TypeData::$variant(_)) {
                    self.bad_cast($name);
                    self.sink_sections.$nil = Default::default();
                    return &mut self.sink_sections.$nil;
                }
                match &mut self.types[t].data {
                    TypeData::$variant(d) => d,
                    _ => &mut self.sink_sections.$nil,
                }
            }
        )*}
    };
}

concrete_casts!(
    as_intrinsic_type, as_intrinsic_type_mut, Intrinsic, IntrinsicType<'a>, intrinsic, "AsIntrinsicType";
    as_literal_type, as_literal_type_mut, Literal, LiteralType<'a>, literal, "AsLiteralType";
    as_unique_es_symbol_type, as_unique_es_symbol_type_mut, UniqueESSymbol, UniqueESSymbolType<'a>, unique_es_symbol, "AsUniqueESSymbolType";
    as_tuple_type, as_tuple_type_mut, Tuple, TupleType<'a>, tuple, "AsTupleType";
    as_instantiation_expression_type, as_instantiation_expression_type_mut, InstantiationExpression, InstantiationExpressionType<'a>, instantiation_expression, "AsInstantiationExpressionType";
    as_mapped_type, as_mapped_type_mut, Mapped, MappedType<'a>, mapped, "AsMappedType";
    as_reverse_mapped_type, as_reverse_mapped_type_mut, ReverseMapped, ReverseMappedType<'a>, reverse_mapped, "AsReverseMappedType";
    as_evolving_array_type, as_evolving_array_type_mut, EvolvingArray, EvolvingArrayType<'a>, evolving_array, "AsEvolvingArrayType";
    as_type_parameter, as_type_parameter_mut, TypeParameter, TypeParameter, type_parameter, "AsTypeParameter";
    as_union_type, as_union_type_mut, Union, UnionType<'a>, union, "AsUnionType";
    as_intersection_type, as_intersection_type_mut, Intersection, IntersectionType<'a>, intersection, "AsIntersectionType";
    as_index_type, as_index_type_mut, Index, IndexType, index, "AsIndexType";
    as_indexed_access_type, as_indexed_access_type_mut, IndexedAccess, IndexedAccessType, indexed_access, "AsIndexedAccessType";
    as_template_literal_type, as_template_literal_type_mut, TemplateLiteral, TemplateLiteralType<'a>, template_literal, "AsTemplateLiteralType";
    as_string_mapping_type, as_string_mapping_type_mut, StringMapping, StringMappingType, string_mapping, "AsStringMappingType";
    as_substitution_type, as_substitution_type_mut, Substitution, SubstitutionType, substitution, "AsSubstitutionType";
    as_conditional_type, as_conditional_type_mut, Conditional, ConditionalType, conditional, "AsConditionalType";
);

// `t.AsX()` of an embedded struct type. Go returns nil when the data has no such part and panics on the field read: the same record as a failed cast.
macro_rules! embedded_casts {
    ($($read:ident, $write:ident, $has:ident, $ty:ty, $nil:ident, $name:literal, { $($variant:ident($d:ident) => $path:expr),* $(,)? };)*) => {
        impl<'a> Checker<'a> {$(
            pub fn $read(&self, t: TypeId) -> &$ty {
                match &self.types[t].data {
                    $(TypeData::$variant($d) => &$path,)*
                    _ => {
                        self.bad_cast($name);
                        &self.nil_sections.$nil
                    }
                }
            }
            pub fn $write(&mut self, t: TypeId) -> &mut $ty {
                if !self.$has(t) {
                    self.bad_cast($name);
                    self.sink_sections.$nil = Default::default();
                    return &mut self.sink_sections.$nil;
                }
                match &mut self.types[t].data {
                    $(TypeData::$variant($d) => &mut $path,)*
                    _ => &mut self.sink_sections.$nil,
                }
            }
            // `t.AsX() != nil`
            pub fn $has(&self, t: TypeId) -> bool {
                matches!(self.types[t].data, $(TypeData::$variant(_))|*)
            }
        )*}
    };
}

embedded_casts!(
    as_constrained_type, as_constrained_type_mut, has_constrained_type, ConstrainedType, constrained, "AsConstrainedType", {
        Object(d) => d.structured.constrained,
        TypeReference(d) => d.object.structured.constrained,
        Interface(d) => d.reference.object.structured.constrained,
        Tuple(d) => d.interface.reference.object.structured.constrained,
        InstantiationExpression(d) => d.object.structured.constrained,
        Mapped(d) => d.object.structured.constrained,
        ReverseMapped(d) => d.object.structured.constrained,
        EvolvingArray(d) => d.object.structured.constrained,
        Union(d) => d.base.structured.constrained,
        Intersection(d) => d.base.structured.constrained,
        TypeParameter(d) => d.constrained,
        Index(d) => d.constrained,
        IndexedAccess(d) => d.constrained,
        TemplateLiteral(d) => d.constrained,
        StringMapping(d) => d.constrained,
        Substitution(d) => d.constrained,
        Conditional(d) => d.constrained,
    };
    as_structured_type, as_structured_type_mut, has_structured_type, StructuredType<'a>, structured, "AsStructuredType", {
        Object(d) => d.structured,
        TypeReference(d) => d.object.structured,
        Interface(d) => d.reference.object.structured,
        Tuple(d) => d.interface.reference.object.structured,
        InstantiationExpression(d) => d.object.structured,
        Mapped(d) => d.object.structured,
        ReverseMapped(d) => d.object.structured,
        EvolvingArray(d) => d.object.structured,
        Union(d) => d.base.structured,
        Intersection(d) => d.base.structured,
    };
    as_object_type, as_object_type_mut, has_object_type, ObjectType<'a>, object, "AsObjectType", {
        Object(d) => **d,
        TypeReference(d) => d.object,
        Interface(d) => d.reference.object,
        Tuple(d) => d.interface.reference.object,
        InstantiationExpression(d) => d.object,
        Mapped(d) => d.object,
        ReverseMapped(d) => d.object,
        EvolvingArray(d) => d.object,
    };
    as_type_reference, as_type_reference_mut, has_type_reference, TypeReference<'a>, reference, "AsTypeReference", {
        TypeReference(d) => **d,
        Interface(d) => d.reference,
        Tuple(d) => d.interface.reference,
    };
    as_interface_type, as_interface_type_mut, has_interface_type, InterfaceType<'a>, interface, "AsInterfaceType", {
        Interface(d) => **d,
        Tuple(d) => d.interface,
    };
    as_union_or_intersection_type, as_union_or_intersection_type_mut, has_union_or_intersection_type, UnionOrIntersectionType<'a>, union_or_intersection, "AsUnionOrIntersectionType", {
        Union(d) => d.base,
        Intersection(d) => d.base,
    };
);

impl<'a> Checker<'a> {
    // t.Distributed()
    pub fn type_distributed(&self, t: TypeId) -> List<'a, TypeId> {
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.as_union_type(t).base.types;
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) {
            return List::NIL;
        }
        self.list_of(&[t])
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

    // t.Mapper()
    pub fn type_mapper(&self, t: TypeId) -> TypeMapperId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::OBJECT) {
            return self.as_object_type(t).mapper;
        }
        if flags.intersects(TypeFlags::TYPE_PARAMETER) {
            return self.as_type_parameter(t).mapper;
        }
        if flags.intersects(TypeFlags::CONDITIONAL) {
            return self.as_conditional_type(t).mapper;
        }
        self.fail("Unhandled case in Type.Mapper")
    }

    // t.Types()
    pub fn type_types(&self, t: TypeId) -> List<'a, TypeId> {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            return self.as_union_or_intersection_type(t).types;
        }
        if flags.intersects(TypeFlags::TEMPLATE_LITERAL) {
            return self.as_template_literal_type(t).types;
        }
        self.fail("Unhandled case in Type.Types")
    }

    // alias.Symbol(): nil for a nil alias.
    pub fn alias_symbol(&self, alias: TypeAliasId) -> SymbolId {
        if alias.is_nil() {
            return SymbolId::NIL;
        }
        self.type_aliases[alias].symbol
    }

    // alias.TypeArguments(): nil for a nil alias.
    pub fn alias_type_arguments(&self, alias: TypeAliasId) -> List<'a, TypeId> {
        if alias.is_nil() {
            return List::NIL;
        }
        self.type_aliases[alias].type_arguments
    }
}
