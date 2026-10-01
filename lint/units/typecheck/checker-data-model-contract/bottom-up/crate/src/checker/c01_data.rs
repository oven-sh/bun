// checker.go 36-552 and the records of flow.go 19-48, inference.go 11-30, relater.go 87-100 and 2569-2597, jsx.go 34-40.
use crate::ast_diagnostic::Arg;
use crate::checker::c30_type_keys::CacheHashKey;
use crate::checker::flags_generated::{
    CachedTypeKind, ExpandingFlags, InferenceFlags, InferencePriority, IntersectionState,
    IterationUse, JsxFlags, RelationComparisonResult, TypeFlags, UnionReduction,
};
use crate::checker::types::LiteralValue;
use crate::diagnostics::MessageId;
use crate::tscore::golang::{List, LiveList, Map, Set, Text};
use crate::tscore::ids::{
    DiagnosticId, ErrorChainId, FlowNodeId, FlowStateId, InferenceContextId, InferenceInfoId,
    InferenceStateId, NodeId, RelaterId, SignatureId, SymbolId, TypeId, TypeMapperId,
    WideningContextId,
};
use crate::tscore::records::Records;

// TypeSystemEntity is `any` upstream: a symbol, a type, a signature or a node.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeSystemEntity {
    #[default]
    Nil,
    Symbol(SymbolId),
    Type(TypeId),
    Signature(SignatureId),
    Node(NodeId),
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
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

#[derive(Clone, Copy, Default)]
pub struct ContextualInfo {
    pub node: NodeId,
    pub t: TypeId,
    pub is_cache: bool,
}

#[derive(Clone, Copy, Default)]
pub struct InferenceContextInfo {
    pub node: NodeId,
    pub context: InferenceContextId,
}

// EnumLiteralKey.value is `any`: a string or a number. A number is its bit pattern, -0 stored as +0.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub enum EnumLiteralValueKey<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(u64),
}

