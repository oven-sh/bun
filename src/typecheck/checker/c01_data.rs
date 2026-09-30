// checker.go:36-551 (layer DATA): the modes, kinds, cache keys and records that checker.go declares before the Checker. After them come the records and flag sets of later ranges of checker.go and of relater.go, flow.go, inference.go and jsx.go that the Checker holds: they are declared here so that the data model compiles as a whole, and their functions stay in the files of their ranges.
use crate::ast::{Arg, DiagnosticId, FlowNodeId, NodeId, SymbolId};
use crate::checker::types::checker_flags;
use crate::checker::{
    CacheHashKey, ErrorChainId, FlowStateId, InferenceContextId, InferenceInfoId, InferenceStateId,
    LiteralValue, Records, RelaterId, SignatureId, TypeComparer, TypeFlags, TypeId, TypeMapperId,
    WideningContextId,
};
use crate::collections::Set;
use crate::core::{List, LiveList, Map, Text};
use crate::diagnostics::MessageId;
use std::borrow::Borrow;

// CheckMode

checker_flags!(CheckMode: u32 {
    NORMAL = 0, // Normal type checking
    CONTEXTUAL = 1 << 0, // Explicitly assigned contextual type, therefore not cacheable
    INFERENTIAL = 1 << 1, // Inferential typing
    SKIP_CONTEXT_SENSITIVE = 1 << 2, // Skip context sensitive function expressions
    SKIP_GENERIC_FUNCTIONS = 1 << 3, // Skip single signature generic functions
    IS_FOR_SIGNATURE_HELP = 1 << 4, // Call resolution for purposes of signature help
    REST_BINDING_ELEMENT = 1 << 5, // Checking a type that is going to be used to determine the type of a rest binding element
    // e.g. in `const { a, ...rest } = foo`, when checking the type of `foo` to determine the type of `rest`, we need to preserve generic types instead of substituting them for constraints
    TYPE_ONLY = 1 << 6, // Called from getTypeOfExpression, diagnostics may be omitted
    FORCE_TUPLE = 1 << 7,
});

// `any` of upstream that holds a symbol, a type, a signature or a node.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub enum TypeSystemEntity {
    #[default]
    Nil,
    Symbol(SymbolId),
    Type(TypeId),
    Signature(SignatureId),
    Node(NodeId),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub enum TypeSystemPropertyName {
    #[default]
    Type,
    ResolvedBaseConstructorType,
    DeclaredType,
    ResolvedReturnType,
    ResolvedBaseConstraint,
    ResolvedTypeArguments,
    ResolvedBaseTypes,
    WriteType,
    InitializerIsUndefined,
    AliasTarget,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct TypeResolution {
    pub target: TypeSystemEntity,
    pub property_name: TypeSystemPropertyName,
    pub result: bool,
}

// ContextualInfo

#[derive(Clone, Copy, Default, Debug)]
pub struct ContextualInfo {
    pub node: NodeId,
    pub t: TypeId,
    pub is_cache: bool,
}

// InferenceContextInfo

#[derive(Clone, Copy, Default, Debug)]
pub struct InferenceContextInfo {
    pub node: NodeId,
    pub context: InferenceContextId,
}

// WideningKind

checker_flags!(WideningKind: i32 {
    NORMAL = 0,
    FUNCTION_RETURN = 1,
    GENERATOR_NEXT = 2,
    GENERATOR_YIELD = 3,
});

// EnumLiteralKey

// `any` of EnumLiteralKey.value: a string or a number. A number is its bits with both zeros as one key, as a Go map compares float keys with `==`; a NaN never reaches the map.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub enum EnumLiteralValueKey<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(u64),
}

impl<'a> EnumLiteralValueKey<'a> {
    // The key of a literal value, given by value or by reference.
    pub fn of(value: impl Borrow<LiteralValue<'a>>) -> Self {
        match value.borrow() {
            LiteralValue::String(s) => Self::String(s),
            LiteralValue::Number(n) => Self::Number(if *n == 0.0 { 0 } else { n.to_bits() }),
            _ => Self::Nil,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct EnumLiteralKey<'a> {
    pub enum_symbol: SymbolId,
    pub value: EnumLiteralValueKey<'a>,
}

// EnumRelationKey

// The two ids are ast.GetSymbolId of the symbols: making the key assigns them.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct EnumRelationKey {
    pub source_id: u64,
    pub target_id: u64,
}

// TypeCacheKind

checker_flags!(CachedTypeKind: i32 {
    LITERAL_UNION_BASE_TYPE = 0,
    INDEX_TYPE = 1,
    STRING_INDEX_TYPE = 2,
    EQUIVALENT_BASE_TYPE = 3,
    APPARENT_TYPE = 4,
    AWAITED_TYPE = 5,
    EVOLVING_ARRAY_TYPE = 6,
    ARRAY_LITERAL_TYPE = 7,
    PERMISSIVE_INSTANTIATION = 8,
    RESTRICTIVE_INSTANTIATION = 9,
    RESTRICTIVE_TYPE_PARAMETER = 10,
    INDEXED_ACCESS_FOR_READING = 11,
    INDEXED_ACCESS_FOR_WRITING = 12,
    WIDENED = 13,
    REGULAR_OBJECT_LITERAL = 14,
    PROMISED_TYPE_OF_PROMISE = 15,
    DEFAULT_ONLY_TYPE = 16,
    SYNTHETIC_TYPE = 17,
    DECORATOR_CONTEXT = 18,
    DECORATOR_CONTEXT_STATIC = 19,
    DECORATOR_CONTEXT_PRIVATE = 20,
    DECORATOR_CONTEXT_PRIVATE_STATIC = 21,
});

// CachedTypeKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct CachedTypeKey {
    pub kind: CachedTypeKind,
    pub type_id: TypeId,
}

// NarrowedTypeKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct NarrowedTypeKey {
    pub t: TypeId,
    pub candidate: TypeId,
    pub assume_true: bool,
    pub check_derived: bool,
}

// UnionOfUnionKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct UnionOfUnionKey {
    pub id1: TypeId,
    pub id2: TypeId,
    pub r: UnionReduction,
    pub a: CacheHashKey,
}

// CachedSignatureKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct CachedSignatureKey {
    pub sig: SignatureId,
    pub key: CacheHashKey, // Type list key or one of the special keys below
}

pub fn signature_key_erased() -> CacheHashKey {
    CacheHashKey::of(b"-")
}

pub fn signature_key_canonical() -> CacheHashKey {
    CacheHashKey::of(b"*")
}

pub fn signature_key_base() -> CacheHashKey {
    CacheHashKey::of(b"#")
}

pub fn signature_key_inner() -> CacheHashKey {
    CacheHashKey::of(b"<")
}

pub fn signature_key_outer() -> CacheHashKey {
    CacheHashKey::of(b">")
}

// StringMappingKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct StringMappingKey {
    pub s: SymbolId,
    pub t: TypeId,
}

// AssignmentReducedKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct AssignmentReducedKey {
    pub id1: TypeId,
    pub id2: TypeId,
}

// DiscriminatedContextualTypeKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct DiscriminatedContextualTypeKey {
    pub node_id: NodeId,
    pub type_id: TypeId,
}

// InstantiationExpressionKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct InstantiationExpressionKey {
    pub node_id: NodeId,
    pub type_id: TypeId,
}

// SubstitutionTypeKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct SubstitutionTypeKey {
    pub base_id: TypeId,
    pub constraint_id: TypeId,
}

// ReverseMappedTypeKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ReverseMappedTypeKey {
    pub source_id: TypeId,
    pub target_id: TypeId,
    pub constraint_id: TypeId,
}

// IterationTypesKey

// `use` of upstream is a keyword here: the field is `use_flags`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct IterationTypesKey {
    pub type_id: TypeId,
    pub use_flags: IterationUse,
}

// PropertiesTypesKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct PropertiesTypesKey {
    pub type_id: TypeId,
    pub include: TypeFlags,
    pub include_origin: bool,
    pub unresolved_members: bool,
}

// NonExistentPropertyKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct NonExistentPropertyKey {
    pub prop_node: NodeId,
    pub containing_type: TypeId,
    pub is_unchecked_js: bool,
}

// FlowLoopKey

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct FlowLoopKey {
    pub flow_node: FlowNodeId,
    pub ref_key: CacheHashKey,
}

// `types` is appended to while the loop is analysed.
#[derive(Clone, Default, Debug)]
pub struct FlowLoopInfo {
    pub key: FlowLoopKey,
    pub types: Vec<TypeId>,
}

// InferenceFlags

checker_flags!(InferenceFlags: u32 {
    NO_DEFAULT = 1 << 0, // Infer silentNeverType for no inferences (otherwise anyType or unknownType)
    ANY_DEFAULT = 1 << 1, // Infer anyType (in JS files) for no inferences (otherwise unknownType)
    SKIPPED_GENERIC_FUNCTION = 1 << 2, // A generic function was skipped during inference
});

// InferenceContext

