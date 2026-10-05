//! Narrowing: the type of a variable or a property at a location, derived from the tests and
//! assignments on the control flow paths that reach it.

use super::decl::Predicate;
use super::errors::Container;
use super::expr::TargetKind;
use super::related::Place;
use super::shape::UntypedProperty;
use super::*;
use crate::bind::{
    Decl, Flow, FlowId, FlowTarget, FnOwner, MemberOwner, Parent, PatParent, SymbolId, UNREACHABLE,
};
use smallvec::{SmallVec, smallvec};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Root {
    Symbol(SymbolId),
    /// A name that is not declared in the file.
    Global(Atom),
    This,
    Super,
    /// `import.meta`
    ImportMeta,
    /// `new.target`
    NewTarget,
    /// The value a pattern destructures. No expression refers to it. Tests of the variables the
    /// pattern binds narrow it.
    Pattern(PatId),
    /// The argument list of a function whose contextual signature has a single rest parameter that
    /// is a union of tuples. Tests of its parameters narrow it.
    Params(FnId),
}

/// `x`, `this`, `x.a.b`: something whose type can be narrowed.
#[derive(Clone, Debug)]
pub(super) struct Reference {
    file: FileId,
    root: Root,
    path: SmallVec<[Atom; 4]>,
    /// Its expression, if it has one. Two references at different positions are the same reference.
    at: ExprId,
    /// `getFlowReferenceKey` has a key for it. It has none for what starts at `super`, `import.meta` or `new.target`, or goes
    /// through a comma or a `satisfies`.
    has_key: bool,
}

impl PartialEq for Reference {
    fn eq(&self, other: &Self) -> bool {
        self.file == other.file && self.root == other.root && self.path == other.path
    }
}

impl Eq for Reference {}

/// Memo tables of flow analysis that are not keyed by a node alone. They belong to the checker, so
/// they are dropped at the end of the task. Those keyed by a node are fields of `Program`. They are
/// stored with `rewrite`: tsgo assigns the link when the computation ends, overwriting what a
/// nested computation for the same node has assigned.
#[derive(Default)]
pub(super) struct FlowMemo {
    /// See `index_narrowing_subjects`: the file it is for; indexed by symbol, the first flow node
    /// with a test, a `switch` or an assignment that concerns it (empty: the file has no such
    /// filter); one bit per symbol, for call statements that have not all been found idle; those
    /// calls, by symbol.
    narrowing_index_file: Option<FileId>,
    first_narrowing_node: Vec<u32>,
    in_call_statements: Vec<u64>,
    call_statements_by_symbol: Vec<(SymbolId, FlowId)>,
    /// Indexed by flow node: an upper bound on the node numbers reachable through its antecedents.
    /// (Only the back edge of a loop leads to a higher one.)
    max_antecedent: Vec<u32>,
    /// Indexed by symbol: the flow node at which its declaration initializes it.
    declaration_node: Vec<u32>,
    /// The functions whose `type_predicates_from_body` is being computed: `sig.resolvedTypePredicate = c.noTypePredicate`.
    type_predicates_in_progress: SmallVec<[(FileId, FnId); 2]>,
    /// `flowNodePostSuper`
    flow_node_post_super: FxHashMap<(FileId, FlowId), bool>,
    /// The `Flow::Call` nodes of the file `idle_calls_of` for whose calls `effects_signatures` has
    /// `None`: one bit per flow node.
    idle_calls: Vec<u64>,
    idle_calls_of: Option<FileId>,
    /// The subjects of each test of the file `tests_of`, indexed by the flow node of the test.
    tests: Vec<About>,
    tests_of: Option<FileId>,
    /// The same for the tests of other files.
    other_tests: FxHashMap<(FileId, FlowId), About>,
    /// `getAssignmentReducedType`, keyed by declared and assigned type.
    assignment_reduced_types: FxHashMap<(TypeId, TypeId), TypeId>,
    /// `getNarrowedType`, keyed by type, candidate, `assumeTrue` and `checkDerived`.
    narrowed_types: FxHashMap<(TypeId, TypeId, bool, bool), TypeId>,
    /// `narrowTypeByEquality`, keyed by the type, the unmodified type of the other operand, whether
    /// the operator is `==`, and whether the operands are equal.
    equal_types: FxHashMap<(TypeId, TypeId, bool, bool), TypeId>,
    /// `type_of_discriminant`, keyed by the type, the name, `?.` and `!`.
    discriminant_types: FxHashMap<(TypeId, Atom, bool, bool), Option<(TypeId, bool)>>,
    /// `members_with_discriminant`, keyed by the type, the name and the narrowed type of the
    /// property.
    discriminated_types: FxHashMap<(TypeId, Atom, TypeId), TypeId>,
    /// `flowLoopCache`, keyed by the loop label and `getFlowReferenceKey`: the declared and the
    /// initial type, then the reference.
    flow_loop_cache: FxHashMap<FlowLoopKey, SmallVec<[(Reference, TypeId); 1]>>,
}

/// `FlowLoopKey`, without the reference.
type FlowLoopKey = (FileId, FlowId, TypeId, TypeId);

impl FlowMemo {
    #[inline]
    fn is_idle_call(&self, file: FileId, flow: FlowId) -> bool {
        self.idle_calls_of == Some(file)
            && self.idle_calls[flow.idx() / 64] & 1 << (flow.idx() % 64) != 0
    }

    fn cached_flow_loop_type(&self, key: &FlowLoopKey, reference: &Reference) -> Option<TypeId> {
        let cached = self.flow_loop_cache.get(key)?;
        cached.iter().find(|c| c.0 == *reference).map(|c| c.1)
    }
}

/// `checkDerived` of `getNarrowedType`: the test is `instanceof` or `#x in`, which goes by the declared
/// `extends` relations. If not, it is a type guard, which goes by the subtype relations.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum CheckDerived {
    No,
    Yes,
}

/// Whether narrowing from outside a function is still valid inside it.
#[derive(Copy, Clone)]
enum Crossing {
    No,
    /// `flowContainer` is nil.
    Yes,
    /// `flowContainer` is this many functions out from that of the reference.
    Times(u32),
    /// A constant, read by the expression: up to `declarationContainer`. That is evaluated when a
    /// walk reaches the start of a function.
    UpToDeclaration(SymbolId, ExprId),
    /// The same, if the variable is no longer assigned after the expression is reached.
    PastLastAssignment(SymbolId, ExprId),
}

/// `FlowType`
#[derive(Copy, Clone)]
struct FlowType {
    ty: TypeId,
    /// It depends on the types collected so far by a loop whose analysis is in progress.
    incomplete: bool,
}

impl FlowType {
    /// `newFlowType`
    fn new(ty: TypeId, incomplete: bool) -> FlowType {
        FlowType {
            ty: if incomplete && ty.is_never() {
                TypeId::SILENT_NEVER
            } else {
                ty
            },
            incomplete,
        }
    }
}

/// The flow types computed at labels.
#[derive(Default)]
struct Labels {
    few: SmallVec<[(FlowId, FlowType); 8]>,
    /// Overflow entries, added once `few` was full.
    many: FxHashMap<FlowId, FlowType>,
}

impl Labels {
    fn get(&self, label: FlowId) -> Option<FlowType> {
        match self.few.iter().find(|known| known.0 == label) {
            Some(known) => Some(known.1),
            None if self.many.is_empty() => None,
            None => self.many.get(&label).copied(),
        }
    }

    fn insert(&mut self, label: FlowId, ty: FlowType) {
        if let Some(known) = self.few.iter_mut().find(|known| known.0 == label) {
            known.1 = ty;
        } else if self.few.len() < self.few.inline_size() {
            self.few.push((label, ty));
        } else {
            self.many.insert(label, ty);
        }
    }
}

/// How far the initial type of a walk has been determined.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Start {
    /// From `Walk::initial`.
    Known,
    /// `Walk::initial` if `assumes_initialized`, which has not been evaluated yet, and `declared |
    /// undefined` otherwise.
    Unsettled,
    /// `declared | undefined`, which differs from `declared` and has not been created yet.
    Unassigned,
}

struct Walk {
    reference: Reference,
    declared: TypeId,
    /// The type of the reference where the walk ends without reaching an assignment. See
    /// `initial_of`.
    initial: TypeId,
    start: Start,
    crossing: Crossing,
    /// How many starts of functions the path to the current flow node has crossed. Each
    /// antecedent of a label reaches the start of its function on a path of its own.
    crossed: u32,
    labels: Labels,
    /// The `finally` blocks being traversed backwards: the start of each, and the label whose
    /// antecedents are used instead.
    reduced: Vec<(FlowId, FlowId)>,
    /// For each loop in progress: the flow types computed at labels during this iteration.
    round_labels: Vec<Labels>,
    steps: u32,
    /// The number of nested `getTypeAtFlowNode` invocations that would be in progress.
    depth: u32,
    /// The depth reached `MAX_FLOW_DEPTH` (`flowAnalysisDisabled`): the result is errorType.
    too_deep: bool,
}

const MAX_STEPS: u32 = 2_000_000;

/// A key for a name or for `this`, not necessarily unique. 0 for any other root of a reference.
fn root_key(root: Root) -> u32 {
    match root {
        Root::Symbol(symbol) => symbol.0 << 2 | 1,
        Root::Global(name) => name.0 << 2 | 2,
        Root::This => 3,
        Root::Super | Root::ImportMeta | Root::NewTarget | Root::Pattern(_) | Root::Params(_) => 0,
    }
}

/// The references a test can narrow.
#[derive(Copy, Clone, Default)]
struct About {
    /// 0: the test has not been analyzed.
    state: u32,
    /// The expressions `narrow` compares a reference with: the `root_key` of the root of each, and
    /// the number of its first property plus one, `ALONE` if it has no property, 0 if that is
    /// unknown or irrelevant.
    chains: [(u32, u32); 3],
}

/// The sink to which `note_test` and `note_chain` report the subjects of a test.
trait NarrowingSubjects {
    fn add(&mut self, root: u32, first: u32);
    /// No further subjects need to be reported.
    fn is_full(&self) -> bool {
        false
    }
    /// A key whose name can only be resolved by a query. `true`: bail out.
    fn bails_on_computed_key(&mut self) -> bool {
        false
    }
}

impl NarrowingSubjects for About {
    fn add(&mut self, root: u32, first: u32) {
        About::add(self, root, first);
    }

    fn is_full(&self) -> bool {
        self.state & About::ANYTHING != 0
    }

    fn bails_on_computed_key(&mut self) -> bool {
        self.state |= About::ANYTHING;
        true
    }
}

/// Indexed by symbol: the first flow node that concerns a reference rooted at it, whatever its
/// path. Second field: the current node.
struct FirstNarrowingNodes<'a>(&'a mut [u32], u32);

impl NarrowingSubjects for FirstNarrowingNodes<'_> {
    fn add(&mut self, root: u32, _: u32) {
        if root & 3 == 1 {
            let first = &mut self.0[(root >> 2) as usize];
            *first = (*first).min(self.1);
        }
    }
}

/// The symbols a call statement references, each once: indexed by symbol, the last call that
/// referenced it; the current call; the list.
struct CallStatementSubjects<'a>(&'a mut [u32], u32, &'a mut Vec<(SymbolId, FlowId)>);

impl NarrowingSubjects for CallStatementSubjects<'_> {
    fn add(&mut self, root: u32, _: u32) {
        if root & 3 == 1 && self.0[(root >> 2) as usize] != self.1 {
            self.0[(root >> 2) as usize] = self.1;
            self.2.push((SymbolId(root >> 2), FlowId(self.1)));
        }
    }
}

impl About {
    const ALONE: u32 = u32::MAX;
    const KNOWN: u32 = 1;
    /// There are more subjects than `chains` can hold, or a key whose name can only be resolved by
    /// a query.
    const ANYTHING: u32 = 2;

    fn add(&mut self, root: u32, first: u32) {
        for chain in &mut self.chains {
            if chain.0 == 0 {
                *chain = (root, first);
                return;
            }
            if chain.0 == root && (chain.1 == first || chain.1 == 0) {
                return;
            }
        }
        self.state |= About::ANYTHING;
    }

    /// Whether one of `chains` can be `reference`, have it as a prefix, or be the object of its
    /// last property.
    fn concerns(&self, reference: &Reference) -> bool {
        let root = root_key(reference.root);
        if root == 0 || self.state & About::ANYTHING != 0 {
            return true;
        }
        let Some(first) = reference.path.first() else {
            return self.chains.iter().any(|chain| chain.0 == root);
        };
        let first = first.0.wrapping_add(1);
        self.chains
            .iter()
            .any(|chain| chain.0 == root && (chain.1 == 0 || chain.1 == first))
    }
}

/// `getTypeAtFlowNode`: the invocation that finds this many in progress bails out.
pub(super) const MAX_FLOW_DEPTH: u32 = 2000;

/// What `checkNonNullTypeWithReporter` reports.
#[derive(Copy, Clone)]
pub(super) enum NonNullError {
    /// 18046, 2571
    IsUnknown,
    /// `TypeFactsIsUndefined`, `TypeFactsIsNull`
    IsPossibly { undefined: bool, null: bool },
}

/// `TypeFacts`: the tests that are true for some value of a type.
mod facts {
    pub(super) const TYPEOF_EQ_STRING: u32 = 1 << 0;
    pub(super) const TYPEOF_EQ_NUMBER: u32 = 1 << 1;
    pub(super) const TYPEOF_EQ_BIGINT: u32 = 1 << 2;
    pub(super) const TYPEOF_EQ_BOOLEAN: u32 = 1 << 3;
    pub(super) const TYPEOF_EQ_SYMBOL: u32 = 1 << 4;
    pub(super) const TYPEOF_EQ_OBJECT: u32 = 1 << 5;
    pub(super) const TYPEOF_EQ_FUNCTION: u32 = 1 << 6;
    pub(super) const TYPEOF_EQ_HOST_OBJECT: u32 = 1 << 7;
    pub(super) const TYPEOF_NE_STRING: u32 = 1 << 8;
    pub(super) const TYPEOF_NE_NUMBER: u32 = 1 << 9;
    pub(super) const TYPEOF_NE_BIGINT: u32 = 1 << 10;
    pub(super) const TYPEOF_NE_BOOLEAN: u32 = 1 << 11;
    pub(super) const TYPEOF_NE_SYMBOL: u32 = 1 << 12;
    pub(super) const TYPEOF_NE_OBJECT: u32 = 1 << 13;
    pub(super) const TYPEOF_NE_FUNCTION: u32 = 1 << 14;
    pub(super) const TYPEOF_NE_HOST_OBJECT: u32 = 1 << 15;
    pub(super) const EQ_UNDEFINED: u32 = 1 << 16;
    pub(super) const EQ_NULL: u32 = 1 << 17;
    pub(super) const EQ_UNDEFINED_OR_NULL: u32 = 1 << 18;
    pub(super) const NE_UNDEFINED: u32 = 1 << 19;
    pub(super) const NE_NULL: u32 = 1 << 20;
    pub(super) const NE_UNDEFINED_OR_NULL: u32 = 1 << 21;
    pub(super) const TRUTHY: u32 = 1 << 22;
    pub(super) const FALSY: u32 = 1 << 23;
    pub(super) const IS_UNDEFINED: u32 = 1 << 24;
    pub(super) const IS_NULL: u32 = 1 << 25;
    pub(super) const ALL: u32 = (1 << 27) - 1;

    /// All eight of `TYPEOF_NE_*`.
    const TYPEOF_NE: u32 = 0xff << 8;
    const THERE: u32 = NE_UNDEFINED | NE_NULL | NE_UNDEFINED_OR_NULL;
    /// The additional facts of every type except `undefined`, `null` and `void` without
    /// strictNullChecks: `StringFacts` is `StringStrictFacts` and this.
    pub(super) const LOOSE: u32 = EQ_UNDEFINED | EQ_NULL | EQ_UNDEFINED_OR_NULL | FALSY;
    /// `BaseStringStrictFacts` and similar. For symbols, objects and functions: `SymbolStrictFacts`
    /// and similar, without `Truthy`.
    pub(super) const OF_STRING: u32 = TYPEOF_EQ_STRING | TYPEOF_NE & !TYPEOF_NE_STRING | THERE;
    pub(super) const OF_NUMBER: u32 = TYPEOF_EQ_NUMBER | TYPEOF_NE & !TYPEOF_NE_NUMBER | THERE;
    pub(super) const OF_BIGINT: u32 = TYPEOF_EQ_BIGINT | TYPEOF_NE & !TYPEOF_NE_BIGINT | THERE;
    pub(super) const OF_BOOLEAN: u32 = TYPEOF_EQ_BOOLEAN | TYPEOF_NE & !TYPEOF_NE_BOOLEAN | THERE;
    pub(super) const OF_SYMBOL: u32 = TYPEOF_EQ_SYMBOL | TYPEOF_NE & !TYPEOF_NE_SYMBOL | THERE;
    pub(super) const OF_OBJECT: u32 = TYPEOF_EQ_OBJECT
        | TYPEOF_EQ_HOST_OBJECT
        | TYPEOF_NE & !(TYPEOF_NE_OBJECT | TYPEOF_NE_HOST_OBJECT)
        | THERE;
    pub(super) const OF_FUNCTION: u32 = TYPEOF_EQ_FUNCTION
        | TYPEOF_EQ_HOST_OBJECT
        | TYPEOF_NE & !(TYPEOF_NE_FUNCTION | TYPEOF_NE_HOST_OBJECT)
        | THERE;
    /// `VoidFacts`, `UndefinedFacts`, `NullFacts`
    pub(super) const OF_VOID: u32 =
        TYPEOF_NE | EQ_UNDEFINED | EQ_UNDEFINED_OR_NULL | NE_NULL | FALSY;
    pub(super) const OF_UNDEFINED: u32 = OF_VOID | IS_UNDEFINED;
    pub(super) const OF_NULL: u32 = TYPEOF_EQ_OBJECT
        | TYPEOF_NE & !TYPEOF_NE_OBJECT
        | EQ_NULL
        | EQ_UNDEFINED_OR_NULL
        | NE_UNDEFINED
        | FALSY
        | IS_NULL;
    /// `UnknownFacts`, which is `EmptyObjectFacts` too
    pub(super) const OF_UNKNOWN: u32 = ALL & !(IS_UNDEFINED | IS_NULL);
    pub(super) const OF_EMPTY_OBJECT_STRICT: u32 =
        OF_UNKNOWN & !(EQ_UNDEFINED | EQ_NULL | EQ_UNDEFINED_OR_NULL);
    /// `AllTypeofNE`
    pub(super) const ALL_TYPEOF_NE: u32 = TYPEOF_NE & !TYPEOF_NE_HOST_OBJECT | NE_UNDEFINED;
    /// `OrFactsMask`: the facts an intersection has if any of its members has them. It has the
    /// other facts only if all members have them.
    pub(super) const OR_MASK: u32 = TYPEOF_EQ_FUNCTION | TYPEOF_NE_OBJECT;
}

/// `typeofNEFacts`
fn typeof_ne_facts(name: Atom) -> u32 {
    match name {
        known::string => facts::TYPEOF_NE_STRING,
        known::number => facts::TYPEOF_NE_NUMBER,
        known::bigint => facts::TYPEOF_NE_BIGINT,
        known::boolean => facts::TYPEOF_NE_BOOLEAN,
        known::symbol => facts::TYPEOF_NE_SYMBOL,
        known::undefined => facts::NE_UNDEFINED,
        known::object => facts::TYPEOF_NE_OBJECT,
        known::function => facts::TYPEOF_NE_FUNCTION,
        _ => facts::TYPEOF_NE_HOST_OBJECT,
    }
}

/// `getNotEqualFactsFromTypeofSwitch`: the facts that are valid where none of the clauses outside
/// `from..to` was entered.
fn not_equal_facts_from_typeof_switch(witnesses: &[Atom], from: usize, to: usize) -> u32 {
    witnesses
        .iter()
        .enumerate()
        .filter(|&(i, name)| !(from..to).contains(&i) && name.is_some())
        .fold(0, |all, (_, &name)| all | typeof_ne_facts(name))
}

/// `getBranchLabelAntecedents`
fn branch_label_antecedents<'b>(
    bound: &'b Bound,
    flow: FlowId,
    reduced: &[(FlowId, FlowId)],
) -> &'b [FlowId] {
    let reduced = reduced.iter().rev().find(|r| r.0 == flow);
    match bound.flow[reduced.map_or(flow, |r| r.1).idx()] {
        Flow::Label { start, len } => bound.edges(start, len),
        _ => &[],
    }
}

impl Walk {
    fn new(
        reference: Reference,
        declared: TypeId,
        initial: TypeId,
        crosses_functions: bool,
    ) -> Walk {
        Walk {
            reference,
            declared,
            initial,
            start: Start::Known,
            crossing: if crosses_functions {
                Crossing::Yes
            } else {
                Crossing::No
            },
            crossed: 0,
            labels: Labels::default(),
            reduced: Vec::new(),
            round_labels: Vec::new(),
            steps: 0,
            depth: 0,
            too_deep: false,
        }
    }

    fn known_at(&self, label: FlowId) -> Option<FlowType> {
        if !self.reduced.is_empty() {
            return None;
        }
        self.shared_at(label)
    }

    fn remember(&mut self, label: FlowId, ty: FlowType) {
        if self.reduced.is_empty() {
            self.remember_shared(label, ty);
        }
    }

    /// `sharedFlows`: the type found at `flow`, whatever the labels were reduced to by then.
    fn shared_at(&self, flow: FlowId) -> Option<FlowType> {
        self.round_labels
            .iter()
            .rev()
            .find_map(|round| round.get(flow))
            .or_else(|| self.labels.get(flow))
    }

    fn remember_shared(&mut self, flow: FlowId, ty: FlowType) {
        self.round_labels
            .last_mut()
            .unwrap_or(&mut self.labels)
            .insert(flow, ty);
    }
}

/// `x.name`, where `x` is what is being narrowed.
#[derive(Copy, Clone)]
struct Access {
    name: Atom,
    /// `x?.name`
    optional: bool,
    /// `x!.name`
    non_null: bool,
}

impl<'p, 's> Checker<'p, 's> {
    /// The result of `work`, and the permission to store it in a memo table: it is finished, and computing it again would raise none of
    /// the flags that relations, unions and intersections raise for their callers.
    fn run_memoizable<T>(&mut self, work: impl FnOnce(&mut Self) -> T) -> (T, Option<Stored>) {
        let scope = self.begin_scope();
        let too_complex = std::mem::take(&mut self.relation_too_complex);
        let reliability = std::mem::take(&mut self.reliability);
        let result = work(self);
        let raises_no_flag = !self.relation_too_complex && self.reliability == 0;
        self.relation_too_complex |= too_complex;
        self.reliability |= reliability;
        let stored = self.end_scope_by_counters(scope).ok();
        (result, stored.filter(|_| raises_no_flag))
    }

    // ───────────────────────────── truthiness ─────────────────────────────

    /// The types `getDefinitelyFalsyPartOfType` returns unchanged, except `any` and `unknown`.
    /// `NaN` is not among them.
    fn is_definitely_falsy(&self, ty: TypeId) -> bool {
        match *self.data(ty) {
            // `void`, and `undefined` and `null` of any kind.
            _ if self.is_nullish(ty) => true,
            TypeData::BoolLit { value, .. } => !value,
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => value == known::empty,
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => f64::from_bits(bits) == 0.0,
            TypeData::BigIntLit { text, .. } => self
                .atoms()
                .bytes(text)
                .iter()
                .all(|&c| c == b'0' || c == b'n'),
            _ => false,
        }
    }

    /// `hasTypeFacts(ty, TypeFactsFalsy)`. `never` has no facts. Without strictNullChecks every
    /// other type has this fact.
    pub fn can_be_falsy(&mut self, ty: TypeId) -> bool {
        self.has_type_facts(ty, facts::FALSY)
    }

    /// `hasTypeFacts(ty, TypeFactsTruthy)`
    pub fn can_be_truthy(&mut self, ty: TypeId) -> bool {
        self.has_type_facts(ty, facts::TRUTHY)
    }

    /// `hasTypeFacts(ty, TypeFactsEQUndefinedOrNull)`
    pub fn can_be_nullish(&mut self, ty: TypeId) -> bool {
        self.has_type_facts(ty, facts::EQ_UNDEFINED_OR_NULL)
    }

    /// `hasTypeFacts(ty, TypeFactsIsUndefined)`
    pub(super) fn is_possibly_undefined(&mut self, ty: TypeId) -> bool {
        self.has_type_facts(ty, facts::IS_UNDEFINED)
    }

    /// `hasTypeFacts(ty, TypeFactsEQUndefined)`
    pub(super) fn can_equal_undefined(&mut self, ty: TypeId) -> bool {
        self.has_type_facts(ty, facts::EQ_UNDEFINED)
    }

    /// `getTypeWithFacts(ty, TypeFactsNEUndefined)`
    pub(super) fn type_with_ne_undefined(&mut self, ty: TypeId) -> TypeId {
        self.type_with_facts(ty, facts::NE_UNDEFINED)
    }

