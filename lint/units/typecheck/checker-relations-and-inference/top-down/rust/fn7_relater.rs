// relater.go 18-115, 2569-2745, 3089-3222, 4862-4981 and inference.go 11-63, 294-368, 1251-1283, 1519-1528, 1625-1684: callees of other layers are stand-ins.
use crate::arena::Arena;
use crate::checker::{Checker, Fallback};
use crate::flags::{ObjectFlags, TypeFlags};
use crate::golang::{List, Map, SliceBuf, Text};
use crate::ids::*;
use crate::keys::{CacheHashKey, KeyBuilder};
use std::collections::BTreeSet;

define_id!(
    RelaterId,
    ErrorChainId,
    InferenceContextId,
    InferenceInfoId,
    InferenceListId
);

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

impl core::ops::BitAnd for Ternary {
    type Output = Self;
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl core::ops::BitAndAssign for Ternary {
    fn bitand_assign(&mut self, rhs: Self) {
        self.0 &= rhs.0;
    }
}

impl<'a> Fallback<'a> for Ternary {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::FALSE
    }
}

macro_rules! small_flags {
    ($name:ident : $repr:ty { $($flag:ident = $value:expr),* $(,)? }) => {
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Debug)]
        pub struct $name(pub $repr);
        impl $name {
            $(pub const $flag: Self = Self($value);)*
            pub const fn intersects(self, other: Self) -> bool {
                self.0 & other.0 != 0
            }
        }
        impl core::ops::BitOr for $name {
            type Output = Self;
            fn bitor(self, rhs: Self) -> Self {
                Self(self.0 | rhs.0)
            }
        }
        impl core::ops::BitAnd for $name {
            type Output = Self;
            fn bitand(self, rhs: Self) -> Self {
                Self(self.0 & rhs.0)
            }
        }
        impl core::ops::BitOrAssign for $name {
            fn bitor_assign(&mut self, rhs: Self) {
                self.0 |= rhs.0;
            }
        }
    };
}

small_flags!(IntersectionState: u32 { NONE = 0, SOURCE = 1 << 0, TARGET = 1 << 1 });
small_flags!(RecursionFlags: u32 { NONE = 0, SOURCE = 1 << 0, TARGET = 1 << 1, BOTH = 3 });
small_flags!(ExpandingFlags: u8 { NONE = 0, SOURCE = 1 << 0, TARGET = 1 << 1, BOTH = 3 });
small_flags!(RelationComparisonResult: u32 {
    NONE = 0,
    SUCCEEDED = 1 << 0,
    FAILED = 1 << 1,
    REPORTS_UNMEASURABLE = 1 << 3,
    REPORTS_UNRELIABLE = 1 << 4,
    COMPLEXITY_OVERFLOW = 1 << 5,
    REPORTS_MASK = (1 << 3) | (1 << 4),
    OVERFLOW = 1 << 5,
});
// The order of inference priorities is numeric and signed: Circularity is below every other value.
small_flags!(InferencePriority: i32 {
    NONE = 0,
    NAKED_TYPE_VARIABLE = 1 << 0,
    RETURN_TYPE = 1 << 7,
    MAX_VALUE = 1 << 11,
    CIRCULARITY = -1,
});
small_flags!(InferenceFlags: u32 { NONE = 0, NO_DEFAULT = 1 << 0, ANY_DEFAULT = 1 << 1 });

impl<'a> Fallback<'a> for RelationComparisonResult {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NONE
    }
}

// Upstream holds five `*Relation` and compares the pointers. `Nil` is the relation of a relater that sits in the pool.
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

// The messages that relater.go compares by pointer. The id is the code: the 2,206 codes are unique.
pub mod msg {
    use crate::ids::MessageId;
    pub const THE_TYPES_OF_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES: MessageId = MessageId(2200);
    pub const THE_TYPES_RETURNED_BY_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES: MessageId =
        MessageId(2201);
    pub const CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE: MessageId = MessageId(2202);
    pub const CONSTRUCT_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE: MessageId =
        MessageId(2203);
    pub const CALL_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1: MessageId =
        MessageId(2204);
    pub const CONSTRUCT_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1:
        MessageId = MessageId(2205);
    pub const TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1: MessageId = MessageId(2322);
    pub const TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE: MessageId = MessageId(2326);
    pub const OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1:
        MessageId = MessageId(2353);
    pub const OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_BUT_0_DOES_NOT_EXIST_IN_TYPE_1_DID_YOU_MEAN_TO_WRITE_2:
        MessageId = MessageId(2561);
    pub const TYPE_0_HAS_NO_PROPERTIES_IN_COMMON_WITH_TYPE_1: MessageId = MessageId(2559);
    pub const VALUE_OF_TYPE_0_HAS_NO_PROPERTIES_IN_COMMON_WITH_TYPE_1_DID_YOU_MEAN_TO_CALL_IT:
        MessageId = MessageId(2560);
    pub const EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1: MessageId = MessageId(2859);
    // diagnosticMessages.json marks 2202 to 2205 with elidedInCompatabilityPyramid.
    pub fn elided_in_compatibility_pyramid(message: MessageId) -> bool {
        (2202..=2205).contains(&message.0)
    }
}

// One argument of a message: upstream passes `any` and the relater compares and rewrites the strings.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum DiagArg<'a> {
    #[default]
    Nil,
    Text(Text<'a>),
    Int(isize),
}

// relater.go 2574-2578. A node is never changed after it is made, so a saved head stays valid.
#[derive(Clone, Copy, Default)]
pub struct ErrorChain<'a> {
    pub next: ErrorChainId,
    pub message: MessageId,
    pub args: List<'a, DiagArg<'a>>,
}

// relater.go 2569-2572. Restoring the slice header of relatedInfo is a truncation: saves and restores nest.
#[derive(Clone, Copy, Default)]
pub struct ErrorState {
    pub error_chain: ErrorChainId,
    pub related_info_len: usize,
}

// relater.go 2580-2597. maybeCount, sourceDepth and targetDepth are declared upstream and never used.
pub struct Relater<'a> {
    pub relation: RelationKind,
    pub error_node: NodeId,
    pub error_chain: ErrorChainId,
    pub error_chains: Arena<ErrorChainId, ErrorChain<'a>>,
    pub related_info: Vec<DiagnosticId>,
    pub maybe_keys: Vec<CacheHashKey>,
    pub maybe_keys_set: BTreeSet<CacheHashKey>,
    pub source_stack: Vec<TypeId>,
    pub target_stack: Vec<TypeId>,
    pub expanding_flags: ExpandingFlags,
    pub overflow: bool,
    pub relation_count: isize,
    pub next: RelaterId,
}

impl Default for Relater<'_> {
    fn default() -> Self {
        Self {
            relation: RelationKind::Nil,
            error_node: NodeId::NIL,
            error_chain: ErrorChainId::NIL,
            error_chains: Arena::new(),
            related_info: Vec::new(),
            maybe_keys: Vec::new(),
            maybe_keys_set: BTreeSet::new(),
            source_stack: Vec::new(),
            target_stack: Vec::new(),
            expanding_flags: ExpandingFlags::NONE,
            overflow: false,
            relation_count: 0,
            next: RelaterId::NIL,
        }
    }
}

// types.go 1425. A comparer is stored in an inference context, so it is data and not a closure.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeComparer {
    #[default]
    Nil,
    // c.compareTypesAssignable, bound to compareTypesAssignableWorker at checker.go 1262.
    Assignable,
    // r.isRelatedToWorker (relater.go 3616, 3768) and the closure of signatureRelatedTo (relater.go 4587).
    Relater {
        r: RelaterId,
        intersection_state: IntersectionState,
    },
}

// relater.go 87. The only reporter that upstream ever passes is `r.reportError`.
pub type ErrorReporter = Option<RelaterId>;

// relater.go 89-96.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RecursionId {
    Node(NodeId),
    Symbol(SymbolId),
    Type(TypeId),
}

// checker.go 289-298.
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