// `inferences` is written in place by mergeInferences after other holders got the list, so the holders share its cells.
#[derive(Default)]
pub struct InferenceContext<'a> {
    pub inferences: LiveList<'a, InferenceInfoId>, // Inferences made for each type parameter
    pub signature: SignatureId, // Generic signature for which inferences are made (if any)
    pub flags: InferenceFlags,  // Inference flags
    pub compare_types: TypeComparer, // Type comparer function
    pub mapper: TypeMapperId,   // Mapper that fixes inferences
    pub non_fixing_mapper: TypeMapperId, // Mapper that doesn't fix inferences
    pub return_mapper: TypeMapperId, // Type mapper for inferences from return types (if any)
    pub outer_return_mapper: TypeMapperId, // Type mapper for inferences from return types of outer function (if any)
    pub inferred_type_parameters: List<'a, TypeId>, // Inferred type parameters for function result
    pub intra_expression_inference_sites: Vec<IntraExpressionInferenceSite>,
}

#[derive(Clone, Default, Debug)]
pub struct InferenceInfo {
    pub type_parameter: TypeId, // Type parameter for which inferences are being made
    pub candidates: Vec<TypeId>, // Candidates in covariant positions in decreasing depth order
    pub contra_candidates: Vec<TypeId>, // Candidates in contravariant positions
    pub inferred_type: TypeId,  // Cache for resolved inferred type
    pub priority: InferencePriority, // Priority of current inference set
    pub top_level: bool,        // True if all inferences are to top level occurrences
    pub is_fixed: bool,         // True if inferences are fixed
    pub implied_arity: isize,   // Implied arity (or -1)
}

checker_flags!(InferencePriority: i32 {
    NAKED_TYPE_VARIABLE = 1 << 0, // Naked type variable in union or intersection type
    SPECULATIVE_TUPLE = 1 << 1, // Speculative tuple inference
    SUBSTITUTE_SOURCE = 1 << 2, // Source of inference originated within a substitution type's substitute
    HOMOMORPHIC_MAPPED_TYPE = 1 << 3, // Reverse inference for homomorphic mapped type
    PARTIAL_HOMOMORPHIC_MAPPED_TYPE = 1 << 4, // Partial reverse inference for homomorphic mapped type
    MAPPED_TYPE_CONSTRAINT = 1 << 5, // Reverse inference for mapped type
    CONTRAVARIANT_CONDITIONAL = 1 << 6, // Conditional type in contravariant position
    RETURN_TYPE = 1 << 7, // Inference made from return type of generic function
    LITERAL_KEYOF = 1 << 8, // Inference made from a string literal to a keyof T
    NO_CONSTRAINTS = 1 << 9, // Don't infer from constraints of instantiable types
    ALWAYS_STRICT = 1 << 10, // Always use strict rules for contravariant inferences
    MAX_VALUE = 1 << 11, // Seed for inference priority tracking
    CIRCULARITY = -1, // Inference circularity (value less than all other priorities)
    PRIORITY_IMPLIES_COMBINATION = Self::RETURN_TYPE.0 | Self::MAPPED_TYPE_CONSTRAINT.0 | Self::LITERAL_KEYOF.0, // These priorities imply that the resulting type should be a combination of all candidates
});

#[derive(Clone, Copy, Default, Debug)]
pub struct IntraExpressionInferenceSite {
    pub node: NodeId,
    pub t: TypeId,
}

checker_flags!(DeclarationMeaning: u32 {
    GET_ACCESSOR = 1 << 0,
    SET_ACCESSOR = 1 << 1,
    PROPERTY_ASSIGNMENT = 1 << 2,
    METHOD = 1 << 3,
    PRIVATE_STATIC = 1 << 4,
    GET_OR_SET_ACCESSOR = Self::GET_ACCESSOR.0 | Self::SET_ACCESSOR.0,
    PROPERTY_ASSIGNMENT_OR_METHOD = Self::PROPERTY_ASSIGNMENT.0 | Self::METHOD.0,
});

checker_flags!(DeclarationSpaces: i32 {
    EXPORT_VALUE = 1 << 0,
    EXPORT_TYPE = 1 << 1,
    EXPORT_NAMESPACE = 1 << 2,
});

// IntrinsicTypeKind

checker_flags!(IntrinsicTypeKind: i32 {
    UNKNOWN = 0,
    UPPERCASE = 1,
    LOWERCASE = 2,
    CAPITALIZE = 3,
    UNCAPITALIZE = 4,
    NO_INFER = 5,
});

// `intrinsicTypeKinds[name]`: Unknown for a name that the map of upstream does not have.
pub fn intrinsic_type_kinds(name: &[u8]) -> IntrinsicTypeKind {
    match name {
        b"Uppercase" => IntrinsicTypeKind::UPPERCASE,
        b"Lowercase" => IntrinsicTypeKind::LOWERCASE,
        b"Capitalize" => IntrinsicTypeKind::CAPITALIZE,
        b"Uncapitalize" => IntrinsicTypeKind::UNCAPITALIZE,
        b"NoInfer" => IntrinsicTypeKind::NO_INFER,
        _ => IntrinsicTypeKind::UNKNOWN,
    }
}

