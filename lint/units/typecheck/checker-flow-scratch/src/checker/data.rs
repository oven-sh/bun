// Scratch: the part of the checker data model that flow.rs names, with the field names of checker-data-model-contract/bottom-up.
use crate::ast::{Ast, DiagnosticStore, FlowNodeId, NodeId, SymbolId};
use crate::collections::Set;
use crate::core::{CompilerOptions, LinkStore, List, Map, Text};
use crate::tscore::deps::{hash_bytes, hash_bytes_second};
pub use crate::tscore::ids::{
    FlowStateId, IndexInfoId, SignatureId, TypeAliasId, TypeId, TypePredicateId,
};
use crate::tscore::records::Records;

#[path = "/workspace/notes/lint/units/typecheck/checker-data-model-contract/bottom-up/crate/src/checker/flags_generated.rs"]
pub mod flags_generated;
pub use flags_generated::*;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct AssignmentKind(pub i32);
impl AssignmentKind {
    pub const NONE: Self = Self(0);
    pub const DEFINITE: Self = Self(1);
    pub const COMPOUND: Self = Self(2);
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct CacheHashKey {
    pub hi: u64,
    pub lo: u64,
}
impl CacheHashKey {
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            hi: hash_bytes_second(bytes),
            lo: hash_bytes(bytes),
        }
    }
    pub fn is_zero(self) -> bool {
        self == Self::default()
    }
}

#[derive(Default)]
pub struct KeyBuilder {
    bytes: Vec<u8>,
}
impl KeyBuilder {
    pub fn hash(&self) -> CacheHashKey {
        CacheHashKey::of(&self.bytes)
    }
    pub fn write_byte(&mut self, c: u8) {
        self.bytes.push(c);
    }
    pub fn write_string(&mut self, s: &[u8]) {
        self.bytes.extend_from_slice(s);
    }
    pub fn write_symbol(&mut self, c: &Checker<'_>, s: SymbolId) {
        self.bytes
            .extend_from_slice(&c.ast.get_symbol_id(s).to_le_bytes());
    }
    pub fn write_type(&mut self, t: TypeId) {
        self.bytes.extend_from_slice(&t.0.to_le_bytes());
    }
    pub fn write_node(&mut self, node: NodeId) {
        if !node.is_nil() {
            self.bytes.extend_from_slice(&node.0.to_le_bytes());
        }
    }
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
pub struct AssignmentReducedKey {
    pub id1: TypeId,
    pub id2: TypeId,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct FlowLoopKey {
    pub flow_node: FlowNodeId,
    pub ref_key: CacheHashKey,
}

#[derive(Default)]
pub struct FlowLoopInfo {
    pub key: FlowLoopKey,
    pub types: Vec<TypeId>,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct FlowType {
    pub t: TypeId,
    pub incomplete: bool,
}

#[derive(Clone, Copy, Default)]
pub struct SharedFlow {
    pub flow: FlowNodeId,
    pub flow_type: FlowType,
}

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

#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct PseudoBigInt<'a> {
    pub negative: bool,
    pub base10_value: Text<'a>,
}

#[derive(Default, Clone, PartialEq, Debug)]
pub enum LiteralValue<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(f64),
    Boolean(bool),
    BigInt(PseudoBigInt<'a>),
}

#[derive(Default)]
pub struct Type {
    pub union_types: Vec<TypeId>,
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub symbol: SymbolId,
}

#[derive(Default)]
pub struct Signature<'a> {
    pub declaration: NodeId,
    pub type_parameters: List<'a, TypeId>,
    pub this_parameter: SymbolId,
}

#[derive(Default)]
pub struct TypePredicate {
    pub kind: TypePredicateKind,
    pub parameter_index: i32,
    pub t: TypeId,
}

#[derive(Default)]
pub struct IndexInfo {
    pub value_type: TypeId,
}

#[derive(Default)]
pub struct EvolvingArrayType {
    pub element_type: TypeId,
    pub final_array_type: TypeId,
}

#[derive(Default)]
pub struct LiteralType<'a> {
    pub value: LiteralValue<'a>,
}