// checker.go 276-287. `inferences` is a handle: mergeInferences replaces elements that an inference state also sees.
#[derive(Default)]
pub struct InferenceContext<'a> {
    pub inferences: InferenceListId,
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

// inference.go 11-30. It lives on the stack of inferTypes: no callee keeps it.
#[derive(Default)]
pub struct InferenceState {
    pub inferences: InferenceListId,
    pub original_source: TypeId,
    pub original_target: TypeId,
    pub priority: InferencePriority,
    pub inference_priority: InferencePriority,
    pub contravariant: bool,
    pub bivariant: bool,
    pub expanding_flags: ExpandingFlags,
    pub propagation_type: TypeId,
    pub visited: Map<(TypeId, TypeId), InferencePriority>,
    pub source_stack: Vec<TypeId>,
    pub target_stack: Vec<TypeId>,
}

// The checker fields of the two files, kept in one record here so that the scratch needs one new field.
pub struct RelationsAndInference<'a> {
    pub relations: [Relation; 5],
    pub relaters: Arena<RelaterId, Relater<'a>>,
    pub free_relater: RelaterId,
    pub reliability_flags: RelationComparisonResult,
    pub inference_contexts: Arena<InferenceContextId, InferenceContext<'a>>,
    pub inference_infos: Arena<InferenceInfoId, InferenceInfo>,
    pub inference_lists: Arena<InferenceListId, Vec<InferenceInfoId>>,
    // Test hook: the results that the stand-in of structuredTypeRelatedTo hands out, last first.
    pub scripted_structured_results: Vec<Ternary>,
}

impl Default for RelationsAndInference<'_> {
    fn default() -> Self {
        Self {
            relations: Default::default(),
            relaters: Arena::new(),
            free_relater: RelaterId::NIL,
            reliability_flags: RelationComparisonResult::NONE,
            inference_contexts: Arena::new(),
            inference_infos: Arena::new(),
            inference_lists: Arena::new(),
            scripted_structured_results: Vec::new(),
        }
    }
}

const PRIMITIVE: TypeFlags = TypeFlags(0x0001_FFFC | (1 << 22) | (1 << 23));
const STRUCTURED_OR_INSTANTIABLE: TypeFlags = TypeFlags(
    (1 << 20)
        | (1 << 27)
        | (1 << 28)
        | (1 << 19)
        | (1 << 25)
        | (1 << 26)
        | (1 << 24)
        | (1 << 21)
        | (1 << 22)
        | (1 << 23),
);
const SINGLETON: TypeFlags = TypeFlags(
    (1 << 0)
        | (1 << 1)
        | (1 << 5)
        | (1 << 6)
        | (1 << 8)
        | (1 << 7)
        | (1 << 9)
        | (1 << 4)
        | (1 << 2)
        | (1 << 3)
        | (1 << 18)
        | (1 << 17),
);
const NULLABLE: TypeFlags = TypeFlags((1 << 2) | (1 << 3));
const DEFINITELY_NON_NULLABLE: TypeFlags =
    TypeFlags((PRIMITIVE.0 & !((1 << 4) | (1 << 2) | (1 << 3))) | (1 << 20) | (1 << 17));
const OBJECT_FRESH_LITERAL: ObjectFlags = ObjectFlags(1 << 13);
const OBJECT_JSX_ATTRIBUTES: ObjectFlags = ObjectFlags(1 << 11);

impl<'a> Checker<'a> {
    fn relation_index(&self, relation: RelationKind) -> Option<usize> {
        match relation {
            RelationKind::Nil => {
                let _: () = self.fail("nil Relation");
                None
            }
            RelationKind::Subtype => Some(0),
            RelationKind::StrictSubtype => Some(1),
            RelationKind::Assignable => Some(2),
            RelationKind::Comparable => Some(3),
            RelationKind::Identity => Some(4),
        }
    }

    // Relation.get
    pub fn relation_get(
        &self,
        relation: RelationKind,
        key: CacheHashKey,
    ) -> RelationComparisonResult {
        match self
            .relation_index(relation)
            .and_then(|i| self.rel.relations.get(i))
        {
            Some(rel) => rel.results.get(&key),
            None => RelationComparisonResult::NONE,
        }
    }

    // Relation.set
    pub fn relation_set(
        &mut self,
        relation: RelationKind,
        key: CacheHashKey,
        result: RelationComparisonResult,
    ) {
        let Some(rel) = self
            .relation_index(relation)
            .and_then(|i| self.rel.relations.get_mut(i))
        else {
            return;
        };
        if rel.results.is_nil() {
            rel.results = Map::make();
        }
        let ok = rel.results.set(key, result);
        self.map_set(ok);
    }

    // Relation.size
    pub fn relation_size(&self, relation: RelationKind) -> isize {
        match self
            .relation_index(relation)
            .and_then(|i| self.rel.relations.get(i))
        {
            Some(rel) => rel.results.len(),
            None => 0,
        }
    }

    pub fn get_relater(&mut self) -> RelaterId {
        let mut r = self.rel.free_relater;
        if r.is_nil() {
            r = self.rel.relaters.alloc(Relater::default());
        }
        self.rel.free_relater = self.rel.relaters[r].next;
        r
    }

    pub fn put_relater(&mut self, r: RelaterId) {
        let next = self.rel.free_relater;
        let rel = &mut self.rel.relaters[r];
        rel.maybe_keys_set.clear();
        rel.maybe_keys.clear();
        rel.source_stack.clear();
        rel.target_stack.clear();
        rel.relation = RelationKind::Nil;
        rel.error_node = NodeId::NIL;
        rel.error_chain = ErrorChainId::NIL;
        rel.error_chains = Arena::new();
        rel.related_info = Vec::new();
        rel.expanding_flags = ExpandingFlags::NONE;
        rel.overflow = false;
        rel.relation_count = 0;
        rel.next = next;
        self.rel.free_relater = r;
    }