checker_flags!(MappedTypeModifiers: u32 {
    INCLUDE_READONLY = 1 << 0,
    EXCLUDE_READONLY = 1 << 1,
    INCLUDE_OPTIONAL = 1 << 2,
    EXCLUDE_OPTIONAL = 1 << 3,
});

checker_flags!(MappedTypeNameTypeKind: i32 {
    FILTERING = 1,
    REMAPPING = 2,
});

checker_flags!(ReferenceHint: i32 {
    UNSPECIFIED = 0,
    IDENTIFIER = 1,
    PROPERTY = 2,
    EXPORT_ASSIGNMENT = 3,
    JSX = 4,
    EXPORT_IMPORT_EQUALS = 5,
    EXPORT_SPECIFIER = 6,
    DECORATOR = 7,
});

checker_flags!(TypeFacts: u32 {
    TYPEOF_EQ_STRING = 1 << 0,
    TYPEOF_EQ_NUMBER = 1 << 1,
    TYPEOF_EQ_BIG_INT = 1 << 2,
    TYPEOF_EQ_BOOLEAN = 1 << 3,
    TYPEOF_EQ_SYMBOL = 1 << 4,
    TYPEOF_EQ_OBJECT = 1 << 5,
    TYPEOF_EQ_FUNCTION = 1 << 6,
    TYPEOF_EQ_HOST_OBJECT = 1 << 7,
    TYPEOF_NE_STRING = 1 << 8,
    TYPEOF_NE_NUMBER = 1 << 9,
    TYPEOF_NE_BIG_INT = 1 << 10,
    TYPEOF_NE_BOOLEAN = 1 << 11,
    TYPEOF_NE_SYMBOL = 1 << 12,
    TYPEOF_NE_OBJECT = 1 << 13,
    TYPEOF_NE_FUNCTION = 1 << 14,
    TYPEOF_NE_HOST_OBJECT = 1 << 15,
    EQ_UNDEFINED = 1 << 16,
    EQ_NULL = 1 << 17,
    EQ_UNDEFINED_OR_NULL = 1 << 18,
    NE_UNDEFINED = 1 << 19,
    NE_NULL = 1 << 20,
    NE_UNDEFINED_OR_NULL = 1 << 21,
    TRUTHY = 1 << 22,
    FALSY = 1 << 23,
    IS_UNDEFINED = 1 << 24,
    IS_NULL = 1 << 25,
    IS_UNDEFINED_OR_NULL = Self::IS_UNDEFINED.0 | Self::IS_NULL.0,
    ALL = (1 << 27) - 1,
    // The following members encode facts about particular kinds of types for use in the getTypeFacts function. The presence of a particular fact means that the given test is true for some (and possibly all) values of that kind of type.
    BASE_STRING_STRICT_FACTS = Self::TYPEOF_EQ_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0,
    BASE_STRING_FACTS = Self::BASE_STRING_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    STRING_STRICT_FACTS = Self::BASE_STRING_STRICT_FACTS.0 | Self::TRUTHY.0 | Self::FALSY.0,
    STRING_FACTS = Self::BASE_STRING_FACTS.0 | Self::TRUTHY.0,
    EMPTY_STRING_STRICT_FACTS = Self::BASE_STRING_STRICT_FACTS.0 | Self::FALSY.0,
    EMPTY_STRING_FACTS = Self::BASE_STRING_FACTS.0,
    NON_EMPTY_STRING_STRICT_FACTS = Self::BASE_STRING_STRICT_FACTS.0 | Self::TRUTHY.0,
    NON_EMPTY_STRING_FACTS = Self::BASE_STRING_FACTS.0 | Self::TRUTHY.0,
    BASE_NUMBER_STRICT_FACTS = Self::TYPEOF_EQ_NUMBER.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0,
    BASE_NUMBER_FACTS = Self::BASE_NUMBER_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    NUMBER_STRICT_FACTS = Self::BASE_NUMBER_STRICT_FACTS.0 | Self::TRUTHY.0 | Self::FALSY.0,
    NUMBER_FACTS = Self::BASE_NUMBER_FACTS.0 | Self::TRUTHY.0,
    ZERO_NUMBER_STRICT_FACTS = Self::BASE_NUMBER_STRICT_FACTS.0 | Self::FALSY.0,
    ZERO_NUMBER_FACTS = Self::BASE_NUMBER_FACTS.0,
    NON_ZERO_NUMBER_STRICT_FACTS = Self::BASE_NUMBER_STRICT_FACTS.0 | Self::TRUTHY.0,
    NON_ZERO_NUMBER_FACTS = Self::BASE_NUMBER_FACTS.0 | Self::TRUTHY.0,
    BASE_BIG_INT_STRICT_FACTS = Self::TYPEOF_EQ_BIG_INT.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0,
    BASE_BIG_INT_FACTS = Self::BASE_BIG_INT_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    BIG_INT_STRICT_FACTS = Self::BASE_BIG_INT_STRICT_FACTS.0 | Self::TRUTHY.0 | Self::FALSY.0,
    BIG_INT_FACTS = Self::BASE_BIG_INT_FACTS.0 | Self::TRUTHY.0,
    ZERO_BIG_INT_STRICT_FACTS = Self::BASE_BIG_INT_STRICT_FACTS.0 | Self::FALSY.0,
    ZERO_BIG_INT_FACTS = Self::BASE_BIG_INT_FACTS.0,
    NON_ZERO_BIG_INT_STRICT_FACTS = Self::BASE_BIG_INT_STRICT_FACTS.0 | Self::TRUTHY.0,
    NON_ZERO_BIG_INT_FACTS = Self::BASE_BIG_INT_FACTS.0 | Self::TRUTHY.0,
    BASE_BOOLEAN_STRICT_FACTS = Self::TYPEOF_EQ_BOOLEAN.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0,
    BASE_BOOLEAN_FACTS = Self::BASE_BOOLEAN_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    BOOLEAN_STRICT_FACTS = Self::BASE_BOOLEAN_STRICT_FACTS.0 | Self::TRUTHY.0 | Self::FALSY.0,
    BOOLEAN_FACTS = Self::BASE_BOOLEAN_FACTS.0 | Self::TRUTHY.0,
    FALSE_STRICT_FACTS = Self::BASE_BOOLEAN_STRICT_FACTS.0 | Self::FALSY.0,
    FALSE_FACTS = Self::BASE_BOOLEAN_FACTS.0,
    TRUE_STRICT_FACTS = Self::BASE_BOOLEAN_STRICT_FACTS.0 | Self::TRUTHY.0,
    TRUE_FACTS = Self::BASE_BOOLEAN_FACTS.0 | Self::TRUTHY.0,
    SYMBOL_STRICT_FACTS = Self::TYPEOF_EQ_SYMBOL.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0 | Self::TRUTHY.0,
    SYMBOL_FACTS = Self::SYMBOL_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    OBJECT_STRICT_FACTS = Self::TYPEOF_EQ_OBJECT.0 | Self::TYPEOF_EQ_HOST_OBJECT.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0 | Self::TRUTHY.0,
    OBJECT_FACTS = Self::OBJECT_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    FUNCTION_STRICT_FACTS = Self::TYPEOF_EQ_FUNCTION.0 | Self::TYPEOF_EQ_HOST_OBJECT.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::NE_UNDEFINED.0 | Self::NE_NULL.0 | Self::NE_UNDEFINED_OR_NULL.0 | Self::TRUTHY.0,
    FUNCTION_FACTS = Self::FUNCTION_STRICT_FACTS.0 | Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::FALSY.0,
    VOID_FACTS = Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::EQ_UNDEFINED.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::NE_NULL.0 | Self::FALSY.0,
    UNDEFINED_FACTS = Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::EQ_UNDEFINED.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::NE_NULL.0 | Self::FALSY.0 | Self::IS_UNDEFINED.0,
    NULL_FACTS = Self::TYPEOF_EQ_OBJECT.0 | Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::TYPEOF_NE_HOST_OBJECT.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::NE_UNDEFINED.0 | Self::FALSY.0 | Self::IS_NULL.0,
    EMPTY_OBJECT_STRICT_FACTS = Self::ALL.0 & !(Self::EQ_UNDEFINED.0 | Self::EQ_NULL.0 | Self::EQ_UNDEFINED_OR_NULL.0 | Self::IS_UNDEFINED_OR_NULL.0),
    EMPTY_OBJECT_FACTS = Self::ALL.0 & !Self::IS_UNDEFINED_OR_NULL.0,
    UNKNOWN_FACTS = Self::ALL.0 & !Self::IS_UNDEFINED_OR_NULL.0,
    ALL_TYPEOF_NE = Self::TYPEOF_NE_STRING.0 | Self::TYPEOF_NE_NUMBER.0 | Self::TYPEOF_NE_BIG_INT.0 | Self::TYPEOF_NE_BOOLEAN.0 | Self::TYPEOF_NE_SYMBOL.0 | Self::TYPEOF_NE_OBJECT.0 | Self::TYPEOF_NE_FUNCTION.0 | Self::NE_UNDEFINED.0,
    // Masks
    OR_FACTS_MASK = Self::TYPEOF_EQ_FUNCTION.0 | Self::TYPEOF_NE_OBJECT.0,
    AND_FACTS_MASK = Self::ALL.0 & !Self::OR_FACTS_MASK.0,
});