#[derive(Default)]
pub struct UniqueESSymbolType<'a> {
    pub name: Text<'a>,
}

#[derive(Default)]
pub struct InterfaceType {
    pub this_type: TypeId,
}

#[derive(Default)]
pub struct SubstitutionType {
    pub base_type: TypeId,
}

#[derive(Default)]
pub struct SwitchStatementLinks<'a> {
    pub exhaustive_state: ExhaustiveState,
    pub switch_types_computed: bool,
    pub witnesses_computed: bool,
    pub switch_types: List<'a, TypeId>,
    pub witnesses: List<'a, Text<'a>>,
}

#[derive(Default)]
pub struct SignatureLinks {
    pub resolved_signature: SignatureId,
    pub effects_signature: SignatureId,
    pub decorator_signature: SignatureId,
}

#[derive(Default)]
pub struct TypeNodeLinks<'a> {
    pub resolved_type: TypeId,
    pub outer_type_parameters: List<'a, TypeId>,
}

#[derive(Default)]
pub struct NodeLinks {
    pub flags: NodeCheckFlags,
}

#[derive(Default)]
pub struct MarkedAssignmentSymbolLinks {
    pub last_assignment_pos: i32,
    pub has_definite_assignment: bool,
}

#[derive(Default)]
pub struct MappedSymbolLinks {
    pub key_type: TypeId,
    pub synthetic_origin: SymbolId,
}

pub struct Checker<'a> {
    pub model: crate::checker::model::Model,
    pub faults: std::cell::Cell<u32>,
    pub ast: Ast<'a>,
    pub stack_check: bun_core::StackCheck,
    pub types: Records<TypeId, Type>,
    pub signatures: Records<SignatureId, Signature<'a>>,
    pub type_predicates: Records<TypePredicateId, TypePredicate>,
    pub index_infos: Records<IndexInfoId, IndexInfo>,
    pub flow_states: Records<FlowStateId, FlowState>,
    pub diagnostic_store: DiagnosticStore,
    pub compiler_options: &'a CompilerOptions,
    pub inline_level: isize,
    pub strict_null_checks: bool,
    pub no_implicit_any: bool,
    pub cached_types: Map<CachedTypeKey, TypeId>,
    pub narrowed_types: Map<NarrowedTypeKey, TypeId>,
    pub assignment_reduced_types: Map<AssignmentReducedKey, TypeId>,
    pub resolving_explicit_type_of_symbol: Set<SymbolId>,
    pub unknown_symbol: SymbolId,
    pub node_links: LinkStore<NodeId, NodeLinks>,
    pub signature_links: LinkStore<NodeId, SignatureLinks>,
    pub type_node_links: LinkStore<NodeId, TypeNodeLinks<'a>>,
    pub switch_statement_links: LinkStore<NodeId, SwitchStatementLinks<'a>>,
    pub mapped_symbol_links: LinkStore<SymbolId, MappedSymbolLinks>,
    pub marked_assignment_symbol_links: LinkStore<SymbolId, MarkedAssignmentSymbolLinks>,
    pub auto_type: TypeId,
    pub error_type: TypeId,
    pub unknown_type: TypeId,
    pub undefined_type: TypeId,
    pub missing_type: TypeId,
    pub null_type: TypeId,
    pub string_type: TypeId,
    pub number_type: TypeId,
    pub bigint_type: TypeId,
    pub boolean_type: TypeId,
    pub es_symbol_type: TypeId,
    pub never_type: TypeId,
    pub silent_never_type: TypeId,
    pub unreachable_never_type: TypeId,
    pub non_primitive_type: TypeId,
    pub empty_object_type: TypeId,
    pub unknown_union_type: TypeId,
    pub unknown_signature: SignatureId,
    pub global_object_type: TypeId,
    pub global_function_type: TypeId,
    pub any_array_type: TypeId,
    pub auto_array_type: TypeId,
    pub free_flow_state: FlowStateId,
    pub flow_loop_cache: Map<FlowLoopKey, TypeId>,
    pub flow_loop_stack: Vec<FlowLoopInfo>,
    pub shared_flows: Vec<SharedFlow>,
    pub antecedent_types: Vec<TypeId>,
    pub flow_analysis_disabled: bool,
    pub flow_invocation_count: isize,
    pub flow_type_cache: Map<NodeId, TypeId>,
    pub last_flow_node: FlowNodeId,
    pub last_flow_node_reachable: bool,
    pub flow_node_reachable: Map<FlowNodeId, bool>,
    pub flow_node_post_super: Map<FlowNodeId, bool>,
}