    /// `extractDefinitelyFalsyTypes`: the values of `ty` that are falsy. `""` for `string`, nothing for an object or a type parameter.
    pub fn definitely_falsy_part(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, m| match c.data(m) {
            TypeData::Intrinsic(Intrinsic::String) => c.string_literal(known::empty, false),
            TypeData::Intrinsic(Intrinsic::Number) => c.number_literal(0.0, false),
            TypeData::Intrinsic(Intrinsic::BigInt) => {
                let zero = c.atoms().intern(b"0");
                c.intern(TypeData::BigIntLit {
                    text: zero,
                    negative: false,
                    fresh: false,
                })
            }
            TypeData::Intrinsic(
                Intrinsic::Any
                | Intrinsic::Error
                | Intrinsic::Auto
                | Intrinsic::IntrinsicMarker
                | Intrinsic::NonInferrableAny
                | Intrinsic::Unknown
                | Intrinsic::Unresolved,
            )
            | TypeData::UnresolvedName { .. } => m,
            _ if c.is_definitely_falsy(m) => m,
            _ => TypeId::NEVER,
        })
    }

    /// `removeDefinitelyFalsyTypes`
    pub fn remove_definitely_falsy(&mut self, ty: TypeId) -> TypeId {
        self.type_with_facts(ty, facts::TRUTHY)
    }

    // ───────────────────────────── facts ─────────────────────────────

    /// `getTypeFacts`: those of `mask` that `ty` has.
    fn type_facts(&mut self, ty: TypeId, mask: u32) -> u32 {
        self.type_facts_worker(ty, mask) & mask
    }

    /// `hasTypeFacts`
    fn has_type_facts(&mut self, ty: TypeId, mask: u32) -> bool {
        self.type_facts(ty, mask) != 0
    }

    /// `getTypeFactsWorker`. Only the facts in `mask` have to be correct.
    fn type_facts_worker(&mut self, ty: TypeId, mask: u32) -> u32 {
        use facts::*;
        // Its constraint is circular.
        if self.is_stack_low() {
            return OF_UNKNOWN;
        }
        let strict = self.p.files.options.strict_null_checks;
        // A deferred type uses its constraint, and so does an intersection. A template literal type
        // that references no type parameter is its own constraint.
        let ty = if self.is_deferred(ty)
            || self.is_intersection(ty)
            || self.is_instantiable(ty) && self.has_type_variables(ty)
        {
            self.base_constraint_of(ty).unwrap_or(TypeId::UNKNOWN)
        } else {
            ty
        };
        let of = |base: u32, truthy: bool, falsy: bool| {
            let truthy = if truthy { TRUTHY } else { 0 };
            let falsy = if !strict {
                LOOSE
            } else if falsy {
                FALSY
            } else {
                0
            };
            base | truthy | falsy
        };
        match self.data(ty) {
            TypeData::Intrinsic(Intrinsic::String) | TypeData::StringMapping { .. } => {
                of(OF_STRING, true, true)
            }
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => {
                let is_empty = *value == known::empty;
                of(OF_STRING, !is_empty, is_empty)
            }
            TypeData::Template { .. } => of(OF_STRING, true, false),
            TypeData::Intrinsic(Intrinsic::Number) | TypeData::Enum { .. } => {
                of(OF_NUMBER, true, true)
            }
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => {
                let is_zero = f64::from_bits(*bits) == 0.0;
                of(OF_NUMBER, !is_zero, is_zero)
            }
            TypeData::Intrinsic(Intrinsic::BigInt) => of(OF_BIGINT, true, true),
            TypeData::BigIntLit { text, .. } => {
                let is_zero = self
                    .atoms()
                    .bytes(*text)
                    .iter()
                    .all(|&c| c == b'0' || c == b'n');
                of(OF_BIGINT, !is_zero, is_zero)
            }
            TypeData::BoolLit { value, .. } => of(OF_BOOLEAN, *value, !*value),
            TypeData::Intrinsic(Intrinsic::Void) => OF_VOID,
            TypeData::Intrinsic(
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening,
            ) => OF_UNDEFINED,
            TypeData::Intrinsic(Intrinsic::Null | Intrinsic::NullWidening) => OF_NULL,
            TypeData::Intrinsic(Intrinsic::Symbol) | TypeData::UniqueSymbol { .. } => {
                of(OF_SYMBOL, true, false)
            }
            TypeData::Intrinsic(Intrinsic::Object) | TypeData::EvolvingArray(_) => {
                of(OF_OBJECT, true, false)
            }
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever,
            ) => 0,
            TypeData::Union(parts) => parts
                .iter()
                .fold(0, |all, &p| all | self.type_facts_worker(p, mask)),
            // `getIntersectionTypeFacts`: next to a primitive, object types are tags.
            TypeData::Intersection(parts) => {
                let ignore_objects = self.maybe_type_of_kind(ty, Self::is_primitive);
                let (mut ored, mut anded) = (0, ALL);
                for &p in parts.iter() {
                    if !(ignore_objects && self.is_object_type(p)) {
                        let f = self.type_facts_worker(p, mask);
                        ored |= f;
                        anded &= f;
                    }
                }
                ored & OR_MASK | anded & !OR_MASK
            }
            _ if self.is_object_type(ty) => {
                let (function, object) = (of(OF_FUNCTION, true, false), of(OF_OBJECT, true, false));
                let empty = if strict {
                    OF_EMPTY_OBJECT_STRICT
                } else {
                    OF_UNKNOWN
                };
                // It is resolved only if the requested facts depend on its members.
                if mask & ((empty ^ object) | (function ^ object)) == 0 {
                    return object;
                }
                if self.is_empty_anonymous_object_type(ty) {
                    return empty;
                }
                if mask & (function ^ object) != 0 && self.is_function_object_type(ty) {
                    function
                } else {
                    object
                }
            }
            _ => OF_UNKNOWN,
        }
    }

    /// `isFunctionObjectType`
    fn is_function_object_type(&mut self, ty: TypeId) -> bool {
        let Some(members) = self.members(ty) else {
            return false;
        };
        if !(members.shape().call.is_empty() && members.shape().construct.is_empty()) {
            return true;
        }
        if members.resolved.prop(known::bind).is_none() {
            return false;
        }
        let function = self.global_ref(known::Function, &[]);
        self.is_subtype(ty, function)
    }

    /// `getTypeWithFacts`
    fn type_with_facts(&mut self, ty: TypeId, include: u32) -> TypeId {
        self.filter(ty, |c, m| c.has_type_facts(m, include))
    }

    /// `getAdjustedTypeWithFacts`
    fn adjusted_type_with_facts(&mut self, ty: TypeId, include: u32) -> TypeId {
        use facts::*;
        if self.is_any(ty) {
            // It has every fact. What is intersected with `{}` below is `errorType` if it is an error type, and `anyType` if it is
            // `autoType`.
            let is_intersected = self.p.files.options.strict_null_checks
                && matches!(
                    include,
                    NE_UNDEFINED | NE_NULL | NE_UNDEFINED_OR_NULL | TRUTHY
                );
            return if is_intersected && self.is_error_type(ty) {
                TypeId::ERROR
            } else if is_intersected && ty == TypeId::AUTO {
                TypeId::ANY
            } else {
                ty
            };
        }
        let strict = self.p.files.options.strict_null_checks;
        let reduced = if strict && ty == TypeId::UNKNOWN {
            // `unknownUnionType`: `unknown` is `{} | null | undefined`, and becomes `unknown` again
            // if none of them is removed.
            let everything = self.union(&[
                TypeId::UNKNOWN_EMPTY_OBJECT,
                TypeId::NULL,
                TypeId::UNDEFINED,
            ]);
            let rest = self.type_with_facts(everything, include);
            if rest == everything { ty } else { rest }
        } else {
            self.type_with_facts(ty, include)
        };
        if !strict {
            return reduced;
        }
        match include {
            NE_UNDEFINED => self.remove_nullable_by_intersection(
                reduced,
                EQ_UNDEFINED,
                EQ_NULL,
                IS_NULL,
                TypeId::NULL,
            ),
            NE_NULL => self.remove_nullable_by_intersection(
                reduced,
                EQ_NULL,
                EQ_UNDEFINED,
                IS_UNDEFINED,
                TypeId::UNDEFINED,
            ),
            NE_UNDEFINED_OR_NULL | TRUTHY => self.map_type(reduced, |c, m| {
                if c.has_type_facts(m, EQ_UNDEFINED_OR_NULL) {
                    c.global_non_nullable_type_instantiation(m)
                } else {
                    m
                }
            }),
            _ => reduced,
        }
    }

    /// `getGlobalNonNullableTypeInstantiation`
    fn global_non_nullable_type_instantiation(&mut self, ty: TypeId) -> TypeId {
        match self.global_type_symbol(known::NonNullable) {
            Some(alias) if self.files().flags(alias).contains(SymFlags::TYPE_ALIAS) => {
                self.type_reference(alias, &[ty])
            }
            _ => self.intersection(&[ty, TypeId::EMPTY_OBJECT]),
        }
    }

    /// `removeNullableByIntersection`: a member that may still be the excluded type (`target`) is
    /// intersected with `{}`, or with `{} | other_ty` if it may be the other nullable type and `ty`
    /// does not already include that type.
    fn remove_nullable_by_intersection(
        &mut self,
        ty: TypeId,
        target: u32,
        other: u32,
        other_includes: u32,
        other_ty: TypeId,
    ) -> TypeId {
        use facts::*;
        let whole = self.type_facts(ty, EQ_UNDEFINED | EQ_NULL | IS_UNDEFINED | IS_NULL);
        if whole & target == 0 {
            return ty;
        }
        let empty_and_other = self.union(&[TypeId::EMPTY_OBJECT, other_ty]);
        self.map_type(ty, |c, m| {
            if !c.has_type_facts(m, target) {
                m
            } else if whole & other_includes == 0 && c.has_type_facts(m, other) {
                c.intersection(&[m, empty_and_other])
            } else {
                c.intersection(&[m, TypeId::EMPTY_OBJECT])
            }
        })
    }

    /// `narrowTypeByTypeFacts`
    fn narrow_type_by_type_facts(&mut self, ty: TypeId, implied: TypeId, include: u32) -> TypeId {
        self.map_type(ty, |c, m| {
            if c.is_strict_subtype(m, implied) {
                if c.has_type_facts(m, include) {
                    m
                } else {
                    TypeId::NEVER
                }
            } else if c.is_subtype(implied, m) {
                implied
            } else if c.has_type_facts(m, include) {
                c.intersection(&[m, implied])
            } else {
                TypeId::NEVER
            }
        })
    }

    // ───────────────────────────── references ─────────────────────────────

    pub(super) fn reference_of(&mut self, file: FileId, e: ExprId) -> Option<Reference> {
        let hir = self.hir(file);
        let mut path: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut at = e;
        let mut has_key = true;
        let root = loop {
            match hir[at].kind {
                ExprKind::Ident(name) => {
                    let symbol = self.bound(file).expr_symbol[at.idx()];
                    break if symbol.is_none() {
                        Root::Global(name)
                    } else {
                        Root::Symbol(symbol)
                    };
                }
                ExprKind::This => break Root::This,
                ExprKind::Super => break Root::Super,
                ExprKind::ImportMeta => break Root::ImportMeta,
                ExprKind::NewTarget(_) => break Root::NewTarget,
                ExprKind::Dot { obj, name, .. } => {
                    path.push(name);
                    at = obj;
                }
                ExprKind::Index { obj, index, .. } => {
                    path.push(self.access_key(file, index)?);
                    at = obj;
                }
                ExprKind::NonNull(x) => at = x,
                // `isMatchingReference` looks through these when they occur in the narrowed
                // reference. `writeFlowCacheKey` handles neither.
                ExprKind::Satisfies { expr: x, .. }
                | ExprKind::Binary {
                    op: BinOp::Comma,
                    right: x,
                    ..
                } => {
                    has_key = false;
                    at = x;
                }
                _ => return None,
            }
        };
        path.reverse();
        let has_key = has_key && !matches!(root, Root::Super | Root::ImportMeta | Root::NewTarget);
        Some(Reference {
            file,
            root,
            path,
            at: e,
            has_key,
        })
    }

    /// `tryGetElementAccessExpressionName`: the property `a[index]` names, if the syntax determines
    /// it, or if a constant that represents a single name does. A parenthesized key yields nothing.
    pub(super) fn literal_key(&mut self, file: FileId, index: ExprId) -> Option<Atom> {
        let hir = self.hir(file);
        if is_parenthesized(hir, index) {
            return None;
        }
        match hir[index].kind {
            ExprKind::String(s) => Some(s),
            ExprKind::Number(n) => Some(self.number_name(hir.numbers[n as usize])),
            ExprKind::Ident(_) | ExprKind::Dot { .. } => {
                self.name_from_entity_name_expression(file, index)
            }
            _ => None,
        }
    }

    /// `tryGetNameFromEntityNameExpression`
    fn name_from_entity_name_expression(&mut self, file: FileId, node: ExprId) -> Option<Atom> {
        let sym = self.resolve_entity_name_expression(file, node, SymFlags::VALUE)?;
        let files = self.files();
        let flags = files.flags(sym);
        if !flags.intersects(SymFlags::CONST | SymFlags::ENUM_MEMBER) {
            return None;
        }
        // `ValueDeclaration`: a type of the same name may be declared first.
        let is_value = |d: &Decl| matches!(d, Decl::Var(_) | Decl::EnumMember(_));
        let (of, decl) = if flags.contains(SymFlags::MERGED) {
            files.decls_of(sym).into_iter().find(|(_, d)| is_value(d))?
        } else {
            (
                sym.file,
                *files.symbol(sym).decls.iter().find(|&d| is_value(d))?,
            )
        };
        match decl {
            Decl::EnumMember(m) => {
                let member = self.hir(of)[m];
                // Without an explicit initializer it yields its name, not its assigned number.
                if member.init.is_none() {
                    return Some(member.name);
                }
                let ty = self.type_of_expr(of, member.init);
                self.property_name_of_type(ty)
            }
            Decl::Var(pat) => {
                // Not a variable bound by a pattern.
                let PatParent::Var(d) = self.bound(of).pat_parent[pat.idx()] else {
                    return None;
                };
                let (annotation, init) = (self.hir(of)[d].ty, self.hir(of)[d].init);
                if annotation.is_some() {
                    let ty = self.type_of_pat(of, pat);
                    if let Some(name) = self.property_name_of_type(ty) {
                        return Some(name);
                    }
                }
                // A declaration in another file counts as declared.
                if init.is_none()
                    || of == file
                        && !self.is_block_scoped_name_declared_before_use(
                            file,
                            self.hir(file).node(d),
                            self.hir(file).node(node),
                        )
                {
                    return None;
                }
                // `getTypeOfExpression` of the initializer, even next to an annotation that does
                // not resolve. It pushes no resolution of the constant and is not widened. The
                // declaration creates the unique symbol type of `Symbol()`, from the syntax alone
                // (`getESSymbolLikeTypeForNode`).
                let ty = if annotation.is_none() && self.is_symbol_or_symbol_for_call(of, init) {
                    self.type_of_symbol(sym)
                } else {
                    self.get_type_of_expression(of, init)
                };
                self.property_name_of_type(ty)
            }
            _ => None,
        }
    }

    /// The key that distinguishes `a[index]` from `a[other]`: the name, or else the variable, if
    /// its value never changes.
    pub(super) fn access_key(&mut self, file: FileId, index: ExprId) -> Option<Atom> {
        if let Some(name) = self.literal_key(file, index) {
            return Some(name);
        }
        let hir = self.hir(file);
        let ExprKind::Ident(name) = hir[index].kind else {
            return None;
        };
        if is_parenthesized(hir, index) {
            return None;
        }
        // `isMatchingReference`: a constant, or a parameter, a `catch` binding or a local `let`
        // that is never assigned. The resulting key cannot collide with a property name.
        let symbol = self.bound(file).expr_symbol[index.idx()];
        if symbol.is_none() {
            // A constant of another script or of the library.
            let sym = self
                .files()
                .global(name, SymFlags::VALUE)
                .filter(|&sym| self.files().flags(sym).contains(SymFlags::CONST))?;
            let (file, id) = (sym.file.0.to_le_bytes(), sym.id.0.to_le_bytes());
            let key = [&[0][..], &file[..], &id[..]].concat();
            return Some(self.atoms().intern(&key));
        }
        if !matches!(
            self.bound(file).symbols[symbol.idx()].decls.first(),
            Some(Decl::Var(_) | Decl::Param(_))
        ) || !self.is_constant_name(file, symbol)
        {
            return None;
        }
        // A zero byte, and the number of the symbol.
        let [a, b, c, d] = symbol.0.to_le_bytes();
        Some(self.atoms().intern(&[0, a, b, c, d]))
    }

    /// Whether `e` is the first `len` steps of `reference`. `isMatchingReference`, with `e` as the
    /// target: `satisfies` is looked through in the reference only.
    fn matches_prefix(&mut self, reference: &Reference, len: usize, e: ExprId) -> bool {
        let hir = self.hir(reference.file);
        let mut at = e;
        let mut remaining = len;
        loop {
            match hir[at].kind {
                ExprKind::Ident(name) => {
                    let symbol = self.bound(reference.file).expr_symbol[at.idx()];
                    return remaining == 0
                        && reference.root
                            == if symbol.is_none() {
                                Root::Global(name)
                            } else {
                                Root::Symbol(symbol)
                            };
                }
                ExprKind::This => return remaining == 0 && reference.root == Root::This,
                ExprKind::Super => return remaining == 0 && reference.root == Root::Super,
                ExprKind::ImportMeta => {
                    return remaining == 0 && reference.root == Root::ImportMeta;
                }
                ExprKind::NewTarget(_) => {
                    return remaining == 0 && reference.root == Root::NewTarget;
                }
                ExprKind::Dot { obj, name, .. } => {
                    if remaining == 0 || reference.path[remaining - 1] != name {
                        return false;
                    }
                    remaining -= 1;
                    at = obj;
                }
                ExprKind::Index { obj, index, .. } => {
                    if remaining == 0
                        || self.access_key(reference.file, index)
                            != Some(reference.path[remaining - 1])
                    {
                        return false;
                    }
                    remaining -= 1;
                    at = obj;
                }
                ExprKind::NonNull(x) => at = x,
                ExprKind::Assign { target, .. } => at = target,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => at = right,
                _ => return false,
            }
        }
    }

    /// `isMatchingReference(reference, e)`
    pub(super) fn matches(&mut self, reference: &Reference, e: ExprId) -> bool {
        self.matches_prefix(reference, reference.path.len(), e)
    }

    /// Whether an entry of `flow_loops` pushed when `stack` had `depth` frames is on `flowLoopStack` now. `checkExpressionCached`
    /// empties `flowLoopStack`, and it computes what a resolution caches: a resolution entered since the push hides the entry.
    /// Not while `checkDeclarationInitializer` has the type from `getQuickTypeOfExpression`, which checks the callee uncached.
    pub(super) fn is_flow_loop_visible(&self, depth: usize) -> bool {
        let depth = depth.min(self.stack.len());
        !self.stack[depth..].iter().enumerate().any(|(i, &q)| {
            let is_quick = |&(from, to): &(usize, usize)| (from..to).contains(&(depth + i));
            self.is_resolution(q) && !self.quick_initializers.iter().any(is_quick)
        })
    }

    /// The depth of `stack` when the top of `flowLoopStack` was pushed, if that was after
    /// `stack[since]` was entered.
    pub(super) fn flow_loop_pushed_since(&self, since: usize) -> Option<usize> {
        let depth = self.flow_loops.last()?.5;
        (depth > since && self.is_flow_loop_visible(depth)).then_some(depth)
    }

    /// Whether `e` is a proper prefix of `reference`: `x` or `x.a` for `x.a.b`.
    fn is_proper_prefix(&mut self, reference: &Reference, e: ExprId) -> bool {
        (0..reference.path.len()).any(|len| self.matches_prefix(reference, len, e))
    }

    /// Whether `e` is `reference?.a.b`: if it has a value, so has the reference.
    fn optional_chain_contains(&mut self, reference: &Reference, e: ExprId) -> bool {
        self.optional_chain_contains_reference(reference, e, true)
    }

    /// `optionalChainContainsReference`. `names_keys`: whether `isMatchingReference` is called,
    /// which resolves the key names of the links.
    fn optional_chain_contains_reference(
        &mut self,
        reference: &Reference,
        e: ExprId,
        names_keys: bool,
    ) -> bool {
        let hir = self.hir(reference.file);
        // `matches` resolves the key names itself for a reference with a path. Nearly all callers
        // in flow.go test `strictNullChecks` first.
        let names_keys =
            names_keys && reference.path.is_empty() && self.p.files.options.strict_null_checks;
        let mut at = e;
        loop {
            let (obj, chain) = match hir[at].kind {
                ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                    (obj, chain)
                }
                ExprKind::Call(c) => (hir[c].callee, hir[c].chain),
                ExprKind::NonNull(x) => (x, Chain::Continue),
                _ => return false,
            };
            if chain == Chain::No {
                return false;
            }
            // `isMatchingReference` has the link as its source and the reference as its target
            // here: `getAccessedPropertyName` resolves the key name of an element access before the
            // target is inspected. `x!` is a link only inside a chain.
            if names_keys && !matches!(hir[at].kind, ExprKind::NonNull(_)) {
                let mut link = obj;
                while let ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } =
                    hir[link].kind
                {
                    link = x;
                }
                if let ExprKind::Index { index, .. } = hir[link].kind {
                    self.literal_key(reference.file, index);
                }
            }
            if self.matches(reference, obj) {
                return true;
            }
            at = obj;
        }
    }

    /// If `e` is `reference.name`, the name.
    /// `e` as an access to a discriminant property of the reference.
    fn discriminant_access(
        &mut self,
        reference: &Reference,
        e: ExprId,
        ty: TypeId,
    ) -> Option<Access> {
        if !matches!(
            self.hir(reference.file)[e].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        ) {
            return None;
        }
        let declared = self.walk_declared;
        let is_declared_union = self.is_union(declared);
        if !is_declared_union && !self.is_union(ty) {
            return None;
        }
        let access = self.candidate_discriminant_access(reference, e, ty)?;
        // Using the declared type keeps a property a discriminant after the members that made it
        // one have been narrowed away.
        let is_subset =
            is_declared_union && (ty == declared || self.is_type_subset_of_union(ty, declared));
        let of = if is_subset { declared } else { ty };
        self.is_discriminant_property(of, access.name)
            .then_some(access)
    }

    /// `isTypeSubsetOfUnion`, without its rule for an enum: whether each member of `source` is a
    /// member of the union `target`. It runs for every condition that every reference passes, so a
    /// search per member makes n tests of a union of n members cost n^4.
    fn is_type_subset_of_union(&self, source: TypeId, target: TypeId) -> bool {
        let (members, of) = (self.parts(source), self.parts(target));
        // Both are in the order of `compare_types`: one pass finds the members of a subset.
        let mut rest = of.iter();
        match members.iter().position(|m| !rest.any(|t| t == m)) {
            None => true,
            Some(unordered) => members[unordered..].iter().all(|m| of.contains(m)),
        }
    }

    /// `isDiscriminantProperty`
    pub(super) fn is_discriminant_property(&mut self, ty: TypeId, name: Atom) -> bool {
        let both = PropFlags::HAS_NON_UNIFORM_TYPE | PropFlags::HAS_LITERAL_TYPE;
        self.is_union(ty)
            && self.union_property(ty, name).is_some_and(|prop| {
                prop.flags.contains(both) && {
                    let ty = self.type_of_prop(prop, MapperId::IDENTITY);
                    !self.is_generic(ty)
                }
            })
    }

    /// `getCandidateDiscriminantPropertyAccess`: `x.kind`, `x["kind"]` or a name that aliases one.
    /// `x.kind!` is none of them.
    fn candidate_discriminant_access(
        &mut self,
        reference: &Reference,
        e: ExprId,
        ty: TypeId,
    ) -> Option<Access> {
        if self.is_any(ty) || ty == TypeId::UNKNOWN || self.is_primitive(ty) {
            return None;
        }
        let hir = self.hir(reference.file);
        if let ExprKind::Ident(_) = hir[e].kind {
            return self.discriminant_alias(reference, e, ty);
        }
        if matches!(reference.root, Root::Pattern(_) | Root::Params(_)) {
            return None;
        }
        let (obj, chain) = match hir[e].kind {
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => (obj, chain),
            _ => return None,
        };
        if !self.matches(reference, obj) {
            return None;
        }
        // `getDiscriminantPropertyAccess` calls `getAccessedPropertyName` only for a candidate:
        // resolving the name of a constant key resolves a type.
        let name = match hir[e].kind {
            ExprKind::Dot { name, .. } => name,
            ExprKind::Index { index, .. } => self.literal_key(reference.file, index)?,
            _ => return None,
        };
        Some(Access {
            name,
            optional: chain != Chain::No,
            non_null: matches!(hir[obj].kind, ExprKind::NonNull(_)),
        })
    }

    /// The variable `e` as an alias of a property of the reference: `const k = x.kind`, `const {
    /// kind: k } = x`, or a variable bound by the pattern, or a parameter of the function, that is
    /// the reference.
    fn discriminant_alias(
        &mut self,
        reference: &Reference,
        e: ExprId,
        ty: TypeId,
    ) -> Option<Access> {
        let file = reference.file;
        let hir = self.hir(file);
        let bound = self.bound(file);
        let symbol = bound.expr_symbol[e.idx()];
        if symbol.is_none() {
            return None;
        }
        let &[Decl::Var(pat) | Decl::Param(pat)] = &bound.symbols[symbol.idx()].decls[..] else {
            return None;
        };
        let plain = |name| {
            Some(Access {
                name,
                optional: false,
                non_null: false,
            })
        };
        let parent = bound.pat_parent[pat.idx()];
        if let Root::Pattern(target) = reference.root {
            return match parent {
                PatParent::Prop(of, prop)
                    if of == target && hir[prop].default.is_none() && !hir[prop].is_rest =>
                {
                    plain(self.member_name(file, hir[prop].key)?)
                }
                PatParent::Elem(of, elem)
                    if of == target && hir[elem].default.is_none() && !hir[elem].is_rest =>
                {
                    let PatKind::Array(elems) = hir[of].kind else {
                        return None;
                    };
                    plain(self.number_name((elem.0 - elems.start) as f64))
                }
                _ => None,
            };
        }
        if let Root::Params(func) = reference.root {
            return match parent {
                // `getAccessedPropertyName`: its index among the parameters, which include a `this`
                // parameter, although the tuples have no element for it.
                PatParent::Param(p)
                    if bound.param_fn[p.idx()] == func
                        && hir[p].default.is_none()
                        && !hir[p].flags.contains(Flags::REST) =>
                {
                    let place =
                        p.0 - hir[func].params.start + hir[func].this_ty(hir).is_some() as u32;
                    plain(self.number_name(place as f64))
                }
                _ => None,
            };
        }
        if !bound.symbols[symbol.idx()].flags.contains(SymFlags::CONST)
            || !self.is_constant_name(file, symbol)
        {
            return None;
        }
        match parent {
            PatParent::Var(d) if hir[d].ty.is_none() && hir[d].init.is_some() => {
                let init = hir[d].init;
                match hir[init].kind {
                    ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                        self.candidate_discriminant_access(reference, init, ty)
                    }
                    _ => None,
                }
            }
            // `const { kind: k } = x`, `const [k] = x`
            PatParent::Prop(of, _) | PatParent::Elem(of, _) => {
                let has_default = match parent {
                    PatParent::Prop(_, prop) => hir[prop].default.is_some(),
                    PatParent::Elem(_, elem) => hir[elem].default.is_some(),
                    _ => true,
                };
                let PatParent::Var(d) = bound.pat_parent[of.idx()] else {
                    return None;
                };
                let init = hir[d].init;
                if has_default
                    || hir[d].ty.is_some()
                    || init.is_none()
                    || !matches!(
                        hir[init].kind,
                        ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
                    )
                    || !self.matches(reference, init)
                {
                    return None;
                }
                // `getDestructuringPropertyName`
                match (parent, hir[of].kind) {
                    (PatParent::Prop(_, prop), _) => plain(self.member_name(file, hir[prop].key)?),
                    (PatParent::Elem(_, elem), PatKind::Array(elems)) => {
                        plain(self.number_name((elem.0 - elems.start) as f64))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn any_binding_assigned(&self, file: FileId, pat: PatId) -> bool {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(_) => {
                let symbol = self.bound(file).pat_symbol[pat.idx()];
                symbol.is_some()
                    && self.bound(file).symbols[symbol.idx()]
                        .flags
                        .contains(SymFlags::ASSIGNED)
            }
            PatKind::Object(props) => props
                .iter()
                .any(|p| self.any_binding_assigned(file, hir[p].value)),
            PatKind::Array(elems) => elems
                .iter()
                .any(|x| self.any_binding_assigned(file, hir[x].pat)),
        }
    }

    /// Whether the pattern that contains `pat` is never rebound: it belongs to a `const`, or to a
    /// parameter that is never assigned.
    fn is_constant_pattern(&self, file: FileId, pat: PatId) -> bool {
        let mut at = pat;
        loop {
            match self.bound(file).pat_parent[at.idx()] {
                PatParent::Prop(parent, _) | PatParent::Elem(parent, _) => at = parent,
                PatParent::Var(d) => {
                    return matches!(
                        self.hir(file)[d].kind,
                        VarKind::Const | VarKind::Using | VarKind::AwaitUsing
                    );
                }
                PatParent::Param(_) => return !self.any_binding_assigned(file, at),
                PatParent::None => return false,
            }
        }
    }

    /// `isConstantReference`: whether the value of the reference cannot have changed since a test
    /// of it was stored in a constant.
    fn is_constant_reference(&mut self, reference: &Reference) -> bool {
        let is_constant_root = match reference.root {
            Root::This => true,
            Root::Symbol(s) => self.is_constant_name(reference.file, s),
            // A constant of another script or of the library.
            Root::Global(name) => self
                .files()
                .global(name, SymFlags::VALUE)
                .is_some_and(|sym| self.files().flags(sym).contains(SymFlags::CONST)),
            Root::Pattern(p) => self.is_constant_pattern(reference.file, p),
            Root::Super | Root::ImportMeta | Root::NewTarget | Root::Params(_) => false,
        };
        if !is_constant_root {
            return false;
        }
        // `a.b.c`: neither the `b` of `a` nor the `c` of that can be assigned.
        if !reference.path.is_empty() {
            let file = reference.file;
            let hir = self.hir(file);
            if reference.at.is_none() {
                return false;
            }
            // Only this exact syntax: `a!.b`, `(a).b` and `(f(), a).b` are not recognized.
            let mut at = reference.at;
            for _ in &reference.path {
                let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[at].kind else {
                    return false;
                };
                if is_parenthesized(hir, obj) {
                    return false;
                }
                at = obj;
            }
            if !matches!(hir[at].kind, ExprKind::Ident(_) | ExprKind::This) {
                return false;
            }
            let mut at = reference.at;
            for &name in reference.path.iter().rev() {
                let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[at].kind else {
                    return false;
                };
                let object = self.type_of_expr(file, obj);
                let object = self.non_nullable(object);
                let object = self.apparent_type(object);
                if !self.is_readonly_property(object, name) {
                    return false;
                }
                at = obj;
            }
        }
        true
    }

    /// `GetRootDeclaration(symbol.ValueDeclaration)` for a variable or a parameter. `None` for
    /// anything else.
    fn root_declaration(&self, file: FileId, symbol: SymbolId) -> PatParent {
        let bound = self.bound(file);
        match bound.symbols[symbol.idx()].decls.first() {
            Some(&(Decl::Var(pat) | Decl::Param(pat))) => {
                super::errors_names_and_exports::root_declaration(bound, pat)
            }
            _ => PatParent::None,
        }
    }

    /// `isParameterOrMutableLocalVariable`
    fn is_parameter_or_mutable_local_variable(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match self.root_declaration(file, symbol) {
            PatParent::Param(_) => true,
            PatParent::Var(d) => {
                let stmt = bound.var_stmt[d.idx()];
                // `IsCatchClause(declaration.Parent)`, or else `isMutableLocalVariableDeclaration`
                stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Try { .. })
                    || hir[d].kind == VarKind::Let
                        && !hir[d].flags.contains(Flags::EXPORT)
                        && !(stmt.is_some()
                            && matches!(bound.stmt_parent[stmt.idx()], Parent::File)
                            && !self.files().modules[file.idx()].is_module())
            }
            _ => false,
        }
    }

    /// `isSymbolAssigned`: a name in `export { x }` counts as assigned.
    fn is_symbol_assigned(&self, file: FileId, symbol: SymbolId) -> bool {
        self.bound(file).symbols[symbol.idx()]
            .flags
            .contains(SymFlags::ASSIGNED)
            || !self.hir(file).exports.is_empty() && self.is_named_by_export_specifier(file, symbol)
    }

    /// `isConstantReference` of a name. A declaration with an `export` modifier is not constant:
    /// the name in the file resolves to the export symbol, which is not followed.
    pub(super) fn is_constant_name(&self, file: FileId, symbol: SymbolId) -> bool {
        let hir = self.hir(file);
        match self.root_declaration(file, symbol) {
            PatParent::Var(d) if hir[d].flags.contains(Flags::EXPORT) => false,
            _ if self.is_parameter_or_mutable_local_variable(file, symbol) => {
                !self.is_symbol_assigned(file, symbol)
            }
            // `isConstantVariable`
            PatParent::Var(d) => matches!(
                hir[d].kind,
                VarKind::Const | VarKind::Using | VarKind::AwaitUsing
            ),
            _ => matches!(
                self.bound(file).symbols[symbol.idx()].decls.first(),
                Some(&Decl::Fn(f)) if hir[f].kind == FnKind::Expr
            ),
        }
    }

    /// `isReadonlySymbol(getPropertyOfType(object, name))`
    fn is_readonly_property(&mut self, object: TypeId, name: Atom) -> bool {
        self.get_property_of_type(object, name)
            .is_some_and(|(prop, _)| self.is_readonly_symbol(prop))
    }

    /// `getNarrowedTypeOfSymbol`. The type of a variable bound by a pattern that destructures a
    /// union, at `e`: tests of the other variables of the pattern determine which member of the
    /// union was destructured.
    pub(super) fn narrow_binding(
        &mut self,
        file: FileId,
        e: ExprId,
        symbol: SymbolId,
        declared: TypeId,
    ) -> TypeId {
        let hir = self.hir(file);
        let bound = self.bound(file);
        let &[Decl::Var(pat) | Decl::Param(pat)] = &bound.symbols[symbol.idx()].decls[..] else {
            return declared;
        };
        let (parent, len) = match bound.pat_parent[pat.idx()] {
            PatParent::Param(p) => return self.narrow_dependent_parameter(file, e, p, declared),
            PatParent::Prop(parent, prop) if hir[prop].default.is_none() && !hir[prop].is_rest => {
                match hir[parent].kind {
                    PatKind::Object(props) => (parent, props.len()),
                    _ => return declared,
                }
            }
            PatParent::Elem(parent, elem) if hir[elem].default.is_none() && !hir[elem].is_rest => {
                match hir[parent].kind {
                    PatKind::Array(elems) => (parent, elems.len()),
                    _ => return declared,
                }
            }
            _ => return declared,
        };
        let flow = bound.expr_flow[e.idx()];
        if len < 2 || flow == UNREACHABLE || !self.is_constant_pattern(file, parent) {
            return declared;
        }
        // `NodeCheckFlagsInCheckIdentifier`
        if self.in_check_identifier.contains(&(file, parent)) {
            return declared;
        }
        self.in_check_identifier.push((file, parent));
        let ty = 'checked: {
            let parent_ty = self.type_of_pat(file, parent);
            let parent_ty = self.map_type(parent_ty, |c, m| {
                if c.is_deferred(m) {
                    c.base_constraint(m)
                } else {
                    m
                }
            });
            if !self.is_union(parent_ty) {
                break 'checked declared;
            }
            let reference = Reference {
                file,
                root: Root::Pattern(parent),
                path: SmallVec::new(),
                at: ExprId::NONE,
                has_key: true,
            };
            let walk = Walk::new(reference, parent_ty, parent_ty, true);
            let narrowed = self.get_flow_type_of_reference(walk, flow);
            if narrowed.is_never() {
                break 'checked TypeId::NEVER;
            }
            self.type_of_binding_element(file, pat, narrowed, true)
        };
        self.in_check_identifier.pop();
        ty
    }

    /// `getNarrowedTypeOfSymbol` for the parameter `p` at `e`. If it has no type annotation and the
    /// contextual signature of the function has a single rest parameter that is a union of tuples,
    /// tests of the other parameters determine which tuple was passed.
    fn narrow_dependent_parameter(
        &mut self,
        file: FileId,
        e: ExprId,
        p: ParamId,
        declared: TypeId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let param = &hir[p];
        if param.ty.is_some() || param.default.is_some() || param.flags.contains(Flags::REST) {
            return declared;
        }
        let func = bound.param_fn[p.idx()];
        let params = hir[func].params;
        // A `this` parameter is one of the parameters that are counted.
        let count = params.len() + hir[func].this_ty(hir).is_some() as usize;
        let flow = bound.expr_flow[e.idx()];
        // `isContextSensitiveFunctionOrObjectLiteralMethod`: a function with its own type
        // parameters takes nothing from its context.
        if count < 2
            || !matches!(
                hir[func].kind,
                FnKind::Expr | FnKind::Arrow | FnKind::Method
            )
            || !hir[func].type_params.is_empty()
            || flow == UNREACHABLE
        {
            return declared;
        }
        if params
            .iter()
            .any(|q| self.any_binding_assigned(file, hir[q].pat))
        {
            return declared;
        }
        let Some(sig) = self.contextual_signature(file, func) else {
            return declared;
        };
        let sig_params = self.sig_params(sig);
        let [rest] = &sig_params[..] else {
            return declared;
        };
        if !rest.rest {
            return declared;
        }
        let declared_rest = rest.ty;
        let instantiated = self
            .takes_context(file, func)
            .and_then(|owner| self.get_inference_context(file, owner))
            .and_then(|level| {
                self.with_inference_context(level, |c, context| {
                    let mapper = c.non_fixing_mapper(context, declared_rest);
                    c.instantiate(declared_rest, mapper)
                })
            })
            .unwrap_or(declared_rest);
        // `getReducedApparentType`
        let rest_ty = self.reduced_apparent_type(instantiated);
        if !self.is_union(rest_ty) || !self.every_type(rest_ty, |c, m| c.is_tuple(m)) {
            return declared;
        }
        let reference = Reference {
            file,
            root: Root::Params(func),
            path: SmallVec::new(),
            at: ExprId::NONE,
            has_key: true,
        };
        let walk = Walk::new(reference, rest_ty, rest_ty, true);
        let narrowed = self.get_flow_type_of_reference(walk, flow);
        // This is the result whether or not anything was narrowed: a parameter declared `x?` does
        // not include `undefined` because of that.
        let index = self.number_literal((p.0 - params.start) as f64, false);
        self.indexed_access(narrowed, index)
    }

    /// `container != f.flowContainer` at the start of a function. What depends on the variable is
    /// evaluated once per walk.
    fn settle_crossing(&mut self, walk: &mut Walk) -> bool {
        let file = walk.reference.file;
        let times = match walk.crossing {
            Crossing::No => return false,
            Crossing::Yes => return true,
            Crossing::Times(times) => times,
            Crossing::UpToDeclaration(symbol, e) => {
                self.flow_containers_up_to_declaration(file, symbol, e)
            }
            Crossing::PastLastAssignment(symbol, e) => {
                if self.is_past_last_assignment(file, symbol, e) {
                    self.flow_containers_up_to_declaration(file, symbol, e)
                } else {
                    0
                }
            }
        };
        walk.crossing = match times {
            0 => Crossing::No,
            u32::MAX => Crossing::Yes,
            _ => Crossing::Times(times),
        };
        if times != u32::MAX && walk.crossed >= times {
            return false;
        }
        walk.crossed += 1;
        true
    }

    /// `checkIdentifier`: how many times `flowContainer` moves to the enclosing container, from
    /// that of `e` until it is `declarationContainer`. `u32::MAX`: no walk can leave
    /// `declarationContainer`, or a container is not known.
    fn flow_containers_up_to_declaration(&self, file: FileId, symbol: SymbolId, e: ExprId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The parent of `f`, if `IsFunctionExpressionOrArrowFunction` or
        // `IsObjectLiteralOrClassExpressionMethodOrAccessor`. Only these have a start with `outer`.
        let around = |f: FnId| match (hir[f].kind, bound.fns[f.idx()].owner) {
            (
                FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter,
                FnOwner::Expr(x),
            ) => Some(bound.expr_parent[x.idx()]),
            (FnKind::Method | FnKind::Getter | FnKind::Setter, FnOwner::Member(m)) => {
                match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => match bound.class_owner[c.idx()] {
                        crate::bind::ClassOwner::Expr(x) => Some(Parent::Expr(x)),
                        crate::bind::ClassOwner::Stmt(_) => None,
                    },
                    _ => None,
                }
            }
            _ => None,
        };
        let declared_in = match self.root_declaration(file, symbol) {
            PatParent::Param(p) => Parent::ParamDefault(p),
            PatParent::Var(d) if bound.var_stmt[d.idx()].is_some() => {
                bound.stmt_parent[bound.var_stmt[d.idx()].idx()]
            }
            _ => return u32::MAX,
        };
        let declaration_container = self.get_control_flow_container(file, declared_in);
        if !matches!(declaration_container, Container::Fn(f) if around(f).is_some()) {
            return u32::MAX;
        }
        let mut flow_container = self.get_control_flow_container(file, bound.expr_parent[e.idx()]);
        let mut times = 0;
        while flow_container != declaration_container {
            let parent = match flow_container {
                Container::Fn(f) => around(f),
                Container::Other => return u32::MAX,
                _ => None,
            };
            let Some(parent) = parent else { break };
            times += 1;
            flow_container = self.get_control_flow_container(file, parent);
        }
        times
    }

    /// `initialType` without `assumeInitialized`: `undefined` for `autoType` and `autoArrayType`, else `declared | undefined`.
    fn start_unassigned(&mut self, walk: &mut Walk) {
        let declared = walk.declared;
        if self.is_automatic_type(declared) {
            walk.initial = TypeId::UNDEFINED;
            walk.start = Start::Known;
        } else if self.p.files.options.strict_null_checks
            && !self.is_any(declared)
            && declared != TypeId::UNKNOWN
            && !self.parts(declared).contains(&TypeId::UNDEFINED)
        {
            walk.start = Start::Unassigned;
        } else {
            walk.initial = self.optional(declared);
            walk.start = Start::Known;
        }
    }

    fn settle_start(&mut self, walk: &mut Walk) {
        let reference = &walk.reference;
        if self.assumes_initialized(reference.file, reference.at, walk.declared) {
            walk.start = Start::Known;
        } else {
            self.start_unassigned(walk);
        }
    }

    /// The type of the reference where `walk` ends without reaching an assignment.
    fn initial_of(&mut self, walk: &mut Walk) -> TypeId {
        if walk.start == Start::Unsettled {
            self.settle_start(walk);
        }
        if walk.start == Start::Unassigned {
            walk.initial = self.optional(walk.declared);
            walk.start = Start::Known;
        }
        walk.initial
    }

    /// Whether `initial_of` is the declared type.
    fn starts_as_declared(&mut self, walk: &mut Walk) -> bool {
        if walk.start == Start::Unsettled {
            self.settle_start(walk);
        }
        walk.start == Start::Known && walk.initial == walk.declared
    }

    /// `narrowTypeByDiscriminant`
    fn narrow_by_discriminant(
        &mut self,
        ty: TypeId,
        access: Access,
        narrow: impl FnOnce(&mut Self, TypeId) -> TypeId,
    ) -> TypeId {
        let Some((prop, has_never)) = self.type_of_discriminant(ty, access) else {
            return ty;
        };
        let narrowed = narrow(self, prop);
        // The property type of every member overlaps the union of all of them, unless it is
        // `never`.
        if narrowed == prop && !has_never {
            return ty;
        }
        self.members_with_discriminant(ty, access.name, narrowed)
    }

    /// The type in `ty` of the property that `access` accesses, and whether it is `never` in some
    /// member. `None`: the property is ignored.
    fn type_of_discriminant(&mut self, ty: TypeId, access: Access) -> Option<(TypeId, bool)> {
        let key = (ty, access.name, access.optional, access.non_null);
        if let Some(&known) = self.flow_memo.discriminant_types.get(&key) {
            return known;
        }
        let (found, stored) = self.run_memoizable(|c| c.type_of_discriminant_uncached(ty, access));
        if stored.is_some() && !self.is_stack_low() {
            self.flow_memo.discriminant_types.insert(key, found);
        }
        found
    }

    fn type_of_discriminant_uncached(
        &mut self,
        ty: TypeId,
        access: Access,
    ) -> Option<(TypeId, bool)> {
        let name = access.name;
        let remove_nullable = self.p.files.options.strict_null_checks
            && (access.optional || access.non_null)
            && self.maybe_type_of_kind(ty, |_, m| m.is_undefined() || m.is_null());
        let base = if remove_nullable {
            self.type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
        } else {
            ty
        };
        let mut prop = self.type_of_property_of_type(base, name)?;
        if self.is_any(prop) {
            return None;
        }
        let has_never = prop.is_never()
            || (self.parts(base).iter()).any(|&m| {
                self.type_of_property_or_index_signature_of_type(m, name)
                    .is_some_and(|t| t.is_never())
            });
        if remove_nullable && access.optional {
            prop = self.optional(prop);
        }
        Some((prop, has_never))
    }

    /// The members of `ty` whose property `name` overlaps `narrowed`.
    fn members_with_discriminant(&mut self, ty: TypeId, name: Atom, narrowed: TypeId) -> TypeId {
        let key = (ty, name, narrowed);
        if let Some(&known) = self.flow_memo.discriminated_types.get(&key) {
            return known;
        }
        let (left, stored) = self.run_memoizable(|c| {
            c.filter(ty, |c, m| {
                let discriminant = c
                    .type_of_property_or_index_signature_of_type(m, name)
                    .unwrap_or(TypeId::UNKNOWN);
                !discriminant.is_never()
                    && !narrowed.is_never()
                    && c.are_comparable(narrowed, discriminant)
            })
        });
        if stored.is_some() && !self.is_stack_low() {
            self.flow_memo.discriminated_types.insert(key, left);
        }
        left
    }

    // ───────────────────────────── tests ─────────────────────────────

    /// Whether `narrow` may narrow `reference` by `expr`, the test of the flow node `flow`. If not,
    /// it would run no query and return its input type.
    fn is_test_about(&mut self, reference: &Reference, flow: FlowId, expr: ExprId) -> bool {
        let file = reference.file;
        let memo = &self.flow_memo;
        let known = if memo.tests_of == Some(file) {
            memo.tests[flow.idx()]
        } else {
            memo.other_tests
                .get(&(file, flow))
                .copied()
                .unwrap_or_default()
        };
        if known.state != 0 {
            return known.concerns(reference);
        }
        self.look_into_test(file, flow, expr).concerns(reference)
    }

    #[inline(never)]
    fn look_into_test(&mut self, file: FileId, flow: FlowId, expr: ExprId) -> About {
        let mut about = About {
            state: About::KNOWN,
            ..About::default()
        };
        self.note_test(file, expr, 0, &mut about);
        let nodes = self.bound(file).flow.len();
        let memo = &mut self.flow_memo;
        // Nearly all walks are in the file being checked.
        if self.task.file == Some(file) && memo.tests_of != Some(file) {
            memo.tests_of = Some(file);
            memo.tests.clear();
            memo.tests.resize(nodes, About::default());
        }
        if memo.tests_of == Some(file) {
            memo.tests[flow.idx()] = about;
        } else {
            memo.other_tests.insert((file, flow), about);
        }
        about
    }

    /// Adds to `about` every expression `narrow` compares a reference with for the test `e`.
    /// `level`: the number of constants holding a test that have been followed.
    fn note_test(&self, file: FileId, e: ExprId, level: u32, about: &mut impl NarrowingSubjects) {
        if about.is_full() || self.is_stack_low() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        self.note_chain(file, e, true, About::ALONE, about);
        match hir[e].kind {
            // `const ok = test; if (ok)`
            ExprKind::Ident(_) if level < 5 => {
                let symbol = bound.expr_symbol[e.idx()];
                if symbol.is_some()
                    && bound.symbols[symbol.idx()].flags.contains(SymFlags::CONST)
                    && let &[Decl::Var(pat)] = &bound.symbols[symbol.idx()].decls[..]
                    && let PatParent::Var(d) = bound.pat_parent[pat.idx()]
                    && hir[d].ty.is_none()
                    && hir[d].init.is_some()
                {
                    self.note_test(file, hir[d].init, level + 1, about);
                }
            }
            ExprKind::Call(c) => {
                let call = &hir[c];
                for argument in hir.ids(call.args) {
                    self.note_chain(file, argument, false, About::ALONE, about);
                }
                // The receiver. `x.hasOwnProperty("a")` narrows `x.a`. For any other method
                // `x.method` is sufficient, which concerns fewer references than `x`.
                if let ExprKind::Dot { obj, name, .. } = hir[call.callee].kind {
                    if self.atoms().bytes(name) == b"hasOwnProperty" {
                        self.note_chain(file, obj, false, 0, about);
                    } else {
                        self.note_chain(file, call.callee, false, About::ALONE, about);
                    }
                }
            }
            ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.note_test(file, x, level, about);
            }
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.note_test(file, operand, level, about),
            ExprKind::Assign { value, .. } => self.note_test(file, value, level, about),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                    let (l, r) = (
                        self.reference_candidate(file, left),
                        self.reference_candidate(file, right),
                    );
                    for (side, other) in [(l, r), (r, l)] {
                        match hir[side].kind {
                            ExprKind::Unary {
                                op: UnOp::Typeof,
                                operand,
                            } => self.note_chain(file, operand, true, About::ALONE, about),
                            // `test(x) === true`
                            _ if matches!(hir[other].kind, ExprKind::True | ExprKind::False) => {
                                self.note_test(file, side, level, about);
                            }
                            _ => self.note_chain(file, side, true, About::ALONE, about),
                        }
                    }
                }
                BinOp::Instanceof => self.note_chain(file, left, false, About::ALONE, about),
                // `"a" in x` narrows `x.a`.
                BinOp::In => self.note_chain(file, right, false, 0, about),
                BinOp::Comma => self.note_test(file, right, level, about),
                BinOp::And | BinOp::Or => {
                    self.note_test(file, left, level, about);
                    self.note_test(file, right, level, about);
                }
                _ => {}
            },
            _ => {}
        }
    }

    /// Adds to `about` the root of `e`, which a reference is compared with: everything
    /// `matches_prefix` and `optional_chain_contains` visit on their way in. `is_whole`: `e` is
    /// tested as a `discriminant_access`, which a constant can alias: `const k = x.kind`, `const {
    /// kind: k } = x`. `first`: the value to record for the first property if there is none.
    fn note_chain(
        &self,
        file: FileId,
        e: ExprId,
        mut is_whole: bool,
        mut first: u32,
        about: &mut impl NarrowingSubjects,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            at = match hir[at].kind {
                ExprKind::Ident(name) => {
                    let symbol = bound.expr_symbol[at.idx()];
                    if symbol.is_none() {
                        about.add(root_key(Root::Global(name)), first);
                        return;
                    }
                    about.add(root_key(Root::Symbol(symbol)), first);
                    if is_whole
                        && bound.symbols[symbol.idx()].flags.contains(SymFlags::CONST)
                        && let &[Decl::Var(pat) | Decl::Param(pat)] =
                            &bound.symbols[symbol.idx()].decls[..]
                    {
                        let (declaration, is_element) = match bound.pat_parent[pat.idx()] {
                            PatParent::Prop(of, _) | PatParent::Elem(of, _) => {
                                (bound.pat_parent[of.idx()], true)
                            }
                            parent => (parent, false),
                        };
                        if let PatParent::Var(d) = declaration
                            && hir[d].init.is_some()
                            && match hir[hir[d].init].kind {
                                ExprKind::Dot { .. } | ExprKind::Index { .. } => true,
                                ExprKind::Ident(_) => is_element,
                                _ => false,
                            }
                        {
                            self.note_chain(file, hir[d].init, false, About::ALONE, about);
                        }
                    }
                    return;
                }
                ExprKind::This => {
                    about.add(root_key(Root::This), first);
                    return;
                }
                ExprKind::Dot { obj, name, .. } => {
                    is_whole = false;
                    first = name.0.wrapping_add(1);
                    obj
                }
                ExprKind::Index { obj, index, .. } => {
                    // `access_key` queries the type of such a key.
                    if matches!(hir[index].kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
                        && about.bails_on_computed_key()
                    {
                        return;
                    }
                    is_whole = false;
                    first = 0;
                    obj
                }
                ExprKind::Call(c) if hir[c].chain != Chain::No => {
                    is_whole = false;
                    hir[c].callee
                }
                ExprKind::NonNull(x) => {
                    is_whole = false;
                    x
                }
                ExprKind::Assign { target, .. } => target,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => right,
                _ => return,
            };
        }
    }

    fn narrow(&mut self, reference: &Reference, ty: TypeId, e: ExprId, sense: bool) -> TypeId {
        if self.is_stack_low() {
            return ty;
        }
        let file = reference.file;
        let hir = self.hir(file);
        // The `a` of `a?.b`, `a ?? b` and `a ??= b` is tested for being non-nullish, not for
        // truthiness.
        if let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] {
            let is_tested_for_presence = match hir[parent].kind {
                ExprKind::Dot {
                    obj,
                    chain: Chain::Start,
                    ..
                }
                | ExprKind::Index {
                    obj,
                    chain: Chain::Start,
                    ..
                } => obj == e,
                ExprKind::Call(c) => hir[c].chain == Chain::Start && hir[c].callee == e,
                ExprKind::Binary {
                    op: BinOp::Nullish,
                    left,
                    ..
                } => left == e,
                ExprKind::Assign {
                    op: Some(BinOp::Nullish),
                    target,
                    ..
                } => target == e,
                _ => false,
            };
            if is_tested_for_presence {
                return self.narrow_by_optionality(reference, ty, e, sense);
            }
        }
        match hir[e].kind {
            ExprKind::Ident(_) | ExprKind::This | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                // `const ok = test; if (ok)`
                if let ExprKind::Ident(_) = hir[e].kind
                    && self.inline_level < 5
                    && !self.matches(reference, e)
                {
                    let bound = self.bound(file);
                    let symbol = bound.expr_symbol[e.idx()];
                    if symbol.is_some()
                        && bound.symbols[symbol.idx()].flags.contains(SymFlags::CONST)
                        && self.is_constant_name(file, symbol)
                        && let &[Decl::Var(pat)] = &bound.symbols[symbol.idx()].decls[..]
                        && let PatParent::Var(d) = bound.pat_parent[pat.idx()]
                        && hir[d].ty.is_none()
                        && hir[d].init.is_some()
                        && self.is_constant_reference(reference)
                    {
                        self.inline_level += 1;
                        let result = self.narrow(reference, ty, hir[d].init, sense);
                        self.inline_level -= 1;
                        return result;
                    }
                }
                self.narrow_by_truthiness(reference, ty, e, sense)
            }
            ExprKind::Call(_) => {
                // `x?.f()` produced a value, so `x` is non-nullish. (Not followed through `const ok
                // = x?.f()`.) `narrowTypeByCallExpression` has no such test, so no key name is
                // resolved for it.
                let ty = if sense
                    && self.inline_level == 0
                    && self.optional_chain_contains_reference(reference, e, false)
                {
                    self.non_nullable(ty)
                } else {
                    ty
                };
                self.narrow_by_call(reference, ty, e, sense)
            }
            ExprKind::NonNull(x) | ExprKind::Satisfies { expr: x, .. } => {
                self.narrow(reference, ty, x, sense)
            }
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.narrow(reference, ty, operand, !sense),
            ExprKind::Assign { op, target, value } => match op {
                None | Some(BinOp::Or | BinOp::And | BinOp::Nullish) => {
                    let ty = self.narrow(reference, ty, value, sense);
                    self.narrow_by_truthiness(reference, ty, target, sense)
                }
                _ => ty,
            },
            ExprKind::Binary { op, left, right } => match op {
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                    self.narrow_by_comparison(reference, ty, op, left, right, sense)
                }
                BinOp::Instanceof => {
                    self.narrow_by_instanceof(reference, ty, e, left, right, sense)
                }
                BinOp::In => self.narrow_by_in(reference, ty, left, right, sense),
                BinOp::Comma => self.narrow(reference, ty, right, sense),
                BinOp::And => {
                    if sense {
                        let ty = self.narrow(reference, ty, left, true);
                        self.narrow(reference, ty, right, true)
                    } else {
                        let a = self.narrow(reference, ty, left, false);
                        let b = self.narrow(reference, ty, right, false);
                        self.union(&[a, b])
                    }
                }
                BinOp::Or => {
                    if sense {
                        let a = self.narrow(reference, ty, left, true);
                        let b = self.narrow(reference, ty, right, true);
                        self.union(&[a, b])
                    } else {
                        let ty = self.narrow(reference, ty, left, false);
                        self.narrow(reference, ty, right, false)
                    }
                }
                _ => ty,
            },
            _ => ty,
        }
    }

    /// `narrowTypeByOptionality`
    fn narrow_by_optionality(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        e: ExprId,
        is_present: bool,
    ) -> TypeId {
        let include = if is_present {
            facts::NE_UNDEFINED_OR_NULL
        } else {
            facts::EQ_UNDEFINED_OR_NULL
        };
        if self.matches(reference, e) {
            return self.adjusted_type_with_facts(ty, include);
        }
        if let Some(name) = self.discriminant_access(reference, e, ty) {
            return self.narrow_by_discriminant(ty, name, |c, t| c.type_with_facts(t, include));
        }
        ty
    }

    /// `narrowTypeByTruthiness`
    fn narrow_by_truthiness(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        e: ExprId,
        sense: bool,
    ) -> TypeId {
        let include = if sense { facts::TRUTHY } else { facts::FALSY };
        if self.matches(reference, e) {
            return self.adjusted_type_with_facts(ty, include);
        }
        let mut ty = ty;
        if sense && self.optional_chain_contains(reference, e) {
            ty = self.non_nullable(ty);
        }
        if let Some(name) = self.discriminant_access(reference, e, ty) {
            return self.narrow_by_discriminant(ty, name, |c, t| c.type_with_facts(t, include));
        }
        ty
    }

    /// `getReferenceCandidate`: the candidate of `x = v`, `x ||= v` and similar is `x`, and that of
    /// `a, x` is `x`. `x!` is not looked through.
    fn reference_candidate(&self, file: FileId, mut e: ExprId) -> ExprId {
        let hir = self.hir(file);
        loop {
            e = match hir[e].kind {
                ExprKind::Assign {
                    op: None | Some(BinOp::Or | BinOp::And | BinOp::Nullish),
                    target,
                    ..
                } => target,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => right,
                _ => return e,
            };
        }
    }

    fn narrow_by_comparison(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        sense: bool,
    ) -> TypeId {
        let file = reference.file;
        let hir = self.hir(file);
        let (l, r) = (
            self.reference_candidate(file, left),
            self.reference_candidate(file, right),
        );
        if let (
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            },
            ExprKind::String(name),
        ) = (hir[l].kind, hir[r].kind)
        {
            return self.narrow_by_typeof(reference, ty, operand, op, name, sense);
        }
        if let (
            ExprKind::String(name),
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            },
        ) = (hir[l].kind, hir[r].kind)
        {
            return self.narrow_by_typeof(reference, ty, operand, op, name, sense);
        }
        if self.matches(reference, l) {
            return self.narrow_by_equality(file, ty, op, r, sense);
        }
        if self.matches(reference, r) {
            return self.narrow_by_equality(file, ty, op, l, sense);
        }
        let mut ty = ty;
        for (chain, value) in [(l, r), (r, l)] {
            if self.optional_chain_contains(reference, chain) {
                // `x?.a === v` implies that `x` is not nullish if `v` is not `undefined`; so does
                // `x?.a !== undefined`.
                let is_equal = matches!(op, BinOp::EqEq | BinOp::EqEqEq) == sense;
                let value_ty = self.get_type_of_expression(file, value);
                let loose = matches!(op, BinOp::EqEq | BinOp::NotEq);
                let may_be_missing = self.some_type(value_ty, |c, m| {
                    m.is_undefined()
                        || c.is_any(m)
                        || m == TypeId::UNKNOWN
                        || (loose && m.is_null())
                });
                let is_missing =
                    self.every_type(value_ty, |_, m| m.is_undefined() || (loose && m.is_null()));
                if (is_equal && !may_be_missing) || (!is_equal && is_missing) {
                    ty = self.non_nullable(ty);
                }
            }
        }
        if let Some(access) = self.discriminant_access(reference, l, ty) {
            return self.narrow_by_discriminant_property(file, ty, access, op, r, sense);
        }
        if let Some(access) = self.discriminant_access(reference, r, ty) {
            return self.narrow_by_discriminant_property(file, ty, access, op, l, sense);
        }
        if self.is_matching_constructor_reference(reference, l) {
            return self.narrow_by_constructor(file, ty, op, r, sense);
        }
        if self.is_matching_constructor_reference(reference, r) {
            return self.narrow_by_constructor(file, ty, op, l, sense);
        }
        // `narrowTypeByBooleanComparison`: `test(x) === true`, `true === test(x)`
        for (test, literal) in [(l, r), (r, l)] {
            if matches!(hir[literal].kind, ExprKind::True | ExprKind::False)
                && !matches!(
                    hir[test].kind,
                    ExprKind::Dot { .. } | ExprKind::Index { .. }
                )
            {
                let is_true = matches!(hir[literal].kind, ExprKind::True);
                let is_equal = matches!(op, BinOp::EqEq | BinOp::EqEqEq);
                return self.narrow(reference, ty, test, (is_true == is_equal) == sense);
            }
        }
        ty
    }

    /// `narrowTypeByDiscriminantProperty`
    fn narrow_by_discriminant_property(
        &mut self,
        file: FileId,
        ty: TypeId,
        access: Access,
        op: BinOp,
        value: ExprId,
        sense: bool,
    ) -> TypeId {
        if matches!(op, BinOp::EqEqEq | BinOp::NotEqEq)
            && let Some((name, constituents)) = self.key_property(ty)
            && *name == access.name
        {
            let key = self.type_of_compared(file, value);
            let key = self.regular(key);
            // `getConstituentTypeForKeyType`
            if let Some(&candidate) = constituents.get(&key)
                && candidate != TypeId::UNKNOWN
            {
                if sense == matches!(op, BinOp::EqEqEq) {
                    return candidate;
                }
                let is_unit = self
                    .type_of_property(candidate, access.name)
                    .is_some_and(|p| self.is_unit(p));
                return if is_unit {
                    self.filter(ty, |_, m| m != candidate)
                } else {
                    ty
                };
            }
        }
        self.narrow_by_discriminant(ty, access, |c, t| {
            c.narrow_by_equality(file, t, op, value, sense)
        })
    }

    /// `getKeyPropertyName` and its map (`computeKeyPropertyNameAndMap`): the discriminant property
    /// of the members of the union `ty`, and the member that each of its values maps to, UNKNOWN
    /// for a value shared by several members. `None` unless `ty` has at least ten object types.
    pub(super) fn key_property(
        &mut self,
        ty: TypeId,
    ) -> Option<&'p (Atom, FxHashMap<TypeId, TypeId>)> {
        if !self.is_union(ty) || self.parts(ty).len() < 10 {
            return None;
        }
        let kept = &self.p.key_properties;
        if let Some(known) = kept.get_ref(&self.task, &ty) {
            return known.as_ref();
        }
        let (found, stored) = self.run_memoizable(|c| c.compute_key_property_name_and_map(ty));
        // An incomplete result is not used: the caller compares with every member of the union
        // instead.
        kept.insert_ref(&self.task, ty, found, stored?).1.as_ref()
    }

    /// `computeKeyPropertyNameAndMap`
    fn compute_key_property_name_and_map(
        &mut self,
        ty: TypeId,
    ) -> Option<(Atom, FxHashMap<TypeId, TypeId>)> {
        let parts = self.parts(ty);
        // `TypeFlagsObject | TypeFlagsInstantiableNonPrimitive`
        let counts = |c: &Self, m: TypeId| {
            c.is_object_type(m) || c.is_deferred(m) && !matches!(c.data(m), TypeData::Keyof(_))
        };
        if parts.len() < 10 || parts.iter().filter(|&&m| counts(self, m)).count() < 10 {
            return None;
        }
        // `getKeyPropertyCandidateName`: the first property whose type is a unit type.
        // `only_viable` is not in tsgo and exists for speed: `mapTypesByKeyProperty` bails out
        // unless every member has a literal type for the name, so from the second member on only
        // the names for which all previous members had one are inspected. The types of the other
        // properties are not resolved.
        let candidate = |c: &mut Self, only_viable: bool| {
            let mut viable: Option<SmallVec<[Atom; 16]>> = None;
            for &m in parts {
                if !counts(c, m) {
                    continue;
                }
                let apparent = c.apparent_type(m);
                let Some(members) = c.members(apparent) else {
                    continue;
                };
                let mut literal = SmallVec::new();
                for prop in &members.shape().props {
                    if viable
                        .as_ref()
                        .is_some_and(|names| !names.contains(&prop.name))
                    {
                        continue;
                    }
                    let held = c.type_of_prop(prop, members.mapper);
                    if c.is_unit(held) {
                        return Some(prop.name);
                    }
                    if only_viable && c.every_type(held, |c, d| c.is_unit(d)) {
                        literal.push(prop.name);
                    }
                }
                if only_viable {
                    if literal.is_empty() {
                        return None;
                    }
                    viable = Some(literal);
                }
            }
            None
        };
        let name = candidate(self, true)?;
        // tsgo takes the first candidate overall, and a candidate that `only_viable` skipped yields
        // no map.
        if candidate(self, false) != Some(name) {
            return None;
        }
        // `mapTypesByKeyProperty`
        let mut constituents = FxHashMap::with_capacity_and_hasher(parts.len(), Default::default());
        let mut count = 0;
        for &m in parts {
            if !(counts(self, m) || self.is_intersection(m)) {
                continue;
            }
            let discriminant = self.type_of_property(m, name)?;
            // `isLiteralType`
            if !self.every_type(discriminant, |c, d| c.is_unit(d)) {
                return None;
            }
            let mut is_duplicate = false;
            for &d in self.parts(discriminant) {
                let key = self.regular(d);
                match constituents.get(&key).copied() {
                    None => {
                        constituents.insert(key, m);
                    }
                    Some(TypeId::UNKNOWN) => {}
                    Some(_) => {
                        constituents.insert(key, TypeId::UNKNOWN);
                        is_duplicate = true;
                    }
                }
            }
            if !is_duplicate {
                count += 1;
            }
        }
        (count >= 10 && count * 2 >= parts.len()).then_some((name, constituents))
    }

    /// `isMatchingConstructorReference`
    fn is_matching_constructor_reference(&mut self, reference: &Reference, e: ExprId) -> bool {
        let (obj, name) = match self.hir(reference.file)[e].kind {
            ExprKind::Dot { obj, name, .. } => (obj, Some(name)),
            ExprKind::Index { obj, index, .. } => (obj, self.literal_key(reference.file, index)),
            _ => return false,
        };
        name == Some(known::constructor) && self.matches(reference, obj)
    }

    /// `narrowTypeByConstructor`
    fn narrow_by_constructor(
        &mut self,
        file: FileId,
        ty: TypeId,
        op: BinOp,
        identifier: ExprId,
        sense: bool,
    ) -> TypeId {
        // Not being equal to the constructor narrows nothing.
        if ty == TypeId::UNRESOLVED || sense != matches!(op, BinOp::EqEq | BinOp::EqEqEq) {
            return ty;
        }
        let constructor = self.get_type_of_expression(file, identifier);
        // `isFunctionType`, `isConstructorType`
        let is_function =
            self.is_object_type(constructor) && !self.signatures(constructor, false).is_empty();
        if !is_function && self.signatures(constructor, true).is_empty() {
            return ty;
        }
        let Some(candidate) = self.type_of_property(constructor, known::prototype) else {
            return ty;
        };
        let (object, function) = (
            self.global_ref(known::Object, &[]),
            self.global_ref(known::Function, &[]),
        );
        if self.is_any(candidate) || candidate == object || candidate == function {
            return ty;
        }
        if self.has_any_flag(ty) {
            return candidate;
        }
        self.filter(ty, |c, m| c.is_constructed_by(m, candidate))
    }

    /// `isConstructedBy`: classes are compared nominally, not structurally.
    fn is_constructed_by(&mut self, source: TypeId, target: TypeId) -> bool {
        if self.is_declared_class_type(source) || self.is_declared_class_type(target) {
            // The `this` type of a class has the symbol of the class.
            let symbol = |c: &Self, t: TypeId| match *c.data(t) {
                TypeData::Ref { target, .. } | TypeData::ThisParam(target) => Some(target),
                _ => None,
            };
            let of_source = symbol(self, source);
            return of_source.is_some() && of_source == symbol(self, target);
        }
        self.is_subtype(source, target)
    }

    /// `ObjectFlagsClass`: the declared type of a class. Not an instantiation with other type
    /// arguments: `C<any>` is a reference to it.
    fn is_declared_class_type(&mut self, ty: TypeId) -> bool {
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return false;
        };
        self.files().flags(target).contains(SymFlags::CLASS) && self.declared_type(target) == ty
    }

    /// The type of `value`, the operand being compared against.
    fn type_of_compared(&mut self, file: FileId, value: ExprId) -> TypeId {
        // A constant that can only have one value has the type of that value. Resolving it by flow
        // analysis re-enters here, repeatedly in a loop.
        let constant = match self.hir(file)[value].kind {
            ExprKind::Ident(name) => self
                .symbol_of_identifier(file, value, name)
                .filter(|&s| self.files().flags(s).contains(SymFlags::CONST))
                .map(|s| self.type_of_symbol(s))
                .filter(|&t| self.is_unit(t)),
            _ => None,
        };
        match constant {
            Some(ty) => ty,
            None => self.get_type_of_expression(file, value),
        }
    }

    /// `narrowTypeByEquality`
    fn narrow_by_equality(
        &mut self,
        file: FileId,
        ty: TypeId,
        op: BinOp,
        value: ExprId,
        sense: bool,
    ) -> TypeId {
        if self.is_any(ty) {
            return ty;
        }
        let sense = if matches!(op, BinOp::NotEq | BinOp::NotEqEq) {
            !sense
        } else {
            sense
        };
        let loose = matches!(op, BinOp::EqEq | BinOp::NotEq);
        let as_written = self.type_of_compared(file, value);
        let value_ty = self.regular(as_written);
        if value_ty == TypeId::UNRESOLVED {
            return ty;
        }
        let key = (ty, as_written, loose, sense);
        if let Some(&known) = self.flow_memo.equal_types.get(&key) {
            return known;
        }
        let (narrowed, stored) =
            self.run_memoizable(|c| c.narrow_by_equal_type(ty, as_written, value_ty, loose, sense));
        if stored.is_some() && !self.is_stack_low() {
            self.flow_memo.equal_types.insert(key, narrowed);
        }
        narrowed
    }

    /// Narrows `ty` given whether it is equal (`sense`) to a value of type `as_written`.
    /// `value_ty`: the same type as an annotation would denote it. `loose`: `==` semantics.
    fn narrow_by_equal_type(
        &mut self,
        ty: TypeId,
        as_written: TypeId,
        value_ty: TypeId,
        loose: bool,
        sense: bool,
    ) -> TypeId {
        if value_ty.is_null() || value_ty.is_undefined() {
            if !self.p.files.options.strict_null_checks {
                return ty;
            }
            let include = match (loose, value_ty.is_null(), sense) {
                (true, _, true) => facts::EQ_UNDEFINED_OR_NULL,
                (true, _, false) => facts::NE_UNDEFINED_OR_NULL,
                (false, true, true) => facts::EQ_NULL,
                (false, true, false) => facts::NE_NULL,
                (false, false, true) => facts::EQ_UNDEFINED,
                (false, false, false) => facts::NE_UNDEFINED,
            };
            return self.adjusted_type_with_facts(ty, include);
        }
        if sense {
            // `unknown` and `{}` narrow to the type they compared equal to.
            if !loose
                && (ty == TypeId::UNKNOWN
                    || self
                        .parts(ty)
                        .iter()
                        .any(|&m| self.is_empty_anonymous_object_type(m)))
            {
                if self.has_primitive_flag(value_ty)
                    || value_ty == TypeId::OBJECT
                    || self.is_empty_anonymous_object_type(value_ty)
                {
                    return as_written;
                }
                if self.is_object_type(value_ty) {
                    return TypeId::OBJECT;
                }
            }
            // `isCoercibleUnderDoubleEquals`
            let coerces = loose
                && (matches!(value_ty, TypeId::NUMBER | TypeId::STRING)
                    || self.is_boolean(value_ty));
            let kept = self.filter(ty, |c, m| {
                c.are_comparable(m, value_ty)
                    || coerces
                        && (m == TypeId::NUMBER || m == TypeId::STRING || c.is_boolean_like(m))
            });
            // Keeps the freshness of the source literal: a `string` narrowed to `"a"` widens to
            // `string` again where it is stored.
            return self.replace_primitives_with_literals(kept, as_written);
        }
        if self.is_unit(value_ty) {
            let is_plain = Self::is_literal_outside_enum(self.flags(value_ty));
            return self.filter(ty, |c, m| {
                if is_plain && Self::is_literal_outside_enum(c.flags(m)) {
                    return c.with_freshness(m, false) != value_ty;
                }
                !(c.is_unit_like(m) && c.are_comparable(m, value_ty))
            });
        }
        ty
    }

    /// FOR SPEED: a string, number or bigint literal type that is not a member of an enum. No rule
    /// of `isSimpleTypeRelatedTo` relates two of them, so they are comparable only if their regular
    /// types are the same. `x.kind !== "a"` tests every member of the type of `x.kind`.
    #[inline]
    fn is_literal_outside_enum(flags: u32) -> bool {
        flags & (tf::STRING_LITERAL | tf::NUMBER_LITERAL | tf::BIGINT_LITERAL) != 0
            && flags & tf::ENUM_LITERAL == 0
    }

    /// `isUnitLikeType`: a tagged literal type also qualifies.
    fn is_unit_like(&mut self, ty: TypeId) -> bool {
        let ty = self.base_constraint_of(ty).unwrap_or(ty);
        match self.data(ty) {
            TypeData::Intersection(parts) => parts.iter().any(|&p| self.is_unit(p)),
            _ => self.is_unit(ty),
        }
    }

    /// `extractUnitType`
    fn extract_unit(&self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Intersection(parts) => parts
                .iter()
                .copied()
                .find(|&p| self.is_unit(p))
                .unwrap_or(ty),
            _ => ty,
        }
    }

    /// `replacePrimitivesWithLiterals`: `string` that compared equal to `"a"` becomes `"a"`.
    fn replace_primitives_with_literals(&mut self, ty: TypeId, literals: TypeId) -> TypeId {
        fn is_pattern(c: &Checker<'_, '_>, t: TypeId) -> bool {
            matches!(
                c.data(t),
                TypeData::Template { .. } | TypeData::StringMapping { .. }
            )
        }
        let has_primitives = self.maybe_type_of_kind(ty, |c, t| {
            matches!(t, TypeId::STRING | TypeId::NUMBER | TypeId::BIGINT)
                || matches!(c.data(t), TypeData::Template { .. })
        });
        if !has_primitives
            || !self.maybe_type_of_kind(literals, |c, t| {
                c.is_literal(t) && !c.is_boolean_like(t) || is_pattern(c, t)
            })
        {
            return ty;
        }
        let has_wide_strings =
            self.maybe_type_of_kind(literals, |c, t| t == TypeId::STRING || is_pattern(c, t));
        self.map_type(ty, |c, m| {
            if m == TypeId::STRING {
                c.filter(literals, |k, x| k.is_string_like(x))
            } else if !has_wide_strings && c.is_pattern_literal(m) {
                c.filter(literals, |k, x| k.is_string_like(x) && k.is_literal(x))
            } else if m == TypeId::NUMBER {
                c.filter(literals, |k, x| {
                    k.is_number_like(x) && !matches!(k.data(x), TypeData::Enum { .. })
                })
            } else if m == TypeId::BIGINT {
                c.filter(literals, |k, x| k.is_bigint_like(x))
            } else {
                m
            }
        })
    }

    fn narrow_by_typeof(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        operand: ExprId,
        op: BinOp,
        name: Atom,
        sense: bool,
    ) -> TypeId {
        let sense = if matches!(op, BinOp::NotEq | BinOp::NotEqEq) {
            !sense
        } else {
            sense
        };
        let operand = self.reference_candidate(reference.file, operand);
        if !self.matches(reference, operand) {
            let mut ty = ty;
            if self.optional_chain_contains(reference, operand)
                && sense == (name != known::undefined)
            {
                ty = self.non_nullable(ty);
            }
            if let Some(prop) = self.discriminant_access(reference, operand, ty) {
                return self.narrow_by_discriminant(ty, prop, |c, t| {
                    c.narrow_type_by_typeof_name(t, name, sense)
                });
            }
            return ty;
        }
        self.narrow_type_by_typeof_name(ty, name, sense)
    }

    /// `narrowTypeByLiteralExpression`
    fn narrow_type_by_typeof_name(&mut self, ty: TypeId, name: Atom, sense: bool) -> TypeId {
        use facts::*;
        if ty == TypeId::UNRESOLVED {
            return ty;
        }
        if !sense {
            return self.adjusted_type_with_facts(ty, typeof_ne_facts(name));
        }
        // `narrowTypeByTypeName`
        match name {
            known::string => self.narrow_type_by_type_facts(ty, TypeId::STRING, TYPEOF_EQ_STRING),
            known::number => self.narrow_type_by_type_facts(ty, TypeId::NUMBER, TYPEOF_EQ_NUMBER),
            known::bigint => self.narrow_type_by_type_facts(ty, TypeId::BIGINT, TYPEOF_EQ_BIGINT),
            known::boolean => {
                self.narrow_type_by_type_facts(ty, TypeId::BOOLEAN, TYPEOF_EQ_BOOLEAN)
            }
            known::symbol => self.narrow_type_by_type_facts(ty, TypeId::SYMBOL, TYPEOF_EQ_SYMBOL),
            known::undefined => {
                let undefined = TypeId::UNDEFINED;
                self.narrow_type_by_type_facts(ty, undefined, EQ_UNDEFINED)
            }
            known::object => {
                if self.has_any_flag(ty) {
                    return ty;
                }
                let object = self.narrow_type_by_type_facts(ty, TypeId::OBJECT, TYPEOF_EQ_OBJECT);
                let null = TypeId::NULL;
                let null = self.narrow_type_by_type_facts(ty, null, EQ_NULL);
                self.union(&[object, null])
            }
            known::function => {
                if self.has_any_flag(ty) {
                    return ty;
                }
                let function = self.global_ref(known::Function, &[]);
                self.narrow_type_by_type_facts(ty, function, TYPEOF_EQ_FUNCTION)
            }
            _ => self.narrow_type_by_type_facts(ty, TypeId::OBJECT, TYPEOF_EQ_HOST_OBJECT),
        }
    }

    /// `getEffectsSignature` for `e`, which is `left instanceof right`. `right_type`: the type of
    /// `right`.
    pub(super) fn effects_signature_of_instanceof(
        &mut self,
        file: FileId,
        e: ExprId,
        right_type: TypeId,
    ) -> Option<SigId> {
        let method = self.symbol_has_instance_method_of_object_type(right_type)?;
        let sigs = self.signatures(method, false);
        match sigs[..] {
            [only] if self.sig_type_params(only).is_empty() => Some(only),
            _ if sigs.iter().any(|&s| self.sig_predicate(s).is_some()) => {
                self.resolved_effects_signature(file, e)
            }
            _ => None,
        }
    }

    fn narrow_by_instanceof(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        e: ExprId,
        left: ExprId,
        right: ExprId,
        sense: bool,
    ) -> TypeId {
        let file = reference.file;
        let left = self.reference_candidate(file, left);
        if !self.matches(reference, left) {
            if sense && self.optional_chain_contains(reference, left) {
                return self.non_nullable(ty);
            }
            return ty;
        }
        let constructor = self.get_type_of_expression(file, right);
        let object = self.global_ref(known::Object, &[]);
        if !self.is_type_derived_from(constructor, object) {
            return ty;
        }
        // A `[Symbol.hasInstance]` that is a type guard takes precedence.
        if let Some(sig) = self.effects_signature_of_instanceof(file, e, constructor)
            && let Some(Predicate {
                param: Some(0),
                ty: Some(guarded),
                asserts: false,
            }) = self.sig_predicate(sig)
        {
            return self.narrowed_to(ty, guarded, sense, CheckDerived::Yes);
        }
        let function = self.global_ref(known::Function, &[]);
        if !self.is_type_derived_from(constructor, function) {
            return ty;
        }
        let instance = self.map_type(constructor, |c, m| c.instance_type(m));
        // `any` is not narrowed to `Object` or `Function`. The false branch narrows only if the
        // instance type is a non-empty object type.
        if self.is_any(ty) && (instance == object || instance == function)
            || !sense
                && !(self.is_object_type(instance)
                    && !self.is_empty_anonymous_object_type(instance))
        {
            return ty;
        }
        self.narrowed_to(ty, instance, sense, CheckDerived::Yes)
    }

    /// `getInstanceType`
    fn instance_type(&mut self, constructor: TypeId) -> TypeId {
        if let TypeData::Anon {
            origin: Origin::ClassStatic(class),
            ..
        } = *self.data(constructor)
        {
            let count = self.local_type_params_of_symbol(class).len();
            let anys: SmallVec<[TypeId; 4]> = smallvec![TypeId::ANY; count];
            return self.type_reference(class, &anys);
        }
        if let Some(prototype) = self.type_of_property(constructor, known::prototype)
            && !self.is_any(prototype)
        {
            return prototype;
        }
        let returns: Vec<TypeId> = self
            .signatures(constructor, true)
            .into_iter()
            .map(|s| {
                let s = self.erased_sig(s);
                self.sig_return(s)
            })
            .collect();
        // Nothing is known about the type it constructs.
        if returns.is_empty() {
            TypeId::EMPTY_OBJECT
        } else {
            self.union(&returns)
        }
    }

    /// `isTypeDerivedFrom`: uses the declared `extends` relations, not the structure.
    pub(super) fn is_type_derived_from(&mut self, source: TypeId, target: TypeId) -> bool {
        if let TypeData::Union(parts) = self.data(source) {
            return parts.iter().all(|&s| self.is_type_derived_from(s, target));
        }
        if let TypeData::Union(parts) = self.data(target) {
            return parts.iter().any(|&t| self.is_type_derived_from(source, t));
        }
        if let TypeData::Intersection(parts) = self.data(source) {
            return parts.iter().any(|&s| self.is_type_derived_from(s, target));
        }
        if self.is_instantiable_non_primitive(source) {
            let constraint = self.base_constraint(source);
            return constraint != source && self.is_type_derived_from(constraint, target);
        }
        let is_object = self.is_object_type(source) || source == TypeId::OBJECT;
        if self.is_empty_anonymous_object_type(target) {
            return is_object;
        }
        if self.is_reference_to_global(target, known::Object) {
            return is_object && !self.is_empty_anonymous_object_type(source);
        }
        if self.is_reference_to_global(target, known::Function) {
            return self.is_object_type(source) && self.is_function_object_type(source);
        }
        let TypeData::Ref { target: base, .. } = *self.data(target) else {
            return false;
        };
        if self.has_base(source, base, 0) {
            return true;
        }
        if self.is_reference_to_global(target, known::Array) {
            let readonly = self.readonly_array_of(TypeId::ANY);
            return self.is_type_derived_from(source, readonly);
        }
        false
    }

    /// `getNarrowedType`: `ty`, knowing that the value is (or is not) a `candidate`.
    pub(super) fn narrowed_to(
        &mut self,
        ty: TypeId,
        candidate: TypeId,
        sense: bool,
        check_derived: CheckDerived,
    ) -> TypeId {
        if !self.is_union(ty) {
            return self.narrowed_to_uncached(ty, candidate, sense, check_derived);
        }
        let key = (ty, candidate, sense, check_derived == CheckDerived::Yes);
        if let Some(&known) = self.flow_memo.narrowed_types.get(&key) {
            return known;
        }
        let (narrowed, stored) =
            self.run_memoizable(|c| c.narrowed_to_uncached(ty, candidate, sense, check_derived));
        if stored.is_some() {
            self.flow_memo.narrowed_types.insert(key, narrowed);
        }
        narrowed
    }

    /// `getNarrowedTypeWorker`
    fn narrowed_to_uncached(
        &mut self,
        ty: TypeId,
        candidate: TypeId,
        sense: bool,
        check_derived: CheckDerived,
    ) -> TypeId {
        if ty == TypeId::UNRESOLVED {
            return ty;
        }
        let check_derived = check_derived == CheckDerived::Yes;
        if !sense {
            if ty == candidate {
                return TypeId::NEVER;
            }
            if check_derived {
                return self.filter(ty, |c, m| !c.is_type_derived_from(m, candidate));
            }
            // `unknownUnionType`: `unknown` is temporarily treated as `{} | null | undefined`.
            let everything = self.union(&[
                TypeId::UNKNOWN_EMPTY_OBJECT,
                TypeId::NULL,
                TypeId::UNDEFINED,
            ]);
            let ty = if ty == TypeId::UNKNOWN {
                everything
            } else {
                ty
            };
            let if_so = self.narrowed_to(ty, candidate, true, CheckDerived::No);
            let rest = self.filter(ty, |c, m| !(m == if_so || c.parts(if_so).contains(&m)));
            return if rest == everything {
                TypeId::UNKNOWN
            } else {
                rest
            };
        }
        if self.is_any(ty) || ty == TypeId::UNKNOWN || ty == candidate {
            return candidate;
        }
        let narrowed = self.map_type(candidate, |c, n| {
            // A union with a key property is reduced to the constituent that has the key of `n`.
            let union = ty;
            let matching = c
                .matching_union_constituent_for_type(union, n)
                .unwrap_or(ty);
            // Of two related types, the more specific one. If each is related to the other: the
            // candidate for a type guard; the original type for `instanceof`, since a prototype
            // carries no type arguments.
            let directly_related = c.map_type(matching, |c, t| {
                if check_derived {
                    if c.is_type_derived_from(t, n) {
                        t
                    } else if c.is_type_derived_from(n, t) {
                        n
                    } else {
                        TypeId::NEVER
                    }
                } else if c.is_strict_subtype(t, n) {
                    t
                } else if c.is_strict_subtype(n, t) {
                    n
                } else if c.is_subtype(t, n) {
                    t
                } else if c.is_subtype(n, t) {
                    n
                } else {
                    TypeId::NEVER
                }
            });
            if !directly_related.is_never() {
                return directly_related;
            }
            // Otherwise, the generic members that may turn out to be a candidate once instantiated.
            c.map_type(ty, |c, t| {
                if c.maybe_type_of_kind(t, Self::is_instantiable) {
                    let related = match c.base_constraint_of(t) {
                        None => true,
                        Some(constraint) if check_derived => c.is_type_derived_from(n, constraint),
                        Some(constraint) => c.is_subtype(n, constraint),
                    };
                    if related {
                        return c.intersection(&[t, n]);
                    }
                }
                TypeId::NEVER
            })
        });
        if !narrowed.is_never() {
            narrowed
        } else if self.is_subtype(candidate, ty) {
            candidate
        } else if self.is_assignable(ty, candidate) {
            ty
        } else if self.is_assignable(candidate, ty) {
            candidate
        } else {
            self.intersection(&[ty, candidate])
        }
    }

    /// `narrowTypeByBinaryExpression`, of `left in right`.
    fn narrow_by_in(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        left: ExprId,
        right: ExprId,
        sense: bool,
    ) -> TypeId {
        let file = reference.file;
        let hir = self.hir(file);
        let right = self.reference_candidate(file, right);
        // `narrowTypeByPrivateIdentifierInInExpression`: `#x in v` tests whether `v` is an instance
        // of the class that declares `#x`.
        if let ExprKind::String(name) = hir[left].kind
            && is_private_name_at(hir, hir[left].pos)
        {
            let Some(&class) = self.bound(file).private_class.get(&left) else {
                return ty;
            };
            if !self.matches(reference, right) {
                return ty;
            }
            // `lookupSymbolForPrivateIdentifierDeclaration`: searches the instance members of the
            // class before its statics.
            let is_static = !hir[class].members.iter().any(|m| {
                hir[m].key == PropKey::Private(name) && !hir[m].flags.contains(Flags::STATIC)
            });
            let sym = self.class_sym(file, class);
            let target = if is_static {
                self.type_of_symbol(sym)
            } else {
                self.declared_type(sym)
            };
            return self.narrowed_to(ty, target, sense, CheckDerived::Yes);
        }
        // `"a" in x` narrows `x.a` by presence if its type includes the missing type
        // (`containsMissingType`).
        if let Some((&last, _)) = reference.path.split_last()
            && self.contains_missing_type(ty)
            && self.matches_prefix(reference, reference.path.len() - 1, right)
        {
            let key = self.get_type_of_expression(file, left);
            if self.property_name_of_type(key) == Some(last) {
                return self.type_with_facts(
                    ty,
                    if sense {
                        facts::NE_UNDEFINED
                    } else {
                        facts::EQ_UNDEFINED
                    },
                );
            }
        }
        if !self.matches(reference, right) {
            return ty;
        }
        let key = self.get_type_of_expression(file, left);
        let Some(name) = self.property_name_of_type(key) else {
            return ty;
        };
        if self.is_any(ty) {
            // It declares no properties: the result is the intersection with `Record<K, unknown>`
            // below, which is `errorType` for an error type and `anyType` for `autoType`.
            let is_intersected = sense && self.global_type_symbol(known::Record).is_some();
            return if is_intersected && self.is_error_type(ty) {
                TypeId::ERROR
            } else if is_intersected && ty == TypeId::AUTO {
                TypeId::ANY
            } else {
                ty
            };
        }
        if (self.parts(ty).iter()).any(|&m| self.is_type_presence_possible(m, name, true)) {
            return self.filter(ty, |c, m| c.is_type_presence_possible(m, name, sense));
        }
        // No member declares the property: in the true branch its presence is all that is known
        // about it.
        if sense && let Some(record) = self.global_type_symbol(known::Record) {
            let key = self.regular(key);
            let record = self.type_reference(record, &[key, TypeId::UNKNOWN]);
            return self.intersection(&[ty, record]);
        }
        ty
    }

    /// `isTypePresencePossible`
    fn is_type_presence_possible(&mut self, ty: TypeId, name: Atom, assume_true: bool) -> bool {
        if let Some((prop, _)) = self.get_property_of_type(ty, name) {
            let partial = PropFlags::READ_PARTIAL | PropFlags::WRITE_PARTIAL;
            return prop.flags.intersects(PropFlags::OPTIONAL | partial) || assume_true;
        }
        // `getApplicableIndexInfoForName`
        let is_indexed = match self.members_for_index_infos(ty) {
            Some(members) => self
                .applicable_index_info_for_name(&members, name)
                .is_some(),
            None => false,
        };
        is_indexed || !assume_true
    }

    /// `narrowTypeByCallExpression`
    fn narrow_by_call(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        call: ExprId,
        sense: bool,
    ) -> TypeId {
        if let Some(narrowed) = self.narrow_by_type_guard(reference, ty, call, sense) {
            return narrowed;
        }
        // `x.hasOwnProperty("a")` narrows `x.a` like `"a" in x`.
        let file = reference.file;
        let hir = self.hir(file);
        if let Some((&last, _)) = reference.path.split_last()
            && self.contains_missing_type(ty)
            && let ExprKind::Call(c) = hir[call].kind
            && let ExprKind::Dot { obj, name, .. } = hir[hir[c].callee].kind
            && hir[c].args.len() == 1
            && let ExprKind::String(text) = hir[hir.id_at(hir[c].args, 0)].kind
            && text == last
            && self.atoms().bytes(name) == b"hasOwnProperty"
        {
            let obj = self.reference_candidate(file, obj);
            if self.matches_prefix(reference, reference.path.len() - 1, obj) {
                return self.type_with_facts(
                    ty,
                    if sense {
                        facts::NE_UNDEFINED
                    } else {
                        facts::EQ_UNDEFINED
                    },
                );
            }
        }
        ty
    }

    /// Narrows the reference by `call` if the callee is a type guard that applies to it. `None`
    /// otherwise.
    fn narrow_by_type_guard(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        call: ExprId,
        sense: bool,
    ) -> Option<TypeId> {
        let file = reference.file;
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return None;
        };
        let data = &hir[c];
        // `x?.isFoo(y)` may be falsy because `x` is nullish.
        if !sense && data.chain != Chain::No {
            return None;
        }
        let receiver = match hir[data.callee].kind {
            ExprKind::Dot { obj, .. } => Some(obj),
            _ => None,
        };
        let mut concerned = false;
        for a in hir.ids(data.args) {
            concerned |= self.matches(reference, a) || self.optional_chain_contains(reference, a);
        }
        if let Some(r) = receiver {
            concerned |= self.matches(reference, r);
        }
        if !concerned {
            return None;
        }
        // Uses the declared type of the callee: the call is resolved only if that is needed to
        // select the type guard. It may be the call whose arguments are currently being checked.
        let callee = match hir[data.callee].kind {
            // `checkPropertyAccessExpression` of a member of the reference being narrowed: the type
            // of the object is already available here, and querying it would re-enter.
            ExprKind::Dot {
                obj,
                name,
                name_pos,
                ..
            } if self.matches(reference, obj) => {
                let receiver = self.non_nullable(ty);
                let declared = self.type_of_property(receiver, name)?;
                if self.is_any(declared) {
                    return None;
                }
                let prop = self
                    .get_property_of_type(receiver, name)
                    .map(|found| found.0);
                let right = (file, name_pos, hir[data.callee].end);
                let target = self.target_kind(file, data.callee);
                self.get_flow_type_of_access_expression(
                    file,
                    data.callee,
                    prop,
                    declared,
                    right,
                    target,
                )
            }
            // `getEffectsSignature`: `checkNonNullType(getOptionalExpressionType(..))`, which reports.
            _ => {
                let callee = self.chain_receiver(file, data.callee, data.chain).0;
                self.check_non_null_type(file, data.callee, callee)
            }
        };
        let callee = self.non_nullable(callee);
        if self.is_any(callee) {
            return None;
        }
        let sigs = self.signatures(callee, false);
        let sig = match sigs[..] {
            [only] if self.sig_type_params(only).is_empty() => only,
            _ => {
                if !sigs.iter().any(|&s| self.sig_predicate(s).is_some()) {
                    return None;
                }
                self.resolved_effects_signature(file, call)?
            }
        };
        let predicate = self.sig_predicate(sig)?;
        if predicate.asserts {
            return None;
        }
        Some(self.apply_predicate(reference, ty, predicate, data.args, receiver, sense))
    }

    fn apply_predicate(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        predicate: Predicate,
        args: IdList<ExprId>,
        receiver: Option<ExprId>,
        sense: bool,
    ) -> TypeId {
        let subject = match predicate.param {
            Some(i) => self.hir(reference.file).ids(args).nth(i),
            None => receiver,
        };
        let Some(subject) = subject else { return ty };
        match predicate.ty {
            // `narrowTypeByTypePredicate`
            Some(target) => {
                // `any` is not narrowed to exactly `Object` or `Function`.
                if self.is_any(ty)
                    && (self.is_reference_to_global(target, known::Object)
                        || self.is_reference_to_global(target, known::Function))
                {
                    return ty;
                }
                if self.matches(reference, subject) {
                    return self.narrowed_to(ty, target, sense, CheckDerived::No);
                }
                // A short-circuited chain yields `undefined`. This one completed if its result is
                // of a type that excludes `undefined`, or is not of a type that consists only of
                // `undefined` and `null`.
                let mut ty = ty;
                if self.p.files.options.strict_null_checks
                    && self.optional_chain_contains(reference, subject)
                    && if sense {
                        !self.has_type_facts(target, facts::EQ_UNDEFINED)
                    } else {
                        self.is_every_type_nullable(target)
                    }
                {
                    ty = self.adjusted_type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL);
                }
                if let Some(name) = self.discriminant_access(reference, subject, ty) {
                    return self.narrow_by_discriminant(ty, name, |c, t| {
                        c.narrowed_to(t, target, sense, CheckDerived::No)
                    });
                }
                ty
            }
            // `getTypeAtFlowCall`: `asserts x`. `asserts this` says nothing.
            None if predicate.param.is_some() => self.narrow_by_asserted(reference, ty, subject),
            None => ty,
        }
    }

    /// `narrowTypeByAssertion`: `e` is the asserted expression. Code after `assert(false)` is
    /// unreachable.
    fn narrow_by_asserted(&mut self, reference: &Reference, ty: TypeId, e: ExprId) -> TypeId {
        if self.is_stack_low() {
            return ty;
        }
        match self.hir(reference.file)[e].kind {
            ExprKind::False => TypeId::UNREACHABLE_NEVER,
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => {
                let ty = self.narrow_by_asserted(reference, ty, left);
                self.narrow_by_asserted(reference, ty, right)
            }
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => {
                let (a, b) = (
                    self.narrow_by_asserted(reference, ty, left),
                    self.narrow_by_asserted(reference, ty, right),
                );
                self.union(&[a, b])
            }
            _ if ty.is_never() => ty,
            _ => self.narrow(reference, ty, e, true),
        }
    }

    /// `isFalseExpression`
    fn is_false_expression(&self, file: FileId, e: ExprId) -> bool {
        if self.is_stack_low() {
            return false;
        }
        match self.hir(file)[e].kind {
            ExprKind::False => true,
            ExprKind::Binary {
                op: BinOp::And,
                left,
                right,
            } => self.is_false_expression(file, left) || self.is_false_expression(file, right),
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => self.is_false_expression(file, left) && self.is_false_expression(file, right),
            _ => false,
        }
    }

    /// `everyType(ty, IsNullableType)`
    fn is_every_type_nullable(&mut self, ty: TypeId) -> bool {
        !ty.is_never()
            && self
                .parts(ty)
                .iter()
                .all(|&m| self.has_type_facts(m, facts::IS_UNDEFINED | facts::IS_NULL))
    }

    // ───────────────────────────── switch ─────────────────────────────

    /// `getTypeAtSwitchClause`
    fn narrow_by_switch(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        stmt: StmtId,
        from: usize,
        to: usize,
    ) -> TypeId {
        let file = reference.file;
        let hir = self.hir(file);
        let StmtKind::Switch {
            expr: subject,
            cases,
        } = hir[stmt].kind
        else {
            return ty;
        };
        if self.matches(reference, subject) {
            return self.narrow_by_switch_values(file, ty, cases, from, to);
        }
        let strict = self.p.files.options.strict_null_checks;
        if let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = hir[subject].kind
        {
            if self.matches(reference, operand) {
                return self.narrow_by_switch_typeof(file, ty, cases, from, to);
            }
            // `typeof x?.a` is `"undefined"` if the chain short-circuits. A parenthesized chain is
            // not a chain.
            if strict
                && !is_parenthesized(hir, operand)
                && self.optional_chain_contains(reference, operand)
            {
                return self.narrow_by_switch_optional_chain_containment(file, ty, cases, from, to, |c, t| {
                    let is_undefined = matches!(
                        *c.data(t),
                        TypeData::StringLit { value, .. } | TypeData::EnumLit { value: EnumValue::String(value), .. } if value == known::undefined
                    );
                    !t.is_never() && !is_undefined
                });
            }
            return ty;
        }
        if matches!(hir[subject].kind, ExprKind::True) {
            return self.narrow_by_switch_on_true(reference, ty, cases, from, to);
        }
        let mut ty = ty;
        if strict && self.optional_chain_contains(reference, subject) {
            ty = self.narrow_by_switch_optional_chain_containment(
                file,
                ty,
                cases,
                from,
                to,
                |_, t| !t.is_undefined() && !t.is_never(),
            );
        }
        if let Some(access) = self.discriminant_access(reference, subject, ty) {
            return self
                .narrow_by_switch_on_discriminant_property(file, ty, access, cases, from, to);
        }
        ty
    }

    /// `narrowTypeBySwitchOnTrue`: `switch (true) { case test: }`
    fn narrow_by_switch_on_true(
        &mut self,
        reference: &Reference,
        ty: TypeId,
        cases: Span<CaseId>,
        from: usize,
        to: usize,
    ) -> TypeId {
        let hir = self.hir(reference.file);
        // None of the preceding case tests matched.
        let mut result = ty;
        for i in 0..from {
            let test = hir[cases.at(i)].test;
            if test.is_some() {
                result = self.narrow(reference, result, test, false);
            }
        }
        // If `default` is among the clauses, none of the following tests matched either. The
        // clauses grouped with it narrow nothing: control can arrive by other paths.
        if from == to || (from..to).any(|i| hir[cases.at(i)].test.is_none()) {
            for i in to..cases.len() {
                let test = hir[cases.at(i)].test;
                if test.is_some() {
                    result = self.narrow(reference, result, test, false);
                }
            }
            return result;
        }
        let mut entered = Vec::with_capacity(to - from);
        for i in from..to {
            entered.push(self.narrow(reference, result, hir[cases.at(i)].test, true));
        }
        self.union(&entered)
    }

    /// `narrowTypeBySwitchOptionalChainContainment`: the optional chain in the `switch` expression
    /// completed if the type of every clause in `from..to` passes `check`. The type of `default` is
    /// `never`.
    fn narrow_by_switch_optional_chain_containment(
        &mut self,
        file: FileId,
        ty: TypeId,
        cases: Span<CaseId>,
        from: usize,
        to: usize,
        check: impl Fn(&Self, TypeId) -> bool,
    ) -> TypeId {
        if from == to {
            return ty;
        }
        let hir = self.hir(file);
        for i in from..to {
            let test = hir[cases.at(i)].test;
            let clause = if test.is_none() {
                TypeId::NEVER
            } else {
                let t = self.get_type_of_expression(file, test);
                self.regular(t)
            };
            if !check(self, clause) {
                return ty;
            }
        }
        self.type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
    }

    /// `narrowTypeBySwitchOnDiscriminantProperty`
    fn narrow_by_switch_on_discriminant_property(
        &mut self,
        file: FileId,
        ty: TypeId,
        access: Access,
        cases: Span<CaseId>,
        from: usize,
        to: usize,
    ) -> TypeId {
        if from < to
            && let Some((name, constituents)) = self.key_property(ty)
            && *name == access.name
        {
            let hir = self.hir(file);
            let mut candidates = Vec::with_capacity(to - from);
            for i in from..to {
                let test = hir[cases.at(i)].test;
                // `default` maps to no member, and neither does a value shared by several members:
                // fall back to the general path.
                if test.is_none() {
                    break;
                }
                let key = self.get_type_of_expression(file, test);
                let key = self.regular(key);
                match constituents.get(&key) {
                    Some(&candidate) if candidate != TypeId::UNKNOWN => candidates.push(candidate),
                    _ => break,
                }
            }
            if candidates.len() == to - from {
                return self.union(&candidates);
            }
        }
        self.narrow_by_discriminant(ty, access, |c, t| {
            c.narrow_by_switch_values(file, t, cases, from, to)
        })
    }

    /// `narrowTypeBySwitchOnDiscriminant`
    fn narrow_by_switch_values(
        &mut self,
        file: FileId,
        ty: TypeId,
        cases: Span<CaseId>,
        from: usize,
        to: usize,
    ) -> TypeId {
        let hir = self.hir(file);
        let mut all: SmallVec<[Option<TypeId>; 8]> = SmallVec::with_capacity(cases.len());
        for c in cases.iter() {
            let test = hir[c].test;
            all.push(if test.is_none() {
                None
            } else {
                let t = self.get_type_of_expression(file, test);
                Some(self.regular(t))
            });
        }
        let has_default = from == to || all[from..to].contains(&None);
        let clause_types: SmallVec<[TypeId; 8]> = all[from..to].iter().flatten().copied().collect();
        if ty == TypeId::UNKNOWN && !has_default {
            // An object type among the cases only shows that the value is an object, not which one.
            let mut ground = Vec::with_capacity(clause_types.len());
            for &t in &clause_types {
                if self.has_primitive_flag(t) || t == TypeId::OBJECT {
                    ground.push(t);
                } else if self.is_object_type(t) {
                    ground.push(TypeId::OBJECT);
                } else {
                    return ty;
                }
            }
            return self.union(&ground);
        }
        let discriminant = self.union(&clause_types);
        let case_type = if discriminant.is_never() {
            TypeId::NEVER
        } else {
            let kept = self.filter(ty, |c, m| c.are_comparable(discriminant, m));
            self.replace_primitives_with_literals(kept, discriminant)
        };
        if !has_default {
            return case_type;
        }
        // A unit type is removed if a case may have that value: `"a"` for `case E.a`, if `E.a` has
        // that value.
        let tested: SmallVec<[TypeId; 8]> = all.iter().flatten().copied().collect();
        let default_type = self.filter(ty, |c, m| {
            if !c.is_unit_like(m) {
                return true;
            }
            let unit = if m.is_undefined() {
                TypeId::UNDEFINED
            } else {
                let unit = c.extract_unit(m);
                c.regular(unit)
            };
            !(c.is_unit(unit) && tested.contains(&unit)
                || tested
                    .iter()
                    .any(|&t| c.is_unit(t) && c.are_comparable(t, unit)))
        });
        if case_type.is_never() {
            return default_type;
        }
        self.union(&[case_type, default_type])
    }

    /// `getSwitchClauseTypeOfWitnesses`: the `typeof` name each clause tests for. `Atom::NONE` for
    /// `default`, for `""` and for a name an earlier clause has. `None`: the expression of some clause
    /// is not a string literal, or is a parenthesized one.
    fn switch_typeof_witnesses(&self, file: FileId, cases: Span<CaseId>) -> Option<Vec<Atom>> {
        let hir = self.hir(file);
        let mut witnesses = vec![Atom::NONE; cases.len()];
        for (i, c) in cases.iter().enumerate() {
            let test = hir[c].test;
            if test.is_none() {
                continue;
            }
            let ExprKind::String(name) = hir[test].kind else {
                return None;
            };
            if is_parenthesized(hir, test) {
                return None;
            }
            if name != known::empty && !witnesses.contains(&name) {
                witnesses[i] = name;
            }
        }
        Some(witnesses)
    }

    /// `narrowTypeBySwitchOnTypeOf`
    fn narrow_by_switch_typeof(
        &mut self,
        file: FileId,
        ty: TypeId,
        cases: Span<CaseId>,
        from: usize,
        to: usize,
    ) -> TypeId {
        let Some(witnesses) = self.switch_typeof_witnesses(file, cases) else {
            return ty;
        };
        let hir = self.hir(file);
        if from == to || (from..to).any(|i| hir[cases.at(i)].test.is_none()) {
            // Whatever no other clause matches.
            let not_equal = not_equal_facts_from_typeof_switch(&witnesses, from, to);
            return self.filter(ty, |c, m| c.type_facts(m, not_equal) == not_equal);
        }
        let mut entered = Vec::with_capacity(to - from);
        for &name in &witnesses[from..to] {
            if name.is_some() {
                entered.push(self.narrow_type_by_typeof_name(ty, name, true));
            }
        }
        self.union(&entered)
    }

    // ───────────────────────────── walking back ─────────────────────────────

    /// `isGenericTypeWithUnionConstraint`: a generic type, including a template literal type, whose
    /// constraint is a union, `undefined` or `null`.
    fn is_generic_with_union_constraint(&mut self, ty: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(ty) {
            return parts
                .iter()
                .any(|&p| self.is_generic_with_union_constraint(p));
        }
        if !self.is_instantiable(ty) {
            return false;
        }
        let constraint = self.base_constraint(ty);
        self.is_union(constraint) || constraint.is_undefined() || constraint.is_null()
    }

    /// `isGenericTypeWithoutNullableConstraint`
    fn is_generic_without_nullable_constraint(&mut self, ty: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(ty) {
            return parts
                .iter()
                .any(|&p| self.is_generic_without_nullable_constraint(p));
        }
        if !self.is_instantiable(ty) {
            return false;
        }
        let constraint = self.base_constraint(ty);
        !self.maybe_type_of_kind(constraint, |_, m| m.is_undefined() || m.is_null())
    }

    /// Whether `e` is in a position where the constraint of its type is what matters: `e.x`,
    /// `e[x]`, `e()`, `new e()`.
    fn is_constraint_position(&mut self, file: FileId, e: ExprId, ty: TypeId) -> bool {
        let hir = self.hir(file);
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Dot { obj, .. } => obj == e,
            ExprKind::Call(c) | ExprKind::New(c) => hir[c].callee == e,
            // `t[k]` with `t` of type `T` and `k` of type `K` must have type `T[K]`.
            ExprKind::Index { obj, index, .. } if obj == e => {
                if !self
                    .parts(ty)
                    .iter()
                    .any(|&m| self.is_generic_without_nullable_constraint(m))
                {
                    return true;
                }
                let index = self.get_type_of_expression(file, index);
                !self.is_generic(index)
            }
            _ => false,
        }
    }

    /// `getNarrowableTypeForReference`
    fn get_narrowable_type_for_reference(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let declared = match *self.data(declared) {
            TypeData::Substitution {
                base,
                constraint: TypeId::UNKNOWN,
            } => base,
            _ => declared,
        };
        if check_mode.contains(CheckMode::INFERENTIAL)
            || !self.has_type_variables(declared)
            || !self
                .parts(declared)
                .iter()
                .any(|&m| self.is_generic_with_union_constraint(m))
        {
            return declared;
        }
        if !self.is_constraint_position(file, e, declared) {
            // `hasContextualTypeWithNoGenericTypes`
            let context_flags = if check_mode.contains(CheckMode::REST_BINDING_ELEMENT) {
                ContextFlags::SKIP_BINDING_PATTERNS
            } else {
                ContextFlags::empty()
            };
            match self.contextual_type(file, e, context_flags) {
                Some(expected) if !self.is_generic(expected) => {}
                _ => return declared,
            }
        }
        // `getBaseConstraintOrType`
        self.map_type(declared, |c, m| {
            let constraint = c.base_constraint(m);
            if constraint == TypeId::UNKNOWN && !c.has_unknown_base_constraint(m, 0) {
                m
            } else {
                constraint
            }
        })
    }

    /// The end of `checkIdentifier`, from `getNarrowableTypeForReference` on: 7034 7005, 2454.
    /// `sym`: the symbol `e` resolves to.
    pub(super) fn narrow_reference(
        &mut self,
        file: FileId,
        e: ExprId,
        sym: Sym,
        declared: TypeId,
    ) -> TypeId {
        if declared == TypeId::UNRESOLVED {
            return declared;
        }
        let declared = self.get_narrowable_type_for_reference(file, e, declared, self.check_mode());
        let ty = self.flow_type_of(file, e, declared, Start::Unsettled);
        let hir = self.hir(file);
        if self.is_automatic_type(declared) && !self.is_evolving_array_operation_target(file, e) {
            // These types only occur under `noImplicitAny`. `checkWithStatement` does not check the
            // body.
            if self.is_automatic_type(ty) && !hir.is_in_with(hir[e].pos) {
                let args = [Arg::Sym(sym), Arg::Type(ty)];
                if let Some(name) = self.place_of_symbol(sym) {
                    self.error_at(name, 7034, &args);
                }
                self.error_at(self.place_of_token(file, hir[e].pos), 7005, &args);
            }
            return self.convert_auto_to_any(ty);
        }
        if ty != declared
            && self.contains_undefined(ty)
            && !self.contains_undefined(declared)
            && !self.assumes_initialized(file, e, declared)
        {
            self.error_at(
                self.place_of_token(file, hir[e].pos),
                2454,
                &[Arg::Sym(sym)],
            );
            // "Return the declared type to reduce follow-on errors"
            return declared;
        }
        ty
    }

    /// `getFlowTypeOfReference` of a `this` expression (`tryGetThisTypeAtEx`).
    pub(super) fn narrow_this(&mut self, file: FileId, e: ExprId, declared: TypeId) -> TypeId {
        if declared == TypeId::UNRESOLVED || declared.is_never() {
            return declared;
        }
        self.flow_type_of(file, e, declared, Start::Known)
    }

    /// `getFlowTypeOfAccessExpression`, except for a property whose type is `autoType`. `prop`:
    /// absent for an access resolved through an index signature.
    /// `error_node`: the name or the index. `target`: the `target_kind` of `e`.
    pub(super) fn get_flow_type_of_access_expression(
        &mut self,
        file: FileId,
        e: ExprId,
        prop: Option<&Prop>,
        prop_type: TypeId,
        error_node: Place,
        target: TargetKind,
    ) -> TypeId {
        if target.definite {
            let is_optional = prop.is_some_and(|prop| prop.flags.contains(PropFlags::OPTIONAL));
            return self.remove_missing_type(prop_type, is_optional);
        }
        if let Some(prop) = prop
            && !self.is_variable_property_or_accessor(prop)
            && !(prop.flags.contains(PropFlags::METHOD) && self.is_union(prop_type))
        {
            return prop_type;
        }
        if prop_type == TypeId::UNRESOLVED {
            return prop_type;
        }
        let prop_type =
            self.get_narrowable_type_for_reference(file, e, prop_type, self.check_mode());
        let uninitialized = prop.filter(|prop| self.assumes_uninitialized(file, e, prop));
        let start = match uninitialized {
            Some(_) => Start::Unassigned,
            None => Start::Known,
        };
        let flow_type = self.flow_type_of(file, e, prop_type, start);
        if let Some(prop) = uninitialized
            && !self.contains_undefined(prop_type)
            && self.contains_undefined(flow_type)
        {
            let name = self.prop_to_string(prop);
            self.error_at(error_node, 2565, &[Arg::Bytes(&name)]);
            // "Return the declared type to reduce follow-on errors"
            return prop_type;
        }
        if target.written {
            self.base_of_literal(flow_type)
        } else {
            flow_type
        }
    }

    /// `prop.Flags&(SymbolFlagsVariable|SymbolFlagsProperty|SymbolFlagsAccessor) != 0`
    pub(super) fn is_variable_property_or_accessor(&self, prop: &Prop) -> bool {
        let symbol = match &prop.source {
            PropSource::Symbol(sym) => Some(*sym),
            // The symbol itself (`getSpreadSymbol`), or one with its flags (`createSymbolWithType`).
            // So `{ ...namespace }` has the alias that `export { a as b }` declares, which is none
            // of the three. A recreated symbol is a property, even if the original is not.
            PropSource::Copy(_, parts, true) => match &parts[..] {
                [only] => match only.source {
                    PropSource::Symbol(sym) => Some(sym),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        match symbol {
            Some(sym) => {
                let flags = self.files().flags(sym);
                flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY | SymFlags::ACCESSOR)
            }
            None => !prop.flags.contains(PropFlags::METHOD),
        }
    }

    /// `assumeUninitialized` of `getFlowTypeOfAccessExpression`, for the access `e` to `prop`.
    fn assumes_uninitialized(&self, file: FileId, e: ExprId, prop: &Prop) -> bool {
        let options = &self.p.files.options;
        if !options.strict_null_checks {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Every property access reaches this point. `prop.ValueDeclaration` matters for `this.x`
        // and for a property declared by an assignment.
        let by_assignment = SymFlags::ASSIGNMENT | SymFlags::FUNCTION_SCOPED_VARIABLE;
        if !matches!(hir[e].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }
                if matches!(hir[obj].kind, ExprKind::This))
            && !matches!(Self::value_declaration(prop), Some(&PropSource::Symbol(sym))
                if self.files().flags(sym).intersects(by_assignment))
        {
            return false;
        }
        let container_of =
            |x: ExprId| self.get_control_flow_container(file, bound.expr_parent[x.idx()]);
        // `prop.ValueDeclaration`, if it is an assignment.
        let (of, assignment) = match self.value_declaration_of_prop(prop) {
            Some((of, Decl::Member(m))) => {
                let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[e].kind else {
                    return false;
                };
                let MemberOwner::Class(class) = self.bound(of).member_owner[m.idx()] else {
                    return false;
                };
                let member = &self.hir(of)[m];
                return options.strict_property_initialization
                    && of == file
                    // `IsAccessExpression`: `typeof this.x` in a type is a qualified name.
                    && !bound.is_in_type_query(e)
                    && matches!(hir[obj].kind, ExprKind::This)
                    && !is_parenthesized(hir, obj)
                    // `isPropertyWithoutInitializer`
                    && member.kind == MemberKind::Property
                    && member.init.is_none()
                    && !member.flags.intersects(
                        Flags::ABSTRACT | Flags::DEFINITE | Flags::STATIC | Flags::AMBIENT,
                    )
                    && !hir[class].flags.contains(Flags::AMBIENT)
                    && matches!(container_of(e), Container::Fn(f)
                        if hir[f].kind == FnKind::Constructor
                            && matches!(bound.fns[f.idx()].owner, FnOwner::Member(constructor)
                                if bound.member_owner[constructor.idx()] == MemberOwner::Class(class)));
            }
            // `exports.name = value` declares a variable. An alias declaration is not a value
            // declaration; `Object.defineProperty(exports, "name", descriptor)` is one.
            Some((
                of,
                Decl::Expando(first) | Decl::ThisProperty(first) | Decl::ExportsProperty(first),
            )) => (of, first),
            _ => return false,
        };
        of == file
            // The left side of `f[key] = value` is not a property access.
            && matches!(hir[assignment].kind, ExprKind::Assign { target, .. }
                if matches!(hir[target].kind, ExprKind::Dot { .. }))
            && container_of(e) == container_of(assignment)
    }

    /// The type of `e`, the initializer of a variable declared by a binding pattern without a type
    /// annotation, for the `...rest` of the pattern (`CheckModeRestBindingElement`). `None`: the
    /// same type the other elements see.
    pub(super) fn type_of_reference_for_rest(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let Parent::VarInit(d) = self.bound(file).expr_parent[e.idx()] else {
            return None;
        };
        if self.hir(file)[d].ty.is_some() {
            return None;
        }
        // A type parameter can only be preserved where one is in scope.
        let scope = self.enclosing_scope_of_expr(file, e);
        if !self
            .type_params_in_scope(file, scope)
            .iter()
            .any(|&p| matches!(self.data(p), TypeData::TypeParam(..)))
        {
            return None;
        }
        let ordinary = self.type_of_expr(file, e);
        if self.is_any(ordinary) {
            return None;
        }
        let ty = self.check_expression_cached_ex(file, e, CheckMode::REST_BINDING_ELEMENT);
        (ty != ordinary).then_some(ty)
    }

    /// Whether `e` is the `x` of `x!`. Not of `(x)!`: only the direct syntactic parent counts.
    fn is_operand_of_non_null(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(self.bound(file).expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::NonNull(_)))
            && !is_parenthesized(hir, e)
    }

    /// `parameterInitializerContainsUndefined`
    fn parameter_initializer_contains_undefined(
        &mut self,
        file: FileId,
        p: ParamId,
        pat: PatId,
    ) -> bool {
        // `NodeCheckFlagsInitializerIsUndefinedComputed`
        if let Some(cached) = self.p.initializer_is_undefined.get(&self.task, &(file, p)) {
            return cached;
        }
        let q = Query::InitializerIsUndefined(file, p);
        if let Some(raw) = self.provisional(q) {
            return raw != 0;
        }
        if !self.enter(q) {
            return true;
        }
        let default = self.type_of_expr(file, self.hir(file)[p].default);
        // `any` does not have the fact. An `UNRESOLVED` type might.
        let contains =
            default == TypeId::UNRESOLVED || self.has_type_facts(default, facts::IS_UNDEFINED);
        let left = self.leave(q);
        if self.left_a_cycle {
            let stored = self.cycle_result();
            (self.p.circular_initializers).insert(&self.task, (file, pat), (), stored);
            self.report_circularity_error_of_pat(q, file, pat);
            return true;
        }
        match left {
            Ok(stored) => {
                (self.p.initializer_is_undefined).insert(&self.task, (file, p), contains, stored);
            }
            Err(open) => self.cache_provisionally(q, u64::from(contains), open),
        }
        contains
    }

    /// `FindAncestor(e, IsFunctionOrModuleBlock)`
    pub(super) fn function_or_module_block_of(&self, file: FileId, e: ExprId) -> Node {
        let hir = self.hir(file);
        hir.find_ancestor(hir.node(e), |n| match hir.kind(n) {
            Kind::SourceFile | Kind::ModuleBlock => true,
            Kind::Block => hir.kind(hir.parent(n)).is_function_like(),
            _ => false,
        })
    }

    /// `if c.flowAnalysisDisabled { return c.errorType }`, applied for the writer only: during
    /// checking the result would depend on evaluation order.
    fn is_flow_analysis_disabled(&self, file: FileId) -> bool {
        self.flow_analysis_disabled_in == Some(file) && self.is_rechecking()
    }

    /// `c.flowAnalysisDisabled = true`. No `checkBlock` is in progress to reset it while a node is
    /// rechecked.
    fn disable_flow_analysis(&mut self, file: FileId) {
        if self.is_rechecking() {
            self.flow_analysis_disabled_in = Some(file);
        }
    }

    /// Not in tsgo. The symbols of `file` that some node of its flow graph refers to: a condition
    /// (`note_test`, as for `is_test_about`), a `switch`, an assignment target, the expression of a
    /// `for in`. Nothing else can change the type of a reference rooted at a name, except an
    /// assertion call: see `FlowMemo::in_call_statements`. Empty: some backward path through the
    /// graph may take `MAX_FLOW_DEPTH` invocations, and the walk that detects that reports it.
    #[inline(never)]
    fn index_narrowing_subjects(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let words = bound.symbols.len() / 64 + 1;
        let mut first_nodes = vec![u32::MAX; bound.symbols.len()];
        let mut last_call_statement = vec![u32::MAX; bound.symbols.len()];
        let mut declaration_node = vec![u32::MAX; bound.symbols.len()];
        let mut mentioned_in_calls = vec![0u64; words];
        let mut call_statements_by_symbol = Vec::new();
        let mut lengths = vec![0u32; bound.flow.len()];
        let mut highest = vec![0u32; bound.flow.len()];
        let mut longest = 0;
        for (i, &node) in bound.flow.iter().enumerate() {
            let about = &mut FirstNarrowingNodes(&mut first_nodes, i as u32);
            // Its antecedents: a range of edges, or a single node.
            let before = match node {
                Flow::Unreachable => &[][..],
                Flow::Label { start, len } | Flow::Loop { start, len } => bound.edges(start, len),
                Flow::Start {
                    outer: ref before, ..
                }
                | Flow::StartInvoked {
                    outer: ref before, ..
                }
                | Flow::Reduce { ref before, .. }
                | Flow::ArrayMutation { ref before, .. }
                | Flow::Cond { ref before, .. }
                | Flow::Switch { ref before, .. }
                | Flow::Assign { ref before, .. }
                | Flow::Call { ref before, .. } => std::slice::from_ref(before),
            };
            // The start of a function and a declaration, other than that of a `for in`, add no
            // invocation of `getTypeAtFlowNode`: its loop goes on to the antecedent.
            let invocations = match node {
                Flow::Start { .. } | Flow::StartInvoked { .. } => 0,
                Flow::Assign {
                    target: FlowTarget::Pat(_),
                    ..
                } => 0,
                Flow::Assign {
                    target: FlowTarget::Var(d),
                    ..
                } => {
                    let stmt = bound.var_stmt[d.idx()];
                    let is_of_for_in = stmt.is_some()
                        && matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(owner)
                            if matches!(hir[owner].kind, StmtKind::ForIn { .. }));
                    u32::from(is_of_for_in)
                }
                _ => 1,
            };
            (highest[i], lengths[i]) = (i as u32, 1);
            for before in before.iter().filter(|before| before.is_some()) {
                highest[i] = highest[i].max(before.0).max(highest[before.idx()]);
                // 0 for the back edge of a loop, which has a higher number.
                lengths[i] = lengths[i].max(lengths[before.idx()] + invocations);
            }
            longest = longest.max(lengths[i]);
            match node {
                Flow::Cond { expr, .. } => self.note_test(file, expr, 0, about),
                Flow::Switch { stmt, .. } => {
                    if let StmtKind::Switch { expr, cases } = hir[stmt].kind {
                        // `switch (x)`, `switch (x.kind)`, `switch (typeof x)`, and `switch (true) { case test: }`
                        self.note_test(file, expr, 0, about);
                        if let ExprKind::Unary { operand, .. } = hir[expr].kind {
                            self.note_test(file, operand, 0, about);
                        }
                        for case in cases.iter() {
                            if hir[case].test.is_some() {
                                self.note_test(file, hir[case].test, 0, about);
                            }
                        }
                    }
                }
                Flow::Assign { target, .. } => match target {
                    FlowTarget::Expr(e) => self.note_chain(file, e, false, About::ALONE, about),
                    FlowTarget::Var(d) => {
                        if let Some(at) =
                            declaration_node.get_mut(bound.pat_symbol[hir[d].pat.idx()].idx())
                        {
                            *at = i as u32;
                        }
                        let stmt = bound.var_stmt[d.idx()];
                        if stmt.is_some()
                            && let Parent::Stmt(owner) = bound.stmt_parent[stmt.idx()]
                            && let StmtKind::ForIn { left, expr, .. } = hir[owner].kind
                            && left == stmt
                        {
                            self.note_chain(file, expr, false, About::ALONE, about);
                        }
                    }
                    FlowTarget::Pat(p) => {
                        if let Some(at) = declaration_node.get_mut(bound.pat_symbol[p.idx()].idx())
                        {
                            *at = i as u32;
                        }
                    }
                },
                // `asserts x`: the argument is a condition. `asserts x is T`, `asserts this`: an
                // argument, the receiver.
                Flow::Call { call, .. } => {
                    if let ExprKind::Call(c) = hir[call].kind {
                        let about = &mut CallStatementSubjects(
                            &mut last_call_statement,
                            i as u32,
                            &mut call_statements_by_symbol,
                        );
                        self.note_test(file, call, 0, about);
                        for argument in hir.ids(hir[c].args) {
                            self.note_test(file, argument, 0, about);
                        }
                    }
                }
                _ => {}
            }
        }
        if longest >= MAX_FLOW_DEPTH {
            first_nodes.clear();
        }
        for &(symbol, _) in &call_statements_by_symbol {
            mentioned_in_calls[symbol.idx() / 64] |= 1 << (symbol.idx() % 64);
        }
        call_statements_by_symbol.sort_unstable_by_key(|&(symbol, flow)| (symbol.0, flow.0));
        let memo = &mut self.flow_memo;
        memo.narrowing_index_file = Some(file);
        (
            memo.first_narrowing_node,
            memo.in_call_statements,
            memo.call_statements_by_symbol,
        ) = (first_nodes, mentioned_in_calls, call_statements_by_symbol);
        (memo.max_antecedent, memo.declaration_node) = (highest, declaration_node);
    }

    /// Whether every call statement that mentions `s` and has a number up to `highest` has already
    /// been found by a walk to have no effect. None is resolved here: that may re-enter the
    /// computation in progress, and tsgo resolves it when a walk reaches it.
    #[inline(never)]
    fn are_call_statements_idle(&mut self, file: FileId, s: SymbolId, highest: u32) -> bool {
        let memo = &self.flow_memo;
        let from = memo
            .call_statements_by_symbol
            .partition_point(|about| about.0.0 < s.0);
        let calls = memo.call_statements_by_symbol[from..]
            .iter()
            .take_while(|about| about.0 == s);
        let mut is_all = true;
        for &(_, flow) in calls {
            if !memo.is_idle_call(file, flow) {
                if flow.0 <= highest {
                    return false;
                }
                is_all = false;
            }
        }
        if is_all {
            self.flow_memo.in_call_statements[s.idx() / 64] &= !(1 << (s.idx() % 64));
        }
        true
    }

    /// Not in tsgo. Whether `getFlowTypeOfReference` can only return `declared` for `reference`,
    /// the expression `e`: see `index_narrowing_subjects`.
    fn is_never_narrowed(
        &mut self,
        reference: &Reference,
        e: ExprId,
        declared: TypeId,
        start: Start,
    ) -> bool {
        let (Root::Symbol(s), file) = (reference.root, reference.file) else {
            return false;
        };
        if self.task.file != Some(file) || self.is_automatic_type(declared) {
            return false;
        }
        if self.flow_memo.narrowing_index_file != Some(file) {
            self.index_narrowing_subjects(file);
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let memo = &self.flow_memo;
        let Some(&first_about) = memo.first_narrowing_node.get(s.idx()) else {
            return false;
        };
        let symbol = &bound.symbols[s.idx()];
        // `let`, `const` or `using` with an initializer, in a statement list, and `e` comes after
        // it: every backward path from `e` reaches the declaration. (Not in a `case`, nor `if (a)
        // const b = 1`, which is an error but parses.)
        let is_dominated_by_declaration = match symbol.decls[..] {
            [Decl::Var(_)] => match self.root_declaration(file, s) {
                PatParent::Var(d) => {
                    let stmt = bound.var_stmt[d.idx()];
                    hir[d].kind != VarKind::Var
                        && hir[d].init.is_some()
                        && e.0 > hir[d].init.0
                        && stmt.is_some()
                        && match bound.stmt_parent[stmt.idx()] {
                            Parent::Stmt(owner) => matches!(hir[owner].kind, StmtKind::Block(_)),
                            Parent::FnBody(_) | Parent::File | Parent::Module(_) => true,
                            _ => false,
                        }
                }
                _ => false,
            },
            _ => false,
        };
        // No node with a higher number is on a relevant backward path from here. A walk that ends
        // at the declaration follows the back edge of a loop only if the loop is inside the scope
        // that contains the declaration.
        let flow = bound.expr_flow[e.idx()];
        let mut highest = memo.max_antecedent[flow.idx()];
        if is_dominated_by_declaration
            && let Some(&around) = memo
                .max_antecedent
                .get(memo.declaration_node[s.idx()] as usize)
            && highest <= around.max(flow.0)
        {
            highest = flow.0;
        }
        if first_about <= highest {
            return false;
        }
        // A redeclaration of the name on the backward path leaves `a.b` at its declared type.
        let is_plain = if !reference.path.is_empty() {
            start == Start::Known
        } else if symbol.flags.contains(SymFlags::ASSIGNED) {
            false
        } else if memo.declaration_node[s.idx()] == u32::MAX
            && matches!(symbol.decls[..], [Decl::Var(_)])
        {
            // `declare const x: T`: no node declares it. Every path ends at a start, with
            // `initialType`.
            start == Start::Known
                || start == Start::Unsettled && self.assumes_initialized(file, e, declared)
        } else if self.is_union(declared) {
            false
        } else {
            match symbol.decls[..] {
                // `isAlias`: assumed to be initialized at the start of the file.
                [
                    Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_),
                ] => true,
                [Decl::Param(pat)] => {
                    matches!(bound.pat_parent[pat.idx()], PatParent::Param(p) if hir[p].default.is_none())
                }
                _ => is_dominated_by_declaration,
            }
        };
        is_plain
            && (self.flow_memo.in_call_statements[s.idx() / 64] & 1 << (s.idx() % 64) == 0
                || self.are_call_statements_idle(file, s, highest))
    }

    /// `start`: `initialType`. `Known`: `declared`.
    fn flow_type_of(&mut self, file: FileId, e: ExprId, declared: TypeId, start: Start) -> TypeId {
        if self.is_flow_analysis_disabled(file) {
            return TypeId::ERROR;
        }
        let bound = self.bound(file);
        let flow = bound.expr_flow[e.idx()];
        // `getTypeAtFlowNode`: an unreachable flow node has `convertAutoToAny(declaredType)`.
        if flow == UNREACHABLE {
            return self.convert_auto_to_any(declared);
        }
        let Some(reference) = self.reference_of(file, e) else {
            return declared;
        };
        if self.is_never_narrowed(&reference, e, declared, start) {
            return declared;
        }
        let is_automatic = self.is_automatic_type(declared);
        // Only `[]` was ever assigned to it: where elements are added it is an array of any element
        // type, whatever its element type is by then. Skipping the walk avoids resolving the type
        // of the added element while its contextual type is being computed.
        if declared == self.auto_array_type
            && let Root::Symbol(s) = reference.root
            && !bound.symbols[s.idx()].flags.contains(SymFlags::ASSIGNED)
            && bound.symbols[s.idx()].decls.len() == 1
            && self.is_evolving_array_operation_target(file, e)
        {
            if self.is_flow_too_deep(&reference, flow) {
                self.disable_flow_analysis(file);
                // `reportFlowControlError`
                (self.p.flows_too_deep).insert(&self.task, (file, e), (), Stored::new());
                return TypeId::ERROR;
            }
            return declared;
        }
        let crossing = if !reference.path.is_empty() {
            // `getTypeAtFlowNode` stops at the start of a function for a property or element access
            // expression. `a.b` in `typeof a.b` is a qualified name, and continues.
            if bound.is_in_type_query(e) {
                Crossing::Yes
            } else {
                Crossing::No
            }
        } else {
            match reference.root {
                Root::Symbol(s) => {
                    let flags = bound.symbols[s.idx()].flags;
                    if flags.contains(SymFlags::CONST) && declared != self.auto_array_type {
                        Crossing::UpToDeclaration(s, e)
                    } else if flags.intersects(SymFlags::VARIABLE) {
                        Crossing::PastLastAssignment(s, e)
                    } else {
                        Crossing::No
                    }
                }
                Root::Global(_)
                | Root::This
                | Root::Super
                | Root::ImportMeta
                | Root::NewTarget
                | Root::Pattern(_)
                | Root::Params(_) => Crossing::No,
            }
        };
        let mut initial = declared;
        // `removeOptionalityFromDeclaredType`: `(x: T | undefined = d)` starts without `undefined`.
        if self.p.files.options.strict_null_checks
            && reference.path.is_empty()
            && let Root::Symbol(s) = reference.root
            && bound.symbols[s.idx()].flags.contains(SymFlags::PARAMETER)
            && let &[Decl::Param(pat)] = &bound.symbols[s.idx()].decls[..]
            && let PatParent::Param(p) = bound.pat_parent[pat.idx()]
            && self.hir(file)[p].default.is_some()
            && self.has_type_facts(declared, facts::IS_UNDEFINED)
            && !self.parameter_initializer_contains_undefined(file, p, pat)
        {
            initial = self.type_with_facts(declared, facts::NE_UNDEFINED);
        }
        let mut walk = Walk::new(reference, declared, initial, false);
        walk.crossing = crossing;
        // `isAutomaticTypeInNonNull`
        if start == Start::Unassigned || is_automatic && self.is_operand_of_non_null(file, e) {
            self.start_unassigned(&mut walk);
        } else {
            walk.start = start;
        }
        let ty = self.get_flow_type_of_reference(walk, flow);
        // `checkIdentifier`, `isAutomaticTypeInNonNull`
        if is_automatic && self.is_operand_of_non_null(file, e) {
            return self.non_nullable(ty);
        }
        ty
    }

    /// `getFlowTypeOfReferenceEx`, once the `FlowState` is set up.
    fn get_flow_type_of_reference(&mut self, mut walk: Walk, flow: FlowId) -> TypeId {
        let (file, e, declared) = (walk.reference.file, walk.reference.at, walk.declared);
        if self.is_flow_analysis_disabled(file) {
            return TypeId::ERROR;
        }
        self.flow_invocation_count += 1;
        let outer = std::mem::replace(&mut self.walk_declared, declared);
        let evolved = self.flow_type(&mut walk, flow).ty;
        self.walk_declared = outer;
        // errorType, and `reportFlowControlError`
        if walk.too_deep {
            self.disable_flow_analysis(file);
            if e.is_some() {
                (self.p.flows_too_deep).insert(&self.task, (file, e), (), Stored::new());
            }
            return TypeId::ERROR;
        }
        if walk.steps >= MAX_STEPS {
            return declared;
        }
        // An operation that adds elements to an evolving array sees `autoArrayType`, whatever its
        // element type is by then.
        let result = if matches!(self.data(evolved), TypeData::EvolvingArray(_))
            && e.is_some()
            && self.is_evolving_array_operation_target(file, e)
        {
            self.auto_array_type
        } else {
            self.finalize_evolving_array(evolved)
        };
        // `x!` where `x` has been narrowed to only the types that `!` removes.
        if result == TypeId::UNREACHABLE_NEVER
            || e.is_some()
                && !result.is_never()
                && self.is_operand_of_non_null(file, e)
                && self
                    .type_with_facts(result, facts::NE_UNDEFINED_OR_NULL)
                    .is_never()
        {
            return declared;
        }
        result
    }

    /// `getFlowTypeOfDestructuring` for a binding pattern element. `const { a } = o.p`: `a` has the
    /// narrowed type of `o.p.a` at that point.
    pub(super) fn narrow_destructured(
        &mut self,
        file: FileId,
        pat: PatId,
        declared: TypeId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Innermost first.
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut at = pat;
        let init = loop {
            let name = match bound.pat_parent[at.idx()] {
                PatParent::Prop(parent, p) if !hir[p].is_rest => {
                    at = parent;
                    self.member_name(file, hir[p].key)
                }
                PatParent::Elem(parent, e) if !hir[e].is_rest => {
                    let PatKind::Array(elems) = hir[parent].kind else {
                        return declared;
                    };
                    at = parent;
                    Some(self.number_name((e.0 - elems.start) as f64))
                }
                PatParent::Var(d) => break hir[d].init,
                _ => return declared,
            };
            let Some(name) = name else { return declared };
            names.push(name);
        };
        self.narrow_path_of(file, init, &names, declared)
    }

    /// `getFlowTypeOfDestructuring` for `e`, an element of an array literal or a property value of
    /// an object literal that is an assignment target, including its default. `({ a } = o.p)`: `a`
    /// is assigned the narrowed type of `o.p.a` at that point.
    pub(super) fn narrow_destructured_assignment(
        &mut self,
        file: FileId,
        e: ExprId,
        declared: TypeId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Innermost first.
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut at = e;
        // `getParentElementAccess`. It uses the direct syntactic parent of a literal: a
        // parenthesized literal has no parent it recognizes.
        let init = loop {
            if !names.is_empty() && is_parenthesized(hir, at) {
                return declared;
            }
            let name = match bound.expr_parent[at.idx()] {
                Parent::Prop(p) if hir[p].kind != PropKind::Spread => {
                    at = bound.prop_owner[p.idx()];
                    self.member_name(file, hir[p].key)
                }
                Parent::Expr(x) => match hir[x].kind {
                    ExprKind::Array(items) => {
                        let Some(index) = hir.ids(items).position(|item| item == at) else {
                            return declared;
                        };
                        at = x;
                        Some(self.number_name(index as f64))
                    }
                    // The outermost literal: the right-hand side of its assignment, which may be
                    // the default of an element.
                    ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    } if !names.is_empty() && target == at => break value,
                    _ => return declared,
                },
                _ => return declared,
            };
            let Some(name) = name else { return declared };
            names.push(name);
        };
        self.narrow_path_of(file, init, &names, declared)
    }

    /// `getSyntheticElementAccess`, and `getFlowTypeOfReference` of it: the narrowed type of
    /// `init.a.b`, declared as `declared`, at the position of `init`. `names`: `b`, `a`, innermost
    /// first.
    fn narrow_path_of(
        &mut self,
        file: FileId,
        init: ExprId,
        names: &[Atom],
        declared: TypeId,
    ) -> TypeId {
        // A parenthesized expression has no flow node, and neither does a call or a comma
        // expression.
        if init.is_none()
            || is_parenthesized(self.hir(file), init)
            || declared == TypeId::UNRESOLVED
        {
            return declared;
        }
        // `getLiteralPropertyNameText`: a string or a number, not a symbol.
        if names.iter().any(|&name| self.atoms().is_symbol_name(name)) {
            return declared;
        }
        let flow = self.bound(file).expr_flow[init.idx()];
        if flow.is_none() {
            return declared;
        }
        let Some(mut reference) = self.reference_of(file, init) else {
            return declared;
        };
        reference.path.extend(names.iter().rev().copied());
        // It does not occur in the source.
        reference.at = ExprId::NONE;
        let walk = Walk::new(reference, declared, declared, false);
        self.get_flow_type_of_reference(walk, flow)
    }

    /// Whether `this.name`, declared as `declared`, has been assigned by the end of the constructor
    /// `func`.
    pub(super) fn is_assigned_in_constructor(
        &mut self,
        file: FileId,
        func: FnId,
        name: Atom,
        declared: TypeId,
    ) -> bool {
        let exit = self.bound(file).fns[func.idx()].exit;
        if exit.is_none() {
            return false;
        }
        if exit == UNREACHABLE {
            return true;
        }
        let initial = self.optional(declared);
        let reference = Reference {
            file,
            root: Root::This,
            path: smallvec![name],
            at: ExprId::NONE,
            has_key: true,
        };
        let walk = Walk::new(reference, declared, initial, false);
        let ty = self.get_flow_type_of_reference(walk, exit);
        !self.contains_undefined(ty)
    }

    /// `getFlowTypeInConstructor`, and one iteration of the loop of `getFlowTypeInStaticBlocks`:
    /// the type assigned to the property `name`, which declares no type, by the end of the
    /// constructor or static block `func`. `None` if that gives no usable type. `initial`: the type
    /// `getFlowTypeOfProperty` starts from, the type of the property in the base class, else
    /// `undefined`.
    /// `value_declaration`: `symbol.ValueDeclaration`.
    pub(super) fn flow_type_in_constructor_from(
        &mut self,
        file: FileId,
        func: FnId,
        name: Atom,
        initial: TypeId,
        value_declaration: UntypedProperty,
    ) -> Option<TypeId> {
        let exit = self.bound(file).fns[func.idx()].exit;
        if exit.is_none() {
            return None;
        }
        let reference = Reference {
            file,
            root: Root::This,
            path: smallvec![name],
            at: ExprId::NONE,
            has_key: true,
        };
        let walk = Walk::new(reference, TypeId::AUTO, initial, false);
        let ty = self.get_flow_type_of_reference(walk, exit);
        if self.p.files.options.no_implicit_any && self.is_automatic_type(ty) {
            let at = self.place_of_untyped_property(file, value_declaration);
            // `symbolToString`
            let written = match value_declaration {
                UntypedProperty::Member(_) => self.source_text(file, at.1, at.2),
                UntypedProperty::Assignment(_) => self.atom_text(name),
            };
            self.error_at(at, 7008, &[Arg::Bytes(&written), Arg::Type(ty)]);
        }
        if self.is_every_type_nullable(ty) {
            return None;
        }
        Some(self.convert_auto_to_any(ty))
    }

    /// `getFlowTypeOfProperty`: the flow type of `e`, an access to a property whose declared type
    /// is `autoType` in the constructor enclosing `e`. `initial`: the type of the property in the
    /// base class, else `undefined`.
    pub(super) fn flow_type_of_property(
        &mut self,
        file: FileId,
        e: ExprId,
        initial: TypeId,
    ) -> TypeId {
        let flow = self.bound(file).expr_flow[e.idx()];
        let Some(reference) = self.reference_of(file, e) else {
            return TypeId::AUTO;
        };
        let walk = Walk::new(reference, TypeId::AUTO, initial, false);
        self.get_flow_type_of_reference(walk, flow)
    }

    /// `array_literal_types_in` for the identifier `e`. `getTypeAtFlowAssignment`: a reference to a variable of `autoType` has the
    /// type of the value assigned to it, with its `ObjectFlagsArrayLiteral`. The control flow analysis is repeated to find the values.
    pub(super) fn array_literal_types_in_automatic_variable(
        &mut self,
        file: FileId,
        e: ExprId,
        all: &mut Vec<TypeId>,
    ) -> SmallVec<[TypeId; 2]> {
        // Not through a second variable: in a loop two of them can be assigned to each other.
        if self.automatic_assignments.is_some() {
            return SmallVec::new();
        }
        let symbol = self.bound(file).expr_symbol[e.idx()];
        let declared = self.type_of_symbol(self.files().sym(file, symbol));
        if !self.is_automatic_type(declared) {
            return SmallVec::new();
        }
        self.automatic_assignments = Some(((file, e), Vec::new()));
        self.flow_type_of(file, e, declared, Start::Unsettled);
        let assignments = match &mut self.automatic_assignments {
            Some((_, assignments)) => std::mem::take(assignments),
            None => Vec::new(),
        };
        let (mut of_values, mut found) = (Vec::new(), SmallVec::<[TypeId; 2]>::new());
        // Assigned on another path without the flag. The union of the two is not the type of an array literal.
        let mut regular = SmallVec::<[TypeId; 2]>::new();
        for (value, assigned) in assignments {
            let from = of_values.len();
            if (self.array_literal_types_in(file, value, &mut of_values)).contains(&assigned) {
                found.push(assigned);
            } else {
                of_values.truncate(from);
                regular.push(assigned);
            }
        }
        self.automatic_assignments = None;
        found.retain(|ty| !regular.contains(ty));
        all.extend(of_values.into_iter().filter(|ty| !regular.contains(ty)));
        found
    }

    /// `t == c.autoType || t == c.autoArrayType`
    pub(super) fn is_automatic_type(&self, ty: TypeId) -> bool {
        ty == TypeId::AUTO || ty == self.auto_array_type
    }

    /// `convertAutoToAny`
    pub(super) fn convert_auto_to_any(&mut self, ty: TypeId) -> TypeId {
        if ty == TypeId::AUTO {
            TypeId::ANY
        } else if ty == self.auto_array_type {
            self.array_of(TypeId::ANY)
        } else {
            ty
        }
    }

    /// `markNodeAssignmentsWorker`: a symbol named by `export { x }` may be assigned at any time,
    /// as far as this file can tell.
    fn is_named_by_export_specifier(&self, file: FileId, symbol: SymbolId) -> bool {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let name = bound.symbols[symbol.idx()].name;
        hir.exports.iter().enumerate().any(|(i, export)| {
            export.spec.is_none()
                && !export.type_only
                && export
                    .items
                    .iter()
                    .any(|s| hir[s].local == name && !hir[s].type_only)
                && files.resolve_name(file, bound.export_scope[i], name, SymFlags::VALUE)
                    == Some(files.sym(file, symbol))
        })
    }

    /// `isParameterOrMutableLocalVariable(symbol) && isPastLastAssignment(symbol, e)`
    pub(super) fn is_past_last_assignment(
        &mut self,
        file: FileId,
        symbol: SymbolId,
        e: ExprId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(&(Decl::Var(pat) | Decl::Param(pat))) = bound.symbols[symbol.idx()].decls.first()
        else {
            return false;
        };
        if !self.is_parameter_or_mutable_local_variable(file, symbol)
            || !hir.exports.is_empty() && self.is_named_by_export_specifier(file, symbol)
        {
            return false;
        }
        // `FindAncestor(symbol.ValueDeclaration, IsFunctionOrSourceFile)`
        let declaring_function = hir.get_containing_function(hir.node(pat));
        // `markNodeAssignmentsWorker`
        let from = bound.assignments.partition_point(|a| a.0.0 < symbol.0);
        bound.assignments[from..]
            .iter()
            .take_while(|a| a.0 == symbol)
            .all(|&(_, assignment)| {
                hir.get_containing_function(hir.node(assignment)) == declaring_function
                    && self.extend_assignment_position(file, assignment, hir[pat].pos) < hir[e].pos
            })
    }

    /// `extendAssignmentPosition`. Only a statement moves the position, and the first statement
    /// around the function that declares the variable ends the climb.
    fn extend_assignment_position(&self, file: FileId, node: ExprId, declaration: u32) -> u32 {
        let hir = self.hir(file);
        let mut pos = hir[node].pos;
        let mut at = hir.parent(hir.node(node));
        while at.is_some() {
            if let NodeData::Stmt(stmt) = hir.data(at) {
                if hir[stmt].start <= declaration {
                    return pos;
                }
                if matches!(
                    hir[stmt].kind,
                    StmtKind::Var(_)
                        | StmtKind::Expr(_)
                        | StmtKind::If { .. }
                        | StmtKind::DoWhile { .. }
                        | StmtKind::While { .. }
                        | StmtKind::For { .. }
                        | StmtKind::ForIn { .. }
                        | StmtKind::ForOf { .. }
                        | StmtKind::Switch { .. }
                        | StmtKind::Try { .. }
                        | StmtKind::Class(_)
                ) {
                    pos = hir[stmt].loc.end;
                }
            }
            at = hir.parent(at);
        }
        pos
    }

    fn evolving_array(&mut self, element: TypeId) -> TypeId {
        self.intern(TypeData::EvolvingArray(element))
    }

    /// `finalizeEvolvingArrayType`, `createFinalArrayType`
    fn finalize_evolving_array(&mut self, ty: TypeId) -> TypeId {
        let TypeData::EvolvingArray(element) = *self.data(ty) else {
            return ty;
        };
        if element.is_never() {
            return self.auto_array_type;
        }
        let element = if self.is_union(element) {
            let parts = self.parts(element);
            self.union_reduced(parts)
        } else {
            element
        };
        self.array_of(element)
    }

    /// The type at a join of control flow paths. Evolving arrays stay evolving if all the types are
    /// evolving arrays.
    /// A type that is not part of the initial type of the reference was introduced by `instanceof`,
    /// `in` or a type guard, and is removed again where it joins a type it is a subtype of.
    fn union_or_evolving(&mut self, types: &[TypeId], walk: &mut Walk) -> TypeId {
        if types.len() < 2 {
            return self.union_or_evolving_with(types, false);
        }
        let initial = self.initial_of(walk);
        let is_subset = |c: &Self, t: TypeId| {
            t == initial
                || t.is_never()
                || c.is_union(initial) && c.is_type_subset_of_union(t, initial)
        };
        let subtype_reduction = !types.iter().all(|&t| is_subset(self, t));
        self.union_or_evolving_with(types, subtype_reduction)
    }

    /// `getUnionOrEvolvingArrayType`
    fn union_or_evolving_with(&mut self, types: &[TypeId], subtype_reduction: bool) -> TypeId {
        if let [only] = *types
            && !matches!(
                self.data(only),
                TypeData::Union(_) | TypeData::EvolvingArray(_)
            )
        {
            return only;
        }
        if !types
            .iter()
            .any(|&t| matches!(self.data(t), TypeData::EvolvingArray(_)))
        {
            let union = if subtype_reduction {
                self.union_reduced(types)
            } else {
                self.union(types)
            };
            // `recombineUnknownType`: the constituents `unknown` was split into, all present again.
            if self.walk_declared == TypeId::UNKNOWN
                && let TypeData::Union(parts) = self.data(union)
                && parts.len() == 3
                && [
                    TypeId::UNKNOWN_EMPTY_OBJECT,
                    TypeId::NULL,
                    TypeId::UNDEFINED,
                ]
                .iter()
                .all(|p| parts.contains(p))
            {
                return TypeId::UNKNOWN;
            }
            // The union of all the members of the declared type is the declared type.
            if union != self.walk_declared
                && let (TypeData::Union(parts), TypeData::Union(declared)) =
                    (self.data(union), self.data(self.walk_declared))
                && parts == declared
            {
                return self.walk_declared;
            }
            // `false | true` is `boolean` regardless of their freshness: together they widen to it
            // anyway.
            let parts = self.parts(union);
            let (fresh_false, fresh_true) = (
                parts.contains(&TypeId::FRESH_FALSE),
                parts.contains(&TypeId::FRESH_TRUE),
            );
            if (fresh_false || fresh_true)
                && (fresh_false || parts.contains(&TypeId::FALSE))
                && (fresh_true || parts.contains(&TypeId::TRUE))
            {
                return self.map_type(union, |c, m| {
                    if c.is_boolean_like(m) {
                        c.regular(m)
                    } else {
                        m
                    }
                });
            }
            return union;
        }
        let mut elements = Vec::with_capacity(types.len());
        for &t in types {
            match *self.data(t) {
                TypeData::EvolvingArray(element) => elements.push(element),
                _ if t.is_never() => {}
                // Not `isEvolvingArrayTypeList`: the union of the finalized types.
                _ => {
                    let types: Vec<TypeId> = types
                        .iter()
                        .map(|&t| self.finalize_evolving_array(t))
                        .collect();
                    return self.union_or_evolving_with(&types, subtype_reduction);
                }
            }
        }
        let element = self.union(&elements);
        self.evolving_array(element)
    }

    /// `isEvolvingArrayOperationTarget`: `x` in `x.length`, `x.push(v)`, `x.unshift(v)`, `x[n] = v`.
    fn is_evolving_array_operation_target(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `getReferenceRoot`: `(x = [], x).push(v)`
        let mut root = e;
        let parent = loop {
            let Parent::Expr(parent) = bound.expr_parent[root.idx()] else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::Assign {
                    op: None, target, ..
                } if target == root => root = parent,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if right == root => root = parent,
                _ => break parent,
            }
        };
        // Only the direct syntactic parent of `x.push` and `x[n]` counts: `(x.push)(v)` and `(x[n])
        // = v` do not qualify.
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == root => {
                name == known::length
                    || (name == known::push || name == known::unshift)
                        && !is_parenthesized(hir, parent)
                        // A call that contains it, even as an argument.
                        && matches!(bound.expr_parent[parent.idx()], Parent::Expr(call) if matches!(hir[call].kind, ExprKind::Call(_)))
            }
            ExprKind::Index { obj, index, .. } if obj == root => {
                let Parent::Expr(assign) = bound.expr_parent[parent.idx()] else {
                    return false;
                };
                if is_parenthesized(hir, parent)
                    || !matches!(hir[assign].kind, ExprKind::Assign { op: None, target, .. } if target == parent)
                    || self.is_definite_assignment_target(file, assign)
                {
                    return false;
                }
                // `isTypeAssignableToKind(.., NumberLike)`
                let index = self.get_type_of_expression(file, index);
                self.is_assignable(index, TypeId::NUMBER)
            }
            _ => false,
        }
    }

    /// `getContextFreeTypeOfExpression`. tsgo caches every result. One that depends on an incomplete loop type is cached here for the
    /// traversal of the back edge only, like `flowTypeCache`.
    fn context_free_type_of_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        if let Some(kept) = self.p.context_free_expr_types.get(&self.task, &(file, e)) {
            return kept;
        }
        let depth = self.flow_type_cache_depth;
        let is_in_back_edge = depth != usize::MAX && self.is_flow_loop_visible(depth);
        if is_in_back_edge && let Some(&cached) = self.flow_type_cache.get(&(file, e, true)) {
            self.taint_from(depth);
            return cached;
        }
        let level = self.inference_contexts.len() + 1;
        let outer = std::mem::replace(&mut self.context_free_level, level);
        let (ty, stored) = self.run_memoizable(|c| {
            let mode = CheckMode::SKIP_CONTEXT_SENSITIVE;
            c.check_expression_with_contextual_type(file, e, TypeId::ANY, None, mode)
        });
        self.context_free_level = outer;
        if let Some(stored) = stored
            && !self.is_stack_low()
        {
            (self.p.context_free_expr_types).rewrite(&self.task, (file, e), ty, stored);
        } else if is_in_back_edge {
            self.flow_type_cache.insert((file, e, true), ty);
        }
        ty
    }

    /// `addEvolvingArrayElementType`: the evolving array `ty` after `value` was added to it.
    fn add_evolving_element(&mut self, file: FileId, ty: TypeId, value: ExprId) -> TypeId {
        let TypeData::EvolvingArray(element) = *self.data(ty) else {
            return ty;
        };
        let hir = self.hir(file);
        let added = match hir[value].kind {
            ExprKind::Spread(inner) => {
                let spread = self.context_free_type_of_expression(file, inner);
                self.iterated_type_of_spread(spread)
            }
            _ => self.context_free_type_of_expression(file, value),
        };
        let added = self.base_of_literal(added);
        let added = self.regular_type_of_object_literal(added);
        if self
            .parts(added)
            .iter()
            .all(|a| self.parts(element).contains(a))
        {
            return ty;
        }
        let element = self.union(&[element, added]);
        self.evolving_array(element)
    }

    /// `getTypeAtFlowNode`
    fn flow_type(&mut self, walk: &mut Walk, start: FlowId) -> FlowType {
        if walk.too_deep {
            return FlowType::new(TypeId::ERROR, false);
        }
        let file = walk.reference.file;
        let bound = self.bound(file);
        // Conditions encountered during the backward walk, applied in forward order afterwards.
        enum Pending {
            Cond(ExprId, bool),
            Switch(StmtId, u16, u16),
            Assert(ExprId),
            /// `a.push(x)`, `a[i] = x`
            Mutation(ExprId),
            /// `x += 1`, `x++`
            Compound,
            /// `for (const k in x)`: `x` is there.
            NonNull,
        }
        let mut pending: SmallVec<[Pending; 8]> = SmallVec::new();
        // Number of conditions that were not deferred because they do not apply to the reference.
        // They count as if they had been deferred.
        let mut passed = 0;
        let mut flow = start;
        let (depth, crossed) = (walk.depth, walk.crossed);
        let mut incomplete = false;
        let is_shared_in_finally = !walk.reduced.is_empty() && bound.is_shared(start);
        let mut ty = loop {
            walk.steps += 1;
            if walk.steps >= MAX_STEPS {
                break walk.declared;
            }
            // This is one invocation of `getTypeAtFlowNode`, and each deferred condition represents
            // one more, nested in it.
            walk.depth = depth + 1 + pending.len() as u32 + passed;
            if walk.depth > MAX_FLOW_DEPTH {
                walk.too_deep = true;
                break TypeId::ERROR;
            }
            // `FlowFlagsShared`: a shared node of a `finally` block keeps the type of its first
            // visit, also when the block is traversed again for another way of leaving it.
            if !walk.reduced.is_empty() && bound.is_shared(flow) {
                if let Some(known) = walk.shared_at(flow) {
                    incomplete = known.incomplete;
                    break known.ty;
                }
                // An invocation of its own, which records the type.
                if flow != start {
                    walk.depth -= 1;
                    let t = self.flow_type(walk, flow);
                    incomplete = t.incomplete;
                    break t.ty;
                }
            }
            match bound.flow[flow.idx()] {
                // "Simply return the non-auto declared type to reduce follow-on errors."
                Flow::Unreachable => break self.convert_auto_to_any(walk.declared),
                Flow::Start { outer, arrow } => {
                    // An arrow function has no `this` of its own.
                    let is_this = arrow
                        && walk.reference.root == Root::This
                        && walk.reference.path.is_empty();
                    if outer.is_some() && (is_this || self.settle_crossing(walk)) {
                        flow = outer;
                        continue;
                    }
                    break self.initial_of(walk);
                }
                Flow::StartInvoked { outer, arrow } => {
                    let continues = walk.reference.path.is_empty()
                        && match walk.reference.root {
                            Root::Symbol(_) | Root::Global(_) => true,
                            Root::This => arrow,
                            // Never walked without a path, or walked with `crosses_functions`.
                            Root::Super
                            | Root::ImportMeta
                            | Root::NewTarget
                            | Root::Pattern(_)
                            | Root::Params(_) => false,
                        };
                    if continues || self.settle_crossing(walk) {
                        flow = outer;
                        continue;
                    }
                    break self.initial_of(walk);
                }
                Flow::Assign { before, target } => {
                    if let FlowTarget::Expr(e) = target
                        && self
                            .bound(file)
                            .get_assignment_target_kind(self.hir(file), e)
                            == AssignmentKind::Compound
                        && self.matches(&walk.reference, e)
                    {
                        if !self.is_reachable(file, flow) {
                            break TypeId::UNREACHABLE_NEVER;
                        }
                        pending.push(Pending::Compound);
                        flow = before;
                        continue;
                    }
                    match self.type_at_assignment(walk, flow, target) {
                        Some(t) => break t,
                        None => {
                            if self.is_for_in_over(&walk.reference, target) {
                                pending.push(Pending::NonNull);
                            }
                            flow = before;
                        }
                    }
                }
                Flow::ArrayMutation { before, expr } => {
                    // `getTypeAtFlowArrayMutation`: a mutation of a different reference is skipped.
                    if self.is_automatic_type(walk.declared)
                        && self.is_mutation_of(&walk.reference, expr)
                    {
                        pending.push(Pending::Mutation(expr));
                    }
                    flow = before;
                }
                Flow::Cond {
                    before,
                    expr,
                    sense,
                } => {
                    // Every condition is applied to an evolving array.
                    if self.is_automatic_type(walk.declared)
                        || self.is_test_about(&walk.reference, flow, expr)
                    {
                        pending.push(Pending::Cond(expr, sense));
                    } else {
                        passed += 1;
                    }
                    flow = before;
                }
                Flow::Switch {
                    before,
                    stmt,
                    from,
                    to,
                } => {
                    pending.push(Pending::Switch(stmt, from, to));
                    flow = before;
                }
                Flow::Call { before, call } => {
                    if !self.flow_memo.is_idle_call(file, flow) {
                        // `getTypeAtFlowCall`
                        match self.effects_signature_and_is_cached(file, call) {
                            (Some(sig), _) => match self.sig_predicate(sig) {
                                Some(predicate) if predicate.asserts => {
                                    pending.push(Pending::Assert(call));
                                }
                                _ => break TypeId::UNREACHABLE_NEVER,
                            },
                            (None, true) => self.note_idle_call(file, flow),
                            (None, false) => {}
                        }
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    walk.reduced.push((label, instead));
                    let t = self.flow_type(walk, before);
                    walk.reduced.pop();
                    incomplete = t.incomplete;
                    break t.ty;
                }
                Flow::Label { start, len } => {
                    // The start of a `finally` block the walk is passing through backward: continue
                    // with the reduced set of antecedents. Nothing before this point depends on
                    // that set, so results computed from here on are cacheable again.
                    if let Some(at) = walk.reduced.iter().rposition(|r| r.0 == flow) {
                        let entry = walk.reduced.remove(at);
                        let t = self.flow_type(walk, entry.1);
                        walk.reduced.insert(at, entry);
                        incomplete = t.incomplete;
                        break t.ty;
                    }
                    if let Some(known) = walk.known_at(flow) {
                        incomplete = known.incomplete;
                        break known.ty;
                    }
                    let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                    // The path that bypasses a `switch` when no case matched. It does not exist if
                    // the `switch` is exhaustive, which is only computed when it would change the
                    // result: the computation can re-enter here.
                    let mut bypass = None;
                    let mut settled = false;
                    for &edge in bound.edges(start, len) {
                        if bypass.is_none()
                            && let Flow::Switch { stmt, from, to, .. } = bound.flow[edge.idx()]
                            && from == to
                        {
                            bypass = Some((edge, stmt));
                            continue;
                        }
                        let t = self.flow_type(walk, edge);
                        if t.ty == walk.declared && self.starts_as_declared(walk) {
                            types.clear();
                            types.push(t.ty);
                            incomplete = false;
                            settled = true;
                            break;
                        }
                        if !types.contains(&t.ty) {
                            types.push(t.ty);
                        }
                        incomplete |= t.incomplete;
                    }
                    if !settled && let Some((edge, stmt)) = bypass {
                        let t = self.flow_type(walk, edge);
                        if !t.ty.is_never()
                            && !types.contains(&t.ty)
                            && !self.is_exhaustive_switch(file, stmt)
                        {
                            incomplete |= t.incomplete;
                            if t.ty == walk.declared && self.starts_as_declared(walk) {
                                types.clear();
                                incomplete = false;
                            }
                            types.push(t.ty);
                        }
                    }
                    let t = FlowType::new(self.union_or_evolving(&types, walk), incomplete);
                    walk.remember(flow, t);
                    break t.ty;
                }
                Flow::Loop { start, len } => {
                    let edges = bound.edges(start, len);
                    match *edges {
                        // A loop label without antecedents: it follows `while (true) {}`.
                        [] => break self.convert_auto_to_any(walk.declared),
                        [only] => {
                            flow = only;
                            continue;
                        }
                        _ => {}
                    }
                    // `getTypeAtFlowLoopLabel`: a reference without a key has its declared type at
                    // a loop label.
                    if !walk.reference.has_key {
                        break walk.declared;
                    }
                    let initial = self.initial_of(walk);
                    let key = (file, flow, walk.declared, initial);
                    if let Some(cached) =
                        self.flow_memo.cached_flow_loop_type(&key, &walk.reference)
                    {
                        break cached;
                    }
                    // `flowLoopStack` belongs to the checker: a walk with the same key, started while another walk follows a back edge
                    // of this loop, gets the union of the antecedent types found so far, marked incomplete.
                    if let Some(i) = self.flow_loops.iter().rposition(|l| {
                        l.0 == flow
                            && l.1 == walk.reference
                            && l.2 == walk.declared
                            && l.3 == initial
                    }) {
                        let (so_far, depth) = (self.flow_loops[i].4, self.flow_loops[i].5);
                        if self.is_flow_loop_visible(depth) {
                            // Nothing computed from an incomplete type is cached.
                            self.taint_from(depth);
                            incomplete = true;
                            break FlowType::new(so_far, true).ty;
                        }
                    }
                    if let Some(known) = walk.known_at(flow) {
                        incomplete = known.incomplete;
                        break known.ty;
                    }
                    let entry = self.flow_type(walk, edges[0]);
                    // The result is incomplete only if the first antecedent is.
                    incomplete = entry.incomplete;
                    let entry = entry.ty;
                    let mut types: SmallVec<[TypeId; 4]> = smallvec![entry];
                    // Once the type is the declared type, only subtypes could be added. Unlike at a
                    // branch label, the initial type is not considered.
                    if entry != walk.declared {
                        // One pass: each back edge sees the types of the antecedents before it.
                        walk.round_labels.push(Labels::default());
                        self.flow_loops.push((
                            flow,
                            walk.reference.clone(),
                            walk.declared,
                            initial,
                            entry,
                            self.stack.len(),
                        ));
                        let mut restarted = None;
                        for &edge in &edges[1..] {
                            let cache = std::mem::take(&mut self.flow_type_cache);
                            let depth = std::mem::replace(
                                &mut self.flow_type_cache_depth,
                                self.stack.len(),
                            );
                            let t = self.flow_type(walk, edge).ty;
                            self.flow_type_cache = cache;
                            self.flow_type_cache_depth = depth;
                            // "Control flow analysis was restarted and completed by checkExpressionCached."
                            restarted = self.flow_memo.cached_flow_loop_type(&key, &walk.reference);
                            if restarted.is_some() {
                                break;
                            }
                            if t == walk.declared {
                                types.push(t);
                                break;
                            }
                            if !types.contains(&t) {
                                types.push(t);
                                let so_far = self.union_or_evolving_with(&types, false);
                                if let Some(shared) = self.flow_loops.last_mut() {
                                    shared.4 = so_far;
                                }
                            }
                        }
                        self.flow_loops.pop();
                        walk.round_labels.pop();
                        if let Some(cached) = restarted {
                            incomplete = false;
                            break cached;
                        }
                    }
                    let result = FlowType::new(self.union_or_evolving(&types, walk), incomplete);
                    walk.remember(flow, result);
                    // A result that depends on a speculative evaluation, a provisional type or a
                    // walk that bailed out is not cached.
                    if !incomplete && !walk.too_deep && walk.steps < MAX_STEPS {
                        self.flow_memo
                            .flow_loop_cache
                            .entry(key)
                            .or_default()
                            .push((walk.reference.clone(), result.ty));
                    }
                    break result.ty;
                }
            }
        };
        (walk.depth, walk.crossed) = (depth, crossed);
        if walk.too_deep {
            return FlowType::new(TypeId::ERROR, false);
        }
        let reference = &walk.reference;
        while let Some(p) = pending.pop() {
            if ty.is_never() {
                break;
            }
            // A condition is applied to the finalized array type; if it narrows nothing, the array
            // stays evolving.
            let seen = self.finalize_evolving_array(ty);
            let narrowed = match p {
                Pending::Cond(expr, sense) => self.narrow(reference, seen, expr, sense),
                Pending::Switch(stmt, from, to) => {
                    self.narrow_by_switch(reference, seen, stmt, from as usize, to as usize)
                }
                Pending::Assert(call) => self.narrow_by_assertion(reference, seen, call),
                Pending::Compound => self.base_of_literal(seen),
                Pending::Mutation(expr) => {
                    ty = self.after_array_mutation(file, ty, expr);
                    continue;
                }
                // Applied to the finalized array type: the array stops evolving.
                Pending::NonNull => {
                    ty = self.non_nullable_type_if_needed(seen);
                    incomplete = false;
                    continue;
                }
            };
            if narrowed != seen {
                ty = FlowType::new(narrowed, incomplete).ty;
            }
        }
        if is_shared_in_finally {
            walk.remember_shared(start, FlowType { ty, incomplete });
        }
        FlowType { ty, incomplete }
    }

    /// `checkNonNullTypeWithReporter`: `ty` without `null` and `undefined`, where neither is
    /// allowed. `report` is called with the problem with `ty`, if there is one.
    pub(super) fn check_non_null_type_with_reporter(
        &mut self,
        ty: TypeId,
        report: impl FnOnce(&mut Self, NonNullError),
    ) -> TypeId {
        // Most types have neither fact, which their kind alone determines.
        if !self.some_type(ty, |c, m| {
            m == TypeId::UNKNOWN
                || m.is_undefined()
                || m.is_null()
                || c.is_deferred(m)
                || c.is_intersection(m)
        }) {
            return ty;
        }
        let strict = self.p.files.options.strict_null_checks;
        if strict && ty == TypeId::UNKNOWN {
            report(self, NonNullError::IsUnknown);
            return TypeId::ERROR;
        }
        let found = self.type_facts(ty, facts::IS_UNDEFINED | facts::IS_NULL);
        if found == 0 {
            return ty;
        }
        report(
            self,
            NonNullError::IsPossibly {
                undefined: found & facts::IS_UNDEFINED != 0,
                null: found & facts::IS_NULL != 0,
            },
        );
        // `GetNonNullableType`
        let non_nullable = if strict {
            self.adjusted_type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
        } else {
            ty
        };
        if non_nullable.is_never() || non_nullable.is_null() || non_nullable.is_undefined() {
            TypeId::ERROR
        } else {
            non_nullable
        }
    }

    /// `checkNonNullType`, without its diagnostics.
    pub(super) fn non_null_type(&mut self, ty: TypeId) -> TypeId {
        self.check_non_null_type_with_reporter(ty, |_, _| {})
    }

    /// `getNonNullableTypeIfNeeded`
    pub(super) fn non_nullable_type_if_needed(&mut self, ty: TypeId) -> TypeId {
        if self.has_type_facts(ty, facts::IS_UNDEFINED | facts::IS_NULL) {
            self.non_nullable(ty)
        } else {
            ty
        }
    }

    /// `GetNonNullableType`
    pub fn non_nullable(&mut self, ty: TypeId) -> TypeId {
        if self.p.files.options.strict_null_checks {
            self.adjusted_type_with_facts(ty, facts::NE_UNDEFINED_OR_NULL)
        } else {
            ty
        }
    }

    /// `getAssignmentReducedType`
    fn assignment_reduced_type(&mut self, declared: TypeId, assigned: TypeId) -> TypeId {
        if declared == assigned {
            return declared;
        }
        if self.is_any(assigned) {
            return declared;
        }
        if assigned.is_never() {
            return assigned;
        }
        let key = (declared, assigned);
        if let Some(&known) = self.flow_memo.assignment_reduced_types.get(&key) {
            return known;
        }
        let (reduced, stored) =
            self.run_memoizable(|c| c.assignment_reduced_type_uncached(declared, assigned));
        if stored.is_some() {
            self.flow_memo.assignment_reduced_types.insert(key, reduced);
        }
        reduced
    }

    /// `getAssignmentReducedTypeWorker`
    fn assignment_reduced_type_uncached(&mut self, declared: TypeId, assigned: TypeId) -> TypeId {
        // A fresh `true` or `false` narrows to fresh types: `var n = s` then widens it.
        let is_fresh_boolean =
            matches!(*self.data(assigned), TypeData::BoolLit { fresh: true, .. });
        let assigned = self.regular(assigned);
        let reduced = self.filter(declared, |c, m| {
            c.parts(assigned).iter().any(|&a| c.is_assignable(a, m))
        });
        if !self.is_assignable(assigned, reduced) {
            return declared;
        }
        if is_fresh_boolean {
            self.map_type(reduced, |c, m| c.fresh(m))
        } else {
            reduced
        }
    }

    /// `getTypeAtFlowAssignment` for a non-compound assignment. `None`: continue from
    /// `flow.Antecedent`.
    fn type_at_assignment(
        &mut self,
        walk: &Walk,
        flow: FlowId,
        target: FlowTarget,
    ) -> Option<TypeId> {
        let (reference, declared) = (&walk.reference, walk.declared);
        let file = reference.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let declares = |pat: PatId| reference.root == Root::Symbol(bound.pat_symbol[pat.idx()]);
        // `isMatchingReference(f.reference, node)`, or else `containsMatchingReference(f.reference, node)`
        let is_matching = match target {
            FlowTarget::Var(d) if declares(hir[d].pat) => reference.path.is_empty(),
            FlowTarget::Pat(p) if declares(p) => reference.path.is_empty(),
            FlowTarget::Expr(e) if self.matches(reference, e) => true,
            FlowTarget::Expr(e) if self.is_proper_prefix(reference, e) => false,
            _ => return None,
        };
        if !self.is_reachable(file, flow) {
            return Some(TypeId::UNREACHABLE_NEVER);
        }
        if !is_matching {
            // "A matching dotted name might also be an expando property on a function *expression*"
            if let FlowTarget::Var(d) = target
                && let Some(init) = hir[d].init.some()
                && (hir.is_js
                    || matches!(
                        hir[d].kind,
                        VarKind::Const | VarKind::Using | VarKind::AwaitUsing
                    ))
                && matches!(hir[init].kind, ExprKind::Fn(f) if matches!(hir[f].kind, FnKind::Expr | FnKind::Arrow))
                && !is_parenthesized(hir, init)
            {
                return None;
            }
            return Some(declared);
        }
        if self.is_automatic_type(declared) {
            // `isEmptyArrayAssignment`
            let value = match target {
                FlowTarget::Var(d) => hir[d].init,
                FlowTarget::Expr(e) => match bound.expr_parent[e.idx()] {
                    Parent::Expr(parent) => match hir[parent].kind {
                        ExprKind::Assign { value, .. } => value,
                        _ => ExprId::NONE,
                    },
                    _ => ExprId::NONE,
                },
                FlowTarget::Pat(_) => ExprId::NONE,
            };
            if value.is_some()
                && matches!(hir[value].kind, ExprKind::Array(items) if items.is_empty())
                && !is_parenthesized(hir, value)
            {
                return Some(self.evolving_array(TypeId::NEVER));
            }
            let assigned = self.initial_or_assigned_type(walk, target);
            let assigned = self.widen_literal(assigned);
            if let Some((at, assignments)) = &mut self.automatic_assignments
                && *at == (file, reference.at)
            {
                assignments.push((value, assigned));
            }
            return Some(if self.is_assignable(assigned, declared) {
                assigned
            } else {
                self.array_of(TypeId::ANY)
            });
        }
        let declared = match target {
            FlowTarget::Expr(e) if self.is_in_compound_like_assignment(file, e) => {
                self.base_of_literal(declared)
            }
            _ => declared,
        };
        // "we only need to evaluate the assigned type if the declared type is a union type"
        if !self.is_union(declared) {
            return Some(declared);
        }
        let assigned = self.initial_or_assigned_type(walk, target);
        Some(self.assignment_reduced_type(declared, assigned))
    }

    /// `getTypeOfExpression`. `flowTypeCache` is ported for the traversal of a loop back edge only. Outside one, the shared expression
    /// cache stores every cacheable result, and a non-cacheable result comes from a cycle or a limit, not from flow analysis.
    pub(super) fn get_type_of_expression(&mut self, file: FileId, e: ExprId) -> TypeId {
        let depth = self.flow_type_cache_depth;
        // `checkExpressionCached` computes with an empty cache: a type resolution entered since the traversal began hides this one.
        if depth == usize::MAX || !self.is_flow_loop_visible(depth) {
            return self.type_of_declaration_initializer(file, e);
        }
        if let Some(&cached) = self.flow_type_cache.get(&(file, e, false)) {
            // The entry was computed from an incomplete loop type.
            self.taint_from(depth);
            return cached;
        }
        let start = self.flow_invocation_count;
        let ty = self.type_of_declaration_initializer(file, e);
        if self.flow_invocation_count != start && self.cached_type_of_expr(file, e).is_none() {
            self.flow_type_cache.insert((file, e, false), ty);
        }
        ty
    }

    /// `getInitialOrAssignedType`
    fn initial_or_assigned_type(&mut self, walk: &Walk, target: FlowTarget) -> TypeId {
        let file = walk.reference.file;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ty = match target {
            FlowTarget::Var(d) if hir[d].init.is_some() => {
                Some(self.type_of_assigned_value(walk, hir[d].init, true))
            }
            FlowTarget::Var(d) => self.initial_type_of_pat(file, hir[d].pat),
            FlowTarget::Pat(p) => self.initial_type_of_pat(file, p),
            // `getAssignedType`
            FlowTarget::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) => match hir[parent].kind {
                    // Not `[x = d] = v`, where `d` is only a fallback.
                    ExprKind::Assign { target, value, .. }
                        if target == e && !self.is_definite_assignment_target(file, parent) =>
                    {
                        Some(self.type_of_assigned_value(walk, value, false))
                    }
                    ExprKind::Unary {
                        op: UnOp::Delete, ..
                    } => Some(TypeId::UNDEFINED),
                    _ => self.assigned_type(file, e),
                },
                _ => self.assigned_type(file, e),
            },
        };
        let ty = ty.unwrap_or(TypeId::ERROR);
        match walk.reference.at.some() {
            Some(at) => self.get_narrowable_type_for_reference(file, at, ty, CheckMode::empty()),
            None => ty,
        }
    }

    /// `getTypeOfInitializer`, `getTypeOfExpression(node.Right)`. `getTypeOfExpression` rechecks an
    /// expression that is already being checked, and terminates at the loop
    /// (`recheck_in_flow_loop`). Beyond a type resolution, which hides the loop, `enter` refuses,
    /// so a cycle through a value assigned on a back edge may not be a cycle in TypeScript.
    /// `mark_cycle_from` identifies those.
    fn type_of_assigned_value(
        &mut self,
        walk: &Walk,
        value: ExprId,
        is_initializer: bool,
    ) -> TypeId {
        let in_loop = !is_initializer && !walk.round_labels.is_empty();
        if in_loop {
            self.eager.push(self.stack.len());
            self.loop_values.push(self.stack.len());
        }
        let ty = self.get_type_of_expression(walk.reference.file, value);
        if in_loop {
            self.loop_values.pop();
            self.eager.pop();
        }
        ty
    }

    /// `getInitialType`: the type the initializer gives `pat`. `None` where TypeScript returns its
    /// error type.
    fn initial_type_of_pat(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ty, default) = match bound.pat_parent[pat.idx()] {
            PatParent::Var(d) if hir[d].init.is_some() => {
                return Some(self.get_type_of_expression(file, hir[d].init));
            }
            // `getInitialTypeOfVariableDeclaration`
            PatParent::Var(d) => {
                return self.initial_type_of_for_head(file, bound.var_stmt[d.idx()]);
            }
            PatParent::Param(_) | PatParent::None => return None,
            PatParent::Prop(parent, prop) => {
                let parent_ty = self.initial_type_of_pat(file, parent)?;
                if hir[prop].is_rest {
                    return None;
                }
                let name = self.member_name(file, hir[prop].key)?;
                (self.type_of_property(parent_ty, name)?, hir[prop].default)
            }
            PatParent::Elem(parent, elem) => {
                let parent_ty = self.initial_type_of_pat(file, parent)?;
                let PatKind::Array(elems) = hir[parent].kind else {
                    return None;
                };
                (
                    self.element_of_destructured(
                        parent_ty,
                        (elem.0 - elems.start) as usize,
                        hir[elem].is_rest,
                        None,
                    ),
                    hir[elem].default,
                )
            }
        };
        // `getTypeWithDefault`
        if default.is_none() {
            return Some(ty);
        }
        let default = self.get_type_of_expression(file, default);
        let ty = self.non_undefined_type(ty);
        Some(self.union(&[ty, default]))
    }

    /// `getAssignedType`. `None` where TypeScript returns its error type.
    fn assigned_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::Expr(p) => match hir[p].kind {
                // `getAssignedTypeOfBinaryExpression`
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if target == e => {
                    if !self.is_definite_assignment_target(file, p) {
                        return Some(self.get_type_of_expression(file, value));
                    }
                    // `x = d` as an element: `x` is assigned the type of the element, or else that
                    // of the default.
                    let ty = self.assigned_type(file, p)?;
                    let (ty, default) = (
                        self.non_undefined_type(ty),
                        self.get_type_of_expression(file, value),
                    );
                    Some(self.union(&[ty, default]))
                }
                ExprKind::Array(items) if self.is_definite_assignment_target(file, p) => {
                    let index = hir.ids(items).position(|i| i == e)?;
                    let ty = self.assigned_type(file, p)?;
                    if self.every_type(ty, |c, m| c.is_tuple(m)) {
                        let key = self.number_literal(index as f64, false);
                        if let Some(element) = self.indexed_access_if_any(ty, key, false) {
                            return Some(element);
                        }
                    }
                    let element = self.iterated_type_of_destructuring(ty);
                    // `includeUndefinedInIndexSignature`
                    Some(if self.p.files.options.no_unchecked_indexed_access {
                        self.with_missing(element)
                    } else {
                        element
                    })
                }
                ExprKind::Spread(_) => {
                    let Parent::Expr(list) = bound.expr_parent[p.idx()] else {
                        return None;
                    };
                    if !matches!(hir[list].kind, ExprKind::Array(_))
                        || !self.is_definite_assignment_target(file, list)
                    {
                        return None;
                    }
                    let ty = self.assigned_type(file, list)?;
                    let element = self.iterated_type_of_destructuring(ty);
                    Some(self.array_of(element))
                }
                _ => None,
            },
            Parent::Prop(prop) => {
                let owner = bound.prop_owner[prop.idx()];
                if hir[prop].kind == PropKind::Spread
                    || !self.is_definite_assignment_target(file, owner)
                {
                    return None;
                }
                let name = self.member_name(file, hir[prop].key)?;
                let ty = self.assigned_type(file, owner)?;
                if let Some(found) = self.type_of_property(ty, name) {
                    return Some(found);
                }
                let key = self.string_literal(name, false);
                Some(
                    self.indexed_access_if_any(ty, key, true)
                        .unwrap_or(TypeId::ERROR),
                )
            }
            Parent::Stmt(left) => self.initial_type_of_for_head(file, left),
            _ => None,
        }
    }

    /// `getInitialTypeOfVariableDeclaration`, `getAssignedType`: the type assigned to `left`, the
    /// head of `for (x in o)` or `for (x of xs)`.
    fn initial_type_of_for_head(&mut self, file: FileId, left: StmtId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Stmt(owner) = bound.stmt_parent[left.some()?.idx()] else {
            return None;
        };
        match hir[owner.some()?].kind {
            StmtKind::ForIn { left: head, .. } if head == left => Some(TypeId::STRING),
            // `checkRightHandSideOfForOf`: the iterated expression is assumed to be non-nullish
            // (`checkNonNullExpression`).
            StmtKind::ForOf {
                left: head,
                expr,
                is_await,
                ..
            } if head == left => {
                let iterable = self.type_of_expr(file, expr);
                let iterable = self.non_nullable_type_if_needed(iterable);
                Some(self.checked_iterated_type(iterable, is_await))
            }
            _ => None,
        }
    }

    /// Whether `target` is the `k` of `for (const k in x)`, where `x` is the reference or an access
    /// chain that contains it.
    fn is_for_in_over(&mut self, reference: &Reference, target: FlowTarget) -> bool {
        let FlowTarget::Var(d) = target else {
            return false;
        };
        let (hir, bound) = (self.hir(reference.file), self.bound(reference.file));
        let stmt = bound.var_stmt[d.idx()];
        if stmt.is_some()
            && let Parent::Stmt(owner) = bound.stmt_parent[stmt.idx()]
            && let StmtKind::ForIn { left, expr, .. } = hir[owner].kind
            && left == stmt
        {
            return self.matches(reference, expr) || self.optional_chain_contains(reference, expr);
        }
        false
    }

    /// Whether `expr`, `a.push(x)` or `a[i] = x`, mutates the reference. `(a.push)(x)` and `(a[i])
    /// = x` are not array mutations (`bindCallExpressionFlow`, `bindBinaryExpressionFlow`).
    fn is_mutation_of(&mut self, reference: &Reference, expr: ExprId) -> bool {
        let hir = self.hir(reference.file);
        let array = match hir[expr].kind {
            ExprKind::Call(c) => match hir[hir[c].callee].kind {
                ExprKind::Dot { obj, .. } if !is_parenthesized(hir, hir[c].callee) => obj,
                _ => return false,
            },
            ExprKind::Assign { target, .. } => match hir[target].kind {
                ExprKind::Index { obj, .. } if !is_parenthesized(hir, target) => obj,
                _ => return false,
            },
            _ => return false,
        };
        self.matches(reference, array)
    }

    /// Whether `getTypeAtFlowNode` reaches a depth of `MAX_FLOW_DEPTH` walking straight back from
    /// `flow`, for an array that is not assigned after its declaration. No node on the way is
    /// evaluated, and the walk stops at a join.
    fn is_flow_too_deep(&mut self, reference: &Reference, mut flow: FlowId) -> bool {
        let (hir, bound) = (self.hir(reference.file), self.bound(reference.file));
        let mut nested = 0;
        loop {
            let (before, is_nested) = match bound.flow[flow.idx()] {
                Flow::ArrayMutation { before, expr } => {
                    (before, self.is_mutation_of(reference, expr))
                }
                Flow::Cond { before, .. } | Flow::Switch { before, .. } => (before, true),
                Flow::Call { before, .. } => (before, false),
                Flow::Assign { before, target } => {
                    if matches!(target, FlowTarget::Var(d) if reference.root == Root::Symbol(bound.pat_symbol[hir[d].pat.idx()]))
                    {
                        return false;
                    }
                    (before, false)
                }
                _ => return false,
            };
            nested += is_nested as u32;
            if nested >= MAX_FLOW_DEPTH {
                return true;
            }
            flow = before;
        }
    }

    /// `getTypeAtFlowArrayMutation`: the array `ty` after the mutation `expr`.
    fn after_array_mutation(&mut self, file: FileId, ty: TypeId, expr: ExprId) -> TypeId {
        if !matches!(self.data(ty), TypeData::EvolvingArray(_)) {
            return ty;
        }
        let hir = self.hir(file);
        match hir[expr].kind {
            ExprKind::Call(c) => {
                let mut ty = ty;
                for arg in hir.ids(hir[c].args) {
                    ty = self.add_evolving_element(file, ty, arg);
                }
                ty
            }
            ExprKind::Assign { target, value, .. } => {
                let ExprKind::Index { index, .. } = hir[target].kind else {
                    return ty;
                };
                let index = self.get_type_of_expression(file, index);
                if self.is_assignable(index, TypeId::NUMBER) {
                    self.add_evolving_element(file, ty, value)
                } else {
                    ty
                }
            }
            _ => ty,
        }
    }

    // ───────────────────────────── calls that assert or never return ─────────────────────────────

    /// `getTypeOfDottedName`: the type of `e` as determined by annotations alone, without
    /// inference.
    pub(super) fn explicit_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                self.explicit_type_of_symbol(sym)
            }
            ExprKind::This => self.explicit_this_type(file, e),
            // `checkSuperExpression`
            ExprKind::Super => Some(self.type_of_expr(file, e)),
            ExprKind::Dot { obj, name, .. } => {
                let obj = self.explicit_type(file, obj)?;
                self.explicit_type_of_property(obj, name)
            }
            _ => None,
        }
    }

    /// `getExplicitTypeOfSymbol(getPropertyOfType(obj, name))`
    fn explicit_type_of_property(&mut self, obj: TypeId, name: Atom) -> Option<TypeId> {
        let (prop, mapper) = self.get_property_of_type(obj, name)?;
        (self.has_explicit_type(prop)).then(|| self.type_of_prop(prop, mapper))
    }

    /// Whether `getExplicitTypeOfSymbol` returns the type of `prop`.
    fn has_explicit_type(&mut self, prop: &Prop) -> bool {
        if prop.flags.contains(PropFlags::ACCESSOR) {
            return false;
        }
        match &prop.source {
            PropSource::Symbol(sym) => self.explicit_type_of_symbol(*sym).is_some(),
            // `SymbolFlagsMethod`. No other member has a type annotation.
            PropSource::Literal(f, p) => self.hir(*f)[*p].kind == PropKind::Method,
            // `syntheticOrigin`
            PropSource::Mapped(_, _, Some(origin)) => origin
                .first()
                .is_some_and(|origin| self.has_explicit_type(origin)),
            // It has the `ValueDeclaration` and the flags of the first.
            PropSource::Copy(_, copied, true) => copied
                .first()
                .is_some_and(|first| self.has_explicit_type(first)),
            PropSource::Intersected(_, parts) => {
                // `createUnionOrIntersectionProperty`, `isInstantiation`: instantiations of one
                // property that have the same type are that property.
                let (single, others) = (&parts[0], &parts[1..]);
                if others.iter().all(|other| other.source == single.source) {
                    let ty = self.type_of_prop(single, MapperId::IDENTITY);
                    if (others.iter())
                        .all(|other| self.type_of_prop(other, MapperId::IDENTITY) == ty)
                    {
                        return self.has_explicit_type(single);
                    }
                }
                // `SymbolFlagsProperty`, even if all are methods.
                (self.value_declaration_of_prop(prop)).is_some_and(|(f, declaration)| {
                    self.is_declaration_with_explicit_type_annotation(f, declaration)
                })
            }
            // No `ValueDeclaration`.
            PropSource::Type(_)
            | PropSource::Mapped(_, _, None)
            | PropSource::Copy(_, _, false)
            | PropSource::ReverseMapped(..) => false,
        }
    }

    /// `isDeclarationWithExplicitTypeAnnotation`
    fn is_declaration_with_explicit_type_annotation(&self, f: FileId, declaration: Decl) -> bool {
        let (hir, bound) = (self.hir(f), self.bound(f));
        match declaration {
            Decl::Var(pat) | Decl::Param(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Var(d) => hir[d].ty.is_some(),
                PatParent::Param(p) => hir[p].ty.is_some(),
                _ => false,
            },
            Decl::ParameterProperty(p) => hir[p].ty.is_some(),
            Decl::Member(m) => hir[m].kind == MemberKind::Property && hir[m].ty.is_some(),
            // `isExpandoPropertyFunctionWithReturnTypeAnnotation`
            Decl::Expando(assignment)
            | Decl::ThisProperty(assignment)
            | Decl::ModuleExports(assignment)
            | Decl::ExportsProperty(assignment) => {
                matches!(hir[assignment].kind, ExprKind::Assign { value, .. }
                    if !is_parenthesized(hir, value) && matches!(hir[value].kind, ExprKind::Fn(func) if hir[func].ret.is_some()))
            }
            _ => false,
        }
    }

    /// `getExplicitTypeOfSymbol`. `has_explicit_type` has the properties that have no `Sym`.
    fn explicit_type_of_symbol(&mut self, sym: Sym) -> Option<TypeId> {
        // `for (var a of b) for (var b of a)`
        if self.is_stack_low() {
            return None;
        }
        let Some(sym) = self.files().resolve_alias_if_needed(sym) else {
            // `resolveSymbol`: a target that is not in the symbol tables is a property.
            let AliasTarget::Property(obj, name, _) = self.resolve_alias(sym) else {
                return None;
            };
            return self.explicit_type_of_property(obj, name);
        };
        let flags = self.files().flags(sym);
        let declares_its_type =
            SymFlags::FUNCTION | SymFlags::METHOD | SymFlags::CLASS | SymFlags::VALUE_MODULE;
        if flags.intersects(declares_its_type) {
            return Some(self.type_of_symbol(sym));
        }
        if !flags.intersects(SymFlags::VARIABLE | SymFlags::PROPERTY) {
            return None;
        }
        let (f, declaration) = self.files().value_declaration(sym)?;
        // The result is the type of the variable: an optional parameter may be `undefined`.
        if self.is_declaration_with_explicit_type_annotation(f, declaration) {
            return Some(self.type_of_symbol(sym));
        }
        // The variable of `for (const f of fs)` has the element type of `fs`, as far as annotations
        // determine the type of `fs`.
        let (hir, bound) = (self.hir(f), self.bound(f));
        let Decl::Var(pat) = declaration else {
            return None;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return None;
        };
        let stmt = bound.var_stmt[d.idx()];
        if stmt.is_some()
            && let Parent::Stmt(owner) = bound.stmt_parent[stmt.idx()]
            && let StmtKind::ForOf {
                left,
                expr,
                is_await,
                ..
            } = hir[owner].kind
            && left == stmt
        {
            let iterable = self.explicit_type(f, expr)?;
            return Some(self.checked_iterated_type(iterable, is_await));
        }
        None
    }

    /// `getExplicitThisType`: the declared type of `this`. Nothing is narrowed.
    fn explicit_this_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        use crate::bind::{FnOwner, MemberOwner};
        let (class, is_static) = match self.this_container(file, e)? {
            Err(of_class) => of_class,
            Ok(func) => {
                let this_ty = self.hir(file)[func].this_ty(self.hir(file));
                if this_ty.is_some() {
                    return Some(self.type_from_node(file, this_ty));
                }
                // `assignContextualParameterTypes` gives a function without a `this` parameter a
                // copy of that of its contextual signature, which has the declaration of the
                // original: `this: T`.
                if let FnOwner::Expr(owner) = self.bound(file).fns[func.idx()].owner
                    && self.is_context_sensitive_function_or_method(file, func, owner)
                    && let Some(sig) = self.assigned_contextual_signature(file, func)
                    && let Some(this) = self.sig_this_type(sig)
                {
                    return Some(this);
                }
                let FnOwner::Member(m) = self.bound(file).fns[func.idx()].owner else {
                    return None;
                };
                let MemberOwner::Class(class) = self.bound(file).member_owner[m.idx()] else {
                    return None;
                };
                (class, self.hir(file)[m].flags.contains(Flags::STATIC))
            }
        };
        let sym = self.class_sym(file, class);
        Some(if is_static {
            self.type_of_symbol(sym)
        } else {
            self.intern(TypeData::ThisParam(sym))
        })
    }

    /// The `getResolvedSignature` branch of `getEffectsSignature`. tsgo caches the result unconditionally, including resolutions made
    /// during the analysis of a flow loop or inside a cycle, where the resolved signature itself is not cached. Without this cache
    /// every visit of a condition or call node resolves the call again: exponential in the number of guard and assertion calls.
    fn resolved_effects_signature(&mut self, file: FileId, call: ExprId) -> Option<SigId> {
        if let Some(cached) = (self.p.resolved_effects_signatures).get(&self.task, &(file, call)) {
            return cached;
        }
        let resolved = self.resolved_signature(file, call);
        // `UNRESOLVED`: the query was refused by the depth or stack limit.
        if resolved.ret != TypeId::UNRESOLVED {
            let (key, stored) = ((file, call), Stored::new());
            (self.p.resolved_effects_signatures).rewrite(&self.task, key, resolved.sig, stored);
        }
        resolved.sig
    }

    /// `getEffectsSignature` for a call statement: the called signature, if it is declared to
    /// assert something or to never return.
    pub(super) fn effects_signature(&mut self, file: FileId, call: ExprId) -> Option<SigId> {
        self.effects_signature_and_is_cached(file, call).0
    }

    /// The same, and whether it is cached in `effects_signatures`.
    fn effects_signature_and_is_cached(
        &mut self,
        file: FileId,
        call: ExprId,
    ) -> (Option<SigId>, bool) {
        if let Some(known) = self.p.effects_signatures.get(&self.task, &(file, call)) {
            return (known, true);
        }
        let mut required_resolution = false;
        let (sig, stored) = self
            .run_memoizable(|c| c.effects_signature_uncached(file, call, &mut required_resolution));
        // `explicit_type_of_symbol` returns nothing when the stack is low.
        let stored = stored.filter(|_| !required_resolution && !self.is_stack_low());
        if let Some(stored) = stored {
            (self.p.effects_signatures).rewrite(&self.task, (file, call), sig, stored);
        }
        (sig, stored.is_some())
    }

    /// `effects_signatures` has `None` for the call of the flow node `flow`.
    #[inline(never)]
    fn note_idle_call(&mut self, file: FileId, flow: FlowId) {
        // Nearly all walks are in the file of the task.
        if self.task.file != Some(file) {
            return;
        }
        let words = self.bound(file).flow.len() / 64 + 1;
        let memo = &mut self.flow_memo;
        if memo.idle_calls_of != Some(file) {
            memo.idle_calls_of = Some(file);
            memo.idle_calls.clear();
            memo.idle_calls.resize(words, 0);
        }
        memo.idle_calls[flow.idx() / 64] |= 1 << (flow.idx() % 64);
    }

    /// `required_resolution`: the result is as cacheable as the resolution of the call, which
    /// tracks that itself.
    fn effects_signature_uncached(
        &mut self,
        file: FileId,
        call: ExprId,
        required_resolution: &mut bool,
    ) -> Option<SigId> {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return None;
        };
        let callee = self.explicit_type(file, hir[c].callee)?;
        let sigs = self.signatures(callee, false);
        let sig = match sigs[..] {
            [only] if self.sig_type_params(only).is_empty() => only,
            _ => {
                if !(sigs.iter()).any(|&s| self.has_type_predicate_or_never_return_type(s, true)) {
                    return None;
                }
                *required_resolution = true;
                self.resolved_effects_signature(file, call)?
            }
        };
        self.asserts_or_never_returns(sig).then_some(sig)
    }

    /// `hasTypePredicateOrNeverReturnType`, excluding `x is T`, which a call statement ignores.
    fn asserts_or_never_returns(&mut self, sig: SigId) -> bool {
        self.has_type_predicate_or_never_return_type(sig, false)
    }

    /// `hasTypePredicateOrNeverReturnType`. `is_guard_included`: `x is T` counts.
    fn has_type_predicate_or_never_return_type(
        &mut self,
        sig: SigId,
        is_guard_included: bool,
    ) -> bool {
        let Some((file, func, _)) = self.sig_decl(sig) else {
            return false;
        };
        let ret = self.hir(file)[func].ret;
        if ret.is_none() {
            return false;
        }
        match self.hir(file)[ret].kind {
            TypeNodeKind::Predicate { asserts, .. } => {
                // `getTypePredicateOfSignature` resolves the predicate type of `x is T` as well as of `asserts x is T`.
                let predicate = self.sig_predicate(sig);
                (asserts || is_guard_included) && predicate.is_some()
            }
            TypeNodeKind::Keyword(keyword) => keyword == Keyword::Never,
            // `getReturnTypeFromAnnotation`: `never` through an alias.
            _ => {
                let returned = self.type_from_node(file, ret);
                returned.is_never()
            }
        }
    }

    fn narrow_by_assertion(&mut self, reference: &Reference, ty: TypeId, call: ExprId) -> TypeId {
        let file = reference.file;
        let Some(sig) = self.effects_signature(file, call) else {
            return ty;
        };
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else {
            return ty;
        };
        match self.sig_predicate(sig) {
            Some(predicate) if predicate.asserts => {
                let receiver = match hir[hir[c].callee].kind {
                    ExprKind::Dot { obj, .. } => Some(obj),
                    _ => None,
                };
                // A generic assertion has to be resolved to know what it asserts.
                let predicate = if self.sig_type_params(sig).is_empty() {
                    predicate
                } else {
                    match self
                        .resolved_effects_signature(file, call)
                        .and_then(|s| self.sig_predicate(s))
                    {
                        Some(p) => p,
                        None => return ty,
                    }
                };
                self.apply_predicate(reference, ty, predicate, hir[c].args, receiver, true)
            }
            _ => ty,
        }
    }

    /// `isReachableFlowNode`
    pub(super) fn is_reachable(&mut self, file: FileId, flow: FlowId) -> bool {
        let reachable = self.is_reachable_worker(file, flow, false, &mut Vec::new());
        self.last_flow_node = (file, flow, reachable);
        reachable
    }

    /// `isReachableFlowNodeWorker`
    fn is_reachable_worker(
        &mut self,
        file: FileId,
        mut flow: FlowId,
        mut no_cache_check: bool,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let bound = self.bound(file);
        loop {
            if (file, flow) == (self.last_flow_node.0, self.last_flow_node.1) {
                return self.last_flow_node.2;
            }
            if bound.is_shared(flow) {
                if !no_cache_check {
                    if let Some(kept) = self.p.flow_node_reachable.get(&self.task, &(file, flow)) {
                        return kept;
                    }
                    let (reachable, stored) =
                        self.run_memoizable(|c| c.is_reachable_worker(file, flow, true, reduced));
                    if stored.is_some() {
                        (self.p.flow_node_reachable).rewrite(&self.task, (file, flow), reachable);
                    }
                    return reachable;
                }
                no_cache_check = false;
            }
            match bound.flow[flow.idx()] {
                Flow::Unreachable => return false,
                Flow::Start { .. } | Flow::StartInvoked { .. } => return true,
                Flow::Assign { before, .. }
                | Flow::Cond { before, .. }
                | Flow::ArrayMutation { before, .. } => flow = before,
                Flow::Call { before, call } => {
                    if !self.flow_memo.is_idle_call(file, flow)
                        && let Some(sig) = self.effects_signature(file, call)
                    {
                        match self.sig_predicate(sig) {
                            // It never returns.
                            None => return false,
                            // `assert(false)`
                            Some(Predicate {
                                param: Some(i),
                                ty: None,
                                asserts: true,
                            }) => {
                                let hir = self.hir(file);
                                if let ExprKind::Call(c) = hir[call].kind
                                    && let Some(asserted) = hir.ids(hir[c].args).nth(i)
                                    && self.is_false_expression(file, asserted)
                                {
                                    return false;
                                }
                            }
                            Some(_) => {}
                        }
                    }
                    flow = before;
                }
                Flow::Switch {
                    before,
                    stmt,
                    from,
                    to,
                } => {
                    if from == to && self.is_exhaustive_switch(file, stmt) {
                        return false;
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    // "Cache is unreliable once we start adjusting labels"
                    self.last_flow_node.1 = FlowId::NONE;
                    reduced.push((label, instead));
                    let reachable = self.is_reachable_worker(file, before, false, reduced);
                    reduced.pop();
                    return reachable;
                }
                Flow::Label { .. } => {
                    // One native frame per label. With `allowUnreachableCode: true` no earlier statement has filled the cache.
                    if self.is_stack_low() {
                        return true;
                    }
                    return branch_label_antecedents(bound, flow, reduced)
                        .iter()
                        .any(|&edge| self.is_reachable_worker(file, edge, false, reduced));
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) => flow = entry,
                    None => return false,
                },
            }
        }
    }

    /// `isPostSuperFlowNode`
    pub(super) fn is_post_super(
        &mut self,
        file: FileId,
        mut flow: FlowId,
        mut no_cache_check: bool,
        reduced: &mut Vec<(FlowId, FlowId)>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            if bound.is_shared(flow) {
                if !no_cache_check {
                    if let Some(&kept) = self.flow_memo.flow_node_post_super.get(&(file, flow)) {
                        return kept;
                    }
                    let is_post_super = self.is_post_super(file, flow, true, reduced);
                    let kept = &mut self.flow_memo.flow_node_post_super;
                    kept.insert((file, flow), is_post_super);
                    return is_post_super;
                }
                no_cache_check = false;
            }
            match bound.flow[flow.idx()] {
                // Unreachable nodes are skipped.
                Flow::Unreachable => return true,
                Flow::Start { .. } | Flow::StartInvoked { .. } => return false,
                Flow::Assign { before, .. }
                | Flow::Cond { before, .. }
                | Flow::ArrayMutation { before, .. }
                | Flow::Switch { before, .. } => {
                    flow = before;
                }
                Flow::Call { before, call } => {
                    if matches!(hir[call].kind, ExprKind::Call(c) if matches!(hir[hir[c].callee].kind, ExprKind::Super))
                    {
                        return true;
                    }
                    flow = before;
                }
                Flow::Reduce {
                    before,
                    label,
                    instead,
                } => {
                    reduced.push((label, instead));
                    let is_post_super = self.is_post_super(file, before, false, reduced);
                    reduced.pop();
                    return is_post_super;
                }
                Flow::Label { .. } => {
                    return branch_label_antecedents(bound, flow, reduced)
                        .iter()
                        .all(|&edge| self.is_post_super(file, edge, false, reduced));
                }
                Flow::Loop { start, len } => match bound.edges(start, len).first() {
                    Some(&entry) => flow = entry,
                    None => return true,
                },
            }
        }
    }

    /// `checkExpressionCached`: the type of `e`, computed with an empty `flowLoopStack`. It is complete, whatever incomplete types the
    /// analyses started for it met.
    fn type_of_expr_outside_loops(&mut self, file: FileId, e: ExprId) -> TypeId {
        let loops = std::mem::take(&mut self.flow_loops);
        let cache = std::mem::take(&mut self.flow_type_cache);
        let depth = std::mem::replace(&mut self.flow_type_cache_depth, usize::MAX);
        let ty = self.type_of_expr(file, e);
        self.flow_type_cache = cache;
        self.flow_type_cache_depth = depth;
        self.flow_loops = loops;
        ty
    }

    /// `computeExhaustiveSwitchStatement`: whether the cases cover every possible value of the
    /// `switch` expression.
    fn is_exhaustive_switch(&mut self, file: FileId, stmt: StmtId) -> bool {
        let hir = self.hir(file);
        let StmtKind::Switch { expr, cases } = hir[stmt].kind else {
            return false;
        };
        if let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = hir[expr].kind
            && !is_parenthesized(hir, expr)
        {
            let Some(witnesses) = self.switch_typeof_witnesses(file, cases) else {
                return false;
            };
            let ty = self.type_of_expr_outside_loops(file, operand);
            let ty = self.base_constraint_of(ty).unwrap_or(ty);
            if ty == TypeId::UNRESOLVED {
                return false;
            }
            let not_equal = not_equal_facts_from_typeof_switch(&witnesses, 0, 0);
            // A type that can be anything is covered by all possible `typeof` results.
            if self.has_any_flag(ty) || ty == TypeId::UNKNOWN {
                return facts::ALL_TYPEOF_NE & not_equal == facts::ALL_TYPEOF_NE;
            }
            // `someType` tests `never` itself, which has no facts: the condition holds vacuously.
            if ty.is_never() {
                return not_equal != 0;
            }
            return !self
                .parts(ty)
                .iter()
                .any(|&m| self.type_facts(m, not_equal) == not_equal);
        }
        let ty = self.type_of_expr_outside_loops(file, expr);
        let ty = self.base_constraint_of(ty).unwrap_or(ty);
        // `isLiteralType`
        if cases.is_empty() || !self.every_type(ty, |c, m| c.is_unit(m)) {
            return false;
        }
        let mut tested = Vec::with_capacity(cases.len());
        for c in cases.iter() {
            let test = hir[c].test;
            if test.is_none() {
                continue;
            }
            let t = self.get_type_of_expression(file, test);
            let t = self.regular(t);
            // `isNeitherUnitTypeNorNever`
            if !self.is_unit(t) && !t.is_never() {
                return false;
            }
            tested.push(t);
        }
        // `eachTypeContainedIn`: by type identity, not by comparability.
        self.every_type(ty, |c, m| tested.contains(&c.with_freshness(m, false)))
    }

    // ───────────────────────────── the rest ─────────────────────────────

    /// `isInCompoundLikeAssignment`: `x = x + 1` is `x += 1` expanded, and a `0` is not assumed to
    /// keep its literal type.
    pub(super) fn is_in_compound_like_assignment(&self, file: FileId, target: ExprId) -> bool {
        let hir = self.hir(file);
        let crate::bind::Parent::Expr(parent) = self.bound(file).expr_parent[target.idx()] else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target: assigned,
            value,
        } = hir[parent].kind
        else {
            return false;
        };
        assigned == target
            && matches!(
                hir[value].kind,
                ExprKind::Binary {
                    op: BinOp::Add
                        | BinOp::Sub
                        | BinOp::Mul
                        | BinOp::Div
                        | BinOp::Rem
                        | BinOp::Pow
                        | BinOp::Shl
                        | BinOp::Shr
                        | BinOp::UShr,
                    ..
                }
            )
    }

    /// `getTypePredicateFromBody`: `x => x.kind === "a"` is a type guard without declaring one.
    pub(super) fn inferred_predicate(&mut self, file: FileId, func: FnId) -> Option<Predicate> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || f.params.is_empty() {
            return None;
        }
        if !matches!(
            f.kind,
            FnKind::Arrow | FnKind::Expr | FnKind::Decl | FnKind::Method
        ) {
            return None;
        }
        let info = bound.fns[func.idx()];
        // The single returned expression, and the flow node at that point. `NONE`: the start of the
        // function.
        let (body, before) = match f.body {
            FnBody::Expr(e) => (e, FlowId::NONE),
            FnBody::Block(_) => {
                let mut returns = bound.ids(info.returns);
                let (Some(only), None) = (returns.next(), returns.next()) else {
                    return None;
                };
                let StmtKind::Return(e) = hir[only].kind else {
                    return None;
                };
                if e.is_none() {
                    return None;
                }
                // `checkIfExpressionRefinesParameter`: the flow node of the `return` applies to its
                // direct operand. A parenthesized condition is treated as if nothing preceded it.
                let is_on_its_own =
                    is_parenthesized(hir, e) && bound.expr_flow[e.idx()] == UNREACHABLE;
                (
                    e,
                    if is_on_its_own {
                        FlowId::NONE
                    } else {
                        bound.stmt_flow[only.idx()]
                    },
                )
            }
            FnBody::None => return None,
        };
        // Expressions that cannot narrow anything are skipped.
        if !matches!(
            hir[body].kind,
            ExprKind::Binary { .. }
                | ExprKind::Assign { .. }
                | ExprKind::Unary { op: UnOp::Not, .. }
                | ExprKind::Call(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Ident(_)
                | ExprKind::NonNull(_)
                | ExprKind::Satisfies { .. }
        ) {
            return None;
        }
        if let Some(kept) = self
            .p
            .type_predicates_from_body
            .get(&self.task, &(file, func))
        {
            return kept;
        }
        // `sig.resolvedTypePredicate = c.noTypePredicate // avoid infinite loop`: a condition
        // evaluated along the way may call the function.
        if (self.flow_memo.type_predicates_in_progress).contains(&(file, func)) {
            return None;
        }
        self.flow_memo
            .type_predicates_in_progress
            .push((file, func));
        let (predicate, stored) = self.run_memoizable(|c| {
            c.check_if_expression_refines_any_parameter(file, func, body, before)
        });
        self.flow_memo.type_predicates_in_progress.pop();
        if let Some(stored) = stored {
            (self.p.type_predicates_from_body).insert(&self.task, (file, func), predicate, stored);
        }
        predicate
    }

    /// `checkExpressionCached(e)`, where `e` may be the body that `getReturnTypeFromBody` is
    /// checking for `contextuallyCheckFunctionExpressionOrObjectLiteralMethod`, which pushes no
    /// type resolution. `checkExpression` has no re-entrancy guard: `e` is checked again, and the
    /// first resolution on the way that is in progress closes the cycle. From then on
    /// `links.resolvedType` has the result, also for `getReturnTypeOfSignature`, while the first
    /// check is still in progress.
    fn check_expression_cached_again(&mut self, file: FileId, e: ExprId) -> TypeId {
        let q = Query::Expr(file, e);
        let from = self.resolution_start.min(self.stack.len());
        let Some(first) = self.stack[from..].iter().rposition(|&x| x == q) else {
            return self.type_of_expr(file, e);
        };
        let first = first + from;
        if let Some(raw) = self.provisional(q) {
            return TypeId(raw as u32);
        }
        let height = self.stack.len();
        let rechecks_at = std::mem::replace(&mut self.rechecks_at, height);
        let ty = self.check_expression_ex(file, e, CheckMode::empty());
        self.rechecks_at = rechecks_at;
        // Valid until the first check ends. A hit taints what computing it again would.
        let entry = Provisional {
            raw: u64::from(ty.0),
            depth: first as u32,
            from: first as u32 + 1,
            height: height as u32,
            moved: 1,
            serial: self.frames[first].serial,
        };
        self.provisional.insert(q, entry);
        ty
    }

    /// `checkIfExpressionRefinesAnyParameter`, and `functionHasImplicitReturn` before it.
    fn check_if_expression_refines_any_parameter(
        &mut self,
        file: FileId,
        func: FnId,
        body: ExprId,
        before: FlowId,
    ) -> Option<Predicate> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (f, info) = (&hir[func], bound.fns[func.idx()]);
        if info.end.is_some() && info.end != UNREACHABLE && self.is_reachable(file, info.end) {
            return None;
        }
        let returned = self.check_expression_cached_again(file, body);
        if !self.is_boolean(returned) {
            return None;
        }
        for (i, p) in f.params.iter().enumerate() {
            let param = &hir[p];
            if param.flags.contains(Flags::REST)
                || !matches!(hir[param.pat].kind, PatKind::Ident(_))
            {
                continue;
            }
            let symbol = bound.pat_symbol[param.pat.idx()];
            if bound.symbols[symbol.idx()]
                .flags
                .contains(SymFlags::ASSIGNED)
            {
                continue;
            }
            let declared = self.type_of_param(file, p);
            // `x is true` is not useful.
            if self.is_boolean(declared) {
                continue;
            }
            // `checkIfExpressionRefinesParameter`
            let reference = Reference {
                file,
                root: Root::Symbol(symbol),
                path: SmallVec::new(),
                at: ExprId::NONE,
                has_key: true,
            };
            let outer = std::mem::replace(&mut self.walk_declared, declared);
            let when_true =
                self.param_type_past_test(&reference, declared, declared, before, body, true);
            // It has to be "if and only if": nothing of the narrowed type may fail the test.
            let leftover = if when_true == declared {
                when_true
            } else {
                let left =
                    self.param_type_past_test(&reference, declared, when_true, before, body, false);
                self.reduced(left)
            };
            self.walk_declared = outer;
            // `x is never` is a type guard like any other, unless the empty result depends on an
            // unresolved type.
            if when_true == declared || !leftover.is_never() {
                continue;
            }
            return Some(Predicate {
                param: Some(i),
                ty: Some(when_true),
                asserts: false,
            });
        }
        None
    }

    /// `getFlowTypeOfReference` for a parameter declared as `declared` whose type is `initial` at
    /// the start of its function, after the condition `test`, which is evaluated at `before`
    /// (`NONE`: the start of the function) with the outcome `sense`.
    fn param_type_past_test(
        &mut self,
        reference: &Reference,
        declared: TypeId,
        initial: TypeId,
        before: FlowId,
        test: ExprId,
        sense: bool,
    ) -> TypeId {
        let start = if before.is_none() {
            initial
        } else {
            let mut walk = Walk::new(reference.clone(), declared, initial, false);
            let ty = self.flow_type(&mut walk, before).ty;
            if walk.steps >= MAX_STEPS {
                declared
            } else {
                ty
            }
        };
        // `getTypeAtFlowCondition`, and the end of `getFlowTypeOfReferenceEx`
        if start == TypeId::UNREACHABLE_NEVER {
            declared
        } else if start.is_never() {
            start
        } else {
            self.narrow(reference, start, test, sense)
        }
    }
}