checker_flags!(IterationUse: u32 {
    ALLOWS_SYNC_ITERABLES_FLAG = 1 << 0,
    ALLOWS_ASYNC_ITERABLES_FLAG = 1 << 1,
    ALLOWS_STRING_INPUT_FLAG = 1 << 2,
    FOR_OF_FLAG = 1 << 3,
    YIELD_STAR_FLAG = 1 << 4,
    SPREAD_FLAG = 1 << 5,
    DESTRUCTURING_FLAG = 1 << 6,
    POSSIBLY_OUT_OF_BOUNDS = 1 << 7,
    // Spread, Destructuring, Array element assignment
    ELEMENT = Self::ALLOWS_SYNC_ITERABLES_FLAG.0,
    SPREAD = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::SPREAD_FLAG.0,
    DESTRUCTURING = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::DESTRUCTURING_FLAG.0,
    FOR_OF = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::ALLOWS_STRING_INPUT_FLAG.0 | Self::FOR_OF_FLAG.0,
    FOR_AWAIT_OF = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::ALLOWS_ASYNC_ITERABLES_FLAG.0 | Self::ALLOWS_STRING_INPUT_FLAG.0 | Self::FOR_OF_FLAG.0,
    YIELD_STAR = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::YIELD_STAR_FLAG.0,
    ASYNC_YIELD_STAR = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::ALLOWS_ASYNC_ITERABLES_FLAG.0 | Self::YIELD_STAR_FLAG.0,
    GENERATOR_RETURN_TYPE = Self::ALLOWS_SYNC_ITERABLES_FLAG.0,
    ASYNC_GENERATOR_RETURN_TYPE = Self::ALLOWS_ASYNC_ITERABLES_FLAG.0,
    CACHE_FLAGS = Self::ALLOWS_SYNC_ITERABLES_FLAG.0 | Self::ALLOWS_ASYNC_ITERABLES_FLAG.0 | Self::FOR_OF_FLAG.0,
});

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct IterationTypes {
    pub yield_type: TypeId,
    pub return_type: TypeId,
    pub next_type: TypeId,
}