    pub fn check_type_related_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_node: NodeId,
        head_message: MessageId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) -> bool {
        let r = self.get_relater();
        self.rel.relaters[r].relation = relation;
        self.rel.relaters[r].error_node = error_node;
        self.rel.relaters[r].relation_count = (16_000_000 - self.relation_size(relation)) / 8;
        let result = self.is_related_to_ex(
            r,
            source,
            target,
            RecursionFlags::BOTH,
            !error_node.is_nil(),
            head_message,
            IntersectionState::NONE,
        );
        if self.rel.relaters[r].overflow {
            // Record this relation as having failed such that we don't attempt the overflowing operation again.
            let (id, _) = self.get_relation_key(
                source,
                target,
                IntersectionState::NONE,
                relation == RelationKind::Identity,
                false,
            );
            self.relation_set(
                relation,
                id,
                RelationComparisonResult::FAILED | RelationComparisonResult::COMPLEXITY_OVERFLOW,
            );
            let mut error_node = error_node;
            if error_node.is_nil() {
                error_node = self.current_node;
            }
            let args = [
                DiagArg::Text(self.type_to_string(source)),
                DiagArg::Text(self.type_to_string(target)),
            ];
            let diagnostic = self.new_diagnostic_for_node(
                error_node,
                msg::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1,
                &args,
            );
            self.report_diagnostic(diagnostic, diagnostic_output);
        } else if !self.rel.relaters[r].error_chain.is_nil() {
            let chain = self.rel.relaters[r].error_chain;
            let diagnostic = self.create_diagnostic_chain_from_error_chain(r, chain);
            self.report_diagnostic(diagnostic, diagnostic_output);
        }
        self.put_relater(r);
        result != Ternary::FALSE
    }

    // createDiagnosticChainFromErrorChain: the tail of the chain carries the node and the related information.
    pub fn create_diagnostic_chain_from_error_chain(
        &mut self,
        r: RelaterId,
        chain: ErrorChainId,
    ) -> DiagnosticId {
        let mut chain = chain;
        while !chain.is_nil()
            && msg::elided_in_compatibility_pyramid(
                self.rel.relaters[r].error_chains[chain].message,
            )
        {
            chain = self.rel.relaters[r].error_chains[chain].next;
        }
        if chain.is_nil() {
            return DiagnosticId::NIL;
        }
        let node = self.rel.relaters[r].error_chains[chain];
        let next = self.create_diagnostic_chain_from_error_chain(r, node.next);
        if next.is_nil() {
            let error_node = self.rel.relaters[r].error_node;
            let diagnostic =
                self.new_diagnostic_for_node(error_node, node.message, node.args.as_slice());
            let related_info = self.rel.relaters[r].related_info.clone();
            return self.set_related_info(diagnostic, related_info);
        }
        self.new_diagnostic_chain(next, node.message, node.args.as_slice())
    }

    pub fn report_diagnostic(
        &mut self,
        diagnostic: DiagnosticId,
        diagnostic_output: Option<&mut Vec<DiagnosticId>>,
    ) {
        if !diagnostic.is_nil() {
            match diagnostic_output {
                Some(output) => output.push(diagnostic),
                None => self.add_diagnostic(diagnostic),
            }
        }
    }

    pub fn is_related_to_simple(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        self.is_related_to_ex(
            r,
            source,
            target,
            RecursionFlags::BOTH,
            false,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    pub fn is_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        recursion_flags: RecursionFlags,
        report_errors: bool,
    ) -> Ternary {
        self.is_related_to_ex(
            r,
            source,
            target,
            recursion_flags,
            report_errors,
            MessageId::NIL,
            IntersectionState::NONE,
        )
    }

    // The value of a TypeComparer, called.
    pub fn call_type_comparer(
        &mut self,
        compare_types: TypeComparer,
        s: TypeId,
        t: TypeId,
        report_errors: bool,
    ) -> Ternary {
        match compare_types {
            TypeComparer::Nil => self.fail("nil TypeComparer"),
            TypeComparer::Assignable => {
                if self.is_type_related_to(s, t, RelationKind::Assignable) {
                    Ternary::TRUE
                } else {
                    Ternary::FALSE
                }
            }
            TypeComparer::Relater {
                r,
                intersection_state,
            } => self.is_related_to_ex(
                r,
                s,
                t,
                RecursionFlags::BOTH,
                report_errors,
                MessageId::NIL,
                intersection_state,
            ),
        }
    }

    pub fn is_related_to_ex(
        &mut self,
        r: RelaterId,
        original_source: TypeId,
        original_target: TypeId,
        recursion_flags: RecursionFlags,
        report_errors: bool,
        head_message: MessageId,
        intersection_state: IntersectionState,
    ) -> Ternary {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return Ternary::MAYBE;
        }
        if original_source == original_target {
            return Ternary::TRUE;
        }
        let relation = self.rel.relaters[r].relation;
        let error_reporter: ErrorReporter = if report_errors { Some(r) } else { None };
        // An object source and a primitive target need only isSimpleTypeRelatedTo.
        if self.types[original_source]
            .flags
            .intersects(TypeFlags::OBJECT)
            && self.types[original_target].flags.intersects(PRIMITIVE)
        {
            if relation == RelationKind::Comparable
                && !self.types[original_target]
                    .flags
                    .intersects(TypeFlags::NEVER)
                && self.is_simple_type_related_to(original_target, original_source, relation, None)
                || self.is_simple_type_related_to(
                    original_source,
                    original_target,
                    relation,
                    error_reporter,
                )
            {
                return Ternary::TRUE;
            }
            if report_errors {
                self.report_error_results(
                    r,
                    original_source,
                    original_target,
                    original_source,
                    original_target,
                    head_message,
                );
            }
            return Ternary::FALSE;
        }
        let source = self.get_normalized_type(original_source, false);
        let mut target = self.get_normalized_type(original_target, true);
        if source == target {
            return Ternary::TRUE;
        }
        if relation == RelationKind::Identity {
            if self.types[source].flags != self.types[target].flags {
                return Ternary::FALSE;
            }
            if self.types[source].flags.intersects(SINGLETON) {
                return Ternary::TRUE;
            }
            return self.recursive_type_related_to(
                r,
                source,
                target,
                false,
                IntersectionState::NONE,
                recursion_flags,
            );
        }
        if self.types[source]
            .flags
            .intersects(TypeFlags::TYPE_PARAMETER)
            && self.get_constraint_of_type(source) == target
        {
            return Ternary::TRUE;
        }
        // A definitely non-nullable source drops null and undefined from a target union that has one other constituent.
        if self.types[source].flags.intersects(DEFINITELY_NON_NULLABLE)
            && self.types[target].flags.intersects(TypeFlags::UNION)
        {
            let types = self.type_types(target);
            let mut candidate = TypeId::NIL;
            if types.len() == 2 && self.types[types.at(0usize)].flags.intersects(NULLABLE) {
                candidate = types.at(1usize);
            } else if types.len() == 3
                && self.types[types.at(0usize)].flags.intersects(NULLABLE)
                && self.types[types.at(1usize)].flags.intersects(NULLABLE)
            {
                candidate = types.at(2usize);
            }
            if !candidate.is_nil() && !self.types[candidate].flags.intersects(NULLABLE) {
                target = self.get_normalized_type(candidate, true);
                if source == target {
                    return Ternary::TRUE;
                }
            }
        }
        if relation == RelationKind::Comparable
            && !self.types[target].flags.intersects(TypeFlags::NEVER)
            && self.is_simple_type_related_to(target, source, relation, None)
            || self.is_simple_type_related_to(source, target, relation, error_reporter)
        {
            return Ternary::TRUE;
        }
        if self.types[source]
            .flags
            .intersects(STRUCTURED_OR_INSTANTIABLE)
            || self.types[target]
                .flags
                .intersects(STRUCTURED_OR_INSTANTIABLE)
        {
            let is_performing_excess_property_checks = !intersection_state
                .intersects(IntersectionState::TARGET)
                && self.is_object_literal_type(source)
                && self.types[source]
                    .object_flags
                    .intersects(OBJECT_FRESH_LITERAL);
            if is_performing_excess_property_checks {
                if self.has_excess_properties(r, source, target, report_errors) {
                    if report_errors {
                        let shown = if !self.types[original_target].alias.is_nil() {
                            original_target
                        } else {
                            target
                        };
                        self.report_relation_error(r, head_message, source, shown);
                    }
                    return Ternary::FALSE;
                }
            }
            let is_performing_common_property_checks = (relation != RelationKind::Comparable
                || self.is_unit_type(source))
                && !intersection_state.intersects(IntersectionState::TARGET)
                && self.types[source]
                    .flags
                    .intersects(TypeFlags(PRIMITIVE.0 | (1 << 20) | (1 << 28)))
                && source != self.global_object_type()
                && self.types[target]
                    .flags
                    .intersects(TypeFlags((1 << 20) | (1 << 28)))
                && self.is_weak_type(target)
                && (self.get_properties_of_type(source).len() > 0
                    || self.type_has_call_or_construct_signatures(source));
            let is_comparing_jsx_attributes = self.types[source]
                .object_flags
                .intersects(OBJECT_JSX_ATTRIBUTES);
            if is_performing_common_property_checks
                && !self.has_common_properties(source, target, is_comparing_jsx_attributes)
            {
                if report_errors {
                    let shown_source = if !self.types[original_source].alias.is_nil() {
                        original_source
                    } else {
                        source
                    };
                    let shown_target = if !self.types[original_target].alias.is_nil() {
                        original_target
                    } else {
                        target
                    };
                    let source_string = self.type_to_string(shown_source);
                    let target_string = self.type_to_string(shown_target);
                    let calls = self.get_signatures_of_type(source, 0);
                    let constructs = self.get_signatures_of_type(source, 1);
                    let mut did_you_mean_to_call = false;
                    if calls.len() > 0 {
                        let return_type = self.get_return_type_of_signature(calls.at(0usize));
                        did_you_mean_to_call = self.is_related_to(
                            r,
                            return_type,
                            target,
                            RecursionFlags::SOURCE,
                            false,
                        ) != Ternary::FALSE;
                    }
                    if !did_you_mean_to_call && constructs.len() > 0 {
                        let return_type = self.get_return_type_of_signature(constructs.at(0usize));
                        did_you_mean_to_call = self.is_related_to(
                            r,
                            return_type,
                            target,
                            RecursionFlags::SOURCE,
                            false,
                        ) != Ternary::FALSE;
                    }
                    let args = [DiagArg::Text(source_string), DiagArg::Text(target_string)];
                    if did_you_mean_to_call {
                        self.report_error(
                            r,
                            msg::VALUE_OF_TYPE_0_HAS_NO_PROPERTIES_IN_COMMON_WITH_TYPE_1_DID_YOU_MEAN_TO_CALL_IT,
                            &args,
                        );
                    } else {
                        self.report_error(
                            r,
                            msg::TYPE_0_HAS_NO_PROPERTIES_IN_COMMON_WITH_TYPE_1,
                            &args,
                        );
                    }
                }
                return Ternary::FALSE;
            }
            let skip_caching = self.types[source].flags.intersects(TypeFlags::UNION)
                && self.type_types(source).len() < 4
                && !self.types[target].flags.intersects(TypeFlags::UNION)
                || self.types[target].flags.intersects(TypeFlags::UNION)
                    && self.type_types(target).len() < 4
                    && !self.types[source]
                        .flags
                        .intersects(STRUCTURED_OR_INSTANTIABLE);
            let result = if skip_caching {
                self.union_or_intersection_related_to(
                    r,
                    source,
                    target,
                    report_errors,
                    intersection_state,
                )
            } else {
                self.recursive_type_related_to(
                    r,
                    source,
                    target,
                    report_errors,
                    intersection_state,
                    recursion_flags,
                )
            };
            if result != Ternary::FALSE {
                return result;
            }
        }
        if report_errors {
            self.report_error_results(
                r,
                original_source,
                original_target,
                source,
                target,
                head_message,
            );
        }
        Ternary::FALSE
    }

    pub fn recursive_type_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
        recursion_flags: RecursionFlags,
    ) -> Ternary {
        if self.rel.relaters[r].overflow {
            return Ternary::FALSE;
        }
        let relation = self.rel.relaters[r].relation;
        let is_identity = relation == RelationKind::Identity;
        let (id, constrained) =
            self.get_relation_key(source, target, intersection_state, is_identity, false);
        // Upstream reads through the nil relation of a pooled relater here and stops.
        if relation == RelationKind::Nil {
            return self.fail("nil Relation");
        }
        let entry = self.relation_get(relation, id);
        if entry != RelationComparisonResult::NONE {
            if report_errors
                && entry.intersects(RelationComparisonResult::FAILED)
                && !entry.intersects(RelationComparisonResult::OVERFLOW)
            {
                // A cached failure that is not an overflow is compared again when errors are wanted.
            } else {
                self.rel.reliability_flags |= entry & RelationComparisonResult::REPORTS_MASK;
                if report_errors && entry.intersects(RelationComparisonResult::OVERFLOW) {
                    let args = [
                        DiagArg::Text(self.type_to_string(source)),
                        DiagArg::Text(self.type_to_string(target)),
                    ];
                    self.report_error(r, msg::EXCESSIVE_COMPLEXITY_COMPARING_TYPES_0_AND_1, &args);
                }
                if entry.intersects(RelationComparisonResult::SUCCEEDED) {
                    return Ternary::TRUE;
                }
                return Ternary::FALSE;
            }
        }
        if self.rel.relaters[r].relation_count <= 0 {
            self.rel.relaters[r].overflow = true;
            return Ternary::FALSE;
        }
        // If source and target are already being compared, consider them related with assumptions
        if self.rel.relaters[r].maybe_keys_set.contains(&id) {
            return Ternary::MAYBE;
        }
        if constrained {
            let (broadest_equivalent_id, _) =
                self.get_relation_key(source, target, intersection_state, is_identity, true);
            if self.rel.relaters[r]
                .maybe_keys_set
                .contains(&broadest_equivalent_id)
            {
                return Ternary::MAYBE;
            }
        }
        if self.rel.relaters[r].source_stack.len() == 100
            || self.rel.relaters[r].target_stack.len() == 100
        {
            // We stop relating if we reach 100 levels of nesting.
            return Ternary::MAYBE;
        }
        let maybe_start = self.rel.relaters[r].maybe_keys.len();
        self.rel.relaters[r].maybe_keys.push(id);
        self.rel.relaters[r].maybe_keys_set.insert(id);
        let save_expanding_flags = self.rel.relaters[r].expanding_flags;
        if recursion_flags.intersects(RecursionFlags::SOURCE) {
            self.rel.relaters[r].source_stack.push(source);
            if !self.rel.relaters[r]
                .expanding_flags
                .intersects(ExpandingFlags::SOURCE)
                && self.is_deeply_nested_type_in_relater(r, source, true, 3)
            {
                self.rel.relaters[r].expanding_flags |= ExpandingFlags::SOURCE;
            }
        }
        if recursion_flags.intersects(RecursionFlags::TARGET) {
            self.rel.relaters[r].target_stack.push(target);
            if !self.rel.relaters[r]
                .expanding_flags
                .intersects(ExpandingFlags::TARGET)
                && self.is_deeply_nested_type_in_relater(r, target, false, 3)
            {
                self.rel.relaters[r].expanding_flags |= ExpandingFlags::TARGET;
            }
        }
        let save_reliability_flags = self.rel.reliability_flags;
        self.rel.reliability_flags = RelationComparisonResult::NONE;
        let result = if self.rel.relaters[r].expanding_flags == ExpandingFlags::BOTH {
            Ternary::MAYBE
        } else {
            self.structured_type_related_to(r, source, target, report_errors, intersection_state)
        };
        let propagating_variance_flags = self.rel.reliability_flags;
        self.rel.reliability_flags |= save_reliability_flags;
        if recursion_flags.intersects(RecursionFlags::SOURCE) {
            self.rel.relaters[r].source_stack.pop();
        }
        if recursion_flags.intersects(RecursionFlags::TARGET) {
            self.rel.relaters[r].target_stack.pop();
        }
        self.rel.relaters[r].expanding_flags = save_expanding_flags;
        if result != Ternary::FALSE {
            if result == Ternary::TRUE
                || (self.rel.relaters[r].source_stack.is_empty()
                    && self.rel.relaters[r].target_stack.is_empty())
            {
                // Record Ternary.Maybe results as having succeeded once we reach depth 0, but never record Ternary.Unknown results.
                let mark = result == Ternary::TRUE || result == Ternary::MAYBE;
                self.reset_maybe_stack(r, maybe_start, propagating_variance_flags, mark);
            }
        } else {
            // A false result goes straight into global cache
            self.relation_set(
                relation,
                id,
                RelationComparisonResult::FAILED | propagating_variance_flags,
            );
            self.rel.relaters[r].relation_count -= 1;
            self.reset_maybe_stack(r, maybe_start, propagating_variance_flags, false);
        }
        result
    }

    pub fn reset_maybe_stack(
        &mut self,
        r: RelaterId,
        maybe_start: usize,
        propagating_variance_flags: RelationComparisonResult,
        mark_all_as_succeeded: bool,
    ) {
        let relation = self.rel.relaters[r].relation;
        let mut i = maybe_start;
        while i < self.rel.relaters[r].maybe_keys.len() {
            let Some(&key) = self.rel.relaters[r].maybe_keys.get(i) else {
                break;
            };
            self.rel.relaters[r].maybe_keys_set.remove(&key);
            if mark_all_as_succeeded {
                self.relation_set(
                    relation,
                    key,
                    RelationComparisonResult::SUCCEEDED | propagating_variance_flags,
                );
                self.rel.relaters[r].relation_count -= 1;
            }
            i += 1;
        }
        self.rel.relaters[r].maybe_keys.truncate(maybe_start);
    }

    pub fn get_error_state(&self, r: RelaterId) -> ErrorState {
        ErrorState {
            error_chain: self.rel.relaters[r].error_chain,
            related_info_len: self.rel.relaters[r].related_info.len(),
        }
    }

    pub fn restore_error_state(&mut self, r: RelaterId, e: ErrorState) {
        self.rel.relaters[r].error_chain = e.error_chain;
        self.rel.relaters[r]
            .related_info
            .truncate(e.related_info_len);
    }

    pub fn report_error(&mut self, r: RelaterId, message: MessageId, args: &[DiagArg<'a>]) {
        let mut message = message;
        let mut args: Vec<DiagArg<'a>> = args.to_vec();
        if message == msg::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE {
            // Suppress if next message is an excess property error
            let first = self.get_chain_message(r, 0);
            if first
                == msg::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_AND_0_DOES_NOT_EXIST_IN_TYPE_1
                || first
                    == msg::OBJECT_LITERAL_MAY_ONLY_SPECIFY_KNOWN_PROPERTIES_BUT_0_DOES_NOT_EXIST_IN_TYPE_1_DID_YOU_MEAN_TO_WRITE_2
            {
                return;
            }
            // A property message above a return type marker becomes one message for 'x()' or 'x(...)'.
            let name = self.get_property_name_arg(args.first().copied().unwrap_or_default());
            let second = self.get_chain_message(r, 1);
            let mut arg: Vec<u8> = Vec::new();
            if second == msg::CALL_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1 {
                arg = [name.as_slice(), b"()"].concat();
            } else if second
                == msg::CONSTRUCT_SIGNATURES_WITH_NO_ARGUMENTS_HAVE_INCOMPATIBLE_RETURN_TYPES_0_AND_1
            {
                arg = [b"new ", name.as_slice(), b"()"].concat();
            } else if second == msg::CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE {
                arg = [name.as_slice(), b"(...)"].concat();
            } else if second == msg::CONSTRUCT_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE {
                arg = [b"new ", name.as_slice(), b"(...)"].concat();
            }
            if !arg.is_empty() {
                message = msg::THE_TYPES_RETURNED_BY_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES;
                if let Some(slot) = args.first_mut() {
                    *slot = DiagArg::Text(self.text(&arg));
                }
                let head = self.rel.relaters[r].error_chain;
                let next = self.rel.relaters[r].error_chains[head].next;
                self.rel.relaters[r].error_chain = self.rel.relaters[r].error_chains[next].next;
            }
            // A property message above a property message becomes one message for 'x.y'.
            let second = self.get_chain_message(r, 1);
            if second == msg::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE
                || second == msg::THE_TYPES_OF_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES
                || second == msg::THE_TYPES_RETURNED_BY_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES
            {
                let head = self.get_property_name_arg(args.first().copied().unwrap_or_default());
                let chain_head = self.rel.relaters[r].error_chain;
                let chain_next = self.rel.relaters[r].error_chains[chain_head].next;
                let tail_arg = self.rel.relaters[r].error_chains[chain_next]
                    .args
                    .at(0usize);
                let tail = self.get_property_name_arg(tail_arg);
                let arg = add_to_dotted_name(&head, &tail);
                self.rel.relaters[r].error_chain =
                    self.rel.relaters[r].error_chains[chain_next].next;
                if message == msg::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE {
                    message = msg::THE_TYPES_OF_0_ARE_INCOMPATIBLE_BETWEEN_THESE_TYPES;
                }
                let arg = [DiagArg::Text(self.text(&arg))];
                self.report_error(r, message, &arg);
                return;
            }
        }
        let mut buf = SliceBuf::make(0, args.len() as isize);
        for a in args {
            buf.push(a);
        }
        let args = self.list(&buf);
        let next = self.rel.relaters[r].error_chain;
        let node = self.rel.relaters[r].error_chains.alloc(ErrorChain {
            next,
            message,
            args,
        });
        self.rel.relaters[r].error_chain = node;
    }

    pub fn get_chain_message(&self, r: RelaterId, index: isize) -> MessageId {
        let mut e = self.rel.relaters[r].error_chain;
        let mut index = index;
        loop {
            if e.is_nil() {
                return MessageId::NIL;
            }
            if index == 0 {
                return self.rel.relaters[r].error_chains[e].message;
            }
            e = self.rel.relaters[r].error_chains[e].next;
            index -= 1;
        }
    }

    // Return true if the arguments of the first entry on the error chain match the given arguments (where Nil acts as a wildcard).
    pub fn chain_args_match(&self, r: RelaterId, args: &[DiagArg<'a>]) -> bool {
        let head = self.rel.relaters[r].error_chain;
        let chain_args = self.rel.relaters[r].error_chains[head].args;
        for (i, a) in args.iter().enumerate() {
            if *a != DiagArg::Nil && *a != chain_args.at(i) {
                return false;
            }
        }
        true
    }

    // getPropertyNameArg: upstream asserts the argument to be a string.
    pub fn get_property_name_arg(&self, arg: DiagArg<'a>) -> Vec<u8> {
        let DiagArg::Text(s) = arg else {
            return self
                .fail::<&'a [u8]>("interface conversion: interface {} is not string")
                .to_vec();
        };
        match s.first() {
            Some(b'"' | b'\'' | b'`') => [b"[", s, b"]"].concat(),
            _ => s.to_vec(),
        }
    }

    pub fn chain_depth(&self, r: RelaterId, chain: ErrorChainId) -> isize {
        let mut depth = 0;
        let mut chain = chain;
        while !chain.is_nil() {
            depth += 1;
            chain = self.rel.relaters[r].error_chains[chain].next;
        }
        depth
    }

    // getRelationKey (checker.go 17723-17739), without the branch for two generic type references.
    pub fn get_relation_key(
        &mut self,
        source: TypeId,
        target: TypeId,
        intersection_state: IntersectionState,
        is_identity: bool,
        ignore_constraints: bool,
    ) -> (CacheHashKey, bool) {
        let (mut source, mut target) = (source, target);
        if is_identity && self.types[source].id > self.types[target].id {
            core::mem::swap(&mut source, &mut target);
        }
        let mut b = KeyBuilder::default();
        let mut constrained = false;
        if self.is_type_reference_with_generic_arguments(source)
            && self.is_type_reference_with_generic_arguments(target)
        {
            b.write_byte(b'g');
            constrained =
                self.write_generic_type_references(&mut b, source, target, ignore_constraints);
        } else {
            b.write_byte(b's');
            b.write_type(self.types[source].id);
            b.write_type(self.types[target].id);
        }
        b.write_uint32(intersection_state.0);
        (b.hash(), constrained)
    }

    // A callee of another layer that takes a comparer of two types: the closure gets the checker back as its parameter.
    pub fn find_matching_discriminant_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        is_related_to: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> Ternary,
    ) -> TypeId {
        if is_related_to(self, source, target) != Ternary::FALSE {
            return target;
        }
        TypeId::NIL
    }

    // The call shape of relater.go 2759: the method value `r.isRelatedToSimple` is a closure over the id.
    pub fn reduced_target_of(&mut self, r: RelaterId, source: TypeId, target: TypeId) -> TypeId {
        self.find_matching_discriminant_type(source, target, &mut |c, s, t| {
            c.is_related_to_simple(r, s, t)
        })
    }

    // compareSignaturesRelated takes the reporter and the comparer as data: both name the same relater.
    pub fn signature_related_to(
        &mut self,
        r: RelaterId,
        source: SignatureId,
        target: SignatureId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let compare_types = TypeComparer::Relater {
            r,
            intersection_state,
        };
        self.compare_signatures_related(source, target, report_errors, Some(r), compare_types)
    }

    pub fn compare_signatures_related(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        report_errors: bool,
        error_reporter: ErrorReporter,
        compare_types: TypeComparer,
    ) -> Ternary {
        if source == target {
            return Ternary::TRUE;
        }
        let source_return_type = self.signatures[source].resolved_return_type;
        let target_return_type = self.signatures[target].resolved_return_type;
        let related = self.call_type_comparer(
            compare_types,
            source_return_type,
            target_return_type,
            report_errors,
        );
        if related == Ternary::FALSE && report_errors {
            if let Some(r) = error_reporter {
                let args = [
                    DiagArg::Text(self.type_to_string(source_return_type)),
                    DiagArg::Text(self.type_to_string(target_return_type)),
                ];
                self.report_error(
                    r,
                    msg::CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE,
                    &args,
                );
            }
        }
        related
    }

    // newInferenceContext and newInferenceContextWorker.
    pub fn new_inference_context(
        &mut self,
        type_parameters: List<'a, TypeId>,
        signature: SignatureId,
        flags: InferenceFlags,
        compare_types: TypeComparer,
    ) -> InferenceContextId {
        let compare_types = if compare_types == TypeComparer::Nil {
            TypeComparer::Assignable
        } else {
            compare_types
        };
        let mut inferences = Vec::new();
        for tp in type_parameters.iter() {
            inferences.push(self.new_inference_info(tp));
        }
        let inferences = self.rel.inference_lists.alloc(inferences);
        self.new_inference_context_worker(inferences, signature, flags, compare_types)
    }

    pub fn new_inference_context_worker(
        &mut self,
        inferences: InferenceListId,
        signature: SignatureId,
        flags: InferenceFlags,
        compare_types: TypeComparer,
    ) -> InferenceContextId {
        let n = self.rel.inference_contexts.alloc(InferenceContext {
            inferences,
            signature,
            flags,
            compare_types,
            ..Default::default()
        });
        let mapper = self.new_inference_type_mapper(n, true);
        self.rel.inference_contexts[n].mapper = mapper;
        let non_fixing_mapper = self.new_inference_type_mapper(n, false);
        self.rel.inference_contexts[n].non_fixing_mapper = non_fixing_mapper;
        n
    }

    pub fn new_inference_info(&mut self, type_parameter: TypeId) -> InferenceInfoId {
        self.rel.inference_infos.alloc(InferenceInfo {
            type_parameter,
            priority: InferencePriority::MAX_VALUE,
            top_level: true,
            implied_arity: -1,
            ..Default::default()
        })
    }

    pub fn clone_inference_info(&mut self, info: InferenceInfoId) -> InferenceInfoId {
        let copy = self.rel.inference_infos[info].clone();
        self.rel.inference_infos.alloc(copy)
    }

    pub fn clear_cached_inferences(&mut self, inferences: InferenceListId) {
        let mut i = 0;
        while let Some(&inference) = self.rel.inference_lists[inferences].get(i) {
            if !self.rel.inference_infos[inference].is_fixed {
                self.rel.inference_infos[inference].inferred_type = TypeId::NIL;
            }
            i += 1;
        }
    }

    pub fn has_inference_candidates(&self, info: InferenceInfoId) -> bool {
        !self.rel.inference_infos[info].candidates.is_empty()
            || !self.rel.inference_infos[info].contra_candidates.is_empty()
    }

    // mergeInferences: the element of the target list is replaced, the record that it named is left as it is.
    pub fn merge_inferences(&mut self, target: InferenceListId, source: InferenceListId) {
        let mut i = 0;
        while let Some(&t) = self.rel.inference_lists[target].get(i) {
            let s = self.rel.inference_lists[source]
                .get(i)
                .copied()
                .unwrap_or_default();
            if !self.has_inference_candidates(t) && self.has_inference_candidates(s) {
                if let Some(slot) = self.rel.inference_lists[target].get_mut(i) {
                    *slot = s;
                }
            }
            i += 1;
        }
    }

    pub fn get_inference_info_for_type(&self, n: &InferenceState, t: TypeId) -> InferenceInfoId {
        if self.types[t]
            .flags
            .intersects(TypeFlags((1 << 19) | (1 << 25)))
        {
            for &inference in &self.rel.inference_lists[n.inferences] {
                if t == self.rel.inference_infos[inference].type_parameter {
                    return inference;
                }
            }
        }
        InferenceInfoId::NIL
    }

    pub fn infer_types(
        &mut self,
        inferences: InferenceListId,
        original_source: TypeId,
        original_target: TypeId,
        priority: InferencePriority,
        contravariant: bool,
    ) {
        let mut n = InferenceState {
            inferences,
            original_source,
            original_target,
            priority,
            inference_priority: InferencePriority::MAX_VALUE,
            contravariant,
            ..Default::default()
        };
        self.infer_from_types(&mut n, original_source, original_target);
    }

    pub fn infer_with_priority(
        &mut self,
        n: &mut InferenceState,
        source: TypeId,
        target: TypeId,
        new_priority: InferencePriority,
    ) {
        let save_priority = n.priority;
        n.priority |= new_priority;
        self.infer_from_types(n, source, target);
        n.priority = save_priority;
    }

    pub fn infer_from_contravariant_types(
        &mut self,
        n: &mut InferenceState,
        source: TypeId,
        target: TypeId,
    ) {
        n.contravariant = !n.contravariant;
        self.infer_from_types(n, source, target);
        n.contravariant = !n.contravariant;
    }

    pub fn invoke_once(
        &mut self,
        n: &mut InferenceState,
        source: TypeId,
        target: TypeId,
        action: fn(&mut Checker<'a>, &mut InferenceState, TypeId, TypeId),
    ) {
        let key = (self.types[source].id, self.types[target].id);
        if let Some(status) = n.visited.get_ok(&key) {
            n.inference_priority = n.inference_priority.min(status);
            return;
        }
        if n.visited.is_nil() {
            n.visited = Map::make();
        }
        let ok = n.visited.set(key, InferencePriority::CIRCULARITY);
        self.map_set(ok);
        let save_inference_priority = n.inference_priority;
        n.inference_priority = InferencePriority::MAX_VALUE;
        // Duplicate recursion identities on both sides stop the inference and report a circularity.
        let save_expanding_flags = n.expanding_flags;
        n.source_stack.push(source);
        n.target_stack.push(target);
        if self.is_deeply_nested_type(source, &n.source_stack, 2) {
            n.expanding_flags |= ExpandingFlags::SOURCE;
        }
        if self.is_deeply_nested_type(target, &n.target_stack, 2) {
            n.expanding_flags |= ExpandingFlags::TARGET;
        }
        if n.expanding_flags != ExpandingFlags::BOTH {
            action(self, n, source, target);
        } else {
            n.inference_priority = InferencePriority::CIRCULARITY;
        }
        n.target_stack.pop();
        n.source_stack.pop();
        n.expanding_flags = save_expanding_flags;
        let ok = n.visited.set(key, n.inference_priority);
        self.map_set(ok);
        n.inference_priority = n.inference_priority.min(save_inference_priority);
    }

    // The call shape of inference.go 853-866: a callback of another function that writes to the state.
    pub fn infer_from_signature(
        &mut self,
        n: &mut InferenceState,
        source: SignatureId,
        target: SignatureId,
    ) {
        let save_bivariant = n.bivariant;
        n.bivariant = true;
        self.apply_to_return_types(source, target, &mut |c, s, t| {
            c.infer_from_contravariant_types(n, s, t);
        });
        n.bivariant = save_bivariant;
        self.apply_to_return_types(source, target, &mut |c, s, t| c.infer_from_types(n, s, t));
    }

    pub fn apply_to_return_types(
        &mut self,
        source: SignatureId,
        target: SignatureId,
        callback: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId),
    ) {
        let source_return_type = self.signatures[source].resolved_return_type;
        let target_return_type = self.signatures[target].resolved_return_type;
        callback(self, source_return_type, target_return_type);
    }

    // The stack of the relater is read while the checker is borrowed: the check takes the side, not the slice.
    fn is_deeply_nested_type_in_relater(
        &mut self,
        r: RelaterId,
        t: TypeId,
        source_side: bool,
        max_depth: isize,
    ) -> bool {
        let stack = if source_side {
            core::mem::take(&mut self.rel.relaters[r].source_stack)
        } else {
            core::mem::take(&mut self.rel.relaters[r].target_stack)
        };
        let result = self.is_deeply_nested_type(t, &stack, max_depth);
        if source_side {
            self.rel.relaters[r].source_stack = stack;
        } else {
            self.rel.relaters[r].target_stack = stack;
        }
        result
    }

    pub fn structured_type_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let _ = (r, source, target, report_errors, intersection_state);
        match self.rel.scripted_structured_results.pop() {
            Some(result) => result,
            None => self.stand_in("Relater.structuredTypeRelatedTo"),
        }
    }

    pub fn is_deeply_nested_type(&mut self, t: TypeId, stack: &[TypeId], max_depth: isize) -> bool {
        let _ = (t, stack, max_depth);
        false
    }

    pub fn infer_from_types(&mut self, n: &mut InferenceState, source: TypeId, target: TypeId) {
        let _ = (n, source, target);
        self.stand_in("inferFromTypes")
    }

    pub fn new_inference_type_mapper(
        &mut self,
        n: InferenceContextId,
        fixing: bool,
    ) -> TypeMapperId {
        let _ = (n, fixing);
        self.stand_in("newInferenceTypeMapper")
    }

    pub fn is_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
    ) -> bool {
        let _ = (source, target, relation);
        self.stand_in("isTypeRelatedTo")
    }

    pub fn is_simple_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: RelationKind,
        error_reporter: ErrorReporter,
    ) -> bool {
        let _ = (source, target, relation, error_reporter);
        false
    }

    pub fn get_normalized_type(&mut self, t: TypeId, writing: bool) -> TypeId {
        let _ = writing;
        t
    }

    pub fn get_constraint_of_type(&mut self, t: TypeId) -> TypeId {
        let _ = t;
        self.stand_in("getConstraintOfType")
    }

    pub fn is_object_literal_type(&mut self, t: TypeId) -> bool {
        let _ = t;
        false
    }

    pub fn is_unit_type(&mut self, t: TypeId) -> bool {
        let _ = t;
        false
    }

    pub fn is_weak_type(&mut self, t: TypeId) -> bool {
        let _ = t;
        false
    }

    pub fn global_object_type(&mut self) -> TypeId {
        TypeId::NIL
    }

    pub fn has_excess_properties(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
    ) -> bool {
        let _ = (r, source, target, report_errors);
        self.stand_in("Relater.hasExcessProperties")
    }

    pub fn has_common_properties(&mut self, source: TypeId, target: TypeId, jsx: bool) -> bool {
        let _ = (source, target, jsx);
        self.stand_in("hasCommonProperties")
    }

    pub fn get_properties_of_type(&mut self, t: TypeId) -> List<'a, SymbolId> {
        let _ = t;
        self.stand_in("getPropertiesOfType")
    }

    pub fn type_has_call_or_construct_signatures(&mut self, t: TypeId) -> bool {
        let _ = t;
        self.stand_in("typeHasCallOrConstructSignatures")
    }

    pub fn get_signatures_of_type(&mut self, t: TypeId, kind: u8) -> List<'a, SignatureId> {
        let _ = (t, kind);
        self.stand_in("getSignaturesOfType")
    }

    pub fn get_return_type_of_signature(&mut self, s: SignatureId) -> TypeId {
        let _ = s;
        self.stand_in("getReturnTypeOfSignature")
    }

    pub fn union_or_intersection_related_to(
        &mut self,
        r: RelaterId,
        source: TypeId,
        target: TypeId,
        report_errors: bool,
        intersection_state: IntersectionState,
    ) -> Ternary {
        let _ = (r, source, target, report_errors, intersection_state);
        self.stand_in("Relater.unionOrIntersectionRelatedTo")
    }

    pub fn report_error_results(
        &mut self,
        r: RelaterId,
        original_source: TypeId,
        original_target: TypeId,
        source: TypeId,
        target: TypeId,
        head_message: MessageId,
    ) {
        let _ = (original_source, original_target);
        self.report_relation_error(r, head_message, source, target);
    }

    pub fn report_relation_error(
        &mut self,
        r: RelaterId,
        message: MessageId,
        source: TypeId,
        target: TypeId,
    ) {
        let message = if message.is_nil() {
            msg::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1
        } else {
            message
        };
        let args = [
            DiagArg::Text(self.type_to_string(source)),
            DiagArg::Text(self.type_to_string(target)),
        ];
        self.report_error(r, message, &args);
    }

    pub fn type_to_string(&mut self, t: TypeId) -> Text<'a> {
        let _ = t;
        b"T"
    }

    pub fn is_type_reference_with_generic_arguments(&mut self, t: TypeId) -> bool {
        let _ = t;
        false
    }

    pub fn write_generic_type_references(
        &mut self,
        b: &mut KeyBuilder,
        source: TypeId,
        target: TypeId,
        ignore_constraints: bool,
    ) -> bool {
        let _ = (b, source, target, ignore_constraints);
        self.stand_in("keyBuilder.writeGenericTypeReferences")
    }

    pub fn new_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[DiagArg<'a>],
    ) -> DiagnosticId {
        let _ = (node, message, args);
        self.stand_in("NewDiagnosticForNode")
    }

    pub fn new_diagnostic_chain(
        &mut self,
        chain: DiagnosticId,
        message: MessageId,
        args: &[DiagArg<'a>],
    ) -> DiagnosticId {
        let _ = (chain, message, args);
        self.stand_in("ast.NewDiagnosticChain")
    }

    pub fn set_related_info(
        &mut self,
        diagnostic: DiagnosticId,
        related_info: Vec<DiagnosticId>,
    ) -> DiagnosticId {
        drop(related_info);
        diagnostic
    }

    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) {
        let _ = diagnostic;
        self.stand_in("addDiagnostic")
    }
}