impl<'a> EnumLiteralValueKey<'a> {
    pub fn of(value: LiteralValue<'a>) -> Self {
        match value {
            LiteralValue::String(s) => Self::String(s),
            LiteralValue::Number(n) => Self::Number(if n == 0.0 { 0 } else { n.to_bits() }),
            _ => Self::Nil,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct EnumLiteralKey<'a> {
    pub enum_symbol: SymbolId,
    pub value: EnumLiteralValueKey<'a>,
}

// The two ids are ast.GetSymbolId values: making the key assigns them.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct EnumRelationKey {
    pub source_id: u64,
    pub target_id: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct CachedTypeKey {
    pub kind: CachedTypeKind,
    pub type_id: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct NarrowedTypeKey {
    pub t: TypeId,
    pub candidate: TypeId,
    pub assume_true: bool,
    pub check_derived: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct UnionOfUnionKey {
    pub id1: TypeId,
    pub id2: TypeId,
    pub r: UnionReduction,
    pub a: CacheHashKey,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct CachedSignatureKey {
    pub sig: SignatureId,
    pub key: CacheHashKey,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct StringMappingKey {
    pub s: SymbolId,
    pub t: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct AssignmentReducedKey {
    pub id1: TypeId,
    pub id2: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct DiscriminatedContextualTypeKey {
    pub node_id: NodeId,
    pub type_id: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct InstantiationExpressionKey {
    pub node_id: NodeId,
    pub type_id: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct SubstitutionTypeKey {
    pub base_id: TypeId,
    pub constraint_id: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct ReverseMappedTypeKey {
    pub source_id: TypeId,
    pub target_id: TypeId,
    pub constraint_id: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct IterationTypesKey {
    pub type_id: TypeId,
    pub use_flags: IterationUse,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct PropertiesTypesKey {
    pub type_id: TypeId,
    pub include: TypeFlags,
    pub include_origin: bool,
    pub unresolved_members: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct NonExistentPropertyKey {
    pub prop_node: NodeId,
    pub containing_type: TypeId,
    pub is_unchecked_js: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct FlowLoopKey {
    pub flow_node: FlowNodeId,
    pub ref_key: CacheHashKey,
}

// `types` is appended to while the loop is analysed.
#[derive(Default)]
pub struct FlowLoopInfo {
    pub key: FlowLoopKey,
    pub types: Vec<TypeId>,
}

// symbolaccessibility.go 402: the kind in the top three bits, the symbol id or node id below.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct SymbolTableKey(pub u64);

// types.go 1425: a comparer is stored in an inference context, so it is a value and not a closure.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeComparer {
    #[default]
    Nil,
    // c.compareTypesAssignable, bound to compareTypesAssignableWorker at checker.go 1262.
    Assignable,
    // r.isRelatedToWorker (relater.go 2624, 3768) and the closure of signatureRelatedTo (relater.go 4587).
    Relater {
        r: RelaterId,
        intersection_state: IntersectionState,
    },
}

// relater.go 87. The only reporter that upstream passes is `r.reportError` of some relater.
pub type ErrorReporter = Option<RelaterId>;

// Inferences made for each type parameter. The list is written in place by mergeInferences (inference.go 1681).
#[derive(Default)]
pub struct InferenceContext<'a> {
    pub inferences: LiveList<'a, InferenceInfoId>,
    pub signature: SignatureId,
    pub flags: InferenceFlags,
    pub compare_types: TypeComparer,
    pub mapper: TypeMapperId,
    pub non_fixing_mapper: TypeMapperId,
    pub return_mapper: TypeMapperId,
    pub outer_return_mapper: TypeMapperId,
    pub inferred_type_parameters: List<'a, TypeId>,
    pub intra_expression_inference_sites: Vec<IntraExpressionInferenceSite>,
}

// candidates and contra_candidates grow by append.
#[derive(Default, Clone)]
pub struct InferenceInfo {
    pub type_parameter: TypeId,
    pub candidates: Vec<TypeId>,
    pub contra_candidates: Vec<TypeId>,
    pub inferred_type: TypeId,
    pub priority: InferencePriority,
    pub top_level: bool,
    pub is_fixed: bool,
    pub implied_arity: isize,
}

#[derive(Clone, Copy, Default)]
pub struct IntraExpressionInferenceSite {
    pub node: NodeId,
    pub t: TypeId,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct IterationTypes {
    pub yield_type: TypeId,
    pub return_type: TypeId,
    pub next_type: TypeId,
}

// The two resolvers of initializeIterationResolvers differ by this kind: the function fields become methods that switch on it.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum IterationTypesResolverKind {
    #[default]
    Sync,
    Async,
}

#[derive(Default)]
pub struct WideningContext<'a> {
    pub parent: WideningContextId,
    pub property_name: Text<'a>,
    pub siblings: List<'a, TypeId>,
    pub resolved_properties: List<'a, SymbolId>,
    pub child_contexts: Map<Text<'a>, WideningContextId>,
    pub widened_types: Map<TypeId, TypeId>,
}

#[derive(Clone, Copy, Default)]
pub struct VarianceStackEntry<'a> {
    pub symbol: SymbolId,
    pub type_parameters: List<'a, TypeId>,
}

pub const MAX_SERIALIZATION_LEVEL: isize = 2;

// checker.go 18164: the constants do not carry the name of the type, so the generator of the flag sets does not see them.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct ThisAssignmentDeclarationKind(pub i32);

impl ThisAssignmentDeclarationKind {
    pub const NONE: Self = Self(0);
    pub const TYPED: Self = Self(1);
    pub const CONSTRUCTOR: Self = Self(2);
    pub const METHOD: Self = Self(3);
}

// flow.go 19
#[derive(Clone, Copy, Default, Debug)]
pub struct FlowType {
    pub t: TypeId,
    pub incomplete: bool,
}

impl FlowType {
    pub const fn is_nil(self) -> bool {
        self.t.is_nil()
    }
}

// flow.go 35
#[derive(Clone, Copy, Default)]
pub struct SharedFlow {
    pub flow: FlowNodeId,
    pub flow_type: FlowType,
}

// flow.go 40. reduce_labels holds the FlowReduceLabelData nodes that are in force.
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

// inference.go 11
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct InferenceKey {
    pub s: TypeId,
    pub t: TypeId,
}

// inference.go 16
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

// relater.go 89-96
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum RecursionId {
    #[default]
    Nil,
    Node(NodeId),
    Symbol(SymbolId),
    Type(TypeId),
}

// Upstream holds five `*Relation` and compares the pointers. Nil is the relation of a relater that sits in the pool.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum RelationKind {
    #[default]
    Nil,
    Subtype,
    StrictSubtype,
    Assignable,
    Comparable,
    Identity,
}

// relater.go 98-115. The map is made by the first `set`.
#[derive(Default)]
pub struct Relation {
    pub results: Map<CacheHashKey, RelationComparisonResult>,
}

// relater.go 2574. A chain node is never changed after it is made, so a saved head stays valid.
#[derive(Clone, Copy, Default)]
pub struct ErrorChain<'a> {
    pub next: ErrorChainId,
    pub message: MessageId,
    pub args: List<'a, Arg<'a>>,
}

// relater.go 2569. related_info is only appended to, so its saved slice header is a length.
#[derive(Clone, Copy, Default)]
pub struct ErrorState {
    pub error_chain: ErrorChainId,
    pub related_info_len: usize,
}

// relater.go 2580. maybe_count, source_depth and target_depth are declared upstream and never read.
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

// jsx.go 34
#[derive(Default)]
pub struct JsxElementLinks {
    pub jsx_flags: JsxFlags,
    pub resolved_jsx_element_attributes_type: TypeId,
    pub jsx_namespace: SymbolId,
    pub jsx_implicit_import_container: SymbolId,
    pub first_jsx_tag_in_file: NodeId,
}

// ast.PatternAmbientModule: core.Pattern is the text with the position of its one star, or -1.
#[derive(Clone, Copy, Default)]
pub struct PatternAmbientModule<'a> {
    pub pattern_text: Text<'a>,
    pub pattern_star_index: isize,
    pub symbol: SymbolId,
}