checker_flags!(IterationTypeKind: i32 {
    YIELD = 0,
    RETURN = 1,
    NEXT = 2,
});

// IterationTypesResolver of upstream holds the name of the iterator symbol, seven getters of global types, a resolver of iteration types and three messages. The checker has two of them, made by initializeIterationResolvers, and they differ by the kind of iteration only: a resolver is its kind, and what it holds are functions of the kind.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub enum IterationTypesResolverKind {
    #[default]
    Sync,
    Async,
}

#[derive(Default)]
pub struct WideningContext<'a> {
    pub parent: WideningContextId,               // Parent context
    pub property_name: Text<'a>,                 // Name of property in parent
    pub siblings: List<'a, TypeId>,              // Types of siblings
    pub resolved_properties: List<'a, SymbolId>, // Properties occurring in sibling object literals
    pub child_contexts: Map<Text<'a>, WideningContextId>,
    pub widened_types: Map<TypeId, TypeId>,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct VarianceStackEntry<'a> {
    pub symbol: SymbolId,
    pub type_parameters: List<'a, TypeId>,
}

pub const MAX_SERIALIZATION_LEVEL: isize = 2;

// checker.go:18164: the kind of the `this.property` assignments of a symbol, which the Checker caches by symbol.

checker_flags!(ThisAssignmentDeclarationKind: i32 {
    // NONE: not (all) this.property assignments
    TYPED = 1, // typed; use the type annotation
    CONSTRUCTOR = 2, // at least one in the constructor; use control flow
    METHOD = 3, // methods only; look in base first, and if not found, union all declaration types plus undefined
});

// checker.go:25725

checker_flags!(UnionReduction: i32 {
    LITERAL = 1,
    SUBTYPE = 2,
});

// checker.go:26157

checker_flags!(IntersectionFlags: u32 {
    NO_SUPERTYPE_REDUCTION = 1 << 0,
    NO_CONSTRAINT_REDUCTION = 1 << 1,
});

// relater.go:18-71

checker_flags!(SignatureCheckMode: u32 {
    BIVARIANT_CALLBACK = 1 << 0,
    STRICT_CALLBACK = 1 << 1,
    IGNORE_RETURN_TYPES = 1 << 2,
    STRICT_ARITY = 1 << 3,
    STRICT_TOP_SIGNATURE = 1 << 4,
    CALLBACK = Self::BIVARIANT_CALLBACK.0 | Self::STRICT_CALLBACK.0,
});

checker_flags!(MinArgumentCountFlags: u32 {
    STRONG_ARITY_FOR_UNTYPED_JS = 1 << 0,
    VOID_IS_NON_OPTIONAL = 1 << 1,
});

checker_flags!(IntersectionState: u32 {
    SOURCE = 1 << 0, // Source type is a constituent of an outer intersection
    TARGET = 1 << 1, // Target type is a constituent of an outer intersection
});