// The value that replaces the result of a function that upstream leaves through a panic, of a stand-in and of a cut recursion.
pub trait Fallback<'a>: Sized {
    fn fallback(c: &Checker<'a>) -> Self;
}
macro_rules! fallback_default {
    ($($ty:ty),* $(,)?) => {$(
        impl<'a> Fallback<'a> for $ty {
            fn fallback(_: &Checker<'a>) -> Self {
                <$ty>::default()
            }
        }
    )*};
}
fallback_default!((), bool, isize, i32, u32, SymbolId, NodeId, TypeAliasId, TypePredicateId);
impl<'a> Fallback<'a> for TypeId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.error_type
    }
}
impl<'a> Fallback<'a> for SignatureId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.unknown_signature
    }
}

impl<'a> Checker<'a> {
    // A checker for the scratch tests: every record store is empty, the maps that flow.rs writes are made.
    pub fn for_test(ast: Ast<'a>, compiler_options: &'a CompilerOptions) -> Self {
        Self {
            model: Default::default(),
            faults: Default::default(),
            ast,
            stack_check: bun_core::StackCheck::init(),
            types: Default::default(),
            signatures: Default::default(),
            type_predicates: Default::default(),
            index_infos: Default::default(),
            flow_states: Default::default(),
            diagnostic_store: Default::default(),
            compiler_options,
            inline_level: 0,
            strict_null_checks: true,
            no_implicit_any: true,
            cached_types: Map::make(),
            narrowed_types: Map::make(),
            assignment_reduced_types: Map::make(),
            resolving_explicit_type_of_symbol: Default::default(),
            unknown_symbol: Default::default(),
            node_links: Default::default(),
            signature_links: Default::default(),
            type_node_links: Default::default(),
            switch_statement_links: Default::default(),
            mapped_symbol_links: Default::default(),
            marked_assignment_symbol_links: Default::default(),
            auto_type: Default::default(),
            error_type: Default::default(),
            unknown_type: Default::default(),
            undefined_type: Default::default(),
            missing_type: Default::default(),
            null_type: Default::default(),
            string_type: Default::default(),
            number_type: Default::default(),
            bigint_type: Default::default(),
            boolean_type: Default::default(),
            es_symbol_type: Default::default(),
            never_type: Default::default(),
            silent_never_type: Default::default(),
            unreachable_never_type: Default::default(),
            non_primitive_type: Default::default(),
            empty_object_type: Default::default(),
            unknown_union_type: Default::default(),
            unknown_signature: Default::default(),
            global_object_type: Default::default(),
            global_function_type: Default::default(),
            any_array_type: Default::default(),
            auto_array_type: Default::default(),
            free_flow_state: Default::default(),
            flow_loop_cache: Map::make(),
            flow_loop_stack: Vec::new(),
            shared_flows: Vec::new(),
            antecedent_types: Vec::new(),
            flow_analysis_disabled: false,
            flow_invocation_count: 0,
            flow_type_cache: Default::default(),
            last_flow_node: Default::default(),
            last_flow_node_reachable: false,
            flow_node_reachable: Map::make(),
            flow_node_post_super: Map::make(),
        }
    }
}