pub fn add_to_dotted_name(head: &[u8], tail: &[u8]) -> Vec<u8> {
    let mut head = head.to_vec();
    if head.starts_with(b"new ") {
        head = [b"(", head.as_slice(), b")"].concat();
    }
    let mut pos = 0;
    loop {
        let rest = tail.get(pos..).unwrap_or(&[]);
        if rest.starts_with(b"(") {
            pos += 1;
        } else if rest.starts_with(b"new ") {
            pos += 4;
        } else {
            break;
        }
    }
    let prefix = tail.get(..pos).unwrap_or(&[]);
    let suffix = tail.get(pos..).unwrap_or(&[]);
    if suffix.starts_with(b"[") {
        return [prefix, head.as_slice(), suffix].concat();
    }
    [prefix, head.as_slice(), b".", suffix].concat()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checker::Program;
    use crate::shims::Bump;
    use crate::types::TypeData;

    fn chain_text(c: &Checker<'_>, r: RelaterId) -> String {
        let mut parts = Vec::new();
        let mut e = c.rel.relaters[r].error_chain;
        while !e.is_nil() {
            let node = c.rel.relaters[r].error_chains[e];
            let args: Vec<String> = node
                .args
                .iter()
                .map(|a| match a {
                    DiagArg::Text(s) => String::from_utf8_lossy(s).into_owned(),
                    DiagArg::Int(i) => i.to_string(),
                    DiagArg::Nil => String::new(),
                })
                .collect();
            parts.push(format!("TS{}[{}]", node.message.0, args.join("|")));
            e = node.next;
        }
        parts.join(" <- ")
    }

    fn text<'a>(s: &'a str) -> DiagArg<'a> {
        DiagArg::Text(s.as_bytes())
    }

    // The call sequences and the chains are the ones that typescript-go prints for probe/chain.ts.
    #[test]
    fn report_error_reduces_the_chain_as_upstream() {
        let arena = Bump;
        let (nodes, symbols) = crate::tests::program();
        let program = Program {
            nodes: &nodes,
            symbols: &symbols,
            next_symbol_id: 1,
        };
        let mut c = crate::tests::checker(&arena, &program);
        let r = c.get_relater();
        c.report_error(r, MessageId(2322), &[text("string"), text("number")]);
        c.report_error(r, MessageId(2326), &[text("c")]);
        c.report_error(
            r,
            MessageId(2322),
            &[text("{ c: string; }"), text("{ c: number; }")],
        );
        c.report_error(r, MessageId(2326), &[text("b")]);
        assert_eq!(chain_text(&c, r), "TS2200[b.c] <- TS2322[string|number]");
        c.report_error(r, MessageId(2322), &[text("B1"), text("B2")]);
        c.report_error(r, MessageId(2326), &[text("a")]);
        assert_eq!(chain_text(&c, r), "TS2200[a.b.c] <- TS2322[string|number]");
        assert_eq!(c.chain_depth(r, c.rel.relaters[r].error_chain), 2);
        c.put_relater(r);

        let r = c.get_relater();
        c.report_error(r, MessageId(2322), &[text("string"), text("number")]);
        c.report_error(r, MessageId(2326), &[text("\"x-y\"")]);
        c.report_error(r, MessageId(2322), &[text("O1"), text("O2")]);
        c.report_error(r, MessageId(2204), &[text("O1"), text("O2")]);
        c.report_error(r, MessageId(2322), &[text("F1"), text("F2")]);
        c.report_error(r, MessageId(2326), &[text("m")]);
        assert_eq!(
            chain_text(&c, r),
            "TS2201[m()[\"x-y\"]] <- TS2322[string|number]"
        );
        c.put_relater(r);

        let r = c.get_relater();
        c.report_error(r, MessageId(2322), &[text("string"), text("number")]);
        c.report_error(r, MessageId(2326), &[text("z")]);
        c.report_error(r, MessageId(2322), &[text("O1"), text("O2")]);
        c.report_error(r, MessageId(2203), &[text("O1"), text("O2")]);
        c.report_error(r, MessageId(2322), &[text("F1"), text("F2")]);
        c.report_error(r, MessageId(2326), &[text("k")]);
        assert_eq!(
            chain_text(&c, r),
            "TS2201[(new k(...)).z] <- TS2322[string|number]"
        );
        assert!(c.chain_args_match(r, &[DiagArg::Nil]));
        assert!(!c.chain_args_match(r, &[text("other")]));
        c.put_relater(r);
        assert_eq!(c.internal.count(), 0);
    }

    // The keys and the results are the SET lines that typescript-go prints for probe/rel2.ts.
    #[test]
    fn recursive_type_related_to_fills_the_cache_as_upstream() {
        let arena = Bump;
        let (nodes, symbols) = crate::tests::program();
        let program = Program {
            nodes: &nodes,
            symbols: &symbols,
            next_symbol_id: 1,
        };
        let mut c = crate::tests::checker(&arena, &program);
        let mut types = Vec::new();
        for _ in 0..87 {
            types.push(c.new_type(TypeFlags::OBJECT, ObjectFlags::NONE, TypeData::Nil));
        }
        let (source, target) = (types[85], types[86]);
        assert_eq!(
            (c.types[source].id, c.types[target].id),
            (TypeId(86), TypeId(87))
        );
        let key = CacheHashKey::of(&[0x73, 0x56, 0, 0, 0, 0x57, 0, 0, 0, 0, 0, 0, 0]);

        c.rel.scripted_structured_results.push(Ternary::FALSE);
        assert!(!c.check_type_related_to_ex(
            source,
            target,
            RelationKind::Assignable,
            NodeId::NIL,
            MessageId::NIL,
            None
        ));
        assert_eq!(
            c.relation_get(RelationKind::Assignable, key),
            RelationComparisonResult::FAILED
        );
        assert_eq!(c.relation_size(RelationKind::Assignable), 1);
        // A cached failure answers without a new comparison when no error is wanted.
        assert!(!c.check_type_related_to_ex(
            source,
            target,
            RelationKind::Assignable,
            NodeId::NIL,
            MessageId::NIL,
            None
        ));
        assert!(c.stand_ins.is_empty());

        // Maybe at depth zero is recorded as a success, Unknown is not recorded.
        c.rel.scripted_structured_results.push(Ternary::MAYBE);
        assert!(c.check_type_related_to_ex(
            source,
            target,
            RelationKind::Subtype,
            NodeId::NIL,
            MessageId::NIL,
            None
        ));
        assert_eq!(
            c.relation_get(RelationKind::Subtype, key),
            RelationComparisonResult::SUCCEEDED
        );
        c.rel.scripted_structured_results.push(Ternary::UNKNOWN);
        assert!(c.check_type_related_to_ex(
            source,
            target,
            RelationKind::Comparable,
            NodeId::NIL,
            MessageId::NIL,
            None
        ));
        assert_eq!(c.relation_size(RelationKind::Comparable), 0);

        // The pool hands the same relater out again, and a comparer that outlives its comparison names that slot.
        let r1 = c.get_relater();
        let r2 = c.get_relater();
        c.put_relater(r2);
        c.put_relater(r1);
        assert_eq!(c.get_relater(), r1);
        assert_eq!(c.get_relater(), r2);
        let stale = TypeComparer::Relater {
            r: r2,
            intersection_state: IntersectionState::NONE,
        };
        c.put_relater(r2);
        assert_eq!(
            c.call_type_comparer(stale, source, target, false),
            Ternary::FALSE
        );
        assert_eq!(c.internal.count(), 1);
        assert!(!c.rel.relaters[r2].overflow);
        assert_eq!(Ternary::TRUE & Ternary::MAYBE, Ternary::MAYBE);
        assert_eq!(Ternary::MAYBE & Ternary::UNKNOWN, Ternary::UNKNOWN);
        assert!(InferencePriority::CIRCULARITY < InferencePriority::NONE);
    }

    #[test]
    fn inference_lists_are_shared_by_handle() {
        let arena = Bump;
        let (nodes, symbols) = crate::tests::program();
        let program = Program {
            nodes: &nodes,
            symbols: &symbols,
            next_symbol_id: 1,
        };
        let mut c = crate::tests::checker(&arena, &program);
        let tp = c.new_type(TypeFlags::TYPE_PARAMETER, ObjectFlags::NONE, TypeData::Nil);
        let mut buf = SliceBuf::make(0, 1);
        buf.push(tp);
        let type_parameters = c.list(&buf);
        let n = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            TypeComparer::Nil,
        );
        assert_eq!(
            c.rel.inference_contexts[n].compare_types,
            TypeComparer::Assignable
        );
        let list = c.rel.inference_contexts[n].inferences;
        let state = InferenceState {
            inferences: list,
            ..Default::default()
        };
        let old = c.get_inference_info_for_type(&state, tp);
        let fresh = c.new_inference_info(tp);
        c.rel.inference_infos[fresh].candidates.push(tp);
        let other = c.rel.inference_lists.alloc(vec![fresh]);
        c.merge_inferences(list, other);
        assert_eq!(c.get_inference_info_for_type(&state, tp), fresh);
        assert!(!c.has_inference_candidates(old));
        let copy = c.clone_inference_info(fresh);
        c.rel.inference_infos[copy].inferred_type = tp;
        c.clear_cached_inferences(other);
        assert_eq!(c.rel.inference_infos[copy].inferred_type, tp);
        let mut st = InferenceState {
            inferences: list,
            inference_priority: InferencePriority::MAX_VALUE,
            ..Default::default()
        };
        c.invoke_once(&mut st, tp, tp, |c, n, s, t| {
            c.infer_with_priority(n, s, t, InferencePriority::RETURN_TYPE)
        });
        c.invoke_once(&mut st, tp, tp, |c, n, s, t| {
            c.infer_from_contravariant_types(n, s, t)
        });
        assert_eq!(
            st.visited.get(&(c.types[tp].id, c.types[tp].id)),
            InferencePriority::MAX_VALUE
        );
        let sig = c.signatures.alloc(Default::default());
        let mut st2 = InferenceState::default();
        c.infer_from_signature(&mut st2, sig, sig);
        let r = c.get_relater();
        c.rel.relaters[r].relation = RelationKind::Assignable;
        assert_eq!(c.reduced_target_of(r, tp, tp), tp);
        assert_eq!(
            c.signature_related_to(r, sig, sig, true, IntersectionState::NONE),
            Ternary::TRUE
        );
    }
}