checker_flags!(RecursionFlags: u32 {
    SOURCE = 1 << 0,
    TARGET = 1 << 1,
    BOTH = Self::SOURCE.0 | Self::TARGET.0,
});

checker_flags!(ExpandingFlags: u8 {
    SOURCE = 1 << 0,
    TARGET = 1 << 1,
    BOTH = Self::SOURCE.0 | Self::TARGET.0,
});

checker_flags!(RelationComparisonResult: u32 {
    SUCCEEDED = 1 << 0,
    FAILED = 1 << 1,
    REPORTS_UNMEASURABLE = 1 << 3,
    REPORTS_UNRELIABLE = 1 << 4,
    COMPLEXITY_OVERFLOW = 1 << 5,
    REPORTS_MASK = Self::REPORTS_UNMEASURABLE.0 | Self::REPORTS_UNRELIABLE.0,
    OVERFLOW = Self::COMPLEXITY_OVERFLOW.0,
});

// relater.go:83-100

// `func(message *diagnostics.Message, args ...any)` upstream. The one reporter that upstream passes is the reportError of a relater, so a reporter names that relater.
pub type ErrorReporter = Option<RelaterId>;

// `any` of RecursionId.value: a node, a symbol or a type.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub enum RecursionId {
    #[default]
    Nil,
    Node(NodeId),
    Symbol(SymbolId),
    Type(TypeId),
}

// The five relations of the checker, which upstream holds as `*Relation` and compares by pointer. Nil is the relation of a relater that is in the pool.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub enum RelationKind {
    #[default]
    Nil,
    Subtype,
    StrictSubtype,
    Assignable,
    Comparable,
    Identity,
}

#[derive(Default)]
pub struct Relation {
    pub results: Map<CacheHashKey, RelationComparisonResult>,
}

// relater.go:2569-2597

// `related_info` of upstream is the slice header of the related information of the relater at the time of the capture: that slice is only appended to, so the header is a length.
#[derive(Clone, Copy, Default, Debug)]
pub struct ErrorState {
    pub error_chain: ErrorChainId,
    pub related_info_len: usize,
}

// A chain node does not change after it is made, so a captured head stays valid.
#[derive(Clone, Copy, Default)]
pub struct ErrorChain<'a> {
    pub next: ErrorChainId,
    pub message: MessageId,
    pub args: List<'a, Arg<'a>>,
}

// `c` of upstream is the one checker. The chain nodes of a relater are its own records.
#[derive(Default)]
pub struct Relater<'a> {
    pub relation: RelationKind,
    pub error_node: NodeId,
    pub error_chain: ErrorChainId,
    pub error_chains: Records<ErrorChainId, ErrorChain<'a>>,
    pub related_info: Vec<DiagnosticId>,
    pub maybe_keys: Vec<CacheHashKey>,
    pub maybe_keys_set: Set<CacheHashKey>,
    pub source_stack: Vec<TypeId>,
    pub target_stack: Vec<TypeId>,
    pub maybe_count: isize,
    pub source_depth: isize,
    pub target_depth: isize,
    pub expanding_flags: ExpandingFlags,
    pub overflow: bool,
    pub relation_count: isize,
    pub next: RelaterId,
}

// flow.go:19-48

#[derive(Clone, Copy, Default, Debug)]
pub struct FlowType {
    pub t: TypeId,
    pub incomplete: bool,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct SharedFlow {
    pub flow: FlowNodeId,
    pub flow_type: FlowType,
}

// `reduce_labels` holds the nodes of the FlowReduceLabelData that are in force.
#[derive(Default)]
pub struct FlowState {
    pub reference: NodeId,
    pub declared_type: TypeId,
    pub initial_type: TypeId,
    pub flow_container: NodeId,
    pub ref_key: CacheHashKey,
    pub depth: isize,
    pub shared_flow_start: isize,
    pub reduce_labels: Vec<NodeId>,
    pub next: FlowStateId,
}

// inference.go:11-30

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct InferenceKey {
    pub s: TypeId,
    pub t: TypeId,
}

#[derive(Default)]
pub struct InferenceState<'a> {
    pub inferences: LiveList<'a, InferenceInfoId>,
    pub original_source: TypeId,
    pub original_target: TypeId,
    pub priority: InferencePriority,
    pub inference_priority: InferencePriority,
    pub contravariant: bool,
    pub bivariant: bool,
    pub expanding_flags: ExpandingFlags,
    pub propagation_type: TypeId,
    pub visited: Map<InferenceKey, InferencePriority>,
    pub source_stack: Vec<TypeId>,
    pub target_stack: Vec<TypeId>,
    pub next: InferenceStateId,
}

// jsx.go:17-40

checker_flags!(JsxFlags: u32 {
    INTRINSIC_NAMED_ELEMENT = 1 << 0, // An element from a named property of the JSX.IntrinsicElements interface
    INTRINSIC_INDEXED_ELEMENT = 1 << 1, // An element inferred from the string index signature of the JSX.IntrinsicElements interface
    INTRINSIC_ELEMENT = Self::INTRINSIC_NAMED_ELEMENT.0 | Self::INTRINSIC_INDEXED_ELEMENT.0,
});

#[derive(Default)]
pub struct JsxElementLinks {
    pub jsx_flags: JsxFlags,                          // Flags for the JSX element
    pub resolved_jsx_element_attributes_type: TypeId, // Resolved element attributes type of a JSX opening-like element
    pub jsx_namespace: SymbolId,                      // Resolved JSX namespace symbol for this node
    pub jsx_implicit_import_container: SymbolId, // Resolved module symbol the implicit JSX import of this file should refer to
    pub first_jsx_tag_in_file: NodeId,           // The first JSX tag in the file
}

#[cfg(test)]
mod tests {
    use super::*;

    // The numbers are what the constants of upstream evaluate to.
    #[test]
    fn kinds_and_flag_sets_keep_the_values_of_upstream() {
        assert_eq!(CheckMode::FORCE_TUPLE.0, 128);
        assert_eq!(CachedTypeKind::DECORATOR_CONTEXT_PRIVATE_STATIC.0, 21);
        assert_eq!(InferencePriority::CIRCULARITY.0, -1);
        assert_eq!(InferencePriority::PRIORITY_IMPLIES_COMBINATION.0, 416);
        assert!(InferencePriority::CIRCULARITY < InferencePriority::NONE);
        assert!(InferencePriority::RETURN_TYPE < InferencePriority::MAX_VALUE);
        assert_eq!(ReferenceHint::DECORATOR.0, 7);
        assert_eq!(TypeFacts::ALL.0, 134217727);
        assert_eq!(TypeFacts::EMPTY_OBJECT_STRICT_FACTS.0, 83427327);
        assert_eq!(TypeFacts::AND_FACTS_MASK.0, 134209471);
        assert_eq!(TypeFacts::NULL_FACTS.0, 42917664);
        assert_eq!(IterationUse::FOR_AWAIT_OF.0, 15);
        assert_eq!(UnionReduction::SUBTYPE.0, 2);
        assert_eq!(IntersectionFlags::NO_CONSTRAINT_REDUCTION.0, 2);
        assert_eq!(SignatureCheckMode::CALLBACK.0, 3);
        assert_eq!(RelationComparisonResult::REPORTS_MASK.0, 24);
        assert_eq!(JsxFlags::INTRINSIC_ELEMENT.0, 3);
        assert_eq!(ThisAssignmentDeclarationKind::METHOD.0, 3);
        assert_eq!(MAX_SERIALIZATION_LEVEL, 2);
    }

    #[test]
    fn intrinsic_type_kinds_answers_unknown_for_another_name() {
        assert_eq!(
            intrinsic_type_kinds(b"Uppercase"),
            IntrinsicTypeKind::UPPERCASE
        );
        assert_eq!(
            intrinsic_type_kinds(b"NoInfer"),
            IntrinsicTypeKind::NO_INFER
        );
        assert_eq!(
            intrinsic_type_kinds(b"uppercase"),
            IntrinsicTypeKind::UNKNOWN
        );
        assert_eq!(intrinsic_type_kinds(b""), IntrinsicTypeKind::UNKNOWN);
    }

    #[test]
    fn an_enum_literal_key_compares_as_the_key_of_a_go_map() {
        let zero = EnumLiteralValueKey::of(LiteralValue::Number(0.0));
        let negative_zero = LiteralValue::Number(-0.0);
        assert_eq!(zero, EnumLiteralValueKey::of(&negative_zero));
        assert_eq!(zero, EnumLiteralValueKey::of(negative_zero));
        assert_ne!(zero, EnumLiteralValueKey::of(LiteralValue::Number(1.0)));
        assert_eq!(
            EnumLiteralValueKey::of(LiteralValue::String(b"a")),
            EnumLiteralValueKey::String(b"a")
        );
        assert_eq!(
            EnumLiteralValueKey::of(LiteralValue::Boolean(true)),
            EnumLiteralValueKey::Nil
        );
    }

    #[test]
    fn the_five_signature_keys_differ() {
        let keys = [
            signature_key_erased(),
            signature_key_canonical(),
            signature_key_base(),
            signature_key_inner(),
            signature_key_outer(),
        ];
        for (i, first) in keys.iter().enumerate() {
            for second in keys.iter().skip(i + 1) {
                assert_ne!(first, second);
            }
        }
    }
}
